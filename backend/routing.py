"""Road routes, address search and where an ambulance is right now.

* Routes come from an OSRM server (OpenStreetMap road data). The free-flow time it gives is
  multiplied by ROUTE_TRAFFIC_FACTOR for Mumbai traffic. If the server cannot be reached a straight
  line is used, so a booking never fails because of the map.
* Addresses come from Nominatim (OpenStreetMap). Its rules allow about one request per second, so
  calls are spaced out and results are cached.
* An ambulance whose driver has the driver page open reports real GPS. When no fresh GPS is coming
  in, its position is estimated from the time since dispatch along the planned road route, and the
  page says that it is an estimate.
"""
import re
import threading
import time
from datetime import timedelta

import requests

from . import config
from .db import db, now
from .utils import distance_km

USER_AGENT = "SmartHealth-Hospital-App/2.0 (hospital management project)"
GPS_FRESH_SECONDS = 90
_geo_lock = threading.Lock()
_geo_last = [0.0]


def hospital():
    return {"name": config.HOSPITAL_NAME, "phone": config.HOSPITAL_PHONE, "address": config.HOSPITAL_ADDRESS,
            "lat": config.HOSPITAL_LAT, "lng": config.HOSPITAL_LNG}


# ---------------------------------------------------------------- routes

def _cache_get(key):
    hit = db.geo_cache.find_one({"_id": key})
    return hit["value"] if hit else None


def _cache_put(key, value):
    db.geo_cache.replace_one({"_id": key}, {"_id": key, "value": value, "created_at": now()}, upsert=True)


def _thin(coords, limit=700):
    if len(coords) <= limit:
        return coords
    step = len(coords) / float(limit)
    picked = [coords[int(i * step)] for i in range(limit)]
    picked[-1] = coords[-1]
    return picked


def straight_route(a_lat, a_lng, b_lat, b_lng):
    km = distance_km(a_lat, a_lng, b_lat, b_lng)
    road_km = km * 1.35  # roads are longer than the straight line
    return {"coords": [[a_lat, a_lng], [b_lat, b_lng]], "distance_m": round(road_km * 1000),
            "duration_s": round(road_km / 25 * 3600), "source": "estimate"}


def road_route(a_lat, a_lng, b_lat, b_lng):
    """Driving route from A to B: {coords [[lat, lng] ...], distance_m, duration_s, source}."""
    key = f"route:{a_lat:.5f},{a_lng:.5f};{b_lat:.5f},{b_lng:.5f}"
    cached = _cache_get(key)
    if cached:
        return cached
    try:
        res = requests.get(f"{config.OSRM_URL}/route/v1/driving/{a_lng:.6f},{a_lat:.6f};{b_lng:.6f},{b_lat:.6f}",
                           params={"overview": "full", "geometries": "geojson"}, timeout=8,
                           headers={"User-Agent": USER_AGENT})
        data = res.json()
        if res.status_code != 200 or data.get("code") != "Ok" or not data.get("routes"):
            raise ValueError(data.get("message") or data.get("code"))
        r = data["routes"][0]
        coords = [[round(lat, 6), round(lng, 6)] for lng, lat in r["geometry"]["coordinates"]]
        # the route starts / ends on the nearest road: join it to the exact points
        if coords[0] != [a_lat, a_lng]:
            coords.insert(0, [a_lat, a_lng])
        if coords[-1] != [b_lat, b_lng]:
            coords.append([b_lat, b_lng])
        route = {"coords": _thin(coords), "distance_m": round(r["distance"]),
                 "duration_s": round(r["duration"] * config.ROUTE_TRAFFIC_FACTOR), "source": "road"}
        _cache_put(key, route)
        return route
    except (requests.RequestException, ValueError, KeyError) as exc:
        print(f"[routing] OSRM route failed, using a straight line: {exc}")
        return straight_route(a_lat, a_lng, b_lat, b_lng)


def route_summary(route):
    if not route:
        return None
    return {"km": round(route["distance_m"] / 1000, 1), "minutes": max(1, round(route["duration_s"] / 60)),
            "source": route.get("source", "road")}


def _cumulative(coords):
    total, out = 0.0, [0.0]
    for i in range(1, len(coords)):
        total += distance_km(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1])
        out.append(total)
    return out


def point_along(coords, fraction):
    """The point `fraction` (0..1) of the way along the route, and the heading index."""
    if not coords:
        return None
    if len(coords) == 1 or fraction <= 0:
        return coords[0]
    cum = _cumulative(coords)
    target = cum[-1] * min(fraction, 1.0)
    for i in range(1, len(cum)):
        if cum[i] >= target:
            seg = cum[i] - cum[i - 1]
            t = 0 if seg == 0 else (target - cum[i - 1]) / seg
            return [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
                    coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t]
    return coords[-1]


def remaining_along(coords, lat, lng):
    """Fraction of the route already driven for a GPS position, using the nearest route point."""
    if not coords or len(coords) < 2:
        return 0.0
    cum = _cumulative(coords)
    best_i, best_d = 0, None
    for i, (plat, plng) in enumerate(coords):
        d = distance_km(lat, lng, plat, plng)
        if best_d is None or d < best_d:
            best_i, best_d = i, d
    if cum[-1] == 0:
        return 1.0
    return cum[best_i] / cum[-1]


# ---------------------------------------------------------------- where is the ambulance

def gps_is_fresh(amb):
    at = amb.get("gps_at") if amb else None
    return bool(at) and amb.get("lat") is not None and at > now() - timedelta(seconds=GPS_FRESH_SECONDS)


def plan_route(amb, to_lat, to_lng):
    """Route an ambulance will drive to a patient: from its live GPS position when it has one,
    otherwise from the hospital, where it is parked."""
    if amb and gps_is_fresh(amb):
        start = (float(amb["lat"]), float(amb["lng"]))
    else:
        start = (config.HOSPITAL_LAT, config.HOSPITAL_LNG)
    return road_route(start[0], start[1], to_lat, to_lng)


def progress(job, amb):
    """Where the ambulance of a dispatched job is: {lat, lng, live, fraction, km_left, minutes_left}."""
    route = job.get("route") or {}
    coords = route.get("coords") or []
    if job.get("status") not in ("Dispatched",) or not coords:
        return None
    if gps_is_fresh(amb):
        lat, lng = float(amb["lat"]), float(amb["lng"])
        frac = remaining_along(coords, lat, lng)
        live = True
    else:
        started = job.get("dispatched_at") or now()
        duration = max(60, route.get("duration_s") or 60)
        frac = min(1.0, max(0.0, (now() - started).total_seconds() / duration))
        lat, lng = point_along(coords, frac)
        live = False
    left = 1.0 - frac
    return {"lat": round(lat, 6), "lng": round(lng, 6), "live": live, "fraction": round(frac, 4),
            "km_left": round(route["distance_m"] * left / 1000, 1),
            "minutes_left": max(0, round(route["duration_s"] * left / 60)) if left > 0.005 else 0}


def advance_simulation():
    """Moves every dispatched ambulance that is not sending GPS to its estimated position, and marks
    the job as arrived once the estimate reaches the patient. Called whenever a map is refreshed."""
    for coll, arrived in (("sos_alerts", "Arrived"), ("ambulance_requests", "Arrived")):
        for job in db[coll].find({"status": "Dispatched", "ambulance_id": {"$ne": None}, "route": {"$ne": None}}):
            amb = db.ambulances.find_one({"_id": job["ambulance_id"]})
            if not amb or gps_is_fresh(amb):
                continue
            p = progress(job, amb)
            if not p:
                continue
            db.ambulances.update_one({"_id": amb["_id"]}, {"$set": {"lat": p["lat"], "lng": p["lng"], "simulated": True}})
            if p["fraction"] >= 1.0:
                db[coll].update_one({"_id": job["_id"], "status": "Dispatched"},
                                    {"$set": {"status": arrived, "arrived_at": now(), "updated_at": now()}})


def park_at_hospital(amb_id):
    """After a job an ambulance without live GPS is shown back at the hospital."""
    amb = db.ambulances.find_one({"_id": amb_id})
    if amb and not gps_is_fresh(amb):
        db.ambulances.update_one({"_id": amb_id}, {"$set": {"lat": config.HOSPITAL_LAT, "lng": config.HOSPITAL_LNG, "simulated": True}})


# ---------------------------------------------------------------- addresses

def _nominatim(path, params):
    key = "geo:" + path + ":" + "&".join(f"{k}={v}" for k, v in sorted(params.items()))
    cached = _cache_get(key)
    if cached is not None:
        return cached
    with _geo_lock:  # at most one request per second to the public server
        wait = 1.05 - (time.time() - _geo_last[0])
        if wait > 0:
            time.sleep(wait)
        _geo_last[0] = time.time()
        res = requests.get(f"{config.NOMINATIM_URL}/{path}", params={**params, "format": "jsonv2"},
                           headers={"User-Agent": USER_AGENT, "Accept-Language": "en"}, timeout=8)
    res.raise_for_status()
    data = res.json()
    _cache_put(key, data)
    return data


def short_address(display_name):
    parts = [p.strip() for p in (display_name or "").split(",")]
    drop = {"India", "Maharashtra", "Mumbai Suburban District", "Mumbai City District"}
    parts = [p for p in parts if p and p not in drop and not p.startswith("Mumbai Zone") and not p.endswith(" Ward")]
    return ", ".join(parts[:6])


def search_places(q):
    """Places matching the text, nearest to Mumbai first (the whole of India is searched)."""
    data = _nominatim("search", {"q": q, "countrycodes": "in", "limit": 6,
                                 "viewbox": "72.70,19.45,73.20,18.85", "bounded": 0})
    places = []
    for p in data:
        lat, lng = float(p["lat"]), float(p["lon"])
        places.append({"name": short_address(p.get("display_name")), "lat": lat, "lng": lng,
                       "km": round(distance_km(config.HOSPITAL_LAT, config.HOSPITAL_LNG, lat, lng), 1)})
    places.sort(key=lambda x: x["km"])
    return places


def locate_address(text, max_tries=4):
    """Finds a typed address on the map. Full addresses often name a building the map does not
    know ("Rc patel polytechnic shirpur dhule district"), so the leading words are dropped one by
    one until a place is found ("shirpur dhule district"). Returns
    {lat, lng, name, exact} - exact is False when only a shorter part matched - or None."""
    text = re.sub(r"\s+", " ", (text or "").replace("\n", ", ")).strip(" ,")
    if len(text) < 3:
        return None
    parts = [p.strip() for p in text.split(",") if p.strip()]
    tries = [text]
    if len(parts) > 2:
        tries += [", ".join(parts[-3:]), ", ".join(parts[-2:])]
    words = text.replace(",", " ").split()
    for i in range(1, len(words) - 1):
        tries.append(" ".join(words[i:]))
    seen = []
    for q in tries:
        if q in seen or len(q) < 3:
            continue
        seen.append(q)
        if len(seen) > max_tries:
            break
        places = search_places(q[:120])
        if places:
            p = places[0]
            return {"lat": p["lat"], "lng": p["lng"], "name": p["name"], "exact": q == text}
    return None


def reverse_place(lat, lng):
    data = _nominatim("reverse", {"lat": f"{lat:.5f}", "lon": f"{lng:.5f}", "zoom": 18})
    return short_address(data.get("display_name")) if isinstance(data, dict) else ""

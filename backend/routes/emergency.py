"""Ambulance service.

* Ambulance requests (patient books from the website): the pickup point is chosen on the map, by GPS
  or by address; a road route is made from the hospital in Mumbai to the pickup point, the admin
  dispatches an ambulance from the fleet, and the patient follows it live on the map.
* Emergency SOS: anyone presses SOS, the phone's location goes to the hospital, the nearest free
  ambulance is sent along a road route and the caller can follow it.
* Drivers open their private driver link, which shares the ambulance's GPS and shows the job.
"""
from flask import Blueprint, jsonify, request, session

from .. import config
from ..db import db, next_id, now, out
from ..mail import send_email
from ..routing import (advance_simulation, gps_is_fresh, guide_route, hospital, locate_address, nearby_hospitals, park_at_hospital,
                       plan_route, progress, reverse_place, road_route, route_summary, search_places)
from ..utils import (admin_can, arg, background, distance_km, fail, new_token, ok, post, require_perm, to_float, to_int,
                     too_soon, valid_coords)

bp = Blueprint("emergency", __name__)

OPEN_SOS = ["New", "Dispatched", "Arrived"]
OPEN_REQUEST = ["Pending", "Dispatched", "Arrived"]


def coord(key, source=None):
    return to_float((source or request.form).get(key))


def ensure_fleet():
    """A new installation gets two ambulances parked at the hospital, so dispatch works at once.
    The admin can rename or remove them under SOS Alerts > Ambulance Fleet."""
    if db.ambulances.count_documents({}) == 0 and not db.counters.find_one({"_id": "fleet_seeded"}):
        db.counters.insert_one({"_id": "fleet_seeded", "seq": 1})
        for n in (1, 2):
            add_ambulance(f"MH 02 AMB 10{n}", f"Duty Driver {n}", "")


def add_ambulance(vehicle_no, driver_name, driver_phone):
    db.ambulances.insert_one({"_id": next_id("ambulances"), "vehicle_no": vehicle_no[:30], "driver_name": driver_name[:100],
                              "driver_phone": driver_phone[:20] or None, "driver_token": new_token(),
                              "lat": config.HOSPITAL_LAT, "lng": config.HOSPITAL_LNG, "gps_at": None, "simulated": True,
                              "status": "Available", "updated_at": now()})


def amb_public(amb, live=None):
    if not amb:
        return None
    return {"vehicle_no": amb["vehicle_no"], "driver_name": amb["driver_name"], "driver_phone": amb.get("driver_phone"),
            "lat": amb.get("lat"), "lng": amb.get("lng"), "live": gps_is_fresh(amb) if live is None else live,
            "updated_at": out(amb).get("updated_at")}


def nearest_ambulance(lat, lng):
    """Nearest ambulance that is free. One that has not reported a position is taken to be at the hospital."""
    best = None
    for amb in db.ambulances.find({"status": "Available"}):
        a_lat = amb["lat"] if amb.get("lat") is not None else config.HOSPITAL_LAT
        a_lng = amb["lng"] if amb.get("lng") is not None else config.HOSPITAL_LNG
        km = 0 if lat is None else distance_km(a_lat, a_lng, lat, lng)
        if best is None or km < best[1]:
            best = (amb, km)
    return best[0] if best else None


def take_ambulance(ambulance_id, lat, lng):
    """Picks the chosen (or nearest) free ambulance and marks it busy; None when none is free."""
    if ambulance_id:
        return db.ambulances.find_one_and_update({"_id": ambulance_id, "status": "Available"}, {"$set": {"status": "Busy", "updated_at": now()}})
    for _ in range(3):  # another dispatch may take the same one at the same moment: try the next
        amb = nearest_ambulance(lat, lng)
        if not amb:
            return None
        got = db.ambulances.find_one_and_update({"_id": amb["_id"], "status": "Available"}, {"$set": {"status": "Busy", "updated_at": now()}})
        if got:
            return got
    return None


def free_ambulance(amb_id):
    if amb_id:
        db.ambulances.update_one({"_id": amb_id, "status": "Busy"}, {"$set": {"status": "Available", "updated_at": now()}})
        park_at_hospital(amb_id)


def service_info(lat, lng):
    km = distance_km(config.HOSPITAL_LAT, config.HOSPITAL_LNG, lat, lng)
    return {"straight_km": round(km, 1), "in_service_area": km <= config.SERVICE_RADIUS_KM,
            "service_radius_km": config.SERVICE_RADIUS_KM}


# ================================================================= addresses / route preview

@bp.get("/api/geo/search")
def geo_search():
    q = arg("q")
    if len(q) < 3:
        return ok(places=[])
    try:
        return ok(places=search_places(q[:120]))
    except Exception as exc:
        print(f"[geo] search failed: {exc}")
        fail("Address search is not available right now. Drop the pin on the map instead.", 502)


@bp.get("/api/geo/locate")
def geo_locate():
    """Puts a typed address on the map (shortening it until a place is found)."""
    q = arg("q")
    if len(q) < 3:
        return ok(found=False)
    try:
        hit = locate_address(q[:200])
    except Exception as exc:
        print(f"[geo] locate failed: {exc}")
        hit = None
    if not hit:
        return ok(found=False)
    return ok(found=True, **hit, **service_info(hit["lat"], hit["lng"]))


@bp.get("/api/geo/reverse")
def geo_reverse():
    lat, lng = to_float(arg("lat")), to_float(arg("lng"))
    if not valid_coords(lat, lng):
        fail("Invalid location")
    try:
        return ok(address=reverse_place(lat, lng))
    except Exception as exc:
        print(f"[geo] reverse failed: {exc}")
        return ok(address="")


@bp.get("/api/ambulance/route")
def route_preview():
    """Road route from the hospital to a pickup point, shown before the patient books."""
    lat, lng = to_float(arg("lat")), to_float(arg("lng"))
    if not valid_coords(lat, lng):
        fail("Invalid location")
    route = road_route(config.HOSPITAL_LAT, config.HOSPITAL_LNG, lat, lng)
    return ok(route=route["coords"], summary=route_summary(route), hospital=hospital(), **service_info(lat, lng))


# ================================================================= ambulance requests

def ensure_pickup(r):
    """A request booked without a map pin gets its pickup point from the typed address (tried once),
    so the route from the hospital can be drawn. Returns the request as it is now."""
    if r.get("pickup_lat") is not None or not r.get("address") or r.get("geo_tried"):
        return r
    try:
        hit = locate_address(r["address"])
    except Exception as exc:
        print(f"[geo] locate failed for request {r['_id']}: {exc}")
        return r  # the map server is down: try again next time
    changes = {"geo_tried": True}
    if hit:
        changes.update(pickup_lat=hit["lat"], pickup_lng=hit["lng"], pickup_place=hit["name"],
                       pin_source="address" if hit["exact"] else "address-approx",
                       route=road_route(config.HOSPITAL_LAT, config.HOSPITAL_LNG, hit["lat"], hit["lng"]))
    db.ambulance_requests.update_one({"_id": r["_id"]}, {"$set": changes})
    r.update(changes)
    return r


def request_row(r, with_route=False):
    row = out(r, hide=("route", "track_token"))
    row["route_summary"] = route_summary(r.get("route"))
    amb = db.ambulances.find_one({"_id": r["ambulance_id"]}) if r.get("ambulance_id") else None
    row["ambulance"] = amb_public(amb)
    row["eta"] = progress(r, amb) if r.get("status") == "Dispatched" else None
    if r.get("pickup_lat") is not None:
        row.update(service_info(r["pickup_lat"], r["pickup_lng"]))
    if with_route and r.get("route"):
        row["route"] = r["route"]["coords"]
    return row


@bp.get("/api/ambulance")
def list_requests():
    """The admin gets every request (plus the fleet for the map), a patient only their own."""
    advance_simulation()
    if admin_can("ambulance"):
        rows = [ensure_pickup(r) if r.get("status") == "Pending" else r for r in db.ambulance_requests.find().sort("_id", -1)]
        fleet = [{**amb_public(a), "id": a["_id"], "status": a["status"]} for a in db.ambulances.find().sort("_id", 1)]
        return ok(requests=[request_row(r, r.get("status") in ("Pending", "Dispatched", "Arrived")) for r in rows],
                  fleet=fleet, hospital=hospital())
    email = session.get("user_email")
    if not email:
        return ok(requests=[], hospital=hospital())
    rows = db.ambulance_requests.find({"user_id": email}).sort("_id", -1)
    return ok(requests=[request_row(r) for r in rows], hospital=hospital())


@bp.post("/api/ambulance/book")
def book_request():
    uid = session.get("user_email")
    if not uid:
        fail("Please log in again to book an ambulance.", 401)
    name, phone, address, kind = post("name"), post("phone"), post("pickup"), post("destination")
    if not name or not phone or not address:
        fail("Name, phone and pickup address are required.")
    if len("".join(c for c in phone if c.isdigit())) < 10:
        fail("Please enter a valid 10-digit mobile number.")
    if too_soon("ambulance_book", 20):
        fail("Your request was just sent. Please wait a few seconds before booking again.", 429)
    lat, lng = coord("lat"), coord("lng")
    pin_source, place = post("pin_source")[:20] or "map", None
    if not valid_coords(lat, lng):
        # no pin on the map: find the typed address, so a route can still be made
        lat = lng = None
        try:
            hit = locate_address(address)
        except Exception:
            hit = None
        if hit:
            lat, lng, place = hit["lat"], hit["lng"], hit["name"]
            pin_source = "address" if hit["exact"] else "address-approx"
        else:
            pin_source = None
    route = road_route(config.HOSPITAL_LAT, config.HOSPITAL_LNG, lat, lng) if lat is not None else None
    rid = next_id("ambulance_requests")
    db.ambulance_requests.insert_one({
        "_id": rid, "user_id": uid, "patient_name": name[:100], "phone": phone[:20], "address": address[:500],
        "emergency_type": kind[:100] or "General Emergency", "status": "Pending",
        "pickup_lat": lat, "pickup_lng": lng, "pin_source": pin_source, "pickup_place": place, "geo_tried": True,
        "route": route, "ambulance_id": None, "created_at": now(), "updated_at": now(),
        "dispatched_at": None, "arrived_at": None, "completed_at": None})
    summary = route_summary(route)
    return ok(id=rid, message="Ambulance Booked Successfully", route_summary=summary,
              located=lat is not None, **(service_info(lat, lng) if lat is not None else {}))


def own_request(rid):
    r = db.ambulance_requests.find_one({"_id": rid})
    if not r:
        fail("Request not found", 404)
    if not admin_can("ambulance") and r.get("user_id") != session.get("user_email"):
        fail("Please log in again", 401)
    return r


@bp.get("/api/ambulance/track")
def track_request():
    advance_simulation()
    r = ensure_pickup(own_request(to_int(arg("id"))))
    amb = db.ambulances.find_one({"_id": r["ambulance_id"]}) if r.get("ambulance_id") else None
    eta = progress(r, amb) if r["status"] == "Dispatched" else None
    amb_view = amb_public(amb, eta["live"] if eta else None)
    if amb_view and eta:
        amb_view["lat"], amb_view["lng"] = eta["lat"], eta["lng"]
    if amb_view and r["status"] == "Arrived" and r.get("pickup_lat") is not None:
        amb_view["lat"], amb_view["lng"] = r["pickup_lat"], r["pickup_lng"]
    route = r.get("route")
    return ok(request=out(r, hide=("route", "track_token")), ambulance=amb_view, eta=eta,
              route=route["coords"] if route else None, route_summary=route_summary(route), hospital=hospital(),
              **(service_info(r["pickup_lat"], r["pickup_lng"]) if r.get("pickup_lat") is not None else {}))


@bp.post("/api/ambulance/cancel")
def cancel_request():
    r = own_request(to_int(post("id")))
    res = db.ambulance_requests.update_one({"_id": r["_id"], "status": {"$in": ["Pending", "Dispatched"]}},
                                           {"$set": {"status": "Cancelled", "cancelled_at": now(), "updated_at": now()}})
    if res.modified_count != 1:
        fail("This request can no longer be cancelled.", 409)
    free_ambulance(r.get("ambulance_id"))
    return ok()


@bp.post("/api/ambulance/dispatch")
def dispatch_request():
    require_perm("ambulance")
    ensure_fleet()
    r = db.ambulance_requests.find_one({"_id": to_int(post("id")), "status": "Pending"})
    if not r:
        fail("This request is no longer waiting for dispatch. The list has been refreshed.", 409)
    r = ensure_pickup(r)
    amb = take_ambulance(to_int(post("ambulance_id")), r.get("pickup_lat"), r.get("pickup_lng"))
    if not amb:
        fail("No ambulance is free right now. Add one under SOS Alerts > Ambulance Fleet, or finish an active job first.", 409)
    route = plan_route(amb, r["pickup_lat"], r["pickup_lng"]) if r.get("pickup_lat") is not None else None
    if amb.get("lat") is None:
        db.ambulances.update_one({"_id": amb["_id"]}, {"$set": {"lat": config.HOSPITAL_LAT, "lng": config.HOSPITAL_LNG}})
    db.ambulance_requests.update_one({"_id": r["_id"]}, {"$set": {
        "status": "Dispatched", "ambulance_id": amb["_id"], "route": route or r.get("route"),
        "dispatched_at": now(), "updated_at": now()}})
    summary = route_summary(route)
    if r.get("user_id"):
        background(send_email, r["user_id"], "Ambulance on the way - SmartHealth",
            f"Hi {r['patient_name']},\n\nAmbulance {amb['vehicle_no']} (driver {amb['driver_name']}"
            + (f", {amb['driver_phone']}" if amb.get("driver_phone") else "") + ") is on the way to:\n"
            f"{r['address']}\n\n" + (f"Distance: {summary['km']} km - expected in about {summary['minutes']} minutes.\n\n" if summary else "")
            + "Follow it live on the map: SmartHealth > My Appointments > Ambulance > Track live.\n\n"
            f"Keep your phone free. Hospital helpline: {config.HOSPITAL_PHONE}\n\n- {config.HOSPITAL_NAME}")
    return ok(vehicle_no=amb["vehicle_no"], route_summary=summary)


@bp.route("/api/ambulance/status", methods=["GET", "POST"])
def request_status():
    require_perm("ambulance")
    rid = to_int(request.values.get("id"))
    status = (request.values.get("status") or "").strip()
    flow = {"Arrived": ["Dispatched"], "Completed": ["Dispatched", "Arrived"], "Cancelled": ["Pending", "Dispatched", "Arrived"]}
    if status not in flow:
        fail("Invalid status")
    stamp = {"Arrived": "arrived_at", "Completed": "completed_at", "Cancelled": "cancelled_at"}[status]
    r = db.ambulance_requests.find_one_and_update({"_id": rid, "status": {"$in": flow[status]}},
                                                  {"$set": {"status": status, stamp: now(), "updated_at": now()}})
    if not r:
        fail("This request was already updated. The list has been refreshed.", 409)
    if status in ("Completed", "Cancelled"):
        free_ambulance(r.get("ambulance_id"))
    return ok(message=f"Ambulance request marked {status}")


@bp.get("/api/ambulance/delete")
def delete_request():
    require_perm("ambulance")
    r = db.ambulance_requests.find_one_and_delete({"_id": to_int(arg("id"))})
    if r and r.get("status") in OPEN_REQUEST:
        free_ambulance(r.get("ambulance_id"))
    return ok(message="Ambulance Record Deleted Successfully")


# ================================================================= emergency SOS + drivers

def alert_view(a):
    amb = db.ambulances.find_one({"_id": a["ambulance_id"]}) if a.get("ambulance_id") else None
    p = progress(a, amb) if a["status"] == "Dispatched" else None
    eta = {"km": p["km_left"], "minutes": max(1, p["minutes_left"]), "fraction": p["fraction"], "live": p["live"]} if p else None
    if p is None and amb and amb.get("lat") is not None and a.get("lat") is not None and a["status"] == "Dispatched":
        km = distance_km(amb["lat"], amb["lng"], a["lat"], a["lng"])
        eta = {"km": round(km, 2), "minutes": max(1, int(km / 30 * 60 + 0.999))}
    view = amb_public(amb, p["live"] if p else None)
    if view and p:
        view["lat"], view["lng"] = p["lat"], p["lng"]
    return {"status": "success",
            "alert": {"id": a["_id"], "state": a["status"], "lat": a.get("lat"), "lng": a.get("lng"),
                      "accuracy": a.get("accuracy"), "created_at": out(a)["created_at"]},
            "ambulance": view, "eta": eta, "route": (a.get("route") or {}).get("coords"), "hospital": hospital()}


def driver_job(amb_id):
    """The job an ambulance is on: an SOS alert or a booked request, shaped the same for the driver page."""
    a = db.sos_alerts.find_one({"ambulance_id": amb_id, "status": {"$in": ["Dispatched", "Arrived"]}})
    if a:
        return "sos", a, {"id": a["_id"], "kind": "SOS", "name": a.get("name"), "phone": a.get("phone"), "lat": a.get("lat"),
                          "lng": a.get("lng"), "address": None, "status": a["status"], "created_at": out(a)["created_at"],
                          "route": (a.get("route") or {}).get("coords")}
    r = db.ambulance_requests.find_one({"ambulance_id": amb_id, "status": {"$in": ["Dispatched", "Arrived"]}})
    if r:
        return "request", r, {"id": r["_id"], "kind": "Booking", "name": r.get("patient_name"), "phone": r.get("phone"),
                              "lat": r.get("pickup_lat"), "lng": r.get("pickup_lng"), "address": r.get("address"),
                              "emergency_type": r.get("emergency_type"), "status": r["status"],
                              "created_at": out(r)["created_at"], "route": (r.get("route") or {}).get("coords")}
    return None, None, None


@bp.route("/api/sos", methods=["GET", "POST"])
def sos_api():
    action = arg("action")

    # ------------------------------------------------------------ public (no login needed)
    if action == "create":
        # one open alert per browser session: pressing again returns the same alert
        if session.get("sos_token"):
            open_alert = db.sos_alerts.find_one({"token": session["sos_token"], "status": {"$in": OPEN_SOS}})
            if open_alert:
                return ok(token=open_alert["token"])
        lat, lng = coord("lat"), coord("lng")
        if not valid_coords(lat, lng):
            lat = lng = None
        token = new_token()
        db.sos_alerts.insert_one({"_id": next_id("sos_alerts"), "token": token, "user_email": session.get("user_email"),
                                  "name": post("name")[:100] or None, "phone": post("phone")[:20] or None, "lat": lat, "lng": lng,
                                  "accuracy": to_int(post("accuracy")) if post("accuracy") else None, "status": "New",
                                  "ambulance_id": None, "route": None, "created_at": now(), "updated_at": now()})
        session["sos_token"] = token
        return ok(token=token)

    if action == "track":
        advance_simulation()
        a = db.sos_alerts.find_one({"token": arg("token")})
        if not a:
            fail("Alert not found", 404)
        return jsonify(alert_view(a))

    if action == "nearby":
        # only for an open alert, so nobody can use up the SerpApi searches from outside
        a = db.sos_alerts.find_one({"token": arg("token"), "status": {"$in": OPEN_SOS}})
        if not a:
            fail("Alert not found", 404)
        if a.get("lat") is None:
            return ok(hospitals=[], enabled=bool(config.SERPAPI_KEY), need_location=True)
        rows = nearby_hospitals(a["lat"], a["lng"])
        return ok(hospitals=rows or [], enabled=rows is not None)

    if action == "routeTo":
        # road route with turn-by-turn steps from the caller to a hospital they picked from the list.
        # "from" is the phone's newest GPS fix while it is being guided; otherwise the alert's location.
        a = db.sos_alerts.find_one({"token": arg("token"), "status": {"$in": OPEN_SOS}})
        if not a:
            fail("Alert not found", 404)
        to_lat, to_lng = to_float(arg("lat")), to_float(arg("lng"))
        from_lat, from_lng = to_float(arg("from_lat")), to_float(arg("from_lng"))
        if not valid_coords(from_lat, from_lng):
            from_lat, from_lng = a.get("lat"), a.get("lng")
        if not valid_coords(from_lat, from_lng):
            fail("Your location is not known yet. Allow location access or drag the pin to where you are.", 409)
        if not valid_coords(to_lat, to_lng) or distance_km(from_lat, from_lng, to_lat, to_lng) > 80:
            fail("This hospital is too far away for a road route.", 400)
        if too_soon("sos_route", 2):
            fail("Please wait a moment.", 429)
        route = guide_route(from_lat, from_lng, to_lat, to_lng)
        return ok(route=route, summary=route_summary(route), start=[from_lat, from_lng])

    if action == "updateLocation":
        lat, lng, token = coord("lat"), coord("lng"), post("token")
        open_q = {"token": token, "status": {"$in": OPEN_SOS}}
        if valid_coords(lat, lng):
            changes = {"lat": lat, "lng": lng, "accuracy": to_int(post("accuracy")), "updated_at": now()}
            a = db.sos_alerts.find_one_and_update(open_q, {"$set": changes})
            # the caller moved the pin a long way after dispatch: plan the route again
            if a and a["status"] == "Dispatched" and a.get("lat") is not None and distance_km(a["lat"], a["lng"], lat, lng) > 0.2:
                amb = db.ambulances.find_one({"_id": a.get("ambulance_id")})
                if amb:
                    db.sos_alerts.update_one({"_id": a["_id"]}, {"$set": {"route": plan_route(amb, lat, lng), "dispatched_at": now()}})
        if post("phone"):
            db.sos_alerts.update_one(open_q, {"$set": {"phone": post("phone")[:20]}})
        return ok()

    if action == "cancel":
        a = db.sos_alerts.find_one_and_update({"token": post("token"), "status": {"$in": OPEN_SOS}},
                                              {"$set": {"status": "Cancelled", "updated_at": now()}})
        if a:
            free_ambulance(a.get("ambulance_id"))
        session.pop("sos_token", None)
        return ok()

    # ------------------------------------------------------------ driver (authorised by the driver link)
    if action in ("driver", "driverLocation", "driverStatus"):
        amb = db.ambulances.find_one({"driver_token": request.values.get("t", "")})
        if not amb:
            fail("Invalid driver link", 403)
        if action == "driverLocation":
            lat, lng = coord("lat"), coord("lng")
            if not valid_coords(lat, lng):
                fail("Invalid location")
            # going online: Offline -> Available; a busy ambulance stays busy
            db.ambulances.update_one({"_id": amb["_id"]}, [{"$set": {
                "lat": lat, "lng": lng, "gps_at": "$$NOW", "simulated": False, "updated_at": "$$NOW",
                "status": {"$cond": [{"$eq": ["$status", "Offline"]}, "Available", "$status"]}}}])
        else:
            advance_simulation()
        if action == "driverStatus":
            state = post("state")
            kind, doc, _ = driver_job(amb["_id"])
            coll = {"sos": db.sos_alerts, "request": db.ambulance_requests}.get(kind)
            if state == "Offline" and not doc:
                db.ambulances.update_one({"_id": amb["_id"]}, {"$set": {"status": "Offline", "gps_at": None, "updated_at": now()}})
            elif doc and state == "Arrived" and doc["status"] == "Dispatched":
                coll.update_one({"_id": doc["_id"]}, {"$set": {"status": "Arrived", "arrived_at": now(), "updated_at": now()}})
            elif doc and state == "Resolved":
                coll.update_one({"_id": doc["_id"]}, {"$set": {"status": "Resolved" if kind == "sos" else "Completed",
                                                               "completed_at": now(), "updated_at": now()}})
                free_ambulance(amb["_id"])
        amb = db.ambulances.find_one({"_id": amb["_id"]})
        _, _, job = driver_job(amb["_id"])
        return ok(ambulance={"id": amb["_id"], "vehicle_no": amb["vehicle_no"], "driver_name": amb["driver_name"],
                             "lat": amb.get("lat"), "lng": amb.get("lng"), "status": amb["status"], "live": gps_is_fresh(amb)},
                  job=job, hospital=hospital())

    # ------------------------------------------------------------ admin
    require_perm("sos")
    ensure_fleet()

    if action == "list":
        advance_simulation()
        order = {"New": 0, "Dispatched": 1, "Arrived": 2, "Resolved": 3, "Cancelled": 4}
        fleet_docs = {f["_id"]: f for f in db.ambulances.find()}
        all_alerts = list(db.sos_alerts.find({}, {"token": 0}))
        all_alerts.sort(key=lambda a: (order.get(a["status"], 9), -a["_id"]))
        alerts = []
        for a in all_alerts[:50]:
            row = out(a, hide=("route",))
            f = fleet_docs.get(a.get("ambulance_id")) or {}
            row.update(vehicle_no=f.get("vehicle_no"), driver_name=f.get("driver_name"), driver_phone=f.get("driver_phone"),
                       amb_lat=f.get("lat"), amb_lng=f.get("lng"))
            if a["status"] in ("Dispatched", "Arrived") and a.get("route"):
                row["route"] = a["route"]["coords"]
                row["route_summary"] = route_summary(a["route"])
            alerts.append(row)
        today = now().astimezone(config.IST).strftime("%Y-%m-%d")
        stats = {"total": len(all_alerts), "waiting": 0, "dispatched": 0, "arrived": 0, "resolved": 0, "cancelled": 0, "today": 0}
        for a in all_alerts:
            key = {"New": "waiting", "Dispatched": "dispatched", "Arrived": "arrived", "Resolved": "resolved", "Cancelled": "cancelled"}.get(a["status"])
            if key:
                stats[key] += 1
            stats["today"] += a["created_at"].astimezone(config.IST).strftime("%Y-%m-%d") == today
        fleet = list(fleet_docs.values())
        stats.update(fleet=len(fleet), available=sum(f["status"] == "Available" for f in fleet),
                     busy=sum(f["status"] == "Busy" for f in fleet), offline=sum(f["status"] == "Offline" for f in fleet))
        return ok(alerts=alerts, stats=stats, hospital=hospital(),
                  fleet=[{"id": f["_id"], "vehicle_no": f["vehicle_no"], "driver_name": f["driver_name"],
                          "driver_phone": f.get("driver_phone"), "driver_token": f["driver_token"], "lat": f.get("lat"),
                          "lng": f.get("lng"), "status": f["status"], "live": gps_is_fresh(f),
                          "updated_at": out(f).get("updated_at")} for f in sorted(fleet, key=lambda f: f["_id"])])

    if action == "dispatch":
        a = db.sos_alerts.find_one({"_id": to_int(post("id")), "status": "New"})
        if not a:
            fail("Alert is no longer waiting for dispatch")
        amb = take_ambulance(to_int(post("ambulance_id")), a.get("lat"), a.get("lng"))
        if not amb:
            fail("No ambulance is free right now. Add one to the fleet below, or finish an active emergency first.")
        route = plan_route(amb, a["lat"], a["lng"]) if a.get("lat") is not None else None
        db.sos_alerts.update_one({"_id": a["_id"]}, {"$set": {"status": "Dispatched", "ambulance_id": amb["_id"], "route": route,
                                                               "dispatched_at": now(), "updated_at": now()}})
        if a.get("user_email"):
            background(send_email, a["user_email"], "SmartHealth SOS - ambulance on the way",
                       f"SmartHealth SOS: Ambulance {amb['vehicle_no']} (driver {amb['driver_name']} {amb.get('driver_phone') or ''}) is on the way to you."
                       + (f" Expected in about {route_summary(route)['minutes']} minutes." if route else ""))
        return ok(vehicle_no=amb["vehicle_no"])

    if action == "resolve":
        a = db.sos_alerts.find_one_and_update({"_id": to_int(post("id"))}, {"$set": {"status": "Resolved", "updated_at": now()}})
        if not a:
            fail("Alert not found", 404)
        free_ambulance(a.get("ambulance_id"))
        return ok()

    if action == "addAmbulance":
        if not post("vehicle_no") or not post("driver_name"):
            fail("Vehicle number and driver name are required")
        add_ambulance(post("vehicle_no").upper(), post("driver_name"), post("driver_phone"))
        return ok()

    if action == "deleteAmbulance":
        aid = to_int(post("id"))
        if (db.sos_alerts.find_one({"ambulance_id": aid, "status": {"$in": ["Dispatched", "Arrived"]}})
                or db.ambulance_requests.find_one({"ambulance_id": aid, "status": {"$in": ["Dispatched", "Arrived"]}})):
            fail("This ambulance is on an active emergency")
        db.ambulances.delete_one({"_id": aid})
        return ok()

    fail("Unknown action", 404)

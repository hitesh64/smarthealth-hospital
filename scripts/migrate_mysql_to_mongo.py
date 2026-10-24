"""One-time move of the old MySQL data into MongoDB.

    python scripts/migrate_mysql_to_mongo.py              (reads hospital_db.sql in the project folder)
    python scripts/migrate_mysql_to_mongo.py dump.sql --replace

The file is a mysqldump export (phpMyAdmin > Export > SQL works too). Ids are kept, passwords stay
as they were (the old PHP hashes keep working), and the id counters are set above the highest id.
Without --replace a collection that already has data is skipped.
"""
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import config  # noqa: E402
from backend.db import bump_counter, db, ensure_indexes  # noqa: E402

ESCAPES = {"0": "\0", "n": "\n", "r": "\r", "t": "\t", "Z": "\x1a", "b": "\b"}


def parse_values(s, i):
    """Rows of an INSERT ... VALUES (...),(...); starting at s[i]. Returns (rows, end index)."""
    rows, n = [], len(s)
    while i < n:
        while i < n and s[i] in " \n\r\t,":
            i += 1
        if i >= n or s[i] == ";":
            return rows, i
        assert s[i] == "(", s[i:i + 40]
        i += 1
        row = []
        while True:
            while s[i] in " \n\r\t":
                i += 1
            if s[i] == "'":
                i += 1
                buf = []
                while True:
                    c = s[i]
                    if c == "\\":
                        buf.append(ESCAPES.get(s[i + 1], s[i + 1]))
                        i += 2
                    elif c == "'" and s[i + 1] == "'":
                        buf.append("'")
                        i += 2
                    elif c == "'":
                        i += 1
                        break
                    else:
                        buf.append(c)
                        i += 1
                row.append("".join(buf))
            else:
                j = i
                while s[j] not in ",)":
                    j += 1
                tok = s[i:j].strip()
                i = j
                if tok.upper() == "NULL":
                    row.append(None)
                elif re.match(r"^-?\d+$", tok):
                    row.append(int(tok))
                else:
                    row.append(float(tok))
            while s[i] in " \n\r\t":
                i += 1
            if s[i] == ",":
                i += 1
                continue
            if s[i] == ")":
                i += 1
                break
        rows.append(row)
    return rows, i


def read_dump(path):
    s = Path(path).read_text(encoding="utf-8", errors="replace")
    columns = {}
    for m in re.finditer(r"CREATE TABLE `(\w+)` \((.*?)\n\)", s, re.S):
        columns[m.group(1)] = re.findall(r"^\s*`(\w+)`", m.group(2), re.M)
    data = {}
    for m in re.finditer(r"INSERT INTO `(\w+)`(?: \(([^)]*)\))? VALUES ", s):
        table = m.group(1)
        cols = [c.strip(" `") for c in m.group(2).split(",")] if m.group(2) else columns.get(table)
        rows, _ = parse_values(s, m.end())
        data.setdefault(table, []).extend(dict(zip(cols, r)) for r in rows)
    return data


def ts(value):
    """MySQL times were stored in Indian time (the PHP code set time_zone +05:30)."""
    if not value or str(value).startswith("0000"):
        return None
    return datetime.strptime(str(value)[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=config.IST).astimezone(timezone.utc)


def low(v):
    return v.strip().lower() if isinstance(v, str) else v


def money(v):
    return round(float(v), 2) if v is not None else 0.0


def build(data):
    out = {}
    out["admins"] = [{"_id": r["id"], "name": r["name"], "email": low(r["email"]), "password": r["password"]} for r in data.get("admins", [])]
    out["users"] = [{"_id": r["id"], "name": r.get("name"), "email": low(r.get("email")), "password": r.get("password"),
                     "phone": r.get("phone"), "age": r.get("age"), "blood": r.get("blood"), "address": r.get("address"),
                     "allergies": r.get("allergies"), "conditions": r.get("conditions"),
                     "emergency_contact": r.get("emergency_contact"), "qr_token": r.get("qr_token"),
                     "password_set": r.get("password_set", 1)} for r in data.get("users", []) if r.get("email")]
    out["doctors"] = [{"_id": r["id"], "doctor_name": r.get("doctor_name"), "specialization": r.get("specialization"),
                       "experience": r.get("experience"), "days": r.get("days"), "image": r.get("image"),
                       "email": low(r.get("email")) or None, "password": r.get("password")} for r in data.get("doctors", [])]
    out["bookings"] = [{"_id": r["id"], "user_id": low(r.get("user_id")), "patient_name": r.get("patient_name"),
                        "patient_phone": r.get("patient_phone"), "doctor_id": r.get("doctor_id"),
                        "appointment_date": str(r.get("appointment_date") or ""), "time_slot": r.get("time_slot"),
                        "status": r.get("status") or "Pending", "token_no": r.get("token_no"),
                        "reminder_sent": r.get("reminder_sent", 0), "created_at": ts(r.get("created_at"))} for r in data.get("bookings", [])]
    out["prescriptions"] = [{"_id": r["id"], "booking_id": r.get("booking_id"), "user_email": low(r.get("user_email")),
                             "doctor_id": r.get("doctor_id"), "diagnosis": r.get("diagnosis"), "medicines": r.get("medicines"),
                             "notes": r.get("notes"), "created_at": ts(r.get("created_at"))} for r in data.get("prescriptions", [])]
    out["medicines"] = [{"_id": r["id"], "name": r["name"], "stock": r.get("stock", 0), "reorder_level": r.get("reorder_level", 10),
                         "unit": r.get("unit") or "strips", "expiry_date": str(r["expiry_date"]) if r.get("expiry_date") else None,
                         "updated_at": ts(r.get("updated_at")), "price": money(r.get("price")), "category": r.get("category") or "General",
                         "description": r.get("description"), "image": r.get("image"), "for_sale": r.get("for_sale", 1)}
                        for r in data.get("medicines", [])]
    items = {}
    for it in data.get("medicine_order_items", []):
        items.setdefault(it["order_id"], []).append({"medicine_id": it["medicine_id"], "name": it["name"], "unit": it["unit"],
                                                     "price": money(it["price"]), "qty": it["qty"], "line_total": money(it["line_total"])})
    out["medicine_orders"] = []
    for r in data.get("medicine_orders", []):
        doc = {k: r.get(k) for k in ("order_no", "customer_name", "phone", "delivery_type", "address", "city", "pincode",
                                     "payment_method", "notes", "status", "cancel_reason", "cancelled_by", "payment_status",
                                     "payment_ref", "delivery_otp_hash", "otp_attempts")}
        doc.update(_id=r["id"], user_email=low(r["user_email"]), subtotal=money(r["subtotal"]), delivery_fee=money(r["delivery_fee"]),
                   total=money(r["total"]), created_at=ts(r.get("created_at")), updated_at=ts(r.get("updated_at")),
                   paid_at=ts(r.get("paid_at")), otp_sent_at=ts(r.get("otp_sent_at")), items=items.get(r["id"], []))
        out["medicine_orders"].append(doc)
    out["ambulances"] = [{"_id": r["id"], "vehicle_no": r["vehicle_no"], "driver_name": r["driver_name"],
                          "driver_phone": r.get("driver_phone"), "driver_token": r["driver_token"],
                          "lat": config.HOSPITAL_LAT, "lng": config.HOSPITAL_LNG, "gps_at": None, "simulated": True,
                          "status": "Available" if r.get("status") != "Busy" else "Busy", "updated_at": ts(r.get("updated_at"))}
                         for r in data.get("ambulances", [])]
    out["sos_alerts"] = [{"_id": r["id"], "token": r["token"], "user_email": low(r.get("user_email")), "name": r.get("name"),
                          "phone": r.get("phone"), "lat": float(r["lat"]) if r.get("lat") is not None else None,
                          "lng": float(r["lng"]) if r.get("lng") is not None else None, "accuracy": r.get("accuracy"),
                          "status": r.get("status") or "New", "ambulance_id": r.get("ambulance_id"), "route": None,
                          "created_at": ts(r.get("created_at")), "updated_at": ts(r.get("updated_at"))} for r in data.get("sos_alerts", [])]
    # the old manual ambulance bookings had only an address: they come over without a map pin
    out["ambulance_requests"] = [{"_id": r["id"], "user_id": low(r.get("user_id")), "patient_name": r.get("patient_name"),
                                  "phone": r.get("phone"), "address": r.get("address"),
                                  "emergency_type": r.get("emergency_type") or "General Emergency",
                                  "status": {"Dispatched": "Completed"}.get(r.get("status"), r.get("status") or "Pending"),
                                  "pickup_lat": None, "pickup_lng": None, "route": None, "ambulance_id": None,
                                  "created_at": None, "updated_at": None} for r in data.get("ambulance", [])]
    out["notifications"] = [{"_id": r["id"], "channel": r.get("channel"), "recipient": r.get("recipient"), "subject": r.get("subject"),
                             "message": r.get("message"), "status": r.get("status"), "detail": r.get("detail"),
                             "attempts": r.get("attempts", 1), "created_at": ts(r.get("created_at"))} for r in data.get("notifications", [])]
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    replace = "--replace" in sys.argv
    path = args[0] if args else str(config.ROOT / "hospital_db.sql")
    if not Path(path).is_file():
        sys.exit(f"{path} was not found. Export the MySQL database first (phpMyAdmin > Export > SQL).")
    docs = build(read_dump(path))
    ensure_indexes()
    print(f"MongoDB: {config.MONGO_URI}  database: {config.MONGO_DB}\n")
    for name, rows in docs.items():
        coll = db[name]
        existing = coll.count_documents({})
        if existing and not replace:
            print(f"  {name:20} skipped - already has {existing} document(s) (use --replace to overwrite)")
            continue
        if replace:
            coll.delete_many({})
        if rows:
            coll.insert_many(rows)
            bump_counter(name, max(r["_id"] for r in rows))
        print(f"  {name:20} {len(rows)} imported")
    # token counters continue after the old token numbers of each doctor and day
    for b in docs["bookings"]:
        if b.get("token_no") and b.get("doctor_id"):
            bump_counter(f"token:{b['doctor_id']}:{b['appointment_date']}", b["token_no"])
    print("\nDone.")


if __name__ == "__main__":
    main()

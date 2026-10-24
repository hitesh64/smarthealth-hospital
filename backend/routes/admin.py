"""Admin API: analytics + reports, medicine stock / store catalogue, medicine orders, notification log."""
import csv
import io
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta

import bcrypt
from flask import Blueprint, Response, session

from .. import config
from ..db import db, next_id, now, out, out_all
from ..mail import mail_configured, retry_failed_emails, waiting_retries
from ..orders import (cancel_order, expire_unpaid_orders, issue_delivery_otp, next_status, notify_order_status,
                      upi_enabled)
from ..utils import (arg, background, fail, ist_day_start, ok, post, remove_upload, require_admin, save_image,
                     slot_datetime, to_float, to_int, today_ist, valid_ymd)
from .clinic import send_due_reminders

bp = Blueprint("admin", __name__)


def date_param(key, default):
    v = arg(key)
    return v if valid_ymd(v) else default


def slot_minutes(slot):
    dt = slot_datetime("2000-01-01", slot or "")
    return dt.hour * 60 + dt.minute if dt else 9999


def medicine_row(m, today):
    row = out(m)
    exp = m.get("expiry_date")
    row["low"] = int(m.get("stock", 0) <= m.get("reorder_level", 0))
    row["expired"] = int(bool(exp) and exp < today)
    soon = (datetime.strptime(today, "%Y-%m-%d") + timedelta(days=30)).strftime("%Y-%m-%d")
    row["expiring"] = int(bool(exp) and today <= exp <= soon)
    return row


@bp.route("/api/admin", methods=["GET", "POST"])
def admin_api():
    action = arg("action")
    if action == "logout":
        session.pop("admin_email", None)
        return ok()

    admin_email = require_admin()
    if action == "me":
        me = db.admins.find_one({"email": admin_email})
        if not me:
            fail("Admin login required", 401)
        return ok(name=me.get("name"), email=me["email"])

    today = today_ist()
    date_from = date_param("from", (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=29)).strftime("%Y-%m-%d"))
    date_to = date_param("to", today)
    in_range = {"appointment_date": {"$gte": date_from, "$lte": date_to}}

    # ------------------------------------------------------------ analytics
    if action == "analytics":
        rows = list(db.bookings.find(in_range))
        docs = {d["_id"]: d for d in db.doctors.find({}, {"doctor_name": 1, "specialization": 1})}
        per_day = Counter(b["appointment_date"] for b in rows)
        busy = Counter(b.get("time_slot") for b in rows)
        dept = Counter((docs.get(b.get("doctor_id")) or {}).get("specialization") or "Unknown" for b in rows)
        statuses = Counter(b.get("status") or "Pending" for b in rows)
        by_doc = defaultdict(lambda: {"total": 0, "completed": 0})
        for b in rows:
            d = docs.get(b.get("doctor_id"))
            key = d["doctor_name"] if d else f"Doctor #{b.get('doctor_id')}"
            by_doc[key]["total"] += 1
            by_doc[key]["completed"] += int(b.get("status") in ("Completed", "Confirmed"))
        start, end = ist_day_start(date_from), ist_day_start(date_to) + timedelta(days=1)
        days = max(1, (datetime.strptime(date_to, "%Y-%m-%d") - datetime.strptime(date_from, "%Y-%m-%d")).days + 1)
        busy_rows = sorted(({"time_slot": s, "total": n} for s, n in busy.items()), key=lambda r: slot_minutes(r["time_slot"]))
        peak = max(busy_rows, key=lambda r: r["total"]) if busy_rows else None
        lab_count = db.lab_bookings.count_documents({"created_at": {"$gte": start, "$lt": end}})
        amb_count = db.ambulance_requests.count_documents({"created_at": {"$gte": start, "$lt": end}})
        return ok(**{"from": date_from, "to": date_to,
            "summary": {"today": db.bookings.count_documents({"appointment_date": today}), "total": len(rows),
                        "patients": len({b.get("user_id") for b in rows}), "avg_per_day": round(len(rows) / days, 1),
                        "sos": db.sos_alerts.count_documents({"created_at": {"$gte": start, "$lt": end}}),
                        "lab": lab_count, "ambulance": amb_count,
                        "peak_slot": peak["time_slot"] if peak else None},
            "per_day": [{"day": d, "total": per_day[d]} for d in sorted(per_day)],
            "busy_hours": busy_rows,
            "departments": [{"department": k, "total": v} for k, v in dept.most_common()],
            "doctors": sorted(({"doctor": k, **v} for k, v in by_doc.items()), key=lambda r: -r["total"]),
            "statuses": [{"status": k, "total": v} for k, v in statuses.items()]})

    if action == "export":
        docs = {d["_id"]: d for d in db.doctors.find({}, {"doctor_name": 1, "specialization": 1})}
        rows = sorted(db.bookings.find(in_range), key=lambda b: (b["appointment_date"], b.get("doctor_id") or 0, b.get("token_no") or 0))
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["ID", "Date", "Time Slot", "Token", "Patient", "Phone", "Email", "Doctor", "Department", "Status"])
        for b in rows:
            d = docs.get(b.get("doctor_id")) or {}
            values = [b["_id"], b.get("appointment_date"), b.get("time_slot"), b.get("token_no"), b.get("patient_name"),
                      b.get("patient_phone"), b.get("user_id"), d.get("doctor_name"), d.get("specialization"), b.get("status")]
            # stop spreadsheet apps treating patient-entered text as a formula
            w.writerow(["'" + str(v) if re.match(r"^[=+\-@]", str(v or "")) else ("" if v is None else v) for v in values])
        return Response(buf.getvalue(), mimetype="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="appointments_{date_from}_to_{date_to}.csv"'})

    # ------------------------------------------------------------ doctor records
    if action == "doctorRecords":
        doc = db.doctors.find_one({"_id": to_int(arg("id"))}, {"doctor_name": 1, "specialization": 1})
        if not doc:
            fail("Doctor not found", 404)
        rows = db.bookings.find({"doctor_id": doc["_id"]}).sort([("appointment_date", -1), ("token_no", 1), ("_id", 1)])
        records = [{**{k: r.get(k) for k in ("patient_name", "patient_phone", "appointment_date", "time_slot", "token_no")},
                    "id": r["_id"], "status": r.get("status") or "Pending"} for r in rows]
        return ok(doctor=out(doc), records=records)

    # ------------------------------------------------------------ medicine stock
    if action == "medicines":
        rows = [medicine_row(m, today) for m in db.medicines.find()]
        rows.sort(key=lambda r: (-r["low"], r["name"].lower()))
        alerts = sum(1 for r in rows if r["low"] or r["expired"] or r["expiring"])
        return ok(medicines=rows, alerts=alerts)

    if action == "saveMedicine":
        name = post("name")
        if not name:
            fail("Medicine name is required")
        mid = to_int(post("id"))
        if db.medicines.find_one({"name": name, "_id": {"$ne": mid}}):
            fail("This medicine is already in the list")
        price = round(to_float(post("price"), 0) or 0, 2)
        for_sale = 1 if post("for_sale") == "1" else 0
        if price < 0:
            fail("Price cannot be negative")
        if for_sale and price <= 0:
            fail('Enter the selling price, or untick "Show in patient store"')
        fields = {"name": name[:150], "stock": max(0, to_int(post("stock"))), "reorder_level": max(0, to_int(post("reorder_level"))),
                  "unit": post("unit") or "strips", "expiry_date": post("expiry_date") if valid_ymd(post("expiry_date")) else None,
                  "price": price, "category": post("category") or "General", "description": post("description")[:500],
                  "for_sale": for_sale, "updated_at": now()}
        image = save_image("image", "medicines", 3)
        if image is None:
            fail("The photo must be a JPG, PNG, WEBP or GIF image smaller than 3 MB")
        if mid:
            old = db.medicines.find_one({"_id": mid})
            if not old:
                fail("Medicine not found", 404)
            if image:
                fields["image"] = image
            db.medicines.update_one({"_id": mid}, {"$set": fields})
            if image:
                remove_upload(old.get("image"), "medicines")
        else:
            db.medicines.insert_one({"_id": next_id("medicines"), **fields, "image": image or None})
        return ok()

    if action == "adjustStock":
        mid = to_int(post("id"))
        med = db.medicines.find_one({"_id": mid}, {"stock": 1})
        if not med:
            fail("Medicine not found", 404)
        delta = to_int(post("delta"))
        if delta < 0 and -delta > med["stock"]:
            fail(f"Only {med['stock']} in stock - cannot remove {-delta}. Use '+ Received' first to add stock.")
        # the condition stops two clicks at the same time pushing the stock below zero
        res = db.medicines.update_one({"_id": mid, "stock": {"$gte": max(0, -delta)}}, {"$inc": {"stock": delta}, "$set": {"updated_at": now()}})
        if res.modified_count != 1:
            fail("The stock changed meanwhile. Please try again.", 409)
        return ok(stock=med["stock"] + delta)

    if action == "deleteMedicine":
        old = db.medicines.find_one_and_delete({"_id": to_int(post("id"))})
        if old:
            remove_upload(old.get("image"), "medicines")
        return ok()

    # ------------------------------------------------------------ medicine orders
    if action == "orders":
        expire_unpaid_orders()
        all_orders = list(db.medicine_orders.find({}, {"delivery_otp_hash": 0}))
        s = Counter()
        for o in all_orders:
            st, pay = o["status"], o.get("payment_status")
            s["total"] += 1
            s["new_orders"] += st == "Placed" and pay != "Pending"
            s["awaiting_payment"] += st == "Placed" and pay == "Pending"
            s["preparing"] += st in ("Confirmed", "Packed")
            s["dispatch"] += st in ("Out for Delivery", "Ready for Pickup")
            s["completed"] += st in ("Delivered", "Collected")
            s["cancelled"] += st == "Cancelled"
            s["to_verify"] += st == "Placed" and pay == "Submitted"
            s["refund_due"] += pay == "Refund Due"
            s["today"] += db_day(o["created_at"]) == today
            if st in ("Delivered", "Collected"):
                s["sales"] += float(o["total"])
                if db_day(o.get("updated_at")) == today:
                    s["sales_today"] += float(o["total"])
        keys = ["total", "new_orders", "awaiting_payment", "preparing", "dispatch", "completed", "cancelled",
                "to_verify", "refund_due", "today", "sales", "sales_today"]
        stats = {k: (round(float(s[k]), 2) if k.startswith("sales") else int(s[k])) for k in keys}
        # orders that still need work first, so the 200-row limit can only cut off old finished ones
        open_first = sorted(all_orders, key=lambda o: (not (o["status"] not in ("Delivered", "Collected", "Cancelled")
                                                            or o.get("payment_status") == "Refund Due"), -o["_id"]))[:200]
        open_first.sort(key=lambda o: -o["_id"])
        rows = []
        for o in open_first:
            row = out(o)
            row["next_status"] = next_status(o)
            # the OTP itself is never shown to the admin - only whether it is locked
            row["otp_locked"] = int(o.get("otp_attempts") or 0) >= config.DELIVERY_OTP_MAX_TRIES
            rows.append(row)
        return ok(orders=rows, waiting=stats["new_orders"] + stats["refund_due"], stats=stats,
                  upi_id=config.UPI_ID if upi_enabled() else "")

    if action == "orderStatus":
        # Moves an order exactly one step forward. The step the admin saw is sent along, so a
        # double click or a second admin cannot push the same order two steps.
        order = db.medicine_orders.find_one({"_id": to_int(post("id"))})
        if not order:
            fail("Order not found", 404)
        nxt = next_status(order)
        if nxt is None or nxt != post("status"):
            fail(f"This order was already updated (now: {order['status']}). The list has been refreshed.", 409)
        if order["payment_method"] == "UPI" and order.get("payment_status") != "Paid":
            fail("This is a UPI order and its payment is not verified yet.", 409)
        home = order["delivery_type"] != "Pickup"

        # home delivery is completed only with the OTP the patient received by email
        if home and nxt == "Delivered":
            otp = re.sub(r"\D", "", post("otp"))
            if len(otp) != 6:
                fail("Enter the 6-digit delivery OTP that the patient received by email.")
            if not order.get("delivery_otp_hash"):
                fail('No delivery OTP was issued for this order. Press "Resend OTP" first.', 409)
            if order.get("otp_sent_at") and order["otp_sent_at"] < now() - timedelta(hours=config.DELIVERY_OTP_HOURS):
                fail('The delivery OTP has expired. Press "Resend OTP" to email a new one.', 409)
            # the try is counted BEFORE it is checked, so parallel requests cannot guess more than the limit
            tried = db.medicine_orders.find_one_and_update(
                {"_id": order["_id"], "otp_attempts": {"$lt": config.DELIVERY_OTP_MAX_TRIES}}, {"$inc": {"otp_attempts": 1}})
            if not tried:
                fail('Too many wrong OTPs. Press "Resend OTP" to email the patient a new one.', 423)
            if not bcrypt.checkpw(otp.encode(), order["delivery_otp_hash"].encode()):
                left = config.DELIVERY_OTP_MAX_TRIES - (int(tried.get("otp_attempts") or 0) + 1)
                fail(f"Wrong OTP. {left} {'try' if left == 1 else 'tries'} left." if left > 0
                     else 'Wrong OTP. The order is locked - press "Resend OTP" to email a new one.', 403)

        query = {"_id": order["_id"], "status": order["status"]}
        if order["payment_method"] == "UPI":
            query["payment_status"] = "Paid"
        if db.medicine_orders.update_one(query, {"$set": {"status": nxt, "updated_at": now()}}).modified_count != 1:
            fail("This order was already updated. The list has been refreshed.", 409)
        new_otp = issue_delivery_otp(order["_id"]) if home and nxt == "Out for Delivery" else ""
        if home and nxt == "Delivered":
            db.medicine_orders.update_one({"_id": order["_id"]}, {"$set": {"delivery_otp_hash": None}})
        background(notify_order_status, order["_id"], "", "", new_otp)
        return ok(new_status=nxt)

    if action == "resendDeliveryOtp":
        order = db.medicine_orders.find_one({"_id": to_int(post("id"))})
        if not order:
            fail("Order not found", 404)
        if order["delivery_type"] == "Pickup" or order["status"] != "Out for Delivery":
            fail("An OTP can only be sent while a home delivery is out for delivery.", 409)
        if order.get("otp_sent_at") and order["otp_sent_at"] > now() - timedelta(seconds=60):
            fail("An OTP was sent less than a minute ago. Please wait a moment.", 429)
        new_otp = issue_delivery_otp(order["_id"])
        background(notify_order_status, order["_id"], "otp", "", new_otp)
        return ok()

    if action == "cancelOrder":
        order = db.medicine_orders.find_one({"_id": to_int(post("id"))}, {"delivery_type": 1})
        if not order:
            fail("Order not found", 404)
        from ..orders import order_flow
        if not cancel_order(order["_id"], post("reason") or "Cancelled by the pharmacy", order_flow(order["delivery_type"])[:-1], "pharmacy"):
            fail("This order is already finished or cancelled.", 409)
        background(notify_order_status, order["_id"])
        return ok()

    if action == "verifyPayment":
        oid = to_int(post("id"))
        res = db.medicine_orders.update_one({"_id": oid, "status": {"$ne": "Cancelled"}, "payment_status": "Submitted"},
                                            {"$set": {"payment_status": "Paid", "paid_at": now(), "updated_at": now()}})
        if res.modified_count != 1:
            fail("This payment was already handled. The list has been refreshed.", 409)
        background(notify_order_status, oid, "verified")
        return ok()

    if action == "rejectPayment":
        # no such payment arrived: the patient is asked for the right UTR and gets a fresh time limit to pay
        order = db.medicine_orders.find_one_and_update(
            {"_id": to_int(post("id")), "status": "Placed", "payment_status": "Submitted"},
            {"$set": {"payment_status": "Pending", "payment_ref": None, "updated_at": now()}})
        if not order:
            fail("This payment was already handled. The list has been refreshed.", 409)
        background(notify_order_status, order["_id"], "rejected", order.get("payment_ref"))
        return ok()

    if action == "markRefunded":
        oid = to_int(post("id"))
        if db.medicine_orders.update_one({"_id": oid, "payment_status": "Refund Due"},
                                         {"$set": {"payment_status": "Refunded", "updated_at": now()}}).modified_count != 1:
            fail("This refund was already handled. The list has been refreshed.", 409)
        background(notify_order_status, oid, "refunded")
        return ok()

    # ------------------------------------------------------------ notifications
    if action == "notifications":
        return ok(email_configured=mail_configured(),
                  notifications=out_all(db.notifications.find().sort("_id", -1).limit(100)))

    if action == "retryEmails":
        expire_unpaid_orders()
        sent = retry_failed_emails(10)
        return ok(sent=sent, waiting=waiting_retries())

    if action == "sendReminders":
        return ok(processed=send_due_reminders())

    fail("Unknown action", 404)


def db_day(value):
    if not value:
        return ""
    return value.astimezone(config.IST).strftime("%Y-%m-%d")

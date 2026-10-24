"""Laboratory: test catalogue, booking with home sample collection or a lab visit, the report flow
(Booked -> Sample Collected -> Processing -> Report Ready) and the report itself.

Results are typed in by the lab in Admin > Laboratory. Calculated values (LDL, MCV, A/G ratio ...)
are filled in automatically and every value is compared with the reference range for the patient's
gender, so the report marks High / Low / Abnormal on its own.
"""
import json
import re
from datetime import datetime, timedelta

from flask import Blueprint, request, session
from pymongo import ReturnDocument

from .. import config, payments
from ..db import db, next_id, now, out
from ..lab_catalog import CATEGORY_ORDER, TESTS, fill_calculated, flag_for, fmt_num, range_for, ref_text
from ..mail import send_email
from ..permissions import LAB_ADMIN_ACTIONS
from ..utils import (arg, background, fail, nice_date, ok, post, require_admin, require_perm, require_user, slot_datetime,
                     to_float, to_int, today_ist, valid_ymd)

bp = Blueprint("lab", __name__)

FLOW = ["Booked", "Sample Collected", "Processing", "Report Ready"]
HOME_SLOTS = ["07:00 AM", "08:00 AM", "09:00 AM", "10:00 AM", "11:00 AM", "05:00 PM", "06:00 PM"]
LAB_SLOTS = ["08:00 AM", "09:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "02:00 PM", "03:00 PM", "04:00 PM",
             "05:00 PM", "06:00 PM", "07:00 PM"]
BOOK_DAYS_AHEAD = 14


def seed_tests():
    """Adds the standard tests that are not in the catalogue yet. Tests already there (perhaps
    edited by the admin) are left as they are, and a test the admin deleted is not added again."""
    have = {t["code"] for t in db.lab_tests.find({}, {"code": 1})}
    removed = {r["_id"] for r in db.lab_tests_removed.find({}, {"_id": 1})}
    for t in TESTS:
        if t["code"] not in have and t["code"] not in removed:
            doc = {"_id": next_id("lab_tests"), "active": True, "includes": [], "parameters": [], "tat_hours": 24,
                   "fasting_hours": 0, "home": True, "sample": "", "preparation": "", **t, "created_at": now()}
            db.lab_tests.insert_one(doc)


def catalogue(active_only=True):
    tests = {t["code"]: t for t in db.lab_tests.find({"active": True} if active_only else {})}
    return tests


def extra_prep(texts):
    """Preparation advice without the fasting sentences (fasting is said once, for the longest test)."""
    seen = []
    for text in texts:
        for sentence in re.split(r"(?<=[.!])\s+", text or ""):
            sentence = sentence.strip()
            low = sentence.lower()
            if not sentence or "fasting" in low or low.startswith("fast for") or low.startswith("no fasting"):
                continue
            if sentence not in seen:
                seen.append(sentence)
    return " ".join(seen)


def test_view(t, tests, full=False):
    """A test as the browser shows it. A package takes its sample, fasting, home collection and
    report time from the tests it includes."""
    comps = [tests[c] for c in t.get("includes") or [] if c in tests] if t.get("includes") else [t]
    row = {"id": t["_id"], "code": t["code"], "name": t["name"], "category": t.get("category"), "price": t.get("price", 0),
           "description": t.get("description", ""), "popular": bool(t.get("popular")), "active": bool(t.get("active", True)),
           "is_package": bool(t.get("includes")),
           "includes": [{"code": c["code"], "name": c["name"]} for c in comps] if t.get("includes") else [],
           "fasting_hours": max([c.get("fasting_hours") or 0 for c in comps] or [0]),
           "home": all(c.get("home", True) for c in comps),
           "tat_hours": max([c.get("tat_hours") or 24 for c in comps] or [24]),
           "sample": ", ".join(sorted({c.get("sample") or "" for c in comps} - {""})),
           "preparation": extra_prep(c.get("preparation") for c in comps) if t.get("includes") else t.get("preparation", ""),
           "parameter_count": sum(len(c.get("parameters") or []) for c in comps),
           "worth": sum(c.get("price", 0) for c in comps) if t.get("includes") else None}
    if full:
        row["parameters"] = t.get("parameters") or []
        row["includes_codes"] = t.get("includes") or []
    return row


def sorted_views(tests, full=False):
    views = [test_view(t, tests, full) for t in tests.values()]
    rank = {c: i for i, c in enumerate(CATEGORY_ORDER)}
    views.sort(key=lambda v: (rank.get(v["category"], 99), not v["popular"], v["name"]))
    return views


# ---------------------------------------------------------------- reports

def report_sections(b):
    """Every test of a booking with its results, units, reference ranges and flags."""
    gender = b.get("gender_code", "")
    results = b.get("results") or {}
    sections = []
    for item in b.get("items", []):
        for comp in item.get("components", []):
            res = results.get(comp["code"], {})
            rows = []
            for p in comp.get("parameters", []):
                r = res.get(p["key"]) or {}
                value = r.get("value", "")
                if p["type"] == "number" and value not in ("", None):
                    try:
                        value = fmt_num(float(value), p.get("decimals", 1))
                    except ValueError:
                        pass
                lo, hi = range_for(p, gender) if p["type"] == "number" else (None, None)
                rows.append({"key": p["key"], "name": p["name"], "unit": p.get("unit", ""), "type": p["type"],
                             "choices": p.get("choices") or [], "normal": p.get("normal") or [], "value": value,
                             "raw": r.get("value", ""), "flag": r.get("flag", ""), "ref": ref_text(p, gender),
                             "calc": bool(p.get("calc")), "formula": p.get("calc") or "", "calc_if": p.get("calc_if") or "",
                             "lo": lo, "hi": hi, "decimals": p.get("decimals", 1)})
            sections.append({"code": comp["code"], "name": comp["name"], "sample": comp.get("sample", ""),
                             "package": item["name"] if item.get("is_package") else None, "rows": rows})
    return sections


def booking_row(b, admin=False):
    row = out(b, hide=("results",) if b.get("status") != "Report Ready" and not admin else ())
    row.pop("results", None)
    row["flow"] = FLOW
    row["can_cancel"] = b["status"] == "Booked"
    # an unpaid booking can still be paid online from My Bookings (or in cash at collection)
    row["can_pay"] = (payments.enabled() and b["status"] == "Booked"
                      and b.get("payment_status") not in ("Paid", "Refund Due", "Refunded"))
    row["items"] = [{"code": i["code"], "name": i["name"], "price": i["price"], "is_package": i.get("is_package", False),
                     "components": [c["name"] for c in i.get("components", [])]} for i in b.get("items", [])]
    if b["status"] == "Report Ready" or admin:
        row["report"] = report_sections(b)
        row["abnormal"] = sum(1 for s in row["report"] for r in s["rows"] if r["flag"])
    return row


def reports_for_doctor(email):
    """Finished lab reports of a patient, for the doctor's patient record."""
    rows = []
    for b in db.lab_bookings.find({"user_email": email, "status": "Report Ready"}).sort("_id", -1).limit(20):
        sections = report_sections(b)
        rows.append({"id": b["_id"], "booking_no": b.get("booking_no"), "report_at": out(b).get("report_at"),
                     "tests": [s["name"] for s in sections], "remarks": b.get("remarks"), "sections": sections,
                     "abnormal": sum(1 for s in sections for r in s["rows"] if r["flag"])})
    return rows


# ---------------------------------------------------------------- mails

def booking_mail(b, event):
    hello = f"Hi {b['patient_name']},\n\n"
    bye = f"\n\nFor help call {config.HOSPITAL_PHONE}.\n\n- {config.HOSPITAL_NAME} Laboratory"
    tests = "\n".join(f"  - {i['name']}" + (f" ({', '.join(c['name'] for c in i['components'])})" if i.get("is_package") else "")
                      + f"  Rs. {i['price']}" for i in b["items"])
    where = (f"Home sample collection at:\n{b.get('address')}" if b["collection_type"] == "Home Collection"
             else f"Lab visit at {config.HOSPITAL_NAME}, {config.HOSPITAL_ADDRESS}")
    if event == "Booked":
        subject = f"Lab test booked - {b['booking_no']}"
        body = (f"Your lab test booking is confirmed.\n\nBooking number: {b['booking_no']}\nDate: {b['slot_date']}  Time: {b['slot_time']}\n"
                f"{where}\n\nTESTS\n{tests}\n\nSubtotal: Rs. {b['subtotal']}\nCollection charge: "
                + (f"Rs. {b['collection_fee']}" if b["collection_fee"] else "Free")
                + (f"\nTOTAL PAID ONLINE: Rs. {b['total']} (receipt {b.get('receipt_no')})\n\n" if b.get("payment_status") == "Paid"
                   else f"\nTOTAL (pay at collection): Rs. {b['total']}\n\n")
                + (f"PREPARATION\n{b['preparation']}\n\n" if b.get("preparation") else "")
                + "Please keep a photo ID ready. You can follow the booking and open the report under Lab Tests > My Bookings.")
    elif event == "Sample Collected":
        subject = f"Sample collected - {b['booking_no']}"
        body = (f"Your sample for booking {b['booking_no']} has been collected and sent to the laboratory.\n\n"
                f"Your report is expected by {b.get('expected_at_text') or 'within 24 hours'}. We will email you as soon as it is ready.")
    elif event == "Report Ready":
        abnormal = sum(1 for s in report_sections(b) for r in s["rows"] if r["flag"])
        subject = f"Lab report ready - {b['booking_no']}"
        body = (f"Your lab report for booking {b['booking_no']} is READY.\n\nOpen SmartHealth > Lab Tests > My Bookings and press \"View report\" "
                "to see it or save it as PDF.\n\n"
                + (f"{abnormal} result{'s are' if abnormal != 1 else ' is'} outside the reference range. Please show the report to your doctor."
                   if abnormal else "All results are within the reference range.")
                + "\n\nYour doctor at the hospital can also see this report on your Health Card.")
    elif event == "Cancelled":
        subject = f"Lab booking cancelled - {b['booking_no']}"
        body = (f"Your lab booking {b['booking_no']} for {b['slot_date']} has been CANCELLED."
                + (f"\n\nReason: {b.get('cancel_reason')}" if b.get("cancel_reason") and b.get("cancelled_by") == "lab" else "")
                + (f"\n\nYour online payment of Rs. {b['total']} will be REFUNDED automatically through Razorpay to the account "
                   "you paid with. We will email you when the refund is sent." if b.get("payment_status") in ("Refund Due", "Refunded")
                   else "\n\nNothing has to be paid.")
                + " You can book again any time under Lab Tests.")
    else:
        return
    send_email(b["user_email"], subject, hello + body + bye)


# ---------------------------------------------------------------- online payment

def to_pay_at_collection(b):
    """An online booking that was not paid stays booked: it is paid in cash at collection instead,
    and the patient now gets the normal booking mail."""
    res = db.lab_bookings.find_one_and_update(
        {"_id": b["_id"], "payment_method": "Online", "payment_status": "Pending", "status": "Booked"},
        {"$set": {"payment_method": "Pay at collection", "payment": "Pay at collection", "payment_status": "At collection",
                  "updated_at": now()}}, return_document=ReturnDocument.AFTER)
    if res:
        background(booking_mail, res, "Booked")
    return res


def settle_online(email=None):
    """Picks up online payments the browser did not report back, and turns online bookings that
    stayed unpaid for UPI_PAY_MINUTES into pay-at-collection bookings."""
    who = {"user_email": email} if email else {}
    # a pay-at-collection booking can also be paid online later, so its payments are looked up too
    ids = [b["_id"] for b in db.lab_bookings.find({"status": "Booked", "payment_status": {"$in": ["Pending", "At collection"]}, **who},
                                                  {"_id": 1})]
    if not ids or not db.payments.find_one({"kind": "lab", "status": "created", "ref_id": {"$in": ids}}, {"_id": 1}):
        ids = []
    if ids and payments.enabled():
        payments.sync_pending("lab", {"ref_id": {"$in": ids}})
    q = {"payment_method": "Online", "payment_status": "Pending", "status": "Booked", **who}
    for b in list(db.lab_bookings.find({**q, "created_at": {"$lt": now() - timedelta(minutes=config.UPI_PAY_MINUTES)}})):
        if not payments.sync_pending("lab", {"ref_id": b["_id"]}, 0):
            to_pay_at_collection(b)


def refund_if_paid(b):
    """A cancelled booking that was paid online gets its money back (the refund is mailed separately)."""
    if b.get("payment_status") == "Paid":
        db.lab_bookings.update_one({"_id": b["_id"], "payment_status": "Paid"}, {"$set": {"payment_status": "Refund Due"}})
        b["payment_status"] = "Refund Due"
        background(payments.refund_for, "lab", b["_id"], b.get("cancel_reason") or "Lab booking cancelled")


# ---------------------------------------------------------------- patient API

@bp.route("/api/lab", methods=["GET", "POST"])
def lab_api():
    action = arg("action")
    if action == "tests":
        tests = catalogue()
        return ok(tests=sorted_views(tests), categories=[c for c in CATEGORY_ORDER if any(t.get("category") == c for t in tests.values())],
                  home_fee=config.LAB_HOME_COLLECTION_FEE, free_above=config.LAB_FREE_COLLECTION_ABOVE,
                  home_slots=HOME_SLOTS, lab_slots=LAB_SLOTS, days_ahead=BOOK_DAYS_AHEAD,
                  online_enabled=payments.enabled(), test_mode=payments.test_mode(),
                  lab={"name": f"{config.HOSPITAL_NAME} Laboratory", "address": config.HOSPITAL_ADDRESS, "phone": config.HOSPITAL_PHONE})

    email = require_user()
    settle_online(email)

    if action == "book":
        try:
            codes = json.loads(post("items") or "[]")
        except ValueError:
            codes = []
        codes = list(dict.fromkeys(str(c) for c in codes if isinstance(c, str)))
        if not codes:
            fail("Please add at least one test.")
        tests = catalogue()
        chosen = []
        for c in codes:
            if c not in tests:
                fail("One of the tests is no longer offered. Please refresh the page.", 409)
            chosen.append(tests[c])
        # a test that is already part of a chosen package would be done (and paid) twice
        for t in chosen:
            for p in chosen:
                if p is not t and t["code"] in (p.get("includes") or []):
                    fail(f"{t['name']} is already included in {p['name']}. Remove it from your list.")

        name, phone, gender = post("patient_name"), re.sub(r"\D", "", post("phone")), post("gender")
        age = to_int(post("age"), -1)
        home = post("collection_type") == "Home"
        online = post("payment") == "Online"
        if online and not payments.enabled():
            fail("Online payment is not available right now. Please choose pay at collection.")
        address, date, slot = post("address"), post("date"), post("slot")
        if len(name) < 2:
            fail("Please enter the patient's full name.")
        if not 0 <= age <= 120:
            fail("Please enter the patient's age.")
        if gender not in ("Male", "Female", "Other"):
            fail("Please choose the patient's gender - reference ranges depend on it.")
        if not re.match(r"^[6-9]\d{9}$", phone[-10:] if len(phone) >= 10 else ""):
            fail("Please enter a valid 10-digit mobile number.")
        views = [test_view(t, tests) for t in chosen]
        if home and not all(v["home"] for v in views):
            fail("Some tests (ECG / X-ray) can only be done at the hospital. Choose 'Visit the lab' or remove them.")
        if home and len(address) < 10:
            fail("Please enter the full address for home sample collection.")
        if not valid_ymd(date) or not today_ist() <= date <= (datetime.strptime(today_ist(), "%Y-%m-%d") + timedelta(days=BOOK_DAYS_AHEAD)).strftime("%Y-%m-%d"):
            fail(f"Please choose a date from today to {BOOK_DAYS_AHEAD} days ahead.")
        if slot not in (HOME_SLOTS if home else LAB_SLOTS):
            fail("Please choose a time slot.")
        starts = slot_datetime(date, slot)
        if starts < now() + timedelta(minutes=60 if home else 15):
            fail("This time slot is too soon. Please choose a later slot." + (" Home collection needs at least 1 hour." if home else ""))

        items = []
        for t in chosen:
            comps = [tests[c] for c in t.get("includes") or []] if t.get("includes") else [t]
            items.append({"code": t["code"], "name": t["name"], "price": t.get("price", 0), "is_package": bool(t.get("includes")),
                          "components": [{"code": c["code"], "name": c["name"], "sample": c.get("sample", ""),
                                          "parameters": c.get("parameters") or []} for c in comps]})
        subtotal = sum(i["price"] for i in items)
        fee = config.LAB_HOME_COLLECTION_FEE if home and subtotal <= config.LAB_FREE_COLLECTION_ABOVE else 0
        fasting = max(v["fasting_hours"] for v in views)
        prep = []
        if fasting:
            prep.append(f"Fast for {fasting}-{fasting + 2} hours before the sample (only water allowed).")
        advice = extra_prep(v["preparation"] for v in views)
        if advice:
            prep.append(advice)
        bid = next_id("lab_bookings")
        booking_no = f"LAB{now().astimezone(config.IST).strftime('%y%m%d')}{bid:04d}"
        tat = max(v["tat_hours"] for v in views)
        b = {"_id": bid, "booking_no": booking_no, "user_email": email, "patient_name": name[:100], "age": age,
             "gender": gender, "gender_code": {"Male": "M", "Female": "F"}.get(gender, ""), "phone": phone[-10:],
             "collection_type": "Home Collection" if home else "Lab Visit", "address": address[:500] if home else None,
             "slot_date": date, "slot_time": slot, "items": items, "subtotal": subtotal, "collection_fee": fee,
             "total": subtotal + fee, "payment": "Online" if online else "Pay at collection",
             "payment_method": "Online" if online else "Pay at collection",
             "payment_status": "Pending" if online else "At collection", "fasting_hours": fasting,
             "preparation": "\n".join(prep), "tat_hours": tat, "referred_by": post("referred_by")[:100],
             "notes": post("notes")[:300], "status": "Booked", "results": {}, "remarks": "", "reported_by": "",
             "created_at": now(), "updated_at": now(), "collected_at": None, "report_at": None}
        db.lab_bookings.insert_one(b)
        checkout, pay_error = None, ""
        if online:
            # the receipt mail (with the booking details) goes out once it is paid
            try:
                checkout = payments.start("lab", b, request.host_url)
            except payments.PaymentError as exc:
                pay_error = f"{exc} Your booking is kept - you can pay at collection."
                to_pay_at_collection(b)
        else:
            background(booking_mail, b, "Booked")
        return ok(id=bid, booking_no=booking_no, total=b["total"], fasting_hours=fasting, preparation=b["preparation"],
                  checkout=checkout, pay_error=pay_error)

    if action == "payLater":
        # the patient closed the payment window and chose to pay in cash at collection
        b = db.lab_bookings.find_one({"_id": to_int(post("id")), "user_email": email})
        if not b:
            fail("Booking not found", 404)
        to_pay_at_collection(b)
        return ok()

    if action == "my":
        rows = [booking_row(b) for b in db.lab_bookings.find({"user_email": email}).sort("_id", -1)]
        return ok(bookings=rows)

    if action == "cancel":
        b = db.lab_bookings.find_one_and_update({"_id": to_int(post("id")), "user_email": email, "status": "Booked"},
                                                {"$set": {"status": "Cancelled", "cancelled_by": "patient", "updated_at": now()}})
        if not b:
            fail("This booking can no longer be cancelled (the sample may already be collected).", 409)
        b["status"] = "Cancelled"
        refund_if_paid(b)
        background(booking_mail, b, "Cancelled")
        return ok()

    fail("Unknown action", 404)


# ---------------------------------------------------------------- admin API

def admin_booking(bid):
    b = db.lab_bookings.find_one({"_id": to_int(bid)})
    if not b:
        fail("Booking not found", 404)
    return b


def number_or_none(v):
    f = to_float(v)
    return None if f is None else f


@bp.route("/api/lab/admin", methods=["GET", "POST"])
def lab_admin():
    admin_email = require_admin()
    action = arg("action")
    if action in LAB_ADMIN_ACTIONS:
        require_perm(LAB_ADMIN_ACTIONS[action])

    if action == "list":
        settle_online()
        today = today_ist()
        rows = list(db.lab_bookings.find().sort("_id", -1).limit(300))
        all_rows = list(db.lab_bookings.find({}, {"status": 1, "slot_date": 1, "total": 1, "created_at": 1, "collected_at": 1,
                                                  "payment_status": 1, "paid_at": 1}))
        stats = {"total": len(all_rows), "booked": 0, "collected": 0, "processing": 0, "ready": 0, "cancelled": 0,
                 "today_slots": 0, "revenue": 0, "revenue_today": 0, "revenue_month": 0, "to_collect": 0, "paid_count": 0,
                 "paid_online": 0}
        month = today[:7]
        for b in all_rows:
            amount = b.get("total", 0) or 0
            online_paid = b.get("payment_status") == "Paid" and b["status"] != "Cancelled"
            # cash is taken when the sample is collected, an online payment when it is paid:
            # that is when a booking becomes revenue
            if online_paid or b["status"] in ("Sample Collected", "Processing", "Report Ready"):
                stats["revenue"] += amount
                stats["paid_count"] += 1
                stats["paid_online"] += amount if online_paid else 0
                when = b.get("paid_at") if online_paid else b.get("collected_at")
                day = when.astimezone(config.IST).strftime("%Y-%m-%d") if when else ""
                stats["revenue_today"] += amount if day == today else 0
                stats["revenue_month"] += amount if day[:7] == month else 0
            elif b["status"] == "Booked":
                stats["to_collect"] += amount
            key = {"Booked": "booked", "Sample Collected": "collected", "Processing": "processing",
                   "Report Ready": "ready", "Cancelled": "cancelled"}.get(b["status"])
            if key:
                stats[key] += 1
            if b.get("slot_date") == today and b["status"] != "Cancelled":
                stats["today_slots"] += 1
        return ok(bookings=[booking_row(b, admin=True) for b in rows], stats=stats, waiting=stats["booked"] + stats["collected"] + stats["processing"])

    if action == "advance":
        # one step forward; the step the admin saw is sent along so a double click cannot skip one
        b = admin_booking(post("id"))
        if b["status"] not in FLOW[:2] or post("from") != b["status"]:
            fail(f"This booking was already updated (now: {b['status']}). The list has been refreshed.", 409)
        nxt = FLOW[FLOW.index(b["status"]) + 1]
        changes = {"status": nxt, "updated_at": now()}
        if nxt == "Sample Collected":
            changes["collected_at"] = now()
            expected = now() + timedelta(hours=b.get("tat_hours") or 24)
            changes["expected_at"] = expected
            changes["expected_at_text"] = nice_date(expected)
        if db.lab_bookings.update_one({"_id": b["_id"], "status": b["status"]}, {"$set": changes}).modified_count != 1:
            fail("This booking was already updated. The list has been refreshed.", 409)
        if nxt == "Sample Collected":
            b.update(changes)
            background(booking_mail, b, "Sample Collected")
        return ok(new_status=nxt)

    if action == "saveResults":
        b = admin_booking(post("id"))
        if b["status"] not in ("Sample Collected", "Processing", "Report Ready"):
            fail("Results can be entered once the sample has been collected.", 409)
        try:
            raw = json.loads(post("results") or "{}")
        except ValueError:
            fail("The results could not be read. Please try again.")
        publish = post("publish") == "1"
        gender = b.get("gender_code", "")
        # Fields may stay empty (a test can be reported later); what is typed must be a real value.
        results, filled, total = {}, 0, 0
        for item in b["items"]:
            for comp in item["components"]:
                given = raw.get(comp["code"]) or {}
                for p in comp["parameters"]:
                    if p["type"] != "number" or given.get(p["key"]) in (None, ""):
                        continue
                    v = to_float(str(given[p["key"]]).replace(",", ""))
                    if v is None:
                        fail(f"{comp['name']}: '{p['name']}' must be a number.")
                    if v < 0:
                        fail(f"{comp['name']}: '{p['name']}' cannot be negative.")
                    if p.get("unit") == "%" and v > 100:
                        fail(f"{comp['name']}: '{p['name']}' cannot be more than 100%.")
                values = fill_calculated(comp["parameters"], given)
                res = {}
                for p in comp["parameters"]:
                    if p["type"] == "number":
                        v = values.get(p["key"])
                        value = "" if v is None else round(v, p.get("decimals", 1))
                    else:
                        value = str(given.get(p["key"]) or "").strip()[:500]
                        if p["type"] == "choice" and value and value not in p.get("choices", []):
                            fail(f"{comp['name']}: choose a value for '{p['name']}' from the list.")
                    if not p.get("calc"):
                        total += 1
                        filled += value != ""
                    res[p["key"]] = {"value": value, "flag": flag_for(p, value, gender)}
                results[comp["code"]] = res
        if publish and not filled:
            fail("Enter at least one result before publishing the report.")
        reported_by = post("reported_by")[:100] or (db.admins.find_one({"email": admin_email}) or {}).get("name", "")
        changes = {"results": results, "remarks": post("remarks")[:2000], "reported_by": reported_by, "updated_at": now()}
        first_publish = publish and b["status"] != "Report Ready"
        if publish:
            changes.update(status="Report Ready", report_at=b.get("report_at") if b["status"] == "Report Ready" else now())
        elif b["status"] == "Sample Collected":
            changes["status"] = "Processing"
        db.lab_bookings.update_one({"_id": b["_id"]}, {"$set": changes})
        if first_publish:
            b.update(changes)
            background(booking_mail, b, "Report Ready")
        updated = db.lab_bookings.find_one({"_id": b["_id"]})
        return ok(booking=booking_row(updated, admin=True))

    if action == "cancel":
        b = db.lab_bookings.find_one_and_update(
            {"_id": to_int(post("id")), "status": {"$in": ["Booked", "Sample Collected", "Processing"]}},
            {"$set": {"status": "Cancelled", "cancelled_by": "lab", "cancel_reason": post("reason")[:255] or "Cancelled by the laboratory",
                      "updated_at": now()}})
        if not b:
            fail("This booking is already finished or cancelled.", 409)
        b.update(status="Cancelled", cancelled_by="lab", cancel_reason=post("reason") or "Cancelled by the laboratory")
        refund_if_paid(b)
        background(booking_mail, b, "Cancelled")
        return ok()

    # ------------------------------------------------------------ test catalogue
    if action == "tests":
        tests = catalogue(active_only=False)
        return ok(tests=sorted_views(tests, full=True), categories=CATEGORY_ORDER)

    if action == "saveTest":
        tid = to_int(post("id"))
        name, code = post("name"), re.sub(r"[^A-Z0-9-]", "", post("code").upper())
        price = to_int(post("price"), -1)
        if len(name) < 3:
            fail("Enter the test name.")
        if price < 0:
            fail("Enter the price in rupees.")
        fields = {"name": name[:150], "category": post("category") or "Haematology", "price": price,
                  "description": post("description")[:500], "preparation": post("preparation")[:500],
                  "popular": post("popular") == "1", "updated_at": now()}
        old = db.lab_tests.find_one({"_id": tid}) if tid else None
        if tid and not old:
            fail("Test not found", 404)
        is_package = bool(old and old.get("includes"))
        if not is_package:
            fields.update(sample=post("sample")[:80] or "Blood (Serum)", tat_hours=max(1, to_int(post("tat_hours"), 24)),
                          fasting_hours=max(0, to_int(post("fasting_hours"), 0)), home=post("home") == "1")
            try:
                params_in = json.loads(post("parameters") or "[]")
            except ValueError:
                fail("The parameters could not be read.")
            fields["parameters"] = merge_parameters((old or {}).get("parameters") or [], params_in)
            if not fields["parameters"]:
                fail("Add at least one parameter (what the report shows).")
        if old:
            db.lab_tests.update_one({"_id": tid}, {"$set": fields})
        else:
            if not code or len(code) < 2:
                fail("Enter a short test code, e.g. IRON.")
            if db.lab_tests.find_one({"code": code}):
                fail("A test with this code already exists.")
            db.lab_tests.insert_one({"_id": next_id("lab_tests"), "code": code, "active": True, "includes": [], **fields, "created_at": now()})
        return ok()

    if action == "deleteTest":
        # bookings keep their own copy of the test, so old bookings and reports are not affected
        t = db.lab_tests.find_one({"_id": to_int(post("id"))})
        if not t:
            fail("Test not found", 404)
        pkgs = [p["name"] for p in db.lab_tests.find({"includes": t["code"]}, {"name": 1})]
        if pkgs:
            fail(f"{t['name']} is part of the package {', '.join(pkgs)}. Remove it from the package (or delete the package) first.", 409)
        db.lab_tests.delete_one({"_id": t["_id"]})
        # remembered, so the start-up does not add a deleted standard test back
        db.lab_tests_removed.update_one({"_id": t["code"]}, {"$set": {"name": t["name"], "removed_at": now()}}, upsert=True)
        return ok()

    if action == "toggleTest":
        t = db.lab_tests.find_one({"_id": to_int(post("id"))})
        if not t:
            fail("Test not found", 404)
        db.lab_tests.update_one({"_id": t["_id"]}, {"$set": {"active": post("active") == "1"}})
        return ok()

    fail("Unknown action", 404)


def merge_parameters(old, given):
    """Parameters from the admin's editor. Number rows carry name, unit, low/high (and female
    low/high); choice / text rows and formulas of the standard tests are kept as they were."""
    by_key = {p["key"]: p for p in old}
    result, used = [], set()
    for i, g in enumerate(given if isinstance(given, list) else []):
        if not isinstance(g, dict):
            continue
        name = str(g.get("name") or "").strip()[:100]
        if not name:
            continue
        key = re.sub(r"[^a-z0-9]", "", str(g.get("key") or "").lower()) or re.sub(r"[^a-z0-9]", "", name.lower())[:12] or f"p{i}"
        while key in used:
            key += "x"
        used.add(key)
        base = dict(by_key.get(key) or {"key": key, "type": "number", "decimals": 1})
        base["name"] = name
        if base["type"] == "number":
            lo, hi = number_or_none(g.get("low")), number_or_none(g.get("high"))
            flo, fhi = number_or_none(g.get("low_f")), number_or_none(g.get("high_f"))
            base["unit"] = str(g.get("unit") or "").strip()[:30]
            base["range"] = {"M": [lo, hi], "F": [flo, fhi]} if (flo is not None or fhi is not None) else [lo, hi]
            if g.get("decimals") not in (None, ""):
                base["decimals"] = max(0, min(3, to_int(g.get("decimals"), 1)))
            if "ref" in g:
                base["ref"] = str(g.get("ref") or "").strip()[:200]
                if not base["ref"]:
                    base.pop("ref")
        result.append(base)
    return result

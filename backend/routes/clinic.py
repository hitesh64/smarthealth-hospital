"""Doctors, appointments, the patient's health card and the doctor dashboard."""
import re
from datetime import timedelta

from flask import Blueprint, jsonify, request, session

from .. import config
from ..db import db, next_id, now, out, out_all
from ..mail import notify_booking_status, notify_patient, send_email
from ..utils import (admin_can, arg, background, fail, login_session, new_token, norm_email, ok, post, require_perm,
                     require_doctor, require_user, save_image, slot_datetime, text, to_int,
                     today_ist, valid_email, valid_ymd)
from .auth import check_pw, hash_pw

bp = Blueprint("clinic", __name__)

BOOKING_STATUSES = ["Pending", "Accepted", "Confirmed", "Completed", "Rejected", "Cancelled"]


def doctor_names():
    return {d["_id"]: d for d in db.doctors.find({}, {"doctor_name": 1, "specialization": 1})}


def with_doctor(rows):
    docs = doctor_names()
    result = []
    for b in rows:
        row = out(b)
        d = docs.get(b.get("doctor_id")) or {}
        row["doctor_name"] = d.get("doctor_name")
        row["specialization"] = d.get("specialization")
        result.append(row)
    return result


# ---------------------------------------------------------------- doctors

@bp.get("/api/doctors")
def get_doctors():
    """Public list for booking. The password hash never leaves; the login email only for the admin."""
    hide = ("password",) if admin_can("doctors") else ("password", "email")
    return jsonify(out_all(db.doctors.find().sort("_id", 1), hide))


@bp.post("/api/doctors/add")
def add_doctor():
    require_perm("doctors", as_text=True)
    name, spec, days = post("doctor_name"), post("specialization"), post("days")
    experience = max(0, to_int(post("experience")))
    if not name or not spec or not days:
        return text("Error: Doctor name, specialization and available days are required.")
    email = norm_email(post("email")) or None
    if email and not valid_email(email):
        return text("Error: The login email is not a valid email address.")
    if email and db.doctors.find_one({"email": email}):
        return text("Error: This login email is already used by another doctor.")
    image = save_image("image", "", 5)
    if not image:
        return text("Error: Please upload a profile photo (JPG, PNG, WEBP or GIF, up to 5 MB).")
    db.doctors.insert_one({"_id": next_id("doctors"), "doctor_name": name[:100], "specialization": spec[:100],
                           "experience": experience, "days": days[:100], "image": image, "email": email,
                           "password": hash_pw(post("password")) if post("password") else None})
    return text("Doctor Added Successfully to Live Database!")


@bp.post("/api/doctors/update")
def update_doctor():
    require_perm("doctors", as_text=True)
    doc_id = to_int(post("id"))
    if not doc_id or not db.doctors.find_one({"_id": doc_id}):
        return text("Error: Doctor not found.")
    name, spec, days = post("doctor_name"), post("specialization"), post("days")
    if not name or not spec or not days:
        return text("Error: Doctor name, specialization and available days are required.")
    email = norm_email(post("email"))
    if email and not valid_email(email):
        return text("Error: The login email is not a valid email address.")
    if email and db.doctors.find_one({"email": email, "_id": {"$ne": doc_id}}):
        return text("Error: This login email is already used by another doctor.")
    image = save_image("image", "", 5)
    if image is None:
        return text("Error: The photo must be a JPG, PNG, WEBP or GIF image up to 5 MB.")
    changes = {"doctor_name": name[:100], "specialization": spec[:100], "experience": max(0, to_int(post("experience"))),
               "days": days[:100]}
    if image:
        changes["image"] = image
    if email:
        changes["email"] = email
    if post("password"):
        changes["password"] = hash_pw(post("password"))
    db.doctors.update_one({"_id": doc_id}, {"$set": changes})
    return text("Doctor details updated successfully in the database!")


@bp.get("/api/doctors/delete")
def delete_doctor():
    require_perm("doctors", as_text=True)
    doc_id = to_int(arg("id"))
    if not doc_id:
        return text("No Doctor ID provided.")
    db.bookings.delete_many({"doctor_id": doc_id})
    db.doctors.delete_one({"_id": doc_id})
    return text("Doctor and associated bookings removed successfully!")


@bp.get("/api/users")
def get_users():
    """Patient directory, admin only. Password hash, QR token and medical details stay on the server."""
    require_perm("patients")
    rows = db.users.find({}, {"name": 1, "email": 1, "phone": 1, "age": 1, "blood": 1}).sort("_id", 1)
    return jsonify(out_all(rows))


# ---------------------------------------------------------------- appointments

@bp.get("/api/bookings")
def get_bookings():
    """The admin gets every booking, a logged-in patient only their own, anybody else nothing."""
    if admin_can("appointments"):
        rows = db.bookings.find().sort("_id", -1)
    elif session.get("user_email"):
        rows = db.bookings.find({"user_id": session["user_email"]}).sort("_id", -1)
    else:
        return jsonify([])
    return jsonify(with_doctor(rows))


@bp.post("/api/bookings/book")
def book():
    uid = session.get("user_email") or norm_email(post("user"))
    name, phone, doctor_id = post("patient_name"), post("patient_phone"), to_int(post("doctor"))
    date, slot = post("date"), post("time")
    if not uid or not name or not phone or not doctor_id or not slot:
        fail("Please fill all booking details.")
    if not valid_ymd(date) or date < today_ist():
        fail("Please choose today or a future date.")
    starts = slot_datetime(date, slot)
    if not starts:
        fail("Please choose a time slot.")
    if starts < now():
        fail("This time has already passed today. Please choose a later slot or another day.")
    doc = db.doctors.find_one({"_id": doctor_id})
    if not doc:
        fail("Doctor not found.")
    # Token number = position in this doctor's queue for the day. The counter is atomic,
    # so two patients booking at the same moment can never get the same token.
    token = next_id(f"token:{doctor_id}:{date}")
    booking_id = next_id("bookings")
    db.bookings.insert_one({"_id": booking_id, "user_id": uid, "patient_name": name[:100], "patient_phone": phone[:20],
                            "doctor_id": doctor_id, "appointment_date": date, "time_slot": slot[:50], "status": "Pending",
                            "token_no": token, "reminder_sent": 0, "created_at": now()})

    def mails():
        notify_patient(uid, f"Appointment booked - Token {token}",
            f"SmartHealth: Hi {name}, your appointment with {doc['doctor_name']} on {date} at {slot} is booked. Token No: {token}.")
        if doc.get("email"):
            p = db.users.find_one({"email": uid}) or {}
            profile = (f"Age: {p.get('age') or '-'}\nBlood Group: {p.get('blood') or '-'}\n"
                       f"Allergies: {p.get('allergies') or 'None recorded'}\nPast diseases: {p.get('conditions') or 'None recorded'}")
            send_email(doc["email"], f"New appointment - {name}, {date}, Token {token}",
                f"Hello {doc['doctor_name']},\n\nA new appointment has been booked with you.\n\n"
                f"BOOKED BY\nPatient: {name}\nPhone: {phone}\nEmail: {uid}\n{profile}\n\n"
                f"APPOINTMENT\nDate: {date}\nTime: {slot}\nToken No: {token}\n\n"
                f"Open your Doctor Dashboard to accept it and see the patient's history.\n\n- {config.HOSPITAL_NAME}")
    background(mails)
    return ok(token_no=token, message=f"Booked Successfully! Your token number is {token}.")


@bp.get("/api/bookings/status")
def booking_status():
    bid, status = to_int(arg("id")), arg("status")
    if not bid or status not in BOOKING_STATUSES:
        return text("Error")
    before = db.bookings.find_one({"_id": bid})
    if not before:
        return text("Error")
    # The admin may set any status. A patient may only cancel their own booking, and only while it is still open.
    if not admin_can("appointments"):
        me = session.get("user_email", "")
        own = me and norm_email(before.get("user_id")) == me
        is_open = (before.get("status") or "Pending") in ("Pending", "Accepted")
        if not own or status != "Cancelled" or not is_open:
            return text("Error: Please log in again." if not me else "Error: You cannot change this booking.", 401 if not me else 403)
    db.bookings.update_one({"_id": bid}, {"$set": {"status": status}})
    if before.get("status") != status:
        background(notify_booking_status, bid, status)
    return text(f"Status Updated to {status}")


@bp.get("/api/bookings/delete")
def delete_booking():
    require_perm("appointments", as_text=True)
    bid = to_int(arg("id"))
    if not bid:
        return text("Error: No booking ID provided.")
    db.bookings.delete_one({"_id": bid})
    return text("Booking Deleted Successfully")


def send_due_reminders():
    """Reminder mails for appointments starting within REMINDER_HOURS_BEFORE hours, once each."""
    from ..mail import retry_failed_emails
    retry_failed_emails(20)
    horizon = now() + timedelta(hours=config.REMINDER_HOURS_BEFORE)
    docs = doctor_names()
    count = 0
    for b in list(db.bookings.find({"reminder_sent": {"$ne": 1}, "status": {"$in": ["Pending", "Accepted"]},
                                    "appointment_date": {"$gte": today_ist()}})):
        starts = slot_datetime(b.get("appointment_date", ""), b.get("time_slot", ""))
        if not starts or not (now() < starts <= horizon):
            continue
        # claim it first so two runs at the same time cannot both send it
        if db.bookings.update_one({"_id": b["_id"], "reminder_sent": {"$ne": 1}}, {"$set": {"reminder_sent": 1}}).modified_count != 1:
            continue
        doctor = (docs.get(b.get("doctor_id")) or {}).get("doctor_name", "your doctor")
        notify_patient(b.get("user_id"), f"Appointment reminder - Token {b.get('token_no')}",
            f"SmartHealth reminder: {b.get('patient_name')}, you have an appointment with {doctor} on "
            f"{b.get('appointment_date')} at {b.get('time_slot')}. Token No: {b.get('token_no')}. Please arrive 10 minutes early.")
        count += 1
    return count


# ---------------------------------------------------------------- patient: health card

@bp.route("/api/patient", methods=["GET", "POST"])
def patient_api():
    action = arg("action")
    email = require_user()
    if action == "card":
        u = db.users.find_one({"email": email})
        if not u:
            fail("User not found", 404)
        if not u.get("qr_token"):
            u["qr_token"] = new_token()
            db.users.update_one({"email": email}, {"$set": {"qr_token": u["qr_token"]}})
        card = {k: u.get(k) for k in ("name", "email", "phone", "age", "blood", "allergies", "conditions", "emergency_contact")}
        card["qr_text"] = "SHQR:" + u["qr_token"]
        return ok(card=card)
    if action == "saveMedical":
        db.users.update_one({"email": email}, {"$set": {"allergies": post("allergies")[:2000], "conditions": post("conditions")[:2000],
                                                        "emergency_contact": post("emergency_contact")[:20]}})
        return ok()
    if action == "regenerate":
        db.users.update_one({"email": email}, {"$set": {"qr_token": new_token()}})  # old printed cards stop working
        return ok()
    if action == "prescriptions":
        return ok(prescriptions=prescriptions_of(email))
    fail("Unknown action", 404)


def prescriptions_of(email):
    docs = doctor_names()
    rows = []
    for p in db.prescriptions.find({"user_email": email}).sort("_id", -1):
        row = out(p)
        d = docs.get(p.get("doctor_id")) or {}
        row["doctor_name"], row["specialization"] = d.get("doctor_name"), d.get("specialization")
        rows.append(row)
    return rows


# ---------------------------------------------------------------- doctor dashboard

def patient_record(user):
    from .lab import reports_for_doctor
    email = user["email"]
    visits = with_doctor(db.bookings.find({"user_id": email}).sort([("appointment_date", -1), ("_id", -1)]))
    return {
        "status": "success",
        "patient": {k: user.get(k) for k in ("name", "email", "phone", "age", "blood", "address", "allergies",
                                              "conditions", "emergency_contact")},
        "prescriptions": prescriptions_of(email),
        "visits": [{k: v.get(k) for k in ("id", "appointment_date", "time_slot", "status", "token_no", "doctor_name", "specialization")} for v in visits],
        "lab_reports": reports_for_doctor(email),
    }


@bp.route("/api/doctor", methods=["GET", "POST"])
def doctor_api():
    action = arg("action")
    if action == "login":
        row = db.doctors.find_one({"email": norm_email(post("email"))})
        if not row or not row.get("password") or not check_pw(post("password"), row["password"]):
            fail("Invalid email or password", 401)
        login_session("doctor_id", row["_id"])
        return ok()
    if action == "logout":
        session.pop("doctor_id", None)
        return ok()

    doctor_id = require_doctor()
    if action == "me":
        me = db.doctors.find_one({"_id": doctor_id}, {"doctor_name": 1, "specialization": 1, "image": 1})
        if not me:
            session.pop("doctor_id", None)  # removed by the admin while still logged in
            fail("Doctor login required", 401)
        return ok(doctor=out(me))
    if action == "appointments":
        date = arg("date")
        query = {"doctor_id": doctor_id}
        if date:
            query["appointment_date"] = date
            rows = db.bookings.find(query).sort([("token_no", 1), ("_id", 1)])
        else:
            rows = db.bookings.find(query).sort([("appointment_date", -1), ("token_no", 1), ("_id", 1)])
        return ok(appointments=out_all(rows))
    if action == "setStatus":
        status = post("status")
        if status not in ("Accepted", "Completed", "Rejected"):
            fail("Invalid status")
        bid = to_int(post("id"))
        own = db.bookings.find_one({"_id": bid, "doctor_id": doctor_id})
        if not own:
            fail("Appointment not found", 404)
        db.bookings.update_one({"_id": bid}, {"$set": {"status": status}})
        if own.get("status") != status:
            background(notify_booking_status, bid, status)
        return ok()
    if action == "patient":
        # only patients who have an appointment with this doctor can be opened by email
        email = norm_email(arg("email"))
        if not db.bookings.find_one({"doctor_id": doctor_id, "user_id": email}):
            fail("This patient has no appointment with you", 403)
        user = db.users.find_one({"email": email})
        if not user:
            fail("Patient has no registered profile", 404)
        return jsonify(patient_record(user))
    if action == "scan":
        code = arg("code")
        if code.upper().startswith("SHQR:"):
            code = code[5:]
        if not re.match(r"^[a-f0-9]{32}$", code):
            fail("This is not a SmartHealth patient card")
        user = db.users.find_one({"qr_token": code})
        if not user:
            fail("Card not recognised. It may have been regenerated.", 404)
        return jsonify(patient_record(user))
    if action == "prescribe":
        email, diagnosis, medicines = norm_email(post("email")), post("diagnosis"), post("medicines")
        if not email or not diagnosis or not medicines:
            fail("Diagnosis and medicines are required")
        if not db.users.find_one({"email": email}):
            fail("Patient not found", 404)
        booking_id = to_int(post("booking_id")) or None
        db.prescriptions.insert_one({"_id": next_id("prescriptions"), "booking_id": booking_id, "user_email": email,
                                     "doctor_id": doctor_id, "diagnosis": diagnosis[:255], "medicines": medicines[:5000],
                                     "notes": post("notes")[:2000], "created_at": now()})
        if booking_id:
            db.bookings.update_one({"_id": booking_id, "doctor_id": doctor_id}, {"$set": {"status": "Completed"}})
        return ok()
    fail("Unknown action", 404)

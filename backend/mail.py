"""Email through Gmail SMTP, the notification log the admin sees, and retrying failed mails.

A brief internet / DNS drop must not lose a mail: each mail is tried up to 3 times, and if it still
fails it stays in `notifications` as "failed" and retry_failed_emails() sends it later.
"""
import smtplib
import socket
import ssl
import time
from datetime import timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr

from pymongo.errors import DuplicateKeyError

from . import config
from .db import db, next_id, now
from .utils import nice_date, valid_email


def mail_configured():
    return bool(config.MAIL_GMAIL_ADDRESS and config.MAIL_GMAIL_APP_PASSWORD)


def log_notification(channel, recipient, message, status, detail="", subject=None, attempts=1, html=None):
    db.notifications.insert_one({
        "_id": next_id("notifications"), "channel": channel, "recipient": recipient, "subject": subject,
        "message": message, "html": html, "status": status, "detail": (detail or "")[:255], "attempts": attempts,
        "created_at": now(),
    })


def smtp_send(to, subject, message, html=None):
    """One delivery attempt. Returns '' on success, otherwise the error text.
    Errors starting with 'Connect failed' are network problems and worth retrying.
    With `html` the mail carries both: mail apps show the designed version, others the plain text."""
    if html:
        msg = MIMEMultipart("alternative")
        msg.attach(MIMEText(message, "plain", "utf-8"))
        msg.attach(MIMEText(html, "html", "utf-8"))
    else:
        msg = MIMEText(message, "plain", "utf-8")
    msg["Subject"] = subject.replace("\r", " ").replace("\n", " ")
    msg["From"] = formataddr((config.MAIL_FROM_NAME, config.MAIL_GMAIL_ADDRESS))
    msg["To"] = to
    try:
        server = smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15, context=ssl.create_default_context())
    except (OSError, socket.timeout) as exc:
        return f"Connect failed: {exc}"
    try:
        server.login(config.MAIL_GMAIL_ADDRESS, config.MAIL_GMAIL_APP_PASSWORD.replace(" ", ""))
        server.sendmail(config.MAIL_GMAIL_ADDRESS, [to], msg.as_string())
        return ""
    except smtplib.SMTPAuthenticationError as exc:
        return f"SMTP error: login rejected ({exc.smtp_code})"
    except smtplib.SMTPRecipientsRefused:
        return "SMTP error: recipient address rejected"
    except smtplib.SMTPException as exc:
        return f"SMTP error: {exc}"
    except (OSError, socket.timeout) as exc:
        return f"Connect failed: {exc}"
    finally:
        try:
            server.quit()
        except Exception:
            pass


def send_email(to, subject, message, secret="", html=None):
    """Sends (or, without Gmail settings, only logs) one mail.
    `secret` (e.g. a delivery OTP) is hidden in the log the admin can read, and a mail carrying it is
    never re-sent by retry_failed_emails (the admin issues a fresh OTP instead)."""
    if not valid_email(to):
        return False
    logged = message if not secret else message.replace(secret, "******")

    if not mail_configured():
        log_notification("email", to, logged, "logged", "Gmail SMTP not configured in .env", subject if not secret else None,
                         html=None if secret else html)
        return False

    error, attempt = "", 1
    for attempt in range(1, 4):
        error = smtp_send(to, subject, message, html)
        # a wrong password / rejected address will not fix itself, so only network errors are retried
        if error == "" or not error.startswith("Connect failed"):
            break
        if attempt < 3:
            time.sleep(3)
    log_notification("email", to, logged, "sent" if error == "" else "failed", error,
                     None if (secret and error) else subject, min(attempt, 3), None if secret else html)
    # the connection works right now, so also deliver anything that failed earlier
    if error == "":
        retry_failed_emails(5)
    return error == ""


def retry_failed_emails(limit=10):
    """Re-sends mails that failed in the last 24 hours (max 6 attempts each). Returns how many went out."""
    if not mail_configured():
        return 0
    # only one worker retries at a time, otherwise the same mail could go out twice
    # (the lock frees itself after two minutes if the worker dies half way)
    try:
        got = db.locks.find_one_and_update(
            {"_id": "mail_retry", "until": {"$lt": now()}},
            {"$set": {"until": now() + timedelta(minutes=2)}}, upsert=True)
    except DuplicateKeyError:
        return 0
    del got
    sent = 0
    try:
        failed = db.notifications.find({
            "channel": "email", "status": "failed", "subject": {"$ne": None}, "attempts": {"$lt": 6},
            "created_at": {"$gt": now() - timedelta(hours=24)},
        }).sort("_id", 1).limit(int(limit))
        for n in list(failed):
            error = smtp_send(n["recipient"], n["subject"], n["message"], n.get("html"))
            # still offline: stop for now, and do not count it as an attempt
            if error.startswith("Connect failed"):
                break
            db.notifications.update_one({"_id": n["_id"]}, {
                "$set": {"status": "sent" if error == "" else "failed",
                         "detail": ("Delivered on retry" if error == "" else error)[:255]},
                "$inc": {"attempts": 1}})
            if error == "":
                sent += 1
    finally:
        db.locks.update_one({"_id": "mail_retry"}, {"$set": {"until": now()}})
    return sent


def waiting_retries():
    return db.notifications.count_documents({
        "channel": "email", "status": "failed", "subject": {"$ne": None}, "attempts": {"$lt": 6},
        "created_at": {"$gt": now() - timedelta(hours=24)},
    })


def notify_patient(email, subject, message, secret=""):
    """Patient notifications go by email, to the address the patient logged in with."""
    if email:
        send_email(email, subject, message, secret)


def send_login_email(name, email):
    return send_email(email, "SmartHealth login alert",
        f"Hi {name},\n\nYou have successfully logged in to your SmartHealth account on {nice_date(now())}.\n\n"
        "You can now book appointments and lab tests, and view your Health Card, prescriptions and lab reports.\n\n"
        f"If this was not you, please change your password immediately or contact {config.HOSPITAL_NAME} at {config.HOSPITAL_PHONE}.\n\n"
        f"- {config.HOSPITAL_NAME}")


def notify_booking_status(booking_id, status):
    """Emails for an appointment status change, whoever made it (admin, doctor or the patient).
       Accepted / Rejected -> patient;  Cancelled -> patient (confirmation) + doctor (the slot is free)."""
    b = db.bookings.find_one({"_id": booking_id})
    if not b:
        return
    d = db.doctors.find_one({"_id": b.get("doctor_id")}) or {}
    doctor = d.get("doctor_name") or "the doctor"
    when = f"{b.get('appointment_date')} at {b.get('time_slot')} (Token {b.get('token_no')})"
    hello = f"Hi {b.get('patient_name')},\n\n"
    bye = f"\n\n- {config.HOSPITAL_NAME}"

    if status == "Accepted":
        notify_patient(b.get("user_id"), f"Appointment accepted - Token {b.get('token_no')}",
            hello + f"Good news! Your appointment with {doctor} on {when} has been ACCEPTED.\n\n"
            "Please arrive 10 minutes early and carry your Smart Patient QR Card." + bye)
    elif status == "Rejected":
        notify_patient(b.get("user_id"), "Appointment not accepted",
            hello + f"We are sorry. Your appointment with {doctor} on {when} has been REJECTED and will not take place.\n\n"
            f"You can book another date or another doctor from the SmartHealth site. For help call {config.HOSPITAL_PHONE}." + bye)
    elif status == "Cancelled":
        notify_patient(b.get("user_id"), "Appointment cancelled",
            hello + f"Your appointment with {doctor} on {when} has been CANCELLED.\n\n"
            f"If you did not cancel it, please contact us at {config.HOSPITAL_PHONE}. You can book a new appointment any time." + bye)
        if d.get("email"):
            send_email(d["email"], f"Appointment cancelled - {b.get('patient_name')}, {b.get('appointment_date')}",
                f"Hello {doctor},\n\nThis appointment has been cancelled:\n\n"
                f"Patient: {b.get('patient_name')}\nPhone: {b.get('patient_phone')}\nEmail: {b.get('user_id')}\n"
                f"Date: {b.get('appointment_date')}\nTime: {b.get('time_slot')}\nToken No: {b.get('token_no')}" + bye)

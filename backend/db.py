"""MongoDB connection, numeric ids and turning documents into JSON for the browser.

Every collection uses a small integer as `_id` (sent to the browser as `id`), like the old MySQL
tables did, so links such as ?id=12 and the ids already stored keep working.
"""
from datetime import datetime, timezone

from bson import ObjectId
from pymongo import ASCENDING, DESCENDING, MongoClient, ReturnDocument

from . import config

client = MongoClient(config.MONGO_URI, tz_aware=True, tzinfo=timezone.utc, serverSelectionTimeoutMS=8000)
db = client[config.MONGO_DB]


def now():
    return datetime.now(timezone.utc)


def next_id(collection):
    """Next number for a collection (1, 2, 3 ...), safe when two requests ask at the same moment."""
    doc = db.counters.find_one_and_update(
        {"_id": collection}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
    return doc["seq"]


def bump_counter(collection, at_least):
    """Makes sure the next id of a collection is above `at_least` (used after importing old rows)."""
    db.counters.update_one({"_id": collection}, {"$max": {"seq": int(at_least)}}, upsert=True)


def ist_text(value):
    """'2026-10-24 14:05:00' in Indian time, the format the pages already show."""
    if not isinstance(value, datetime):
        return value
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(config.IST).strftime("%Y-%m-%d %H:%M:%S")


def clean(value):
    if isinstance(value, datetime):
        return ist_text(value)
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v) for v in value]
    return value


def out(doc, hide=()):
    """A document as the browser gets it: `_id` becomes `id`, dates become Indian-time text."""
    if doc is None:
        return None
    row = {"id": doc.get("_id")}
    for key, value in doc.items():
        if key == "_id" or key in hide:
            continue
        row[key] = clean(value)
    return row


def out_all(docs, hide=()):
    return [out(d, hide) for d in docs]


def ensure_indexes():
    db.users.create_index("email", unique=True)
    db.users.create_index("qr_token", unique=True, partialFilterExpression={"qr_token": {"$type": "string"}})
    db.admins.create_index("email", unique=True)
    db.doctors.create_index("email", unique=True, partialFilterExpression={"email": {"$type": "string"}})
    db.bookings.create_index([("doctor_id", ASCENDING), ("appointment_date", ASCENDING)])
    db.bookings.create_index("user_id")
    db.prescriptions.create_index("user_email")
    db.medicines.create_index("name", unique=True)
    db.medicine_orders.create_index("order_no", unique=True, partialFilterExpression={"order_no": {"$type": "string"}})
    db.medicine_orders.create_index("user_email")
    db.medicine_orders.create_index("payment_ref")
    db.ambulances.create_index("driver_token", unique=True)
    db.sos_alerts.create_index("token", unique=True)
    db.sos_alerts.create_index("status")
    db.ambulance_requests.create_index("user_id")
    db.ambulance_requests.create_index("status")
    db.notifications.create_index([("created_at", DESCENDING)])
    db.lab_tests.create_index("code", unique=True)
    db.lab_bookings.create_index("booking_no", unique=True, partialFilterExpression={"booking_no": {"$type": "string"}})
    db.lab_bookings.create_index("user_email")
    db.lab_bookings.create_index("status")
    # cached routes and address look-ups are dropped after a week
    db.geo_cache.create_index("created_at", expireAfterSeconds=7 * 86400)

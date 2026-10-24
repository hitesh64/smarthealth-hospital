"""Shared helpers for the API routes: form values, JSON / text replies, login guards, uploads."""
import math
import re
import secrets
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

from flask import Response, jsonify, request, session

from . import config
from .db import db, now

# Slow work (sending mail takes seconds) runs here after the reply has gone to the browser
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="bg")


def background(fn, *args, **kwargs):
    def run():
        try:
            fn(*args, **kwargs)
        except Exception as exc:  # a failed mail must never crash the server
            print(f"[background] {fn.__name__} failed: {exc}")
    _pool.submit(run)


class ApiError(Exception):
    def __init__(self, message, code=400, text=False):
        super().__init__(message)
        self.message = message
        self.code = code
        self.text = text


def fail(message, code=400):
    """Stops the request with {"status": "error", "message": ...}."""
    raise ApiError(message, code)


def fail_text(message, code=200):
    """Same for the older endpoints whose pages expect plain text."""
    raise ApiError(message, code, text=True)


def ok(data=None, code=200, **extra):
    body = {"status": "success"}
    if data:
        body.update(data)
    body.update(extra)
    return jsonify(body), code


def text(message, code=200):
    return Response(message, status=code, mimetype="text/plain")


def post(key, default=""):
    value = request.form.get(key)
    return default if value is None else value.strip()


def arg(key, default=""):
    value = request.args.get(key)
    return default if value is None else value.strip()


def to_int(value, default=0):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return default


def to_float(value, default=None):
    try:
        f = float(str(value).strip())
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def valid_email(value):
    return bool(value) and len(value) <= 150 and bool(EMAIL_RE.match(value))


def norm_email(value):
    return (value or "").strip().lower()


def new_token():
    return secrets.token_hex(16)


# ---------------------------------------------------------------- login guards

def is_admin():
    return bool(session.get("admin_email"))


def require_admin():
    if not is_admin():
        fail("Admin login required", 401)
    return session["admin_email"]


def require_admin_text():
    if not is_admin():
        raise ApiError("Error: Admin login required. Please sign in again.", 401, text=True)
    return session["admin_email"]


def require_user():
    if not session.get("user_email"):
        fail("Please log in again", 401)
    return session["user_email"]


def require_doctor():
    if not session.get("doctor_id"):
        fail("Doctor login required", 401)
    return int(session["doctor_id"])


def login_session(key, value):
    """Fresh session on every login (like session_regenerate_id), keeping other logins of the browser."""
    keep = {k: session[k] for k in ("admin_email", "user_email", "doctor_id") if k in session and k != key}
    session.clear()
    session.update(keep)
    session[key] = value


# ---------------------------------------------------------------- dates

def today_ist():
    return datetime.now(config.IST).strftime("%Y-%m-%d")


def ist_now():
    return datetime.now(config.IST)


def ist_day_start(ymd):
    """Start of a day in Indian time, as a UTC datetime, for range queries on created_at."""
    d = datetime.strptime(ymd, "%Y-%m-%d").replace(tzinfo=config.IST)
    return d


def valid_ymd(value):
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", value or ""):
        return False
    try:
        datetime.strptime(value, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def slot_datetime(ymd, slot):
    """'2026-10-24' + '09:00 AM' -> aware datetime in Indian time, or None."""
    try:
        return datetime.strptime(f"{ymd} {slot.strip()}", "%Y-%m-%d %I:%M %p").replace(tzinfo=config.IST)
    except (ValueError, AttributeError):
        return None


def nice_date(dt):
    return dt.astimezone(config.IST).strftime("%d %b %Y, %I:%M %p")


def ago(minutes=0, hours=0, seconds=0):
    return now() - timedelta(minutes=minutes, hours=hours, seconds=seconds)


def distance_km(lat1, lng1, lat2, lng2):
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lng / 2) ** 2
    return 6371 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def valid_coords(lat, lng):
    return lat is not None and lng is not None and abs(lat) <= 90 and abs(lng) <= 180


# ---------------------------------------------------------------- uploads

_IMAGE_TYPES = [
    (b"\xff\xd8\xff", "jpg"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
]


def image_kind(head):
    for magic, ext in _IMAGE_TYPES:
        if head.startswith(magic):
            return ext
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    return None


def save_image(field, folder, max_mb):
    """Saves an uploaded photo under uploads/<folder>. Returns its path, '' when no file was sent and
    None when it is not a real image (a renamed script, too large ...). The type is read from the
    file itself, never from the name the browser sent."""
    file = request.files.get(field)
    if not file or not file.filename:
        return ""
    data = file.read(max_mb * 1024 * 1024 + 1)
    if not data or len(data) > max_mb * 1024 * 1024:
        return None
    ext = image_kind(data[:16])
    if not ext:
        return None
    target = config.UPLOAD_DIR / folder if folder else config.UPLOAD_DIR
    target.mkdir(parents=True, exist_ok=True)
    name = f"{int(time.time())}_{new_token()}.{ext}" if not folder else f"{new_token()}.{ext}"
    (target / name).write_bytes(data)
    return "uploads/" + (f"{folder}/" if folder else "") + name


def remove_upload(path, folder):
    if path and path.startswith(f"uploads/{folder}/"):
        try:
            (config.ROOT / path).unlink()
        except OSError:
            pass


# ---------------------------------------------------------------- small rate limiter

def too_soon(key, seconds):
    """True when the same browser asked for `key` less than `seconds` ago."""
    last = session.get("rl_" + key, 0)
    if time.time() - last < seconds:
        return True
    session["rl_" + key] = time.time()
    return False


def find_one_by_id(collection, value):
    return db[collection].find_one({"_id": to_int(value)})

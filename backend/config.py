"""Settings for the SmartHealth backend.

Values come from environment variables. For local use put them in a `.env` file next to app.py
(it holds passwords, so it is never committed - see .env.example). On a hosting service such as
Render set the same names under Environment.
"""
import os
import secrets
from datetime import timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def env(key, default=""):
    value = os.environ.get(key)
    return default if value is None or value.strip() == "" else value.strip()


def env_int(key, default):
    try:
        return int(env(key, default))
    except ValueError:
        return default


def env_float(key, default):
    try:
        return float(env(key, default))
    except ValueError:
        return default


# --- MongoDB ---
MONGO_URI = env("MONGO_URI", "mongodb://127.0.0.1:27017")
MONGO_DB = env("MONGO_DB", "hospital_db")


def database_is_temporary():
    """True on a host such as Render when MongoDB runs inside the container without a persistent
    disk: everything (admins, patients, orders) is then wiped on every restart, redeploy or sleep."""
    local = any(h in MONGO_URI for h in ("localhost", "127.0.0.1"))
    hosted = bool(os.environ.get("RENDER")) or Path("/.dockerenv").exists()
    data_dir = Path(env("MONGO_DATA_DIR", "/data/db"))
    on_disk = any(os.path.ismount(p) for p in (data_dir, data_dir.parent))
    return local and hosted and not on_disk


TEMPORARY_DB_WARNING = ("This server keeps its database inside the container. Render wipes it on every restart, "
                        "redeploy and sleep, so all admins, patients and orders disappear. Set MONGO_URI to a "
                        "MongoDB Atlas link in Render > Environment to keep the data permanently.")

# --- Flask session cookie. A fixed key keeps patients logged in across restarts. ---
def _secret_key():
    key = env("SECRET_KEY")
    if key:
        return key
    path = ROOT / ".flask_secret"
    if path.is_file():
        return path.read_text().strip()
    key = secrets.token_hex(32)
    try:
        path.write_text(key)
    except OSError:
        pass
    return key


SECRET_KEY = _secret_key()

# --- Super Admin: created at start-up whenever this email has no staff login (also after the
# database was wiped). An existing account keeps its password.
# Fixed admin login, written in the code as the hospital asked. ADMIN_EMAIL / ADMIN_PASSWORD in the
# server settings still take precedence. NOTE: the GitHub repository is public, so anyone who reads
# this file knows this login - make the repository private or change the password after signing in.
ADMIN_EMAIL = env("ADMIN_EMAIL", "admin@gmail.com")
ADMIN_PASSWORD = env("ADMIN_PASSWORD", "admin123")
ADMIN_NAME = env("ADMIN_NAME", "Administrator")

# --- Email via Gmail SMTP (empty = messages are only logged in Admin > Notifications) ---
MAIL_GMAIL_ADDRESS = env("MAIL_GMAIL_ADDRESS")
MAIL_GMAIL_APP_PASSWORD = env("MAIL_GMAIL_APP_PASSWORD")
MAIL_FROM_NAME = env("MAIL_FROM_NAME", "SmartHealth Hospital")

# --- Google Sign-In client id (must match the one in index.html) ---
GOOGLE_CLIENT_ID = env("GOOGLE_CLIENT_ID")

# --- Hospital: name, phone and its fixed location in Mumbai (map centre, ambulance base, route start) ---
HOSPITAL_NAME = env("HOSPITAL_NAME", "SmartHealth Hospital")
HOSPITAL_PHONE = env("HOSPITAL_PHONE", "+91 1800-123-4567")
HOSPITAL_ADDRESS = env("HOSPITAL_ADDRESS", "Cross Road B, MIDC, Andheri East, Mumbai, Maharashtra 400096")
HOSPITAL_LAT = env_float("HOSPITAL_LAT", 19.11499)
HOSPITAL_LNG = env_float("HOSPITAL_LNG", 72.86817)

# Ambulance requests further than this from the hospital are flagged as outside the service area
SERVICE_RADIUS_KM = env_float("SERVICE_RADIUS_KM", 40)
# Free-flow road times from the routing server are multiplied by this for Mumbai traffic
ROUTE_TRAFFIC_FACTOR = env_float("ROUTE_TRAFFIC_FACTOR", 1.35)
# Public routing / address servers (OpenStreetMap). Replace with your own instance for heavy use.
OSRM_URL = env("OSRM_URL", "https://router.project-osrm.org")
NOMINATIM_URL = env("NOMINATIM_URL", "https://nominatim.openstreetmap.org")

# How many hours before an appointment the reminder goes out
REMINDER_HOURS_BEFORE = env_int("REMINDER_HOURS_BEFORE", 24)

# --- UPI payment for medicine orders (empty UPI_ID = cash only) ---
UPI_ID = env("UPI_ID")
UPI_PAYEE_NAME = env("UPI_PAYEE_NAME", HOSPITAL_NAME)
UPI_PAY_MINUTES = env_int("UPI_PAY_MINUTES", 30)

# --- Razorpay online payments (cards, UPI, net banking, wallets) for medicine orders and lab tests.
# Use the rzp_test_ keys while testing (no real money moves). Empty = online payment is switched off.
RAZORPAY_KEY_ID = env("RAZORPAY_KEY_ID")
RAZORPAY_KEY_SECRET = env("RAZORPAY_KEY_SECRET")
RAZORPAY_THEME = env("RAZORPAY_THEME", "#2563eb")

# --- Delivery OTP for home deliveries ---
DELIVERY_OTP_HOURS = 24
DELIVERY_OTP_MAX_TRIES = 5

# --- AI Symptom Checker: Google Gemini API key (empty = the checker is switched off) ---
GEMINI_API_KEY = env("GEMINI_API_KEY")

# --- SerpApi key: real nearby hospitals from Google Maps on the SOS screen (empty = list hidden) ---
SERPAPI_KEY = env("SERPAPI_KEY")

# --- Laboratory ---
LAB_HOME_COLLECTION_FEE = env_int("LAB_HOME_COLLECTION_FEE", 100)
LAB_FREE_COLLECTION_ABOVE = env_int("LAB_FREE_COLLECTION_ABOVE", 999)

# Indian time for "today", dates in mails and reports (servers usually run on UTC)
IST = timezone(timedelta(hours=5, minutes=30))

UPLOAD_DIR = ROOT / "uploads"

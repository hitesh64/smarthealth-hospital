"""Patient and admin accounts: login, register, Google sign-in, password, profile."""
import bcrypt
import requests
from flask import Blueprint, jsonify, session

from .. import config
from ..db import db, next_id, now
from ..mail import send_email, send_login_email
from ..utils import (background, fail, is_admin, login_session, new_token, norm_email, ok, post, require_user,
                     text, to_int, valid_email)

bp = Blueprint("auth", __name__)


def hash_pw(password):
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def check_pw(password, hashed):
    """Also accepts the $2y$ hashes made by the old PHP version."""
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def user_reply(u, **extra):
    return {"status": "success", "name": u.get("name"), "email": u.get("email"), "phone": u.get("phone"),
            "age": u.get("age"), "blood": u.get("blood"), "address": u.get("address"), **extra}


@bp.post("/api/auth/login")
def login():
    email = norm_email(post("email"))
    row = db.users.find_one({"email": email})
    if not row:
        return text("User not found")
    if not check_pw(post("password"), row.get("password")):
        return text("Incorrect Password!")
    login_session("user_email", row["email"])
    # the patient is logged in at once, the alert mail goes out afterwards
    background(send_login_email, row.get("name"), row["email"])
    return jsonify(user_reply(row))


@bp.post("/api/auth/register")
def register():
    name, email, password = post("name"), norm_email(post("email")), post("password")
    if not name or not valid_email(email) or not password:
        return text("Please enter your name, a valid email and a password")
    if len(password) < 6:
        return text("Password must be at least 6 characters")
    if db.users.find_one({"email": email}):
        return text("User Already Exists")
    db.users.insert_one({"_id": next_id("users"), "name": name[:100], "email": email, "password": hash_pw(password),
                         "phone": None, "age": None, "blood": None, "address": None, "allergies": None,
                         "conditions": None, "emergency_contact": None, "qr_token": None, "password_set": 1,
                         "created_at": now()})
    background(send_email, email, f"Welcome to {config.HOSPITAL_NAME}",
        f"Hi {name},\n\nWelcome to SmartHealth! Your account has been created successfully.\n\n"
        "With your account you can:\n"
        "- Book doctor appointments online and get a token number\n"
        "- Book lab tests with home sample collection and see your reports online\n"
        "- Get your Smart Patient QR Card for quick check-in\n"
        "- See your prescriptions and medical history\n"
        "- Book an ambulance and follow it live on the map\n\n"
        "Log in with this email address to get started.\n\n"
        f"If you did not create this account, please contact us at {config.HOSPITAL_PHONE}.\n\n- {config.HOSPITAL_NAME}")
    return text("Registered")


@bp.post("/api/auth/logout")
def logout():
    session.pop("user_email", None)
    session.pop("sos_token", None)
    return ok()


@bp.post("/api/auth/google")
def google_user():
    """Google ID token is checked with Google. Only a verified login gets a server session
    (health card, prescriptions and lab reports open with it)."""
    name, email = post("name"), norm_email(post("email"))
    verified = False
    credential = post("credential")
    if credential and config.GOOGLE_CLIENT_ID:
        try:
            info = requests.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": credential}, timeout=10).json()
            if (info.get("aud") == config.GOOGLE_CLIENT_ID and str(info.get("email_verified")) == "true" and info.get("email")):
                verified = True
                email = norm_email(info["email"])
                name = info.get("name") or name
        except (requests.RequestException, ValueError):
            pass
    if not email:
        fail("Email is required")
    row = db.users.find_one({"email": email})
    if not row:
        row = {"_id": next_id("users"), "name": name[:100], "email": email, "password": hash_pw(new_token()),
               "phone": None, "age": None, "blood": None, "address": None, "allergies": None, "conditions": None,
               "emergency_contact": None, "qr_token": None, "password_set": 0, "created_at": now()}
        db.users.insert_one(row)
    if verified:
        login_session("user_email", row["email"])
        # login mail only for a Google-verified login, otherwise anyone could trigger mails to any address
        background(send_login_email, row.get("name"), row["email"])
    # the popup asks Google users to choose their own password until they have done so
    return jsonify(user_reply(row, needs_password=verified and int(row.get("password_set", 1)) == 0))


@bp.post("/api/auth/set-password")
def set_password():
    """Lets a Google-verified user choose a password once, so they can also log in with email + password."""
    email = require_user()
    password = post("password")
    if len(password) < 6:
        fail("Password must be at least 6 characters")
    row = db.users.find_one({"email": email}, {"password_set": 1})
    if not row:
        fail("User not found", 404)
    if int(row.get("password_set", 1)) == 1:
        fail("Password is already set", 409)
    db.users.update_one({"email": email}, {"$set": {"password": hash_pw(password), "password_set": 1}})
    return ok()


@bp.post("/api/profile")
def update_profile():
    """Only the logged-in patient can change their own profile (the email comes from the session)."""
    email = session.get("user_email")
    if not email:
        return text("Error: Please log in again.", 401)
    name = post("name")
    if not name:
        return text("Error: Name is required")
    age = post("age")
    db.users.update_one({"email": email}, {"$set": {
        "name": name[:100], "phone": post("phone")[:20], "age": None if age == "" else max(0, min(130, to_int(age))),
        "blood": post("blood")[:10], "address": post("address")[:500]}})
    return text("success")


# ---------------------------------------------------------------- admin accounts

@bp.post("/api/admin/login")
def admin_login():
    row = db.admins.find_one({"email": norm_email(post("email"))})
    if not row:
        return text("Admin not found!")
    if not check_pw(post("password"), row.get("password")):
        return text("Incorrect Password!")
    login_session("admin_email", row["email"])
    return jsonify({"status": "success", "name": row.get("name"), "email": row["email"]})


@bp.post("/api/admin/register")
def admin_register():
    """A new administrator can only be created by a signed-in administrator. The single exception
    is a brand-new installation with no administrator at all."""
    first = db.admins.count_documents({}) == 0
    if not first and not is_admin():
        return text("Error: Only a signed-in administrator can create administrator accounts.", 401)
    name, email, password = post("name"), norm_email(post("email")), post("password")
    if len(name) < 3 or not valid_email(email) or len(password) < 8:
        return text("Error: Enter a name, a valid email and a password of at least 8 characters.")
    if db.admins.find_one({"email": email}):
        return text("Admin email already registered!")
    db.admins.insert_one({"_id": next_id("admins"), "name": name[:100], "email": email, "password": hash_pw(password)})
    return text("success")

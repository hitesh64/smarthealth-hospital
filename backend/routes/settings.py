"""Admin > Settings: roles (which sections a role may open) and staff users (who signs in to the
admin panel with which role). Only staff whose role has the Settings section can use it.

Safety rules, so the hospital can never lock itself out:
* the Super Admin role always has every section and cannot be deleted;
* there is always at least one active Super Admin;
* you cannot switch off, delete or demote your own account here.
"""
import json
import re

from flask import Blueprint

from ..db import db, next_id, now, out
from ..permissions import ALL, DEFAULT_ROLES, LABELS, SECTIONS, SUPER_ADMIN
from ..utils import arg, fail, norm_email, ok, post, require_perm, to_int, valid_email
from .auth import hash_pw

bp = Blueprint("settings", __name__)


def super_role_id():
    role = db.roles.find_one({"builtin": True})
    return role["_id"] if role else None


def ensure_roles():
    """A new installation gets the Super Admin role and a few common roles. Staff accounts made
    before roles existed become Super Admins, so nobody loses access."""
    if db.roles.count_documents({}) == 0:
        for name, description, perms in DEFAULT_ROLES:
            db.roles.insert_one({"_id": next_id("roles"), "name": name, "name_key": name.lower(), "description": description,
                                 "permissions": list(perms), "builtin": name == SUPER_ADMIN, "created_at": now()})
    sid = super_role_id()
    if sid is None:  # the Super Admin role was removed from the database by hand: put it back
        sid = next_id("roles")
        db.roles.insert_one({"_id": sid, "name": SUPER_ADMIN, "name_key": SUPER_ADMIN.lower(), "builtin": True,
                             "description": DEFAULT_ROLES[0][1], "permissions": ALL, "created_at": now()})
    db.roles.update_one({"_id": sid}, {"$set": {"permissions": ALL}})
    db.admins.update_many({"role_id": {"$exists": False}}, {"$set": {"role_id": sid, "active": True}})


def ensure_default_admin():
    """An empty database (e.g. a new hosted server) gets its first Super Admin from ADMIN_EMAIL /
    ADMIN_PASSWORD, so somebody can sign in to the admin panel. Nothing happens once any staff
    login exists."""
    from .. import config
    if db.admins.count_documents({}) or not config.ADMIN_EMAIL or len(config.ADMIN_PASSWORD) < 8:
        return
    db.admins.insert_one({"_id": next_id("admins"), "name": config.ADMIN_NAME[:100], "email": norm_email(config.ADMIN_EMAIL),
                          "password": hash_pw(config.ADMIN_PASSWORD), "role_id": super_role_id(), "active": True,
                          "created_at": now(), "last_login": None})
    print(f"[startup] created the first Super Admin {norm_email(config.ADMIN_EMAIL)}")


def active_supers(exclude_id=None):
    q = {"role_id": super_role_id(), "active": {"$ne": False}}
    if exclude_id is not None:
        q["_id"] = {"$ne": exclude_id}
    return db.admins.count_documents(q)


def role_rows():
    counts = {}
    for a in db.admins.find({}, {"role_id": 1}):
        counts[a.get("role_id")] = counts.get(a.get("role_id"), 0) + 1
    rows = []
    for r in db.roles.find().sort([("builtin", -1), ("name_key", 1)]):
        row = out(r, hide=("name_key",))
        row["permissions"] = ALL if r.get("builtin") else [p for p in r.get("permissions", []) if p in LABELS]
        row["users"] = counts.get(r["_id"], 0)
        rows.append(row)
    return rows


@bp.route("/api/admin/settings", methods=["GET", "POST"])
def settings_api():
    me = require_perm("settings")
    action = arg("action")

    if action == "data":
        roles = {r["id"]: r for r in role_rows()}
        users = []
        for a in db.admins.find().sort("_id", 1):
            r = roles.get(a.get("role_id"))
            users.append({"id": a["_id"], "name": a.get("name"), "email": a["email"], "role_id": a.get("role_id"),
                          "role": r["name"] if r else "No role", "super": bool(r and r.get("builtin")),
                          "active": a.get("active", True) is not False, "is_me": a["_id"] == me["id"],
                          "created_at": out(a).get("created_at"), "last_login": out(a).get("last_login")})
        return ok(roles=list(roles.values()), users=users,
                  sections=[{"key": k, "label": label, "tabs": tabs, "description": d} for k, label, tabs, d in SECTIONS])

    # ------------------------------------------------------------ roles
    if action == "saveRole":
        rid = to_int(post("id"))
        name = re.sub(r"\s+", " ", post("name"))[:60]
        try:
            perms = [p for p in json.loads(post("permissions") or "[]") if p in LABELS]
        except ValueError:
            fail("The sections could not be read. Please try again.")
        old = db.roles.find_one({"_id": rid}) if rid else None
        if rid and not old:
            fail("Role not found", 404)
        if old and old.get("builtin"):
            # only the description of Super Admin can change; it always keeps every section
            db.roles.update_one({"_id": rid}, {"$set": {"description": post("description")[:200]}})
            return ok()
        if len(name) < 2:
            fail("Enter a role name, e.g. Receptionist.")
        if name.lower() == SUPER_ADMIN.lower():
            fail("Super Admin already exists. Choose another name.")
        if db.roles.find_one({"name_key": name.lower(), "_id": {"$ne": rid}}):
            fail("A role with this name already exists.")
        if not perms:
            fail("Tick at least one section this role can open.")
        fields = {"name": name, "name_key": name.lower(), "description": post("description")[:200], "permissions": perms,
                  "updated_at": now()}
        if old:
            db.roles.update_one({"_id": rid}, {"$set": fields})
        else:
            db.roles.insert_one({"_id": next_id("roles"), "builtin": False, "created_at": now(), **fields})
        return ok()

    if action == "deleteRole":
        r = db.roles.find_one({"_id": to_int(post("id"))})
        if not r:
            fail("Role not found", 404)
        if r.get("builtin"):
            fail("The Super Admin role cannot be deleted.")
        n = db.admins.count_documents({"role_id": r["_id"]})
        if n:
            fail(f"{n} staff user{'s have' if n > 1 else ' has'} this role. Give them another role first.")
        db.roles.delete_one({"_id": r["_id"]})
        return ok()

    # ------------------------------------------------------------ staff users
    if action == "saveUser":
        uid = to_int(post("id"))
        name, email, password = post("name")[:100], norm_email(post("email")), post("password")
        role = db.roles.find_one({"_id": to_int(post("role_id"))})
        active = post("active") != "0"
        old = db.admins.find_one({"_id": uid}) if uid else None
        if uid and not old:
            fail("User not found", 404)
        if len(name) < 3:
            fail("Enter the staff member's full name.")
        if not valid_email(email):
            fail("Enter a valid email address - it is their login.")
        if db.admins.find_one({"email": email, "_id": {"$ne": uid}}):
            fail("This email is already used by another staff login.")
        if not role:
            fail("Choose a role.")
        if not old and len(password) < 8:
            fail("Enter a password of at least 8 characters for the new login.")
        if old and password and len(password) < 8:
            fail("The new password must be at least 8 characters (leave it empty to keep the old one).")
        if old and old["_id"] == me["id"]:
            if not active:
                fail("You cannot switch off your own account.")
            if not role.get("builtin") and me["super"]:
                fail("You cannot remove Super Admin from your own account. Ask another Super Admin.")
        if old and old.get("role_id") == super_role_id() and (not role.get("builtin") or not active) and active_supers(old["_id"]) == 0:
            fail("This is the last active Super Admin. Make another user Super Admin first.")
        fields = {"name": name, "email": email, "role_id": role["_id"], "active": active, "updated_at": now()}
        if password:
            fields["password"] = hash_pw(password)
        if old:
            db.admins.update_one({"_id": uid}, {"$set": fields})
        else:
            db.admins.insert_one({"_id": next_id("admins"), "created_at": now(), "last_login": None, **fields})
        return ok()

    if action == "deleteUser":
        a = db.admins.find_one({"_id": to_int(post("id"))})
        if not a:
            fail("User not found", 404)
        if a["_id"] == me["id"]:
            fail("You cannot delete your own account.")
        if a.get("role_id") == super_role_id() and a.get("active", True) is not False and active_supers(a["_id"]) == 0:
            fail("This is the last active Super Admin and cannot be deleted.")
        db.admins.delete_one({"_id": a["_id"]})
        return ok()

    fail("Unknown action", 404)


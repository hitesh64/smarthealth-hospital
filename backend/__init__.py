"""SmartHealth Hospital - Flask + MongoDB backend.

The web pages (index.html, admin.html, doctor.html, driver.html and their css / js) are served from
the project folder; everything under /api/ is answered by the blueprints in backend/routes.
"""
import re
import time
from pathlib import Path

from flask import Flask, abort, jsonify, send_from_directory
from pymongo.errors import ConnectionFailure, ConfigurationError, DuplicateKeyError, OperationFailure, ServerSelectionTimeoutError
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

from . import config
from .db import ensure_indexes
from .utils import ApiError, text

# Only these files are served to browsers. Python code, .env, database exports etc. never are.
PUBLIC_EXT = {".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico", ".woff", ".woff2"}
PUBLIC_DIRS = {"", "assets", "uploads", "uploads/medicines"}


DB_ERRORS = (ServerSelectionTimeoutError, ConnectionFailure, ConfigurationError, OperationFailure)
_setup = {"done": False, "next_try": 0.0, "error": ""}


def safe_uri():
    """MONGO_URI without the password, for logs and the health page."""
    return re.sub(r"//([^:/@]+):[^@]*@", lambda m: "//" + m.group(1) + ":****@", config.MONGO_URI)


def setup_database():
    """Indexes and the starting data (roles, admin, lab tests, ambulances). Runs at start-up and, if the
    database was not reachable then, again on a later request, so the site heals itself once
    MONGO_URI is right. Safe when several server workers run it at the same time."""
    from .routes.emergency import ensure_fleet
    from .routes.lab import seed_tests
    from .routes.settings import ensure_default_admin, ensure_roles
    for step in (ensure_indexes, ensure_roles, ensure_default_admin, seed_tests, ensure_fleet):
        try:
            step()
        except DuplicateKeyError:
            pass  # another worker inserted the same starting data a moment earlier
    _setup.update(done=True, error="")


def try_setup():
    if _setup["done"] or time.time() < _setup["next_try"]:
        return
    _setup["next_try"] = time.time() + 30
    try:
        setup_database()
        print(f"[startup] MongoDB ready at {safe_uri()}")
    except Exception as exc:
        _setup["error"] = str(exc)[:300]
        print(f"[startup] MongoDB is not reachable at {safe_uri()}: {exc}")


def create_app():
    app = Flask(__name__, static_folder=None)
    app.config.update(
        SECRET_KEY=config.SECRET_KEY,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        MAX_CONTENT_LENGTH=12 * 1024 * 1024,
        JSON_SORT_KEYS=False,
    )
    # behind a hosting proxy (Render) the original request is HTTPS: the cookie is then sent over HTTPS only
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    @app.before_request
    def secure_cookie_on_https():
        from flask import request
        app.config["SESSION_COOKIE_SECURE"] = request.scheme == "https"
        if request.path.startswith("/api/"):
            try_setup()

    @app.get("/api/health")
    def health():
        """Shows whether the server can reach its database (open it in the browser after a deploy)."""
        from .db import db
        try:
            db.command("ping")
            try_setup()
            counts = {c: db[c].estimated_document_count() for c in ("admins", "users", "doctors", "lab_tests", "roles")}
            temporary = config.database_is_temporary()
            return jsonify({"status": "ok", "database": "connected", "mongo": safe_uri(), "db_name": config.MONGO_DB,
                            "storage": "temporary - wiped on restart" if temporary else "permanent",
                            **({"warning": config.TEMPORARY_DB_WARNING} if temporary else {}),
                            "setup_done": _setup["done"], "documents": counts})
        except Exception as exc:
            from .db import INIT_ERROR
            return jsonify({"status": "error", "database": "not connected", "mongo": safe_uri(), "db_name": config.MONGO_DB,
                            "detail": (INIT_ERROR or str(exc))[:300],
                            "fix": "Set MONGO_URI (e.g. a MongoDB Atlas mongodb+srv:// link) in the hosting environment "
                                   "and allow the server's IP in Atlas > Network Access."}), 503

    from .routes import admin, ai, auth, clinic, emergency, lab, pay, settings, store
    for module in (auth, clinic, admin, store, ai, emergency, lab, settings, pay):
        app.register_blueprint(module.bp)

    @app.errorhandler(ApiError)
    def api_error(err):
        if err.text:
            return text(err.message, err.code)
        return jsonify({"status": "error", "message": err.message}), err.code

    @app.errorhandler(HTTPException)
    def http_error(err):
        from flask import request
        if request.path.startswith("/api/"):
            return jsonify({"status": "error", "message": err.description or err.name}), err.code
        return err

    def database_error(err):
        from flask import request
        print(f"[db] {type(err).__name__}: {err}")
        if request.path.startswith("/api/"):
            return jsonify({"status": "error", "database": False,
                            "message": "The hospital database is not reachable right now. Please try again in a minute."}), 503
        return "Database not reachable", 503

    for exc_class in DB_ERRORS:
        app.register_error_handler(exc_class, database_error)

    @app.errorhandler(Exception)
    def server_error(err):
        from flask import request
        app.logger.exception(err)
        if request.path.startswith("/api/"):
            return jsonify({"status": "error", "message": "Server error. Please try again."}), 500
        return "Server error", 500

    @app.after_request
    def caching(resp):
        from flask import request
        path = request.path
        if path.startswith("/api/") or path.endswith(".html") or path == "/":
            resp.headers["Cache-Control"] = "no-cache"
        elif Path(path).suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
            resp.headers["Cache-Control"] = "public, max-age=2592000"
        elif Path(path).suffix in {".css", ".js"}:
            # files are linked with ?v=N - raise N in the HTML whenever one changes
            resp.headers["Cache-Control"] = "public, max-age=604800"
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        return resp

    @app.get("/")
    def home():
        return send_from_directory(config.ROOT, "index.html")

    @app.get("/<path:filename>")
    def public_file(filename):
        p = Path(filename)
        folder = p.parent.as_posix().strip(".")
        if (p.suffix.lower() not in PUBLIC_EXT or folder not in PUBLIC_DIRS
                or any(part.startswith(".") for part in p.parts) or ".." in p.parts):
            abort(404)
        return send_from_directory(config.ROOT, p.as_posix())

    with app.app_context():
        try_setup()
    return app

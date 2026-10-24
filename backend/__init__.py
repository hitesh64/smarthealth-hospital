"""SmartHealth Hospital - Flask + MongoDB backend.

The web pages (index.html, admin.html, doctor.html, driver.html and their css / js) are served from
the project folder; everything under /api/ is answered by the blueprints in backend/routes.
"""
from pathlib import Path

from flask import Flask, abort, jsonify, send_from_directory
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

from . import config
from .db import ensure_indexes
from .utils import ApiError, text

# Only these files are served to browsers. Python code, .env, database exports etc. never are.
PUBLIC_EXT = {".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico", ".woff", ".woff2"}
PUBLIC_DIRS = {"", "assets", "uploads", "uploads/medicines"}


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

    from .routes import admin, ai, auth, clinic, emergency, lab, store
    for module in (auth, clinic, admin, store, ai, emergency, lab):
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
        try:
            ensure_indexes()
            from .routes.lab import seed_tests
            seed_tests()
            from .routes.emergency import ensure_fleet
            ensure_fleet()
        except Exception as exc:
            print(f"[startup] MongoDB is not reachable at {config.MONGO_URI}: {exc}")
    return app

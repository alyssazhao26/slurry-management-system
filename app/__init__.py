import os
import secrets
from collections import defaultdict, deque
from flask import Flask, abort, jsonify, request, session
from werkzeug.middleware.proxy_fix import ProxyFix
from .config import Config


def create_app():
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config.from_object(Config)
    Config.validate_production_settings()
    from .db import verify_ui_schema
    with app.app_context():
        verify_ui_schema()
    if app.config["BEHIND_TLS_PROXY"]:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1)
    os.makedirs(app.config["LOG_DIR"], exist_ok=True)
    app.extensions["manager_login_attempts"] = defaultdict(deque)

    @app.before_request
    def security_checks():
        remote_address = request.remote_addr or ""
        remote_http = not request.is_secure and remote_address not in {"127.0.0.1", "::1"}
        if app.config["DISPLAY_ONLY_HTTP"] and remote_http:
            public_display_path = (
                request.path == "/display"
                or request.path == "/api/public-display"
                or request.path.startswith("/static/")
            )
            if request.method not in {"GET", "HEAD"} or not public_display_path:
                abort(404)

        host = request.host.split(":", 1)[0].lower()
        if not (app.config["DISPLAY_ONLY_HTTP"] and remote_http) and host not in app.config["ALLOWED_HOSTS"]:
            abort(400, "Unrecognised host.")
        if "csrf_token" not in session:
            session["csrf_token"] = secrets.token_urlsafe(32)
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            token, supplied = session.get("csrf_token"), request.headers.get("X-CSRF-Token", "")
            if not token or not secrets.compare_digest(token, supplied):
                response = jsonify(error="Your secure session changed. The application will renew it and retry the save.")
                response.status_code = 403
                response.headers["X-Session-Refresh"] = "required"
                return response

    @app.after_request
    def security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Cache-Control"] = "no-store" if request.path.startswith("/api/manager") else "private, no-cache"
        response.headers["Content-Security-Policy"] = "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'"
        if app.config["ENVIRONMENT"] == "production" and request.is_secure:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    @app.errorhandler(500)
    def internal_server_error(_error):
        if request.path.startswith("/api/"):
            return jsonify(
                error=(
                    "The server could not load this data. Check the server log; "
                    "the cause may be a pending migration or a data-format issue."
                )
            ), 500
        return "The server encountered an error. Check the server log.", 500

    @app.context_processor
    def csrf_context():
        return {"csrf_token": session["csrf_token"]}
    from .routes import web
    app.register_blueprint(web)
    return app

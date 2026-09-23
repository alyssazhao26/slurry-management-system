import os
import secrets
from collections import defaultdict, deque
from flask import Flask, abort, jsonify, request, session
from werkzeug.middleware.proxy_fix import ProxyFix
from .config import Config


def create_app(display_only=False):
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config.from_object(Config)
    Config.validate_production_settings()
    # The display-only listener is intentionally plain HTTP so employee phones
    # can use attendance without installing the private Caddy certificate.
    # Secure cookies are discarded by browsers on that listener, which breaks
    # both CSRF continuity and the authenticated attendance session.
    if display_only:
        app.config["SESSION_COOKIE_SECURE"] = False
        app.config["BEHIND_TLS_PROXY"] = False
    from .db import verify_ui_schema
    from .departments import department_context

    with app.app_context():
        verify_ui_schema()
        with department_context("slitting"):
            verify_ui_schema()
        with department_context("coating"):
            verify_ui_schema()
    if app.config["BEHIND_TLS_PROXY"]:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1)
    os.makedirs(app.config["LOG_DIR"], exist_ok=True)
    app.extensions["manager_login_attempts"] = defaultdict(deque)

    from .departments import select_request_department, current_department

    app.before_request(select_request_department)

    @app.before_request
    def security_checks():
        # Coating is a display-only alias of Slitting. It may read the live
        # Slitting dataset, but it must never create or change records.
        if current_department() == "coating" and request.method in {
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
        }:
            return jsonify(error="Coating is a read-only display of Slitting data."), 403
        if display_only:
            public_display_path = (
                request.path == "/display"
                or request.path == "/api/public-display"
                or (
                    current_department() in {"slitting", "coating"}
                    and request.path in {"/api/slitting/summary", "/api/daily-report"}
                )
                or request.path.startswith("/static/")
            )
            attendance_get_path = request.path in {"/attendance", "/api/csrf", "/api/attendance/me"}
            attendance_post_path = request.path in {
                "/api/attendance/login",
                "/api/attendance/logout",
                "/api/attendance/reset-pin",
                "/api/attendance/records",
            }
            allowed_display_request = (
                request.method in {"GET", "HEAD"} and (public_display_path or attendance_get_path)
            ) or (request.method == "POST" and attendance_post_path)
            if not allowed_display_request:
                abort(404)

        host = request.host.split(":", 1)[0].lower()
        if not display_only and host not in app.config["ALLOWED_HOSTS"]:
            abort(400, "Unrecognised host.")
        if "csrf_token" not in session:
            session["csrf_token"] = secrets.token_urlsafe(32)
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            token, supplied = session.get("csrf_token"), request.headers.get("X-CSRF-Token", "")
            if not token or not secrets.compare_digest(token, supplied):
                response = jsonify(
                    error="Your secure session changed. The application will renew it and retry the save."
                )
                response.status_code = 403
                response.headers["X-Session-Refresh"] = "required"
                return response

    @app.after_request
    def security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Cache-Control"] = (
            "no-store" if request.path.startswith("/api/manager") else "private, no-cache"
        )
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data: blob:; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'"
        )
        if app.config["ENVIRONMENT"] == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    @app.errorhandler(500)
    def internal_server_error(_error):
        if request.path.startswith("/api/"):
            return (
                jsonify(
                    error=(
                        "The server could not load this data. Check the server log; "
                        "the cause may be a pending migration or a data-format issue."
                    )
                ),
                500,
            )
        return "The server encountered an error. Check the server log.", 500

    @app.context_processor
    def csrf_context():
        return {"csrf_token": session["csrf_token"], "department": current_department()}

    from .routes import web

    app.register_blueprint(web)
    return app

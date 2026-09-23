from app import create_app
from app.config import Config


def build_app(monkeypatch):
    monkeypatch.setattr("app.db.verify_ui_schema", lambda: None)
    monkeypatch.setattr(Config, "ENVIRONMENT", "development")
    monkeypatch.setattr(Config, "BEHIND_TLS_PROXY", False)
    monkeypatch.setattr(Config, "ALLOWED_HOSTS", {"localhost", "127.0.0.1"})
    return create_app(display_only=True)


def test_remote_http_can_open_read_only_display(monkeypatch):
    client = build_app(monkeypatch).test_client()

    response = client.get(
        "/display",
        base_url="http://192.168.1.10:5000",
        environ_base={"REMOTE_ADDR": "192.168.1.20"},
    )

    assert response.status_code == 200


def test_production_http_attendance_cookie_is_not_secure(monkeypatch):
    monkeypatch.setattr("app.db.verify_ui_schema", lambda: None)
    monkeypatch.setattr(Config, "validate_production_settings", classmethod(lambda cls: None))
    monkeypatch.setattr(Config, "ENVIRONMENT", "production")
    monkeypatch.setattr(Config, "SESSION_COOKIE_SECURE", True)
    monkeypatch.setattr(Config, "BEHIND_TLS_PROXY", True)
    app = create_app(display_only=True)
    client = app.test_client()
    options = {
        "base_url": "http://192.168.1.10:5000",
        "environ_base": {"REMOTE_ADDR": "192.168.1.20"},
    }
    response = client.get("/api/csrf", **options)
    assert response.status_code == 200
    assert "Secure" not in response.headers["Set-Cookie"]
    assert app.config["SESSION_COOKIE_SECURE"] is False
    assert app.config["BEHIND_TLS_PROXY"] is False


def test_remote_http_cannot_open_application_or_write(monkeypatch):
    client = build_app(monkeypatch).test_client()
    request_options = {
        "base_url": "http://192.168.1.10:5000",
        "environ_base": {"REMOTE_ADDR": "192.168.1.20"},
    }

    assert client.get("/", **request_options).status_code == 404
    assert client.get("/attendance", **request_options).status_code == 200
    assert client.get("/attendance/qr", **request_options).status_code == 404
    assert client.get("/api/csrf", **request_options).status_code == 200
    assert client.get("/api/attendance/me", **request_options).status_code == 401
    assert client.post("/api/attendance/login", **request_options).status_code == 403
    assert client.post("/api/manager/display-settings", **request_options).status_code == 404


def test_normal_https_application_still_accepts_remote_users(monkeypatch):
    monkeypatch.setattr("app.db.verify_ui_schema", lambda: None)
    monkeypatch.setattr(Config, "ENVIRONMENT", "development")
    monkeypatch.setattr(Config, "BEHIND_TLS_PROXY", False)
    monkeypatch.setattr(Config, "ALLOWED_HOSTS", {"slurry-management.local"})
    client = create_app().test_client()

    response = client.get(
        "/",
        base_url="https://slurry-management.local",
        environ_base={"REMOTE_ADDR": "192.168.1.20"},
    )

    assert response.status_code == 200
    assert client.get("/attendance", base_url="https://slurry-management.local").status_code == 200
    assert (
        client.get("/attendance/qr", base_url="https://slurry-management.local").status_code == 403
    )
    with client.session_transaction(base_url="https://slurry-management.local") as session:
        session["manager_access"] = True
    qr = client.get("/attendance/qr", base_url="https://slurry-management.local")
    assert qr.status_code == 200
    assert qr.mimetype == "image/png"
    assert qr.headers["X-Attendance-URL"].startswith("http://")

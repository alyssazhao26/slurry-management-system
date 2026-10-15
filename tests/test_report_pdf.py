import io

from PIL import Image

from app import create_app
from app.config import Config


def build_client(monkeypatch):
    monkeypatch.setattr("app.db.verify_ui_schema", lambda: None)
    monkeypatch.setattr(Config, "ENVIRONMENT", "development")
    monkeypatch.setattr(Config, "BEHIND_TLS_PROXY", False)
    monkeypatch.setattr(Config, "ALLOWED_HOSTS", {"localhost", "127.0.0.1"})
    return create_app().test_client()


def png_bytes(width=800, height=1600):
    output = io.BytesIO()
    Image.new("RGB", (width, height), "white").save(output, format="PNG")
    output.seek(0)
    return output


def test_report_pdf_export_returns_paginated_pdf(monkeypatch):
    client = build_client(monkeypatch)
    csrf = client.get("/api/csrf").json["token"]
    response = client.post(
        "/api/report-pdf?department=slitting",
        data={
            "report_image": (png_bytes(), "report.png"),
            "report_date": "2026-10-15",
            "machine": "FJ5",
        },
        headers={"X-CSRF-Token": csrf},
        content_type="multipart/form-data",
    )

    assert response.status_code == 200
    assert response.mimetype == "application/pdf"
    assert response.data.startswith(b"%PDF")
    assert "GNEM-slitting-FJ5-2026-10-15.pdf" in response.headers["Content-Disposition"]


def test_report_pdf_rejects_non_image(monkeypatch):
    client = build_client(monkeypatch)
    csrf = client.get("/api/csrf").json["token"]
    response = client.post(
        "/api/report-pdf",
        data={"report_image": (io.BytesIO(b"not an image"), "report.png")},
        headers={"X-CSRF-Token": csrf},
        content_type="multipart/form-data",
    )

    assert response.status_code == 400

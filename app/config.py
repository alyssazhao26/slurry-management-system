import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
# The project .env is the authoritative configuration for this local server.
# This prevents an unrelated Windows-level WEB_HOST variable from forcing the
# application back to localhost after a restart.
load_dotenv(ROOT / ".env", override=True)


class Config:
    ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
    DEPLOYMENT_MODE = os.getenv("DEPLOYMENT_MODE", "single_server")
    SECRET_KEY = os.environ["SECRET_KEY"] if ENVIRONMENT == "production" else os.getenv("SECRET_KEY", "development-only-change-me")
    DB = {
        "host": os.getenv("DB_HOST", "127.0.0.1"), "port": int(os.getenv("DB_PORT", "3306")),
        "database": os.getenv("DB_NAME", "slurry_management"), "user": os.getenv("DB_USER", "slurry_app"),
        "password": os.getenv("DB_PASSWORD", ""),
    }
    # Optional TLS: configure MySQL with a server certificate, then provide its CA here.
    if os.getenv("DB_SSL_CA"):
        DB["ssl_ca"] = os.getenv("DB_SSL_CA")
        DB["ssl_verify_cert"] = os.getenv("DB_SSL_VERIFY_CERT", "true").lower() == "true"
    LOW_YIELD_THRESHOLD = float(os.getenv("LOW_YIELD_THRESHOLD", "0.90"))
    MANAGER_PIN = os.environ["MANAGER_PIN"] if ENVIRONMENT == "production" else os.getenv("MANAGER_PIN", "manager-demo-pin-change-me")
    SYNC_BATCH_LIMIT = int(os.getenv("SYNC_BATCH_LIMIT", "100"))
    DB_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "12"))
    RECORDS_PAGE_SIZE = int(os.getenv("RECORDS_PAGE_SIZE", "50"))
    RECORDS_MAX_PAGE_SIZE = int(os.getenv("RECORDS_MAX_PAGE_SIZE", "100"))
    MAX_CONTENT_LENGTH = 1 * 1024 * 1024
    LOG_DIR = str(ROOT / "logs")
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = ENVIRONMENT == "production"
    PERMANENT_SESSION_LIFETIME = 60 * 60 * 8
    ALLOWED_HOSTS = {host.strip().lower() for host in os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if host.strip()}
    BEHIND_TLS_PROXY = os.getenv("BEHIND_TLS_PROXY", "false").lower() == "true"
    WEB_HOST = os.getenv("WEB_HOST", "127.0.0.1")
    WEB_PORT = int(os.getenv("WEB_PORT", "5000"))
    MANAGER_LOGIN_MAX_ATTEMPTS = int(os.getenv("MANAGER_LOGIN_MAX_ATTEMPTS", "5"))
    MANAGER_LOGIN_WINDOW_SECONDS = int(os.getenv("MANAGER_LOGIN_WINDOW_SECONDS", "300"))
    # Reserved for a future manager-only, server-side integration. No provider
    # client is created by this application and this key is never sent to a browser.
    AI_ENABLED = os.getenv("AI_ENABLED", "false").lower() == "true"
    AI_PROVIDER = os.getenv("AI_PROVIDER", "")
    AI_API_BASE_URL = os.getenv("AI_API_BASE_URL", "")
    AI_MODEL = os.getenv("AI_MODEL", "")
    AI_API_KEY = os.getenv("AI_API_KEY", "")

    @classmethod
    def validate_production_settings(cls):
        if cls.ENVIRONMENT != "production":
            return
        if not cls.SECRET_KEY or cls.SECRET_KEY == "development-only-change-me":
            raise RuntimeError("SECRET_KEY must be a unique private value in production.")
        if not cls.MANAGER_PIN or cls.MANAGER_PIN == "manager-demo-pin-change-me":
            raise RuntimeError("MANAGER_PIN must be changed in production.")
        if cls.ALLOWED_HOSTS <= {"localhost", "127.0.0.1"}:
            raise RuntimeError("Set ALLOWED_HOSTS to the employee server's private DNS name or IP address.")
        if not cls.BEHIND_TLS_PROXY:
            raise RuntimeError("Production requires HTTPS through a TLS reverse proxy (set BEHIND_TLS_PROXY=true after configuring it).")
        if cls.DEPLOYMENT_MODE == "single_server" and cls.DB["host"].lower() not in {"127.0.0.1", "localhost", "::1"}:
            raise RuntimeError("Single-server mode requires DB_HOST to be local (127.0.0.1 or localhost).")

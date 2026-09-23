"""Local-only Desktop preview, separate from port 5000 deployment."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Config

Config.ENVIRONMENT = "development"
Config.BEHIND_TLS_PROXY = False
Config.SESSION_COOKIE_SECURE = False
Config.SESSION_COOKIE_NAME = "gnem_multi_department_preview"
Config.ALLOWED_HOSTS = {"localhost", "127.0.0.1"}
from app import create_app

app = create_app()
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5002, debug=False, use_reloader=False)

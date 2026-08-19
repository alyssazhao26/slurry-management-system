"""Run each numbered SQL migration once. Never put DROP TABLE in a production migration."""

import os
from pathlib import Path

import mysql.connector
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

DATABASE_CONFIG = {
    "host": os.getenv("DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("DB_PORT", "3306")),
    "database": os.getenv("DB_NAME", "slurry_management"),
    "user": os.getenv("DB_USER", "slurry_app"),
    "password": os.getenv("DB_PASSWORD", ""),
}


def ensure_application_database():
    """Create the main schema before connecting to it for first-time deployment."""
    bootstrap_config = dict(DATABASE_CONFIG)
    database_name = bootstrap_config.pop("database")
    connection = mysql.connector.connect(**bootstrap_config)
    cursor = connection.cursor()
    try:
        cursor.execute(
            f"CREATE DATABASE IF NOT EXISTS `{database_name}` "
            "CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
        )
        connection.commit()
    finally:
        cursor.close()
        connection.close()


def main():
    ensure_application_database()
    connection = mysql.connector.connect(**DATABASE_CONFIG)
    cursor = connection.cursor()
    try:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(100) PRIMARY KEY,
                applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        cursor.execute("SELECT version FROM schema_migrations")
        applied = {row[0] for row in cursor.fetchall()}

        for path in sorted((ROOT / "migrations").glob("*.sql")):
            if path.name in applied:
                continue

            for statement in path.read_text(encoding="utf-8").split(";"):
                if statement.strip():
                    cursor.execute(statement)

            cursor.execute(
                "INSERT INTO schema_migrations (version) VALUES (%s)",
                (path.name,),
            )
            connection.commit()
            print(f"Applied {path.name}")
    finally:
        cursor.close()
        connection.close()


if __name__ == "__main__":
    main()

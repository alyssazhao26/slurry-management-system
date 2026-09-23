"""Apply or report versioned migrations for each configured department schema."""

import argparse
import os
import re
from dataclasses import dataclass
from pathlib import Path

import mysql.connector
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env", override=True)
departments_env = ROOT / ".env.departments"
if departments_env.exists():
    load_dotenv(departments_env, override=True)


# Migration filenames are persisted in each department database. These aliases
# let the source tree use a clear sequence without replaying files that were
# already applied under their historical production names.
MIGRATION_ALIASES = {
    "003_daily_task_shift_slots.sql": {"028_daily_task_shift_slots.sql"},
    "010_slitting_department.sql": {"003_slitting_department.sql"},
    "011_slitting_event_categories.sql": {"026_slitting_event_categories.sql"},
    "020_attendance_system.sql": {"027_attendance_system.sql"},
    "021_attendance_login_timestamp_and_pin_lookup.sql": {
        "029_attendance_login_timestamp_and_pin_lookup.sql"
    },
}

# Earlier test and production builds used several smaller migrations for work
# that is consolidated into the cleaned files above. A consolidated migration
# is satisfied only when every filename in one complete legacy sequence is in
# the ledger. This avoids treating a partially upgraded database as current.
LEGACY_MIGRATION_SEQUENCES = {
    "002_approved_feature_round.sql": (
        frozenset(
            {
                "002_display_layout_settings.sql",
                "017_retire_redundant_reason_code.sql",
                "018_refresh_event_entry_guidance.sql",
                "019_reconcile_completed_event_status.sql",
            }
        ),
    ),
    "003_daily_task_shift_slots.sql": (
        frozenset(
            {
                "020_daily_task_shifts.sql",
                "021_daily_task_day_schedules.sql",
            }
        ),
    ),
    "010_slitting_department.sql": (
        frozenset(
            {
                "020_slitting_inventory.sql",
                "021_inventory_label_created_at.sql",
                "022_optional_inventory_registration_fields.sql",
                "023_slitting_model_lookup.sql",
                "024_canonical_slitting_model_suffixes.sql",
                "025_restore_full_slitting_models.sql",
            }
        ),
    ),
    "020_attendance_system.sql": (
        frozenset(
            {
                "020_attendance.sql",
                "021_attendance_staffing_company.sql",
                "022_attendance_visible_pin.sql",
                "023_attendance_hours.sql",
                "024_attendance_first_login_pin_reset.sql",
                "025_attendance_login_timestamp.sql",
                "026_attendance_pin_lookup.sql",
            }
        ),
    ),
    "021_attendance_login_timestamp_and_pin_lookup.sql": (
        frozenset(
            {
                "025_attendance_login_timestamp.sql",
                "026_attendance_pin_lookup.sql",
            }
        ),
    ),
}


@dataclass(frozen=True)
class DepartmentDatabase:
    name: str
    database: str
    import_schema: str
    user: str
    password: str

    def connection_config(self, include_database=True):
        config = {
            "host": os.getenv("DB_HOST", "127.0.0.1"),
            "port": int(os.getenv("DB_PORT", "3306")),
            "user": self.user,
            "password": self.password,
        }
        if include_database:
            config["database"] = self.database
        return config


def safe_identifier(value):
    if not re.fullmatch(r"[A-Za-z0-9_]+", value or ""):
        raise ValueError(f"Unsafe database/schema name: {value!r}")
    return f"`{value}`"


def configured_departments():
    # Migrations require DDL privileges that the website account intentionally
    # does not have. A dedicated, schema-scoped migrator is the durable default;
    # the legacy fallback keeps development installations backward compatible.
    common_user = os.getenv("MIGRATION_DB_USER") or os.getenv("DB_USER", "slurry_app")
    common_password = os.getenv("MIGRATION_DB_PASSWORD") or os.getenv("DB_PASSWORD", "")
    departments = {
        "slurry": DepartmentDatabase(
            "slurry",
            os.getenv("DB_NAME", "slurry_management"),
            os.getenv("IMPORT_SCHEMA", "system_import"),
            common_user,
            common_password,
        )
    }
    slitting_database = os.getenv("SLITTING_DB_NAME")
    slitting_import = os.getenv("SLITTING_IMPORT_SCHEMA")
    if slitting_database and slitting_import:
        departments["slitting"] = DepartmentDatabase(
            "slitting",
            slitting_database,
            slitting_import,
            os.getenv("SLITTING_MIGRATION_DB_USER") or common_user,
            os.getenv("SLITTING_MIGRATION_DB_PASSWORD") or common_password,
        )
    return departments


def migration_paths(department):
    paths = list((ROOT / "migrations").glob("*.sql"))
    paths.extend((ROOT / "migrations" / "departments" / department).glob("*.sql"))
    paths = sorted(paths, key=lambda path: path.name)
    names = [path.name for path in paths]
    if len(names) != len(set(names)):
        raise RuntimeError(f"Migration filenames must be unique for {department}: {names}")
    return paths


def migration_was_applied(path, applied_versions):
    accepted_names = {path.name, *MIGRATION_ALIASES.get(path.name, set())}
    if not accepted_names.isdisjoint(applied_versions):
        return True
    return any(
        legacy_sequence <= applied_versions
        for legacy_sequence in LEGACY_MIGRATION_SEQUENCES.get(path.name, ())
    )


def migration_sql(path, import_schema):
    sql = path.read_text(encoding="utf-8")
    sql = "\n".join(line for line in sql.splitlines() if not line.lstrip().startswith("--"))
    return re.sub(r"\bsystem_import\b", safe_identifier(import_schema), sql)


def ensure_schemas(department):
    connection = mysql.connector.connect(**department.connection_config(include_database=False))
    cursor = connection.cursor()
    try:
        for schema in (department.database, department.import_schema):
            cursor.execute(
                f"CREATE DATABASE IF NOT EXISTS {safe_identifier(schema)} "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
            )
        connection.commit()
    finally:
        cursor.close()
        connection.close()


def applied_versions(connection, create=False):
    cursor = connection.cursor()
    try:
        if create:
            cursor.execute("""CREATE TABLE IF NOT EXISTS schema_migrations (
                    version VARCHAR(100) PRIMARY KEY,
                    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                )""")
        cursor.execute("SELECT version FROM schema_migrations")
        return {row[0] for row in cursor.fetchall()}
    finally:
        cursor.close()


def run_department(department, status_only=False):
    if not status_only and os.getenv("MIGRATION_CREATE_SCHEMAS", "false").lower() in {
        "1",
        "true",
        "yes",
    }:
        ensure_schemas(department)
    connection = mysql.connector.connect(**department.connection_config())
    cursor = connection.cursor()
    try:
        applied = applied_versions(connection, create=not status_only)
        paths = migration_paths(department.name)
        pending = [path for path in paths if not migration_was_applied(path, applied)]
        print(
            f"{department.name}: database={department.database}, "
            f"import={department.import_schema}, "
            f"applied={len(applied)}, pending={len(pending)}"
        )
        for path in pending:
            print(f"  PENDING {path.name}")
        if status_only:
            return
        for path in pending:
            for statement in migration_sql(path, department.import_schema).split(";"):
                if statement.strip():
                    cursor.execute(statement)
            cursor.execute(
                "INSERT INTO schema_migrations (version) VALUES (%s)",
                (path.name,),
            )
            connection.commit()
            print(f"  APPLIED {path.name}")
    finally:
        cursor.close()
        connection.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--department", choices=("all", "slurry", "slitting"), default="all")
    parser.add_argument(
        "--status", action="store_true", help="Report migration state without changing schemas."
    )
    args = parser.parse_args()
    departments = configured_departments()
    if args.department == "slitting" and "slitting" not in departments:
        parser.error("SLITTING_DB_NAME and SLITTING_IMPORT_SCHEMA must be configured.")
    selected = departments.values() if args.department == "all" else (departments[args.department],)
    for department in selected:
        run_department(department, status_only=args.status)


if __name__ == "__main__":
    main()

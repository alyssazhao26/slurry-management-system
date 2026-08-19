from contextlib import contextmanager
from threading import Lock

import mysql.connector
from mysql.connector import pooling
from flask import current_app


_pool = None
_pool_lock = Lock()

REQUIRED_SYSTEM_IMPORT_COLUMNS = {
    "production_records": {
        "record_date", "shift_name", "machine_code", "formula_code", "batch_number",
        "planned_quantity", "actual_quantity", "qualified_pending", "achievement_rate",
        "qualified_rate", "notes", "custom_fields",
    },
    "abnormality_reports": {
        "event_date", "start_time", "end_time", "shift_name", "machine_code", "machine_type",
        "event_type", "severity", "duration_minutes", "description", "immediate_action",
        "is_resolved", "effective_time_cost", "cost_failure_types", "solution_provided",
        "actual_finish_date", "custom_fields",
    },
}
REQUIRED_SYSTEM_IMPORT_TABLES = {"production_records", "abnormality_reports", "event_type_options"}


def _connection_pool():
    """Create one bounded MySQL pool per GNEM server process."""
    global _pool
    with _pool_lock:
        if _pool is None:
            config = dict(current_app.config["DB"])
            config.update(
                pool_name="gnem_slurry_pool",
                pool_size=current_app.config["DB_POOL_SIZE"],
                pool_reset_session=True,
            )
            _pool = pooling.MySQLConnectionPool(**config)
    return _pool


def verify_ui_schema():
    """Fail fast if the database cannot store fields shown by the running UI."""
    connection = mysql.connector.connect(**current_app.config["DB"])
    try:
        cursor = connection.cursor()
        cursor.execute(
            """
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'system_import'
              AND table_name IN ('production_records', 'abnormality_reports', 'event_type_options')
            """
        )
        present = {table: set() for table in REQUIRED_SYSTEM_IMPORT_TABLES}
        for table_name, column_name in cursor.fetchall():
            present[table_name].add(column_name)
        missing = [
            f"system_import.{table}.{column}"
            for table, expected in REQUIRED_SYSTEM_IMPORT_COLUMNS.items()
            for column in sorted(expected - present[table])
        ]
        existing_tables = set(present)
        cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'system_import'")
        existing_tables = {row[0] for row in cursor.fetchall()}
        missing.extend(f"system_import.{table}" for table in REQUIRED_SYSTEM_IMPORT_TABLES - existing_tables)
        if missing:
            raise RuntimeError(
                "Database migration is incomplete. Run scripts/apply_migrations.py before starting GNEM. "
                f"Missing: {', '.join(missing)}"
            )
    finally:
        connection.close()


@contextmanager
def transaction():
    conn = _connection_pool().get_connection()
    try:
        cursor = conn.cursor(dictionary=True)
        yield cursor
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()

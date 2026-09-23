from contextlib import contextmanager
from threading import Lock

import mysql.connector
from mysql.connector import pooling
from flask import current_app
from .departments import database_config, import_schema, current_department
import re

_pools = {}
_pool_lock = Lock()


class DepartmentCursor:
    def __init__(self, cursor, schema):
        self._cursor, self._schema = cursor, schema

    def execute(self, operation, params=None):
        return self._cursor.execute(
            re.sub(r"\bsystem_import\.", self._schema + ".", operation), params
        )

    def executemany(self, operation, params):
        return self._cursor.executemany(
            re.sub(r"\bsystem_import\.", self._schema + ".", operation), params
        )

    def __getattr__(self, name):
        return getattr(self._cursor, name)


REQUIRED_SYSTEM_IMPORT_COLUMNS = {
    "production_records": {
        "record_date",
        "shift_name",
        "machine_code",
        "formula_code",
        "batch_number",
        "planned_quantity",
        "actual_quantity",
        "qualified_pending",
        "achievement_rate",
        "qualified_rate",
        "notes",
        "custom_fields",
    },
    "abnormality_reports": {
        "event_date",
        "start_time",
        "end_time",
        "shift_name",
        "machine_code",
        "machine_type",
        "event_type",
        "severity",
        "duration_minutes",
        "description",
        "immediate_action",
        "is_resolved",
        "effective_time_cost",
        "cost_failure_types",
        "solution_provided",
        "actual_finish_date",
        "custom_fields",
    },
}
REQUIRED_SYSTEM_IMPORT_TABLES = {
    "production_records",
    "abnormality_reports",
    "event_type_options",
    "display_settings",
}


def _connection_pool():
    config = database_config()
    key = (current_department(), tuple(sorted(config.items())))
    with _pool_lock:
        if key not in _pools:
            _pools[key] = pooling.MySQLConnectionPool(
                pool_name="gnem_" + current_department() + "_" + str(len(_pools)),
                pool_size=current_app.config["DB_POOL_SIZE"],
                pool_reset_session=True,
                **config,
            )
    return _pools[key]


def verify_ui_schema():
    """Fail fast if the database cannot store fields shown by the running UI."""
    connection = mysql.connector.connect(**database_config())
    try:
        cursor = connection.cursor()
        cursor.execute(
            """
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = %s
              AND table_name IN ('production_records', 'abnormality_reports', 'event_type_options')
            """,
            (import_schema(),),
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
        cursor.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = %s",
            (import_schema(),),
        )
        existing_tables = {row[0] for row in cursor.fetchall()}
        missing.extend(
            f"system_import.{table}" for table in REQUIRED_SYSTEM_IMPORT_TABLES - existing_tables
        )
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
    cursor = None
    try:
        cursor = DepartmentCursor(conn.cursor(dictionary=True), import_schema())
        yield cursor
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        if cursor is not None:
            cursor.close()
        conn.close()

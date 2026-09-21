import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("department_migrations", ROOT / "scripts" / "apply_migrations.py")
MIGRATIONS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATIONS)


def test_slitting_receives_common_and_department_only_migrations():
    names = [path.name for path in MIGRATIONS.migration_paths("slitting")]
    assert "001_initial_schema.sql" in names
    assert "003_slitting_department.sql" in names
    assert "026_slitting_event_categories.sql" in names
    assert "028_daily_task_shift_slots.sql" in names
    assert "029_attendance_login_timestamp_and_pin_lookup.sql" not in names
    assert "009_slitting_baseline_repair.sql" not in names


def test_slurry_does_not_receive_slitting_inventory_migrations():
    names = [path.name for path in MIGRATIONS.migration_paths("slurry")]
    assert "001_initial_schema.sql" in names
    assert "003_slitting_department.sql" not in names
    assert "028_daily_task_shift_slots.sql" in names
    assert "029_attendance_login_timestamp_and_pin_lookup.sql" in names


def test_import_schema_is_rewritten_and_validated():
    path = ROOT / "migrations" / "departments" / "slitting" / "003_slitting_department.sql"
    sql = MIGRATIONS.migration_sql(path, "slitting_system_import")
    assert "`slitting_system_import`.inventory_products" in sql
    assert "system_import.inventory_products" not in sql
    with pytest.raises(ValueError):
        MIGRATIONS.migration_sql(path, "unsafe-name")


def test_dedicated_migration_credentials_override_restricted_web_accounts(monkeypatch):
    monkeypatch.setenv("DB_USER", "slurry_web_app")
    monkeypatch.setenv("DB_PASSWORD", "web-secret")
    monkeypatch.setenv("MIGRATION_DB_USER", "gnem_migrator")
    monkeypatch.setenv("MIGRATION_DB_PASSWORD", "migration-secret")
    monkeypatch.setenv("SLITTING_DB_NAME", "slitting_management")
    monkeypatch.setenv("SLITTING_IMPORT_SCHEMA", "slitting_system_import")
    departments = MIGRATIONS.configured_departments()
    assert departments["slurry"].user == "gnem_migrator"
    assert departments["slurry"].password == "migration-secret"
    assert departments["slitting"].user == "gnem_migrator"
    assert departments["slitting"].password == "migration-secret"

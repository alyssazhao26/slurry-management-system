import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "department_migrations",
    ROOT / "scripts" / "apply_migrations.py",
)
MIGRATIONS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATIONS)


def test_slitting_receives_ordered_common_and_department_migrations():
    names = [path.name for path in MIGRATIONS.migration_paths("slitting")]
    assert names == [
        "001_initial_schema.sql",
        "002_approved_feature_round.sql",
        "003_daily_task_shift_slots.sql",
        "010_slitting_department.sql",
        "011_slitting_event_categories.sql",
    ]


def test_slurry_receives_ordered_common_and_attendance_migrations():
    names = [path.name for path in MIGRATIONS.migration_paths("slurry")]
    assert names == [
        "001_initial_schema.sql",
        "002_approved_feature_round.sql",
        "003_daily_task_shift_slots.sql",
        "020_attendance_system.sql",
        "021_attendance_login_timestamp_and_pin_lookup.sql",
    ]


@pytest.mark.parametrize(
    ("canonical", "historical"),
    [
        ("003_daily_task_shift_slots.sql", "028_daily_task_shift_slots.sql"),
        ("010_slitting_department.sql", "003_slitting_department.sql"),
        ("011_slitting_event_categories.sql", "026_slitting_event_categories.sql"),
        ("020_attendance_system.sql", "027_attendance_system.sql"),
        (
            "021_attendance_login_timestamp_and_pin_lookup.sql",
            "029_attendance_login_timestamp_and_pin_lookup.sql",
        ),
    ],
)
def test_historical_migration_names_satisfy_renamed_files(canonical, historical):
    path = Path(canonical)
    assert MIGRATIONS.migration_was_applied(path, {historical})
    assert MIGRATIONS.migration_was_applied(path, {canonical})
    assert not MIGRATIONS.migration_was_applied(path, set())


@pytest.mark.parametrize(
    ("department", "v330_ledger"),
    [
        (
            "slitting",
            {
                "001_initial_schema.sql",
                "002_approved_feature_round.sql",
                "028_daily_task_shift_slots.sql",
                "003_slitting_department.sql",
                "026_slitting_event_categories.sql",
            },
        ),
        (
            "slurry",
            {
                "001_initial_schema.sql",
                "002_approved_feature_round.sql",
                "028_daily_task_shift_slots.sql",
                "027_attendance_system.sql",
                "029_attendance_login_timestamp_and_pin_lookup.sql",
            },
        ),
    ],
)
def test_v330_ledger_has_no_false_pending_migrations(department, v330_ledger):
    pending = [
        path.name
        for path in MIGRATIONS.migration_paths(department)
        if not MIGRATIONS.migration_was_applied(path, v330_ledger)
    ]
    assert pending == []


@pytest.mark.parametrize(
    "canonical",
    [
        "002_approved_feature_round.sql",
        "003_daily_task_shift_slots.sql",
        "010_slitting_department.sql",
        "020_attendance_system.sql",
        "021_attendance_login_timestamp_and_pin_lookup.sql",
    ],
)
def test_complete_legacy_sequences_satisfy_consolidated_files(canonical):
    sequence = MIGRATIONS.LEGACY_MIGRATION_SEQUENCES[canonical][0]
    assert MIGRATIONS.migration_was_applied(Path(canonical), set(sequence))
    assert not MIGRATIONS.migration_was_applied(
        Path(canonical),
        set(sequence) - {next(iter(sequence))},
    )


def test_import_schema_is_rewritten_and_validated():
    path = ROOT / "migrations" / "departments" / "slitting" / "010_slitting_department.sql"
    sql = MIGRATIONS.migration_sql(path, "slitting_system_import")
    assert "`slitting_system_import`.inventory_products" in sql
    assert "system_import.inventory_products" not in sql
    with pytest.raises(ValueError):
        MIGRATIONS.migration_sql(path, "unsafe-name")


def test_dedicated_migration_credentials_override_restricted_web_accounts(
    monkeypatch,
):
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
    assert "coating" not in departments

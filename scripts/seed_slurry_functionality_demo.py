"""Insert idempotent Slurry production and event examples for feature verification."""

import json
import sys
from datetime import date, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app import create_app
from app.db import transaction
from app.departments import department_context


PRODUCTION = (
    (-21, "J2", "K1-26", "DEMO-SLURRY-01", 1200, 1160, 1135),
    (-14, "J5", "B1-1", "DEMO-SLURRY-02", 1400, 1365, 1328),
    (-7, "J3", "E3", "DEMO-SLURRY-03", 1100, 1080, 1055),
    (0, "J8", "K1-26", "DEMO-SLURRY-04", 1500, 1460, 1422),
)

EVENTS = (
    (-25, "J2", "Equipment Event", 35, "Transfer pump pressure fluctuation"),
    (-20, "J5", "Quality Event", 28, "Viscosity verification required adjustment"),
    (-15, "J2", "Material Event", 42, "Raw material delivery arrived outside sequence"),
    (-11, "J8", "Personnel Event", 18, "Shift handover checklist required correction"),
    (-7, "J5", "Equipment Event", 55, "Agitator sensor produced intermittent reading"),
    (-3, "J3", "Cleaning", 24, "Extended vessel cleaning verification"),
    (0, "J8", "Quality Event", 31, "Retained sample required secondary review"),
)


def main():
    app = create_app()
    inserted = 0
    with app.app_context(), department_context("slurry"), transaction() as cursor:
        for offset, machine, formula, batch, planned, actual, qualified in PRODUCTION:
            record_date = date.today() + timedelta(days=offset)
            cursor.execute("SELECT id FROM system_import.production_records WHERE batch_number=%s", (batch,))
            if cursor.fetchone():
                continue
            cursor.execute(
                """INSERT INTO system_import.production_records
                   (record_date, shift_name, machine_code, formula_code, batch_number,
                    planned_quantity, actual_quantity, qualified_quantity, qualified_pending,
                    notes, achievement_rate, qualified_rate, custom_fields)
                   VALUES (%s, 'Day 08-20', %s, %s, %s, %s, %s, %s, FALSE,
                           '[FUNCTIONALITY DEMO]', %s, %s, JSON_OBJECT())""",
                (record_date, machine, formula, batch, planned, actual, qualified,
                 actual / planned, qualified / actual),
            )
            inserted += 1
        for offset, machine, event_type, minutes, description in EVENTS:
            event_date = date.today() + timedelta(days=offset)
            marker = f"[FUNCTIONALITY DEMO] {event_date} {machine} {description}"
            cursor.execute("SELECT id FROM system_import.abnormality_reports WHERE description=%s", (marker,))
            if cursor.fetchone():
                continue
            cursor.execute(
                """INSERT INTO system_import.abnormality_reports
                   (event_date, start_time, end_time, shift_name, machine_code, machine_type,
                    event_type, severity, duration_minutes, description, immediate_action,
                    state, is_resolved, effective_time_cost, cost_failure_types,
                    responsible_person, target_finish_date, solution_provided,
                    actual_finish_date, effectiveness, custom_fields)
                   VALUES (%s, '09:00', '10:00', 'Day 08-20', %s, 'semi', %s, 'normal', %s,
                           %s, 'Demonstration corrective action / 演示纠正措施', 'resolved', 'yes',
                           'yes', JSON_ARRAY(), 'Demo owner', %s,
                           'Functionality demonstration only / 仅用于功能演示', %s,
                           'effective', %s)""",
                (event_date, machine, event_type, minutes, marker, event_date, event_date,
                 json.dumps({"demo_note": description})),
            )
            inserted += 1
    print(f"Inserted {inserted} Slurry functionality demo record(s).")


if __name__ == "__main__":
    main()

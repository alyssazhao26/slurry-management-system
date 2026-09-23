"""Insert idempotent Slitting abnormality examples for display verification."""

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

DEMO_ROWS = (
    (
        -4,
        "Day",
        "FJ3",
        "Equipment Issue / 设备异常",
        "Blade issue / 刀片异常",
        35,
        "Blade alignment required adjustment / 刀片位置需要调整",
    ),
    (
        -2,
        "Night",
        "FJ5",
        "Incoming Material Issue / 来料异常",
        "Coated film appearance defect / 涂覆膜外观异常",
        50,
        "Surface marks found during unwind / 放卷时发现表面印痕",
    ),
    (
        0,
        "Day",
        "FX1",
        "QC Issue / 检验异常",
        "Width out of standard / 宽度超标",
        25,
        "Width check required a machine adjustment / 宽度检查后调整设备",
    ),
    (
        -2,
        "Day",
        "FX3",
        "Equipment Issue / 设备异常",
        "Tension control issue / 张力异常",
        20,
        "Tension fluctuated during production / 生产时张力波动",
    ),
    (
        -2,
        "Night",
        "FJ4",
        "Personnel / Operation Issue / 人员异常",
        "Shift handover omission / 交接班遗漏",
        15,
        "Handover checklist item was missed / 交接清单项目遗漏",
    ),
    (
        0,
        "Day",
        "FX4",
        "Incoming Material Issue / 来料异常",
        "Material shortage / 缺料",
        10,
        "Material delivery was delayed / 来料延迟",
    ),
)


def main():
    app = create_app()
    inserted = 0
    with app.app_context(), department_context("slitting"):
        with transaction() as cursor:
            for offset, shift, machine, category, subcategory, minutes, note in DEMO_ROWS:
                event_date = date.today() + timedelta(days=offset)
                marker = f"[DISPLAY DEMO] {event_date.isoformat()} {machine} {subcategory}"
                cursor.execute(
                    "SELECT id FROM system_import.abnormality_reports WHERE description=%s LIMIT 1",
                    (marker,),
                )
                if cursor.fetchone():
                    continue
                cursor.execute(
                    """
                    INSERT INTO system_import.abnormality_reports
                        (event_date, start_time, end_time, shift_name, machine_code,
                         machine_type, event_type, severity, duration_minutes,
                         description, immediate_action, state, is_resolved,
                         effective_time_cost, cost_failure_types, target_finish_date,
                         solution_provided, actual_finish_date, effectiveness, custom_fields)
                    VALUES
                        (%s, '10:00', '11:00', %s, %s, 'auto', %s, 'normal', %s,
                         %s, 'Example corrective action completed / 示例纠正措施已完成',
                         'resolved', 'yes', 'yes', JSON_ARRAY(), %s,
                         'Display demonstration only / 仅用于看板演示', %s, 'effective', %s)
                    """,
                    (
                        event_date,
                        shift,
                        machine,
                        category,
                        minutes,
                        marker,
                        event_date,
                        event_date,
                        json.dumps({"subcategory": subcategory, "event_notes": note}),
                    ),
                )
                inserted += 1
    print(f"Inserted {inserted} Slitting display demo abnormality record(s).")


if __name__ == "__main__":
    main()

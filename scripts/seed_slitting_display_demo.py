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
    (-27, "Day", "FJ5", "Equipment Issue / 设备异常", "Guide roller wear / 导辊磨损", 18,
     "Initial guide roller inspection / 首次导辊检查"),
    (-23, "Night", "FJ3", "QC Issue / 检验异常", "Width variation / 宽度波动", 22,
     "Width variation identified during sampling / 抽检发现宽度波动"),
    (-20, "Day", "FJ5", "Incoming Material Issue / 来料异常", "Coating mark / 涂层印痕", 26,
     "Incoming roll isolated for review / 来料卷已隔离检查"),
    (-17, "Night", "FX3", "Personnel / Operation Issue / 人员异常", "Setup delay / 换型延迟", 16,
     "Setup checklist reviewed / 已复核换型清单"),
    (-13, "Day", "FJ5", "Equipment Issue / 设备异常", "Tension fluctuation / 张力波动", 31,
     "Tension system parameters checked / 已检查张力系统参数"),
    (-10, "Night", "FJ3", "Incoming Material Issue / 来料异常", "Material splice / 来料接头", 19,
     "Splice location documented / 已记录接头位置"),
    (-7, "Day", "FJ5", "QC Issue / 检验异常", "Edge quality / 边缘质量", 24,
     "Edge inspection frequency increased / 已提高边缘检查频率"),
    (-5, "Night", "FX3", "Equipment Issue / 设备异常", "Sensor alignment / 传感器对位", 21,
     "Sensor alignment corrected / 已校正传感器位置"),
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
    (
        -1,
        "Day",
        "FJ5",
        "Equipment Issue / 设备异常",
        "Guide roller vibration / 导辊振动",
        30,
        "Guide roller vibration required inspection / 导辊振动需要检查",
    ),
    (
        0,
        "Night",
        "FJ5",
        "QC Issue / 检验异常",
        "Edge quality variation / 边缘质量波动",
        20,
        "Edge quality variation required parameter adjustment / 边缘质量波动需要调整参数",
    ),
)


def main():
    app = create_app()
    inserted = 0
    with app.app_context(), department_context("slitting"):
        with transaction() as cursor:
            cursor.execute("SELECT model_code, width_m, coated_length_m, coated_width_m, stations, slitting_length_m FROM system_import.slitting_model_specs WHERE is_active=TRUE AND width_m IS NOT NULL AND coated_length_m IS NOT NULL AND coated_width_m IS NOT NULL AND stations IS NOT NULL AND slitting_length_m IS NOT NULL ORDER BY model_code LIMIT 3")
            specs = cursor.fetchall()
            if not specs:
                demo_specs = (("DISPLAY-DEMO-88.8MM", .0888, 2000, 1.0, 10, 1800), ("DISPLAY-DEMO-93.7MM", .0937, 1800, 1.0, 9, 1650))
                for values in demo_specs:
                    cursor.execute("""INSERT INTO system_import.slitting_model_specs
                        (model_code,width_m,coated_length_m,coated_width_m,stations,slitting_length_m,is_active)
                        VALUES (%s,%s,%s,%s,%s,%s,TRUE)
                        ON DUPLICATE KEY UPDATE width_m=VALUES(width_m),coated_length_m=VALUES(coated_length_m),coated_width_m=VALUES(coated_width_m),stations=VALUES(stations),slitting_length_m=VALUES(slitting_length_m),is_active=TRUE""", values)
                cursor.execute("SELECT model_code, width_m, coated_length_m, coated_width_m, stations, slitting_length_m FROM system_import.slitting_model_specs WHERE model_code LIKE 'DISPLAY-DEMO-%' ORDER BY model_code")
                specs = cursor.fetchall()
            demo_machines = ("FJ1", "FJ3", "FJ6", "FX3")
            for day_offset in range(-6, 1):
                record_date = date.today() + timedelta(days=day_offset)
                for machine_index, machine in enumerate(demo_machines):
                    spec = specs[(machine_index + day_offset) % len(specs)]
                    planned_rolls = 8 + machine_index * 2
                    input_rolls = max(1, planned_rolls - ((machine_index + abs(day_offset)) % 4))
                    qualified_rolls = max(0, input_rolls * int(spec["stations"]) - ((machine_index + abs(day_offset)) % 3))
                    unit = float(spec["width_m"]) * float(spec["slitting_length_m"])
                    batch = f"DISPLAY-DEMO-{record_date:%Y%m%d}-{machine}"
                    custom = {"slitting": {"width_m": float(spec["width_m"]), "coated_length_m": float(spec["coated_length_m"]), "coated_width_m": float(spec["coated_width_m"]), "stations": int(spec["stations"]), "slitting_length_m": float(spec["slitting_length_m"]), "planned_rolls": planned_rolls, "input_rolls": input_rolls, "qualified_rolls": qualified_rolls}}
                    planned = planned_rolls * int(spec["stations"]) * unit
                    actual = input_rolls * int(spec["stations"]) * unit
                    qualified = qualified_rolls * unit
                    cursor.execute("SELECT id FROM system_import.production_records WHERE batch_number=%s LIMIT 1", (batch,))
                    if cursor.fetchone():
                        continue
                    cursor.execute("""INSERT INTO system_import.production_records
                        (record_date,shift_name,machine_code,formula_code,batch_number,planned_quantity,actual_quantity,qualified_quantity,qualified_pending,notes,achievement_rate,qualified_rate,custom_fields)
                        VALUES (%s,'Day',%s,%s,%s,%s,%s,%s,FALSE,'[DISPLAY DEMO]',%s,%s,%s)""",
                        (record_date,machine,spec["model_code"],batch,planned,actual,qualified,actual/planned if planned else None,qualified/actual if actual else None,json.dumps(custom)))
                    inserted += 1
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
    print(f"Inserted {inserted} Slitting display demo production/event record(s).")


if __name__ == "__main__":
    main()

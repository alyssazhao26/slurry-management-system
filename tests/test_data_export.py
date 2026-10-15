import pytest
from flask import Flask
from openpyxl import load_workbook

from app.departments import department_context
from app.services import records


def test_export_columns_are_department_specific():
    app = Flask(__name__)
    with app.app_context(), department_context("slurry"):
        keys = {key for key, _ in records.data_export_columns("production")}
        assert "planned_rolls" not in keys
        event_keys = {key for key, _ in records.data_export_columns("abnormality")}
        assert "subcategory" not in event_keys
    with app.app_context(), department_context("slitting"):
        keys = {key for key, _ in records.data_export_columns("production")}
        assert {"planned_rolls", "input_rolls", "qualified_rolls"} <= keys
        event_keys = {key for key, _ in records.data_export_columns("abnormality")}
        assert {"subcategory", "event_notes", "duration_minutes"} <= event_keys


@pytest.mark.parametrize(
    "start,end,message",
    [("invalid", "2026-10-15", "valid export"),
     ("2026-10-16", "2026-10-15", "cannot be after"),
     ("2025-01-01", "2026-10-15", "one year")],
)
def test_export_date_range_validation(start, end, message):
    with pytest.raises(ValueError, match=message):
        records._export_date_range(start, end)


def test_excel_export_contains_only_selected_columns(monkeypatch):
    monkeypatch.setattr(records, "prepare_data_export", lambda *args: (
        ["record_date", "machine_code"],
        {"record_date": "Date / 日期", "machine_code": "Machine / 设备"},
        [{"record_date": "2026-10-15", "machine_code": "J8"}],
    ))
    output, count = records.export_data_workbook(
        "production", "2026-10-01", "2026-10-15", ["record_date", "machine_code"]
    )
    sheet = load_workbook(output).active
    assert count == 1
    assert [cell.value for cell in sheet[1]] == ["Date / 日期", "Machine / 设备"]
    assert [cell.value for cell in sheet[2]] == ["2026-10-15", "J8"]


def test_tracker_includes_duration_and_event_type_filter():
    from pathlib import Path
    root = Path(__file__).parents[1]
    javascript = (root / "app" / "static" / "app.js").read_text(encoding="utf-8")
    service = (root / "app" / "services" / "records.py").read_text(encoding="utf-8")
    assert "Duration min / 持续分钟" in javascript
    assert 'event_type: root.querySelector(\'[name="event_type"]\')' in javascript
    assert 'conditions.append("event_type = %s")' in service

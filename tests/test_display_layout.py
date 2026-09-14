from contextlib import contextmanager
from pathlib import Path

import pytest
from flask import Flask

from app.departments import department_context
from app.services import records


def test_slitting_display_uses_all_open_event_feed():
    source = (Path(__file__).parents[1] / "app" / "static" / "slitting-display.js").read_text(encoding="utf-8")
    assert "fetch('/api/public-display?department=slitting')" in source
    assert "openData.ongoing_events" in source


def test_live_display_keeps_widths_but_allows_content_height():
    root = Path(__file__).parents[1]
    for filename in ("display.js", "slitting-display.js"):
        source = (root / "app" / "static" / filename).read_text(encoding="utf-8")
        assert "style.gridColumn=`span" in source
        assert "style.gridRow='auto'" in source
        assert "--block-height" in source
        assert "startAutomaticOverflowCycle" in source
        assert "adaptDisplayBlocks" in source
        assert "requestAnimationFrame(frame)" in source
        assert "pixelsPerSecond" in source


def test_department_specific_five_column_defaults():
    with Flask(__name__).app_context():
        settings = records.default_display_settings()
        assert [block["key"] for block in settings["blocks"]] == ["task", "rates", "pending_qualification", "production_trend", "abnormality_trend", "ongoing"]
        assert settings["event_columns"] == []
        with department_context("slitting"):
            settings = records.default_display_settings()
            assert [block["key"] for block in settings["blocks"]] == ["slitting_task", "slitting_events"]
            assert next(block for block in settings["blocks"] if block["key"] == "slitting_task")["width"] == 3
            assert next(block for block in settings["blocks"] if block["key"] == "slitting_events")["width"] == 5


def test_slurry_abnormality_chart_uses_stacked_downtime_and_exclusions():
    root = Path(__file__).parents[1]
    service_source = (root / "app" / "services" / "records.py").read_text(encoding="utf-8")
    chart_source = (root / "app" / "static" / "display.js").read_text(encoding="utf-8")
    assert "SUM(reports.duration_minutes)" in service_source
    assert "'cleaning', 'normal production'" in service_source
    assert "categories" in chart_source and "chart-stack-segment" in chart_source
    assert "categoryIndex" in chart_source
    assert "chart-category-legend" in chart_source
    assert "direction === 'down' ? limit : 0" in chart_source
    assert "direction === 'down' ? 'up' : 'down'" in chart_source


def test_slitting_standard_fields_use_slitting_catalog(monkeypatch):
    class Cursor:
        def execute(self, sql, params=None):
            pass

        def fetchall(self):
            return []

    @contextmanager
    def fake_transaction():
        yield Cursor()

    monkeypatch.setattr(records, "transaction", fake_transaction)
    with Flask(__name__).app_context(), department_context("slitting"):
        production = records.get_standard_field_settings("production")
        abnormality = records.get_standard_field_settings("abnormality")
    production_keys = {field["field_key"] for field in production}
    abnormality_keys = {field["field_key"] for field in abnormality}
    assert {"slitting_model", "planned_rolls", "input_rolls", "qualified_rolls"} <= production_keys
    assert "formula_code" not in production_keys
    assert {"subcategory", "event_notes"} <= abnormality_keys
    assert "machine_type" not in abnormality_keys


def test_slitting_daily_task_requires_overview_and_schedule(monkeypatch):
    executed = []

    class Cursor:
        lastrowid = 1

        def execute(self, sql, params=None):
            executed.append((sql, params))

    @contextmanager
    def fake_transaction():
        yield Cursor()

    monkeypatch.setattr(records, "transaction", fake_transaction)
    monkeypatch.setattr(records.slitting, "machine_choices", lambda form_key='production': [{"value": machine, "label": machine} for machine in records.slitting.MACHINES])
    payload = {"task_items": [
        {"type": "slitting_production", "product_item": "88.8MM", "production_status": "production_in_progress", "production_target": 150, "target_unit": "sr", "custom_unit": ""},
        {"type": "slitting_schedule", "machine": "FX4", "product_item": "88.8 mm", "planned_input": "150 sr", "operator": "Operator A", "shift_lead": "Lead A"},
    ], "reminders": []}
    with Flask(__name__).app_context(), department_context("slitting"):
        records.save_daily_task(payload, actor_id=2)
        with pytest.raises(ValueError, match="schedule"):
            records.save_daily_task({"task_items": payload["task_items"][:1], "reminders": []})
    assert any("INSERT INTO system_import.daily_tasks" in sql for sql, _ in executed)


def test_slitting_custom_product_and_training_are_saved(monkeypatch):
    executed = []

    class Cursor:
        def execute(self, sql, params=None):
            executed.append((sql, params))

    @contextmanager
    def fake_transaction():
        yield Cursor()

    monkeypatch.setattr(records, "transaction", fake_transaction)
    monkeypatch.setattr(records.slitting, "machine_choices", lambda form_key='production': [{"value": machine, "label": machine} for machine in records.slitting.MACHINES])
    payload = {"task_items": [
        {"type": "slitting_production", "product_item": "CUSTOM", "custom_product_item": "Cleaning", "production_status": "production_in_progress", "production_target": 2, "target_unit": "custom", "custom_unit": "hours"},
        {"type": "slitting_schedule", "machine": "FX4", "product_item": "CUSTOM", "custom_product_item": "Cleaning", "planned_input": "2 hours", "operator": "Operator A", "shift_lead": "Lead A"},
        {"type": "slitting_training", "training_item": "Safety", "training_type": "Hands-on", "subject": "Night shift operators", "time": "9:00-10:00"},
    ], "reminders": []}
    with Flask(__name__).app_context(), department_context("slitting"):
        records.save_daily_task(payload, actor_id=2)
    saved_items = __import__("json").loads(executed[0][1][1])
    assert saved_items[0]["product_item"] == "Cleaning"
    assert saved_items[1]["product_item"] == "Cleaning"
    assert saved_items[2]["type"] == "slitting_training"


def test_slitting_training_can_be_the_only_task(monkeypatch):
    @contextmanager
    def fake_transaction():
        class Cursor:
            def execute(self, sql, params=None):
                pass
        yield Cursor()

    monkeypatch.setattr(records, "transaction", fake_transaction)
    payload = {"task_items": [{"type": "slitting_training", "training_item": "Safety", "training_type": "Classroom", "subject": "FX operators", "time": "10:00"}], "reminders": []}
    with Flask(__name__).app_context(), department_context("slitting"):
        records.save_daily_task(payload)


def test_static_text_heading_and_five_by_five_are_saved(monkeypatch):
    executed = []

    class Cursor:
        def execute(self, sql, params=None):
            executed.append((sql, params))

    @contextmanager
    def fake_transaction():
        yield Cursor()

    monkeypatch.setattr(records, "transaction", fake_transaction)
    with Flask(__name__).app_context():
        defaults = records.default_display_settings()
        payload = {
            **defaults,
            "blocks": [
                *defaults["blocks"],
                {"key": "text_12345678", "type": "static_text", "title": "Safety", "content": "Check guards",
                 "heading_level": "h1", "visible": True, "order": 90, "width": 9, "height": 9, "font_size": 16},
            ],
        }
        saved = records.save_display_settings(payload)
    notice = next(block for block in saved["blocks"] if block["key"] == "text_12345678")
    assert (notice["heading_level"], notice["width"], notice["height"]) == ("h1", 5, 5)
    assert executed


def test_static_text_rejects_unknown_heading(monkeypatch):
    @contextmanager
    def fake_transaction():
        yield object()

    monkeypatch.setattr(records, "transaction", fake_transaction)
    with Flask(__name__).app_context():
        defaults = records.default_display_settings()
        defaults["blocks"].append({"key": "text_12345678", "type": "static_text", "title": "Safety", "content": "",
                                   "heading_level": "h3", "visible": True, "order": 90, "width": 1, "height": 1})
        with pytest.raises(ValueError, match="Heading 1 or Heading 2"):
            records.save_display_settings(defaults)

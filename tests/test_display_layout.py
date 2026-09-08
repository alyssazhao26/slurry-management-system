from contextlib import contextmanager

import pytest
from flask import Flask

from app.departments import department_context
from app.services import records


def test_department_specific_five_column_defaults():
    with Flask(__name__).app_context():
        assert next(block for block in records.default_display_settings()["blocks"] if block["key"] == "events")["width"] == 5
        with department_context("slitting"):
            settings = records.default_display_settings()
            assert [block["key"] for block in settings["blocks"]] == ["slitting_task", "slitting_events"]
            assert all(block["width"] == 5 for block in settings["blocks"])


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
    payload = {"task_items": [
        {"type": "slitting_production", "product_item": "88.8MM", "production_status": "production_in_progress", "production_target": 150, "target_unit": "sr", "custom_unit": ""},
        {"type": "slitting_schedule", "machine": "FX4", "product_item": "88.8 mm", "planned_input": "150 sr", "operator": "Operator A", "shift_lead": "Lead A"},
    ], "reminders": []}
    with Flask(__name__).app_context(), department_context("slitting"):
        records.save_daily_task(payload, actor_id=2)
        with pytest.raises(ValueError, match="schedule"):
            records.save_daily_task({"task_items": payload["task_items"][:1], "reminders": []})
    assert any("INSERT INTO system_import.daily_tasks" in sql for sql, _ in executed)


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

from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path

import pytest
from flask import Flask

from app.departments import department_context
from app.services import records


def compact(source):
    """Ignore formatter-only whitespace in JavaScript source assertions."""
    return "".join(source.split())


def test_production_slot_uses_night_shift_start_date():
    with Flask(__name__).app_context(), department_context("slitting"):
        assert records.current_production_slot(
            datetime(2026, 9, 7, 7, 49),
        ) == (date(2026, 9, 6), "Night")
        assert records.current_production_slot(
            datetime(2026, 9, 7, 7, 50),
        ) == (date(2026, 9, 7), "Day")
        assert records.current_production_slot(
            datetime(2026, 9, 7, 19, 50),
        ) == (date(2026, 9, 7), "Night")
        assert records.production_shift_label(date(2026, 9, 7), "Day") == "Day · 07:50–19:50"
        assert records.production_shift_label(date(2026, 9, 7), "Night") == "Night · 19:50–07:50"


def test_slurry_uses_two_selectable_day_schedules():
    with Flask(__name__).app_context(), department_context("slurry"):
        assert records.current_production_slot(
            datetime(2026, 9, 12, 21, 0),
        ) == (date(2026, 9, 12), "Day 08-20")
        assert (
            records.production_shift_label(
                date(2026, 9, 12),
                "Day 08-17",
            )
            == "Day · 08:00–17:00"
        )
        assert (
            records.production_shift_label(
                date(2026, 9, 14),
                "Day 08-20",
            )
            == "Day · 08:00–20:00"
        )
        assert records.current_production_slot(
            datetime(2026, 9, 13, 10, 0),
        ) == (date(2026, 9, 14), "Day 08-20")


def test_slitting_display_uses_all_open_event_feed():
    source = (Path(__file__).parents[1] / "app" / "static" / "slitting-display.js").read_text(
        encoding="utf-8"
    )
    source_compact = compact(source)
    assert "fetch('/api/public-display?'+slotQuery)" in source_compact
    assert "openData.ongoing_events" in source
    assert "consttaskWidth=trainingVisible?" in source_compact
    assert "bottomPauseMilliseconds=10000" in source_compact
    assert "constholdAtBottom=" in source_compact
    assert "root.scrollHeight-window.innerHeight" in source_compact
    assert ":5;" in source_compact


def test_live_display_keeps_widths_but_allows_content_height():
    root = Path(__file__).parents[1]
    for filename in ("display.js", "slitting-display.js"):
        source = (root / "app" / "static" / filename).read_text(encoding="utf-8")
        source_compact = compact(source)
        assert "style.gridColumn=`span" in source_compact
        assert "style.gridRow='auto'" in source_compact
        assert "--block-height" in source
        assert "startAutomaticOverflowCycle" in source
        assert "adaptDisplayBlocks" in source
        assert "requestAnimationFrame(frame)" in source
        assert "pixelsPerSecond" in source


def test_department_specific_display_defaults():
    with Flask(__name__).app_context():
        settings = records.default_display_settings()
        assert [block["key"] for block in settings["blocks"]] == [
            "task",
            "reminders",
            "rates",
            "pending_qualification",
            "production_trend",
            "abnormality_trend",
            "ongoing",
        ]
        assert settings["event_columns"] == []
        with department_context("slitting"):
            settings = records.default_display_settings()
            assert settings["layout_version"] == 4
            assert [block["key"] for block in settings["blocks"]] == [
                "slitting_task",
                "slitting_training",
                "slitting_reminders",
                "slitting_pending_qualification",
                "slitting_events",
                "slitting_production_trend",
                "slitting_abnormality_trend",
            ]
            assert (
                next(block for block in settings["blocks"] if block["key"] == "slitting_task")[
                    "width"
                ]
                == 3
            )
            assert (
                next(block for block in settings["blocks"] if block["key"] == "slitting_training")[
                    "width"
                ]
                == 2
            )
            assert (
                next(block for block in settings["blocks"] if block["key"] == "slitting_events")[
                    "width"
                ]
                == 5
            )
            assert settings["event_columns"][0]["key"] == "shift_name"


def test_shift_is_visible_in_tracker_and_pending_quality():
    root = Path(__file__).parents[1]
    app_js = (root / "app" / "static" / "app.js").read_text(encoding="utf-8")
    display_js = (root / "app" / "static" / "display.js").read_text(encoding="utf-8")
    service_source = (root / "app" / "services" / "records.py").read_text(encoding="utf-8")

    assert "['shift_name', 'Shift / \u73ed\u6b21']" in app_js
    assert "record.shift_name || 'Day'" in app_js
    assert "record.shift_name || 'Day'" in display_js
    assert "SELECT id, record_date, shift_name, formula_code" in service_source
    assert "SELECT id, event_date, start_time, shift_name, machine_code" in service_source


def test_tv_mode_uses_responsive_canvas_and_preserves_training_block():
    root = Path(__file__).parents[1]
    css = (root / "app" / "static" / "display.css").read_text(encoding="utf-8")
    slurry_js = (root / "app" / "static" / "display.js").read_text(encoding="utf-8")
    slitting_js = (root / "app" / "static" / "slitting-display.js").read_text(encoding="utf-8")
    template = (root / "app" / "templates" / "slitting_display.html").read_text(encoding="utf-8")

    assert "configurable-display:not(.tv-mode)" in css
    assert "TV_LAYOUT_WIDTH" not in slurry_js
    assert "TV_LAYOUT_WIDTH" not in slitting_js
    assert "document.body.style.width = '100%'" in slurry_js
    assert "document.body.style.width='100%'" in compact(slitting_js)
    assert 'data-display-block="slitting_training"' in template
    assert "renderSlittingTraining(production.daily_task)" in compact(slitting_js)


def test_slitting_training_is_rendered_on_management_dashboard():
    root = Path(__file__).parents[1]
    app_js = (root / "app" / "static" / "app.js").read_text(encoding="utf-8")
    dashboard = (root / "app" / "templates" / "dashboard.html").read_text(encoding="utf-8")

    assert "item.type === 'slitting_training'" in app_js
    assert "Training / 培训" in app_js
    assert "app.js?v=20261015-report-pdf" in dashboard
    assert "slitting.js?v=20261015-report-pdf" in dashboard
    assert "select-all-event-columns" in dashboard
    assert "display-abnormality-types" in dashboard
    assert "abnormality_chart_types" in app_js
    assert "save-report-pdf" in dashboard
    assert "saveReportPdf" in app_js


def test_slitting_report_labels_and_optional_training():
    root = Path(__file__).parents[1]
    report_js = (root / "app" / "static" / "slitting.js").read_text(encoding="utf-8")
    display_js = (root / "app" / "static" / "slitting-display.js").read_text(encoding="utf-8")

    assert "Actual output / 实际产出" in report_js
    assert "Qualified output / 合格产出" in report_js
    assert "function qualifiedOutput(stats)" in report_js
    assert "Actual rolls / 实际卷数" in report_js
    assert "Actual rolls / 实际卷数', compactNumber(actualRolls, 0)" in report_js
    assert "Planned / 计划" in report_js
    assert "Qualified / 合格" in report_js
    assert "in · ${record.qualified_rolls" not in report_js
    assert "Date / 日期" in report_js
    display_compact = compact(display_js)
    assert "trainingSection.hidden=!trainingVisible" in display_compact
    assert "taskSection.dataset.fullRow=String(!trainingVisible)" in display_compact


def test_slurry_daily_report_is_management_by_exception():
    root = Path(__file__).parents[1]
    app_js = (root / "app" / "static" / "app.js").read_text(encoding="utf-8")
    template = (root / "app" / "templates" / "dashboard.html").read_text(encoding="utf-8")
    service = (root / "app" / "services" / "records.py").read_text(encoding="utf-8")

    assert "Recorded time by event category / 各事件类别记录时间" in template
    assert "Categories are shown exactly as entered" in template
    assert "Unresolved on report date / 报告日期未解决" in template
    assert "Unresolved from earlier dates / 以往日期未解决" in template
    assert "View full event log / 查看完整事件记录" not in template
    assert "Notable completed events / 重点已完成事件" in template
    assert "function slurryReportModel(data)" in app_js
    assert "const categoryMap = new Map()" in app_js
    assert "function reportOpenDays(eventDate, reportDate)" in app_js
    assert "canvasTableHeight(model.unresolvedToday.length)" in app_js
    assert 'class="category-composition" viewBox="0 0 100 10"' in app_js
    assert "report-effective-time" in template
    assert "load-sample-report" not in template
    assert "renderReportTable('#report-exceptions', model.exceptions" in app_js
    assert "drawCanvasTable(context, 'Notable completed events" not in app_js
    assert "overdue / 已逾期" not in app_js
    assert "WHERE is_resolved = 'no'" in service
    assert '"ongoing_events": _json_safe_rows(ongoing_events)' in service


def test_slurry_abnormality_chart_uses_stacked_downtime_and_exclusions():
    root = Path(__file__).parents[1]
    service_source = (root / "app" / "services" / "records.py").read_text(encoding="utf-8")
    chart_source = (root / "app" / "static" / "display.js").read_text(encoding="utf-8")
    assert "SUM(reports.duration_minutes)" in service_source
    assert "'cleaning', 'normal production'" in service_source
    assert "categories" in chart_source and "chart-stack-segment" in chart_source
    assert "categoryIndex" in chart_source
    assert "chart-category-legend" in chart_source
    assert "jumpToTop();" in chart_source
    assert "bottomPauseMilliseconds = 10000" in chart_source
    assert "setTimeout(scrollDown, topPauseMilliseconds)" in chart_source
    assert "direction === 'down' ? 'up' : 'down'" not in chart_source


def test_slitting_display_compares_machines_for_attainment_and_downtime():
    root = Path(__file__).parents[1]
    source = (root / "app" / "static" / "slitting-display.js").read_text(encoding="utf-8")
    service = (root / "app" / "services" / "records.py").read_text(encoding="utf-8")
    assert "function slittingMachineAttainmentTrend(rows, dates)" in source
    assert "Cumulative downtime by machine / 各机台累计停机时间" in source
    assert "machine-stacked-bar" in source
    assert "machine-downtime-legend" in source
    assert "machine-segment-label" in source
    assert "Daily downtime by category / 每日各类别停机时间" in source
    assert "item.categories[category.type]" in source
    assert '"machine": row["machine_code"]' in service


def test_slitting_report_compares_machine_attainment_and_uses_abnormality_pivot():
    root = Path(__file__).parents[1]
    source = (root / "app" / "static" / "slitting.js").read_text(encoding="utf-8")
    service = (root / "app" / "services" / "records.py").read_text(encoding="utf-8")
    template = (root / "app" / "templates" / "dashboard.html").read_text(encoding="utf-8")
    assert "function slittingPlanAttainmentComparison(rows, dates, selectedMachine = '')" in source
    assert "function slittingAbnormalityPivot(rows, selectedMachine = '')" in source
    assert "Machine performance and four-week abnormality summary" in template
    assert "Seven-day plan attainment by machine" in source
    assert "dates = dates.slice(-7)" in source
    assert "chartDates.length-1" in source
    assert "DATE_SUB(%s, INTERVAL 27 DAY)" in service
    assert '"abnormality_trends"' in service
    assert '"production_trends"' in service
    assert '"trend_dates"' in service
    assert "Cumulative abnormality pivot" in source
    assert "machine-point-label" in (root / "app" / "static" / "slitting-display.js").read_text(encoding="utf-8")


def test_slurry_display_uses_conditional_content_rows():
    root = Path(__file__).parents[1]
    source = (root / "app" / "static" / "display.js").read_text(encoding="utf-8")
    template = (root / "app" / "templates" / "public_display.html").read_text(encoding="utf-8")
    source_compact = compact(source)
    assert 'data-display-block="reminders"' in template
    assert "function arrangeSlurryRows" in source
    assert "companions.length===0?4" in source_compact
    assert "task.dataset.fullRow=String(companions.length===0)" in source_compact
    assert "conststatusBlocks=[rates,pending]" in source_compact
    assert "conststatusWidths=statusBlocks.length===2?[1,3]:[4]" in source_compact
    assert "ongoing.style.gridRow='3'" in source_compact
    assert "constwidths=visuals.length===2?[2,2]:[4]" in source_compact
    assert "No pending records until" in source
    assert "No unresolved events until" in source


def test_slitting_pending_uses_separate_full_width_row():
    root = Path(__file__).parents[1]
    source = (root / "app" / "static" / "slitting-display.js").read_text(encoding="utf-8")
    stylesheet = (root / "app" / "static" / "display.css").read_text(encoding="utf-8")
    template = (root / "app" / "templates" / "slitting_display.html").read_text(encoding="utf-8")
    source_compact = compact(source)
    assert "function arrangeSlittingContentRows" in source
    assert "taskWidth=companions.length===0?4" in source_compact
    assert "pendingSection.style.gridRow='2'" in source_compact
    assert "pendingSection.style.gridColumn='1/-1'" in source_compact
    assert "eventsSection.style.gridRow='3'" in source_compact
    assert "constvisualWidths=visuals.length===2?[2,2]:[4]" in source_compact
    assert (
        '[data-display-block="slitting_pending_qualification"] .pending-qualification-list{grid-template-columns:repeat(4,minmax(0,1fr))'
        in stylesheet
    )
    assert ".slitting-event-grid{display:grid;grid-template-columns:repeat(4" in stylesheet
    assert "display.css?v=20261015-point-labels" in template
    assert "No pending records until" in source
    assert "No unresolved events until" in source
    assert "slitting-display.js?v=20261015-point-labels" in template
    assert "TV_LAYOUT_WIDTH" not in source


def test_task_editor_defaults_to_current_shift_and_canvas_is_hidden():
    root = Path(__file__).parents[1]
    source = (root / "app" / "static" / "app.js").read_text(encoding="utf-8")
    dashboard = (root / "app" / "templates" / "dashboard.html").read_text(encoding="utf-8")
    assert "function currentTaskSlot" in source
    assert "constslot=currentTaskSlot()" in compact(source)
    assert "function nextPlanningSlot" not in source
    assert "Display canvas / 看板画布" not in dashboard
    assert 'id="display-layout-preview" hidden' in dashboard
    assert 'id="quick-add-attendance-record"' not in dashboard


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
    monkeypatch.setattr(
        records.slitting,
        "machine_choices",
        lambda form_key="production": [
            {"value": machine, "label": machine} for machine in records.slitting.MACHINES
        ],
    )
    payload = {
        "task_items": [
            {
                "type": "slitting_production",
                "product_item": "88.8MM",
                "production_status": "production_in_progress",
                "production_target": 150,
                "target_unit": "sr",
                "custom_unit": "",
            },
            {
                "type": "slitting_schedule",
                "machine": "FX4",
                "product_item": "88.8 mm",
                "planned_input": "150 sr",
                "operator": "Operator A",
                "shift_lead": "Lead A",
            },
        ],
        "reminders": [],
    }
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
    monkeypatch.setattr(
        records.slitting,
        "machine_choices",
        lambda form_key="production": [
            {"value": machine, "label": machine} for machine in records.slitting.MACHINES
        ],
    )
    payload = {
        "task_items": [
            {
                "type": "slitting_production",
                "product_item": "CUSTOM",
                "custom_product_item": "Cleaning",
                "production_status": "production_in_progress",
                "production_target": 2,
                "target_unit": "custom",
                "custom_unit": "hours",
            },
            {
                "type": "slitting_schedule",
                "machine": "FX4",
                "product_item": "CUSTOM",
                "custom_product_item": "Cleaning",
                "planned_input": "2 hours",
                "operator": "Operator A",
                "shift_lead": "Lead A",
            },
            {
                "type": "slitting_training",
                "training_item": "Safety",
                "training_type": "Hands-on",
                "subject": "Night shift operators",
                "time": "9:00-10:00",
            },
        ],
        "reminders": [],
    }
    with Flask(__name__).app_context(), department_context("slitting"):
        records.save_daily_task(payload, actor_id=2)
    saved_items = __import__("json").loads(executed[0][1][3])
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
    payload = {
        "task_items": [
            {
                "type": "slitting_training",
                "training_item": "Safety",
                "training_type": "Classroom",
                "subject": "FX operators",
                "time": "10:00",
            }
        ],
        "reminders": [],
    }
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
                {
                    "key": "text_12345678",
                    "type": "static_text",
                    "title": "Safety",
                    "content": "Check guards",
                    "heading_level": "h1",
                    "visible": True,
                    "order": 90,
                    "width": 9,
                    "height": 9,
                    "font_size": 16,
                },
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
        defaults["blocks"].append(
            {
                "key": "text_12345678",
                "type": "static_text",
                "title": "Safety",
                "content": "",
                "heading_level": "h3",
                "visible": True,
                "order": 90,
                "width": 1,
                "height": 1,
            }
        )
        with pytest.raises(ValueError, match="Heading 1 or Heading 2"):
            records.save_display_settings(defaults)

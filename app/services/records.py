import hashlib
import json
import re
from datetime import date, datetime, timedelta
from uuid import UUID, uuid4

from flask import current_app

from ..db import transaction
from .analysis import Analysis, analyse_abnormality, analyse_production


def _json_safe_rows(rows):
    """Convert MySQL TIME values to HH:MM before Flask returns JSON."""
    for row in rows:
        for key, value in row.items():
            if isinstance(value, timedelta):
                total_minutes = int(value.total_seconds() // 60)
                hours, minutes = divmod(total_minutes, 60)
                row[key] = f"{hours:02d}:{minutes:02d}"
            elif isinstance(value, datetime):
                row[key] = value.isoformat(sep=" ", timespec="seconds")
            elif isinstance(value, date):
                row[key] = value.isoformat()
    return rows

def _audit(cursor, actor_id, entity_type, entity_id, action, details):
    cursor.execute(
        """
        INSERT INTO audit_events (actor_id, entity_type, entity_id, action, details_json)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (actor_id, entity_type, entity_id, action, json.dumps(details)),
    )


def _sync_identity(payload, source_type):
    client_record_id = str(payload.get("client_record_id") or uuid4())
    try:
        UUID(client_record_id)
    except ValueError as exc:
        raise ValueError("client_record_id must be a UUID.") from exc

    normalized = dict(payload)
    normalized["client_record_id"] = client_record_id
    payload_json = json.dumps(normalized, sort_keys=True, separators=(",", ":"))
    return client_record_id, hashlib.sha256(payload_json.encode()).hexdigest()


def _existing_sync(cursor, source_type, client_record_id, payload_hash):
    cursor.execute(
        """
        SELECT server_record_id, payload_hash
        FROM system_import.sync_receipts
        WHERE source_type = %s AND client_record_id = %s
        """,
        (source_type, client_record_id),
    )
    receipt = cursor.fetchone()
    if receipt and receipt["payload_hash"] != payload_hash:
        raise ValueError("The same offline record ID was submitted with different data.")
    return receipt["server_record_id"] if receipt else None


def create_production(payload, actor_id=None):
    payload = {**payload, "record_date": date.today().isoformat()}
    planned, actual = (float(payload[key]) for key in ("planned_quantity", "actual_quantity"))
    raw_qualified = str(payload.get("qualified_quantity", "")).strip()
    qualified = float(raw_qualified) if raw_qualified else None
    qualified_pending = qualified is None
    if qualified is not None and qualified > actual or actual < 0 or planned < 0:
        raise ValueError(
            "Quantities are invalid: planned and actual must be non-negative, "
            "qualified cannot exceed actual."
        )
    analysis = (
        analyse_production(planned, actual, qualified, current_app.config["LOW_YIELD_THRESHOLD"])
        if qualified is not None
        else Analysis("normal", "normal", "Qualified quantity is pending follow-up.", {"qualified_pending": True})
    )
    achievement_rate = actual / planned if planned > 0 else None
    qualified_rate = qualified / actual if qualified is not None and actual > 0 else None

    formula_code = str(payload["formula_code"]).strip().upper()
    if not formula_code:
        raise ValueError("Choose a formula or enter a custom formula.")
    payload = {**payload, "formula_code": formula_code}
    client_record_id, payload_hash = _sync_identity(payload, "production")
    with transaction() as cursor:
        replay_id = _existing_sync(cursor, "production", client_record_id, payload_hash)
        if replay_id:
            return replay_id, analysis
        cursor.execute(
            """
            SELECT id, qualified_pending, actual_quantity
            FROM system_import.production_records
            WHERE record_date = %s AND shift_name = %s AND machine_code = %s AND batch_number = %s
            """,
            (payload["record_date"], payload["shift_name"], payload["machine_code"], payload["batch_number"]),
        )
        existing = cursor.fetchone()
        if existing:
            if existing["qualified_pending"] and qualified is not None:
                existing_actual = float(existing["actual_quantity"])
                if qualified > existing_actual:
                    raise ValueError("Qualified quantity cannot exceed the saved actual quantity.")
                cursor.execute(
                    """
                    UPDATE system_import.production_records
                    SET qualified_quantity = %s, qualified_pending = FALSE,
                        qualified_rate = %s, row_version = row_version + 1
                    WHERE id = %s
                    """,
                    (qualified, qualified / existing_actual if existing_actual > 0 else None, existing["id"]),
                )
                _audit(cursor, actor_id, "production_record", existing["id"], "qualified_quantity_follow_up", {"qualified_quantity": qualified})
                return existing["id"], analysis
            raise ValueError(
                "This date, shift, machine, and batch already have a production record. "
                "Open Production records to add the qualified result if it is pending."
            )

        cursor.execute(
            """
            INSERT INTO system_import.production_records (
                record_date, shift_name, machine_code, formula_code, batch_number,
                planned_quantity, actual_quantity, qualified_quantity, qualified_pending, notes,
                achievement_rate, qualified_rate, created_by, custom_fields
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                payload["record_date"], payload["shift_name"], payload["machine_code"],
                formula_code, payload["batch_number"], planned, actual,
                qualified, qualified_pending, payload.get("notes", ""), achievement_rate, qualified_rate, actor_id,
                json.dumps(payload.get("custom_fields", {})),
            ),
        )
        record_id = cursor.lastrowid
        cursor.execute(
            """
            INSERT INTO system_import.sync_receipts
                (source_type, client_record_id, payload_hash, server_record_id)
            VALUES ('production', %s, %s, %s)
            """,
            (client_record_id, payload_hash, record_id),
        )
        _audit(cursor, actor_id, "production_record", record_id, "created_kiosk", payload)
        if analysis.status == "open":
            cursor.execute(
                """
                INSERT INTO exceptions_queue
                    (source_type, source_id, severity, summary, evidence_json)
                VALUES ('production', %s, %s, %s, %s)
                """,
                (record_id, analysis.severity, analysis.summary, json.dumps(analysis.evidence)),
            )
    return record_id, analysis


def update_production_qualification(record_id, payload, actor_id=None):
    try:
        qualified = float(payload["qualified_quantity"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Enter a valid qualified quantity.") from exc
    if qualified < 0:
        raise ValueError("Qualified quantity cannot be negative.")
    with transaction() as cursor:
        cursor.execute(
            "SELECT planned_quantity, actual_quantity FROM system_import.production_records WHERE id = %s",
            (record_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise ValueError("Production record not found.")
        actual = float(row["actual_quantity"])
        planned = float(row["planned_quantity"])
        if qualified > actual:
            raise ValueError("Qualified quantity cannot exceed actual quantity.")
        analysis = analyse_production(planned, actual, qualified, current_app.config["LOW_YIELD_THRESHOLD"])
        cursor.execute(
            """
            UPDATE system_import.production_records
            SET qualified_quantity = %s, qualified_pending = FALSE,
                qualified_rate = %s, row_version = row_version + 1
            WHERE id = %s
            """,
            (qualified, qualified / actual if actual > 0 else None, record_id),
        )
        _audit(cursor, actor_id, "production_record", record_id, "qualified_quantity_follow_up", {"qualified_quantity": qualified})
        if analysis.status == "open":
            cursor.execute(
                """
                INSERT INTO exceptions_queue (source_type, source_id, severity, summary, evidence_json)
                VALUES ('production', %s, %s, %s, %s)
                """,
                (record_id, analysis.severity, analysis.summary, json.dumps(analysis.evidence)),
            )
    return record_id


def create_abnormality(payload, actor_id=None):
    payload = {**payload, "event_date": date.today().isoformat()}
    time_pattern = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
    if not time_pattern.fullmatch(str(payload.get("start_time", ""))) or not time_pattern.fullmatch(str(payload.get("end_time", ""))):
        raise ValueError("Event time must use valid 24-hour values (HH:MM - HH:MM).")
    duration = int(payload["duration_minutes"])
    cost_failure_types = payload.get("cost_failure_types", [])
    if not isinstance(cost_failure_types, list):
        raise ValueError("Cost-failure types must be a list.")
    is_resolved = payload.get("is_resolved", "no")
    effective_time_cost = payload.get("effective_time_cost") or None
    machine_type = payload.get("machine_type")
    if is_resolved not in {"yes", "no"}:
        raise ValueError("Is resolved must be yes or no.")
    responsible_person = str(payload.get("responsible_person", "")).strip()
    target_finish_date = payload.get("target_finish_date") or None
    if is_resolved == "yes":
        target_finish_date = date.today().isoformat()
    if is_resolved == "no" and (not responsible_person or not target_finish_date):
        raise ValueError("Unresolved events require a responsible person and expected finish date.")
    if effective_time_cost not in {None, "yes", "no"}:
        raise ValueError("Effective time cost must be yes or no.")
    if machine_type not in {"semi", "auto"}:
        raise ValueError("Choose Semi / 半自动 or Auto / 全自动 machine type.")
    analysis = analyse_abnormality(
        payload["event_type"],
        payload["severity"],
        duration,
        payload.get("description", ""),
    )
    if duration < 0:
        raise ValueError("Duration cannot be negative.")
    workflow_state = "resolved" if is_resolved == "yes" else "open"

    client_record_id, payload_hash = _sync_identity(payload, "abnormality")
    with transaction() as cursor:
        cursor.execute(
            "SELECT event_value FROM system_import.event_type_options WHERE is_active = TRUE"
        )
        active_event_types = {row["event_value"] for row in cursor.fetchall()}
        if payload["event_type"] not in active_event_types:
            raise ValueError("An invalid or inactive event type was supplied.")
        cursor.execute(
            "SELECT type_code FROM system_import.cost_failure_types WHERE is_active = TRUE"
        )
        active_types = {row["type_code"] for row in cursor.fetchall()}
        if not set(cost_failure_types).issubset(active_types):
            raise ValueError("An invalid or inactive cost-failure type was supplied.")
        replay_id = _existing_sync(cursor, "abnormality", client_record_id, payload_hash)
        if replay_id:
            return replay_id, analysis

        cursor.execute(
            """
            INSERT INTO system_import.abnormality_reports (
                event_date, start_time, end_time, shift_name, machine_code, machine_type, event_type, severity,
                duration_minutes, description, immediate_action, reported_by, custom_fields, state,
                is_resolved, effective_time_cost, cost_failure_types, responsible_person, target_finish_date
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                payload["event_date"], payload.get("start_time") or None, payload.get("end_time") or None,
                payload["shift_name"], payload["machine_code"], machine_type, payload["event_type"],
                payload["severity"], duration,
                payload.get("description", ""), payload.get("immediate_action", ""),
                actor_id, json.dumps(payload.get("custom_fields", {})), workflow_state, is_resolved,
                effective_time_cost, json.dumps(cost_failure_types), responsible_person or None, target_finish_date,
            ),
        )
        report_id = cursor.lastrowid
        cursor.execute(
            """
            INSERT INTO system_import.sync_receipts
                (source_type, client_record_id, payload_hash, server_record_id)
            VALUES ('abnormality', %s, %s, %s)
            """,
            (client_record_id, payload_hash, report_id),
        )
        _audit(cursor, actor_id, "abnormality_report", report_id, "created_kiosk", payload)
        if analysis.status == "open":
            cursor.execute(
                """
                INSERT INTO exceptions_queue
                    (source_type, source_id, severity, summary, evidence_json)
                VALUES ('abnormality', %s, %s, %s, %s)
                """,
                (report_id, analysis.severity, analysis.summary, json.dumps(analysis.evidence)),
            )
    return report_id, analysis


def list_records(record_type, manager=False, page=1, page_size=50, record_date=None, machine_code=None):
    queries = {
        "production": """
            SELECT id, record_date, shift_name, machine_code, formula_code, batch_number,
                   planned_quantity, actual_quantity, qualified_quantity, qualified_pending, custom_fields,
                   achievement_rate, qualified_rate, state, created_at
            FROM system_import.production_records
        """,
        "abnormality": """
            SELECT id, event_date, shift_name, machine_code, event_type, severity,
                   responsible_person, duration_minutes, description, immediate_action,
                   custom_fields, state, created_at
            FROM system_import.abnormality_reports
        """,
        "tracker": """
            SELECT id, event_date, shift_name, machine_code, machine_type, event_type, severity,
                   description, responsible_person, target_finish_date,
                   solution_provided, actual_finish_date, effectiveness, state
            FROM system_import.abnormality_reports
        """,
        "ongoing": """
            SELECT id, event_date, start_time, end_time, shift_name, machine_code, machine_type, event_type,
                   severity, is_resolved, effective_time_cost, solution_provided,
                   cost_failure_types, responsible_person, target_finish_date,
                   actual_finish_date, state, created_at
            FROM system_import.abnormality_reports
        """,
        "analysis": """
            SELECT source_type, source_id, severity, summary, evidence_json, status, created_at
            FROM exceptions_queue
        """,
    }
    table_map = {
        "production": "system_import.production_records",
        "abnormality": "system_import.abnormality_reports",
        "tracker": "system_import.abnormality_reports",
        "ongoing": "system_import.abnormality_reports",
        "analysis": "exceptions_queue",
    }
    order_by = {
        "production": "created_at DESC",
        "abnormality": "created_at DESC",
        "tracker": "state ASC, target_finish_date ASC, created_at DESC",
        "ongoing": "event_date DESC, start_time DESC, created_at DESC",
        "analysis": "status ASC, created_at DESC",
    }
    conditions, params = [], []
    if record_type == "ongoing":
        conditions.append("is_resolved = 'no'")
    if record_type != "analysis" and record_date:
        conditions.append("record_date = %s" if record_type == "production" else "event_date = %s")
        params.append(record_date)
    if record_type != "analysis" and machine_code:
        conditions.append("machine_code = %s")
        params.append(machine_code)
    where_clause = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    offset = (page - 1) * page_size
    with transaction() as cursor:
        cursor.execute(
            f"SELECT COUNT(*) AS total FROM {table_map[record_type]}{where_clause}",
            params,
        )
        total = cursor.fetchone()["total"]
        cursor.execute(
            f"{queries[record_type]}{where_clause} ORDER BY {order_by[record_type]} LIMIT %s OFFSET %s",
            [*params, page_size, offset],
        )
        rows = cursor.fetchall()

    if record_type == "tracker" and not manager:
        for row in rows:
            row.pop("solution_provided", None)
    return _json_safe_rows(rows), total


def update_tracker(report_id, payload, manager=False):
    operator_fields = {"responsible_person", "target_finish_date", "actual_finish_date", "solution_provided"}
    manager_fields = operator_fields | {"solution_provided", "effectiveness", "state"}
    permitted_fields = manager_fields if manager else operator_fields
    changes = {key: value for key, value in payload.items() if key in permitted_fields}
    if not changes:
        raise ValueError("No permitted tracker fields supplied.")

    if not manager:
        with transaction() as cursor:
            cursor.execute(
                "SELECT state, is_resolved FROM system_import.abnormality_reports WHERE id = %s",
                (report_id,),
            )
            row = cursor.fetchone()
            if not row or row["state"] != "open" or row["is_resolved"] != "no":
                raise ValueError("Only unresolved open events can be updated from the ongoing tracker.")
        has_finish = bool(str(changes.get("actual_finish_date", "")).strip())
        has_solution = bool(str(changes.get("solution_provided", "")).strip())
        if not (has_finish and has_solution):
            raise ValueError("Enter both actual finish date and solution provided to close this event.")
        changes.update({"is_resolved": "yes", "state": "resolved"})

    if changes.get("state") == "resolved" and not changes.get("solution_provided"):
        raise ValueError("Manager resolution requires a documented solution.")

    assignments = ", ".join(f"{key} = %s" for key in changes)
    with transaction() as cursor:
        cursor.execute(
            f"""
            UPDATE system_import.abnormality_reports
            SET {assignments}, row_version = row_version + 1
            WHERE id = %s
            """,
            (*changes.values(), report_id),
        )
        if cursor.rowcount != 1:
            raise ValueError("Abnormality report not found.")
        _audit(cursor, None, "abnormality_report", report_id, "tracker_updated", changes)
    return {"closed": changes.get("state") == "resolved", "id": report_id}


def get_field_definitions(form_key, include_inactive=False):
    active_clause = "" if include_inactive else "AND is_active = TRUE"
    with transaction() as cursor:
        cursor.execute(
            f"""
            SELECT field_key, label, input_type, options_json, is_required, display_order
            FROM system_import.field_definitions
            WHERE form_key = %s {active_clause}
              AND NOT (form_key = 'production' AND field_key = 'work_order')
            ORDER BY display_order
            """,
            (form_key,),
        )
        return cursor.fetchall()


STANDARD_FIELD_CATALOG = {
    "production": [
        ("shift_name", "Shift / 班次", "select"),
        ("machine_code", "Machine / 设备", "select"),
        ("formula_code", "Formula / 配方", "select"),
        ("batch_number", "Batch number / 批次号", "text"),
        ("planned_quantity", "Planned quantity / 计划数量", "number"),
        ("actual_quantity", "Actual quantity / 实际数量", "number"),
        ("qualified_quantity", "Qualified quantity / 合格数量", "number"),
        ("notes", "Notes / 备注", "textarea"),
    ],
    "abnormality": [
        ("event_time", "Event time / 事件时间", "time_range"),
        ("shift_name", "Shift / 班次", "select"),
        ("machine_code", "Machine / 设备", "select"),
        ("machine_type", "Process type / 工艺类型", "select"),
        ("event_type", "Event type / 事件类型", "select"),
        ("severity", "Severity | Priority / 严重程度 | 优先级", "select"),
        ("is_resolved", "Is it resolved? / 是否已解决", "select"),
        ("responsible_person", "Responsible person / 责任人", "text"),
        ("target_finish_date", "Expected finish date / 预计完成日期", "date"),
        ("effective_time_cost", "是否为有效时间成本 / Effective time cost?", "select"),
        ("description", "What happened? / 发生了什么？", "textarea"),
        ("immediate_action", "Immediate action / 立即措施", "textarea"),
        ("actual_finish_date", "Actual finish date / 实际完成日期", "date"),
        ("solution_provided", "Solution provided / 解决方案", "textarea"),
    ],
}

# Stored as value|bilingual display text so manager edits keep the database value stable.
STANDARD_FIELD_OPTIONS = {
    ("production", "shift_name"): ["Day|Day / 白班", "Night|Night / 夜班"],
    ("production", "machine_code"): [item for item in ("J1", "J2", "J3", "J4", "J5", "J6", "J7", "J8", "J9", "J10-1", "J10-2", "J10-3", "J10-4", "J10-5")],
    ("production", "formula_code"): ["K1-26", "B1-1", "E3", "custom|Custom / 自定义"],
    ("abnormality", "shift_name"): ["Day|Day / 白班", "Night|Night / 夜班"],
    ("abnormality", "machine_code"): [item for item in ("J1", "J2", "J3", "J4", "J5", "J6", "J7", "J8", "J9", "J10-1", "J10-2", "J10-3", "J10-4", "J10-5", "NA|NA / 不适用")],
    ("abnormality", "machine_type"): ["semi|Semi / 半自动", "auto|Auto / 全自动"],
    ("abnormality", "severity"): ["normal|Normal / 正常", "low|Low / 低", "medium|Medium / 中", "high|High / 高"],
    ("abnormality", "is_resolved"): ["no|No / 否", "yes|Yes / 是"],
    ("abnormality", "effective_time_cost"): ["no|No / 否", "yes|Yes / 是"],
}


def get_standard_field_settings(form_key):
    if form_key not in STANDARD_FIELD_CATALOG:
        raise ValueError("Unknown form.")
    with transaction() as cursor:
        cursor.execute(
            "SELECT field_key, label, help_text, options_json FROM system_import.standard_field_settings WHERE form_key = %s",
            (form_key,),
        )
        saved = {row["field_key"]: row for row in cursor.fetchall()}
    return [
        {
            "field_key": key,
            "label": saved.get(key, {}).get("label") or label,
            "help_text": saved.get(key, {}).get("help_text") or "",
            "input_type": input_type,
            "options_json": saved.get(key, {}).get("options_json") if saved.get(key, {}).get("options_json") is not None else STANDARD_FIELD_OPTIONS.get((form_key, key), []),
            "is_configured": key in saved,
        }
        for key, label, input_type in STANDARD_FIELD_CATALOG[form_key]
    ]


def save_standard_field_setting(form_key, payload):
    valid = {key for key, _, _ in STANDARD_FIELD_CATALOG.get(form_key, [])}
    field_key = str(payload.get("field_key", "")).strip()
    label = str(payload.get("label", "")).strip()
    if field_key not in valid or not label:
        raise ValueError("Choose a standard field and provide a bilingual label.")
    help_text = str(payload.get("help_text", "")).strip()
    options = payload.get("options", [])
    if not isinstance(options, list):
        raise ValueError("Options must be a list.")
    with transaction() as cursor:
        cursor.execute(
            """
            INSERT INTO system_import.standard_field_settings
                (form_key, field_key, label, help_text, options_json)
            VALUES (%s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE label = VALUES(label), help_text = VALUES(help_text),
                options_json = VALUES(options_json)
            """,
            (form_key, field_key, label, help_text or None, json.dumps(options) if options else None),
        )
        _audit(cursor, None, "standard_field_setting", 0, "saved", {"form_key": form_key, "field_key": field_key})


def get_cost_failure_types(include_inactive=False):
    query = "SELECT type_code, display_name, definition, is_active FROM system_import.cost_failure_types"
    if not include_inactive:
        query += " WHERE is_active = TRUE"
    query += " ORDER BY display_name"
    with transaction() as cursor:
        cursor.execute(query)
        return cursor.fetchall()


def get_event_types(include_inactive=False):
    query = "SELECT event_value, display_name, is_active FROM system_import.event_type_options"
    if not include_inactive:
        query += " WHERE is_active = TRUE"
    query += " ORDER BY display_order, display_name"
    with transaction() as cursor:
        cursor.execute(query)
        return cursor.fetchall()


def save_event_type(payload):
    event_value = str(payload.get("event_value", "")).strip()
    display_name = str(payload.get("display_name", "")).strip()
    if not event_value or not display_name or len(event_value) > 80:
        raise ValueError("Event value and bilingual display name are required.")
    with transaction() as cursor:
        cursor.execute(
            """
            INSERT INTO system_import.event_type_options (event_value, display_name, display_order)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE display_name = VALUES(display_name),
                display_order = VALUES(display_order), is_active = TRUE
            """,
            (event_value, display_name, int(payload.get("display_order", 100))),
        )
        _audit(cursor, None, "event_type_option", 0, "saved", {"event_value": event_value})


def deactivate_event_type(event_value):
    with transaction() as cursor:
        cursor.execute(
            "UPDATE system_import.event_type_options SET is_active = FALSE WHERE event_value = %s",
            (event_value,),
        )
        if cursor.rowcount != 1:
            raise ValueError("Event type not found.")
        _audit(cursor, None, "event_type_option", 0, "deactivated", {"event_value": event_value})


def save_cost_failure_type(payload):
    type_code = str(payload.get("type_code", "")).strip().lower().replace(" ", "_")
    display_name = str(payload.get("display_name", "")).strip()
    definition = str(payload.get("definition", "")).strip()
    if not type_code.replace("_", "").isalnum() or not display_name or not definition:
        raise ValueError("Type code, display name, and definition are required.")
    with transaction() as cursor:
        cursor.execute(
            """
            INSERT INTO system_import.cost_failure_types (type_code, display_name, definition)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE
                display_name = VALUES(display_name),
                definition = VALUES(definition),
                is_active = TRUE
            """,
            (type_code, display_name, definition),
        )
        _audit(cursor, None, "cost_failure_type", 0, "saved", {"type_code": type_code})


def deactivate_cost_failure_type(type_code):
    with transaction() as cursor:
        cursor.execute(
            "UPDATE system_import.cost_failure_types SET is_active = FALSE WHERE type_code = %s",
            (type_code,),
        )
        if cursor.rowcount != 1:
            raise ValueError("Cost-failure type not found.")
        _audit(cursor, None, "cost_failure_type", 0, "deactivated", {"type_code": type_code})


def save_field_definition(form_key, payload):
    valid_types = {"text", "number", "date", "select", "textarea"}
    if form_key not in {"production", "abnormality"} or payload.get("input_type") not in valid_types:
        raise ValueError("Invalid form or input type.")

    key = str(payload.get("field_key", "")).strip().lower().replace(" ", "_")
    if form_key == "production" and key == "work_order":
        raise ValueError("Work order is retired and cannot be added back to the production form.")
    if not key.replace("_", "").isalnum() or not key:
        raise ValueError("Field key may contain letters, numbers, and underscores only.")

    options = payload.get("options", [])
    with transaction() as cursor:
        cursor.execute(
            """
            INSERT INTO system_import.field_definitions (
                form_key, field_key, label, input_type, options_json, is_required, display_order
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                label = VALUES(label),
                input_type = VALUES(input_type),
                options_json = VALUES(options_json),
                is_required = VALUES(is_required),
                display_order = VALUES(display_order),
                is_active = TRUE
            """,
            (
                form_key, key, payload.get("label", key), payload["input_type"],
                json.dumps(options), bool(payload.get("is_required", False)),
                int(payload.get("display_order", 200)),
            ),
        )
        _audit(cursor, None, "field_definition", 0, "saved", {"form_key": form_key, "field_key": key})


def manager_dashboard():
    with transaction() as cursor:
        cursor.execute(
            """
            SELECT COUNT(*) AS records, COALESCE(SUM(actual_quantity), 0) AS actual,
                   COALESCE(SUM(qualified_quantity), 0) AS qualified
            FROM system_import.production_records
            WHERE record_date = CURDATE()
            """
        )
        production = cursor.fetchone()
        cursor.execute(
            """
            SELECT COUNT(*) AS open_events, COALESCE(SUM(duration_minutes), 0) AS downtime
            FROM system_import.abnormality_reports
            WHERE event_date = CURDATE() AND state = 'open'
            """
        )
        abnormality = cursor.fetchone()
        cursor.execute(
            """
            SELECT machine_code, COUNT(*) AS event_count,
                   COALESCE(SUM(duration_minutes), 0) AS downtime
            FROM system_import.abnormality_reports
            WHERE event_date >= CURDATE() - INTERVAL 30 DAY
            GROUP BY machine_code
            ORDER BY downtime DESC LIMIT 5
            """
        )
        machines = cursor.fetchall()

    actual = float(production["actual"] or 0)
    qualified = float(production["qualified"] or 0)
    return {
        "today_records": production["records"],
        "today_yield": round(qualified / actual * 100, 1) if actual else None,
        "open_events": abnormality["open_events"],
        "downtime_minutes": int(abnormality["downtime"] or 0),
        "machines": machines,
    }


DAILY_TASK_TYPES = {"production", "cleaning", "custom"}
DAILY_TASK_MACHINES = {*(f"J{number}" for number in range(1, 10)), *(f"J10-{number}" for number in range(1, 6))}


def _legacy_task_items(task):
    """Map the former one-row task format to repeatable items without losing data."""
    types = json.loads(task.get("task_types") or "[]")
    items = []
    for task_type in types:
        item = {"type": task_type, "description": ""}
        if task_type == "production":
            item.update({"formula_code": task.get("formula_code") or "", "amount_needed": task.get("amount_needed"), "machine_assigned": task.get("machine_assigned") or ""})
        elif task_type == "custom":
            item["description"] = task.get("custom_task") or ""
        items.append(item)
    return items


def get_daily_task(record_date=None):
    """Return one display-safe daily task; absent tasks are represented explicitly."""
    selected_date = record_date or date.today()
    with transaction() as cursor:
        cursor.execute(
            """
            SELECT record_date, task_types, task_items, reminders, custom_task, formula_code, amount_needed, machine_assigned, updated_at
            FROM system_import.daily_tasks WHERE record_date = %s
            """,
            (selected_date,),
        )
        task = cursor.fetchone()
    if not task:
        return {"record_date": selected_date.isoformat(), "task_items": [], "reminders": [], "updated_at": None}
    task["task_items"] = json.loads(task["task_items"] or "null") or _legacy_task_items(task)
    task["reminders"] = json.loads(task["reminders"] or "[]")
    return _json_safe_rows([task])[0]


def save_daily_task(payload, actor_id=None):
    """Save an employee-entered task for today's shared display."""
    raw_items = payload.get("task_items", [])
    if not isinstance(raw_items, list) or not raw_items or len(raw_items) > 20:
        raise ValueError("Add between one and twenty task items.")
    raw_reminders = payload.get("reminders", [])
    if not isinstance(raw_reminders, list) or len(raw_reminders) > 12:
        raise ValueError("Add up to twelve reminder items.")
    reminders = []
    for reminder in raw_reminders:
        clean_reminder = str(reminder).strip()
        if clean_reminder:
            if len(clean_reminder) > 300:
                raise ValueError("Each reminder must be 300 characters or fewer.")
            reminders.append(clean_reminder)

    task_items = []
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            raise ValueError("Each task item must be valid.")
        task_type = str(raw_item.get("type", "")).strip().lower()
        if task_type not in DAILY_TASK_TYPES:
            raise ValueError("Choose a valid task type for every item.")
        item = {"type": task_type, "description": str(raw_item.get("description", "")).strip()}
        if task_type == "custom" and not item["description"]:
            raise ValueError("Custom tasks require a description.")
        if task_type == "cleaning":
            process_type = str(raw_item.get("process_type", "")).strip().lower()
            if process_type not in {"semi", "auto"}:
                raise ValueError("Each cleaning task requires Semi / 半自动 or Auto / 全自动.")
            item["process_type"] = process_type
        if task_type == "production":
            formula_code = str(raw_item.get("formula_code", "")).strip().upper()
            machine_assigned = str(raw_item.get("machine_assigned", "")).strip().upper()
            if not formula_code:
                raise ValueError("Each production task requires a formula.")
            if machine_assigned not in DAILY_TASK_MACHINES:
                raise ValueError("Choose a machine for every production task.")
            try:
                amount_needed = float(raw_item.get("amount_needed"))
            except (TypeError, ValueError) as exc:
                raise ValueError("Each production task requires a valid tank amount.") from exc
            if amount_needed < 0:
                raise ValueError("Tank amount cannot be negative.")
            item.update({"formula_code": formula_code, "amount_needed": amount_needed, "machine_assigned": machine_assigned})
        task_items.append(item)

    task_types = [item["type"] for item in task_items]
    first_production = next((item for item in task_items if item["type"] == "production"), {})
    first_custom = next((item for item in task_items if item["type"] == "custom"), {})

    with transaction() as cursor:
        cursor.execute(
            """
            INSERT INTO system_import.daily_tasks
                (record_date, task_types, task_items, reminders, custom_task, formula_code, amount_needed, machine_assigned, updated_by)
            VALUES (CURDATE(), %s, %s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                task_types = VALUES(task_types), task_items = VALUES(task_items), reminders = VALUES(reminders), custom_task = VALUES(custom_task),
                formula_code = VALUES(formula_code), amount_needed = VALUES(amount_needed),
                machine_assigned = VALUES(machine_assigned),
                updated_by = VALUES(updated_by)
            """,
            (json.dumps(task_types), json.dumps(task_items), json.dumps(reminders), first_custom.get("description") or None,
             first_production.get("formula_code"), first_production.get("amount_needed"), first_production.get("machine_assigned"), actor_id),
        )
        _audit(cursor, actor_id, "daily_task", 0, "saved", {"task_types": task_types, "item_count": len(task_items), "reminder_count": len(reminders)})


def daily_report(record_date):
    try:
        selected_date = date.fromisoformat(record_date)
    except (TypeError, ValueError) as exc:
        raise ValueError("Choose a valid report date.") from exc

    with transaction() as cursor:
        cursor.execute(
            """
            SELECT shift_name, machine_code, formula_code, batch_number,
                   planned_quantity, actual_quantity, qualified_quantity,
                   achievement_rate, qualified_rate
            FROM system_import.production_records
            WHERE record_date = %s
            ORDER BY shift_name, machine_code, batch_number
            LIMIT 20
            """,
            (selected_date,),
        )
        production = cursor.fetchall()
        cursor.execute(
            """
            SELECT machine_type,
                   CONCAT(COALESCE(TIME_FORMAT(start_time, '%H:%i'), '—'), ' - ',
                          COALESCE(TIME_FORMAT(end_time, '%H:%i'), '—')) AS event_time,
                   event_type, description, is_resolved, responsible_person,
                   target_finish_date, actual_finish_date
            FROM system_import.abnormality_reports
            WHERE event_date = %s
            ORDER BY start_time, machine_code
            LIMIT 20
            """,
            (selected_date,),
        )
        events = cursor.fetchall()
    return {
        "report_date": record_date,
        "production": _json_safe_rows(production),
        "events": _json_safe_rows(events),
    }


def public_display_summary(record_date=None):
    """Safe display summary: today task, last production day, cumulative machines."""
    try:
        selected_date = date.fromisoformat(record_date) if record_date else date.today()
    except ValueError as exc:
        raise ValueError("Choose a valid display date.") from exc
    with transaction() as cursor:
        cursor.execute(
            """
            SELECT record_date, task_types, task_items, reminders, custom_task, formula_code, amount_needed, machine_assigned, updated_at
            FROM system_import.daily_tasks WHERE record_date = CURDATE()
            """
        )
        daily_task = cursor.fetchone()
        cursor.execute(
            """
            SELECT record_date, COUNT(*) AS record_count, COALESCE(SUM(planned_quantity), 0) AS planned,
                   COALESCE(SUM(actual_quantity), 0) AS actual,
                   COALESCE(SUM(qualified_quantity), 0) AS qualified,
                   COALESCE(SUM(qualified_pending), 0) AS qualified_pending,
                   MAX(updated_at) AS latest_production_update
            FROM system_import.production_records
            GROUP BY record_date
            ORDER BY record_date DESC
            LIMIT 1
            """,
        )
        production = cursor.fetchone()
        cursor.execute(
            """
            SELECT COUNT(*) AS total, COALESCE(SUM(state = 'open'), 0) AS open_events,
                   COALESCE(SUM(is_resolved = 'yes'), 0) AS resolved_events,
                   MAX(updated_at) AS latest_event_update
            FROM system_import.abnormality_reports WHERE event_date = %s
            """,
            (selected_date,),
        )
        events = cursor.fetchone()
        cursor.execute(
            """
            SELECT machine_code, COALESCE(SUM(planned_quantity), 0) AS planned,
                   COALESCE(SUM(actual_quantity), 0) AS actual,
                   COALESCE(SUM(qualified_pending), 0) AS pending
            FROM system_import.production_records
            GROUP BY machine_code ORDER BY machine_code
            """,
        )
        machines = cursor.fetchall()
        cursor.execute(
            """
            SELECT machine_code, COUNT(*) AS event_count, COALESCE(SUM(state = 'open'), 0) AS open_count
            FROM system_import.abnormality_reports
            GROUP BY machine_code
            """,
        )
        event_by_machine = {row["machine_code"]: row for row in cursor.fetchall()}
        cursor.execute(
            """
            SELECT machine_code, machine_type, event_type, severity, is_resolved, state,
                   start_time, end_time, responsible_person, target_finish_date
            FROM system_import.abnormality_reports
            WHERE event_date = %s
            ORDER BY start_time, created_at
            LIMIT 12
            """,
            (selected_date,),
        )
        event_tracker = cursor.fetchall()
        cursor.execute(
            """
            SELECT id, event_date, machine_code, event_type, severity,
                   responsible_person, target_finish_date
            FROM system_import.abnormality_reports
            WHERE is_resolved = 'no'
            ORDER BY event_date DESC, start_time DESC, created_at DESC
            LIMIT 8
            """
        )
        ongoing_events = cursor.fetchall()

    if daily_task:
        daily_task["task_items"] = json.loads(daily_task["task_items"] or "null") or _legacy_task_items(daily_task)
        daily_task["reminders"] = json.loads(daily_task["reminders"] or "[]")
        task_updated = daily_task["updated_at"]
    else:
        daily_task = {"record_date": date.today().isoformat(), "task_items": [], "reminders": [], "updated_at": None}
        task_updated = None
    if not production:
        production = {"record_date": None, "record_count": 0, "planned": 0, "actual": 0, "qualified": 0, "qualified_pending": 0, "latest_production_update": None}

    for row in machines:
        event_row = event_by_machine.get(row["machine_code"], {})
        row["event_count"] = event_row.get("event_count", 0)
        row["open_count"] = event_row.get("open_count", 0)
    planned, actual, qualified = (float(production[key] or 0) for key in ("planned", "actual", "qualified"))
    latest = max(
        (value for value in (task_updated, production["latest_production_update"], events["latest_event_update"]) if value is not None),
        default=None,
    )
    return {
        "display_date": selected_date.isoformat(),
        "daily_task": _json_safe_rows([daily_task])[0],
        "production": {
            "record_date": production["record_date"].isoformat() if production["record_date"] else None,
            "record_count": production["record_count"], "planned": planned, "actual": actual,
            "achievement_rate": round(actual / planned, 4) if planned else None,
            "qualified_rate": round(qualified / actual, 4) if actual and not production["qualified_pending"] else None,
            "qualified_pending": int(production["qualified_pending"] or 0),
        },
        "events": {"total": events["total"], "open": int(events["open_events"] or 0), "resolved": int(events["resolved_events"] or 0)},
        "machines": _json_safe_rows(machines),
        "event_tracker": _json_safe_rows(event_tracker),
        "ongoing_events": _json_safe_rows(ongoing_events),
        "last_updated": latest.isoformat(sep=" ", timespec="seconds") if latest else None,
    }


def manager_get_record(record_type, record_id):
    """Return one operational record for a manager-only correction screen."""
    table = {"production": "production_records", "abnormality": "abnormality_reports"}.get(record_type)
    if not table:
        raise ValueError("Unknown record type.")
    with transaction() as cursor:
        cursor.execute(f"SELECT * FROM system_import.{table} WHERE id = %s", (record_id,))
        row = cursor.fetchone()
    if not row:
        raise ValueError("Record not found.")
    return _json_safe_rows([row])[0]


def manager_update_record(record_type, record_id, payload, actor_id=None):
    """Manager corrections retain the original record date and write an audit event."""
    existing = manager_get_record(record_type, record_id)
    with transaction() as cursor:
        if record_type == "production":
            planned = float(payload.get("planned_quantity", existing["planned_quantity"]))
            actual = float(payload.get("actual_quantity", existing["actual_quantity"]))
            raw_qualified = str(payload.get("qualified_quantity", "")).strip()
            qualified = float(raw_qualified) if raw_qualified else None
            if planned < 0 or actual < 0 or (qualified is not None and (qualified < 0 or qualified > actual)):
                raise ValueError("Production quantities are invalid.")
            cursor.execute("""UPDATE system_import.production_records SET shift_name=%s, machine_code=%s, formula_code=%s, batch_number=%s,
                planned_quantity=%s, actual_quantity=%s, qualified_quantity=%s, qualified_pending=%s, notes=%s,
                achievement_rate=%s, qualified_rate=%s, row_version=row_version+1 WHERE id=%s""", (
                payload.get("shift_name", existing["shift_name"]), payload.get("machine_code", existing["machine_code"]),
                payload.get("formula_code", existing["formula_code"]), payload.get("batch_number", existing["batch_number"]), planned, actual,
                qualified, qualified is None, payload.get("notes", existing.get("notes") or ""), actual / planned if planned else None,
                qualified / actual if qualified is not None and actual else None, record_id))
        elif record_type == "abnormality":
            severity = str(payload.get("severity", existing["severity"])).lower()
            if severity not in {"normal", "low", "medium", "high"}:
                raise ValueError("Choose a valid severity or priority.")
            is_resolved = str(payload.get("is_resolved", existing["is_resolved"])).lower()
            if is_resolved not in {"yes", "no"}:
                raise ValueError("Resolved status must be yes or no.")
            cursor.execute("""UPDATE system_import.abnormality_reports SET start_time=%s, end_time=%s, shift_name=%s, machine_code=%s,
                machine_type=%s, event_type=%s, severity=%s, duration_minutes=%s, description=%s, immediate_action=%s,
                responsible_person=%s, target_finish_date=%s, actual_finish_date=%s, solution_provided=%s,
                effective_time_cost=%s, is_resolved=%s, state=%s, row_version=row_version+1 WHERE id=%s""", (
                payload.get("start_time") or None, payload.get("end_time") or None, payload.get("shift_name", existing["shift_name"]),
                payload.get("machine_code", existing["machine_code"]), payload.get("machine_type", existing["machine_type"]),
                payload.get("event_type", existing["event_type"]), severity, int(payload.get("duration_minutes", existing["duration_minutes"])),
                payload.get("description", existing.get("description") or ""), payload.get("immediate_action", existing.get("immediate_action") or ""),
                payload.get("responsible_person", existing.get("responsible_person") or ""), payload.get("target_finish_date") or None,
                payload.get("actual_finish_date") or None, payload.get("solution_provided", existing.get("solution_provided") or ""),
                payload.get("effective_time_cost") or None, is_resolved, "resolved" if is_resolved == "yes" else "open", record_id))
        else:
            raise ValueError("Unknown record type.")
        _audit(cursor, actor_id, f"{record_type}_record", record_id, "manager_corrected", payload)
    return manager_get_record(record_type, record_id)

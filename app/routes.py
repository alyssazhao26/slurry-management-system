import secrets
from functools import wraps
from hmac import compare_digest
from time import monotonic
from flask import Blueprint, current_app, jsonify, render_template, request, session

from .services.records import (
    create_abnormality,
    create_production,
    daily_report,
    deactivate_cost_failure_type,
    deactivate_event_type,
    get_cost_failure_types,
    get_event_types,
    get_field_definitions,
    get_standard_field_settings,
    list_records,
    manager_get_record,
    manager_update_record,
    manager_dashboard,
    public_display_summary,
    save_cost_failure_type,
    save_event_type,
    save_field_definition,
    save_standard_field_setting,
    save_daily_task,
    update_production_qualification,
    update_tracker,
)
from .services.backups import run_manual_backup

web = Blueprint("web", __name__)


def require_manager(fn):
    @wraps(fn)
    def inner(*args, **kwargs):
        if not session.get("manager_access"):
            return jsonify(error="Manager access required"), 403
        return fn(*args, **kwargs)

    return inner


@web.get("/")
def dashboard():
    return render_template("dashboard.html")

@web.get("/display")
def public_display():
    return render_template("public_display.html")

@web.get("/api/csrf")
def csrf_token():
    return jsonify(token=session["csrf_token"])

@web.post("/api/manager/login")
def manager_login():
    attempts = current_app.extensions["manager_login_attempts"]
    client_ip = request.remote_addr or "unknown"
    now = monotonic()
    window = current_app.config["MANAGER_LOGIN_WINDOW_SECONDS"]
    bucket = attempts[client_ip]
    while bucket and bucket[0] <= now - window:
        bucket.popleft()
    if len(bucket) >= current_app.config["MANAGER_LOGIN_MAX_ATTEMPTS"]:
        return jsonify(error="Too many manager PIN attempts. Wait five minutes and try again."), 429
    if not compare_digest(str((request.get_json() or {}).get("pin", "")), current_app.config["MANAGER_PIN"]):
        bucket.append(now)
        return jsonify(error="Invalid manager PIN"), 401
    attempts.pop(client_ip, None)
    session.clear()
    session["manager_access"] = True
    session["csrf_token"] = secrets.token_urlsafe(32)
    session.permanent = True
    return jsonify(ok=True, csrf_token=session["csrf_token"])

@web.post("/api/manager/logout")
def manager_logout():
    session.clear()
    return jsonify(ok=True)

@web.post("/api/production-records")
def production():
    try:
        record_id, _ = create_production(request.get_json() or {}, None)
        return jsonify(id=record_id, message="Production record submitted."), 201
    except (KeyError, ValueError) as exc:
        return jsonify(error=str(exc)), 400

@web.patch("/api/production-records/<int:record_id>/qualification")
def production_qualification(record_id):
    try:
        update_production_qualification(record_id, request.get_json() or {}, None)
        return jsonify(ok=True, message="Qualified quantity updated.")
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

@web.post("/api/abnormality-reports")
def abnormality():
    try:
        report_id, _ = create_abnormality(request.get_json() or {}, None)
        return jsonify(id=report_id, message="Abnormality report submitted."), 201
    except (KeyError, ValueError) as exc:
        return jsonify(error=str(exc)), 400

@web.post("/api/sync")
def sync_offline_queue():
    records = (request.get_json() or {}).get("records", [])
    if not isinstance(records, list) or not records or len(records) > current_app.config["SYNC_BATCH_LIMIT"]:
        return jsonify(error=f"Send between 1 and {current_app.config['SYNC_BATCH_LIMIT']} records per sync."), 400
    outcomes = []
    for item in records:
        try:
            source_type, payload = item["source_type"], item["payload"]
            if source_type == "production":
                record_id, _ = create_production(payload, None)
            elif source_type == "abnormality":
                record_id, _ = create_abnormality(payload, None)
            else:
                raise ValueError("Unknown source type.")
            outcomes.append(
                {
                    "local_id": item.get("local_id"),
                    "status": "accepted",
                    "server_record_id": record_id,
                }
            )
        except (KeyError, ValueError, TypeError) as exc:
            outcomes.append(
                {
                    "local_id": item.get("local_id") if isinstance(item, dict) else None,
                    "status": "rejected",
                    "error": str(exc),
                }
            )
    return jsonify(outcomes=outcomes)

@web.get("/api/records/<record_type>")
def records(record_type):
    if record_type not in {"production", "abnormality", "tracker", "ongoing", "analysis"}:
        return jsonify(error="Unknown record type"), 404
    if record_type == "analysis" and not session.get("manager_access"):
        return jsonify(error="Manager access required"), 403
    try:
        page = max(1, int(request.args.get("page", "1")))
        page_size = min(
            current_app.config["RECORDS_MAX_PAGE_SIZE"],
            max(1, int(request.args.get("page_size", current_app.config["RECORDS_PAGE_SIZE"]))),
        )
    except ValueError:
        return jsonify(error="Page and page size must be whole numbers."), 400
    rows, total = list_records(
        record_type,
        manager=session.get("manager_access", False),
        page=page,
        page_size=page_size,
        record_date=request.args.get("date") or None,
        machine_code=(request.args.get("machine") or "").strip() or None,
    )
    return jsonify(records=rows, page=page, page_size=page_size, total=total)

@web.get("/api/forms/<form_key>")
def form_definition(form_key):
    if form_key not in {"production", "abnormality"}:
        return jsonify(error="Unknown form"), 404
    return jsonify(fields=get_field_definitions(form_key))


@web.get("/api/forms/<form_key>/standard-fields")
def standard_form_definition(form_key):
    try:
        return jsonify(fields=get_standard_field_settings(form_key))
    except ValueError as exc:
        return jsonify(error=str(exc)), 404

@web.get("/api/manager/forms/<form_key>/fields")
def manager_form_definitions(form_key):
    if form_key not in {"production", "abnormality"}:
        return jsonify(error="Unknown form"), 404
    return jsonify(fields=get_field_definitions(form_key, include_inactive=True))


@web.get("/api/manager/forms/<form_key>/standard-fields")
def manager_standard_form_fields(form_key):
    try:
        return jsonify(fields=get_standard_field_settings(form_key))
    except ValueError as exc:
        return jsonify(error=str(exc)), 404

@web.get("/api/cost-failure-types")
def cost_failure_types():
    return jsonify(types=get_cost_failure_types())

@web.get("/api/event-types")
def event_types():
    return jsonify(types=get_event_types())

@web.get("/api/daily-report")
def report_for_date():
    try:
        return jsonify(daily_report(request.args.get("date")))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

@web.get("/api/public-display")
def public_display_data():
    try:
        return jsonify(public_display_summary(request.args.get("date") or None))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

@web.post("/api/daily-task")
def save_operator_daily_task():
    try:
        save_daily_task(request.get_json() or {})
        return jsonify(ok=True, message="Today's task saved.")
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

@web.post("/api/manager/cost-failure-types")
@require_manager
def save_cost_type():
    try:
        save_cost_failure_type(request.get_json() or {})
        return jsonify(ok=True, message="Cost-failure type saved.")
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

@web.delete("/api/manager/cost-failure-types/<type_code>")
@require_manager
def remove_cost_type(type_code):
    try:
        deactivate_cost_failure_type(type_code)
        return jsonify(ok=True, message="Cost-failure type deactivated.")
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

@web.post("/api/manager/event-types")
def save_event_type_option():
    try:
        save_event_type(request.get_json() or {})
        return jsonify(ok=True, message="Event type saved.")
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

@web.delete("/api/manager/event-types/<path:event_value>")
def remove_event_type(event_value):
    try:
        deactivate_event_type(event_value)
        return jsonify(ok=True, message="Event type deactivated.")
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

@web.post("/api/manager/forms/<form_key>/fields")
def configure_field(form_key):
    try:
        save_field_definition(form_key, request.get_json() or {})
        return jsonify(ok=True, message="Form field saved to system_import.field_definitions.")
    except ValueError as exc:
        return jsonify(error=str(exc)), 400


@web.post("/api/manager/forms/<form_key>/standard-fields")
def configure_standard_field(form_key):
    try:
        save_standard_field_setting(form_key, request.get_json() or {})
        return jsonify(ok=True, message="Standard field setting saved to system_import.standard_field_settings.")
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

@web.get("/api/manager/dashboard")
@require_manager
def dashboard_summary():
    return jsonify(manager_dashboard())


@web.post("/api/manager/backup")
@require_manager
def manager_backup():
    try:
        return jsonify(ok=True, message=run_manual_backup())
    except RuntimeError as exc:
        current_app.logger.warning("Manager-requested backup failed: %s", exc)
        return jsonify(error=str(exc)), 500


@web.get("/api/manager/records/<record_type>/<int:record_id>")
def manager_record(record_type, record_id):
    try:
        return jsonify(record=manager_get_record(record_type, record_id))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400


@web.patch("/api/manager/records/<record_type>/<int:record_id>")
def manager_record_update(record_type, record_id):
    try:
        return jsonify(ok=True, record=manager_update_record(record_type, record_id, request.get_json() or {}))
    except (TypeError, ValueError) as exc:
        return jsonify(error=str(exc)), 400

@web.patch("/api/abnormality-reports/<int:report_id>/tracker")
def tracker_update(report_id):
    try:
        result = update_tracker(report_id, request.get_json() or {}, manager=session.get("manager_access", False))
        return jsonify(ok=True, message="Event closed." if result["closed"] else "Tracker updated.", **result)
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

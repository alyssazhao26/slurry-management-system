import secrets
import io
from functools import wraps
from hmac import compare_digest
from time import monotonic
from flask import Blueprint, current_app, jsonify, render_template, request, session, send_file

from .services.records import (
    create_abnormality,
    create_production,
    daily_report,
    deactivate_cost_failure_type,
    deactivate_event_type,
    get_cost_failure_types,
    get_event_types,
    get_display_settings,
    get_daily_task,
    get_field_definitions,
    get_standard_field_settings,
    list_records,
    manager_get_record,
    manager_update_record,
    manager_dashboard,
    public_display_summary,
    save_cost_failure_type,
    save_event_type,
    save_display_settings,
    save_field_definition,
    save_standard_field_setting,
    save_daily_task,
    update_production_qualification,
    update_tracker,
)
from .services.backups import run_manual_backup

from .services.inventory import (check_out_product, get_product_by_token, inventory_summary, make_qr_png, register_product, register_small_roll)
from .departments import current_department, DEPARTMENTS, department_context
from .services.slitting import summary as slitting_summary, model_specs, save_model_spec, event_categories, save_event_category, MACHINES

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
    return render_template("slitting_display.html" if current_department() == "slitting" else "public_display.html")

@web.get("/inventory/scan/<token>")
def inventory_scan_page(token):
    try:
        product = get_product_by_token(token)
    except ValueError:
        product = None
    return render_template("inventory_scan.html", token=token, product=product)

@web.get("/api/inventory")
def inventory():
    try:
        product_page = max(1, int(request.args.get("product_page", "1")))
        transaction_page = max(1, int(request.args.get("transaction_page", "1")))
        for key in ("checkout_date", "register_date", "transaction_date"):
            value = request.args.get(key, "").strip()
            if value:
                from datetime import date
                date.fromisoformat(value)
        return jsonify(inventory_summary(
            product_page=product_page,
            transaction_page=transaction_page,
            page_size=20,
            product_query=request.args.get("product_query", "").strip() or None,
            product_width=request.args.get("product_width", "").strip() or None,
            product_status=request.args.get("product_status", "").strip() or None,
            checkout_date=request.args.get("checkout_date", "").strip() or None,
            register_date=request.args.get("register_date", "").strip() or None,
            transaction_query=request.args.get("transaction_query", "").strip() or None,
            transaction_date=request.args.get("transaction_date", "").strip() or None,
        ))
    except ValueError:
        return jsonify(error="Inventory pages must be whole numbers and dates must be valid."), 400

@web.post("/api/inventory/products")
def create_inventory_product():
    try:
        products = register_product(request.get_json() or {})
        first = products[0]
        message = (
            f'{len(products)} small rolls registered and QR labels created.'
            if len(products) > 1 else "Roll registered and QR label created."
        )
        return jsonify(id=first["id"], qr_token=first["qr_token"], ids=[p["id"] for p in products], products=products, message=message), 201
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

@web.post("/api/inventory/products/<int:product_id>/small-rolls")
def create_inventory_small_roll(product_id):
    try:
        product = register_small_roll(product_id, request.get_json() or {})
        return jsonify(id=product["id"], qr_token=product["qr_token"], message="Small roll registered and QR label created."), 201
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

@web.get("/api/inventory/products/<int:product_id>/qr.png")
def inventory_product_qr(product_id):
    with_url = current_app.config["QR_PUBLIC_BASE_URL"] or request.url_root.rstrip("/")
    from .db import transaction
    with transaction() as cursor:
        cursor.execute("SELECT qr_token, roll_number FROM system_import.inventory_products WHERE id=%s", (product_id,))
        product = cursor.fetchone()
    if not product:
        return jsonify(error="Product not found."), 404
    try:
        return send_file(make_qr_png(f'{with_url}/inventory/scan/{product["qr_token"]}'), mimetype="image/png", download_name=f'{product["roll_number"]}-QR.png')
    except RuntimeError as exc:
        return jsonify(error=str(exc)), 503

@web.get("/inventory/products/<int:product_id>/label")
def inventory_product_label(product_id):
    from .db import transaction
    with transaction() as cursor:
        cursor.execute(
            """SELECT id, roll_number, product_code, material_code, parent_roll_number,
                      slit_width_mm, thickness_um, roll_length_m, net_weight_kg,
                      production_date, machine_code, location
               FROM system_import.inventory_products WHERE id=%s""",
            (product_id,),
        )
        product = cursor.fetchone()
    if not product:
        return "Product not found.", 404
    return render_template("inventory_label.html", product=product)

@web.get("/inventory/products/labels")
def inventory_product_labels():
    raw_ids = [value.strip() for value in request.args.get("ids", "").split(",") if value.strip()]
    try:
        product_ids = list(dict.fromkeys(int(value) for value in raw_ids))
    except ValueError:
        return "Product IDs must be whole numbers.", 400
    if not product_ids or len(product_ids) > 100:
        return "Select between 1 and 100 products.", 400
    from .db import transaction
    placeholders = ",".join(["%s"] * len(product_ids))
    with transaction() as cursor:
        cursor.execute(
            f"""SELECT id, roll_number, product_code, material_code, parent_roll_number,
                       slit_width_mm, thickness_um, roll_length_m, net_weight_kg,
                       production_date, machine_code, location, label_created_at
                FROM system_import.inventory_products WHERE id IN ({placeholders})""",
            product_ids,
        )
        by_id = {row["id"]: row for row in cursor.fetchall()}
    products = [by_id[product_id] for product_id in product_ids if product_id in by_id]
    if not products:
        return "No selected products were found.", 404
    return render_template("inventory_labels.html", products=products)

@web.post("/api/inventory/scan/<token>")
def scan_inventory_product(token):
    try:
        product = check_out_product(token, (request.get_json() or {}).get("scanned_by"))
        return jsonify(ok=True, product=product, message=f'Roll {product["roll_number"]} checked out. Inventory reduced by 1.')
    except ValueError as exc:
        return jsonify(error=str(exc)), 409

@web.post("/api/inventory/decode-qr")
def decode_inventory_qr():
    upload = request.files.get("image")
    if not upload:
        return jsonify(error="Take a clear picture of the QR code."), 400
    try:
        from PIL import Image
        import zxingcpp
        image = Image.open(io.BytesIO(upload.read()))
        barcode = zxingcpp.read_barcode(image)
        if not barcode or not barcode.text:
            raise ValueError("No QR code was found. Move closer and try again.")
        from urllib.parse import urlparse
        parsed = urlparse(barcode.text)
        prefix = "/inventory/scan/"
        if not parsed.path.startswith(prefix):
            raise ValueError("This is not a GNEM roll inventory QR code.")
        token = parsed.path[len(prefix):].strip("/")
        get_product_by_token(token)
        return jsonify(ok=True, scan_path=f"{prefix}{token}")
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except Exception:
        return jsonify(error="The QR picture could not be read. Retake it in good light."), 400

@web.get('/api/departments')
def departments():
    return jsonify(departments=DEPARTMENTS, selected=current_department())

@web.post('/api/manager/department')
@require_manager
def manager_department():
    value = (request.get_json() or {}).get('department')
    if value not in DEPARTMENTS:
        return jsonify(error='Unknown department.'), 400
    return jsonify(department=value, url='/?department=' + value)

@web.get('/api/slitting/summary')
def slitting_production_summary():
    if current_department() != 'slitting':
        return jsonify(error='Select Slitting first.'), 400
    try:
        summary = slitting_summary(request.args.get('date') or None, request.args.get('machine') or None)
        summary['display_settings'] = get_display_settings()
        summary['daily_task'] = get_daily_task(request.args.get('date') or None)
        return jsonify(summary)
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

@web.get('/api/slitting/options')
def slitting_options():
    return jsonify(categories=event_categories(), machines=MACHINES, models=[row['model_code'] for row in model_specs()])

@web.post('/api/manager/slitting-event-categories')
@require_manager
def save_slitting_event_category():
    try:
        saved = save_event_category(request.get_json() or {}, session.get('manager_id'))
        return jsonify(message='Slitting main category and subcategory saved.', category=saved), 201
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

@web.get('/api/manager/slitting-models')
@require_manager
def slitting_models():
    return jsonify(models=model_specs(False))

@web.post('/api/manager/slitting-models')
@require_manager
def save_slitting_model():
    try:
        save_model_spec(request.get_json() or {}, session.get('manager_id'))
        return jsonify(message='Slitting model lookup saved.')
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

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
            if payload.get("department", "slurry") != current_department():
                raise ValueError("Sync this record in its original department.")
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

@web.get("/api/manager/display-settings")
@require_manager
def manager_display_settings(): return jsonify(settings=get_display_settings())

@web.post("/api/manager/display-settings")
@require_manager
def update_manager_display_settings():
    try: return jsonify(ok=True, settings=save_display_settings(request.get_json() or {}))
    except ValueError as exc: return jsonify(error=str(exc)), 400

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
@require_manager
def manager_record(record_type, record_id):
    try:
        return jsonify(record=manager_get_record(record_type, record_id))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400


@web.patch("/api/manager/records/<record_type>/<int:record_id>")
@require_manager
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

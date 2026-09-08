import io
from datetime import date, datetime
from uuid import uuid4

from ..db import transaction


def _serialize(rows):
    for row in rows:
        for key, value in row.items():
            if isinstance(value, (date, datetime)):
                row[key] = value.isoformat(sep=" ", timespec="seconds") if isinstance(value, datetime) else value.isoformat()
    return rows


def _small_roll_number(payload):
    raw = str(payload.get("small_roll_number", "")).strip()
    if not raw:
        return None
    if not raw.isdigit() or int(raw) < 1 or int(raw) > 100:
        raise ValueError("Small roll quantity must be a whole number from 1 to 100.")
    return int(raw)


def register_product(payload, expand_small_rolls=True):
    mr_number = str(payload.get("mr_number") or payload.get("roll_number") or "").strip().upper()
    if not mr_number:
        raise ValueError("MR number is required.")
    small_roll_number = _small_roll_number(payload)
    small_roll_numbers = (
        range(1, small_roll_number + 1)
        if small_roll_number is not None and expand_small_rolls
        else [small_roll_number]
    )
    try:
        width = float(payload["slit_width_mm"]) if str(payload.get("slit_width_mm", "")).strip() else None
        thickness = float(payload["thickness_um"]) if str(payload.get("thickness_um", "")).strip() else None
        length = float(payload["roll_length_m"]) if str(payload.get("roll_length_m", "")).strip() else None
        production_date = str(payload.get("production_date", "")).strip() or None
        if production_date:
            date.fromisoformat(production_date)
    except (TypeError, ValueError) as exc:
        raise ValueError("Enter valid numeric dimensions and a valid production date.") from exc
    if any(value is not None and value <= 0 for value in (width, thickness, length)):
        raise ValueError("Roll dimensions must be greater than zero.")
    created = []
    with transaction() as cursor:
        for number in small_roll_numbers:
            token = str(uuid4())
            roll_number = f"{mr_number}-{number:05d}" if number is not None else mr_number
            try:
                cursor.execute(
                    """INSERT INTO system_import.inventory_products
                       (qr_token, roll_number, product_code, material_code, parent_roll_number,
                        slit_width_mm, thickness_um, roll_length_m, net_weight_kg, production_date,
                        machine_code, location, notes)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (token, roll_number, None, None, mr_number,
                     width, thickness, length, None, production_date,
                     str(payload.get("machine_code", "")).strip().upper() or None,
                     str(payload.get("location", "")).strip() or None,
                     str(payload.get("notes", "")).strip() or None),
                )
            except Exception as exc:
                if "Duplicate" in str(exc):
                    raise ValueError(f"Roll {roll_number} is already registered.") from exc
                raise
            product_id = cursor.lastrowid
            cursor.execute("INSERT INTO system_import.inventory_transactions (product_id, transaction_type, quantity_delta, source) VALUES (%s,'in',1,'registration')", (product_id,))
            created.append({"id": product_id, "qr_token": token, "roll_number": roll_number})
    return created


def register_small_roll(product_id, payload):
    small_roll_number = _small_roll_number(payload)
    if small_roll_number is None:
        raise ValueError("Small roll number is required.")
    with transaction() as cursor:
        cursor.execute(
            """SELECT parent_roll_number, roll_number, slit_width_mm, thickness_um,
                      roll_length_m, production_date, machine_code, location, notes
               FROM system_import.inventory_products WHERE id=%s""",
            (product_id,),
        )
        source = cursor.fetchone()
    if not source:
        raise ValueError("MR roll was not found.")
    mr_number = source["parent_roll_number"] or source["roll_number"]
    return register_product(
        {**source, "mr_number": mr_number, "small_roll_number": small_roll_number},
        expand_small_rolls=False,
    )[0]


def inventory_summary(product_page=1, transaction_page=1, page_size=20,
                      product_query=None, product_width=None, product_status=None, checkout_date=None, register_date=None,
                      transaction_query=None, transaction_date=None):
    product_conditions, product_params = [], []
    if product_query:
        product_conditions.append("(roll_number = %s OR parent_roll_number = %s)")
        product_params.extend((product_query, product_query))
    if product_width is not None:
        try:
            product_width = float(product_width)
        except (TypeError, ValueError) as exc:
            raise ValueError("Width filter must be a valid number.") from exc
        if product_width <= 0:
            raise ValueError("Width filter must be greater than zero.")
        product_conditions.append("slit_width_mm = %s")
        product_params.append(product_width)
    if product_status:
        if product_status not in {"in_stock", "out"}:
            raise ValueError("Inventory status filter is invalid.")
        product_conditions.append("status = %s")
        product_params.append(product_status)
    if checkout_date:
        product_conditions.append("DATE(checked_out_at) = %s")
        product_params.append(checkout_date)
    if register_date:
        product_conditions.append("DATE(created_at) = %s")
        product_params.append(register_date)
    product_where = f" WHERE {' AND '.join(product_conditions)}" if product_conditions else ""

    transaction_conditions, transaction_params = [], []
    if transaction_query:
        transaction_conditions.append("(p.roll_number LIKE %s OR p.product_code LIKE %s)")
        search = f"%{transaction_query}%"
        transaction_params.extend((search, search))
    if transaction_date:
        transaction_conditions.append("DATE(t.occurred_at) = %s")
        transaction_params.append(transaction_date)
    transaction_where = f" WHERE {' AND '.join(transaction_conditions)}" if transaction_conditions else ""
    product_offset = (product_page - 1) * page_size
    transaction_offset = (transaction_page - 1) * page_size

    with transaction() as cursor:
        cursor.execute("SELECT COUNT(*) AS registered, SUM(status='in_stock') AS in_stock, SUM(status='out') AS checked_out FROM system_import.inventory_products")
        summary = cursor.fetchone()
        cursor.execute(f"SELECT COUNT(*) AS total FROM system_import.inventory_products{product_where}", product_params)
        product_total = cursor.fetchone()["total"]
        cursor.execute(f"""SELECT id, roll_number, product_code, material_code, parent_roll_number,
                          slit_width_mm, thickness_um, roll_length_m, net_weight_kg, production_date,
                          machine_code, location, status, created_at, label_created_at, checked_out_at
                          FROM system_import.inventory_products{product_where}
                          ORDER BY label_created_at DESC, id DESC LIMIT %s OFFSET %s""",
                       [*product_params, page_size, product_offset])
        products = cursor.fetchall()
        cursor.execute(f"""SELECT COUNT(*) AS total FROM system_import.inventory_transactions t
                          JOIN system_import.inventory_products p ON p.id=t.product_id{transaction_where}""",
                       transaction_params)
        transaction_total = cursor.fetchone()["total"]
        cursor.execute(f"""SELECT t.id, t.product_id, p.roll_number, p.product_code, t.transaction_type,
                          t.quantity_delta, t.source, t.occurred_at
                          FROM system_import.inventory_transactions t
                          JOIN system_import.inventory_products p ON p.id=t.product_id
                          {transaction_where} ORDER BY t.occurred_at DESC, t.id DESC LIMIT %s OFFSET %s""",
                       [*transaction_params, page_size, transaction_offset])
        transactions = cursor.fetchall()
    summary = {key: int(value or 0) for key, value in summary.items()}
    return {
        "summary": summary,
        "products": _serialize(products),
        "transactions": _serialize(transactions),
        "product_pagination": {"page": product_page, "page_size": page_size, "total": int(product_total)},
        "transaction_pagination": {"page": transaction_page, "page_size": page_size, "total": int(transaction_total)},
    }


def get_product_by_token(token):
    with transaction() as cursor:
        cursor.execute("SELECT id, roll_number, product_code, slit_width_mm, status, checked_out_at FROM system_import.inventory_products WHERE qr_token=%s", (token,))
        row = cursor.fetchone()
    if not row:
        raise ValueError("Product QR code is not recognized.")
    return _serialize([row])[0]


def check_out_product(token, scanned_by=None):
    with transaction() as cursor:
        cursor.execute("SELECT id, roll_number, product_code, status FROM system_import.inventory_products WHERE qr_token=%s FOR UPDATE", (token,))
        product = cursor.fetchone()
        if not product:
            raise ValueError("Product QR code is not recognized.")
        if product["status"] != "in_stock":
            raise ValueError(f'Roll {product["roll_number"]} is already out of inventory.')
        cursor.execute("UPDATE system_import.inventory_products SET status='out', checked_out_at=CURRENT_TIMESTAMP WHERE id=%s", (product["id"],))
        cursor.execute("INSERT INTO system_import.inventory_transactions (product_id, transaction_type, quantity_delta, source, scanned_by) VALUES (%s,'out',-1,'qr_scan',%s)", (product["id"], str(scanned_by or "").strip() or None))
    return product


def make_qr_png(value):
    try:
        import qrcode
    except ImportError as exc:
        raise RuntimeError("QR support is not installed. Run pip install -r requirements.txt.") from exc
    image = qrcode.make(value)
    output = io.BytesIO()
    image.save(output, format="PNG")
    output.seek(0)
    return output

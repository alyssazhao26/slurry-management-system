"""Slitting inputs are stored as immutable per-record calculation snapshots."""
import json
import math
import re
from uuid import uuid4
from datetime import date
from ..db import transaction

MACHINES = ['FJ2','FJ3','FJ4','FJ5','FJ6','FX1','FX2','FX3','FX4','FX5','FX6','FX7','FX8']
CATEGORIES = {
 'Equipment Issue / 设备异常': ['Meter counter issue / 计米异常','CCD inspection issue / CCD异常','Edge alignment issue / 纠偏异常','Tension control issue / 张力异常','Sensor issue / 感应器异常','Abnormal machine noise / 机台异响','Blade issue / 刀片异常','Rewinding issue / 收卷异常','Unwinding issue / 放卷异常','Other equipment issue / 其他设备异常'],
 'Personnel / Operation Issue / 人员异常': ['Film threading error / 穿膜失误','Blade adjustment error / 调刀失误','Edge alignment positioning error / 纠偏定位失误','SOP not followed / 未按SOP操作','Staff absent / 人员缺岗','Shift handover omission / 交接班遗漏','Cleaning not completed properly / 清洁不到位','Other personnel/operation issue / 其他人员异常'],
 'Incoming Material Issue / 来料异常': ['Material shortage / 缺料','Coated film short length / 涂覆膜短米','Coated film appearance defect / 涂覆膜外观异常','Other incoming material issue / 其他来料异常'],
 'QC Issue / 检验异常': ['Waiting for FAI approval / 等待首刀','Waiting for inspection result / 等待检验结果','Width out of standard / 宽度超标','Foreign matter over standard / 异物超标','Hipot test out of standard / 弱电超标','Other QC issue / 其他检验异常'],
 'Other Issue / 其它异常': ['Other issue / 其它异常']
}
NUMBERS = ['width_m','coated_length_m','coated_width_m','stations','slitting_length_m','planned_rolls','input_rolls','qualified_rolls']

def field_choices(form_key, field_key, defaults):
    """Return manager-configured saved values and labels, falling back to defaults."""
    with transaction() as cursor:
        cursor.execute("SELECT options_json FROM system_import.standard_field_settings WHERE form_key=%s AND field_key=%s", (form_key, field_key))
        row = cursor.fetchone()
    raw = row.get('options_json') if row else None
    if isinstance(raw, str):
        try: raw = json.loads(raw)
        except (TypeError, ValueError): raw = None
    values = raw if isinstance(raw, list) and raw else defaults
    choices = []
    for item in values:
        value, separator, label = str(item).partition('|')
        value = value.strip()
        if value and value not in {choice['value'] for choice in choices}:
            choices.append({'value': value, 'label': label.strip() if separator and label.strip() else value})
    return choices

def machine_choices(form_key='production'):
    defaults = MACHINES + (['NA|NA / 不适用'] if form_key == 'abnormality' else [])
    choices = field_choices(form_key, 'machine_code', defaults)
    # A machine is a shared Slitting resource. Managers may edit it from either
    # form, so merge both saved lists instead of allowing the task scheduler,
    # production form, and event form to drift apart.
    other_form = 'abnormality' if form_key == 'production' else 'production'
    for choice in field_choices(other_form, 'machine_code', []):
        if choice['value'] != 'NA' and choice['value'] not in {item['value'] for item in choices}:
            choices.append(choice)
    if form_key == 'abnormality' and not any(choice['value'] == 'NA' for choice in choices):
        choices.append({'value': 'NA', 'label': 'NA / 不适用'})
    return choices

def shift_choices(form_key='production'):
    return field_choices(form_key, 'shift_name', ['Day|Day / 白班', 'Night|Night / 夜班'])

def event_categories():
    with transaction() as cursor:
        cursor.execute("SELECT main_category, subcategory FROM system_import.slitting_event_categories WHERE is_active=TRUE ORDER BY display_order, id")
        rows = cursor.fetchall()
    categories = {}
    for row in rows:
        categories.setdefault(row['main_category'], []).append(row['subcategory'])
    return categories

def save_event_category(payload, actor_id=None):
    main = str(payload.get('main_category', '')).strip()
    subcategory = str(payload.get('subcategory', '')).strip()
    if not main or not subcategory: raise ValueError('Enter both a main category and its subcategory.')
    if len(main) > 160 or len(subcategory) > 160: raise ValueError('Category names must be 160 characters or fewer.')
    if main == subcategory: raise ValueError('Main category and subcategory must be different.')
    with transaction() as cursor:
        cursor.execute("""INSERT INTO system_import.slitting_event_categories
            (main_category, subcategory, is_active, updated_by)
            VALUES (%s,%s,TRUE,%s)
            ON DUPLICATE KEY UPDATE is_active=TRUE, updated_by=VALUES(updated_by)""",
            (main, subcategory, actor_id))
    return {'main_category': main, 'subcategory': subcategory}

def model_specs(active_only=True):
    where = " WHERE is_active=TRUE" if active_only else ""
    with transaction() as cursor:
        cursor.execute("SELECT id, model_code, width_m, coated_length_m, coated_width_m, stations, slitting_length_m, is_active, updated_at FROM system_import.slitting_model_specs" + where + " ORDER BY model_code")
        return cursor.fetchall()

def save_model_spec(payload, actor_id=None):
    model = str(payload.get('model_code', '')).strip()
    if not model or len(model) > 100: raise ValueError('Model must contain 1 to 100 characters.')
    values = {}
    for key in ('width_m','coated_length_m','coated_width_m','stations','slitting_length_m'):
        raw = payload.get(key)
        if raw in ('', None): values[key] = None; continue
        try: value = float(raw)
        except (TypeError, ValueError) as exc: raise ValueError('Model dimensions must be valid numbers.') from exc
        if not math.isfinite(value) or value <= 0: raise ValueError('Model dimensions must be greater than zero.')
        if key == 'stations' and not value.is_integer(): raise ValueError('Stations must be a whole number.')
        values[key] = int(value) if key == 'stations' else value
    with transaction() as cursor:
        cursor.execute("""INSERT INTO system_import.slitting_model_specs
            (model_code,width_m,coated_length_m,coated_width_m,stations,slitting_length_m,is_active,updated_by)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON DUPLICATE KEY UPDATE width_m=VALUES(width_m),coated_length_m=VALUES(coated_length_m),coated_width_m=VALUES(coated_width_m),stations=VALUES(stations),slitting_length_m=VALUES(slitting_length_m),is_active=VALUES(is_active),updated_by=VALUES(updated_by)""",
            (model,values['width_m'],values['coated_length_m'],values['coated_width_m'],values['stations'],values['slitting_length_m'],bool(payload.get('is_active',True)),actor_id))

def _model_spec(model):
    with transaction() as cursor:
        cursor.execute("SELECT width_m,coated_length_m,coated_width_m,stations,slitting_length_m FROM system_import.slitting_model_specs WHERE model_code=%s AND is_active=TRUE", (model,))
        return cursor.fetchone()

def custom(row):
    value = row.get('custom_fields') or {}
    return json.loads(value) if isinstance(value, str) else dict(value)

def normalise_production(payload, existing=None):
    old = custom(existing or {}).get('slitting', {})
    model = str(payload.get('formula_code', (existing or {}).get('formula_code', ''))).strip()
    spec = _model_spec(model)
    if not spec: raise ValueError('Choose an active model from the model lookup.')
    missing = [key for key in ('width_m','coated_length_m','coated_width_m','stations','slitting_length_m') if spec.get(key) in ('',None)]
    if missing: raise ValueError('This model lookup is incomplete. A manager must fill all calculation fields before it can be used.')
    values = {**old, **payload, **spec}
    clean = {}
    for key in NUMBERS:
        raw = values.get(key)
        if key == 'qualified_rolls' and raw in ('', None):
            clean[key] = None
            continue
        try:
            number = float(raw)
        except (ValueError, TypeError):
            raise ValueError('Enter a valid ' + key.replace('_', ' ') + '.')
        if not math.isfinite(number) or number < 0 or number > 100000000:
            raise ValueError('Invalid ' + key.replace('_', ' ') + '.')
        if key in ['stations','planned_rolls','input_rolls','qualified_rolls'] and not number.is_integer():
            raise ValueError('Roll counts and stations must be whole numbers.')
        if key in ['width_m','coated_length_m','coated_width_m','stations','slitting_length_m'] and number == 0:
            raise ValueError('Dimensions and stations must be greater than zero.')
        clean[key] = number
    if clean['width_m'] * clean['stations'] > clean['coated_width_m'] + 0.000001:
        raise ValueError('Width × stations cannot exceed coated film width. Check metre units.')
    if clean['slitting_length_m'] > clean['coated_length_m']:
        raise ValueError('Slitting length cannot exceed coated film length.')
    if clean['qualified_rolls'] is not None and clean['qualified_rolls'] > clean['input_rolls'] * clean['stations']:
        raise ValueError('Qualified output rolls cannot exceed input rolls × stations.')
    machine = str(values.get('machine_code', (existing or {}).get('machine_code', ''))).strip()
    if machine not in {choice['value'] for choice in machine_choices('production')}: raise ValueError('Choose a configured slitting machine.')
    batch = str(values.get('batch_number', (existing or {}).get('batch_number', ''))).strip() or ('AUTO-' + uuid4().hex[:16].upper())
    if not model or len(model) > 50: raise ValueError('Enter a model (up to 50 characters).')
    if values.get('shift_name', (existing or {}).get('shift_name')) not in {choice['value'] for choice in shift_choices('production')}:
        raise ValueError('Choose a configured Slitting shift.')
    unit = clean['width_m'] * clean['slitting_length_m']
    fields = {**custom(existing or {}), **payload.get('custom_fields', {}), 'slitting': clean}
    return {**payload, 'machine_code':machine, 'formula_code':model, 'batch_number':batch,
            'planned_quantity':clean['planned_rolls'] * clean['stations'] * unit,
            'actual_quantity':clean['input_rolls'] * clean['stations'] * unit,
            'qualified_quantity': '' if clean['qualified_rolls'] is None else clean['qualified_rolls'] * unit,
            'custom_fields':fields}

def normalise_abnormality(payload, existing=None):
    old = custom(existing or {})
    category = payload.get('event_type', (existing or {}).get('event_type'))
    subcategory = payload.get('subcategory', old.get('subcategory'))
    categories = event_categories()
    if category not in categories or subcategory not in categories[category]:
        raise ValueError('Choose a main category and a subcategory belonging to it.')
    notes = str(payload.get('event_notes', old.get('event_notes', ''))).strip()
    if len(notes) > 4000: raise ValueError('Notes must be 4000 characters or fewer.')
    machine = str(payload.get('machine_code', (existing or {}).get('machine_code', ''))).strip()
    shift = str(payload.get('shift_name', (existing or {}).get('shift_name', ''))).strip()
    if machine not in {choice['value'] for choice in machine_choices('abnormality')}: raise ValueError('Choose a configured Slitting machine.')
    if shift not in {choice['value'] for choice in shift_choices('abnormality')}: raise ValueError('Choose a configured Slitting shift.')
    return {**payload, 'machine_type':'auto', 'event_type':category, 'description':subcategory + (' — ' + notes if notes else ''),
            'custom_fields':{**old, **payload.get('custom_fields', {}), 'subcategory':subcategory, 'event_notes':notes}}

def enrich(row):
    if row.get('qualified_quantity') == '': row['qualified_quantity'] = None
    if row.get('qualified_quantity') == '': row['qualified_quantity'] = None
    fields = custom(row)
    # Expose configured custom values to every JSON consumer (history, reports,
    # manager editor, and the read-only display) while retaining custom_fields.
    row.update({key: value for key, value in fields.items() if key != 'slitting'})
    row.update({k:fields.get(k, '') for k in ('subcategory','event_notes')})
    spec = fields.get('slitting')
    if spec:
        row.update(spec)
        row['input_area'] = spec['input_rolls'] * spec['coated_length_m'] * spec['coated_width_m']
        row['yield_rate'] = float(row['qualified_quantity']) / row['input_area'] if row.get('qualified_quantity') is not None and row['input_area'] else None
    return row

def aggregate(rows):
    totals = {key:0.0 for key in ('planned_quantity','input_area','actual_quantity','qualified_quantity')}
    pending = 0
    for row in rows:
        for key in totals: totals[key] += float(row.get(key) or 0)
        pending += int(row.get('qualified_quantity') is None)
    def ratio(n,d): return n/d if d else None
    return {**totals, 'records':len(rows), 'pending':pending,
            'achievement_rate':ratio(totals['actual_quantity'],totals['planned_quantity']),
            'qualified_rate':None if pending else ratio(totals['qualified_quantity'],totals['actual_quantity']),
            'yield_rate':None if pending else ratio(totals['qualified_quantity'],totals['input_area'])}

def model_width_suffix(model_code):
    """Return the numeric width following the final slash in a model code."""
    suffix = str(model_code or '').rsplit('/', 1)[-1].strip()
    match = re.match(r'^([0-9]+(?:\.[0-9]+)?)', suffix)
    return float(match.group(1)) if match else None


def summary(record_date=None, machine=None, width=None):
    from .records import _json_safe_rows
    clauses, params = [], []
    if record_date:
        try: date.fromisoformat(record_date)
        except ValueError: raise ValueError('Choose a valid date.')
        clauses.append('record_date = %s'); params.append(record_date)
    if machine:
        clauses.append('machine_code = %s'); params.append(machine)
    where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
    with transaction() as cursor:
        cursor.execute('SELECT * FROM system_import.production_records' + where + ' ORDER BY record_date DESC, machine_code, shift_name, id', params)
        all_rows = [enrich(row) for row in _json_safe_rows(cursor.fetchall())]
    rows = [row for row in all_rows if custom(row).get('slitting')]
    if width not in (None, ''):
        try:
            selected_width = float(str(width).strip().upper().removesuffix('MM'))
        except ValueError as exc:
            raise ValueError('Width must be a number, for example 88.8.') from exc
        rows = [
            row for row in rows
            if model_width_suffix(row.get('formula_code')) is not None
            and abs(model_width_suffix(row.get('formula_code')) - selected_width) < 0.0001
        ]
    machines = sorted({row['machine_code'] for row in rows})
    with transaction() as cursor:
        cursor.execute("""SELECT field_key, label, input_type, options_json, is_required, display_order
                          FROM system_import.field_definitions
                          WHERE form_key='production' AND is_active=TRUE AND field_key<>'work_order'
                          ORDER BY display_order""")
        custom_field_definitions = cursor.fetchall()
    return {'overall':aggregate(rows), 'machines':[{'machine_code':m, 'stats':aggregate([r for r in rows if r['machine_code']==m]), 'records':[r for r in rows if r['machine_code']==m]} for m in machines],
            'records':rows, 'legacy_records':len(all_rows)-len(rows), 'report_date':record_date,
            'custom_field_definitions': custom_field_definitions}

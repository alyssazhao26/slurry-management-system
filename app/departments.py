"""Department context is request-local; never change shared Flask configuration."""
from contextlib import contextmanager
from flask import current_app, g, has_app_context, has_request_context, request, abort

DEPARTMENTS = {'slurry': 'Slurry / 制浆', 'slitting': 'Slitting / 分切'}

def current_department():
    if not has_app_context():
        return 'slurry'
    return getattr(g, 'department', 'slurry')

def select_request_department():
    value = request.headers.get('X-Department') or request.args.get('department') or 'slurry'
    if request.path.startswith(('/inventory/', '/api/inventory')):
        value = 'slitting'  # QR links always resolve in the inventory-owning department.
    if value not in DEPARTMENTS:
        abort(400, 'Unknown department.')
    if request.is_json and request.method in {'POST','PATCH','PUT'}:
        payload = request.get_json(silent=True)
        if isinstance(payload, dict) and 'department' in payload and request.path != '/api/manager/department' and payload['department'] != value:
            abort(400, 'Record department does not match this request.')
    g.department = value

@contextmanager
def department_context(value):
    if value not in DEPARTMENTS:
        raise ValueError('Unknown department.')
    previous = current_department()
    g.department = value
    try:
        yield
    finally:
        g.department = previous

def database_config():
    if current_department() == 'slitting':
        return dict(current_app.config['SLITTING_DB'])
    return dict(current_app.config['DB'])

def import_schema():
    key = 'SLITTING_IMPORT_SCHEMA' if current_department() == 'slitting' else 'IMPORT_SCHEMA'
    schema = current_app.config[key]
    import re
    if not re.fullmatch(r'[A-Za-z0-9_]+', schema):
        raise RuntimeError('Invalid import schema configuration.')
    return schema

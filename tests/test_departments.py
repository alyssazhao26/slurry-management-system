import pytest
from flask import Flask
from app import create_app
from app.config import Config
from app.departments import department_context, current_department
from app.db import DepartmentCursor
from app.services import slitting
from app.services.slitting import normalise_production, normalise_abnormality, aggregate, enrich, CATEGORIES

@pytest.fixture(autouse=True)
def model_lookup(monkeypatch):
    monkeypatch.setattr(slitting, '_model_spec', lambda model: dict(width_m=.0888, coated_length_m=2060, coated_width_m=1.02, stations=11, slitting_length_m=2000) if model == 'F/SHK13J22H/B1/88.8MM' else None)
    monkeypatch.setattr(slitting, 'machine_choices', lambda form_key='production': [{'value':machine,'label':machine} for machine in slitting.MACHINES] + ([{'value':'NA','label':'NA / 不适用'}] if form_key == 'abnormality' else []))
    monkeypatch.setattr(slitting, 'shift_choices', lambda form_key='production': [{'value':'Day','label':'Day / 白班'},{'value':'Night','label':'Night / 夜班'}])

def sample(**updates):
    return dict(dict(machine_code='FX5',shift_name='Day',formula_code='F/SHK13J22H/B1/88.8MM',batch_number='RUN1',width_m=.0888,coated_length_m=2060,coated_width_m=1.02,stations=11,slitting_length_m=2000,planned_rolls=3,input_rolls=3,qualified_rolls=11),**updates)

def test_reference_report():
    row=enrich(normalise_production(sample()))
    assert row['planned_quantity']==pytest.approx(5860.8)
    assert row['actual_quantity']==pytest.approx(5860.8)
    assert row['qualified_quantity']==pytest.approx(1953.6)
    assert row['input_area']==pytest.approx(6303.6)
    total=aggregate([row])
    assert total['achievement_rate']==pytest.approx(1)
    assert total['qualified_rate']==pytest.approx(1/3)
    assert total['yield_rate']==pytest.approx(1953.6/6303.6)

@pytest.mark.parametrize('updates',[{'input_rolls':-1},{'qualified_rolls':34},{'planned_rolls':'nan'},{'machine_code':'J1'},{'input_rolls':1.5},{'formula_code':'not-in-lookup'}])
def test_invalid_dimensions(updates):
    with pytest.raises(ValueError): normalise_production(sample(**updates))

def test_employee_dimensions_are_ignored_in_favour_of_lookup():
    row = normalise_production(sample(width_m=88.8, stations=1, coated_width_m=99))
    assert row['custom_fields']['slitting']['width_m'] == .0888
    assert row['custom_fields']['slitting']['stations'] == 11

def test_configured_machine_is_accepted_everywhere(monkeypatch):
    monkeypatch.setattr(slitting,'machine_choices',lambda form_key='production':[{'value':'FJ1','label':'FJ1'}])
    row=normalise_production(sample(machine_code='FJ1'))
    assert row['machine_code']=='FJ1'

def test_weighted_totals_pending_and_zero():
    first=enrich(normalise_production(sample()))
    second=enrich(normalise_production(sample(input_rolls=6,planned_rolls=3,qualified_rolls=66)))
    result=aggregate([first,second])
    assert result['qualified_rate']==pytest.approx(7/9)
    pending=enrich(normalise_production(sample(qualified_rolls='')))
    assert aggregate([first,pending])['qualified_rate'] is None
    assert aggregate([])['achievement_rate'] is None

def test_edit_recomputes_from_snapshot():
    original=normalise_production(sample())
    updated=normalise_production({'qualified_rolls':22},original)
    assert updated['qualified_quantity']==pytest.approx(3907.2)
    assert updated['custom_fields']['slitting']['qualified_rolls']==22

def test_dependent_categories(monkeypatch):
    category=next(iter(CATEGORIES)); sub=CATEGORIES[category][0]
    monkeypatch.setattr(slitting, 'event_categories', lambda: CATEGORIES)
    result=normalise_abnormality({'event_type':category,'subcategory':sub,'event_notes':'Note','machine_code':'FX5','shift_name':'Day'})
    assert result['description']==sub+' — Note'
    assert result['custom_fields']['event_notes']=='Note'
    with pytest.raises(ValueError): normalise_abnormality({'event_type':category,'subcategory':'Not in catalog','machine_code':'FX5','shift_name':'Day'})

def test_save_slitting_event_category(monkeypatch):
    calls=[]
    class Cursor:
        def execute(self,sql,params=None): calls.append((sql,params))
    from contextlib import contextmanager
    @contextmanager
    def fake_transaction(): yield Cursor()
    monkeypatch.setattr(slitting,'transaction',fake_transaction)
    saved=slitting.save_event_category({'main_category':'Maintenance / 维护','subcategory':'Preventive / 预防'},actor_id=2)
    assert saved['main_category']=='Maintenance / 维护'
    assert calls and calls[0][1][2]==2

def test_department_context_restored_after_exception():
    with Flask(__name__).app_context():
        assert current_department()=='slurry'
        with pytest.raises(ValueError):
            with department_context('slitting'):
                assert current_department()=='slitting'
                raise ValueError()
        assert current_department()=='slurry'

def test_sql_schema_translation_leaves_values_alone():
    class Cursor:
        def execute(self,sql,params): self.sql,self.params=sql,params
    raw=Cursor(); cursor=DepartmentCursor(raw,'private_slitting')
    cursor.execute('SELECT * FROM system_import.production_records WHERE notes=%s',('system_import.keep_text',))
    assert 'private_slitting.production_records' in raw.sql
    assert raw.params==('system_import.keep_text',)

def app_for_test(monkeypatch):
    monkeypatch.setattr('app.db.verify_ui_schema',lambda:None)
    monkeypatch.setattr(Config,'ENVIRONMENT','development')
    monkeypatch.setattr(Config,'BEHIND_TLS_PROXY',False)
    monkeypatch.setattr(Config,'SESSION_COOKIE_SECURE',False)
    monkeypatch.setattr(Config,'ALLOWED_HOSTS',{'localhost'})
    return create_app()

def test_department_switch_and_tab_isolation(monkeypatch):
    app=app_for_test(monkeypatch);client=app.test_client()
    token=client.get('/api/csrf').json['token'];headers={'X-CSRF-Token':token}
    assert client.post('/api/manager/department',json={'department':'slitting'},headers=headers).status_code==403
    with client.session_transaction() as session: session['manager_access']=True
    assert client.post('/api/manager/department',json={'department':'slitting'},headers=headers).json['url']=='/?department=slitting'
    assert client.get('/api/departments',headers={'X-Department':'slitting'}).json['selected']=='slitting'
    assert client.get('/api/departments',headers={'X-Department':'slurry'}).json['selected']=='slurry'
    assert client.get('/?department=unknown').status_code==400
    assert client.post('/api/production-records',json={'department':'slurry'},headers={**headers,'X-Department':'slitting'}).status_code==400

def test_edit_requires_manager(monkeypatch):
    client=app_for_test(monkeypatch).test_client()
    assert client.get('/api/manager/records/production/1').status_code==403

def test_attendance_employee_department_is_not_request_routing(monkeypatch):
    app=app_for_test(monkeypatch);client=app.test_client();saved=[]
    monkeypatch.setattr('app.routes.save_employee',lambda payload,employee_id=None:saved.append(payload))
    token=client.get('/api/csrf').json['token']
    with client.session_transaction() as session: session['manager_access']=True
    response=client.post('/api/manager/attendance-employees',json={
        'staffing_company':'Staffing Co','employee_name':'Test','employee_department':'Slurry','job_title':'Slurry','pin':'1234','is_active':True,
    },headers={'X-CSRF-Token':token,'X-Department':'slurry'})
    assert response.status_code==201
    assert saved[0]['employee_department']=='Slurry'
    assert saved[0]['staffing_company']=='Staffing Co'

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

def test_dependent_categories():
    category=next(iter(CATEGORIES)); sub=CATEGORIES[category][0]
    result=normalise_abnormality({'event_type':category,'subcategory':sub,'event_notes':'Note'})
    assert result['description']==sub+' — Note'
    assert result['custom_fields']['event_notes']=='Note'
    with pytest.raises(ValueError): normalise_abnormality({'event_type':category,'subcategory':'Not in catalog'})

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

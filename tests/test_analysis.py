from app.services.analysis import analyse_production, analyse_abnormality

def test_low_yield_creates_open_exception():
    result = analyse_production(100, 100, 75, .90)
    assert result.status == 'open'
    assert result.evidence['yield_rate'] == .75

def test_normal_production_does_not_escalate():
    assert analyse_production(100, 100, 95, .90).status == 'normal'

def test_high_severity_abnormality_escalates():
    assert analyse_abnormality('equipment', 'high', 10, 'Motor fault').status == 'open'

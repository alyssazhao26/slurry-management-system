from app.services.slitting import model_width_suffix


def test_model_width_suffix_uses_number_after_last_slash():
    assert model_width_suffix("F/SNK14E2211H/515.4MM") == 515.4
    assert model_width_suffix("F/SHK12E22H/E3/88.8MM") == 88.8
    assert model_width_suffix("NO-WIDTH") is None

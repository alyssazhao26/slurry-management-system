import pytest

from app.services.records import _manager_completion_values


def legacy_resolved_event():
    return {
        "is_resolved": "yes",
        "state": "resolved",
        "actual_finish_date": None,
        "solution_provided": None,
    }


def test_unrelated_edit_does_not_require_legacy_completion_details():
    finish, solution, status = _manager_completion_values(
        legacy_resolved_event(),
        {"event_type": "Normal Production", "is_resolved": "yes"},
    )
    assert (finish, solution, status) == (None, "", "yes")


def test_newly_closing_event_requires_completion_details():
    existing = {**legacy_resolved_event(), "is_resolved": "no", "state": "open"}
    with pytest.raises(ValueError, match="Closing an event requires"):
        _manager_completion_values(existing, {"is_resolved": "yes"})


def test_completion_details_must_be_entered_together():
    existing = {**legacy_resolved_event(), "is_resolved": "no", "state": "open"}
    with pytest.raises(ValueError, match="completed together"):
        _manager_completion_values(existing, {"actual_finish_date": "2026-08-31"})

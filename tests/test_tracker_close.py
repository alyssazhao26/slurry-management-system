from contextlib import contextmanager

from app.services import records


def test_manager_close_form_marks_event_resolved(monkeypatch):
    statements = []

    class Cursor:
        rowcount = 1

        def execute(self, sql, params=None):
            statements.append((sql, params))

    @contextmanager
    def fake_transaction():
        yield Cursor()

    monkeypatch.setattr(records, "transaction", fake_transaction)
    result = records.update_tracker(
        42,
        {
            "actual_finish_date": "2026-09-17",
            "solution_provided": "Blade replaced and verified.",
        },
        manager=True,
    )

    update_sql, update_params = statements[0]
    assert "is_resolved = %s" in update_sql
    assert "state = %s" in update_sql
    assert "yes" in update_params
    assert "resolved" in update_params
    assert result["closed"] is True

import json
from contextlib import contextmanager

from app.services import records


class FakeCursor:
    def __init__(self):
        self.calls = []

    def execute(self, query, params=None):
        self.calls.append((query, params))


def test_permanent_display_block_is_validated_and_persisted(monkeypatch):
    cursor = FakeCursor()

    @contextmanager
    def fake_transaction():
        yield cursor

    monkeypatch.setattr(records, "transaction", fake_transaction)
    settings = records.default_display_settings()
    settings["blocks"].append(
        {
            "key": "text_12345678",
            "type": "static_text",
            "title": "Standing tasks",
            "content": "Inspect the line before startup.",
            "visible": True,
            "order": 60,
            "width": 3,
            "height": 2,
        }
    )

    saved = records.save_display_settings(settings)

    block = saved["blocks"][-1]
    assert block["type"] == "static_text"
    assert block["width"] == 3
    assert block["height"] == 2
    persisted = json.loads(cursor.calls[0][1][0])
    assert persisted["blocks"][-1]["content"] == "Inspect the line before startup."


def test_display_sizes_snap_to_supported_grid(monkeypatch):
    cursor = FakeCursor()

    @contextmanager
    def fake_transaction():
        yield cursor

    monkeypatch.setattr(records, "transaction", fake_transaction)
    settings = records.default_display_settings()
    settings["blocks"][0].update(width=99, height=0)

    saved = records.save_display_settings(settings)

    assert saved["blocks"][0]["width"] == 3
    assert saved["blocks"][0]["height"] == 1


def test_pending_qualification_block_is_a_visible_one_by_one_default():
    block = next(item for item in records.default_display_settings()["blocks"] if item["key"] == "pending_qualification")

    assert block["visible"] is True
    assert block["width"] == 1
    assert block["height"] == 1

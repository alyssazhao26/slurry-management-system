from pathlib import Path


def compact(source):
    """Ignore formatter-only whitespace in JavaScript source assertions."""
    return "".join(source.split())


def test_task_editor_uses_configured_slitting_machines():
    root = Path(__file__).parents[1]
    app_source = (root / "app" / "static" / "app.js").read_text(encoding="utf-8")
    slitting_source = (root / "app" / "static" / "slitting.js").read_text(encoding="utf-8")
    app_compact = compact(app_source)
    slitting_compact = compact(slitting_source)
    assert (
        "if(isSlitting&&window.refreshSlittingOptions)awaitwindow.refreshSlittingOptions()"
        in app_compact
    )
    assert "fetch('/api/slitting/options',{cache:'no-store'})" in slitting_compact
    assert (
        "taskMachineOptions.splice(0,taskMachineOptions.length,...slittingOptions.machine_options.map"
        in slitting_compact
    )

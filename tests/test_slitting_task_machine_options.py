from pathlib import Path


def test_task_editor_uses_configured_slitting_machines():
    root = Path(__file__).parents[1]
    app_source = (root / "app" / "static" / "app.js").read_text(encoding="utf-8")
    slitting_source = (root / "app" / "static" / "slitting.js").read_text(encoding="utf-8")
    assert "if(isSlitting&&window.refreshSlittingOptions)await window.refreshSlittingOptions()" in app_source
    assert "fetch('/api/slitting/options',{cache:'no-store'})" in slitting_source
    assert "taskMachineOptions.splice(0,taskMachineOptions.length,...slittingOptions.machine_options.map" in slitting_source

# Multi-department Desktop test

The reviewed multi-department implementation has been promoted from the Desktop test copy into this GitHub-ready project.
One Flask server serves Slurry and Slitting. Manager sign-in > Department opens the chosen view. Every tab pins its department in its URL and API headers. Inventory URLs always resolve to Slitting. Existing QR URLs on a former host require that host to redirect to the new server, or labels must be reprinted after deployment.

Configuration: IMPORT_SCHEMA (default system_import), SLITTING_DB_NAME, SLITTING_IMPORT_SCHEMA, optional SLITTING_DB_USER / SLITTING_DB_PASSWORD, QR_PUBLIC_BASE_URL. Keep production credentials outside source control. The local `.env.departments` overrides are test-only. Common migrations live directly under `migrations`; slitting-only migrations live under `migrations/departments/slitting`.

Check both departments without changing data:

    .venv\Scripts\python scripts\apply_migrations.py --status

Apply pending migrations to both configured department databases:

    .venv\Scripts\python scripts\apply_migrations.py --department all

Use `--department slurry` or `--department slitting` to migrate only one department. Each department keeps its own `schema_migrations` ledger and operational import schema.

Slitting formulas (all dimensions in metres): planned rolls × width × stations × slitting length; input rolls × coated length × coated width; output = input rolls × width × stations × slitting length; qualified = qualified output rolls × width × slitting length. Rates: output/planned, qualified/output, qualified/input. Overall and machine percentages use summed areas, not averages of percentages. Unknown qualification leaves rates pending. A zero denominator yields no rate. Each record saves input dimensions in custom_fields.slitting. Legacy rows lacking those dimensions are counted separately and excluded from area summaries, rather than interpreted as square metres.

Machine and model are independent choices. The employee production form uses the full model-name lookup. Width, coated-film length and width, stations, and slitting length are stored lookup inputs used for report calculations and are maintained by managers. Employees enter only shift, machine, model, planned input rolls, actual input rolls, and qualified output rolls.

Abnormalities keep the existing resolution, responsibility, timing and follow-up workflow. The five categories and their dependent subcategories come from screenshot 4; optional notes are stored separately and displayed with the subcategory. No invalid-time percentage is invented because shift duration / available machine hours are not defined in the supplied formulas.


## Verification on 2026-09-07

- 24 regression tests passed (`.venv\Scripts\python.exe -B -m pytest tests -q -p no:cacheprovider`).
- Live test API: production creation, pending qualification, qualified roll follow-up, manager correction, category persistence and mismatched category rejection.
- QR test: PNG generation, single and batch label pages, successful checkout and rejection of a repeated checkout.
- Browser: production submission, machine FX4/FX5 summaries, category change clearing the previous subcategory, abnormality submission/reset, inventory and compact label rendering, slurry home data and slitting display.
- JavaScript and backup PowerShell syntax checks passed. Backup execution, physical label printing, phone-camera scanning, LAN/TV connectivity and production cutover have not been performed.

Preview: http://127.0.0.1:5002/?department=slitting . To switch, sign in with the existing manager PIN, choose Department, then Show department. To restart the preview, run `.venv\Scripts\python.exe scripts\run_multi_department_preview.py` from this Desktop folder. The preview uses a distinct session cookie and listens only on localhost.

Slitting preview data is in slitting_multi_test and slitting_multi_test_import. Synthetic rows have QA-prefixed run IDs or BROWSER-QA-01 and may be used for reviewing the formula example. The former separate Desktop slitting application was removed after its inventory workflow and migration references were integrated here. Its MySQL databases were not deleted. The ChatGPT project folder was not changed.

The Slitting Daily Report is a compact share card: overall KPIs, one concise section per machine, and an abnormality timeline. **Save full report image / 保存完整报告图片** creates one PNG containing the entire selected date, including content below the visible browser area.

Before production cutover: configure the real Slitting schema names and account permissions; set QR_PUBLIC_BASE_URL to the shared HTTPS server address; back up both departments; review migration status; and test phone/TV access. Do not copy development `.env.departments`, databases, synthetic test data, logs, backups, or `.venv` into another deployment.

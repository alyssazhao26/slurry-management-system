# Slurry Management System

Factory kiosk pilot with separate **Production Records**, **Abnormality Reports**, an open-item **Tracker**, and a manager-only analysis view.

## Access model

Operators do not sign in. They may submit production/abnormality forms, see operational records, and update the responsible person or target/actual finish date on **open** tracker items. They cannot see exception analysis, recorded solutions, or resolve/close a report.

Managers unlock a separate view with `MANAGER_PIN`. It includes anomaly analysis, evidence, complete tracker information, and the future resolution workflow. The manager PIN is required in production; never use the development fallback value.

This is a controlled kiosk design. Limit the app to factory devices/network access and retain a device/location identifier before using real operational data.

## Run locally

1. Copy `.env.example` to `.env`; set a unique `SECRET_KEY`, database credentials, and `MANAGER_PIN`.
2. Create the MySQL database and least-privilege application user outside this repository. Use a database administrator account for migrations; use the restricted application account only while the website is running.
3. `python -m venv .venv` then `.venv\\Scripts\\pip install -r requirements.txt`
4. Run `.venv\\Scripts\\python scripts/apply_migrations.py` once with the administrator database credentials. Then grant the application database user `SELECT, INSERT, UPDATE` permissions on both `slurry_management.*` and `system_import.*`.
5. For the intended one-server factory deployment, keep `WEB_HOST=127.0.0.1`, `DB_HOST=127.0.0.1`, and the Caddy HTTPS gateway for employee and manager computers. The separate display server binds the server's LAN address on port 5000 and exposes only the read-only factory display over HTTP.

## Data and migration rules

The executable deployment set currently contains two files: `001_initial_schema.sql` creates the baseline, and `002_approved_feature_round.sql` applies all approved database changes from this development round in dependency order. Earlier pre-baseline history is retained under `migrations\legacy_prebaseline` for audit only and is not executed. After deployment, never edit a migration already applied to that department database; add the next unique numbered migration instead.

## Power BI import

Connect Power BI to the central MySQL server/database and select the two `system_import` source tables. For a Power BI Service refresh against local MySQL, use the standard on-premises data gateway and install Oracle MySQL Connector/NET on the gateway computer. Do not expose MySQL directly to the internet.

The rule-based analysis engine creates manager-only exceptions for low yield, under-plan output, high severity, long downtime, and incomplete reports. A future LLM may summarize this already-authorized data; it must never update records autonomously.

## Performance and maintenance

Historical production, event-tracker, and ongoing-event pages use 50-record pages and optional date/machine filters. This prevents a large history from being transferred to every browser load. MySQL connection pooling is enabled by default (`DB_POOL_SIZE=12`) for the eight-worker web server. Apply each new migration before restarting GNEM.

For the planned Power BI schedule, refresh weekly or monthly using the read-only Power BI account; this has negligible impact on the operational application. For the pilot, create backups manually from the manager workspace using **Create manual backup / 创建手动备份**. It writes a timestamped SQL backup to `BACKUP_DIRECTORY` (default `C:\GNEM_Backups`) on the server. The optional `scripts\install_maintenance_tasks.ps1` scheduler is reserved for a later production phase after a separate backup account and protected backup location are configured.

## Availability truth

The default is one always-on factory server running both the employee web app and MySQL locally. Manager, AI, and Power BI computers may be switched off without stopping data entry; they read from the server using separate read-only database accounts. The factory server must remain on for employee entry and SQL saving. The current app displays a failed-save message if it is unavailable; it does not yet retain records in a browser offline queue.

## Starting after a restart

IT should run `scripts\install_autostart_task.ps1` once as an administrator with a dedicated non-administrator Windows service account. After that, Windows starts GNEM automatically after every reboot. For manual control, use the single Desktop launcher **GNEM Server Control Panel.cmd**. Its Start, Restart, and Stop buttons control the HTTPS application, Caddy gateway, and separate HTTP display; MySQL stays running and stored records are unchanged.

After an approved code/UI update, use `Restart_GNEM_Slurry_Tracker.cmd` and refresh the browser with `Ctrl + F5`. The normal Start shortcut does not restart a running server.

## Department display

Open `http://172.23.19.139:5000/display` on the department screen. This separate read-only HTTP service does not depend on Caddy, while employee and manager computers continue using `https://slurry-management.local`. The display refreshes from SQL every 15 seconds. The first row shows **Today's task / 今日任务**, achievement rate, and qualified rate. The task is strictly today's task; both rates use the latest date with production records so that end-of-day and pending qualification entry do not make the screen look empty. Machine cards are cumulative actual/plan/event totals, followed by the ongoing issue tracker and the selected day's event details.

Only a manager can edit the task: open **Manager workspace**, unlock it, complete **Today's task / 今日任务**, and save. Select one or more task types (Production, Cleaning, Custom). Selecting Production reveals the Formula and Amount needed fields; selecting Custom reveals its description field. The read-only display updates automatically after the save.

## Where submitted records are stored

The application writes live reporting records to `system_import.production_records` and `system_import.abnormality_reports`. `slurry_management.audit_events` records that an action occurred; it is not the production-record table. Do not use the older `slurry_management.production_records` table to verify kiosk submissions.

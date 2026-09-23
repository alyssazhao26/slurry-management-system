# Database migrations

Migration filenames are ordered by scope:

- `001`-`009`: shared schema used by every stored-data department.
- `010`-`019`: Slitting schema.
- `020`-`029`: Slurry-only schema, including attendance.

Coating is intentionally absent. It is a read-only display that uses Slitting's
configured database and does not own a schema or store data.

## Deployment compatibility

Applied migration filenames are permanent deployment history. When a file is
renamed for this cleaned sequence, `scripts/apply_migrations.py` maps its new
name to the historical filename through `MIGRATION_ALIASES`. Consolidated files
use `LEGACY_MIGRATION_SEQUENCES` and are considered applied only when the entire
older sequence is recorded. This prevents both replay and false matches against
partially upgraded databases.

Before deployment, run:

```powershell
.\.venv\Scripts\python.exe scripts\apply_migrations.py --department all --status
```

Review every `PENDING` entry before running the same command without `--status`.
Never edit an already deployed migration's SQL. Add the next unused number in
the appropriate range and add tests for both a fresh ledger and any required
historical filename aliases.

"""Fast, database-free release gate used before a staging or production deployment."""
from __future__ import annotations

import ast
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = (
    "README.md", "requirements.txt", "main.py", ".env.example",
    "documentation/01_deployment.html", "documentation/07_release_pipeline.html",
    "documentation/index.html", "documentation/assets/docs.css",
    "deployment/environments/.env.development.example",
    "deployment/environments/.env.test.example",
    "deployment/environments/.env.production.example",
)


def main() -> int:
    missing = [path for path in REQUIRED if not (ROOT / path).is_file()]
    if missing:
        print("Missing release files:", ", ".join(missing))
        return 1
    migration_numbers = []
    for migration in sorted((ROOT / "migrations").glob("*.sql")):
        prefix = migration.name.split("_", 1)[0]
        if not prefix.isdigit() or len(prefix) != 3:
            print(f"Invalid migration filename: {migration.name}")
            return 1
        migration_numbers.append(int(prefix))
    if migration_numbers != sorted(set(migration_numbers)):
        print("Migration numbers must be unique and ordered.")
        return 1
    for source in ROOT.rglob("*.py"):
        if ".venv" not in source.parts:
            ast.parse(source.read_text(encoding="utf-8"), filename=str(source))
    print("Release verification passed: files, migrations, and Python syntax are valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

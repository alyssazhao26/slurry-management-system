"""Manager-only manual backup boundary.

The PowerShell script reads database credentials from the server's private .env
file. Browser requests never receive credentials or the backup file itself.
"""

from pathlib import Path
from subprocess import CalledProcessError, TimeoutExpired, run
from threading import Lock


PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKUP_SCRIPT = PROJECT_ROOT / "scripts" / "backup_factory_database.ps1"
BACKUP_TIMEOUT_SECONDS = 300
BACKUP_LOCK = Lock()


def run_manual_backup() -> str:
    """Run one local backup and return a safe operator-facing success message."""
    if not BACKUP_SCRIPT.is_file():
        raise RuntimeError("Backup script is missing. Contact IT.")

    if not BACKUP_LOCK.acquire(blocking=False):
        raise RuntimeError("A backup is already running. Please wait for it to finish.")

    try:
        try:
            run(
                [
                    "PowerShell.exe",
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    str(BACKUP_SCRIPT),
                ],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
                timeout=BACKUP_TIMEOUT_SECONDS,
                check=True,
            )
        except TimeoutExpired as exc:
            raise RuntimeError("Backup did not finish within five minutes. Check the server.") from exc
        except CalledProcessError as exc:
            # Do not return raw PowerShell output: it can reveal server paths or settings.
            raise RuntimeError("Backup failed. Check the server backup log or configuration.") from exc
    finally:
        BACKUP_LOCK.release()

    return "Backup completed. The server stored it in the configured backup folder."

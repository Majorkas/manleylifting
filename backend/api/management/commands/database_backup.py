import sqlite3
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.db import connection
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Create a SQLite SQL dump backup for the configured application database."

    def add_arguments(self, parser):
        parser.add_argument(
            "--output",
            dest="output",
            default="",
            help="Destination path for the SQL dump file.",
        )

    def handle(self, *args, **options):
        database = settings.DATABASES["default"]
        engine = database.get("ENGINE", "")
        if engine != "django.db.backends.sqlite3":
            raise RuntimeError("database_backup is only supported for SQLite databases")

        if options["output"]:
            destination = Path(options["output"]).expanduser()
        else:
            backup_dir = Path(settings.BASE_DIR) / "backups"
            backup_dir.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
            destination = backup_dir / f"database-backup-{timestamp}.sql"

        if not destination.parent.exists():
            destination.parent.mkdir(parents=True, exist_ok=True)

        source = getattr(connection, "connection", None)
        if source is None:
            raise RuntimeError("No active SQLite database connection is available for backup")

        temp_db = destination.with_suffix(destination.suffix + ".tmp.db")
        backup_conn = sqlite3.connect(str(temp_db))
        try:
            source.backup(backup_conn)
            backup_conn.commit()
            dump = "\n".join(backup_conn.iterdump())
        finally:
            backup_conn.close()

        destination.write_text(dump + "\n", encoding="utf-8")
        if temp_db.exists():
            temp_db.unlink()

        self.stdout.write(self.style.SUCCESS(f"Database backup created at {destination}"))

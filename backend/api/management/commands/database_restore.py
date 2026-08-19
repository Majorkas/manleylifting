import sqlite3
from pathlib import Path

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Restore a SQLite SQL dump archive to a target database file for a restore drill."

    def add_arguments(self, parser):
        parser.add_argument("--backup", dest="backup", required=True, help="Path to the SQL backup file.")
        parser.add_argument("--target", dest="target", required=True, help="Path to the restored SQLite database file.")

    def handle(self, *args, **options):
        backup_path = Path(options["backup"]).expanduser()
        target_path = Path(options["target"]).expanduser()

        if not backup_path.exists():
            raise FileNotFoundError(f"Backup file does not exist: {backup_path}")

        if target_path.exists():
            target_path.unlink()

        target_path.parent.mkdir(parents=True, exist_ok=True)

        with sqlite3.connect(str(target_path)) as connection:
            with backup_path.open("r", encoding="utf-8") as source:
                sql = source.read()
            connection.executescript(sql)
            connection.commit()

        self.stdout.write(self.style.SUCCESS(f"Database restore complete: {target_path}"))

"""Wraps Django's built-in ``migrate`` command to repair a stale Postgres
index before running the real migration chain.

Why this exists (see backend/api/migrations/0032_onsiteorder_order_number.py):
Migration 0032 runs atomically. If the deferred ``CREATE INDEX`` it relies on
fails at the very end, Django's schema_editor.__exit__ raises *before* it ever
reaches the line that closes the wrapping transaction, so Postgres is left
holding an open transaction that gets rolled back the moment the failing
``manage.py migrate`` process exits. That rollback undoes *everything* run
inside that same migration - including any repair statement placed as an
earlier operation in the same migration's operations list. A repair only
sticks if it runs and commits completely independently of migration 0032's
own transaction, which is what this command wrapper guarantees: the DROP
INDEX below executes and auto-commits (Django connections default to
autocommit) before ``super().handle()`` ever starts migration 0032.
"""

from django.core.management.commands.migrate import Command as MigrateCommand
from django.db import connections
from django.db.migrations.recorder import MigrationRecorder

STALE_INDEX_TABLE = "api_onsiteorder"
STALE_INDEX_PREFIX = "api_onsiteorder_order_number"
ORDER_NUMBER_MIGRATION = ("api", "0032_onsiteorder_order_number")


def repair_stale_order_number_indexes(using="default"):
    connection = connections[using]
    if connection.vendor != "postgresql":
        return 0
    if ORDER_NUMBER_MIGRATION in MigrationRecorder(connection).applied_migrations():
        return 0
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT schemaname, indexname FROM pg_indexes "
            "WHERE tablename = %s AND indexname LIKE %s",
            [STALE_INDEX_TABLE, f"{STALE_INDEX_PREFIX}%"],
        )
        stale_indexes = cursor.fetchall()
        for schema_name, index_name in stale_indexes:
            cursor.execute(
                "DROP INDEX IF EXISTS "
                f"{connection.ops.quote_name(schema_name)}."
                f"{connection.ops.quote_name(index_name)} CASCADE;"
            )
    connection.commit()
    return len(stale_indexes)


class Command(MigrateCommand):
    def handle(self, *args, **options):
        if not any(options.get(flag) for flag in ("plan", "check", "fake")):
            database = options.get("database") or "default"
            repaired_count = repair_stale_order_number_indexes(using=database)
            if repaired_count:
                self.stdout.write(
                    self.style.WARNING(
                        f"Removed {repaired_count} stale order_number index(es)."
                    )
                )
        return super().handle(*args, **options)

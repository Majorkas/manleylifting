from collections import defaultdict

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email


class Command(BaseCommand):
    help = "Audit user emails before enabling case-insensitive email identity."

    def handle(self, *args, **options):
        users = get_user_model().objects.order_by("pk").values("pk", "username", "email")
        missing = []
        invalid = []
        noncanonical = []
        users_by_email = defaultdict(list)
        total_users = 0

        for user in users.iterator():
            total_users += 1
            reference = f"user_id={user['pk']} username={user['username']!r}"
            stored_email = str(user["email"] or "")
            canonical_email = stored_email.strip().lower()

            if not canonical_email:
                missing.append(reference)
                continue

            try:
                validate_email(canonical_email)
            except ValidationError:
                invalid.append(reference)
                continue

            users_by_email[canonical_email].append(reference)
            if stored_email != canonical_email:
                noncanonical.append(reference)

        duplicate_groups = [
            references
            for references in users_by_email.values()
            if len(references) > 1
        ]

        self.stdout.write(f"Audited {total_users} user account(s).")
        self._write_user_findings("Missing email", missing)
        self._write_user_findings("Invalid email", invalid)
        self._write_user_findings("Non-canonical email", noncanonical)
        self._write_duplicate_findings(duplicate_groups)

        if missing or invalid or noncanonical or duplicate_groups:
            raise CommandError(
                "Email identity audit failed. Resolve every finding before enabling "
                "email login or commerce registration."
            )

        self.stdout.write(self.style.SUCCESS("Email identity audit passed."))

    def _write_user_findings(self, label, references):
        self.stdout.write(f"{label}: {len(references)}")
        for reference in references:
            self.stdout.write(f"  - {reference}")

    def _write_duplicate_findings(self, duplicate_groups):
        self.stdout.write(f"Duplicate email groups: {len(duplicate_groups)}")
        for group_number, references in enumerate(duplicate_groups, start=1):
            self.stdout.write(f"  - group {group_number}: {'; '.join(references)}")

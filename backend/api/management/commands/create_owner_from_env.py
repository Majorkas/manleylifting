import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api.models import UserProfile


class Command(BaseCommand):
    help = "Create or update an owner account from environment variables."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force-password",
            action="store_true",
            help="Always reset the password from OWNER_PASSWORD, even if the user exists.",
        )

    def handle(self, *args, **options):
        username = os.getenv("OWNER_USERNAME", "").strip()
        email = os.getenv("OWNER_EMAIL", "").strip()
        password = os.getenv("OWNER_PASSWORD", "").strip()
        first_name = os.getenv("OWNER_FIRST_NAME", "").strip()
        last_name = os.getenv("OWNER_LAST_NAME", "").strip()
        force_password = options.get("force_password", False)

        missing = [
            name
            for name, value in (
                ("OWNER_USERNAME", username),
                ("OWNER_EMAIL", email),
                ("OWNER_PASSWORD", password),
            )
            if not value
        ]
        if missing:
            raise CommandError(
                "Missing required environment variable(s): " + ", ".join(missing)
            )

        User = get_user_model()

        with transaction.atomic():
            user, created = User.objects.get_or_create(
                username=username,
                defaults={
                    "email": email,
                    "first_name": first_name,
                    "last_name": last_name,
                    "is_staff": True,
                    "is_superuser": True,
                    "is_active": True,
                },
            )

            details_changed = False

            if user.email != email:
                user.email = email
                details_changed = True

            if first_name and user.first_name != first_name:
                user.first_name = first_name
                details_changed = True

            if last_name and user.last_name != last_name:
                user.last_name = last_name
                details_changed = True

            if not user.is_staff:
                user.is_staff = True
                details_changed = True

            if not user.is_superuser:
                user.is_superuser = True
                details_changed = True

            if not user.is_active:
                user.is_active = True
                details_changed = True

            password_changed = False
            if created or force_password:
                user.set_password(password)
                details_changed = True
                password_changed = True

            if details_changed:
                user.save()

            profile, _ = UserProfile.objects.get_or_create(user=user)
            if profile.role != UserProfile.ROLE_OWNER:
                profile.role = UserProfile.ROLE_OWNER
                profile.save(update_fields=["role", "updated_at"])

        if created:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Created owner account '{username}' with role '{UserProfile.ROLE_OWNER}'."
                )
            )
            return

        if password_changed:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Updated owner account '{username}' and reset password."
                )
            )
            return

        self.stdout.write(
            self.style.SUCCESS(
                f"Verified owner account '{username}' and ensured owner role."
            )
        )

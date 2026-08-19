from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from api.models import ProcessedStripeEvent


class Command(BaseCommand):
    help = "Flag operational alerts for failed Stripe webhook processing and related health conditions."

    def add_arguments(self, parser):
        parser.add_argument("--stale-minutes", type=int, default=60)

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(minutes=max(1, options["stale_minutes"]))

        stripe_errors = list(
            ProcessedStripeEvent.objects.filter(
                status=ProcessedStripeEvent.STATUS_ERROR,
                created_at__gte=cutoff,
            ).order_by("-created_at").values_list("event_id", "event_type", "error_message")
        )

        alert = "required" if stripe_errors else "clear"
        self.stdout.write(
            self.style.WARNING(f"alert={alert} stripe_errors={len(stripe_errors)}")
        )

        for event_id, event_type, error_message in stripe_errors:
            self.stdout.write(f"stripe_errors {event_id} {event_type}: {error_message}")

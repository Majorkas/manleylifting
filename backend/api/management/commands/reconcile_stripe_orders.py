from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from api.models import OnsiteOrder


class Command(BaseCommand):
    help = "Report stale pending or processing orders that may need Stripe reconciliation."

    def add_arguments(self, parser):
        parser.add_argument("--stale-minutes", type=int, default=60)

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(minutes=max(1, options["stale_minutes"]))
        orders = OnsiteOrder.objects.filter(
            status__in=[OnsiteOrder.STATUS_PENDING, OnsiteOrder.STATUS_PROCESSING],
            payment_intent_id__gt="",
            updated_at__lt=cutoff,
        ).order_by("updated_at")
        count = orders.count()
        self.stdout.write(f"Found {count} stale Stripe order(s).")
        for order in orders:
            self.stdout.write(
                f"{order.order_number} checkout_ref={order.checkout_ref} "
                f"payment_intent_id={order.payment_intent_id} status={order.status} "
                f"updated_at={order.updated_at.isoformat()}"
            )

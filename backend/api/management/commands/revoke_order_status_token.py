from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from api.models import OnsiteOrder


class Command(BaseCommand):
    help = "Revoke the status capability for an order."

    def add_arguments(self, parser):
        parser.add_argument("--order-number", required=True)

    def handle(self, *args, **options):
        order_number = str(options["order_number"] or "").strip()
        try:
            order = OnsiteOrder.objects.get(order_number=order_number)
        except OnsiteOrder.DoesNotExist as error:
            raise CommandError(f"Order not found: {order_number}") from error

        if order.status_token_revoked_at is None:
            order.status_token_revoked_at = timezone.now()
            order.save(update_fields=["status_token_revoked_at", "updated_at"])

        self.stdout.write(
            self.style.SUCCESS(f"Status token revoked for {order.order_number}")
        )

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from api.models import CatalogProduct, OnsiteOrder


class Command(BaseCommand):
    help = "Report stale orders, low inventory, and operational alerts for M12 monitoring readiness."

    def add_arguments(self, parser):
        parser.add_argument("--stale-minutes", type=int, default=60)
        parser.add_argument("--low-inventory-threshold", type=int, default=2)

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(minutes=max(1, options["stale_minutes"]))

        stale_orders = list(
            OnsiteOrder.objects.filter(
                status__in=[OnsiteOrder.STATUS_PENDING, OnsiteOrder.STATUS_PROCESSING],
                payment_intent_id__gt="",
                updated_at__lt=cutoff,
            ).order_by("updated_at").values_list("checkout_ref", "updated_at")
        )

        low_inventory = list(
            CatalogProduct.objects.filter(
                inventory_tracked=True,
                available_qty__lte=options["low_inventory_threshold"],
            ).order_by("handle").values_list("handle", "available_qty", "reserved_qty")
        )

        alert_needed = bool(stale_orders or low_inventory)
        summary = {
            "alert": "required" if alert_needed else "clear",
            "stale_orders": len(stale_orders),
            "low_inventory": len(low_inventory),
            "stale_order_refs": [checkout_ref for checkout_ref, _ in stale_orders],
            "low_inventory_items": [
                {"handle": handle, "available_qty": available_qty, "reserved_qty": reserved_qty}
                for handle, available_qty, reserved_qty in low_inventory
            ],
        }

        self.stdout.write(self.style.WARNING(f"alert={summary['alert']} stale_orders={summary['stale_orders']} low_inventory={summary['low_inventory']}"))
        if stale_orders:
            self.stdout.write(f"Stale orders detected: {', '.join(summary['stale_order_refs'])}")
        if low_inventory:
            self.stdout.write("Low inventory detected.")

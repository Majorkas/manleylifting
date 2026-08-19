from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from api.models import CatalogProduct, InventoryReservation, InventoryTransaction


class Command(BaseCommand):
    help = "Release expired inventory reservations and restore reserved quantities."

    def handle(self, *args, **options):
        now = timezone.now()
        released = 0
        with transaction.atomic():
            reservations = InventoryReservation.objects.select_for_update().select_related("product").filter(
                status=InventoryReservation.STATUS_RESERVED,
                expires_at__isnull=False,
                expires_at__lte=now,
            )
            for reservation in reservations:
                product = CatalogProduct.objects.select_for_update().get(pk=reservation.product_id)
                inventory_tracked = product.inventory_tracked or product.stock_policy == product.STOCK_POLICY_FINITE
                if inventory_tracked:
                    product.reserved_qty = max(0, product.reserved_qty - reservation.quantity)
                    product.save(update_fields=["reserved_qty", "updated_at"])
                reservation.status = InventoryReservation.STATUS_RELEASED
                reservation.released_at = now
                reservation.save(update_fields=["status", "released_at"])
                InventoryTransaction.objects.create(
                    product=product,
                    order=reservation.order,
                    transaction_type=InventoryTransaction.TYPE_RETURN,
                    quantity_change=reservation.quantity,
                    reason="Reservation expired",
                )
                released += 1
        self.stdout.write(self.style.SUCCESS(f"Released {released} reservation(s)."))

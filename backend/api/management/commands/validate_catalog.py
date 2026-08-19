from django.core.management.base import BaseCommand, CommandError

from api.models import CatalogProduct


class Command(BaseCommand):
    help = "Validate active catalog products before a production release."

    def handle(self, *args, **options):
        findings = []
        products = CatalogProduct.objects.filter(is_active=True).order_by("handle")

        for product in products.iterator():
            missing = []
            if not product.image_url or not product.image_alt:
                missing.append("image")
            if product.price_amount <= 0:
                missing.append("price")
            if product.currency_code != "EUR":
                missing.append("currency")
            if not product.shipping_class or not product.weight_grams:
                missing.append("shipping")
            if (
                product.stock_policy != CatalogProduct.STOCK_POLICY_FINITE
                or not product.inventory_tracked
                or not product.sku
                or product.reserved_qty > product.available_qty
            ):
                missing.append("stock")

            if missing:
                findings.append(f"{product.handle}: missing or invalid {', '.join(missing)}")

        self.stdout.write(f"Validated {products.count()} active catalog product(s).")
        if findings:
            for finding in findings:
                self.stdout.write(f"  - {finding}")
            raise CommandError("Catalog validation failed: " + "; ".join(findings))

        self.stdout.write(self.style.SUCCESS("Catalog validation passed."))

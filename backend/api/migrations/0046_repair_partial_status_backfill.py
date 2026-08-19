from django.db import migrations, transaction


def repair_partial_status_fields(apps, schema_editor):
    OnsiteOrder = apps.get_model("api", "OnsiteOrder")
    status_mapping = {
        "pending": ("pending", "unfulfilled"),
        "processing": ("processing", "processing"),
        "paid": ("paid", "unfulfilled"),
        "shipped": ("paid", "shipped"),
        "completed": ("paid", "delivered"),
        "failed": ("failed", "canceled"),
        "canceled": ("canceled", "canceled"),
    }

    with transaction.atomic():
        queryset = OnsiteOrder.objects.filter(
            payment_status__isnull=True,
        ).order_by("pk")
        for order in queryset.iterator(chunk_size=500):
            payment_status, _ = status_mapping.get(
                order.status,
                ("pending", "unfulfilled"),
            )
            OnsiteOrder.objects.filter(pk=order.pk).update(payment_status=payment_status)

        queryset = OnsiteOrder.objects.filter(
            fulfillment_status__isnull=True,
        ).order_by("pk")
        for order in queryset.iterator(chunk_size=500):
            _, fulfillment_status = status_mapping.get(
                order.status,
                ("pending", "unfulfilled"),
            )
            OnsiteOrder.objects.filter(pk=order.pk).update(fulfillment_status=fulfillment_status)


def reverse_repair(apps, schema_editor):
    OnsiteOrder = apps.get_model("api", "OnsiteOrder")
    OnsiteOrder.objects.update(payment_status=None, fulfillment_status=None)


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0045_alter_inventoryreservation_order_and_more"),
    ]

    operations = [
        migrations.RunPython(repair_partial_status_fields, reverse_repair),
    ]

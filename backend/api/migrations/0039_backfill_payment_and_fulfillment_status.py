# Generated migration for M2 Phase 1B: Backfill payment_status and fulfillment_status

from django.db import migrations, transaction


def backfill_status_fields(apps, schema_editor):
    """
    Backfill payment_status and fulfillment_status from legacy status field.
    Uses the OnsiteOrder model's mapping methods to ensure consistency.
    Batches updates every 500 rows for performance and memory safety.
    Idempotent: skips rows where both new fields already have values.
    """
    OnsiteOrder = apps.get_model('api', 'OnsiteOrder')
    
    # Fetch all orders without explicit status split
    queryset = OnsiteOrder.objects.filter(
        payment_status__isnull=True,
        fulfillment_status__isnull=True
    )
    
    total_count = queryset.count()
    if total_count == 0:
        return  # Already backfilled
    
    # Map legacy status to new fields
    status_mapping = {
        'pending': ('pending', 'unfulfilled'),
        'processing': ('processing', 'processing'),
        'paid': ('paid', 'unfulfilled'),
        'shipped': ('paid', 'shipped'),
        'completed': ('paid', 'delivered'),
        'failed': ('failed', 'canceled'),
        'canceled': ('canceled', 'canceled'),
    }
    
    # Use atomic transaction to ensure consistency: all-or-nothing backfill
    with transaction.atomic():
        batch_size = 500
        processed = 0
        batches_logged = 0
        last_pk = -1
        
        while True:
            # Use pk-based filtering (not offset slicing) for O(n) performance on large tables
            batch = queryset.filter(pk__gt=last_pk)[:batch_size]
            batch_list = list(batch)
            
            if not batch_list:
                break
            
            for order in batch_list:
                payment_status, fulfillment_status = status_mapping.get(
                    order.status,
                    ('pending', 'unfulfilled')
                )
                order.payment_status = payment_status
                order.fulfillment_status = fulfillment_status
                last_pk = order.pk
            
            # Bulk update to avoid repeated DB round-trips
            OnsiteOrder.objects.bulk_update(
                batch_list,
                ['payment_status', 'fulfillment_status'],
                batch_size=batch_size
            )
            
            processed += len(batch_list)
            batches_logged += 1
            
            # Log progress every 10 batches (every 5000 rows at default batch_size=500)
            if batches_logged % 10 == 0:
                print(f"  Backfilled {processed}/{total_count} OnsiteOrder rows...")


def reverse_backfill(apps, schema_editor):
    """
    Reverse: Clear the backfilled status fields.
    This is a one-way migration; we refuse to drop the new columns.
    """
    OnsiteOrder = apps.get_model('api', 'OnsiteOrder')
    OnsiteOrder.objects.all().update(payment_status=None, fulfillment_status=None)


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0038_onsiteorder_fulfillment_status_and_more'),
    ]

    operations = [
        migrations.RunPython(backfill_status_fields, reverse_backfill),
    ]

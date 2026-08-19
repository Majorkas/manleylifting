import hashlib
import re

from django.db import migrations


def digest_capability_token(raw_token):
    return hashlib.sha256(str(raw_token).encode("utf-8")).hexdigest()


TOKEN_DIGEST_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def hash_model_tokens(model, field_name):
    pending_updates = []
    queryset = model.objects.exclude(**{field_name: ""}).only("pk", field_name)
    for instance in queryset.iterator(chunk_size=500):
        token = str(getattr(instance, field_name) or "")
        if TOKEN_DIGEST_PATTERN.fullmatch(token):
            continue
        setattr(instance, field_name, digest_capability_token(token))
        pending_updates.append(instance)
        if len(pending_updates) >= 500:
            model.objects.bulk_update(pending_updates, [field_name], batch_size=500)
            pending_updates.clear()
    if pending_updates:
        model.objects.bulk_update(pending_updates, [field_name], batch_size=500)


def hash_existing_capability_tokens(apps, schema_editor):
    OnsiteOrder = apps.get_model("api", "OnsiteOrder")
    GuestOrderClaim = apps.get_model("api", "GuestOrderClaim")
    PendingCheckout = apps.get_model("api", "PendingCheckout")

    hash_model_tokens(OnsiteOrder, "status_token")
    hash_model_tokens(GuestOrderClaim, "claim_token")
    hash_model_tokens(PendingCheckout, "status_token")


def refuse_reverse(apps, schema_editor):
    raise RuntimeError(
        "Migration 0037 is a one-way token hash backfill. "
        "Restore a pre-migration database backup instead of reversing it."
    )


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0036_remove_onsiteorder_payment_client_secret"),
    ]

    operations = [
        migrations.RunPython(hash_existing_capability_tokens, refuse_reverse),
    ]
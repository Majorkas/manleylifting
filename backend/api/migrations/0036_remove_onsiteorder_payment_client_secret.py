from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0035_onsiteorder_fulfillment_statuses"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="onsiteorder",
            name="payment_client_secret",
        ),
    ]
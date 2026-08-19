from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0054_onsiteorder_status_token_expires_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="onsiteorder",
            name="status_token_revoked_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
    ]

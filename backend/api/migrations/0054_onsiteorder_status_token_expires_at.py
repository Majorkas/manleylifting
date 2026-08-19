from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0053_orderemaildelivery"),
    ]

    operations = [
        migrations.AddField(
            model_name="onsiteorder",
            name="status_token_expires_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
    ]

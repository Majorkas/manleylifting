from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0013_auditlog"),
    ]

    operations = [
        migrations.AddField(
            model_name="inspectionreport",
            name="checklist_items",
            field=models.JSONField(blank=True, default=list),
        ),
    ]

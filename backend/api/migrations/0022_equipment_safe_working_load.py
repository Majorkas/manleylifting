from django.db import migrations, models


def backfill_safe_working_load(apps, schema_editor):
    Equipment = apps.get_model("api", "Equipment")
    Equipment.objects.filter(safe_working_load__isnull=True).update(safe_working_load="Not Recorded")
    Equipment.objects.filter(safe_working_load="").update(safe_working_load="Not Recorded")


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0021_certificate_site"),
    ]

    operations = [
        migrations.AddField(
            model_name="equipment",
            name="safe_working_load",
            field=models.CharField(default="Not Recorded", max_length=120),
        ),
        migrations.RunPython(backfill_safe_working_load, migrations.RunPython.noop),
    ]

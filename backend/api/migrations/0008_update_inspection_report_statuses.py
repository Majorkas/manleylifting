from django.db import migrations, models


def migrate_final_to_approved(apps, schema_editor):
    InspectionReport = apps.get_model("api", "InspectionReport")
    InspectionReport.objects.filter(status="final").update(status="approved")


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0007_company_equipment_inspectionreport_certificate_and_more"),
    ]

    operations = [
        migrations.RunPython(migrate_final_to_approved, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="inspectionreport",
            name="status",
            field=models.CharField(
                choices=[("draft", "Draft"), ("submitted", "Submitted"), ("approved", "Approved")],
                default="draft",
                max_length=20,
            ),
        ),
    ]

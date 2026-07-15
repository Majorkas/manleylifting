from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0014_inspectionreport_checklist_items"),
    ]

    operations = [
        migrations.AddField(
            model_name="certificate",
            name="deleted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="certificate",
            name="deleted_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="deleted_certificates",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="certificate",
            name="is_deleted",
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name="certificate",
            name="recovery_expires_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name="certificate",
            index=models.Index(fields=["company", "is_deleted", "created_at"], name="api_certifi_company_454d1c_idx"),
        ),
        migrations.AddIndex(
            model_name="certificate",
            index=models.Index(fields=["recovery_expires_at"], name="api_certifi_recover_4bf919_idx"),
        ),
    ]

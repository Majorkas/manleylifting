from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0016_rename_api_certifi_company_454d1c_idx_api_certifi_company_282caa_idx_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="inspectionreport",
            name="deleted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="inspectionreport",
            name="deleted_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="deleted_reports",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="inspectionreport",
            name="is_deleted",
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name="inspectionreport",
            name="recovery_expires_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name="inspectionreport",
            index=models.Index(
                fields=["equipment", "is_deleted", "updated_at"],
                name="api_insprep_equ_del_upd_idx",
            ),
        ),
    ]

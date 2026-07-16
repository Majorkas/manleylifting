from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0020_reportimage_checklist_label"),
    ]

    operations = [
        migrations.AddField(
            model_name="certificate",
            name="site",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="certificates",
                to="api.site",
            ),
        ),
    ]

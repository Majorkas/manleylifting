from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0019_rename_api_equipme_compan_95d5d7_idx_api_equipme_company_817c7b_idx_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="reportimage",
            name="checklist_label",
            field=models.CharField(blank=True, default="", max_length=220),
        ),
    ]

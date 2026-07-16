from django.db import migrations, models
import django.db.models.deletion


def seed_sites_for_existing_companies(apps, schema_editor):
    Company = apps.get_model("api", "Company")
    Equipment = apps.get_model("api", "Equipment")
    Site = apps.get_model("api", "Site")

    site_by_company_id = {}
    for company in Company.objects.all().iterator():
        site = Site.objects.create(
            company=company,
            name="Main Site",
            address=company.address or "",
        )
        site_by_company_id[company.id] = site.id

    for equipment in Equipment.objects.all().iterator():
        site_id = site_by_company_id.get(equipment.company_id)
        if site_id:
            Equipment.objects.filter(id=equipment.id).update(site_id=site_id)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0017_inspectionreport_soft_delete"),
    ]

    operations = [
        migrations.CreateModel(
            name="Site",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=200)),
                ("address", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="sites", to="api.company"),
                ),
            ],
            options={
                "ordering": ["name", "id"],
            },
        ),
        migrations.AddConstraint(
            model_name="site",
            constraint=models.UniqueConstraint(fields=("company", "name"), name="unique_site_name_per_company"),
        ),
        migrations.AddField(
            model_name="equipment",
            name="site",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="equipment",
                to="api.site",
            ),
        ),
        migrations.RunPython(seed_sites_for_existing_companies, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="equipment",
            name="site",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="equipment",
                to="api.site",
            ),
        ),
        migrations.AddIndex(
            model_name="equipment",
            index=models.Index(fields=["company", "site", "status"], name="api_equipme_compan_95d5d7_idx"),
        ),
    ]

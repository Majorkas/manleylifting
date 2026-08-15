from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0034_accountsession_device_metadata"),
    ]

    operations = [
        migrations.AlterField(
            model_name="onsiteorder",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("processing", "Processing"),
                    ("paid", "Paid"),
                    ("shipped", "Shipped"),
                    ("completed", "Completed"),
                    ("failed", "Failed"),
                    ("canceled", "Canceled"),
                ],
                default="pending",
                max_length=20,
            ),
        ),
    ]

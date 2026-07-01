from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0005_catalogcollection_catalogproduct"),
    ]

    operations = [
        migrations.RenameField(
            model_name="pendingcheckout",
            old_name="shopify_cart_id",
            new_name="provider_cart_id",
        ),
        migrations.RenameField(
            model_name="catalogproduct",
            old_name="shopify_product_id",
            new_name="product_ref",
        ),
        migrations.RenameField(
            model_name="catalogproduct",
            old_name="shopify_variant_id",
            new_name="variant_ref",
        ),
    ]

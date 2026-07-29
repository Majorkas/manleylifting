from collections import Counter

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import migrations


INDEX_NAME = "auth_user_identity_email_ci_uniq"


def validate_identity_emails(apps, schema_editor):
    app_label, model_name = settings.AUTH_USER_MODEL.split(".", 1)
    user_model = apps.get_model(app_label, model_name)
    counts = Counter()
    normalized_counts = Counter()

    for user in user_model.objects.order_by("pk").only("email").iterator():
        stored_email = str(user.email or "")
        normalized_email = stored_email.strip().lower()

        if not normalized_email:
            counts["missing"] += 1
            continue

        try:
            validate_email(normalized_email)
        except ValidationError:
            counts["invalid"] += 1
            continue

        if stored_email != normalized_email:
            counts["noncanonical"] += 1
        normalized_counts[normalized_email] += 1

    counts["duplicate_groups"] = sum(
        1 for email_count in normalized_counts.values() if email_count > 1
    )
    if any(counts.values()):
        raise RuntimeError(
            "Identity email migration blocked: "
            f"missing={counts['missing']}, invalid={counts['invalid']}, "
            f"noncanonical={counts['noncanonical']}, "
            f"duplicate_groups={counts['duplicate_groups']}. "
            "Run audit_identity_emails and resolve every finding first."
        )


def create_identity_email_index(apps, schema_editor):
    app_label, model_name = settings.AUTH_USER_MODEL.split(".", 1)
    user_model = apps.get_model(app_label, model_name)
    quote_name = schema_editor.quote_name
    table_name = quote_name(user_model._meta.db_table)
    email_column = quote_name("email")
    index_name = quote_name(INDEX_NAME)
    schema_editor.execute(
        f"CREATE UNIQUE INDEX {index_name} ON {table_name} "
        f"(LOWER(TRIM({email_column}))) WHERE TRIM({email_column}) <> ''"
    )


def drop_identity_email_index(apps, schema_editor):
    schema_editor.execute(
        f"DROP INDEX IF EXISTS {schema_editor.quote_name(INDEX_NAME)}"
    )


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0023_commercecustomerprofile"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.RunPython(validate_identity_emails, migrations.RunPython.noop),
        migrations.RunPython(create_identity_email_index, drop_identity_email_index),
    ]
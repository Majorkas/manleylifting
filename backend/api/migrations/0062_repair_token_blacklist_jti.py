import base64
import json

from django.db import migrations


TABLE_NAME = "token_blacklist_outstandingtoken"


def quote_identifier(connection, value):
    return connection.ops.quote_name(value)


def table_columns(connection):
    with connection.cursor() as cursor:
        return {
            column.name
            for column in connection.introspection.get_table_description(
                cursor, TABLE_NAME
            )
        }


def token_jti(token):
    try:
        payload = token.split(".")[1]
        padding = "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload + padding))
        return str(claims.get("jti") or "")
    except (AttributeError, IndexError, TypeError, ValueError, json.JSONDecodeError):
        return ""


def repair_outstanding_token_jti(apps, schema_editor):
    connection = schema_editor.connection
    columns = table_columns(connection)
    if "jti" not in columns:
        with connection.cursor() as cursor:
            if "jti_hex" in columns:
                cursor.execute(
                    f"ALTER TABLE {quote_identifier(connection, TABLE_NAME)} "
                    f"RENAME COLUMN {quote_identifier(connection, 'jti_hex')} "
                    f"TO {quote_identifier(connection, 'jti')}"
                )
            else:
                cursor.execute(
                    f"ALTER TABLE {quote_identifier(connection, TABLE_NAME)} "
                    f"ADD COLUMN {quote_identifier(connection, 'jti')} "
                    "varchar(255)"
                )
        columns.add("jti")

    with connection.cursor() as cursor:
        cursor.execute(
            f"SELECT id, token FROM {quote_identifier(connection, TABLE_NAME)} "
            f"WHERE {quote_identifier(connection, 'jti')} IS NULL "
            f"OR {quote_identifier(connection, 'jti')} = ''"
        )
        missing_jti = cursor.fetchall()
        for token_id, raw_token in missing_jti:
            jti = token_jti(raw_token) or f"legacy-{token_id}"
            cursor.execute(
                f"UPDATE {quote_identifier(connection, TABLE_NAME)} "
                f"SET {quote_identifier(connection, 'jti')} = %s "
                f"WHERE id = %s",
                [jti, token_id],
            )
        cursor.execute(
            f"CREATE UNIQUE INDEX IF NOT EXISTS "
            f"{quote_identifier(connection, 'token_blacklist_outstandingtoken_jti_key')} "
            f"ON {quote_identifier(connection, TABLE_NAME)} "
            f"({quote_identifier(connection, 'jti')})"
        )

        if connection.vendor == "postgresql":
            cursor.execute(
                f"ALTER TABLE {quote_identifier(connection, TABLE_NAME)} "
                f"ALTER COLUMN {quote_identifier(connection, 'jti')} SET NOT NULL"
            )


def noop_reverse(apps, schema_editor):
    return


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("api", "0061_catalogproductimage"),
        ("token_blacklist", "0013_alter_blacklistedtoken_options_and_more"),
    ]

    operations = [
        migrations.RunPython(repair_outstanding_token_jti, noop_reverse),
    ]

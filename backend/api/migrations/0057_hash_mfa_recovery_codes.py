# Generated data migration to hash existing recovery codes

from django.db import migrations
from django.contrib.auth.hashers import make_password


def hash_existing_recovery_codes(apps, schema_editor):
    """Hash all existing plaintext recovery codes. Idempotent: skips already-hashed codes."""
    AccountSecurityState = apps.get_model("api", "AccountSecurityState")
    
    for security_state in AccountSecurityState.objects.filter(mfa_recovery_codes__isnull=False):
        if not security_state.mfa_recovery_codes:
            continue
        
        # Check if codes are already hashed (Django password hashes start with algorithm prefix)
        first_code = security_state.mfa_recovery_codes[0] if security_state.mfa_recovery_codes else None
        if first_code and first_code.startswith(("pbkdf2_sha256$", "default$", "argon2$", "bcrypt$")):
            # Already hashed, skip
            continue
        
        # Hash all recovery codes
        hashed_codes = [make_password(code) for code in security_state.mfa_recovery_codes]
        security_state.mfa_recovery_codes = hashed_codes
        security_state.save(update_fields=["mfa_recovery_codes"])


def reverse_hash_recovery_codes(apps, schema_editor):
    """Cannot reverse: we don't have raw codes anymore. This is one-way."""
    raise RuntimeError(
        "Cannot reverse MFA recovery code hashing backfill: raw codes are not retained after hashing. "
        "If you need to rollback, restore from backup."
    )


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0056_commercecustomerprofile_deletion_expires_at_and_more"),
    ]

    operations = [
        migrations.RunPython(hash_existing_recovery_codes, reverse_hash_recovery_codes),
    ]

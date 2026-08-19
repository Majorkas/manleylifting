"""
GDPR compliance health-check service.

Returns a machine-readable summary of the repository's privacy controls.
No raw database values, emails, IDs, exception text, or secrets are included
in messages or evidence strings.
"""

CHECK_KEYS = (
    "privacy_modules_present",
    "privacy_retention_policy",
    "consent_records_exported",
    "mfa_recovery_codes_hashed",
    "privacy_migrations_applied",
    "audit_log_anonymization",
    "external_approval_gates",
)


def run_compliance_checks():
    checks = [
        _check_privacy_modules(),
        _check_retention_policy(),
        _check_consent_export(),
        _check_mfa_recovery_codes(),
        _check_migrations(),
        _check_audit_log_anonymization(),
        _check_external_approval_gates(),
    ]
    technical_failure = any(check["status"] == "fail" for check in checks)
    approval_required = any(check["status"] == "approval_required" for check in checks)
    return {
        "status": "attention_required" if technical_failure or approval_required else "pass",
        "checks": checks,
    }


def _check_privacy_modules():
    required = (
        "api.privacy",
        "api.privacy_export",
        "api.privacy_logging",
        "api.privacy_retention",
        "api.privacy_tokens",
    )
    for module_path in required:
        try:
            __import__(module_path)
        except ImportError:
            return {
                "key": "privacy_modules_present",
                "status": "fail",
                "message": f"Required privacy module could not be imported: {module_path}",
                "evidence": f"module={module_path}",
            }
    return {
        "key": "privacy_modules_present",
        "status": "pass",
        "message": "All required privacy modules are importable.",
        "evidence": ", ".join(required),
    }


def _check_retention_policy():
    required_attrs = (
        "ACCOUNT_SESSION_EXPIRY_DAYS",
        "ACCOUNT_ACTION_TOKEN_EXPIRY_DAYS",
        "AUDIT_LOG_RETENTION_DAYS",
        "ORDER_EMAIL_DELIVERY_RETENTION_DAYS",
        "ACCOUNT_DELETION_RECOVERY_DAYS",
        "ANONYMIZED_ACCOUNT_RETENTION_DAYS",
    )
    try:
        from api.privacy_retention import RetentionPolicy
    except ImportError:
        return {
            "key": "privacy_retention_policy",
            "status": "fail",
            "message": "RetentionPolicy class could not be imported.",
            "evidence": "module=api.privacy_retention",
        }

    missing = []
    invalid = []
    for attr in required_attrs:
        value = getattr(RetentionPolicy, attr, None)
        if value is None:
            missing.append(attr)
        elif not (isinstance(value, int) and value > 0):
            invalid.append(attr)

    if missing or invalid:
        problems = ", ".join(missing + invalid)
        return {
            "key": "privacy_retention_policy",
            "status": "fail",
            "message": f"RetentionPolicy attributes missing or not positive integers: {problems}",
            "evidence": f"checked={', '.join(required_attrs)}",
        }

    return {
        "key": "privacy_retention_policy",
        "status": "pass",
        "message": "RetentionPolicy defines all required *_DAYS attributes as positive integers.",
        "evidence": f"checked={', '.join(required_attrs)}",
    }


def _check_consent_export():
    evidence_parts = []
    try:
        from api.models import CookieConsentRecord  # noqa: F401
        evidence_parts.append("api.models.CookieConsentRecord")
    except ImportError:
        return {
            "key": "consent_records_exported",
            "status": "fail",
            "message": "CookieConsentRecord could not be imported from api.models.",
            "evidence": "module=api.models",
        }

    try:
        from api import privacy_export
        serializer = getattr(privacy_export, "_serialize_consent_record", None)
        if not callable(serializer):
            return {
                "key": "consent_records_exported",
                "status": "fail",
                "message": "_serialize_consent_record is not callable in api.privacy_export.",
                "evidence": "module=api.privacy_export",
            }
        evidence_parts.append("api.privacy_export._serialize_consent_record")
    except ImportError:
        return {
            "key": "consent_records_exported",
            "status": "fail",
            "message": "api.privacy_export could not be imported.",
            "evidence": "module=api.privacy_export",
        }

    return {
        "key": "consent_records_exported",
        "status": "pass",
        "message": "CookieConsentRecord is importable and consent serializer is callable.",
        "evidence": ", ".join(evidence_parts),
    }


def _check_mfa_recovery_codes():
    try:
        from api.models import AccountSecurityState
        from django.contrib.auth.hashers import identify_hasher
    except ImportError:
        return {
            "key": "mfa_recovery_codes_hashed",
            "status": "fail",
            "message": "Required imports for MFA recovery code check are unavailable.",
            "evidence": "module=api.models",
        }

    plaintext_count = 0
    checked_count = 0

    for state in AccountSecurityState.objects.only("mfa_recovery_codes"):
        codes = state.mfa_recovery_codes or []
        for code in codes:
            checked_count += 1
            try:
                identify_hasher(code)
            except ValueError:
                plaintext_count += 1

    if plaintext_count:
        return {
            "key": "mfa_recovery_codes_hashed",
            "status": "fail",
            "message": f"{plaintext_count} recovery code(s) are stored in plaintext.",
            "evidence": f"plaintext_count={plaintext_count}, total_checked={checked_count}",
        }

    return {
        "key": "mfa_recovery_codes_hashed",
        "status": "pass",
        "message": "All MFA recovery codes are stored as hashed values.",
        "evidence": f"total_checked={checked_count}",
    }


def _check_migrations():
    required = (
        ("api", "0057_hash_mfa_recovery_codes"),
        ("api", "0059_cookieconsentrecord"),
    )
    try:
        from django.db.migrations.recorder import MigrationRecorder
        recorder = MigrationRecorder.Migration.objects
    except Exception:
        return {
            "key": "privacy_migrations_applied",
            "status": "fail",
            "message": "Could not access migration recorder.",
            "evidence": "module=django.db.migrations.recorder",
        }

    missing = []
    for app, name in required:
        if not recorder.filter(app=app, name=name).exists():
            missing.append(name)

    if missing:
        return {
            "key": "privacy_migrations_applied",
            "status": "fail",
            "message": f"Required migration(s) not applied: {', '.join(missing)}",
            "evidence": f"missing={', '.join(missing)}",
        }

    applied = [name for _, name in required]
    return {
        "key": "privacy_migrations_applied",
        "status": "pass",
        "message": "All required privacy migrations are applied.",
        "evidence": f"applied={', '.join(applied)}",
    }


def _check_audit_log_anonymization():
    try:
        from api.models import AuditLog
        from api.privacy_retention import cleanup_old_audit_logs
    except ImportError:
        return {
            "key": "audit_log_anonymization",
            "status": "fail",
            "message": "AuditLog or cleanup_old_audit_logs could not be imported.",
            "evidence": "modules=api.models, api.privacy_retention",
        }

    actor_field = AuditLog._meta.get_field("actor")
    if not actor_field.null:
        return {
            "key": "audit_log_anonymization",
            "status": "fail",
            "message": "AuditLog.actor is not nullable; anonymization cannot set it to NULL.",
            "evidence": "field=AuditLog.actor, null=False",
        }

    if not callable(cleanup_old_audit_logs):
        return {
            "key": "audit_log_anonymization",
            "status": "fail",
            "message": "cleanup_old_audit_logs is not callable.",
            "evidence": "function=api.privacy_retention.cleanup_old_audit_logs",
        }

    return {
        "key": "audit_log_anonymization",
        "status": "pass",
        "message": "AuditLog.actor is nullable and cleanup_old_audit_logs is callable.",
        "evidence": "field=AuditLog.actor null=True, function=cleanup_old_audit_logs callable=True",
    }


def _check_external_approval_gates():
    return {
        "key": "external_approval_gates",
        "status": "approval_required",
        "message": (
            "The following items require human review and cannot be verified programmatically: "
            "legal identity verification, lawful basis and retention schedule confirmation, "
            "processor agreements (DPA), DPIA/DPO assessment, and infrastructure verification."
        ),
        "evidence": "checklist=docs/gdpr-governance-checklist.md",
    }

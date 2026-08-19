"""
Privacy data retention and cleanup module.

This module implements GDPR-compliant data retention policies and idempotent
cleanup operations for automatically managing the lifecycle of sensitive data.
All cleanup functions are designed to be safe for repeated execution and track
both deleted and retained record counts for audit purposes.
"""

from datetime import datetime, timedelta, timezone
from typing import Dict

import logging
from django.db import transaction
from django.db.models import Q
from django.utils import timezone as django_timezone

from .models import (
    AccountSession,
    AccountActionToken,
    AuditLog,
    OnsiteOrder,
    OrderEmailDelivery,
    CommerceCustomerProfile,
)

logger = logging.getLogger(__name__)


class RetentionPolicy:
    """
    GDPR-compliant data retention policy constants.

    These constants define how long different types of personal and operational
    data should be retained before automatic cleanup. All values represent the
    maximum age in days before records become eligible for deletion or anonymization.
    """

    ACCOUNT_SESSION_EXPIRY_DAYS = 30
    """
    Maximum age for inactive account sessions before deletion (days).

    Account sessions older than this threshold are deleted during cleanup.
    This prevents accumulation of stale session records while balancing user
    convenience for quickly resuming authenticated sessions.

    [APPROVAL GATE] - Legal review: Confirm 30 days aligns with security best practices
    and does not conflict with user expectations for "remember me" functionality.
    """

    ACCOUNT_ACTION_TOKEN_EXPIRY_DAYS = 7
    """
    Maximum age for account action tokens before deletion (days).

    Tokens used for password resets, email verification, and account operations
    are deleted after this period. Expired tokens are no longer valid and can be
    safely removed to reduce token table size.

    [APPROVAL GATE] - Legal review: Confirm 7 days aligns with security standards
    for password reset and verification token expiration policies.
    """

    AUDIT_LOG_RETENTION_DAYS = 90
    """
    Maximum age for audit logs before anonymization (days).

    Audit logs are anonymized (not deleted) after this period. This preserves
    security event history while removing personally identifiable information.
    Anonymization allows for aggregate analytics while protecting user privacy.

    [APPROVAL GATE] - Legal review: Confirm 90 days meets regulatory requirements
    for audit trail retention and complies with applicable data protection laws.
    """

    ORDER_EMAIL_DELIVERY_RETENTION_DAYS = 180
    """
    Maximum age for order email delivery records before deletion (days).

    Email delivery logs (bounce events, delivery confirmations) are deleted after
    this period. Retention is longer than sessions to support customer service
    inquiries about order communications.

    [APPROVAL GATE] - Legal review: Confirm 180 days aligns with customer service
    retention needs and does not conflict with email archival requirements.
    """

    ACCOUNT_DELETION_RECOVERY_DAYS = 30
    """
    Recovery window for hard-deleted account data (days).

    When a user requests account deletion, records are marked as deleted but not
    immediately hard-deleted. During this recovery period, deletion can be
    reversed if the user logs back in. After this period, hard deletion proceeds.

    [APPROVAL GATE] - Legal review: Confirm 30-day recovery window balances user
    control with regulatory requirements for timely data deletion.
    """

    ANONYMIZED_ACCOUNT_RETENTION_DAYS = 365
    """
    Maximum age for anonymized account records before hard deletion (days).

    Even after anonymization, records are retained for one year to support
    historical queries and potential legal discovery. After this period,
    remaining anonymized data is hard-deleted.

    [APPROVAL GATE] - Legal review: Confirm 365-day anonymization retention
    meets retention requirements and does not violate user deletion requests.
    """


@transaction.atomic
def cleanup_expired_account_sessions() -> Dict[str, int]:
    """
    Delete expired account sessions.

    Removes all account sessions that have exceeded the configured expiry period.
    This operation is idempotent—running it multiple times has the same effect as
    running it once. Session cleanup prevents the session table from growing
    unbounded while respecting user security expectations.

    Returns:
        Dict with keys:
            - 'deleted': Number of sessions removed
            - 'retained': Number of sessions still within retention window

    Example:
        >>> result = cleanup_expired_account_sessions()
        >>> print(result)
        {'deleted': 42, 'retained': 156}
    """
    cutoff_date = django_timezone.now() - timedelta(
        days=RetentionPolicy.ACCOUNT_SESSION_EXPIRY_DAYS
    )

    expired_sessions = AccountSession.objects.filter(created_at__lt=cutoff_date)
    deleted_count = expired_sessions.count()

    expired_sessions.delete()

    retained_count = AccountSession.objects.filter(created_at__gte=cutoff_date).count()

    logger.info(
        f"cleanup_expired_account_sessions: deleted={deleted_count}, retained={retained_count}"
    )

    return {"deleted": deleted_count, "retained": retained_count}


@transaction.atomic
@transaction.atomic
def cleanup_expired_account_action_tokens() -> Dict[str, int]:
    """
    Delete expired account action tokens.

    Removes all account action tokens (password resets, email verifications, etc.)
    that have exceeded the configured expiry period. Expired tokens are no longer
    valid and serve no purpose. This operation is idempotent and prevents token
    table bloat.

    Returns:
        Dict with keys:
            - 'deleted': Number of tokens removed
            - 'retained': Number of tokens still within retention window

    Example:
        >>> result = cleanup_expired_account_action_tokens()
        >>> print(result)
        {'deleted': 128, 'retained': 45}
    """
    cutoff_date = django_timezone.now() - timedelta(
        days=RetentionPolicy.ACCOUNT_ACTION_TOKEN_EXPIRY_DAYS
    )
    now = django_timezone.now()

    # Delete tokens that are either:
    # 1. Consumed more than 7 days ago, or
    # 2. Expired (expires_at in the past)
    expired_tokens = AccountActionToken.objects.filter(
        Q(consumed_at__lt=cutoff_date) |  # Consumed tokens older than retention window
        Q(expires_at__lt=now)  # Tokens that have expired
    )
    deleted_count = expired_tokens.count()

    expired_tokens.delete()

    retained_count = AccountActionToken.objects.count()

    logger.info(
        f"cleanup_expired_account_action_tokens: deleted={deleted_count}, retained={retained_count}"
    )

    return {"deleted": deleted_count, "retained": retained_count}


@transaction.atomic
def cleanup_old_audit_logs() -> Dict[str, int]:
    """
    Anonymize old audit logs.

    Removes personally identifiable information from audit log records that have
    exceeded the configured retention period. Rather than deleting logs entirely
    (which would lose security event history), this operation anonymizes them,
    removing user identification while preserving the event record for compliance
    and aggregate analytics.

    Returns:
        Dict with keys:
            - 'anonymized': Number of logs anonymized
            - 'retained': Number of logs still within retention window

    Example:
        >>> result = cleanup_old_audit_logs()
        >>> print(result)
        {'anonymized': 312, 'retained': 5847}
    """
    cutoff_date = django_timezone.now() - timedelta(
        days=RetentionPolicy.AUDIT_LOG_RETENTION_DAYS
    )

    old_logs = AuditLog.objects.filter(created_at__lt=cutoff_date)
    anonymized_count = old_logs.count()

    old_logs.update(actor_id=None, ip_address=None)

    retained_count = AuditLog.objects.filter(created_at__gte=cutoff_date).count()

    logger.info(
        f"cleanup_old_audit_logs: anonymized={anonymized_count}, retained={retained_count}"
    )

    return {"anonymized": anonymized_count, "retained": retained_count}


@transaction.atomic
def cleanup_old_order_email_delivery_records() -> Dict[str, int]:
    """
    Delete old order email delivery records.

    Removes email delivery logs (bounce events, delivery confirmations) that have
    exceeded the configured retention period. These records support customer
    service investigations but become less relevant over time. This operation is
    idempotent and prevents the email delivery log table from growing unbounded.

    Returns:
        Dict with keys:
            - 'deleted': Number of records removed
            - 'retained': Number of records still within retention window

    Example:
        >>> result = cleanup_old_order_email_delivery_records()
        >>> print(result)
        {'deleted': 891, 'retained': 2156}
    """
    cutoff_date = django_timezone.now() - timedelta(
        days=RetentionPolicy.ORDER_EMAIL_DELIVERY_RETENTION_DAYS
    )

    old_delivery_records = OrderEmailDelivery.objects.filter(
        created_at__lt=cutoff_date
    )
    deleted_count = old_delivery_records.count()

    old_delivery_records.delete()

    retained_count = OrderEmailDelivery.objects.filter(
        created_at__gte=cutoff_date
    ).count()

    logger.info(
        f"cleanup_old_order_email_delivery_records: deleted={deleted_count}, retained={retained_count}"
    )

    return {"deleted": deleted_count, "retained": retained_count}


@transaction.atomic
def purge_expired_deleted_accounts() -> Dict[str, int]:
    """
    Hard-delete accounts that have exceeded the recovery window.

    When users request account deletion, records are marked as deleted but not
    immediately hard-deleted (allowing for potential recovery/reversal). This
    function permanently removes accounts that have been in deleted state for
    longer than the configured recovery period. This operation is idempotent.

    Returns:
        Dict with keys:
            - 'hard_deleted': Number of accounts permanently removed
            - 'still_in_recovery': Number of deleted accounts still in recovery window

    Example:
        >>> result = purge_expired_deleted_accounts()
        >>> print(result)
        {'hard_deleted': 23, 'still_in_recovery': 156}
    """
    cutoff_date = django_timezone.now() - timedelta(
        days=RetentionPolicy.ACCOUNT_DELETION_RECOVERY_DAYS
    )

    expired_deleted_profiles = CommerceCustomerProfile.objects.filter(
        deleted_at__isnull=False, deleted_at__lt=cutoff_date
    )
    hard_deleted_count = expired_deleted_profiles.count()

    expired_deleted_profiles.delete()

    still_in_recovery_count = CommerceCustomerProfile.objects.filter(
        deleted_at__isnull=False, deleted_at__gte=cutoff_date
    ).count()

    logger.info(
        f"purge_expired_deleted_accounts: hard_deleted={hard_deleted_count}, still_in_recovery={still_in_recovery_count}"
    )

    return {
        "hard_deleted": hard_deleted_count,
        "still_in_recovery": still_in_recovery_count,
    }

import hashlib
import hmac
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.utils import timezone

from .models import AccountActionToken


def _normalize_email(email):
    normalized_email = str(email or "").strip().lower()
    validate_email(normalized_email)
    return normalized_email


def _validate_purpose(purpose):
    if purpose not in AccountActionToken.Purpose.values:
        raise ValueError("Unsupported account action token purpose")


def _token_digest(raw_token, purpose):
    message = f"{purpose}:{raw_token}".encode("utf-8")
    secret = str(settings.SECRET_KEY).encode("utf-8")
    return hmac.new(secret, message, hashlib.sha256).hexdigest()


def revoke_account_action_tokens(*, user, purposes=None):
    requested_purposes = list(
        AccountActionToken.Purpose.values if purposes is None else purposes
    )
    if any(purpose not in AccountActionToken.Purpose.values for purpose in requested_purposes):
        raise ValueError("Unsupported account action token purpose")

    return AccountActionToken.objects.filter(
        user=user,
        purpose__in=requested_purposes,
        consumed_at__isnull=True,
        revoked_at__isnull=True,
    ).update(revoked_at=timezone.now())


def issue_account_action_token(*, user, purpose, target_email, lifetime):
    _validate_purpose(purpose)
    issued_for_email = _normalize_email(user.email)
    normalized_email = _normalize_email(target_email)
    if (
        purpose
        in {
            AccountActionToken.Purpose.VERIFY_EMAIL,
            AccountActionToken.Purpose.PASSWORD_RESET,
        }
        and normalized_email != issued_for_email
    ):
        raise ValueError("Token target must match the account email")
    if not isinstance(lifetime, timedelta) or lifetime <= timedelta(0):
        raise ValueError("Account action token lifetime must be positive")

    raw_token = secrets.token_urlsafe(32)
    now = timezone.now()

    with transaction.atomic():
        get_user_model().objects.select_for_update().only("pk").get(pk=user.pk)
        revoke_account_action_tokens(user=user, purposes=[purpose])
        AccountActionToken.objects.create(
            user=user,
            purpose=purpose,
            token_digest=_token_digest(raw_token, purpose),
            issued_for_email=issued_for_email,
            target_email=normalized_email,
            expires_at=now + lifetime,
        )

    return raw_token


def consume_account_action_token(*, raw_token, purpose, action):
    _validate_purpose(purpose)
    if not callable(action):
        raise TypeError("Account action token consumer must be callable")
    candidate_token = str(raw_token or "").strip()
    if not candidate_token:
        return None

    token_digest = _token_digest(candidate_token, purpose)
    candidate_user_id = AccountActionToken.objects.filter(
        token_digest=token_digest,
        purpose=purpose,
        consumed_at__isnull=True,
        revoked_at__isnull=True,
        expires_at__gt=timezone.now(),
    ).values_list("user_id", flat=True).first()
    if candidate_user_id is None:
        return None

    with transaction.atomic():
        user_model = get_user_model()
        try:
            user = user_model.objects.select_for_update().only("pk", "email").get(
                pk=candidate_user_id
            )
        except user_model.DoesNotExist:
            return None

        now = timezone.now()
        action_token = (
            AccountActionToken.objects.select_for_update()
            .filter(
                token_digest=token_digest,
                purpose=purpose,
                user_id=user.pk,
                consumed_at__isnull=True,
                revoked_at__isnull=True,
                expires_at__gt=now,
            )
            .first()
        )
        if action_token is None:
            return None
        action_token.user = user

        try:
            current_email = _normalize_email(user.email)
        except ValidationError:
            action_token.revoked_at = now
            action_token.save(update_fields=["revoked_at"])
            return None
        if action_token.issued_for_email != current_email:
            action_token.revoked_at = now
            action_token.save(update_fields=["revoked_at"])
            return None

        action_token.consumed_at = now
        action_token.save(update_fields=["consumed_at"])
        return action(action_token)

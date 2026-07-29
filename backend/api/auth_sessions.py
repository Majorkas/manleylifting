from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import UntypedToken
from rest_framework_simplejwt.utils import datetime_from_epoch

from .models import AccountSecurityState, AccountSession


SESSION_GENERATION_CLAIM = "session_generation"
SESSION_ID_CLAIM = "session_id"


def create_account_session(*, user, refresh_token):
    session = AccountSession.objects.create(
        user=user,
        expires_at=datetime_from_epoch(refresh_token["exp"]),
    )
    refresh_token[SESSION_ID_CLAIM] = str(session.pk)
    OutstandingToken.objects.filter(
        user=user,
        jti=refresh_token[api_settings.JTI_CLAIM],
    ).update(token=str(refresh_token))
    return session


def parse_refresh_token(raw_token):
    token = UntypedToken(raw_token)
    if token.get(api_settings.TOKEN_TYPE_CLAIM) != "refresh":
        raise TokenError("Token has the wrong type")
    return token


def get_user_session_generation(user):
    generation = AccountSecurityState.objects.filter(user_id=user.pk).values_list(
        "session_generation",
        flat=True,
    ).first()
    return int(generation or 0)


def token_has_current_session_generation(user, token):
    try:
        token_generation = int(token.get(SESSION_GENERATION_CLAIM, 0))
    except (TypeError, ValueError, ValidationError):
        return False
    return token_generation == get_user_session_generation(user)


def token_has_active_account_session(user, token):
    session_id = token.get(SESSION_ID_CLAIM)
    if not session_id:
        return False
    try:
        return AccountSession.objects.filter(
            pk=session_id,
            user=user,
            revoked_at__isnull=True,
            expires_at__gt=timezone.now(),
        ).exists()
    except (TypeError, ValueError, ValidationError):
        return False


def revoke_user_sessions(user):
    now = timezone.now()
    with transaction.atomic():
        state, _ = AccountSecurityState.objects.get_or_create(user=user)
        AccountSecurityState.objects.filter(pk=state.pk).update(
            session_generation=F("session_generation") + 1,
            sessions_revoked_at=now,
            updated_at=now,
        )
        AccountSession.objects.filter(
            user=user,
            revoked_at__isnull=True,
        ).update(revoked_at=now)

        outstanding_tokens = (
            OutstandingToken.objects.select_for_update()
            .filter(user=user)
            .order_by("pk")
        )
        for token in outstanding_tokens:
            BlacklistedToken.objects.get_or_create(token=token)


def revoke_account_session(*, session_id, user):
    now = timezone.now()
    with transaction.atomic():
        try:
            session = AccountSession.objects.select_for_update().filter(
                pk=session_id,
                user=user,
            ).first()
        except (TypeError, ValueError, ValidationError):
            session = None
        if session is not None and session.revoked_at is None:
            session.revoked_at = now
            session.save(update_fields=["revoked_at"])


def revoke_refresh_session(*, raw_token, user, expected_session_id):
    token = parse_refresh_token(raw_token)
    token_user_id = str(token.get(api_settings.USER_ID_CLAIM) or "")
    user_id = str(getattr(user, api_settings.USER_ID_FIELD))
    if token_user_id != user_id:
        raise TokenError("Token does not belong to the authenticated user")

    session_id = token.get(SESSION_ID_CLAIM)
    if str(session_id or "") != str(expected_session_id or ""):
        raise TokenError("Token does not belong to the authenticated session")
    jti = token.get(api_settings.JTI_CLAIM)

    with transaction.atomic():
        revoke_account_session(session_id=session_id, user=user)

        outstanding_token = OutstandingToken.objects.select_for_update().filter(
            user=user,
            jti=jti,
        ).first()
        if outstanding_token is not None:
            BlacklistedToken.objects.get_or_create(token=outstanding_token)

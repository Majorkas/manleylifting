from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .account_emails import send_password_reset_email
from .account_tokens import consume_account_action_token, issue_account_action_token
from .auth_sessions import revoke_user_sessions
from .models import AccountActionToken, CommerceCustomerProfile
from .request_security import client_ip
from .serializers import AccountEmailSerializer, PasswordResetCompleteSerializer
from .throttles import AccountEmailRateThrottle
from .turnstile import verify_turnstile_token


REQUEST_RESPONSE = {"detail": "If an account exists, a reset email will be sent."}


def _queue_password_reset_email(*, recipient_email, raw_token):
    def deliver_password_reset_email():
        send_password_reset_email(
            recipient_email=recipient_email,
            raw_token=raw_token,
        )

    transaction.on_commit(deliver_password_reset_email, robust=True)


class PasswordResetRequestView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    parser_classes = [JSONParser]
    throttle_classes = [ScopedRateThrottle, AccountEmailRateThrottle]
    throttle_scope = "account.reset"

    def post(self, request):
        serializer = AccountEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not verify_turnstile_token(
            serializer.validated_data.get("turnstile_token"),
            required=settings.ACCOUNT_REQUIRE_TURNSTILE,
            secret_key=settings.ACCOUNT_TURNSTILE_SECRET_KEY,
            remote_ip=client_ip(request),
        ):
            return Response(
                {"detail": "Bot verification failed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        email = serializer.validated_data["email"]
        profile = (
            CommerceCustomerProfile.objects.select_related("user")
            .filter(
                user__email__iexact=email,
                disabled_at__isnull=True,
                anonymized_at__isnull=True,
            )
            .first()
        )
        if profile is not None and profile.user.is_active:
            raw_token = issue_account_action_token(
                user=profile.user,
                purpose=AccountActionToken.Purpose.PASSWORD_RESET,
                target_email=profile.user.email,
                lifetime=settings.ACCOUNT_VERIFY_TOKEN_LIFETIME,
            )
            _queue_password_reset_email(
                recipient_email=profile.user.email,
                raw_token=raw_token,
            )
        return Response(REQUEST_RESPONSE, status=status.HTTP_202_ACCEPTED)


class PasswordResetCompleteView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    parser_classes = [JSONParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "account.reset"

    def post(self, request):
        serializer = PasswordResetCompleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        def apply_password_reset(action_token):
            user = get_user_model().objects.select_for_update().get(pk=action_token.user_id)
            user.set_password(payload["new_password"])
            user.save(update_fields=["password"])
            revoke_user_sessions(user)
            return user.pk

        completed_user_id = consume_account_action_token(
            raw_token=payload["token"],
            purpose=AccountActionToken.Purpose.PASSWORD_RESET,
            action=apply_password_reset,
        )
        if completed_user_id is None:
            return Response(
                {"detail": "Reset link is invalid or has expired."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"ok": True})

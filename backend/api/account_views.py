import secrets

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .account_emails import send_verification_email
from .account_tokens import consume_account_action_token, issue_account_action_token
from .models import AccountActionToken, CommerceCustomerProfile, UserProfile
from .request_security import client_ip
from .serializers import (
    AccountBootstrapSerializer,
    AccountEmailSerializer,
    CommerceRegistrationSerializer,
    VerifyEmailSerializer,
)
from .throttles import AccountEmailRateThrottle, PortalMethodRateThrottle
from .turnstile import verify_turnstile_token


REGISTRATION_RESPONSE = {
    "detail": "If the address can be registered, check your email for next steps."
}
RESEND_RESPONSE = {
    "detail": "If an unverified account exists, a verification email will be sent."
}


def _queue_verification_email(*, recipient_email, raw_token):
    def deliver_verification_email():
        send_verification_email(
            recipient_email=recipient_email,
            raw_token=raw_token,
        )

    transaction.on_commit(deliver_verification_email, robust=True)


def _issue_verification(*, user):
    raw_token = issue_account_action_token(
        user=user,
        purpose=AccountActionToken.Purpose.VERIFY_EMAIL,
        target_email=user.email,
        lifetime=settings.ACCOUNT_VERIFY_TOKEN_LIFETIME,
    )
    _queue_verification_email(
        recipient_email=user.email,
        raw_token=raw_token,
    )


def _new_commerce_username():
    return f"commerce_{secrets.token_hex(12)}"


@method_decorator(csrf_protect, name="dispatch")
class CommerceRegistrationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    parser_classes = [JSONParser]
    throttle_classes = [ScopedRateThrottle, AccountEmailRateThrottle]
    throttle_scope = "account.register"

    def post(self, request):
        if not settings.ACCOUNT_REGISTRATION_ENABLED:
            return Response(
                {"detail": "Registration is temporarily unavailable."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        serializer = CommerceRegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data
        if not verify_turnstile_token(
            payload.get("turnstile_token"),
            required=settings.ACCOUNT_REQUIRE_TURNSTILE,
            secret_key=settings.ACCOUNT_TURNSTILE_SECRET_KEY,
            remote_ip=client_ip(request),
        ):
            return Response(
                {"detail": "Bot verification failed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user_model = get_user_model()
        email = payload["email"]
        password_hash = make_password(payload["password"])
        try:
            with transaction.atomic():
                identity_exists = user_model.objects.filter(
                    Q(email__iexact=email) | Q(username__iexact=email)
                ).exists()
                if identity_exists:
                    return Response(
                        REGISTRATION_RESPONSE,
                        status=status.HTTP_202_ACCEPTED,
                    )

                user = user_model.objects.create(
                    username=_new_commerce_username(),
                    email=email,
                    first_name=str(payload.get("first_name") or "").strip(),
                    last_name=str(payload.get("last_name") or "").strip(),
                    password=password_hash,
                    is_active=False,
                )
                accepted_at = timezone.now()
                CommerceCustomerProfile.objects.create(
                    user=user,
                    activation_pending=True,
                    terms_accepted_at=accepted_at,
                    privacy_accepted_at=accepted_at,
                    terms_version=settings.ACCOUNT_TERMS_VERSION,
                    privacy_version=settings.ACCOUNT_PRIVACY_VERSION,
                )
                _issue_verification(user=user)
        except IntegrityError:
            pass

        return Response(REGISTRATION_RESPONSE, status=status.HTTP_202_ACCEPTED)


@method_decorator(csrf_protect, name="dispatch")
class VerifyEmailView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    parser_classes = [JSONParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "account.verify"

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        def activate_account(action_token):
            user = get_user_model().objects.select_for_update().get(
                pk=action_token.user_id
            )
            profile = CommerceCustomerProfile.objects.select_for_update().filter(
                user=user,
                disabled_at__isnull=True,
                anonymized_at__isnull=True,
            ).first()
            if profile is None or (not user.is_active and not profile.activation_pending):
                return None

            now = timezone.now()
            profile.verified_email = action_token.target_email
            profile.email_verified_at = now
            profile.activation_pending = False
            if not user.is_active:
                user.is_active = True
                user.save(update_fields=["is_active"])
            profile.save(
                update_fields=[
                    "verified_email",
                    "email_verified_at",
                    "activation_pending",
                    "updated_at",
                ]
            )
            return profile.pk

        profile_id = consume_account_action_token(
            raw_token=serializer.validated_data["token"],
            purpose=AccountActionToken.Purpose.VERIFY_EMAIL,
            action=activate_account,
        )
        if profile_id is None:
            return Response(
                {"detail": "Verification link is invalid or has expired."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"ok": True})


@method_decorator(csrf_protect, name="dispatch")
class ResendVerificationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    parser_classes = [JSONParser]
    throttle_classes = [ScopedRateThrottle, AccountEmailRateThrottle]
    throttle_scope = "account.resend"

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
        profile = (
            CommerceCustomerProfile.objects.select_related("user")
            .filter(
                user__email__iexact=serializer.validated_data["email"],
                email_verified_at__isnull=True,
                disabled_at__isnull=True,
                anonymized_at__isnull=True,
            )
            .first()
        )
        if profile is not None and (profile.user.is_active or profile.activation_pending):
            _issue_verification(user=profile.user)
        return Response(RESEND_RESPONSE, status=status.HTTP_202_ACCEPTED)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def account_bootstrap(request):
    commerce_profile = CommerceCustomerProfile.objects.filter(
        user_id=request.user.pk
    ).first()
    email_verified = bool(
        commerce_profile and commerce_profile.has_verified_email()
    )
    commerce_enabled = bool(
        email_verified
        and commerce_profile.disabled_at is None
        and commerce_profile.anonymized_at is None
    )
    payload = {
        "username": request.user.username,
        "email": request.user.email or "",
        "full_name": request.user.get_full_name() or "",
        "email_verified": email_verified,
        "capabilities": {
            "can_shop": commerce_enabled,
            "can_view_orders": commerce_enabled,
            "can_access_portal": UserProfile.objects.filter(
                user_id=request.user.pk
            ).exists(),
        },
    }
    serializer = AccountBootstrapSerializer(payload)
    return Response(serializer.data)

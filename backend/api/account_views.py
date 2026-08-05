import secrets

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
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

from .account_emails import send_email_change_email, send_verification_email
from .account_tokens import consume_account_action_token, issue_account_action_token
from .audit import log_portal_audit_event
from .auth_sessions import revoke_user_sessions
from .models import AccountActionToken, CommerceCustomerProfile, OnsiteOrder, SavedAddress, UserProfile
from .request_security import client_ip
from .serializers import (
    AccountBootstrapSerializer,
    AccountChangePasswordSerializer,
    AccountDeleteSerializer,
    AccountDisableSerializer,
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
                profile = CommerceCustomerProfile.objects.create(
                    user=user,
                    activation_pending=True,
                    terms_accepted_at=accepted_at,
                    privacy_accepted_at=accepted_at,
                    terms_version=settings.ACCOUNT_TERMS_VERSION,
                    privacy_version=settings.ACCOUNT_PRIVACY_VERSION,
                )
                recipient_name = str(payload.get("recipient_name") or "").strip()
                recipient_phone = str(payload.get("recipient_phone") or "").strip()
                address_line_1 = str(payload.get("address_line_1") or "").strip()
                address_line_2 = str(payload.get("address_line_2") or "").strip()
                city = str(payload.get("city") or "").strip()
                county = str(payload.get("county") or "").strip()
                postcode = str(payload.get("postcode") or "").strip()
                country_code = str(payload.get("country_code") or "").strip()
                has_checkout_address = any(
                    [
                        recipient_name,
                        recipient_phone,
                        address_line_1,
                        address_line_2,
                        city,
                        county,
                        postcode,
                        country_code,
                    ]
                )
                if has_checkout_address:
                    SavedAddress.objects.create(
                        commerce_profile=profile,
                        label="Checkout address",
                        recipient_name=recipient_name,
                        recipient_phone=recipient_phone,
                        address_line_1=address_line_1,
                        address_line_2=address_line_2,
                        city=city,
                        county=county,
                        postcode=postcode,
                        country_code=country_code,
                        is_default_shipping=True,
                        is_default_billing=False,
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


class AccountOrdersView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, checkout_ref=None):
        queryset = OnsiteOrder.objects.filter(user=request.user).order_by("-created_at")
        if checkout_ref is not None:
            order = queryset.filter(checkout_ref=checkout_ref).first()
            if order is None:
                return Response({"detail": "Order not found."}, status=status.HTTP_404_NOT_FOUND)
            return Response(self._serialize_order(order))

        orders = queryset.values(
            "checkout_ref",
            "status",
            "customer_name",
            "customer_email",
            "line_items",
            "amount_total_cents",
            "currency",
            "paid_at",
            "created_at",
        )
        payload = []
        for order in orders:
            payload.append(
                {
                    "checkoutRef": order["checkout_ref"],
                    "status": order["status"],
                    "customerName": order["customer_name"],
                    "customerEmail": order["customer_email"],
                    "lineItems": order["line_items"],
                    "amountTotalCents": order["amount_total_cents"],
                    "currency": order["currency"],
                    "paidAt": order["paid_at"].isoformat() if order["paid_at"] else None,
                    "createdAt": order["created_at"].isoformat() if order["created_at"] else None,
                }
            )
        return Response(payload)

    def _serialize_order(self, order):
        return {
            "checkoutRef": order.checkout_ref,
            "status": order.status,
            "customerName": order.customer_name,
            "customerEmail": order.customer_email,
            "lineItems": order.line_items,
            "amountTotalCents": order.amount_total_cents,
            "currency": order.currency,
            "paidAt": order.paid_at.isoformat() if order.paid_at else None,
            "createdAt": order.created_at.isoformat() if order.created_at else None,
        }


class AccountAddressesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, address_id=None):
        profile = self._get_profile(request.user)
        if address_id is not None:
            address = profile.saved_addresses.filter(pk=address_id, is_deleted=False).first()
            if address is None:
                return Response({"detail": "Address not found."}, status=status.HTTP_404_NOT_FOUND)
            return Response(self._serialize_address(address))

        addresses = profile.saved_addresses.filter(is_deleted=False).order_by("-is_default_shipping", "-created_at", "id")
        payload = [self._serialize_address(address) for address in addresses]
        return Response(payload)

    def post(self, request):
        profile = self._get_profile(request.user)

        label = str(request.data.get("label") or "").strip()
        recipient_name = str(request.data.get("recipientName") or request.data.get("recipient_name") or "").strip()
        recipient_phone = str(request.data.get("recipientPhone") or request.data.get("recipient_phone") or "").strip()
        address_line_1 = str(request.data.get("addressLine1") or request.data.get("address_line_1") or "").strip()
        address_line_2 = str(request.data.get("addressLine2") or request.data.get("address_line_2") or "").strip()
        city = str(request.data.get("city") or "").strip()
        county = str(request.data.get("county") or "").strip()
        postcode = str(request.data.get("postcode") or "").strip()
        country_code = str(request.data.get("countryCode") or request.data.get("country_code") or "").strip()
        is_default_shipping = bool(request.data.get("isDefaultShipping") or request.data.get("is_default_shipping"))
        is_default_billing = bool(request.data.get("isDefaultBilling") or request.data.get("is_default_billing"))

        if not label or not recipient_name or not address_line_1 or not city or not postcode or not country_code:
            return Response({"detail": "Address is incomplete."}, status=status.HTTP_400_BAD_REQUEST)

        if is_default_shipping:
            profile.saved_addresses.filter(is_deleted=False).update(is_default_shipping=False)
        if is_default_billing:
            profile.saved_addresses.filter(is_deleted=False).update(is_default_billing=False)

        address = SavedAddress.objects.create(
            commerce_profile=profile,
            label=label,
            recipient_name=recipient_name,
            recipient_phone=recipient_phone,
            address_line_1=address_line_1,
            address_line_2=address_line_2,
            city=city,
            county=county,
            postcode=postcode,
            country_code=country_code,
            is_default_shipping=is_default_shipping,
            is_default_billing=is_default_billing,
        )
        return Response(self._serialize_address(address), status=status.HTTP_201_CREATED)

    def patch(self, request, address_id):
        profile = self._get_profile(request.user)
        address = profile.saved_addresses.filter(pk=address_id, is_deleted=False).first()
        if address is None:
            return Response({"detail": "Address not found."}, status=status.HTTP_404_NOT_FOUND)

        if "label" in request.data:
            address.label = str(request.data.get("label") or "").strip()
        if "recipientName" in request.data or "recipient_name" in request.data:
            address.recipient_name = str(request.data.get("recipientName") or request.data.get("recipient_name") or "").strip()
        if "recipientPhone" in request.data or "recipient_phone" in request.data:
            address.recipient_phone = str(request.data.get("recipientPhone") or request.data.get("recipient_phone") or "").strip()
        if "addressLine1" in request.data or "address_line_1" in request.data:
            address.address_line_1 = str(request.data.get("addressLine1") or request.data.get("address_line_1") or "").strip()
        if "addressLine2" in request.data or "address_line_2" in request.data:
            address.address_line_2 = str(request.data.get("addressLine2") or request.data.get("address_line_2") or "").strip()
        if "city" in request.data:
            address.city = str(request.data.get("city") or "").strip()
        if "county" in request.data:
            address.county = str(request.data.get("county") or "").strip()
        if "postcode" in request.data:
            address.postcode = str(request.data.get("postcode") or "").strip()
        if "countryCode" in request.data or "country_code" in request.data:
            address.country_code = str(request.data.get("countryCode") or request.data.get("country_code") or "").strip()
        if "isDefaultShipping" in request.data or "is_default_shipping" in request.data:
            address.is_default_shipping = bool(request.data.get("isDefaultShipping") or request.data.get("is_default_shipping"))
            if address.is_default_shipping:
                profile.saved_addresses.filter(is_deleted=False).update(is_default_shipping=False)
                address.is_default_shipping = True
        if "isDefaultBilling" in request.data or "is_default_billing" in request.data:
            address.is_default_billing = bool(request.data.get("isDefaultBilling") or request.data.get("is_default_billing"))
            if address.is_default_billing:
                profile.saved_addresses.filter(is_deleted=False).update(is_default_billing=False)
                address.is_default_billing = True

        address.save()
        return Response(self._serialize_address(address))

    def delete(self, request, address_id):
        profile = self._get_profile(request.user)
        address = profile.saved_addresses.filter(pk=address_id, is_deleted=False).first()
        if address is None:
            return Response({"detail": "Address not found."}, status=status.HTTP_404_NOT_FOUND)

        address.is_deleted = True
        address.deleted_at = timezone.now()
        address.save(update_fields=["is_deleted", "deleted_at", "updated_at"])
        return Response({"ok": True})

    def _get_profile(self, user):
        profile = CommerceCustomerProfile.objects.filter(user=user).first()
        if profile is None:
            return CommerceCustomerProfile.objects.create(user=user)
        return profile

    def _serialize_address(self, address):
        return {
            "id": address.id,
            "label": address.label,
            "recipientName": address.recipient_name,
            "recipientPhone": address.recipient_phone,
            "addressLine1": address.address_line_1,
            "addressLine2": address.address_line_2,
            "city": address.city,
            "county": address.county,
            "postcode": address.postcode,
            "countryCode": address.country_code,
            "isDefaultShipping": address.is_default_shipping,
            "isDefaultBilling": address.is_default_billing,
        }


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def account_change_password(request):
    serializer = AccountChangePasswordSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    payload = serializer.validated_data

    current_password = payload["current_password"]
    new_password = payload["new_password"]

    if not request.user.check_password(current_password):
        return Response({"detail": "Current password is incorrect"}, status=status.HTTP_400_BAD_REQUEST)

    if current_password == new_password:
        return Response(
            {"detail": "New password must be different from current password"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        validate_password(new_password, user=request.user)
    except DjangoValidationError as error:
        messages = list(error.messages or [])
        return Response(
            {"detail": messages[0] if messages else "Password is not valid"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    with transaction.atomic():
        request.user.set_password(new_password)
        request.user.save(update_fields=["password"])

    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def account_logout_all(request):
    revoke_user_sessions(request.user)
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def account_disable(request):
    serializer = AccountDisableSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    payload = serializer.validated_data

    if not request.user.check_password(payload["current_password"]):
        return Response({"detail": "Current password is incorrect"}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        request.user.is_active = False
        request.user.save(update_fields=["is_active"])
        profile = CommerceCustomerProfile.objects.select_for_update().filter(user=request.user).first()
        if profile is not None:
            profile.disabled_at = timezone.now()
            profile.activation_pending = False
            profile.verified_email = ""
            profile.email_verified_at = None
            profile.save(update_fields=["disabled_at", "activation_pending", "verified_email", "email_verified_at", "updated_at"])

    log_portal_audit_event(
        request=request,
        action="account.disable",
        target_type="account",
        target_id=str(request.user.pk),
        details={"disabled": True},
    )
    revoke_user_sessions(request.user)
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def account_delete(request):
    serializer = AccountDeleteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    payload = serializer.validated_data

    if not payload["confirm"]:
        return Response({"detail": "Confirmation is required"}, status=status.HTTP_400_BAD_REQUEST)
    if not request.user.check_password(payload["current_password"]):
        return Response({"detail": "Current password is incorrect"}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        log_portal_audit_event(
            request=request,
            action="account.delete",
            target_type="account",
            target_id=str(request.user.pk),
            details={"deleted": True},
        )
        request.user.delete()
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def account_change_email_request(request):
    payload = dict(request.data)
    if "email" not in payload:
        for raw_key in ("new_email", "newEmail"):
            if raw_key in payload:
                payload["email"] = payload[raw_key]
                break

    serializer = AccountEmailSerializer(data=payload)
    serializer.is_valid(raise_exception=True)

    current_password = request.data.get("current_password")
    if not current_password:
        return Response({"detail": "Current password is required"}, status=status.HTTP_400_BAD_REQUEST)
    if not request.user.check_password(current_password):
        return Response({"detail": "Current password is incorrect"}, status=status.HTTP_400_BAD_REQUEST)

    new_email = serializer.validated_data["email"]
    if new_email.lower() == request.user.email.lower():
        return Response({"detail": "New email must be different from the current email"}, status=status.HTTP_400_BAD_REQUEST)

    profile = CommerceCustomerProfile.objects.filter(user=request.user, disabled_at__isnull=True, anonymized_at__isnull=True).first()
    if profile is None:
        return Response({"detail": "Account is unavailable"}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        raw_token = issue_account_action_token(
            user=request.user,
            purpose=AccountActionToken.Purpose.EMAIL_CHANGE,
            target_email=new_email,
            lifetime=settings.ACCOUNT_VERIFY_TOKEN_LIFETIME,
        )
        profile.email_verified_at = None
        profile.verified_email = ""
        profile.activation_pending = False
        profile.save(update_fields=["email_verified_at", "verified_email", "activation_pending", "updated_at"])

    log_portal_audit_event(
        request=request,
        action="account.email_change_request",
        target_type="account",
        target_id=str(request.user.pk),
        details={"new_email": new_email},
    )
    send_email_change_email(recipient_email=new_email, raw_token=raw_token)
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([AllowAny])
def account_change_email_complete(request):
    serializer = VerifyEmailSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    def apply_email_change(action_token):
        user = get_user_model().objects.select_for_update().get(pk=action_token.user_id)
        profile = CommerceCustomerProfile.objects.select_for_update().filter(
            user=user,
            disabled_at__isnull=True,
            anonymized_at__isnull=True,
        ).first()
        if profile is None:
            return None

        user.email = action_token.target_email
        user.save(update_fields=["email"])
        profile.verified_email = ""
        profile.email_verified_at = None
        profile.activation_pending = False
        profile.save(update_fields=["verified_email", "email_verified_at", "activation_pending", "updated_at"])
        return user.pk

    completed_user_id = consume_account_action_token(
        raw_token=serializer.validated_data["token"],
        purpose=AccountActionToken.Purpose.EMAIL_CHANGE,
        action=apply_email_change,
    )
    if completed_user_id is None:
        return Response({"detail": "Verification link is invalid or has expired."}, status=status.HTTP_400_BAD_REQUEST)
    return Response({"ok": True})


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
    phone = ""
    if commerce_profile is not None:
        phone = str(getattr(commerce_profile, "contact_phone", "") or "").strip()

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
    if phone:
        payload["phone"] = phone
    serializer = AccountBootstrapSerializer(payload)
    return Response(serializer.data)

import base64
import secrets
import time
from io import BytesIO
from pathlib import Path
from urllib.parse import quote
from uuid import UUID

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import HttpResponse
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

from .account_emails import send_email_change_email, send_security_notification_email, send_verification_email
from .account_tokens import consume_account_action_token, issue_account_action_token
from .audit import log_portal_audit_event
from .auth_sessions import SESSION_ID_CLAIM, revoke_account_session, revoke_user_sessions
from .capability_tokens import digest_capability_token
from .models import AccountActionToken, AccountSecurityState, AccountSession, AuditLog, CommerceCustomerProfile, GuestOrderClaim, OnsiteOrder, SavedAddress, UserProfile
from .privacy import recover_account_deletion, request_account_deletion
from .privacy_export import build_account_export
from .privacy_tokens import hash_recovery_code
from .request_security import client_ip
from .serializers import (
    AccountBootstrapSerializer,
    AccountChangePasswordSerializer,
    AccountDeleteRecoverySerializer,
    AccountDeleteSerializer,
    AccountDisableSerializer,
    AccountEmailSerializer,
    AccountMfaSetupSerializer,
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


def _build_account_order_invoice_pdf(order):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    buffer = BytesIO()
    document = canvas.Canvas(buffer, pagesize=A4)
    page_width, page_height = A4
    margin = 20 * mm
    y_position = page_height - margin
    logo_path = Path(__file__).resolve().parents[2] / "frontend" / "public" / "logo-navbar.png"

    if logo_path.exists():
        document.drawImage(
            str(logo_path),
            margin,
            y_position - 16 * mm,
            width=58 * mm,
            height=16 * mm,
            preserveAspectRatio=True,
            mask="auto",
        )
    y_position -= 26 * mm
    document.setStrokeColor(colors.HexColor("#123A7A"))
    document.setLineWidth(1.5)
    document.line(margin, y_position, page_width - margin, y_position)
    y_position -= 12 * mm

    document.setFillColor(colors.HexColor("#123A7A"))
    document.setFont("Helvetica-Bold", 18)
    document.drawString(margin, y_position, "Invoice")
    document.setFillColor(colors.HexColor("#172033"))
    document.setFont("Helvetica-Bold", 10)
    document.drawRightString(page_width - margin, y_position, order.order_number)
    y_position -= 6 * mm
    document.setFont("Helvetica", 9)
    created_at = timezone.localtime(order.created_at).strftime("%d %b %Y") if order.created_at else ""
    document.drawRightString(page_width - margin, y_position, created_at)
    y_position -= 12 * mm

    document.setFont("Helvetica-Bold", 9)
    document.drawString(margin, y_position, "Delivery details")
    y_position -= 5 * mm
    document.setFont("Helvetica", 9)
    delivery_lines = [
        order.shipping_name or order.customer_name,
        order.shipping_address_line_1,
        order.shipping_address_line_2,
        ", ".join(part for part in [order.shipping_city, order.shipping_county, order.shipping_postcode] if part),
        order.shipping_country_code,
    ]
    for line in filter(None, delivery_lines):
        document.drawString(margin, y_position, str(line))
        y_position -= 5 * mm
    y_position -= 5 * mm

    document.setFillColor(colors.HexColor("#F1F5F9"))
    document.rect(margin, y_position - 7 * mm, page_width - (2 * margin), 7 * mm, fill=1, stroke=0)
    document.setFillColor(colors.HexColor("#475569"))
    document.setFont("Helvetica-Bold", 8)
    document.drawString(margin + 3 * mm, y_position - 4.5 * mm, "ITEM")
    document.drawRightString(page_width - margin - 38 * mm, y_position - 4.5 * mm, "QTY")
    document.drawRightString(page_width - margin - 3 * mm, y_position - 4.5 * mm, "TOTAL")
    y_position -= 12 * mm

    line_items = order.line_items if isinstance(order.line_items, list) else []
    for item in line_items:
        if y_position < 55 * mm:
            document.showPage()
            y_position = page_height - margin
        title = str(item.get("title") or item.get("sku") or "Item")
        quantity = int(item.get("quantity") or 0)
        line_total = int(item.get("lineTotalCents") or 0)
        document.setFillColor(colors.HexColor("#172033"))
        document.setFont("Helvetica", 9)
        document.drawString(margin + 3 * mm, y_position, title[:72])
        document.drawRightString(page_width - margin - 38 * mm, y_position, str(quantity))
        document.drawRightString(page_width - margin - 3 * mm, y_position, f"{line_total / 100:,.2f} {order.currency}")
        document.setStrokeColor(colors.HexColor("#E2E8F0"))
        document.line(margin, y_position - 3 * mm, page_width - margin, y_position - 3 * mm)
        y_position -= 8 * mm

    subtotal_cents = int(order.subtotal_cents or sum(int(item.get("lineTotalCents") or 0) for item in line_items))
    summary_rows = [
        ("Subtotal", subtotal_cents),
        ("Shipping paid", int(order.shipping_cents or 0)),
        ("Taxes", int(order.tax_cents or 0)),
        ("Total paid", int(order.amount_total_cents or 0)),
    ]
    y_position -= 4 * mm
    for label, amount_cents in summary_rows:
        is_total = label == "Total paid"
        document.setFont("Helvetica-Bold" if is_total else "Helvetica", 10 if is_total else 9)
        document.setFillColor(colors.HexColor("#123A7A") if is_total else colors.HexColor("#475569"))
        document.drawRightString(page_width - margin - 42 * mm, y_position, label)
        document.drawRightString(page_width - margin, y_position, f"{amount_cents / 100:,.2f} {order.currency}")
        y_position -= 7 * mm

    document.save()
    return buffer.getvalue()


OPERATIONS_ACCOUNT_ROLES = {
    UserProfile.ROLE_OWNER,
    UserProfile.ROLE_OFFICE_STAFF,
    UserProfile.ROLE_STAFF,
}


def _is_operations_account(user):
    profile = UserProfile.objects.filter(user_id=user.pk).first()
    return bool(profile and profile.role in OPERATIONS_ACCOUNT_ROLES)


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


def generate_totp_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").strip("=")


def generate_totp_code(secret):
    if not secret:
        return ""
    counter = int(time.time()) // 30
    key = base64.b32decode(secret.upper() + '=' * ((8 - len(secret) % 8) % 8))
    import hashlib
    import hmac
    import struct

    digest = hmac.new(key, struct.pack('>Q', counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(binary % 1000000).zfill(6)


def _mfa_issuer_name():
    issuer = str(getattr(settings, "ACCOUNT_MFA_ISSUER", "") or "").strip()
    return issuer or "Manley Lifting"


def _mfa_account_label(user):
    email = str(getattr(user, "email", "") or "").strip()
    username = str(getattr(user, "username", "") or "").strip()
    return email or username or f"user-{user.pk}"


def _build_mfa_otpauth_uri(*, user, secret):
    issuer = _mfa_issuer_name()
    label = f"{issuer}:{_mfa_account_label(user)}"
    return f"otpauth://totp/{quote(label)}?secret={quote(secret)}&issuer={quote(issuer)}"


def _build_mfa_qr_code_url(otpauth_uri):
    # Render with a local QR image when available; otherwise fall back to a hosted QR URL.
    try:
        import io

        import qrcode
    except Exception:
        return f"https://quickchart.io/qr?size=240&text={quote(otpauth_uri, safe='')}"

    image = qrcode.make(otpauth_uri)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


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
                existing_user = (
                    user_model.objects.select_related("commerce_profile")
                    .filter(Q(email__iexact=email) | Q(username__iexact=email))
                    .order_by("id")
                    .first()
                )
                if existing_user is not None:
                    profile = getattr(existing_user, "commerce_profile", None)
                    if (
                        profile is not None
                        and profile.disabled_at is None
                        and profile.anonymized_at is None
                        and not profile.has_verified_email()
                    ):
                        _issue_verification(user=existing_user)
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

    def get(self, request, checkout_ref=None, order_number=None, invoice=False):
        if not self._has_verified_commerce_access(request.user):
            return Response({"detail": "Account access is not available yet."}, status=status.HTTP_403_FORBIDDEN)

        queryset = OnsiteOrder.objects.filter(user=request.user).order_by("-created_at")
        if checkout_ref is not None:
            order = queryset.filter(checkout_ref=checkout_ref).first()
            if order is None:
                return Response({"detail": "Order not found."}, status=status.HTTP_404_NOT_FOUND)
            return Response(self._serialize_order(order))
        if order_number is not None:
            order = queryset.filter(order_number=order_number).first()
            if order is None:
                return Response({"detail": "Order not found."}, status=status.HTTP_404_NOT_FOUND)
            if invoice:
                response = HttpResponse(_build_account_order_invoice_pdf(order), content_type="application/pdf")
                response["Content-Disposition"] = f'attachment; filename="invoice-{order.order_number}.pdf"'
                return response
            return Response(self._serialize_order(order))

        orders = queryset.values(
            "checkout_ref",
            "order_number",
            "status",
            "payment_status",
            "fulfillment_status",
            "customer_name",
            "customer_email",
            "line_items",
            "amount_total_cents",
            "subtotal_cents",
            "discount_cents",
            "shipping_cents",
            "tax_cents",
            "currency",
            "paid_at",
            "created_at",
            "shipping_name",
            "shipping_phone",
            "shipping_address_line_1",
            "shipping_address_line_2",
            "shipping_city",
            "shipping_county",
            "shipping_postcode",
            "shipping_country_code",
        )
        payload = []
        for order in orders:
            payload.append(
                {
                    "checkoutRef": order["checkout_ref"],
                    "orderNumber": order["order_number"],
                    "status": order["status"],
                    "paymentStatus": order["payment_status"] or OnsiteOrder(
                        status=order["status"]
                    ).get_payment_status_from_legacy(),
                    "fulfillmentStatus": order["fulfillment_status"] or OnsiteOrder(
                        status=order["status"]
                    ).get_fulfillment_status_from_legacy(),
                    "customerName": order["customer_name"],
                    "customerEmail": order["customer_email"],
                    "lineItems": order["line_items"],
                    "amountTotalCents": order["amount_total_cents"],
                    "subtotalCents": order["subtotal_cents"],
                    "discountCents": order["discount_cents"],
                    "shippingCents": order["shipping_cents"],
                    "taxCents": order["tax_cents"],
                    "currency": order["currency"],
                    "paidAt": order["paid_at"].isoformat() if order["paid_at"] else None,
                    "createdAt": order["created_at"].isoformat() if order["created_at"] else None,
                    "shippingName": order["shipping_name"],
                    "shippingPhone": order["shipping_phone"],
                    "shippingAddressLine1": order["shipping_address_line_1"],
                    "shippingAddressLine2": order["shipping_address_line_2"],
                    "shippingCity": order["shipping_city"],
                    "shippingCounty": order["shipping_county"],
                    "shippingPostcode": order["shipping_postcode"],
                    "shippingCountryCode": order["shipping_country_code"],
                }
            )
        return Response(payload)

    def _serialize_order(self, order):
        return {
            "checkoutRef": order.checkout_ref,
            "orderNumber": order.order_number,
            "status": order.status,
            "paymentStatus": order.payment_status or order.get_payment_status_from_legacy(),
            "fulfillmentStatus": order.fulfillment_status or order.get_fulfillment_status_from_legacy(),
            "customerName": order.customer_name,
            "customerEmail": order.customer_email,
            "lineItems": order.line_items,
            "amountTotalCents": order.amount_total_cents,
            "subtotalCents": order.subtotal_cents,
            "discountCents": order.discount_cents,
            "shippingCents": order.shipping_cents,
            "taxCents": order.tax_cents,
            "orderItems": [
                {
                    "sku": item.sku,
                    "title": item.title,
                    "variantRef": item.variant_ref,
                    "unitPriceCents": item.unit_price_cents,
                    "quantity": item.quantity,
                    "lineTotalCents": item.line_total_cents,
                }
                for item in order.order_items.all()
            ],
            "currency": order.currency,
            "paidAt": order.paid_at.isoformat() if order.paid_at else None,
            "createdAt": order.created_at.isoformat() if order.created_at else None,
            "shippingName": order.shipping_name,
            "shippingPhone": order.shipping_phone,
            "shippingAddressLine1": order.shipping_address_line_1,
            "shippingAddressLine2": order.shipping_address_line_2,
            "shippingCity": order.shipping_city,
            "shippingCounty": order.shipping_county,
            "shippingPostcode": order.shipping_postcode,
            "shippingCountryCode": order.shipping_country_code,
        }

    def _has_verified_commerce_access(self, user):
        if _is_operations_account(user):
            return False
        profile = CommerceCustomerProfile.objects.filter(user=user).first()
        if profile is None:
            return True
        if profile.disabled_at is not None or profile.anonymized_at is not None:
            return False
        return bool(profile.has_verified_email())


class AccountAddressesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, address_id=None):
        if not self._has_verified_commerce_access(request.user):
            return Response({"detail": "Account access is not available yet."}, status=status.HTTP_403_FORBIDDEN)
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
        if not self._has_verified_commerce_access(request.user):
            return Response({"detail": "Account access is not available yet."}, status=status.HTTP_403_FORBIDDEN)

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

    def _has_verified_commerce_access(self, user):
        if _is_operations_account(user):
            return False
        profile = CommerceCustomerProfile.objects.filter(user=user).first()
        if profile is None:
            return True
        if profile.disabled_at is not None or profile.anonymized_at is not None:
            return False
        if profile.has_verified_email():
            return True
        return profile.saved_addresses.filter(is_deleted=False).exists()

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
def account_claim_order(request):
    order_number = str(request.data.get("orderNumber") or "").strip()
    claim_token = str(request.data.get("claimToken") or "").strip()

    if not order_number or not claim_token:
        return Response({"detail": "Order number and claim token are required."}, status=status.HTTP_400_BAD_REQUEST)

    profile = CommerceCustomerProfile.objects.filter(user=request.user, disabled_at__isnull=True, anonymized_at__isnull=True).first()
    if profile is None or not profile.has_verified_email():
        return Response({"detail": "Account access is not available yet."}, status=status.HTTP_403_FORBIDDEN)

    with transaction.atomic():
        claim = (
            GuestOrderClaim.objects.select_for_update()
            .filter(
                claim_token=digest_capability_token(claim_token),
                claim_state=GuestOrderClaim.STATE_PENDING,
            )
            .first()
        )
        if claim is None:
            return Response({"detail": "Claim token is invalid or has already been used."}, status=status.HTTP_400_BAD_REQUEST)
        if claim.expires_at and claim.expires_at < timezone.now():
            claim.claim_state = GuestOrderClaim.STATE_EXPIRED
            claim.save(update_fields=["claim_state", "updated_at"])
            return Response({"detail": "Claim token has expired."}, status=status.HTTP_400_BAD_REQUEST)
        if claim.order.order_number != order_number:
            return Response({"detail": "Claim token does not match the requested order."}, status=status.HTTP_400_BAD_REQUEST)
        if claim.order.user_id is not None:
            return Response({"detail": "This order is already attached to an account."}, status=status.HTTP_400_BAD_REQUEST)

        order = claim.order
        order.user = request.user
        order.save(update_fields=["user", "updated_at"])
        claim.claim_state = GuestOrderClaim.STATE_CLAIMED
        claim.claimed_by = request.user
        claim.claimed_at = timezone.now()
        claim.save(update_fields=["claim_state", "claimed_by", "claimed_at", "updated_at"])

    log_portal_audit_event(
        request=request,
        action="account.claim_order",
        target_type="order",
        target_id=str(order.order_number),
        details={"order_number": order.order_number},
        actor=request.user,
    )
    return Response({"ok": True, "orderNumber": order.order_number})


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

    log_portal_audit_event(
        request=request,
        action="account.password_change",
        target_type="account",
        target_id=str(request.user.pk),
        details={"changed": True},
    )
    send_security_notification_email(
        recipient_email=request.user.email,
        subject="Your Manley Lifting password was changed",
        text_body=(
            "Your Manley Lifting password was changed successfully.\n\n"
            "If you did not make this change, sign in immediately and review your active sessions."
        ),
    )
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def account_mfa_setup(request):
    serializer = AccountMfaSetupSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    payload = serializer.validated_data

    if not request.user.check_password(payload["current_password"]):
        return Response({"detail": "Current password is incorrect"}, status=status.HTTP_400_BAD_REQUEST)

    security_state, _ = AccountSecurityState.objects.get_or_create(user=request.user)
    if security_state.mfa_enabled:
        return Response({"setupInProgress": False, "enabled": True})

    secret = generate_totp_secret()
    security_state.mfa_pending_secret = secret
    security_state.mfa_enabled = False
    security_state.mfa_secret = ""
    security_state.mfa_recovery_codes = []
    security_state.save(update_fields=["mfa_pending_secret", "mfa_enabled", "mfa_secret", "mfa_recovery_codes", "updated_at"])
    otpauth_uri = _build_mfa_otpauth_uri(user=request.user, secret=secret)
    qr_code_url = _build_mfa_qr_code_url(otpauth_uri)

    log_portal_audit_event(
        request=request,
        action="account.mfa_setup",
        target_type="account",
        target_id=str(request.user.pk),
        details={"started": True},
    )
    return Response(
        {
            "setupInProgress": True,
            "secret": secret,
            "otpauthUri": otpauth_uri,
            "qrCodeUrl": qr_code_url,
            "recoveryCodes": [],
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def account_mfa_verify(request):
    code = str(request.data.get("code") or "").strip()
    if not code:
        return Response({"detail": "Verification code is required"}, status=status.HTTP_400_BAD_REQUEST)

    security_state = AccountSecurityState.objects.filter(user=request.user).first()
    if security_state is None:
        return Response({"detail": "MFA setup is not available"}, status=status.HTTP_400_BAD_REQUEST)
    if not security_state.mfa_pending_secret:
        return Response({"detail": "MFA setup is not available"}, status=status.HTTP_400_BAD_REQUEST)
    if generate_totp_code(security_state.mfa_pending_secret) != code:
        return Response({"detail": "Invalid verification code"}, status=status.HTTP_400_BAD_REQUEST)

    recovery_codes = [f"recovery-{secrets.token_hex(3).upper()}" for _ in range(6)]
    security_state.mfa_enabled = True
    security_state.mfa_secret = security_state.mfa_pending_secret
    security_state.mfa_pending_secret = ""
    security_state.mfa_recovery_codes = [hash_recovery_code(code) for code in recovery_codes]
    security_state.save(update_fields=["mfa_enabled", "mfa_secret", "mfa_pending_secret", "mfa_recovery_codes", "updated_at"])

    log_portal_audit_event(
        request=request,
        action="account.mfa_verify",
        target_type="account",
        target_id=str(request.user.pk),
        details={"enabled": True},
    )
    send_security_notification_email(
        recipient_email=request.user.email,
        subject="Multi-factor authentication was enabled on your account",
        text_body=(
            "Multi-factor authentication was enabled on your Manley Lifting account.\n\n"
            "If you did not make this change, sign in immediately and review your active sessions."
        ),
    )
    return Response({"ok": True, "recoveryCodes": recovery_codes})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def account_security_events(request):
    events = (
        AuditLog.objects.filter(actor=request.user)
        .filter(action__in=[
            "account.password_change",
            "account.logout_all",
            "account.disable",
            "account.delete",
            "account.email_change_request",
            "account.password_reset",
            "account.mfa_setup",
            "account.mfa_verify",
            "account.claim_order",
        ])
        .order_by("-created_at")[:10]
        .values("action", "target_type", "target_id", "details", "created_at")
    )
    payload = []
    for event in events:
        payload.append(
            {
                "action": event["action"],
                "targetType": event["target_type"],
                "targetId": event["target_id"],
                "details": event["details"],
                "createdAt": event["created_at"].isoformat() if event["created_at"] else None,
            }
        )
    return Response(payload)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def account_sessions(request):
    current_session_id = None
    auth = getattr(request, "auth", None)
    if auth is not None:
        current_session_id = str(auth.get(SESSION_ID_CLAIM) or "")

    queryset = AccountSession.objects.filter(user=request.user).order_by("-created_at")
    payload = []
    for session in queryset:
        session_id = str(session.pk)
        payload.append(
            {
                "id": session_id,
                "createdAt": session.created_at.isoformat() if session.created_at else None,
                "lastSeenAt": session.last_seen_at.isoformat() if session.last_seen_at else None,
                "expiresAt": session.expires_at.isoformat() if session.expires_at else None,
                "revokedAt": session.revoked_at.isoformat() if session.revoked_at else None,
                "isCurrentSession": session_id == current_session_id,
                "isActive": session.revoked_at is None and session.expires_at > timezone.now(),
                "isRevoked": session.revoked_at is not None,
            }
        )
    return Response(payload)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def account_revoke_session(request, session_id):
    try:
        session_uuid = UUID(str(session_id))
    except (TypeError, ValueError, AttributeError):
        return Response({"detail": "Session not found."}, status=status.HTTP_404_NOT_FOUND)

    session = AccountSession.objects.filter(user=request.user, pk=session_uuid).first()
    if session is None:
        return Response({"detail": "Session not found."}, status=status.HTTP_404_NOT_FOUND)

    revoke_account_session(session_id=session_uuid, user=request.user)
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def account_logout_all(request):
    revoke_user_sessions(request.user)
    log_portal_audit_event(
        request=request,
        action="account.logout_all",
        target_type="account",
        target_id=str(request.user.pk),
        details={"revoked": True},
    )
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def account_export(request):
    if _is_operations_account(request.user):
        return Response({"detail": "Account access is not available yet."}, status=status.HTTP_403_FORBIDDEN)

    profile = CommerceCustomerProfile.objects.filter(user=request.user).first()
    if profile is None:
        return Response({"detail": "Account access is not available yet."}, status=status.HTTP_403_FORBIDDEN)
    if profile.disabled_at is not None or profile.anonymized_at is not None or not profile.has_verified_email():
        return Response({"detail": "Account access is not available yet."}, status=status.HTTP_403_FORBIDDEN)

    payload = build_account_export(request.user, request=request)
    
    log_portal_audit_event(
        request=request,
        action="account.export",
        target_type="account",
        target_id=str(request.user.id),
        details={"export_version": payload.get("version"), "generated_at": payload.get("generatedAt")},
        actor=request.user,
    )
    
    return Response(payload)


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

    profile = CommerceCustomerProfile.objects.filter(user=request.user).first()
    if profile is not None and profile.deletion_requested_at is not None and profile.deletion_expires_at is not None:
        return Response({"detail": "Account deletion is already pending."}, status=status.HTTP_409_CONFLICT)

    request_account_deletion(request.user, request)
    log_portal_audit_event(
        request=request,
        action="account.delete",
        target_type="account",
        target_id=str(request.user.pk),
        details={"deletion_requested_at": timezone.now().isoformat()},
    )
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def account_delete_recover(request):
    serializer = AccountDeleteRecoverySerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    payload = serializer.validated_data

    if not request.user.check_password(payload["current_password"]):
        return Response({"detail": "Current password is incorrect"}, status=status.HTTP_400_BAD_REQUEST)

    profile = CommerceCustomerProfile.objects.filter(user=request.user).first()
    if profile is None or profile.deletion_requested_at is None or profile.deletion_expires_at is None:
        return Response({"detail": "No pending account deletion recovery is available."}, status=status.HTTP_400_BAD_REQUEST)
    if profile.deletion_expires_at <= timezone.now():
        return Response({"detail": "Account recovery window has expired."}, status=status.HTTP_410_GONE)

    recover_account_deletion(request.user)
    log_portal_audit_event(
        request=request,
        action="account.delete_recover",
        target_type="account",
        target_id=str(request.user.pk),
        details={"recovered": True},
    )
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
    if not verify_turnstile_token(
        serializer.validated_data.get("turnstile_token"),
        required=settings.ACCOUNT_REQUIRE_TURNSTILE,
        secret_key=settings.ACCOUNT_TURNSTILE_SECRET_KEY,
        remote_ip=client_ip(request),
    ):
        return Response({"detail": "Bot verification failed"}, status=status.HTTP_400_BAD_REQUEST)

    current_password = request.data.get("current_password")
    if not current_password:
        return Response({"detail": "Current password is required"}, status=status.HTTP_400_BAD_REQUEST)
    if not request.user.check_password(current_password):
        return Response({"detail": "Current password is incorrect"}, status=status.HTTP_400_BAD_REQUEST)

    new_email = serializer.validated_data["email"]
    if new_email.lower() == request.user.email.lower():
        return Response({"detail": "New email must be different from the current email"}, status=status.HTTP_400_BAD_REQUEST)

    profile = CommerceCustomerProfile.objects.filter(user=request.user, disabled_at__isnull=True, anonymized_at__isnull=True).first()
    if profile is None or not profile.has_verified_email():
        return Response({"detail": "Account access is not available yet."}, status=status.HTTP_403_FORBIDDEN)

    with transaction.atomic():
        raw_token = issue_account_action_token(
            user=request.user,
            purpose=AccountActionToken.Purpose.EMAIL_CHANGE,
            target_email=new_email,
            lifetime=settings.ACCOUNT_VERIFY_TOKEN_LIFETIME,
        )

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
        old_email = user.email
        now = timezone.now()
        profile = CommerceCustomerProfile.objects.select_for_update().filter(
            user=user,
            disabled_at__isnull=True,
            anonymized_at__isnull=True,
        ).first()
        if profile is None:
            return None

        user.email = action_token.target_email
        user.save(update_fields=["email"])
        profile.verified_email = action_token.target_email
        profile.email_verified_at = now
        profile.activation_pending = False
        profile.save(update_fields=["verified_email", "email_verified_at", "activation_pending", "updated_at"])
        send_security_notification_email(
            recipient_email=old_email,
            subject="Your Manley Lifting email address was changed",
            text_body=(
                f"Your Manley Lifting account email was changed to {action_token.target_email}.\n\n"
                "If you did not make this change, sign in immediately and review your account security settings."
            ),
        )
        if action_token.target_email and action_token.target_email.lower() != old_email.lower():
            send_security_notification_email(
                recipient_email=action_token.target_email,
                subject="Your Manley Lifting email address was changed",
                text_body=(
                    "Your Manley Lifting account email change has completed successfully.\n\n"
                    "If you did not make this change, sign in immediately and review your account security settings."
                ),
            )
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
    portal_profile = UserProfile.objects.filter(user_id=request.user.pk).first()
    is_operations_account = bool(
        portal_profile and portal_profile.role in OPERATIONS_ACCOUNT_ROLES
    )
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

    security_state = AccountSecurityState.objects.filter(user_id=request.user.pk).first()
    mfa_enabled = bool(security_state and security_state.mfa_enabled)
    mfa_setup_in_progress = bool(security_state and security_state.mfa_pending_secret)
    mfa_recovery_codes = []
    if security_state and security_state.mfa_recovery_codes:
        mfa_recovery_codes = list(security_state.mfa_recovery_codes or [])

    payload = {
        "username": request.user.username,
        "email": request.user.email or "",
        "full_name": request.user.get_full_name() or "",
        "email_verified": email_verified,
        "capabilities": {
            "can_shop": commerce_enabled and not is_operations_account,
            "can_view_orders": commerce_enabled and not is_operations_account,
            "can_access_portal": bool(portal_profile),
            "can_fulfill_orders": is_operations_account,
        },
    }
    if phone:
        payload["phone"] = phone
    if mfa_enabled or mfa_setup_in_progress or mfa_recovery_codes:
        payload["mfa_enabled"] = mfa_enabled
        payload["mfa_setup_in_progress"] = mfa_setup_in_progress
        payload["mfa_recovery_codes"] = mfa_recovery_codes
    serializer = AccountBootstrapSerializer(payload)
    return Response(serializer.data)

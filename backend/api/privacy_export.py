from django.utils import timezone

from .models import (
    AccountSecurityState,
    AccountSession,
    AuditLog,
    CommerceCustomerProfile,
    CookieConsentRecord,
    OnsiteOrder,
    SavedAddress,
)

EXPORT_VERSION = 1


def _serialize_datetime(value):
    return value.isoformat() if value else None


def _serialize_profile(user):
    profile = CommerceCustomerProfile.objects.filter(user=user).first()
    payload = {
        "username": user.username,
        "email": user.email or "",
        "fullName": user.get_full_name() or "",
        "emailVerified": bool(profile and profile.has_verified_email()),
        "termsAcceptedAt": _serialize_datetime(profile.terms_accepted_at if profile else None),
        "privacyAcceptedAt": _serialize_datetime(profile.privacy_accepted_at if profile else None),
        "deletionRequestedAt": _serialize_datetime(profile.deletion_requested_at if profile else None),
        "deletionExpiresAt": _serialize_datetime(profile.deletion_expires_at if profile else None),
        "createdAt": _serialize_datetime(getattr(user, "date_joined", None)),
    }
    if profile is not None:
        payload["activationPending"] = bool(profile.activation_pending)
        payload["disabledAt"] = _serialize_datetime(profile.disabled_at)
    return payload


def _serialize_order(order):
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
        "currency": order.currency,
        "paidAt": _serialize_datetime(order.paid_at),
        "createdAt": _serialize_datetime(order.created_at),
        "shippingName": order.shipping_name,
        "shippingPhone": order.shipping_phone,
        "shippingAddressLine1": order.shipping_address_line_1,
        "shippingAddressLine2": order.shipping_address_line_2,
        "shippingCity": order.shipping_city,
        "shippingCounty": order.shipping_county,
        "shippingPostcode": order.shipping_postcode,
        "shippingCountryCode": order.shipping_country_code,
    }


def _serialize_address(address):
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
        "createdAt": _serialize_datetime(address.created_at),
    }


def _serialize_security_event(event):
    return {
        "action": event["action"],
        "targetType": event["target_type"],
        "targetId": event["target_id"],
        "details": event["details"],
        "createdAt": _serialize_datetime(event["created_at"]),
    }


def _serialize_session(session, current_session_id=None):
    session_id = str(session.pk)
    return {
        "id": session_id,
        "createdAt": _serialize_datetime(session.created_at),
        "lastSeenAt": _serialize_datetime(session.last_seen_at),
        "expiresAt": _serialize_datetime(session.expires_at),
        "revokedAt": _serialize_datetime(session.revoked_at),
        "isCurrentSession": session_id == current_session_id,
        "isActive": session.revoked_at is None and session.expires_at > timezone.now(),
        "isRevoked": session.revoked_at is not None,
        "ipAddress": session.ip_address,
        "userAgent": session.user_agent,
    }


def _serialize_audit_event(event):
    return {
        "action": event["action"],
        "targetType": event["target_type"],
        "targetId": event["target_id"],
        "details": event["details"],
        "createdAt": _serialize_datetime(event["created_at"]),
    }


def _serialize_consent_record(record):
    """Serialize consent record for export."""
    return {
        "version": record.consent_version,
        "categories": record.consent_categories,
        "consentedAt": _serialize_datetime(record.consented_at),
        "withdrawnAt": _serialize_datetime(record.withdrawn_at) if record.withdrawn_at else None,
    }


def build_account_export(user, request=None):
    profile = CommerceCustomerProfile.objects.filter(user=user).first()
    security_state = AccountSecurityState.objects.filter(user=user).first()

    current_session_id = None
    if request is not None:
        auth = getattr(request, "auth", None)
        if auth is not None:
            current_session_id = str(auth.get("session_id") or "")

    export = {
        "version": EXPORT_VERSION,
        "generatedAt": _serialize_datetime(timezone.now()),
        "profile": _serialize_profile(user),
        "orders": [_serialize_order(order) for order in OnsiteOrder.objects.filter(user=user).order_by("-created_at")],
        "addresses": [_serialize_address(address) for address in SavedAddress.objects.filter(commerce_profile__user=user, is_deleted=False).order_by("-created_at")],
        "securityEvents": [
            _serialize_security_event(event)
            for event in (
                AuditLog.objects.filter(actor=user)
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
                .order_by("-created_at")
                .values("action", "target_type", "target_id", "details", "created_at")[:10]
            )
        ],
        "sessions": [
            _serialize_session(session, current_session_id=current_session_id)
            for session in AccountSession.objects.filter(user=user).order_by("-created_at")
        ],
        "auditEvents": [
            _serialize_audit_event(event)
            for event in (
                AuditLog.objects.filter(actor=user)
                .order_by("-created_at")
                .values("action", "target_type", "target_id", "details", "created_at")[:50]
            )
        ],
        "consent": [
            _serialize_consent_record(record)
            for record in CookieConsentRecord.objects.filter(user=user).order_by("consented_at")
        ],
    }

    if security_state is not None:
        export["mfa"] = {
            "enabled": bool(security_state.mfa_enabled),
            "setupInProgress": bool(security_state.mfa_pending_secret),
        }
    return export

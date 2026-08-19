from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .audit import log_portal_audit_event
from .models import CookieConsentRecord


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def record_consent(request):
    """Record user's cookie consent decision."""
    consent_version = request.data.get("consent_version")
    consent_categories = request.data.get("consent_categories", [])

    if not consent_version or not isinstance(consent_categories, list):
        return Response(
            {"detail": "consent_version and consent_categories required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    with transaction.atomic():
        record = CookieConsentRecord.objects.create(
            user=request.user,
            consent_version=consent_version,
            consent_categories=consent_categories,
            consented_at=timezone.now(),
        )

        log_portal_audit_event(
            request=request,
            action="consent.record",
            target_type="consent",
            target_id=str(record.id),
            details={"version": consent_version, "categories": consent_categories},
            actor=request.user,
        )

    return Response(
        {
            "id": str(record.id),
            "consent_version": record.consent_version,
            "consented_at": record.consented_at.isoformat(),
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def withdraw_consent(request):
    """Withdraw user's cookie consent."""
    latest_consent = (
        CookieConsentRecord.objects.filter(user=request.user)
        .order_by("-consented_at")
        .first()
    )

    if latest_consent is None or latest_consent.withdrawn_at:
        return Response(
            {"detail": "No active consent to withdraw"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    latest_consent.withdrawn_at = timezone.now()
    latest_consent.save(update_fields=["withdrawn_at", "updated_at"])

    log_portal_audit_event(
        request=request,
        action="consent.withdraw",
        target_type="consent",
        target_id=str(latest_consent.id),
        details={},
        actor=request.user,
    )

    return Response(
        {
            "id": str(latest_consent.id),
            "withdrawn_at": latest_consent.withdrawn_at.isoformat(),
        }
    )

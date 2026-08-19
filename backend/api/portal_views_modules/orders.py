import os
import logging

import stripe
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.db import transaction
from django.db.models import Case, IntegerField, Value, When
from django.utils import timezone

from ..models import AuditLog, CatalogProduct, InventoryReservation, InventoryTransaction, OnsiteOrder, UserProfile
from ..order_emails import send_order_canceled_email, send_order_completed_email, send_order_shipped_email
from ..permissions import HasPortalAccess
from ..portal_views import _get_pagination_params, _paginate_queryset, _profile_for_user
from ..throttles import PortalMethodRateThrottle

stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "").strip()
logger = logging.getLogger(__name__)


def _can_view_fulfillment_orders(user):
    if user.is_superuser:
        return True
    role = _profile_for_user(user).role
    return role in {UserProfile.ROLE_OWNER, UserProfile.ROLE_OFFICE_STAFF, UserProfile.ROLE_STAFF}


def _can_update_fulfillment_order(user):
    if user.is_superuser:
        return True
    role = _profile_for_user(user).role
    return role in {UserProfile.ROLE_OWNER, UserProfile.ROLE_OFFICE_STAFF}


def _serialize_order_row(order):
    line_items = order.line_items if isinstance(order.line_items, list) else []
    return {
        "checkoutRef": order.checkout_ref,
        "orderNumber": order.order_number,
        "status": order.status,
        "paymentStatus": order.payment_status or order.get_payment_status_from_legacy(),
        "fulfillmentStatus": order.fulfillment_status or order.get_fulfillment_status_from_legacy(),
        "customerName": order.customer_name,
        "customerEmail": order.customer_email,
        "lineItemCount": len(line_items),
        "amountTotalCents": order.amount_total_cents,
        "subtotalCents": order.subtotal_cents,
        "discountCents": order.discount_cents,
        "shippingCents": order.shipping_cents,
        "taxCents": order.tax_cents,
        "currency": order.currency,
        "createdAt": order.created_at.isoformat() if order.created_at else None,
        "paidAt": order.paid_at.isoformat() if order.paid_at else None,
        "shippingName": order.shipping_name,
        "shippingCity": order.shipping_city,
        "shippingPostcode": order.shipping_postcode,
        "shippingCountryCode": order.shipping_country_code,
    }


def _serialize_order_detail(order):
    payload = _serialize_order_row(order)
    payload.update(
        {
            "lineItems": order.line_items if isinstance(order.line_items, list) else [],
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
            "shippingPhone": order.shipping_phone,
            "shippingAddressLine1": order.shipping_address_line_1,
            "shippingAddressLine2": order.shipping_address_line_2,
            "shippingCounty": order.shipping_county,
        }
    )
    return payload


PAID_CONFIRMED_STATUSES = {
    OnsiteOrder.STATUS_PAID,
    OnsiteOrder.STATUS_SHIPPED,
    OnsiteOrder.STATUS_COMPLETED,
}

FULFILLMENT_MUTABLE_STATUSES = {
    OnsiteOrder.STATUS_PAID,
    OnsiteOrder.STATUS_SHIPPED,
    OnsiteOrder.STATUS_COMPLETED,
}


def _apply_fulfillment_status_transition(*, order, next_status, actor=None):
    transition_map = {
        OnsiteOrder.STATUS_PAID: {OnsiteOrder.STATUS_SHIPPED, OnsiteOrder.STATUS_COMPLETED},
        OnsiteOrder.STATUS_SHIPPED: {OnsiteOrder.STATUS_COMPLETED},
        OnsiteOrder.STATUS_COMPLETED: set(),
    }
    allowed = transition_map.get(order.status, set())
    if next_status not in allowed:
        return False
    with transaction.atomic():
        locked_order = OnsiteOrder.objects.select_for_update().get(pk=order.pk)
        allowed = transition_map.get(locked_order.status, set())
        if next_status not in allowed:
            return False
        locked_order.status = next_status
        locked_order.fulfillment_actor = actor
        fulfillment_status_map = {
            OnsiteOrder.STATUS_PAID: OnsiteOrder.FULFILLMENT_STATUS_UNFULFILLED,
            OnsiteOrder.STATUS_SHIPPED: OnsiteOrder.FULFILLMENT_STATUS_SHIPPED,
            OnsiteOrder.STATUS_COMPLETED: OnsiteOrder.FULFILLMENT_STATUS_DELIVERED,
        }
        locked_order.fulfillment_status = fulfillment_status_map[next_status]

        if next_status == OnsiteOrder.STATUS_COMPLETED:
            reservations = InventoryReservation.objects.select_for_update().select_related("product").filter(
                order=locked_order,
                status=InventoryReservation.STATUS_RESERVED,
            )
            reservation_rows = list(reservations)
            products = {
                product_id: CatalogProduct.objects.select_for_update().get(pk=product_id)
                for product_id in {reservation.product_id for reservation in reservation_rows}
            }
            quantities_by_product = {}
            for reservation in reservation_rows:
                product = products[reservation.product_id]
                quantities_by_product[product.pk] = quantities_by_product.get(product.pk, 0) + reservation.quantity
            for product_id, quantity in quantities_by_product.items():
                product = products[product_id]
                if product.inventory_tracked and (
                    product.reserved_qty < quantity
                    or product.available_qty < quantity
                ):
                    transaction.set_rollback(True)
                    return False
            for reservation in reservation_rows:
                product = products[reservation.product_id]
                inventory_tracked = product.inventory_tracked
                if inventory_tracked:
                    product.available_qty -= reservation.quantity
                    product.reserved_qty -= reservation.quantity
                    product.save(update_fields=["available_qty", "reserved_qty", "updated_at"])
                reservation.status = InventoryReservation.STATUS_FULFILLED
                reservation.fulfilled_at = timezone.now()
                reservation.save(update_fields=["status", "fulfilled_at"])
                InventoryTransaction.objects.create(
                    product=product,
                    order=locked_order,
                    transaction_type=InventoryTransaction.TYPE_FULFILL,
                    quantity_change=-reservation.quantity,
                    reason="Order fulfilled",
                )

        timestamp_field = {
            OnsiteOrder.STATUS_SHIPPED: "shipped_at",
            OnsiteOrder.STATUS_COMPLETED: "delivered_at",
        }.get(next_status)
        if locked_order.processing_at is None:
            locked_order.processing_at = timezone.now()
        if timestamp_field:
            setattr(locked_order, timestamp_field, timezone.now())

        update_fields = ["status", "fulfillment_status", "fulfillment_actor", "processing_at", "updated_at"]
        if timestamp_field:
            update_fields.append(timestamp_field)
        locked_order.save(update_fields=update_fields)
        order.status = locked_order.status
        order.fulfillment_status = locked_order.fulfillment_status
    return True


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated, HasPortalAccess])
@throttle_classes([PortalMethodRateThrottle])
def portal_orders(request, order_number=None):
    if not _can_view_fulfillment_orders(request.user):
        return Response({"detail": "You do not have permission to view fulfillment orders."}, status=status.HTTP_403_FORBIDDEN)

    if order_number is not None:
        order = OnsiteOrder.objects.filter(
            order_number=order_number,
            status__in=PAID_CONFIRMED_STATUSES,
        ).first()
        if order is None:
            return Response({"detail": "Order not found."}, status=status.HTTP_404_NOT_FOUND)

        if request.method == "GET":
            return Response(_serialize_order_detail(order))

        if not _can_update_fulfillment_order(request.user):
            return Response({"detail": "You do not have permission to update fulfillment orders."}, status=status.HTTP_403_FORBIDDEN)

        action = str(request.data.get("action") or "").strip().lower()
        if action == "cancel":
            reason = str(request.data.get("reason") or "").strip()
            if not reason:
                return Response({"detail": "A cancellation reason is required."}, status=400)
            with transaction.atomic():
                from ..views import _release_order_reservations

                locked_order = OnsiteOrder.objects.select_for_update().get(pk=order.pk)
                if locked_order.status not in {OnsiteOrder.STATUS_PAID, OnsiteOrder.STATUS_SHIPPED}:
                    return Response({"detail": "This order cannot be canceled in its current state."}, status=400)
                _release_order_reservations(locked_order)
                locked_order.status = OnsiteOrder.STATUS_CANCELED
                locked_order.payment_status = locked_order.payment_status or OnsiteOrder.PAYMENT_STATUS_PAID
                locked_order.fulfillment_status = OnsiteOrder.FULFILLMENT_STATUS_CANCELED
                locked_order.canceled_at = timezone.now()
                locked_order.cancellation_reason = reason
                locked_order.save(update_fields=["status", "payment_status", "fulfillment_status", "canceled_at", "cancellation_reason", "updated_at"])
                AuditLog.objects.create(actor=request.user, company=locked_order.company, action="order.canceled", target_type="onsite_order", target_id=str(locked_order.pk), details={"reason": reason})
                order = locked_order
            transaction.on_commit(lambda: send_order_canceled_email(order=order), robust=True)
            return Response(_serialize_order_detail(order))

        if action == "refund":
            if request.user.is_superuser is False and _profile_for_user(request.user).role != UserProfile.ROLE_OWNER:
                return Response({"detail": "Only owners can issue refunds."}, status=403)
            if not bool(request.data.get("confirmed")):
                return Response({"detail": "Refund confirmation is required."}, status=400)
            try:
                refund_cents = int(request.data.get("amountCents") or order.amount_total_cents)
            except (TypeError, ValueError):
                return Response({"detail": "amountCents must be an integer."}, status=400)
            if refund_cents <= 0 or refund_cents > order.amount_total_cents - order.refund_total_cents:
                return Response({"detail": "Refund amount exceeds the refundable order balance."}, status=400)
            reason = str(request.data.get("reason") or "").strip()
            if not reason:
                return Response({"detail": "A refund reason is required."}, status=400)
            if not stripe.api_key or not order.payment_intent_id:
                return Response({"detail": "This order is not refundable yet."}, status=400)
            try:
                refund = stripe.Refund.create(payment_intent=order.payment_intent_id, amount=refund_cents, metadata={"order_number": order.order_number})
            except Exception:
                logger.exception("Stripe refund failed for order %s", order.order_number)
                return Response({"detail": "Refund could not be started."}, status=502)
            AuditLog.objects.create(actor=request.user, company=order.company, action="order.refund_requested", target_type="onsite_order", target_id=str(order.pk), details={"amount_cents": refund_cents, "reason": reason, "refund_id": str(getattr(refund, "id", "") or refund.get("id", ""))})
            return Response({**_serialize_order_detail(order), "refundRequestedCents": refund_cents})

        next_status = str(request.data.get("status") or "").strip().lower()
        if next_status not in FULFILLMENT_MUTABLE_STATUSES:
            return Response(
                {"detail": "status must be paid, shipped, or completed"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if order.status == next_status:
            return Response(_serialize_order_detail(order))

        if not _apply_fulfillment_status_transition(order=order, next_status=next_status, actor=request.user):
            return Response(
                {"detail": "Invalid status transition for this order."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if next_status == OnsiteOrder.STATUS_SHIPPED:
            transaction.on_commit(lambda: send_order_shipped_email(order=order), robust=True)
        elif next_status == OnsiteOrder.STATUS_COMPLETED:
            transaction.on_commit(lambda: send_order_completed_email(order=order), robust=True)
        return Response(_serialize_order_detail(order))

    bucket = str(request.GET.get("bucket") or "recent").strip().lower()
    paid_confirmed_queryset = OnsiteOrder.objects.filter(status__in=PAID_CONFIRMED_STATUSES).order_by("-created_at")

    queryset = paid_confirmed_queryset
    if bucket in {"recent", "received"}:
        queryset = queryset.filter(status=OnsiteOrder.STATUS_PAID)
    elif bucket in {"shipped-completed", "shipped_completed", "completed", "shipped"}:
        queryset = (
            queryset.filter(status__in={OnsiteOrder.STATUS_SHIPPED, OnsiteOrder.STATUS_COMPLETED})
            .annotate(
                fulfillment_priority=Case(
                    When(status=OnsiteOrder.STATUS_SHIPPED, then=Value(0)),
                    When(status=OnsiteOrder.STATUS_COMPLETED, then=Value(1)),
                    default=Value(2),
                    output_field=IntegerField(),
                )
            )
            .order_by("fulfillment_priority", "-created_at")
        )
    elif bucket in {"pending-failed", "pending_failed", "pending", "failed"}:
        queryset = OnsiteOrder.objects.filter(
            status__in={
                OnsiteOrder.STATUS_PENDING,
                OnsiteOrder.STATUS_PROCESSING,
                OnsiteOrder.STATUS_FAILED,
            }
        ).order_by("-created_at")
    else:
        return Response(
            {"detail": "bucket must be recent, shipped-completed, or pending-failed"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    page, page_size = _get_pagination_params(request, default_page_size=6)
    paginated = _paginate_queryset(queryset, page, page_size)

    results = [_serialize_order_row(order) for order in paginated["results"]]

    return Response(
        {
            "results": results,
            "total_count": paginated["total_count"],
            "page": paginated["page"],
            "page_size": paginated["page_size"],
            "total_pages": paginated["total_pages"],
        }
    )

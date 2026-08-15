from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.db import transaction
from django.db.models import Case, IntegerField, Value, When

from ..models import OnsiteOrder, UserProfile
from ..order_emails import send_order_completed_email, send_order_shipped_email
from ..permissions import HasPortalAccess
from ..portal_views import _get_pagination_params, _paginate_queryset, _profile_for_user
from ..throttles import PortalMethodRateThrottle


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
        "customerName": order.customer_name,
        "customerEmail": order.customer_email,
        "lineItemCount": len(line_items),
        "amountTotalCents": order.amount_total_cents,
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


def _apply_fulfillment_status_transition(*, order, next_status):
    transition_map = {
        OnsiteOrder.STATUS_PAID: {OnsiteOrder.STATUS_SHIPPED, OnsiteOrder.STATUS_COMPLETED},
        OnsiteOrder.STATUS_SHIPPED: {OnsiteOrder.STATUS_COMPLETED},
        OnsiteOrder.STATUS_COMPLETED: set(),
    }
    allowed = transition_map.get(order.status, set())
    if next_status not in allowed:
        return False
    order.status = next_status
    order.save(update_fields=["status", "updated_at"])
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

        next_status = str(request.data.get("status") or "").strip().lower()
        if next_status not in FULFILLMENT_MUTABLE_STATUSES:
            return Response(
                {"detail": "status must be paid, shipped, or completed"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if order.status == next_status:
            return Response(_serialize_order_detail(order))

        if not _apply_fulfillment_status_transition(order=order, next_status=next_status):
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

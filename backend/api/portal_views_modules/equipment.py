from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import Company, Equipment
from ..portal_views import (
    _get_pagination_params,
    _is_staff_or_owner,
    _paginate_queryset,
    _visible_company_ids,
)
from ..serializers import EquipmentCreateSerializer, EquipmentSerializer
from ..throttles import PortalMethodRateThrottle


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def portal_equipment_list(request):
    if request.method == "POST":
        if not _is_staff_or_owner(request.user):
            return Response({"detail": "Insufficient permissions"}, status=status.HTTP_403_FORBIDDEN)

        company_id_raw = request.data.get("company_id")
        company_id = str(company_id_raw or "").strip()
        if not company_id:
            return Response({"detail": "company_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            company_id_int = int(company_id)
        except (TypeError, ValueError):
            return Response({"detail": "company_id must be a valid integer"}, status=status.HTTP_400_BAD_REQUEST)

        if company_id_int not in _visible_company_ids(request.user):
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

        company = Company.objects.filter(id=company_id_int, is_active=True).first()
        if not company:
            return Response({"detail": "Company not found"}, status=status.HTTP_404_NOT_FOUND)

        serializer = EquipmentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        equipment = serializer.save(company=company)
        return Response(EquipmentSerializer(equipment).data, status=status.HTTP_201_CREATED)

    company_id = request.GET.get("companyId")
    search = (request.GET.get("search") or "").strip()

    visible_ids = _visible_company_ids(request.user)
    equipment = Equipment.objects.filter(company_id__in=visible_ids)

    if company_id:
        equipment = equipment.filter(company_id=company_id)

    if search:
        equipment = equipment.filter(
            Q(name__icontains=search)
            | Q(asset_tag__icontains=search)
            | Q(serial_number__icontains=search)
            | Q(location__icontains=search)
        )

    equipment = equipment.select_related("company").order_by("company__name", "name")
    page, page_size = _get_pagination_params(request)
    paginated = _paginate_queryset(equipment, page, page_size)
    serializer = EquipmentSerializer(paginated["results"], many=True)
    return Response(
        {
            "results": serializer.data,
            "total_count": paginated["total_count"],
            "page": paginated["page"],
            "page_size": paginated["page_size"],
            "total_pages": paginated["total_pages"],
        }
    )


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def portal_equipment_update(request, equipment_id):
    equipment = Equipment.objects.select_related("company").filter(id=equipment_id).first()
    if not equipment:
        return Response({"detail": "Equipment not found"}, status=status.HTTP_404_NOT_FOUND)

    if equipment.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if not _is_staff_or_owner(request.user):
        return Response({"detail": "Insufficient permissions"}, status=status.HTTP_403_FORBIDDEN)

    if "status" in request.data:
        new_status = request.data.get("status", "").strip().lower()
        if new_status not in {"active", "inactive", "retired", "decommissioned"}:
            return Response({"detail": "Invalid status value"}, status=status.HTTP_400_BAD_REQUEST)
        equipment.status = new_status
        if new_status == "decommissioned":
            equipment.decommissioned_at = timezone.now().date()
        elif new_status != "decommissioned":
            equipment.decommissioned_at = None
        equipment.save()

    return Response(EquipmentSerializer(equipment).data)

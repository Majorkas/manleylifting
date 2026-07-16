from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..audit import log_portal_audit_event
from ..models import AuditLog, Company, Equipment, InspectionReport, Site
from ..portal_views import (
    _get_or_create_default_site,
    _is_owner,
    _get_pagination_params,
    _is_staff_or_owner,
    _paginate_queryset,
    _visible_company_ids,
)
from ..serializers import EquipmentCreateSerializer, EquipmentSerializer, SiteCreateSerializer, SiteSerializer
from ..throttles import PortalMethodRateThrottle


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def portal_company_sites(request):
    company_id_raw = request.GET.get("companyId") if request.method == "GET" else request.data.get("company_id")
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

    if request.method == "GET":
        _get_or_create_default_site(company)
        serializer = SiteSerializer(company.sites.order_by("name", "id"), many=True)
        return Response({"results": serializer.data})

    if not _is_staff_or_owner(request.user):
        return Response({"detail": "Insufficient permissions"}, status=status.HTTP_403_FORBIDDEN)

    serializer = SiteCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    site_name = str(serializer.validated_data.get("name") or "").strip()
    if Site.objects.filter(company=company, name__iexact=site_name).exists():
        return Response({"detail": "A site with this name already exists for the company"}, status=status.HTTP_400_BAD_REQUEST)

    site = Site.objects.create(
        company=company,
        name=site_name,
        address=str(serializer.validated_data.get("address") or "").strip(),
    )
    return Response(SiteSerializer(site).data, status=status.HTTP_201_CREATED)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def portal_company_site_detail(request, site_id):
    site = Site.objects.select_related("company").filter(id=site_id).first()
    if not site:
        return Response({"detail": "Site not found"}, status=status.HTTP_404_NOT_FOUND)

    if site.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if not _is_owner(request.user):
        return Response({"detail": "Only owner or office staff can manage sites"}, status=status.HTTP_403_FORBIDDEN)

    if request.method == "PATCH":
        serializer = SiteCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        next_name = str(serializer.validated_data.get("name") or "").strip()
        next_address = str(serializer.validated_data.get("address") or "").strip()

        if (
            Site.objects.filter(company_id=site.company_id, name__iexact=next_name)
            .exclude(id=site.id)
            .exists()
        ):
            return Response({"detail": "A site with this name already exists for the company"}, status=status.HTTP_400_BAD_REQUEST)

        site.name = next_name
        site.address = next_address
        site.save(update_fields=["name", "address", "updated_at"])
        return Response(SiteSerializer(site).data)

    total_sites = Site.objects.filter(company_id=site.company_id).count()
    if total_sites <= 1:
        return Response({"detail": "A company must have at least one site"}, status=status.HTTP_400_BAD_REQUEST)

    equipment_count = Equipment.objects.filter(site_id=site.id).count()
    if equipment_count > 0:
        return Response(
            {"detail": "Move or remove equipment assigned to this site before deleting it"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    site.delete()
    return Response({"ok": True})


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

        site_id_raw = request.data.get("site_id")
        site_id = str(site_id_raw or "").strip()
        if not site_id:
            return Response({"detail": "site_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            site_id_int = int(site_id)
        except (TypeError, ValueError):
            return Response({"detail": "site_id must be a valid integer"}, status=status.HTTP_400_BAD_REQUEST)

        site = Site.objects.filter(id=site_id_int, company=company).first()
        if not site:
            return Response({"detail": "Site not found for company"}, status=status.HTTP_400_BAD_REQUEST)

        serializer = EquipmentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        equipment = serializer.save(company=company, site=site)
        return Response(EquipmentSerializer(equipment).data, status=status.HTTP_201_CREATED)

    company_id = request.GET.get("companyId")
    site_id = request.GET.get("siteId")
    search = (request.GET.get("search") or "").strip()

    visible_ids = _visible_company_ids(request.user)
    equipment = Equipment.objects.filter(company_id__in=visible_ids)

    if company_id:
        equipment = equipment.filter(company_id=company_id)

    if site_id:
        equipment = equipment.filter(site_id=site_id)

    if search:
        equipment = equipment.filter(
            Q(name__icontains=search)
            | Q(asset_tag__icontains=search)
            | Q(serial_number__icontains=search)
            | Q(location__icontains=search)
        )

    equipment = equipment.select_related("company", "site").order_by("company__name", "site__name", "name")
    page, page_size = _get_pagination_params(request)
    paginated = _paginate_queryset(equipment, page, page_size)

    latest_approved_report_by_equipment_id = {}
    latest_reports = (
        InspectionReport.objects.filter(
            equipment_id__in=[equipment_item.id for equipment_item in paginated["results"]],
            status=InspectionReport.STATUS_APPROVED,
            is_deleted=False,
        )
        .exclude(report_date__isnull=True)
        .select_related("equipment")
        .order_by("equipment_id", "-report_date", "-id")
    )
    for report in latest_reports:
        if report.equipment_id not in latest_approved_report_by_equipment_id:
            latest_approved_report_by_equipment_id[report.equipment_id] = report

    serializer = EquipmentSerializer(
        paginated["results"],
        many=True,
        context={"latest_approved_report_by_equipment_id": latest_approved_report_by_equipment_id},
    )
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
    equipment = Equipment.objects.select_related("company", "site").filter(id=equipment_id).first()
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
        previous_status = equipment.status
        equipment.status = new_status
        if new_status == "decommissioned":
            equipment.decommissioned_at = timezone.now().date()
        elif new_status != "decommissioned":
            equipment.decommissioned_at = None
        equipment.save(update_fields=["status", "decommissioned_at", "updated_at"])

        if previous_status != new_status:
            log_portal_audit_event(
                request=request,
                action="equipment.status_changed",
                target_type="equipment",
                target_id=equipment.id,
                company=equipment.company,
                details={"from": previous_status, "to": new_status},
            )

    return Response(EquipmentSerializer(equipment).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def portal_equipment_activity(request, equipment_id):
    equipment = Equipment.objects.select_related("company", "site").filter(id=equipment_id).first()
    if not equipment:
        return Response({"detail": "Equipment not found"}, status=status.HTTP_404_NOT_FOUND)

    if equipment.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    activity = (
        AuditLog.objects.select_related("actor")
        .filter(company_id=equipment.company_id)
        .filter(
            Q(target_type="equipment", target_id=str(equipment.id))
            | Q(details__equipment_id=equipment.id)
        )
        .order_by("-created_at")[:100]
    )

    results = []
    for entry in activity:
        actor = entry.actor
        actor_name = "System"
        if actor:
            actor_name = actor.get_full_name() or actor.username

        results.append(
            {
                "id": entry.id,
                "action": entry.action,
                "target_type": entry.target_type,
                "target_id": entry.target_id,
                "actor_name": actor_name,
                "details": entry.details or {},
                "created_at": entry.created_at.isoformat() if entry.created_at else "",
            }
        )

    return Response({"results": results})

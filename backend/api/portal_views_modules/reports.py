from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import Equipment, InspectionReport, ReportRevision, UserProfile
from ..portal_views import (
    _get_pagination_params,
    _is_engineer,
    _is_owner,
    _is_staff_or_owner,
    _paginate_queryset,
    _parse_removed_report_image_ids,
    _profile_for_user,
    _refresh_equipment_next_due_from_approved_reports,
    _remove_report_images,
    _report_snapshot,
    _upload_report_images,
    _validate_report_images,
    _visible_company_ids,
)
from ..serializers import (
    InspectionReportCreateSerializer,
    InspectionReportOwnerEditSerializer,
    InspectionReportSerializer,
    InspectionReportUpdateSerializer,
    ReportRevisionSerializer,
)
from ..throttles import PortalMethodRateThrottle


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def portal_equipment_reports(request, equipment_id):
    equipment = Equipment.objects.select_related("company").filter(id=equipment_id).first()
    if not equipment:
        return Response({"detail": "Equipment not found"}, status=status.HTTP_404_NOT_FOUND)

    if equipment.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        reports = equipment.reports.select_related("submitted_by", "edited_by").all()
        if _is_owner(request.user):
            pass
        elif _is_engineer(request.user):
            reports = reports.filter(
                Q(status=InspectionReport.STATUS_APPROVED)
                | Q(
                    submitted_by=request.user,
                    status__in=[InspectionReport.STATUS_DRAFT, InspectionReport.STATUS_SUBMITTED],
                )
            )
        else:
            reports = reports.filter(status=InspectionReport.STATUS_APPROVED)

        reports = reports.order_by("-updated_at", "-report_date", "-id")
        page, page_size = _get_pagination_params(request)
        paginated = _paginate_queryset(reports, page, page_size)
        serializer = InspectionReportSerializer(paginated["results"], many=True)
        return Response(
            {
                "results": serializer.data,
                "total_count": paginated["total_count"],
                "page": paginated["page"],
                "page_size": paginated["page_size"],
                "total_pages": paginated["total_pages"],
            }
        )

    if not _is_staff_or_owner(request.user):
        return Response({"detail": "Insufficient permissions"}, status=status.HTTP_403_FORBIDDEN)

    report_images = request.FILES.getlist("images")
    upload_error = _validate_report_images(report_images)
    if upload_error:
        return Response({"detail": upload_error}, status=status.HTTP_400_BAD_REQUEST)

    serializer = InspectionReportCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    status_value = serializer.validated_data.get("status", InspectionReport.STATUS_DRAFT)
    if status_value not in {InspectionReport.STATUS_DRAFT, InspectionReport.STATUS_SUBMITTED}:
        return Response(
            {"detail": "Staff reports can only be saved as draft or submitted"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        with transaction.atomic():
            report = serializer.save(equipment=equipment, submitted_by=request.user)
            if report_images:
                _upload_report_images(report, report_images, request.user)
    except ValueError as error:
        return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)

    return Response(InspectionReportSerializer(report).data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def portal_pending_report_approvals(request):
    if not _is_owner(request.user):
        return Response({"detail": "Only owner can view pending approvals"}, status=status.HTTP_403_FORBIDDEN)

    reports = (
        InspectionReport.objects.select_related("submitted_by", "equipment__company")
        .filter(status=InspectionReport.STATUS_SUBMITTED, equipment__company_id__in=_visible_company_ids(request.user))
        .order_by("-updated_at", "-report_date", "-id")
    )
    page, page_size = _get_pagination_params(request)
    paginated = _paginate_queryset(reports, page, page_size)
    serializer = InspectionReportSerializer(paginated["results"], many=True)
    return Response(
        {
            "results": serializer.data,
            "total_count": paginated["total_count"],
            "page": paginated["page"],
            "page_size": paginated["page_size"],
            "total_pages": paginated["total_pages"],
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def portal_dashboard_stats(request):
    if not _is_owner(request.user):
        return Response({"detail": "Only owner can view dashboard stats"}, status=status.HTTP_403_FORBIDDEN)

    visible_ids = _visible_company_ids(request.user)
    today = timezone.localdate()
    due_soon_cutoff = today + timedelta(days=14)

    equipment = Equipment.objects.filter(company_id__in=visible_ids).exclude(status=Equipment.STATUS_DECOMMISSIONED)

    overdue_count = equipment.filter(next_inspection_due__lt=today).count()
    due_soon_count = equipment.filter(next_inspection_due__gte=today, next_inspection_due__lte=due_soon_cutoff).count()
    pending_approvals_count = InspectionReport.objects.filter(
        status=InspectionReport.STATUS_SUBMITTED,
        equipment__company_id__in=visible_ids,
    ).count()

    return Response(
        {
            "overdue_count": overdue_count,
            "due_soon_count": due_soon_count,
            "pending_approvals_count": pending_approvals_count,
        }
    )


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def portal_report_owner_edit(request, report_id):
    report = InspectionReport.objects.select_related("equipment__company").filter(id=report_id).first()
    if not report:
        return Response({"detail": "Report not found"}, status=status.HTTP_404_NOT_FOUND)

    if report.equipment.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if _is_owner(request.user):
        report_images = request.FILES.getlist("images")
        removed_image_ids = _parse_removed_report_image_ids(request.data)
        upload_error = _validate_report_images(report_images)
        if upload_error:
            return Response({"detail": upload_error}, status=status.HTTP_400_BAD_REQUEST)

        previous_data = _report_snapshot(report)

        serializer = InspectionReportOwnerEditSerializer(report, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        status_value = serializer.validated_data.get("status", report.status)
        if status_value not in {InspectionReport.STATUS_SUBMITTED, InspectionReport.STATUS_APPROVED}:
            return Response(
                {"detail": "Owner reports can only be marked as submitted or approved"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        previous_status = report.status
        try:
            with transaction.atomic():
                serializer.save(edited_by=request.user)
                if previous_status == InspectionReport.STATUS_APPROVED or report.status == InspectionReport.STATUS_APPROVED:
                    _refresh_equipment_next_due_from_approved_reports(report.equipment)

                if removed_image_ids:
                    _remove_report_images(report, removed_image_ids)

                if report_images:
                    _upload_report_images(report, report_images, request.user)

                ReportRevision.objects.create(
                    report=report,
                    edited_by=request.user,
                    previous_data=previous_data,
                )
        except ValueError as error:
            return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(InspectionReportSerializer(report).data)

    profile = _profile_for_user(request.user)
    if profile.role not in {UserProfile.ROLE_ENGINEER, UserProfile.ROLE_STAFF}:
        return Response({"detail": "Only staff or owner can edit reports"}, status=status.HTTP_403_FORBIDDEN)

    if report.status != InspectionReport.STATUS_DRAFT:
        return Response({"detail": "Staff can only edit draft reports"}, status=status.HTTP_403_FORBIDDEN)

    if report.submitted_by_id != request.user.id:
        return Response({"detail": "Staff can only edit their own draft reports"}, status=status.HTTP_403_FORBIDDEN)

    report_images = request.FILES.getlist("images")
    removed_image_ids = _parse_removed_report_image_ids(request.data)
    upload_error = _validate_report_images(report_images)
    if upload_error:
        return Response({"detail": upload_error}, status=status.HTTP_400_BAD_REQUEST)

    serializer = InspectionReportUpdateSerializer(report, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)

    status_value = serializer.validated_data.get("status", report.status)
    if status_value not in {InspectionReport.STATUS_DRAFT, InspectionReport.STATUS_SUBMITTED}:
        return Response(
            {"detail": "Staff draft reports can only be saved as draft or submitted"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        with transaction.atomic():
            serializer.save(edited_by=request.user)
            if removed_image_ids:
                _remove_report_images(report, removed_image_ids)
            if report_images:
                _upload_report_images(report, report_images, request.user)
    except ValueError as error:
        return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)

    return Response(InspectionReportSerializer(report).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def portal_report_revisions(request, report_id):
    report = InspectionReport.objects.select_related("equipment__company").filter(id=report_id).first()
    if not report:
        return Response({"detail": "Report not found"}, status=status.HTTP_404_NOT_FOUND)

    if report.equipment.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if not _is_owner(request.user):
        return Response({"detail": "Only owner can view report revisions"}, status=status.HTTP_403_FORBIDDEN)

    revisions = report.revisions.select_related("edited_by").all()
    serializer = ReportRevisionSerializer(revisions, many=True)
    return Response({"results": serializer.data})

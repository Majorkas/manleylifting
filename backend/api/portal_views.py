from django.db.models import Q
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Certificate, Company, Equipment, InspectionReport, ReportRevision, UserProfile
from .serializers import (
    CertificateSerializer,
    CompanyHeaderSerializer,
    EquipmentSerializer,
    InspectionReportCreateSerializer,
    InspectionReportOwnerEditSerializer,
    InspectionReportSerializer,
    PortalMeSerializer,
)


def _profile_for_user(user):
    profile, _ = UserProfile.objects.get_or_create(
        user=user,
        defaults={"role": UserProfile.ROLE_CUSTOMER},
    )
    return profile


def _visible_companies(user):
    if user.is_superuser:
        return Company.objects.filter(is_active=True)

    profile = _profile_for_user(user)
    if profile.role == UserProfile.ROLE_OWNER:
        return Company.objects.filter(is_active=True)

    return profile.allowed_companies.filter(is_active=True)


def _visible_company_ids(user):
    return list(_visible_companies(user).values_list("id", flat=True))


def _is_staff_or_owner(user):
    if user.is_superuser:
        return True
    return _profile_for_user(user).role in {UserProfile.ROLE_STAFF, UserProfile.ROLE_OWNER}


def _is_owner(user):
    if user.is_superuser:
        return True
    return _profile_for_user(user).role == UserProfile.ROLE_OWNER


def _selected_company(user, company_id):
    companies = _visible_companies(user)
    if company_id:
        return companies.filter(id=company_id).first()
    return companies.order_by("name").first()


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def portal_me(request):
    profile = _profile_for_user(request.user)
    payload = {
        "id": request.user.id,
        "username": request.user.username,
        "email": request.user.email or "",
        "full_name": request.user.get_full_name() or "",
        "role": profile.role,
        "allowed_company_ids": _visible_company_ids(request.user),
    }
    serializer = PortalMeSerializer(payload)
    return Response(serializer.data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def portal_company_header(request):
    company_id = request.GET.get("companyId")
    company = _selected_company(request.user, company_id)
    if not company:
        return Response({"detail": "Company not found"}, status=status.HTTP_404_NOT_FOUND)

    serializer = CompanyHeaderSerializer(company, context={"request": request})
    return Response(serializer.data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def portal_equipment_list(request):
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

    serializer = EquipmentSerializer(
        equipment.select_related("company").order_by("company__name", "name")[:500],
        many=True,
    )
    return Response({"results": serializer.data})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def portal_equipment_reports(request, equipment_id):
    equipment = Equipment.objects.select_related("company").filter(id=equipment_id).first()
    if not equipment:
        return Response({"detail": "Equipment not found"}, status=status.HTTP_404_NOT_FOUND)

    if equipment.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        reports = equipment.reports.select_related("submitted_by", "edited_by").all()
        serializer = InspectionReportSerializer(reports, many=True)
        return Response({"results": serializer.data})

    if not _is_staff_or_owner(request.user):
        return Response({"detail": "Insufficient permissions"}, status=status.HTTP_403_FORBIDDEN)

    serializer = InspectionReportCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    report = serializer.save(equipment=equipment, submitted_by=request.user)
    return Response(InspectionReportSerializer(report).data, status=status.HTTP_201_CREATED)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def portal_report_owner_edit(request, report_id):
    report = InspectionReport.objects.select_related("equipment__company").filter(id=report_id).first()
    if not report:
        return Response({"detail": "Report not found"}, status=status.HTTP_404_NOT_FOUND)

    if report.equipment.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if not _is_owner(request.user):
        return Response({"detail": "Only owner can edit reports"}, status=status.HTTP_403_FORBIDDEN)

    previous_data = {
        "title": report.title,
        "summary": report.summary,
        "findings": report.findings,
        "recommendations": report.recommendations,
        "report_date": report.report_date.isoformat() if report.report_date else None,
        "status": report.status,
    }

    serializer = InspectionReportOwnerEditSerializer(report, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save(edited_by=request.user)

    ReportRevision.objects.create(
        report=report,
        edited_by=request.user,
        previous_data=previous_data,
    )

    return Response(InspectionReportSerializer(report).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def portal_equipment_certificates(request, equipment_id):
    equipment = Equipment.objects.select_related("company").filter(id=equipment_id).first()
    if not equipment:
        return Response({"detail": "Equipment not found"}, status=status.HTTP_404_NOT_FOUND)

    if equipment.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    certificates = Certificate.objects.filter(equipment_id=equipment.id).order_by("-created_at")
    serializer = CertificateSerializer(certificates, many=True, context={"request": request})
    return Response({"results": serializer.data})

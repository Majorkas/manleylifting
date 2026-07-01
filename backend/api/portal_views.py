import os
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.http import FileResponse
from django.db.models import Q
from django.utils.dateparse import parse_date
from django.utils.text import slugify
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Certificate, Company, Equipment, InspectionReport, ReportRevision, UserProfile
from .serializers import (
    CertificateSerializer,
    EquipmentCreateSerializer,
    CompanyHeaderSerializer,
    EquipmentSerializer,
    InspectionReportCreateSerializer,
    InspectionReportOwnerEditSerializer,
    InspectionReportSerializer,
    InspectionReportUpdateSerializer,
    PortalMeSerializer,
    PortalCustomerCreateResponseSerializer,
    PortalCustomerCreateSerializer,
    ReportRevisionSerializer,
    UserProfileAssignmentSerializer,
    UserProfileAssignmentUpdateSerializer,
)


CERTIFICATE_ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg"}
CERTIFICATE_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024


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


def _validate_certificate_upload(uploaded_file):
    if not uploaded_file:
        return "Certificate file is required"

    if uploaded_file.size > CERTIFICATE_MAX_FILE_SIZE_BYTES:
        return "Certificate file must be 10MB or smaller"

    extension = os.path.splitext(uploaded_file.name or "")[1].lower()
    if extension not in CERTIFICATE_ALLOWED_EXTENSIONS:
        return "Certificate file type must be PDF, PNG, JPG, or JPEG"

    return ""


def _report_snapshot(report):
    return {
        "title": report.title,
        "summary": report.summary,
        "findings": report.findings,
        "recommendations": report.recommendations,
        "report_date": report.report_date.isoformat() if report.report_date else None,
        "status": report.status,
    }


def _update_equipment_next_due_from_report(report):
    if report.status != InspectionReport.STATUS_SUBMITTED:
        return

    inspection_interval_days = report.equipment.inspection_interval_days or 365
    if not report.report_date:
        report.equipment.next_inspection_due = None
    else:
        report.equipment.next_inspection_due = report.report_date + timedelta(days=inspection_interval_days)
    report.equipment.save(update_fields=["next_inspection_due", "updated_at"])


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


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def portal_logout(request):
    refresh = str(request.data.get("refresh") or "").strip()
    if not refresh:
        return Response({"detail": "refresh token is required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        token = RefreshToken(refresh)
        token.blacklist()
    except TokenError:
        return Response({"detail": "invalid refresh token"}, status=status.HTTP_400_BAD_REQUEST)

    return Response({"ok": True})


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
def portal_companies(request):
    companies = _visible_companies(request.user).order_by("name")
    serializer = CompanyHeaderSerializer(companies, many=True, context={"request": request})
    return Response({"results": serializer.data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def portal_create_customer(request):
    if not _is_owner(request.user):
        return Response({"detail": "Only owner can create customers"}, status=status.HTTP_403_FORBIDDEN)

    serializer = PortalCustomerCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    payload = serializer.validated_data

    user_model = get_user_model()
    username = payload["customer_username"].strip()
    email = payload["customer_email"].strip().lower()
    company_name = payload["company_name"].strip()

    if user_model.objects.filter(username=username).exists():
        return Response({"detail": "customer_username already exists"}, status=status.HTTP_400_BAD_REQUEST)

    if user_model.objects.filter(email__iexact=email).exists():
        return Response({"detail": "customer_email already exists"}, status=status.HTTP_400_BAD_REQUEST)

    base_slug = slugify(company_name)[:200] or "company"
    slug = base_slug
    counter = 2
    while Company.objects.filter(slug=slug).exists():
        suffix = f"-{counter}"
        slug = f"{base_slug[: max(1, 200 - len(suffix))]}{suffix}"
        counter += 1

    with transaction.atomic():
        company = Company.objects.create(
            name=company_name,
            slug=slug,
            contact_email=payload.get("company_contact_email", "").strip(),
            contact_phone=payload.get("company_contact_phone", "").strip(),
            address=payload.get("company_address", "").strip(),
            is_active=True,
        )

        customer_user = user_model.objects.create_user(
            username=username,
            email=email,
            password=payload["customer_password"],
            first_name=payload.get("customer_first_name", "").strip(),
            last_name=payload.get("customer_last_name", "").strip(),
            is_active=True,
        )

        profile, _ = UserProfile.objects.get_or_create(
            user=customer_user,
            defaults={"role": UserProfile.ROLE_CUSTOMER},
        )
        profile.role = UserProfile.ROLE_CUSTOMER
        profile.save(update_fields=["role", "updated_at"])
        profile.allowed_companies.set([company])

    body = {
        "company": CompanyHeaderSerializer(company, context={"request": request}).data,
        "customer": {
            "id": customer_user.id,
            "username": customer_user.username,
            "email": customer_user.email,
            "full_name": customer_user.get_full_name() or "",
            "role": profile.role,
            "allowed_company_ids": [company.id],
        },
    }

    output = PortalCustomerCreateResponseSerializer(body)
    return Response(output.data, status=status.HTTP_201_CREATED)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
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

    serializer = EquipmentSerializer(
        equipment.select_related("company").order_by("company__name", "name")[:500],
        many=True,
    )
    return Response({"results": serializer.data})


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def portal_equipment_update(request, equipment_id):
    equipment = Equipment.objects.select_related("company").filter(id=equipment_id).first()
    if not equipment:
        return Response({"detail": "Equipment not found"}, status=status.HTTP_404_NOT_FOUND)

    if equipment.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if not _is_staff_or_owner(request.user):
        return Response({"detail": "Insufficient permissions"}, status=status.HTTP_403_FORBIDDEN)

    # Only allow updating status for now
    if "status" in request.data:
        from django.utils import timezone
        new_status = request.data.get("status", "").strip().lower()
        if new_status not in {"active", "inactive", "retired", "decommissioned"}:
            return Response(
                {"detail": "Invalid status value"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        equipment.status = new_status
        # Set decommissioned_at when marking as decommissioned
        if new_status == "decommissioned":
            equipment.decommissioned_at = timezone.now().date()
        elif new_status != "decommissioned":
            # Clear decommissioned_at if changing back to active
            equipment.decommissioned_at = None
        equipment.save()

    return Response(EquipmentSerializer(equipment).data)


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

    previous_status = None
    serializer = InspectionReportCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    status_value = serializer.validated_data.get("status", InspectionReport.STATUS_DRAFT)
    if status_value not in {InspectionReport.STATUS_DRAFT, InspectionReport.STATUS_SUBMITTED}:
        return Response(
            {"detail": "Staff reports can only be saved as draft or submitted"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    report = serializer.save(equipment=equipment, submitted_by=request.user)
    if report.status == InspectionReport.STATUS_SUBMITTED:
        _update_equipment_next_due_from_report(report)
    return Response(InspectionReportSerializer(report).data, status=status.HTTP_201_CREATED)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def portal_report_owner_edit(request, report_id):
    report = InspectionReport.objects.select_related("equipment__company").filter(id=report_id).first()
    if not report:
        return Response({"detail": "Report not found"}, status=status.HTTP_404_NOT_FOUND)

    if report.equipment.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if _is_owner(request.user):
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
        serializer.save(edited_by=request.user)

        if previous_status != InspectionReport.STATUS_SUBMITTED and report.status == InspectionReport.STATUS_SUBMITTED:
            _update_equipment_next_due_from_report(report)

        ReportRevision.objects.create(
            report=report,
            edited_by=request.user,
            previous_data=previous_data,
        )

        return Response(InspectionReportSerializer(report).data)

    profile = _profile_for_user(request.user)
    if profile.role != UserProfile.ROLE_STAFF:
        return Response({"detail": "Only staff or owner can edit reports"}, status=status.HTTP_403_FORBIDDEN)

    if report.status != InspectionReport.STATUS_DRAFT:
        return Response({"detail": "Staff can only edit draft reports"}, status=status.HTTP_403_FORBIDDEN)

    if report.submitted_by_id != request.user.id:
        return Response({"detail": "Staff can only edit their own draft reports"}, status=status.HTTP_403_FORBIDDEN)

    serializer = InspectionReportUpdateSerializer(report, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)

    status_value = serializer.validated_data.get("status", report.status)
    if status_value not in {InspectionReport.STATUS_DRAFT, InspectionReport.STATUS_SUBMITTED}:
        return Response(
            {"detail": "Staff draft reports can only be saved as draft or submitted"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    previous_status = report.status
    serializer.save(edited_by=request.user)

    if previous_status != InspectionReport.STATUS_SUBMITTED and report.status == InspectionReport.STATUS_SUBMITTED:
        _update_equipment_next_due_from_report(report)
    return Response(InspectionReportSerializer(report).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
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


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def portal_equipment_certificates(request, equipment_id):
    equipment = Equipment.objects.select_related("company").filter(id=equipment_id).first()
    if not equipment:
        return Response({"detail": "Equipment not found"}, status=status.HTTP_404_NOT_FOUND)

    if equipment.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        certificates = Certificate.objects.filter(equipment_id=equipment.id).order_by("-created_at")
        serializer = CertificateSerializer(certificates, many=True, context={"request": request})
        return Response({"results": serializer.data})

    if not _is_staff_or_owner(request.user):
        return Response({"detail": "Insufficient permissions"}, status=status.HTTP_403_FORBIDDEN)

    upload_error = _validate_certificate_upload(request.FILES.get("file"))
    if upload_error:
        return Response({"detail": upload_error}, status=status.HTTP_400_BAD_REQUEST)

    title = str(request.data.get("title") or "").strip()
    if not title:
        return Response({"detail": "title is required"}, status=status.HTTP_400_BAD_REQUEST)

    report_id = request.data.get("report")
    report = None
    if report_id:
        report = InspectionReport.objects.filter(id=report_id, equipment_id=equipment.id).first()
        if not report:
            return Response({"detail": "report is invalid for equipment"}, status=status.HTTP_400_BAD_REQUEST)

    issue_date_raw = request.data.get("issue_date")
    expiry_date_raw = request.data.get("expiry_date")
    issue_date = parse_date(str(issue_date_raw)) if issue_date_raw else None
    expiry_date = parse_date(str(expiry_date_raw)) if expiry_date_raw else None
    if issue_date_raw and issue_date is None:
        return Response({"detail": "issue_date must be YYYY-MM-DD"}, status=status.HTTP_400_BAD_REQUEST)
    if expiry_date_raw and expiry_date is None:
        return Response({"detail": "expiry_date must be YYYY-MM-DD"}, status=status.HTTP_400_BAD_REQUEST)

    certificate = Certificate.objects.create(
        company=equipment.company,
        equipment=equipment,
        report=report,
        title=title,
        file=request.FILES["file"],
        issue_date=issue_date,
        expiry_date=expiry_date,
        uploaded_by=request.user,
    )
    serializer = CertificateSerializer(certificate, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def portal_certificate_download(request, certificate_id):
    certificate = Certificate.objects.select_related("company").filter(id=certificate_id).first()
    if not certificate:
        return Response({"detail": "Certificate not found"}, status=status.HTTP_404_NOT_FOUND)

    if certificate.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if not certificate.file:
        return Response({"detail": "Certificate file not available"}, status=status.HTTP_404_NOT_FOUND)

    filename = os.path.basename(certificate.file.name)
    response = FileResponse(certificate.file.open("rb"), as_attachment=True, filename=filename)
    return response


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def portal_staff_assignments(request):
    if not _is_owner(request.user):
        return Response({"detail": "Only owner can manage assignments"}, status=status.HTTP_403_FORBIDDEN)

    if request.method == "GET":
        profiles = UserProfile.objects.select_related("user").prefetch_related("allowed_companies")
        serializer = UserProfileAssignmentSerializer(profiles, many=True)
        return Response({"results": serializer.data})

    serializer = UserProfileAssignmentUpdateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    payload = serializer.validated_data

    profile = UserProfile.objects.select_related("user").filter(user_id=payload["user_id"]).first()
    if not profile:
        return Response({"detail": "User profile not found"}, status=status.HTTP_404_NOT_FOUND)

    if "role" in payload:
        profile.role = payload["role"]
        profile.save(update_fields=["role", "updated_at"])

    if "allowed_company_ids" in payload:
        visible_ids = _visible_company_ids(request.user)
        allowed_ids = list(set(payload["allowed_company_ids"]) & set(visible_ids))
        companies = Company.objects.filter(id__in=allowed_ids, is_active=True)
        profile.allowed_companies.set(companies)

    output = UserProfileAssignmentSerializer(profile)
    return Response(output.data)

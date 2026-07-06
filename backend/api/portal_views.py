import json
import os
from datetime import timedelta

try:
    import cloudinary.uploader as cloudinary_uploader
except ImportError:
    cloudinary_uploader = None
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.http import FileResponse
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.utils.text import slugify
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Certificate, Company, Equipment, InspectionReport, ReportImage, ReportRevision, UserProfile
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
    PortalCustomerUpdateSerializer,
    PortalChangePasswordSerializer,
    ReportRevisionSerializer,
    UserProfileAssignmentSerializer,
    UserProfileAssignmentCreateSerializer,
    UserProfileAssignmentUpdateSerializer,
)


CERTIFICATE_ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg"}
CERTIFICATE_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
REPORT_IMAGE_ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
REPORT_IMAGE_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024


def _get_pagination_params(request, default_page_size=50):
    """Extract and validate pagination parameters from request."""
    try:
        page = int(request.GET.get('page', 1))
        page_size = int(request.GET.get('page_size', default_page_size))
    except (TypeError, ValueError):
        page = 1
        page_size = default_page_size

    page = max(1, page)
    page_size = max(1, min(page_size, 500))  # Cap at 500 per page
    return page, page_size


def _paginate_queryset(queryset, page, page_size):
    """Apply pagination to a queryset and return paginated results."""
    total_count = queryset.count()
    total_pages = (total_count + page_size - 1) // page_size
    start = (page - 1) * page_size
    end = start + page_size
    return {
        'results': list(queryset[start:end]),
        'total_count': total_count,
        'page': page,
        'page_size': page_size,
        'total_pages': total_pages,
    }


def _cloudinary_is_configured():
    return bool(
        os.getenv("CLOUDINARY_URL", "").strip()
        or (
            os.getenv("CLOUDINARY_CLOUD_NAME", "").strip()
            and os.getenv("CLOUDINARY_API_KEY", "").strip()
            and os.getenv("CLOUDINARY_API_SECRET", "").strip()
        )
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
    if profile.role in {UserProfile.ROLE_OWNER, UserProfile.ROLE_OFFICE_STAFF}:
        return Company.objects.filter(is_active=True)

    return profile.allowed_companies.filter(is_active=True)


def _visible_company_ids(user):
    return list(_visible_companies(user).values_list("id", flat=True))


def _is_staff_or_owner(user):
    if user.is_superuser:
        return True
    return _profile_for_user(user).role in {
        UserProfile.ROLE_ENGINEER,
        UserProfile.ROLE_STAFF,
        UserProfile.ROLE_OFFICE_STAFF,
        UserProfile.ROLE_OWNER,
    }


def _is_engineer(user):
    if user.is_superuser:
        return False
    return _profile_for_user(user).role in {UserProfile.ROLE_ENGINEER, UserProfile.ROLE_STAFF}


def _is_employee_role(role):
    return role in {UserProfile.ROLE_ENGINEER, UserProfile.ROLE_STAFF, UserProfile.ROLE_OFFICE_STAFF}


def _is_owner(user):
    if user.is_superuser:
        return True
    return _profile_for_user(user).role in {UserProfile.ROLE_OWNER, UserProfile.ROLE_OFFICE_STAFF}


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


def _validate_report_images(report_images):
    for uploaded_file in report_images:
        if uploaded_file.size > REPORT_IMAGE_MAX_FILE_SIZE_BYTES:
            return "Each report image must be 10MB or smaller"

        extension = os.path.splitext(uploaded_file.name or "")[1].lower()
        if extension not in REPORT_IMAGE_ALLOWED_EXTENSIONS:
            return "Report images must be PNG, JPG, JPEG, or WEBP"

    return ""


def _upload_report_images(report, report_images, uploaded_by=None):
    if cloudinary_uploader is None:
        raise ValueError("Cloudinary Python SDK is not installed")

    if not _cloudinary_is_configured():
        raise ValueError("Cloudinary is not configured")

    for uploaded_file in report_images:
        upload_result = cloudinary_uploader.upload(
            uploaded_file,
            folder="manleylifting/reports",
            resource_type="image",
            overwrite=False,
        )

        ReportImage.objects.create(
            report=report,
            image_url=str(upload_result.get("secure_url") or upload_result.get("url") or ""),
            public_id=str(upload_result.get("public_id") or ""),
            uploaded_by=uploaded_by,
        )


def _remove_report_images(report, removed_image_ids):
    removed_ids = [image_id for image_id in removed_image_ids if image_id is not None]
    if not removed_ids:
        return

    images_to_remove = list(report.images.filter(id__in=removed_ids))
    if not images_to_remove:
        return

    if cloudinary_uploader is not None and _cloudinary_is_configured():
        for image in images_to_remove:
            if not image.public_id:
                continue
            try:
                cloudinary_uploader.destroy(image.public_id, resource_type="image", invalidate=True)
            except Exception:
                pass

    report.images.filter(id__in=[image.id for image in images_to_remove]).delete()


def _parse_removed_report_image_ids(request_data):
    raw_value = request_data.get("removed_image_ids")
    if raw_value in (None, ""):
        return []

    if isinstance(raw_value, list):
        raw_items = raw_value
    else:
        try:
            parsed = json.loads(raw_value)
        except (TypeError, ValueError):
            parsed = raw_value

        if isinstance(parsed, list):
            raw_items = parsed
        else:
            raw_items = [item.strip() for item in str(parsed).split(",") if item.strip()]

    removed_ids = []
    for raw_item in raw_items:
        try:
            removed_ids.append(int(raw_item))
        except (TypeError, ValueError):
            continue

    return removed_ids


def _report_snapshot(report):
    return {
        "title": report.title,
        "summary": report.summary,
        "findings": report.findings,
        "recommendations": report.recommendations,
        "report_date": report.report_date.isoformat() if report.report_date else None,
        "status": report.status,
    }


def _refresh_equipment_next_due_from_approved_reports(equipment):
    latest_approved_report = (
        equipment.reports.filter(status=InspectionReport.STATUS_APPROVED)
        .exclude(report_date__isnull=True)
        .order_by("-report_date", "-id")
        .first()
    )

    inspection_interval_days = equipment.inspection_interval_days or 365
    if latest_approved_report and latest_approved_report.report_date:
        equipment.next_inspection_due = latest_approved_report.report_date + timedelta(days=inspection_interval_days)
    else:
        equipment.next_inspection_due = None

    equipment.save(update_fields=["next_inspection_due", "updated_at"])


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
        "required_password_change": bool(profile.required_password_change),
    }
    serializer = PortalMeSerializer(payload)
    return Response(serializer.data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def portal_change_password(request):
    serializer = PortalChangePasswordSerializer(data=request.data)
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
    except ValidationError as error:
        messages = list(error.messages or [])
        return Response(
            {"detail": messages[0] if messages else "Password is not valid"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    request.user.set_password(new_password)
    request.user.save()

    profile = _profile_for_user(request.user)
    if profile.required_password_change:
        profile.required_password_change = False
        profile.save(update_fields=["required_password_change", "updated_at"])

    return Response({"ok": True})


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
    today = timezone.localdate()
    due_soon_cutoff = today + timedelta(days=14)
    active_statuses = [
        Equipment.STATUS_ACTIVE,
        Equipment.STATUS_INACTIVE,
        Equipment.STATUS_RETIRED,
    ]

    companies = (
        _visible_companies(request.user)
        .annotate(
            inspections_overdue_count=Count(
                "equipment",
                filter=Q(
                    equipment__status__in=active_statuses,
                    equipment__next_inspection_due__lt=today,
                ),
                distinct=True,
            ),
            inspections_due_count=Count(
                "equipment",
                filter=Q(
                    equipment__status__in=active_statuses,
                    equipment__next_inspection_due__gte=today,
                    equipment__next_inspection_due__lte=due_soon_cutoff,
                ),
                distinct=True,
            ),
        )
        .order_by("name")
    )
    page, page_size = _get_pagination_params(request)
    paginated = _paginate_queryset(companies, page, page_size)
    serializer = CompanyHeaderSerializer(paginated['results'], many=True, context={"request": request})
    return Response({
        "results": serializer.data,
        "total_count": paginated['total_count'],
        "page": paginated['page'],
        "page_size": paginated['page_size'],
        "total_pages": paginated['total_pages'],
    })


@api_view(["POST", "PATCH"])
@permission_classes([IsAuthenticated])
def portal_create_customer(request):
    if not _is_owner(request.user):
        return Response({"detail": "Only owner can create customers"}, status=status.HTTP_403_FORBIDDEN)

    if request.method == "PATCH":
        serializer = PortalCustomerUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        company_id = payload["company_id"]
        company = Company.objects.filter(id=company_id, is_active=True).first()
        if not company:
            return Response({"detail": "Company not found"}, status=status.HTTP_404_NOT_FOUND)

        updates = []

        if "company_name" in payload:
            next_name = str(payload.get("company_name") or "").strip()
            if not next_name:
                return Response({"detail": "company_name cannot be blank"}, status=status.HTTP_400_BAD_REQUEST)
            if Company.objects.filter(name__iexact=next_name).exclude(id=company.id).exists():
                return Response({"detail": "company_name already exists"}, status=status.HTTP_400_BAD_REQUEST)
            company.name = next_name
            updates.append("name")

        if "company_contact_email" in payload:
            company.contact_email = str(payload.get("company_contact_email") or "").strip()
            updates.append("contact_email")

        if "company_contact_phone" in payload:
            company.contact_phone = str(payload.get("company_contact_phone") or "").strip()
            updates.append("contact_phone")

        if "company_address" in payload:
            company.address = str(payload.get("company_address") or "").strip()
            updates.append("address")

        if "is_active" in payload:
            company.is_active = bool(payload.get("is_active"))
            updates.append("is_active")

        if not updates:
            return Response({"detail": "No valid changes provided"}, status=status.HTTP_400_BAD_REQUEST)

        updates.append("updated_at")
        company.save(update_fields=updates)
        return Response(CompanyHeaderSerializer(company, context={"request": request}).data)

    serializer = PortalCustomerCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    payload = serializer.validated_data

    user_model = get_user_model()
    username = payload["customer_username"].strip().lower()
    email = payload["customer_email"].strip().lower()
    company_name = payload["company_name"].strip()

    if user_model.objects.filter(username__iexact=username).exists():
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
            defaults={
                "role": UserProfile.ROLE_CUSTOMER,
                "required_password_change": True,
            },
        )
        profile.role = UserProfile.ROLE_CUSTOMER
        profile.required_password_change = True
        profile.save(update_fields=["role", "required_password_change", "updated_at"])
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

    equipment = equipment.select_related("company").order_by("company__name", "name")
    page, page_size = _get_pagination_params(request)
    paginated = _paginate_queryset(equipment, page, page_size)
    serializer = EquipmentSerializer(paginated['results'], many=True)
    return Response({
        "results": serializer.data,
        "total_count": paginated['total_count'],
        "page": paginated['page'],
        "page_size": paginated['page_size'],
        "total_pages": paginated['total_pages'],
    })


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
        serializer = InspectionReportSerializer(paginated['results'], many=True)
        return Response({
            "results": serializer.data,
            "total_count": paginated['total_count'],
            "page": paginated['page'],
            "page_size": paginated['page_size'],
            "total_pages": paginated['total_pages'],
        })

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
    serializer = InspectionReportSerializer(paginated['results'], many=True)
    return Response({
        "results": serializer.data,
        "total_count": paginated['total_count'],
        "page": paginated['page'],
        "page_size": paginated['page_size'],
        "total_pages": paginated['total_pages'],
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
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

    return Response({
        "overdue_count": overdue_count,
        "due_soon_count": due_soon_count,
        "pending_approvals_count": pending_approvals_count,
    })


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
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
                if (
                    previous_status == InspectionReport.STATUS_APPROVED
                    or report.status == InspectionReport.STATUS_APPROVED
                ):
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


@api_view(["GET", "POST", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def portal_staff_assignments(request):
    if not _is_owner(request.user):
        return Response({"detail": "Only owner can manage assignments"}, status=status.HTTP_403_FORBIDDEN)

    if request.method == "GET":
        profiles = (
            UserProfile.objects.select_related("user")
            .prefetch_related("allowed_companies")
            .filter(role__in=[UserProfile.ROLE_ENGINEER, UserProfile.ROLE_STAFF, UserProfile.ROLE_OFFICE_STAFF])
            .order_by("-id")
        )
        page, page_size = _get_pagination_params(request)
        paginated = _paginate_queryset(profiles, page, page_size)
        serializer = UserProfileAssignmentSerializer(paginated['results'], many=True)
        return Response({
            "results": serializer.data,
            "total_count": paginated['total_count'],
            "page": paginated['page'],
            "page_size": paginated['page_size'],
            "total_pages": paginated['total_pages'],
        })

    if request.method == "POST":
        serializer = UserProfileAssignmentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        user_model = get_user_model()
        username = payload["username"].strip().lower()
        email = payload["email"].strip().lower()

        if user_model.objects.filter(username__iexact=username).exists():
            return Response({"detail": "username already exists"}, status=status.HTTP_400_BAD_REQUEST)

        if user_model.objects.filter(email__iexact=email).exists():
            return Response({"detail": "email already exists"}, status=status.HTTP_400_BAD_REQUEST)

        role = payload.get("role") or UserProfile.ROLE_ENGINEER
        if not _is_employee_role(role):
            return Response({"detail": "Employee role must be engineer or office staff"}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            created_user = user_model.objects.create_user(
                username=username,
                email=email,
                password=payload["password"],
                first_name=payload.get("first_name", "").strip(),
                last_name=payload.get("last_name", "").strip(),
                is_active=True,
            )

            profile, _ = UserProfile.objects.get_or_create(
                user=created_user,
                defaults={"role": role, "required_password_change": True},
            )
            profile.role = role
            profile.required_password_change = True
            profile.save(update_fields=["role", "required_password_change", "updated_at"])

            visible_ids = _visible_company_ids(request.user)
            requested_company_ids = payload.get("allowed_company_ids", [])
            allowed_ids = list(set(requested_company_ids) & set(visible_ids))
            companies = Company.objects.filter(id__in=allowed_ids, is_active=True)
            profile.allowed_companies.set(companies)

        output = UserProfileAssignmentSerializer(profile)
        return Response(output.data, status=status.HTTP_201_CREATED)

    if request.method == "DELETE":
        user_id_raw = request.data.get("user_id")
        try:
            user_id = int(user_id_raw)
        except (TypeError, ValueError):
            return Response({"detail": "user_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        if request.user.id == user_id:
            return Response({"detail": "You cannot remove your own account"}, status=status.HTTP_400_BAD_REQUEST)

        profile = UserProfile.objects.select_related("user").filter(user_id=user_id).first()
        if not profile:
            return Response({"detail": "User profile not found"}, status=status.HTTP_404_NOT_FOUND)

        if not _is_employee_role(profile.role):
            return Response({"detail": "Only employee accounts can be removed"}, status=status.HTTP_400_BAD_REQUEST)

        # Soft-delete: deactivate user instead of hard-delete to preserve report attribution
        profile.user.is_active = False
        profile.user.save(update_fields=["is_active", "updated_at"])
        return Response({"ok": True})

    serializer = UserProfileAssignmentUpdateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    payload = serializer.validated_data

    profile = UserProfile.objects.select_related("user").filter(user_id=payload["user_id"]).first()
    if not profile:
        return Response({"detail": "User profile not found"}, status=status.HTTP_404_NOT_FOUND)

    if not _is_employee_role(profile.role):
        return Response({"detail": "Only employee accounts can be updated"}, status=status.HTTP_400_BAD_REQUEST)

    if "role" in payload:
        if not _is_employee_role(payload["role"]):
            return Response(
                {"detail": "Employee role must be engineer or office staff"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        profile.role = payload["role"]
        profile.save(update_fields=["role", "updated_at"])

    if "allowed_company_ids" in payload:
        visible_ids = _visible_company_ids(request.user)
        allowed_ids = list(set(payload["allowed_company_ids"]) & set(visible_ids))
        companies = Company.objects.filter(id__in=allowed_ids, is_active=True)
        profile.allowed_companies.set(companies)

    output = UserProfileAssignmentSerializer(profile)
    return Response(output.data)

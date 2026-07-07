import json
import os
from datetime import timedelta

try:
    import cloudinary.uploader as cloudinary_uploader
except ImportError:
    cloudinary_uploader = None
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.text import slugify
from PIL import Image, UnidentifiedImageError
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from .auth_cookies import clear_refresh_cookie
from .models import Company, Equipment, InspectionReport, ReportImage, UserProfile
from .serializers import (
    CompanyHeaderSerializer,
    PortalMeSerializer,
    PortalCustomerCreateResponseSerializer,
    PortalCustomerCreateSerializer,
    PortalCustomerUpdateSerializer,
    PortalChangePasswordSerializer,
)
from .throttles import PortalMethodRateThrottle


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
    page_size = max(1, min(page_size, 100))  # Cap at 100 per page
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


def _suggest_available_username(base_username):
    user_model = get_user_model()
    base = str(base_username or "").strip().lower()
    if not base:
        return ""

    if not user_model.objects.filter(username__iexact=base).exists():
        return base

    suffix = 2
    while True:
        candidate = f"{base}{suffix}"
        if not user_model.objects.filter(username__iexact=candidate).exists():
            return candidate
        suffix += 1


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

    uploaded_file.seek(0)
    if extension == ".pdf":
        header = uploaded_file.read(5)
        uploaded_file.seek(0)
        if header != b"%PDF-":
            return "Certificate file content does not match the file extension"
        return ""

    allowed_image_formats = {
        ".png": {"PNG"},
        ".jpg": {"JPEG"},
        ".jpeg": {"JPEG"},
    }

    try:
        image = Image.open(uploaded_file)
        image.verify()
        image_format = str(image.format or "").upper()
    except (UnidentifiedImageError, OSError, ValueError):
        uploaded_file.seek(0)
        return "Certificate file content does not match the file extension"

    uploaded_file.seek(0)
    if image_format not in allowed_image_formats.get(extension, set()):
        return "Certificate file content does not match the file extension"

    return ""


def _validate_report_images(report_images):
    allowed_image_formats = {
        ".png": {"PNG"},
        ".jpg": {"JPEG"},
        ".jpeg": {"JPEG"},
        ".webp": {"WEBP"},
    }

    for uploaded_file in report_images:
        if uploaded_file.size > REPORT_IMAGE_MAX_FILE_SIZE_BYTES:
            return "Each report image must be 10MB or smaller"

        extension = os.path.splitext(uploaded_file.name or "")[1].lower()
        if extension not in REPORT_IMAGE_ALLOWED_EXTENSIONS:
            return "Report images must be PNG, JPG, JPEG, or WEBP"

        uploaded_file.seek(0)
        try:
            image = Image.open(uploaded_file)
            image.verify()
            image_format = str(image.format or "").upper()
        except (UnidentifiedImageError, OSError, ValueError):
            uploaded_file.seek(0)
            return "Report image content does not match the file extension"

        uploaded_file.seek(0)
        if image_format not in allowed_image_formats.get(extension, set()):
            return "Report image content does not match the file extension"

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
@throttle_classes([PortalMethodRateThrottle])
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
@throttle_classes([PortalMethodRateThrottle])
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
@throttle_classes([PortalMethodRateThrottle])
def portal_logout(request):
    refresh = str(
        request.data.get("refresh")
        or request.COOKIES.get(settings.JWT_REFRESH_COOKIE_NAME)
        or ""
    ).strip()

    if refresh:
        try:
            token = RefreshToken(refresh)
            token.blacklist()
        except TokenError:
            # Logout should stay idempotent even with stale/invalid refresh cookies.
            pass

    response = Response({"ok": True})
    clear_refresh_cookie(response)
    return response


@api_view(["GET"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def portal_company_header(request):
    company_id = request.GET.get("companyId")
    company = _selected_company(request.user, company_id)
    if not company:
        return Response({"detail": "Company not found"}, status=status.HTTP_404_NOT_FOUND)

    serializer = CompanyHeaderSerializer(company, context={"request": request})
    return Response(serializer.data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
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
@throttle_classes([PortalMethodRateThrottle])
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
        return Response(
            {
                "detail": "customer_username already exists",
                "suggested_username": _suggest_available_username(username),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

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

# Split domain-specific endpoints into dedicated modules while keeping shared helpers above.
from .portal_views_modules.certificates import (  # noqa: E402
    portal_certificate_download,
    portal_equipment_certificates,
)
from .portal_views_modules.equipment import (  # noqa: E402
    portal_equipment_list,
    portal_equipment_update,
)
from .portal_views_modules.reports import (  # noqa: E402
    portal_dashboard_stats,
    portal_equipment_reports,
    portal_pending_report_approvals,
    portal_report_owner_edit,
    portal_report_revisions,
)
from .portal_views_modules.staff import portal_staff_assignments  # noqa: E402

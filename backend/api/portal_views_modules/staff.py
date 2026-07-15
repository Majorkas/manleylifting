from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..audit import log_portal_audit_event
from ..models import Company, UserProfile
from ..portal_views import (
    _get_pagination_params,
    _is_employee_role,
    _is_owner,
    _paginate_queryset,
    _revoke_user_refresh_tokens,
    _suggest_available_username,
    _visible_company_ids,
)
from ..serializers import (
    UserProfileAssignmentCreateSerializer,
    UserProfileAssignmentSerializer,
    UserProfileAssignmentUpdateSerializer,
)
from ..throttles import PortalMethodRateThrottle


@api_view(["GET", "POST", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def portal_staff_assignments(request):
    if not _is_owner(request.user):
        return Response({"detail": "Only owner can manage assignments"}, status=status.HTTP_403_FORBIDDEN)

    if request.method == "GET":
        status_filter = str(request.GET.get("status") or "active").strip().lower()
        is_active_filter = None
        if status_filter == "active":
            is_active_filter = True
        elif status_filter == "inactive":
            is_active_filter = False
        elif status_filter != "all":
            return Response(
                {"detail": "status must be active, inactive, or all"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        profile_filters = {
            "role__in": [UserProfile.ROLE_ENGINEER, UserProfile.ROLE_STAFF, UserProfile.ROLE_OFFICE_STAFF],
        }
        if is_active_filter is not None:
            profile_filters["user__is_active"] = is_active_filter

        profiles = (
            UserProfile.objects.select_related("user")
            .prefetch_related("allowed_companies")
            .filter(**profile_filters)
            .exclude(user_id=request.user.id)
            .order_by("-id")
        )
        page, page_size = _get_pagination_params(request)
        paginated = _paginate_queryset(profiles, page, page_size)
        serializer = UserProfileAssignmentSerializer(paginated["results"], many=True)
        return Response(
            {
                "results": serializer.data,
                "total_count": paginated["total_count"],
                "page": paginated["page"],
                "page_size": paginated["page_size"],
                "total_pages": paginated["total_pages"],
            }
        )

    if request.method == "POST":
        serializer = UserProfileAssignmentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        user_model = get_user_model()
        username = payload["username"].strip().lower()
        email = payload["email"].strip().lower()

        if user_model.objects.filter(username__iexact=username).exists():
            return Response(
                {
                    "detail": "Username is unavailable",
                    "suggested_username": _suggest_available_username(username),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

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
        log_portal_audit_event(
            request=request,
            action="staff.created",
            target_type="user",
            target_id=created_user.id,
            details={
                "role": profile.role,
                "allowed_company_ids": sorted(list(companies.values_list("id", flat=True))),
            },
        )
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

        profile.user.is_active = False
        profile.user.save(update_fields=["is_active"])
        _revoke_user_refresh_tokens(profile.user)
        log_portal_audit_event(
            request=request,
            action="staff.deactivated",
            target_type="user",
            target_id=profile.user_id,
            details={"role": profile.role},
        )
        return Response({"ok": True})

    serializer = UserProfileAssignmentUpdateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    payload = serializer.validated_data

    profile = UserProfile.objects.select_related("user").filter(user_id=payload["user_id"]).first()
    if not profile:
        return Response({"detail": "User profile not found"}, status=status.HTTP_404_NOT_FOUND)

    if not _is_employee_role(profile.role):
        return Response({"detail": "Only employee accounts can be updated"}, status=status.HTTP_400_BAD_REQUEST)

    change_details = {}

    if "role" in payload:
        if not _is_employee_role(payload["role"]):
            return Response(
                {"detail": "Employee role must be engineer or office staff"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        previous_role = profile.role
        profile.role = payload["role"]
        profile.save(update_fields=["role", "updated_at"])
        if previous_role != profile.role:
            change_details["role"] = {"from": previous_role, "to": profile.role}

    if "is_active" in payload:
        previous_active = bool(profile.user.is_active)
        profile.user.is_active = bool(payload["is_active"])
        profile.user.save(update_fields=["is_active"])
        if previous_active and not profile.user.is_active:
            _revoke_user_refresh_tokens(profile.user)
        if previous_active != bool(profile.user.is_active):
            change_details["is_active"] = {"from": previous_active, "to": bool(profile.user.is_active)}

    if "allowed_company_ids" in payload:
        previous_company_ids = sorted(list(profile.allowed_companies.values_list("id", flat=True)))
        visible_ids = _visible_company_ids(request.user)
        allowed_ids = list(set(payload["allowed_company_ids"]) & set(visible_ids))
        companies = Company.objects.filter(id__in=allowed_ids, is_active=True)
        profile.allowed_companies.set(companies)
        next_company_ids = sorted(list(profile.allowed_companies.values_list("id", flat=True)))
        if previous_company_ids != next_company_ids:
            change_details["allowed_company_ids"] = {
                "from": previous_company_ids,
                "to": next_company_ids,
            }

    if change_details:
        log_portal_audit_event(
            request=request,
            action="staff.updated",
            target_type="user",
            target_id=profile.user_id,
            details=change_details,
        )

    output = UserProfileAssignmentSerializer(profile)
    return Response(output.data)

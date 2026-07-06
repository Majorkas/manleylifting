from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import Company, UserProfile
from ..portal_views import (
    _get_pagination_params,
    _is_employee_role,
    _is_owner,
    _paginate_queryset,
    _visible_company_ids,
)
from ..serializers import (
    UserProfileAssignmentCreateSerializer,
    UserProfileAssignmentSerializer,
    UserProfileAssignmentUpdateSerializer,
)


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

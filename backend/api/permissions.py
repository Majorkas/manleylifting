from rest_framework.permissions import BasePermission

from .models import UserProfile


class HasPortalAccess(BasePermission):
    message = "Portal access is not enabled for this account."

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and UserProfile.objects.filter(user_id=user.pk).exists()
        )

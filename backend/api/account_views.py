from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import CommerceCustomerProfile, UserProfile
from .serializers import AccountBootstrapSerializer
from .throttles import PortalMethodRateThrottle


@api_view(["GET"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def account_bootstrap(request):
    commerce_profile = CommerceCustomerProfile.objects.filter(
        user_id=request.user.pk
    ).first()
    email_verified = bool(
        commerce_profile and commerce_profile.has_verified_email()
    )
    commerce_enabled = bool(
        email_verified
        and commerce_profile.disabled_at is None
        and commerce_profile.anonymized_at is None
    )
    payload = {
        "username": request.user.username,
        "email": request.user.email or "",
        "full_name": request.user.get_full_name() or "",
        "email_verified": email_verified,
        "capabilities": {
            "can_shop": commerce_enabled,
            "can_view_orders": commerce_enabled,
            "can_access_portal": UserProfile.objects.filter(
                user_id=request.user.pk
            ).exists(),
        },
    }
    serializer = AccountBootstrapSerializer(payload)
    return Response(serializer.data)
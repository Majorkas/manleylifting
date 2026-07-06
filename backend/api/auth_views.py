from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .auth_cookies import set_refresh_cookie
from .serializers import PortalTokenObtainPairSerializer, PortalTokenRefreshSerializer


class PortalTokenObtainPairView(TokenObtainPairView):
    serializer_class = PortalTokenObtainPairSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth.token"

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        refresh = str(response.data.get("refresh") or "")
        if refresh:
            set_refresh_cookie(response, refresh)
            response.data.pop("refresh", None)
        return response


class PortalTokenRefreshView(TokenRefreshView):
    serializer_class = PortalTokenRefreshSerializer

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        refresh = str(response.data.get("refresh") or "")
        if refresh:
            set_refresh_cookie(response, refresh)
            response.data.pop("refresh", None)
        return response

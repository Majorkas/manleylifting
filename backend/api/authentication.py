from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication

from .auth_sessions import (
    token_has_active_account_session,
    token_has_current_session_generation,
)


class AccountJWTAuthentication(JWTAuthentication):
    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if not token_has_current_session_generation(user, validated_token):
            raise AuthenticationFailed(
                "Session is no longer valid.",
                code="session_revoked",
            )
        if not token_has_active_account_session(user, validated_token):
            raise AuthenticationFailed(
                "Session is no longer valid.",
                code="session_revoked",
            )
        return user

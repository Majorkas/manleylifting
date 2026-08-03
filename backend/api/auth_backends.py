from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend


def resolve_login_user(identifier):
    user_model = get_user_model()
    normalized_identifier = str(identifier or "").strip()
    if not normalized_identifier:
        return None

    username_matches = list(
        user_model._default_manager.filter(
            username__iexact=normalized_identifier
        ).order_by("pk")[:2]
    )
    if len(username_matches) == 1:
        return username_matches[0]
    if username_matches:
        return None

    user = (
        user_model._default_manager.filter(
            email__iexact=normalized_identifier,
            commerce_profile__email_verified_at__isnull=False,
            commerce_profile__disabled_at__isnull=True,
            commerce_profile__anonymized_at__isnull=True,
        )
        .select_related("commerce_profile")
        .first()
    )
    if user is None or not user.commerce_profile.has_verified_email():
        return None
    return user


class CaseInsensitiveModelBackend(ModelBackend):
    def authenticate(self, request, username=None, password=None, **kwargs):
        if username is None:
            username = kwargs.get(get_user_model().USERNAME_FIELD)

        if not username:
            return None

        lookup_username = str(username).strip()
        if not lookup_username:
            return None

        user = resolve_login_user(lookup_username)
        if user is None:
            get_user_model()().set_password(password)
            return None

        if user.check_password(password) and self.user_can_authenticate(user):
            return user

        return None

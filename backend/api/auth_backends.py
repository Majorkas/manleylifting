from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend


def _lookup_username_user(user_model, identifier):
    username_matches = list(
        user_model._default_manager.filter(
            username__iexact=identifier
        ).order_by("pk")[:2]
    )
    if len(username_matches) == 1:
        return username_matches[0]
    if username_matches:
        return None
    return None


def _lookup_email_user(user_model, identifier):
    return (
        user_model._default_manager.filter(
            email__iexact=identifier,
            commerce_profile__disabled_at__isnull=True,
            commerce_profile__anonymized_at__isnull=True,
        )
        .select_related("commerce_profile")
        .first()
    )


def resolve_login_user(identifier, *, require_verified_email=True):
    user_model = get_user_model()
    normalized_identifier = str(identifier or "").strip()
    if not normalized_identifier:
        return None

    # Email-like identifiers should always resolve against ecommerce email first.
    if "@" in normalized_identifier:
        user = _lookup_email_user(user_model, normalized_identifier)
        if user is None:
            user = _lookup_username_user(user_model, normalized_identifier)
    else:
        user = _lookup_username_user(user_model, normalized_identifier)
        if user is None:
            user = _lookup_email_user(user_model, normalized_identifier)

    if user is None:
        return None

    if require_verified_email:
        profile = getattr(user, "commerce_profile", None)
        # Portal-only users may not have a commerce profile yet.
        if profile is not None and not profile.has_verified_email():
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

from django.conf import settings
from django.db.models.signals import m2m_changed, post_delete, post_save, pre_save
from django.dispatch import receiver

from .account_tokens import revoke_account_action_tokens
from .auth_sessions import revoke_user_sessions
from .models import CommerceCustomerProfile, UserProfile


SENSITIVE_USER_FIELDS = {"email", "password", "is_active", "is_staff", "is_superuser"}


@receiver(pre_save, sender=settings.AUTH_USER_MODEL)
def capture_sensitive_user_changes(sender, instance, update_fields=None, **kwargs):
    if not instance.pk:
        instance._security_sensitive_fields = set()
        return

    fields_to_check = SENSITIVE_USER_FIELDS
    if update_fields is not None:
        fields_to_check = fields_to_check.intersection(update_fields)
    if not fields_to_check:
        instance._security_sensitive_fields = set()
        return

    previous = sender.objects.filter(pk=instance.pk).values(*fields_to_check).first()
    instance._security_sensitive_fields = {
        field
        for field in fields_to_check
        if previous is not None and previous[field] != getattr(instance, field)
    }


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def invalidate_credentials_after_user_change(sender, instance, created, **kwargs):
    changed_fields = getattr(instance, "_security_sensitive_fields", set())
    if not changed_fields:
        return

    if "email" in changed_fields:
        CommerceCustomerProfile.objects.filter(user=instance).update(
            verified_email="",
            email_verified_at=None,
        )
    if "is_active" in changed_fields and not instance.is_active:
        CommerceCustomerProfile.objects.filter(user=instance).update(
            activation_pending=False,
        )

    revoke_user_sessions(instance)
    revoke_account_action_tokens(user=instance)


@receiver(pre_save, sender=UserProfile)
def capture_portal_role_change(sender, instance, **kwargs):
    if not instance.pk:
        instance._portal_role_changed = True
        return
    previous_role = sender.objects.filter(pk=instance.pk).values_list(
        "role",
        flat=True,
    ).first()
    instance._portal_role_changed = previous_role != instance.role


@receiver(post_save, sender=UserProfile)
def invalidate_credentials_after_portal_profile_change(sender, instance, **kwargs):
    if not getattr(instance, "_portal_role_changed", False):
        return
    revoke_user_sessions(instance.user)
    revoke_account_action_tokens(user=instance.user)


@receiver(post_delete, sender=UserProfile)
def invalidate_credentials_after_portal_profile_delete(
    sender,
    instance,
    origin=None,
    **kwargs,
):
    origin_model = getattr(origin, "model", None)
    if not isinstance(origin, UserProfile) and origin_model is not UserProfile:
        return
    revoke_user_sessions(instance.user)
    revoke_account_action_tokens(user=instance.user)


@receiver(m2m_changed, sender=UserProfile.allowed_companies.through)
def invalidate_credentials_after_company_access_change(
    sender,
    instance,
    action,
    reverse,
    **kwargs,
):
    if reverse and action == "pre_clear":
        instance._removed_profile_ids = list(
            instance.members.values_list("pk", flat=True)
        )
        return
    if action not in {"post_add", "post_remove", "post_clear"}:
        return

    if reverse:
        profile_ids = kwargs.get("pk_set") or getattr(
            instance,
            "_removed_profile_ids",
            [],
        )
        profiles = UserProfile.objects.filter(pk__in=profile_ids).select_related("user")
        for profile in profiles:
            revoke_user_sessions(profile.user)
            revoke_account_action_tokens(user=profile.user)
        return

    revoke_user_sessions(instance.user)
    revoke_account_action_tokens(user=instance.user)

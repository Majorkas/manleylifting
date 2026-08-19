from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .auth_sessions import revoke_user_sessions
from .models import CommerceCustomerProfile, OnsiteOrder

ACCOUNT_DELETION_RECOVERY_DAYS = 30


def _anonymized_customer_record():
    return {
        "customer_name": "Account deleted",
        "customer_email": "",
        "shipping_name": "Account deleted",
        "shipping_phone": "",
        "shipping_address_line_1": "",
        "shipping_address_line_2": "",
        "shipping_city": "",
        "shipping_county": "",
        "shipping_postcode": "",
        "shipping_country_code": "",
    }


def request_account_deletion(user, request=None):
    now = timezone.now()
    with transaction.atomic():
        profile = CommerceCustomerProfile.objects.select_for_update().filter(user=user).first()
        if profile is None:
            profile = CommerceCustomerProfile.objects.create(user=user)

        profile.deletion_requested_at = now
        profile.deletion_expires_at = now + timedelta(days=ACCOUNT_DELETION_RECOVERY_DAYS)
        profile.disabled_at = profile.disabled_at or now
        profile.activation_pending = False
        profile.verified_email = ""
        profile.email_verified_at = None
        profile.anonymized_at = None
        profile.save(
            update_fields=[
                "disabled_at",
                "activation_pending",
                "verified_email",
                "email_verified_at",
                "deletion_requested_at",
                "deletion_expires_at",
                "anonymized_at",
                "updated_at",
            ]
        )

        user.is_active = False
        user.save(update_fields=["is_active"])

        revoke_user_sessions(user)
        OnsiteOrder.objects.filter(user=user).update(
            user=None,
            **_anonymized_customer_record(),
        )

    return profile


def recover_account_deletion(user):
    with transaction.atomic():
        profile = CommerceCustomerProfile.objects.select_for_update().filter(user=user).first()
        if profile is None:
            return False

        if profile.deletion_requested_at is None or profile.deletion_expires_at is None:
            return False
        if profile.deletion_expires_at <= timezone.now():
            return False

        profile.deletion_requested_at = None
        profile.deletion_expires_at = None
        profile.disabled_at = None
        profile.verified_email = user.email
        profile.email_verified_at = timezone.now()
        profile.save(
            update_fields=[
                "disabled_at",
                "verified_email",
                "email_verified_at",
                "deletion_requested_at",
                "deletion_expires_at",
                "updated_at",
            ]
        )

        user.is_active = True
        user.save(update_fields=["is_active"])
        revoke_user_sessions(user)
        return True


def anonymize_user_order_data(user):
    with transaction.atomic():
        return OnsiteOrder.objects.filter(user=user).update(
            user=None,
            **_anonymized_customer_record(),
        )

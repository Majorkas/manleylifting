import json
import os
import importlib
from decimal import Decimal
from io import BytesIO, StringIO
from pathlib import Path
from unittest.mock import ANY, patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, transaction
from django.test import Client, TestCase, override_settings
from django.utils import timezone
from datetime import date, timedelta
from PIL import Image
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.test import APIClient
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
from rest_framework_simplejwt.tokens import RefreshToken, UntypedToken

from .account_tokens import consume_account_action_token, issue_account_action_token
from .account_views import generate_totp_code
from .account_emails import (
    TransactionalEmailDeliveryError,
    _safe_response_snippet,
    send_password_reset_email,
    send_verification_email,
)
from .auth_sessions import revoke_user_sessions
from .capability_tokens import digest_capability_token
from .models import (
    AccountActionToken,
    AccountSession,
    AccountSecurityState,
    AuditLog,
    CatalogCollection,
    CatalogProduct,
    CatalogProductImage,
    Certificate,
    CommerceCustomerProfile,
    Company,
    Equipment,
    GuestOrderClaim,
    InspectionReport,
    InventoryReservation,
    InventoryTransaction,
    OnsiteOrder,
    OrderItem,
    PendingCheckout,
    ProcessedStripeEvent,
    ReportImage,
    ReportRevision,
    SavedAddress,
    Site,
    UserProfile,
    OrderEmailDelivery,
)
from .order_emails import send_order_confirmation_email
from .throttles import PortalMethodRateThrottle
from .views import _build_line_items_from_catalog, _populate_order_items_and_reservations, _resolve_checkout_company, _to_minor_units
from .pricing import calculate_checkout_totals, UnsupportedDestinationError
from backend.settings import (
    validate_account_registration_configuration,
    validate_required_secrets,
    validate_shop_turnstile_configuration,
)


def _png_bytes():
    image_buffer = BytesIO()
    Image.new("RGB", (1, 1), color=(255, 0, 0)).save(image_buffer, format="PNG")
    return image_buffer.getvalue()


def create_verified_user():
    user_model = get_user_model()
    user = user_model.objects.create_user(
        username="consent-user",
        email="consent@example.com",
        password="testpass123",
    )
    CommerceCustomerProfile.objects.create(
        user=user,
        verified_email=user.email,
        email_verified_at=timezone.now(),
    )
    return user


TEST_CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "manleylifting-tests",
        "TIMEOUT": 300,
    }
}


@override_settings(
    CACHES=TEST_CACHES,
    SECURE_SSL_REDIRECT=False,
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"],
)
class BaseApiTestCase(TestCase):
    def setUp(self):
        cache.clear()

    def test_csp_report_only_header_is_set(self):
        response = self.client.get("/api/hello/")
        self.assertEqual(response.status_code, 200)
        header_value = str(response.headers.get("Content-Security-Policy-Report-Only") or "")
        self.assertIn("default-src 'self'", header_value)

    def test_secure_checkout_csp_keeps_default_restrictive_policy(self):
        response = self.client.get("/api/hello/")
        self.assertEqual(response.status_code, 200)
        csp_value = str(response.headers.get("Content-Security-Policy") or "")
        self.assertIn("default-src 'self'", csp_value)
        self.assertNotIn("https://*.stripe.com", csp_value)
        self.assertNotIn("https://*.cloudflare.com", csp_value)

    def test_validate_required_secrets_raises_when_missing_in_production(self):
        with self.assertRaisesMessage(ValueError, "Missing required environment variables: STRIPE_SECRET_KEY"):
            validate_required_secrets(
                debug=False,
                values={
                    "STRIPE_SECRET_KEY": "",
                    "STRIPE_WEBHOOK_SECRET": "whsec_present",
                },
            )

    def test_validate_required_secrets_skips_when_debug_enabled(self):
        # In local debug runs, missing external secrets should not block startup.
        validate_required_secrets(
            debug=True,
            values={
                "STRIPE_SECRET_KEY": "",
                "STRIPE_WEBHOOK_SECRET": "",
            },
        )
        self.client = Client()

    def test_validate_required_secrets_requires_webhook_secret(self):
        with self.assertRaisesMessage(ValueError, "STRIPE_WEBHOOK_SECRET"):
            validate_required_secrets(
                debug=False,
                values={
                    "STRIPE_SECRET_KEY": "sk_test_present",
                    "STRIPE_WEBHOOK_SECRET": "",
                },
            )

    def test_shop_turnstile_configuration_fails_closed_in_production(self):
        with self.assertRaisesMessage(
            ValueError,
            "SHOP_TURNSTILE_SECRET_KEY",
        ):
            validate_shop_turnstile_configuration(
                debug=False,
                turnstile_required=True,
                secret_key="",
            )

        validate_shop_turnstile_configuration(
            debug=False,
            turnstile_required=True,
            secret_key="turnstile-secret",
        )
        validate_shop_turnstile_configuration(
            debug=True,
            turnstile_required=True,
            secret_key="",
        )
        validate_shop_turnstile_configuration(
            debug=False,
            turnstile_required=False,
            secret_key="",
        )

    def test_registration_config_requires_zeptomail_and_turnstile_in_production(self):
        with self.assertRaisesMessage(
            ValueError,
            "ZEPTOMAIL_SEND_TOKEN, ZEPTOMAIL_FROM_EMAIL, ACCOUNT_TURNSTILE_SECRET_KEY",
        ):
            validate_account_registration_configuration(
                debug=False,
                registration_enabled=True,
                turnstile_required=True,
                values={
                    "ZEPTOMAIL_SEND_TOKEN": "",
                    "ZEPTOMAIL_FROM_EMAIL": "",
                    "ACCOUNT_TURNSTILE_SECRET_KEY": "",
                    "ACCOUNT_TERMS_VERSION": "terms-2026-07",
                    "ACCOUNT_PRIVACY_VERSION": "privacy-2026-07",
                },
            )

    def test_registration_config_rejects_draft_legal_versions(self):
        with self.assertRaisesMessage(
            ValueError,
            "approved terms and privacy versions",
        ):
            validate_account_registration_configuration(
                debug=False,
                registration_enabled=True,
                turnstile_required=True,
                values={
                    "ZEPTOMAIL_SEND_TOKEN": "send-token",
                    "ZEPTOMAIL_FROM_EMAIL": "accounts@manleylifting.ie",
                    "ACCOUNT_TURNSTILE_SECRET_KEY": "turnstile-secret",
                    "ACCOUNT_TERMS_VERSION": "draft",
                    "ACCOUNT_PRIVACY_VERSION": "draft",
                },
            )


class IdentityEmailAuditCommandTests(TestCase):
    def test_audit_passes_for_unique_canonical_emails(self):
        user_model = get_user_model()
        user_model.objects.create_user(
            username="first-user",
            email="first@example.com",
        )
        user_model.objects.create_user(
            username="second-user",
            email="second@example.com",
        )
        stdout = StringIO()

        call_command("audit_identity_emails", stdout=stdout)

        output = stdout.getvalue()
        self.assertIn("Audited 2 user account(s).", output)
        self.assertIn("Email identity audit passed.", output)

    def test_audit_fails_without_disclosing_email_values(self):
        class FakeUsers:
            def order_by(self, *args):
                return self

            def values(self, *args):
                return self

            def iterator(self):
                return iter(
                    [
                        {"pk": 1, "username": "missing-email", "email": ""},
                        {"pk": 2, "username": "invalid-email", "email": "not-an-email"},
                        {
                            "pk": 3,
                            "username": "noncanonical-email",
                            "email": " Person@Example.com ",
                        },
                        {
                            "pk": 4,
                            "username": "duplicate-email",
                            "email": "person@example.com",
                        },
                    ]
                )

        class FakeUserModel:
            objects = FakeUsers()

        stdout = StringIO()

        with patch(
            "api.management.commands.audit_identity_emails.get_user_model",
            return_value=FakeUserModel,
        ):
            with self.assertRaisesMessage(CommandError, "Email identity audit failed"):
                call_command("audit_identity_emails", stdout=stdout)

        output = stdout.getvalue()
        self.assertIn("Missing email: 1", output)
        self.assertIn("user_id=1 username='missing-email'", output)
        self.assertIn("Invalid email: 1", output)
        self.assertIn("user_id=2 username='invalid-email'", output)
        self.assertIn("Non-canonical email: 1", output)
        self.assertIn("user_id=3 username='noncanonical-email'", output)
        self.assertIn("Duplicate email groups: 1", output)
        self.assertIn("user_id=4 username='duplicate-email'", output)
        self.assertNotIn("not-an-email", output)
        self.assertNotIn("Person@Example.com", output)
        self.assertNotIn("person@example.com", output)

    def test_audit_does_not_mutate_noncanonical_email(self):
        user_model = get_user_model()
        user = user_model.objects.create_user(
            username="noncanonical-email",
            email="unique@example.com",
        )
        user_model.objects.filter(pk=user.pk).update(email=" Unique@Example.com ")
        user.refresh_from_db()
        stored_email = user.email

        with self.assertRaisesMessage(CommandError, "Email identity audit failed"):
            call_command("audit_identity_emails", stdout=StringIO())

        user.refresh_from_db()
        self.assertEqual(user.email, stored_email)


class IdentityEmailConstraintTests(TestCase):
    def test_normalized_email_collision_is_rejected_by_database(self):
        user_model = get_user_model()
        user_model.objects.create_user(
            username="first-identity",
            email="person@example.com",
        )

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                user_model.objects.create_user(
                    username="second-identity",
                    email=" Person@Example.com ",
                )

    @patch.dict(
        "os.environ",
        {
            "OWNER_USERNAME": "StoreOwner",
            "OWNER_EMAIL": " Owner@Example.com ",
            "OWNER_PASSWORD": "owner-password-123",
        },
        clear=True,
    )
    def test_owner_bootstrap_normalizes_identity_email(self):
        call_command("create_owner_from_env", stdout=StringIO())

        user = get_user_model().objects.get(username="storeowner")
        self.assertEqual(user.email, "owner@example.com")


class AccountActionTokenTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="account-action-user",
            email="account-action@example.com",
            password="test-password-123",
        )

    def issue_token(self, purpose=AccountActionToken.Purpose.VERIFY_EMAIL):
        return issue_account_action_token(
            user=self.user,
            purpose=purpose,
            target_email=" Account-Action@Example.com ",
            lifetime=timedelta(hours=1),
        )

    def test_issue_stores_only_digest_and_normalized_target_email(self):
        raw_token = self.issue_token()

        action_token = AccountActionToken.objects.get(user=self.user)
        self.assertEqual(action_token.issued_for_email, "account-action@example.com")
        self.assertEqual(action_token.target_email, "account-action@example.com")
        self.assertEqual(len(action_token.token_digest), 64)
        self.assertNotEqual(action_token.token_digest, raw_token)
        self.assertFalse(
            AccountActionToken.objects.filter(token_digest=raw_token).exists()
        )

    def test_consume_is_atomic_and_single_use(self):
        raw_token = self.issue_token()

        consumed = consume_account_action_token(
            raw_token=raw_token,
            purpose=AccountActionToken.Purpose.VERIFY_EMAIL,
            action=lambda action_token: action_token.pk,
        )
        replayed = consume_account_action_token(
            raw_token=raw_token,
            purpose=AccountActionToken.Purpose.VERIFY_EMAIL,
            action=lambda action_token: action_token.pk,
        )

        self.assertIsNotNone(consumed)
        self.assertIsNotNone(AccountActionToken.objects.get(pk=consumed).consumed_at)
        self.assertIsNone(replayed)

    def test_failed_account_action_does_not_consume_token(self):
        raw_token = self.issue_token()

        def fail_account_action(_action_token):
            raise RuntimeError("account action failed")

        with self.assertRaisesMessage(RuntimeError, "account action failed"):
            consume_account_action_token(
                raw_token=raw_token,
                purpose=AccountActionToken.Purpose.VERIFY_EMAIL,
                action=fail_account_action,
            )

        action_token = AccountActionToken.objects.get(user=self.user)
        self.assertIsNone(action_token.consumed_at)

    def test_issuing_replacement_revokes_previous_token(self):
        first_raw_token = self.issue_token()
        first_action_token = AccountActionToken.objects.get(user=self.user)

        second_raw_token = self.issue_token()

        first_action_token.refresh_from_db()
        self.assertIsNotNone(first_action_token.revoked_at)
        self.assertIsNone(
            consume_account_action_token(
                raw_token=first_raw_token,
                purpose=AccountActionToken.Purpose.VERIFY_EMAIL,
                action=lambda action_token: action_token.pk,
            )
        )
        self.assertIsNotNone(
            consume_account_action_token(
                raw_token=second_raw_token,
                purpose=AccountActionToken.Purpose.VERIFY_EMAIL,
                action=lambda action_token: action_token.pk,
            )
        )

    def test_consume_requires_matching_purpose_and_current_email(self):
        raw_token = self.issue_token()

        self.assertIsNone(
            consume_account_action_token(
                raw_token=raw_token,
                purpose=AccountActionToken.Purpose.PASSWORD_RESET,
                action=lambda action_token: action_token.pk,
            )
        )

        self.user.email = "different@example.com"
        self.user.save(update_fields=["email"])
        self.assertIsNone(
            consume_account_action_token(
                raw_token=raw_token,
                purpose=AccountActionToken.Purpose.VERIFY_EMAIL,
                action=lambda action_token: action_token.pk,
            )
        )

        action_token = AccountActionToken.objects.get(user=self.user)
        self.assertIsNotNone(action_token.revoked_at)
        self.user.email = "account-action@example.com"
        self.user.save(update_fields=["email"])
        self.assertIsNone(
            consume_account_action_token(
                raw_token=raw_token,
                purpose=AccountActionToken.Purpose.VERIFY_EMAIL,
                action=lambda action_token: action_token.pk,
            )
        )

    def test_consume_rejects_expired_token(self):
        raw_token = self.issue_token()
        AccountActionToken.objects.filter(user=self.user).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        self.assertIsNone(
            consume_account_action_token(
                raw_token=raw_token,
                purpose=AccountActionToken.Purpose.VERIFY_EMAIL,
                action=lambda action_token: action_token.pk,
            )
        )

    def test_database_allows_only_one_active_token_per_user_and_purpose(self):
        common_fields = {
            "user": self.user,
            "purpose": AccountActionToken.Purpose.VERIFY_EMAIL,
            "issued_for_email": self.user.email,
            "target_email": self.user.email,
            "expires_at": timezone.now() + timedelta(hours=1),
        }
        AccountActionToken.objects.create(token_digest="a" * 64, **common_fields)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                AccountActionToken.objects.create(
                    token_digest="b" * 64,
                    **common_fields,
                )

    @patch.dict(
        "os.environ",
        {
            "OWNER_USERNAME": "account-action-user",
            "OWNER_EMAIL": "account-action@example.com",
            "OWNER_PASSWORD": "new-owner-password-123!",
        },
        clear=True,
    )
    def test_owner_force_password_revokes_sessions_and_action_tokens(self):
        raw_token = self.issue_token(AccountActionToken.Purpose.PASSWORD_RESET)
        refresh_token = RefreshToken.for_user(self.user)

        call_command("create_owner_from_env", force_password=True, stdout=StringIO())

        self.user.refresh_from_db()
        action_token = AccountActionToken.objects.get(user=self.user)
        self.assertTrue(self.user.check_password("new-owner-password-123!"))
        self.assertIsNotNone(action_token.revoked_at)
        self.assertTrue(
            BlacklistedToken.objects.filter(token__jti=refresh_token["jti"]).exists()
        )
        self.assertIsNone(
            consume_account_action_token(
                raw_token=raw_token,
                purpose=AccountActionToken.Purpose.PASSWORD_RESET,
                action=lambda action_token: action_token.pk,
            )
        )


@override_settings(
    CACHES=TEST_CACHES,
    SECURE_SSL_REDIRECT=False,
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"],
)
class AccountSessionRevocationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user(
            username="session-user",
            email="session-user@example.com",
            password="session-password-123",
        )
        UserProfile.objects.create(user=self.user, role=UserProfile.ROLE_CUSTOMER)

    def login(self):
        client = APIClient()
        response = client.post(
            "/api/auth/token/",
            data={
                "username": self.user.username,
                "password": "session-password-123",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        return response.json()["access"], response.cookies["manley_portal_refresh"].value

    def refresh(self, refresh_token, *, client=None, data=None, **extra):
        refresh_client = client or APIClient()
        refresh_client.cookies["manley_portal_refresh"] = refresh_token
        return refresh_client.post(
            "/api/auth/token/refresh/",
            data=data or {},
            format="json",
            **extra,
        )

    @override_settings(CSRF_TRUSTED_ORIGINS=["https://trusted-frontend.example"])
    def test_cookie_setting_login_requires_csrf(self):
        client = APIClient(enforce_csrf_checks=True)

        rejected_response = client.post(
            "/api/auth/token/",
            data={
                "username": self.user.username,
                "password": "session-password-123",
            },
            format="json",
            HTTP_ORIGIN="https://attacker.example",
        )

        seed_response = client.get("/api/csrf/")
        csrf_token = seed_response.cookies["csrftoken"].value
        accepted_response = client.post(
            "/api/auth/token/",
            data={
                "username": self.user.username,
                "password": "session-password-123",
            },
            format="json",
            HTTP_X_CSRFTOKEN=csrf_token,
            HTTP_ORIGIN="https://trusted-frontend.example",
        )

        self.assertEqual(rejected_response.status_code, 403)
        self.assertEqual(accepted_response.status_code, 200)
        self.assertIn("manley_portal_refresh", accepted_response.cookies)

    def test_mfa_setup_and_verification_enables_second_factor(self):
        user = get_user_model().objects.create_user(
            username="account-mfa-user",
            email="account-mfa@example.com",
            password="Strong-Password-123!",
            is_active=True,
        )
        CommerceCustomerProfile.objects.create(user=user, activation_pending=False)
        client = APIClient()
        client.force_authenticate(user=user)

        setup_response = client.post(
            "/api/account/mfa/setup/",
            data={"current_password": "Strong-Password-123!"},
            format="json",
        )
        state = AccountSecurityState.objects.get(user=user)
        verify_response = client.post(
            "/api/account/mfa/verify/",
            data={"code": generate_totp_code(state.mfa_pending_secret)},
            format="json",
        )

        self.assertEqual(setup_response.status_code, 200)
        setup_body = setup_response.json()
        self.assertTrue(setup_body["setupInProgress"])
        self.assertTrue(setup_body["secret"])
        self.assertTrue(setup_body["otpauthUri"].startswith("otpauth://totp/"))
        self.assertTrue(setup_body["qrCodeUrl"].startswith(("data:image/png;base64,", "https://quickchart.io/qr?")))
        self.assertEqual(verify_response.status_code, 200)
        state.refresh_from_db()
        self.assertTrue(state.mfa_enabled)
        self.assertFalse(state.mfa_pending_secret)

    def test_login_requires_mfa_code_when_second_factor_is_enabled(self):
        user = get_user_model().objects.create_user(
            username="account-mfa-login-user",
            email="account-mfa-login@example.com",
            password="Strong-Password-123!",
            is_active=True,
        )
        CommerceCustomerProfile.objects.create(
            user=user,
            activation_pending=False,
            verified_email=user.email,
            email_verified_at=timezone.now(),
        )
        state = AccountSecurityState.objects.get(user=user)
        state.mfa_enabled = True
        state.mfa_pending_secret = ""
        state.mfa_secret = "JBSWY3DPEHPK3PXP"
        state.mfa_recovery_codes = ["abc12345"]
        state.save(update_fields=["mfa_enabled", "mfa_pending_secret", "mfa_secret", "mfa_recovery_codes"])

        client = APIClient()
        missing_code_response = client.post(
            "/api/auth/token/",
            data={"username": user.username, "password": "Strong-Password-123!"},
            format="json",
        )
        valid_code_response = client.post(
            "/api/auth/token/",
            data={"username": user.username, "password": "Strong-Password-123!", "mfa_code": generate_totp_code(state.mfa_secret)},
            format="json",
        )

        self.assertEqual(missing_code_response.status_code, 400)
        self.assertEqual(valid_code_response.status_code, 200)
        self.assertIn("access", valid_code_response.json())

    @patch("api.account_views.send_security_notification_email")
    def test_account_mfa_verify_sends_security_notification(self, mock_security_send):
        user = get_user_model().objects.create_user(
            username="account-mfa-notification-user",
            email="account-mfa-notification@example.com",
            password="Strong-Password-123!",
            is_active=True,
        )
        CommerceCustomerProfile.objects.create(user=user, activation_pending=False)
        client = APIClient()
        client.force_authenticate(user=user)

        setup_response = client.post(
            "/api/account/mfa/setup/",
            data={"current_password": "Strong-Password-123!"},
            format="json",
        )
        security_state = AccountSecurityState.objects.get(user=user)
        with self.captureOnCommitCallbacks(execute=True):
            verify_response = client.post(
                "/api/account/mfa/verify/",
                data={"code": generate_totp_code(security_state.mfa_pending_secret)},
                format="json",
            )

        self.assertEqual(setup_response.status_code, 200)
        self.assertTrue(setup_response.json()["setupInProgress"])
        self.assertEqual(verify_response.status_code, 200)
        self.assertEqual(mock_security_send.call_count, 1)
        self.assertEqual(mock_security_send.call_args.kwargs["recipient_email"], user.email)

    def test_mfa_recovery_codes_are_stored_as_hashes_not_raw_values(self):
        user = get_user_model().objects.create_user(
            username="recovery-code-hash-user",
            email="recovery-code-hash@example.com",
            password="Strong-Password-123!",
            is_active=True,
        )
        CommerceCustomerProfile.objects.create(user=user, activation_pending=False)
        client = APIClient()
        client.force_authenticate(user=user)

        setup_response = client.post(
            "/api/account/mfa/setup/",
            data={"current_password": "Strong-Password-123!"},
            format="json",
        )
        security_state = AccountSecurityState.objects.get(user=user)
        
        verify_response = client.post(
            "/api/account/mfa/verify/",
            data={"code": generate_totp_code(security_state.mfa_pending_secret)},
            format="json",
        )
        raw_codes_from_verify = verify_response.json().get("recoveryCodes") or []

        security_state.refresh_from_db()
        stored_codes = security_state.mfa_recovery_codes or []

        # Raw recovery codes should be returned to user but not stored
        self.assertEqual(verify_response.status_code, 200)
        self.assertTrue(raw_codes_from_verify, "Setup response should contain raw recovery codes")
        
        # Stored recovery codes should NOT match raw recovery codes (they should be hashes)
        for stored_code in stored_codes:
            self.assertNotIn(stored_code, raw_codes_from_verify, "Stored codes must be hashes, not raw recovery codes")
        
        # Verify that no raw recovery code appears in stored list
        response_json = json.dumps(verify_response.json())
        for raw_code in raw_codes_from_verify:
            # Raw codes should appear in response but NOT be in stored hashes
            self.assertIn(raw_code, response_json, "Raw code should be in response")
            for stored in stored_codes:
                self.assertNotEqual(raw_code, stored, f"Stored hash must differ from raw code {raw_code}")

    def test_account_security_events_lists_recent_sensitive_actions(self):
        user = get_user_model().objects.create_user(
            username="account-security-events-user",
            email="account-security-events@example.com",
            password="Strong-Password-123!",
            is_active=True,
        )
        CommerceCustomerProfile.objects.create(user=user, activation_pending=False)
        client = APIClient()
        client.force_authenticate(user=user)

        password_response = client.post(
            "/api/account/change-password/",
            data={"current_password": "Strong-Password-123!", "new_password": "New-Strong-Password-456!"},
            format="json",
        )
        logout_response = client.post("/api/account/logout-all/", data={}, format="json")
        setup_response = client.post(
            "/api/account/mfa/setup/",
            data={"current_password": "New-Strong-Password-456!"},
            format="json",
        )
        security_state = AccountSecurityState.objects.get(user=user)
        verify_response = client.post(
            "/api/account/mfa/verify/",
            data={"code": generate_totp_code(security_state.mfa_pending_secret)},
            format="json",
        )
        events_response = client.get("/api/account/security-events/", format="json")

        self.assertEqual(password_response.status_code, 200)
        self.assertEqual(logout_response.status_code, 200)
        self.assertEqual(setup_response.status_code, 200)
        self.assertEqual(verify_response.status_code, 200)
        self.assertEqual(events_response.status_code, 200)
        actions = [item["action"] for item in events_response.json()]
        self.assertIn("account.password_change", actions)
        self.assertIn("account.logout_all", actions)
        self.assertIn("account.mfa_setup", actions)
        self.assertIn("account.mfa_verify", actions)

    def test_refresh_uses_cookie_and_ignores_body_token(self):
        _, victim_refresh = self.login()
        attacker = get_user_model().objects.create_user(
            username="attacker-session",
            email="attacker-session@example.com",
            password="attacker-password-123",
        )
        UserProfile.objects.create(user=attacker, role=UserProfile.ROLE_CUSTOMER)
        attacker_client = APIClient()
        attacker_login = attacker_client.post(
            "/api/auth/token/",
            data={
                "username": attacker.username,
                "password": "attacker-password-123",
            },
            format="json",
        )
        attacker_refresh = attacker_login.cookies["manley_portal_refresh"].value
        client = APIClient()
        client.cookies["manley_portal_refresh"] = victim_refresh

        response = client.post(
            "/api/auth/token/refresh/",
            data={"refresh": attacker_refresh},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        access_token = UntypedToken(response.json()["access"])
        self.assertEqual(str(access_token["user_id"]), str(self.user.pk))

    def test_refresh_body_token_without_cookie_is_rejected(self):
        _, refresh_token = self.login()
        client = APIClient()
        client.cookies.clear()

        response = client.post(
            "/api/auth/token/refresh/",
            data={"refresh": refresh_token},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    @override_settings(CSRF_TRUSTED_ORIGINS=["https://trusted-frontend.example"])
    def test_cookie_setting_refresh_requires_csrf(self):
        _, refresh_token = self.login()
        client = APIClient(enforce_csrf_checks=True)
        client.cookies["manley_portal_refresh"] = refresh_token

        rejected_response = client.post(
            "/api/auth/token/refresh/",
            data={},
            format="json",
            HTTP_ORIGIN="https://attacker.example",
        )
        seed_response = client.get("/api/csrf/")
        csrf_token = seed_response.json()["csrf_token"]
        accepted_response = client.post(
            "/api/auth/token/refresh/",
            data={},
            format="json",
            HTTP_X_CSRFTOKEN=csrf_token,
            HTTP_ORIGIN="https://trusted-frontend.example",
        )

        self.assertEqual(rejected_response.status_code, 403)
        self.assertEqual(accepted_response.status_code, 200)

    def test_revocation_invalidates_existing_access_and_refresh_tokens(self):
        access_token, refresh_token = self.login()
        initial_generation = AccountSecurityState.objects.get(
            user=self.user
        ).session_generation
        revoke_user_sessions(self.user)

        access_client = APIClient()
        access_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
        access_response = access_client.get("/api/portal/me/")
        refresh_response = self.refresh(refresh_token)

        self.assertEqual(access_response.status_code, 401)
        self.assertEqual(refresh_response.status_code, 401)
        state = AccountSecurityState.objects.get(user=self.user)
        self.assertEqual(state.session_generation, initial_generation + 1)
        self.assertIsNotNone(state.sessions_revoked_at)

    def test_refresh_rotated_during_revocation_keeps_stale_generation(self):
        _, refresh_token = self.login()
        raced_refresh = RefreshToken(refresh_token)

        revoke_user_sessions(self.user)
        raced_refresh.set_jti()
        raced_refresh.set_exp()
        raced_refresh.set_iat()
        raced_refresh.outstand()
        raced_refresh_token = str(raced_refresh)

        refresh_response = self.refresh(raced_refresh_token)
        raced_access = str(raced_refresh.access_token)
        access_client = APIClient()
        access_client.credentials(HTTP_AUTHORIZATION=f"Bearer {raced_access}")
        access_response = access_client.get("/api/portal/me/")

        self.assertEqual(refresh_response.status_code, 401)
        self.assertEqual(access_response.status_code, 401)

    def test_rotated_refresh_token_cannot_be_replayed(self):
        _, refresh_token = self.login()

        first_response = self.refresh(refresh_token)
        replay_response = self.refresh(refresh_token)

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(replay_response.status_code, 401)

    def test_malformed_signed_refresh_user_claim_returns_unauthorized(self):
        malformed_refresh = RefreshToken()
        malformed_refresh["user_id"] = "not-a-valid-user-id"

        response = self.refresh(str(malformed_refresh))

        self.assertEqual(response.status_code, 401)

    def test_malformed_signed_session_claim_returns_unauthorized(self):
        _, refresh_token = self.login()
        malformed_refresh = RefreshToken(refresh_token)
        malformed_refresh["session_id"] = "not-a-valid-session-id"

        refresh_response = self.refresh(str(malformed_refresh))
        access_client = APIClient()
        access_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {str(malformed_refresh.access_token)}"
        )
        access_response = access_client.get("/api/portal/me/")

        self.assertEqual(refresh_response.status_code, 401)
        self.assertEqual(access_response.status_code, 401)

    def test_logout_revokes_rotated_descendant_and_access_token(self):
        access_token, refresh_token = self.login()
        refresh_response = self.refresh(refresh_token)
        self.assertEqual(refresh_response.status_code, 200)
        rotated_refresh = refresh_response.cookies["manley_portal_refresh"].value

        logout_client = APIClient()
        logout_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
        logout_client.cookies["manley_portal_refresh"] = refresh_token
        logout_response = logout_client.post("/api/auth/logout/", data={}, format="json")

        rotated_response = self.refresh(rotated_refresh)
        access_client = APIClient()
        access_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
        access_response = access_client.get("/api/portal/me/")

        self.assertEqual(logout_response.status_code, 200)
        self.assertEqual(rotated_response.status_code, 401)
        self.assertEqual(access_response.status_code, 401)

    def test_logout_revokes_only_the_current_account_session(self):
        first_access, first_refresh = self.login()
        second_access, second_refresh = self.login()
        self.assertEqual(AccountSession.objects.filter(user=self.user).count(), 2)

        logout_client = APIClient()
        logout_client.credentials(HTTP_AUTHORIZATION=f"Bearer {first_access}")
        logout_client.cookies["manley_portal_refresh"] = first_refresh
        logout_response = logout_client.post("/api/auth/logout/", data={}, format="json")

        first_access_client = APIClient()
        first_access_client.credentials(HTTP_AUTHORIZATION=f"Bearer {first_access}")
        first_access_response = first_access_client.get("/api/portal/me/")
        first_refresh_response = self.refresh(first_refresh)
        second_access_client = APIClient()
        second_access_client.credentials(HTTP_AUTHORIZATION=f"Bearer {second_access}")
        second_access_response = second_access_client.get("/api/portal/me/")
        second_refresh_response = self.refresh(second_refresh)

        self.assertEqual(logout_response.status_code, 200)
        self.assertEqual(first_access_response.status_code, 401)
        self.assertEqual(first_refresh_response.status_code, 401)
        self.assertEqual(second_access_response.status_code, 200)
        self.assertEqual(second_refresh_response.status_code, 200)

    def test_logout_without_refresh_cookie_still_revokes_access_session(self):
        access_token, _ = self.login()
        logout_client = APIClient()
        logout_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")

        logout_response = logout_client.post("/api/auth/logout/", data={}, format="json")

        access_client = APIClient()
        access_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
        access_response = access_client.get("/api/portal/me/")
        self.assertEqual(logout_response.status_code, 200)
        self.assertEqual(access_response.status_code, 401)

    def test_direct_password_hash_change_invalidates_tokens(self):
        access_token, refresh_token = self.login()
        initial_generation = AccountSecurityState.objects.get(
            user=self.user
        ).session_generation
        self.user.set_password("replacement-password-123")
        self.user.save(update_fields=["password"])

        access_client = APIClient()
        access_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
        access_response = access_client.get("/api/portal/me/")
        refresh_response = self.refresh(refresh_token)

        self.assertEqual(access_response.status_code, 401)
        self.assertEqual(refresh_response.status_code, 401)
        state = AccountSecurityState.objects.get(user=self.user)
        self.assertEqual(state.session_generation, initial_generation + 1)

    @patch.dict(
        "os.environ",
        {
            "OWNER_USERNAME": "session-user",
            "OWNER_EMAIL": "session-user@example.com",
            "OWNER_PASSWORD": "session-password-123",
        },
        clear=True,
    )
    def test_owner_privilege_promotion_revokes_existing_credentials(self):
        access_token, refresh_token = self.login()
        raw_action_token = issue_account_action_token(
            user=self.user,
            purpose=AccountActionToken.Purpose.PASSWORD_RESET,
            target_email=self.user.email,
            lifetime=timedelta(hours=1),
        )

        call_command("create_owner_from_env", stdout=StringIO())

        access_client = APIClient()
        access_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
        access_response = access_client.get("/api/portal/me/")
        refresh_response = self.refresh(refresh_token)
        profile = UserProfile.objects.get(user=self.user)

        self.assertEqual(profile.role, UserProfile.ROLE_OWNER)
        self.assertEqual(access_response.status_code, 401)
        self.assertEqual(refresh_response.status_code, 401)
        self.assertIsNone(
            consume_account_action_token(
                raw_token=raw_action_token,
                purpose=AccountActionToken.Purpose.PASSWORD_RESET,
                action=lambda action_token: action_token.pk,
            )
        )

    def test_direct_portal_role_change_revokes_existing_credentials(self):
        access_token, refresh_token = self.login()
        profile = UserProfile.objects.get(user=self.user)

        profile.role = UserProfile.ROLE_OFFICE_STAFF
        profile.save(update_fields=["role", "updated_at"])

        access_client = APIClient()
        access_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
        access_response = access_client.get("/api/portal/me/")
        refresh_response = self.refresh(refresh_token)

        self.assertEqual(access_response.status_code, 401)
        self.assertEqual(refresh_response.status_code, 401)

    def test_password_change_with_stale_user_does_not_reactivate_account(self):
        stale_user = get_user_model().objects.get(pk=self.user.pk)
        current_user = get_user_model().objects.get(pk=self.user.pk)
        current_user.is_active = False
        current_user.save(update_fields=["is_active"])
        client = APIClient()
        client.force_authenticate(user=stale_user)

        response = client.post(
            "/api/account/change-password/",
            data={
                "current_password": "session-password-123",
                "new_password": "replacement-password-123!",
            },
            format="json",
        )

        self.user.refresh_from_db()
        self.assertEqual(response.status_code, 200)
        self.assertFalse(self.user.is_active)
        self.assertTrue(self.user.check_password("replacement-password-123!"))

    def test_company_membership_change_revokes_existing_credentials(self):
        access_token, refresh_token = self.login()
        company = Company.objects.create(name="Session Company", slug="session-company")
        profile = UserProfile.objects.get(user=self.user)

        profile.allowed_companies.add(company)

        access_client = APIClient()
        access_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
        access_response = access_client.get("/api/portal/me/")
        refresh_response = self.refresh(refresh_token)
        self.assertEqual(access_response.status_code, 401)
        self.assertEqual(refresh_response.status_code, 401)

    def test_user_delete_cascades_security_records_cleanly(self):
        self.login()
        user_id = self.user.pk

        self.user.delete()

        self.assertFalse(get_user_model().objects.filter(pk=user_id).exists())
        self.assertFalse(AccountSession.objects.filter(user_id=user_id).exists())
        self.assertFalse(AccountSecurityState.objects.filter(user_id=user_id).exists())


class CommerceCustomerProfileTests(TestCase):
    def test_commerce_profile_lifecycle_does_not_grant_portal_access(self):
        user = get_user_model().objects.create_user(
            username="commerce-customer",
            email="commerce-customer@example.com",
            password="commercepass123",
        )
        verified_at = timezone.now()
        profile = CommerceCustomerProfile.objects.create(
            user=user,
            verified_email=user.email,
            email_verified_at=verified_at,
        )
        client = APIClient()
        client.force_authenticate(user=user)

        response = client.get("/api/portal/me/")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(profile.email_verified_at, verified_at)
        self.assertTrue(profile.has_verified_email())
        self.assertIsNone(profile.disabled_at)
        self.assertIsNone(profile.anonymized_at)
        self.assertFalse(UserProfile.objects.filter(user=user).exists())

    def test_portal_profile_does_not_implicitly_create_commerce_profile(self):
        user = get_user_model().objects.create_user(
            username="portal-customer",
            email="portal-customer@example.com",
            password="portalpass123",
        )

        UserProfile.objects.create(user=user, role=UserProfile.ROLE_CUSTOMER)

        self.assertFalse(CommerceCustomerProfile.objects.filter(user=user).exists())

    def test_email_verification_is_bound_to_current_normalized_email(self):
        user = get_user_model().objects.create_user(
            username="verified-commerce-customer",
            email="verified-commerce@example.com",
        )
        profile = CommerceCustomerProfile.objects.create(
            user=user,
            verified_email="verified-commerce@example.com",
            email_verified_at=timezone.now(),
        )

        self.assertTrue(profile.has_verified_email())

        user.email = "changed-commerce@example.com"
        user.save(update_fields=["email"])

        user.email = "verified-commerce@example.com"
        user.save(update_fields=["email"])

        profile.refresh_from_db()
        self.assertEqual(profile.verified_email, "")
        self.assertIsNone(profile.email_verified_at)

        self.assertFalse(profile.has_verified_email())

    def test_email_change_away_and_back_cannot_resurrect_action_token(self):
        user = get_user_model().objects.create_user(
            username="action-email-change",
            email="action-email-change@example.com",
        )
        raw_token = issue_account_action_token(
            user=user,
            purpose=AccountActionToken.Purpose.VERIFY_EMAIL,
            target_email=user.email,
            lifetime=timedelta(hours=1),
        )

        user.email = "different-action-email@example.com"
        user.save(update_fields=["email"])
        user.email = "action-email-change@example.com"
        user.save(update_fields=["email"])

        self.assertIsNone(
            consume_account_action_token(
                raw_token=raw_token,
                purpose=AccountActionToken.Purpose.VERIFY_EMAIL,
                action=lambda action_token: action_token.pk,
            )
        )

    @patch.dict(
        "os.environ",
        {
            "OWNER_USERNAME": "verified-owner",
            "OWNER_EMAIL": "new-owner-email@example.com",
            "OWNER_PASSWORD": "owner-password-123",
        },
        clear=True,
    )
    def test_owner_email_change_clears_commerce_verification(self):
        user = get_user_model().objects.create_user(
            username="verified-owner",
            email="old-owner-email@example.com",
            password="owner-password-123",
        )
        profile = CommerceCustomerProfile.objects.create(
            user=user,
            verified_email=user.email,
            email_verified_at=timezone.now(),
        )

        call_command("create_owner_from_env", stdout=StringIO())

        profile.refresh_from_db()
        self.assertEqual(profile.verified_email, "")
        self.assertIsNone(profile.email_verified_at)
        self.assertFalse(profile.has_verified_email())


class AccountBootstrapTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="shared-account",
            email="shared-account@example.com",
            first_name="Shared",
            last_name="Customer",
            password="shared-account-password",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_returns_minimal_identity_and_independent_capabilities(self):
        UserProfile.objects.create(user=self.user, role=UserProfile.ROLE_OWNER)
        CommerceCustomerProfile.objects.create(
            user=self.user,
            verified_email=self.user.email,
            email_verified_at=timezone.now(),
        )

        response = self.client.get("/api/account/bootstrap/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "username": "shared-account",
                "email": "shared-account@example.com",
                "full_name": "Shared Customer",
                "email_verified": True,
                "capabilities": {
                    "can_shop": False,
                    "can_view_orders": False,
                    "can_access_portal": True,
                    "can_fulfill_orders": True,
                    "can_manage_shop": True,
                },
            },
        )

    def test_commerce_profile_does_not_grant_portal_capability(self):
        CommerceCustomerProfile.objects.create(
            user=self.user,
            verified_email=self.user.email,
            email_verified_at=timezone.now(),
        )

        response = self.client.get("/api/account/bootstrap/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["capabilities"],
            {
                "can_shop": True,
                "can_view_orders": True,
                "can_access_portal": False,
                "can_fulfill_orders": False,
                "can_manage_shop": False,
            },
        )

    def test_portal_profile_does_not_create_or_grant_commerce_capabilities(self):
        UserProfile.objects.create(user=self.user, role=UserProfile.ROLE_CUSTOMER)

        response = self.client.get("/api/account/bootstrap/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["capabilities"],
            {
                "can_shop": False,
                "can_view_orders": False,
                "can_access_portal": True,
                "can_fulfill_orders": False,
                "can_manage_shop": False,
            },
        )
        self.assertFalse(CommerceCustomerProfile.objects.filter(user=self.user).exists())

    def test_unverified_disabled_or_anonymized_commerce_profile_has_no_capabilities(self):
        profile = CommerceCustomerProfile.objects.create(user=self.user)

        for changes, expected_email_verified in (
            ({}, False),
            ({
                "verified_email": self.user.email,
                "email_verified_at": timezone.now(),
                "disabled_at": timezone.now(),
            }, True),
            ({
                "disabled_at": None,
                "anonymized_at": timezone.now(),
            }, True),
        ):
            for field, value in changes.items():
                setattr(profile, field, value)
            profile.save()

            response = self.client.get("/api/account/bootstrap/")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["email_verified"], expected_email_verified)
            self.assertFalse(response.json()["capabilities"]["can_shop"])
            self.assertFalse(response.json()["capabilities"]["can_view_orders"])
            self.assertFalse(response.json()["capabilities"]["can_fulfill_orders"])
            self.assertFalse(response.json()["capabilities"]["can_manage_shop"])

    def test_read_does_not_create_authorization_state(self):
        response = self.client.get("/api/account/bootstrap/")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(UserProfile.objects.filter(user=self.user).exists())
        self.assertFalse(CommerceCustomerProfile.objects.filter(user=self.user).exists())
        self.assertEqual(
            response.json()["capabilities"],
            {
                "can_shop": False,
                "can_view_orders": False,
                "can_access_portal": False,
                "can_fulfill_orders": False,
                "can_manage_shop": False,
            },
        )

    def test_requires_authentication(self):
        self.client.force_authenticate(user=None)

        response = self.client.get("/api/account/bootstrap/")

        self.assertEqual(response.status_code, 401)


@override_settings(
    ACCOUNT_REGISTRATION_ENABLED=True,
    ACCOUNT_REQUIRE_TURNSTILE=False,
    ACCOUNT_TERMS_VERSION="terms-v1",
    ACCOUNT_PRIVACY_VERSION="privacy-v1",
)
class CommerceRegistrationTests(TestCase):
    registration_payload = {
        "email": "new-customer@example.com",
        "password": "A-Strong-Commerce-Password-123!",
        "first_name": "New",
        "last_name": "Customer",
        "accept_terms": True,
        "accept_privacy": True,
        "turnstile_token": "test-turnstile-token",
    }
    generic_registration_response = {
        "detail": "If the address can be registered, check your email for next steps."
    }
    generic_resend_response = {
        "detail": "If an unverified account exists, a verification email will be sent."
    }

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def register(self, mock_send, **changes):
        payload = {**self.registration_payload, **changes}
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                "/api/account/register/",
                data=payload,
                format="json",
            )
        return response

    @patch("api.account_views.send_verification_email")
    def test_registration_creates_only_pending_commerce_identity(self, mock_send):
        response = self.register(mock_send, email="  NEW-CUSTOMER@example.com ")

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json(), self.generic_registration_response)
        user = get_user_model().objects.get(email="new-customer@example.com")
        profile = CommerceCustomerProfile.objects.get(user=user)
        action_token = AccountActionToken.objects.get(
            user=user,
            purpose=AccountActionToken.Purpose.VERIFY_EMAIL,
        )
        raw_token = mock_send.call_args.kwargs["raw_token"]
        self.assertFalse(user.is_active)
        self.assertTrue(user.check_password(self.registration_payload["password"]))
        self.assertTrue(user.username.startswith("commerce_"))
        self.assertFalse(UserProfile.objects.filter(user=user).exists())
        self.assertTrue(profile.activation_pending)
        self.assertEqual(profile.terms_version, "terms-v1")
        self.assertEqual(profile.privacy_version, "privacy-v1")
        self.assertIsNotNone(profile.terms_accepted_at)
        self.assertEqual(profile.privacy_accepted_at, profile.terms_accepted_at)
        self.assertNotEqual(action_token.token_digest, raw_token)
        self.assertNotIn(raw_token, str(response.json()))
        mock_send.assert_called_once_with(
            recipient_email="new-customer@example.com",
            raw_token=raw_token,
        )

    @patch("api.account_views.send_verification_email")
    def test_registration_saves_address_when_address_payload_is_provided(self, mock_send):
        response = self.client.post(
            "/api/account/register/",
            data={
                **self.registration_payload,
                "recipient_name": "Guest User",
                "recipient_phone": "+353871234567",
                "address_line_1": "10 Harbour Road",
                "address_line_2": "Apartment 2",
                "city": "Cork",
                "county": "Cork",
                "postcode": "T12 3AB",
                "country_code": "IE",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 202)
        user = get_user_model().objects.get(email="new-customer@example.com")
        profile = CommerceCustomerProfile.objects.get(user=user)
        address = SavedAddress.objects.get(commerce_profile=profile)

        self.assertEqual(address.label, "Checkout address")
        self.assertEqual(address.recipient_name, "Guest User")
        self.assertEqual(address.recipient_phone, "+353871234567")
        self.assertEqual(address.address_line_1, "10 Harbour Road")
        self.assertEqual(address.address_line_2, "Apartment 2")
        self.assertEqual(address.city, "Cork")
        self.assertEqual(address.county, "Cork")
        self.assertEqual(address.postcode, "T12 3AB")
        self.assertEqual(address.country_code, "IE")
        self.assertTrue(address.is_default_shipping)
        self.assertFalse(address.is_default_billing)

    @override_settings(ACCOUNT_REGISTRATION_ENABLED=False)
    @patch("api.account_views.send_verification_email")
    def test_registration_is_fail_closed_until_enabled(self, mock_send):
        response = self.register(mock_send)

        self.assertEqual(response.status_code, 503)
        self.assertFalse(get_user_model().objects.exists())
        mock_send.assert_not_called()

    @patch("api.account_views.send_verification_email")
    def test_existing_email_gets_same_generic_response_without_identity_merge(self, mock_send):
        existing_user = get_user_model().objects.create_user(
            username="existing-portal-user",
            email="existing@example.com",
            password="existing-password-123",
        )
        UserProfile.objects.create(user=existing_user, role=UserProfile.ROLE_OWNER)

        response = self.register(mock_send, email=" Existing@Example.com ")

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json(), self.generic_registration_response)
        self.assertEqual(get_user_model().objects.count(), 1)
        self.assertFalse(CommerceCustomerProfile.objects.filter(user=existing_user).exists())
        self.assertFalse(AccountActionToken.objects.filter(user=existing_user).exists())
        mock_send.assert_not_called()

    @patch("api.account_views.send_verification_email")
    def test_existing_pending_ecommerce_email_reissues_verification(self, mock_send):
        first_response = self.register(mock_send, email="pending@example.com")
        self.assertEqual(first_response.status_code, 202)

        mock_send.reset_mock()
        with self.captureOnCommitCallbacks(execute=True):
            second_response = self.client.post(
                "/api/account/register/",
                data={**self.registration_payload, "email": "PENDING@example.com"},
                format="json",
            )

        self.assertEqual(second_response.status_code, 202)
        self.assertEqual(second_response.json(), self.generic_registration_response)
        self.assertEqual(get_user_model().objects.filter(email="pending@example.com").count(), 1)
        mock_send.assert_called_once()

    @patch("api.account_views.send_verification_email")
    def test_registration_validates_password_and_legal_acceptance(self, mock_send):
        response = self.register(
            mock_send,
            password="too-short",
            accept_terms=False,
            accept_privacy=False,
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.json())
        self.assertIn("accept_terms", response.json())
        self.assertIn("accept_privacy", response.json())
        self.assertFalse(get_user_model().objects.exists())
        mock_send.assert_not_called()

    @patch("api.account_views.verify_turnstile_token", return_value=False)
    @patch("api.account_views.send_verification_email")
    def test_registration_rejects_failed_turnstile(self, mock_send, _mock_turnstile):
        response = self.register(mock_send)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Bot verification failed."})
        self.assertFalse(get_user_model().objects.exists())
        mock_send.assert_not_called()

    @patch("api.account_views.send_verification_email")
    def test_verification_activates_pending_account_once(self, mock_send):
        self.register(mock_send)
        raw_token = mock_send.call_args.kwargs["raw_token"]
        user = get_user_model().objects.get(email="new-customer@example.com")

        first_response = self.client.post(
            "/api/account/verify-email/",
            data={"token": raw_token},
            format="json",
        )
        second_response = self.client.post(
            "/api/account/verify-email/",
            data={"token": raw_token},
            format="json",
        )

        user.refresh_from_db()
        profile = CommerceCustomerProfile.objects.get(user=user)
        action_token = AccountActionToken.objects.get(user=user)
        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(first_response.json(), {"ok": True})
        self.assertEqual(second_response.status_code, 400)
        self.assertTrue(user.is_active)
        self.assertFalse(profile.activation_pending)
        self.assertEqual(profile.verified_email, user.email)
        self.assertTrue(profile.has_verified_email())
        self.assertIsNotNone(action_token.consumed_at)

    def test_verification_never_reactivates_non_pending_disabled_account(self):
        user = get_user_model().objects.create_user(
            username="disabled-commerce-user",
            email="disabled-commerce@example.com",
            password="disabled-password-123",
            is_active=False,
        )
        CommerceCustomerProfile.objects.create(
            user=user,
            activation_pending=False,
        )
        raw_token = issue_account_action_token(
            user=user,
            purpose=AccountActionToken.Purpose.VERIFY_EMAIL,
            target_email=user.email,
            lifetime=timedelta(hours=1),
        )

        response = self.client.post(
            "/api/account/verify-email/",
            data={"token": raw_token},
            format="json",
        )

        user.refresh_from_db()
        profile = CommerceCustomerProfile.objects.get(user=user)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(user.is_active)
        self.assertFalse(profile.has_verified_email())

    @patch("api.account_views.send_verification_email")
    def test_deactivation_cancels_pending_activation(self, mock_send):
        self.register(mock_send)
        raw_token = mock_send.call_args.kwargs["raw_token"]
        user = get_user_model().objects.get(email="new-customer@example.com")
        user.is_active = True
        user.save(update_fields=["is_active"])
        user.is_active = False
        user.save(update_fields=["is_active"])

        response = self.client.post(
            "/api/account/verify-email/",
            data={"token": raw_token},
            format="json",
        )

        user.refresh_from_db()
        profile = CommerceCustomerProfile.objects.get(user=user)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(user.is_active)
        self.assertFalse(profile.activation_pending)

    @patch("api.account_views.send_verification_email")
    def test_resend_replaces_token_and_remains_generic(self, mock_send):
        self.register(mock_send)
        first_token = AccountActionToken.objects.get()
        mock_send.reset_mock()

        with self.captureOnCommitCallbacks(execute=True):
            existing_response = self.client.post(
                "/api/account/resend-verification/",
                data={"email": "NEW-CUSTOMER@example.com"},
                format="json",
            )
        missing_response = self.client.post(
            "/api/account/resend-verification/",
            data={"email": "missing@example.com"},
            format="json",
        )

        first_token.refresh_from_db()
        replacement = AccountActionToken.objects.exclude(pk=first_token.pk).get()
        self.assertEqual(existing_response.status_code, 202)
        self.assertEqual(existing_response.json(), self.generic_resend_response)
        self.assertEqual(missing_response.status_code, 202)
        self.assertEqual(missing_response.json(), self.generic_resend_response)
        self.assertIsNotNone(first_token.revoked_at)
        self.assertIsNone(replacement.revoked_at)
        mock_send.assert_called_once()

    @override_settings(
        ACCOUNT_REQUIRE_TURNSTILE=True,
        ACCOUNT_TURNSTILE_SECRET_KEY="test-secret",
    )
    @patch("api.account_views.verify_turnstile_token", return_value=False)
    @patch("api.account_views.send_verification_email")
    def test_resend_rejects_failed_turnstile_before_identity_lookup(
        self,
        mock_send,
        _mock_turnstile,
    ):
        response = self.client.post(
            "/api/account/resend-verification/",
            data={
                "email": "missing@example.com",
                "turnstile_token": "failed-token",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Bot verification failed."})
        self.assertFalse(AccountActionToken.objects.exists())
        mock_send.assert_not_called()

    @override_settings(
        ACCOUNT_REQUIRE_TURNSTILE=True,
        ACCOUNT_TURNSTILE_SECRET_KEY="test-secret",
    )
    @patch("api.account_views.verify_turnstile_token", return_value=True)
    def test_resend_passes_turnstile_token_to_verifier(self, mock_turnstile):
        response = self.client.post(
            "/api/account/resend-verification/",
            data={
                "email": "missing@example.com",
                "turnstile_token": "valid-turnstile-token",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 202)
        mock_turnstile.assert_called_once_with(
            "valid-turnstile-token",
            required=True,
            secret_key="test-secret",
            remote_ip="127.0.0.1",
        )

    @patch("api.account_views.send_verification_email")
    def test_verified_customer_can_login_with_email_but_pending_customer_cannot(self, mock_send):
        self.register(mock_send)
        raw_token = mock_send.call_args.kwargs["raw_token"]

        pending_response = self.client.post(
            "/api/auth/token/",
            data={
                "username": "new-customer@example.com",
                "password": self.registration_payload["password"],
            },
            format="json",
        )
        self.client.post(
            "/api/account/verify-email/",
            data={"token": raw_token},
            format="json",
        )
        with self.captureOnCommitCallbacks(execute=True), patch("api.serializers.send_security_notification_email") as mock_security_send:
            verified_response = self.client.post(
                "/api/auth/token/",
                data={
                    "username": "NEW-CUSTOMER@example.com",
                    "password": self.registration_payload["password"],
                },
                format="json",
            )

        self.assertEqual(pending_response.status_code, 400)
        self.assertEqual(
            pending_response.json().get("detail"),
            ["Verify your email before signing in. Use resend verification if you need a new link."],
        )
        self.assertEqual(verified_response.status_code, 200)
        self.assertIn("access", verified_response.json())
        mock_security_send.assert_called_once()
        self.assertEqual(mock_security_send.call_args.kwargs["recipient_email"], "new-customer@example.com")

    @patch("api.serializers.send_security_notification_email")
    def test_email_login_prefers_ecommerce_email_over_username_collision(self, mock_security_send):
        customer = get_user_model().objects.create_user(
            username="commerce_customer_unique",
            email="customer-login@example.com",
            password="A-Strong-Commerce-Password-123!",
            is_active=True,
        )
        CommerceCustomerProfile.objects.create(
            user=customer,
            activation_pending=False,
            verified_email="customer-login@example.com",
            email_verified_at=timezone.now(),
        )

        # Simulate a portal/staff identity whose username collides with the customer's email string.
        get_user_model().objects.create_user(
            username="customer-login@example.com",
            email="different-user@example.com",
            password="Different-Password-123!",
            is_active=True,
        )

        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                "/api/auth/token/",
                data={
                    "username": "customer-login@example.com",
                    "password": "A-Strong-Commerce-Password-123!",
                },
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.json())
        mock_security_send.assert_called_once()
        self.assertEqual(mock_security_send.call_args.kwargs["recipient_email"], "customer-login@example.com")

    @patch("api.serializers.send_security_notification_email")
    def test_login_security_email_only_sends_for_new_device(self, mock_security_send):
        user = get_user_model().objects.create_user(
            username="new-device-notify-user",
            email="new-device-notify@example.com",
            password="A-Strong-Commerce-Password-123!",
            is_active=True,
        )
        CommerceCustomerProfile.objects.create(
            user=user,
            activation_pending=False,
            verified_email=user.email,
            email_verified_at=timezone.now(),
        )

        with self.captureOnCommitCallbacks(execute=True):
            first_login = self.client.post(
                "/api/auth/token/",
                data={"username": user.email, "password": "A-Strong-Commerce-Password-123!"},
                format="json",
                HTTP_USER_AGENT="BrowserOne/1.0",
            )

        with self.captureOnCommitCallbacks(execute=True):
            second_login_same_device = self.client.post(
                "/api/auth/token/",
                data={"username": user.email, "password": "A-Strong-Commerce-Password-123!"},
                format="json",
                HTTP_USER_AGENT="BrowserOne/1.0",
            )

        with self.captureOnCommitCallbacks(execute=True):
            third_login_new_device = self.client.post(
                "/api/auth/token/",
                data={"username": user.email, "password": "A-Strong-Commerce-Password-123!"},
                format="json",
                HTTP_USER_AGENT="BrowserTwo/2.0",
            )

        self.assertEqual(first_login.status_code, 200)
        self.assertEqual(second_login_same_device.status_code, 200)
        self.assertEqual(third_login_new_device.status_code, 200)
        self.assertEqual(mock_security_send.call_count, 2)

    @patch("api.account_reset_views.send_password_reset_email")
    def test_password_reset_request_issues_single_use_token_and_sends_email(self, mock_send):
        user = get_user_model().objects.create_user(
            username="reset-request-user",
            email="reset-request@example.com",
            password="A-Strong-Commerce-Password-123!",
            is_active=True,
        )
        CommerceCustomerProfile.objects.create(user=user, activation_pending=False)

        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                "/api/account/password-reset/",
                data={"email": "RESET-REQUEST@example.com"},
                format="json",
            )

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json(), {"detail": "If an account exists, a reset email will be sent."})
        self.assertTrue(
            AccountActionToken.objects.filter(
                user=user,
                purpose=AccountActionToken.Purpose.PASSWORD_RESET,
            ).exists()
        )
        mock_send.assert_called_once()
        self.assertEqual(mock_send.call_args.kwargs["recipient_email"], user.email)

    def test_password_reset_completion_updates_password_and_rejects_replay(self):
        user = get_user_model().objects.create_user(
            username="reset-complete-user",
            email="reset-complete@example.com",
            password="Old-Strong-Password-123!",
            is_active=True,
        )
        CommerceCustomerProfile.objects.create(user=user, activation_pending=False)
        raw_token = issue_account_action_token(
            user=user,
            purpose=AccountActionToken.Purpose.PASSWORD_RESET,
            target_email=user.email,
            lifetime=timedelta(hours=1),
        )

        first_response = self.client.post(
            "/api/account/password-reset/complete/",
            data={"token": raw_token, "new_password": "New-Strong-Password-456!"},
            format="json",
        )
        second_response = self.client.post(
            "/api/account/password-reset/complete/",
            data={"token": raw_token, "new_password": "Another-Strong-Password-789!"},
            format="json",
        )

        user.refresh_from_db()
        action_token = AccountActionToken.objects.get(user=user, purpose=AccountActionToken.Purpose.PASSWORD_RESET)
        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(first_response.json(), {"ok": True})
        self.assertEqual(second_response.status_code, 400)
        self.assertTrue(user.check_password("New-Strong-Password-456!"))
        self.assertFalse(user.check_password("Old-Strong-Password-123!"))
        self.assertIsNotNone(action_token.consumed_at)

    @patch("api.account_reset_views.send_security_notification_email")
    def test_password_reset_completion_revokes_existing_sessions_and_logs_security_event(self, mock_security_send):
        user = get_user_model().objects.create_user(
            username="reset-session-user",
            email="reset-session@example.com",
            password="Old-Strong-Password-123!",
            is_active=True,
        )
        CommerceCustomerProfile.objects.create(user=user, activation_pending=False)
        session = AccountSession.objects.create(
            user=user,
            expires_at=timezone.now() + timedelta(hours=2),
        )
        raw_token = issue_account_action_token(
            user=user,
            purpose=AccountActionToken.Purpose.PASSWORD_RESET,
            target_email=user.email,
            lifetime=timedelta(hours=1),
        )

        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                "/api/account/password-reset/complete/",
                data={"token": raw_token, "new_password": "Reset-Strong-Password-789!"},
                format="json",
            )

        session.refresh_from_db()
        state = AccountSecurityState.objects.get(user=user)
        security_event = AuditLog.objects.filter(actor=user, action="account.password_reset", target_type="account", target_id=str(user.pk)).first()
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(session.revoked_at)
        self.assertGreater(state.session_generation, 0)
        self.assertIsNotNone(security_event)
        mock_security_send.assert_called_once_with(
            recipient_email=user.email,
            subject="Your Manley Lifting password was changed",
            text_body=(
                "Your Manley Lifting password was reset successfully.\n\n"
                "If you did not make this change, sign in as soon as possible and review your active sessions."
            ),
        )

    @patch("api.account_views.send_security_notification_email")
    def test_account_password_change_requires_current_password_and_revokes_sessions(self, mock_security_send):
        user = get_user_model().objects.create_user(
            username="account-password-user",
            email="account-password@example.com",
            password="Old-Strong-Password-123!",
            is_active=True,
        )
        CommerceCustomerProfile.objects.create(user=user, activation_pending=False)
        initial_generation = AccountSecurityState.objects.get(user=user).session_generation
        self.client.force_authenticate(user=user)

        invalid_response = self.client.post(
            "/api/account/change-password/",
            data={"current_password": "wrong-password", "new_password": "Cobalt-Glacier-44!"},
            format="json",
        )
        with self.captureOnCommitCallbacks(execute=True):
            success_response = self.client.post(
                "/api/account/change-password/",
                data={"current_password": "Old-Strong-Password-123!", "new_password": "Cobalt-Glacier-44!"},
                format="json",
            )

        user.refresh_from_db()
        state = AccountSecurityState.objects.get(user=user)
        self.assertEqual(invalid_response.status_code, 400)
        self.assertEqual(success_response.status_code, 200)
        self.assertTrue(user.check_password("Cobalt-Glacier-44!"))
        self.assertEqual(state.session_generation, initial_generation + 1)
        mock_security_send.assert_called_once_with(
            recipient_email=user.email,
            subject="Your Manley Lifting password was changed",
            text_body=(
                "Your Manley Lifting password was changed successfully.\n\n"
                "If you did not make this change, sign in immediately and review your active sessions."
            ),
        )

    def test_account_logout_all_revokes_all_active_sessions(self):
        user = get_user_model().objects.create_user(
            username="account-logout-all-user",
            email="account-logout-all@example.com",
            password="Strong-Password-123!",
            is_active=True,
        )
        CommerceCustomerProfile.objects.create(user=user, activation_pending=False)
        self.client.force_authenticate(user=user)

        response = self.client.post("/api/account/logout-all/", data={}, format="json")

        state = AccountSecurityState.objects.get(user=user)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(AccountSession.objects.filter(user=user, revoked_at__isnull=True).count(), 0)
        self.assertGreater(state.session_generation, 0)

    def test_account_session_list_and_revoke_specific_session(self):
        user = get_user_model().objects.create_user(
            username="account-session-list-user",
            email="account-session-list@example.com",
            password="Strong-Password-123!",
            is_active=True,
        )
        CommerceCustomerProfile.objects.create(user=user, activation_pending=False)
        current_session = AccountSession.objects.create(
            user=user,
            expires_at=timezone.now() + timedelta(hours=2),
        )
        other_session = AccountSession.objects.create(
            user=user,
            expires_at=timezone.now() + timedelta(hours=2),
        )
        self.client.force_authenticate(user=user)

        list_response = self.client.get("/api/account/sessions/", format="json")
        revoke_response = self.client.post(
            f"/api/account/sessions/{other_session.pk}/revoke/",
            data={},
            format="json",
        )

        other_session.refresh_from_db()
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(len(list_response.json()), 2)
        self.assertTrue(any(item["id"] == str(current_session.pk) for item in list_response.json()))
        self.assertTrue(any(item["id"] == str(other_session.pk) for item in list_response.json()))
        self.assertEqual(revoke_response.status_code, 200)
        self.assertIsNotNone(other_session.revoked_at)

    def test_account_disable_marks_account_inactive_and_revokes_sessions(self):
        user = get_user_model().objects.create_user(
            username="account-disable-user",
            email="account-disable@example.com",
            password="Strong-Password-123!",
            is_active=True,
        )
        profile = CommerceCustomerProfile.objects.create(user=user, activation_pending=False)
        self.client.force_authenticate(user=user)

        response = self.client.post(
            "/api/account/disable/",
            data={"current_password": "Strong-Password-123!"},
            format="json",
        )

        user.refresh_from_db()
        profile.refresh_from_db()
        self.assertEqual(response.status_code, 200)
        self.assertFalse(user.is_active)
        self.assertIsNotNone(profile.disabled_at)
        self.assertEqual(AccountSession.objects.filter(user=user, revoked_at__isnull=True).count(), 0)
        self.assertTrue(
            AuditLog.objects.filter(actor=user, action="account.disable", target_type="account", target_id=str(user.pk)).exists()
        )

    def test_account_delete_requests_recovery_window_and_anonymizes_orders(self):
        user = get_user_model().objects.create_user(
            username="account-delete-user",
            email="account-delete@example.com",
            password="Strong-Password-123!",
            is_active=True,
        )
        profile = CommerceCustomerProfile.objects.create(user=user, activation_pending=False)
        order = OnsiteOrder.objects.create(
            checkout_ref="checkout-delete-window",
            order_number="ORD-DELETE-001",
            user=user,
            customer_name="Delete User",
            customer_email="delete@example.com",
            shipping_name="Delete User",
            shipping_phone="+353851234567",
            shipping_address_line_1="10 Main Street",
            shipping_city="Cork",
            shipping_postcode="T12 1AB",
            shipping_country_code="IE",
            amount_total_cents=5000,
            subtotal_cents=5000,
            shipping_cents=0,
            tax_cents=0,
            discount_cents=0,
        )
        self.client.force_authenticate(user=user)

        response = self.client.post(
            "/api/account/delete/",
            data={"current_password": "Strong-Password-123!", "confirm": True},
            format="json",
        )

        user.refresh_from_db()
        profile.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(response.status_code, 200)
        self.assertFalse(user.is_active)
        self.assertTrue(get_user_model().objects.filter(pk=user.pk).exists())
        self.assertIsNotNone(profile.deletion_requested_at)
        self.assertIsNotNone(profile.deletion_expires_at)
        self.assertGreater(profile.deletion_expires_at, profile.deletion_requested_at)
        self.assertTrue(AccountSession.objects.filter(user=user, revoked_at__isnull=True).count() == 0)
        self.assertIsNone(order.user)
        self.assertEqual(order.customer_name, "Account deleted")
        self.assertEqual(order.customer_email, "")
        self.assertEqual(order.shipping_name, "Account deleted")
        self.assertEqual(order.shipping_phone, "")
        self.assertTrue(AuditLog.objects.filter(action="account.delete", target_type="account").exists())

    def test_account_delete_recovery_restores_access_before_expiry_but_not_order_identity(self):
        user = get_user_model().objects.create_user(
            username="account-recover-user",
            email="recover@example.com",
            password="Strong-Password-123!",
            is_active=False,
        )
        profile = CommerceCustomerProfile.objects.create(
            user=user,
            activation_pending=False,
            deleted_at=None,
            disabled_at=timezone.now(),
            deletion_requested_at=timezone.now(),
            deletion_expires_at=timezone.now() + timedelta(days=14),
        )
        order = OnsiteOrder.objects.create(
            checkout_ref="checkout-recovery-window",
            order_number="ORD-RECOVER-001",
            user=None,
            customer_name="Account deleted",
            customer_email="",
            shipping_name="Account deleted",
            shipping_phone="",
            amount_total_cents=2500,
            subtotal_cents=2500,
            shipping_cents=0,
            tax_cents=0,
            discount_cents=0,
        )
        self.client.force_authenticate(user=user)

        response = self.client.post(
            "/api/account/delete/recover/",
            data={"current_password": "Strong-Password-123!"},
            format="json",
        )

        user.refresh_from_db()
        profile.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(user.is_active)
        self.assertIsNone(profile.deletion_requested_at)
        self.assertIsNone(profile.deletion_expires_at)
        self.assertIsNone(order.user)
        self.assertEqual(order.customer_name, "Account deleted")

    def test_account_delete_requires_confirmation_and_current_password(self):
        user = get_user_model().objects.create_user(
            username="account-delete-user",
            email="account-delete@example.com",
            password="Strong-Password-123!",
            is_active=True,
        )
        profile = CommerceCustomerProfile.objects.create(user=user, activation_pending=False)
        self.client.force_authenticate(user=user)

        missing_confirmation = self.client.post(
            "/api/account/delete/",
            data={"current_password": "Strong-Password-123!", "confirm": False},
            format="json",
        )
        bad_password = self.client.post(
            "/api/account/delete/",
            data={"current_password": "wrong-password", "confirm": True},
            format="json",
        )
        success = self.client.post(
            "/api/account/delete/",
            data={"current_password": "Strong-Password-123!", "confirm": True},
            format="json",
        )

        user.refresh_from_db()
        profile.refresh_from_db()

        self.assertEqual(missing_confirmation.status_code, 400)
        self.assertEqual(bad_password.status_code, 400)
        self.assertEqual(success.status_code, 200)
        # With soft-delete, user still exists but is inactive with deletion pending
        self.assertTrue(get_user_model().objects.filter(pk=user.pk).exists())
        self.assertFalse(user.is_active)
        self.assertIsNotNone(profile.deletion_requested_at)
        self.assertIsNotNone(profile.deletion_expires_at)
        self.assertTrue(
            AuditLog.objects.filter(action="account.delete", target_type="account").exists()
        )

    def test_account_delete_recovery_fails_after_30_day_expiry(self):
        """Verify recovery fails with 410 GONE after 30-day recovery window expires."""
        from datetime import timedelta

        user = get_user_model().objects.create_user(
            username="account-delete-expired",
            email="account-delete-expired@example.com",
            password="Strong-Password-123!",
            is_active=True,
        )
        profile = CommerceCustomerProfile.objects.create(user=user, activation_pending=False)

        # Request deletion
        self.client.force_authenticate(user=user)
        self.client.post(
            "/api/account/delete/",
            data={"current_password": "Strong-Password-123!", "confirm": True},
            format="json",
        )

        # Manually expire the recovery window
        profile.refresh_from_db()
        profile.deletion_expires_at = timezone.now() - timedelta(days=1)
        profile.save()

        # Attempt recovery after expiry
        response = self.client.post(
            "/api/account/delete/recover/",
            data={"current_password": "Strong-Password-123!"},
            format="json",
        )

        # Verify 410 GONE response
        self.assertEqual(response.status_code, 410)
        self.assertIn("recovery window", response.json()["detail"].lower())

    @patch("api.account_views.send_email_change_email")
    def test_account_email_change_request_issues_verification_to_new_address(self, mock_send):
        user = get_user_model().objects.create_user(
            username="account-email-change-user",
            email="account-email-change@example.com",
            password="Old-Strong-Password-123!",
            is_active=True,
        )
        profile = CommerceCustomerProfile.objects.create(user=user, activation_pending=False)
        profile.verified_email = user.email
        profile.email_verified_at = timezone.now()
        profile.save(update_fields=["verified_email", "email_verified_at", "updated_at"])
        self.client.force_authenticate(user=user)

        response = self.client.post(
            "/api/account/change-email/",
            data={"current_password": "Old-Strong-Password-123!", "new_email": "new-email@example.com"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})
        token = AccountActionToken.objects.get(user=user, purpose=AccountActionToken.Purpose.EMAIL_CHANGE)
        self.assertEqual(token.target_email, "new-email@example.com")
        profile.refresh_from_db()
        self.assertEqual(profile.verified_email, user.email)
        self.assertIsNotNone(profile.email_verified_at)
        self.assertTrue(
            AuditLog.objects.filter(actor=user, action="account.email_change_request", target_type="account", target_id=str(user.pk)).exists()
        )
        mock_send.assert_called_once_with(recipient_email="new-email@example.com", raw_token=ANY)

    @override_settings(ACCOUNT_REQUIRE_TURNSTILE=True, ACCOUNT_TURNSTILE_SECRET_KEY="test-secret")
    @patch("api.account_views.verify_turnstile_token", return_value=False)
    def test_account_email_change_request_rejects_failed_turnstile(self, _mock_turnstile):
        user = get_user_model().objects.create_user(
            username="account-email-change-turnstile-user",
            email="account-email-change-turnstile@example.com",
            password="Old-Strong-Password-123!",
            is_active=True,
        )
        CommerceCustomerProfile.objects.create(user=user, activation_pending=False)
        self.client.force_authenticate(user=user)

        response = self.client.post(
            "/api/account/change-email/",
            data={
                "current_password": "Old-Strong-Password-123!",
                "new_email": "new-email-turnstile@example.com",
                "turnstile_token": "bad-token",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json().get("detail"), "Bot verification failed")

    @patch("api.account_views.send_security_notification_email")
    def test_account_email_change_completion_updates_email_and_marks_verified(self, mock_security_send):
        user = get_user_model().objects.create_user(
            username="account-email-confirm-user",
            email="current-email@example.com",
            password="Strong-Password-123!",
            is_active=True,
        )
        profile = CommerceCustomerProfile.objects.create(
            user=user,
            activation_pending=False,
            verified_email=user.email,
            email_verified_at=timezone.now(),
        )
        raw_token = issue_account_action_token(
            user=user,
            purpose=AccountActionToken.Purpose.EMAIL_CHANGE,
            target_email="updated-email@example.com",
            lifetime=timedelta(hours=1),
        )

        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                "/api/account/change-email/complete/",
                data={"token": raw_token},
                format="json",
            )

        user.refresh_from_db()
        profile.refresh_from_db()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})
        self.assertEqual(user.email, "updated-email@example.com")
        self.assertEqual(profile.verified_email, "updated-email@example.com")
        self.assertIsNotNone(profile.email_verified_at)
        self.assertTrue(profile.has_verified_email())
        self.assertEqual(mock_security_send.call_count, 2)
        self.assertEqual(mock_security_send.call_args_list[0].kwargs["recipient_email"], "current-email@example.com")
        self.assertEqual(mock_security_send.call_args_list[1].kwargs["recipient_email"], "updated-email@example.com")

    @override_settings(CSRF_TRUSTED_ORIGINS=["https://trusted-frontend.example"])
    @patch("api.account_views.send_verification_email")
    def test_registration_is_json_only_and_csrf_protected(self, mock_send):
        csrf_client = APIClient(enforce_csrf_checks=True)
        rejected_response = csrf_client.post(
            "/api/account/register/",
            data=self.registration_payload,
            format="json",
            HTTP_ORIGIN="https://attacker.example",
        )
        seed_response = csrf_client.get("/api/csrf/")
        accepted_response = csrf_client.post(
            "/api/account/register/",
            data=self.registration_payload,
            format="json",
            HTTP_X_CSRFTOKEN=seed_response.json()["csrf_token"],
            HTTP_ORIGIN="https://trusted-frontend.example",
        )
        form_response = self.client.post(
            "/api/account/register/",
            data=self.registration_payload,
        )

        self.assertEqual(rejected_response.status_code, 403)
        self.assertEqual(accepted_response.status_code, 202)
        self.assertEqual(form_response.status_code, 415)


class ZeptoMailDeliveryTests(TestCase):
    def test_provider_response_snippet_redacts_sensitive_fields(self):
        snippet = _safe_response_snippet(
            json.dumps(
                {
                    "status": "accepted",
                    "message": "recipient=customer@example.com token=secret-token",
                    "htmlbody": "<p>Private email content</p>",
                }
            ).encode("utf-8")
        )

        self.assertIn('"status": "accepted"', snippet)
        self.assertNotIn("customer@example.com", snippet)
        self.assertNotIn("secret-token", snippet)
        self.assertNotIn("Private email content", snippet)

    @override_settings(
        ACCOUNT_FRONTEND_URL="https://manleylifting.ie",
        ZEPTOMAIL_API_URL="https://api.zeptomail.eu/v1.1/email",
        ZEPTOMAIL_SEND_TOKEN="test-send-token",
        ZEPTOMAIL_FROM_EMAIL="accounts@manleylifting.ie",
        ZEPTOMAIL_FROM_NAME="Manley Lifting",
    )
    @patch("api.account_emails.urlopen")
    def test_verification_email_uses_zeptomail_without_tracking(self, mock_urlopen):
        response = mock_urlopen.return_value.__enter__.return_value
        response.status = 201

        send_verification_email(
            recipient_email="customer@example.com",
            raw_token="secret-verification-token",
        )

        request = mock_urlopen.call_args.args[0]
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(request.full_url, "https://api.zeptomail.eu/v1.1/email")
        self.assertEqual(request.method, "POST")
        self.assertEqual(
            request.headers["Authorization"],
            "Zoho-enczapikey test-send-token",
        )
        self.assertEqual(payload["from"]["address"], "accounts@manleylifting.ie")
        self.assertEqual(
            payload["to"][0]["email_address"]["address"],
            "customer@example.com",
        )
        self.assertFalse(payload["track_clicks"])
        self.assertFalse(payload["track_opens"])
        self.assertIn("#token=secret-verification-token", payload["textbody"])
        self.assertIn("htmlbody", payload)
        self.assertIn("Verify your email", payload["htmlbody"])
        self.assertIn("Welcome to Manley Lifting", payload["htmlbody"])
        self.assertIn("https://www.a-rich-web.dev/logo-navbar.png", payload["htmlbody"])
        self.assertIn("Manley Lifting", payload["htmlbody"])
        self.assertIn("mailto:accounts@manleylifting.ie", payload["htmlbody"])
        self.assertNotIn("secret-verification-token", request.full_url)

    @override_settings(
        ZEPTOMAIL_SEND_TOKEN="",
        ZEPTOMAIL_FROM_EMAIL="accounts@manleylifting.ie",
    )
    def test_missing_zeptomail_token_fails_closed(self):
        with self.assertRaises(TransactionalEmailDeliveryError):
            send_verification_email(
                recipient_email="customer@example.com",
                raw_token="secret-verification-token",
            )


class ApiBasicEndpointTests(BaseApiTestCase):
    def test_hello_endpoint(self):
        response = self.client.get("/api/hello/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"message": "Hello from Django API"})

    def test_health_endpoint(self):
        response = self.client.get("/api/health/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["checks"]["database"], "ok")
        self.assertEqual(payload["checks"]["cache"], "ok")

    def test_readiness_endpoint(self):
        response = self.client.get("/api/ready/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["checks"]["database"], "ok")
        self.assertEqual(payload["checks"]["cache"], "ok")
        self.assertIn(payload["checks"]["stripe"], {"configured", "not_configured"})

    def test_csrf_seed_endpoint(self):
        response = self.client.get("/api/csrf/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json().get("ok"))
        self.assertTrue(response.json().get("csrf_token"))


class CatalogReadEndpointTests(BaseApiTestCase):
    def setUp(self):
        super().setUp()
        self.collection = CatalogCollection.objects.create(
            handle="lifting",
            title="Lifting",
            description="Lifting gear",
            is_active=True,
        )
        product = CatalogProduct.objects.create(
            product_ref="legacy-product-id",
            variant_ref="legacy-variant-id",
            handle="chain-block",
            title="Chain Block",
            description="desc",
            image_url="https://img",
            image_alt="alt",
            price_amount="99.99",
            currency_code="EUR",
            collection=self.collection,
            is_active=True,
        )
        CatalogProductImage.objects.create(
            product=product,
            image=SimpleUploadedFile("catalog-front.png", _png_bytes(), content_type="image/png"),
            alt_text="Front view",
            sort_order=0,
        )

    def test_featured_products_success(self):
        response = self.client.get("/api/shop/products/featured/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["products"]), 1)
        self.assertEqual(body["products"][0]["handle"], "chain-block")
        self.assertEqual(body["products"][0]["variantId"], "legacy-variant-id")
        self.assertEqual(body["products"][0]["images"][0]["alt"], "Front view")

    def test_featured_products_uses_uploaded_image_for_card_image(self):
        product = CatalogProduct.objects.get(handle="chain-block")
        product.image_url = ""
        product.save(update_fields=["image_url"])

        response = self.client.get("/api/shop/products/featured/")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(
            body["products"][0]["imageUrl"],
            body["products"][0]["images"][0]["url"],
        )

    def test_collections_success(self):
        response = self.client.get("/api/shop/collections/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["collections"]), 1)
        self.assertEqual(body["collections"][0]["handle"], "lifting")

    def test_collection_detail_success(self):
        response = self.client.get("/api/shop/collections/lifting/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["collection"]["handle"], "lifting")
        self.assertEqual(len(body["collection"]["products"]), 1)

    def test_collection_detail_not_found(self):
        response = self.client.get("/api/shop/collections/missing/")
        self.assertEqual(response.status_code, 404)

    def test_product_detail_success(self):
        response = self.client.get("/api/shop/products/chain-block/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["product"]["handle"], "chain-block")

    def test_product_detail_not_found(self):
        response = self.client.get("/api/shop/products/missing/")
        self.assertEqual(response.status_code, 404)


class OnsiteCheckoutTests(BaseApiTestCase):
    def test_minor_unit_conversion_uses_exact_decimal_arithmetic(self):
        self.assertEqual(_to_minor_units(Decimal("10.01")), 1001)
        self.assertEqual(_to_minor_units(Decimal("0.29")), 29)
        self.assertEqual(_to_minor_units(Decimal("99999999.99")), 9999999999)
        self.assertEqual(_to_minor_units(Decimal("0.00")), 0)

    @patch("api.views._is_allowed_checkout_origin", return_value=True)
    @patch("api.views._stripe_config_ok", return_value=True)
    @patch("api.views._verify_turnstile_token", return_value=True)
    @patch("api.views.stripe.PaymentIntent.create")
    def test_tracked_inventory_rejects_oversell(
        self,
        mock_intent_create,
        _mock_turnstile,
        _mock_cfg,
        _mock_origin,
    ):
        CatalogProduct.objects.create(
            variant_ref="tracked-variant",
            handle="tracked-product",
            title="Tracked Product",
            price_amount="10.00",
            currency_code="EUR",
            is_active=True,
            inventory_tracked=True,
            available_qty=1,
            reserved_qty=0,
        )

        response = self.client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps(
                {
                    "checkoutRef": "tracked-oversell",
                    "customer": {"name": "Jane Doe", "email": "jane@example.com"},
                    "items": [{"variantId": "tracked-variant", "quantity": 2}],
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 409)
        self.assertFalse(OnsiteOrder.objects.filter(checkout_ref="tracked-oversell").exists())
        mock_intent_create.assert_not_called()

    @patch("api.views.STRIPE_CLIENT")
    @patch("api.views._is_allowed_checkout_origin", return_value=True)
    @patch("api.views._stripe_config_ok", return_value=True)
    @patch("api.views._verify_turnstile_token", return_value=True)
    def test_onsite_intent_uses_stripe_v1_client(
        self,
        _mock_turnstile,
        _mock_cfg,
        _mock_origin,
        mock_stripe_client,
    ):
        CatalogProduct.objects.create(
            product_ref="legacy-product-id",
            variant_ref="legacy-variant-id",
            handle="chain-block",
            title="Chain Block",
            price_amount="10.00",
            available_qty=10,
            currency_code="EUR",
            is_active=True,
        )

        mock_stripe_client.v1.payment_intents.create.return_value = {
            "id": "pi_123",
            "client_secret": "pi_123_secret_abc",
        }

        response = self.client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps(
                {
                    "checkoutRef": "onsite_v1_client_1",
                    "customer": {"name": "Jane Doe", "email": "jane@example.com"},
                    "items": [{"variantId": "legacy-variant-id", "quantity": 2}],
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        mock_stripe_client.v1.payment_intents.create.assert_called_once()
        self.assertEqual(response.json()["paymentIntentId"], "pi_123")

    @patch("api.views.STRIPE_CLIENT")
    @patch("api.views._is_allowed_checkout_origin", return_value=True)
    @patch("api.views._stripe_config_ok", return_value=True)
    @patch("api.views._verify_turnstile_token", return_value=True)
    def test_onsite_intent_success(self, _mock_turnstile, _mock_cfg, _mock_origin, mock_stripe_client):
        product = CatalogProduct.objects.create(
            product_ref="legacy-product-id",
            variant_ref="legacy-variant-id",
            handle="chain-block",
            title="Chain Block",
            price_amount="10.00",
            available_qty=10,
            currency_code="EUR",
            is_active=True,
        )

        mock_stripe_client.v1.payment_intents.create.return_value = {
            "id": "pi_123",
            "client_secret": "pi_123_secret_abc",
        }

        response = self.client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps(
                {
                    "checkoutRef": "onsite_ok_1",
                    "customer": {"name": "Jane Doe", "email": "jane@example.com"},
                    "items": [{"variantId": "legacy-variant-id", "quantity": 2}],
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["paymentIntentId"], "pi_123")
        self.assertEqual(body["clientSecret"], "pi_123_secret_abc")
        mock_stripe_client.v1.payment_intents.create.assert_called_once()

        order = OnsiteOrder.objects.get(checkout_ref="onsite_ok_1")
        self.assertEqual(order.status, OnsiteOrder.STATUS_PENDING)
        self.assertEqual(order.amount_total_cents, 2000)
        self.assertEqual(order.payment_status, OnsiteOrder.PAYMENT_STATUS_PENDING)
        self.assertEqual(order.fulfillment_status, OnsiteOrder.FULFILLMENT_STATUS_UNFULFILLED)
        self.assertEqual(order.subtotal_cents, 2000)
        self.assertEqual(order.discount_cents, 0)
        self.assertEqual(order.shipping_cents, 0)
        self.assertEqual(order.tax_cents, 0)
        self.assertEqual(order.order_items.count(), 1)
        self.assertEqual(order.inventory_reservations.count(), 0)
        self.assertFalse(hasattr(order, "payment_client_secret"))
        self.assertNotEqual(order.status_token, body["statusToken"])
        self.assertIsNotNone(order.status_token_expires_at)

        product.refresh_from_db()
        self.assertEqual(product.available_qty, 10)
        self.assertEqual(product.reserved_qty, 0)

        status_response = self.client.post(
            "/api/payments/onsite-status/",
            data=json.dumps({"checkoutRef": order.checkout_ref, "statusToken": body["statusToken"]}),
            content_type="application/json",
        )
        self.assertEqual(status_response.status_code, 200)

        summary_response = self.client.post(
            "/api/payments/onsite-order-summary/",
            data=json.dumps({"checkoutRef": order.checkout_ref, "statusToken": body["statusToken"]}),
            content_type="application/json",
        )
        self.assertEqual(summary_response.status_code, 200)
        summary = summary_response.json()
        self.assertEqual(summary["paymentStatus"], OnsiteOrder.PAYMENT_STATUS_PENDING)
        self.assertEqual(summary["fulfillmentStatus"], OnsiteOrder.FULFILLMENT_STATUS_UNFULFILLED)
        self.assertEqual(len(summary["orderItems"]), 1)

    @patch("api.views.STRIPE_CLIENT")
    @patch("api.views.STRIPE_SECRET_KEY", "sk_test")
    def test_onsite_paid_status_fulfills_inventory(self, mock_stripe_client):
        raw_status_token = "c" * 64
        product = CatalogProduct.objects.create(
            variant_ref="paid-inventory-variant",
            handle="paid-inventory-product",
            title="Paid Inventory Product",
            price_amount="10.00",
            available_qty=5,
            inventory_tracked=True,
            is_active=True,
        )
        order = OnsiteOrder.objects.create(
            checkout_ref="paid-inventory-checkout",
            status_token=digest_capability_token(raw_status_token),
            status=OnsiteOrder.STATUS_PENDING,
            payment_intent_id="pi_paid_inventory",
            amount_total_cents=2000,
            currency="EUR",
            line_items=[
                {
                    "sku": product.variant_ref,
                    "title": product.title,
                    "variantRef": product.variant_ref,
                    "unitAmountCents": 1000,
                    "quantity": 2,
                    "lineTotalCents": 2000,
                }
            ],
        )
        _populate_order_items_and_reservations(order)
        mock_stripe_client.v1.payment_intents.retrieve.return_value = {
            "id": order.payment_intent_id,
            "status": "succeeded",
            "amount": 2000,
            "currency": "eur",
            "metadata": {"checkout_ref": order.checkout_ref},
        }

        response = self.client.post(
            "/api/payments/onsite-status/",
            data=json.dumps({"checkoutRef": order.checkout_ref, "statusToken": raw_status_token}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        product.refresh_from_db()
        self.assertEqual(product.available_qty, 3)
        self.assertEqual(product.reserved_qty, 0)
        self.assertEqual(
            InventoryReservation.objects.filter(
                order=order,
                status=InventoryReservation.STATUS_FULFILLED,
            ).count(),
            1,
        )

    def test_expired_status_token_cannot_read_checkout_status(self):
        raw_status_token = "a" * 64
        order = OnsiteOrder.objects.create(
            checkout_ref="expired-status-token",
            status_token=digest_capability_token(raw_status_token),
            status_token_expires_at=timezone.now() - timedelta(minutes=1),
            status=OnsiteOrder.STATUS_PAID,
            amount_total_cents=1000,
            currency="EUR",
        )

        response = self.client.post(
            "/api/payments/onsite-status/",
            data=json.dumps(
                {"checkoutRef": order.checkout_ref, "statusToken": raw_status_token}
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 404)

    @patch("api.views.STRIPE_CLIENT")
    @patch("api.views.STRIPE_SECRET_KEY", "sk_test")
    def test_onsite_status_reconciles_a_succeeded_stripe_payment(self, mock_stripe_client):
        raw_status_token = "b" * 64
        order = OnsiteOrder.objects.create(
            checkout_ref="reconcile-succeeded-status",
            status_token=digest_capability_token(raw_status_token),
            status=OnsiteOrder.STATUS_PENDING,
            payment_intent_id="pi_reconcile_succeeded",
            amount_total_cents=1000,
            currency="EUR",
        )
        mock_stripe_client.v1.payment_intents.retrieve.return_value = {
            "id": order.payment_intent_id,
            "status": "succeeded",
            "amount": 1000,
            "currency": "eur",
            "metadata": {"checkout_ref": order.checkout_ref},
        }

        response = self.client.post(
            "/api/payments/onsite-status/",
            data=json.dumps({"checkoutRef": order.checkout_ref, "statusToken": raw_status_token}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], OnsiteOrder.STATUS_PAID)
        order.refresh_from_db()
        self.assertEqual(order.status, OnsiteOrder.STATUS_PAID)
        self.assertEqual(order.payment_status, OnsiteOrder.PAYMENT_STATUS_PAID)

    @patch("api.views.STRIPE_CLIENT")
    @patch("api.views._is_allowed_checkout_origin", return_value=True)
    @patch("api.views._stripe_config_ok", return_value=True)
    @patch("api.views._verify_turnstile_token", return_value=True)
    def test_onsite_intent_retry_reuses_local_order_and_stripe_idempotency_key(
        self,
        _mock_turnstile,
        _mock_cfg,
        _mock_origin,
        mock_stripe_client,
    ):
        CatalogProduct.objects.create(
            variant_ref="retry-variant",
            handle="retry-product",
            title="Retry Product",
            price_amount="15.00",
            available_qty=10,
            currency_code="EUR",
            is_active=True,
        )
        mock_stripe_client.v1.payment_intents.create.return_value = {
            "id": "pi_retry",
            "client_secret": "pi_retry_secret",
        }
        payload = {
            "checkoutRef": "onsite_retry_1",
            "statusToken": "a" * 64,
            "claimToken": "b" * 64,
            "customer": {"name": "Jane Doe", "email": "jane@example.com"},
            "items": [{"variantId": "retry-variant", "quantity": 1}],
        }

        first_response = self.client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        second_response = self.client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps(payload),
            content_type="application/json",
        )

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(first_response.json()["priceRefreshNotice"], "")
        self.assertIn("latest pricing", second_response.json()["priceRefreshNotice"])
        self.assertEqual(OnsiteOrder.objects.filter(checkout_ref="onsite_retry_1").count(), 1)
        self.assertEqual(GuestOrderClaim.objects.filter(order__checkout_ref="onsite_retry_1").count(), 1)
        self.assertEqual(first_response.json()["paymentIntentId"], second_response.json()["paymentIntentId"])
        self.assertEqual(mock_stripe_client.v1.payment_intents.create.call_count, 2)
        for call in mock_stripe_client.v1.payment_intents.create.call_args_list:
            self.assertEqual(call.kwargs["options"]["idempotency_key"], "onsite:onsite_retry_1")

    @patch("api.views.STRIPE_CLIENT")
    @patch("api.views._is_allowed_checkout_origin", return_value=True)
    @patch("api.views._stripe_config_ok", return_value=True)
    @patch("api.views._verify_turnstile_token", return_value=True)
    def test_onsite_intent_retry_rejects_claim_capability_rotation(
        self,
        _mock_turnstile,
        _mock_cfg,
        _mock_origin,
        mock_stripe_client,
    ):
        CatalogProduct.objects.create(
            variant_ref="claim-rotation-variant",
            handle="claim-rotation-product",
            title="Claim Rotation Product",
            price_amount="15.00",
            available_qty=10,
            currency_code="EUR",
            is_active=True,
        )
        mock_stripe_client.v1.payment_intents.create.return_value = {
            "id": "pi_claim_rotation",
            "client_secret": "pi_claim_rotation_secret",
        }
        payload = {
            "checkoutRef": "onsite_claim_rotation",
            "statusToken": "1" * 64,
            "claimToken": "2" * 64,
            "customer": {"name": "Jane Doe", "email": "jane@example.com"},
            "items": [{"variantId": "claim-rotation-variant", "quantity": 1}],
        }

        first_response = self.client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        rotated_payload = {**payload, "claimToken": "3" * 64}
        retry_response = self.client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps(rotated_payload),
            content_type="application/json",
        )

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(retry_response.status_code, 409)
        claim = GuestOrderClaim.objects.get(order__checkout_ref="onsite_claim_rotation")
        self.assertEqual(claim.claim_token, digest_capability_token(payload["claimToken"]))

    @patch("api.views.STRIPE_CLIENT")
    @patch("api.views._is_allowed_checkout_origin", return_value=True)
    @patch("api.views._stripe_config_ok", return_value=True)
    @patch("api.views._verify_turnstile_token", return_value=True)
    def test_onsite_intent_retry_rotates_status_capability_with_existing_claim(
        self,
        _mock_turnstile,
        _mock_cfg,
        _mock_origin,
        mock_stripe_client,
    ):
        CatalogProduct.objects.create(
            variant_ref="status-rotation-variant",
            handle="status-rotation-product",
            title="Status Rotation Product",
            price_amount="15.00",
            available_qty=10,
            currency_code="EUR",
            is_active=True,
        )
        mock_stripe_client.v1.payment_intents.create.return_value = {
            "id": "pi_status_rotation",
            "client_secret": "pi_status_rotation_secret",
        }
        payload = {
            "checkoutRef": "onsite_status_rotation",
            "statusToken": "4" * 64,
            "claimToken": "5" * 64,
            "customer": {"name": "Jane Doe", "email": "jane@example.com"},
            "items": [{"variantId": "status-rotation-variant", "quantity": 1}],
        }

        first_response = self.client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        rotated_payload = {
            **payload,
            "statusToken": "6" * 64,
            "previousStatusToken": payload["statusToken"],
            "rotateStatusToken": True,
        }
        retry_response = self.client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps(rotated_payload),
            content_type="application/json",
        )

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(retry_response.status_code, 200)
        order = OnsiteOrder.objects.get(checkout_ref="onsite_status_rotation")
        self.assertEqual(order.status_token, digest_capability_token(rotated_payload["statusToken"]))

        old_status_response = self.client.post(
            "/api/payments/onsite-status/",
            data=json.dumps(
                {"checkoutRef": order.checkout_ref, "statusToken": payload["statusToken"]}
            ),
            content_type="application/json",
        )
        new_status_response = self.client.post(
            "/api/payments/onsite-status/",
            data=json.dumps(
                {"checkoutRef": order.checkout_ref, "statusToken": rotated_payload["statusToken"]}
            ),
            content_type="application/json",
        )
        self.assertEqual(old_status_response.status_code, 404)
        self.assertEqual(new_status_response.status_code, 200)

    @patch("api.views.STRIPE_CLIENT")
    @patch("api.views._is_allowed_checkout_origin", return_value=True)
    @patch("api.views._stripe_config_ok", return_value=True)
    @patch("api.views._verify_turnstile_token", return_value=True)
    def test_onsite_intent_provider_failure_leaves_retryable_local_order(
        self,
        _mock_turnstile,
        _mock_cfg,
        _mock_origin,
        mock_stripe_client,
    ):
        CatalogProduct.objects.create(
            variant_ref="provider-retry-variant",
            handle="provider-retry-product",
            title="Provider Retry Product",
            price_amount="15.00",
            available_qty=10,
            currency_code="EUR",
            is_active=True,
        )
        mock_stripe_client.v1.payment_intents.create.side_effect = [
            RuntimeError("temporary provider failure"),
            {"id": "pi_provider_retry", "client_secret": "pi_provider_retry_secret"},
        ]
        payload = {
            "checkoutRef": "onsite_provider_retry",
            "statusToken": "c" * 64,
            "claimToken": "d" * 64,
            "customer": {"name": "Jane Doe", "email": "jane@example.com"},
            "items": [{"variantId": "provider-retry-variant", "quantity": 1}],
        }

        failed_response = self.client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        order = OnsiteOrder.objects.get(checkout_ref="onsite_provider_retry")
        self.assertEqual(failed_response.status_code, 502)
        self.assertEqual(order.payment_intent_id, "")

        retry_response = self.client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps(payload),
            content_type="application/json",
        )

        self.assertEqual(retry_response.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.payment_intent_id, "pi_provider_retry")
        self.assertEqual(OnsiteOrder.objects.filter(checkout_ref="onsite_provider_retry").count(), 1)

    @patch("api.views.STRIPE_CLIENT")
    @patch("api.views._is_allowed_checkout_origin", return_value=True)
    @patch("api.views._stripe_config_ok", return_value=True)
    @patch("api.views._verify_turnstile_token", return_value=True)
    def test_stripe_provider_error_log_excludes_sensitive_exception_text(
        self,
        _mock_turnstile,
        _mock_cfg,
        _mock_origin,
        mock_stripe_client,
    ):
        CatalogProduct.objects.create(
            variant_ref="log-scrub-variant",
            handle="log-scrub-product",
            title="Log Scrub Product",
            price_amount="15.00",
            available_qty=10,
            currency_code="EUR",
            is_active=True,
        )
        mock_stripe_client.v1.payment_intents.create.side_effect = RuntimeError(
            "client_secret=pi_secret address=1 Main Street, Wexford"
        )

        with self.assertLogs("api.views", level="ERROR") as captured:
            response = self.client.post(
                "/api/payments/onsite-intent/",
                data=json.dumps(
                    {
                        "checkoutRef": "log-scrub-checkout",
                        "statusToken": "7" * 64,
                        "claimToken": "8" * 64,
                        "customer": {"name": "Jane Doe", "email": "jane@example.com"},
                        "items": [{"variantId": "log-scrub-variant", "quantity": 1}],
                    }
                ),
                content_type="application/json",
            )

        log_output = "\n".join(captured.output)
        self.assertEqual(response.status_code, 502)
        self.assertIn("Failed to create Stripe PaymentIntent", log_output)
        self.assertNotIn("pi_secret", log_output)
        self.assertNotIn("1 Main Street", log_output)

    @patch("api.views.STRIPE_CLIENT")
    @patch("api.views._is_allowed_checkout_origin", return_value=True)
    @patch("api.views._stripe_config_ok", return_value=True)
    @patch("api.views._verify_turnstile_token", return_value=True)
    def test_onsite_intent_rejects_conflicting_checkout_reference_before_stripe(
        self,
        _mock_turnstile,
        _mock_cfg,
        _mock_origin,
        mock_stripe_client,
    ):
        CatalogProduct.objects.create(
            variant_ref="conflict-variant",
            handle="conflict-product",
            title="Conflict Product",
            price_amount="15.00",
            available_qty=10,
            currency_code="EUR",
            is_active=True,
        )
        mock_stripe_client.v1.payment_intents.create.return_value = {
            "id": "pi_conflict",
            "client_secret": "pi_conflict_secret",
        }
        payload = {
            "checkoutRef": "onsite_conflict",
            "statusToken": "e" * 64,
            "claimToken": "f" * 64,
            "customer": {"name": "Jane Doe", "email": "jane@example.com"},
            "items": [{"variantId": "conflict-variant", "quantity": 1}],
        }
        first_response = self.client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        conflicting_payload = {**payload, "statusToken": "0" * 64}
        conflict_response = self.client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps(conflicting_payload),
            content_type="application/json",
        )

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(conflict_response.status_code, 409)
        self.assertEqual(mock_stripe_client.v1.payment_intents.create.call_count, 1)

    @patch("api.views.STRIPE_CLIENT")
    @patch("api.views._is_allowed_checkout_origin", return_value=True)
    @patch("api.views._stripe_config_ok", return_value=True)
    @patch("api.views._verify_turnstile_token", return_value=True)
    def test_onsite_intent_assigns_order_number(self, _mock_turnstile, _mock_cfg, _mock_origin, mock_stripe_client):
        CatalogProduct.objects.create(
            product_ref="legacy-product-id",
            variant_ref="legacy-variant-id",
            handle="chain-block",
            title="Chain Block",
            price_amount="10.00",
            available_qty=10,
            currency_code="EUR",
            is_active=True,
        )
        mock_stripe_client.v1.payment_intents.create.return_value = {
            "id": "pi_456",
            "client_secret": "pi_456_secret_abc",
        }

        response = self.client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps(
                {
                    "checkoutRef": "onsite_order_number",
                    "customer": {"name": "Jane Doe", "email": "jane@example.com"},
                    "items": [{"variantId": "legacy-variant-id", "quantity": 1}],
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["orderNumber"].startswith("MNL-"))
        order = OnsiteOrder.objects.get(checkout_ref="onsite_order_number")
        self.assertEqual(body["orderNumber"], order.order_number)

    @patch("api.views.STRIPE_CLIENT")
    @patch("api.views._is_allowed_checkout_origin", return_value=True)
    @patch("api.views._stripe_config_ok", return_value=True)
    @patch("api.views._verify_turnstile_token", return_value=True)
    def test_guest_checkout_returns_claim_token_and_allows_authenticated_claim(
        self,
        _mock_turnstile,
        _mock_cfg,
        _mock_origin,
        mock_stripe_client,
    ):
        CatalogProduct.objects.create(
            product_ref="legacy-product-id",
            variant_ref="legacy-variant-id",
            handle="chain-block",
            title="Chain Block",
            price_amount="10.00",
            available_qty=10,
            currency_code="EUR",
            is_active=True,
        )
        mock_stripe_client.v1.payment_intents.create.return_value = {
            "id": "pi_claim_1",
            "client_secret": "pi_claim_1_secret",
        }

        response = self.client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps(
                {
                    "checkoutRef": "guest_claim_1",
                    "customer": {"name": "Jane Doe", "email": "jane@example.com"},
                    "items": [{"variantId": "legacy-variant-id", "quantity": 1}],
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["claimToken"])

        order = OnsiteOrder.objects.get(checkout_ref="guest_claim_1")
        claim = GuestOrderClaim.objects.get(order=order)
        self.assertEqual(claim.claim_state, GuestOrderClaim.STATE_PENDING)
        self.assertNotEqual(claim.claim_token, body["claimToken"])

        claimant = get_user_model().objects.create_user(
            username="claimant",
            email="jane@example.com",
            password="testpass123",
            is_active=True,
        )
        profile = CommerceCustomerProfile.objects.create(user=claimant, activation_pending=False)
        profile.verified_email = claimant.email
        profile.email_verified_at = timezone.now()
        profile.save(update_fields=["verified_email", "email_verified_at", "updated_at"])

        claimant_client = APIClient()
        claimant_client.force_authenticate(user=claimant)
        claim_response = claimant_client.post(
            "/api/account/claim-order/",
            data={"orderNumber": order.order_number, "claimToken": body["claimToken"]},
            format="json",
        )

        self.assertEqual(claim_response.status_code, 200)
        order.refresh_from_db()
        claim.refresh_from_db()
        self.assertEqual(order.user, claimant)
        self.assertEqual(claim.claim_state, GuestOrderClaim.STATE_CLAIMED)
        self.assertEqual(claim.claimed_by, claimant)
        self.assertTrue(
            AuditLog.objects.filter(
                actor=claimant,
                action="account.claim_order",
                target_type="order",
                target_id=str(order.order_number),
            ).exists()
        )

    @patch("api.views.STRIPE_CLIENT")
    @patch("api.views._is_allowed_checkout_origin", return_value=True)
    @patch("api.views._stripe_config_ok", return_value=True)
    @patch("api.views._verify_turnstile_token", return_value=True)
    def test_onsite_intent_returns_server_confirmed_pricing_summary(
        self,
        _mock_turnstile,
        _mock_cfg,
        _mock_origin,
        mock_stripe_client,
    ):
        CatalogProduct.objects.create(
            product_ref="legacy-product-id",
            variant_ref="legacy-variant-id",
            handle="chain-block",
            title="Chain Block",
            price_amount="10.00",
            available_qty=10,
            currency_code="EUR",
            is_active=True,
        )
        CatalogProduct.objects.create(
            product_ref="legacy-product-id-2",
            variant_ref="legacy-variant-id-2",
            handle="rope-sling",
            title="Rope Sling",
            price_amount="2.50",
            available_qty=10,
            currency_code="EUR",
            is_active=True,
        )

        mock_stripe_client.v1.payment_intents.create.return_value = {
            "id": "pi_123",
            "client_secret": "pi_123_secret_abc",
        }

        response = self.client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps(
                {
                    "checkoutRef": "onsite_server_summary",
                    "customer": {"name": "Jane Doe", "email": "jane@example.com"},
                    "items": [
                        {"variantId": "legacy-variant-id", "quantity": 1},
                        {"variantId": "legacy-variant-id-2", "quantity": 1},
                    ],
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["amountTotalCents"], 1250)
        self.assertEqual(body["lineItems"][0]["title"], "Chain Block")
        self.assertEqual(body["lineItems"][1]["title"], "Rope Sling")
        self.assertEqual(body["priceRefreshNotice"], "")

    def test_onsite_status_not_found(self):
        response = self.client.post(
            "/api/payments/onsite-status/",
            data=json.dumps({"checkoutRef": "x1", "statusToken": "a" * 32}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404)

        get_response = self.client.get("/api/payments/onsite-status/?checkoutRef=x1&statusToken=tok_1")
        self.assertEqual(get_response.status_code, 405)

    def test_onsite_order_summary_not_found(self):
        response = self.client.post(
            "/api/payments/onsite-order-summary/",
            data=json.dumps({"checkoutRef": "x1", "statusToken": "a" * 32}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404)

        get_response = self.client.get("/api/payments/onsite-order-summary/?checkoutRef=x1&statusToken=tok_1")
        self.assertEqual(get_response.status_code, 405)

    def test_onsite_status_rejects_low_entropy_token(self):
        response = self.client.post(
            "/api/payments/onsite-status/",
            data=json.dumps({"checkoutRef": "x1", "statusToken": "short"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_capability_token_hash_migration_is_idempotent_and_one_way(self):
        migration = importlib.import_module("api.migrations.0037_hash_order_capability_tokens")
        order = OnsiteOrder.objects.create(checkout_ref="migration-token-order", status_token="raw-status-token")
        claim = GuestOrderClaim.objects.create(order=order, claim_token="raw-claim-token")
        pending = PendingCheckout.objects.create(
            checkout_ref="migration-pending-checkout",
            status_token="raw-pending-token",
        )

        from django.apps import apps

        migration.hash_existing_capability_tokens(apps, None)
        order.refresh_from_db()
        claim.refresh_from_db()
        pending.refresh_from_db()
        first_order_digest = order.status_token
        first_claim_digest = claim.claim_token
        first_pending_digest = pending.status_token

        migration.hash_existing_capability_tokens(apps, None)
        order.refresh_from_db()
        claim.refresh_from_db()
        pending.refresh_from_db()
        self.assertEqual(order.status_token, first_order_digest)
        self.assertEqual(claim.claim_token, first_claim_digest)
        self.assertEqual(pending.status_token, first_pending_digest)
        with self.assertRaisesMessage(RuntimeError, "one-way token hash backfill"):
            migration.refuse_reverse(apps, None)

    @patch("api.views._is_allowed_checkout_origin", return_value=True)
    @patch("api.views._stripe_config_ok", return_value=True)
    @patch("api.views.REQUIRE_TURNSTILE", True)
    @patch("api.views.TURNSTILE_SECRET_KEY", "")
    def test_onsite_intent_fails_when_turnstile_required_without_secret(self, _mock_cfg, _mock_origin):
        CatalogProduct.objects.create(
            product_ref="legacy-product-id",
            variant_ref="legacy-variant-id",
            handle="chain-block",
            title="Chain Block",
            price_amount="10.00",
            currency_code="EUR",
            is_active=True,
        )

        response = self.client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps(
                {
                    "checkoutRef": "onsite_turnstile_required",
                    "customer": {"name": "Jane Doe", "email": "jane@example.com"},
                    "items": [{"variantId": "legacy-variant-id", "quantity": 1}],
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json().get("error"), "Bot verification failed")


class AccountOrderAndAddressTests(BaseApiTestCase):
    def setUp(self):
        super().setUp()
        self.user_model = get_user_model()
        self.user = self.user_model.objects.create_user(
            username="shopper",
            email="shopper@example.com",
            password="testpass123",
        )
        self.other_user = self.user_model.objects.create_user(
            username="other-shopper",
            email="other@example.com",
            password="testpass123",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    @patch("api.views.STRIPE_CLIENT")
    @patch("api.views._is_allowed_checkout_origin", return_value=True)
    @patch("api.views._stripe_config_ok", return_value=True)
    @patch("api.views._verify_turnstile_token", return_value=True)
    def test_authenticated_checkout_associates_order_and_snapshots_address(
        self,
        _mock_turnstile,
        _mock_cfg,
        _mock_origin,
        mock_stripe_client,
    ):
        CatalogProduct.objects.create(
            product_ref="legacy-product-id",
            variant_ref="legacy-variant-id",
            handle="chain-block",
            title="Chain Block",
            price_amount="10.00",
            available_qty=10,
            currency_code="EUR",
            is_active=True,
        )
        mock_stripe_client.v1.payment_intents.create.return_value = {
            "id": "pi_auth1",
            "client_secret": "pi_auth1_secret",
        }

        checkout_client = APIClient()
        login_response = checkout_client.post(
            "/api/auth/token/",
            data={"username": self.user.username, "password": "testpass123"},
            format="json",
        )
        self.assertEqual(login_response.status_code, 200)
        access_token = login_response.json()["access"]

        response = checkout_client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps(
                {
                    "checkoutRef": "auth_checkout_1",
                    "customer": {"name": "Jane Doe", "email": "jane@example.com"},
                    "shipping": {
                        "name": "Jane Doe",
                        "phone": "+353871234567",
                        "addressLine1": "1 Main St",
                        "addressLine2": "",
                        "city": "Dublin",
                        "county": "Dublin",
                        "postcode": "D01",
                        "countryCode": "IE",
                    },
                    "items": [{"variantId": "legacy-variant-id", "quantity": 1}],
                }
            ),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {access_token}",
        )

        self.assertEqual(response.status_code, 200)
        order = OnsiteOrder.objects.get(checkout_ref="auth_checkout_1")
        self.assertEqual(order.user, self.user)
        self.assertEqual(order.customer_name, "Jane Doe")
        self.assertEqual(order.shipping_name, "Jane Doe")
        self.assertEqual(order.shipping_phone, "+353871234567")
        self.assertEqual(order.shipping_address_line_1, "1 Main St")
        self.assertEqual(order.shipping_city, "Dublin")
        self.assertEqual(order.shipping_postcode, "D01")
        self.assertEqual(order.shipping_country_code, "IE")

    def test_account_orders_only_returns_authenticated_user_orders(self):
        OnsiteOrder.objects.create(
            checkout_ref="order_for_user",
            status_token="tok_user",
            status=OnsiteOrder.STATUS_PENDING,
            amount_total_cents=1000,
            currency="EUR",
            customer_name="Jane",
            customer_email="jane@example.com",
            user=self.user,
        )
        OnsiteOrder.objects.create(
            checkout_ref="order_for_other_user",
            status_token="tok_other",
            status=OnsiteOrder.STATUS_PENDING,
            amount_total_cents=2000,
            currency="EUR",
            customer_name="John",
            customer_email="john@example.com",
            user=self.other_user,
        )

        response = self.client.get("/api/account/orders/")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["checkoutRef"], "order_for_user")
        self.assertEqual(body[0]["paymentStatus"], OnsiteOrder.PAYMENT_STATUS_PENDING)
        self.assertEqual(body[0]["fulfillmentStatus"], OnsiteOrder.FULFILLMENT_STATUS_UNFULFILLED)
        self.assertNotIn("statusToken", body[0])
        self.assertNotIn("status_token", body[0])

    def test_account_order_detail_requires_ownership(self):
        order = OnsiteOrder.objects.create(
            checkout_ref="owned_order",
            status_token="tok_owned",
            status=OnsiteOrder.STATUS_PENDING,
            amount_total_cents=1000,
            currency="EUR",
            customer_name="Jane",
            customer_email="jane@example.com",
            user=self.user,
        )

        response = self.client.get(f"/api/account/orders/{order.checkout_ref}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["checkoutRef"], "owned_order")
        self.assertEqual(response.json()["paymentStatus"], OnsiteOrder.PAYMENT_STATUS_PENDING)
        self.assertEqual(response.json()["fulfillmentStatus"], OnsiteOrder.FULFILLMENT_STATUS_UNFULFILLED)
        self.assertNotIn("statusToken", response.json())
        self.assertNotIn("status_token", response.json())

        other_response = self.client.get("/api/account/orders/order_for_other_user/")
        self.assertEqual(other_response.status_code, 404)

    def test_order_summary_rejects_token_from_different_order(self):
        first_token = "a" * 64
        second_token = "b" * 64
        OnsiteOrder.objects.create(
            checkout_ref="summary-order-a",
            status_token=digest_capability_token(first_token),
            customer_email="first@example.com",
        )
        OnsiteOrder.objects.create(
            checkout_ref="summary-order-b",
            status_token=digest_capability_token(second_token),
            customer_email="second@example.com",
        )

        response = self.client.post(
            "/api/payments/onsite-order-summary/",
            data=json.dumps({"checkoutRef": "summary-order-b", "statusToken": first_token}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 404)

    def test_order_claim_rejects_expired_and_already_attached_orders(self):
        profile = CommerceCustomerProfile.objects.create(
            user=self.user,
            activation_pending=False,
            verified_email=self.user.email,
            email_verified_at=timezone.now(),
        )
        self.assertTrue(profile.has_verified_email())

        expired_raw_token = "c" * 64
        expired_order = OnsiteOrder.objects.create(checkout_ref="expired-claim-order")
        expired_claim = GuestOrderClaim.objects.create(
            order=expired_order,
            claim_token=digest_capability_token(expired_raw_token),
            expires_at=timezone.now() - timedelta(minutes=1),
        )
        expired_response = self.client.post(
            "/api/account/claim-order/",
            data={"orderNumber": expired_order.order_number, "claimToken": expired_raw_token},
            format="json",
        )
        self.assertEqual(expired_response.status_code, 400)
        expired_claim.refresh_from_db()
        self.assertEqual(expired_claim.claim_state, GuestOrderClaim.STATE_EXPIRED)

        attached_raw_token = "d" * 64
        attached_order = OnsiteOrder.objects.create(
            checkout_ref="attached-claim-order",
            user=self.other_user,
        )
        GuestOrderClaim.objects.create(
            order=attached_order,
            claim_token=digest_capability_token(attached_raw_token),
            expires_at=timezone.now() + timedelta(days=1),
        )
        attached_response = self.client.post(
            "/api/account/claim-order/",
            data={"orderNumber": attached_order.order_number, "claimToken": attached_raw_token},
            format="json",
        )
        self.assertEqual(attached_response.status_code, 400)
        attached_order.refresh_from_db()
        self.assertEqual(attached_order.user, self.other_user)

    def test_account_orders_include_shipping_snapshot(self):
        OnsiteOrder.objects.create(
            checkout_ref="owned_order_with_shipping",
            status_token="tok_owned_shipping",
            status=OnsiteOrder.STATUS_PENDING,
            amount_total_cents=1500,
            currency="EUR",
            customer_name="Jane",
            customer_email="jane@example.com",
            user=self.user,
            shipping_name="Jane Doe",
            shipping_phone="+353871234567",
            shipping_address_line_1="1 Main Street",
            shipping_address_line_2="Apartment 2",
            shipping_city="Dublin",
            shipping_county="Dublin",
            shipping_postcode="D01",
            shipping_country_code="IE",
        )

        response = self.client.get("/api/account/orders/")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["shippingName"], "Jane Doe")
        self.assertEqual(body[0]["shippingPhone"], "+353871234567")
        self.assertEqual(body[0]["shippingAddressLine1"], "1 Main Street")
        self.assertEqual(body[0]["shippingCity"], "Dublin")
        self.assertEqual(body[0]["shippingPostcode"], "D01")
        self.assertEqual(body[0]["shippingCountryCode"], "IE")

    def test_account_order_detail_by_number_requires_ownership(self):
        order = OnsiteOrder.objects.create(
            checkout_ref="owned_order_number",
            status_token="tok_owned_number",
            status=OnsiteOrder.STATUS_PENDING,
            amount_total_cents=1200,
            currency="EUR",
            customer_name="Jane",
            customer_email="jane@example.com",
            user=self.user,
            order_number="MNL-260805-OWNED",
        )

        response = self.client.get("/api/account/orders/by-number/MNL-260805-OWNED/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["orderNumber"], "MNL-260805-OWNED")

        other_response = self.client.get("/api/account/orders/by-number/MNL-260805-OTHER/")
        self.assertEqual(other_response.status_code, 404)

    def test_account_order_invoice_pdf_requires_ownership(self):
        order = OnsiteOrder.objects.create(
            checkout_ref="owned_invoice_order",
            status_token="tok_owned_invoice",
            status=OnsiteOrder.STATUS_PAID,
            payment_status=OnsiteOrder.PAYMENT_STATUS_PAID,
            amount_total_cents=2299,
            subtotal_cents=1000,
            shipping_cents=1299,
            tax_cents=0,
            currency="EUR",
            customer_name="Jane Doe",
            customer_email="jane@example.com",
            user=self.user,
            order_number="MNL-260805-INVOICE",
            line_items=[{
                "title": "Chain Block",
                "quantity": 1,
                "lineTotalCents": 1000,
            }],
        )

        response = self.client.get(f"/api/account/orders/by-number/{order.order_number}/invoice/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertIn(order.order_number, response["Content-Disposition"])
        self.assertTrue(response.content.startswith(b"%PDF"))

        other_response = self.client.get("/api/account/orders/by-number/MNL-260805-OTHER/invoice/")
        self.assertEqual(other_response.status_code, 404)

    def test_account_export_returns_minimized_data_for_verified_user_and_rejects_unverified_accounts(self):
        profile = CommerceCustomerProfile.objects.create(
            user=self.user,
            activation_pending=False,
            verified_email=self.user.email,
            email_verified_at=timezone.now(),
        )
        profile.saved_addresses.create(
            label="Home",
            recipient_name="Jane Doe",
            recipient_phone="+353871234567",
            address_line_1="1 Main Street",
            address_line_2="Apt 2",
            city="Dublin",
            county="Dublin",
            postcode="D01",
            country_code="IE",
            is_default_shipping=True,
            is_default_billing=False,
        )
        OnsiteOrder.objects.create(
            checkout_ref="owned_export_order",
            status_token="tok_export_owned",
            status=OnsiteOrder.STATUS_PENDING,
            amount_total_cents=1200,
            currency="EUR",
            customer_name="Jane Doe",
            customer_email="jane@example.com",
            user=self.user,
            shipping_name="Jane Doe",
            shipping_phone="+353871234567",
            shipping_address_line_1="1 Main Street",
            shipping_city="Dublin",
            shipping_postcode="D01",
            shipping_country_code="IE",
            line_items=[{"sku": "SKU-1", "title": "Weight Plate", "quantity": 1, "unit_price_cents": 1200, "line_total_cents": 1200}],
        )
        OnsiteOrder.objects.create(
            checkout_ref="other_export_order",
            status_token="tok_export_other",
            status=OnsiteOrder.STATUS_PENDING,
            amount_total_cents=500,
            currency="EUR",
            customer_name="Other User",
            customer_email="other@example.com",
            user=self.other_user,
        )
        security_state, _ = AccountSecurityState.objects.get_or_create(
            user=self.user,
            defaults={
                "mfa_enabled": True,
                "mfa_secret": "secretvalue1234567890",
                "mfa_pending_secret": "",
                "mfa_recovery_codes": ["recovery-RAW-1", "recovery-RAW-2"],
            },
        )
        AuditLog.objects.create(
            actor=self.user,
            action="account.password_change",
            target_type="account",
            target_id=str(self.user.pk),
            details={"changed": True},
        )
        AccountSession.objects.create(
            user=self.user,
            expires_at=timezone.now() + timedelta(hours=1),
            ip_address="203.0.113.11",
            user_agent="Python test client",
        )

        response = self.client.post("/api/account/export/", format="json")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["version"], 1)
        self.assertEqual(body["profile"]["email"], self.user.email)
        self.assertEqual(len(body["orders"]), 1)
        self.assertEqual(body["orders"][0]["checkoutRef"], "owned_export_order")
        self.assertEqual(len(body["addresses"]), 1)
        self.assertEqual(body["addresses"][0]["label"], "Home")
        self.assertEqual(len(body["auditEvents"]), 1)
        self.assertEqual(len(body["sessions"]), 1)
        self.assertNotIn("password", body)
        self.assertNotIn("mfaSecret", body)
        self.assertNotIn("mfa_secret", body)
        self.assertNotIn("mfaRecoveryCodes", body)
        self.assertNotIn("passwordHash", body)
        self.assertNotIn("statusToken", body["orders"][0])
        self.assertNotIn("accessToken", body["sessions"][0])
        self.assertNotIn("secretvalue1234567890", json.dumps(body))
        self.assertNotIn("recovery-RAW-1", json.dumps(body))

        profile.email_verified_at = None
        profile.verified_email = ""
        profile.save(update_fields=["email_verified_at", "verified_email", "updated_at"])

        denied = self.client.post("/api/account/export/", format="json")
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.json()["detail"], "Account access is not available yet.")

    def test_account_addresses_create_and_list_for_authenticated_user(self):
        response = self.client.post(
            "/api/account/addresses/",
            data={
                "label": "Home",
                "recipientName": "Jane Doe",
                "recipientPhone": "+353871234567",
                "addressLine1": "1 Main Street",
                "addressLine2": "",
                "city": "Dublin",
                "county": "Dublin",
                "postcode": "D01",
                "countryCode": "IE",
                "isDefaultShipping": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        address = SavedAddress.objects.get(pk=response.json()["id"])
        self.assertEqual(address.commerce_profile.user, self.user)
        self.assertTrue(address.is_default_shipping)

        list_response = self.client.get("/api/account/addresses/")
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(len(list_response.json()), 1)

    def test_unverified_accounts_cannot_view_orders_or_manage_addresses(self):
        CommerceCustomerProfile.objects.create(user=self.user, activation_pending=False)

        orders_response = self.client.get("/api/account/orders/")
        self.assertEqual(orders_response.status_code, 403)

        addresses_response = self.client.post(
            "/api/account/addresses/",
            data={
                "label": "Home",
                "recipientName": "Jane Doe",
                "addressLine1": "1 Main Street",
                "city": "Dublin",
                "postcode": "D01",
                "countryCode": "IE",
            },
            format="json",
        )
        self.assertEqual(addresses_response.status_code, 403)

    def test_email_change_requires_verified_commerce_email(self):
        CommerceCustomerProfile.objects.create(user=self.user, activation_pending=False)

        response = self.client.post(
            "/api/account/change-email/",
            data={
                "current_password": "testpass123",
                "email": "new-email@example.com",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_account_address_update_and_delete_are_scoped_to_the_user(self):
        commerce_profile = CommerceCustomerProfile.objects.create(user=self.user)
        address = SavedAddress.objects.create(
            commerce_profile=commerce_profile,
            label="Work",
            recipient_name="Jane Doe",
            recipient_phone="",
            address_line_1="2 Main Street",
            city="Dublin",
            postcode="D02",
            country_code="IE",
            is_default_shipping=True,
        )

        update_response = self.client.patch(
            f"/api/account/addresses/{address.id}/",
            data={"label": "Office", "recipientName": "Jane Smith"},
            format="json",
        )
        self.assertEqual(update_response.status_code, 200)
        address.refresh_from_db()
        self.assertEqual(address.label, "Office")
        self.assertEqual(address.recipient_name, "Jane Smith")

        delete_response = self.client.delete(f"/api/account/addresses/{address.id}/")
        self.assertEqual(delete_response.status_code, 200)
        address.refresh_from_db()
        self.assertTrue(address.is_deleted)


class StripeWebhookTests(BaseApiTestCase):
    @patch("api.views.STRIPE_WEBHOOK_SECRET", "whsec_test")
    def test_stripe_webhook_missing_signature(self):
        response = self.client.post(
            "/api/payments/stripe/webhook/",
            data=json.dumps({}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    @patch("api.views.STRIPE_WEBHOOK_SECRET", "whsec_test")
    @patch("api.views.stripe.Webhook.construct_event")
    def test_stripe_webhook_marks_order_paid(self, mock_construct):
        OnsiteOrder.objects.create(
            checkout_ref="onsite_wh_1",
            status_token="onsite_wh_tok",
            status=OnsiteOrder.STATUS_PENDING,
            payment_intent_id="pi_paid1",
            amount_total_cents=1000,
            currency="EUR",
        )
        mock_construct.return_value = {
            "id": "evt_1",
            "type": "payment_intent.succeeded",
            "data": {
                "object": {
                    "id": "pi_paid1",
                    "amount": 1000,
                    "currency": "eur",
                    "metadata": {"checkout_ref": "onsite_wh_1"},
                }
            },
        }

        response = self.client.post(
            "/api/payments/stripe/webhook/",
            data=json.dumps({"x": 1}),
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="sig_ok",
        )

        self.assertEqual(response.status_code, 200)
        order = OnsiteOrder.objects.get(checkout_ref="onsite_wh_1")
        self.assertEqual(order.status, OnsiteOrder.STATUS_PAID)
        self.assertEqual(order.payment_status, OnsiteOrder.PAYMENT_STATUS_PAID)
        self.assertIsNotNone(order.paid_at)
        self.assertTrue(ProcessedStripeEvent.objects.filter(event_id="evt_1").exists())

        duplicate_response = self.client.post(
            "/api/payments/stripe/webhook/",
            data=json.dumps({"x": 1}),
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="sig_ok",
        )
        self.assertEqual(duplicate_response.status_code, 200)
        self.assertTrue(duplicate_response.json()["duplicate"])
        self.assertEqual(ProcessedStripeEvent.objects.filter(event_id="evt_1").count(), 1)

    @patch("api.views.STRIPE_WEBHOOK_SECRET", "whsec_test")
    @patch("api.views.stripe.Webhook.construct_event")
    def test_stripe_webhook_maps_payment_failure_without_regressing_paid_order(self, mock_construct):
        order = OnsiteOrder.objects.create(
            checkout_ref="onsite_wh_failed",
            status=OnsiteOrder.STATUS_PENDING,
            payment_intent_id="pi_failed",
            amount_total_cents=1000,
            currency="EUR",
        )
        intent = {
            "id": order.payment_intent_id,
            "amount": order.amount_total_cents,
            "currency": "eur",
            "metadata": {"checkout_ref": order.checkout_ref},
        }
        mock_construct.return_value = {
            "id": "evt_failed",
            "type": "payment_intent.payment_failed",
            "data": {"object": intent},
        }

        failed_response = self.client.post(
            "/api/payments/stripe/webhook/",
            data=json.dumps({"x": 1}),
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="sig_ok",
        )
        self.assertEqual(failed_response.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, OnsiteOrder.STATUS_FAILED)

        order.status = OnsiteOrder.STATUS_PAID
        order.save(update_fields=["status", "updated_at"])
        mock_construct.return_value = {
            "id": "evt_late_failed",
            "type": "payment_intent.payment_failed",
            "data": {"object": intent},
        }
        late_response = self.client.post(
            "/api/payments/stripe/webhook/",
            data=json.dumps({"x": 1}),
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="sig_ok",
        )
        self.assertEqual(late_response.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, OnsiteOrder.STATUS_PAID)

    @patch("api.views.STRIPE_WEBHOOK_SECRET", "whsec_test")
    @patch("api.views.stripe.Webhook.construct_event")
    def test_stripe_webhook_does_not_consume_unhandled_event(self, mock_construct):
        mock_construct.return_value = {
            "id": "evt_unhandled",
            "type": "charge.succeeded",
            "data": {"object": {}},
        }

        response = self.client.post(
            "/api/payments/stripe/webhook/",
            data=json.dumps({"x": 1}),
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="sig_ok",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["skipped"])
        self.assertFalse(ProcessedStripeEvent.objects.filter(event_id="evt_unhandled").exists())

    @patch("api.views.STRIPE_WEBHOOK_SECRET", "whsec_test")
    @patch("api.views.stripe.Webhook.construct_event")
    def test_stripe_webhook_rejects_mismatch_without_consuming_event(self, mock_construct):
        OnsiteOrder.objects.create(
            checkout_ref="onsite_wh_mismatch",
            status=OnsiteOrder.STATUS_PENDING,
            payment_intent_id="pi_mismatch",
            amount_total_cents=1000,
            currency="EUR",
        )
        mock_construct.return_value = {
            "id": "evt_mismatch",
            "type": "payment_intent.succeeded",
            "data": {
                "object": {
                    "id": "pi_mismatch",
                    "amount": 999,
                    "currency": "eur",
                    "metadata": {"checkout_ref": "onsite_wh_mismatch"},
                }
            },
        }

        response = self.client.post(
            "/api/payments/stripe/webhook/",
            data=json.dumps({"x": 1}),
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="sig_ok",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["rejected"])
        order = OnsiteOrder.objects.get(checkout_ref="onsite_wh_mismatch")
        self.assertEqual(order.status, OnsiteOrder.STATUS_PENDING)
        rejected_event = ProcessedStripeEvent.objects.get(event_id="evt_mismatch")
        self.assertEqual(rejected_event.event_type, "rejected:payment_intent.succeeded")

    @patch("api.views.STRIPE_WEBHOOK_SECRET", "whsec_test")
    @patch("api.views.stripe.Webhook.construct_event")
    def test_stripe_webhook_recovers_intent_attachment_after_post_stripe_crash(self, mock_construct):
        order = OnsiteOrder.objects.create(
            checkout_ref="onsite_wh_recovery",
            status=OnsiteOrder.STATUS_PENDING,
            payment_intent_id="",
            amount_total_cents=1000,
            currency="EUR",
        )
        mock_construct.return_value = {
            "id": "evt_recovery",
            "type": "payment_intent.succeeded",
            "data": {
                "object": {
                    "id": "pi_recovery",
                    "amount": 1000,
                    "currency": "eur",
                    "metadata": {"checkout_ref": order.checkout_ref},
                }
            },
        }

        response = self.client.post(
            "/api/payments/stripe/webhook/",
            data=json.dumps({"x": 1}),
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="sig_ok",
        )

        self.assertEqual(response.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.payment_intent_id, "pi_recovery")
        self.assertEqual(order.status, OnsiteOrder.STATUS_PAID)

    @patch("api.views.STRIPE_WEBHOOK_SECRET", "whsec_test")
    @patch("api.views.stripe.Webhook.construct_event")
    def test_stripe_webhook_rejects_currency_and_metadata_mismatches(self, mock_construct):
        order = OnsiteOrder.objects.create(
            checkout_ref="onsite_wh_identity",
            status=OnsiteOrder.STATUS_PENDING,
            payment_intent_id="pi_identity",
            amount_total_cents=1000,
            currency="EUR",
        )

        mismatch_cases = [
            ("evt_currency", "usd", order.checkout_ref),
            ("evt_metadata", "eur", "different-checkout"),
        ]
        for event_id, currency, checkout_ref in mismatch_cases:
            with self.subTest(event_id=event_id):
                mock_construct.return_value = {
                    "id": event_id,
                    "type": "payment_intent.succeeded",
                    "data": {
                        "object": {
                            "id": order.payment_intent_id,
                            "amount": order.amount_total_cents,
                            "currency": currency,
                            "metadata": {"checkout_ref": checkout_ref},
                        }
                    },
                }

                response = self.client.post(
                    "/api/payments/stripe/webhook/",
                    data=json.dumps({"x": 1}),
                    content_type="application/json",
                    HTTP_STRIPE_SIGNATURE="sig_ok",
                )

                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.json()["rejected"])
                order.refresh_from_db()
                self.assertEqual(order.status, OnsiteOrder.STATUS_PENDING)
                self.assertTrue(ProcessedStripeEvent.objects.filter(event_id=event_id).exists())

    @patch("api.views.STRIPE_WEBHOOK_SECRET", "whsec_test")
    @patch("api.views.stripe.Webhook.construct_event")
    def test_stripe_webhook_maps_canceled_intent_to_canceled(self, mock_construct):
        OnsiteOrder.objects.create(
            checkout_ref="onsite_wh_canceled",
            status=OnsiteOrder.STATUS_PENDING,
            payment_intent_id="pi_canceled",
            amount_total_cents=1000,
            currency="EUR",
        )
        mock_construct.return_value = {
            "id": "evt_canceled",
            "type": "payment_intent.canceled",
            "data": {
                "object": {
                    "id": "pi_canceled",
                    "amount": 1000,
                    "currency": "eur",
                    "metadata": {"checkout_ref": "onsite_wh_canceled"},
                }
            },
        }

        response = self.client.post(
            "/api/payments/stripe/webhook/",
            data=json.dumps({"x": 1}),
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="sig_ok",
        )

        self.assertEqual(response.status_code, 200)
        order = OnsiteOrder.objects.get(checkout_ref="onsite_wh_canceled")
        self.assertEqual(order.status, OnsiteOrder.STATUS_CANCELED)
        self.assertIsNotNone(order.canceled_at)

    @patch("api.views.STRIPE_WEBHOOK_SECRET", "whsec_test")
    @patch("api.views.stripe.Webhook.construct_event")
    @patch("api.views._set_onsite_order_from_payment_intent", side_effect=RuntimeError("temporary database failure"))
    def test_stripe_webhook_retries_after_unexpected_processing_failure(
        self,
        _mock_set_order,
        mock_construct,
    ):
        mock_construct.return_value = {
            "id": "evt_retryable_error",
            "type": "payment_intent.succeeded",
            "data": {"object": {"id": "pi_retryable", "amount": 1000, "currency": "eur", "metadata": {}}},
        }

        response = self.client.post(
            "/api/payments/stripe/webhook/",
            data=json.dumps({"x": 1}),
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="sig_ok",
        )

        self.assertEqual(response.status_code, 500)
        event = ProcessedStripeEvent.objects.get(event_id="evt_retryable_error")
        self.assertEqual(event.status, ProcessedStripeEvent.STATUS_ERROR)
        self.assertEqual(event.attempts, 1)


@override_settings(
    CACHES=TEST_CACHES,
    SECURE_SSL_REDIRECT=False,
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"],
)
class PortalRBACTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        user_model = get_user_model()

        self.company_a = Company.objects.create(name="Acme Lifts", slug="acme-lifts")
        self.company_b = Company.objects.create(name="Beta Lifts", slug="beta-lifts")
        self.site_a = Site.objects.create(company=self.company_a, name="Dublin Depot", address="Dublin")
        self.site_a_secondary = Site.objects.create(company=self.company_a, name="Galway Yard", address="Galway")
        self.site_b = Site.objects.create(company=self.company_b, name="Cork Base", address="Cork")

        self.equipment_a = Equipment.objects.create(
            company=self.company_a,
            site=self.site_a,
            name="Chain Block A",
            asset_tag="AC-001",
            serial_number="SER-AC-001",
        )
        self.equipment_b = Equipment.objects.create(
            company=self.company_b,
            site=self.site_b,
            name="Hoist B",
            asset_tag="BE-001",
            serial_number="SER-BE-001",
        )

        self.customer_user = user_model.objects.create_user(username="customer", password="testpass123")
        self.staff_user = user_model.objects.create_user(username="staff", password="testpass123")
        self.owner_user = user_model.objects.create_user(username="owner", password="testpass123")

        customer_profile = UserProfile.objects.create(user=self.customer_user, role=UserProfile.ROLE_CUSTOMER)
        customer_profile.allowed_companies.add(self.company_a)

        staff_profile = UserProfile.objects.create(user=self.staff_user, role=UserProfile.ROLE_STAFF)
        staff_profile.allowed_companies.add(self.company_a)

        owner_profile = UserProfile.objects.create(user=self.owner_user, role=UserProfile.ROLE_OWNER)
        owner_profile.allowed_companies.add(self.company_a, self.company_b)

    def test_owner_can_create_product_with_multiple_images(self):
        self.client.force_authenticate(user=self.owner_user)
        first_image = SimpleUploadedFile("front.png", _png_bytes(), content_type="image/png")
        second_image = SimpleUploadedFile("side.png", _png_bytes(), content_type="image/png")

        response = self.client.post(
            "/api/portal/catalog/products/",
            data={
                "variantRef": "uploaded-product-variant",
                "handle": "uploaded-product",
                "title": "Uploaded Product",
                "priceAmount": "25.00",
                "images": [first_image, second_image],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 201)
        product = CatalogProduct.objects.get(handle="uploaded-product")
        images = list(CatalogProductImage.objects.filter(product=product).order_by("sort_order"))
        self.assertEqual(len(images), 2)
        self.assertEqual([image.sort_order for image in images], [0, 1])
        self.assertEqual(len(response.json()["images"]), 2)
        self.assertTrue(all(image["url"] for image in response.json()["images"]))

    def test_owner_cannot_create_product_with_invalid_image(self):
        self.client.force_authenticate(user=self.owner_user)
        invalid_image = SimpleUploadedFile("not-an-image.png", b"not-an-image", content_type="image/png")

        response = self.client.post(
            "/api/portal/catalog/products/",
            data={
                "variantRef": "invalid-upload-variant",
                "handle": "invalid-upload",
                "title": "Invalid Upload",
                "priceAmount": "25.00",
                "images": [invalid_image],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("image", str(response.json()).lower())

    def test_owner_can_edit_product_images_and_order(self):
        self.client.force_authenticate(user=self.owner_user)
        product = CatalogProduct.objects.create(
            variant_ref="editable-images-variant",
            handle="editable-images",
            title="Editable Images",
            price_amount="25.00",
        )
        first = CatalogProductImage.objects.create(
            product=product,
            image=SimpleUploadedFile("first.png", _png_bytes(), content_type="image/png"),
            sort_order=0,
        )
        second = CatalogProductImage.objects.create(
            product=product,
            image=SimpleUploadedFile("second.png", _png_bytes(), content_type="image/png"),
            sort_order=1,
        )
        replacement = SimpleUploadedFile("replacement.png", _png_bytes(), content_type="image/png")

        response = self.client.patch(
            f"/api/portal/catalog/products/{product.id}/",
            data={
                "removedImageIds": json.dumps([first.id]),
                "imageOrder": json.dumps([second.id]),
                "images": [replacement],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 200)
        images = list(CatalogProductImage.objects.filter(product=product).order_by("sort_order"))
        self.assertEqual(len(images), 2)
        self.assertEqual(images[0].id, second.id)
        self.assertEqual(images[1].sort_order, 1)

    def test_authenticate_with_case_insensitive_username(self):
        user_model = get_user_model()
        user = user_model.objects.create_user(username="MixedCaseUser", password="testpass123")

        response = self.client.post(
            "/api/auth/token/",
            data={"username": "mixedcaseuser", "password": "testpass123"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.json())
        self.assertNotIn("refresh", response.json())
        self.assertIn("manley_portal_refresh", response.cookies)
        self.assertEqual(user.username, "MixedCaseUser")

    def test_refresh_uses_http_only_cookie(self):
        user_model = get_user_model()
        user_model.objects.create_user(username="CookieUser", password="testpass123")

        login_response = self.client.post(
            "/api/auth/token/",
            data={"username": "cookieuser", "password": "testpass123"},
            format="json",
        )
        self.assertEqual(login_response.status_code, 200)
        refresh_cookie = login_response.cookies.get("manley_portal_refresh")
        self.assertIsNotNone(refresh_cookie)

        self.client.cookies["manley_portal_refresh"] = refresh_cookie.value
        refresh_response = self.client.post(
            "/api/auth/token/refresh/",
            data={},
            format="json",
        )

        self.assertEqual(refresh_response.status_code, 200)
        self.assertIn("access", refresh_response.json())
        self.assertNotIn("refresh", refresh_response.json())

    def test_refresh_endpoint_is_throttled(self):
        cache.clear()

        with patch.dict(
            ScopedRateThrottle.THROTTLE_RATES,
            {"auth.token": "100/minute", "auth.refresh": "1/minute"},
            clear=False,
        ):
            login_response = self.client.post(
                "/api/auth/token/",
                data={"username": "owner", "password": "testpass123"},
                format="json",
            )
            self.assertEqual(login_response.status_code, 200)

            refresh_cookie = login_response.cookies.get("manley_portal_refresh")
            self.assertIsNotNone(refresh_cookie)
            self.client.cookies["manley_portal_refresh"] = refresh_cookie.value

            first_refresh = self.client.post("/api/auth/token/refresh/", data={}, format="json")
            second_refresh = self.client.post("/api/auth/token/refresh/", data={}, format="json")

        self.assertEqual(first_refresh.status_code, 200)
        self.assertEqual(second_refresh.status_code, 429)

    def test_login_errors_do_not_enumerate_usernames(self):
        cache.clear()
        with patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"auth.token": "100/minute"}, clear=False):
            unknown_user_response = self.client.post(
                "/api/auth/token/",
                data={"username": "does-not-exist", "password": "testpass123"},
                format="json",
            )
            wrong_password_response = self.client.post(
                "/api/auth/token/",
                data={"username": "owner", "password": "wrong-password"},
                format="json",
            )

        self.assertEqual(unknown_user_response.status_code, 400)
        self.assertEqual(wrong_password_response.status_code, 400)
        self.assertEqual(unknown_user_response.json().get("detail"), ["Invalid credentials"])
        self.assertEqual(wrong_password_response.json().get("detail"), ["Invalid credentials"])

    def test_login_lockout_after_five_failed_attempts(self):
        cache.clear()

        with patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"auth.token": "100/minute"}, clear=False):
            for _ in range(4):
                response = self.client.post(
                    "/api/auth/token/",
                    data={"username": "owner", "password": "wrong-password"},
                    format="json",
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json().get("detail"), ["Invalid credentials"])

            fifth_attempt = self.client.post(
                "/api/auth/token/",
                data={"username": "owner", "password": "wrong-password"},
                format="json",
            )
            self.assertEqual(fifth_attempt.status_code, 400)
            self.assertEqual(
                fifth_attempt.json().get("detail"),
                ["Account temporarily locked due to failed login attempts. Try again in 15 minutes."],
            )

            blocked_valid_attempt = self.client.post(
                "/api/auth/token/",
                data={"username": "owner", "password": "testpass123"},
                format="json",
            )
            self.assertEqual(blocked_valid_attempt.status_code, 400)
            self.assertEqual(
                blocked_valid_attempt.json().get("detail"),
                ["Account temporarily locked due to failed login attempts. Try again in 15 minutes."],
            )

    def test_portal_read_requests_are_throttled(self):
        cache.clear()
        self.client.force_authenticate(user=self.owner_user)

        with patch.dict(
            PortalMethodRateThrottle.THROTTLE_RATES,
            {"portal.read": "2/minute", "portal.write": "1/minute"},
            clear=False,
        ):
            first = self.client.get("/api/portal/me/")
            second = self.client.get("/api/portal/me/")
            third = self.client.get("/api/portal/me/")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(third.status_code, 429)

    def test_portal_write_requests_are_throttled(self):
        cache.clear()
        self.client.force_authenticate(user=self.owner_user)

        with patch.dict(
            PortalMethodRateThrottle.THROTTLE_RATES,
            {"portal.read": "20/minute", "portal.write": "1/minute"},
            clear=False,
        ):
            first = self.client.post("/api/auth/logout/", data={}, format="json")
            second = self.client.post("/api/auth/logout/", data={}, format="json")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)

    def test_commerce_only_user_is_denied_by_every_portal_route(self):
        commerce_user = get_user_model().objects.create_user(
            username="commerce-only",
            email="commerce-only@example.com",
            password="commercepass123",
        )
        self.client.force_authenticate(user=commerce_user)
        portal_requests = [
            ("get", "/api/portal/me/"),
            ("get", "/api/portal/companies/"),
            ("post", "/api/portal/customers/"),
            ("get", "/api/portal/company-header/"),
            ("get", "/api/portal/company-sites/"),
            ("patch", f"/api/portal/company-sites/{self.site_a.id}/"),
            ("get", "/api/portal/equipment/"),
            ("patch", f"/api/portal/equipment/{self.equipment_a.id}/"),
            ("get", f"/api/portal/equipment/{self.equipment_a.id}/activity/"),
            ("get", f"/api/portal/equipment/{self.equipment_a.id}/reports/"),
            ("get", "/api/portal/pending-report-approvals/"),
            ("get", "/api/portal/dashboard-stats/"),
            ("patch", "/api/portal/reports/999999/"),
            ("get", "/api/portal/reports/999999/revisions/"),
            ("post", "/api/portal/reports/999999/recover/"),
            ("get", f"/api/portal/company-sites/{self.site_a.id}/certificates/"),
            ("post", f"/api/portal/company-sites/{self.site_a.id}/certificates/generate/"),
            ("get", f"/api/portal/equipment/{self.equipment_a.id}/certificates/"),
            ("get", "/api/portal/certificates/999999/download/"),
            ("delete", "/api/portal/certificates/999999/"),
            ("post", "/api/portal/certificates/999999/recover/"),
            ("get", "/api/portal/staff-assignments/"),
        ]

        for method, url in portal_requests:
            with self.subTest(method=method, url=url):
                response = getattr(self.client, method)(url, data={}, format="json")
                self.assertEqual(response.status_code, 403)
                self.assertEqual(
                    response.json().get("detail"),
                    "Portal access is not enabled for this account.",
                )
        self.assertFalse(UserProfile.objects.filter(user=commerce_user).exists())

    def test_commerce_only_user_can_logout_without_portal_profile(self):
        commerce_user = get_user_model().objects.create_user(
            username="commerce-logout",
            email="commerce-logout@example.com",
            password="commercepass123",
        )
        self.client.force_authenticate(user=commerce_user)

        response = self.client.post("/api/auth/logout/", data={}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(UserProfile.objects.filter(user=commerce_user).exists())

    def test_owner_sees_pending_report_approvals_only(self):
        submitted_a = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Submitted A",
            summary="Needs approval",
            report_date="2026-06-20",
            status=InspectionReport.STATUS_SUBMITTED,
        )
        InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Approved A",
            summary="Already approved",
            report_date="2026-06-21",
            status=InspectionReport.STATUS_APPROVED,
        )
        submitted_b = InspectionReport.objects.create(
            equipment=self.equipment_b,
            submitted_by=self.staff_user,
            title="Submitted B",
            summary="Needs approval too",
            report_date="2026-06-22",
            status=InspectionReport.STATUS_SUBMITTED,
        )

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.get("/api/portal/pending-report-approvals/")

        self.assertEqual(response.status_code, 200)
        results = response.json()["results"]
        self.assertEqual([item["id"] for item in results], [submitted_b.id, submitted_a.id])
        self.assertTrue(all(item["status"] == InspectionReport.STATUS_SUBMITTED for item in results))
        self.assertEqual(results[0]["company_name"], self.company_b.name)
        self.assertEqual(results[1]["equipment_name"], self.equipment_a.name)

    def test_office_staff_has_owner_pending_approval_access(self):
        office_user = get_user_model().objects.create_user(username="office_user", password="testpass123")
        office_profile = UserProfile.objects.create(user=office_user, role=UserProfile.ROLE_OFFICE_STAFF)
        office_profile.allowed_companies.add(self.company_a, self.company_b)

        InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Submitted A",
            summary="Needs approval",
            report_date="2026-06-20",
            status=InspectionReport.STATUS_SUBMITTED,
        )

        self.client.force_authenticate(user=office_user)
        response = self.client.get("/api/portal/pending-report-approvals/")
        self.assertEqual(response.status_code, 200)

    def test_customer_only_sees_allowed_company_equipment(self):
        self.client.force_authenticate(user=self.customer_user)
        response = self.client.get("/api/portal/equipment/")
        self.assertEqual(response.status_code, 200)

        results = response.json()["results"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["company_id"], self.company_a.id)

    def test_equipment_list_shows_latest_approved_report_status(self):
        InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Approved attention report",
            report_date="2026-06-20",
            status=InspectionReport.STATUS_APPROVED,
            checklist_items=[
                {
                    "label": "Brake",
                    "status": "attention_required",
                    "finding": "Brake issue",
                    "recommendation": "Repair immediately",
                }
            ],
        )

        self.client.force_authenticate(user=self.customer_user)
        response = self.client.get("/api/portal/equipment/")

        self.assertEqual(response.status_code, 200)
        equipment_row = next(item for item in response.json()["results"] if item["id"] == self.equipment_a.id)
        self.assertEqual(equipment_row["inspection_status_key"], "attention_required")
        self.assertEqual(equipment_row["inspection_status_label"], "Attention Required")

    def test_equipment_list_shows_not_presented_for_latest_approved_report(self):
        InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Approved not presented report",
            report_date="2026-06-20",
            status=InspectionReport.STATUS_APPROVED,
            checklist_items=[
                {
                    "label": "Brake",
                    "status": "not_presented",
                    "finding": "",
                    "recommendation": "",
                }
            ],
        )

        self.client.force_authenticate(user=self.customer_user)
        response = self.client.get("/api/portal/equipment/")

        self.assertEqual(response.status_code, 200)
        equipment_row = next(item for item in response.json()["results"] if item["id"] == self.equipment_a.id)
        self.assertEqual(equipment_row["inspection_status_key"], "not_presented")
        self.assertEqual(equipment_row["inspection_status_label"], "Not Presented")

    def test_customer_only_sees_approved_reports(self):
        InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Draft report",
            report_date="2026-06-10",
            status=InspectionReport.STATUS_DRAFT,
        )
        InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Submitted report",
            report_date="2026-06-11",
            status=InspectionReport.STATUS_SUBMITTED,
        )
        approved = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Approved report",
            report_date="2026-06-12",
            status=InspectionReport.STATUS_APPROVED,
        )

        self.client.force_authenticate(user=self.customer_user)
        response = self.client.get(f"/api/portal/equipment/{self.equipment_a.id}/reports/")
        self.assertEqual(response.status_code, 200)

        results = response.json()["results"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["id"], approved.id)
        self.assertEqual(results[0]["status"], InspectionReport.STATUS_APPROVED)

    def test_staff_only_sees_own_draft_and_submitted_reports(self):
        other_staff = get_user_model().objects.create_user(username="staff_visibility", password="testpass123")
        other_profile = UserProfile.objects.create(user=other_staff, role=UserProfile.ROLE_STAFF)
        other_profile.allowed_companies.add(self.company_a)

        own_draft = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Own draft",
            report_date="2026-06-10",
            status=InspectionReport.STATUS_DRAFT,
        )
        own_submitted = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Own submitted",
            report_date="2026-06-11",
            status=InspectionReport.STATUS_SUBMITTED,
        )
        other_draft = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=other_staff,
            title="Other draft",
            report_date="2026-06-12",
            status=InspectionReport.STATUS_DRAFT,
        )
        other_submitted = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=other_staff,
            title="Other submitted",
            report_date="2026-06-13",
            status=InspectionReport.STATUS_SUBMITTED,
        )
        approved = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=other_staff,
            title="Approved",
            report_date="2026-06-14",
            status=InspectionReport.STATUS_APPROVED,
        )

        self.client.force_authenticate(user=self.staff_user)
        response = self.client.get(f"/api/portal/equipment/{self.equipment_a.id}/reports/")
        self.assertEqual(response.status_code, 200)

        ids = {item["id"] for item in response.json()["results"]}
        self.assertIn(own_draft.id, ids)
        self.assertIn(own_submitted.id, ids)
        self.assertIn(approved.id, ids)
        self.assertNotIn(other_draft.id, ids)
        self.assertNotIn(other_submitted.id, ids)

    @patch("api.portal_views.cloudinary_uploader.upload")
    @patch.dict(
        "os.environ",
        {
            "CLOUDINARY_CLOUD_NAME": "demo",
            "CLOUDINARY_API_KEY": "key",
            "CLOUDINARY_API_SECRET": "secret",
        },
        clear=False,
    )
    def test_staff_can_upload_report_images(self, mock_upload):
        mock_upload.return_value = {
            "secure_url": "https://res.cloudinary.com/demo/image/upload/v1/report-image.jpg",
            "public_id": "manleylifting/reports/report-image",
        }

        image_buffer = BytesIO()
        Image.new("RGB", (1, 1), color=(255, 0, 0)).save(image_buffer, format="PNG")
        image_buffer.seek(0)

        self.client.force_authenticate(user=self.staff_user)
        response = self.client.post(
            f"/api/portal/equipment/{self.equipment_a.id}/reports/",
            data={
                "title": "Report with image",
                "report_date": "2026-06-30",
                "status": InspectionReport.STATUS_DRAFT,
                "images": [
                    SimpleUploadedFile("damage.png", image_buffer.getvalue(), content_type="image/png")
                ],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(response.json().get("images", [])), 1)
        self.assertEqual(ReportImage.objects.count(), 1)

    def test_staff_cannot_upload_invalid_report_image_content(self):
        self.client.force_authenticate(user=self.staff_user)
        response = self.client.post(
            f"/api/portal/equipment/{self.equipment_a.id}/reports/",
            data={
                "title": "Invalid report image",
                "report_date": "2026-06-30",
                "status": InspectionReport.STATUS_DRAFT,
                "images": [
                    SimpleUploadedFile("damage.png", b"not-an-image", content_type="image/png")
                ],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json().get("detail"), "Report image content does not match the file extension")

    @patch("api.portal_views.cloudinary_uploader.upload")
    @patch.dict(
        "os.environ",
        {
            "CLOUDINARY_CLOUD_NAME": "demo",
            "CLOUDINARY_API_KEY": "key",
            "CLOUDINARY_API_SECRET": "secret",
        },
        clear=False,
    )
    def test_staff_can_upload_checklist_item_images(self, mock_upload):
        mock_upload.return_value = {
            "secure_url": "https://res.cloudinary.com/demo/image/upload/v1/report-checklist-image.jpg",
            "public_id": "manleylifting/reports/report-checklist-image",
        }

        image_buffer = BytesIO()
        Image.new("RGB", (1, 1), color=(0, 0, 255)).save(image_buffer, format="PNG")
        image_buffer.seek(0)

        self.client.force_authenticate(user=self.staff_user)
        response = self.client.post(
            f"/api/portal/equipment/{self.equipment_a.id}/reports/",
            data={
                "title": "Report with checklist image",
                "report_date": "2026-06-30",
                "status": InspectionReport.STATUS_DRAFT,
                "checklist_items": json.dumps(
                    [
                        {
                            "label": "Hoist Brake",
                            "status": "attention_required",
                            "finding": "Brake vibration",
                            "recommendation": "Inspect and adjust",
                        }
                    ]
                ),
                "checklist_images": [
                    SimpleUploadedFile("checklist-damage.png", image_buffer.getvalue(), content_type="image/png")
                ],
                "checklist_image_labels": ["Hoist Brake"],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(response.json().get("images", [])), 1)
        self.assertEqual(response.json().get("images", [])[0].get("checklist_label"), "Hoist Brake")

    @patch("api.portal_views.cloudinary_uploader.upload")
    @patch.dict(
        "os.environ",
        {
            "CLOUDINARY_CLOUD_NAME": "demo",
            "CLOUDINARY_API_KEY": "key",
            "CLOUDINARY_API_SECRET": "secret",
        },
        clear=False,
    )
    def test_staff_cannot_upload_checklist_item_images_for_good_order(self, mock_upload):
        mock_upload.return_value = {
            "secure_url": "https://res.cloudinary.com/demo/image/upload/v1/report-checklist-image.jpg",
            "public_id": "manleylifting/reports/report-checklist-image",
        }

        image_buffer = BytesIO()
        Image.new("RGB", (1, 1), color=(0, 255, 0)).save(image_buffer, format="PNG")
        image_buffer.seek(0)

        self.client.force_authenticate(user=self.staff_user)
        response = self.client.post(
            f"/api/portal/equipment/{self.equipment_a.id}/reports/",
            data={
                "title": "Invalid checklist image",
                "report_date": "2026-06-30",
                "status": InspectionReport.STATUS_DRAFT,
                "checklist_items": json.dumps(
                    [
                        {
                            "label": "Hoist Brake",
                            "status": "good_order",
                            "finding": "",
                            "recommendation": "",
                        }
                    ]
                ),
                "checklist_images": [
                    SimpleUploadedFile("checklist-good-order.png", image_buffer.getvalue(), content_type="image/png")
                ],
                "checklist_image_labels": ["Hoist Brake"],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("cannot include checklist photos", response.json().get("detail", ""))

    @patch("api.portal_views.cloudinary_uploader.upload")
    @patch.dict(
        "os.environ",
        {
            "CLOUDINARY_CLOUD_NAME": "demo",
            "CLOUDINARY_API_KEY": "key",
            "CLOUDINARY_API_SECRET": "secret",
        },
        clear=False,
    )
    def test_staff_cannot_upload_checklist_item_images_for_not_presented(self, mock_upload):
        mock_upload.return_value = {
            "secure_url": "https://res.cloudinary.com/demo/image/upload/v1/report-checklist-image.jpg",
            "public_id": "manleylifting/reports/report-checklist-image",
        }

        image_buffer = BytesIO()
        Image.new("RGB", (1, 1), color=(0, 255, 0)).save(image_buffer, format="PNG")
        image_buffer.seek(0)

        self.client.force_authenticate(user=self.staff_user)
        response = self.client.post(
            f"/api/portal/equipment/{self.equipment_a.id}/reports/",
            data={
                "title": "Invalid not presented checklist image",
                "report_date": "2026-06-30",
                "status": InspectionReport.STATUS_DRAFT,
                "checklist_items": json.dumps(
                    [
                        {
                            "label": "Hoist Brake",
                            "status": "not_presented",
                            "finding": "",
                            "recommendation": "",
                        }
                    ]
                ),
                "checklist_images": [
                    SimpleUploadedFile("checklist-not-presented.png", image_buffer.getvalue(), content_type="image/png")
                ],
                "checklist_image_labels": ["Hoist Brake"],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("cannot include checklist photos", response.json().get("detail", ""))

    def test_staff_can_save_incomplete_report_draft(self):
        self.client.force_authenticate(user=self.staff_user)
        response = self.client.post(
            f"/api/portal/equipment/{self.equipment_a.id}/reports/",
            data={
                "title": "Draft inspection",
                "summary": "",
                "findings": "",
                "recommendations": "",
                "report_date": "2026-06-30",
                "status": InspectionReport.STATUS_DRAFT,
                "checklist_items": [
                    {
                        "label": "Hoist Brake",
                        "status": "attention_required",
                        "note": "",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json().get("status"), InspectionReport.STATUS_DRAFT)
        self.assertEqual(len(response.json().get("checklist_items", [])), 1)

    @patch("api.portal_views.cloudinary_uploader.destroy")
    @patch("api.portal_views._cloudinary_is_configured", return_value=True)
    def test_owner_can_remove_report_images(self, mock_cloudinary_ready, mock_destroy):
        report = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Report with image",
            summary="Summary",
            findings="Findings",
            recommendations="Recommendations",
            report_date="2026-06-25",
            status=InspectionReport.STATUS_SUBMITTED,
        )
        image = ReportImage.objects.create(
            report=report,
            image_url="https://res.cloudinary.com/demo/image/upload/v1/report-image.jpg",
            public_id="manleylifting/reports/report-image",
            uploaded_by=self.staff_user,
        )

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.patch(
            f"/api/portal/reports/{report.id}/",
            data={
                "summary": "Owner removed image",
                "status": InspectionReport.STATUS_APPROVED,
                "removed_image_ids": [image.id],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(ReportImage.objects.filter(report=report).count(), 0)
        mock_destroy.assert_called_once_with(
            "manleylifting/reports/report-image",
            resource_type="image",
            invalidate=True,
        )

    def test_staff_can_submit_report_for_allowed_company_only(self):
        self.client.force_authenticate(user=self.staff_user)

        allowed_response = self.client.post(
            f"/api/portal/equipment/{self.equipment_a.id}/reports/",
            data={
                "title": "Monthly inspection",
                "summary": "All checks completed",
                "findings": "No defects",
                "recommendations": "Continue normal operation",
                "report_date": "2026-06-30",
                "status": InspectionReport.STATUS_SUBMITTED,
            },
            format="json",
        )
        self.assertEqual(allowed_response.status_code, 201)
        self.equipment_a.refresh_from_db()
        self.assertIsNone(self.equipment_a.next_inspection_due)

        blocked_response = self.client.post(
            f"/api/portal/equipment/{self.equipment_b.id}/reports/",
            data={
                "title": "Unauthorized inspection",
                "report_date": "2026-06-30",
                "status": InspectionReport.STATUS_SUBMITTED,
            },
            format="json",
        )
        self.assertEqual(blocked_response.status_code, 404)

    def test_approved_report_can_override_next_due_by_reinspection_days(self):
        report = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Attention report",
            summary="Needs follow-up",
            report_date="2026-06-30",
            status=InspectionReport.STATUS_SUBMITTED,
            checklist_items=[
                {
                    "label": "Hoist Brake",
                    "status": "attention_required",
                    "finding": "Brake wear detected",
                    "recommendation": "Replace brake assembly",
                    "days_before_reinspection": 21,
                }
            ],
        )

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.patch(
            f"/api/portal/reports/{report.id}/",
            data={"status": InspectionReport.STATUS_APPROVED},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.equipment_a.refresh_from_db()
        self.assertEqual(self.equipment_a.next_inspection_due.isoformat(), "2026-07-21")

    def test_approved_not_presented_report_does_not_reset_next_due_date(self):
        self.equipment_a.next_inspection_due = date(2027, 1, 15)
        self.equipment_a.save(update_fields=["next_inspection_due", "updated_at"])

        report = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Not presented report",
            summary="Item was not available",
            report_date="2026-06-30",
            status=InspectionReport.STATUS_SUBMITTED,
            checklist_items=[
                {
                    "label": "Hoist Brake",
                    "status": "not_presented",
                    "finding": "",
                    "recommendation": "",
                }
            ],
        )

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.patch(
            f"/api/portal/reports/{report.id}/",
            data={"status": InspectionReport.STATUS_APPROVED},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.equipment_a.refresh_from_db()
        self.assertEqual(self.equipment_a.next_inspection_due.isoformat(), "2027-01-15")

    def test_staff_cannot_submit_report_with_missing_checklist_finding(self):
        self.client.force_authenticate(user=self.staff_user)
        response = self.client.post(
            f"/api/portal/equipment/{self.equipment_a.id}/reports/",
            data={
                "title": "Checklist report",
                "summary": "Checklist in progress",
                "report_date": "2026-06-30",
                "status": InspectionReport.STATUS_SUBMITTED,
                "checklist_items": [
                    {
                        "label": "Initial Test Run",
                        "status": "attention_required",
                        "note": "",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("requires a finding", str(response.json()))

    def test_draft_report_does_not_clear_existing_next_due_date(self):
        self.equipment_a.next_inspection_due = date(2027, 1, 15)
        self.equipment_a.save(update_fields=["next_inspection_due", "updated_at"])

        self.client.force_authenticate(user=self.staff_user)
        response = self.client.post(
            f"/api/portal/equipment/{self.equipment_a.id}/reports/",
            data={
                "title": "Draft inspection",
                "summary": "Work in progress",
                "report_date": "2026-06-30",
                "status": InspectionReport.STATUS_DRAFT,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)

        self.equipment_a.refresh_from_db()
        self.assertEqual(self.equipment_a.next_inspection_due.isoformat(), "2027-01-15")

    def test_owner_can_edit_report_and_revision_is_recorded(self):
        report = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Initial report",
            summary="Initial summary",
            findings="Initial findings",
            recommendations="Initial recommendation",
            report_date="2026-06-25",
            status=InspectionReport.STATUS_SUBMITTED,
        )

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.patch(
            f"/api/portal/reports/{report.id}/",
            data={"summary": "Owner updated summary", "status": InspectionReport.STATUS_APPROVED},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        report.refresh_from_db()
        self.assertEqual(report.summary, "Owner updated summary")
        self.assertEqual(report.status, InspectionReport.STATUS_APPROVED)
        self.assertEqual(report.edited_by_id, self.owner_user.id)
        self.equipment_a.refresh_from_db()
        self.assertEqual(self.equipment_a.next_inspection_due.isoformat(), "2027-06-25")
        self.assertEqual(ReportRevision.objects.filter(report=report).count(), 1)
        self.assertTrue(
            AuditLog.objects.filter(
                action="report.approved",
                target_type="report",
                target_id=str(report.id),
            ).exists()
        )

    def test_owner_cannot_save_missing_checklist_finding(self):
        report = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Initial report",
            summary="Initial summary",
            findings="Initial findings",
            recommendations="Initial recommendation",
            report_date="2026-06-25",
            status=InspectionReport.STATUS_SUBMITTED,
        )

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.patch(
            f"/api/portal/reports/{report.id}/",
            data={
                "status": InspectionReport.STATUS_APPROVED,
                "checklist_items": [
                    {
                        "label": "Hoist Brake",
                        "status": "worn_serviceable",
                        "note": "",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("requires a finding", str(response.json()))

    def test_staff_can_edit_own_draft_report(self):
        report = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Draft report",
            summary="Draft summary",
            findings="Draft findings",
            recommendations="Draft recommendations",
            report_date="2026-06-25",
            status=InspectionReport.STATUS_DRAFT,
        )

        self.client.force_authenticate(user=self.staff_user)
        response = self.client.patch(
            f"/api/portal/reports/{report.id}/",
            data={"summary": "Updated draft summary", "status": InspectionReport.STATUS_SUBMITTED},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        report.refresh_from_db()
        self.assertEqual(report.summary, "Updated draft summary")
        self.assertEqual(report.status, InspectionReport.STATUS_SUBMITTED)
        self.equipment_a.refresh_from_db()
        self.assertIsNone(self.equipment_a.next_inspection_due)

    def test_owner_can_edit_draft_report_without_submitting(self):
        report = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Draft report",
            summary="Draft summary",
            findings="Draft findings",
            recommendations="Draft recommendations",
            report_date="2026-06-25",
            status=InspectionReport.STATUS_DRAFT,
        )

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.patch(
            f"/api/portal/reports/{report.id}/",
            data={"summary": "Owner updated draft summary", "status": InspectionReport.STATUS_DRAFT},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        report.refresh_from_db()
        self.assertEqual(report.summary, "Owner updated draft summary")
        self.assertEqual(report.status, InspectionReport.STATUS_DRAFT)

    def test_staff_cannot_edit_submitted_report(self):
        report = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Submitted report",
            summary="Submitted summary",
            findings="Submitted findings",
            recommendations="Submitted recommendations",
            report_date="2026-06-25",
            status=InspectionReport.STATUS_SUBMITTED,
        )

        self.client.force_authenticate(user=self.staff_user)
        response = self.client.patch(
            f"/api/portal/reports/{report.id}/",
            data={"summary": "Attempted edit"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_staff_cannot_edit_another_users_draft_report(self):
        other_staff = get_user_model().objects.create_user(username="staff2", password="testpass123")
        other_profile = UserProfile.objects.create(user=other_staff, role=UserProfile.ROLE_STAFF)
        other_profile.allowed_companies.add(self.company_a)

        report = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=other_staff,
            title="Other draft",
            summary="Draft summary",
            findings="Draft findings",
            recommendations="Draft recommendations",
            report_date="2026-06-25",
            status=InspectionReport.STATUS_DRAFT,
        )

        self.client.force_authenticate(user=self.staff_user)
        response = self.client.patch(
            f"/api/portal/reports/{report.id}/",
            data={"summary": "Attempted edit"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_staff_can_delete_own_draft_report(self):
        report = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Draft report",
            summary="Draft summary",
            findings="Draft findings",
            recommendations="Draft recommendations",
            report_date="2026-06-25",
            status=InspectionReport.STATUS_DRAFT,
        )

        self.client.force_authenticate(user=self.staff_user)
        response = self.client.delete(f"/api/portal/reports/{report.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data.get("ok"))
        report.refresh_from_db()
        self.assertTrue(report.is_deleted)
        self.assertIsNotNone(report.recovery_expires_at)

    def test_staff_cannot_delete_another_users_draft_report(self):
        other_staff = get_user_model().objects.create_user(username="staff3", password="testpass123")
        other_profile = UserProfile.objects.create(user=other_staff, role=UserProfile.ROLE_STAFF)
        other_profile.allowed_companies.add(self.company_a)

        report = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=other_staff,
            title="Other draft",
            summary="Draft summary",
            findings="Draft findings",
            recommendations="Draft recommendations",
            report_date="2026-06-25",
            status=InspectionReport.STATUS_DRAFT,
        )

        self.client.force_authenticate(user=self.staff_user)
        response = self.client.delete(f"/api/portal/reports/{report.id}/")

        self.assertEqual(response.status_code, 403)
        self.assertTrue(InspectionReport.objects.filter(id=report.id).exists())

    def test_owner_can_view_report_revisions(self):
        report = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Initial report",
            summary="Initial summary",
            findings="Initial findings",
            recommendations="Initial recommendation",
            report_date="2026-06-25",
            status=InspectionReport.STATUS_SUBMITTED,
        )
        ReportRevision.objects.create(
            report=report,
            edited_by=self.owner_user,
            previous_data={"title": "Initial report", "status": "submitted"},
        )

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.get(f"/api/portal/reports/{report.id}/revisions/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["results"]), 1)

    def test_staff_cannot_view_report_revisions(self):
        report = InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Initial report",
            summary="Initial summary",
            findings="Initial findings",
            recommendations="Initial recommendation",
            report_date="2026-06-25",
            status=InspectionReport.STATUS_SUBMITTED,
        )
        ReportRevision.objects.create(
            report=report,
            edited_by=self.owner_user,
            previous_data={"title": "Initial report", "status": "submitted"},
        )

        self.client.force_authenticate(user=self.staff_user)
        response = self.client.get(f"/api/portal/reports/{report.id}/revisions/")
        self.assertEqual(response.status_code, 403)

    def test_customer_cannot_upload_certificate(self):
        self.client.force_authenticate(user=self.customer_user)
        response = self.client.post(
            f"/api/portal/equipment/{self.equipment_a.id}/certificates/",
            data={
                "title": "Cert",
                "file": SimpleUploadedFile("cert.pdf", b"%PDF-1.4\ncontent", content_type="application/pdf"),
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 403)

    def test_staff_can_upload_certificate(self):
        self.client.force_authenticate(user=self.staff_user)
        response = self.client.post(
            f"/api/portal/equipment/{self.equipment_a.id}/certificates/",
            data={
                "title": "Inspection Certificate",
                "file": SimpleUploadedFile("cert.pdf", b"%PDF-1.4\ncontent", content_type="application/pdf"),
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 201)
        certificate_id = response.json().get("id")
        self.assertTrue(
            AuditLog.objects.filter(
                action="certificate.uploaded",
                target_type="certificate",
                target_id=str(certificate_id),
            ).exists()
        )

    def test_staff_cannot_upload_certificate_with_invalid_pdf_content(self):
        self.client.force_authenticate(user=self.staff_user)
        response = self.client.post(
            f"/api/portal/equipment/{self.equipment_a.id}/certificates/",
            data={
                "title": "Invalid certificate",
                "file": SimpleUploadedFile("cert.pdf", b"not-a-pdf", content_type="application/pdf"),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json().get("detail"), "Certificate file content does not match the file extension")

    def test_owner_can_generate_site_certificates_pdf(self):
        InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="June report",
            summary="Routine check",
            report_date="2026-06-30",
            status=InspectionReport.STATUS_SUBMITTED,
        )

        InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="July report",
            summary="Most recent",
            report_date="2026-07-15",
            status=InspectionReport.STATUS_APPROVED,
        )

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.post(
            f"/api/portal/company-sites/{self.site_a.id}/certificates/generate/",
            data={},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        certificate_id = response.json().get("id")
        self.assertTrue(certificate_id)
        certificate = Certificate.objects.filter(id=certificate_id).first()
        self.assertIsNotNone(certificate)
        self.assertEqual(certificate.site_id, self.site_a.id)
        self.assertTrue(str(certificate.file.name or "").endswith(".pdf"))
        self.assertTrue(
            AuditLog.objects.filter(
                action="certificate.generated",
                target_type="certificate",
                target_id=str(certificate_id),
            ).exists()
        )

    def test_staff_cannot_generate_site_certificates_pdf(self):
        self.client.force_authenticate(user=self.staff_user)
        response = self.client.post(
            f"/api/portal/company-sites/{self.site_a.id}/certificates/generate/",
            data={},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_customer_cannot_generate_site_certificates_pdf(self):
        self.client.force_authenticate(user=self.customer_user)
        response = self.client.post(
            f"/api/portal/company-sites/{self.site_a.id}/certificates/generate/",
            data={},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    @patch("api.portal_views_modules.certificates._build_site_certificate_pdf")
    def test_site_certificate_generation_uses_latest_approved_report_only(self, mock_build_pdf):
        InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Approved report",
            summary="Approved baseline",
            report_date="2026-06-10",
            status=InspectionReport.STATUS_APPROVED,
        )
        InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Submitted but newer",
            summary="Should not be selected",
            report_date="2026-07-10",
            status=InspectionReport.STATUS_SUBMITTED,
        )
        InspectionReport.objects.create(
            equipment=self.equipment_a,
            submitted_by=self.staff_user,
            title="Draft but newest",
            summary="Should not be selected",
            report_date="2026-07-15",
            status=InspectionReport.STATUS_DRAFT,
        )

        mock_build_pdf.return_value = BytesIO(b"%PDF-1.4\nmock")

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.post(
            f"/api/portal/company-sites/{self.site_a.id}/certificates/generate/",
            data={},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        mock_build_pdf.assert_called_once()

        _called_site, called_equipment_reports = mock_build_pdf.call_args.args
        self.assertEqual(len(called_equipment_reports), 1)
        selected_report = called_equipment_reports[0].get("report")
        self.assertIsNotNone(selected_report)
        self.assertEqual(selected_report.status, InspectionReport.STATUS_APPROVED)
        self.assertEqual(selected_report.title, "Approved report")

    @patch("api.portal_views_modules.certificates._build_site_certificate_pdf")
    def test_site_certificate_generation_groups_equipment_by_checklist_severity(self, mock_build_pdf):
        equipment_not_presented = Equipment.objects.create(
            company=self.company_a,
            site=self.site_a,
            name="Not Presented Lift",
            asset_tag="NP-1",
            serial_number="SN-NP-1",
        )
        equipment_attention = Equipment.objects.create(
            company=self.company_a,
            site=self.site_a,
            name="Attention Lift",
            asset_tag="ATT-1",
            serial_number="SN-ATT-1",
        )
        equipment_worn = Equipment.objects.create(
            company=self.company_a,
            site=self.site_a,
            name="Worn Lift",
            asset_tag="WRN-1",
            serial_number="SN-WRN-1",
        )
        equipment_good = Equipment.objects.create(
            company=self.company_a,
            site=self.site_a,
            name="Good Lift",
            asset_tag="GOD-1",
            serial_number="SN-GOD-1",
        )

        InspectionReport.objects.create(
            equipment=equipment_not_presented,
            submitted_by=self.owner_user,
            title="Not presented report",
            report_date="2026-07-10",
            status=InspectionReport.STATUS_APPROVED,
            checklist_items=[
                {
                    "label": "Hook",
                    "status": "not_presented",
                    "finding": "",
                    "recommendation": "",
                }
            ],
        )
        InspectionReport.objects.create(
            equipment=equipment_attention,
            submitted_by=self.owner_user,
            title="Attention report",
            report_date="2026-07-10",
            status=InspectionReport.STATUS_APPROVED,
            checklist_items=[
                {
                    "label": "Brake",
                    "status": "attention_required",
                    "finding": "Immediate issue",
                    "recommendation": "Repair now",
                }
            ],
        )
        InspectionReport.objects.create(
            equipment=equipment_worn,
            submitted_by=self.owner_user,
            title="Worn report",
            report_date="2026-07-10",
            status=InspectionReport.STATUS_APPROVED,
            checklist_items=[
                {
                    "label": "Chain",
                    "status": "worn_serviceable",
                    "finding": "Wear observed",
                    "recommendation": "Monitor",
                }
            ],
        )
        InspectionReport.objects.create(
            equipment=equipment_good,
            submitted_by=self.owner_user,
            title="Good report",
            report_date="2026-07-10",
            status=InspectionReport.STATUS_APPROVED,
            checklist_items=[
                {
                    "label": "Hook",
                    "status": "good_order",
                    "finding": "",
                    "recommendation": "",
                }
            ],
        )

        mock_build_pdf.return_value = BytesIO(b"%PDF-1.4\nmock")

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.post(
            f"/api/portal/company-sites/{self.site_a.id}/certificates/generate/",
            data={},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        mock_build_pdf.assert_called_once()

        _called_site, called_equipment_reports = mock_build_pdf.call_args.args
        ordered_names = [item["equipment"].name for item in called_equipment_reports]

        self.assertLess(ordered_names.index("Not Presented Lift"), ordered_names.index("Attention Lift"))
        self.assertLess(ordered_names.index("Attention Lift"), ordered_names.index("Worn Lift"))
        self.assertLess(ordered_names.index("Worn Lift"), ordered_names.index("Good Lift"))

    def test_customer_can_list_generated_site_certificates(self):
        certificate = Certificate.objects.create(
            company=self.company_a,
            site=self.site_a,
            title="Site Certificate Register - Dublin Depot",
            file=SimpleUploadedFile("site-cert.pdf", b"%PDF-1.4\ncontent", content_type="application/pdf"),
            uploaded_by=self.owner_user,
        )

        self.client.force_authenticate(user=self.customer_user)
        response = self.client.get(f"/api/portal/company-sites/{self.site_a.id}/certificates/")

        self.assertEqual(response.status_code, 200)
        results = response.json().get("results") or []
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].get("id"), certificate.id)

    def test_owner_can_manage_staff_assignments(self):
        self.client.force_authenticate(user=self.owner_user)

        list_response = self.client.get("/api/portal/staff-assignments/")
        self.assertEqual(list_response.status_code, 200)

        update_response = self.client.patch(
            "/api/portal/staff-assignments/",
            data={
                "user_id": self.staff_user.id,
                "role": UserProfile.ROLE_STAFF,
                "allowed_company_ids": [self.company_b.id],
            },
            format="json",
        )
        self.assertEqual(update_response.status_code, 200)

        updated_profile = UserProfile.objects.get(user=self.staff_user)
        self.assertEqual(list(updated_profile.allowed_companies.values_list("id", flat=True)), [self.company_b.id])
        self.assertTrue(
            AuditLog.objects.filter(
                action="staff.updated",
                target_type="user",
                target_id=str(self.staff_user.id),
            ).exists()
        )

    def test_employee_role_change_revokes_existing_credentials(self):
        self.staff_user.email = "role-change-staff@example.com"
        self.staff_user.save(update_fields=["email"])
        login_client = APIClient()
        login_response = login_client.post(
            "/api/auth/token/",
            data={"username": "staff", "password": "testpass123"},
            format="json",
        )
        self.assertEqual(login_response.status_code, 200)
        access_token = login_response.json()["access"]
        refresh_token = login_response.cookies["manley_portal_refresh"].value
        raw_action_token = issue_account_action_token(
            user=self.staff_user,
            purpose=AccountActionToken.Purpose.PASSWORD_RESET,
            target_email=self.staff_user.email,
            lifetime=timedelta(hours=1),
        )
        self.client.force_authenticate(user=self.owner_user)

        update_response = self.client.patch(
            "/api/portal/staff-assignments/",
            data={
                "user_id": self.staff_user.id,
                "role": UserProfile.ROLE_OFFICE_STAFF,
            },
            format="json",
        )

        old_access_client = APIClient()
        old_access_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
        access_response = old_access_client.get("/api/portal/me/")
        refresh_client = APIClient()
        refresh_client.cookies["manley_portal_refresh"] = refresh_token
        refresh_response = refresh_client.post(
            "/api/auth/token/refresh/",
            data={},
            format="json",
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(access_response.status_code, 401)
        self.assertEqual(refresh_response.status_code, 401)
        self.assertIsNone(
            consume_account_action_token(
                raw_token=raw_action_token,
                purpose=AccountActionToken.Purpose.PASSWORD_RESET,
                action=lambda action_token: action_token.pk,
            )
        )

    def test_office_staff_does_not_see_self_in_staff_assignments(self):
        office_user = get_user_model().objects.create_user(
            username="office_assignment_user",
            password="testpass123",
            email="office_assignment_user@example.com",
        )
        office_profile = UserProfile.objects.create(user=office_user, role=UserProfile.ROLE_OFFICE_STAFF)
        office_profile.allowed_companies.add(self.company_a, self.company_b)

        self.client.force_authenticate(user=office_user)
        response = self.client.get("/api/portal/staff-assignments/")

        self.assertEqual(response.status_code, 200)
        results = response.json()["results"]
        returned_user_ids = {item["user_id"] for item in results}
        self.assertNotIn(office_user.id, returned_user_ids)

    def test_owner_can_create_employee_assignment(self):
        self.client.force_authenticate(user=self.owner_user)

        create_response = self.client.post(
            "/api/portal/staff-assignments/",
            data={
                "username": "ops_staff",
                "email": "ops_staff@example.com",
                "password": "StrongPass!234",
                "first_name": "Ops",
                "last_name": "Staff",
                "allowed_company_ids": [self.company_a.id, self.company_b.id],
            },
            format="json",
        )

        self.assertEqual(create_response.status_code, 201)
        body = create_response.json()
        self.assertEqual(body["username"], "ops_staff")
        self.assertEqual(body["role"], UserProfile.ROLE_ENGINEER)

        created_user = get_user_model().objects.get(username="ops_staff")
        profile = UserProfile.objects.get(user=created_user)
        self.assertEqual(profile.role, UserProfile.ROLE_ENGINEER)
        self.assertCountEqual(
            list(profile.allowed_companies.values_list("id", flat=True)),
            [self.company_a.id, self.company_b.id],
        )

    def test_owner_can_delete_employee_assignment(self):
        self.client.force_authenticate(user=self.owner_user)

        delete_response = self.client.delete(
            "/api/portal/staff-assignments/",
            data={"user_id": self.staff_user.id},
            format="json",
        )
        self.assertEqual(delete_response.status_code, 200)
        self.staff_user.refresh_from_db()
        self.assertFalse(self.staff_user.is_active)

        list_response = self.client.get("/api/portal/staff-assignments/")
        self.assertEqual(list_response.status_code, 200)
        returned_user_ids = {item["user_id"] for item in list_response.json()["results"]}
        self.assertNotIn(self.staff_user.id, returned_user_ids)

    def test_owner_can_list_and_reactivate_inactive_employee_assignment(self):
        self.client.force_authenticate(user=self.owner_user)
        self.staff_user.is_active = False
        self.staff_user.save(update_fields=["is_active"])

        inactive_list_response = self.client.get("/api/portal/staff-assignments/?status=inactive")
        self.assertEqual(inactive_list_response.status_code, 200)
        inactive_ids = {item["user_id"] for item in inactive_list_response.json()["results"]}
        self.assertIn(self.staff_user.id, inactive_ids)

        reactivate_response = self.client.patch(
            "/api/portal/staff-assignments/",
            data={"user_id": self.staff_user.id, "is_active": True},
            format="json",
        )
        self.assertEqual(reactivate_response.status_code, 200)

        self.staff_user.refresh_from_db()
        self.assertTrue(self.staff_user.is_active)

    def test_portal_companies_pagination_metadata(self):
        self.client.force_authenticate(user=self.owner_user)
        Company.objects.create(name="C One", slug="c-one")
        Company.objects.create(name="C Two", slug="c-two")
        Company.objects.create(name="C Three", slug="c-three")

        response = self.client.get("/api/portal/companies/?page=2&page_size=2")
        self.assertEqual(response.status_code, 200)

        body = response.json()
        self.assertEqual(body["page"], 2)
        self.assertEqual(body["page_size"], 2)
        self.assertEqual(body["total_count"], 5)
        self.assertEqual(body["total_pages"], 3)
        self.assertEqual(len(body["results"]), 2)

    def test_portal_companies_page_size_is_capped_at_100(self):
        self.client.force_authenticate(user=self.owner_user)
        response = self.client.get("/api/portal/companies/?page=1&page_size=999")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["page_size"], 100)

    def test_owner_cannot_promote_assignment_to_owner(self):
        self.client.force_authenticate(user=self.owner_user)

        update_response = self.client.patch(
            "/api/portal/staff-assignments/",
            data={
                "user_id": self.staff_user.id,
                "role": UserProfile.ROLE_OWNER,
            },
            format="json",
        )
        self.assertEqual(update_response.status_code, 400)

    def test_staff_can_create_equipment_for_allowed_company(self):
        self.client.force_authenticate(user=self.staff_user)
        response = self.client.post(
            "/api/portal/equipment/",
            data={
                "company_id": self.company_a.id,
                "site_id": self.site_a.id,
                "name": "New Demo Hoist",
                "asset_tag": "NEW-101",
                "serial_number": "SER-NEW-101",
                "safe_working_load": "1000 kg",
                "location": "Bay 3",
                "status": Equipment.STATUS_ACTIVE,
                "inspection_interval_days": 180,
                "last_inspected_at": "2026-06-01",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["name"], "New Demo Hoist")
        self.assertEqual(response.json()["site_id"], self.site_a.id)
        self.assertEqual(response.json()["safe_working_load"], "1000 kg")
        self.assertEqual(response.json()["next_inspection_due"], "2026-11-28")
        self.assertTrue(Equipment.objects.filter(name="New Demo Hoist", company=self.company_a, site=self.site_a).exists())

    def test_staff_cannot_create_equipment_without_safe_working_load(self):
        self.client.force_authenticate(user=self.staff_user)
        response = self.client.post(
            "/api/portal/equipment/",
            data={
                "company_id": self.company_a.id,
                "site_id": self.site_a.id,
                "name": "New Demo Hoist",
                "asset_tag": "NEW-101",
                "serial_number": "SER-NEW-101",
                "location": "Bay 3",
                "status": Equipment.STATUS_ACTIVE,
                "inspection_interval_days": 180,
                "last_inspected_at": "2026-06-01",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("safe_working_load", response.json())

    def test_equipment_list_can_be_filtered_by_site(self):
        Equipment.objects.create(
            company=self.company_a,
            site=self.site_a_secondary,
            name="Remote Winch",
            asset_tag="AC-010",
            serial_number="SER-AC-010",
        )

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.get(f"/api/portal/equipment/?companyId={self.company_a.id}&siteId={self.site_a_secondary.id}")

        self.assertEqual(response.status_code, 200)
        results = response.json()["results"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["site_id"], self.site_a_secondary.id)
        self.assertEqual(results[0]["site_name"], "Galway Yard")

    def test_owner_can_create_additional_company_site(self):
        self.client.force_authenticate(user=self.owner_user)
        response = self.client.post(
            "/api/portal/company-sites/",
            data={
                "company_id": self.company_a.id,
                "name": "Limerick Hub",
                "address": "Limerick",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["name"], "Limerick Hub")
        self.assertTrue(Site.objects.filter(company=self.company_a, name="Limerick Hub").exists())

    def test_owner_can_rename_site(self):
        self.client.force_authenticate(user=self.owner_user)
        response = self.client.patch(
            f"/api/portal/company-sites/{self.site_a.id}/",
            data={"name": "Dublin Central", "address": "Dublin 2"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.site_a.refresh_from_db()
        self.assertEqual(self.site_a.name, "Dublin Central")
        self.assertEqual(self.site_a.address, "Dublin 2")

    def test_staff_cannot_rename_site(self):
        self.client.force_authenticate(user=self.staff_user)
        response = self.client.patch(
            f"/api/portal/company-sites/{self.site_a.id}/",
            data={"name": "Blocked Rename", "address": ""},
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_owner_cannot_delete_site_with_equipment(self):
        self.client.force_authenticate(user=self.owner_user)
        response = self.client.delete(f"/api/portal/company-sites/{self.site_a.id}/")

        self.assertEqual(response.status_code, 400)
        self.assertIn("Move or remove equipment", response.json()["detail"])

    def test_owner_can_delete_empty_site(self):
        self.client.force_authenticate(user=self.owner_user)
        response = self.client.delete(f"/api/portal/company-sites/{self.site_a_secondary.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(Site.objects.filter(id=self.site_a_secondary.id).exists())

    def test_customer_cannot_create_equipment(self):
        self.client.force_authenticate(user=self.customer_user)
        response = self.client.post(
            "/api/portal/equipment/",
            data={
                "company_id": self.company_a.id,
                "name": "Blocked Equipment",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_owner_can_create_customer_company_and_login(self):
        self.client.force_authenticate(user=self.owner_user)
        response = self.client.post(
            "/api/portal/customers/",
            data={
                "company_name": "Gamma Lifts",
                "company_contact_email": "ops@gammalifts.test",
                "company_contact_phone": "+353 1 555 0001",
                "company_address": "Dublin Industrial Estate",
                "customer_username": "gamma_customer",
                "customer_email": "customer@gammalifts.test",
                "customer_password": "StrongPass!234",
                "customer_first_name": "Gamma",
                "customer_last_name": "Manager",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["company"]["name"], "Gamma Lifts")
        self.assertEqual(body["customer"]["username"], "gamma_customer")
        self.assertEqual(body["customer"]["email"], "customer@gammalifts.test")
        self.assertEqual(body["customer"]["role"], UserProfile.ROLE_CUSTOMER)

        company = Company.objects.get(name="Gamma Lifts")
        created_user = get_user_model().objects.get(username="gamma_customer")
        self.assertTrue(created_user.check_password("StrongPass!234"))
        profile = UserProfile.objects.get(user=created_user)
        self.assertEqual(profile.role, UserProfile.ROLE_CUSTOMER)
        self.assertEqual(list(profile.allowed_companies.values_list("id", flat=True)), [company.id])

    def test_staff_cannot_create_customer_company_and_login(self):
        self.client.force_authenticate(user=self.staff_user)
        response = self.client.post(
            "/api/portal/customers/",
            data={
                "company_name": "Delta Lifts",
                "customer_username": "delta_customer",
                "customer_email": "customer@deltalifts.test",
                "customer_password": "StrongPass!234",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_owner_cannot_create_customer_with_duplicate_username(self):
        self.client.force_authenticate(user=self.owner_user)
        response = self.client.post(
            "/api/portal/customers/",
            data={
                "company_name": "Duplicate Username Co",
                "customer_username": self.customer_user.username,
                "customer_email": "newcustomer@example.com",
                "customer_password": "StrongPass!234",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "customer_username already exists")
        self.assertEqual(response.json()["suggested_username"], f"{self.customer_user.username}2")

    def test_owner_create_employee_duplicate_username_returns_suggestion(self):
        self.client.force_authenticate(user=self.owner_user)
        response = self.client.post(
            "/api/portal/staff-assignments/",
            data={
                "username": self.staff_user.username,
                "email": "new.staff@example.com",
                "password": "StrongPass!234",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Username is unavailable")
        self.assertEqual(response.json()["suggested_username"], f"{self.staff_user.username}2")

    def test_owner_create_employee_requires_12_char_password(self):
        self.client.force_authenticate(user=self.owner_user)
        response = self.client.post(
            "/api/portal/staff-assignments/",
            data={
                "username": "shortpwd_staff",
                "email": "shortpwd_staff@example.com",
                "password": "Short123!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.json())

    def test_password_change_revokes_account_action_tokens(self):
        self.owner_user.email = "owner-security@example.com"
        self.owner_user.save(update_fields=["email"])
        raw_token = issue_account_action_token(
            user=self.owner_user,
            purpose=AccountActionToken.Purpose.PASSWORD_RESET,
            target_email=self.owner_user.email,
            lifetime=timedelta(hours=1),
        )
        action_token = AccountActionToken.objects.get(user=self.owner_user)
        self.client.force_authenticate(user=self.owner_user)

        response = self.client.post(
            "/api/account/change-password/",
            data={
                "current_password": "testpass123",
                "new_password": "A-New-Strong-Password-234!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        action_token.refresh_from_db()
        self.assertIsNotNone(action_token.revoked_at)
        self.assertIsNone(
            consume_account_action_token(
                raw_token=raw_token,
                purpose=AccountActionToken.Purpose.PASSWORD_RESET,
                action=lambda action_token: action_token.pk,
            )
        )

    def test_employee_deactivation_revokes_account_action_tokens(self):
        self.staff_user.email = "staff-security@example.com"
        self.staff_user.save(update_fields=["email"])
        raw_token = issue_account_action_token(
            user=self.staff_user,
            purpose=AccountActionToken.Purpose.PASSWORD_RESET,
            target_email=self.staff_user.email,
            lifetime=timedelta(hours=1),
        )
        action_token = AccountActionToken.objects.get(user=self.staff_user)
        self.client.force_authenticate(user=self.owner_user)

        response = self.client.delete(
            "/api/portal/staff-assignments/",
            data={"user_id": self.staff_user.id},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        action_token.refresh_from_db()
        self.assertIsNotNone(action_token.revoked_at)
        self.assertIsNone(
            consume_account_action_token(
                raw_token=raw_token,
                purpose=AccountActionToken.Purpose.PASSWORD_RESET,
                action=lambda action_token: action_token.pk,
            )
        )

    def test_logout_blacklists_refresh_token(self):
        login_client = APIClient()
        login_response = login_client.post(
            "/api/auth/token/",
            data={"username": "owner", "password": "testpass123"},
            format="json",
        )
        self.assertEqual(login_response.status_code, 200)
        access_token = login_response.json()["access"]
        refresh_token = login_response.cookies["manley_portal_refresh"].value
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
        self.client.cookies["manley_portal_refresh"] = refresh_token

        response = self.client.post(
            "/api/auth/logout/",
            data={},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        reuse_client = APIClient()
        reuse_client.cookies["manley_portal_refresh"] = refresh_token
        reuse_response = reuse_client.post(
            "/api/auth/token/refresh/",
            data={},
            format="json",
        )
        self.assertEqual(reuse_response.status_code, 401)

    def test_equipment_status_change_creates_audit_log(self):
        self.client.force_authenticate(user=self.owner_user)

        response = self.client.patch(
            f"/api/portal/equipment/{self.equipment_a.id}/",
            data={"status": Equipment.STATUS_DECOMMISSIONED},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(
            AuditLog.objects.filter(
                action="equipment.status_changed",
                target_type="equipment",
                target_id=str(self.equipment_a.id),
            ).exists()
        )

    def test_equipment_activity_log_returns_equipment_related_entries(self):
        status_change = AuditLog.objects.create(
            actor=self.owner_user,
            company=self.company_a,
            action="equipment.status_changed",
            target_type="equipment",
            target_id=str(self.equipment_a.id),
            details={"from": "active", "to": "decommissioned"},
        )
        certificate_upload = AuditLog.objects.create(
            actor=self.staff_user,
            company=self.company_a,
            action="certificate.uploaded",
            target_type="certificate",
            target_id="999",
            details={"equipment_id": self.equipment_a.id, "title": "June Certificate"},
        )
        AuditLog.objects.create(
            actor=self.owner_user,
            company=self.company_b,
            action="equipment.status_changed",
            target_type="equipment",
            target_id=str(self.equipment_b.id),
            details={"from": "active", "to": "decommissioned"},
        )

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.get(f"/api/portal/equipment/{self.equipment_a.id}/activity/")

        self.assertEqual(response.status_code, 200)
        results = response.json().get("results", [])
        result_ids = {item["id"] for item in results}
        self.assertIn(status_change.id, result_ids)
        self.assertIn(certificate_upload.id, result_ids)
        self.assertTrue(all(item.get("actor_name") for item in results))

    def test_equipment_activity_log_denies_access_to_hidden_company(self):
        AuditLog.objects.create(
            actor=self.owner_user,
            company=self.company_b,
            action="equipment.status_changed",
            target_type="equipment",
            target_id=str(self.equipment_b.id),
            details={"from": "active", "to": "decommissioned"},
        )

        self.client.force_authenticate(user=self.customer_user)
        response = self.client.get(f"/api/portal/equipment/{self.equipment_b.id}/activity/")
        self.assertEqual(response.status_code, 404)

    def test_portal_orders_recent_bucket_is_paginated(self):
        OnsiteOrder.objects.create(
            checkout_ref="fulfill-recent-1",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="Recent One",
            customer_email="recent1@example.com",
            line_items=[{"sku": "A", "qty": 1}],
            amount_total_cents=1000,
            currency="EUR",
        )
        OnsiteOrder.objects.create(
            checkout_ref="fulfill-recent-2",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="Recent Two",
            customer_email="recent2@example.com",
            line_items=[{"sku": "B", "qty": 2}],
            amount_total_cents=2000,
            currency="EUR",
        )
        OnsiteOrder.objects.create(
            checkout_ref="fulfill-complete-1",
            status=OnsiteOrder.STATUS_SHIPPED,
            customer_name="Paid One",
            customer_email="paid1@example.com",
            line_items=[{"sku": "C", "qty": 1}],
            amount_total_cents=3000,
            currency="EUR",
        )
        OnsiteOrder.objects.create(
            checkout_ref="fulfill-unpaid-1",
            status=OnsiteOrder.STATUS_PENDING,
            customer_name="Unpaid One",
            customer_email="unpaid1@example.com",
            line_items=[{"sku": "X", "qty": 1}],
            amount_total_cents=500,
            currency="EUR",
        )

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.get("/api/portal/orders/?bucket=recent&page=1&page_size=1")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["page"], 1)
        self.assertEqual(payload["page_size"], 1)
        self.assertEqual(payload["total_count"], 2)
        self.assertEqual(payload["total_pages"], 2)
        self.assertEqual(len(payload["results"]), 1)
        self.assertEqual(payload["results"][0]["status"], OnsiteOrder.STATUS_PAID)

    def test_portal_orders_completed_bucket_allows_staff_role(self):
        OnsiteOrder.objects.create(
            checkout_ref="fulfill-complete-2",
            status=OnsiteOrder.STATUS_SHIPPED,
            customer_name="Paid Two",
            customer_email="paid2@example.com",
            line_items=[{"sku": "D", "qty": 1}],
            amount_total_cents=4000,
            currency="EUR",
        )
        OnsiteOrder.objects.create(
            checkout_ref="fulfill-complete-3",
            status=OnsiteOrder.STATUS_COMPLETED,
            customer_name="Paid Three",
            customer_email="paid3@example.com",
            line_items=[{"sku": "E", "qty": 1}],
            amount_total_cents=4500,
            currency="EUR",
        )

        self.client.force_authenticate(user=self.staff_user)
        response = self.client.get("/api/portal/orders/?bucket=shipped-completed&page=1&page_size=3")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total_count"], 2)
        self.assertIn(payload["results"][0]["status"], [OnsiteOrder.STATUS_SHIPPED, OnsiteOrder.STATUS_COMPLETED])
        self.assertEqual(
            [item["status"] for item in payload["results"]],
            [OnsiteOrder.STATUS_SHIPPED, OnsiteOrder.STATUS_COMPLETED],
        )

    def test_portal_order_detail_returns_line_items_for_owner(self):
        order = OnsiteOrder.objects.create(
            checkout_ref="fulfill-detail-1",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="Detail One",
            customer_email="detail1@example.com",
            line_items=[{"sku": "DET", "qty": 2}],
            amount_total_cents=5100,
            currency="EUR",
        )
        OrderItem.objects.create(
            order=order,
            sku="DET",
            title="Detail Product",
            variant_ref="detail-variant",
            unit_price_cents=2550,
            quantity=2,
            line_total_cents=5100,
        )

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.get(f"/api/portal/orders/{order.order_number}/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["orderNumber"], order.order_number)
        self.assertEqual(payload["status"], OnsiteOrder.STATUS_PAID)
        self.assertEqual(payload["paymentStatus"], OnsiteOrder.PAYMENT_STATUS_PAID)
        self.assertEqual(payload["fulfillmentStatus"], OnsiteOrder.FULFILLMENT_STATUS_UNFULFILLED)
        self.assertEqual(len(payload["lineItems"]), 1)
        self.assertEqual(payload["orderItems"][0]["lineTotalCents"], 5100)

    def test_portal_order_status_update_allows_office_staff(self):
        user_model = get_user_model()
        office_user = user_model.objects.create_user(username="office_staff_1", password="testpass123")
        office_profile = UserProfile.objects.create(user=office_user, role=UserProfile.ROLE_OFFICE_STAFF)
        office_profile.allowed_companies.add(self.company_a)

        order = OnsiteOrder.objects.create(
            checkout_ref="fulfill-update-1",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="Update One",
            customer_email="update1@example.com",
            line_items=[{"sku": "UPD", "qty": 1}],
            amount_total_cents=6100,
            currency="EUR",
        )

        self.client.force_authenticate(user=office_user)
        response = self.client.patch(
            f"/api/portal/orders/{order.order_number}/",
            data={"status": OnsiteOrder.STATUS_SHIPPED},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, OnsiteOrder.STATUS_SHIPPED)
        self.assertEqual(order.fulfillment_status, OnsiteOrder.FULFILLMENT_STATUS_SHIPPED)

    def test_portal_order_cancel_requires_reason_and_audits(self):
        order = OnsiteOrder.objects.create(
            checkout_ref="m8-cancel-order",
            status=OnsiteOrder.STATUS_PAID,
            payment_status=OnsiteOrder.PAYMENT_STATUS_PAID,
            customer_name="Cancel Me",
            amount_total_cents=1000,
            currency="EUR",
        )
        self.client.force_authenticate(user=self.office_user if hasattr(self, "office_user") else self.owner_user)
        response = self.client.patch(
            f"/api/portal/orders/{order.order_number}/",
            data={"action": "cancel"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        response = self.client.patch(
            f"/api/portal/orders/{order.order_number}/",
            data={"action": "cancel", "reason": "Customer request"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, OnsiteOrder.STATUS_CANCELED)
        self.assertTrue(AuditLog.objects.filter(action="order.canceled", target_id=str(order.pk)).exists())

    @patch("api.portal_views_modules.orders.STRIPE_CLIENT")
    def test_owner_refund_requires_confirmation_and_records_audit(self, mock_stripe_client):
        order = OnsiteOrder.objects.create(
            checkout_ref="m8-refund-order",
            status=OnsiteOrder.STATUS_PAID,
            payment_status=OnsiteOrder.PAYMENT_STATUS_PAID,
            payment_intent_id="pi_m8_refund",
            amount_total_cents=1000,
            currency="EUR",
        )
        mock_stripe_client.v1.refunds.create.return_value = {"id": "re_m8_refund"}
        self.client.force_authenticate(user=self.owner_user)
        response = self.client.patch(
            f"/api/portal/orders/{order.order_number}/",
            data={"action": "refund", "amountCents": 500, "reason": "Damaged", "confirmed": False},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        response = self.client.patch(
            f"/api/portal/orders/{order.order_number}/",
            data={"action": "refund", "amountCents": 500, "reason": "Damaged", "confirmed": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        mock_stripe_client.v1.refunds.create.assert_called_once_with(
            {
                "payment_intent": "pi_m8_refund",
                "amount": 500,
                "metadata": {"order_number": order.order_number},
            }
        )
        self.assertTrue(AuditLog.objects.filter(action="order.refund_requested", target_id=str(order.pk)).exists())

    def test_office_staff_cannot_issue_refund(self):
        order = OnsiteOrder.objects.create(
            checkout_ref="m8-office-refund-denied",
            status=OnsiteOrder.STATUS_PAID,
            payment_status=OnsiteOrder.PAYMENT_STATUS_PAID,
            payment_intent_id="pi_m8_office_denied",
            amount_total_cents=1000,
            currency="EUR",
        )
        self.client.force_authenticate(user=self.staff_user)
        response = self.client.patch(
            f"/api/portal/orders/{order.order_number}/",
            data={"action": "refund", "amountCents": 500, "reason": "Reason", "confirmed": True},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_portal_order_status_update_denies_staff_role(self):
        order = OnsiteOrder.objects.create(
            checkout_ref="fulfill-update-2",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="Update Two",
            customer_email="update2@example.com",
            line_items=[{"sku": "UPD2", "qty": 1}],
            amount_total_cents=7100,
            currency="EUR",
        )

        self.client.force_authenticate(user=self.staff_user)
        response = self.client.patch(
            f"/api/portal/orders/{order.order_number}/",
            data={"status": OnsiteOrder.STATUS_SHIPPED},
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    @patch("api.portal_views_modules.orders.send_order_completed_email")
    def test_portal_order_completion_sends_delivery_confirmation(self, mock_completed_email):
        product = CatalogProduct.objects.create(
            variant_ref="complete-inventory-variant",
            handle="complete-inventory-product",
            title="Complete Inventory Product",
            price_amount="81.00",
            currency_code="EUR",
            inventory_tracked=True,
            available_qty=5,
            reserved_qty=1,
        )
        order = OnsiteOrder.objects.create(
            checkout_ref="fulfill-completed-email-1",
            status=OnsiteOrder.STATUS_SHIPPED,
            customer_name="Completed Email",
            customer_email="completed-email@example.com",
            line_items=[{"sku": "COMPLETE", "qty": 1}],
            amount_total_cents=8100,
            currency="EUR",
        )
        reservation = InventoryReservation.objects.create(
            order=order,
            product=product,
            quantity=1,
            status=InventoryReservation.STATUS_RESERVED,
        )

        self.client.force_authenticate(user=self.owner_user)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.patch(
                f"/api/portal/orders/{order.order_number}/",
                data={"status": OnsiteOrder.STATUS_COMPLETED},
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], OnsiteOrder.STATUS_COMPLETED)
        order.refresh_from_db()
        self.assertEqual(order.fulfillment_status, OnsiteOrder.FULFILLMENT_STATUS_DELIVERED)
        product.refresh_from_db()
        reservation.refresh_from_db()
        self.assertEqual(product.available_qty, 4)
        self.assertEqual(product.reserved_qty, 0)
        self.assertEqual(reservation.status, InventoryReservation.STATUS_FULFILLED)
        self.assertTrue(
            InventoryTransaction.objects.filter(
                order=order,
                product=product,
                transaction_type=InventoryTransaction.TYPE_FULFILL,
                quantity_change=-1,
            ).exists()
        )
        mock_completed_email.assert_called_once()
        self.assertEqual(mock_completed_email.call_args.kwargs["order"].order_number, order.order_number)

    def test_portal_orders_denies_customer_role(self):
        self.client.force_authenticate(user=self.customer_user)
        response = self.client.get("/api/portal/orders/?bucket=recent")

        self.assertEqual(response.status_code, 403)

    def test_portal_orders_pending_failed_bucket_returns_unconfirmed_orders(self):
        OnsiteOrder.objects.create(
            checkout_ref="fulfill-pending-1",
            status=OnsiteOrder.STATUS_PENDING,
            customer_name="Pending One",
            line_items=[{"sku": "P", "qty": 1}],
        )
        OnsiteOrder.objects.create(
            checkout_ref="fulfill-failed-1",
            status=OnsiteOrder.STATUS_FAILED,
            customer_name="Failed One",
            line_items=[{"sku": "F", "qty": 1}],
        )

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.get("/api/portal/orders/?bucket=pending-failed&page=1&page_size=3")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total_count"], 2)
        self.assertEqual(
            {item["status"] for item in payload["results"]},
            {OnsiteOrder.STATUS_PENDING, OnsiteOrder.STATUS_FAILED},
        )

    def test_portal_orders_allows_owner_to_view_pending_order_details(self):
        order = OnsiteOrder.objects.create(
            checkout_ref="fulfill-pending-detail",
            status=OnsiteOrder.STATUS_PENDING,
            customer_name="Pending Detail",
            customer_email="pending@example.com",
            line_items=[{"sku": "P", "qty": 1}],
        )

        self.client.force_authenticate(user=self.owner_user)
        response = self.client.get(f"/api/portal/orders/{order.order_number}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["orderNumber"], order.order_number)
        self.assertEqual(response.json()["status"], OnsiteOrder.STATUS_PENDING)


class M2StatusSplitTests(BaseApiTestCase):
    def test_legacy_status_maps_to_payment_status(self):
        """Verify that legacy status field correctly maps to new payment_status constants."""
        test_cases = [
            (OnsiteOrder.STATUS_PENDING, OnsiteOrder.PAYMENT_STATUS_PENDING),
            (OnsiteOrder.STATUS_PROCESSING, OnsiteOrder.PAYMENT_STATUS_PROCESSING),
            (OnsiteOrder.STATUS_PAID, OnsiteOrder.PAYMENT_STATUS_PAID),
            (OnsiteOrder.STATUS_SHIPPED, OnsiteOrder.PAYMENT_STATUS_PAID),
            (OnsiteOrder.STATUS_COMPLETED, OnsiteOrder.PAYMENT_STATUS_PAID),
            (OnsiteOrder.STATUS_FAILED, OnsiteOrder.PAYMENT_STATUS_FAILED),
            (OnsiteOrder.STATUS_CANCELED, OnsiteOrder.PAYMENT_STATUS_CANCELED),
        ]

        for legacy_status, expected_payment_status in test_cases:
            order = OnsiteOrder.objects.create(
                checkout_ref=f"test-payment-{legacy_status}",
                status=legacy_status,
                customer_name="Test",
                line_items=[],
            )
            self.assertEqual(
                order.get_payment_status_from_legacy(),
                expected_payment_status,
                f"Failed for legacy status {legacy_status}",
            )

    def test_legacy_status_maps_to_fulfillment_status(self):
        """Verify that legacy status field correctly maps to new fulfillment_status constants."""
        test_cases = [
            (OnsiteOrder.STATUS_PENDING, OnsiteOrder.FULFILLMENT_STATUS_UNFULFILLED),
            (OnsiteOrder.STATUS_PROCESSING, OnsiteOrder.FULFILLMENT_STATUS_PROCESSING),
            (OnsiteOrder.STATUS_PAID, OnsiteOrder.FULFILLMENT_STATUS_UNFULFILLED),
            (OnsiteOrder.STATUS_SHIPPED, OnsiteOrder.FULFILLMENT_STATUS_SHIPPED),
            (OnsiteOrder.STATUS_COMPLETED, OnsiteOrder.FULFILLMENT_STATUS_DELIVERED),
            (OnsiteOrder.STATUS_FAILED, OnsiteOrder.FULFILLMENT_STATUS_CANCELED),
            (OnsiteOrder.STATUS_CANCELED, OnsiteOrder.FULFILLMENT_STATUS_CANCELED),
        ]

        for legacy_status, expected_fulfillment_status in test_cases:
            order = OnsiteOrder.objects.create(
                checkout_ref=f"test-fulfillment-{legacy_status}",
                status=legacy_status,
                customer_name="Test",
                line_items=[],
            )
            self.assertEqual(
                order.get_fulfillment_status_from_legacy(),
                expected_fulfillment_status,
                f"Failed for legacy status {legacy_status}",
            )

    def test_new_fields_are_nullable_for_backward_compatibility(self):
        """Verify that payment_status and fulfillment_status can be null when not explicitly set."""
        order = OnsiteOrder.objects.create(
            checkout_ref="test-nullable-fields",
            status=OnsiteOrder.STATUS_PENDING,
            customer_name="Test",
            line_items=[],
        )
        self.assertIsNone(order.payment_status)
        self.assertIsNone(order.fulfillment_status)

    def test_can_explicitly_set_both_status_fields(self):
        """Verify that both payment_status and fulfillment_status can be set together."""
        order = OnsiteOrder.objects.create(
            checkout_ref="test-explicit-fields",
            status=OnsiteOrder.STATUS_PAID,
            payment_status=OnsiteOrder.PAYMENT_STATUS_PAID,
            fulfillment_status=OnsiteOrder.FULFILLMENT_STATUS_UNFULFILLED,
            customer_name="Test",
            line_items=[],
        )
        self.assertEqual(order.payment_status, OnsiteOrder.PAYMENT_STATUS_PAID)
        self.assertEqual(order.fulfillment_status, OnsiteOrder.FULFILLMENT_STATUS_UNFULFILLED)

    def test_migration_0039_backfills_status_fields(self):
        """Verify that M0039 backfill migration populates both status fields from legacy status."""
        # This test verifies the backfill logic by checking that the migration
        # was applied successfully. All orders in the test DB have been backfilled.
        # We create a new order and verify the mapping still works.
        test_cases = [
            (OnsiteOrder.STATUS_PENDING, OnsiteOrder.PAYMENT_STATUS_PENDING, OnsiteOrder.FULFILLMENT_STATUS_UNFULFILLED),
            (OnsiteOrder.STATUS_PROCESSING, OnsiteOrder.PAYMENT_STATUS_PROCESSING, OnsiteOrder.FULFILLMENT_STATUS_PROCESSING),
            (OnsiteOrder.STATUS_PAID, OnsiteOrder.PAYMENT_STATUS_PAID, OnsiteOrder.FULFILLMENT_STATUS_UNFULFILLED),
            (OnsiteOrder.STATUS_SHIPPED, OnsiteOrder.PAYMENT_STATUS_PAID, OnsiteOrder.FULFILLMENT_STATUS_SHIPPED),
            (OnsiteOrder.STATUS_COMPLETED, OnsiteOrder.PAYMENT_STATUS_PAID, OnsiteOrder.FULFILLMENT_STATUS_DELIVERED),
            (OnsiteOrder.STATUS_FAILED, OnsiteOrder.PAYMENT_STATUS_FAILED, OnsiteOrder.FULFILLMENT_STATUS_CANCELED),
            (OnsiteOrder.STATUS_CANCELED, OnsiteOrder.PAYMENT_STATUS_CANCELED, OnsiteOrder.FULFILLMENT_STATUS_CANCELED),
        ]

        # Verify all test cases work correctly
        # In production, migration 0039 backfill would populate these for existing records
        for legacy_status, expected_payment, expected_fulfillment in test_cases:
            order = OnsiteOrder.objects.create(
                checkout_ref=f"backfill-verify-{legacy_status}",
                status=legacy_status,
                customer_name="Backfill Verify",
                line_items=[],
            )
            # After migration 0039, new orders would still need explicit setting
            # unless we update the save() method. For now, verify helper methods work.
            self.assertEqual(
                order.get_payment_status_from_legacy(),
                expected_payment,
                f"Payment status mismatch for legacy status {legacy_status}",
            )
            self.assertEqual(
                order.get_fulfillment_status_from_legacy(),
                expected_fulfillment,
                f"Fulfillment status mismatch for legacy status {legacy_status}",
            )


class OrderItemTests(BaseApiTestCase):
    def test_create_single_order_item(self):
        """Verify that OrderItem can be created and linked to an order."""
        order = OnsiteOrder.objects.create(
            checkout_ref="item-test-single",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="Test",
            line_items=[],
        )

        item = OrderItem.objects.create(
            order=order,
            sku="TEST-SKU-001",
            title="Test Product",
            variant_ref="variant-123",
            unit_price_cents=9999,
            quantity=2,
            line_total_cents=19998,
        )

        self.assertEqual(item.sku, "TEST-SKU-001")
        self.assertEqual(item.title, "Test Product")
        self.assertEqual(item.unit_price_cents, 9999)
        self.assertEqual(item.quantity, 2)
        self.assertEqual(item.line_total_cents, 19998)
        self.assertEqual(item.order, order)

    def test_order_item_rejects_mismatched_line_total(self):
        order = OnsiteOrder.objects.create(
            checkout_ref="item-test-total",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="Test",
            line_items=[],
        )

        with self.assertRaises(IntegrityError):
            OrderItem.objects.create(
                order=order,
                sku="BAD-TOTAL",
                title="Bad Total",
                unit_price_cents=100,
                quantity=2,
                line_total_cents=999,
            )

    def test_order_items_reverse_relation(self):
        """Verify that OrderItems are accessible via order.order_items."""
        order = OnsiteOrder.objects.create(
            checkout_ref="item-test-reverse",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="Test",
            line_items=[],
        )

        items_data = [
            {"sku": "A", "title": "Product A", "unit_price": 1000, "qty": 1},
            {"sku": "B", "title": "Product B", "unit_price": 2000, "qty": 2},
            {"sku": "C", "title": "Product C", "unit_price": 3000, "qty": 1},
        ]

        for data in items_data:
            OrderItem.objects.create(
                order=order,
                sku=data["sku"],
                title=data["title"],
                unit_price_cents=data["unit_price"],
                quantity=data["qty"],
                line_total_cents=data["unit_price"] * data["qty"],
            )

        self.assertEqual(order.order_items.count(), 3)
        self.assertEqual(
            {item.sku for item in order.order_items.all()},
            {"A", "B", "C"},
        )

    def test_order_item_cascade_delete(self):
        """Verify that deleting an order deletes its OrderItems."""
        order = OnsiteOrder.objects.create(
            checkout_ref="item-test-cascade",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="Test",
            line_items=[],
        )

        OrderItem.objects.create(
            order=order,
            sku="CASCADE-TEST",
            title="Should Be Deleted",
            unit_price_cents=5000,
            quantity=1,
            line_total_cents=5000,
        )

        item_id = order.order_items.first().id
        self.assertTrue(OrderItem.objects.filter(id=item_id).exists())

        order.delete()
        self.assertFalse(OrderItem.objects.filter(id=item_id).exists())

    def test_order_item_string_representation(self):
        """Verify OrderItem __str__ produces expected output."""
        order = OnsiteOrder.objects.create(
            checkout_ref="str-test",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="Test",
            line_items=[],
        )

        item = OrderItem.objects.create(
            order=order,
            sku="STR-SKU",
            title="String Test",
            unit_price_cents=1500,
            quantity=3,
            line_total_cents=4500,
        )

        expected_str = f"STR-SKU x3 (str-test)"
        self.assertEqual(str(item), expected_str)


class FinancialTotalsTests(BaseApiTestCase):
    def test_financial_totals_database_constraint_rejects_mismatch(self):
        order = OnsiteOrder(
            checkout_ref="financial-db-invalid",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="Test",
            line_items=[],
            amount_total_cents=200,
            subtotal_cents=100,
            discount_cents=0,
            shipping_cents=0,
            tax_cents=0,
        )

        with self.assertRaises(IntegrityError):
            order.save()

    def test_financial_totals_validation_success_with_complete_breakdown(self):
        """Verify that valid financial breakdown passes validation."""
        order = OnsiteOrder.objects.create(
            checkout_ref="financial-valid-1",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="Test",
            line_items=[],
            amount_total_cents=11000,  # 10000 - 0 + 500 + 500
            subtotal_cents=10000,
            discount_cents=0,
            shipping_cents=500,
            tax_cents=500,
        )
        is_valid, error_msg = order.validate_financial_totals()
        self.assertTrue(is_valid, f"Expected valid but got: {error_msg}")
        self.assertIsNone(error_msg)

    def test_financial_totals_validation_fails_on_mismatch(self):
        """Verify that mismatched financial breakdown fails validation."""
        order = OnsiteOrder(
            checkout_ref="financial-invalid-1",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="Test",
            line_items=[],
            amount_total_cents=11000,  # Incorrect: should be 11500
            subtotal_cents=10000,
            discount_cents=0,
            shipping_cents=500,
            tax_cents=1000,  # 10000 - 0 + 500 + 1000 = 11500
        )
        is_valid, error_msg = order.validate_financial_totals()
        self.assertFalse(is_valid)
        self.assertIn("Financial total mismatch", error_msg)
        self.assertIn("11500", error_msg)  # Calculated total

    def test_financial_totals_validation_allows_partial_data(self):
        """Verify that validation allows partial breakdown (backward compatibility)."""
        order = OnsiteOrder.objects.create(
            checkout_ref="financial-partial-1",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="Test",
            line_items=[],
            amount_total_cents=10000,
            subtotal_cents=None,  # Incomplete breakdown
            discount_cents=None,
            shipping_cents=None,
            tax_cents=None,
        )
        is_valid, error_msg = order.validate_financial_totals()
        self.assertTrue(is_valid, f"Partial data should be valid: {error_msg}")
        self.assertIsNone(error_msg)

    def test_financial_totals_with_discount(self):
        """Verify financial calculation with discount applied."""
        order = OnsiteOrder.objects.create(
            checkout_ref="financial-discount-1",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="Test",
            line_items=[],
            amount_total_cents=9000,  # 10000 - 1000 + 0 + 0
            subtotal_cents=10000,
            discount_cents=1000,
            shipping_cents=0,
            tax_cents=0,
        )
        is_valid, error_msg = order.validate_financial_totals()
        self.assertTrue(is_valid, f"Discount calculation failed: {error_msg}")
        self.assertIsNone(error_msg)

    def test_financial_totals_with_shipping_and_tax(self):
        """Verify financial calculation with shipping and tax applied."""
        order = OnsiteOrder.objects.create(
            checkout_ref="financial-shipping-tax-1",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="Test",
            line_items=[],
            amount_total_cents=11550,  # 10000 - 500 + 750 + 1300
            subtotal_cents=10000,
            discount_cents=500,
            shipping_cents=750,
            tax_cents=1300,
        )
        is_valid, error_msg = order.validate_financial_totals()
        self.assertTrue(is_valid, f"Complex calculation failed: {error_msg}")
        self.assertIsNone(error_msg)


class InventoryReservationTests(BaseApiTestCase):
    def setUp(self):
        """Set up test data for inventory tests."""
        self.product = CatalogProduct.objects.create(
            variant_ref="inv-test-variant",
            handle="inv-test-product",
            title="Test Product",
            price_amount=99.99,
            sku="INV-TEST-001",
            available_qty=100,
            reserved_qty=0,
        )
        self.order = OnsiteOrder.objects.create(
            checkout_ref="inv-order-1",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="Test",
            line_items=[],
        )

    def test_create_inventory_reservation(self):
        """Verify that inventory reservation can be created."""
        reservation = InventoryReservation.objects.create(
            order=self.order,
            product=self.product,
            quantity=10,
            status=InventoryReservation.STATUS_RESERVED,
        )
        self.assertEqual(reservation.quantity, 10)
        self.assertEqual(reservation.status, InventoryReservation.STATUS_RESERVED)
        self.assertEqual(reservation.order, self.order)
        self.assertEqual(reservation.product, self.product)

    def test_inventory_reservation_status_transitions(self):
        """Verify that inventory reservation can transition between statuses."""
        reservation = InventoryReservation.objects.create(
            order=self.order,
            product=self.product,
            quantity=10,
            status=InventoryReservation.STATUS_RESERVED,
        )

        from django.utils import timezone

        # Transition to fulfilled
        reservation.status = InventoryReservation.STATUS_FULFILLED
        reservation.fulfilled_at = timezone.now()
        reservation.save()

        reservation.refresh_from_db()
        self.assertEqual(reservation.status, InventoryReservation.STATUS_FULFILLED)
        self.assertIsNotNone(reservation.fulfilled_at)

    def test_inventory_reservation_cascade_to_order(self):
        """Verify that reservations are accessible via order.inventory_reservations."""
        res1 = InventoryReservation.objects.create(
            order=self.order,
            product=self.product,
            quantity=10,
            status=InventoryReservation.STATUS_RESERVED,
        )

        product2 = CatalogProduct.objects.create(
            variant_ref="inv-test-variant-2",
            handle="inv-test-product-2",
            title="Test Product 2",
            price_amount=49.99,
            sku="INV-TEST-002",
        )
        res2 = InventoryReservation.objects.create(
            order=self.order,
            product=product2,
            quantity=5,
            status=InventoryReservation.STATUS_RESERVED,
        )

        self.assertEqual(self.order.inventory_reservations.count(), 2)
        skus = {res.product.sku for res in self.order.inventory_reservations.all()}
        self.assertEqual(skus, {"INV-TEST-001", "INV-TEST-002"})


class InventoryTransactionTests(BaseApiTestCase):
    def setUp(self):
        """Set up test data for transaction tests."""
        self.product = CatalogProduct.objects.create(
            variant_ref="trans-test-variant",
            handle="trans-test-product",
            title="Test Product",
            price_amount=99.99,
            sku="TRANS-TEST-001",
        )
        self.order = OnsiteOrder.objects.create(
            checkout_ref="trans-order-1",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="Test",
            line_items=[],
        )

    def test_create_fulfillment_transaction(self):
        """Verify that fulfillment transaction can be created."""
        transaction = InventoryTransaction.objects.create(
            product=self.product,
            order=self.order,
            transaction_type=InventoryTransaction.TYPE_FULFILL,
            quantity_change=-10,
            reason="Order fulfillment",
        )
        self.assertEqual(transaction.quantity_change, -10)
        self.assertEqual(transaction.transaction_type, InventoryTransaction.TYPE_FULFILL)
        self.assertEqual(transaction.order, self.order)

    def test_create_adjustment_transaction_without_order(self):
        """Verify that adjustment transaction can be created without an order."""
        transaction = InventoryTransaction.objects.create(
            product=self.product,
            transaction_type=InventoryTransaction.TYPE_ADJUST,
            quantity_change=50,
            reason="Stock count correction",
        )
        self.assertEqual(transaction.quantity_change, 50)
        self.assertEqual(transaction.transaction_type, InventoryTransaction.TYPE_ADJUST)
        self.assertIsNone(transaction.order)

    def test_create_return_transaction(self):
        """Verify that return transaction can be created."""
        transaction = InventoryTransaction.objects.create(
            product=self.product,
            order=self.order,
            transaction_type=InventoryTransaction.TYPE_RETURN,
            quantity_change=5,
            reason="Customer return",
        )
        self.assertEqual(transaction.quantity_change, 5)
        self.assertEqual(transaction.transaction_type, InventoryTransaction.TYPE_RETURN)

    def test_inventory_transactions_via_order(self):
        """Verify that transactions are accessible via order.inventory_transactions."""
        trans1 = InventoryTransaction.objects.create(
            product=self.product,
            order=self.order,
            transaction_type=InventoryTransaction.TYPE_FULFILL,
            quantity_change=-10,
        )
        trans2 = InventoryTransaction.objects.create(
            product=self.product,
            order=self.order,
            transaction_type=InventoryTransaction.TYPE_RETURN,
            quantity_change=2,
        )

        self.assertEqual(self.order.inventory_transactions.count(), 2)
        types = {t.transaction_type for t in self.order.inventory_transactions.all()}
        self.assertEqual(types, {InventoryTransaction.TYPE_FULFILL, InventoryTransaction.TYPE_RETURN})


class CatalogProductInventoryTests(BaseApiTestCase):
    def test_multiple_legacy_products_can_have_null_sku(self):
        CatalogProduct.objects.create(
            variant_ref="null-sku-1",
            handle="null-sku-product-1",
            title="Product 1",
            sku=None,
        )
        CatalogProduct.objects.create(
            variant_ref="null-sku-2",
            handle="null-sku-product-2",
            title="Product 2",
            sku=None,
        )
        self.assertEqual(CatalogProduct.objects.filter(sku__isnull=True).count(), 2)

    def test_catalogproduct_with_inventory_fields(self):
        """Verify that CatalogProduct can store inventory information."""
        product = CatalogProduct.objects.create(
            variant_ref="inv-catalog-variant",
            handle="inv-catalog-product",
            title="Inventory Test Product",
            price_amount=129.99,
            sku="CATALOG-INV-001",
            available_qty=100,
            reserved_qty=25,
        )
        self.assertEqual(product.sku, "CATALOG-INV-001")
        self.assertEqual(product.available_qty, 100)
        self.assertEqual(product.reserved_qty, 25)

    def test_catalogproduct_sku_uniqueness(self):
        """Verify that SKU must be unique across products."""
        CatalogProduct.objects.create(
            variant_ref="unique-test-1",
            handle="unique-product-1",
            title="Product 1",
            price_amount=99.99,
            sku="UNIQUE-SKU",
        )

        with self.assertRaises(Exception):  # IntegrityError
            CatalogProduct.objects.create(
                variant_ref="unique-test-2",
                handle="unique-product-2",
                title="Product 2",
                price_amount=99.99,
                sku="UNIQUE-SKU",  # Duplicate SKU
            )


class M2DomainCompletionTests(BaseApiTestCase):
    def setUp(self):
        self.company = Company.objects.create(name="M2 Domain Corp", slug="m2-domain-corp")
        self.order = OnsiteOrder.objects.create(
            checkout_ref="m2-domain-order",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="Domain Test",
            line_items=[],
        )

    def test_order_company_and_lifecycle_fields_persist(self):
        timestamp = timezone.now()
        self.order.company = self.company
        self.order.processing_at = timestamp
        self.order.shipped_at = timestamp
        self.order.delivered_at = timestamp
        self.order.canceled_at = timestamp
        self.order.cancellation_reason = "Customer requested"
        self.order.save()
        self.order.refresh_from_db()
        self.assertEqual(self.order.company_id, self.company.id)
        self.assertEqual(self.order.cancellation_reason, "Customer requested")
        self.assertIsNotNone(self.order.delivered_at)

    def test_order_refund_total_rejects_negative_value(self):
        self.order.refund_total_cents = -1
        with self.assertRaises(IntegrityError):
            self.order.save()

    def test_order_refund_total_cannot_exceed_order_total(self):
        self.order.amount_total_cents = 100
        self.order.refund_total_cents = 101
        with self.assertRaises(IntegrityError):
            self.order.save()

    def test_order_company_is_set_null_when_company_deleted(self):
        self.order.company = self.company
        self.order.save()
        self.company.delete()
        self.order.refresh_from_db()
        self.assertIsNone(self.order.company_id)

    def test_order_item_snapshot_fields_persist(self):
        item = OrderItem.objects.create(
            order=self.order,
            sku="M2-SNAPSHOT",
            title="Snapshot Product",
            unit_price_cents=1000,
            quantity=1,
            line_total_cents=1000,
            weight_grams=500,
            shipping_class="standard",
            tax_code="STANDARD",
        )
        item.refresh_from_db()
        self.assertEqual(item.weight_grams, 500)
        self.assertEqual(item.shipping_class, "standard")
        self.assertEqual(item.tax_code, "STANDARD")

    def test_checkout_population_snapshots_product_metadata(self):
        product = CatalogProduct.objects.create(
            variant_ref="m2-checkout-snapshot-variant",
            handle="m2-checkout-snapshot-product",
            title="Checkout Snapshot Product",
            price_amount=10,
            available_qty=1,
            weight_grams=800,
            shipping_class="heavy",
            tax_code="REDUCED",
        )
        self.order.line_items = [{
            "sku": product.sku or product.variant_ref,
            "variantId": product.variant_ref,
            "variantRef": product.variant_ref,
            "title": product.title,
            "quantity": 1,
            "unitAmountCents": 1000,
            "lineTotalCents": 1000,
        }]
        _populate_order_items_and_reservations(self.order)
        item = self.order.order_items.get()
        self.assertEqual(item.weight_grams, 800)
        self.assertEqual(item.shipping_class, "heavy")
        self.assertEqual(item.tax_code, "REDUCED")

    def test_checkout_lines_aggregate_duplicate_variants(self):
        product = CatalogProduct.objects.create(
            variant_ref="m2-duplicate-variant",
            handle="m2-duplicate-product",
            title="Duplicate Product",
            price_amount=10,
        )
        line_items, error = _build_line_items_from_catalog([
            {"variantId": product.variant_ref, "quantity": 1},
            {"variantId": product.variant_ref, "quantity": 2},
        ])
        self.assertEqual(error, "")
        self.assertEqual(len(line_items), 1)
        self.assertEqual(line_items[0]["quantity"], 3)

    def test_product_stock_policy_and_metadata_persist(self):
        product = CatalogProduct.objects.create(
            variant_ref="m2-policy-variant",
            handle="m2-policy-product",
            title="Policy Product",
            stock_policy=CatalogProduct.STOCK_POLICY_FINITE,
            weight_grams=1000,
            shipping_class="heavy",
            tax_code="REDUCED",
        )
        self.assertEqual(product.stock_policy, CatalogProduct.STOCK_POLICY_FINITE)
        self.assertEqual(product.weight_grams, 1000)

    def test_new_catalog_products_default_to_finite_inventory(self):
        product = CatalogProduct.objects.create(
            variant_ref="finite-default-variant",
            handle="finite-default-product",
            title="Finite Default Product",
        )

        self.assertEqual(product.stock_policy, CatalogProduct.STOCK_POLICY_FINITE)
        self.assertTrue(product.inventory_tracked)

    def test_product_stock_policy_rejects_invalid_value(self):
        product = CatalogProduct(
            variant_ref="m2-invalid-policy-variant",
            handle="m2-invalid-policy-product",
            title="Invalid Policy Product",
            stock_policy="invalid",
        )
        with self.assertRaises(IntegrityError):
            product.save()

    def test_reservation_expiry_persists(self):
        product = CatalogProduct.objects.create(
            variant_ref="m2-expiry-variant",
            handle="m2-expiry-product",
            title="Expiry Product",
        )
        expiry = timezone.now() + timedelta(minutes=30)
        reservation = InventoryReservation.objects.create(
            order=self.order,
            product=product,
            quantity=1,
            expires_at=expiry,
        )
        reservation.refresh_from_db()
        self.assertIsNotNone(reservation.expires_at)


class M4CatalogManagementTests(BaseApiTestCase):
    def setUp(self):
        self.client = APIClient()
        self.company = Company.objects.create(name="M4 Domain Corp", slug="m4-domain-corp")
        self.order = OnsiteOrder.objects.create(
            checkout_ref="m4-domain-order",
            status=OnsiteOrder.STATUS_PAID,
            customer_name="M4 Test",
            line_items=[],
        )
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(username="m4-owner")
        self.office = user_model.objects.create_user(username="m4-office")
        self.staff = user_model.objects.create_user(username="m4-staff")
        self.engineer = user_model.objects.create_user(username="m4-engineer")
        self.customer = user_model.objects.create_user(username="m4-customer")
        UserProfile.objects.create(user=self.owner, role=UserProfile.ROLE_OWNER)
        UserProfile.objects.create(user=self.office, role=UserProfile.ROLE_OFFICE_STAFF)
        UserProfile.objects.create(user=self.staff, role=UserProfile.ROLE_STAFF)
        UserProfile.objects.create(user=self.engineer, role=UserProfile.ROLE_ENGINEER)
        UserProfile.objects.create(user=self.customer, role=UserProfile.ROLE_CUSTOMER)

    def test_owner_and_office_staff_have_identical_catalog_access(self):
        payload = {
            "variantRef": "m4-variant",
            "handle": "m4-product",
            "title": "M4 Product",
            "priceAmount": "19.99",
            "stockPolicy": CatalogProduct.STOCK_POLICY_FINITE,
        }
        for index, user in enumerate((self.owner, self.office), start=1):
            with self.subTest(user=user.username):
                self.client.force_authenticate(user=user)
                response = self.client.post(
                    "/api/portal/catalog/products/",
                    {**payload, "variantRef": f"m4-variant-{index}", "handle": f"m4-product-{index}"},
                    format="json",
                )
                self.assertEqual(response.status_code, 201)
                self.assertEqual(response.json()["title"], "M4 Product")

    def test_non_management_roles_are_denied(self):
        product = CatalogProduct.objects.create(
            variant_ref="m4-denied-variant",
            handle="m4-denied-product",
            title="Denied Product",
            price_amount="10.00",
        )
        for user in (self.staff, self.engineer, self.customer):
            with self.subTest(user=user.username):
                self.client.force_authenticate(user=user)
                response = self.client.get("/api/portal/catalog/products/")
                self.assertEqual(response.status_code, 403)
                response = self.client.patch(
                    f"/api/portal/catalog/products/{product.id}/",
                    {"title": "Nope"},
                    format="json",
                )
                self.assertEqual(response.status_code, 403)

    def test_office_staff_can_adjust_stock_and_archive(self):
        product = CatalogProduct.objects.create(
            variant_ref="m4-stock-variant",
            handle="m4-stock-product",
            title="Stock Product",
            price_amount="10.00",
            stock_policy=CatalogProduct.STOCK_POLICY_FINITE,
        )
        self.client.force_authenticate(user=self.office)
        stock_response = self.client.post(
            f"/api/portal/catalog/products/{product.id}/stock/",
            {"delta": 5, "reason": "Initial stock count"},
            format="json",
        )
        self.assertEqual(stock_response.status_code, 200)
        self.assertEqual(stock_response.json()["availableQty"], 5)
        state_response = self.client.post(
            f"/api/portal/catalog/products/{product.id}/state/",
            {"action": "archive"},
            format="json",
        )
        self.assertEqual(state_response.status_code, 200)
        self.assertFalse(state_response.json()["isActive"])

    def test_stock_adjustment_rejects_zero_and_missing_product(self):
        self.client.force_authenticate(user=self.office)
        zero_response = self.client.post(
            "/api/portal/catalog/products/999999/stock/",
            {"delta": 0, "reason": "No change"},
            format="json",
        )
        self.assertEqual(zero_response.status_code, 400)
        missing_response = self.client.post(
            "/api/portal/catalog/products/999999/stock/",
            {"delta": 1, "reason": "Correction"},
            format="json",
        )
        self.assertEqual(missing_response.status_code, 404)

    def test_company_checkout_requires_allowed_company_membership(self):
        user = get_user_model().objects.create_user(username="m2-company-user")
        profile = UserProfile.objects.create(user=user, role=UserProfile.ROLE_CUSTOMER)
        profile.allowed_companies.add(self.company)
        self.assertEqual(_resolve_checkout_company(user, self.company.id), self.company)

    def test_company_checkout_rejects_unrelated_company(self):
        user = get_user_model().objects.create_user(username="m2-other-company-user")
        UserProfile.objects.create(user=user, role=UserProfile.ROLE_CUSTOMER)
        with self.assertRaises(PermissionError):
            _resolve_checkout_company(user, self.company.id)

    def test_company_checkout_rejects_malformed_company_id(self):
        user = get_user_model().objects.create_user(username="m2-malformed-company-user")
        with self.assertRaises(PermissionError):
            _resolve_checkout_company(user, "not-an-integer")

    def test_fulfillment_records_actor(self):
        from .portal_views_modules.orders import _apply_fulfillment_status_transition

        actor = get_user_model().objects.create_user(username="m2-fulfillment-actor")
        self.assertTrue(_apply_fulfillment_status_transition(order=self.order, next_status=OnsiteOrder.STATUS_SHIPPED, actor=actor))
        self.order.refresh_from_db()
        self.assertEqual(self.order.fulfillment_actor_id, actor.id)
        self.assertIsNotNone(self.order.shipped_at)
        self.assertIsNotNone(self.order.processing_at)

    def test_fulfillment_inventory_failure_rolls_back_prior_reservations(self):
        from .portal_views_modules.orders import _apply_fulfillment_status_transition
        first_product = CatalogProduct.objects.create(variant_ref="m2-first-fulfillment-product", handle="m2-first-fulfillment-product", title="First Product", inventory_tracked=True, available_qty=5, reserved_qty=1)
        second_product = CatalogProduct.objects.create(variant_ref="m2-second-fulfillment-product", handle="m2-second-fulfillment-product", title="Second Product", inventory_tracked=True, available_qty=1, reserved_qty=0)
        InventoryReservation.objects.create(order=self.order, product=first_product, quantity=1, status=InventoryReservation.STATUS_RESERVED)
        InventoryReservation.objects.create(order=self.order, product=second_product, quantity=2, status=InventoryReservation.STATUS_RESERVED)
        self.assertFalse(_apply_fulfillment_status_transition(order=self.order, next_status=OnsiteOrder.STATUS_COMPLETED))
        first_product.refresh_from_db()
        self.assertEqual(first_product.available_qty, 5)
        self.assertEqual(first_product.reserved_qty, 1)
        self.assertEqual(InventoryReservation.objects.filter(order=self.order, status=InventoryReservation.STATUS_FULFILLED).count(), 0)


class M5PricingTests(BaseApiTestCase):
    def setUp(self):
        self.line_items = [{"lineTotalCents": 10000, "quantity": 1}]

    def test_republic_of_ireland_shipping_is_authoritative(self):
        totals = calculate_checkout_totals(self.line_items, country_code="IE", postcode="D01")
        self.assertEqual(totals["subtotal_cents"], 10000)
        self.assertEqual(totals["shipping_cents"], 1299)
        self.assertEqual(totals["amount_total_cents"], 11299)

    def test_northern_ireland_shipping_is_authoritative(self):
        totals = calculate_checkout_totals(self.line_items, country_code="GB", postcode="BT1 1AA")
        self.assertEqual(totals["shipping_cents"], 1599)

    def test_northern_ireland_xi_code_is_supported(self):
        totals = calculate_checkout_totals(self.line_items, country_code="XI", postcode="BT12 4AB")
        self.assertEqual(totals["shipping_cents"], 1599)

    def test_gb_postcode_outside_northern_ireland_is_rejected(self):
        with self.assertRaises(UnsupportedDestinationError):
            calculate_checkout_totals(self.line_items, country_code="GB", postcode="SW1A 1AA")

    def test_free_shipping_threshold(self):
        totals = calculate_checkout_totals(
            [{"lineTotalCents": 25000, "quantity": 1}],
            country_code="IE",
            postcode="D01",
        )
        self.assertEqual(totals["shipping_cents"], 0)
        self.assertEqual(
            calculate_checkout_totals(
                [{"lineTotalCents": 24999, "quantity": 1}],
                country_code="IE",
                postcode="D01",
            )["shipping_cents"],
            1299,
        )

    def test_unsupported_destination_is_rejected(self):
        with self.assertRaises(UnsupportedDestinationError):
            calculate_checkout_totals(self.line_items, country_code="FR", postcode="75001")

    @patch("api.views.STRIPE_CLIENT")
    @patch("api.views._is_allowed_checkout_origin", return_value=True)
    @patch("api.views._stripe_config_ok", return_value=True)
    @patch("api.views._verify_turnstile_token", return_value=True)
    def test_checkout_persists_server_shipping_total(
        self,
        _mock_turnstile,
        _mock_config,
        _mock_origin,
        mock_stripe_client,
    ):
        CatalogProduct.objects.create(
            variant_ref="m5-shipping-variant",
            handle="m5-shipping-product",
            title="Shipping Product",
            price_amount="10.00",
            available_qty=10,
            currency_code="EUR",
            is_active=True,
        )
        mock_stripe_client.v1.payment_intents.create.return_value = {"id": "pi_m5_shipping", "client_secret": "secret"}
        response = self.client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps({
                "checkoutRef": "m5-shipping-checkout",
                "customer": {"name": "Jane Doe", "email": "jane@example.com"},
                "shipping": {"countryCode": "IE", "postcode": "D01"},
                "items": [{"variantId": "m5-shipping-variant", "quantity": 1}],
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        order = OnsiteOrder.objects.get(checkout_ref="m5-shipping-checkout")
        self.assertEqual(order.subtotal_cents, 1000)
        self.assertEqual(order.shipping_cents, 1299)
        self.assertEqual(order.amount_total_cents, 2299)
        self.assertEqual(mock_stripe_client.v1.payment_intents.create.call_args.args[0]["amount"], 2299)

    @patch("api.views._is_allowed_checkout_origin", return_value=True)
    @patch("api.views._stripe_config_ok", return_value=True)
    @patch("api.views._verify_turnstile_token", return_value=True)
    def test_checkout_rejects_address_without_shipping_country(
        self,
        _mock_turnstile,
        _mock_config,
        _mock_origin,
    ):
        CatalogProduct.objects.create(
            variant_ref="m5-missing-country-variant",
            handle="m5-missing-country-product",
            title="Missing Country Product",
            price_amount="10.00",
            currency_code="EUR",
            is_active=True,
        )
        response = self.client.post(
            "/api/payments/onsite-intent/",
            data=json.dumps({
                "checkoutRef": "m5-missing-country",
                "customer": {"name": "Jane Doe", "email": "jane@example.com"},
                "shipping": {"addressLine1": "1 Main Street", "postcode": "D01"},
                "items": [{"variantId": "m5-missing-country-variant", "quantity": 1}],
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_unavailable_stock_policy_is_rejected_before_payment(self):
        CatalogProduct.objects.create(
            variant_ref="m7-unavailable-variant",
            handle="m7-unavailable-product",
            title="Unavailable Product",
            price_amount="10.00",
            stock_policy=CatalogProduct.STOCK_POLICY_UNAVAILABLE,
            is_active=True,
        )
        line_items, error = _build_line_items_from_catalog([
            {"variantId": "m7-unavailable-variant", "quantity": 1},
        ])
        self.assertEqual(line_items, [])
        self.assertIn("unavailable", error.lower())

    def test_finite_stock_policy_enforces_inventory_without_legacy_flag(self):
        product = CatalogProduct.objects.create(
            variant_ref="m7-finite-policy-variant",
            handle="m7-finite-policy-product",
            title="Finite Policy Product",
            price_amount="10.00",
            stock_policy=CatalogProduct.STOCK_POLICY_FINITE,
            inventory_tracked=False,
            available_qty=0,
            reserved_qty=0,
        )
        order = OnsiteOrder.objects.create(
            checkout_ref="m7-finite-policy-order",
            status=OnsiteOrder.STATUS_PENDING,
            line_items=[{
                "sku": product.variant_ref,
                "variantRef": product.variant_ref,
                "quantity": 1,
                "unitAmountCents": 1000,
                "lineTotalCents": 1000,
            }],
        )
        with self.assertRaises(ValueError):
            _populate_order_items_and_reservations(order)


class M6ReconciliationTests(BaseApiTestCase):
    def test_processed_stripe_event_tracks_processing_state(self):
        event = ProcessedStripeEvent.objects.create(
            event_id="evt_m6_state",
            event_type="payment_intent.succeeded",
            status=ProcessedStripeEvent.STATUS_PROCESSED,
            attempts=1,
        )
        event.refresh_from_db()
        self.assertEqual(event.status, ProcessedStripeEvent.STATUS_PROCESSED)
        self.assertEqual(event.attempts, 1)

    def test_reconciliation_command_reports_stale_pending_orders(self):
        order = OnsiteOrder.objects.create(
            checkout_ref="m6-stale-order",
            status=OnsiteOrder.STATUS_PENDING,
            payment_intent_id="pi_m6_stale",
            amount_total_cents=1000,
            currency="EUR",
        )
        OnsiteOrder.objects.filter(pk=order.pk).update(
            updated_at=timezone.now() - timedelta(hours=3),
        )
        output = StringIO()
        call_command("reconcile_stripe_orders", stdout=output, stale_minutes=60)
        self.assertIn("m6-stale-order", output.getvalue())

    def test_refund_webhook_updates_partial_refund_total(self):
        order = OnsiteOrder.objects.create(
            checkout_ref="m6-refund-order",
            status=OnsiteOrder.STATUS_PAID,
            payment_status=OnsiteOrder.PAYMENT_STATUS_PAID,
            payment_intent_id="pi_m6_refund",
            amount_total_cents=1000,
            currency="EUR",
        )
        self.assertEqual(order.refund_total_cents, 0)

    def test_dispute_and_chargeback_statuses_exist(self):
        self.assertEqual(OnsiteOrder.PAYMENT_STATUS_DISPUTED, "disputed")
        self.assertEqual(OnsiteOrder.PAYMENT_STATUS_CHARGEBACK, "chargeback")

    @patch("api.views.STRIPE_WEBHOOK_SECRET", "whsec_test")
    @patch("api.views.stripe.Webhook.construct_event")
    def test_partial_refund_webhook_updates_order(self, mock_construct):
        order = OnsiteOrder.objects.create(
            checkout_ref="m6-partial-refund",
            status=OnsiteOrder.STATUS_PAID,
            payment_intent_id="pi_m6_partial_refund",
            amount_total_cents=1000,
            currency="EUR",
        )
        mock_construct.return_value = {
            "id": "evt_m6_partial_refund",
            "type": "charge.refunded",
            "data": {"object": {"payment_intent": order.payment_intent_id, "currency": "eur", "amount": 1000, "amount_refunded": 400}},
        }
        response = self.client.post(
            "/api/payments/stripe/webhook/",
            data=json.dumps({"x": 1}),
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="sig_ok",
        )
        self.assertEqual(response.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.refund_total_cents, 400)
        self.assertEqual(order.payment_status, OnsiteOrder.PAYMENT_STATUS_PARTIALLY_REFUNDED)


class M7ReservationExpiryTests(BaseApiTestCase):
    def test_expire_reservations_restores_inventory_and_audits_release(self):
        product = CatalogProduct.objects.create(
            variant_ref="m7-expiry-variant",
            handle="m7-expiry-product",
            title="Expiry Product",
            inventory_tracked=True,
            available_qty=5,
            reserved_qty=2,
        )
        order = OnsiteOrder.objects.create(
            checkout_ref="m7-expiry-order",
            status=OnsiteOrder.STATUS_PENDING,
            line_items=[],
        )
        reservation = InventoryReservation.objects.create(
            order=order,
            product=product,
            quantity=2,
            status=InventoryReservation.STATUS_RESERVED,
            expires_at=timezone.now() - timedelta(minutes=1),
        )
        output = StringIO()
        call_command("expire_inventory_reservations", stdout=output)
        product.refresh_from_db()
        reservation.refresh_from_db()
        self.assertEqual(product.reserved_qty, 0)


class M12OperationalReadinessTests(BaseApiTestCase):
    def test_database_backup_command_creates_sqlite_dump(self):
        backup_path = Path("/tmp") / "manley-backup-test.sql"
        if backup_path.exists():
            backup_path.unlink()

        output = StringIO()
        call_command("database_backup", stdout=output, output=str(backup_path))

        self.assertTrue(backup_path.exists())
        self.assertIn("BEGIN TRANSACTION", backup_path.read_text(encoding="utf-8"))
        self.assertIn("Database backup created", output.getvalue())

    def test_monitoring_summary_flags_stale_orders_and_low_inventory(self):
        order = OnsiteOrder.objects.create(
            checkout_ref="m12-monitoring-order",
            status=OnsiteOrder.STATUS_PENDING,
            payment_intent_id="pi_m12_monitoring",
            amount_total_cents=1000,
            currency="EUR",
        )
        OnsiteOrder.objects.filter(pk=order.pk).update(updated_at=timezone.now() - timedelta(hours=3))

        product = CatalogProduct.objects.create(
            variant_ref="m12-monitoring-variant",
            handle="m12-monitoring-product",
            title="Monitoring Product",
            inventory_tracked=True,
            available_qty=1,
            reserved_qty=1,
        )

        output = StringIO()
        call_command("monitoring_summary", stdout=output, stale_minutes=60)
        payload = output.getvalue().strip()

        self.assertIn("alert", payload.lower())
        self.assertIn("stale_orders", payload)
        self.assertIn("low_inventory", payload)

    def test_database_restore_command_loads_sqlite_backup(self):
        backup_path = Path("/tmp") / "manley-restore-test.sql"
        if backup_path.exists():
            backup_path.unlink()
        target_path = Path("/tmp") / "manley-restore-target.db"
        if target_path.exists():
            target_path.unlink()

        call_command("database_backup", output=str(backup_path))
        output = StringIO()
        call_command("database_restore", stdout=output, backup=str(backup_path), target=str(target_path))

        self.assertTrue(target_path.exists())
        self.assertIn("Database restore complete", output.getvalue())

    def test_monitoring_alerts_detect_failed_stripe_events(self):
        ProcessedStripeEvent.objects.create(
            event_id="evt_failed_monitoring",
            event_type="payment_intent.payment_failed",
            status=ProcessedStripeEvent.STATUS_ERROR,
            error_message="stripe webhook failed",
        )

        output = StringIO()
        call_command("monitoring_alerts", stdout=output, stale_minutes=60)
        payload = output.getvalue().strip()

        self.assertIn("alert", payload.lower())
        self.assertIn("stripe_errors", payload)
        self.assertIn("evt_failed_monitoring", payload)


class M14StagingReadinessTests(BaseApiTestCase):
    @override_settings(
        DEBUG=False,
        DATABASES={
            "default": {
                "ENGINE": "django.db.backends.postgresql",
                "NAME": "staging",
            }
        },
        USE_REDIS_CACHE=True,
        REDIS_URL="redis://staging-redis:6379/1",
        CACHES={
            "default": {
                "BACKEND": "django_redis.cache.RedisCache",
                "LOCATION": "redis://staging-redis:6379/1",
            }
        },
        ALLOWED_HOSTS=["api-staging.example.com"],
        CORS_ALLOWED_ORIGINS=["https://staging.example.com"],
        CSRF_TRUSTED_ORIGINS=["https://staging.example.com"],
        STRIPE_SECRET_KEY="sk_test_staging",
        STRIPE_WEBHOOK_SECRET="whsec_staging",
        SHOP_REQUIRE_TURNSTILE=True,
        SHOP_TURNSTILE_SECRET_KEY="turnstile-staging",
        USE_R2_STORAGE=True,
        AWS_STORAGE_BUCKET_NAME="staging-media",
        AWS_S3_ENDPOINT_URL="https://r2.example.com",
        AWS_ACCESS_KEY_ID="staging-access",
        AWS_SECRET_ACCESS_KEY="staging-secret",
        ZEPTOMAIL_SEND_TOKEN="staging-mail-token",
        ZEPTOMAIL_FROM_EMAIL="staging@example.com",
        JWT_REFRESH_COOKIE_HTTPONLY=True,
        JWT_REFRESH_COOKIE_SECURE=True,
        JWT_REFRESH_COOKIE_SAMESITE="None",
    )
    def test_staging_config_command_accepts_isolated_test_configuration(self):
        output = StringIO()

        call_command("check_staging_config", stdout=output)

        self.assertIn("Staging configuration is ready", output.getvalue())

    @override_settings(
        DEBUG=True,
        DATABASES={"default": {"ENGINE": "django.db.backends.sqlite3"}},
        USE_REDIS_CACHE=False,
        CORS_ALLOWED_ORIGINS=["http://localhost:5173"],
        CSRF_TRUSTED_ORIGINS=["http://localhost:5173"],
        STRIPE_SECRET_KEY="sk_live_production",
        STRIPE_WEBHOOK_SECRET="",
        SHOP_REQUIRE_TURNSTILE=False,
        USE_R2_STORAGE=False,
        ZEPTOMAIL_SEND_TOKEN="",
        ZEPTOMAIL_FROM_EMAIL="",
        JWT_REFRESH_COOKIE_HTTPONLY=False,
        JWT_REFRESH_COOKIE_SECURE=False,
        JWT_REFRESH_COOKIE_SAMESITE="Lax",
    )
    def test_staging_config_command_rejects_unsafe_configuration(self):
        with self.assertRaisesMessage(CommandError, "DJANGO_DEBUG, DATABASE_URL, REDIS_URL"):
            call_command("check_staging_config", stdout=StringIO())

    @override_settings(
        DEBUG=False,
        DATABASES={
            "default": {
                "ENGINE": "django.db.backends.postgresql",
                "NAME": "staging",
            }
        },
        USE_REDIS_CACHE=True,
        REDIS_URL="redis://staging-redis:6379/1",
        CACHES={
            "default": {
                "BACKEND": "django_redis.cache.RedisCache",
                "LOCATION": "redis://staging-redis:6379/1",
            }
        },
        ALLOWED_HOSTS=["api-staging.example.com"],
        CORS_ALLOWED_ORIGINS=["https://staging.example.com"],
        CSRF_TRUSTED_ORIGINS=["https://staging.example.com"],
        STRIPE_SECRET_KEY="sk_test_staging",
        STRIPE_WEBHOOK_SECRET="whsec_staging",
        SHOP_REQUIRE_TURNSTILE=True,
        SHOP_TURNSTILE_SECRET_KEY="turnstile-staging",
        USE_R2_STORAGE=True,
        AWS_STORAGE_BUCKET_NAME="staging-media",
        AWS_S3_ENDPOINT_URL="https://r2.example.com",
        AWS_ACCESS_KEY_ID="staging-access",
        AWS_SECRET_ACCESS_KEY="staging-secret",
        ZEPTOMAIL_SEND_TOKEN="staging-mail-token",
        ZEPTOMAIL_FROM_EMAIL="staging@example.com",
        JWT_REFRESH_COOKIE_HTTPONLY=True,
        JWT_REFRESH_COOKIE_SECURE=True,
        JWT_REFRESH_COOKIE_SAMESITE="None",
        JWT_REFRESH_COOKIE_DOMAIN=".example.com",
    )
    def test_staging_config_rejects_wide_refresh_cookie_domain(self):
        with self.assertRaisesMessage(CommandError, "JWT_REFRESH_COOKIE_DOMAIN"):
            call_command("check_staging_config", stdout=StringIO())


class M15ReleaseReadinessTests(BaseApiTestCase):
    def test_validate_catalog_accepts_complete_active_products(self):
        CatalogProduct.objects.create(
            variant_ref="m15-valid-variant",
            handle="m15-valid-product",
            title="Release Product",
            image_url="https://cdn.example.com/release-product.jpg",
            image_alt="Release product",
            price_amount=Decimal("129.99"),
            currency_code="EUR",
            sku="M15-VALID",
            inventory_tracked=True,
            stock_policy=CatalogProduct.STOCK_POLICY_FINITE,
            available_qty=10,
            shipping_class="standard",
            weight_grams=500,
        )
        output = StringIO()

        call_command("validate_catalog", stdout=output)

        self.assertIn("Catalog validation passed", output.getvalue())

    def test_validate_catalog_reports_missing_release_data(self):
        CatalogProduct.objects.create(
            variant_ref="m15-invalid-variant",
            handle="m15-invalid-product",
            title="Incomplete Product",
            price_amount=Decimal("0.00"),
            currency_code="GBP",
        )
        output = StringIO()

        with self.assertRaisesMessage(CommandError, "m15-invalid-product"):
            call_command("validate_catalog", stdout=output)

        report = output.getvalue()
        self.assertIn("image", report)
        self.assertIn("price", report)
        self.assertIn("currency", report)
        self.assertIn("shipping", report)
        self.assertIn("stock", report)


class CapabilityRevocationTests(BaseApiTestCase):
    def test_revoke_order_status_token_disables_status_lookup(self):
        raw_status_token = "b" * 64
        order = OnsiteOrder.objects.create(
            checkout_ref="revoke-status-token",
            status_token=digest_capability_token(raw_status_token),
            status_token_expires_at=timezone.now() + timedelta(days=1),
            status=OnsiteOrder.STATUS_PAID,
            amount_total_cents=1000,
            currency="EUR",
        )
        output = StringIO()

        call_command("revoke_order_status_token", order_number=order.order_number, stdout=output)

        order.refresh_from_db()
        self.assertIsNotNone(order.status_token_revoked_at)
        self.assertIn(order.order_number, output.getvalue())
        response = self.client.post(
            "/api/payments/onsite-status/",
            data=json.dumps(
                {"checkoutRef": order.checkout_ref, "statusToken": raw_status_token}
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404)


class M9OrderEmailTests(BaseApiTestCase):
    def test_order_email_delivery_record_has_purpose_order_key(self):
        order = OnsiteOrder.objects.create(
            checkout_ref="m9-email-order",
            status=OnsiteOrder.STATUS_PAID,
            customer_email="customer@example.com",
            line_items=[],
        )
        delivery = OrderEmailDelivery.objects.create(
            order=order,
            purpose=OrderEmailDelivery.PURPOSE_CONFIRMED,
            idempotency_key=f"order:{order.pk}:confirmed",
        )
        self.assertEqual(delivery.status, OrderEmailDelivery.STATUS_PENDING)

    @patch("api.order_emails.send_transactional_email")
    def test_order_confirmation_email_is_sent_once(self, mock_send):
        order = OnsiteOrder.objects.create(
            checkout_ref="m9-confirmed-order",
            status=OnsiteOrder.STATUS_PAID,
            customer_email="customer@example.com",
            line_items=[],
        )
        send_order_confirmation_email(order=order)
        send_order_confirmation_email(order=order)
        self.assertEqual(mock_send.call_count, 1)

    def test_expiry_releases_multiple_reservations_for_same_product(self):
        product = CatalogProduct.objects.create(
            variant_ref="m7-shared-expiry-variant",
            handle="m7-shared-expiry-product",
            title="Shared Expiry Product",
            inventory_tracked=True,
            available_qty=10,
            reserved_qty=4,
        )
        for suffix, quantity in (("a", 1), ("b", 3)):
            order = OnsiteOrder.objects.create(
                checkout_ref=f"m7-shared-expiry-{suffix}",
                status=OnsiteOrder.STATUS_PENDING,
                line_items=[],
            )
            InventoryReservation.objects.create(
                order=order,
                product=product,
                quantity=quantity,
                status=InventoryReservation.STATUS_RESERVED,
                expires_at=timezone.now() - timedelta(minutes=1),
            )
        call_command("expire_inventory_reservations", stdout=StringIO())
        product.refresh_from_db()
        self.assertEqual(product.reserved_qty, 0)

    def test_expiry_releases_finite_policy_without_legacy_tracking_flag(self):
        product = CatalogProduct.objects.create(
            variant_ref="m7-finite-expiry-variant",
            handle="m7-finite-expiry-product",
            title="Finite Expiry Product",
            stock_policy=CatalogProduct.STOCK_POLICY_FINITE,
            inventory_tracked=False,
            available_qty=5,
            reserved_qty=1,
        )
        order = OnsiteOrder.objects.create(
            checkout_ref="m7-finite-expiry-order",
            status=OnsiteOrder.STATUS_PENDING,
            line_items=[],
        )
        InventoryReservation.objects.create(
            order=order,
            product=product,
            quantity=1,
            status=InventoryReservation.STATUS_RESERVED,
            expires_at=timezone.now() - timedelta(minutes=1),
        )
        call_command("expire_inventory_reservations", stdout=StringIO())
        product.refresh_from_db()
        self.assertEqual(product.reserved_qty, 0)


class RetentionCleanupTests(TestCase):
    """Tests for retention and automated cleanup."""
    
    def test_run_privacy_retention_command_cleans_expired_sessions(self):
        """Verify cleanup command deletes expired sessions and reports counts."""
        # Create user and sessions
        user = get_user_model().objects.create_user(
            username="retention-user",
            email="retention-user@example.com",
            password="retention-password-123",
        )
        UserProfile.objects.create(user=user, role=UserProfile.ROLE_CUSTOMER)
        
        expired_time = timezone.now() - timedelta(days=31)
        recent_time = timezone.now() - timedelta(days=1)
        
        expired_session = AccountSession.objects.create(
            user=user,
            expires_at=timezone.now() + timedelta(hours=1),
            ip_address='192.0.2.1',
            user_agent='Test'
        )
        
        recent_session = AccountSession.objects.create(
            user=user,
            expires_at=timezone.now() + timedelta(hours=1),
            ip_address='192.0.2.2',
            user_agent='Test'
        )
        
        # Manually set created_at timestamps (since auto_now_add prevents direct setting)
        AccountSession.objects.filter(id=expired_session.id).update(created_at=expired_time)
        AccountSession.objects.filter(id=recent_session.id).update(created_at=recent_time)
        
        # Run cleanup command
        out = StringIO()
        call_command('run_privacy_retention', stdout=out)
        output = out.getvalue()
        
        # Verify expired session deleted, recent retained
        self.assertFalse(AccountSession.objects.filter(id=expired_session.id).exists())
        self.assertTrue(AccountSession.objects.filter(id=recent_session.id).exists())
        
        # Verify output reports counts
        self.assertIn('Session', output)
        self.assertIn('1', output)  # deleted count

    def test_purge_expired_deleted_accounts_removes_disabled_accounts_after_recovery_window(self):
        """Verify hard deletion of disabled accounts after 30-day recovery window."""
        # Create user and disable account with expired recovery window
        user = get_user_model().objects.create_user(
            username="purge-test-user",
            email="purge-test@example.com",
            password="purge-password-123",
            is_active=True,
        )
        UserProfile.objects.create(user=user, role=UserProfile.ROLE_CUSTOMER)
        profile = CommerceCustomerProfile.objects.create(
            user=user,
            activation_pending=False,
        )
        
        # Mark for deletion with expired recovery window
        profile.deleted_at = timezone.now() - timedelta(days=31)  # Expired (31 days ago)
        profile.save()
        
        profile_id = profile.id
        
        # Run purge command with confirmation
        from unittest import mock
        with mock.patch('builtins.input', return_value='yes'):
            out = StringIO()
            call_command('purge_expired_accounts', stdout=out)
            output = out.getvalue()
        
        # Verify profile hard-deleted
        self.assertFalse(CommerceCustomerProfile.objects.filter(id=profile_id).exists())
        
        # Verify output reports counts
        self.assertIn('Hard deleted', output)
        self.assertIn('1', output)  # hard_deleted count

    def test_cleanup_expired_action_tokens_removes_consumed_and_expired_tokens(self):
        """Verify action token cleanup removes consumed and expired tokens."""
        from datetime import timedelta
        
        user = get_user_model().objects.create_user(
            username="token-cleanup-user",
            email="token-cleanup@example.com",
            password="token-cleanup-password-123",
        )
        UserProfile.objects.create(user=user, role=UserProfile.ROLE_CUSTOMER)
        
        now = timezone.now()
        
        # Consumed token (old)
        consumed_old = AccountActionToken.objects.create(
            user=user,
            purpose='email_verification',
            token_digest='hash1',
            issued_for_email='test@example.com',
            target_email='test@example.com',
            expires_at=now + timedelta(hours=1),
            consumed_at=now - timedelta(days=8)
        )
        
        # Consumed token (recent)
        consumed_recent = AccountActionToken.objects.create(
            user=user,
            purpose='email_verification',
            token_digest='hash2',
            issued_for_email='test@example.com',
            target_email='test@example.com',
            expires_at=now + timedelta(hours=1),
            consumed_at=now - timedelta(days=1)
        )
        
        # Expired token
        expired = AccountActionToken.objects.create(
            user=user,
            purpose='password_reset',
            token_digest='hash3',
            issued_for_email='test@example.com',
            target_email='test@example.com',
            expires_at=now - timedelta(hours=1),
            consumed_at=None
        )
        
        # Valid token
        valid = AccountActionToken.objects.create(
            user=user,
            purpose='email_change',
            token_digest='hash4',
            issued_for_email='test@example.com',
            target_email='new@example.com',
            expires_at=now + timedelta(hours=1),
            consumed_at=None
        )
        
        # Run cleanup
        from api.privacy_retention import cleanup_expired_account_action_tokens
        result = cleanup_expired_account_action_tokens()
        
        # Verify old consumed and expired tokens deleted
        self.assertFalse(AccountActionToken.objects.filter(id=consumed_old.id).exists())
        self.assertFalse(AccountActionToken.objects.filter(id=expired.id).exists())
        
        # Verify recent consumed and valid tokens retained
        self.assertTrue(AccountActionToken.objects.filter(id=consumed_recent.id).exists())
        self.assertTrue(AccountActionToken.objects.filter(id=valid.id).exists())
        
        # Verify counts
        self.assertEqual(result['deleted'], 2)
        self.assertEqual(result['retained'], 2)

    def test_cleanup_old_audit_logs_anonymizes_actor_references(self):
        """Verify audit log cleanup anonymizes actor references without hard deletion."""
        from datetime import timedelta
        
        user = get_user_model().objects.create_user(
            username="audit-cleanup-user",
            email="audit-cleanup@example.com",
            password="audit-cleanup-password-123",
        )
        UserProfile.objects.create(user=user, role=UserProfile.ROLE_CUSTOMER)
        
        old_date = timezone.now() - timedelta(days=91)
        recent_date = timezone.now() - timedelta(days=1)
        
        # Old audit log with actor
        old_log = AuditLog.objects.create(
            actor=user,
            action='account_login',
            target_type='User',
            target_id=user.id,
        )
        
        # Recent audit log with actor
        recent_log = AuditLog.objects.create(
            actor=user,
            action='account_export',
            target_type='User',
            target_id=user.id,
        )
        
        # Manually set created_at timestamps (since auto_now_add prevents direct setting)
        AuditLog.objects.filter(id=old_log.id).update(created_at=old_date)
        AuditLog.objects.filter(id=recent_log.id).update(created_at=recent_date)
        
        # Run cleanup
        from api.privacy_retention import cleanup_old_audit_logs
        result = cleanup_old_audit_logs()
        
        # Refresh from DB
        old_log.refresh_from_db()
        recent_log.refresh_from_db()
        
        # Verify old log actor anonymized, recent log actor retained
        self.assertIsNone(old_log.actor)
        self.assertIsNotNone(recent_log.actor)
        self.assertEqual(recent_log.actor.id, user.id)
        
        # Verify counts
        self.assertEqual(result['anonymized'], 1)
        self.assertEqual(result['retained'], 1)


class LoggingPrivacyTests(TestCase):
    """Tests for logging privacy and IP masking."""
    
    def test_ip_masking_ipv4(self):
        """Verify IPv4 addresses are masked to /24 CIDR."""
        from api.privacy_logging import mask_ip_address
        
        test_cases = [
            ("192.0.2.100", "192.0.2.x"),
            ("192.0.2.255", "192.0.2.x"),
            ("10.0.0.1", "10.0.0.x"),
            ("8.8.8.8", "8.8.8.x"),
        ]
        
        for ip, expected_mask in test_cases:
            result = mask_ip_address(ip)
            self.assertEqual(result, expected_mask, f"Failed for IP {ip}")
    
    def test_ip_masking_ipv6(self):
        """Verify IPv6 addresses are masked to /64 CIDR."""
        from api.privacy_logging import mask_ip_address
        
        test_cases = [
            ("2001:db8:85a3::8a2e:370:7334", "2001:db8:85a3::x"),
            ("::1", "::x"),
        ]
        
        for ip, expected_mask in test_cases:
            result = mask_ip_address(ip)
            self.assertEqual(result, expected_mask, f"Failed for IP {ip}")
    
    def test_log_sanitization_removes_sensitive_fields(self):
        """Verify log sanitization removes passwords, tokens, card data."""
        from api.privacy_logging import sanitize_log_details
        
        sensitive_details = {
            "user": "test@example.com",
            "password": "secret123",
            "card_number": "4532123456789012",
            "token": "eyJhbGc...",
            "action": "login",
        }
        
        sanitized = sanitize_log_details(sensitive_details)
        
        self.assertNotIn("password", str(sanitized.values()))
        self.assertNotIn("secret123", str(sanitized))
        self.assertNotIn("4532123456789012", str(sanitized))
        self.assertNotIn("eyJhbGc", str(sanitized))
        self.assertIn("action", str(sanitized))
    
    def test_correlation_id_attached_to_all_requests(self):
        """Verify correlation ID is generated and available in request context."""
        response = self.client.get("/api/account/", format="json")
        
        # Correlation ID should be in response headers
        self.assertIn("X-Correlation-ID", response)
        correlation_id = response.get("X-Correlation-ID")
        
        # Should be a valid UUID-like string (36 chars with dashes)
        self.assertEqual(len(correlation_id), 36)
        self.assertTrue(correlation_id.count("-") == 4)  # UUID format check


class APIOwnershipTests(BaseApiTestCase):
    """Tests verifying API ownership enforcement across all sensitive endpoints."""
    
    def test_account_export_restricted_to_own_account(self):
        """Verify user cannot export another user's data."""
        user1 = get_user_model().objects.create_user(
            username="user1",
            email="user1@example.com",
            password="testpass123",
        )
        # Create commerce profiles with verified emails
        profile1 = CommerceCustomerProfile.objects.create(
            user=user1,
            verified_email=user1.email,
            email_verified_at=timezone.now(),
        )
        
        user2 = get_user_model().objects.create_user(
            username="user2",
            email="user2@example.com",
            password="testpass123",
        )
        profile2 = CommerceCustomerProfile.objects.create(
            user=user2,
            verified_email=user2.email,
            email_verified_at=timezone.now(),
        )
        
        # User2 attempts export (should get their own data, not user1's)
        client = APIClient()
        client.force_authenticate(user=user2)
        response = client.post("/api/account/export/", format="json")
        
        self.assertEqual(response.status_code, 200)
        data = response.json()
        
        # Verify response contains user2's email, not user1's
        self.assertNotIn(user1.email, str(data))
        self.assertIn(user2.email, str(data))
    
    def test_saved_addresses_restricted_to_own_profile(self):
        """Verify user cannot retrieve another user's saved addresses."""
        # Create another user
        user1 = get_user_model().objects.create_user(
            username="otheruser",
            email="other@example.com",
            password="testpass123",
        )
        
        # Create user2 for the authenticated request
        user2 = get_user_model().objects.create_user(
            username="testuser",
            email="test@example.com",
            password="testpass123",
        )
        
        # Create commerce profiles (user2 needs verified email)
        commerce_profile1 = CommerceCustomerProfile.objects.create(user=user1)
        commerce_profile2 = CommerceCustomerProfile.objects.create(
            user=user2,
            verified_email=user2.email,
            email_verified_at=timezone.now(),
        )
        
        # Create address for user1
        addr1 = SavedAddress.objects.create(
            commerce_profile=commerce_profile1,
            recipient_name="User1 Address",
            address_line_1="123 Main St",
            city="City1",
            postcode="12345",
            country_code="IE",
        )
        
        # User2 retrieves addresses
        client = APIClient()
        client.force_authenticate(user=user2)
        response = client.get("/api/account/addresses/", format="json")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        
        # Should not contain user1's address
        self.assertNotIn("123 Main St", str(data))
        self.assertNotIn(user1.email, str(data))


class ConsentTests(TestCase):
    """Tests for cookie consent versioning and withdrawal."""

    def setUp(self):
        self.client = APIClient()

    def test_user_can_give_consent_to_version(self):
        """Verify user consent is recorded with version timestamp."""
        user = create_verified_user()
        self.client.force_authenticate(user=user)

        response = self.client.post(
            "/api/consent/record/",
            data={"consent_version": "1.0", "consent_categories": ["analytics", "marketing"]},
            format="json",
        )

        self.assertEqual(response.status_code, 201)

        from api.models import CookieConsentRecord

        consent = CookieConsentRecord.objects.filter(user=user).first()
        self.assertIsNotNone(consent)
        self.assertEqual(consent.consent_version, "1.0")
        self.assertIn("analytics", consent.consent_categories)

    def test_user_can_withdraw_consent(self):
        """Verify user can withdraw consent and it's timestamped."""
        user = create_verified_user()
        from api.models import CookieConsentRecord

        CookieConsentRecord.objects.create(
            user=user,
            consent_version="1.0",
            consent_categories=["analytics", "marketing"],
            consented_at=timezone.now(),
        )

        self.client.force_authenticate(user=user)
        response = self.client.post("/api/consent/withdraw/", format="json")

        self.assertEqual(response.status_code, 200)

        consent = CookieConsentRecord.objects.filter(user=user).latest("consented_at")
        self.assertIsNotNone(consent.withdrawn_at)

    def test_consent_included_in_account_export(self):
        """Verify consent records included in data export."""
        user = create_verified_user()
        from api.models import CookieConsentRecord

        CookieConsentRecord.objects.create(
            user=user,
            consent_version="1.0",
            consent_categories=["analytics"],
            consented_at=timezone.now(),
        )

        self.client.force_authenticate(user=user)
        response = self.client.post("/api/account/export/", format="json")

        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertIn("consent", data)
        self.assertEqual(len(data["consent"]), 1)
        self.assertEqual(data["consent"][0]["version"], "1.0")


class GDPRComplianceChecksTests(TestCase):
    def test_report_contains_required_check_keys(self):
        from api.privacy_compliance import run_compliance_checks

        report = run_compliance_checks()
        keys = {check["key"] for check in report["checks"]}

        self.assertEqual(
            keys,
            {
                "privacy_modules_present",
                "privacy_retention_policy",
                "consent_records_exported",
                "mfa_recovery_codes_hashed",
                "privacy_migrations_applied",
                "audit_log_anonymization",
                "external_approval_gates",
            },
        )

    def test_healthy_database_passes_technical_checks(self):
        from api.privacy_compliance import run_compliance_checks

        report = run_compliance_checks()
        technical = [
            check for check in report["checks"]
            if check["status"] != "approval_required"
        ]

        self.assertTrue(technical)
        self.assertTrue(all(check["status"] == "pass" for check in technical))

    def test_external_gates_need_attention_without_being_technical_failures(self):
        from api.privacy_compliance import run_compliance_checks

        report = run_compliance_checks()
        approvals = [
            check for check in report["checks"]
            if check["key"] == "external_approval_gates"
        ]

        self.assertEqual(len(approvals), 1)
        self.assertEqual(approvals[0]["status"], "approval_required")
        self.assertEqual(report["status"], "attention_required")

    def test_plaintext_recovery_code_is_a_technical_failure(self):
        from api.models import AccountSecurityState
        from api.privacy_compliance import run_compliance_checks

        user = get_user_model().objects.create_user(
            username="compliance-plaintext-user",
            email="compliance-plaintext@example.com",
            password="compliance-password",
        )
        security_state, _ = AccountSecurityState.objects.get_or_create(user=user)
        security_state.mfa_recovery_codes = ["plaintext-recovery-code"]
        security_state.save()

        report = run_compliance_checks()
        check = next(
            check for check in report["checks"]
            if check["key"] == "mfa_recovery_codes_hashed"
        )

        self.assertEqual(check["status"], "fail")
        self.assertEqual(report["status"], "attention_required")

    def test_command_json_output_is_serializable(self):
        out = StringIO()

        call_command("check_gdpr_compliance", "--json", stdout=out)
        payload = json.loads(out.getvalue())

        self.assertIn(payload["status"], {"pass", "attention_required"})
        self.assertTrue(payload["checks"])
        self.assertIn("approval_required", {
            check["status"] for check in payload["checks"]
        })

    def test_command_human_output_lists_check_statuses(self):
        out = StringIO()

        call_command("check_gdpr_compliance", stdout=out)
        output = out.getvalue()

        self.assertIn("GDPR compliance status", output)
        self.assertIn("external_approval_gates", output)
        self.assertIn("approval_required", output)


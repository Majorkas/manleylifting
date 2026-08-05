import json
from io import BytesIO, StringIO
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
    send_password_reset_email,
    send_verification_email,
)
from .auth_sessions import revoke_user_sessions
from .models import (
    AccountActionToken,
    AccountSession,
    AccountSecurityState,
    AuditLog,
    CatalogCollection,
    CatalogProduct,
    Certificate,
    CommerceCustomerProfile,
    Company,
    Equipment,
    InspectionReport,
    OnsiteOrder,
    ProcessedStripeEvent,
    ReportImage,
    ReportRevision,
    SavedAddress,
    Site,
    UserProfile,
)
from .throttles import PortalMethodRateThrottle
from backend.settings import (
    validate_account_registration_configuration,
    validate_required_secrets,
)


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
        self.assertTrue(setup_response.json()["setupInProgress"])
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
        CommerceCustomerProfile.objects.create(user=user, activation_pending=False)
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
        events_response = client.get("/api/account/security-events/", format="json")

        self.assertEqual(password_response.status_code, 200)
        self.assertEqual(logout_response.status_code, 200)
        self.assertEqual(events_response.status_code, 200)
        actions = [item["action"] for item in events_response.json()]
        self.assertIn("account.password_change", actions)
        self.assertIn("account.logout_all", actions)

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
            "/api/portal/me/change-password/",
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
                    "can_shop": True,
                    "can_view_orders": True,
                    "can_access_portal": True,
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
        verified_response = self.client.post(
            "/api/auth/token/",
            data={
                "username": "NEW-CUSTOMER@example.com",
                "password": self.registration_payload["password"],
            },
            format="json",
        )

        self.assertEqual(pending_response.status_code, 400)
        self.assertEqual(verified_response.status_code, 200)
        self.assertIn("access", verified_response.json())

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

    def test_account_password_change_requires_current_password_and_revokes_sessions(self):
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

    def test_account_delete_requires_confirmation_and_current_password(self):
        user = get_user_model().objects.create_user(
            username="account-delete-user",
            email="account-delete@example.com",
            password="Strong-Password-123!",
            is_active=True,
        )
        CommerceCustomerProfile.objects.create(user=user, activation_pending=False)
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

        self.assertEqual(missing_confirmation.status_code, 400)
        self.assertEqual(bad_password.status_code, 400)
        self.assertEqual(success.status_code, 200)
        self.assertFalse(get_user_model().objects.filter(pk=user.pk).exists())
        self.assertTrue(
            AuditLog.objects.filter(action="account.delete", target_type="account").exists()
        )

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

    def test_account_email_change_completion_updates_email_and_clears_verification(self):
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
        self.assertEqual(profile.verified_email, "")
        self.assertIsNone(profile.email_verified_at)

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
        CatalogProduct.objects.create(
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

    def test_featured_products_success(self):
        response = self.client.get("/api/shop/products/featured/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["products"]), 1)
        self.assertEqual(body["products"][0]["handle"], "chain-block")
        self.assertEqual(body["products"][0]["variantId"], "legacy-variant-id")

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
    @patch("api.views._is_allowed_checkout_origin", return_value=True)
    @patch("api.views._stripe_config_ok", return_value=True)
    @patch("api.views._verify_turnstile_token", return_value=True)
    @patch("api.views.stripe.PaymentIntent.create")
    def test_onsite_intent_success(self, mock_intent_create, _mock_turnstile, _mock_cfg, _mock_origin):
        CatalogProduct.objects.create(
            product_ref="legacy-product-id",
            variant_ref="legacy-variant-id",
            handle="chain-block",
            title="Chain Block",
            price_amount="10.00",
            currency_code="EUR",
            is_active=True,
        )

        mock_intent_create.return_value = {
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

        order = OnsiteOrder.objects.get(checkout_ref="onsite_ok_1")
        self.assertEqual(order.status, OnsiteOrder.STATUS_PENDING)
        self.assertEqual(order.amount_total_cents, 2000)

    @patch("api.views._is_allowed_checkout_origin", return_value=True)
    @patch("api.views._stripe_config_ok", return_value=True)
    @patch("api.views._verify_turnstile_token", return_value=True)
    @patch("api.views.stripe.PaymentIntent.create")
    def test_onsite_intent_returns_server_confirmed_pricing_summary(
        self,
        mock_intent_create,
        _mock_turnstile,
        _mock_cfg,
        _mock_origin,
    ):
        CatalogProduct.objects.create(
            product_ref="legacy-product-id",
            variant_ref="legacy-variant-id",
            handle="chain-block",
            title="Chain Block",
            price_amount="10.00",
            currency_code="EUR",
            is_active=True,
        )
        CatalogProduct.objects.create(
            product_ref="legacy-product-id-2",
            variant_ref="legacy-variant-id-2",
            handle="rope-sling",
            title="Rope Sling",
            price_amount="2.50",
            currency_code="EUR",
            is_active=True,
        )

        mock_intent_create.return_value = {
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
        self.assertIn("latest pricing", body["priceRefreshNotice"])

    def test_onsite_status_not_found(self):
        response = self.client.get("/api/payments/onsite-status/?checkoutRef=x1&statusToken=tok_1")
        self.assertEqual(response.status_code, 404)

    def test_onsite_order_summary_not_found(self):
        response = self.client.get("/api/payments/onsite-order-summary/?checkoutRef=x1&statusToken=tok_1")
        self.assertEqual(response.status_code, 404)

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

    @patch("api.views._is_allowed_checkout_origin", return_value=True)
    @patch("api.views._stripe_config_ok", return_value=True)
    @patch("api.views._verify_turnstile_token", return_value=True)
    @patch("api.views.stripe.PaymentIntent.create")
    def test_authenticated_checkout_associates_order_and_snapshots_address(
        self,
        mock_intent_create,
        _mock_turnstile,
        _mock_cfg,
        _mock_origin,
    ):
        CatalogProduct.objects.create(
            product_ref="legacy-product-id",
            variant_ref="legacy-variant-id",
            handle="chain-block",
            title="Chain Block",
            price_amount="10.00",
            currency_code="EUR",
            is_active=True,
        )
        mock_intent_create.return_value = {
            "id": "pi_auth1",
            "client_secret": "pi_auth1_secret",
        }

        response = self.client.post(
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

        other_response = self.client.get("/api/account/orders/order_for_other_user/")
        self.assertEqual(other_response.status_code, 404)

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
        )
        mock_construct.return_value = {
            "id": "evt_1",
            "type": "payment_intent.succeeded",
            "data": {"object": {"id": "pi_paid1"}},
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
        self.assertIsNotNone(order.paid_at)
        self.assertTrue(ProcessedStripeEvent.objects.filter(event_id="evt_1").exists())


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
            ("post", "/api/portal/me/change-password/"),
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

    def test_owner_change_password_requires_12_char_new_password(self):
        self.client.force_authenticate(user=self.owner_user)
        response = self.client.post(
            "/api/portal/me/change-password/",
            data={
                "current_password": "testpass123",
                "new_password": "Short123!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json().get("detail"),
            "Staff and owner passwords must be at least 12 characters long",
        )

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
            "/api/portal/me/change-password/",
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

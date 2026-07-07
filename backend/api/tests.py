import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from datetime import date
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from .models import (
    CatalogCollection,
    CatalogProduct,
    Company,
    Equipment,
    InspectionReport,
    OnsiteOrder,
    ProcessedStripeEvent,
    ReportImage,
    ReportRevision,
    UserProfile,
)
from .throttles import PortalMethodRateThrottle


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
        self.client = Client()


class ApiBasicEndpointTests(BaseApiTestCase):
    def test_hello_endpoint(self):
        response = self.client.get("/api/hello/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"message": "Hello from Django API"})

    def test_csrf_seed_endpoint(self):
        response = self.client.get("/api/csrf/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})


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

    def test_onsite_status_not_found(self):
        response = self.client.get("/api/payments/onsite-status/?checkoutRef=x1&statusToken=tok_1")
        self.assertEqual(response.status_code, 404)

    def test_onsite_order_summary_not_found(self):
        response = self.client.get("/api/payments/onsite-order-summary/?checkoutRef=x1&statusToken=tok_1")
        self.assertEqual(response.status_code, 404)


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
        self.client = APIClient()
        user_model = get_user_model()

        self.company_a = Company.objects.create(name="Acme Lifts", slug="acme-lifts")
        self.company_b = Company.objects.create(name="Beta Lifts", slug="beta-lifts")

        self.equipment_a = Equipment.objects.create(
            company=self.company_a,
            name="Chain Block A",
            asset_tag="AC-001",
            serial_number="SER-AC-001",
        )
        self.equipment_b = Equipment.objects.create(
            company=self.company_b,
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

    def test_login_errors_do_not_enumerate_usernames(self):
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

        self.client.force_authenticate(user=self.staff_user)
        response = self.client.post(
            f"/api/portal/equipment/{self.equipment_a.id}/reports/",
            data={
                "title": "Report with image",
                "report_date": "2026-06-30",
                "status": InspectionReport.STATUS_DRAFT,
                "images": [
                    SimpleUploadedFile("damage.jpg", b"fake-image-bytes", content_type="image/jpeg")
                ],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(response.json().get("images", [])), 1)
        self.assertEqual(ReportImage.objects.count(), 1)

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

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["name"], "New Demo Hoist")
        self.assertEqual(response.json()["next_inspection_due"], "2026-11-28")
        self.assertTrue(Equipment.objects.filter(name="New Demo Hoist", company=self.company_a).exists())

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
        self.assertEqual(response.json()["detail"], "username already exists")
        self.assertEqual(response.json()["suggested_username"], f"{self.staff_user.username}2")

    def test_logout_blacklists_refresh_token(self):
        self.client.force_authenticate(user=self.owner_user)
        refresh = RefreshToken.for_user(self.owner_user)
        self.client.cookies["manley_portal_refresh"] = str(refresh)

        response = self.client.post(
            "/api/auth/logout/",
            data={},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        reuse_response = self.client.post(
            "/api/auth/token/refresh/",
            data={"refresh": str(refresh)},
            format="json",
        )
        self.assertEqual(reuse_response.status_code, 401)

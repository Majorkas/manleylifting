import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
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
    ReportRevision,
    UserProfile,
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

    def test_customer_only_sees_allowed_company_equipment(self):
        self.client.force_authenticate(user=self.customer_user)
        response = self.client.get("/api/portal/equipment/")
        self.assertEqual(response.status_code, 200)

        results = response.json()["results"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["company_id"], self.company_a.id)

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
            data={"summary": "Owner updated summary", "status": InspectionReport.STATUS_FINAL},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        report.refresh_from_db()
        self.assertEqual(report.summary, "Owner updated summary")
        self.assertEqual(report.status, InspectionReport.STATUS_FINAL)
        self.assertEqual(report.edited_by_id, self.owner_user.id)
        self.assertEqual(ReportRevision.objects.filter(report=report).count(), 1)

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

    def test_logout_blacklists_refresh_token(self):
        self.client.force_authenticate(user=self.owner_user)
        refresh = RefreshToken.for_user(self.owner_user)

        response = self.client.post(
            "/api/auth/logout/",
            data={"refresh": str(refresh)},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        reuse_response = self.client.post(
            "/api/auth/token/refresh/",
            data={"refresh": str(refresh)},
            format="json",
        )
        self.assertEqual(reuse_response.status_code, 401)

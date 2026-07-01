import json
from unittest.mock import patch

from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from .models import CatalogCollection, CatalogProduct, OnsiteOrder, ProcessedStripeEvent


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

import base64
import hashlib
import hmac
import json
from datetime import timedelta
from unittest.mock import patch
from django.test import override_settings

from django.core.cache import cache
from django.test import Client, RequestFactory, TestCase, override_settings
from django.utils import timezone

from . import views
from .models import PendingCheckout, ProcessedWebhookEvent


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
        self.assertIn("csrftoken", response.cookies)


class ShopifyReadEndpointTests(BaseApiTestCase):
    @patch("api.views._shopify_graphql")
    def test_featured_products_success(self, mock_graphql):
        mock_graphql.return_value = (
            {
                "products": {
                    "nodes": [
                        {
                            "id": "gid://shopify/Product/1",
                            "title": "Chain Block",
                            "handle": "chain-block",
                            "description": "desc",
                            "featuredImage": {"url": "https://img", "altText": "alt"},
                            "variants": {
                                "nodes": [
                                    {
                                        "id": "gid://shopify/ProductVariant/10",
                                        "price": {"amount": "99.99", "currencyCode": "EUR"},
                                    }
                                ]
                            },
                            "collections": {"nodes": [{"handle": "lifting", "title": "Lifting"}]},
                        }
                    ]
                }
            },
            None,
            200,
        )

        response = self.client.get("/api/shop/products/featured/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["products"]), 1)
        self.assertEqual(body["products"][0]["handle"], "chain-block")
        self.assertEqual(body["products"][0]["variantId"], "gid://shopify/ProductVariant/10")

    @patch("api.views._is_rate_limited", return_value=True)
    def test_featured_products_rate_limited(self, _mock_limit):
        response = self.client.get("/api/shop/products/featured/")
        self.assertEqual(response.status_code, 429)

    @patch("api.views._shopify_graphql", return_value=(None, {"x": "y"}, 500))
    def test_collections_shopify_error_is_sanitized(self, _mock_graphql):
        response = self.client.get("/api/shop/collections/")
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"], "Could not load collections right now.")

    @patch("api.views._shopify_graphql", return_value=({"collection": None}, None, 200))
    def test_collection_detail_not_found(self, _mock_graphql):
        response = self.client.get("/api/shop/collections/missing/")
        self.assertEqual(response.status_code, 404)

    @patch("api.views._shopify_graphql", return_value=({"product": None}, None, 200))
    def test_product_detail_not_found(self, _mock_graphql):
        response = self.client.get("/api/shop/products/missing/")
        self.assertEqual(response.status_code, 404)


class CheckoutUrlTests(BaseApiTestCase):
    @patch("api.views.REQUIRE_TURNSTILE", False)
    @patch("api.views.CHECKOUT_ALLOWED_ORIGINS", {"https://manleylifting.ie"})
    @patch("api.views.ENFORCE_CHECKOUT_ORIGIN", True)
    def test_checkout_url_rejects_disallowed_origin(self):
        response = self.client.post(
            "/api/shop/checkout-url/",
            data=json.dumps(
                {
                    "checkoutRef": "origin_fail_1",
                    "items": [{"variantId": "gid://shopify/ProductVariant/1", "quantity": 1}],
                }
            ),
            content_type="application/json",
            HTTP_ORIGIN="https://evil.example",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"], "Invalid request origin")

    @patch(
        "api.views._shopify_graphql",
        return_value=(
            {
                "cartCreate": {
                    "cart": {"id": "gid://shopify/Cart/999", "checkoutUrl": "https://checkout.example"},
                    "userErrors": [],
                }
            },
            None,
            200,
        ),
    )
    @patch("api.views.REQUIRE_TURNSTILE", False)
    @patch("api.views.CHECKOUT_ALLOWED_ORIGINS", {"https://manleylifting.ie"})
    @patch("api.views.ENFORCE_CHECKOUT_ORIGIN", True)
    def test_checkout_url_accepts_allowed_origin(self, _mock_graphql):
        response = self.client.post(
            "/api/shop/checkout-url/",
            data=json.dumps(
                {
                    "checkoutRef": "origin_ok_1",
                    "items": [{"variantId": "gid://shopify/ProductVariant/1", "quantity": 1}],
                }
            ),
            content_type="application/json",
            HTTP_ORIGIN="https://manleylifting.ie",
        )

        self.assertEqual(response.status_code, 200)

    @patch("api.views._verify_turnstile_token", return_value=False)
    @patch("api.views.REQUIRE_TURNSTILE", True)
    @patch("api.views.ENFORCE_CHECKOUT_ORIGIN", False)
    def test_checkout_url_turnstile_rejects_invalid_token(self, _mock_verify):
        response = self.client.post(
            "/api/shop/checkout-url/",
            data=json.dumps(
                {
                    "checkoutRef": "turnstile_fail_1",
                    "items": [{"variantId": "gid://shopify/ProductVariant/1", "quantity": 1}],
                    "antiBotToken": "invalid-token",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"], "Bot verification failed")

    @patch(
        "api.views._shopify_graphql",
        return_value=(
            {
                "cartCreate": {
                    "cart": {"id": "gid://shopify/Cart/999", "checkoutUrl": "https://checkout.example"},
                    "userErrors": [],
                }
            },
            None,
            200,
        ),
    )
    @patch("api.views._verify_turnstile_token", return_value=True)
    @patch("api.views.REQUIRE_TURNSTILE", True)
    @patch("api.views.ENFORCE_CHECKOUT_ORIGIN", False)
    def test_checkout_url_turnstile_accepts_valid_token(self, _mock_verify, _mock_graphql):
        response = self.client.post(
            "/api/shop/checkout-url/",
            data=json.dumps(
                {
                    "checkoutRef": "turnstile_ok_1",
                    "items": [{"variantId": "gid://shopify/ProductVariant/1", "quantity": 1}],
                    "antiBotToken": "valid-token",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)

    @patch(
        "api.views._shopify_graphql",
        return_value=(
            {
                "cartCreate": {
                    "cart": {"id": "gid://shopify/Cart/999", "checkoutUrl": "https://checkout.example"},
                    "userErrors": [],
                }
            },
            None,
            200,
        ),
    )
    def test_checkout_url_is_csrf_exempt(self, _mock_graphql):
        strict_client = Client(enforce_csrf_checks=True)
        response = strict_client.post(
            "/api/shop/checkout-url/",
            data=json.dumps(
                {
                    "checkoutRef": "csrf_exempt_ref_1",
                    "items": [{"variantId": "gid://shopify/ProductVariant/1", "quantity": 1}],
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)

    @patch("api.views._is_rate_limited", return_value=True)
    def test_checkout_url_rate_limited(self, _mock_limit):
        response = self.client.post(
            "/api/shop/checkout-url/",
            data=json.dumps({"checkoutRef": "ref1", "items": []}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 429)

    def test_checkout_url_invalid_json(self):
        response = self.client.post(
            "/api/shop/checkout-url/",
            data="{bad-json",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Invalid JSON body")

    def test_checkout_url_invalid_checkout_ref(self):
        response = self.client.post(
            "/api/shop/checkout-url/",
            data=json.dumps({"checkoutRef": "bad ref!", "items": [{"variantId": "x", "quantity": 1}]}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Valid checkoutRef is required")

    def test_checkout_url_items_required(self):
        response = self.client.post(
            "/api/shop/checkout-url/",
            data=json.dumps({"checkoutRef": "ref_ok_1", "items": []}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Items are required")

    def test_checkout_url_rejects_invalid_lines(self):
        response = self.client.post(
            "/api/shop/checkout-url/",
            data=json.dumps(
                {
                    "checkoutRef": "ref_ok_2",
                    "items": [
                        {"variantId": "not-shopify-variant", "quantity": 1},
                        {"variantId": "gid://shopify/ProductVariant/1", "quantity": 0},
                    ],
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "No valid checkout lines provided")

    @patch("api.views._shopify_graphql", return_value=(None, {"boom": True}, 500))
    def test_checkout_url_shopify_error_sanitized(self, _mock_graphql):
        response = self.client.post(
            "/api/shop/checkout-url/",
            data=json.dumps(
                {
                    "checkoutRef": "ref_ok_3",
                    "items": [{"variantId": "gid://shopify/ProductVariant/1", "quantity": 2}],
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"], "Could not start checkout right now.")

    @patch(
        "api.views._shopify_graphql",
        return_value=({"cartCreate": {"cart": {}, "userErrors": [{"field": "x", "message": "bad"}]}}, None, 200),
    )
    def test_checkout_url_user_errors(self, _mock_graphql):
        response = self.client.post(
            "/api/shop/checkout-url/",
            data=json.dumps(
                {
                    "checkoutRef": "ref_ok_4",
                    "items": [{"variantId": "gid://shopify/ProductVariant/1", "quantity": 2}],
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Checkout validation failed")

    @patch("api.views._shopify_graphql", return_value=({"cartCreate": {"cart": {}, "userErrors": []}}, None, 200))
    def test_checkout_url_missing_checkout_url(self, _mock_graphql):
        response = self.client.post(
            "/api/shop/checkout-url/",
            data=json.dumps(
                {
                    "checkoutRef": "ref_ok_5",
                    "items": [{"variantId": "gid://shopify/ProductVariant/1", "quantity": 2}],
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Checkout URL not returned")

    @patch(
        "api.views._shopify_graphql",
        return_value=(
            {
                "cartCreate": {
                    "cart": {"id": "gid://shopify/Cart/999", "checkoutUrl": "https://checkout.example"},
                    "userErrors": [],
                }
            },
            None,
            200,
        ),
    )
    def test_checkout_url_success_creates_and_updates_pending_checkout(self, _mock_graphql):
        ref = "ref_ok_6"
        response = self.client.post(
            "/api/shop/checkout-url/",
            data=json.dumps(
                {
                    "checkoutRef": ref,
                    "items": [{"variantId": "gid://shopify/ProductVariant/1", "quantity": 2}],
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["checkoutUrl"], "https://checkout.example")
        self.assertTrue(body["statusToken"])

        pending = PendingCheckout.objects.get(checkout_ref=ref)
        self.assertEqual(pending.status, PendingCheckout.STATUS_PENDING)
        self.assertEqual(pending.shopify_cart_id, "gid://shopify/Cart/999")
        self.assertEqual(pending.checkout_url, "https://checkout.example")
        self.assertEqual(pending.status_token, body["statusToken"])
        self.assertEqual(
            pending.cart_payload["items"][0]["merchandiseId"],
            "gid://shopify/ProductVariant/1",
        )


class CheckoutStatusTests(BaseApiTestCase):
    @patch("api.views._is_rate_limited", return_value=True)
    def test_checkout_status_rate_limited(self, _mock_limit):
        response = self.client.get("/api/shop/checkout-status/?checkoutRef=abc&statusToken=tok_123")
        self.assertEqual(response.status_code, 429)

    def test_checkout_status_invalid_ref(self):
        response = self.client.get("/api/shop/checkout-status/?checkoutRef=bad ref&statusToken=tok_123")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Valid checkoutRef is required")

    def test_checkout_status_missing_status_token(self):
        response = self.client.get("/api/shop/checkout-status/?checkoutRef=missing_ref")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Valid statusToken is required")

    def test_checkout_status_not_found(self):
        response = self.client.get("/api/shop/checkout-status/?checkoutRef=missing_ref&statusToken=tok_123")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"], "Checkout not found")

    def test_checkout_status_existing_pending(self):
        PendingCheckout.objects.create(
            checkout_ref="pending_ref",
            status_token="tok_pending_1",
            status=PendingCheckout.STATUS_PENDING,
        )
        response = self.client.get("/api/shop/checkout-status/?checkoutRef=pending_ref&statusToken=tok_pending_1")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "pending")
        self.assertEqual(body["checkoutRef"], "pending_ref")
        self.assertIsNone(body["confirmedAt"])

    def test_checkout_status_existing_confirmed(self):
        pc = PendingCheckout.objects.create(
            checkout_ref="confirmed_ref",
            status_token="tok_confirmed_1",
            status=PendingCheckout.STATUS_CONFIRMED,
            confirmed_at=timezone.now(),
        )
        response = self.client.get("/api/shop/checkout-status/?checkoutRef=confirmed_ref&statusToken=tok_confirmed_1")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "confirmed")
        self.assertEqual(body["checkoutRef"], "confirmed_ref")
        self.assertTrue(body["confirmedAt"])
        self.assertTrue(body["confirmedAt"].startswith(str(pc.confirmed_at.year)))


class WebhookTests(BaseApiTestCase):
    SHOP_DOMAIN = "manley-lifting.myshopify.com"

    def setUp(self):
        super().setUp()
        self._store_domain_patcher = patch("api.views.STORE_DOMAIN", self.SHOP_DOMAIN)
        self._store_domain_patcher.start()
        self.addCleanup(self._store_domain_patcher.stop)

    def _webhook_headers(self, webhook_id, shop_domain=None, topic="orders/create"):
        return {
            "HTTP_X_SHOPIFY_WEBHOOK_ID": webhook_id,
            "HTTP_X_SHOPIFY_TOPIC": topic,
            "HTTP_X_SHOPIFY_SHOP_DOMAIN": shop_domain if shop_domain is not None else self.SHOP_DOMAIN,
        }

    def test_webhook_rejects_invalid_signature(self):
        response = self.client.post(
            "/api/shopify/webhooks/orders-create/",
            data=json.dumps({"id": 1}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)

    @patch("api.views._verify_shopify_webhook", return_value=True)
    def test_webhook_rejects_invalid_shop_domain(self, _mock_verify):
        response = self.client.post(
            "/api/shopify/webhooks/orders-create/",
            data=json.dumps({"id": 1}),
            content_type="application/json",
            **self._webhook_headers("wh_bad_domain", shop_domain="evil-store.myshopify.com"),
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"], "Invalid webhook shop domain")

    @patch("api.views._verify_shopify_webhook", return_value=True)
    def test_webhook_rejects_missing_webhook_id(self, _mock_verify):
        response = self.client.post(
            "/api/shopify/webhooks/orders-create/",
            data=json.dumps({"id": 1}),
            content_type="application/json",
            HTTP_X_SHOPIFY_SHOP_DOMAIN=self.SHOP_DOMAIN,
            HTTP_X_SHOPIFY_TOPIC="orders/create",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Missing or invalid webhook id")

    @patch("api.views._verify_shopify_webhook", return_value=True)
    def test_webhook_invalid_json(self, _mock_verify):
        response = self.client.post(
            "/api/shopify/webhooks/orders-create/",
            data="{bad-json",
            content_type="application/json",
            **self._webhook_headers("wh_1"),
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Invalid JSON body")

    @patch("api.views._verify_shopify_webhook", return_value=True)
    def test_webhook_ok_when_no_checkout_ref(self, _mock_verify):
        response = self.client.post(
            "/api/shopify/webhooks/orders-create/",
            data=json.dumps({"note_attributes": []}),
            content_type="application/json",
            **self._webhook_headers("wh_2"),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})
        self.assertTrue(ProcessedWebhookEvent.objects.filter(webhook_id="wh_2").exists())

    @patch("api.views._verify_shopify_webhook", return_value=True)
    def test_webhook_confirms_pending_checkout_from_note_attributes(self, _mock_verify):
        PendingCheckout.objects.create(
            checkout_ref="ref_attr",
            status_token="tok_attr",
            status=PendingCheckout.STATUS_PENDING,
        )

        payload = {"note_attributes": [{"name": "checkout_ref", "value": "ref_attr"}]}
        response = self.client.post(
            "/api/shopify/webhooks/orders-create/",
            data=json.dumps(payload),
            content_type="application/json",
            **self._webhook_headers("wh_3"),
        )

        self.assertEqual(response.status_code, 200)
        pc = PendingCheckout.objects.get(checkout_ref="ref_attr")
        self.assertEqual(pc.status, PendingCheckout.STATUS_CONFIRMED)
        self.assertIsNotNone(pc.confirmed_at)

    @patch("api.views._verify_shopify_webhook", return_value=True)
    def test_webhook_confirms_pending_checkout_from_note_fallback(self, _mock_verify):
        PendingCheckout.objects.create(
            checkout_ref="ref_note",
            status_token="tok_note",
            status=PendingCheckout.STATUS_PENDING,
        )

        payload = {"note": "customer info checkout_ref=ref_note"}
        response = self.client.post(
            "/api/shopify/webhooks/orders-create/",
            data=json.dumps(payload),
            content_type="application/json",
            **self._webhook_headers("wh_4"),
        )

        self.assertEqual(response.status_code, 200)
        pc = PendingCheckout.objects.get(checkout_ref="ref_note")
        self.assertEqual(pc.status, PendingCheckout.STATUS_CONFIRMED)

    @patch("api.views._verify_shopify_webhook", return_value=True)
    def test_webhook_duplicate_id_is_ignored(self, _mock_verify):
        PendingCheckout.objects.create(
            checkout_ref="dup_ref",
            status_token="tok_dup",
            status=PendingCheckout.STATUS_PENDING,
        )
        payload = {"note_attributes": [{"name": "checkout_ref", "value": "dup_ref"}]}

        first = self.client.post(
            "/api/shopify/webhooks/orders-create/",
            data=json.dumps(payload),
            content_type="application/json",
            **self._webhook_headers("wh_dup"),
        )
        second = self.client.post(
            "/api/shopify/webhooks/orders-create/",
            data=json.dumps(payload),
            content_type="application/json",
            **self._webhook_headers("wh_dup"),
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json(), {"ok": True, "duplicate": True})
        self.assertEqual(ProcessedWebhookEvent.objects.filter(webhook_id="wh_dup").count(), 1)


@override_settings(
    CACHES=TEST_CACHES,
    SECURE_SSL_REDIRECT=False,
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"],
)
class HelperLogicTests(TestCase):
    def setUp(self):
        cache.clear()
        self.factory = RequestFactory()

    def test_checkout_ref_validator(self):
        self.assertTrue(views._is_valid_checkout_ref("abc_123-XYZ"))
        self.assertFalse(views._is_valid_checkout_ref(""))
        self.assertFalse(views._is_valid_checkout_ref("contains space"))
        self.assertFalse(views._is_valid_checkout_ref("x" * 101))

    def test_client_ip_uses_remote_addr_by_default(self):
        request = self.factory.get("/api/hello/", REMOTE_ADDR="10.0.0.5")
        self.assertEqual(views._client_ip(request), "10.0.0.5")

    def test_rate_limiter_blocks_after_limit(self):
        request = self.factory.get("/api/hello/", REMOTE_ADDR="10.0.0.5")

        # The limiter increments until the stored count reaches limit; the next hit is blocked.
        self.assertFalse(views._is_rate_limited(request, "shop-read", limit=3, window_seconds=60))
        self.assertFalse(views._is_rate_limited(request, "shop-read", limit=3, window_seconds=60))
        self.assertFalse(views._is_rate_limited(request, "shop-read", limit=3, window_seconds=60))
        self.assertTrue(views._is_rate_limited(request, "shop-read", limit=3, window_seconds=60))

    @override_settings(TRUST_X_FORWARDED_FOR=False, TRUSTED_PROXY_IPS=["127.0.0.1"])
    def test_client_ip_ignores_xff_when_not_trusted(self):
        request = self.factory.get(
            "/api/hello/",
            REMOTE_ADDR="127.0.0.1",
            HTTP_X_FORWARDED_FOR="203.0.113.10, 127.0.0.1",
        )
        self.assertEqual(views._client_ip(request), "127.0.0.1")

    @override_settings(TRUST_X_FORWARDED_FOR=True, TRUSTED_PROXY_IPS=["127.0.0.1"])
    def test_client_ip_uses_xff_when_remote_is_trusted_proxy(self):
        request = self.factory.get(
            "/api/hello/",
            REMOTE_ADDR="127.0.0.1",
            HTTP_X_FORWARDED_FOR="203.0.113.10, 127.0.0.1",
        )
        self.assertEqual(views._client_ip(request), "203.0.113.10")

    def test_status_token_validator(self):
        self.assertTrue(views._is_valid_status_token("tok_Abc-123"))
        self.assertFalse(views._is_valid_status_token(""))
        self.assertFalse(views._is_valid_status_token("bad token"))
        self.assertFalse(views._is_valid_status_token("x" * 129))

    def test_webhook_id_validator(self):
        self.assertTrue(views._is_valid_webhook_id("wh_Abc-123"))
        self.assertFalse(views._is_valid_webhook_id(""))
        self.assertFalse(views._is_valid_webhook_id("bad id"))
        self.assertFalse(views._is_valid_webhook_id("x" * 129))

    def test_shop_domain_validator(self):
        with patch("api.views.STORE_DOMAIN", "manley-lifting.myshopify.com"):
            self.assertTrue(views._is_valid_shop_domain("manley-lifting.myshopify.com"))
            self.assertTrue(views._is_valid_shop_domain("Manley-Lifting.myshopify.com"))
            self.assertFalse(views._is_valid_shop_domain("other-store.myshopify.com"))
            self.assertFalse(views._is_valid_shop_domain(""))

    def test_extract_checkout_ref_from_order(self):
        payload_attr = {"note_attributes": [{"name": "checkout_ref", "value": "abc123"}]}
        self.assertEqual(views._extract_checkout_ref_from_order(payload_attr), "abc123")

        payload_note = {"note": "hello checkout_ref:xyz_789 bye"}
        self.assertEqual(views._extract_checkout_ref_from_order(payload_note), "xyz_789")

        payload_none = {"note_attributes": [{"name": "other", "value": "x"}], "note": "no ref"}
        self.assertEqual(views._extract_checkout_ref_from_order(payload_none), "")

    def test_verify_shopify_webhook_hmac(self):
        body = b'{"id":1}'
        secret = "unit_test_secret"
        digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()
        signature = base64.b64encode(digest).decode("utf-8")

        request = self.factory.post(
            "/api/shopify/webhooks/orders-create/",
            data=body,
            content_type="application/json",
            HTTP_X_SHOPIFY_HMAC_SHA256=signature,
        )

        with patch("api.views.SHOPIFY_WEBHOOK_SECRET", secret):
            self.assertTrue(views._verify_shopify_webhook(request))

    def test_expire_stale_pending_checkouts(self):
        old = PendingCheckout.objects.create(
            checkout_ref="old_pending",
            status_token="tok_old",
            status=PendingCheckout.STATUS_PENDING,
        )
        recent = PendingCheckout.objects.create(
            checkout_ref="recent_pending",
            status_token="tok_recent",
            status=PendingCheckout.STATUS_PENDING,
        )

        stale_time = timezone.now() - timedelta(minutes=61)
        recent_time = timezone.now() - timedelta(minutes=10)

        PendingCheckout.objects.filter(pk=old.pk).update(created_at=stale_time, updated_at=stale_time)
        PendingCheckout.objects.filter(pk=recent.pk).update(created_at=recent_time, updated_at=recent_time)

        with patch("api.views.PENDING_CHECKOUT_TTL_MINUTES", 60):
            changed = views._expire_stale_pending_checkouts()

        self.assertEqual(changed, 1)
        old.refresh_from_db()
        recent.refresh_from_db()
        self.assertEqual(old.status, PendingCheckout.STATUS_EXPIRED)
        self.assertEqual(recent.status, PendingCheckout.STATUS_PENDING)

    def test_purge_old_terminal_checkouts(self):
        old_confirmed = PendingCheckout.objects.create(
            checkout_ref="old_confirmed",
            status_token="tok_old_conf",
            status=PendingCheckout.STATUS_CONFIRMED,
        )
        old_expired = PendingCheckout.objects.create(
            checkout_ref="old_expired",
            status_token="tok_old_exp",
            status=PendingCheckout.STATUS_EXPIRED,
        )
        recent_confirmed = PendingCheckout.objects.create(
            checkout_ref="recent_confirmed",
            status_token="tok_recent_conf",
            status=PendingCheckout.STATUS_CONFIRMED,
        )
        old_pending = PendingCheckout.objects.create(
            checkout_ref="old_pending_keep",
            status_token="tok_old_pending",
            status=PendingCheckout.STATUS_PENDING,
        )

        old_time = timezone.now() - timedelta(days=31)
        recent_time = timezone.now() - timedelta(days=2)

        PendingCheckout.objects.filter(pk__in=[old_confirmed.pk, old_expired.pk, old_pending.pk]).update(
            updated_at=old_time
        )
        PendingCheckout.objects.filter(pk=recent_confirmed.pk).update(updated_at=recent_time)

        with patch("api.views.PENDING_CHECKOUT_RETENTION_DAYS", 30):
            deleted = views._purge_old_terminal_checkouts()

        self.assertEqual(deleted, 2)
        self.assertFalse(PendingCheckout.objects.filter(pk=old_confirmed.pk).exists())
        self.assertFalse(PendingCheckout.objects.filter(pk=old_expired.pk).exists())
        self.assertTrue(PendingCheckout.objects.filter(pk=recent_confirmed.pk).exists())
        self.assertTrue(PendingCheckout.objects.filter(pk=old_pending.pk).exists())

    def test_purge_old_processed_webhooks(self):
        old_event = ProcessedWebhookEvent.objects.create(webhook_id="wh_old", topic="orders/create")
        recent_event = ProcessedWebhookEvent.objects.create(webhook_id="wh_recent", topic="orders/create")

        old_time = timezone.now() - timedelta(days=31)
        recent_time = timezone.now() - timedelta(days=2)

        ProcessedWebhookEvent.objects.filter(pk=old_event.pk).update(created_at=old_time)
        ProcessedWebhookEvent.objects.filter(pk=recent_event.pk).update(created_at=recent_time)

        with patch("api.views.WEBHOOK_EVENT_RETENTION_DAYS", 30):
            deleted = views._purge_old_processed_webhooks()

        self.assertEqual(deleted, 1)
        self.assertFalse(ProcessedWebhookEvent.objects.filter(pk=old_event.pk).exists())
        self.assertTrue(ProcessedWebhookEvent.objects.filter(pk=recent_event.pk).exists())

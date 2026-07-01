import json
import logging
import os
import re
import secrets
from datetime import timedelta
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen
import stripe

from django.core.cache import cache
from django.conf import settings
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from .models import (
  CatalogCollection,
  CatalogProduct,
  OnsiteOrder,
  ProcessedStripeEvent,
)

STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "").strip()
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
STRIPE_CURRENCY = os.getenv("STRIPE_CURRENCY", "eur").strip().lower() or "eur"
logger = logging.getLogger(__name__)

if STRIPE_SECRET_KEY:
  stripe.api_key = STRIPE_SECRET_KEY


def _env_int(name, default):
  raw = str(os.getenv(name, str(default))).strip()
  try:
    return int(raw)
  except (TypeError, ValueError):
    return int(default)


def _env_bool(name, default=False):
  value = os.getenv(name)
  if value is None:
    return bool(default)
  return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_list(name, default=None):
  if default is None:
    default = []
  value = os.getenv(name, "")
  if not value.strip():
    return list(default)
  return [item.strip() for item in value.split(",") if item.strip()]


PENDING_CHECKOUT_TTL_MINUTES = max(5, _env_int("SHOP_PENDING_TTL_MINUTES", 120))
ENFORCE_CHECKOUT_ORIGIN = _env_bool("SHOP_ENFORCE_CHECKOUT_ORIGIN", not bool(getattr(settings, "DEBUG", False)))
REQUIRE_CHECKOUT_ORIGIN = _env_bool("SHOP_REQUIRE_CHECKOUT_ORIGIN", False)
CHECKOUT_ALLOWED_ORIGINS = set(
  _env_list("SHOP_CHECKOUT_ALLOWED_ORIGINS", getattr(settings, "CORS_ALLOWED_ORIGINS", []))
)
TURNSTILE_SECRET_KEY = os.getenv("SHOP_TURNSTILE_SECRET_KEY", "").strip()
REQUIRE_TURNSTILE = _env_bool("SHOP_REQUIRE_TURNSTILE", bool(TURNSTILE_SECRET_KEY))
TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


@ensure_csrf_cookie
@require_GET
def csrf_seed(request):
  return JsonResponse({"ok": True})


def _safe_shop_error(message, status=502):
  return JsonResponse({"error": message}, status=status)


def _client_error(message, status=400, log_message="", log_level="warning", **context):
  if log_message:
    logger_fn = getattr(logger, log_level, logger.warning)
    logger_fn("%s | context=%s", log_message, context or {})
  return JsonResponse({"error": message}, status=status)


def _to_int(value, default=0):
  try:
    return int(value)
  except (TypeError, ValueError):
    return default


def _client_ip(request):
  remote_addr = str(request.META.get("REMOTE_ADDR", "")).strip()
  forwarded_for = str(request.META.get("HTTP_X_FORWARDED_FOR", "")).strip()

  trust_forwarded = bool(getattr(settings, "TRUST_X_FORWARDED_FOR", False))
  trusted_proxies = set(getattr(settings, "TRUSTED_PROXY_IPS", []) or [])

  if trust_forwarded and remote_addr and remote_addr in trusted_proxies and forwarded_for:
    first_hop = forwarded_for.split(",")[0].strip()
    if first_hop:
      return first_hop

  if remote_addr:
    return remote_addr
  return "unknown"


def _is_rate_limited(request, scope, limit, window_seconds):
  ip = _client_ip(request)
  key = f"ratelimit:{scope}:{ip}"
  current = cache.get(key)

  if current is None:
    cache.set(key, 1, timeout=window_seconds)
    return False

  if int(current) >= int(limit):
    return True

  try:
    cache.incr(key)
  except ValueError:
    cache.set(key, int(current) + 1, timeout=window_seconds)

  return False


def _normalized_origin(value):
  candidate = str(value or "").strip()
  if not candidate:
    return ""

  parsed = urlparse(candidate)
  if not parsed.scheme or not parsed.netloc:
    return ""

  return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


def _request_origin(request):
  origin = str(request.META.get("HTTP_ORIGIN", "")).strip()
  if origin:
    return _normalized_origin(origin)

  referer = str(request.META.get("HTTP_REFERER", "")).strip()
  if not referer:
    return ""

  return _normalized_origin(referer)


def _is_allowed_checkout_origin(request):
  if not ENFORCE_CHECKOUT_ORIGIN:
    return True

  request_origin = _request_origin(request)
  if not request_origin:
    return not REQUIRE_CHECKOUT_ORIGIN

  allowed = {_normalized_origin(item) for item in CHECKOUT_ALLOWED_ORIGINS}
  allowed.discard("")
  return request_origin in allowed


def _verify_turnstile_token(token, remote_ip=""):
  if not REQUIRE_TURNSTILE:
    return True

  if not TURNSTILE_SECRET_KEY:
    logger.error("SHOP_TURNSTILE_SECRET_KEY is required when SHOP_REQUIRE_TURNSTILE is enabled")
    return False

  response_token = str(token or "").strip()
  if not response_token:
    return False

  payload = {
    "secret": TURNSTILE_SECRET_KEY,
    "response": response_token,
  }
  if remote_ip:
    payload["remoteip"] = remote_ip

  req = Request(
    TURNSTILE_VERIFY_URL,
    data=urlencode(payload).encode("utf-8"),
    headers={"Content-Type": "application/x-www-form-urlencoded"},
    method="POST",
  )

  try:
    with urlopen(req, timeout=10) as response:
      body = json.loads(response.read().decode("utf-8") or "{}")
  except Exception:
    logger.warning("Turnstile verification request failed")
    return False

  return bool(body.get("success"))


def _is_valid_checkout_ref(value):
  if not value:
    return False
  if len(value) > 100:
    return False
  return bool(re.fullmatch(r"[A-Za-z0-9_-]+", value))


def _is_valid_status_token(value):
  if not value:
    return False
  if len(value) > 128:
    return False
  return bool(re.fullmatch(r"[A-Za-z0-9_-]+", value))


def _is_valid_email(value):
  if not value:
    return False
  return bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", str(value).strip()))


def _new_status_token():
  return secrets.token_urlsafe(24)


def _stripe_config_ok():
  return bool(STRIPE_SECRET_KEY)


def _is_valid_payment_intent_id(value):
  text = str(value or "").strip()
  return bool(re.fullmatch(r"pi_[A-Za-z0-9]+", text))


def _to_minor_units(amount):
  try:
    value = float(amount)
  except Exception:
    return 0
  if value <= 0:
    return 0
  return int(round(value * 100))


def _build_line_items_from_catalog(items):
  if not isinstance(items, list):
    return [], "Items are required"

  valid_rows = []
  variant_ids = []
  for item in items:
    row = item or {}
    variant_id = str(row.get("variantId") or "").strip()
    quantity = _to_int(row.get("quantity"), 0)

    if not variant_id:
      continue
    if quantity <= 0 or quantity > 99:
      continue

    valid_rows.append({"variantId": variant_id, "quantity": quantity})
    variant_ids.append(variant_id)

  if not valid_rows:
    return [], "No valid checkout lines provided"

  products = CatalogProduct.objects.filter(
    variant_ref__in=variant_ids,
    is_active=True,
  ).select_related("collection")
  by_variant_id = {item.variant_ref: item for item in products}

  line_items = []
  for row in valid_rows:
    product = by_variant_id.get(row["variantId"])
    if not product:
      return [], "One or more checkout items are no longer available"

    amount = _to_float(product.price_amount, 0.0)
    if amount <= 0:
      return [], "One or more checkout items are no longer available"

    currency = str(product.currency_code or STRIPE_CURRENCY).strip().upper()
    quantity = int(row["quantity"])
    unit_amount_cents = _to_minor_units(amount)

    line_items.append(
      {
        "variantId": product.variant_ref,
        "title": str(product.title or "Product").strip(),
        "variantTitle": str(product.variant_title or "").strip(),
        "quantity": quantity,
        "currency": currency,
        "unitAmountCents": unit_amount_cents,
        "lineTotalCents": unit_amount_cents * quantity,
      }
    )

  return line_items, ""


def _set_onsite_order_from_payment_intent(payment_intent, status):
  if isinstance(payment_intent, dict):
    intent_id = str(payment_intent.get("id") or "").strip()
  else:
    intent_id = str(getattr(payment_intent, "id", "") or "").strip()
  if not _is_valid_payment_intent_id(intent_id):
    return

  update_fields = {"status": status, "updated_at": timezone.now()}
  if status == OnsiteOrder.STATUS_PAID:
    update_fields["paid_at"] = timezone.now()

  OnsiteOrder.objects.filter(payment_intent_id=intent_id).update(**update_fields)


def _stripe_field(obj, name, default=None):
  if isinstance(obj, dict):
    return obj.get(name, default)
  return getattr(obj, name, default)


def hello(request):
  return JsonResponse({"message": "Hello from Django API"})


def _to_float(value, default=0.0):
  try:
    return float(value)
  except Exception:
    return default


def _map_catalog_product(product):
  collection = getattr(product, "collection", None)
  return {
    "id": str(product.product_ref or ""),
    "title": str(product.title or ""),
    "handle": str(product.handle or ""),
    "description": str(product.description or ""),
    "imageUrl": str(product.image_url or ""),
    "imageAlt": str(product.image_alt or ""),
    "variantId": str(product.variant_ref or ""),
    "price": _to_float(product.price_amount, 0.0),
    "currency": str(product.currency_code or "EUR"),
    "collectionHandle": str(getattr(collection, "handle", "") or ""),
    "collectionTitle": str(getattr(collection, "title", "") or ""),
  }


@require_GET
def shop_featured_products(request):
  if _is_rate_limited(request, "shop-read", limit=120, window_seconds=60):
    return _client_error(
      "Too many requests",
      status=429,
      log_message="Featured products rate limit exceeded",
      ip=_client_ip(request),
      scope="shop-read",
    )

  products_qs = CatalogProduct.objects.filter(is_active=True).select_related("collection")[:12]
  products = [_map_catalog_product(product) for product in products_qs]

  return JsonResponse({"products": products})


@require_GET
def shop_collections(request):
  if _is_rate_limited(request, "shop-read", limit=120, window_seconds=60):
    return _client_error(
      "Too many requests",
      status=429,
      log_message="Collections rate limit exceeded",
      ip=_client_ip(request),
      scope="shop-read",
    )

  collections = CatalogCollection.objects.filter(is_active=True)[:24]
  normalized = [
    {
      "handle": item.handle or "",
      "title": item.title or "",
      "description": item.description or "",
    }
    for item in collections
  ]

  return JsonResponse({"collections": normalized})


@require_GET
def shop_collection_detail(request, handle):
  if _is_rate_limited(request, "shop-read", limit=120, window_seconds=60):
    return _client_error(
      "Too many requests",
      status=429,
      log_message="Collection detail rate limit exceeded",
      handle=handle,
      ip=_client_ip(request),
      scope="shop-read",
    )

  collection = CatalogCollection.objects.filter(handle=handle, is_active=True).first()
  if not collection:
    return _client_error(
      "Collection not found",
      status=404,
      log_message="Collection detail lookup returned no collection",
      handle=handle,
      ip=_client_ip(request),
      log_level="info",
    )

  products = CatalogProduct.objects.filter(collection=collection, is_active=True).select_related("collection")[:50]
  mapped_products = [_map_catalog_product(product) for product in products]

  return JsonResponse(
    {
      "collection": {
        "handle": collection.handle or "",
        "title": collection.title or "",
        "description": collection.description or "",
        "products": mapped_products,
      }
    }
  )


@require_GET
def shop_product_detail(request, handle):
  if _is_rate_limited(request, "shop-read", limit=120, window_seconds=60):
    return _client_error(
      "Too many requests",
      status=429,
      log_message="Product detail rate limit exceeded",
      handle=handle,
      ip=_client_ip(request),
      scope="shop-read",
    )

  product = CatalogProduct.objects.filter(handle=handle, is_active=True).select_related("collection").first()
  if not product:
    return _client_error(
      "Product not found",
      status=404,
      log_message="Product detail lookup returned no product",
      handle=handle,
      ip=_client_ip(request),
      log_level="info",
    )

  return JsonResponse({"product": _map_catalog_product(product)})


@require_POST
def onsite_checkout_intent(request):
  if not _is_allowed_checkout_origin(request):
    return _client_error(
      "Invalid request origin",
      status=403,
      log_message="Onsite intent blocked due to disallowed origin",
      origin=_request_origin(request),
      ip=_client_ip(request),
    )

  if _is_rate_limited(request, "onsite-intent", limit=30, window_seconds=60):
    return _client_error(
      "Too many requests",
      status=429,
      log_message="Onsite intent rate limit exceeded",
      ip=_client_ip(request),
    )

  if not _stripe_config_ok():
    logger.error("STRIPE_SECRET_KEY is not configured")
    return _safe_shop_error("Payment provider is not configured right now.", status=500)

  try:
    payload = json.loads(request.body.decode("utf-8") or "{}")
  except Exception:
    return _client_error(
      "Invalid JSON body",
      status=400,
      log_message="Onsite intent JSON parsing failed",
      ip=_client_ip(request),
    )

  items = payload.get("items") or []
  checkout_ref = str(payload.get("checkoutRef") or "").strip()
  customer = payload.get("customer") or {}
  customer_name = str(customer.get("name") or "").strip()
  customer_email = str(customer.get("email") or "").strip().lower()
  anti_bot_token = str(payload.get("antiBotToken") or "").strip()

  if not _verify_turnstile_token(anti_bot_token, remote_ip=_client_ip(request)):
    return _client_error(
      "Bot verification failed",
      status=403,
      log_message="Turnstile verification failed for onsite intent",
      ip=_client_ip(request),
    )

  if not _is_valid_checkout_ref(checkout_ref):
    return _client_error("Valid checkoutRef is required", status=400)

  if not customer_name:
    return _client_error("Customer name is required", status=400)

  if not _is_valid_email(customer_email):
    return _client_error("Valid customer email is required", status=400)

  line_items, line_error = _build_line_items_from_catalog(items)
  if line_error:
    return _client_error(line_error, status=400)

  if not line_items:
    return _client_error("No valid checkout lines provided", status=400)

  currency = line_items[0]["currency"].lower()
  if any(str(item.get("currency") or "").lower() != currency for item in line_items):
    return _client_error("Checkout currency mismatch", status=400)

  amount_total = sum(int(item.get("lineTotalCents") or 0) for item in line_items)
  if amount_total <= 0:
    return _client_error("Checkout total must be greater than zero", status=400)

  status_token = _new_status_token()
  try:
    intent = stripe.PaymentIntent.create(
      amount=amount_total,
      currency=currency,
      automatic_payment_methods={"enabled": True},
      receipt_email=customer_email,
      metadata={
        "checkout_ref": checkout_ref,
      },
    )
  except Exception:
    logger.exception("Failed to create Stripe PaymentIntent")
    return _safe_shop_error("Could not start payment right now.", status=502)

  payment_intent_id = str(_stripe_field(intent, "id", "") or "")
  client_secret = str(_stripe_field(intent, "client_secret", "") or "")
  if not _is_valid_payment_intent_id(payment_intent_id) or not client_secret:
    logger.error("Stripe response missing expected payment intent fields")
    return _safe_shop_error("Could not start payment right now.", status=502)

  OnsiteOrder.objects.update_or_create(
    checkout_ref=checkout_ref,
    defaults={
      "status_token": status_token,
      "status": OnsiteOrder.STATUS_PENDING,
      "line_items": line_items,
      "amount_total_cents": amount_total,
      "currency": currency.upper(),
      "customer_name": customer_name,
      "customer_email": customer_email,
      "payment_intent_id": payment_intent_id,
      "payment_client_secret": client_secret,
      "paid_at": None,
    },
  )

  return JsonResponse(
    {
      "checkoutRef": checkout_ref,
      "statusToken": status_token,
      "clientSecret": client_secret,
      "paymentIntentId": payment_intent_id,
      "amountTotalCents": amount_total,
      "currency": currency.upper(),
    }
  )


@require_GET
def onsite_checkout_status(request):
  if _is_rate_limited(request, "onsite-status", limit=120, window_seconds=60):
    return _client_error("Too many requests", status=429)

  checkout_ref = str(request.GET.get("checkoutRef") or "").strip()
  status_token = str(request.GET.get("statusToken") or "").strip()

  if not _is_valid_checkout_ref(checkout_ref):
    return _client_error("Valid checkoutRef is required", status=400)
  if not _is_valid_status_token(status_token):
    return _client_error("Valid statusToken is required", status=400)

  order = OnsiteOrder.objects.filter(checkout_ref=checkout_ref, status_token=status_token).first()
  if not order:
    return _client_error("Checkout not found", status=404)

  return JsonResponse(
    {
      "checkoutRef": order.checkout_ref,
      "status": order.status,
      "paidAt": order.paid_at.isoformat() if order.paid_at else None,
      "amountTotalCents": order.amount_total_cents,
      "currency": order.currency,
    }
  )


@require_GET
def onsite_order_summary(request):
  if _is_rate_limited(request, "onsite-order-summary", limit=120, window_seconds=60):
    return _client_error("Too many requests", status=429)

  checkout_ref = str(request.GET.get("checkoutRef") or "").strip()
  status_token = str(request.GET.get("statusToken") or "").strip()

  if not _is_valid_checkout_ref(checkout_ref):
    return _client_error("Valid checkoutRef is required", status=400)
  if not _is_valid_status_token(status_token):
    return _client_error("Valid statusToken is required", status=400)

  order = OnsiteOrder.objects.filter(checkout_ref=checkout_ref, status_token=status_token).first()
  if not order:
    return _client_error("Checkout not found", status=404)

  return JsonResponse(
    {
      "checkoutRef": order.checkout_ref,
      "status": order.status,
      "customerName": order.customer_name,
      "customerEmail": order.customer_email,
      "lineItems": order.line_items,
      "amountTotalCents": order.amount_total_cents,
      "currency": order.currency,
      "paidAt": order.paid_at.isoformat() if order.paid_at else None,
      "createdAt": order.created_at.isoformat() if order.created_at else None,
    }
  )


@csrf_exempt
@require_POST
def stripe_webhook(request):
  if not STRIPE_WEBHOOK_SECRET:
    logger.error("STRIPE_WEBHOOK_SECRET is not configured")
    return _client_error("Webhook not configured", status=500)

  signature = str(request.META.get("HTTP_STRIPE_SIGNATURE", "")).strip()
  if not signature:
    return _client_error("Missing Stripe signature", status=400)

  try:
    event = stripe.Webhook.construct_event(request.body, signature, STRIPE_WEBHOOK_SECRET)
  except Exception:
    return _client_error("Invalid Stripe signature", status=400)

  event_id = str(_stripe_field(event, "id", "") or "").strip()
  if not event_id:
    return _client_error("Invalid Stripe event", status=400)

  _, created = ProcessedStripeEvent.objects.get_or_create(
    event_id=event_id,
    defaults={"event_type": str(_stripe_field(event, "type", "") or "").strip()},
  )
  if not created:
    return JsonResponse({"ok": True, "duplicate": True})

  event_type = str(_stripe_field(event, "type", "") or "")
  event_data = _stripe_field(event, "data", {}) or {}
  intent = _stripe_field(event_data, "object", {}) or {}
  if event_type == "payment_intent.succeeded":
    _set_onsite_order_from_payment_intent(intent, OnsiteOrder.STATUS_PAID)
  elif event_type in {"payment_intent.payment_failed", "payment_intent.canceled"}:
    _set_onsite_order_from_payment_intent(intent, OnsiteOrder.STATUS_FAILED)

  return JsonResponse({"ok": True})

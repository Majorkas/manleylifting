import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
from datetime import timedelta
from urllib.parse import urlencode, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.core.cache import cache
from django.conf import settings
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from .models import PendingCheckout, ProcessedWebhookEvent

STORE_DOMAIN = os.getenv("SHOPIFY_STORE_DOMAIN", "").strip()
STOREFRONT_TOKEN = os.getenv("SHOPIFY_STOREFRONT_TOKEN", "").strip()
STOREFRONT_API_VERSION = os.getenv("SHOPIFY_STOREFRONT_API_VERSION", "2026-04").strip()
SHOPIFY_WEBHOOK_SECRET = os.getenv("SHOPIFY_WEBHOOK_SECRET", "").strip()
logger = logging.getLogger(__name__)


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
PENDING_CHECKOUT_RETENTION_DAYS = max(1, _env_int("SHOP_PENDING_RETENTION_DAYS", 30))
WEBHOOK_EVENT_RETENTION_DAYS = max(1, _env_int("SHOP_WEBHOOK_EVENT_RETENTION_DAYS", 30))
ENFORCE_CHECKOUT_ORIGIN = _env_bool("SHOP_ENFORCE_CHECKOUT_ORIGIN", not bool(getattr(settings, "DEBUG", False)))
REQUIRE_CHECKOUT_ORIGIN = _env_bool("SHOP_REQUIRE_CHECKOUT_ORIGIN", False)
CHECKOUT_ALLOWED_ORIGINS = set(
  _env_list("SHOP_CHECKOUT_ALLOWED_ORIGINS", getattr(settings, "CORS_ALLOWED_ORIGINS", []))
)
TURNSTILE_SECRET_KEY = os.getenv("SHOP_TURNSTILE_SECRET_KEY", "").strip()
REQUIRE_TURNSTILE = _env_bool("SHOP_REQUIRE_TURNSTILE", bool(TURNSTILE_SECRET_KEY))
TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

PRODUCT_FIELDS = """
id
title
handle
description
featuredImage {
  url
  altText
}
variants(first: 1) {
  nodes {
    id
    price {
      amount
      currencyCode
    }
  }
}
collections(first: 1) {
  nodes {
    handle
    title
  }
}
"""


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


def _is_valid_webhook_id(value):
  if not value:
    return False
  if len(value) > 128:
    return False
  return bool(re.fullmatch(r"[A-Za-z0-9_-]+", value))

def _is_valid_shop_domain(value):
  expected = str(STORE_DOMAIN or "").strip().lower()
  candidate = str(value or "").strip().lower()

  if not expected:
    logger.error("SHOPIFY_STORE_DOMAIN is not configured")
    return False

  return hmac.compare_digest(candidate, expected)


def _new_status_token():
  return secrets.token_urlsafe(24)


def _expire_stale_pending_checkouts():
  cutoff = timezone.now() - timedelta(minutes=PENDING_CHECKOUT_TTL_MINUTES)
  updated_count = PendingCheckout.objects.filter(
    status=PendingCheckout.STATUS_PENDING,
    created_at__lt=cutoff,
  ).update(
    status=PendingCheckout.STATUS_EXPIRED,
    updated_at=timezone.now(),
  )
  return int(updated_count)


def _purge_old_terminal_checkouts():
  cutoff = timezone.now() - timedelta(days=PENDING_CHECKOUT_RETENTION_DAYS)
  deleted_count, _ = PendingCheckout.objects.filter(
    status__in=[PendingCheckout.STATUS_CONFIRMED, PendingCheckout.STATUS_EXPIRED],
    updated_at__lt=cutoff,
  ).delete()
  return int(deleted_count)


def _purge_old_processed_webhooks():
  cutoff = timezone.now() - timedelta(days=WEBHOOK_EVENT_RETENTION_DAYS)
  deleted_count, _ = ProcessedWebhookEvent.objects.filter(created_at__lt=cutoff).delete()
  return int(deleted_count)


def _verify_shopify_webhook(request):
  if not SHOPIFY_WEBHOOK_SECRET:
    logger.error("SHOPIFY_WEBHOOK_SECRET is not configured")
    return False

  received_hmac = request.META.get("HTTP_X_SHOPIFY_HMAC_SHA256", "")
  if not received_hmac:
    return False

  digest = hmac.new(
    SHOPIFY_WEBHOOK_SECRET.encode("utf-8"),
    request.body,
    hashlib.sha256,
  ).digest()
  computed_hmac = base64.b64encode(digest).decode("utf-8")

  return hmac.compare_digest(computed_hmac, received_hmac)


def _extract_checkout_ref_from_order(order_payload):
  note_attributes = order_payload.get("note_attributes") or []
  for attribute in note_attributes:
    row = attribute or {}
    key = str(row.get("name") or row.get("key") or "").strip().lower()
    value = str(row.get("value") or "").strip()
    if key == "checkout_ref" and _is_valid_checkout_ref(value):
      return value

  note = str(order_payload.get("note") or "")
  fallback_match = re.search(r"checkout_ref[:=]\s*([A-Za-z0-9_-]+)", note, re.IGNORECASE)
  if fallback_match:
    candidate = fallback_match.group(1)
    if _is_valid_checkout_ref(candidate):
      return candidate

  return ""


def hello(request):
  return JsonResponse({"message": "Hello from Django API"})


def _shopify_config_ok():
  return bool(STORE_DOMAIN and STOREFRONT_TOKEN)


def _shopify_endpoint():
  return f"https://{STORE_DOMAIN}/api/{STOREFRONT_API_VERSION}/graphql.json"


def _shopify_graphql(query, variables=None):
  if not _shopify_config_ok():
    return None, "Shopify credentials are missing on server", 500

  payload = {
    "query": query,
    "variables": variables or {},
  }

  req = Request(
    _shopify_endpoint(),
    data=json.dumps(payload).encode("utf-8"),
    headers={
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": STOREFRONT_TOKEN,
    },
    method="POST",
  )

  try:
    with urlopen(req, timeout=20) as response:
      raw = response.read().decode("utf-8")
      body = json.loads(raw)
  except HTTPError as err:
    try:
      error_body = json.loads(err.read().decode("utf-8"))
    except Exception:
      error_body = {"error": "Shopify HTTP error"}
    return None, error_body, err.code
  except URLError:
    return None, {"error": "Could not reach Shopify API"}, 502
  except Exception:
    return None, {"error": "Unexpected Shopify API failure"}, 500

  if body.get("errors"):
    return None, body["errors"], 400

  return body.get("data", {}), None, 200


def _to_float(value, default=0.0):
  try:
    return float(value)
  except Exception:
    return default


def _map_product(node):
  if not node:
    return None

  variant_nodes = (node.get("variants") or {}).get("nodes") or []
  first_variant = variant_nodes[0] if variant_nodes else {}

  price_obj = first_variant.get("price") or {}
  price_amount = _to_float(price_obj.get("amount"), 0.0)
  currency = price_obj.get("currencyCode") or "EUR"

  featured_image = node.get("featuredImage") or {}
  collection_nodes = (node.get("collections") or {}).get("nodes") or []
  first_collection = collection_nodes[0] if collection_nodes else {}

  return {
    "id": node.get("id"),
    "title": node.get("title") or "",
    "handle": node.get("handle") or "",
    "description": node.get("description") or "",
    "imageUrl": featured_image.get("url") or "",
    "imageAlt": featured_image.get("altText") or "",
    "variantId": first_variant.get("id") or "",
    "price": price_amount,
    "currency": currency,
    "collectionHandle": first_collection.get("handle") or "",
    "collectionTitle": first_collection.get("title") or "",
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

  query = f"""
  query FeaturedProducts {{
    products(first: 12, sortKey: BEST_SELLING) {{
      nodes {{
        {PRODUCT_FIELDS}
      }}
    }}
  }}
  """

  data, error, status = _shopify_graphql(query)
  if error:
    logger.warning("Shopify error in shop_featured_products: status=%s error=%s", status, error)
    return _safe_shop_error("Could not load products right now.", status=502)

  products = [_map_product(node) for node in data.get("products", {}).get("nodes", [])]
  products = [item for item in products if item]

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

  query = """
  query Collections {
    collections(first: 24) {
      nodes {
        handle
        title
        description
      }
    }
  }
  """

  data, error, status = _shopify_graphql(query)
  if error:
    logger.warning("Shopify error in shop_collections: status=%s error=%s", status, error)
    return _safe_shop_error("Could not load collections right now.", status=502)

  collections = data.get("collections", {}).get("nodes", []) or []
  normalized = [
    {
      "handle": item.get("handle") or "",
      "title": item.get("title") or "",
      "description": item.get("description") or "",
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

  query = f"""
  query CollectionByHandle($handle: String!) {{
    collection(handle: $handle) {{
      handle
      title
      description
      products(first: 50) {{
        nodes {{
          {PRODUCT_FIELDS}
        }}
      }}
    }}
  }}
  """

  data, error, status = _shopify_graphql(query, {"handle": handle})
  if error:
    logger.warning(
      "Shopify error in shop_collection_detail: handle=%s status=%s error=%s",
      handle,
      status,
      error,
    )
    return _safe_shop_error("Could not load this collection right now.", status=502)

  collection = data.get("collection")
  if not collection:
    return _client_error(
      "Collection not found",
      status=404,
      log_message="Collection detail lookup returned no collection",
      handle=handle,
      ip=_client_ip(request),
      log_level="info",
    )

  products = [_map_product(node) for node in collection.get("products", {}).get("nodes", [])]
  products = [item for item in products if item]

  return JsonResponse(
    {
      "collection": {
        "handle": collection.get("handle") or "",
        "title": collection.get("title") or "",
        "description": collection.get("description") or "",
        "products": products,
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

  query = f"""
  query ProductByHandle($handle: String!) {{
    product(handle: $handle) {{
      {PRODUCT_FIELDS}
    }}
  }}
  """

  data, error, status = _shopify_graphql(query, {"handle": handle})
  if error:
    logger.warning(
      "Shopify error in shop_product_detail: handle=%s status=%s error=%s",
      handle,
      status,
      error,
    )
    return _safe_shop_error("Could not load this product right now.", status=502)

  product = _map_product(data.get("product"))
  if not product:
    return _client_error(
      "Product not found",
      status=404,
      log_message="Product detail lookup returned no product",
      handle=handle,
      ip=_client_ip(request),
      log_level="info",
    )

  return JsonResponse({"product": product})


@csrf_exempt
@require_POST
def shop_checkout_url(request):
  if not _is_allowed_checkout_origin(request):
    return _client_error(
      "Invalid request origin",
      status=403,
      log_message="Checkout blocked due to disallowed origin",
      origin=_request_origin(request),
      allowed_origins=sorted({_normalized_origin(item) for item in CHECKOUT_ALLOWED_ORIGINS if item}),
      ip=_client_ip(request),
    )

  if _is_rate_limited(request, "shop-checkout", limit=30, window_seconds=60):
    return _client_error(
      "Too many requests",
      status=429,
      log_message="Checkout rate limit exceeded",
      ip=_client_ip(request),
    )

  _expire_stale_pending_checkouts()
  _purge_old_terminal_checkouts()

  try:
    payload = json.loads(request.body.decode("utf-8") or "{}")
  except Exception:
    return _client_error(
      "Invalid JSON body",
      status=400,
      log_message="Checkout payload JSON parsing failed",
      ip=_client_ip(request),
    )

  items = payload.get("items") or []
  checkout_ref = str(payload.get("checkoutRef") or "").strip()
  anti_bot_token = str(payload.get("antiBotToken") or "").strip()

  if not _verify_turnstile_token(anti_bot_token, remote_ip=_client_ip(request)):
    return _client_error(
      "Bot verification failed",
      status=403,
      log_message="Turnstile verification failed for checkout",
      ip=_client_ip(request),
    )

  if not _is_valid_checkout_ref(checkout_ref):
    return _client_error(
      "Valid checkoutRef is required",
      status=400,
      log_message="Checkout rejected due to invalid checkoutRef",
      checkout_ref=checkout_ref,
      ip=_client_ip(request),
    )

  if not isinstance(items, list) or not items:
    return _client_error(
      "Items are required",
      status=400,
      log_message="Checkout rejected due to empty items list",
      checkout_ref=checkout_ref,
      ip=_client_ip(request),
    )

  lines = []
  for item in items:
    payload_item = item or {}

    variant_id = str(payload_item.get("variantId") or "").strip()
    quantity = _to_int(payload_item.get("quantity"), 0)

    if not variant_id.startswith("gid://shopify/ProductVariant/"):
      continue
    if quantity <= 0 or quantity > 99:
      continue

    lines.append({"merchandiseId": variant_id, "quantity": quantity})

  if not lines:
    return _client_error(
      "No valid checkout lines provided",
      status=400,
      log_message="Checkout rejected because all lines were invalid",
      checkout_ref=checkout_ref,
      item_count=len(items),
      ip=_client_ip(request),
    )

  status_token = _new_status_token()

  PendingCheckout.objects.update_or_create(
    checkout_ref=checkout_ref,
    defaults={
      "status_token": status_token,
      "status": PendingCheckout.STATUS_PENDING,
      "cart_payload": {"items": lines},
      "shopify_cart_id": "",
      "checkout_url": "",
      "confirmed_at": None,
    },
  )

  query = """
  mutation CreateCart($input: CartInput) {
    cartCreate(input: $input) {
      cart {
        id
        checkoutUrl
      }
      userErrors {
        field
        message
      }
    }
  }
  """

  cart_input = {
    "lines": lines,
    "attributes": [{"key": "checkout_ref", "value": checkout_ref}],
  }

  data, error, status = _shopify_graphql(query, {"input": cart_input})
  if error:
    logger.warning("Shopify error in shop_checkout_url: status=%s error=%s", status, error)
    return _safe_shop_error("Could not start checkout right now.", status=502)

  result = data.get("cartCreate") or {}
  user_errors = result.get("userErrors") or []
  if user_errors:
    return _client_error(
      "Checkout validation failed",
      status=400,
      log_message="Shopify returned checkout validation errors",
      checkout_ref=checkout_ref,
      user_errors=user_errors,
      ip=_client_ip(request),
    )

  cart = result.get("cart") or {}
  shopify_cart_id = str(cart.get("id") or "")
  checkout_url = str(cart.get("checkoutUrl") or "")
  if not checkout_url:
    return _client_error(
      "Checkout URL not returned",
      status=400,
      log_message="Shopify cartCreate response missing checkoutUrl",
      checkout_ref=checkout_ref,
      shopify_cart_id=shopify_cart_id,
      ip=_client_ip(request),
    )

  PendingCheckout.objects.filter(checkout_ref=checkout_ref).update(
    shopify_cart_id=shopify_cart_id,
    checkout_url=checkout_url,
  )

  return JsonResponse(
    {
      "checkoutUrl": checkout_url,
      "statusToken": status_token,
    }
  )


@require_GET
def shop_checkout_status(request):
  if _is_rate_limited(request, "shop-status", limit=120, window_seconds=60):
    return _client_error(
      "Too many requests",
      status=429,
      log_message="Checkout status rate limit exceeded",
      ip=_client_ip(request),
    )

  _expire_stale_pending_checkouts()
  _purge_old_terminal_checkouts()

  checkout_ref = str(request.GET.get("checkoutRef") or "").strip()
  status_token = str(request.GET.get("statusToken") or "").strip()

  if not _is_valid_checkout_ref(checkout_ref):
    return _client_error(
      "Valid checkoutRef is required",
      status=400,
      log_message="Checkout status rejected due to invalid checkoutRef",
      checkout_ref=checkout_ref,
      ip=_client_ip(request),
    )
  if not _is_valid_status_token(status_token):
    return _client_error(
      "Valid statusToken is required",
      status=400,
      log_message="Checkout status rejected due to invalid status token",
      checkout_ref=checkout_ref,
      ip=_client_ip(request),
    )

  checkout = PendingCheckout.objects.filter(
    checkout_ref=checkout_ref,
    status_token=status_token,
  ).first()
  if not checkout:
    return _client_error(
      "Checkout not found",
      status=404,
      log_message="Checkout status lookup returned no record",
      checkout_ref=checkout_ref,
      ip=_client_ip(request),
      log_level="info",
    )

  confirmed_at = checkout.confirmed_at.isoformat() if checkout.confirmed_at else None
  return JsonResponse(
    {
      "checkoutRef": checkout.checkout_ref,
      "status": checkout.status,
      "confirmedAt": confirmed_at,
    }
  )


@csrf_exempt
@require_POST
def shopify_orders_create_webhook(request):
  _expire_stale_pending_checkouts()
  _purge_old_processed_webhooks()

  if not _verify_shopify_webhook(request):
    return _client_error(
      "Invalid webhook signature",
      status=401,
      log_message="Webhook rejected due to invalid signature",
      ip=_client_ip(request),
    )

  shop_domain = str(request.META.get("HTTP_X_SHOPIFY_SHOP_DOMAIN", "")).strip()
  if not _is_valid_shop_domain(shop_domain):
    return _client_error(
      "Invalid webhook shop domain",
      status=401,
      log_message="Webhook rejected due to shop domain mismatch",
      shop_domain=shop_domain,
      ip=_client_ip(request),
    )

  webhook_id = str(request.META.get("HTTP_X_SHOPIFY_WEBHOOK_ID", "")).strip()
  topic = str(request.META.get("HTTP_X_SHOPIFY_TOPIC", "")).strip()

  if not _is_valid_webhook_id(webhook_id):
    return _client_error(
      "Missing or invalid webhook id",
      status=400,
      log_message="Webhook rejected due to missing or malformed webhook id",
      webhook_id=webhook_id,
      topic=topic,
      ip=_client_ip(request),
    )

  event, created = ProcessedWebhookEvent.objects.get_or_create(
    webhook_id=webhook_id,
    defaults={"topic": topic},
  )
  if not created:
    logger.info("Duplicate webhook ignored: id=%s topic=%s", webhook_id, event.topic)
    return JsonResponse({"ok": True, "duplicate": True})

  try:
    order_payload = json.loads(request.body.decode("utf-8") or "{}")
  except Exception:
    return _client_error(
      "Invalid JSON body",
      status=400,
      log_message="Webhook payload JSON parsing failed",
      webhook_id=webhook_id,
      topic=topic,
      ip=_client_ip(request),
    )

  checkout_ref = _extract_checkout_ref_from_order(order_payload)
  if not checkout_ref:
    return JsonResponse({"ok": True})

  updated_count = PendingCheckout.objects.filter(
    checkout_ref=checkout_ref
  ).exclude(status=PendingCheckout.STATUS_CONFIRMED).update(
    status=PendingCheckout.STATUS_CONFIRMED,
    confirmed_at=timezone.now(),
    updated_at=timezone.now(),
  )

  logger.info(
    "Processed orders/create webhook for checkout_ref=%s updated=%s webhook_id=%s shop_domain=%s",
    checkout_ref,
    bool(updated_count),
    webhook_id,
    shop_domain,
  )
  return JsonResponse({"ok": True})

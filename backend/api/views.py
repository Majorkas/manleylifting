import json
import logging
import os
import re
import secrets
from datetime import timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from urllib.parse import urlparse
import stripe

from django.core.cache import cache
from django.conf import settings
from django.db import transaction
from django.middleware.csrf import get_token
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from .models import (
  CatalogCollection,
  CatalogProduct,
  Company,
  GuestOrderClaim,
  InventoryReservation,
  InventoryTransaction,
  OnsiteOrder,
  OrderItem,
  ProcessedStripeEvent,
  UserProfile,
)
from .pricing import UnsupportedDestinationError, calculate_checkout_totals
from .order_emails import send_order_confirmation_email, send_order_refunded_email
from .capability_tokens import digest_capability_token
from .authentication import AccountJWTAuthentication
from .request_security import client_ip as _client_ip
from .turnstile import verify_turnstile_token
from rest_framework.exceptions import AuthenticationFailed

STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "").strip()
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
STRIPE_CURRENCY = os.getenv("STRIPE_CURRENCY", "eur").strip().lower() or "eur"
logger = logging.getLogger(__name__)
STRIPE_CLIENT = stripe.StripeClient(api_key=STRIPE_SECRET_KEY) if STRIPE_SECRET_KEY else None


def _get_stripe_client():
  if STRIPE_CLIENT is not None:
    return STRIPE_CLIENT
  if STRIPE_SECRET_KEY:
    return stripe.StripeClient(api_key=STRIPE_SECRET_KEY)
  return None


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
STATUS_TOKEN_TTL_DAYS = max(1, _env_int("SHOP_STATUS_TOKEN_TTL_DAYS", 7))
ENFORCE_CHECKOUT_ORIGIN = _env_bool("SHOP_ENFORCE_CHECKOUT_ORIGIN", not bool(getattr(settings, "DEBUG", False)))
REQUIRE_CHECKOUT_ORIGIN = _env_bool("SHOP_REQUIRE_CHECKOUT_ORIGIN", False)
CHECKOUT_ALLOWED_ORIGINS = set(
  _env_list("SHOP_CHECKOUT_ALLOWED_ORIGINS", getattr(settings, "CORS_ALLOWED_ORIGINS", []))
)
TURNSTILE_SECRET_KEY = str(getattr(settings, "SHOP_TURNSTILE_SECRET_KEY", "") or "").strip()
REQUIRE_TURNSTILE = bool(getattr(settings, "SHOP_REQUIRE_TURNSTILE", not bool(getattr(settings, "DEBUG", False))))


@ensure_csrf_cookie
@require_GET
def csrf_seed(request):
  return JsonResponse({"ok": True, "csrf_token": get_token(request)})


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
  return verify_turnstile_token(
    token,
    required=REQUIRE_TURNSTILE,
    secret_key=TURNSTILE_SECRET_KEY,
    remote_ip=remote_ip,
  )


def _is_valid_checkout_ref(value):
  if not value:
    return False
  if len(value) > 100:
    return False
  return bool(re.fullmatch(r"[A-Za-z0-9_-]+", value))


def _is_valid_status_token(value):
  if not value:
    return False
  if len(value) < 32 or len(value) > 128:
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
  return bool(re.fullmatch(r"pi_[A-Za-z0-9_]+", text))


def _to_minor_units(amount):
  try:
    value = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
  except (InvalidOperation, TypeError, ValueError):
    return 0
  if value <= 0:
    return 0
  return int(value * 100)


def _build_line_items_from_catalog(items):
  if not isinstance(items, list):
    return [], "Items are required"

  valid_rows = []
  quantities_by_variant = {}
  variant_ids = []
  for item in items:
    row = item or {}
    variant_id = str(row.get("variantId") or "").strip()
    quantity = _to_int(row.get("quantity"), 0)

    if not variant_id:
      continue
    if quantity <= 0 or quantity > 99:
      continue

    if variant_id not in quantities_by_variant:
      quantities_by_variant[variant_id] = 0
      variant_ids.append(variant_id)
    quantities_by_variant[variant_id] += quantity

  valid_rows = [
    {"variantId": variant_id, "quantity": quantity}
    for variant_id, quantity in quantities_by_variant.items()
  ]

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
    if product.stock_policy == CatalogProduct.STOCK_POLICY_UNAVAILABLE:
      return [], "One or more checkout items are unavailable"

    unit_amount_cents = _to_minor_units(product.price_amount)
    if unit_amount_cents <= 0:
      return [], "One or more checkout items are no longer available"

    currency = str(product.currency_code or STRIPE_CURRENCY).strip().upper()
    quantity = int(row["quantity"])
    line_items.append(
      {
        "sku": str(product.sku or product.variant_ref).strip(),
        "variantId": product.variant_ref,
        "variantRef": product.variant_ref,
        "title": str(product.title or "Product").strip(),
        "variantTitle": str(product.variant_title or "").strip(),
        "quantity": quantity,
        "currency": currency,
        "unitAmountCents": unit_amount_cents,
        "lineTotalCents": unit_amount_cents * quantity,
      }
    )

  return line_items, ""


class PaymentIntentVerificationError(ValueError):
  pass


def _populate_order_items_and_reservations(order):
  """
  Create OrderItem snapshots and InventoryReservations from order's line_items.
  Called after order is created during checkout.
  Idempotent: only creates items/reservations if they don't already exist.
  """
  if not order.line_items:
    return True, "No line items to process"

  # Check if OrderItems already exist (idempotent)
  existing_count = OrderItem.objects.filter(order=order).count()
  if existing_count > 0:
    return True, f"Order already has {existing_count} OrderItems, skipping"

  for line_item in order.line_items:
    sku = str(line_item.get("sku") or line_item.get("variantId") or "").strip()
    title = str(line_item.get("title") or "").strip()
    variant_ref = str(line_item.get("variantRef") or line_item.get("variantId") or "").strip()
    unit_price_cents = int(line_item.get("unitAmountCents") or 0)
    quantity = int(line_item.get("quantity") or 0)
    line_total_cents = int(line_item.get("lineTotalCents") or 0)

    if not sku or quantity <= 0 or line_total_cents != unit_price_cents * quantity:
      raise ValueError(f"Invalid line item for order {order.order_number}")

    product = CatalogProduct.objects.select_for_update().filter(variant_ref=variant_ref, is_active=True).first()
    if product is None:
      raise ValueError(f"Product {variant_ref} is no longer available")
    if product.stock_policy == CatalogProduct.STOCK_POLICY_UNAVAILABLE:
      raise ValueError(f"Product {variant_ref} is no longer available")
    inventory_tracked = product.inventory_tracked or product.stock_policy == CatalogProduct.STOCK_POLICY_FINITE
    if inventory_tracked and product.available_qty - product.reserved_qty < quantity:
      raise ValueError(f"Insufficient inventory for product {variant_ref}")

    OrderItem.objects.create(
      order=order,
      sku=sku,
      title=title,
      variant_ref=variant_ref,
      unit_price_cents=unit_price_cents,
      quantity=quantity,
      line_total_cents=line_total_cents,
        weight_grams=product.weight_grams,
        shipping_class=product.shipping_class,
        tax_code=product.tax_code,
    )
    InventoryReservation.objects.create(
      order=order,
      product=product,
      quantity=quantity,
      status=InventoryReservation.STATUS_RESERVED,
      expires_at=timezone.now() + timedelta(minutes=30),
    )
    if inventory_tracked:
      product.reserved_qty += quantity
      product.save(update_fields=["reserved_qty", "updated_at"])

  return True, "OrderItems and InventoryReservations created successfully"


def _populate_financial_totals(order, totals=None):
  """
  Calculate and populate financial breakdown fields (subtotal, discount, shipping, tax).
  For now, calculates subtotal from line_items and leaves other fields for future use.
  """
  if not order.line_items:
    return

  subtotal_cents = sum(int(item.get("lineTotalCents") or 0) for item in order.line_items)
  order.subtotal_cents = int((totals or {}).get("subtotal_cents", subtotal_cents))
  order.discount_cents = int((totals or {}).get("discount_cents", 0))
  order.shipping_cents = int((totals or {}).get("shipping_cents", 0))
  order.tax_cents = int((totals or {}).get("tax_cents", 0))
  is_valid, error_msg = order.validate_financial_totals()
  if not is_valid:
    raise ValueError(error_msg)


def _release_order_reservations(order):
  for reservation in InventoryReservation.objects.select_for_update().select_related("product").filter(
    order=order,
    status=InventoryReservation.STATUS_RESERVED,
  ):
    product = CatalogProduct.objects.select_for_update().get(pk=reservation.product_id)
    product.reserved_qty = max(0, product.reserved_qty - reservation.quantity)
    product.save(update_fields=["reserved_qty", "updated_at"])
    reservation.status = InventoryReservation.STATUS_RELEASED
    reservation.released_at = timezone.now()
    reservation.save(update_fields=["status", "released_at"])
    InventoryTransaction.objects.create(
      product=product,
      order=order,
      transaction_type=InventoryTransaction.TYPE_RETURN,
      quantity_change=reservation.quantity,
      reason="Payment canceled or failed",
    )




def _set_onsite_order_from_payment_intent(payment_intent, status):
  if isinstance(payment_intent, dict):
    intent_id = str(payment_intent.get("id") or "").strip()
  else:
    intent_id = str(getattr(payment_intent, "id", "") or "").strip()
  if not _is_valid_payment_intent_id(intent_id):
    raise PaymentIntentVerificationError("Invalid PaymentIntent identifier")

  intent_amount = _to_int(_stripe_field(payment_intent, "amount", None), -1)
  intent_currency = str(_stripe_field(payment_intent, "currency", "") or "").strip().upper()
  intent_metadata = _stripe_field(payment_intent, "metadata", {}) or {}
  intent_checkout_ref = str(_stripe_field(intent_metadata, "checkout_ref", "") or "").strip()

  order = OnsiteOrder.objects.select_for_update().filter(payment_intent_id=intent_id).first()
  if order is None and intent_checkout_ref:
    order = OnsiteOrder.objects.select_for_update().filter(
      checkout_ref=intent_checkout_ref,
      payment_intent_id="",
      status=OnsiteOrder.STATUS_PENDING,
    ).first()
  if order is None:
    raise PaymentIntentVerificationError("PaymentIntent does not match a local order")

  if intent_amount != order.amount_total_cents:
    raise PaymentIntentVerificationError("PaymentIntent amount does not match the local order")
  if intent_currency != str(order.currency or "").strip().upper():
    raise PaymentIntentVerificationError("PaymentIntent currency does not match the local order")
  if intent_checkout_ref != order.checkout_ref:
    raise PaymentIntentVerificationError("PaymentIntent metadata does not match the local order")

  if not order.payment_intent_id:
    order.payment_intent_id = intent_id

  fulfillment_started_statuses = {
    OnsiteOrder.STATUS_PAID,
    OnsiteOrder.STATUS_SHIPPED,
    OnsiteOrder.STATUS_COMPLETED,
  }
  if order.status in fulfillment_started_statuses and order.status != status:
    logger.warning(
      "Ignored regressive PaymentIntent transition for order %s: %s -> %s",
      order.order_number,
      order.status,
      status,
    )
    return order

  order.status = status
  update_fields = ["status", "payment_intent_id", "updated_at"]
  if status == OnsiteOrder.STATUS_PAID:
    order.paid_at = timezone.now()
    update_fields.append("paid_at")

  order.payment_status = order.get_payment_status_from_legacy()
  update_fields.append("payment_status")
  if status in {OnsiteOrder.STATUS_FAILED, OnsiteOrder.STATUS_CANCELED}:
    _release_order_reservations(order)
    order.fulfillment_status = OnsiteOrder.FULFILLMENT_STATUS_CANCELED
    order.canceled_at = timezone.now()
    update_fields.extend(["fulfillment_status", "canceled_at"])

  order.save(update_fields=update_fields)
  if status == OnsiteOrder.STATUS_PAID:
    transaction.on_commit(lambda: send_order_confirmation_email(order=order), robust=True)
  return order


def _set_onsite_order_from_charge(charge, payment_status):
  payment_intent_id = str(_stripe_field(charge, "payment_intent", "") or "").strip()
  if not _is_valid_payment_intent_id(payment_intent_id):
    raise PaymentIntentVerificationError("Charge does not contain a valid PaymentIntent identifier")
  order = OnsiteOrder.objects.select_for_update().filter(payment_intent_id=payment_intent_id).first()
  if order is None:
    raise PaymentIntentVerificationError("Charge does not match a local order")
  currency = str(_stripe_field(charge, "currency", "") or "").strip().upper()
  if currency != str(order.currency or "").strip().upper():
    raise PaymentIntentVerificationError("Charge currency does not match the local order")
  refunded_cents = _to_int(_stripe_field(charge, "amount_refunded", None), -1)
  if refunded_cents < 0 or refunded_cents > order.amount_total_cents:
    raise PaymentIntentVerificationError("Refund amount does not match the local order")
  order.refund_total_cents = refunded_cents
  order.payment_status = payment_status
  order.save(update_fields=["refund_total_cents", "payment_status", "updated_at"])
  if payment_status == OnsiteOrder.PAYMENT_STATUS_REFUNDED:
    transaction.on_commit(lambda: send_order_refunded_email(order=order), robust=True)
  return order


def _set_onsite_order_from_dispute(dispute, payment_status):
  payment_intent_id = str(_stripe_field(dispute, "payment_intent", "") or "").strip()
  if not _is_valid_payment_intent_id(payment_intent_id):
    raise PaymentIntentVerificationError("Dispute does not contain a valid PaymentIntent identifier")
  order = OnsiteOrder.objects.select_for_update().filter(payment_intent_id=payment_intent_id).first()
  if order is None:
    raise PaymentIntentVerificationError("Dispute does not match a local order")
  order.payment_status = payment_status
  order.save(update_fields=["payment_status", "updated_at"])
  return order


def _stripe_field(obj, name, default=None):
  if isinstance(obj, dict):
    return obj.get(name, default)
  return getattr(obj, name, default)


def hello(request):
  return JsonResponse({"message": "Hello from Django API"})


@require_GET
def health_check(request):
  try:
    from django.db import connection
    with connection.cursor() as cursor:
      cursor.execute("SELECT 1")
    database_ok = "ok"
  except Exception:
    database_ok = "error"

  try:
    cache.set("health-check", "ok", timeout=5)
    cache_ok = "ok" if cache.get("health-check") == "ok" else "error"
  except Exception:
    cache_ok = "error"

  status = "ok" if database_ok == "ok" and cache_ok == "ok" else "degraded"
  return JsonResponse({
    "status": status,
    "checks": {
      "database": database_ok,
      "cache": cache_ok,
    },
  })


@require_GET
def readiness_check(request):
  health = health_check(request)
  payload = json.loads(health.content.decode("utf-8"))
  stripe_status = "configured" if STRIPE_SECRET_KEY else "not_configured"
  payload["status"] = "ready" if payload["status"] == "ok" else "not_ready"
  payload["checks"]["stripe"] = stripe_status
  return JsonResponse(payload)


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
    "stockPolicy": CatalogProduct.STOCK_POLICY_FINITE,
    "inventoryTracked": True,
    "availableQty": max(0, int(product.available_qty or 0) - int(product.reserved_qty or 0)),
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

  collections = CatalogCollection.objects.filter(is_active=True).prefetch_related("products")[:24]
  normalized = [
    {
      "handle": item.handle or "",
      "title": item.title or "",
      "description": item.description or "",
      "productCount": sum(1 for product in item.products.all() if product.is_active),
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


def _coerce_shipping_field(payload, *candidate_names):
  for name in candidate_names:
    value = payload.get(name)
    if value is None:
      continue
    text = str(value or "").strip()
    if text:
      return text
  return ""


def _optional_checkout_user(request):
  authorization = str(request.META.get("HTTP_AUTHORIZATION", "") or "").strip()
  if not authorization:
    return None
  result = AccountJWTAuthentication().authenticate(request)
  return result[0] if result else None


def _resolve_checkout_company(user, company_id):
  if company_id in (None, ""):
    return None
  if user is None:
    raise PermissionError("An authenticated user is required for company checkout")
  try:
    normalized_company_id = int(company_id)
  except (TypeError, ValueError):
    raise PermissionError("Company is not available for checkout")
  company = Company.objects.filter(pk=normalized_company_id, is_active=True).first()
  if company is None:
    raise PermissionError("Company is not available for checkout")
  profile = UserProfile.objects.filter(user=user).first()
  if profile is None or not profile.allowed_companies.filter(pk=company.pk).exists():
    raise PermissionError("User is not authorized for this company")
  return company


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
  shipping = payload.get("shipping") or {}
  shipping_name = _coerce_shipping_field(shipping, "name", "recipientName")
  shipping_phone = _coerce_shipping_field(shipping, "phone", "recipientPhone")
  shipping_address_line_1 = _coerce_shipping_field(shipping, "addressLine1", "address_line_1")
  shipping_address_line_2 = _coerce_shipping_field(shipping, "addressLine2", "address_line_2")
  shipping_city = _coerce_shipping_field(shipping, "city")
  shipping_county = _coerce_shipping_field(shipping, "county")
  shipping_postcode = _coerce_shipping_field(shipping, "postcode")
  shipping_country_code = _coerce_shipping_field(shipping, "countryCode", "country_code")
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
  checkout_totals = None
  if shipping_country_code:
    try:
      checkout_totals = calculate_checkout_totals(
        line_items,
        country_code=shipping_country_code,
        postcode=shipping_postcode,
      )
    except UnsupportedDestinationError as error:
      return _client_error(str(error), status=400)
    amount_total = checkout_totals["amount_total_cents"]
  elif any(
    value
    for value in (
      shipping_name,
      shipping_phone,
      shipping_address_line_1,
      shipping_address_line_2,
      shipping_city,
      shipping_county,
      shipping_postcode,
    )
  ):
    return _client_error("A supported shipping country is required", status=400)

  status_token = str(payload.get("statusToken") or "").strip() or _new_status_token()
  claim_token = str(payload.get("claimToken") or "").strip() or secrets.token_urlsafe(24)
  previous_status_token = str(payload.get("previousStatusToken") or "").strip()
  rotate_status_token = payload.get("rotateStatusToken") is True
  if not _is_valid_status_token(status_token) or not _is_valid_status_token(claim_token):
    return _client_error("Valid checkout capability tokens are required", status=400)
  status_token_digest = digest_capability_token(status_token)
  previous_status_token_digest = (
    digest_capability_token(previous_status_token)
    if _is_valid_status_token(previous_status_token)
    else ""
  )

  try:
    authenticated_user = _optional_checkout_user(request)
  except AuthenticationFailed:
    return _client_error("Authentication failed", status=401)
  try:
    checkout_company = _resolve_checkout_company(authenticated_user, payload.get("companyId"))
  except PermissionError as error:
    return _client_error(str(error), status=403)

  order_defaults = {
    "status_token": status_token_digest,
    "status_token_expires_at": timezone.now() + timedelta(days=STATUS_TOKEN_TTL_DAYS),
    "status": OnsiteOrder.STATUS_PENDING,
    "user": authenticated_user,
    "company": checkout_company,
    "line_items": line_items,
    "amount_total_cents": amount_total,
    "currency": currency.upper(),
    "customer_name": customer_name,
    "customer_email": customer_email,
    "shipping_name": shipping_name,
    "shipping_phone": shipping_phone,
    "shipping_address_line_1": shipping_address_line_1,
    "shipping_address_line_2": shipping_address_line_2,
    "shipping_city": shipping_city,
    "shipping_county": shipping_county,
    "shipping_postcode": shipping_postcode,
    "shipping_country_code": shipping_country_code,
    "payment_intent_id": "",
    "paid_at": None,
  }

  with transaction.atomic():
    order, created = OnsiteOrder.objects.select_for_update().get_or_create(
      checkout_ref=checkout_ref,
      defaults=order_defaults,
    )
    if not created:
      status_token_matches = order.status_token == status_token_digest
      rotation_authorized = (
        rotate_status_token
        and bool(previous_status_token_digest)
        and order.status_token == previous_status_token_digest
      )
      immutable_matches = (
        order.status == OnsiteOrder.STATUS_PENDING
        and order.status_token_revoked_at is None
        and (status_token_matches or rotation_authorized)
        and order.user_id == getattr(authenticated_user, "id", None)
        and order.company_id == getattr(checkout_company, "id", None)
        and order.line_items == line_items
        and order.amount_total_cents == amount_total
        and str(order.currency or "").upper() == currency.upper()
        and order.customer_name == customer_name
        and order.customer_email == customer_email
        and order.shipping_name == shipping_name
        and order.shipping_phone == shipping_phone
        and order.shipping_address_line_1 == shipping_address_line_1
        and order.shipping_address_line_2 == shipping_address_line_2
        and order.shipping_city == shipping_city
        and order.shipping_county == shipping_county
        and order.shipping_postcode == shipping_postcode
        and order.shipping_country_code == shipping_country_code
      )
      if not immutable_matches:
        return _client_error("Checkout reference is already in use", status=409)

    claim, claim_created = GuestOrderClaim.objects.select_for_update().get_or_create(
      order=order,
      defaults={
        "claim_token": digest_capability_token(claim_token),
        "claim_state": GuestOrderClaim.STATE_PENDING,
        "claimed_by": None,
        "claimed_at": None,
        "expires_at": timezone.now() + timedelta(days=7),
      },
    )
    if not claim_created:
      if (
        claim.claim_state != GuestOrderClaim.STATE_PENDING
        or claim.claim_token != digest_capability_token(claim_token)
      ):
        return _client_error("Checkout reference is already in use", status=409)

    if not created and order.status_token != status_token_digest:
      order.status_token = status_token_digest
      order.status_token_expires_at = timezone.now() + timedelta(days=STATUS_TOKEN_TTL_DAYS)
      order.save(update_fields=["status_token", "status_token_expires_at", "updated_at"])

    if created:
      try:
        _populate_order_items_and_reservations(order)
        _populate_financial_totals(order, checkout_totals)
      except ValueError as error:
        transaction.set_rollback(True)
        return _client_error(str(error), status=409)
      order.payment_status = OnsiteOrder.PAYMENT_STATUS_PENDING
      order.fulfillment_status = OnsiteOrder.FULFILLMENT_STATUS_UNFULFILLED
      order.save(
        update_fields=[
          "payment_status",
          "fulfillment_status",
          "subtotal_cents",
          "discount_cents",
          "shipping_cents",
          "tax_cents",
          "updated_at",
        ]
      )

  client = _get_stripe_client()
  try:
    if client is not None and hasattr(client, "v1") and hasattr(client.v1, "payment_intents"):
      intent = client.v1.payment_intents.create(
        amount=amount_total,
        currency=currency,
        automatic_payment_methods={"enabled": True},
        idempotency_key=f"onsite:{checkout_ref}",
        receipt_email=customer_email,
        metadata={
          "checkout_ref": checkout_ref,
        },
      )
    else:
      intent = stripe.PaymentIntent.create(
        amount=amount_total,
        currency=currency,
        automatic_payment_methods={"enabled": True},
        idempotency_key=f"onsite:{checkout_ref}",
        receipt_email=customer_email,
        metadata={
          "checkout_ref": checkout_ref,
        },
      )
  except Exception as error:
    logger.error(
      "Failed to create Stripe PaymentIntent provider_error_type=%s",
      type(error).__name__,
    )
    return _safe_shop_error("Could not start payment right now.", status=502)

  payment_intent_id = str(_stripe_field(intent, "id", "") or "")
  client_secret = str(_stripe_field(intent, "client_secret", "") or "")
  if not _is_valid_payment_intent_id(payment_intent_id) or not client_secret:
    logger.error("Stripe response missing expected payment intent fields")
    return _safe_shop_error("Could not start payment right now.", status=502)

  with transaction.atomic():
    order = OnsiteOrder.objects.select_for_update().get(pk=order.pk)
    if order.payment_intent_id and order.payment_intent_id != payment_intent_id:
      logger.error("Stripe idempotency mismatch for checkout %s", checkout_ref)
      return _safe_shop_error("Could not start payment right now.", status=502)
    if not order.payment_intent_id:
      order.payment_intent_id = payment_intent_id
      order.save(update_fields=["payment_intent_id", "updated_at"])

  refresh_notice = (
    "We refreshed your order with the latest pricing and stock availability."
    if not created
    else ""
  )

  return JsonResponse(
    {
      "checkoutRef": checkout_ref,
      "orderNumber": getattr(order, "order_number", ""),
      "claimToken": claim_token,
      "statusToken": status_token,
      "clientSecret": client_secret,
      "paymentIntentId": payment_intent_id,
      "amountTotalCents": amount_total,
      "currency": currency.upper(),
      "lineItems": line_items,
      "subtotalCents": order.subtotal_cents,
      "discountCents": order.discount_cents,
      "shippingCents": order.shipping_cents,
      "taxCents": order.tax_cents,
      "priceRefreshNotice": refresh_notice,
    }
  )


@require_POST
def onsite_checkout_status(request):
  if _is_rate_limited(request, "onsite-status", limit=120, window_seconds=60):
    return _client_error("Too many requests", status=429)

  try:
    payload = json.loads(request.body.decode("utf-8") or "{}")
  except (UnicodeDecodeError, json.JSONDecodeError):
    return _client_error("Invalid JSON body", status=400)

  checkout_ref = str(payload.get("checkoutRef") or "").strip()
  status_token = str(payload.get("statusToken") or "").strip()

  if not _is_valid_checkout_ref(checkout_ref):
    return _client_error("Valid checkoutRef is required", status=400)
  if not _is_valid_status_token(status_token):
    return _client_error("Valid statusToken is required", status=400)

  order = OnsiteOrder.objects.filter(
    checkout_ref=checkout_ref,
    status_token=digest_capability_token(status_token),
  ).first()
  if not order or (
    order.status_token_expires_at and order.status_token_expires_at <= timezone.now()
  ) or order.status_token_revoked_at:
    return _client_error("Checkout not found", status=404)

  if (
    order.status in {OnsiteOrder.STATUS_PENDING, OnsiteOrder.STATUS_PROCESSING}
    and order.payment_intent_id
    and _stripe_config_ok()
  ):
    try:
      client = _get_stripe_client()
      if client is not None and hasattr(client, "v1") and hasattr(client.v1, "payment_intents"):
        payment_intent = client.v1.payment_intents.retrieve(order.payment_intent_id)
      else:
        payment_intent = stripe.PaymentIntent.retrieve(order.payment_intent_id)
      provider_status = str(_stripe_field(payment_intent, "status", "") or "").strip().lower()
      status_map = {
        "succeeded": OnsiteOrder.STATUS_PAID,
        "canceled": OnsiteOrder.STATUS_CANCELED,
        "requires_payment_method": OnsiteOrder.STATUS_FAILED,
        "requires_action": OnsiteOrder.STATUS_FAILED,
      }
      next_status = status_map.get(provider_status)
      if next_status:
        with transaction.atomic():
          _set_onsite_order_from_payment_intent(payment_intent, next_status)
        order.refresh_from_db()
    except Exception:
      logger.warning("Stripe status reconciliation failed for order %s", order.order_number)

  return JsonResponse(
    {
      "checkoutRef": order.checkout_ref,
      "orderNumber": order.order_number,
      "status": order.status,
      "paymentStatus": order.payment_status or order.get_payment_status_from_legacy(),
      "fulfillmentStatus": order.fulfillment_status or order.get_fulfillment_status_from_legacy(),
      "paidAt": order.paid_at.isoformat() if order.paid_at else None,
      "amountTotalCents": order.amount_total_cents,
      "currency": order.currency,
    }
  )


@require_POST
def onsite_order_summary(request):
  if _is_rate_limited(request, "onsite-order-summary", limit=120, window_seconds=60):
    return _client_error("Too many requests", status=429)

  try:
    payload = json.loads(request.body.decode("utf-8") or "{}")
  except (UnicodeDecodeError, json.JSONDecodeError):
    return _client_error("Invalid JSON body", status=400)

  checkout_ref = str(payload.get("checkoutRef") or "").strip()
  status_token = str(payload.get("statusToken") or "").strip()

  if not _is_valid_checkout_ref(checkout_ref):
    return _client_error("Valid checkoutRef is required", status=400)
  if not _is_valid_status_token(status_token):
    return _client_error("Valid statusToken is required", status=400)

  order = OnsiteOrder.objects.filter(
    checkout_ref=checkout_ref,
    status_token=digest_capability_token(status_token),
  ).first()
  if not order or (
    order.status_token_expires_at and order.status_token_expires_at <= timezone.now()
  ) or order.status_token_revoked_at:
    return _client_error("Checkout not found", status=404)

  return JsonResponse(
    {
      "checkoutRef": order.checkout_ref,
      "orderNumber": order.order_number,
      "status": order.status,
      "paymentStatus": order.payment_status or order.get_payment_status_from_legacy(),
      "fulfillmentStatus": order.fulfillment_status or order.get_fulfillment_status_from_legacy(),
      "customerName": order.customer_name,
      "customerEmail": order.customer_email,
      "lineItems": order.line_items,
      "orderItems": [
        {
          "sku": item.sku,
          "title": item.title,
          "variantRef": item.variant_ref,
          "unitPriceCents": item.unit_price_cents,
          "quantity": item.quantity,
          "lineTotalCents": item.line_total_cents,
        }
        for item in order.order_items.all()
      ],
      "amountTotalCents": order.amount_total_cents,
      "subtotalCents": order.subtotal_cents,
      "discountCents": order.discount_cents,
      "shippingCents": order.shipping_cents,
      "taxCents": order.tax_cents,
      "currency": order.currency,
      "paidAt": order.paid_at.isoformat() if order.paid_at else None,
      "createdAt": order.created_at.isoformat() if order.created_at else None,
      "shippingName": order.shipping_name,
      "shippingPhone": order.shipping_phone,
      "shippingAddressLine1": order.shipping_address_line_1,
      "shippingAddressLine2": order.shipping_address_line_2,
      "shippingCity": order.shipping_city,
      "shippingCounty": order.shipping_county,
      "shippingPostcode": order.shipping_postcode,
      "shippingCountryCode": order.shipping_country_code,
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

  event_type = str(_stripe_field(event, "type", "") or "")
  handled_event_types = {
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "payment_intent.canceled",
    "charge.refunded",
    "charge.dispute.created",
    "charge.dispute.closed",
  }
  if event_type not in handled_event_types:
    return JsonResponse({"ok": True, "skipped": True})

  event_data = _stripe_field(event, "data", {}) or {}
  intent = _stripe_field(event_data, "object", {}) or {}

  event_record, created = ProcessedStripeEvent.objects.get_or_create(
    event_id=event_id,
    defaults={
      "event_type": event_type.strip(),
      "status": ProcessedStripeEvent.STATUS_PROCESSING,
      "attempts": 0,
    },
  )
  if not created and event_record.status in {
    ProcessedStripeEvent.STATUS_PROCESSED,
    ProcessedStripeEvent.STATUS_REJECTED,
  }:
    return JsonResponse({"ok": True, "duplicate": True})

  event_record.attempts += 1
  event_record.status = ProcessedStripeEvent.STATUS_PROCESSING
  event_record.error_message = ""
  event_record.save(update_fields=["attempts", "status", "error_message"])

  try:
    with transaction.atomic():
      if event_type == "payment_intent.succeeded":
        _set_onsite_order_from_payment_intent(intent, OnsiteOrder.STATUS_PAID)
      elif event_type == "payment_intent.payment_failed":
        _set_onsite_order_from_payment_intent(intent, OnsiteOrder.STATUS_FAILED)
      elif event_type == "payment_intent.canceled":
        _set_onsite_order_from_payment_intent(intent, OnsiteOrder.STATUS_CANCELED)
      elif event_type == "charge.refunded":
        refunded_cents = _to_int(_stripe_field(intent, "amount_refunded", None), -1)
        status = (
          OnsiteOrder.PAYMENT_STATUS_REFUNDED
          if refunded_cents == _to_int(_stripe_field(intent, "amount", None), -2)
          else OnsiteOrder.PAYMENT_STATUS_PARTIALLY_REFUNDED
        )
        _set_onsite_order_from_charge(intent, status)
      elif event_type == "charge.dispute.created":
        _set_onsite_order_from_dispute(intent, OnsiteOrder.PAYMENT_STATUS_DISPUTED)
      elif event_type == "charge.dispute.closed":
        dispute_status = str(_stripe_field(intent, "status", "") or "").lower()
        status = OnsiteOrder.PAYMENT_STATUS_CHARGEBACK if dispute_status == "lost" else OnsiteOrder.PAYMENT_STATUS_PAID
        _set_onsite_order_from_dispute(intent, status)
      event_record.status = ProcessedStripeEvent.STATUS_PROCESSED
      event_record.processed_at = timezone.now()
      event_record.save(update_fields=["status", "processed_at"])
  except PaymentIntentVerificationError as error:
    logger.error("Rejected Stripe webhook event %s: %s", event_id, error)
    event_record.status = ProcessedStripeEvent.STATUS_REJECTED
    event_record.event_type = f"rejected:{event_type}"[:80]
    event_record.error_message = str(error)[:500]
    event_record.save(update_fields=["status", "event_type", "error_message"])
    return JsonResponse({"ok": True, "rejected": True})
  except Exception:
    logger.exception("Stripe webhook processing failed for event %s", event_id)
    event_record.status = ProcessedStripeEvent.STATUS_ERROR
    event_record.error_message = "Webhook processing failed"
    event_record.save(update_fields=["status", "error_message"])
    return _client_error("Webhook processing failed", status=500)

  return JsonResponse({"ok": True})

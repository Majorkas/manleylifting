from django.urls import path

from .views import (
  csrf_seed,
  hello,
  onsite_checkout_intent,
  onsite_checkout_status,
  onsite_order_summary,
  shop_collection_detail,
  shop_collections,
  shop_featured_products,
  shop_product_detail,
  stripe_webhook,
)

urlpatterns = [
  path("hello/", hello),
  path("csrf/", csrf_seed),
  path("shop/products/featured/", shop_featured_products),
  path("shop/products/<str:handle>/", shop_product_detail),
  path("shop/collections/", shop_collections),
  path("shop/collections/<str:handle>/", shop_collection_detail),
  path("payments/onsite-intent/", onsite_checkout_intent),
  path("payments/onsite-status/", onsite_checkout_status),
  path("payments/onsite-order-summary/", onsite_order_summary),
  path("payments/stripe/webhook/", stripe_webhook),
]

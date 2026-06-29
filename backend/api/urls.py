from django.urls import path

from .views import (
  csrf_seed,
  hello,
  shop_checkout_status,
  shop_checkout_url,
  shop_collection_detail,
  shop_collections,
  shop_featured_products,
  shop_product_detail,
  shopify_orders_create_webhook,
)

urlpatterns = [
  path("hello/", hello),
  path("csrf/", csrf_seed),
  path("shop/products/featured/", shop_featured_products),
  path("shop/products/<str:handle>/", shop_product_detail),
  path("shop/collections/", shop_collections),
  path("shop/collections/<str:handle>/", shop_collection_detail),
  path("shop/checkout-url/", shop_checkout_url),
  path("shop/checkout-status/", shop_checkout_status),
  path("shopify/webhooks/orders-create/", shopify_orders_create_webhook),
]

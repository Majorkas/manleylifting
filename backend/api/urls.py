from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .portal_views import (
  portal_certificate_download,
  portal_company_header,
  portal_equipment_certificates,
  portal_equipment_list,
  portal_equipment_reports,
  portal_logout,
  portal_me,
  portal_report_owner_edit,
  portal_staff_assignments,
)
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
  path("auth/token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
  path("auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
  path("auth/logout/", portal_logout),
  path("portal/me/", portal_me),
  path("portal/company-header/", portal_company_header),
  path("portal/equipment/", portal_equipment_list),
  path("portal/equipment/<int:equipment_id>/reports/", portal_equipment_reports),
  path("portal/reports/<int:report_id>/", portal_report_owner_edit),
  path("portal/equipment/<int:equipment_id>/certificates/", portal_equipment_certificates),
  path("portal/certificates/<int:certificate_id>/download/", portal_certificate_download),
  path("portal/staff-assignments/", portal_staff_assignments),
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

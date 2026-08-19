from django.contrib import admin

from .models import (
	AuditLog,
	CatalogCollection,
	CatalogProduct,
	Certificate,
	CommerceCustomerProfile,
	Company,
	Equipment,
	InspectionReport,
	InventoryReservation,
	InventoryTransaction,
	OnsiteOrder,
	OrderItem,
	ReportRevision,
	UserProfile,
)


@admin.register(CatalogCollection)
class CatalogCollectionAdmin(admin.ModelAdmin):
	list_display = ("handle", "title", "sort_order", "is_active", "updated_at")
	list_filter = ("is_active",)
	search_fields = ("handle", "title")
	ordering = ("sort_order", "title")


@admin.register(CatalogProduct)
class CatalogProductAdmin(admin.ModelAdmin):
	list_display = (
		"handle",
		"title",
		"variant_ref",
		"price_amount",
		"currency_code",
		"inventory_tracked",
		"available_qty",
		"reserved_qty",
		"is_active",
		"updated_at",
	)
	list_filter = ("is_active", "currency_code", "collection")
	search_fields = ("handle", "title", "product_ref", "variant_ref")
	ordering = ("sort_order", "title")


@admin.register(Company)
class CompanyAdmin(admin.ModelAdmin):
	list_display = ("name", "slug", "contact_email", "is_active", "updated_at")
	list_filter = ("is_active",)
	search_fields = ("name", "slug", "contact_email")


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
	list_display = ("user", "role", "updated_at")
	list_filter = ("role",)
	search_fields = ("user__username", "user__email")
	filter_horizontal = ("allowed_companies",)


@admin.register(CommerceCustomerProfile)
class CommerceCustomerProfileAdmin(admin.ModelAdmin):
	list_display = (
		"user",
		"verified_email",
		"email_verified_at",
		"activation_pending",
		"disabled_at",
		"anonymized_at",
		"updated_at",
	)
	search_fields = ("user__username", "user__email")
	readonly_fields = (
		"verified_email",
		"email_verified_at",
		"activation_pending",
		"terms_accepted_at",
		"privacy_accepted_at",
		"terms_version",
		"privacy_version",
		"disabled_at",
		"anonymized_at",
		"created_at",
		"updated_at",
	)


@admin.register(Equipment)
class EquipmentAdmin(admin.ModelAdmin):
	list_display = ("name", "company", "asset_tag", "serial_number", "status", "next_inspection_due")
	list_filter = ("status", "company")
	search_fields = ("name", "asset_tag", "serial_number", "location")


@admin.register(InspectionReport)
class InspectionReportAdmin(admin.ModelAdmin):
	list_display = ("title", "equipment", "status", "report_date", "submitted_by", "updated_at")
	list_filter = ("status", "equipment__company")
	search_fields = ("title", "equipment__name", "equipment__asset_tag")


@admin.register(ReportRevision)
class ReportRevisionAdmin(admin.ModelAdmin):
	list_display = ("id", "report", "edited_by", "changed_at")
	list_filter = ("report__equipment__company",)
	search_fields = ("report__title", "edited_by__username")


@admin.register(Certificate)
class CertificateAdmin(admin.ModelAdmin):
	list_display = ("title", "company", "equipment", "issue_date", "expiry_date", "created_at")
	list_filter = ("company",)
	search_fields = ("title", "equipment__name")


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
	list_display = ("action", "target_type", "target_id", "actor", "company", "ip_address", "created_at")
	list_filter = ("action", "company")
	search_fields = ("target_type", "target_id", "actor__username")


@admin.register(OrderItem)
class OrderItemAdmin(admin.ModelAdmin):
	list_display = ("order", "sku", "title", "quantity", "unit_price_cents", "line_total_cents", "created_at")
	list_filter = ("sku", "created_at")
	search_fields = ("order__order_number", "sku", "title")
	readonly_fields = ("created_at",)
	ordering = ("-created_at",)


@admin.register(OnsiteOrder)
class OnsiteOrderAdmin(admin.ModelAdmin):
	list_display = ("order_number", "checkout_ref", "status", "payment_status", "fulfillment_status", "amount_total_cents", "created_at")
	list_filter = ("status", "payment_status", "fulfillment_status", "currency")
	search_fields = ("order_number", "checkout_ref", "customer_email", "payment_intent_id")
	readonly_fields = ("order_number", "created_at", "updated_at", "paid_at")
	ordering = ("-created_at",)


@admin.register(InventoryReservation)
class InventoryReservationAdmin(admin.ModelAdmin):
	list_display = ("order", "product", "quantity", "status", "created_at", "fulfilled_at")
	list_filter = ("status", "created_at")
	search_fields = ("order__order_number", "product__sku")
	readonly_fields = ("created_at", "released_at", "fulfilled_at")
	ordering = ("-created_at",)


@admin.register(InventoryTransaction)
class InventoryTransactionAdmin(admin.ModelAdmin):
	list_display = ("product", "transaction_type", "quantity_change", "order", "reason", "created_at")
	list_filter = ("transaction_type", "created_at")
	search_fields = ("product__sku", "order__order_number", "reason")
	readonly_fields = ("created_at",)
	ordering = ("-created_at",)

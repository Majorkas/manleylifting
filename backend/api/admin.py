from django.contrib import admin

from .models import (
	CatalogCollection,
	CatalogProduct,
	Certificate,
	Company,
	Equipment,
	InspectionReport,
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

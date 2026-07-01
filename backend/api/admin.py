from django.contrib import admin

from .models import CatalogCollection, CatalogProduct


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

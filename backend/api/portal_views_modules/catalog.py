from decimal import Decimal, InvalidOperation
import json
import os

from django.db import IntegrityError, transaction
from django.db.models import Q
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from PIL import Image, UnidentifiedImageError

from ..models import CatalogCollection, CatalogProduct, CatalogProductImage, InventoryTransaction
from ..permissions import HasPortalAccess
from ..portal_views import _get_pagination_params, _is_owner, _paginate_queryset
from ..throttles import PortalMethodRateThrottle

PRODUCT_IMAGE_ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
PRODUCT_IMAGE_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024


def _catalog_allowed(user):
    return _is_owner(user)


def _serialize_collection(collection):
    return {
        "id": collection.id,
        "handle": collection.handle,
        "title": collection.title,
        "description": collection.description,
        "sortOrder": collection.sort_order,
        "isActive": collection.is_active,
        "productCount": collection.products.count(),
    }


def _serialize_product(product):
    images = [
        {
            "id": image.id,
            "url": image.image.url,
            "alt": image.alt_text or product.image_alt or product.title,
            "sortOrder": image.sort_order,
        }
        for image in product.images.all()
    ]
    return {
        "id": product.id,
        "variantRef": product.variant_ref,
        "productRef": product.product_ref,
        "variantTitle": product.variant_title,
        "handle": product.handle,
        "title": product.title,
        "description": product.description,
        "imageUrl": product.image_url,
        "imageAlt": product.image_alt,
        "images": images,
        "priceAmount": str(product.price_amount),
        "currencyCode": product.currency_code,
        "collectionId": product.collection_id,
        "sortOrder": product.sort_order,
        "isActive": product.is_active,
        "sku": product.sku,
        "stockPolicy": CatalogProduct.STOCK_POLICY_FINITE,
        "inventoryTracked": True,
        "weightGrams": product.weight_grams,
        "shippingClass": product.shipping_class,
        "taxCode": product.tax_code,
        "availableQty": product.available_qty,
        "reservedQty": product.reserved_qty,
        "createdAt": product.created_at.isoformat() if product.created_at else None,
        "updatedAt": product.updated_at.isoformat() if product.updated_at else None,
    }


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated, HasPortalAccess])
@throttle_classes([PortalMethodRateThrottle])
def portal_catalog_collections(request):
    if not _catalog_allowed(request.user):
        return Response({"detail": "Catalog management requires owner or office staff role."}, status=403)
    if request.method == "GET":
        queryset = CatalogCollection.objects.prefetch_related("products").order_by(
            "sort_order", "title", "handle"
        )
        search = str(request.GET.get("search") or "").strip()
        if search:
            queryset = queryset.filter(Q(title__icontains=search) | Q(handle__icontains=search))
        if request.GET.get("isActive") is not None:
            queryset = queryset.filter(is_active=str(request.GET.get("isActive")).lower() != "false")
        page, page_size = _get_pagination_params(request)
        page_data = _paginate_queryset(queryset, page, page_size)
        return Response({**page_data, "results": [_serialize_collection(item) for item in page_data["results"]]})

    handle = str(request.data.get("handle") or "").strip()
    title = str(request.data.get("title") or "").strip()
    if not handle or not title:
        return Response({"detail": "handle and title are required"}, status=400)
    try:
        collection = CatalogCollection.objects.create(
            handle=handle,
            title=title,
            description=str(request.data.get("description") or ""),
            sort_order=max(0, int(request.data.get("sortOrder") or 0)),
        )
    except (IntegrityError, ValueError, TypeError):
        return Response({"detail": "Handle already exists or sort order is invalid."}, status=400)
    return Response(_serialize_collection(collection), status=status.HTTP_201_CREATED)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated, HasPortalAccess])
@throttle_classes([PortalMethodRateThrottle])
def portal_catalog_collection_detail(request, collection_id):
    if not _catalog_allowed(request.user):
        return Response({"detail": "Catalog management requires owner or office staff role."}, status=403)
    try:
        collection = CatalogCollection.objects.get(pk=collection_id)
    except CatalogCollection.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)
    if "handle" in request.data:
        collection.handle = str(request.data.get("handle") or "").strip()
    if "title" in request.data:
        collection.title = str(request.data.get("title") or "").strip()
    if "description" in request.data:
        collection.description = str(request.data.get("description") or "")
    if "sortOrder" in request.data:
        try:
            collection.sort_order = max(0, int(request.data.get("sortOrder") or 0))
        except (TypeError, ValueError):
            return Response({"detail": "sort order must be an integer"}, status=400)
    if not collection.handle or not collection.title:
        return Response({"detail": "handle and title are required"}, status=400)
    try:
        collection.save()
    except IntegrityError:
        return Response({"detail": "Handle already exists."}, status=400)
    return Response(_serialize_collection(collection))


@api_view(["POST"])
@permission_classes([IsAuthenticated, HasPortalAccess])
@throttle_classes([PortalMethodRateThrottle])
def portal_catalog_collection_state(request, collection_id):
    if not _catalog_allowed(request.user):
        return Response({"detail": "Catalog management requires owner or office staff role."}, status=403)
    try:
        collection = CatalogCollection.objects.get(pk=collection_id)
    except CatalogCollection.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)
    action = str(request.data.get("action") or "").lower()
    if action not in {"archive", "reactivate"}:
        return Response({"detail": "action must be archive or reactivate"}, status=400)
    collection.is_active = action == "reactivate"
    collection.save(update_fields=["is_active", "updated_at"])
    return Response(_serialize_collection(collection))


def _validate_product_images(uploaded_images):
    allowed_formats = {
        ".png": {"PNG"},
        ".jpg": {"JPEG"},
        ".jpeg": {"JPEG"},
        ".webp": {"WEBP"},
    }
    for uploaded_file in uploaded_images:
        if uploaded_file.size > PRODUCT_IMAGE_MAX_FILE_SIZE_BYTES:
            return "Each product image must be 10MB or smaller"
        extension = os.path.splitext(uploaded_file.name or "")[1].lower()
        if extension not in PRODUCT_IMAGE_ALLOWED_EXTENSIONS:
            return "Product images must be PNG, JPG, JPEG, or WEBP"
        uploaded_file.seek(0)
        try:
            image = Image.open(uploaded_file)
            image.verify()
            image_format = str(image.format or "").upper()
        except (UnidentifiedImageError, OSError, ValueError):
            uploaded_file.seek(0)
            return "Product image content does not match the file extension"
        uploaded_file.seek(0)
        if image_format not in allowed_formats[extension]:
            return "Product image content does not match the file extension"
    return ""


def _save_product_images(product, uploaded_images):
    next_sort_order = product.images.count()
    for offset, uploaded_image in enumerate(uploaded_images):
        CatalogProductImage.objects.create(
            product=product,
            image=uploaded_image,
            alt_text=product.image_alt or product.title,
            sort_order=next_sort_order + offset,
        )


def _parse_json_list(value):
    if value in (None, ""):
        return []
    if isinstance(value, list):
        return value
    return json.loads(value)


def _apply_product_image_changes(product, request_data, uploaded_images):
    raw_removed_ids = request_data.get("removedImageIds", "[]")
    raw_image_order = request_data.get("imageOrder", "[]")
    try:
        removed_ids = {int(value) for value in _parse_json_list(raw_removed_ids)}
        image_order = [int(value) for value in _parse_json_list(raw_image_order)]
    except (TypeError, ValueError, json.JSONDecodeError):
        raise ValueError("Product image ordering data is invalid")

    if removed_ids:
        product.images.filter(id__in=removed_ids).delete()
    if uploaded_images:
        _save_product_images(product, uploaded_images)

    images = list(product.images.order_by("sort_order", "id"))
    ordered_ids = [image_id for image_id in image_order if image_id in {image.id for image in images}]
    ordered_images = [next(image for image in images if image.id == image_id) for image_id in ordered_ids]
    ordered_images.extend(image for image in images if image.id not in set(ordered_ids))
    for sort_order, image in enumerate(ordered_images):
        if image.sort_order != sort_order:
            image.sort_order = sort_order
            image.save(update_fields=["sort_order"])


def _validate_product(data, create=False):
    errors = {}
    required = ("variantRef", "handle", "title") if create else ()
    for field in required:
        if not str(data.get(field) or "").strip():
            errors[field] = "This field is required."
    if "priceAmount" in data:
        try:
            if Decimal(str(data["priceAmount"])) < 0:
                errors["priceAmount"] = "Price must be non-negative."
        except (InvalidOperation, TypeError, ValueError):
            errors["priceAmount"] = "Enter a valid decimal number."
    if "stockPolicy" in data and data["stockPolicy"] not in {
        choice[0] for choice in CatalogProduct.STOCK_POLICY_CHOICES
    }:
        errors["stockPolicy"] = "Invalid stock policy."
    if "collectionId" in data and data["collectionId"] is not None:
        try:
            if not CatalogCollection.objects.filter(pk=int(data["collectionId"])).exists():
                errors["collectionId"] = "Collection not found."
        except (TypeError, ValueError):
            errors["collectionId"] = "Collection ID must be an integer."
    return errors


def _apply_product(product, data, create=False):
    fields = {
        "variantRef": "variant_ref", "productRef": "product_ref", "variantTitle": "variant_title",
        "handle": "handle", "title": "title", "description": "description", "imageUrl": "image_url",
        "imageAlt": "image_alt", "currencyCode": "currency_code", "stockPolicy": "stock_policy",
        "inventoryTracked": "inventory_tracked", "weightGrams": "weight_grams",
        "shippingClass": "shipping_class", "taxCode": "tax_code", "sortOrder": "sort_order",
    }
    required_on_create = {"variantRef", "handle", "title"}
    for source, target in fields.items():
        if source not in data and not (create and source in required_on_create):
            continue
        value = data.get(source)
        if target == "currency_code": value = str(value or "EUR").strip().upper()
        if target == "sort_order": value = max(0, int(value or 0))
        if target in {"weight_grams"} and value is not None: value = int(value)
        setattr(product, target, value)
    product.stock_policy = CatalogProduct.STOCK_POLICY_FINITE
    product.inventory_tracked = True
    if create or "priceAmount" in data:
        product.price_amount = Decimal(str(data.get("priceAmount", product.price_amount)))
    if create or "collectionId" in data:
        product.collection_id = int(data["collectionId"]) if data.get("collectionId") is not None else None
    if "sku" in data:
        product.sku = str(data.get("sku") or "").strip() or None


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated, HasPortalAccess])
@throttle_classes([PortalMethodRateThrottle])
def portal_catalog_products(request):
    if not _catalog_allowed(request.user):
        return Response({"detail": "Catalog management requires owner or office staff role."}, status=403)
    if request.method == "GET":
        queryset = CatalogProduct.objects.select_related("collection").order_by("sort_order", "title", "handle")
        search = str(request.GET.get("search") or "").strip()
        if search:
            queryset = queryset.filter(Q(title__icontains=search) | Q(handle__icontains=search))
        if request.GET.get("isActive") is not None:
            queryset = queryset.filter(is_active=str(request.GET.get("isActive")).lower() != "false")
        page, page_size = _get_pagination_params(request)
        page_data = _paginate_queryset(queryset, page, page_size)
        return Response({**page_data, "results": [_serialize_product(item) for item in page_data["results"]]})
    uploaded_images = request.FILES.getlist("images")
    image_error = _validate_product_images(uploaded_images)
    if image_error:
        return Response({"detail": image_error}, status=400)
    errors = _validate_product(request.data, create=True)
    if errors: return Response(errors, status=400)
    product = CatalogProduct()
    _apply_product(product, request.data, create=True)
    try:
        with transaction.atomic():
            product.save()
            _save_product_images(product, uploaded_images)
    except IntegrityError:
        return Response({"detail": "Handle, SKU, or variant reference already exists."}, status=400)
    except Exception:
        return Response({"detail": "Product could not be saved."}, status=500)
    return Response(_serialize_product(product), status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated, HasPortalAccess])
@throttle_classes([PortalMethodRateThrottle])
def portal_catalog_product_detail(request, product_id):
    if not _catalog_allowed(request.user): return Response({"detail": "Catalog management requires owner or office staff role."}, status=403)
    try: product = CatalogProduct.objects.select_related("collection").get(pk=product_id)
    except CatalogProduct.DoesNotExist: return Response({"detail": "Not found."}, status=404)
    if request.method == "GET": return Response(_serialize_product(product))
    errors = _validate_product(request.data)
    if errors: return Response(errors, status=400)
    uploaded_images = request.FILES.getlist("images")
    image_error = _validate_product_images(uploaded_images)
    if image_error:
        return Response({"detail": image_error}, status=400)
    try:
        with transaction.atomic():
            _apply_product(product, request.data)
            product.save()
            _apply_product_image_changes(product, request.data, uploaded_images)
    except ValueError as error:
        return Response({"detail": str(error)}, status=400)
    except IntegrityError: return Response({"detail": "Handle, SKU, or variant reference already exists."}, status=400)
    return Response(_serialize_product(product))


@api_view(["POST"])
@permission_classes([IsAuthenticated, HasPortalAccess])
@throttle_classes([PortalMethodRateThrottle])
def portal_catalog_product_state(request, product_id):
    if not _catalog_allowed(request.user): return Response({"detail": "Catalog management requires owner or office staff role."}, status=403)
    try: product = CatalogProduct.objects.get(pk=product_id)
    except CatalogProduct.DoesNotExist: return Response({"detail": "Not found."}, status=404)
    action = str(request.data.get("action") or "").lower()
    if action not in {"archive", "reactivate"}: return Response({"detail": "action must be archive or reactivate"}, status=400)
    product.is_active = action == "reactivate"
    product.save(update_fields=["is_active", "updated_at"])
    return Response(_serialize_product(product))


@api_view(["POST"])
@permission_classes([IsAuthenticated, HasPortalAccess])
@throttle_classes([PortalMethodRateThrottle])
def portal_catalog_product_adjust_stock(request, product_id):
    if not _catalog_allowed(request.user): return Response({"detail": "Catalog management requires owner or office staff role."}, status=403)
    try:
        delta = int(request.data.get("delta"))
    except (TypeError, ValueError):
        return Response({"detail": "delta must be an integer"}, status=400)
    reason = str(request.data.get("reason") or "").strip()
    if delta == 0: return Response({"detail": "delta must not be zero"}, status=400)
    if not reason: return Response({"detail": "reason is required"}, status=400)
    with transaction.atomic():
        try:
            product = CatalogProduct.objects.select_for_update().get(pk=product_id)
        except CatalogProduct.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)
        next_qty = product.available_qty + delta
        if next_qty < product.reserved_qty: return Response({"detail": "Stock cannot fall below reserved quantity"}, status=400)
        product.available_qty = next_qty
        product.inventory_tracked = True
        product.save(update_fields=["available_qty", "inventory_tracked", "updated_at"])
        InventoryTransaction.objects.create(product=product, transaction_type=InventoryTransaction.TYPE_ADJUST, quantity_change=delta, reason=reason)
    return Response(_serialize_product(product))

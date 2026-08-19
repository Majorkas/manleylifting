import secrets
import uuid

from django.db import models
from django.utils import timezone


class PendingCheckout(models.Model):
    """Retained legacy provider-checkout state; new store orders use OnsiteOrder."""
    STATUS_PENDING = "pending"
    STATUS_CONFIRMED = "confirmed"
    STATUS_EXPIRED = "expired"

    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_CONFIRMED, "Confirmed"),
        (STATUS_EXPIRED, "Expired"),
    ]

    checkout_ref = models.CharField(max_length=100, unique=True)
    status_token = models.CharField(max_length=128, default="", db_index=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    cart_payload = models.JSONField(default=dict, blank=True)
    provider_cart_id = models.CharField(max_length=255, blank=True, default="")
    checkout_url = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.checkout_ref} ({self.status})"


class ProcessedWebhookEvent(models.Model):
    webhook_id = models.CharField(max_length=128, unique=True)
    topic = models.CharField(max_length=120, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.webhook_id


class GuestOrderClaim(models.Model):
    STATE_PENDING = "pending"
    STATE_CLAIMED = "claimed"
    STATE_EXPIRED = "expired"

    STATE_CHOICES = [
        (STATE_PENDING, "Pending"),
        (STATE_CLAIMED, "Claimed"),
        (STATE_EXPIRED, "Expired"),
    ]

    order = models.OneToOneField("OnsiteOrder", on_delete=models.CASCADE, related_name="guest_claim")
    claim_token = models.CharField(max_length=128, unique=True, db_index=True)
    claim_state = models.CharField(max_length=20, choices=STATE_CHOICES, default=STATE_PENDING)
    claimed_by = models.ForeignKey(
        "auth.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="claimed_guest_orders",
    )
    issued_at = models.DateTimeField(auto_now_add=True)
    claimed_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Claim for {self.order_id}"


class OnsiteOrder(models.Model):
    STATUS_PENDING = "pending"
    STATUS_PROCESSING = "processing"
    STATUS_PAID = "paid"
    STATUS_SHIPPED = "shipped"
    STATUS_COMPLETED = "completed"
    STATUS_FAILED = "failed"
    STATUS_CANCELED = "canceled"

    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_PROCESSING, "Processing"),
        (STATUS_PAID, "Paid"),
        (STATUS_SHIPPED, "Shipped"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_FAILED, "Failed"),
        (STATUS_CANCELED, "Canceled"),
    ]

    # New payment and fulfillment status constants
    PAYMENT_STATUS_PENDING = "pending"
    PAYMENT_STATUS_PROCESSING = "processing"
    PAYMENT_STATUS_PAID = "paid"
    PAYMENT_STATUS_FAILED = "failed"
    PAYMENT_STATUS_CANCELED = "canceled"
    PAYMENT_STATUS_PARTIALLY_REFUNDED = "partially_refunded"
    PAYMENT_STATUS_REFUNDED = "refunded"
    PAYMENT_STATUS_DISPUTED = "disputed"
    PAYMENT_STATUS_CHARGEBACK = "chargeback"

    PAYMENT_STATUS_CHOICES = [
        (PAYMENT_STATUS_PENDING, "Pending"),
        (PAYMENT_STATUS_PROCESSING, "Processing"),
        (PAYMENT_STATUS_PAID, "Paid"),
        (PAYMENT_STATUS_FAILED, "Failed"),
        (PAYMENT_STATUS_CANCELED, "Canceled"),
        (PAYMENT_STATUS_PARTIALLY_REFUNDED, "Partially refunded"),
        (PAYMENT_STATUS_REFUNDED, "Refunded"),
        (PAYMENT_STATUS_DISPUTED, "Disputed"),
        (PAYMENT_STATUS_CHARGEBACK, "Chargeback"),
    ]

    FULFILLMENT_STATUS_UNFULFILLED = "unfulfilled"
    FULFILLMENT_STATUS_PROCESSING = "processing"
    FULFILLMENT_STATUS_SHIPPED = "shipped"
    FULFILLMENT_STATUS_DELIVERED = "delivered"
    FULFILLMENT_STATUS_CANCELED = "canceled"

    FULFILLMENT_STATUS_CHOICES = [
        (FULFILLMENT_STATUS_UNFULFILLED, "Unfulfilled"),
        (FULFILLMENT_STATUS_PROCESSING, "Processing"),
        (FULFILLMENT_STATUS_SHIPPED, "Shipped"),
        (FULFILLMENT_STATUS_DELIVERED, "Delivered"),
        (FULFILLMENT_STATUS_CANCELED, "Canceled"),
    ]

    checkout_ref = models.CharField(max_length=100, unique=True)
    order_number = models.CharField(max_length=32, unique=True, blank=True, default="", db_index=True)
    status_token = models.CharField(max_length=128, default="", db_index=True)
    status_token_expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    status_token_revoked_at = models.DateTimeField(null=True, blank=True, db_index=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    payment_status = models.CharField(
        max_length=20,
        choices=PAYMENT_STATUS_CHOICES,
        null=True,
        blank=True,
        db_index=True,
    )
    fulfillment_status = models.CharField(
        max_length=20,
        choices=FULFILLMENT_STATUS_CHOICES,
        null=True,
        blank=True,
        db_index=True,
    )
    user = models.ForeignKey(
        "auth.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="onsite_orders",
    )
    line_items = models.JSONField(default=list, blank=True)
    amount_total_cents = models.PositiveIntegerField(default=0)
    currency = models.CharField(max_length=8, default="EUR")
    # Financial breakdown (M2: for future payment/fulfillment separation)
    subtotal_cents = models.PositiveIntegerField(null=True, blank=True, db_index=False)
    discount_cents = models.PositiveIntegerField(default=0, null=True, blank=True)
    shipping_cents = models.PositiveIntegerField(null=True, blank=True)
    tax_cents = models.PositiveIntegerField(null=True, blank=True)
    company = models.ForeignKey(
        "Company",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="onsite_orders",
    )
    fulfillment_actor = models.ForeignKey(
        "auth.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="fulfilled_onsite_orders",
    )
    customer_name = models.CharField(max_length=150, blank=True, default="")
    customer_email = models.EmailField(blank=True, default="")
    shipping_name = models.CharField(max_length=150, blank=True, default="")
    shipping_phone = models.CharField(max_length=50, blank=True, default="")
    shipping_address_line_1 = models.CharField(max_length=200, blank=True, default="")
    shipping_address_line_2 = models.CharField(max_length=200, blank=True, default="")
    shipping_city = models.CharField(max_length=120, blank=True, default="")
    shipping_county = models.CharField(max_length=120, blank=True, default="")
    shipping_postcode = models.CharField(max_length=40, blank=True, default="")
    shipping_country_code = models.CharField(max_length=2, blank=True, default="")
    payment_intent_id = models.CharField(max_length=128, blank=True, default="", db_index=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    processing_at = models.DateTimeField(null=True, blank=True)
    shipped_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    canceled_at = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.CharField(max_length=255, blank=True, default="")
    refund_total_cents = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(subtotal_cents__isnull=True)
                    | models.Q(discount_cents__isnull=True)
                    | models.Q(shipping_cents__isnull=True)
                    | models.Q(tax_cents__isnull=True)
                    | models.Q(
                        amount_total_cents=(
                            models.F("subtotal_cents")
                            - models.F("discount_cents")
                            + models.F("shipping_cents")
                            + models.F("tax_cents")
                        )
                    )
                ),
                name="onsite_order_financial_totals_match",
            ),
            models.CheckConstraint(
                condition=models.Q(refund_total_cents__gte=0),
                name="onsite_order_refund_total_nonnegative",
            ),
            models.CheckConstraint(
                condition=models.Q(refund_total_cents__lte=models.F("amount_total_cents")),
                name="onsite_order_refund_lte_total",
            ),
        ]

    def save(self, *args, **kwargs):
        if not self.order_number:
            self.order_number = self._generate_order_number()
        super().save(*args, **kwargs)

    def _generate_order_number(self):
        prefix = "MNL"
        for _ in range(10):
            stamp = timezone.now().strftime("%y%m%d")
            suffix = secrets.token_hex(3).upper()
            candidate = f"{prefix}-{stamp}-{suffix}"
            if not self.__class__.objects.filter(order_number=candidate).exists():
                return candidate
        return f"{prefix}-{timezone.now().strftime('%y%m%d')}-{secrets.token_hex(4).upper()}"

    def get_payment_status_from_legacy(self):
        """Map legacy single status field to new payment_status for backward compatibility."""
        status_to_payment = {
            self.STATUS_PENDING: self.PAYMENT_STATUS_PENDING,
            self.STATUS_PROCESSING: self.PAYMENT_STATUS_PROCESSING,
            self.STATUS_PAID: self.PAYMENT_STATUS_PAID,
            self.STATUS_SHIPPED: self.PAYMENT_STATUS_PAID,
            self.STATUS_COMPLETED: self.PAYMENT_STATUS_PAID,
            self.STATUS_FAILED: self.PAYMENT_STATUS_FAILED,
            self.STATUS_CANCELED: self.PAYMENT_STATUS_CANCELED,
        }
        return status_to_payment.get(self.status, self.PAYMENT_STATUS_PENDING)

    def get_fulfillment_status_from_legacy(self):
        """Map legacy single status field to new fulfillment_status for backward compatibility."""
        status_to_fulfillment = {
            self.STATUS_PENDING: self.FULFILLMENT_STATUS_UNFULFILLED,
            self.STATUS_PROCESSING: self.FULFILLMENT_STATUS_PROCESSING,
            self.STATUS_PAID: self.FULFILLMENT_STATUS_UNFULFILLED,
            self.STATUS_SHIPPED: self.FULFILLMENT_STATUS_SHIPPED,
            self.STATUS_COMPLETED: self.FULFILLMENT_STATUS_DELIVERED,
            self.STATUS_FAILED: self.FULFILLMENT_STATUS_CANCELED,
            self.STATUS_CANCELED: self.FULFILLMENT_STATUS_CANCELED,
        }
        return status_to_fulfillment.get(self.status, self.FULFILLMENT_STATUS_UNFULFILLED)

    def validate_financial_totals(self):
        """
        Validate that financial totals sum correctly if all components are present.
        Returns (is_valid, error_message) tuple.
        Allows partial data (some fields null) for backward compatibility.
        """
        # If all breakdown fields are present, verify the grand total
        if all(v is not None for v in [self.subtotal_cents, self.discount_cents, self.shipping_cents, self.tax_cents]):
            calculated_total = self.subtotal_cents - self.discount_cents + self.shipping_cents + self.tax_cents
            if calculated_total != self.amount_total_cents:
                return (
                    False,
                    f"Financial total mismatch: subtotal({self.subtotal_cents}) - discount({self.discount_cents}) + shipping({self.shipping_cents}) + tax({self.tax_cents}) = {calculated_total}, but amount_total_cents = {self.amount_total_cents}",
                )
        return (True, None)

    def __str__(self):
        return f"{self.checkout_ref} ({self.status})"


class OrderItem(models.Model):
    """
    Normalized snapshot of a line item from an order.
    Created when an order is placed, immutable after creation.
    """
    order = models.ForeignKey(
        OnsiteOrder,
        on_delete=models.CASCADE,
        related_name="order_items",
    )
    sku = models.CharField(max_length=100, db_index=True)
    title = models.CharField(max_length=255)
    variant_ref = models.CharField(max_length=100, blank=True, default="")
    unit_price_cents = models.PositiveIntegerField()
    quantity = models.PositiveIntegerField()
    line_total_cents = models.PositiveIntegerField()
    weight_grams = models.PositiveIntegerField(null=True, blank=True)
    shipping_class = models.CharField(max_length=80, null=True, blank=True)
    tax_code = models.CharField(max_length=80, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["order", "created_at"]),
            models.Index(fields=["sku"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(line_total_cents=models.F("unit_price_cents") * models.F("quantity")),
                name="orderitem_line_total_matches_qty",
            ),
        ]

    def __str__(self):
        return f"{self.sku} x{self.quantity} ({self.order.checkout_ref})"


class InventoryReservation(models.Model):
    """
    Captures inventory reserved during checkout.
    Created when payment intent is created, released if order is canceled.
    """
    STATUS_RESERVED = "reserved"
    STATUS_RELEASED = "released"
    STATUS_FULFILLED = "fulfilled"

    STATUS_CHOICES = [
        (STATUS_RESERVED, "Reserved"),
        (STATUS_RELEASED, "Released"),
        (STATUS_FULFILLED, "Fulfilled"),
    ]

    order = models.ForeignKey(
        OnsiteOrder,
        on_delete=models.PROTECT,
        related_name="inventory_reservations",
    )
    product = models.ForeignKey(
        "CatalogProduct",
        on_delete=models.PROTECT,
        related_name="reservations",
    )
    quantity = models.PositiveIntegerField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_RESERVED, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    released_at = models.DateTimeField(null=True, blank=True)
    fulfilled_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["order", "status"]),
            models.Index(fields=["product", "status"]),
        ]

    def __str__(self):
        return f"Reserve {self.quantity}x {self.product.sku} for {self.order.checkout_ref} ({self.status})"


class InventoryTransaction(models.Model):
    """
    Audit log for inventory movements (fulfillment, adjustments, returns).
    Immutable record of what happened and when.
    """
    TYPE_FULFILL = "fulfill"
    TYPE_ADJUST = "adjust"
    TYPE_RETURN = "return"

    TYPE_CHOICES = [
        (TYPE_FULFILL, "Fulfillment"),
        (TYPE_ADJUST, "Adjustment"),
        (TYPE_RETURN, "Return"),
    ]

    product = models.ForeignKey(
        "CatalogProduct",
        on_delete=models.PROTECT,
        related_name="transactions",
    )
    order = models.ForeignKey(
        OnsiteOrder,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="inventory_transactions",
    )
    transaction_type = models.CharField(max_length=20, choices=TYPE_CHOICES, db_index=True)
    quantity_change = models.IntegerField()  # Positive or negative
    reason = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["product", "created_at"]),
            models.Index(fields=["transaction_type"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(quantity_change=0),
                name="inventory_transaction_nonzero_change",
            ),
        ]

    def __str__(self):
        return f"{self.get_transaction_type_display()} {self.product.sku}: {self.quantity_change:+d}"


class ProcessedStripeEvent(models.Model):
    STATUS_PROCESSING = "processing"
    STATUS_PROCESSED = "processed"
    STATUS_REJECTED = "rejected"
    STATUS_ERROR = "error"
    STATUS_CHOICES = [
        (STATUS_PROCESSING, "Processing"),
        (STATUS_PROCESSED, "Processed"),
        (STATUS_REJECTED, "Rejected"),
        (STATUS_ERROR, "Error"),
    ]
    event_id = models.CharField(max_length=128, unique=True)
    event_type = models.CharField(max_length=80, blank=True, default="")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PROCESSING, db_index=True)
    attempts = models.PositiveIntegerField(default=0)
    error_message = models.CharField(max_length=500, blank=True, default="")
    processed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.event_id


class CatalogCollection(models.Model):
    handle = models.SlugField(max_length=120, unique=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "title", "handle"]

    def __str__(self):
        return self.title or self.handle


class CatalogProduct(models.Model):
    product_ref = models.CharField(max_length=255, blank=True, default="", db_index=True)
    variant_ref = models.CharField(max_length=255, unique=True)
    variant_title = models.CharField(max_length=200, blank=True, default="")
    handle = models.SlugField(max_length=160, unique=True)
    title = models.CharField(max_length=240)
    description = models.TextField(blank=True, default="")
    image_url = models.URLField(max_length=500, blank=True, default="")
    image_alt = models.CharField(max_length=255, blank=True, default="")
    price_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    currency_code = models.CharField(max_length=8, default="EUR")
    collection = models.ForeignKey(
        CatalogCollection,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="products",
    )
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    # Inventory fields (M2)
    sku = models.CharField(max_length=100, null=True, blank=True, db_index=True)
    inventory_tracked = models.BooleanField(default=True)
    STOCK_POLICY_UNTRACKED = "untracked"
    STOCK_POLICY_FINITE = "finite"
    STOCK_POLICY_UNAVAILABLE = "unavailable"
    STOCK_POLICY_CHOICES = [
        (STOCK_POLICY_UNTRACKED, "Untracked"),
        (STOCK_POLICY_FINITE, "Finite"),
        (STOCK_POLICY_UNAVAILABLE, "Unavailable"),
    ]
    stock_policy = models.CharField(
        max_length=20,
        choices=STOCK_POLICY_CHOICES,
        default=STOCK_POLICY_FINITE,
    )
    weight_grams = models.PositiveIntegerField(null=True, blank=True)
    shipping_class = models.CharField(max_length=80, null=True, blank=True)
    tax_code = models.CharField(max_length=80, null=True, blank=True)
    available_qty = models.PositiveIntegerField(default=0)
    reserved_qty = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "title", "handle"]
        constraints = [
            models.UniqueConstraint(
                fields=["sku"],
                condition=models.Q(sku__isnull=False),
                name="catalog_product_unique_nonnull_sku",
            ),
            models.CheckConstraint(
                condition=models.Q(reserved_qty__lte=models.F("available_qty")),
                name="catalog_product_reserved_lte_available",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    stock_policy__in=[
                        "untracked",
                        "finite",
                        "unavailable",
                    ]
                ),
                name="catalog_product_stock_policy_valid",
            ),
        ]

    def __str__(self):
        return self.title or self.handle


class Company(models.Model):
    name = models.CharField(max_length=200, unique=True)
    slug = models.SlugField(max_length=220, unique=True)
    logo = models.ImageField(upload_to="company-logos/", blank=True, null=True)
    contact_email = models.EmailField(blank=True, default="")
    contact_phone = models.CharField(max_length=50, blank=True, default="")
    address = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Site(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="sites")
    name = models.CharField(max_length=200)
    address = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]
        constraints = [
            models.UniqueConstraint(fields=["company", "name"], name="unique_site_name_per_company"),
        ]

    def __str__(self):
        return f"{self.name} ({self.company.name})"


class UserProfile(models.Model):
    ROLE_CUSTOMER = "customer"
    ROLE_ENGINEER = "engineer"
    ROLE_OFFICE_STAFF = "office_staff"
    # Legacy value retained to avoid breaking existing rows.
    ROLE_STAFF = "staff"
    ROLE_OWNER = "owner"

    ROLE_CHOICES = [
        (ROLE_CUSTOMER, "Customer"),
        (ROLE_ENGINEER, "Engineer"),
        (ROLE_OFFICE_STAFF, "Office Staff"),
        (ROLE_STAFF, "Staff"),
        (ROLE_OWNER, "Owner"),
    ]

    user = models.OneToOneField("auth.User", on_delete=models.CASCADE, related_name="profile")
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default=ROLE_CUSTOMER)
    required_password_change = models.BooleanField(default=False)
    allowed_companies = models.ManyToManyField(Company, blank=True, related_name="members")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["user__username"]

    def __str__(self):
        return f"{self.user.username} ({self.role})"


class CommerceCustomerProfile(models.Model):
    user = models.OneToOneField(
        "auth.User",
        on_delete=models.CASCADE,
        related_name="commerce_profile",
    )
    verified_email = models.EmailField(blank=True, default="")
    email_verified_at = models.DateTimeField(null=True, blank=True)
    activation_pending = models.BooleanField(default=False)
    terms_accepted_at = models.DateTimeField(null=True, blank=True)
    privacy_accepted_at = models.DateTimeField(null=True, blank=True)
    terms_version = models.CharField(max_length=64, blank=True, default="")
    privacy_version = models.CharField(max_length=64, blank=True, default="")
    disabled_at = models.DateTimeField(null=True, blank=True)
    deletion_requested_at = models.DateTimeField(null=True, blank=True)
    deletion_expires_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    anonymized_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["user__id"]

    def __str__(self):
        return f"Commerce profile for {self.user.username}"

    def has_verified_email(self):
        current_email = str(self.user.email or "").strip().lower()
        verified_email = str(self.verified_email or "").strip().lower()
        return bool(
            self.email_verified_at
            and current_email
            and verified_email
            and current_email == verified_email
        )


class CookieConsentRecord(models.Model):
    """Records user cookie consent decisions with versioning and withdrawal."""

    user = models.ForeignKey("auth.User", on_delete=models.CASCADE, related_name="consent_records")
    consent_version = models.CharField(max_length=20)
    consent_categories = models.JSONField(default=list)
    consented_at = models.DateTimeField()
    withdrawn_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-consented_at"]

    def __str__(self):
        return f"{self.user} consent v{self.consent_version} ({self.consented_at})"


class SavedAddress(models.Model):
    commerce_profile = models.ForeignKey(
        CommerceCustomerProfile,
        on_delete=models.CASCADE,
        related_name="saved_addresses",
    )
    label = models.CharField(max_length=80, blank=True, default="")
    recipient_name = models.CharField(max_length=150, blank=True, default="")
    recipient_phone = models.CharField(max_length=50, blank=True, default="")
    address_line_1 = models.CharField(max_length=200, blank=True, default="")
    address_line_2 = models.CharField(max_length=200, blank=True, default="")
    city = models.CharField(max_length=120, blank=True, default="")
    county = models.CharField(max_length=120, blank=True, default="")
    postcode = models.CharField(max_length=40, blank=True, default="")
    country_code = models.CharField(max_length=2, blank=True, default="")
    is_default_shipping = models.BooleanField(default=False)
    is_default_billing = models.BooleanField(default=False)
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_default_shipping", "-created_at", "id"]

    def __str__(self):
        return self.label or f"Address {self.id}"


class AccountSecurityState(models.Model):
    user = models.OneToOneField(
        "auth.User",
        on_delete=models.CASCADE,
        related_name="security_state",
    )
    session_generation = models.PositiveBigIntegerField(default=0)
    sessions_revoked_at = models.DateTimeField(null=True, blank=True)
    mfa_enabled = models.BooleanField(default=False)
    mfa_secret = models.CharField(max_length=64, blank=True, default="")
    mfa_pending_secret = models.CharField(max_length=64, blank=True, default="")
    mfa_recovery_codes = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Security state for user {self.user_id}"


class AccountSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        "auth.User",
        on_delete=models.CASCADE,
        related_name="account_sessions",
    )
    expires_at = models.DateTimeField(db_index=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True, default="")
    device_fingerprint = models.CharField(max_length=64, blank=True, default="", db_index=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Session {self.id} for user {self.user_id}"


class AccountActionToken(models.Model):
    class Purpose(models.TextChoices):
        VERIFY_EMAIL = "verify_email", "Verify email"
        PASSWORD_RESET = "password_reset", "Password reset"
        EMAIL_CHANGE = "email_change", "Email change"

    user = models.ForeignKey(
        "auth.User",
        on_delete=models.CASCADE,
        related_name="account_action_tokens",
    )
    purpose = models.CharField(max_length=32, choices=Purpose.choices)
    token_digest = models.CharField(max_length=64, unique=True, editable=False)
    issued_for_email = models.EmailField()
    target_email = models.EmailField()
    expires_at = models.DateTimeField(db_index=True)
    consumed_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "purpose"],
                condition=models.Q(consumed_at__isnull=True, revoked_at__isnull=True),
                name="unique_active_account_action",
            ),
        ]

    def __str__(self):
        return f"{self.get_purpose_display()} for user {self.user_id}"


class Equipment(models.Model):
    STATUS_ACTIVE = "active"
    STATUS_INACTIVE = "inactive"
    STATUS_RETIRED = "retired"
    STATUS_DECOMMISSIONED = "decommissioned"

    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_INACTIVE, "Inactive"),
        (STATUS_RETIRED, "Retired"),
        (STATUS_DECOMMISSIONED, "Decommissioned"),
    ]

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="equipment")
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="equipment")
    name = models.CharField(max_length=200)
    asset_tag = models.CharField(max_length=120, blank=True, default="")
    serial_number = models.CharField(max_length=120, blank=True, default="")
    safe_working_load = models.CharField(max_length=120, default="Not Recorded")
    location = models.CharField(max_length=200, blank=True, default="")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    inspection_interval_days = models.PositiveIntegerField(default=365)
    next_inspection_due = models.DateField(null=True, blank=True)
    last_inspected_at = models.DateField(null=True, blank=True)
    decommissioned_at = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["company__name", "name", "asset_tag"]
        indexes = [
            models.Index(fields=["company", "site", "status"]),
            models.Index(fields=["company", "status"]),
            models.Index(fields=["asset_tag"]),
            models.Index(fields=["serial_number"]),
        ]

    def __str__(self):
        return f"{self.name} ({self.company.name})"


class InspectionReport(models.Model):
    STATUS_DRAFT = "draft"
    STATUS_SUBMITTED = "submitted"
    STATUS_APPROVED = "approved"

    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_SUBMITTED, "Submitted"),
        (STATUS_APPROVED, "Approved"),
    ]

    equipment = models.ForeignKey(Equipment, on_delete=models.CASCADE, related_name="reports")
    submitted_by = models.ForeignKey(
        "auth.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="submitted_reports",
    )
    title = models.CharField(max_length=220)
    summary = models.TextField(blank=True, default="")
    findings = models.TextField(blank=True, default="")
    recommendations = models.TextField(blank=True, default="")
    checklist_items = models.JSONField(default=list, blank=True)
    report_date = models.DateField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    edited_by = models.ForeignKey(
        "auth.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="edited_reports",
    )
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        "auth.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="deleted_reports",
    )
    recovery_expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-report_date", "-created_at"]
        indexes = [
            models.Index(fields=["equipment", "report_date"]),
            models.Index(fields=["equipment", "is_deleted", "updated_at"]),
        ]

    def __str__(self):
        return f"{self.title} - {self.equipment.name}"


class ReportImage(models.Model):
    report = models.ForeignKey(InspectionReport, on_delete=models.CASCADE, related_name="images")
    image_url = models.URLField(max_length=500)
    public_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    checklist_label = models.CharField(max_length=220, blank=True, default="")
    uploaded_by = models.ForeignKey("auth.User", on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Image {self.id} for report {self.report_id}"


class ReportRevision(models.Model):
    report = models.ForeignKey(InspectionReport, on_delete=models.CASCADE, related_name="revisions")
    edited_by = models.ForeignKey("auth.User", on_delete=models.SET_NULL, null=True, blank=True)
    previous_data = models.JSONField(default=dict, blank=True)
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-changed_at"]

    def __str__(self):
        return f"Revision {self.id} for report {self.report_id}"


class Certificate(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="certificates")
    site = models.ForeignKey(
        Site,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="certificates",
    )
    equipment = models.ForeignKey(
        Equipment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="certificates",
    )
    report = models.ForeignKey(
        InspectionReport,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="certificates",
    )
    title = models.CharField(max_length=220)
    file = models.FileField(upload_to="certificates/")
    issue_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    uploaded_by = models.ForeignKey("auth.User", on_delete=models.SET_NULL, null=True, blank=True)
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        "auth.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="deleted_certificates",
    )
    recovery_expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["company", "expiry_date"]),
            models.Index(fields=["company", "is_deleted", "created_at"]),
            models.Index(fields=["recovery_expires_at"]),
        ]

    def __str__(self):
        return self.title


class AuditLog(models.Model):
    actor = models.ForeignKey("auth.User", on_delete=models.SET_NULL, null=True, blank=True)
    company = models.ForeignKey("Company", on_delete=models.SET_NULL, null=True, blank=True)
    action = models.CharField(max_length=120, db_index=True)
    target_type = models.CharField(max_length=120)
    target_id = models.CharField(max_length=120, blank=True, default="")
    details = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["action", "created_at"]),
            models.Index(fields=["company", "created_at"]),
        ]

    def __str__(self):
        return f"{self.action} ({self.target_type}:{self.target_id})"


class OrderEmailDelivery(models.Model):
    PURPOSE_CONFIRMED = "confirmed"
    PURPOSE_SHIPPED = "shipped"
    PURPOSE_DELIVERED = "delivered"
    PURPOSE_CANCELED = "canceled"
    PURPOSE_REFUNDED = "refunded"
    PURPOSE_CHOICES = [(value, value.title()) for value in (PURPOSE_CONFIRMED, PURPOSE_SHIPPED, PURPOSE_DELIVERED, PURPOSE_CANCELED, PURPOSE_REFUNDED)]
    STATUS_PENDING = "pending"
    STATUS_SENT = "sent"
    STATUS_ERROR = "error"
    STATUS_CHOICES = [(STATUS_PENDING, "Pending"), (STATUS_SENT, "Sent"), (STATUS_ERROR, "Error")]

    order = models.ForeignKey(OnsiteOrder, on_delete=models.CASCADE, related_name="email_deliveries")
    purpose = models.CharField(max_length=20, choices=PURPOSE_CHOICES)
    idempotency_key = models.CharField(max_length=160, unique=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    attempts = models.PositiveIntegerField(default=0)
    error_message = models.CharField(max_length=500, blank=True, default="")
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["order", "purpose"], name="unique_order_email_purpose")]

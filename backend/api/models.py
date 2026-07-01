from django.db import models


class PendingCheckout(models.Model):
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


class OnsiteOrder(models.Model):
    STATUS_PENDING = "pending"
    STATUS_PROCESSING = "processing"
    STATUS_PAID = "paid"
    STATUS_FAILED = "failed"
    STATUS_CANCELED = "canceled"

    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_PROCESSING, "Processing"),
        (STATUS_PAID, "Paid"),
        (STATUS_FAILED, "Failed"),
        (STATUS_CANCELED, "Canceled"),
    ]

    checkout_ref = models.CharField(max_length=100, unique=True)
    status_token = models.CharField(max_length=128, default="", db_index=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    line_items = models.JSONField(default=list, blank=True)
    amount_total_cents = models.PositiveIntegerField(default=0)
    currency = models.CharField(max_length=8, default="EUR")
    customer_name = models.CharField(max_length=150, blank=True, default="")
    customer_email = models.EmailField(blank=True, default="")
    payment_intent_id = models.CharField(max_length=128, blank=True, default="", db_index=True)
    payment_client_secret = models.CharField(max_length=255, blank=True, default="")
    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.checkout_ref} ({self.status})"


class ProcessedStripeEvent(models.Model):
    event_id = models.CharField(max_length=128, unique=True)
    event_type = models.CharField(max_length=80, blank=True, default="")
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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "title", "handle"]

    def __str__(self):
        return self.title or self.handle

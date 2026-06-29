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
    shopify_cart_id = models.CharField(max_length=255, blank=True, default="")
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

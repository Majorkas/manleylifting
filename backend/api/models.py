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

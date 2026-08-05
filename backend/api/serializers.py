from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
import json

from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.utils import get_md5_hash_password

from .auth_sessions import (
    SESSION_GENERATION_CLAIM,
    SESSION_ID_CLAIM,
    create_account_session,
    get_user_session_generation,
    parse_refresh_token,
    token_has_current_session_generation,
)
from .auth_backends import resolve_login_user
from .models import AccountSession, Certificate, Company, Equipment, InspectionReport, ReportImage, ReportRevision, Site, UserProfile

REPORT_CHECKLIST_ALLOWED_STATUSES = {
    "good_order",
    "worn_serviceable",
    "attention_required",
    "not_presented",
}


def _normalize_days_before_reinspection(value):
    raw_value = str(value or "").strip()
    if not raw_value:
        return ""

    try:
        days_before_reinspection = int(raw_value)
    except (TypeError, ValueError):
        raise serializers.ValidationError("Days before reinspection must be a whole number.")

    if days_before_reinspection < 1:
        raise serializers.ValidationError("Days before reinspection must be at least 1.")

    return days_before_reinspection


def validate_report_checklist_items(items, require_notes=True):
    if items in (None, ""):
        return []

    if isinstance(items, str):
        try:
            items = json.loads(items)
        except (TypeError, ValueError):
            raise serializers.ValidationError("Checklist items must be valid JSON.")

    if not isinstance(items, list):
        raise serializers.ValidationError("Checklist items must be a list.")

    validated_items = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise serializers.ValidationError(f"Checklist item {index + 1} must be an object.")

        label = str(item.get("label") or "").strip()
        status = str(item.get("status") or "good_order").strip()
        finding = str(item.get("finding") or item.get("note") or "").strip()
        recommendation = str(item.get("recommendation") or "").strip()
        days_before_reinspection = _normalize_days_before_reinspection(item.get("days_before_reinspection"))

        if not label:
            raise serializers.ValidationError(f"Checklist item {index + 1} is missing a label.")

        if status not in REPORT_CHECKLIST_ALLOWED_STATUSES:
            raise serializers.ValidationError(
                f"Checklist item '{label}' has an invalid status '{status}'."
            )

        if require_notes and status in {"worn_serviceable", "attention_required"} and not finding:
            raise serializers.ValidationError(
                f"Checklist item '{label}' requires a finding when status is not Good Order."
            )

        if require_notes and status in {"worn_serviceable", "attention_required"} and not recommendation:
            raise serializers.ValidationError(
                f"Checklist item '{label}' requires a recommendation when status is not Good Order."
            )

        validated_items.append(
            {
                "label": label,
                "status": status,
                "finding": finding,
                "recommendation": recommendation,
                "days_before_reinspection": days_before_reinspection,
            }
        )

    return validated_items


class CompanyHeaderSerializer(serializers.ModelSerializer):
    inspections_due_count = serializers.IntegerField(read_only=True)
    inspections_overdue_count = serializers.IntegerField(read_only=True)
    sites = serializers.SerializerMethodField()

    def get_sites(self, obj):
        return SiteSerializer(obj.sites.all(), many=True).data

    class Meta:
        model = Company
        fields = [
            "id",
            "name",
            "slug",
            "logo",
            "contact_email",
            "contact_phone",
            "address",
            "sites",
            "inspections_due_count",
            "inspections_overdue_count",
        ]


class SiteSerializer(serializers.ModelSerializer):
    company_id = serializers.IntegerField(source="company.id", read_only=True)

    class Meta:
        model = Site
        fields = ["id", "company_id", "name", "address", "created_at", "updated_at"]


class EquipmentSerializer(serializers.ModelSerializer):
    company_id = serializers.IntegerField(source="company.id", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)
    site_id = serializers.IntegerField(source="site.id", read_only=True)
    site_name = serializers.CharField(source="site.name", read_only=True)
    inspection_status_key = serializers.SerializerMethodField()
    inspection_status_label = serializers.SerializerMethodField()

    class Meta:
        model = Equipment
        fields = [
            "id",
            "company_id",
            "company_name",
            "site_id",
            "site_name",
            "name",
            "asset_tag",
            "serial_number",
            "safe_working_load",
            "location",
            "status",
            "inspection_status_key",
            "inspection_status_label",
            "inspection_interval_days",
            "next_inspection_due",
            "last_inspected_at",
            "decommissioned_at",
            "notes",
        ]

    def _get_latest_approved_report(self, obj):
        report_by_id = self.context.get("latest_approved_report_by_equipment_id") or {}
        report = report_by_id.get(obj.id)
        if report is not None:
            return report

        return (
            obj.reports.filter(status=InspectionReport.STATUS_APPROVED, is_deleted=False)
            .exclude(report_date__isnull=True)
            .order_by("-report_date", "-id")
            .first()
        )

    def _get_inspection_status(self, obj):
        latest_report = self._get_latest_approved_report(obj)
        if not latest_report:
            return "no_approved_report", "No Approved Report"

        checklist_items = getattr(latest_report, "checklist_items", []) if isinstance(getattr(latest_report, "checklist_items", []), list) else []
        has_attention_required = False
        has_worn_serviceable = False
        has_not_presented = False
        for item in checklist_items:
            if not isinstance(item, dict):
                continue
            status = str(item.get("status") or "").strip().lower()
            if status == "attention_required":
                has_attention_required = True
                break
            if status == "worn_serviceable":
                has_worn_serviceable = True
            if status == "not_presented":
                has_not_presented = True

        if has_attention_required:
            return "attention_required", "Attention Required"
        if has_worn_serviceable:
            return "worn_serviceable", "Worn"
        if has_not_presented:
            return "not_presented", "Not Presented"
        return "good_order", "Good Order"

    def get_inspection_status_key(self, obj):
        return self._get_inspection_status(obj)[0]

    def get_inspection_status_label(self, obj):
        return self._get_inspection_status(obj)[1]


class EquipmentCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Equipment
        fields = [
            "name",
            "asset_tag",
            "serial_number",
            "safe_working_load",
            "location",
            "status",
            "inspection_interval_days",
            "last_inspected_at",
            "notes",
        ]
        extra_kwargs = {
            "safe_working_load": {"required": True, "allow_blank": False},
        }

    def validate_safe_working_load(self, value):
        safe_working_load = str(value or "").strip()
        if not safe_working_load:
            raise serializers.ValidationError("Safe working load is required.")
        return safe_working_load

    def create(self, validated_data):
        last_inspected_at = validated_data.get("last_inspected_at")
        inspection_interval_days = validated_data.get("inspection_interval_days") or 365

        if last_inspected_at:
            validated_data["next_inspection_due"] = last_inspected_at + timedelta(
                days=inspection_interval_days,
            )
        else:
            validated_data["next_inspection_due"] = None

        return super().create(validated_data)


class SiteCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Site
        fields = ["name", "address"]


class InspectionReportSerializer(serializers.ModelSerializer):
    equipment_id = serializers.IntegerField(source="equipment.id", read_only=True)
    equipment_name = serializers.CharField(source="equipment.name", read_only=True)
    company_id = serializers.IntegerField(source="equipment.company.id", read_only=True)
    company_name = serializers.CharField(source="equipment.company.name", read_only=True)
    submitted_by_name = serializers.SerializerMethodField()
    edited_by_name = serializers.SerializerMethodField()
    images = serializers.SerializerMethodField()

    class Meta:
        model = InspectionReport
        fields = [
            "id",
            "equipment_id",
            "equipment_name",
            "company_id",
            "company_name",
            "title",
            "summary",
            "findings",
            "recommendations",
            "checklist_items",
            "report_date",
            "status",
            "submitted_by",
            "submitted_by_name",
            "edited_by",
            "edited_by_name",
            "images",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["submitted_by", "edited_by", "created_at", "updated_at"]

    def get_submitted_by_name(self, obj):
        if not obj.submitted_by:
            return ""
        return obj.submitted_by.get_full_name() or obj.submitted_by.username

    def get_edited_by_name(self, obj):
        if not obj.edited_by:
            return ""
        return obj.edited_by.get_full_name() or obj.edited_by.username

    def get_images(self, obj):
        return ReportImageSerializer(obj.images.all(), many=True).data


class ReportImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReportImage
        fields = ["id", "image_url", "public_id", "checklist_label", "created_at"]


class InspectionReportCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = InspectionReport
        fields = [
            "title",
            "summary",
            "findings",
            "recommendations",
            "checklist_items",
            "report_date",
            "status",
        ]

    def validate_checklist_items(self, value):
            initial_data = getattr(self, "initial_data", {}) or {}
            status_value = str(initial_data.get("status") or InspectionReport.STATUS_DRAFT).strip()
            return validate_report_checklist_items(value, require_notes=status_value != InspectionReport.STATUS_DRAFT)


class InspectionReportUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = InspectionReport
        fields = [
            "title",
            "summary",
            "findings",
            "recommendations",
            "checklist_items",
            "report_date",
            "status",
        ]

    def validate_checklist_items(self, value):
            initial_data = getattr(self, "initial_data", {}) or {}
            status_value = str(initial_data.get("status") or getattr(self.instance, "status", InspectionReport.STATUS_DRAFT)).strip()
            require_notes = status_value != InspectionReport.STATUS_DRAFT
            if self.instance and self.instance.status != InspectionReport.STATUS_DRAFT and status_value == self.instance.status:
                require_notes = False
            return validate_report_checklist_items(value, require_notes=require_notes)


class InspectionReportOwnerEditSerializer(serializers.ModelSerializer):
    class Meta:
        model = InspectionReport
        fields = [
            "title",
            "summary",
            "findings",
            "recommendations",
            "checklist_items",
            "report_date",
            "status",
        ]

    def validate_checklist_items(self, value):
            initial_data = getattr(self, "initial_data", {}) or {}
            status_value = str(initial_data.get("status") or getattr(self.instance, "status", InspectionReport.STATUS_DRAFT)).strip()
            require_notes = status_value != InspectionReport.STATUS_DRAFT
            if self.instance and self.instance.status != InspectionReport.STATUS_DRAFT and status_value == self.instance.status:
                require_notes = False
            return validate_report_checklist_items(value, require_notes=require_notes)


class ReportRevisionSerializer(serializers.ModelSerializer):
    edited_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ReportRevision
        fields = ["id", "report", "edited_by", "edited_by_name", "previous_data", "changed_at"]

    def get_edited_by_name(self, obj):
        if not obj.edited_by:
            return ""
        return obj.edited_by.get_full_name() or obj.edited_by.username


class CertificateSerializer(serializers.ModelSerializer):
    company_id = serializers.IntegerField(source="company.id", read_only=True)
    equipment_id = serializers.IntegerField(source="equipment.id", read_only=True)
    site_id = serializers.IntegerField(source="site.id", read_only=True)

    class Meta:
        model = Certificate
        fields = [
            "id",
            "company_id",
            "site_id",
            "equipment_id",
            "report",
            "title",
            "file",
            "issue_date",
            "expiry_date",
            "created_at",
        ]


class PortalMeSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField()
    email = serializers.EmailField(allow_blank=True)
    full_name = serializers.CharField(allow_blank=True)
    role = serializers.ChoiceField(choices=UserProfile.ROLE_CHOICES)
    allowed_company_ids = serializers.ListField(child=serializers.IntegerField())
    required_password_change = serializers.BooleanField()


class AccountCapabilitiesSerializer(serializers.Serializer):
    can_shop = serializers.BooleanField()
    can_view_orders = serializers.BooleanField()
    can_access_portal = serializers.BooleanField()


class AccountBootstrapSerializer(serializers.Serializer):
    username = serializers.CharField()
    email = serializers.EmailField(allow_blank=True)
    full_name = serializers.CharField(allow_blank=True)
    phone = serializers.CharField(allow_blank=True, required=False)
    email_verified = serializers.BooleanField()
    capabilities = AccountCapabilitiesSerializer()


class CommerceRegistrationSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(write_only=True, min_length=12, max_length=128)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    recipient_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    recipient_phone = serializers.CharField(max_length=50, required=False, allow_blank=True)
    address_line_1 = serializers.CharField(max_length=200, required=False, allow_blank=True)
    address_line_2 = serializers.CharField(max_length=200, required=False, allow_blank=True)
    city = serializers.CharField(max_length=120, required=False, allow_blank=True)
    county = serializers.CharField(max_length=120, required=False, allow_blank=True)
    postcode = serializers.CharField(max_length=40, required=False, allow_blank=True)
    country_code = serializers.CharField(max_length=2, required=False, allow_blank=True)
    accept_terms = serializers.BooleanField()
    accept_privacy = serializers.BooleanField()
    turnstile_token = serializers.CharField(
        max_length=2048,
        required=False,
        allow_blank=True,
        write_only=True,
    )

    def validate_email(self, value):
        return str(value).strip().lower()

    def validate_password(self, value):
        user = get_user_model()(
            email=str(self.initial_data.get("email") or "").strip().lower(),
            first_name=str(self.initial_data.get("first_name") or "").strip(),
            last_name=str(self.initial_data.get("last_name") or "").strip(),
        )
        try:
            validate_password(value, user=user)
        except DjangoValidationError as error:
            raise serializers.ValidationError(list(error.messages)) from error
        return value

    def validate_accept_terms(self, value):
        if not value:
            raise serializers.ValidationError("Terms acceptance is required.")
        return value

    def validate_accept_privacy(self, value):
        if not value:
            raise serializers.ValidationError("Privacy notice acceptance is required.")
        return value


class AccountEmailSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    turnstile_token = serializers.CharField(
        max_length=2048,
        required=False,
        allow_blank=True,
        write_only=True,
    )

    def validate_email(self, value):
        return str(value).strip().lower()


class VerifyEmailSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=256, trim_whitespace=True)


class PasswordResetCompleteSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=256, trim_whitespace=True)
    new_password = serializers.CharField(write_only=True, min_length=12, max_length=128)

    def validate_new_password(self, value):
        user = get_user_model()(email="")
        try:
            validate_password(value, user=user)
        except DjangoValidationError as error:
            raise serializers.ValidationError(list(error.messages)) from error
        return value


class PortalChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, min_length=8, max_length=128)
    new_password = serializers.CharField(write_only=True, min_length=8, max_length=128)


class AccountChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, min_length=8, max_length=128)
    new_password = serializers.CharField(write_only=True, min_length=8, max_length=128)


class AccountDisableSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, min_length=8, max_length=128)
    reason = serializers.CharField(required=False, allow_blank=True, max_length=500)


class AccountDeleteSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, min_length=8, max_length=128)
    confirm = serializers.BooleanField()


class UserProfileAssignmentSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    full_name = serializers.SerializerMethodField()
    is_active = serializers.BooleanField(source="user.is_active", read_only=True)
    allowed_company_ids = serializers.SerializerMethodField()

    class Meta:
        model = UserProfile
        fields = [
            "user_id",
            "username",
            "email",
            "full_name",
            "is_active",
            "role",
            "allowed_company_ids",
        ]

    def get_full_name(self, obj):
        return obj.user.get_full_name() or ""

    def get_allowed_company_ids(self, obj):
        return list(obj.allowed_companies.values_list("id", flat=True))


class UserProfileAssignmentUpdateSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    role = serializers.ChoiceField(choices=UserProfile.ROLE_CHOICES, required=False)
    is_active = serializers.BooleanField(required=False)
    allowed_company_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
    )


class UserProfileAssignmentCreateSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=12, max_length=128)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    role = serializers.ChoiceField(choices=UserProfile.ROLE_CHOICES, required=False)
    allowed_company_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
    )


class PortalCustomerCreateSerializer(serializers.Serializer):
    company_name = serializers.CharField(max_length=200)
    company_contact_email = serializers.EmailField(required=False, allow_blank=True)
    company_contact_phone = serializers.CharField(max_length=50, required=False, allow_blank=True)
    company_address = serializers.CharField(required=False, allow_blank=True)
    customer_username = serializers.CharField(max_length=150)
    customer_email = serializers.EmailField()
    customer_password = serializers.CharField(write_only=True, min_length=8, max_length=128)
    customer_first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    customer_last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)


class PortalCustomerCreateResponseSerializer(serializers.Serializer):
    company = CompanyHeaderSerializer()
    customer = serializers.DictField()


class PortalCustomerUpdateSerializer(serializers.Serializer):
    company_id = serializers.IntegerField(min_value=1)
    company_name = serializers.CharField(max_length=200, required=False)
    company_contact_email = serializers.EmailField(required=False, allow_blank=True)
    company_contact_phone = serializers.CharField(max_length=50, required=False, allow_blank=True)
    company_address = serializers.CharField(required=False, allow_blank=True)
    is_active = serializers.BooleanField(required=False)

    def validate(self, attrs):
        updatable_fields = {
            "company_name",
            "company_contact_email",
            "company_contact_phone",
            "company_address",
            "is_active",
        }
        if not any(field in attrs for field in updatable_fields):
            raise serializers.ValidationError("At least one field is required for update")
        return attrs


class PortalTokenObtainPairSerializer(TokenObtainPairSerializer):
    default_error_messages = {
        "no_active_account": "Invalid credentials",
    }

    LOGIN_FAILURE_LIMIT = 5
    LOCKOUT_SECONDS = 15 * 60

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token[SESSION_GENERATION_CLAIM] = get_user_session_generation(user)
        return token

    def _login_failure_cache_key(self, username):
        normalized = str(username or "").strip().lower()
        return f"portal_login_failures:{normalized}"

    def validate(self, attrs):
        username = str(attrs.get("username") or "").strip()
        password = attrs.get("password")

        if not username:
            raise serializers.ValidationError({"detail": "Username is required"})

        if not password:
            raise serializers.ValidationError({"detail": "Password is required"})

        failure_key = self._login_failure_cache_key(username)
        failed_attempts = int(cache.get(failure_key, 0) or 0)
        if failed_attempts >= self.LOGIN_FAILURE_LIMIT:
            raise serializers.ValidationError(
                {"detail": "Account temporarily locked due to failed login attempts. Try again in 15 minutes."}
            )

        user = resolve_login_user(username)

        if user is None:
            get_user_model()().set_password(password)
        if user is None or not user.check_password(password):
            cache.set(failure_key, failed_attempts + 1, timeout=self.LOCKOUT_SECONDS)
            next_attempt_count = failed_attempts + 1
            if next_attempt_count >= self.LOGIN_FAILURE_LIMIT:
                raise serializers.ValidationError(
                    {"detail": "Account temporarily locked due to failed login attempts. Try again in 15 minutes."}
                )
            raise serializers.ValidationError({"detail": "Invalid credentials"})

        if not user.is_active:
            raise serializers.ValidationError({"detail": "Account is disabled"})

        cache.delete(failure_key)

        with transaction.atomic():
            data = super().validate(attrs)
            refresh_token = self.token_class(data["refresh"])
            create_account_session(user=self.user, refresh_token=refresh_token)
            data["refresh"] = str(refresh_token)
            data["access"] = str(refresh_token.access_token)
            return data


class PortalTokenRefreshSerializer(TokenRefreshSerializer):
    refresh = serializers.CharField(required=False, allow_blank=True, write_only=True)

    def validate(self, attrs):
        request = self.context.get("request")
        cookie_name = settings.JWT_REFRESH_COOKIE_NAME
        refresh = str(getattr(request, "COOKIES", {}).get(cookie_name) or "").strip()

        if not refresh:
            raise serializers.ValidationError({"detail": "refresh token is required"})

        untyped_token = parse_refresh_token(refresh)
        user_id = untyped_token.get(api_settings.USER_ID_CLAIM)
        user_model = get_user_model()
        try:
            user = user_model.objects.get(
                **{api_settings.USER_ID_FIELD: user_id}
            )
        except (user_model.DoesNotExist, TypeError, ValueError) as error:
            raise AuthenticationFailed(
                "Session is no longer valid.",
                code="session_revoked",
            ) from error

        session_id = untyped_token.get(SESSION_ID_CLAIM)
        jti = untyped_token.get(api_settings.JTI_CLAIM)
        if not session_id or not jti:
            raise AuthenticationFailed(
                "Session is no longer valid.",
                code="session_revoked",
            )

        with transaction.atomic():
            try:
                account_session = AccountSession.objects.select_for_update().filter(
                    pk=session_id,
                    user=user,
                    revoked_at__isnull=True,
                    expires_at__gt=timezone.now(),
                ).first()
            except (TypeError, ValueError, DjangoValidationError):
                account_session = None

            outstanding_token = OutstandingToken.objects.select_for_update().filter(
                user=user,
                jti=jti,
            ).first()
            if (
                account_session is None
                or outstanding_token is None
                or BlacklistedToken.objects.filter(token=outstanding_token).exists()
            ):
                raise AuthenticationFailed(
                    "Session is no longer valid.",
                    code="session_revoked",
                )

            refresh_token = self.token_class(refresh)
            password_claim = refresh_token.get(api_settings.REVOKE_TOKEN_CLAIM)
            if (
                not token_has_current_session_generation(user, refresh_token)
                or password_claim != get_md5_hash_password(user.password)
            ):
                raise AuthenticationFailed(
                    "Session is no longer valid.",
                    code="session_revoked",
                )

            attrs["refresh"] = refresh
            data = super().validate(attrs)
            account_session.last_seen_at = timezone.now()
            account_session.save(update_fields=["last_seen_at"])
            return data

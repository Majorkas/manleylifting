from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer

from .models import Certificate, Company, Equipment, InspectionReport, ReportImage, ReportRevision, UserProfile


class CompanyHeaderSerializer(serializers.ModelSerializer):
    inspections_due_count = serializers.IntegerField(read_only=True)
    inspections_overdue_count = serializers.IntegerField(read_only=True)

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
            "inspections_due_count",
            "inspections_overdue_count",
        ]


class EquipmentSerializer(serializers.ModelSerializer):
    company_id = serializers.IntegerField(source="company.id", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)

    class Meta:
        model = Equipment
        fields = [
            "id",
            "company_id",
            "company_name",
            "name",
            "asset_tag",
            "serial_number",
            "location",
            "status",
            "inspection_interval_days",
            "next_inspection_due",
            "last_inspected_at",
            "decommissioned_at",
            "notes",
        ]


class EquipmentCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Equipment
        fields = [
            "name",
            "asset_tag",
            "serial_number",
            "location",
            "status",
            "inspection_interval_days",
            "last_inspected_at",
            "notes",
        ]

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
        fields = ["id", "image_url", "public_id", "created_at"]


class InspectionReportCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = InspectionReport
        fields = [
            "title",
            "summary",
            "findings",
            "recommendations",
            "report_date",
            "status",
        ]


class InspectionReportUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = InspectionReport
        fields = [
            "title",
            "summary",
            "findings",
            "recommendations",
            "report_date",
            "status",
        ]


class InspectionReportOwnerEditSerializer(serializers.ModelSerializer):
    class Meta:
        model = InspectionReport
        fields = [
            "title",
            "summary",
            "findings",
            "recommendations",
            "report_date",
            "status",
        ]


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

    class Meta:
        model = Certificate
        fields = [
            "id",
            "company_id",
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


class PortalChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, min_length=8, max_length=128)
    new_password = serializers.CharField(write_only=True, min_length=8, max_length=128)


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
    password = serializers.CharField(write_only=True, min_length=8, max_length=128)
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

    def validate(self, attrs):
        username = str(attrs.get("username") or "").strip()
        password = attrs.get("password")

        if not username:
            raise serializers.ValidationError({"detail": "Username is required"})

        if not password:
            raise serializers.ValidationError({"detail": "Password is required"})

        user_model = get_user_model()
        user = user_model.objects.filter(username__iexact=username).first()

        if user is None:
            raise serializers.ValidationError({"detail": "Incorrect username"})

        if not user.check_password(password):
            raise serializers.ValidationError({"detail": "Incorrect password"})

        if not user.is_active:
            raise serializers.ValidationError({"detail": "Account is disabled"})

        return super().validate(attrs)


class PortalTokenRefreshSerializer(TokenRefreshSerializer):
    refresh = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        refresh = str(attrs.get("refresh") or "").strip()
        if not refresh:
            request = self.context.get("request")
            cookie_name = settings.JWT_REFRESH_COOKIE_NAME
            refresh = str(getattr(request, "COOKIES", {}).get(cookie_name) or "").strip()

        if not refresh:
            raise serializers.ValidationError({"detail": "refresh token is required"})

        attrs["refresh"] = refresh
        return super().validate(attrs)

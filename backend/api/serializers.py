from rest_framework import serializers

from .models import Certificate, Company, Equipment, InspectionReport, UserProfile


class CompanyHeaderSerializer(serializers.ModelSerializer):
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
            "notes",
        ]


class InspectionReportSerializer(serializers.ModelSerializer):
    equipment_id = serializers.IntegerField(source="equipment.id", read_only=True)
    submitted_by_name = serializers.SerializerMethodField()
    edited_by_name = serializers.SerializerMethodField()

    class Meta:
        model = InspectionReport
        fields = [
            "id",
            "equipment_id",
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

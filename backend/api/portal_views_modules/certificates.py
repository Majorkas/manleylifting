import os

from django.http import FileResponse
from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import Certificate, Equipment, InspectionReport
from ..portal_views import _is_staff_or_owner, _validate_certificate_upload, _visible_company_ids
from ..serializers import CertificateSerializer


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def portal_equipment_certificates(request, equipment_id):
    equipment = Equipment.objects.select_related("company").filter(id=equipment_id).first()
    if not equipment:
        return Response({"detail": "Equipment not found"}, status=status.HTTP_404_NOT_FOUND)

    if equipment.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        certificates = Certificate.objects.filter(equipment_id=equipment.id).order_by("-created_at")
        serializer = CertificateSerializer(certificates, many=True, context={"request": request})
        return Response({"results": serializer.data})

    if not _is_staff_or_owner(request.user):
        return Response({"detail": "Insufficient permissions"}, status=status.HTTP_403_FORBIDDEN)

    upload_error = _validate_certificate_upload(request.FILES.get("file"))
    if upload_error:
        return Response({"detail": upload_error}, status=status.HTTP_400_BAD_REQUEST)

    title = str(request.data.get("title") or "").strip()
    if not title:
        return Response({"detail": "title is required"}, status=status.HTTP_400_BAD_REQUEST)

    report_id = request.data.get("report")
    report = None
    if report_id:
        report = InspectionReport.objects.filter(id=report_id, equipment_id=equipment.id).first()
        if not report:
            return Response({"detail": "report is invalid for equipment"}, status=status.HTTP_400_BAD_REQUEST)

    issue_date_raw = request.data.get("issue_date")
    expiry_date_raw = request.data.get("expiry_date")
    issue_date = parse_date(str(issue_date_raw)) if issue_date_raw else None
    expiry_date = parse_date(str(expiry_date_raw)) if expiry_date_raw else None
    if issue_date_raw and issue_date is None:
        return Response({"detail": "issue_date must be YYYY-MM-DD"}, status=status.HTTP_400_BAD_REQUEST)
    if expiry_date_raw and expiry_date is None:
        return Response({"detail": "expiry_date must be YYYY-MM-DD"}, status=status.HTTP_400_BAD_REQUEST)

    certificate = Certificate.objects.create(
        company=equipment.company,
        equipment=equipment,
        report=report,
        title=title,
        file=request.FILES["file"],
        issue_date=issue_date,
        expiry_date=expiry_date,
        uploaded_by=request.user,
    )
    serializer = CertificateSerializer(certificate, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def portal_certificate_download(request, certificate_id):
    certificate = Certificate.objects.select_related("company").filter(id=certificate_id).first()
    if not certificate:
        return Response({"detail": "Certificate not found"}, status=status.HTTP_404_NOT_FOUND)

    if certificate.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if not certificate.file:
        return Response({"detail": "Certificate file not available"}, status=status.HTTP_404_NOT_FOUND)

    filename = os.path.basename(certificate.file.name)
    return FileResponse(certificate.file.open("rb"), as_attachment=True, filename=filename)

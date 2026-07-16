import os
from io import BytesIO
from datetime import timedelta
from urllib.request import urlopen

from django.http import FileResponse
from django.core.files.base import ContentFile
from django.utils.text import slugify
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.utils.html import escape
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..audit import log_portal_audit_event
from ..models import Certificate, Equipment, InspectionReport, Site
from ..portal_views import _is_owner, _is_staff_or_owner, _validate_certificate_upload, _visible_company_ids
from ..serializers import CertificateSerializer
from ..throttles import PortalMethodRateThrottle


CERTIFICATE_RECOVERY_WINDOW_DAYS = 3


def _extract_problem_checklist_items(checklist_items):
    worn_items = []
    attention_required_items = []
    not_presented_items = []
    good_order_count = 0

    for raw_item in checklist_items if isinstance(checklist_items, list) else []:
        if not isinstance(raw_item, dict):
            continue

        status = str(raw_item.get("status") or "").strip().lower()
        label = str(raw_item.get("label") or "").strip() or "Unnamed checklist item"
        finding = str(raw_item.get("finding") or raw_item.get("note") or "").strip()
        recommendation = str(raw_item.get("recommendation") or "").strip()

        normalized_item = {
            "label": label,
            "finding": finding,
            "recommendation": recommendation,
        }

        if status == "worn_serviceable":
            worn_items.append(normalized_item)
        elif status == "attention_required":
            attention_required_items.append(normalized_item)
        elif status == "not_presented":
            not_presented_items.append(normalized_item)
        elif status == "good_order":
            good_order_count += 1

    return worn_items, attention_required_items, not_presented_items, good_order_count


def _equipment_report_sort_key(item):
    equipment = item.get("equipment")
    report = item.get("report")
    if not report:
        return (4, str(getattr(equipment, "name", "") or ""), str(getattr(equipment, "asset_tag", "") or ""), int(getattr(equipment, "id", 0) or 0))

    worn_items, attention_required_items, not_presented_items, _ = _extract_problem_checklist_items(
        getattr(report, "checklist_items", [])
    )
    if not_presented_items:
        priority = 0
    elif attention_required_items:
        priority = 1
    elif worn_items:
        priority = 2
    else:
        priority = 3

    return (
        priority,
        str(getattr(equipment, "name", "") or ""),
        str(getattr(equipment, "asset_tag", "") or ""),
        int(getattr(equipment, "id", 0) or 0),
    )


def _build_company_logo_flowable(company, max_width, max_height):
    from django.conf import settings
    from reportlab.platypus import Image

    logo_source, logo_buffer = _resolve_company_logo_asset(company)

    if not logo_source and logo_buffer is None:
        return None

    logo_image = Image(logo_source or logo_buffer, width=max_width, height=max_height, kind="proportional")
    logo_image.hAlign = "CENTER"
    return logo_image


def _resolve_brand_logo_asset():
    from django.conf import settings

    candidates = []
    frontend_public = os.path.abspath(os.path.join(getattr(settings, "BASE_DIR", ""), "..", "frontend", "public"))
    candidates.extend(
        [
            os.path.join(frontend_public, "logo-navbar.png"),
            os.path.join(frontend_public, "logo-hero.png"),
            os.path.join(frontend_public, "main.JPG"),
        ]
    )

    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate

    return None


def _resolve_signature_asset():
    from django.conf import settings

    frontend_public = os.path.abspath(os.path.join(getattr(settings, "BASE_DIR", ""), "..", "frontend", "public"))
    candidates = [
        os.path.join(frontend_public, "signature.JPG"),
        os.path.join(frontend_public, "signature.jpg"),
        os.path.join(frontend_public, "signature.png"),
    ]

    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate

    return None


def _resolve_company_logo_asset(company):
    from django.conf import settings

    logo_field = getattr(company, "logo", None)
    if not logo_field:
        return "", None

    logo_source = ""
    logo_buffer = None

    try:
        candidate_path = str(logo_field.path or "").strip()
        if candidate_path and os.path.exists(candidate_path):
            logo_source = candidate_path
    except Exception:
        logo_source = ""

    if not logo_source:
        logo_name = str(getattr(logo_field, "name", "") or "").strip()
        media_root = str(getattr(settings, "MEDIA_ROOT", "") or "").strip()
        if logo_name and media_root:
            candidate_path = os.path.join(media_root, logo_name.replace("/", os.sep))
            if os.path.exists(candidate_path):
                logo_source = candidate_path

    if not logo_source:
        try:
            logo_url = str(logo_field.url or "").strip()
        except Exception:
            logo_url = ""

        if logo_url.lower().startswith(("http://", "https://")):
            try:
                with urlopen(logo_url, timeout=5) as response:
                    logo_buffer = BytesIO(response.read())
            except Exception:
                logo_buffer = None

    return logo_source, logo_buffer


def _build_site_certificate_pdf(site, equipment_reports):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=46 * mm,
        bottomMargin=28 * mm,
        title=f"Certificate Register - {site.name}",
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "CoverTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        alignment=1,
        spaceAfter=10,
    )
    subtitle_style = ParagraphStyle(
        "CoverSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=16,
        alignment=1,
        spaceAfter=6,
    )
    paragraph_style = ParagraphStyle(
        "CoverParagraph",
        parent=styles["Normal"],
        fontSize=10.5,
        leading=14,
        spaceAfter=8,
    )
    meta_style = ParagraphStyle(
        "CoverMeta",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=14,
        spaceAfter=4,
        textColor=colors.HexColor("#0F172A"),
    )
    cover_brand_title_style = ParagraphStyle(
        "CoverBrandTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        alignment=0,
        textColor=colors.white,
        spaceAfter=6,
    )
    cover_brand_subtitle_style = ParagraphStyle(
        "CoverBrandSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=11,
        leading=14,
        alignment=0,
        textColor=colors.HexColor("#E2E8F0"),
        spaceAfter=0,
    )
    cover_info_label_style = ParagraphStyle(
        "CoverInfoLabel",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=13,
        textColor=colors.HexColor("#123A7A"),
    )
    cover_info_value_style = ParagraphStyle(
        "CoverInfoValue",
        parent=styles["Normal"],
        fontSize=10,
        leading=13,
        textColor=colors.HexColor("#0F172A"),
    )
    detail_heading_style = ParagraphStyle(
        "DetailHeading",
        parent=styles["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=15,
        spaceAfter=5,
        textColor=colors.HexColor("#0F172A"),
    )
    detail_heading_alert_style = ParagraphStyle(
        "DetailHeadingAlert",
        parent=detail_heading_style,
        textColor=colors.HexColor("#9A3412"),
        backColor=colors.HexColor("#FFF7ED"),
        borderPadding=4,
    )
    detail_body_style = ParagraphStyle(
        "DetailBody",
        parent=styles["Normal"],
        fontSize=9.5,
        leading=13,
        spaceAfter=4,
    )
    detail_issue_style = ParagraphStyle(
        "DetailIssue",
        parent=styles["Normal"],
        fontSize=9,
        leading=12,
        leftIndent=8,
        spaceAfter=2,
    )
    detail_muted_style = ParagraphStyle(
        "DetailMuted",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.HexColor("#475569"),
        leading=12,
        spaceAfter=4,
    )
    register_cell_style = ParagraphStyle(
        "RegisterCell",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#0F172A"),
        wordWrap="CJK",
        splitLongWords=True,
    )
    register_status_style = ParagraphStyle(
        "RegisterStatus",
        parent=register_cell_style,
        fontName="Helvetica-Bold",
    )
    detail_alert_style = ParagraphStyle(
        "DetailAlert",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9.5,
        leading=13,
        textColor=colors.HexColor("#9A3412"),
        backColor=colors.HexColor("#FFF7ED"),
        borderPadding=3,
        spaceAfter=5,
    )

    equipment_header_style = ParagraphStyle(
        "EquipmentHeader",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        alignment=1,
        textColor=colors.white,
    )
    equipment_cell_style = ParagraphStyle(
        "EquipmentCell",
        parent=register_cell_style,
        fontSize=7.4,
        leading=9,
    )
    equipment_cell_center_style = ParagraphStyle(
        "EquipmentCellCenter",
        parent=equipment_cell_style,
        alignment=1,
    )
    page_intro_style = ParagraphStyle(
        "PageIntro",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=15,
        alignment=1,
        textColor=colors.HexColor("#0F172A"),
        spaceAfter=8,
    )

    generated_on = timezone.localtime(timezone.now()).strftime("%d/%m/%Y")
    company_name = str(getattr(site.company, "name", "") or "Company").strip() or "Company"
    site_name = escape(site.name or "-")
    site_address = escape(site.address or "-")

    logo_source = _resolve_brand_logo_asset()
    logo_buffer = None
    logo_reader = None
    if logo_source:
        try:
            logo_reader = ImageReader(logo_source)
        except Exception:
            logo_reader = None

    signature_asset = _resolve_signature_asset()
    signature_image = None
    if signature_asset:
        try:
            signature_image = Image(signature_asset, width=34 * mm, height=12 * mm, kind="proportional")
            signature_image.hAlign = "LEFT"
        except Exception:
            signature_image = None

    footer_lines = [
        "Kilnamanagh Upper Oulart, Gorey Co Wexford.",
        "email michael@manleylifting.ie",
        "Ph 053 9136337 Mobile 087 6819908",
        "Web www.manleylifting.ie",
    ]

    def draw_cover_header(canvas, _doc):
        canvas.saveState()
        page_width, page_height = _doc.pagesize
        page_number = canvas.getPageNumber()

        canvas.setFillColor(colors.HexColor("#123A7A"))
        canvas.setFont("Helvetica-Bold", 10)
        canvas.drawRightString(page_width - _doc.rightMargin, page_height - 12 * mm, f"Page {page_number}")

        if logo_reader:
            logo_width = 68 * mm
            logo_height = 18 * mm
            logo_x = (page_width - logo_width) / 2
            logo_y = page_height - 24 * mm
            canvas.drawImage(
                logo_reader,
                logo_x,
                logo_y,
                width=logo_width,
                height=logo_height,
                preserveAspectRatio=True,
                mask="auto",
            )
        else:
            canvas.setFillColor(colors.HexColor("#123A7A"))
            canvas.setFont("Helvetica-Bold", 22)
            canvas.drawCentredString(page_width / 2, page_height - 20 * mm, company_name)

        canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
        canvas.setLineWidth(0.8)
        canvas.line(_doc.leftMargin, page_height - 28 * mm, page_width - _doc.rightMargin, page_height - 28 * mm)
        canvas.restoreState()

    def draw_content_header(canvas, _doc):
        canvas.saveState()
        page_width, page_height = _doc.pagesize

        canvas.setFillColor(colors.HexColor("#123A7A"))
        canvas.setFont("Helvetica-Bold", 10)
        canvas.drawRightString(page_width - _doc.rightMargin, page_height - 12 * mm, f"Page {canvas.getPageNumber()}")

        if logo_reader:
            logo_width = 52 * mm
            logo_height = 14 * mm
            logo_x = (page_width - logo_width) / 2
            logo_y = page_height - 20 * mm
            canvas.drawImage(
                logo_reader,
                logo_x,
                logo_y,
                width=logo_width,
                height=logo_height,
                preserveAspectRatio=True,
                mask="auto",
            )
        else:
            canvas.setFont("Helvetica-Bold", 18)
            canvas.drawCentredString(page_width / 2, page_height - 17 * mm, company_name)

        canvas.setFillColor(colors.HexColor("#0F172A"))
        canvas.setFont("Helvetica-Bold", 11)
        canvas.drawCentredString(page_width / 2, page_height - 27 * mm, company_name)
        canvas.setFont("Helvetica", 9.2)
        canvas.drawCentredString(page_width / 2, page_height - 31 * mm, site_name)
        canvas.drawCentredString(page_width / 2, page_height - 35 * mm, site_address)
        canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
        canvas.setLineWidth(0.8)
        canvas.line(_doc.leftMargin, page_height - 39 * mm, page_width - _doc.rightMargin, page_height - 39 * mm)
        canvas.restoreState()

    def draw_footer(canvas, _doc):
        canvas.saveState()
        page_width = _doc.pagesize[0]
        footer_y = 11 * mm
        canvas.setFillColor(colors.HexColor("#0F172A"))
        canvas.setFont("Helvetica", 7.8)
        canvas.drawString(_doc.leftMargin, footer_y + 8, footer_lines[0])
        canvas.drawRightString(page_width - _doc.rightMargin, footer_y + 8, footer_lines[1])
        canvas.drawString(_doc.leftMargin, footer_y, footer_lines[2])
        canvas.drawRightString(page_width - _doc.rightMargin, footer_y, footer_lines[3])
        canvas.restoreState()

    def draw_cover_page(canvas, _doc):
        draw_cover_header(canvas, _doc)
        draw_footer(canvas, _doc)

    def draw_content_page(canvas, _doc):
        draw_content_header(canvas, _doc)
        draw_footer(canvas, _doc)

    periods_rows = [
        [
            Paragraph(
                "Description of lifting equipment or lifting accessory or other miscellaneous equipment",
                equipment_header_style,
            ),
            Paragraph("Period within which a thorough examination must occur", equipment_header_style),
        ],
        [
            Paragraph(
                "Lifting accessories including chains, ropes, rings, hooks, shackles, clamps, swivels, spreader beams and spreader frames, vacuum lifting devices",
                equipment_cell_style,
            ),
            Paragraph("6 months", equipment_cell_center_style),
        ],
        [Paragraph("Dumper", equipment_cell_style), Paragraph("Work Equipment regulations", equipment_cell_center_style)],
        [
            Paragraph("Suspended access equipment (Window Cleaning Basket)", equipment_cell_style),
            Paragraph("6 months", equipment_cell_center_style),
        ],
        [Paragraph("Tower crane climbing rig", equipment_cell_style), Paragraph("6 months", equipment_cell_center_style)],
        [
            Paragraph("Mobile elevating work platform (Scissor lift)", equipment_cell_style),
            Paragraph("6 months", equipment_cell_center_style),
        ],
        [Paragraph("Hoist or Lift", equipment_cell_style), Paragraph("12 months", equipment_cell_center_style)],
        [
            Paragraph("Teleporter, Excavator", equipment_cell_style),
            Paragraph("12 months (6 if used to lift persons)", equipment_cell_center_style),
        ],
        [Paragraph("Mast climbing work platform", equipment_cell_style), Paragraph("6 months", equipment_cell_center_style)],
        [Paragraph("Man Basket", equipment_cell_style), Paragraph("6 months", equipment_cell_center_style)],
        [Paragraph("Crane", equipment_cell_style), Paragraph("12 months", equipment_cell_center_style)],
        [
            Paragraph("Fork lift truck including interchangeable accessories", equipment_cell_style),
            Paragraph("12 months (6 if used to lift persons)", equipment_cell_center_style),
        ],
        [Paragraph("Items provided for support of lifting equipment", equipment_cell_style), Paragraph("12 months", equipment_cell_center_style)],
        [Paragraph("Tailboard goods lift", equipment_cell_style), Paragraph("12 months", equipment_cell_center_style)],
        [
            Paragraph("Crane used in dock work, shipbuilding, ship-repairing", equipment_cell_style),
            Paragraph("12 months", equipment_cell_center_style),
        ],
        [
            Paragraph("Telehandler including interchangeable accessories", equipment_cell_style),
            Paragraph("12 months (6 if used to lift persons)", equipment_cell_center_style),
        ],
    ]

    periods_table = Table(periods_rows, colWidths=[doc.width * 0.55, doc.width * 0.45])
    periods_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#123A7A")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#94A3B8")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
            ]
        )
    )

    def _format_text(value, fallback="-"):
        text = str(value or "").strip()
        return escape(text) if text else fallback

    def _build_equipment_description(equipment):
        lines = []
        name_text = str(getattr(equipment, "name", "") or "").strip()
        asset_tag_text = str(getattr(equipment, "asset_tag", "") or "").strip()
        serial_number_text = str(getattr(equipment, "serial_number", "") or "").strip()
        location_text = str(getattr(equipment, "location", "") or "").strip()

        if name_text:
            lines.append(escape(name_text))
        if asset_tag_text:
            lines.append(f"Asset Tag: {escape(asset_tag_text)}")
        if serial_number_text:
            lines.append(f"Serial No: {escape(serial_number_text)}")
        if location_text:
            lines.append(f"Location: {escape(location_text)}")

        return "<br/>".join(lines) if lines else "-"

    def _build_equipment_issue_summary(report):
        if not report:
            return "No approved report available."

        worn_items, attention_required_items, not_presented_items, _ = _extract_problem_checklist_items(
            getattr(report, "checklist_items", [])
        )
        issue_parts = []

        if attention_required_items:
            for item in attention_required_items:
                issue_line = item["label"]
                if item["finding"]:
                    issue_line = f"{issue_line}: {item['finding']}"
                if item["recommendation"]:
                    issue_line = f"{issue_line} - {item['recommendation']}"
                issue_parts.append(issue_line)
        elif worn_items:
            for item in worn_items:
                issue_line = item["label"]
                if item["finding"]:
                    issue_line = f"{issue_line}: {item['finding']}"
                if item["recommendation"]:
                    issue_line = f"{issue_line} - {item['recommendation']}"
                issue_parts.append(issue_line)
        elif not_presented_items:
            # Keep this concise so the register row stays within page bounds.
            issue_parts.append("Not presented for examination.")
        else:
            issue_parts.append("In good order.")

        findings = str(getattr(report, "findings", "") or "").strip()
        if findings:
            issue_parts.append(findings)

        return "<br/>".join(escape(part) for part in issue_parts if str(part).strip()) or "-"

    def _build_equipment_repair_summary(report):
        if not report:
            return "N/A"

        _, attention_required_items, _, _ = _extract_problem_checklist_items(getattr(report, "checklist_items", []))
        if attention_required_items:
            repair_parts = []
            for item in attention_required_items:
                part = item["label"]
                if item["recommendation"]:
                    part = f"{part}: {item['recommendation']}"
                repair_parts.append(part)
            recommendations = str(getattr(report, "recommendations", "") or "").strip()
            if recommendations:
                repair_parts.append(recommendations)
            return "<br/>".join(escape(part) for part in repair_parts if str(part).strip()) or "N/A"

        recommendations = str(getattr(report, "recommendations", "") or "").strip()
        if recommendations:
            return escape(recommendations)
        return "N/A"

    def _build_equipment_table_row(item):
        equipment = item["equipment"]
        report = item.get("report")
        submitted_by = getattr(report, "submitted_by", None) if report else None
        inspector_name = "-"
        if submitted_by is not None:
            inspector_name = (submitted_by.get_full_name() or submitted_by.username or "").strip() or "-"

        examination_date = escape(report.report_date.isoformat() if report and report.report_date else "-")
        if report and inspector_name != "-":
            examination_by = f"{examination_date}<br/>{escape(inspector_name)}"
        else:
            examination_by = examination_date

        next_examination = escape(equipment.next_inspection_due.isoformat() if equipment.next_inspection_due else "-")

        return [
            Paragraph(_build_equipment_description(equipment), equipment_cell_style),
            Paragraph(_format_text(equipment.safe_working_load, "-"), equipment_cell_center_style),
            Paragraph("Unknown", equipment_cell_center_style),
            Paragraph(examination_by or "-", equipment_cell_style),
            Paragraph(next_examination, equipment_cell_center_style),
            Paragraph(_build_equipment_issue_summary(report), equipment_cell_style),
            Paragraph(_build_equipment_repair_summary(report), equipment_cell_style),
        ]

    color_key_rows = [
        [Paragraph("Colour Key", equipment_header_style), Paragraph("Meaning", equipment_header_style)],
        [Paragraph("Blue", equipment_cell_style), Paragraph("Not Presented - item was not presented for examination and due date remains unchanged", equipment_cell_style)],
        [Paragraph("Red", equipment_cell_style), Paragraph("Attention Required - urgent defects or issues that need immediate action", equipment_cell_style)],
        [Paragraph("Amber", equipment_cell_style), Paragraph("Worn but Serviceable - item remains usable but should be monitored or repaired", equipment_cell_style)],
        [Paragraph("White", equipment_cell_style), Paragraph("Good Order / Standard register presentation", equipment_cell_style)],
    ]
    color_key_table = Table(color_key_rows, colWidths=[32 * mm, doc.width - (32 * mm)])
    color_key_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#123A7A")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
            ]
        )
    )

    story = [
        Spacer(1, 2 * mm),
        Paragraph("General Regulations 2007", subtitle_style),
        Paragraph("The Safety, Health and Welfare at Work (General Application)", subtitle_style),
        Paragraph("Regulation 2007 SI no. 299 of 2007", subtitle_style),
        Spacer(1, 6),
        Paragraph("Certificate of Thorough Examination GA1", title_style),
        Paragraph(f"DATE: {escape(generated_on)}", meta_style),
        Spacer(1, 8),
        Paragraph("Dear Sir/Madam", paragraph_style),
        Paragraph(
            "Please find enclosed your Register of Equipment inspected recently. "
            "This register complies fully with the Safety Health and Welfare at work "
            "(General Application) Regulations 2007.",
            paragraph_style,
        ),
        Paragraph(
            "Your attention should be drawn to any defects noted. "
            "General Application 2007 SI no. 299 of 2007.",
            paragraph_style,
        ),
        Paragraph(
            "Defect(s), which is or could become a danger to persons or any defect(s) repaired, "
            "renewed or alteration required to rectify a defect found to be a danger to persons, "
            "Must be reported to the Health and Safety Authority within 20 days.",
            paragraph_style,
        ),
        Paragraph(
            "If you need any information, please do not hesitate to contact me.",
            paragraph_style,
        ),
        Spacer(1, 6),
        Paragraph("Yours Faithfully", paragraph_style),
        Spacer(1, 2),
        Paragraph("Michael Manley", paragraph_style),
        Spacer(1, 1),
        signature_image if signature_image else Spacer(1, 14),
        PageBreak(),
        Paragraph("Name of Owner or Employer:", page_intro_style),
        Paragraph(f"{escape(company_name)} - {site_name}", subtitle_style),
        Paragraph("Address of Site Premises:", page_intro_style),
        Paragraph(site_address, subtitle_style),
        Spacer(1, 6),
        Paragraph("General Application -", styles["Heading3"]),
        Paragraph(
            "Period of thorough examination of lifting equipment, lifting accessory equipment or other miscellaneous equipment",
            paragraph_style,
        ),
        Paragraph(
            "This Register must be kept for inspection by H.S.A Inspectors for five years (or other prescribed period) after date of the last entry.",
            paragraph_style,
        ),
        Spacer(1, 8),
        periods_table,
        Spacer(1, 8),
        color_key_table,
        PageBreak(),
        Paragraph("Equipment Examination Register", styles["Heading2"]),
        Spacer(1, 6),
    ]

    equipment_rows = [
        [
            Paragraph(
                "Distinguishing number or mark and description sufficient to identify the item",
                equipment_header_style,
            ),
            Paragraph("Safe Working Load", equipment_header_style),
            Paragraph("Date of Manufacture", equipment_header_style),
            Paragraph("Date and by whom carried out the examination", equipment_header_style),
            Paragraph("Date of Next Examination", equipment_header_style),
            Paragraph(
                "Particulars of any defect found on parts. Identify any part found to have defect which is or could become a danger to persons and describe the defect",
                equipment_header_style,
            ),
            Paragraph(
                "Repairs carried out or item to be scrapped and dates when repair should be completed",
                equipment_header_style,
            ),
        ]
    ]
    equipment_row_statuses = []
    for item in equipment_reports:
        equipment = item["equipment"]
        report = item.get("report")
        worn_items, attention_required_items, not_presented_items, _ = _extract_problem_checklist_items(
            getattr(report, "checklist_items", []) if report else []
        )
        row_status = "good"
        if attention_required_items:
            row_status = "attention_required"
        elif worn_items:
            row_status = "worn"
        elif not_presented_items:
            row_status = "not_presented"
        equipment_row_statuses.append(row_status)
        equipment_rows.append(_build_equipment_table_row(item))

    equipment_table = Table(
        equipment_rows,
        repeatRows=1,
        colWidths=[
            34 * mm,
            16 * mm,
            15 * mm,
            25 * mm,
            18 * mm,
            34 * mm,
            28 * mm,
        ],
    )
    equipment_table_styles = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#123A7A")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
    ]
    for row_index, row_status in enumerate(equipment_row_statuses, start=1):
        if row_status == "attention_required":
            equipment_table_styles.extend(
                [
                    ("BACKGROUND", (0, row_index), (-1, row_index), colors.HexColor("#FEE2E2")),
                    ("TEXTCOLOR", (0, row_index), (-1, row_index), colors.HexColor("#991B1B")),
                    ("FONTNAME", (0, row_index), (-1, row_index), "Helvetica-Bold"),
                ]
            )
        elif row_status == "worn":
            equipment_table_styles.extend(
                [
                    ("BACKGROUND", (0, row_index), (-1, row_index), colors.HexColor("#FFF7ED")),
                    ("TEXTCOLOR", (0, row_index), (-1, row_index), colors.HexColor("#9A3412")),
                    ("FONTNAME", (0, row_index), (-1, row_index), "Helvetica-Bold"),
                ]
            )
        elif row_status == "not_presented":
            equipment_table_styles.extend(
                [
                    ("BACKGROUND", (0, row_index), (-1, row_index), colors.HexColor("#DBEAFE")),
                    ("TEXTCOLOR", (0, row_index), (-1, row_index), colors.HexColor("#1E3A8A")),
                    ("FONTNAME", (0, row_index), (-1, row_index), "Helvetica-Bold"),
                ]
            )

    equipment_table.setStyle(TableStyle(equipment_table_styles))
    story.append(equipment_table)

    doc.build(story, onFirstPage=draw_cover_page, onLaterPages=draw_content_page)
    buffer.seek(0)
    return buffer


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def portal_equipment_certificates(request, equipment_id):
    equipment = Equipment.objects.select_related("company").filter(id=equipment_id).first()
    if not equipment:
        return Response({"detail": "Equipment not found"}, status=status.HTTP_404_NOT_FOUND)

    if equipment.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        certificates = Certificate.objects.filter(equipment_id=equipment.id, is_deleted=False).order_by("-created_at")
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
    log_portal_audit_event(
        request=request,
        action="certificate.uploaded",
        target_type="certificate",
        target_id=certificate.id,
        company=equipment.company,
        details={
            "equipment_id": equipment.id,
            "report_id": report.id if report else None,
            "title": certificate.title,
        },
    )
    serializer = CertificateSerializer(certificate, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def portal_certificate_download(request, certificate_id):
    certificate = Certificate.objects.select_related("company").filter(id=certificate_id).first()
    if not certificate:
        return Response({"detail": "Certificate not found"}, status=status.HTTP_404_NOT_FOUND)

    if certificate.is_deleted:
        return Response({"detail": "Certificate not found"}, status=status.HTTP_404_NOT_FOUND)

    if certificate.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if not certificate.file:
        return Response({"detail": "Certificate file not available"}, status=status.HTTP_404_NOT_FOUND)

    filename = os.path.basename(certificate.file.name)
    return FileResponse(certificate.file.open("rb"), as_attachment=True, filename=filename)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def portal_certificate_delete(request, certificate_id):
    certificate = Certificate.objects.select_related("company", "equipment").filter(id=certificate_id).first()
    if not certificate:
        return Response({"detail": "Certificate not found"}, status=status.HTTP_404_NOT_FOUND)

    if certificate.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if not _is_owner(request.user):
        return Response({"detail": "Insufficient permissions"}, status=status.HTTP_403_FORBIDDEN)

    now = timezone.now()
    recovery_expires_at = now + timedelta(days=CERTIFICATE_RECOVERY_WINDOW_DAYS)

    if not certificate.is_deleted:
        certificate.is_deleted = True
        certificate.deleted_at = now
        certificate.deleted_by = request.user
        certificate.recovery_expires_at = recovery_expires_at
        certificate.save(update_fields=["is_deleted", "deleted_at", "deleted_by", "recovery_expires_at"])

        log_portal_audit_event(
            request=request,
            action="certificate.deleted",
            target_type="certificate",
            target_id=certificate.id,
            company=certificate.company,
            details={
                "certificate_id": certificate.id,
                "equipment_id": certificate.equipment_id,
                "title": certificate.title,
                "recovery_expires_at": recovery_expires_at.isoformat(),
            },
        )

    return Response(
        {
            "ok": True,
            "certificate_id": certificate.id,
            "recovery_expires_at": (
                certificate.recovery_expires_at.isoformat() if certificate.recovery_expires_at else recovery_expires_at.isoformat()
            ),
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def portal_certificate_recover(request, certificate_id):
    certificate = Certificate.objects.select_related("company", "equipment").filter(id=certificate_id).first()
    if not certificate:
        return Response({"detail": "Certificate not found"}, status=status.HTTP_404_NOT_FOUND)

    if certificate.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if not _is_owner(request.user):
        return Response({"detail": "Insufficient permissions"}, status=status.HTTP_403_FORBIDDEN)

    if not certificate.is_deleted:
        return Response({"detail": "Certificate is not deleted"}, status=status.HTTP_400_BAD_REQUEST)

    if certificate.recovery_expires_at and timezone.now() > certificate.recovery_expires_at:
        return Response(
            {"detail": "Certificate recovery window has expired"},
            status=status.HTTP_410_GONE,
        )

    previous_deleted_at = certificate.deleted_at
    certificate.is_deleted = False
    certificate.deleted_at = None
    certificate.deleted_by = None
    certificate.recovery_expires_at = None
    certificate.save(update_fields=["is_deleted", "deleted_at", "deleted_by", "recovery_expires_at"])

    log_portal_audit_event(
        request=request,
        action="certificate.recovered",
        target_type="certificate",
        target_id=certificate.id,
        company=certificate.company,
        details={
            "certificate_id": certificate.id,
            "equipment_id": certificate.equipment_id,
            "title": certificate.title,
            "recovered_from_deleted_at": previous_deleted_at.isoformat() if previous_deleted_at else None,
        },
    )

    serializer = CertificateSerializer(certificate, context={"request": request})
    return Response(serializer.data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def portal_site_certificates_generate(request, site_id):
    site = Site.objects.select_related("company").filter(id=site_id).first()
    if not site:
        return Response({"detail": "Site not found"}, status=status.HTTP_404_NOT_FOUND)

    if site.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if not _is_owner(request.user):
        return Response({"detail": "Insufficient permissions"}, status=status.HTTP_403_FORBIDDEN)

    site_equipment = list(
        Equipment.objects.filter(site_id=site.id, company_id=site.company_id).order_by("name", "asset_tag", "id")
    )
    if not site_equipment:
        return Response({"detail": "No equipment found for this site"}, status=status.HTTP_400_BAD_REQUEST)

    latest_report_by_equipment_id = {}
    latest_reports = (
        InspectionReport.objects.filter(
            equipment__site_id=site.id,
            equipment__company_id=site.company_id,
            is_deleted=False,
            status=InspectionReport.STATUS_APPROVED,
        )
        .select_related("equipment", "submitted_by")
        .order_by("equipment_id", "-report_date", "-created_at")
    )
    for report in latest_reports:
        if report.equipment_id not in latest_report_by_equipment_id:
            latest_report_by_equipment_id[report.equipment_id] = report

    equipment_reports = [
        {
            "equipment": equipment,
            "report": latest_report_by_equipment_id.get(equipment.id),
        }
        for equipment in site_equipment
    ]
    equipment_reports = sorted(equipment_reports, key=_equipment_report_sort_key)

    try:
        pdf_buffer = _build_site_certificate_pdf(site, equipment_reports)
    except ModuleNotFoundError:
        return Response(
            {"detail": "PDF generation dependency is unavailable. Install reportlab."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    filename = f"site-certificate-register-{slugify(site.company.name)}-{slugify(site.name)}-{timezone.localdate().isoformat()}.pdf"
    pdf_bytes = pdf_buffer.getvalue()

    certificate = Certificate(
        company=site.company,
        site=site,
        title=f"Site Certificate Register - {site.name}",
        issue_date=timezone.localdate(),
        uploaded_by=request.user,
    )
    certificate.file.save(filename, ContentFile(pdf_bytes), save=False)
    certificate.save()

    log_portal_audit_event(
        request=request,
        action="certificate.generated",
        target_type="certificate",
        target_id=certificate.id,
        company=site.company,
        details={
            "certificate_id": certificate.id,
            "site_id": site.id,
            "site_name": site.name,
            "equipment_count": len(site_equipment),
            "report_count": len([item for item in equipment_reports if item.get("report") is not None]),
            "filename": filename,
        },
    )

    serializer = CertificateSerializer(certificate, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
@throttle_classes([PortalMethodRateThrottle])
def portal_site_certificates(request, site_id):
    site = Site.objects.select_related("company").filter(id=site_id).first()
    if not site:
        return Response({"detail": "Site not found"}, status=status.HTTP_404_NOT_FOUND)

    if site.company_id not in _visible_company_ids(request.user):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    certificates = Certificate.objects.filter(site_id=site.id, is_deleted=False).order_by("-created_at")
    serializer = CertificateSerializer(certificates, many=True, context={"request": request})
    return Response({"results": serializer.data})

"""
Management command: seed_demo_data
===================================
Creates 20 demo companies (each with a customer login, 20 pieces of equipment,
and inspection reports covering all statuses), plus 15 employees (12 engineers,
3 office staff).  All accounts use the password supplied via --password
(defaults to DemoPass!234).

Usage:
    python manage.py seed_demo_data
    python manage.py seed_demo_data --password MyOtherPass1!
    python manage.py seed_demo_data --clear   # wipe demo data first
"""

import random
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.utils.text import slugify

from api.models import Company, Equipment, InspectionReport, UserProfile

User = get_user_model()

# ── Seed constants ────────────────────────────────────────────────────────────

DEMO_PASSWORD = "DemoPass!234"

COMPANIES = [
    ("Connacht Steel Fabricators", "Galway", "connacht-steel"),
    ("Murphy Industrial Lifting", "Cork", "murphy-industrial"),
    ("Shannon Bridge Engineering", "Limerick", "shannon-bridge"),
    ("Leinster Crane Services", "Dublin", "leinster-crane"),
    ("Celtic Heavy Haulage", "Waterford", "celtic-heavy"),
    ("Wicklow Engineering Works", "Wicklow", "wicklow-eng"),
    ("Boyne Valley Fabrications", "Drogheda", "boyne-valley"),
    ("Atlantic Rigging Solutions", "Sligo", "atlantic-rigging"),
    ("Tipperary Plant Hire", "Tipperary", "tipp-plant"),
    ("Erne Industrial Services", "Enniskillen", "erne-industrial"),
    ("Midlands Hoist & Crane", "Tullamore", "midlands-hoist"),
    ("Foyle Engineering Ltd", "Derry", "foyle-engineering"),
    ("Suir Engineering Group", "Clonmel", "suir-engineering"),
    ("Barrow Valley Contractors", "Carlow", "barrow-valley"),
    ("Mourne Manufacturing", "Newry", "mourne-manufacturing"),
    ("Connaught Offshore Services", "Mayo", "connaught-offshore"),
    ("Nore Industrial Lifting", "Kilkenny", "nore-industrial"),
    ("Lee Valley Plant", "Cork", "lee-valley-plant"),
    ("Bann River Engineering", "Portadown", "bann-river"),
    ("Liffey Industrial Group", "Dublin", "liffey-industrial"),
]

EQUIPMENT_TEMPLATES = [
    ("10T EOT Overhead Crane",      "CRANE",  "OHC"),
    ("5T Monorail Hoist",           "HOIST",  "MNR"),
    ("20T Gantry Crane",            "CRANE",  "GNT"),
    ("2T Electric Chain Block",     "CHAIN",  "ECB"),
    ("15T Bridge Crane",            "CRANE",  "BRC"),
    ("500kg Wire Rope Hoist",       "HOIST",  "WRH"),
    ("3T Jib Crane",                "CRANE",  "JIB"),
    ("1T Lever Block",              "CHAIN",  "LVB"),
    ("8T Underslung Crane",         "CRANE",  "USC"),
    ("250T Hydraulic Press",        "PRESS",  "HYP"),
    ("6T Forklift Attachment",      "ATTACH", "FKA"),
    ("4T Manual Chain Block",       "CHAIN",  "MCB"),
    ("12T Semi-Gantry Crane",       "CRANE",  "SGC"),
    ("750kg Davit Crane",           "CRANE",  "DAV"),
    ("30T Overhead Travelling Crane","CRANE", "OTC"),
    ("2T Articulated Jib Crane",    "CRANE",  "AJC"),
    ("5T Grab Bucket",              "ATTACH", "GRB"),
    ("3T Vacuum Lifter",            "ATTACH", "VAC"),
    ("10T Below-Hook Spreader Bar", "ATTACH", "SPR"),
    ("1T Endless Chain Sling",      "SLING",  "ECS"),
]

EMPLOYEES = [
    # (first, last, role)
    ("Liam",     "Burke",      "engineer"),
    ("Aoife",    "Murphy",     "engineer"),
    ("Ciarán",   "Doyle",      "engineer"),
    ("Niamh",    "Walsh",      "engineer"),
    ("Seán",     "Brennan",    "engineer"),
    ("Róisín",   "O'Brien",    "engineer"),
    ("Pádraig",  "Fitzpatrick","engineer"),
    ("Sinéad",   "Ryan",       "engineer"),
    ("Conor",    "McCarthy",   "engineer"),
    ("Aisling",  "Nolan",      "engineer"),
    ("Darragh",  "Higgins",    "engineer"),
    ("Caoimhe",  "Daly",       "engineer"),
    # Office staff
    ("Patricia", "O'Connor",   "office_staff"),
    ("Michael",  "Thornton",   "office_staff"),
    ("Siobhán",  "Keane",      "office_staff"),
]

CHECKLIST_LABELS = [
    "Initial Test Run",
    "Isolator",
    "Pendant Cable Box",
    "Pendant Suspension & Terminators",
    "Conducts & Cables",
    "Hoist Control Gear",
    "Travel Control Gear",
    "Traverse Control Gear",
    "Downshop Conductors",
    "Travel Wheels",
    "Travel Gears",
    "Travel Brakes",
    "Travel Motors",
    "Travel Gearbox/Oil Level",
    "Travel Bearings",
    "Travel Limits/Stops",
    "Traverse Wheels",
    "Traverse Gears",
    "Traverse Brakes",
    "Traverse Gear/Oil Level",
    "Traverse Motor",
    "Traverse Bearings - Bushes",
    "Traverse Limits / Stops",
    "Travel Buffers",
    "Anti Collision",
    "Pendant Controls",
    "Remote Control",
    "Slipping Clutch/Adjustment",
    "Hoist Ropes",
    "Rope Guide & Pressure Band",
    "Return Sheave",
    "Bottom Block & Hook",
    "Hoist Motor",
    "Hoist Brake",
    "Hoist Gearbox/Oil Level",
    "Hoist Limits",
    "Hoist Bearing - Bushes",
    "General Structure",
    "Crane Platforms",
    "Rail",
    "Load Chain",
    "Load Sprocket",
    "Chain Guide",
    "Chain Anchor Suspension",
    "Suspension Hook / Eye",
    "Suspension Pins / Bolts",
    "Over Load Limiting Device",
    "Over Load Protection",
    "Control Panel",
    "Cooling Fan/Cover",
]

WORN_NOTES = [
    "Minor surface wear observed, within serviceable limits.",
    "Light fretting on contact face, no measurable loss of function.",
    "Slight corrosion present, monitor at next inspection.",
    "Wear evident but operating within tolerance, scheduled for replacement at next overhaul.",
    "Surface pitting noted, continue in service with six-monthly monitoring.",
]

ATTENTION_NOTES = [
    "Replace within 30 days — wear beyond acceptable tolerance.",
    "Cracking detected, immediate repair required before return to service.",
    "Adjustment required — operating outside rated parameters.",
    "Component seized, lubrication or replacement required immediately.",
    "Brake pad worn below minimum thickness — replace before next operation.",
]

SUMMARIES = [
    "Full LOLER inspection completed. Equipment operating within rated parameters.",
    "Thorough inspection carried out as per BS EN 818 requirements. All safety-critical items checked.",
    "Scheduled statutory examination completed. Equipment certified fit for continued operation.",
    "Pre-planned maintenance inspection conducted. Findings documented in full below.",
    "Six-monthly statutory examination performed in line with LEEA guidelines.",
    "Annual thorough examination carried out. Minor defects noted and actioned.",
    "Inspection following recent repair. Equipment returned to service after confirmation of remedial work.",
    "Routine LOLER examination. No significant defects found during this visit.",
]

FINDINGS_GOOD = [
    "All mechanical and electrical components inspected and found to be in good working order. No defects identified.",
    "Visual inspection and functional testing completed satisfactorily. Equipment meets all required safety standards.",
    "All structural welds, bearings, limits, and controls inspected. Equipment found serviceable.",
    "No abnormal wear, damage, or deterioration identified during this inspection.",
]

FINDINGS_ISSUES = [
    "Minor wear identified on {item}. Detailed in checklist. Equipment remains fit for purpose.",
    "Attention required on {item}. Component flagged for follow-up within the recommended timeframe.",
    "Two items require attention: {item} and load-bearing pins. See checklist for full details.",
    "Wear noted on {item}. Customer advised of recommended maintenance schedule.",
]

RECOMMENDATIONS_GOOD = [
    "No immediate action required. Continue routine inspection schedule.",
    "Equipment to remain in service. Next thorough examination due as per schedule.",
    "No remedial work required at this time. Monitor as per inspection interval.",
    "Maintain current inspection frequency. No outstanding defects.",
]

RECOMMENDATIONS_ISSUES = [
    "Replace flagged components within the timeframe specified in the checklist.",
    "Arrange follow-up inspection after recommended repairs are completed.",
    "Customer to schedule downtime to address attention items before next statutory due date.",
    "Engineer to revisit site within 30 days to confirm remedial actions have been taken.",
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _random_date_past(months_back_max=24):
    days_ago = random.randint(0, months_back_max * 30)
    return date.today() - timedelta(days=days_ago)


def _build_checklist(scenario="good"):
    """
    scenario: 'good' | 'worn' | 'attention' | 'mixed'
    """
    items = []
    for label in CHECKLIST_LABELS:
        if scenario == "good":
            items.append({"label": label, "status": "good_order", "note": ""})
        elif scenario == "worn":
            if label in ("Hoist Ropes", "Travel Wheels", "Hoist Brake"):
                items.append({"label": label, "status": "worn_serviceable",
                               "note": random.choice(WORN_NOTES)})
            else:
                items.append({"label": label, "status": "good_order", "note": ""})
        elif scenario == "attention":
            if label in ("Bottom Block & Hook", "Travel Brakes", "General Structure"):
                items.append({"label": label, "status": "attention_required",
                               "note": random.choice(ATTENTION_NOTES)})
            else:
                items.append({"label": label, "status": "good_order", "note": ""})
        else:  # mixed
            if label in ("Hoist Ropes", "Travel Wheels"):
                items.append({"label": label, "status": "worn_serviceable",
                               "note": random.choice(WORN_NOTES)})
            elif label in ("Travel Brakes",):
                items.append({"label": label, "status": "attention_required",
                               "note": random.choice(ATTENTION_NOTES)})
            else:
                items.append({"label": label, "status": "good_order", "note": ""})
    return items


def _build_report_data(equipment_name, report_num, report_status):
    scenario_map = {
        1: "good",
        2: "worn",
        3: "attention",
        4: "mixed",
        5: "good",
    }
    scenario = scenario_map.get(report_num, "good")

    if scenario == "good":
        findings = random.choice(FINDINGS_GOOD)
        recommendations = random.choice(RECOMMENDATIONS_GOOD)
    else:
        issue_item = random.choice(["hoist rope", "travel brake", "bottom block", "pendant cable"])
        findings = random.choice(FINDINGS_ISSUES).format(item=issue_item)
        recommendations = random.choice(RECOMMENDATIONS_ISSUES)

    report_date = _random_date_past(24)

    return {
        "title": f"LOLER Inspection — {equipment_name} (Visit {report_num})",
        "summary": random.choice(SUMMARIES),
        "findings": findings,
        "recommendations": recommendations,
        "report_date": report_date,
        "status": report_status,
        "checklist_items": _build_checklist(scenario),
    }


class Command(BaseCommand):
    help = "Seed the database with demo companies, equipment, reports, and employees."

    def add_arguments(self, parser):
        parser.add_argument(
            "--password",
            default=DEMO_PASSWORD,
            help="Password for all demo accounts (default: DemoPass!234)",
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete existing demo data before seeding (matches usernames/company names).",
        )

    def handle(self, *args, **options):
        password = options["password"]
        self.stdout.write(self.style.MIGRATE_HEADING("=== Manley Lifting Demo Seed ==="))

        if options["clear"]:
            self._clear_demo_data()

        # ── 1. Companies + customers + equipment + reports ──────────────────
        all_company_ids = []
        for idx, (company_name, county, _slug) in enumerate(COMPANIES, start=1):
            company, customer_user = self._create_company_and_customer(
                company_name, county, idx, password
            )
            all_company_ids.append(company.id)
            self._create_equipment_and_reports(company, customer_user, idx)
            self.stdout.write(f"  ✓ Company {idx:02d}/20: {company_name}")

        # ── 2. Employees ─────────────────────────────────────────────────────
        self.stdout.write(self.style.MIGRATE_HEADING("\nCreating employees…"))
        for emp_idx, (first, last, role) in enumerate(EMPLOYEES, start=1):
            self._create_employee(first, last, role, emp_idx, all_company_ids, password)
            label = "Office Staff" if role == "office_staff" else "Engineer"
            self.stdout.write(f"  ✓ {label}: {first} {last}")

        self.stdout.write(self.style.SUCCESS(
            "\nSeed complete. "
            f"20 companies · 400 equipment items · ~1 200 reports · 15 employees.\n"
            f"All accounts use password: {password}"
        ))

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _clear_demo_data(self):
        self.stdout.write("Clearing previous demo data…")
        demo_usernames = []
        for idx, (_cn, _co, slug) in enumerate(COMPANIES, start=1):
            demo_usernames.append(f"demo.customer.{idx:02d}")
        for idx, (first, last, _role) in enumerate(EMPLOYEES, start=1):
            demo_usernames.append(self._employee_username(first, last, idx))

        User.objects.filter(username__in=demo_usernames).delete()

        demo_names = [cn for cn, _, _ in COMPANIES]
        Company.objects.filter(name__in=demo_names).delete()

    def _create_company_and_customer(self, company_name, county, idx, password):
        username = f"demo.customer.{idx:02d}"
        email = f"customer{idx:02d}@demo-manleylifting.ie"

        # Company
        slug = slugify(company_name)
        counter = 2
        base_slug = slug
        while Company.objects.filter(slug=slug).exists():
            suffix = f"-{counter}"
            slug = f"{base_slug[:max(1, 220 - len(suffix))]}{suffix}"
            counter += 1

        company, _ = Company.objects.get_or_create(
            name=company_name,
            defaults={
                "slug": slug,
                "contact_email": f"info@{slugify(company_name)}.ie",
                "contact_phone": f"+353 {random.randint(10,99)} {random.randint(100,999)} {random.randint(1000,9999)}",
                "address": f"Unit {idx}, {county} Business Park, {county}, Ireland",
                "is_active": True,
            },
        )

        # Customer user
        user, created = User.objects.get_or_create(
            username=username,
            defaults={
                "email": email,
                "first_name": company_name.split()[0],
                "last_name": "Demo",
                "is_active": True,
            },
        )
        if created:
            user.set_password(password)
            user.save()

        profile, _ = UserProfile.objects.get_or_create(
            user=user,
            defaults={"role": UserProfile.ROLE_CUSTOMER},
        )
        profile.role = UserProfile.ROLE_CUSTOMER
        profile.allowed_companies.add(company)
        profile.save(update_fields=["role", "updated_at"])

        return company, user

    def _create_equipment_and_reports(self, company, customer_user, company_idx):
        # 5 report patterns to cycle across equipment: approved, approved, submitted, draft, approved+worn
        report_plan = [
            # (status, count)
            [("approved", 1), ("approved", 2)],
            [("approved", 1), ("submitted", 2)],
            [("approved", 1), ("approved", 2), ("draft", 3)],
            [("approved", 1), ("approved", 2), ("approved", 3)],
            [("approved", 1), ("submitted", 2)],
        ]

        for eq_idx, (eq_name, eq_type, eq_prefix) in enumerate(EQUIPMENT_TEMPLATES, start=1):
            asset_tag = f"{eq_prefix}-{company_idx:02d}{eq_idx:02d}"
            serial = f"SN{company_idx:02d}{eq_idx:04d}"

            last_inspected = _random_date_past(18)
            interval = random.choice([180, 365, 730])
            next_due = last_inspected + timedelta(days=interval)

            eq, _ = Equipment.objects.get_or_create(
                company=company,
                asset_tag=asset_tag,
                defaults={
                    "name": eq_name,
                    "serial_number": serial,
                    "safe_working_load": random.choice(["500 kg", "1000 kg", "2000 kg", "3.2 t"]),
                    "location": f"Bay {eq_idx}, {company.address.split(',')[0]}",
                    "status": Equipment.STATUS_ACTIVE,
                    "inspection_interval_days": interval,
                    "last_inspected_at": last_inspected,
                    "next_inspection_due": next_due,
                    "notes": f"Demo equipment — {eq_type} class asset.",
                },
            )

            plan = report_plan[eq_idx % len(report_plan)]
            for report_status, report_num in plan:
                data = _build_report_data(eq_name, report_num, report_status)
                InspectionReport.objects.get_or_create(
                    equipment=eq,
                    title=data["title"],
                    defaults={
                        "submitted_by": customer_user,
                        "summary": data["summary"],
                        "findings": data["findings"],
                        "recommendations": data["recommendations"],
                        "report_date": data["report_date"],
                        "status": data["status"],
                        "checklist_items": data["checklist_items"],
                    },
                )

    def _employee_username(self, first, last, idx):
        # Normalise accented chars to ASCII for username
        import unicodedata
        def _ascii(s):
            return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
        return f"{_ascii(first).lower()}.{_ascii(last).lower()}.{idx:02d}"

    def _create_employee(self, first, last, role, idx, all_company_ids, password):
        username = self._employee_username(first, last, idx)
        email = f"{username}@demo-manleylifting.ie"

        user, created = User.objects.get_or_create(
            username=username,
            defaults={
                "email": email,
                "first_name": first,
                "last_name": last,
                "is_active": True,
            },
        )
        if created:
            user.set_password(password)
            user.save()

        profile, _ = UserProfile.objects.get_or_create(
            user=user,
            defaults={"role": role},
        )
        profile.role = role
        profile.required_password_change = False

        # Assign engineers to a random subset of companies; office staff to all
        if role == "office_staff":
            assigned_ids = all_company_ids
        else:
            count = random.randint(3, 8)
            assigned_ids = random.sample(all_company_ids, min(count, len(all_company_ids)))

        companies = Company.objects.filter(id__in=assigned_ids)
        profile.allowed_companies.set(companies)
        profile.save(update_fields=["role", "required_password_change", "updated_at"])

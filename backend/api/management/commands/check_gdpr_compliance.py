import json

from django.core.management.base import BaseCommand, CommandError

from api.privacy_compliance import run_compliance_checks


class Command(BaseCommand):
    help = "Report repository-verifiable GDPR governance checks."

    def add_arguments(self, parser):
        parser.add_argument(
            "--json",
            action="store_true",
            dest="as_json",
            help="Render the compliance report as JSON.",
        )

    def handle(self, *args, **options):
        report = run_compliance_checks()
        if options["as_json"]:
            self.stdout.write(json.dumps(report, sort_keys=True))
        else:
            self.stdout.write(f"GDPR compliance status: {report['status']}")
            for check in report["checks"]:
                self.stdout.write(
                    f"{check['key']}: {check['status']} - {check['message']}"
                )
        if any(check["status"] == "fail" for check in report["checks"]):
            raise CommandError("One or more technical GDPR checks failed.")

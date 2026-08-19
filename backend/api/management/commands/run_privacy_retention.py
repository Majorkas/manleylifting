"""
Management command for running GDPR retention cleanup operations.

This command executes the suite of idempotent privacy retention cleanup
functions, deleting or anonymizing data according to configured retention
policies. It supports a dry-run mode for testing.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api.privacy_retention import (
    cleanup_expired_account_sessions,
    cleanup_expired_account_action_tokens,
    cleanup_old_audit_logs,
    cleanup_old_order_email_delivery_records,
)


class Command(BaseCommand):
    help = 'Run idempotent GDPR retention cleanup for expired personal data.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            dest='dry_run',
            help='Preview cleanup operations without persisting changes',
        )

    def handle(self, *args, **options):
        dry_run = options.get('dry_run', False)
        
        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    '⚠️  DRY RUN MODE: Cleanup operations will be rolled back'
                )
            )
        
        try:
            with transaction.atomic():
                # Run all cleanup functions in order
                session_results = cleanup_expired_account_sessions()
                token_results = cleanup_expired_account_action_tokens()
                audit_results = cleanup_old_audit_logs()
                email_results = cleanup_old_order_email_delivery_records()
                
                # Format and display results
                self.stdout.write(
                    self.style.SUCCESS('\n✓ Privacy Retention Cleanup Complete\n')
                )
                
                # Sessions
                self.stdout.write(
                    f"Sessions:     {session_results['deleted']} deleted, "
                    f"{session_results['retained']} retained"
                )
                
                # Tokens
                self.stdout.write(
                    f"Tokens:       {token_results['deleted']} deleted, "
                    f"{token_results['retained']} retained"
                )
                
                # Audit logs
                self.stdout.write(
                    f"Audit Logs:   {audit_results['anonymized']} anonymized, "
                    f"{audit_results['retained']} retained"
                )
                
                # Email delivery records
                self.stdout.write(
                    f"Email Records: {email_results['deleted']} deleted, "
                    f"{email_results['retained']} retained"
                )
                
                if dry_run:
                    # Force transaction rollback by raising exception
                    raise CommandError('Dry-run mode: rolling back all changes')
                
                self.stdout.write(self.style.SUCCESS('\n✓ All cleanup operations persisted\n'))
                
        except CommandError as e:
            if dry_run and 'Dry-run mode' in str(e):
                self.stdout.write(
                    self.style.WARNING('\n✓ Dry-run complete: no changes persisted\n')
                )
            else:
                self.stdout.write(
                    self.style.ERROR(f'\n✗ Error during cleanup: {str(e)}\n')
                )
                raise

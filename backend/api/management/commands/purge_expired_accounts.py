"""
Management command for permanently deleting accounts after recovery window expires.

This command executes hard deletion of disabled accounts that have exceeded the
30-day recovery period after deletion request. It requires explicit user confirmation
unless run in dry-run mode.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api.privacy_retention import purge_expired_deleted_accounts


class Command(BaseCommand):
    help = 'Permanently delete disabled accounts after 30-day recovery window expires.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            dest='dry_run',
            help='Preview purge operations without persisting changes',
        )

    def handle(self, *args, **options):
        dry_run = options.get('dry_run', False)
        
        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    '⚠️  DRY RUN MODE: Purge operations will be rolled back'
                )
            )
        
        # Prompt for confirmation if not in dry-run mode
        if not dry_run:
            confirmation = input('WARNING: This will PERMANENTLY DELETE accounts. Continue? [yes/no] ')
            if confirmation.lower() != 'yes':
                self.stdout.write(self.style.WARNING('Purge cancelled.'))
                return
        
        try:
            with transaction.atomic():
                # Call the purge function
                result = purge_expired_deleted_accounts()
                
                # Format and display results
                self.stdout.write(
                    self.style.SUCCESS('\n✓ Account Purge Complete\n')
                )
                
                self.stdout.write(
                    f"Hard deleted: {result['hard_deleted']} accounts permanently removed"
                )
                self.stdout.write(
                    f"In recovery:  {result['still_in_recovery']} accounts still in recovery window"
                )
                
                if dry_run:
                    # Force transaction rollback by raising exception
                    raise CommandError('Dry-run mode: rolling back all changes')
                
                self.stdout.write(self.style.SUCCESS('\n✓ All purge operations persisted\n'))
                
        except CommandError as e:
            if dry_run and 'Dry-run mode' in str(e):
                self.stdout.write(
                    self.style.WARNING('\n✓ Dry-run complete: no changes persisted\n')
                )
            else:
                self.stdout.write(
                    self.style.ERROR(f'\n✗ Error during purge: {str(e)}\n')
                )
                raise

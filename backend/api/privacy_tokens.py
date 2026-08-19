"""
Recovery code hashing and verification for GDPR compliance.

Recovery codes are generated once, returned to the user, and stored as password-hashes.
Verification is one-time: a consumed code is atomically removed from the stored list.
"""

from django.contrib.auth.hashers import make_password, check_password


def hash_recovery_code(raw_code):
    """Hash a raw recovery code for storage. Uses Django's password hasher for consistency."""
    return make_password(raw_code)


def verify_recovery_code(raw_code, stored_hash):
    """Check if a raw recovery code matches the stored hash."""
    return check_password(raw_code, stored_hash)

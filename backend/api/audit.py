from django.conf import settings

from .models import AuditLog


def _request_ip(request):
    remote_addr = str(request.META.get("REMOTE_ADDR") or "").strip()
    forwarded_for = str(request.META.get("HTTP_X_FORWARDED_FOR") or "").strip()

    trust_forwarded = bool(getattr(settings, "TRUST_X_FORWARDED_FOR", False))
    trusted_proxies = set(getattr(settings, "TRUSTED_PROXY_IPS", []) or [])

    if trust_forwarded and forwarded_for and (not trusted_proxies or remote_addr in trusted_proxies):
        first_hop = forwarded_for.split(",")[0].strip()
        if first_hop:
            return first_hop

    return remote_addr or None


def log_portal_audit_event(*, request, action, target_type, target_id="", company=None, details=None):
    if details is None:
        details = {}

    AuditLog.objects.create(
        actor=getattr(request, "user", None) if getattr(getattr(request, "user", None), "is_authenticated", False) else None,
        company=company,
        action=action,
        target_type=target_type,
        target_id=str(target_id or ""),
        details=details,
        ip_address=_request_ip(request),
    )

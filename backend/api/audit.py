from .models import AuditLog


def _request_ip(request):
    forwarded_for = str(request.META.get("HTTP_X_FORWARDED_FOR") or "").strip()
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return str(request.META.get("REMOTE_ADDR") or "").strip() or None


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

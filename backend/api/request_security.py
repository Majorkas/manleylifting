from django.conf import settings


def client_ip(request):
    remote_addr = str(request.META.get("REMOTE_ADDR", "")).strip()
    forwarded_for = str(request.META.get("HTTP_X_FORWARDED_FOR", "")).strip()
    trusted_proxies = set(getattr(settings, "TRUSTED_PROXY_IPS", []) or [])

    if (
        getattr(settings, "TRUST_X_FORWARDED_FOR", False)
        and remote_addr in trusted_proxies
        and forwarded_for
    ):
        first_hop = forwarded_for.split(",")[0].strip()
        if first_hop:
            return first_hop

    return remote_addr or "unknown"

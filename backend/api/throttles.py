import hashlib
import hmac

from django.conf import settings
from rest_framework.throttling import ScopedRateThrottle, SimpleRateThrottle


class PortalMethodRateThrottle(ScopedRateThrottle):
    """Use separate rate scopes for read vs write portal requests."""

    def allow_request(self, request, view):
        if request.method in {"GET", "HEAD", "OPTIONS"}:
            self.scope = "portal.read"
        else:
            self.scope = "portal.write"

        self.rate = self.get_rate()
        self.num_requests, self.duration = self.parse_rate(self.rate)
        return SimpleRateThrottle.allow_request(self, request, view)


class AccountEmailRateThrottle(SimpleRateThrottle):
    scope = "account.email"

    def get_cache_key(self, request, view):
        email = str(request.data.get("email") or "").strip().lower()
        if not email:
            return None
        digest = hmac.new(
            str(settings.SECRET_KEY).encode("utf-8"),
            email.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": digest}

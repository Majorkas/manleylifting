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

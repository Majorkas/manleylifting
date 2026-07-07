from django.conf import settings


class ContentSecurityPolicyReportOnlyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        policy_value = str(getattr(settings, "CONTENT_SECURITY_POLICY_REPORT_ONLY", "")).strip()
        if policy_value and "Content-Security-Policy-Report-Only" not in response:
            response["Content-Security-Policy-Report-Only"] = policy_value
        return response

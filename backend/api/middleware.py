"""
Middleware for request processing, security policies, and distributed tracing.
"""

import uuid
import contextvars
from django.conf import settings

# Module-level context for correlation ID
_correlation_id_context: contextvars.ContextVar[str] = contextvars.ContextVar(
    'correlation_id', default=None
)


def get_correlation_id() -> str:
    """Get current request correlation ID."""
    return _correlation_id_context.get()


class CorrelationIdMiddleware:
    """
    Adds a unique correlation ID to each request for distributed tracing.
    
    The correlation ID is a UUID and contains no PII. It's stored in context
    vars for access in logs and error handlers without passing through
    request/response bodies.
    """
    
    def __init__(self, get_response):
        self.get_response = get_response
    
    def __call__(self, request):
        # Generate or get correlation ID from request header
        correlation_id = request.META.get("HTTP_X_CORRELATION_ID")
        if not correlation_id:
            correlation_id = str(uuid.uuid4())
        
        # Set in context for this request
        _correlation_id_context.set(correlation_id)
        
        # Process request
        response = self.get_response(request)
        
        # Add to response headers for client tracing
        response["X-Correlation-ID"] = correlation_id
        
        return response


class ContentSecurityPolicyReportOnlyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        policy_value = str(getattr(settings, "CONTENT_SECURITY_POLICY_REPORT_ONLY", "")).strip()
        if policy_value and "Content-Security-Policy-Report-Only" not in response:
            response["Content-Security-Policy-Report-Only"] = policy_value

        strict_policy = str(getattr(settings, "CONTENT_SECURITY_POLICY", "")).strip()
        if strict_policy and "Content-Security-Policy" not in response:
            response["Content-Security-Policy"] = strict_policy

        return response

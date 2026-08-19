"""
Privacy-focused logging utilities for IP masking and log sanitization.

This module provides utilities to mask IP addresses and sanitize sensitive data
from logs, in compliance with GDPR and privacy best practices.
"""

import ipaddress
import re
from typing import Any, Dict, Optional


def mask_ip_address(ip_str: str) -> str:
    """
    Mask an IP address to CIDR notation for privacy.
    
    IPv4 addresses are masked to /24 CIDR (e.g., "192.0.2.x").
    IPv6 addresses are masked to /64 CIDR (e.g., "2001:db8:85a3::x").
    
    Args:
        ip_str: String representation of an IPv4 or IPv6 address.
        
    Returns:
        Masked IP address string.
        
    Raises:
        ValueError: If the IP address string is invalid.
    """
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError as e:
        raise ValueError(f"Invalid IP address: {ip_str}") from e
    
    if isinstance(ip, ipaddress.IPv4Address):
        # Mask IPv4 to /24 CIDR
        # Example: 192.0.2.100 -> 192.0.2.x
        parts = ip_str.split(".")
        return f"{parts[0]}.{parts[1]}.{parts[2]}.x"
    elif isinstance(ip, ipaddress.IPv6Address):
        # Mask IPv6 to /64 CIDR
        # Example: 2001:db8:85a3::8a2e:370:7334 -> 2001:db8:85a3::x
        # Create a /64 network from this address
        network = ipaddress.ip_network(f"{ip}/64", strict=False)
        # Get the network address as string and convert to masked format
        network_str = str(network.network_address)
        
        # Find the first 4 groups (64 bits = 4 * 16 bits)
        # Use ipaddress to handle compression properly
        # Get hex representation and extract first 4 groups
        parts = network_str.split(":")
        
        # Handle compressed notation: keep what we have up to the ::x boundary
        if "::" in network_str:
            # For addresses like ::1 or 2001:db8:85a3::
            # Extract the actual meaningful part
            prefix_parts = network_str.split("::")
            if prefix_parts[0]:
                # Non-empty prefix (e.g., "2001:db8:85a3")
                return f"{prefix_parts[0]}::x"
            else:
                # Starts with :: (e.g., "::1")
                return "::x"
        else:
            # No :: compression, take first 4 groups
            return ":".join(parts[:4]) + "::x"
    
    return ip_str


def sanitize_log_details(details: Dict[str, Any]) -> Dict[str, Any]:
    """
    Remove sensitive fields from log details dictionary.
    
    Removes keys related to authentication, payment, and internal state.
    Also removes values that appear to be card numbers (13-19 digits).
    
    Args:
        details: Dictionary of log details that may contain sensitive data.
        
    Returns:
        Sanitized dictionary with sensitive fields removed.
    """
    sensitive_keys = {
        "password",
        "passwd",
        "pwd",
        "token",
        "access_token",
        "refresh_token",
        "session_id",
        "card_number",
        "card_data",
        "cvv",
        "stripe_token",
        "request_body",
        "request_data",
        "exception",
        "traceback",
        "stack_trace",
        "signature",
        "signed_data",
    }
    
    # Pattern for card numbers: 13-19 consecutive digits
    card_number_pattern = re.compile(r"\b\d{13,19}\b")
    
    sanitized = {}
    
    for key, value in details.items():
        # Skip sensitive keys
        if key.lower() in sensitive_keys:
            continue
        
        # Skip values that look like card numbers
        if isinstance(value, str) and card_number_pattern.search(value):
            continue
        
        sanitized[key] = value
    
    return sanitized


def get_masked_ip_from_request(request) -> Optional[str]:
    """
    Extract and mask the client IP address from a Django HttpRequest.
    
    Attempts to get the IP from X-Forwarded-For header (for proxied requests)
    first, then falls back to REMOTE_ADDR.
    
    Args:
        request: Django HttpRequest object.
        
    Returns:
        Masked IP address string, or None if no IP could be determined.
    """
    # Try X-Forwarded-For header first (for proxied requests)
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded_for:
        # X-Forwarded-For can contain multiple IPs; use the first one
        ip_str = x_forwarded_for.split(",")[0].strip()
    else:
        # Fall back to REMOTE_ADDR
        ip_str = request.META.get("REMOTE_ADDR")
    
    if not ip_str:
        return None
    
    try:
        return mask_ip_address(ip_str)
    except ValueError:
        # If IP is invalid, return None
        return None

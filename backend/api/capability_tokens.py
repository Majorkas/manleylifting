import hashlib


def digest_capability_token(raw_token):
    token = str(raw_token or "")
    if not token:
        raise ValueError("Capability token must not be empty")
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

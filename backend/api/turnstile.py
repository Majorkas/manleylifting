import json
import logging
from urllib.parse import urlencode
from urllib.request import Request, urlopen


TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
logger = logging.getLogger(__name__)


def verify_turnstile_token(token, *, required, secret_key, remote_ip=""):
    if not required:
        return True
    if not secret_key:
        logger.error("Turnstile is required but its secret key is missing")
        return False

    response_token = str(token or "").strip()
    if not response_token:
        return False

    payload = {"secret": secret_key, "response": response_token}
    if remote_ip and remote_ip != "unknown":
        payload["remoteip"] = remote_ip
    request = Request(
        TURNSTILE_VERIFY_URL,
        data=urlencode(payload).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            body = json.loads(response.read().decode("utf-8") or "{}")
    except Exception:
        logger.warning("Turnstile verification request failed")
        return False
    return bool(body.get("success"))

import json
import logging
from urllib.parse import quote
from urllib.request import Request, urlopen

from django.conf import settings


logger = logging.getLogger(__name__)


class TransactionalEmailDeliveryError(RuntimeError):
    pass


def send_transactional_email(*, recipient_email, subject, text_body):
    if not settings.ZEPTOMAIL_SEND_TOKEN:
        raise TransactionalEmailDeliveryError("Transactional email is not configured")
    if not settings.ZEPTOMAIL_FROM_EMAIL:
        raise TransactionalEmailDeliveryError("Transactional email sender is not configured")

    payload = {
        "from": {
            "address": settings.ZEPTOMAIL_FROM_EMAIL,
            "name": settings.ZEPTOMAIL_FROM_NAME,
        },
        "to": [
            {
                "email_address": {
                    "address": recipient_email,
                    "name": "",
                }
            }
        ],
        "subject": subject,
        "textbody": text_body,
        "track_clicks": False,
        "track_opens": False,
    }
    request = Request(
        settings.ZEPTOMAIL_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Authorization": f"Zoho-enczapikey {settings.ZEPTOMAIL_SEND_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            if not 200 <= response.status < 300:
                raise TransactionalEmailDeliveryError("Transactional email provider rejected the request")
    except TransactionalEmailDeliveryError:
        raise
    except Exception as error:
        logger.exception("ZeptoMail transactional email request failed")
        raise TransactionalEmailDeliveryError(
            "Transactional email could not be delivered"
        ) from error


def send_verification_email(*, recipient_email, raw_token):
    verification_url = (
        f"{settings.ACCOUNT_FRONTEND_URL.rstrip('/')}/account/verify-email"
        f"#token={quote(raw_token, safe='')}"
    )
    send_transactional_email(
        recipient_email=recipient_email,
        subject="Verify your Manley Lifting account",
        text_body=(
            "Verify your email address to activate your Manley Lifting account:\n\n"
            f"{verification_url}\n\n"
            "If you did not request this account, you can ignore this email."
        ),
    )

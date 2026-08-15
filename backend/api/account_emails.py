import json
import logging
from html import escape
from urllib.parse import quote
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from django.conf import settings
from django.db import transaction


logger = logging.getLogger(__name__)


class TransactionalEmailDeliveryError(RuntimeError):
    pass


def _mask_email_address(value):
    text = str(value or "").strip()
    if "@" not in text:
        return text
    local, domain = text.split("@", 1)
    local = local.strip()
    if not local:
        return f"***@{domain}"
    if len(local) == 1:
        return f"{local}***@{domain}"
    return f"{local[0]}***{local[-1]}@{domain}"


def _safe_response_snippet(raw_bytes):
    if not raw_bytes:
        return ""
    text = raw_bytes.decode("utf-8", errors="replace").strip()
    if len(text) > 600:
        return text[:600] + "..."
    return text


def _normalize_zeptomail_token(raw_token):
    token = str(raw_token or "").strip()
    if not token:
        return ""
    prefix = "zoho-enczapikey "
    if token.lower().startswith(prefix):
        return token[len(prefix):].strip()
    return token


def _brand_logo_url():
    configured = str(getattr(settings, "ACCOUNT_EMAIL_LOGO_URL", "") or "").strip()
    if configured:
        return configured
    return "https://www.a-rich-web.dev/logo-navbar.png"


def _support_email_address():
    configured = str(getattr(settings, "ACCOUNT_SUPPORT_EMAIL", "") or "").strip()
    if configured:
        return configured
    return str(getattr(settings, "ZEPTOMAIL_FROM_EMAIL", "") or "").strip()


def _support_phone_number():
    return str(getattr(settings, "ACCOUNT_SUPPORT_PHONE", "") or "").strip()


def _support_contact_text():
    support_email = _support_email_address()
    support_phone = _support_phone_number()
    if support_email and support_phone:
        return f"Need help? Contact {support_email} or call {support_phone}."
    if support_email:
        return f"Need help? Contact {support_email}."
    if support_phone:
        return f"Need help? Call {support_phone}."
    return "Need help? Contact our support team."


def _support_contact_html_line():
    support_email = _support_email_address()
    support_phone = _support_phone_number()
    parts = []
    if support_email:
        safe_email = escape(support_email, quote=True)
        parts.append(f"<a href=\"mailto:{safe_email}\" style=\"color:#123A7A;text-decoration:none;\">{safe_email}</a>")
    if support_phone:
        safe_phone = escape(support_phone, quote=True)
        dial_phone = "".join(char for char in support_phone if char.isdigit() or char in "+")
        safe_dial_phone = escape(dial_phone, quote=True)
        parts.append(f"<a href=\"tel:{safe_dial_phone}\" style=\"color:#123A7A;text-decoration:none;\">{safe_phone}</a>")
    if not parts:
        return "Need help? Contact our support team."
    return "Need help? " + " or ".join(parts) + "."


def _render_email_html(
    *,
    title,
    intro,
    action_label,
    action_url,
    body_lines,
    support_note,
    preheader="",
    accent_color="#123A7A",
    badge_label="Manley Lifting Account",
):
    safe_title = escape(str(title or "").strip())
    safe_intro = escape(str(intro or "").strip())
    safe_action_label = escape(str(action_label or "Continue").strip())
    safe_action_url = escape(str(action_url or "").strip(), quote=True)
    safe_support_note = escape(str(support_note or "").strip())
    safe_preheader = escape(str(preheader or "").strip())
    safe_badge_label = escape(str(badge_label or "Manley Lifting Account").strip())
    safe_accent_color = escape(str(accent_color or "#123A7A").strip(), quote=True)
    safe_support_contact_line = _support_contact_html_line()
    line_items = "".join(
        f"<p style=\"margin:0 0 12px;color:#334155;font-size:15px;line-height:1.6;\">{escape(str(line).strip())}</p>"
        for line in body_lines
        if str(line or "").strip()
    )
    logo_url = escape(_brand_logo_url(), quote=True)
    home_url = escape(settings.ACCOUNT_FRONTEND_URL.rstrip('/'), quote=True)
    return (
        "<!doctype html>"
        "<html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head>"
        "<body style=\"margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;\">"
        f"<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;\">{safe_preheader}</div>"
        "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"padding:24px 12px;\"><tr><td align=\"center\">"
        "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:640px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;\">"
        f"<tr><td style=\"padding:24px 28px 16px;background:{safe_accent_color};\">"
        f"<a href=\"{home_url}\" style=\"display:inline-block;text-decoration:none;\">"
        f"<img src=\"{logo_url}\" alt=\"Manley Lifting\" style=\"height:44px;width:auto;display:block;\"></a>"
        "</td></tr>"
        "<tr><td style=\"padding:28px;\">"
        f"<p style=\"margin:0 0 10px;color:{safe_accent_color};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;\">{safe_badge_label}</p>"
        f"<h1 style=\"margin:0 0 10px;font-size:24px;line-height:1.3;color:{safe_accent_color};\">{safe_title}</h1>"
        f"<p style=\"margin:0 0 18px;color:#334155;font-size:15px;line-height:1.6;\">{safe_intro}</p>"
        f"{line_items}"
        f"<p style=\"margin:22px 0 0;\"><a href=\"{safe_action_url}\" style=\"display:inline-block;padding:12px 18px;background:{safe_accent_color};color:#ffffff;text-decoration:none;font-weight:700;border-radius:8px;\">{safe_action_label}</a></p>"
        f"<p style=\"margin:16px 0 0;color:#64748b;font-size:13px;line-height:1.5;word-break:break-word;\">If the button does not work, copy and paste this link into your browser:<br>{safe_action_url}</p>"
        "</td></tr>"
        "<tr><td style=\"padding:18px 28px;background:#f1f5f9;border-top:1px solid #e2e8f0;\">"
        f"<p style=\"margin:0 0 8px;color:#334155;font-size:13px;line-height:1.5;\">{safe_support_note}</p>"
        f"<p style=\"margin:0 0 8px;color:#334155;font-size:13px;line-height:1.5;\">{safe_support_contact_line}</p>"
        f"<p style=\"margin:0;color:#64748b;font-size:12px;line-height:1.5;\">Manley Lifting - <a href=\"{home_url}\" style=\"color:#123A7A;text-decoration:none;\">manleylifting.ie</a></p>"
        "</td></tr></table></td></tr></table></body></html>"
    )


def _security_notification_html(*, subject, text_body):
    lines = [line.strip() for line in str(text_body or "").splitlines() if line.strip()]
    action_url = f"{settings.ACCOUNT_FRONTEND_URL.rstrip('/')}/account/security"
    return _render_email_html(
        title=subject,
        intro="We recorded a security-related action on your Manley Lifting account.",
        action_label="Review Security Settings",
        action_url=action_url,
        body_lines=lines,
        support_note="If this was not you, secure your account immediately by changing your password.",
        preheader="Security update on your account.",
        accent_color="#B91C1C",
        badge_label="Account Security",
    )


def send_transactional_email(*, recipient_email, subject, text_body, html_body=""):
    send_token = _normalize_zeptomail_token(settings.ZEPTOMAIL_SEND_TOKEN)

    if not send_token:
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
    html_body = str(html_body or "").strip()
    if html_body:
        payload["htmlbody"] = html_body
    request = Request(
        settings.ZEPTOMAIL_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Authorization": f"Zoho-enczapikey {send_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    masked_recipient = _mask_email_address(recipient_email)
    try:
        with urlopen(request, timeout=10) as response:
            response_body = _safe_response_snippet(response.read())
            if not 200 <= response.status < 300:
                logger.error(
                    "ZeptoMail transactional email rejected status=%s recipient=%s subject=%s response=%s",
                    response.status,
                    masked_recipient,
                    subject,
                    response_body,
                )
                raise TransactionalEmailDeliveryError("Transactional email provider rejected the request")
            logger.info(
                "ZeptoMail transactional email accepted status=%s recipient=%s subject=%s response=%s",
                response.status,
                masked_recipient,
                subject,
                response_body,
            )
    except HTTPError as error:
        response_body = _safe_response_snippet(error.read())
        logger.error(
            "ZeptoMail transactional email HTTP error status=%s recipient=%s subject=%s response=%s",
            error.code,
            masked_recipient,
            subject,
            response_body,
        )
        raise TransactionalEmailDeliveryError(
            "Transactional email provider rejected the request"
        ) from error
    except TransactionalEmailDeliveryError:
        raise
    except Exception as error:
        logger.exception(
            "ZeptoMail transactional email request failed recipient=%s subject=%s",
            masked_recipient,
            subject,
        )
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
        html_body=_render_email_html(
            title="Verify your email",
            intro="Finish setting up your Manley Lifting account.",
            action_label="Verify Email",
            action_url=verification_url,
            body_lines=[
                "Use the secure link below to verify your email and activate your account.",
                "If you did not request this account, you can safely ignore this email.",
            ],
            support_note=_support_contact_text(),
            preheader="Verify your email to activate your account.",
            accent_color="#123A7A",
            badge_label="Welcome to Manley Lifting",
        ),
    )


def send_password_reset_email(*, recipient_email, raw_token):
    reset_url = (
        f"{settings.ACCOUNT_FRONTEND_URL.rstrip('/')}/account/reset-password"
        f"#token={quote(raw_token, safe='')}"
    )
    send_transactional_email(
        recipient_email=recipient_email,
        subject="Reset your Manley Lifting password",
        text_body=(
            "Use the link below to reset your Manley Lifting password:\n\n"
            f"{reset_url}\n\n"
            "If you did not request this change, you can ignore this email."
        ),
        html_body=_render_email_html(
            title="Reset your password",
            intro="Use this secure link to set a new password.",
            action_label="Reset Password",
            action_url=reset_url,
            body_lines=[
                "For your security, this link can only be used once.",
                "If you did not request a password reset, you can ignore this email.",
            ],
            support_note=_support_contact_text(),
            preheader="Reset your account password.",
            accent_color="#0F766E",
            badge_label="Password Assistance",
        ),
    )


def send_email_change_email(*, recipient_email, raw_token):
    change_url = (
        f"{settings.ACCOUNT_FRONTEND_URL.rstrip('/')}/account/change-email"
        f"#token={quote(raw_token, safe='')}"
    )
    send_transactional_email(
        recipient_email=recipient_email,
        subject="Confirm your Manley Lifting email change",
        text_body=(
            "Use the link below to confirm your new Manley Lifting email address:\n\n"
            f"{change_url}\n\n"
            "If you did not request this change, you can ignore this email."
        ),
        html_body=_render_email_html(
            title="Confirm your new email",
            intro="A request was made to change the email on your Manley Lifting account.",
            action_label="Confirm Email Change",
            action_url=change_url,
            body_lines=[
                "Confirm this change using the secure button below.",
                "If you did not request this change, ignore this email and review your account security settings.",
            ],
            support_note="We will never ask for your password by email.",
            preheader="Confirm your new account email address.",
            accent_color="#7C3AED",
            badge_label="Email Change Request",
        ),
    )


def send_security_notification_email(*, recipient_email, subject, text_body):
    def deliver_security_notification_email():
        send_transactional_email(
            recipient_email=recipient_email,
            subject=subject,
            text_body=text_body,
            html_body=_security_notification_html(subject=subject, text_body=text_body),
        )

    transaction.on_commit(deliver_security_notification_email, robust=True)

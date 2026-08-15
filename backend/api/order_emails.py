from django.conf import settings

from .account_emails import _render_email_html, send_transactional_email


def _order_summary(order):
    items = order.line_items if isinstance(order.line_items, list) else []
    summary = []
    for item in items:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or item.get("name") or item.get("sku") or "Item").strip()
        quantity = int(item.get("quantity") or item.get("qty") or 1)
        summary.append(f"{title} x {quantity}")
    return summary or ["Your order items are available in your account."]


def _order_action_url():
    return f"{settings.ACCOUNT_FRONTEND_URL.rstrip('/')}/account/orders"


def _order_email_details(order):
    total = f"{order.currency.upper()} {order.amount_total_cents / 100:.2f}"
    shipping = ", ".join(
        value
        for value in [
            order.shipping_name,
            order.shipping_address_line_1,
            order.shipping_address_line_2,
            order.shipping_city,
            order.shipping_county,
            order.shipping_postcode,
            order.shipping_country_code,
        ]
        if str(value or "").strip()
    )
    return [
        f"Order number: {order.order_number}",
        f"Order total: {total}",
        f"Items: {'; '.join(_order_summary(order))}",
        f"Delivery address: {shipping or 'Address available in your account'}",
    ]


def send_order_confirmation_email(*, order):
    recipient_email = str(order.customer_email or "").strip()
    if not recipient_email:
        return

    action_url = _order_action_url()
    send_transactional_email(
        recipient_email=recipient_email,
        subject=f"Order confirmed - {order.order_number}",
        text_body=(
            "Thank you for your order with Manley Lifting. Your payment has been confirmed.\n\n"
            + "\n".join(_order_email_details(order))
            + f"\n\nView your order: {action_url}\n"
        ),
        html_body=_render_email_html(
            title="Order confirmed",
            intro="Thank you for your order. Your payment has been confirmed and we are preparing it for fulfillment.",
            action_label="View your order",
            action_url=action_url,
            body_lines=_order_email_details(order),
            support_note="We will send another update when your order has shipped.",
            preheader=f"Your order {order.order_number} has been confirmed.",
            accent_color="#123A7A",
            badge_label="Order Confirmation",
        ),
    )


def send_order_shipped_email(*, order):
    recipient_email = str(order.customer_email or "").strip()
    if not recipient_email:
        return

    action_url = _order_action_url()
    send_transactional_email(
        recipient_email=recipient_email,
        subject=f"Your order has shipped - {order.order_number}",
        text_body=(
            "Your Manley Lifting order has shipped.\n\n"
            + "\n".join(_order_email_details(order))
            + f"\n\nView your order: {action_url}\n"
        ),
        html_body=_render_email_html(
            title="Your order has shipped",
            intro="Your order is on its way. Thank you for choosing Manley Lifting.",
            action_label="View your order",
            action_url=action_url,
            body_lines=_order_email_details(order),
            support_note="Please contact us if you need help with your delivery.",
            preheader=f"Order {order.order_number} has shipped.",
            accent_color="#0F766E",
            badge_label="Shipping Confirmation",
        ),
    )


def send_order_completed_email(*, order):
    recipient_email = str(order.customer_email or "").strip()
    if not recipient_email:
        return

    action_url = _order_action_url()
    send_transactional_email(
        recipient_email=recipient_email,
        subject=f"Order delivered - {order.order_number}",
        text_body=(
            "Your Manley Lifting order has been marked as delivered.\n\n"
            + "\n".join(_order_email_details(order))
            + f"\n\nView your order: {action_url}\n"
        ),
        html_body=_render_email_html(
            title="Order delivered",
            intro="Your Manley Lifting order has been marked as delivered.",
            action_label="View your order",
            action_url=action_url,
            body_lines=_order_email_details(order),
            support_note="Please contact us if your delivery has not arrived or if anything is missing.",
            preheader=f"Order {order.order_number} has been delivered.",
            accent_color="#047857",
            badge_label="Delivery Confirmation",
        ),
    )
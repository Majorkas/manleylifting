from dataclasses import dataclass


class UnsupportedDestinationError(ValueError):
    pass


@dataclass(frozen=True)
class CheckoutTotals:
    subtotal_cents: int
    discount_cents: int
    shipping_cents: int
    tax_cents: int
    amount_total_cents: int

    def as_dict(self):
        return {
            "subtotal_cents": self.subtotal_cents,
            "discount_cents": self.discount_cents,
            "shipping_cents": self.shipping_cents,
            "tax_cents": self.tax_cents,
            "amount_total_cents": self.amount_total_cents,
        }


def _shipping_cents(*, country_code, postcode, subtotal_cents):
    country = str(country_code or "").strip().upper()
    normalized_postcode = str(postcode or "").strip().upper().replace(" ", "")
    if country == "IE":
        return 0 if subtotal_cents >= 25000 else 1299
    if country in {"GB", "XI"} and normalized_postcode.startswith("BT"):
        return 0 if subtotal_cents >= 25000 else 1599
    raise UnsupportedDestinationError("We only deliver to the Republic of Ireland and Northern Ireland.")


def calculate_checkout_totals(line_items, *, country_code, postcode):
    subtotal_cents = sum(int(item.get("lineTotalCents") or 0) for item in line_items)
    if subtotal_cents <= 0:
        raise ValueError("Checkout total must be greater than zero")
    shipping_cents = _shipping_cents(
        country_code=country_code,
        postcode=postcode,
        subtotal_cents=subtotal_cents,
    )
    # Product prices are VAT-inclusive. The approved tax provider boundary will
    # supply a tax allocation without changing the customer-facing grand total.
    tax_cents = 0
    return CheckoutTotals(
        subtotal_cents=subtotal_cents,
        discount_cents=0,
        shipping_cents=shipping_cents,
        tax_cents=tax_cents,
        amount_total_cents=subtotal_cents + shipping_cents,
    ).as_dict()

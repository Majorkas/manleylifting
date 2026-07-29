# Store Production Roadmap

This roadmap covers the work required to make the Manley Lifting store functional, secure, operationally supportable, and ready for a production release.

## Assumptions

- The store sells physical goods to customers in the Republic of Ireland and Northern Ireland at launch.
- Existing portal customers use their current Django account and session for both portal and store features.
- People without portal access can create commerce-only accounts for checkout, order history, saved addresses, profile, and security settings.
- Authentication is shared, but portal authorization and commerce capabilities remain separate. A commerce account must never grant company, equipment, report, certificate, staff, or owner access.
- Authenticated checkout is a first-class flow using Stripe Payment Element. Guest checkout remains available only if explicitly approved in Phase 0.
- Django and PostgreSQL remain the source of truth for products, prices, orders, and inventory.
- Stripe is used only for secure payment-method collection, payment authorization/capture, refunds, disputes, and payment-state webhooks. Stripe Product and Price objects are not required for the store catalog.
- Render remains the deployment platform.
- Security takes priority over convenience. Payment, order, and customer data must not be persisted in browser storage unless strictly necessary.

## Current Baseline

Already implemented:

- Local Django catalog models and read endpoints.
- Django admin screens for products and collections.
- Product, collection, cart, checkout, and confirmation React pages.
- Local browser cart persistence.
- Server-side catalog price calculation.
- Stripe PaymentIntent creation and signed webhook handling.
- Opaque status token for checkout polling and order summaries.
- Origin checks, rate limiting, Turnstile support, HTTPS settings, and secret validation.
- Backend tests for catalog reads, intent creation, and a successful Stripe webhook.
- A shared Django `User` identity and portal `UserProfile` already exist, with company access represented by `allowed_companies`.

Not currently launchable:

- Every public store route in `frontend/src/App.jsx` points to `StoreWorkInProgressPage`.
- Orders do not contain a usable delivery address or controlled phone value.
- Shipping, VAT/tax, inventory, fulfillment, cancellation, and refunds are not implemented.
- `OnsiteOrder` and Stripe webhook records are not available in Django admin.
- Payment retries, reconciliation, and webhook validation need hardening.
- Storefront tests and end-to-end checkout tests are missing.
- There is no public account registration, email verification, password recovery, or commerce account lifecycle.
- Orders are not linked to authenticated users and there are no saved-address or account order-history models/APIs.
- The existing single portal role must not be reused as a commerce entitlement because one person can be both a portal customer and a store customer.

## Release Priorities

- **P0:** Blocks launch or could cause payment, security, fulfillment, or legal failures.
- **P1:** Required for a reliable professional launch.
- **P2:** Valuable improvement that can follow shortly after launch.
- **P3:** Growth or optimization work after the store is stable.

---

## Architecture Decision: Local Catalog and Stripe Payment Capture

The store will keep its complete product catalog locally rather than maintaining a duplicate catalog in Stripe.

### Django/PostgreSQL owns

- Products, variants, SKUs, descriptions, collections, images, and publication state.
- Authoritative prices, currencies, VAT/tax classifications, shipping attributes, stock, and reservations.
- Customer accounts, saved addresses, orders, immutable order-item snapshots, fulfillment, returns, and audit history.
- Product images as external Cloudinary/R2 object URLs rather than database binary data.

### Stripe owns

- Payment Element and secure payment-method collection.
- PaymentIntent authorization/capture and 3D Secure handling.
- Provider payment state, refunds, disputes, chargebacks, and signed webhook delivery.
- Card and wallet data, which must never pass through or be stored by the application.

### Implementation rules

- [ ] **P0** Do not require Stripe Product or Price objects and do not build bidirectional product synchronization unless this architecture is deliberately reviewed and changed later.
- [ ] **P0** Send only local variant/SKU identifiers and quantities from the browser. Ignore any browser-supplied product title, unit price, subtotal, tax, shipping, discount, or final total.
- [ ] **P0** Resolve every product from the active local catalog, validate stock, and calculate all monetary amounts server-side using `Decimal` and integer minor units without floating-point conversion.
- [ ] **P0** Persist the local order and immutable order-item snapshots before creating the PaymentIntent.
- [ ] **P0** Send Stripe only the final server-calculated amount, currency, receipt email where appropriate, and a non-sensitive immutable local order reference in metadata.
- [ ] **P0** Use that immutable order reference as the Stripe idempotency key so retries cannot create duplicate charges.
- [ ] **P0** Verify the signed webhook's PaymentIntent ID, order metadata, amount, and currency against the local order before applying any paid/refunded/disputed state.
- [ ] **P0** Keep fulfillment and item-level order operations in the application; Stripe Dashboard is a payment view, not the catalog or order-management source of truth.
- [ ] **P0** Generate the itemized customer confirmation/invoice from local order snapshots because a PaymentIntent receipt alone may not provide the required itemized purchase record.
- [ ] **P1** Add a reconciliation report linking local order number, PaymentIntent ID, local total, Stripe amount, currency, and status without duplicating the product catalog in Stripe.

**Acceptance gate:** A product can be created, priced, stocked, purchased, fulfilled, refunded, and audited without any Stripe Product or Price object. Tampered browser prices are ignored, Stripe receives exactly the local server-calculated total, and the customer receives an itemized record generated from immutable local order data.

---

## Phase 0: Freeze the Commerce Contract

Complete these decisions before changing models or checkout logic.

### Confirmed implementation decisions

- Launch destinations are the Republic of Ireland and Northern Ireland only.
- Displayed product prices are VAT-inclusive. Stripe Tax will calculate tax from server-authoritative product tax codes and the validated delivery address.
- Guest checkout remains available. A past guest order can be claimed only through a single-use proof issued for that individual order after email ownership is verified; matching email text never triggers automatic claiming.
- Portal customers, office staff, and owners may place a company order for a company they are authorized to use. Engineers and legacy staff may not place company orders unless deliberately added to this policy later.
- A company order is visible to its purchaser and to authorized company owners/office staff. The purchaser retains access to the order.
- Stock is tracked and backorders are not allowed.
- Flat launch shipping is EUR 12.99 for the Republic of Ireland and EUR 15.99 for Northern Ireland. Shipping is free from a VAT-inclusive eligible subtotal of EUR 250.00. These values remain server-configurable.
- New commerce accounts require verified email ownership and a minimum 12-character password, in addition to Django's similarity, common-password, and numeric-password checks.
- Existing user emails must be cleaned up before email identity or commerce registration is implemented. The read-only `audit_identity_emails` command is the blocking audit gate.
- Staff and owner MFA is mandatory before production commerce access. Customer MFA is optional.
- Postmark is the transactional email provider. Its verified sender address remains unset until the business confirms it.
- Shared customer account screens live under `/account`, separate from portal-only equipment routes while reusing the same Django identity and secure session.
- Customers may anonymize optional account/profile data, while immutable order records required for accounting, fraud, disputes, and other legal obligations are retained for the approved period.
- Catalog administration remains manual in Django admin for launch. Fulfillment is handled in a protected portal staff/owner interface.
- Returns and refund policy details remain blocked on legal/business review and must not be inferred by the implementation.

### Outstanding launch approvals

- Irish VAT registration details, product tax codes/rates, invoice requirements, and accountant sign-off.
- Delivery estimates, excluded postcodes, oversized-product rules, and the exact subtotal definition used by the free-shipping threshold.
- Cancellation, returns, partial/full refund, damaged-goods, and failed-delivery policies.
- Which staff roles may issue refunds and adjust stock, including any step-up authentication or approval thresholds.
- Saved-address deletion behavior, dormant-account retention, and exact statutory/order/account audit retention periods.
- Verified Postmark sender address plus the support email, phone, legal business address, company number, and VAT number.

- [x] **P0** Confirm the countries and regions that can place orders.
- [x] **P0** Decide whether displayed prices include Irish VAT.
- [ ] **P0** Confirm VAT rates, VAT registration details, invoice requirements, and accountant sign-off.
- [ ] **P0** Define shipping methods, rates, free-shipping rules, delivery estimates, and excluded postcodes/regions.
- [x] **P0** Decide whether products can be backordered or must always have available stock.
- [ ] **P0** Define cancellation, return, partial-refund, full-refund, damaged-goods, and failed-delivery policies.
- [ ] **P0** Decide who can view orders, fulfill orders, issue refunds, and change stock.
- [x] **P0** Decide whether guest checkout remains available or whether checkout requires a verified account.
- [x] **P0** Decide whether orders placed by portal customers are personal purchases, company purchases, or selectable at checkout.
- [x] **P0** Define whether company orders/addresses are visible only to the purchaser or to authorized members/owners of that company.
- [ ] **P0** Decide whether commerce users sign in with email only while existing portal users may continue using username or verified email.
- [ ] **P0** Define account deletion, address deletion, order retention, dormant-account retention, and guest-order claiming rules.
- [x] **P0** Decide which roles require MFA. At minimum, staff and owner accounts should require MFA before production commerce operations are enabled.
- [ ] **P1** Confirm support email, phone, business name/address, company number, and VAT number used in legal pages and emails.

**Acceptance gate:** A written commerce and account specification exists and has business/accounting approval. It defines guest checkout, personal/company order ownership, account roles, address ownership, retention, and MFA. No tax, shipping, inventory, identity, or order-state implementation starts until these decisions are fixed.

---

## Phase 1: Establish the Security Baseline

- [ ] **P0** Keep Stripe secret keys, webhook secrets, Turnstile secrets, database URLs, email credentials, and Django secrets only in Render environment variables.
- [ ] **P0** Search the full Git history for accidentally committed secrets and rotate any exposed credential.
- [ ] **P0** Maintain separate Stripe test and live keys/webhook secrets. Never use live keys in local development or automated tests.
- [ ] **P0** Set exact production origin allowlists. Do not use wildcard CORS or CSRF origins.
- [ ] **P0** Require HTTPS, HSTS, secure cookies, and the existing strict host configuration in production.
- [x] **P0** Keep the current secure session model: short-lived access token in memory and refresh token in an `HttpOnly`, `Secure` cookie. Never place access or refresh tokens in local storage.
- [x] **P0** Use one authentication authority and one Django `User` identity for portal and commerce. Do not create a second password database or duplicate login system.
- [x] **P0** Model authorization as independent capabilities. Authentication or commerce registration alone must never imply portal/company access.
- [ ] **P0** Prefer a host-only refresh cookie on the API domain and the narrowest viable `SameSite` policy. Do not widen the cookie to every parent-domain subdomain unless a documented requirement and threat review justify it.
- [ ] **P0** Add strict rate limits and Turnstile to registration, login, verification resend, password reset, email change, and order-claim endpoints.
- [ ] **P0** Return generic responses for registration, login, verification, and password reset so attackers cannot enumerate existing accounts.
- [ ] **P0** Require verified email ownership before showing order history, saving addresses, claiming guest orders, or changing the account email.
- [ ] **P0** Use single-use, short-lived verification/reset links. Store only hashed tokens and revoke them after use, password change, email change, or account disablement.
- [ ] **P0** Support password change, password reset, sign out, sign out all devices, and server-side refresh-session revocation.
- [ ] **P0** Require current-password or step-up authentication for email changes, password changes, MFA changes, account deletion, and other sensitive account actions.
- [ ] **P0** Never auto-merge an ecommerce registration into an existing portal account based only on a matching email string. Require successful login or verified ownership recovery.
- [ ] **P0** Enforce order/address ownership from `request.user` on the server. Never accept a client-supplied user ID as authorization.
- [ ] **P0** Set `SHOP_REQUIRE_TURNSTILE=True`, provide a production Turnstile secret, and fail deployment if the corresponding frontend/backend keys are missing.
- [ ] **P0** Keep catalog prices and final totals server-authoritative. Do not accept a total, discount, tax, or shipping charge calculated by the browser.
- [ ] **P0** Stop passing checkout capability tokens in query strings. Send them in POST bodies or protected headers so they do not leak through browser history, proxy logs, analytics, or referrers.
- [ ] **P0** Store only a cryptographic hash of order/status lookup tokens in the database. Use constant-time comparison and support token rotation/revocation.
- [ ] **P0** Remove `payment_client_secret` from persistent order storage unless a documented recovery flow truly requires it. Never log it.
- [ ] **P0** Ensure logs never contain customer addresses, full email payloads, status tokens, client secrets, Stripe signatures, or card-related data.
- [ ] **P1** Move CSP from report-only to enforced mode after testing Stripe, Turnstile, images, and frontend assets in staging.
- [ ] **P1** Define retention and deletion periods for pending orders, paid orders, webhook records, customer PII, and logs.
- [ ] **P1** Protect staff/owner accounts with mandatory TOTP or WebAuthn MFA and offer MFA plus recovery codes to customers.
- [ ] **P1** Assess field-level encryption for saved-address PII, document encryption-at-rest controls, and establish a key-rotation procedure.

**Acceptance gate:** `python manage.py check --deploy` passes with production-like settings; a security review confirms one identity system, separate portal/commerce authorization, no browser-persisted access/payment secrets, no account enumeration, no address/order IDOR, and no sensitive log fields.

---

## Phase 2: Redesign the Identity, Order, Address, and Product Data Model

Create migrations before building operational screens.

- [x] **P0** Keep `auth.User` as the single login identity. Keep portal roles/company membership in the portal profile and add a separate one-to-one `CommerceCustomerProfile` for commerce preferences and lifecycle state.
- [x] **P0** Do not add `ecommerce_customer` as another mutually exclusive portal role. Portal access must depend on explicit portal profile/capabilities; commerce-only users have no allowed companies or portal permissions.
- [x] **P0** Enforce a normalized, case-insensitive unique verified email for commerce accounts after auditing and resolving missing/duplicate emails on existing portal users.
- [ ] **P0** Add a `SavedAddress` model owned by the commerce profile with label, recipient, controlled phone, address fields, type/default flags, timestamps, and soft-delete/audit fields.
- [ ] **P0** Add database constraints so each account has at most one default shipping and one default billing address, and cap the number of active addresses per account.
- [ ] **P0** Link each order to a nullable authenticated `User`/commerce profile using `SET_NULL` for legally retained orders, while preserving immutable customer and address snapshots.
- [ ] **P0** If company purchasing is approved, add an explicit nullable company purchaser plus authorization rules; never infer company ownership from an email domain.
- [ ] **P0** Add an auditable guest-order claim record rather than silently attaching historical orders by email.
- [ ] **P0** Give every order a human-friendly immutable order number separate from `checkout_ref`.
- [ ] **P0** Separate payment status from fulfillment status.
- [ ] **P0** Add payment states for pending, processing, paid, failed, canceled, partially refunded, fully refunded, disputed, and chargeback.
- [ ] **P0** Add fulfillment states for unfulfilled, processing, packed, shipped, delivered, canceled, and returned.
- [ ] **P0** Add normalized `OrderItem` rows instead of relying only on `line_items` JSON. Snapshot SKU, title, variant, unit price, quantity, tax, discount, and line total.
- [ ] **P0** Add shipping name, controlled phone, address lines, city/town, county, postcode, country, and optional billing address.
- [ ] **P0** Add subtotal, discount, shipping, tax, and grand-total fields in minor currency units.
- [ ] **P0** Add Stripe customer/payment identifiers needed for reconciliation, without storing card data.
- [ ] **P0** Add product SKU, stock policy, available quantity, reserved quantity, weight, dimensions, and shipping/tax classification.
- [ ] **P0** Add inventory transaction and reservation records so every stock movement is auditable.
- [ ] **P1** Add order notes, tracking carrier/reference/URL, fulfilled timestamp, canceled timestamp, and refund totals.
- [ ] **P1** Add constraints and indexes for order number, checkout ref, PaymentIntent ID, SKU, active catalog queries, status, and timestamps.
- [ ] **P1** Add an audit trail for stock adjustments, order status changes, address edits, cancellations, and refunds.
- [ ] **P1** Add account/session security records needed for email verification, MFA, session revocation, login alerts, and security-event auditing without storing raw tokens.

**Acceptance gate:** Migrations apply cleanly to a production-size database copy and roll back safely. Model tests enforce identity separation, unique verified emails, saved-address ownership/default constraints, immutable order snapshots, legal state transitions, unique identifiers, nonnegative totals, and nonnegative stock.

---

## Phase 2A: Implement Unified Customer Authentication and Account Lifecycle

- [x] **P0** Audit existing portal users for missing, duplicate, unverified, or shared email addresses before enabling email-based commerce login.
- [ ] **P0** Backfill commerce profiles for existing portal users lazily after a successful login or through a reviewed migration. Do not alter their passwords, portal roles, or company memberships.
- [x] **P0** Stop portal request helpers from automatically creating a default portal customer profile for every authenticated user. Portal profiles/company memberships must be explicitly provisioned, while commerce profiles may be created independently.
- [ ] **P0** Add public registration for commerce-only accounts using email, password, terms/privacy acceptance, Turnstile, throttling, and verified-email activation.
- [ ] **P0** Prevent registration from creating a duplicate identity when the email belongs to an existing portal account. Return a generic response and direct the legitimate owner through login or password recovery.
- [ ] **P0** Use the existing case-insensitive portal credentials for current portal customers and allow verified-email login only after duplicate-email cleanup.
- [x] **P0** Build one account/session bootstrap endpoint that returns minimal profile data and explicit capabilities such as `can_shop`, `can_view_orders`, and `can_access_portal`; do not send authorization data the user does not need.
- [ ] **P0** Ensure commerce-only accounts receive `403` from every company/equipment/report/certificate/staff endpoint even if they manually call the API.
- [ ] **P0** Add verified email activation, resend verification, forgot password, reset password, change password, change email/reverify, logout, logout-all-sessions, and account disable/delete flows.
- [ ] **P0** Preserve a validated internal redirect through login/verification/reset so QR equipment links, checkout returns, and order-history links return to the requested page. Reject external/open redirects.
- [ ] **P0** Invalidate all refresh sessions after password reset, suspicious account recovery, or account disablement; let password change offer an explicit sign-out-other-sessions option.
- [ ] **P0** Add generic security notifications for password/email/MFA changes and new-session activity without exposing secrets.
- [ ] **P1** Add staff/owner mandatory MFA and optional customer MFA with one-time recovery codes stored only as secure hashes.
- [ ] **P1** Add a user-facing active-session list with device/time metadata and individual session revocation.

**Acceptance gate:** An existing portal customer signs in once and can access both authorized portal features and commerce account features. A newly registered commerce-only user can verify, sign in, recover their account, and use commerce features but receives no portal data or permissions.

**Session rollout note:** Deploying session-bound JWTs intentionally invalidates tokens issued by older releases, so the release must announce a one-time sign-in reset. Browser sessions have a 30-day absolute lifetime from login even when refresh tokens rotate; active users must sign in again after that boundary.

---

## Phase 2B: Implement Account Order History and Saved Address APIs

- [ ] **P0** Associate new authenticated checkouts with `request.user` on the server and snapshot the verified checkout email/address onto the order.
- [ ] **P0** Add paginated `/account/orders/` and `/account/orders/<order-number>/` endpoints that always scope queries to the authenticated user or explicitly authorized company.
- [ ] **P0** Return only customer-safe order fields; exclude internal notes, raw Stripe payloads, payment client secrets, capability hashes, and staff audit metadata.
- [ ] **P0** Add authenticated saved-address list/create/update/delete/default endpoints with strict object ownership, field validation, address limits, and audit logging.
- [ ] **P0** Resolve a saved address by its ID through the authenticated user's queryset during checkout. Never trust address fields or owner IDs merely because they came from an authenticated browser.
- [ ] **P0** Copy a selected saved address into the immutable order snapshot; later address edits/deletion must never rewrite historical orders.
- [ ] **P0** Let customers explicitly opt to save a checkout address. Do not silently save guest or one-off addresses.
- [ ] **P0** If guest checkout remains, provide a secure post-purchase account creation/claim flow using verified email plus a one-time claim proof. Do not attach every order sharing that email automatically.
- [ ] **P0** Define and enforce whether company purchase history is purchaser-only or company-visible, including behavior when company membership is removed.
- [ ] **P1** Add customer-safe order filters, shipment tracking, invoice/receipt downloads, cancellation/return request status, and accessible pagination.

**Acceptance gate:** Users can view only their authorized orders and addresses. Attempts to substitute another order/address ID return `404` or `403` without leaking existence, while immutable order snapshots remain correct after saved-address changes.

---

## Phase 3: Make Catalog Management Operational

- [ ] **P0** Register `OnsiteOrder`, order items, inventory, reservations, refunds, and `ProcessedStripeEvent` in Django admin.
- [ ] **P0** Make payment identifiers, totals, and immutable snapshots read-only in admin.
- [ ] **P0** Add order search by order number, customer email, checkout ref, PaymentIntent ID, and tracking number.
- [ ] **P0** Add filters for payment status, fulfillment status, date, collection, active product, and low stock.
- [ ] **P0** Validate product title, slug, SKU/variant reference, positive price, supported currency, stock policy, image, and collection before activation.
- [ ] **P0** Prevent duplicate SKUs/variant references and accidental activation of products without a valid price or fulfillment configuration.
- [ ] **P1** Add a validated CSV import/export workflow with dry-run output, row-level errors, and transaction rollback.
- [ ] **P1** Add a catalog validation management command that fails when active products have missing images, invalid prices, unsupported currencies, or missing stock/shipping data.
- [ ] **P1** Add low-stock reporting and a deliberate stock-adjustment workflow with reason codes.

**Acceptance gate:** A non-developer can add a product, set price/stock, publish it, find an order, and inspect its full audit history without editing the database directly.

---

## Phase 4: Implement Shipping, Address, VAT, and Final Pricing

- [ ] **P0** Collect a controlled phone value and complete shipping address using Stripe Address Element or equivalent accessible fields.
- [ ] **P0** For signed-in users, allow selection of an owned saved address and prefill verified profile data without exposing addresses in URLs or browser storage.
- [ ] **P0** Require explicit consent before saving a new checkout address and allow checkout with an unsaved one-off address.
- [ ] **P0** Add browser autocomplete attributes and server-side normalization/validation for all customer and address fields.
- [ ] **P0** Reject unsupported destination countries/regions before creating a PaymentIntent.
- [ ] **P0** Calculate shipping on the server from destination, method, weight/dimensions, and business rules.
- [ ] **P0** Calculate VAT/tax on the server using Stripe Tax or an accountant-approved implementation.
- [ ] **P0** Display subtotal, discount, shipping, VAT/tax, and final payable total before the customer confirms payment.
- [ ] **P0** Recalculate every line and the complete total immediately before creating or updating the PaymentIntent.
- [ ] **P0** Save an immutable pricing/address snapshot on the order.
- [ ] **P0** Associate authenticated orders with the signed-in account on the server; never accept customer ownership from the checkout payload.
- [ ] **P0** Require acceptance of current terms, returns, and privacy policies, recording policy versions and acceptance time.
- [ ] **P1** Clearly display delivery estimates and any regional restrictions in cart and checkout.
- [ ] **P1** Decide whether address validation is advisory or blocking and handle corrections accessibly.

**Acceptance gate:** For every supported destination, the amount shown immediately before payment exactly matches the Stripe amount and stored order total. Unsupported destinations cannot reach payment.

---

## Phase 5: Make Payment Creation Idempotent and Correct

- [ ] **P0** Keep PaymentIntent creation independent of Stripe Product/Price objects; use local catalog/order records for all item and pricing details.
- [ ] **P0** Create or lock the local order before calling Stripe.
- [ ] **P0** Use the immutable order/checkout reference as Stripe's idempotency key.
- [ ] **P0** Reuse or deliberately replace an existing PaymentIntent; never create orphan intents when the customer double-clicks or retries a request.
- [ ] **P0** Put only non-sensitive order identifiers in Stripe metadata.
- [ ] **P0** Validate webhook signature before reading or storing the event.
- [ ] **P0** On every success webhook, verify PaymentIntent ID, metadata order reference, amount, and currency against the stored order before marking it paid.
- [ ] **P0** Process order updates and inventory changes in one database transaction.
- [ ] **P0** Mark a webhook event processed only after its handler commits successfully. Store processing/error state so failed events can be retried.
- [ ] **P0** Handle `processing`, `succeeded`, `payment_failed`, `canceled`, refund, partial refund, dispute, and chargeback events.
- [ ] **P0** Map canceled events to canceled, not failed.
- [ ] **P0** Add a scheduled reconciliation command that retrieves Stripe state for stale pending/processing orders and repairs missed webhooks.
- [ ] **P0** Configure the production webhook endpoint in Stripe and subscribe only to required event types.
- [ ] **P1** Add explicit timeouts and safe retries around Stripe and Turnstile network calls.

**Acceptance gate:** Duplicate checkout requests produce one logical order and one charge. A lost webhook is reconciled automatically. A mismatched amount/currency is rejected and alerted rather than marking an order paid.

---

## Phase 6: Add Atomic Inventory and Reservation Logic

- [ ] **P0** Validate requested quantities against active product and available stock on every checkout attempt.
- [ ] **P0** Reserve stock atomically using database transactions and row locks before accepting payment.
- [ ] **P0** Expire reservations after a defined interval and restore stock through a scheduled task.
- [ ] **P0** Convert reservations to committed stock movements exactly once after confirmed payment.
- [ ] **P0** Release reservations after canceled/failed payments and approved cancellations.
- [ ] **P0** Prevent overselling under concurrent checkouts and prevent stock from becoming negative.
- [ ] **P0** Enforce the same quantity ceiling in cart UI, checkout API, and inventory service.
- [ ] **P1** Show in-stock, low-stock, out-of-stock, and backorder states on product/cart pages.
- [ ] **P1** Revalidate stale carts and clearly explain product removal or price/availability changes.

**Acceptance gate:** Two simultaneous orders for the final unit cannot both succeed. Reservation expiry, payment failure, refund/cancellation policy, and manual stock adjustments leave inventory correct and auditable.

---

## Phase 7: Build Fulfillment, Cancellation, and Refund Operations

- [ ] **P0** Add a protected staff order list/detail workflow, either in hardened Django admin or the portal.
- [ ] **P0** Show customer, address, items, pricing, payment state, fulfillment state, and audit history.
- [ ] **P0** Add controlled transitions for processing, packed, shipped, delivered, canceled, and returned.
- [ ] **P0** Generate a printable picking/packing document without exposing unnecessary PII.
- [ ] **P0** Record carrier, tracking number/link, shipping date, and fulfillment actor.
- [ ] **P0** Implement server-side Stripe full and partial refunds with owner-only permission, confirmation, reason, and audit logging.
- [ ] **P0** Reconcile refund/dispute/chargeback webhooks to local records.
- [ ] **P0** Define how cancellations and returns affect inventory.
- [ ] **P1** Add a daily exception view for paid-unfulfilled, stale pending, failed email, inventory mismatch, and webhook/reconciliation errors.

**Acceptance gate:** Staff can fulfill, cancel, and refund an order without using Stripe Dashboard plus manual database changes. Every sensitive action is authorized and audited.

---

## Phase 8: Add Transactional Email

- [ ] **P0** Select a transactional provider and configure separate staging/production credentials.
- [ ] **P0** Configure SPF, DKIM, and DMARC for the sending domain.
- [ ] **P0** Send idempotent, expiring account verification, password reset, email-change confirmation, and security-change notification emails.
- [ ] **P0** Send idempotent customer emails for payment received/order confirmed, shipped, canceled, and refunded.
- [ ] **P0** Send staff notifications for paid orders and operational exceptions.
- [ ] **P0** Include order number, item summary, totals, support details, and delivery information; never include status tokens or payment secrets.
- [ ] **P0** Track email delivery attempts and retry transient failures without sending duplicates.
- [ ] **P1** Generate legally compliant invoices/receipts if Stripe receipts do not satisfy business/accounting requirements.

**Acceptance gate:** A staging purchase generates one customer confirmation and one staff notification; retries do not create duplicate emails.

---

## Phase 9: Finish and Activate the Storefront

- [ ] **P0** Keep WIP routes in place until all previous P0 acceptance gates pass.
- [ ] **P0** Restore the real components for `/shop`, collection/product pages, `/cart`, `/checkout`, and `/order-confirmed` in `frontend/src/App.jsx`.
- [ ] **P0** Refactor the customer portal into a shared authenticated account shell. All authenticated customers see Orders, Addresses, Profile, and Security; only users with explicit portal capabilities see Companies, Equipment, Reports, and Certificates.
- [ ] **P0** Reuse one login/session flow for portal and commerce. The store may expose an account-login entry route, but it must render the shared auth flow and use the same backend identity/session as `/portal/login`.
- [ ] **P0** Add commerce registration, verify-email, forgot/reset-password, account profile, security, order history/detail, and saved-address screens.
- [ ] **P0** Route commerce-only users to their order/account overview after login and never render an empty or unauthorized equipment dashboard.
- [ ] **P0** Let existing portal customers move between equipment and store account sections without logging in again.
- [ ] **P0** Preserve QR equipment, checkout, and order redirect targets through login and email verification using validated same-origin paths only.
- [ ] **P0** Derive navigation from backend capabilities for usability while continuing to enforce every permission on the backend.
- [ ] **P0** Never store access/refresh tokens, verification/reset tokens, full saved addresses, or order capability secrets in local storage.
- [ ] **P0** Confirm `CartProvider` wraps every route/component that calls `useCart`.
- [ ] **P0** Clamp and normalize cart quantities and reject malformed local-storage cart data.
- [ ] **P0** Show server-confirmed pricing before payment and explain price/stock changes from stale carts.
- [ ] **P0** Add safe payment retry, duplicate-submit prevention, processing, failure, cancellation, network-loss, and timeout states.
- [ ] **P0** Recover an in-progress checkout after refresh without persisting client secrets or payment credentials.
- [ ] **P0** Make order confirmation depend on verified backend order state, not only local browser state.
- [ ] **P0** Add secure customer order lookup using an opaque one-time/rotatable capability or verified email flow. Do not expose order PII from guessable references.
- [ ] **P0** For authenticated customers, prefer account-scoped order history over reusable capability URLs.
- [ ] **P1** Add clear loading, empty, unavailable, out-of-stock, and error states to every store route.
- [ ] **P1** Add accessible focus management, error summaries, labels, keyboard behavior, and screen-reader announcements to checkout/cart dialogs.
- [ ] **P1** Add a real 404 route and safe recovery links.
- [ ] **P1** Add product/collection metadata, canonical URLs, Product/Breadcrumb JSON-LD, sitemap, and robots configuration.
- [ ] **P2** Add search, sorting, and filters after the core catalog size justifies them.

**Acceptance gate:** A portal customer can use the same session for equipment and store account features, while a commerce-only customer can register and use orders/addresses without any portal access. Both can browse, add/edit items, recover from stale cart changes, pay once, refresh during processing, and retrieve only their authorized orders on desktop and mobile.

---

## Phase 10: Build Automated Test Coverage

### Backend tests

- [ ] **P0** Local-catalog checkout makes no Stripe Product/Price API calls, ignores browser-supplied prices/totals, and sends the exact server-calculated minor-unit amount to the PaymentIntent.
- [ ] **P0** Existing portal login compatibility and lazy commerce-profile creation without role/company changes.
- [ ] **P0** Commerce registration, email uniqueness/normalization, verification, resend, password reset, email change, account disable/delete, session revocation, and generic anti-enumeration responses.
- [ ] **P0** Permission matrix covering portal customer, commerce-only customer, engineer, office staff, owner, inactive user, unverified user, and guest.
- [ ] **P0** Commerce-only users are denied every portal/company/equipment/report/certificate/staff endpoint.
- [ ] **P0** Account order list/detail ownership, optional company-order rules, guest-order claim proofs, and removal of access after relevant membership changes.
- [ ] **P0** Saved-address CRUD ownership/default constraints, cross-account ID substitution, limits, validation, soft deletion, and immutable order snapshots.
- [ ] **P0** Catalog activation, positive pricing, currency, SKU uniqueness, and unavailable-product behavior.
- [ ] **P0** Quantity limits, server-side price calculation, shipping, VAT/tax, and final totals.
- [ ] **P0** PaymentIntent idempotency and simultaneous duplicate requests.
- [ ] **P0** Webhook signature rejection, duplicate delivery, amount/currency/order mismatch, handler failure/retry, and transaction rollback.
- [ ] **P0** All payment/refund/dispute state transitions and illegal transition rejection.
- [ ] **P0** Reconciliation of stale/missed webhooks.
- [ ] **P0** Concurrent inventory reservations, expiry, release, conversion, and no-negative-stock constraint.
- [ ] **P0** Order lookup authorization/token hashing and PII non-disclosure.
- [ ] **P0** Admin/portal permissions for order view, fulfillment, cancellation, and refunds.
- [ ] **P1** Email idempotency and retry behavior.

### Frontend tests

- [ ] **P0** Shared login, registration, verification, reset, safe redirect validation, session expiry, logout-all, and capability-driven navigation.
- [ ] **P0** Portal customers see both portal and commerce areas; commerce-only customers never see or enter protected portal areas.
- [ ] **P0** Order history/detail loading, pagination, empty/error states, unauthorized order behavior, and safe receipt/tracking links.
- [ ] **P0** Saved-address create/edit/delete/default/select flows, explicit save consent, validation, and inaccessible foreign addresses.
- [ ] **P0** Cart load/normalization, add/remove, quantity limits, stale product, and price change.
- [ ] **P0** Product/collection loading, empty, unavailable, and failure states.
- [ ] **P0** Checkout field validation, unsupported address, Turnstile failure, and server total update.
- [ ] **P0** Stripe decline, authentication-required payment, success, processing, cancellation, retry, double-submit, and timeout states.
- [ ] **P0** Refresh recovery during pending/processing payment and secure confirmation lookup.
- [ ] **P1** Accessibility checks for cart, forms, errors, and dialogs.

### End-to-end staging tests

- [ ] **P0** Existing portal customer login -> equipment -> store -> checkout -> order history without a second login.
- [ ] **P0** New commerce-only registration -> verification -> checkout -> order history/address management -> attempted portal access denied.
- [ ] **P0** Password reset/session revocation and mobile reload behavior for both portal and commerce-only accounts.
- [ ] **P0** Guest checkout -> verified account creation/order claim, if guest checkout remains enabled.
- [ ] **P0** Browse -> product -> cart -> checkout -> Stripe success -> webhook -> confirmation -> inventory -> emails.
- [ ] **P0** Test Stripe decline, insufficient funds, 3DS/authentication, processing, and canceled payment scenarios.
- [ ] **P0** Refresh, back/forward, duplicate taps, network interruption, and expired Turnstile at each checkout stage.
- [ ] **P0** Exercise Chrome, Safari, Firefox, iPhone Safari/Chrome, and Android Chrome.
- [ ] **P0** Issue and verify a test full refund and partial refund.

**Acceptance gate:** All automated tests pass in CI. The staging end-to-end matrix passes against Stripe test mode and real webhooks.

---

## Phase 11: Add Monitoring, Backups, and Performance Controls

- [ ] **P0** Add backend and frontend error tracking with environment/release tags and PII scrubbing.
- [ ] **P0** Add structured logs with a correlation/order reference, but no secret tokens or sensitive customer data.
- [ ] **P0** Alert on webhook failures, reconciliation failures, amount mismatches, stale paid/unfulfilled orders, negative/low inventory, elevated checkout errors, and failed emails.
- [ ] **P0** Alert on registration/login/reset abuse, account lockouts, verification floods, suspicious order claims, MFA recovery, and repeated cross-account authorization failures without logging credentials or raw tokens.
- [ ] **P0** Add health/readiness checks for application, database, cache, and critical dependencies without leaking internals.
- [ ] **P0** Enable automated PostgreSQL backups and complete a documented restore drill.
- [ ] **P0** Document recovery point and recovery time objectives.
- [ ] **P1** Add checkout funnel, payment success/failure, order value, refund, fulfillment time, and stock metrics without storing unnecessary PII.
- [ ] **P1** Load-test catalog reads, cart-to-intent creation, status polling, webhook bursts, and admin order searches.
- [ ] **P1** Verify database indexes and remove N+1 queries before launch.

**Acceptance gate:** A deliberate staging error triggers an alert, a missed webhook is visible/reconciled, and a backup restore succeeds in a disposable environment.

---

## Phase 12: Complete Legal, Privacy, Accessibility, and PCI Review

- [ ] **P0** Have the Terms, Privacy, Returns/Refunds, Shipping/Delivery, and Cookie policies reviewed against the actual implementation and Irish/EU obligations.
- [ ] **P0** Display legal business identity, contact details, VAT information, prices, delivery charges, and cancellation rights correctly.
- [ ] **P0** Document the lawful basis, retention, deletion, and processor list for order/customer data.
- [ ] **P0** Document commerce account creation, email verification, order-history retention, saved-address handling, account deletion, company-order visibility, and the distinction between deleting optional profile data and retaining legally required order records.
- [ ] **P0** Verify cookie consent blocks nonessential analytics/marketing until consent and supports withdrawal.
- [ ] **P0** Confirm Stripe Payment Element keeps card data out of Manley Lifting systems and document the applicable PCI SAQ scope.
- [ ] **P0** Run keyboard, screen reader, zoom/reflow, contrast, form-error, and mobile accessibility checks.
- [ ] **P1** Add a documented process for data-access/deletion requests that respects accounting-retention obligations.

**Acceptance gate:** Legal/accounting sign-off is recorded, consent behavior matches policy text, and no known critical accessibility issue remains.

---

## Phase 13: Configure Staging

Use isolated services and Stripe test mode. Never test destructive workflows against production orders.

### Frontend environment

```env
VITE_API_BASE_URL=https://api-staging.example.com/api
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_replace
VITE_TURNSTILE_SITE_KEY=replace
```

### Backend environment

```env
DJANGO_DEBUG=False
DJANGO_SECRET_KEY=replace-with-generated-secret
DJANGO_ALLOWED_HOSTS=api-staging.example.com
DJANGO_SECURE_SSL_REDIRECT=True

DATABASE_URL=postgresql://replace
USE_REDIS_CACHE=True
REDIS_URL=redis://replace

CORS_ALLOWED_ORIGINS=https://staging.example.com
CSRF_TRUSTED_ORIGINS=https://staging.example.com

STRIPE_SECRET_KEY=sk_test_replace
STRIPE_WEBHOOK_SECRET=whsec_replace
STRIPE_CURRENCY=eur

SHOP_ENFORCE_CHECKOUT_ORIGIN=True
SHOP_REQUIRE_CHECKOUT_ORIGIN=True
SHOP_CHECKOUT_ALLOWED_ORIGINS=https://staging.example.com
SHOP_REQUIRE_TURNSTILE=True
SHOP_TURNSTILE_SECRET_KEY=replace
```

- [ ] **P0** Use a separate staging database, Redis instance, object storage, email sandbox, Turnstile configuration, and Stripe webhook.
- [ ] **P0** Configure the staging refresh cookie as `HttpOnly` and `Secure` with the narrowest host/domain and `SameSite` policy that supports the actual frontend/API topology; verify it on iPhone and Android reloads.
- [ ] **P0** Configure a staging email sender and test verification, reset, email-change, security notification, and order emails end to end.
- [ ] **P0** Run migrations automatically as a controlled release step.
- [ ] **P0** Load representative catalog, stock, shipping, and tax data without copying unnecessary production PII.
- [ ] **P0** Configure SPA rewrites so direct product/cart/checkout URLs resolve correctly.
- [ ] **P0** Run `python manage.py check --deploy`, backend tests, frontend lint/tests/build, migration checks, and all staging smoke tests.

**Acceptance gate:** Staging mirrors production architecture and passes the full automated and manual checkout matrix.

---

## Phase 14: Production Release

- [ ] **P0** Freeze catalog/order schema changes before the release window.
- [ ] **P0** Take and verify a pre-release database backup.
- [ ] **P0** Confirm rollback steps for application, migrations, Stripe webhook, and store routes.
- [ ] **P0** Set production Stripe live keys and a separate live webhook secret only at the final release stage.
- [ ] **P0** Verify production Turnstile, exact origins, HTTPS, CSP, email, storage, database, Redis, and alerting.
- [ ] **P0** Apply migrations, run the catalog validation command, and confirm stock/prices.
- [ ] **P0** Run the account migration/audit report and resolve every duplicate/missing portal email before enabling commerce registration or email login.
- [ ] **P0** Point the public store routes from WIP to the real store pages.
- [ ] **P0** Smoke-test one existing portal customer and one newly verified commerce-only customer, including order history, saved addresses, password recovery, session reload, and portal access denial for the commerce-only user.
- [ ] **P0** Place one low-value real order from desktop and mobile, verify webhook/order/inventory/email/fulfillment, then issue and verify a refund.
- [ ] **P0** Monitor errors, Stripe webhook delivery, stale orders, payment failure rate, email delivery, and inventory continuously for at least 48 hours.
- [ ] **P0** Keep an owner and technical responder available during the launch window.

**Go/no-go rule:** Do not launch with an unresolved P0 item. Re-enable the WIP page if payment correctness, inventory, fulfillment, security, or monitoring is uncertain.

---

## Phase 15: Post-Launch Operations

### Daily

- [ ] Review failed/stale payments, webhook/reconciliation errors, paid-unfulfilled orders, email failures, refunds/disputes, and low stock.
- [ ] Reconcile Stripe payouts/orders against local records and investigate mismatches.
- [ ] Review account-security alerts, verification/reset delivery failures, suspicious order claims, and repeated authorization failures.

### Weekly

- [ ] Review logs/alerts, abandoned checkout causes, conversion, fulfillment time, refunds, and customer support issues.
- [ ] Apply catalog/stock changes through audited tools only.

### Monthly

- [ ] Patch dependencies, review security advisories, run restore/recovery checks, review access permissions, and test an end-to-end purchase/refund in staging.
- [ ] Review retention/deletion jobs and legal policy accuracy.

### Later enhancements

- [ ] **P2** Search, filtering, sorting, related products, and recommendations.
- [ ] **P2** Discount/coupon system with server-side limits and audit history.
- [ ] **P2** Consent-aware analytics and conversion reporting.
- [ ] **P2** Wish lists, saved carts, reorder shortcuts, and company purchasing controls after the core account system is stable.
- [ ] **P3** Abandoned-cart email only after explicit marketing/legal review and consent rules are implemented.
- [ ] **P3** Product reviews, wish lists, multi-currency, and internationalization.

## Minimum Production Definition of Done

The store is ready only when all of the following are true:

- [ ] All P0 items through Phase 14 are complete.
- [ ] Existing portal customers use the same secure identity/session for portal and commerce without losing their current roles, companies, or QR redirects.
- [ ] Commerce-only users can register, verify, recover, manage sessions, view their orders, and manage saved addresses while having no portal/company access.
- [ ] Authentication and authorization are tested independently, with no account enumeration, open redirects, cross-account order/address access, or browser-persisted auth tokens.
- [ ] Real store routes are enabled and WIP routes are retained as a tested rollback option.
- [ ] Django/PostgreSQL remains the sole catalog, pricing, stock, order, and fulfillment source of truth; Stripe is limited to payment processing and reconciliation.
- [ ] Prices, VAT/tax, shipping, address, stock, and totals are server-authoritative and correct.
- [ ] Payment creation is idempotent and every paid/refunded/disputed state reconciles from Stripe.
- [ ] Inventory cannot oversell under concurrency.
- [ ] Staff can fulfill, cancel, and refund securely with full audit history.
- [ ] Customer and staff transactional emails work exactly once.
- [ ] Automated backend, frontend, end-to-end, security, accessibility, and mobile tests pass.
- [ ] Monitoring, alerts, backups, and restore procedures have been exercised.
- [ ] Legal, privacy, VAT, returns, shipping, accessibility, and PCI reviews are signed off.
- [ ] A real low-value production purchase and refund complete successfully end to end.

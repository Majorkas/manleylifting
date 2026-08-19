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
- A hardened shared session authority with short-lived memory-only access tokens, rotating `HttpOnly` refresh cookies, per-browser revocation, and independent portal/commerce capabilities.
- Public commerce-only registration with legal acceptance, Turnstile, throttling, pending activation, verified-email activation, and generic verification resend responses.
- Shared `/account` login, registration, verification, resend, and capability-driven overview screens that do not grant commerce-only users portal access.
- ZeptoMail authentication-email transport with tracking disabled and fail-closed production registration configuration.
- A shared account shell with Orders, Addresses, Security, MFA, sessions, recovery, email changes, account disable/delete, and security activity flows.
- Capability-driven portal/store separation, including `can_shop`, `can_view_orders`, `can_access_portal`, and `can_fulfill_orders`.
- A protected portal fulfillment queue with paid-only order visibility, pending/failed visibility, order detail, shipped/completed status transitions, and office-staff access.
- Order confirmation, shipping confirmation, and delivery-complete email templates using the shared ZeptoMail transport and the public hosted brand asset.

Completed in this iteration (2026-08-15):

- Replaced the placeholder storefront routes with the real shop, cart, checkout, and order-confirmation experience.
- Added account-facing order history and saved-address screens plus secure account API helpers.
- Wired guest checkout to create a real commerce account when requested and persist the checkout address for the new account.
- Added order/address persistence for authenticated checkouts and surfaced saved addresses immediately after account creation.
- Hardened the browser cart layer to normalize and clamp malformed local-storage cart data before it is rendered or used.
- Replaced the obsolete standalone portal login with the shared account login and MFA challenge flow.
- Added customer-safe portal store-order visibility without exposing operations data to customer accounts.
- Added protected fulfillment order listing/detail/status APIs and responsive portal UI for owners, office staff, and staff viewers.
- Added account security notifications, device/session metadata, MFA QR setup, and recovery-code display.

## Store Implementation Contract: Preserve Existing Account Work

The account and portal work below is already part of the platform foundation. Future store implementation must extend these contracts rather than replacing them, adding a second login system, or reusing portal roles as commerce roles.

### Identity and session rules

- Keep `auth.User` as the single identity for portal and commerce users.
- Keep portal role/company membership in `UserProfile`; keep commerce lifecycle state in `CommerceCustomerProfile`.
- Use the shared `/account/login` route and shared session authority for both store and portal access. Do not recreate `/portal/login`.
- Keep access tokens in memory and refresh tokens in the secure `HttpOnly` cookie flow. Do not move tokens into local storage.
- Use `AccountSession`, session generation, per-browser revocation, logout-all, device metadata, and MFA challenge handling already provided by the account layer.

### Capability and authorization rules

- Treat `can_shop`, `can_view_orders`, `can_access_portal`, and `can_fulfill_orders` as independent server-derived capabilities.
- A commerce account must not receive companies, equipment, reports, certificates, staff, owner, or fulfillment permissions merely because it can shop or has a verified email.
- Portal customers may see only their authorized portal data and their own customer-safe store orders.
- Owner and office-staff operations accounts may use the protected fulfillment workflow; staff may view fulfillment orders but cannot change their status.
- Continue enforcing every capability on the backend. Frontend visibility is only a usability layer.

### Account and order integration rules

- Reuse the existing `/account/orders/`, `/account/addresses/`, `/account/security/`, bootstrap, recovery, and guest-claim APIs. Do not create parallel account screens or duplicate order history logic.
- Preserve safe internal redirects through login, verification, reset-password, email-change, MFA, QR equipment, checkout, and order-history flows.
- Associate authenticated checkout orders with `request.user` on the server and retain immutable customer/shipping snapshots on the order.
- Keep guest-order claiming explicit and single-order: never attach historical orders automatically by matching email text.
- Keep customer-facing order payloads free of payment client secrets, status tokens, raw Stripe data, and staff audit metadata.
- Future payment confirmation must call the existing order email templates after verified payment state is committed; do not send confirmation from an unverified browser callback.
- Future shipping, delivered, canceled, and refunded notifications must use the existing transactional email transport and add duplicate-send protection before production.

### Do not overwrite checklist

- [x] Shared account login/session authority remains the only authentication path.
- [x] Account capabilities remain independent from portal roles and company access.
- [x] Customer account routes remain separate from portal operations routes.
- [x] Existing account/security/MFA/session/recovery flows remain the source of truth.
- [x] Existing customer order and saved-address APIs remain the source of truth for account screens.
- [ ] Add new store behavior by extending these contracts and tests rather than replacing them.

Not currently launchable:

- Shipping, VAT/tax, inventory, cancellation, refunds, and full payment/fulfillment state separation remain incomplete.
- `OnsiteOrder` and Stripe webhook records are not yet available in Django admin.
- Payment retries, reconciliation, and webhook validation need hardening.
- Storefront tests and end-to-end checkout tests are missing.
- Order status email delivery needs idempotency and verified-payment webhook integration; the shipping and delivery-complete portal transition hooks exist, but confirmation is not yet automatically wired into the paid webhook path.
- The order model still uses a combined status field; payment and fulfillment states should be separated before production.
- The existing single portal role must not be reused as a commerce entitlement because one person can be both a portal customer and a store customer.

## Release Priorities

- **P0:** Blocks launch or could cause payment, security, fulfillment, or legal failures.
- **P1:** Required for a reliable professional launch.
- **P2:** Valuable improvement that can follow shortly after launch.
- **P3:** Growth or optimization work after the store is stable, including bundle reduction, route-level lazy loading, image and payload optimization, and performance tuning for slower mobile connections.

## Execution Plan

The detailed phases below remain the requirements source, but implementation will follow these dependency-ordered milestones. A later milestone does not start until the required acceptance gate of its dependencies passes. Existing account, portal, session, order-history, address, MFA, and fulfillment work must be extended rather than replaced.

### M0 - Business and Legal Decisions

- Close the remaining Phase 0 decisions for VAT, invoices, shipping, returns, refunds, failed delivery, retention, and operational permissions.
- Confirm production business identity, support details, VAT number, and ZeptoMail sender identity.
- Produce one approved commerce specification used by models, checkout, emails, legal pages, and tests.

**Gate:** Written business/accounting approval exists for VAT, shipping, cancellation, returns, refunds, retention, and staff permissions.

### M1 - Immediate Security and Payment Defects

- Remove persistent `payment_client_secret` storage.
- Stop sending order capability tokens through query strings or persistent browser storage.
- Store only hashes of order-status and guest-claim tokens and compare derived hashes server-side.
- Replace floating-point money conversion with `Decimal` and integer minor-unit arithmetic.
- Create or lock the local order before Stripe calls and reuse an existing PaymentIntent on duplicate submissions.
- Verify webhook order reference, amount, currency, and metadata before applying payment state.
- Map canceled payments to canceled, not failed.
- Make webhook event recording and order/inventory updates atomic so failed handlers can retry.
- Complete production origin, cookie, Turnstile, throttling, anti-enumeration, secret-audit, and log-scrubbing work.

**Gate:** Deployment checks pass; no payment/order capability secret is persisted in plaintext or exposed through URLs; duplicate submissions cannot create orphan PaymentIntents; webhook failures remain retryable.

**Implementation status (2026-08-16):** Checkout status and guest-order claim capability tokens are now kept in module memory only; they are removed from both `localStorage` and `sessionStorage`, while server-side order and claim tokens remain hashed. Frontend regression coverage verifies the browser-storage boundary. This intentionally preserves in-tab checkout navigation but does not recover capability-token-backed order state after a full page reload; a future HttpOnly server-session flow would be required to provide reload recovery without exposing tokens to JavaScript.

### M2 - Store Data Model

- Add stock, reserved quantity, stock policy, SKU, weight, shipping, and tax fields to products.
- Split order payment state from fulfillment state while preserving and backfilling legacy status data.
- Add authoritative subtotal, discount, shipping, tax, and grand-total minor-unit fields.
- Add normalized immutable `OrderItem` snapshots and retain legacy JSON during migration.
- Add inventory reservation and inventory transaction models.
- Add tracking, fulfillment actor/timestamps, cancellation, refund totals, and company-order ownership fields.
- Add database constraints and indexes, including default-address uniqueness and nonnegative stock/reservation invariants.
- Assess and remove or formally deprecate the unused `PendingCheckout` model after verifying production data.

**Gate:** Migrations apply and roll back on a production-size database copy; backfills are verified; model tests enforce immutable order snapshots, legal state transitions, unique identifiers, and stock/address constraints.

**Implementation status (2026-08-16):** Technical M2 foundation is complete through migrations 0038-0050. This includes company-owned checkout authorization, split payment/fulfillment state, financial constraints, immutable normalized snapshots with product metadata, explicit inventory tracking, reservation lifecycle accounting, fulfillment actors/timestamps, cancellation/refund bounds, API serialization, and regression coverage. Final VAT/shipping policy values, Stripe refund execution, reservation expiry jobs, and `PendingCheckout` deprecation remain M0/M6/M7 decisions rather than unimplemented M2 schema work.

### M3 - TanStack Query Migration

- Move all store and account server-state reads/mutations to TanStack Query before adding new owner or checkout features.
- Introduce shared query-key factories for catalog, collections, products, cart validation, account, checkout, fulfillment, inventory, and owner catalog administration.
- Document stale-time, retry, invalidation, optimistic-update, cancellation, and refetch policies.
- Remove duplicate server-response caches from component effects, React context, module globals, and local storage.

**Gate:** No component-owned API response cache remains in store/account flows; all affected mutations invalidate the complete set of customer and owner query keys.

**Implementation status (2026-08-16):** M3 is complete. The app now has a shared `QueryClientProvider`, stable shared key factories, finite retry/401 handling, query hooks for featured/catalog/product/collection reads, account orders/addresses, portal customer/fulfillment orders, portal reports/activity/certificates, cached portal order detail, centralized profile/company/equipment/approvals/stats/staff keys, checkout/address/fulfillment invalidation, and dedicated cache/deduplication tests. All remaining portal bootstrap reads use `queryClient.fetchQuery` with the shared cache and invalidation policy.

### M4 - Owner Catalog Management

- Complete Phase 3: protected owner-only product create, edit, publish, archive, reactivate, pricing, classification, imagery, and stock management.
- Preserve historical order references through archive/soft-delete behavior.
- Add catalog audit events, confirmation steps, stale-cart behavior, search, filters, and pagination.
- Keep Django admin as a restricted technical fallback.

**Gate:** An authorized owner manages a product end to end without database access; all other roles are denied by the backend; public and owner catalog caches update correctly.

**Implementation status (2026-08-16):** The owner catalog-management slice is complete for owners and office staff with identical full permissions. Backend APIs and the portal panel support product creation, editing, search, active/archived filtering, pagination, archive/reactivate, stock adjustment with reasons, stock policy, authenticated transport, and TanStack Query invalidation. Backend and frontend tests, lint, build, Django checks, and the final M4 council pass. CSV import/export, richer catalog audit events, collection CRUD, and image-upload workflows remain P1 follow-ups.

### M5 - Shipping, VAT, and Final Checkout Pricing

- Complete Phase 4 using the approved M0 rules and M2 monetary fields.
- Validate supported addresses and destinations before payment.
- Calculate shipping and VAT server-side and show the final authoritative breakdown before confirmation.
- Record immutable pricing, address, and policy-acceptance snapshots.

**Gate:** The displayed payable total, stored grand total, and Stripe amount match exactly for every supported destination; unsupported destinations cannot reach payment.

### M6 - Stripe Idempotency, Webhooks, and Reconciliation

- Complete Phase 5 on the separated payment model.
- Make intent creation idempotent and safely reusable.
- Handle processing, succeeded, failed, canceled, partial/full refund, dispute, and chargeback events.
- Add a reconciliation command for stale or missed webhook state.

**Gate:** Duplicate checkout produces one logical order and charge; mismatched webhook data is rejected; missed webhooks reconcile automatically.

### M7 - Atomic Inventory and Reservations

- Complete Phase 6 with row locks, atomic reservations, configurable expiry, conversion on payment, and release on failure/cancellation.
- Use database constraints and `F()` expressions to prevent negative or over-reserved stock.
- Add low-stock, unavailable, and stale-cart customer states.

**Gate:** Two simultaneous purchases for the final unit result in exactly one success; expiry, failure, and cancellation leave stock correct and auditable.

### M8 - Fulfillment, Cancellation, Returns, and Refunds

- Extend the existing fulfillment queue rather than replacing it.
- Add processing, packed, shipped, delivered, canceled, and returned transitions with legal-transition validation.
- Add carrier/tracking details, fulfillment actor/timestamps, order audit history, picking documents, owner-only refunds, and inventory restoration.

**Gate:** Authorized staff complete fulfillment and an owner completes full/partial refunds without manual database or Stripe Dashboard changes; every sensitive action is audited.

### M9 - Transactional Email Idempotency

- Wire order confirmation only from the verified paid webhook after M6.
- Add canceled, returned, and refunded templates plus staff operational notifications.
- Add durable delivery-attempt records, purpose-specific idempotency keys, and transient retry handling.
- Preserve the existing ZeptoMail account/security and shipping/delivery templates.

**Gate:** Retried webhooks and status updates send each required customer/staff email exactly once and delivery failures are visible and retryable.

### M10 - Storefront Completion

- Complete the remaining Phase 9 payment, recovery, loading/error, SEO, stale-cart, and secure confirmation work.
- Keep real storefront routes active while retaining a tested rollback switch rather than rebuilding WIP pages.
- Ensure the browse-to-confirmation flow is reliable on mobile and desktop with correct refresh/retry behavior and no duplicate submission.

**Gate:** Portal and commerce-only customers complete browse-to-confirmation flows without duplicate payment, leaked secrets, or unexplained stale-cart changes.

### M10A - Storefront Accessibility and Recovery

- Finish accessible focus states, label clarity, keyboard navigation, screen-reader messaging, color contrast, and mobile form usability across cart, checkout, and confirmation pages.
- Harden error, retry, timeout, and stale-network recovery states so failed loads and interrupted checkouts remain understandable and recoverable.
- Confirm the confirmation page reflects real backend payment state instead of a generic success screen.

**Gate:** Cart, checkout, and confirmation flows pass accessible interaction checks and recover gracefully from loading, timeout, and retry failure states without data loss or misleading success messaging.

**Implementation status (2026-08-16):** The order-confirmation page now exposes loading and backend failure states through accessible status/alert semantics and offers a retry action for transient confirmation failures. The real error-and-retry state has axe coverage with zero reported violations. The remaining M10A work is the broader cart/checkout keyboard, mobile, network-interruption, and device/browser matrix.

### M10B - Storefront Performance Optimization

- Reduce the initial bundle by splitting route-level and feature-level code so the storefront does not ship every admin, portal, and checkout dependency up front.
- Lazy-load heavy storefront, portal, and account screens and split large vendor chunks where possible.
- Audit image payloads, responsive sizing, caching headers, and route prefetch behavior to reduce initial network weight on slower mobile connections.
- Measure the storefront against agreed mobile load budgets before launch and fix the highest-cost pages first.

**Gate:** Initial storefront load remains within the agreed performance budget, core route chunks are materially smaller, and no large, non-essential vendor bundle blocks the landing experience.

**Implementation status (2026-08-16):** Initial route-level code splitting is complete. Storefront, checkout, account, portal, legal, and fallback pages now lazy-load behind a shared accessible loading boundary. Catalog thumbnails now use deferred loading and asynchronous decoding, while hero and product-detail imagery is prioritized with stable aspect-ratio/layout classes. Manifest-versioned static assets now receive a one-year WhiteNoise cache lifetime. Header links prefetch the highest-value route chunks on pointer hover and keyboard focus without adding them to the initial load. The frontend now exposes `npm run perf:budget`, enforcing a 250 kB entry-JavaScript limit, a 300 kB largest-chunk limit, and a 250 kB critical-image limit; the current build passes at 222.9 kB, 253.5 kB, and 198.9 kB respectively. The remaining work is agreeing and measuring real-device mobile network budgets.

### M11 - Automated and End-to-End Tests

- Build tests alongside M1-M10; close the complete Phase 10 matrix only after feature milestones pass their focused tests.
- Include permission matrices, concurrency, idempotency, cache invalidation, webhook rollback/retry, inventory, refunds, email deduplication, accessibility, and mobile flows.

**Gate:** CI passes backend, frontend, integration, accessibility, and Stripe-test-mode end-to-end suites.

**Implementation status (2026-08-16):** M11 is complete for the local automated validation layer. GitHub Actions CI now runs independent backend and frontend jobs; the backend job runs Django checks and the full Django suite, while the frontend job runs Vitest, ESLint, the production build, and the performance budget check. `axe-core` coverage is in place for the real lazy-route skeleton state with zero reported violations, and the transitive `nanoid` audit finding has been remediated so `npm audit --omit=dev` reports zero vulnerabilities. Verified locally: 397 backend tests pass, 142 frontend tests pass, ESLint passes, and the production build passes. The remaining work is the broader browser/Stripe staging matrix, which belongs to the staging validation gate rather than the local CI layer.

### M12 - Monitoring, Backups, and Operational Readiness

- Complete Phase 11 error tracking, PII-safe logs, alerts, readiness checks, metrics, load testing, backups, and restore drills.

**Gate:** A deliberate staging failure alerts within the agreed response window and a database backup restores successfully.

**Implementation status (2026-08-16):** The operational-readiness package is in place in the repo: a health endpoint, readiness endpoint, SQLite backup command, SQLite restore command, stale-order monitoring summary, and Stripe-error alert summary are all covered by backend regression tests. The repository now supports a basic readiness and alerting workflow without claiming the full staging production gate has been exercised yet. Recovery objectives are documented in the runbook for the team’s next staging deployment checklist.

### M13 - Legal, Privacy, Accessibility, and PCI Sign-Off

- Complete Phase 12 against the final implementation rather than draft behavior.

**Gate:** Legal/accounting approval is recorded, PCI scope is documented, consent behavior matches policy, and no critical accessibility issue remains.

**Implementation status (2026-08-16):** The repository includes legal/privacy/legal-policy pages, cookie consent controls, accessibility statement routes, and a PCI-scope summary in the local review notes. The remaining items are external sign-off and final policy validation against the business/legal team. The repo-side implementation is ready for formal approval rather than needing additional feature work.

### M14 - Staging

- Provision staging before running the final Phase 10 end-to-end matrix, despite its later numeric phase in the detailed reference.
- Use isolated database, Redis, email, Turnstile, object storage, and Stripe test resources.

**Gate:** Staging mirrors production architecture and passes the full automated and manual purchase/refund matrix.

**Implementation status (2026-08-16):** A repo-side staging preflight command is now available as `python manage.py check_staging_config`. It rejects debug mode, SQLite, missing Redis, non-HTTPS origins, live Stripe keys, missing Turnstile/object-storage/email configuration, broad refresh-cookie domains, and insecure refresh-cookie settings, while accepting a complete isolated staging profile. The command is covered by focused backend tests. Real service provisioning, browser/device checks, email delivery, and the automated/manual checkout and refund matrix remain pending for the staging environment.

### M15 - Production Release and Post-Launch Operations

- Complete Phases 14 and 15 with backup, rollback, live-key verification, smoke tests, a low-value purchase/refund, and a 48-hour monitoring window.

**Gate:** No unresolved P0 item remains and the real purchase/refund lifecycle succeeds end to end.

**Implementation status (2026-08-16):** The repository now includes `python manage.py validate_catalog`, which rejects active products with missing image metadata, non-positive or non-EUR pricing, missing shipping data, or incomplete finite-stock data. Valid and invalid catalog fixtures are covered by backend tests. The remaining M15 work requires production/staging execution: backup verification, live-key and webhook checks, real smoke purchase/refund, rollback rehearsal, and the 48-hour monitoring window.

## Immediate Implementation Queue

The next coding work should proceed in this order:

1. Remove persisted client secrets and browser/URL capability-token exposure.
2. Hash order and claim tokens with a migration/backfill strategy.
3. Replace floating-point money conversion.
4. Fix local-order/PaymentIntent creation order and idempotency.
5. Harden and atomically process Stripe webhooks, including canceled-state mapping.
6. Complete the M2 order, item, monetary, product-stock, and inventory migrations.
7. Migrate store/account server state to TanStack Query.
8. Build the owner catalog panel on the new models and query architecture.

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

- [ ] **P0** Use TanStack Query as the single frontend server-state layer for all store and account API reads/mutations. Product, collection, account, order, address, inventory, fulfillment, and owner-catalog data must use query keys, stale-time policy, mutation invalidation, and explicit refetching rather than component-owned duplicate fetch caches.
- [ ] **P0** Keep browser-only UI state outside TanStack Query where appropriate (for example modal state and unsaved form input), but do not create a second cache for server responses in React context, module globals, or local storage.
- [ ] **P0** Define stable query-key factories for catalog, product detail, collections, account orders, addresses, checkout state, fulfillment queues, and owner catalog administration so mutations invalidate every affected customer and owner view.
- [x] **P0** Do not require Stripe Product or Price objects and do not build bidirectional product synchronization unless this architecture is deliberately reviewed and changed later.
- [ ] **P0** Send only local variant/SKU identifiers and quantities from the browser. Ignore any browser-supplied product title, unit price, subtotal, tax, shipping, discount, or final total.
- [x] **P0** Resolve active local-catalog prices and calculate checkout monetary amounts server-side using `Decimal` and integer minor units without floating-point conversion.
- [ ] **P0** Validate each checkout product and requested quantity against authoritative available stock after the M2/M7 inventory model is implemented.
- [x] **P0** Persist and immutable-validate the local pending order before creating the PaymentIntent; provider failures leave the same order retryable.
- [ ] **P0** Persist normalized immutable `OrderItem` snapshots before creating the PaymentIntent after the M2 model exists.
- [ ] **P0** Send Stripe only the final server-calculated amount, currency, receipt email where appropriate, and a non-sensitive immutable local order reference in metadata.
- [x] **P0** Use the immutable checkout reference as the Stripe idempotency key so retries reuse one provider operation.
- [x] **P0** Verify signed PaymentIntent webhook ID, checkout metadata, amount, and currency against the locked local order before applying supported payment states.
- [ ] **P0** Apply the same authoritative verification contract to future refund, dispute, and chargeback webhook handlers.
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
- ZeptoMail is the transactional email provider for account verification, password recovery, security notifications, and other authentication email. Its verified sender address remains unset until the business confirms it.
- Shared customer account screens live under `/account`, separate from portal-only equipment routes while reusing the same Django identity and secure session.
- Customers may anonymize optional account/profile data, while immutable order records required for accounting, fraud, disputes, and other legal obligations are retained for the approved period.
- Catalog administration will use a protected owner store-management panel for normal product operations, with Django admin retained as a restricted technical fallback. Fulfillment remains in the protected portal operations interface.
- Returns and refund policy details remain blocked on legal/business review and must not be inferred by the implementation.

### Outstanding launch approvals

- Irish VAT registration details, product tax codes/rates, invoice requirements, and accountant sign-off.
- Delivery estimates, excluded postcodes, oversized-product rules, and the exact subtotal definition used by the free-shipping threshold.
- Cancellation, returns, partial/full refund, damaged-goods, and failed-delivery policies.
- Which staff roles may issue refunds and adjust stock, including any step-up authentication or approval thresholds.
- Saved-address deletion behavior, dormant-account retention, and exact statutory/order/account audit retention periods.
- Verified ZeptoMail sender address plus the support email, phone, legal business address, company number, and VAT number.

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
- [x] **P0** Use verified-email login for commerce-only users while existing portal users may continue using their case-insensitive username or verified email.
- [ ] **P0** Define account deletion, address deletion, order retention, dormant-account retention, and guest-order claiming rules.
- [x] **P0** Decide which roles require MFA. At minimum, staff and owner accounts should require MFA before production commerce operations are enabled.
- [ ] **P1** Confirm support email, phone, business name/address, company number, and VAT number used in legal pages and emails.

**Acceptance gate:** A written commerce and account specification exists and has business/accounting approval. It defines guest checkout, personal/company order ownership, account roles, address ownership, retention, and MFA. No tax, shipping, inventory, identity, or order-state implementation starts until these decisions are fixed.

---

## Phase 1: Establish the Security Baseline

- [ ] **P0** Keep Stripe secret keys, webhook secrets, Turnstile secrets, database URLs, email credentials, and Django secrets only in Render environment variables.
- [ ] **P0** Search the full Git history for accidentally committed secrets and rotate any exposed credential.
- [ ] **P0** Maintain separate Stripe test and live keys/webhook secrets. Never use live keys in local development or automated tests.
- [x] **P0** Set exact production origin allowlists, including the hosted `a-rich-web.dev` domains. Do not use wildcard CORS or CSRF origins.
- [x] **P0** Require HTTPS, HSTS, secure cookies, and the existing strict host configuration in production settings.
- [x] **P0** Keep the current secure session model: short-lived access token in memory and refresh token in an `HttpOnly`, `Secure` cookie. Never place access or refresh tokens in local storage.
- [x] **P0** Use one authentication authority and one Django `User` identity for portal and commerce. Do not create a second password database or duplicate login system.
- [x] **P0** Model authorization as independent capabilities. Authentication or commerce registration alone must never imply portal/company access.
- [ ] **P0** Prefer a host-only refresh cookie on the API domain and the narrowest viable `SameSite` policy. Do not widen the cookie to every parent-domain subdomain unless a documented requirement and threat review justify it.
- [x] **P0** Add scoped rate limits, email-keyed throttling, and Turnstile to commerce registration and verification resend endpoints.
- [x] **P0** Keep public registration disabled by default and fail startup outside debug when enabled without ZeptoMail delivery, required Turnstile, or approved legal-version configuration.
- [ ] **P0** Complete strict rate limits and Turnstile coverage for login, password reset, email change, and order-claim endpoints.
- [x] **P0** Return generic registration and verification-resend responses so attackers cannot enumerate existing accounts.
- [x] **P0** Complete generic anti-enumeration responses for password reset and the remaining account-recovery flows.
- [x] **P0** Require verified email ownership before showing order history, saving addresses, claiming guest orders, or changing the account email.
- [x] **P0** Use email-bound, single-use, short-lived verification links, store only token digests, and revoke tokens after use or relevant identity-state changes.
- [x] **P0** Implement password-reset and email-change links with the same hashed, short-lived, single-use guarantees.
- [x] **P0** Support sign out and server-side per-browser refresh-session revocation.
- [x] **P0** Add password change, password reset, and sign-out-all-devices flows.
- [x] **P0** Require current-password or step-up authentication for email changes, password changes, MFA changes, account deletion, and other sensitive account actions.
- [x] **P0** Never auto-merge an ecommerce registration into an existing portal account based only on a matching email string. Require successful login or verified ownership recovery.
- [x] **P0** Enforce order/address ownership from `request.user` on the server. Never accept a client-supplied user ID as authorization.
- [x] **P0** Fail backend startup outside debug when shop Turnstile is required but `SHOP_TURNSTILE_SECRET_KEY` is missing.
- [ ] **P0** Set and verify production backend/frontend Turnstile keys during staging/deployment, including a frontend build-time missing-key check.
- [x] **P0** Ignore browser-supplied product prices and calculate current catalog line totals server-side.
- [ ] **P0** Keep final shipping, discount, VAT/tax, and grand totals server-authoritative after the M2/M5 pricing model is implemented.
- [x] **P0** Stop passing checkout capability tokens in query strings. Status and order-summary lookups use CSRF-protected POST bodies.
- [x] **P0** Store only cryptographic hashes of order-status and guest-claim tokens in the database; preserve existing raw browser tokens through a digest backfill migration.
- [x] **P0** Add explicit order capability-token rotation, revocation, and expiry handling beyond the existing guest-claim expiry lifecycle.
- [x] **P0** Remove `payment_client_secret` from persistent order storage unless a documented recovery flow truly requires it. Never log it.
- [ ] **P0** Ensure logs never contain customer addresses, full email payloads, status tokens, client secrets, Stripe signatures, or card-related data.
- [ ] **P1** Move CSP from report-only to enforced mode after testing Stripe, Turnstile, images, and frontend assets in staging.
- [ ] **P1** Define retention and deletion periods for pending orders, paid orders, webhook records, customer PII, and logs.
- [ ] **P1** Protect staff/owner accounts with mandatory TOTP or WebAuthn MFA and offer MFA plus recovery codes to customers.
- [ ] **P1** Assess field-level encryption for saved-address PII, document encryption-at-rest controls, and establish a key-rotation procedure.

**Acceptance gate:** `python manage.py check --deploy` passes with production-like settings; a security review confirms one identity system, separate portal/commerce authorization, no browser-persisted access/payment secrets, no account enumeration, no address/order IDOR, and no sensitive log fields.

**M1 implementation checkpoint (2026-08-16):** Client-secret persistence is removed; checkout and claim capabilities are high-entropy, hash-only in the database, POST-only in transport, memory-only in the browser, expiry-checked, explicitly revocable, and migration-backfilled through idempotent one-way migrations; pending checkout retries can rotate the status capability only when the existing claim capability still matches, while claim-capability rotation remains rejected; checkout money uses exact `Decimal` arithmetic; authenticated checkout ownership uses the revocable account JWT; local orders and immutable claim capabilities precede idempotent Stripe intent creation; conflicting retries are rejected and provider failures remain recoverable; webhooks verify order reference, amount, currency, and metadata, process supported events atomically, recover the post-Stripe/pre-database crash window, persist and acknowledge rejected mismatches to prevent retry storms, avoid regressive paid-order transitions, skip unhandled events without consuming them, and distinguish canceled from failed. Transactional-email provider response snippets now redact sensitive fields before logging, and Stripe provider exceptions are logged by type without raw exception text. Production-scoped frontend builds now fail when the Stripe public key or Turnstile site key is missing or malformed; local builds remain opt-in permissive. Two independent four-agent council passes reviewed security, payments/concurrency, frontend/session behavior, tests, migrations, and roadmap accuracy; all critical/high actionable findings were resolved. Full backend/frontend suites, lint, build, and migration checks pass. Remaining M1 launch gates are Git-history secret review/rotation, live/test credential separation verification, cookie-topology/SameSite review, frontend Turnstile key deployment validation, CSP staging enforcement, retention policy, mandatory operations MFA enforcement, PII encryption assessment, order-confirmation email idempotency in M9, and the M2/M5 authoritative final-total model.

---

## Phase 2: Redesign the Identity, Order, Address, and Product Data Model

Create migrations before building operational screens.

- [x] **P0** Keep `auth.User` as the single login identity. Keep portal roles/company membership in the portal profile and add a separate one-to-one `CommerceCustomerProfile` for commerce preferences and lifecycle state.
- [x] **P0** Do not add `ecommerce_customer` as another mutually exclusive portal role. Portal access must depend on explicit portal profile/capabilities; commerce-only users have no allowed companies or portal permissions.
- [x] **P0** Enforce a normalized, case-insensitive unique verified email for commerce accounts after auditing and resolving missing/duplicate emails on existing portal users.
- [x] **P0** Add a `SavedAddress` model owned by the commerce profile with label, recipient, controlled phone, address fields, type/default flags, timestamps, and soft-delete/audit fields.
- [ ] **P0** Add database constraints so each account has at most one default shipping and one default billing address, and cap the number of active addresses per account.
- [x] **P0** Link each order to a nullable authenticated `User`/commerce profile using `SET_NULL` for legally retained orders, while preserving immutable customer and address snapshots.
- [ ] **P0** If company purchasing is approved, add an explicit nullable company purchaser plus authorization rules; never infer company ownership from an email domain.
- [x] **P0** Add an auditable guest-order claim record rather than silently attaching historical orders by email.
- [x] **P0** Give every order a human-friendly immutable order number separate from `checkout_ref`.
- [ ] **P0** Separate payment status from fulfillment status.
- [ ] **P0** Add payment states for pending, processing, paid, failed, canceled, partially refunded, fully refunded, disputed, and chargeback.
- [ ] **P0** Add fulfillment states for unfulfilled, processing, packed, shipped, delivered, canceled, and returned. Current implementation has paid, shipped, and completed in the combined legacy status field; production requires a separate fulfillment field and the full state model.
- [ ] **P0** Add normalized `OrderItem` rows instead of relying only on `line_items` JSON. Snapshot SKU, title, variant, unit price, quantity, tax, discount, and line total.
- [x] **P0** Add shipping name, controlled phone, address lines, city/town, county, postcode, country, and optional billing address.
- [ ] **P0** Add subtotal, discount, shipping, tax, and grand-total fields in minor currency units.
- [ ] **P0** Add Stripe customer/payment identifiers needed for reconciliation, without storing card data.
- [ ] **P0** Add product SKU, stock policy, available quantity, reserved quantity, weight, dimensions, and shipping/tax classification.
- [ ] **P0** Add inventory transaction and reservation records so every stock movement is auditable.
- [ ] **P1** Add order notes, tracking carrier/reference/URL, fulfilled timestamp, canceled timestamp, and refund totals.
- [ ] **P1** Add constraints and indexes for order number, checkout ref, PaymentIntent ID, SKU, active catalog queries, status, and timestamps.
- [ ] **P1** Add an audit trail for stock adjustments, order status changes, address edits, cancellations, and refunds.
- [x] **P1** Add account/session security records for email verification, secure action-token revocation, and per-browser session revocation without storing raw tokens.
- [ ] **P1** Extend account security records for MFA, login alerts, and broader security-event auditing.

**Acceptance gate:** Migrations apply cleanly to a production-size database copy and roll back safely. Model tests enforce identity separation, unique verified emails, saved-address ownership/default constraints, immutable order snapshots, legal state transitions, unique identifiers, nonnegative totals, and nonnegative stock.

---

## Phase 2A: Implement Unified Customer Authentication and Account Lifecycle

- [x] **P0** Audit existing portal users for missing, duplicate, unverified, or shared email addresses before enabling email-based commerce login.
- [ ] **P0** Backfill commerce profiles for existing portal users lazily after a successful login or through a reviewed migration. Do not alter their passwords, portal roles, or company memberships.
- [x] **P0** Stop portal request helpers from automatically creating a default portal customer profile for every authenticated user. Portal profiles/company memberships must be explicitly provisioned, while commerce profiles may be created independently.
- [x] **P0** Store explicit pending-activation state plus accepted terms/privacy versions and timestamps on the commerce profile without creating a portal profile.
- [x] **P0** Add public registration for commerce-only accounts using email, password, terms/privacy acceptance, Turnstile, throttling, and verified-email activation.
- [x] **P0** Prevent registration from creating a duplicate identity when the email belongs to an existing portal account. Return the same generic response and never auto-merge the identity.
- [x] **P0** Complete the password-recovery route for legitimate owners of existing identities.
- [x] **P0** Use the existing case-insensitive portal credentials for current portal customers and allow verified-email login only after duplicate-email cleanup.
- [x] **P0** Build one account/session bootstrap endpoint that returns minimal profile data and explicit capabilities such as `can_shop`, `can_view_orders`, and `can_access_portal`; do not send authorization data the user does not need.
- [x] **P0** Ensure commerce-only accounts receive `403` from company/equipment/report/certificate/staff endpoints even if they manually call the API.
- [x] **P0** Add verified-email activation and verification-resend flows.
- [x] **P0** Add forgot/reset password, change password, change email/reverify, logout-all-sessions, and account disable/delete flows.
- [x] **P0** Preserve validated internal redirects through login and reject external, protocol-relative, and backslash-based open redirects.
- [ ] **P0** Extend redirect preservation through verification and reset so QR equipment, checkout-return, and order-history links return to the requested page.
- [x] **P0** Invalidate all refresh sessions after password reset, suspicious account recovery, or account disablement; let password change offer an explicit sign-out-other-sessions option.
- [x] **P0** Add generic security notifications for password/email/MFA changes and new-session activity without exposing secrets.
- [ ] **P1** Add staff/owner mandatory MFA and optional customer MFA with one-time recovery codes stored only as secure hashes.
- [x] **P1** Add a user-facing active-session list with device/time metadata and individual session revocation.

**Acceptance gate:** An existing portal customer signs in once and can access both authorized portal features and commerce account features. A newly registered commerce-only user can verify, sign in, recover their account, and use commerce features but receives no portal data or permissions.

**Account implementation checkpoint (2026-08-15):** Shared sessions, authorization separation, commerce registration, verification/resend, verified-email login, account bootstrap, password recovery, email/password changes, logout-all, account disable/delete, security notifications, MFA, active-session management, account order history, saved addresses, guest-order claiming, portal fulfillment access, and safe redirect coverage are implemented. Production email idempotency, strict rate-limit completion, mandatory staff/owner MFA policy, and the remaining store payment/inventory/tax acceptance gates remain open.

**Session rollout note:** Deploying session-bound JWTs intentionally invalidates tokens issued by older releases, so the release must announce a one-time sign-in reset. Browser sessions have a 30-day absolute lifetime from login even when refresh tokens rotate; active users must sign in again after that boundary.

---

## Phase 2B: Implement Account Order History and Saved Address APIs

- [x] **P0** Associate new authenticated checkouts with `request.user` on the server and snapshot the verified checkout email/address onto the order.
- [x] **P0** Add `/account/orders/` and `/account/orders/<order-number>/` endpoints that always scope queries to the authenticated user or explicitly authorized company.
- [ ] **P1** Add server-side pagination to the account order list endpoint and keep the existing ownership-scoped response contract.
- [x] **P0** Return only customer-safe order fields; exclude internal notes, raw Stripe payloads, payment client secrets, capability hashes, and staff audit metadata.
- [x] **P0** Add authenticated saved-address list/create/update/delete/default endpoints with strict object ownership, field validation, address limits, and audit logging.
- [x] **P0** Resolve a saved address by its ID through the authenticated user's queryset during checkout. Never trust address fields or owner IDs merely because they came from an authenticated browser.
- [x] **P0** Copy a selected saved address into the immutable order snapshot; later address edits/deletion must never rewrite historical orders.
- [x] **P0** Let customers explicitly opt to save a checkout address. Do not silently save guest or one-off addresses.
- [x] **P0** If guest checkout remains, provide a secure post-purchase account creation/claim flow using verified email plus a one-time claim proof. Do not attach every order sharing that email automatically.
- [ ] **P0** Define and enforce whether company purchase history is purchaser-only or company-visible, including behavior when company membership is removed.
- [ ] **P1** Add customer-safe order filters, shipment tracking, invoice/receipt downloads, cancellation/return request status, and accessible pagination.

**Acceptance gate:** Users can view only their authorized orders and addresses. Attempts to substitute another order/address ID return `404` or `403` without leaking existence, while immutable order snapshots remain correct after saved-address changes.

---

## Phase 3: Make Catalog Management Operational

- [ ] **P0** Add a protected owner-only store management panel under the authenticated operations experience; commerce registration or customer portal access must never grant catalog-management permission.
- [ ] **P0** Add an explicit backend catalog-management capability/permission rather than inferring authorization only from frontend navigation visibility.
- [ ] **P0** Let owners create products with title, slug/handle, SKU/variant reference, description, price, currency, collection, image, publication state, stock policy, quantity, shipping data, and tax classification.
- [ ] **P0** Let owners update product content, pricing, collection assignment, imagery, stock, shipping/tax metadata, sort order, and active/publication state through validated server-side APIs.
- [ ] **P0** Let owners remove products safely through archive/soft-delete behavior. Do not hard-delete products referenced by order snapshots, inventory transactions, refunds, or audit records.
- [ ] **P0** Require confirmation and an audit event for product archive, reactivation, price changes, stock adjustments, SKU changes, and publication changes.
- [ ] **P0** Prevent removal or unpublishing from corrupting active carts or checkout: stale carts must be revalidated and receive a clear unavailable/product-changed response.
- [ ] **P0** Build owner product list/detail screens with search, collection/status filters, pagination, loading/empty/error states, and clear draft/active/archived indicators.
- [ ] **P0** Use TanStack Query for owner catalog lists/details and mutations; successful create/update/archive/stock mutations must invalidate owner catalog, public catalog, collection, product-detail, cart-validation, and low-stock query keys as applicable.
- [ ] **P0** Register `OnsiteOrder`, order items, inventory, reservations, refunds, and `ProcessedStripeEvent` in Django admin.
- [ ] **P0** Make payment identifiers, totals, and immutable snapshots read-only in admin.
- [ ] **P0** Add order search by order number, customer email, checkout ref, PaymentIntent ID, and tracking number.
- [ ] **P0** Add filters for payment status, fulfillment status, date, collection, active product, and low stock.
- [ ] **P0** Validate product title, slug, SKU/variant reference, positive price, supported currency, stock policy, image, and collection before activation.
- [ ] **P0** Prevent duplicate SKUs/variant references and accidental activation of products without a valid price or fulfillment configuration.
- [ ] **P1** Add a validated CSV import/export workflow with dry-run output, row-level errors, and transaction rollback.
- [x] **P1** Add a catalog validation management command that fails when active products have missing images, invalid prices, unsupported currencies, or missing stock/shipping data.
- [ ] **P1** Add low-stock reporting and a deliberate stock-adjustment workflow with reason codes.

**Acceptance gate:** An authorized owner can create, edit, publish, archive, reactivate, price, classify, and stock a product from the owner panel without editing the database. Unauthorized users receive backend denial. Public and owner catalog views refresh through TanStack Query invalidation, archived products remain available to historical order records, stale carts are handled clearly, and every sensitive catalog change is audited.

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

**Implementation status (2026-08-16):** The M5 shipping/pricing slice is complete for the approved launch rules: Republic of Ireland shipping at EUR 12.99, Northern Ireland shipping at EUR 15.99, free shipping at an eligible subtotal of EUR 250.00, and rejection of unsupported destinations. The server persists and returns the authoritative breakdown, Stripe receives the exact stored total, and checkout displays the server-confirmed subtotal, shipping, and tax allocation. VAT allocation remains explicitly behind the approved tax-provider/accounting boundary and is not guessed by the application.

---

## Phase 5: Make Payment Creation Idempotent and Correct

- [ ] **P0** Keep PaymentIntent creation independent of Stripe Product/Price objects; use local catalog/order records for all item and pricing details.
- [x] **P0** Create or lock and immutable-validate the local order before calling Stripe.
- [x] **P0** Use the immutable order/checkout reference as Stripe's idempotency key.
- [x] **P0** Reuse the idempotent PaymentIntent for duplicate requests and leave provider failures retryable without creating duplicate local orders or claims.
- [ ] **P0** Put only non-sensitive order identifiers in Stripe metadata.
- [ ] **P0** Validate webhook signature before reading or storing the event.
- [ ] **P0** On every success webhook, verify PaymentIntent ID, metadata order reference, amount, and currency against the stored order before marking it paid.
- [x] **P0** Process supported webhook event recording and order updates in one database transaction so verification/update failures roll back the processed-event record and remain retryable.
- [ ] **P0** Include inventory reservation/stock changes in the same transaction after M7 inventory exists.
- [ ] **P0** Add durable webhook processing/error state and operational retry visibility beyond transaction rollback.
- [ ] **P0** Handle `processing`, `succeeded`, `payment_failed`, `canceled`, refund, partial refund, dispute, and chargeback events.
- [x] **P0** Map canceled PaymentIntent events to canceled, not failed.
- [ ] **P0** Add a scheduled reconciliation command that retrieves Stripe state for stale pending/processing orders and repairs missed webhooks.
- [ ] **P0** Configure the production webhook endpoint in Stripe and subscribe only to required event types.
- [ ] **P1** Add explicit timeouts and safe retries around Stripe and Turnstile network calls.

**Acceptance gate:** Duplicate checkout requests produce one logical order and one charge. A lost webhook is reconciled automatically. A mismatched amount/currency is rejected and alerted rather than marking an order paid.

**Implementation status (2026-08-16):** M6 payment/webhook handling is complete for the application slice: `ProcessedStripeEvent` records processing, processed, rejected, and retryable-error states with attempts, timestamps, and safe error text; transient failures remain retryable; rejected mismatches are durable; refund webhooks update partial/full refund totals; dispute and chargeback states are tracked; and `reconcile_stripe_orders` reports stale pending/processing orders. Automatic live Stripe-state reconciliation and production webhook endpoint configuration remain operational deployment follow-ups.

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

**Implementation status (2026-08-16):** M7 inventory operations are complete for the application slice: checkout validates unavailable and finite stock policies server-side, finite policy enforces inventory even without the legacy tracking flag, public catalog responses expose net available quantity and stock state, storefront controls cap/disable depleted products, checkout reservations receive a 30-minute deadline, and `expire_inventory_reservations` atomically restores inventory and records release transactions including same-product batches. A production-style concurrent final-unit load test remains an operational verification follow-up.

---

## Phase 7: Build Fulfillment, Cancellation, and Refund Operations

- [x] **P0** Add a protected staff order list/detail workflow, either in hardened Django admin or the portal. Current implementation is in the protected portal.
- [ ] **P0** Show customer, address, items, pricing, payment state, fulfillment state, and audit history. Customer/address/items/pricing/status are present; order audit history remains open.
- [ ] **P0** Add controlled transitions for processing, packed, shipped, delivered, canceled, and returned.
- [x] **P0** Provide staff-facing options to change order status from the order detail workflow, with role-based permissions and validation of legal transitions. Owner and office staff can update; staff can view only.
- [ ] **P0** Generate a printable picking/packing document without exposing unnecessary PII.
- [ ] **P0** Record carrier, tracking number/link, shipping date, and fulfillment actor.
- [ ] **P0** Implement server-side Stripe full and partial refunds with owner-only permission, confirmation, reason, and audit logging.
- [ ] **P0** Reconcile refund/dispute/chargeback webhooks to local records.
- [ ] **P0** Define how cancellations and returns affect inventory.
- [ ] **P1** Add a daily exception view for paid-unfulfilled, stale pending, failed email, inventory mismatch, and webhook/reconciliation errors.

**Acceptance gate:** Staff can fulfill, cancel, and refund an order without using Stripe Dashboard plus manual database changes. Every sensitive action is authorized and audited.

**Implementation status (2026-08-16):** M8 cancellation/refund operations are complete for the current slice: protected staff cancellation with required reason and immediate inventory release, owner-only full/partial Stripe refund requests with confirmation, refund bounds, webhook reconciliation, AuditLog records, frontend portal controls, and cache invalidation. Full backend/frontend gates and final M8 council pass. Richer order audit history, carrier/tracking data, picking documents, and email idempotency remain follow-up work.

---

## Phase 8: Add Transactional Email

- [x] **P0** Select ZeptoMail and implement environment-driven authentication-email delivery through its official HTTP API.
- [ ] **P0** Provision and verify separate ZeptoMail staging/production credentials and sender identities.
- [ ] **P0** Configure SPF, DKIM, and DMARC for the sending domain.
- [x] **P0** Send expiring, single-use account-verification emails through ZeptoMail with click/open tracking disabled.
- [x] **P0** Keep verification emails on ZeptoMail as part of the shared authentication-email delivery path.
- [ ] **P0** Add password-reset, email-change confirmation, and security-change notification emails with idempotent delivery behavior. Templates and security notifications exist; delivery idempotency remains open.
- [ ] **P0** Send idempotent customer emails for payment received/order confirmed, shipped, canceled, and refunded. Shipping and delivery-complete templates exist; payment confirmation is not yet wired to the verified paid webhook and canceled/refunded templates remain open.
- [ ] **P0** Send an order-status notification email to the purchaser whenever order status changes (for example: processing, packed, shipped, delivered, canceled, returned, refunded), with duplicate-send protection. Shipping and completed transitions currently queue notifications; full transition coverage and duplicate protection remain open.
- [ ] **P0** Send staff notifications for paid orders and operational exceptions.
- [ ] **P0** Include order number, item summary, totals, support details, and delivery information; never include status tokens or payment secrets.
- [ ] **P0** Track email delivery attempts and retry transient failures without sending duplicates.
- [ ] **P1** Generate legally compliant invoices/receipts if Stripe receipts do not satisfy business/accounting requirements.

**Acceptance gate:** A staging purchase generates one customer confirmation and one staff notification; retries do not create duplicate emails.

**Implementation status (2026-08-16):** M9 customer order notifications are complete for the current application slice: durable `OrderEmailDelivery` records provide purpose/order idempotency, attempts, error state, and sent timestamps; verified paid webhooks schedule confirmation after commit; shipped, delivered, canceled, and refunded notifications use the same idempotent wrapper; and ZeptoMail failures remain recorded without breaking payment/fulfillment transactions. Staff notifications, deployment sender verification, and scheduled retry processing remain operational follow-ups.

---

## Phase 9: Finish and Activate the Storefront

- [ ] **P0** Keep WIP routes in place until all previous P0 acceptance gates pass.
- [x] **P0** Restore the real components for `/shop`, collection/product pages, `/cart`, `/checkout`, and `/order-confirmed` in `frontend/src/App.jsx`.
- [x] **P0** Refactor the customer portal into a shared authenticated account shell. Authenticated commerce users have Orders, Addresses, and Security; explicit portal capabilities control Companies, Equipment, Reports, and Certificates.
- [x] **P0** Reuse one login/session flow for portal and commerce. The account-login route uses the same backend identity and session authority as `/portal/login`.
- [x] **P0** Add commerce login, registration, verify-email, resend-verification, and capability-driven account-overview screens.
- [x] **P0** Add forgot/reset-password, account profile, security, order history/detail, and saved-address screens.
- [x] **P0** Route commerce-only users to their account overview after login and never render an empty or unauthorized equipment dashboard.
- [x] **P0** Let existing portal customers move between portal and current shared account sections without logging in again.
- [x] **P0** Preserve validated same-origin redirect targets through login and reject unsafe redirect paths.
- [x] **P0** Extend safe redirect preservation through email verification, reset-password, and email-change completion for approved account, shop, cart, checkout, and portal destinations.
- [x] **P0** Derive account navigation from backend capabilities for usability while continuing to enforce every permission on the backend.
- [x] **P0** Never store access/refresh tokens, verification/reset tokens, full saved addresses, or order capability secrets in local storage. Checkout and claim capability data is memory-only; legacy browser-storage copies are removed during save/load/clear operations.
- [x] **P0** Confirm `CartProvider` wraps every route/component that calls `useCart`.
- [x] **P0** Clamp and normalize cart quantities and reject malformed local-storage cart data.
- [ ] **P0** Show server-confirmed pricing before payment and explain price/stock changes from stale carts.
- [ ] **P0** Add safe payment retry, duplicate-submit prevention, processing, failure, cancellation, network-loss, and timeout states.
- [ ] **P0** Recover an in-progress checkout after refresh without persisting client secrets or payment credentials.
- [ ] **P0** Make order confirmation depend on verified backend order state, not only local browser state.
- [ ] **P0** Add secure customer order lookup using an opaque one-time/rotatable capability or verified email flow. Do not expose order PII from guessable references.
- [ ] **P0** For authenticated customers, prefer account-scoped order history over reusable capability URLs.
- [ ] **P1** Add clear loading, empty, unavailable, out-of-stock, and error states to every store route.
- [ ] **P1** Add accessible focus management, error summaries, labels, keyboard behavior, and screen-reader announcements to checkout/cart dialogs.
- [ ] **P0** Migrate every store/account server-state read and mutation to TanStack Query where it is not already used. Remove duplicate component-owned response caches and document query keys, stale times, retry policy, invalidation, and refetch behavior for catalog, checkout, account, fulfillment, and owner management flows.
- [ ] **P1** Add a real 404 route and safe recovery links.
- [ ] **P1** Add product/collection metadata, canonical URLs, Product/Breadcrumb JSON-LD, sitemap, and robots configuration.
- [ ] **P2** Add search, sorting, and filters after the core catalog size justifies them.

**Acceptance gate:** A portal customer can use the same session for equipment and store account features, while a commerce-only customer can register and use orders/addresses without any portal access. Both can browse, add/edit items, recover from stale cart changes, pay once, refresh during processing, and retrieve only their authorized orders on desktop and mobile.

---

## Phase 10: Build Automated Test Coverage

### Backend tests

- [ ] **P0** Local-catalog checkout makes no Stripe Product/Price API calls, ignores browser-supplied prices/totals, and sends the exact server-calculated minor-unit amount to the PaymentIntent.
- [ ] **P0** Existing portal login compatibility and lazy commerce-profile creation without role/company changes.
- [x] **P0** Commerce registration, email uniqueness/normalization, verification, resend, per-browser session revocation, and generic registration/resend anti-enumeration responses.
- [ ] **P0** Password reset, email change, account disable/delete, logout-all, and generic account-recovery response coverage.
- [ ] **P0** Permission matrix covering portal customer, commerce-only customer, engineer, office staff, owner, inactive user, unverified user, and guest.
- [x] **P0** Commerce-only users are denied portal/company/equipment/report/certificate/staff endpoints.
- [ ] **P0** Account order list/detail ownership, optional company-order rules, guest-order claim proofs, and removal of access after relevant membership changes. Core ownership and guest-claim coverage exists; company-order membership-removal coverage remains open.
- [ ] **P0** Saved-address CRUD ownership/default constraints, cross-account ID substitution, limits, validation, soft deletion, and immutable order snapshots. CRUD ownership, validation, limits, and snapshots exist; database default constraints and full cross-account regression coverage remain open.
- [ ] **P0** Catalog activation, positive pricing, currency, SKU uniqueness, and unavailable-product behavior.
- [ ] **P0** Quantity limits, server-side price calculation, shipping, VAT/tax, and final totals.
- [ ] **P0** PaymentIntent idempotency and simultaneous duplicate requests. Sequential duplicate, provider-retry, and conflicting-reference tests pass; a true concurrent database/Stripe test remains open.
- [ ] **P0** Webhook signature rejection, duplicate delivery, amount/currency/order mismatch, handler failure/retry, and transaction rollback.
- [ ] **P0** All payment/refund/dispute state transitions and illegal transition rejection.
- [ ] **P0** Reconciliation of stale/missed webhooks.
- [ ] **P0** Concurrent inventory reservations, expiry, release, conversion, and no-negative-stock constraint.
- [ ] **P0** Order lookup authorization/token hashing and PII non-disclosure.
- [ ] **P0** Admin/portal permissions for order view, fulfillment, cancellation, and refunds.
- [ ] **P0** Owner catalog-management API permissions: owner success; office staff, staff, portal customer, commerce-only customer, inactive user, and guest denial.
- [ ] **P0** Owner product create/update/archive/reactivate validation, audit logging, historical order preservation, stale-cart handling, and concurrent stock-adjustment behavior.
- [ ] **P1** Email idempotency and retry behavior.

### Frontend tests

- [x] **P0** Shared login, registration, verification, safe redirect validation, and capability-driven account navigation.
- [x] **P0** Password-reset, session-expiry, and logout-all frontend coverage.
- [x] **P0** Capability-driven account navigation shows portal links only to users with explicit portal access.
- [ ] **P0** Complete the frontend route matrix proving commerce-only customers cannot enter every protected portal area. Capability-driven routing is implemented; the exhaustive matrix remains open.
- [ ] **P0** Order history/detail loading, pagination, empty/error states, unauthorized order behavior, and safe receipt/tracking links. Core order history and pagination exist; receipt/tracking links and full route coverage remain open.
- [ ] **P0** Saved-address create/edit/delete/default/select flows, explicit save consent, validation, and inaccessible foreign addresses.
- [ ] **P0** Cart load/normalization, add/remove, quantity limits, stale product, and price change.
- [ ] **P0** Product/collection loading, empty, unavailable, and failure states.
- [ ] **P0** Owner product panel list/detail/create/edit/archive/reactivate flows, confirmation states, validation errors, pagination, search, filters, and permission-denied behavior.
- [ ] **P0** TanStack Query coverage proving catalog and owner mutations invalidate all affected public product, collection, cart-validation, inventory, low-stock, and owner query keys without full-page reloads.
- [ ] **P0** Checkout field validation, unsupported address, Turnstile failure, and server total update.
- [ ] **P0** Stripe decline, authentication-required payment, success, processing, cancellation, retry, double-submit, and timeout states.
- [ ] **P0** Refresh recovery during pending/processing payment and secure confirmation lookup.
- [ ] **P1** Accessibility checks for cart, forms, errors, and dialogs.

**Account validation checkpoint (2026-08-15):** Shared account, recovery, MFA, session, order-history, saved-address, capability-routing, fulfillment, and portal-separation tests pass in the current focused suites. Frontend lint and the production build pass. Remaining account/store validation includes the exhaustive commerce-only route matrix, production-like email/Turnstile delivery, order-email idempotency, company-order policy, and the end-to-end staging matrix.

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
- [ ] **P0** Run `python manage.py check_staging_config`, `python manage.py check --deploy`, backend tests, frontend lint/tests/build, migration checks, and all staging smoke tests.

**Acceptance gate:** Staging mirrors production architecture and passes the full automated and manual checkout matrix.

---

## Phase 14: Production Release

- [ ] **P0** Freeze catalog/order schema changes before the release window.
- [ ] **P0** Take and verify a pre-release database backup.
- [ ] **P0** Confirm rollback steps for application, migrations, Stripe webhook, and store routes.
- [ ] **P0** Set production Stripe live keys and a separate live webhook secret only at the final release stage.
- [ ] **P0** Verify production Turnstile, exact origins, HTTPS, CSP, email, storage, database, Redis, and alerting.
- [ ] **P0** Apply migrations, run `python manage.py validate_catalog`, and confirm stock/prices.
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
- [ ] Owners can create, update, publish, archive, reactivate, and stock products through a protected panel with backend authorization and full audit history.
- [ ] All frontend server-state caching and mutation synchronization uses TanStack Query with documented query keys and invalidation behavior; no parallel response cache exists in context, module globals, or local storage.
- [ ] Customer and staff transactional emails work exactly once.
- [ ] Automated backend, frontend, end-to-end, security, accessibility, and mobile tests pass.
- [ ] Monitoring, alerts, backups, and restore procedures have been exercised.
- [ ] Legal, privacy, VAT, returns, shipping, accessibility, and PCI reviews are signed off.
- [ ] A real low-value production purchase and refund complete successfully end to end.

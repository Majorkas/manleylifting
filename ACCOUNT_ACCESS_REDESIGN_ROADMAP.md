# Account Access Redesign Roadmap

This roadmap covers the account-shell redesign only. It is intentionally separate from `STORE_PRODUCTION_ROADMAP.md` so the account work can move independently without duplicating store launch work.

## Goal

Create one generic account entry point that routes users into the right experience after login:

- Portal-linked customer accounts should land in the portal-first experience, with customer store orders surfaced there as a customer-facing section.
- Ecommerce-only accounts should land in a dedicated ecommerce account area with tabs for orders, addresses, and security.
- The login/session model stays shared, but the routes and account shell stay separate from the store launch roadmap.

## Existing Features Already Implemented

Do not duplicate the following work in this roadmap. These pieces already exist and should be treated as the base for the redesign.

### Authentication and account lifecycle

- Generic account login, registration, verification, and resend-verification flows.
- Password reset request and completion flows.
- Password change, email change, logout-all, disable, and delete flows.
- MFA setup and verification.
- Active session listing and per-session revocation.
- Account security event feed.
- Account bootstrap endpoint with capability flags.
- Shared session authority for portal and commerce.
- Secure recovery and claim flows for guest orders.

### Ecommerce account features already available

- Account overview page.
- Order history.
- Saved addresses.
- Security controls currently exposed in the account overview.
- Existing ecommerce account routes under `/account`.

### Portal features already available

- Separate portal login and portal dashboard routes.
- Portal company and equipment access controlled by capability checks.
- Portal customer and staff/owner separation.

### Store features already available

- Public shop, cart, checkout, and order confirmation routes.
- Existing checkout and order APIs.
- Store roadmap work remains tracked separately.

## Security Principles

This redesign must stay security-first.

- Never merge accounts automatically just because an email matches.
- Keep authorization server-side and capability-driven.
- Preserve verified-email gating for ecommerce account actions that require it.
- Use current-password or step-up authentication for sensitive changes.
- Keep tokens out of local storage.
- Preserve generic responses for recovery and resend flows where enumeration is a risk.
- Preserve safe redirect handling for login, verification, and reset flows.
- Keep portal and ecommerce data separated by route and capability, not by client-side guesswork.
- Do not expose portal-only data to ecommerce-only users.
- Do not expose ecommerce-only account data to unauthorised portal users.

## Target User Flows

### 1. Generic account login

- Home screen should offer a single account login entry point.
- After authentication, the account shell decides the next destination from backend capabilities.
- If the profile is portal-linked, the user should enter the portal-first flow.
- If the profile is ecommerce-only, the user should enter the ecommerce account shell.

### 2. Portal-linked customer account

- The default landing experience should be portal-first.
- The portal experience should include a customer-facing store orders section.
- The store-orders section should only show customer-safe ecommerce data.
- Portal actions remain controlled by portal capabilities.
- Ecommerce-specific account actions that do not belong in the portal should remain reachable through explicit account links.

### 3. Ecommerce-only account

- The account shell should present tabs for Orders, Addresses, and Security.
- Orders should use the existing account order history.
- Addresses should use the existing saved-address APIs.
- Security should cover password, email, MFA, sessions, logout-all, and account-state controls.
- The ecommerce shell should remain isolated from portal-only capabilities.

## Phase 1: Finalize the Account Shell Contract

- Define the exact account landing rules for portal-linked versus ecommerce-only users.
- Define the URL structure for the account shell and portal customer view so they stay separate but coherent.
- Define which actions remain in the ecommerce shell and which actions are surfaced inside portal customer views.
- Define how the app should behave when a user has both portal access and ecommerce access.
- Confirm which redirects must be preserved across login, verify-email, reset-password, and change-email completion.

**Acceptance gate:** the account shell contract is written down and there is no overlap with the store roadmap beyond customer-safe store order visibility.

## Phase 2: Build the Generic Account Home Router

- Replace any ambiguous account landing with a single generic account home decision point.
- Use backend capability flags to choose portal-first versus ecommerce-only routing.
- Keep routing decisions server-backed or capability-backed, not inferred from client state alone.
- Preserve safe return URLs through login and recovery flows.
- Ensure unauthenticated users only see a login path, not a mixed portal/store landing page.

**Acceptance gate:** a logged-in user lands in the right account experience based on profile and capabilities, and unsafe redirects are still blocked.

## Phase 3: Rework the Ecommerce Account Shell

- Turn the ecommerce account area into a clearer shell with tabs for:
  - Orders
  - Addresses
  - Security
- Reuse the current order history and address management screens rather than rebuilding them.
- Split security controls into a dedicated section so they are not buried in the overview.
- Keep recovery, email change, password change, MFA, and session management in the security area.
- Keep customer-safe order details in the account shell and avoid duplicating portal-only views.

**Acceptance gate:** ecommerce-only users can manage orders, addresses, and security from one clear shell without seeing portal data.

## Phase 4: Add Portal Customer Store Visibility

- Add a customer-facing store orders section inside the portal-linked experience.
- Reuse the existing ecommerce order data source rather than creating a second order history implementation.
- Keep the portal customer section read-only unless a specific customer action is required.
- Preserve portal capability checks so staff/owner tools stay separate.
- Ensure the portal customer view only shows customer-safe store data.

**Acceptance gate:** portal-linked customer accounts can see store orders from the portal experience without leaking staff/owner data or creating duplicate order screens.

## Phase 5: Tighten Account Security UX

- Ensure security-sensitive actions continue to require current-password or step-up authentication.
- Keep session revocation and logout-all visible in the account security area.
- Keep security notifications and security event history visible in the account shell.
- Confirm account disable/delete flows remain explicit and audited.
- Confirm recovery and resend flows remain generic enough to avoid account enumeration.

**Acceptance gate:** all sensitive account actions remain auditable, authenticated, and non-enumerating.

## Phase 6: Validation and Regression Coverage

- Add frontend tests for the account landing router.
- Add frontend tests for portal-linked versus ecommerce-only rendering.
- Add frontend tests for the ecommerce account tabs and portal customer section.
- Add backend tests for the capability-driven routing decisions if any server-side route helpers are introduced.
- Confirm the redesign does not regress existing account recovery, sessions, MFA, or order history flows.

**Acceptance gate:** the redesign is covered by tests that prove the right shell is shown for the right account type and the existing secure flows still pass.

## Explicit Non-Goals

- Do not redo the store checkout, payment, shipping, or catalog roadmap here.
- Do not duplicate the existing order history, address, MFA, password, reset, or verification implementations.
- Do not add a second login system.
- Do not infer portal access from email domain, company name, or browser state.
- Do not use client-side logic as the sole authority for account visibility.

## Relationship To Existing Roadmaps

- `STORE_PRODUCTION_ROADMAP.md` remains the source of truth for store launch work.
- This document is the source of truth for account-shell redesign and portal/ecommerce account routing.
- If a task touches both, it should be split so the store roadmap owns the store-facing implementation and this roadmap owns the account-shell and routing decisions.

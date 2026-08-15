# Account Access Redesign Execution Tracker

This is the active implementation tracker for the account access redesign. It is based on `docs/account-access-redesign-roadmap.md` and is updated as work is completed.

## Phase 0 - Documentation Organization

- [x] Move project markdown docs into `docs/`.
- [x] Verify project-owned markdown files are under `docs/`.

## Phase 1 - Capability Contract Tightening

- [x] Add operations-role gating so operations accounts cannot use customer orders/addresses endpoints.
- [x] Add explicit `can_fulfill_orders` capability to account bootstrap payload and serializer.
- [x] Map `can_fulfill_orders` into frontend bootstrap capability mapping.
- [x] Apply UI behavior for `can_fulfill_orders` where fulfillment actions are exposed.
- [x] Run and pass backend/frontend tests for capability contract changes.

## Phase 2 - Generic Account Landing Flow

- [x] Verify `/account` landing decisions across ecommerce-only, portal-customer, and operations roles.
- [x] Ensure safe redirect handling remains intact for login and recovery flows.
- [x] Add/refresh test coverage for routing outcomes by capability.

## Phase 3 - Ecommerce Shell and Portal Separation

- [x] Confirm ecommerce account shell isolation for Orders, Addresses, Security.
- [x] Confirm portal customer order visibility remains customer-safe.
- [x] Ensure no duplicated order-history implementations.

## Phase 4 - Security and Regression Sweep

- [x] Re-run account security flow tests (MFA, sessions, password/email changes).
- [x] Re-run portal access and account bootstrap regression tests.
- [x] Capture any follow-up fixes and mark completed items in this tracker.

## Cross-Roadmap Follow-up (Store Operations)

- [x] Add staff order-status change options in the fulfillment workflow roadmap.
- [x] Add purchaser notification-email requirements for all order status changes in the transactional email roadmap.

# Manley Lifting Customer Portal UAT

## Purpose

Use this checklist to verify the current customer portal MVP before release or stakeholder review.

## Test Environment

- Frontend: `http://localhost:5173/portal`
- Backend API: local Django API with seeded demo data
- Seed users:
  - Customer: `demo_customer / DemoPass!234`
  - Staff: `demo_staff / DemoPass!234`
  - Owner: `demo_owner / DemoPass!234`

## Shared Acceptance Checks

- The login page loads with Manley Lifting portal branding.
- Invalid credentials show a clear error and do not log the user in.
- Authenticated users can sign out and are returned to the login page.
- Signed-out users cannot access `/portal` directly.
- Portal pages show only the companies and equipment allowed for the logged-in role.

## Customer Journey

### Goal

Confirm that a customer can view only their own company data, equipment, and report history.

### Steps

1. Log in as `demo_customer`.
2. Confirm the user lands directly on the company profile view, not a customer-picker screen.
3. Confirm the company header shows the assigned customer details.
4. Confirm the equipment table loads for that company.
5. Open the reports panel for a listed equipment item.
6. Confirm existing reports are visible.
7. Confirm no report create or edit actions are shown.
8. Sign out.

### Expected Result

- Customer can view their own company and equipment.
- Customer cannot create, edit, approve, or review internal revision history.

## Staff Journey

### Goal

Confirm that staff can select an assigned customer, create reports, and edit only their own draft reports.

### Steps

1. Log in as `demo_staff`.
2. Confirm the first screen is the customer list.
3. Open an assigned customer profile.
4. Confirm company details and equipment list load.
5. Use the back button in the portal UI and confirm it returns to the customer list.
6. Open the reports panel for a listed equipment item.
7. Confirm the report form is visible.
8. Confirm the create form status options are only `Draft` and `Submitted`.
9. Create a new report as `Draft`.
10. Confirm the new draft appears in the reports table.
11. Edit that draft report and save changes.
12. Confirm the edited draft updates successfully.
13. Confirm a submitted report does not show an edit action for staff.
14. Sign out.

### Expected Result

- Staff must choose a customer before opening a company profile.
- Staff can create reports as draft or submitted.
- Staff can edit only draft reports they created.
- Staff cannot edit submitted reports or access revision history.

## Owner Journey

### Goal

Confirm that owners can manage customer access, edit submitted reports, approve them, and review revision history.

### Steps

1. Log in as `demo_owner`.
2. Confirm the first screen is the customer list.
3. Open a customer profile.
4. Open the reports panel for a listed equipment item.
5. Confirm an `Edit` action is available on submitted reports.
6. Open a submitted report in edit mode.
7. Confirm the status options are `Submitted` and `Approved`.
8. Change the status to `Approved` and save.
9. Confirm the updated status appears in the reports table.
10. Open `Revisions` for the edited report.
11. Confirm revision history shows the previous values and timestamp.
12. Close the revision panel.
13. Sign out.

### Expected Result

- Owner can open any visible customer profile.
- Owner can edit submitted reports and set them to approved.
- Owner can view revision history after edits.

## Regression Checks

Run these checks after any portal auth, routing, or reporting change.

1. Verify customer login still bypasses the customer-picker screen.
2. Verify staff and owner still start at the customer list.
3. Verify report actions still match role and status rules.
4. Verify sign-out clears access to the protected portal route.
5. Verify revision history can still be opened and closed by the owner.

## Sign-Off

- UAT run date:
- Tester name:
- Build or commit:
- Result: pass / fail
- Notes:

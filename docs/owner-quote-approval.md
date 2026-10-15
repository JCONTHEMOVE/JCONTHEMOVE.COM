# Owner quote approval

The job editor's saved estimate is separate from quote approval. The previous
"Fix it" shortcut returned to that editor even when no edits were needed, leaving
the owner at a disabled Save and return button.

## Owner and admin

- The approval blocker opens the quote review directly. Field-specific price
  repairs still open the relevant editor field.
- The editor's final step offers **Review and approve quote** for an unchanged
  saved job, or **Save and review quote** when edits need saving first. A failed
  save preserves the edits and never advances to approval.
- The review defaults to **Approve only — no customer message**. **Save and
  approve** approves the reviewed quote through the existing approval service.
  This mode does not create an invoice, contact the customer, record customer
  agreement or payment, or dispatch anyone. Sharing remains an explicit option.
- Opening a page or a notification never approves a quote. Existing policy and
  owner exception checks still apply. Customer agreement remains its own step.

## Coworker requests

- Coworkers with quote access can request owner approval from quote review.
  Assigned coworkers whose roles hide financial information get a separate
  request-only control that reveals no price or customer information.
- The server checks authentication, approved employee status, existing quote
  authority or assignment, the saved version and job stage. Requests cannot
  approve quotes or bypass dispatch requirements.
- A locked transaction saves the request, audit entry and owner in-app
  notifications together. Repeating the request for the same version returns
  the existing request; simultaneous requests cannot create duplicate alerts.
- Notifications contain the job number, price, crew size, hours and Central-time
  schedule. The owner can open **Review and approve quote** from the notification
  bell. Browser push uses the existing subscription and VAPID configuration as a
  best-effort alert; unavailable push never removes the durable in-app request.
- The link opens an authenticated review of the current saved job. Changed or
  already handled requests are labelled. Approval is bound to the reviewed
  version and hash. A replay of an older approval cannot approve new terms.
- Waiting screens refresh approval status every 15 seconds. No new pricing,
  payment or dispatch engine is introduced, and existing tier permissions are
  preserved.

## Verification and rollout

`node --test scripts/job-workflow-report.test.mjs` exercises the actual React
components and request client with synthetic HTTP responses: the approval
shortcut, stale confirmation repair, unsaved edits, failed-save recovery,
owner-only actions, coworker requests, notification navigation and keyboard use.

`node --import tsx server/services/__tests__/jobWorkflowIntegration.test.ts`
exercises the real Express router and service against isolated PGlite SQL,
including access checks, privacy, duplicate requests, rollback, push failure,
stale approvals and approval-only side effects. PGlite serializes its connection;
it is not a substitute for independent PostgreSQL connection concurrency testing.
All outbound message, invoice, push and dispatch providers are mocked.

The request uses existing JSON job details, notifications and audit tables; no
schema migration or new secret is required. A Railway release from main is
required before these controls appear on the live site. Live phone push still
depends on a valid enrolled browser subscription and the existing push settings.
No real customer or crew action is part of these tests.

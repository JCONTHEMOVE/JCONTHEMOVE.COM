# Representative lead-bot pilot

Review branch based on main `054ea0eb48f4ddcf1c6e333c29506f89de720f9d`.
No production campaign, promotion, customer record, migration, message, deployment,
or publication was created while building this pilot.

## Owner experience

Open **Admin → Marketing → Lead-bot pilot**. The pilot supports one saved
configuration. Select a current representative, service, territory, existing
approved campaign variant, and an active promotion (or no promotion). Review the
explicit town list and select up to three additional project questions.

The representative must have an active marketing profile linked to an approved
user. A conflicting referral-code owner blocks approval and intake. No seed
representative, guessed phone number, discount, or availability is copied into
production. The default four-town list is an editable draft suggestion.

Saving creates a draft. The owner can preview the exact saved conversation, then
approve that revision or pause it. Every edit clears approval. Campaign revision,
representative mapping or offer-term changes invalidate approval. Expired,
exhausted, inactive and other-representative promotions fail closed. No prices
are calculated and no discounts are redeemed by intake.

The generated `/lead-bot/:id` link resolves attribution server-side. It accepts
no client-supplied representative, promotion or campaign override. Preview uses
the authenticated admin endpoint and never submits a lead or records a visit.
Required questions cover location, scope, preferred timing (Central or Eastern)
and contact details. Preferences are not reservations. Answers survive back
navigation, failed submissions and reloads in the same browser session; the
contact draft is removed after success.

## Canonical intake and attribution

The conversation posts to the existing **`/api/leads/quick-request`** endpoint.
A narrow adapter validates the pilot's current approved configuration and
converts answers to the existing `project` intake schema. The original route
constructs the canonical lead, with structured project details, actual email,
address, no confirmed date, and no invented price or crew allocation.

Inside the canonical transaction, the adapter saves the existing `leads` record,
`quote_attributions` credit and `marketing_bot_events` conversion together.
An attribution/event failure rolls everything back. Credit uses the verified
marketing representative's user ID and referral code; any selected customer
promotion remains separate in the lead and attribution metadata. Existing
lead/quote/booking workflows can continue from this same lead.

The pilot returns only a receipt. It exits before email, SMS, scheduler,
creator-reward and job-event broadcast paths. No customer messaging or social
publishing adapter is called, and no new schedule is enabled. The owner finds
the request in the existing lead queue (`source=project_request`,
`status=quote_requested`). Qualifying here means complete required details and
a match to the owner-selected service/town campaign; it is not a booked job or
a verification of customer identity/address.

Submission keys are hashed and unique in SQL. Transaction locks serialize
retries across processes. Reusing a key with different answers is rejected.
The same normalized phone/location/scope/timing/service inquiry within 24 hours
also deduplicates under a different key. Original credit is preserved; a repeat
does not reassign the representative or update the earlier contact record.
Visit IDs are hashed and recorded once per bot/browser session. Metrics count
distinct visits and canonical inquiries, never inferred bookings or revenue.

## PR #59 integration boundary

Inspected PR #59 at `b1c1a85b4a4434a7194d0e836437c3ecb63656d5`; it remains
a separate unmerged draft. This branch changes no booking, availability, hold,
quote, payment or pricing engine. It introduces no alternative booking route.
The pilot only qualifies incoming requests; it does not offer a second
"book now" path. Continue scheduling from the existing canonical lead.

Both branches touch `/api/leads/quick-request` in `server/routes.ts`. When
combining them, retain PR #59's `requestKey`/`public_booking_requests` logic for
its homepage flow. Keep this pilot's adapter before `quickRequestSchema.parse`,
its atomic persistence hook first inside the transaction, and its receipt return
before side effects. The adapter deliberately does not supply PR #59's booking
capability key and cannot create a hold or enter its payment flow.

The extracted-handler fixture in PR #59's `scripts/check-homepage-booking.ts`
will also need `LeadBotError` in its dependency map, as this branch does for the
existing `projectRequest.test.ts`. If it exercises the pilot, inject
`prepareLeadBotSubmission` and `commitLeadBotInquiry` against its isolated SQL
database as demonstrated in this branch's acceptance fixture. Run both suites
after integration. Cross-navigation between a completed inquiry and an unrelated
new homepage booking does not claim shared identity; no such navigation is
introduced by this pilot.

## Release gates and rollback

Public intake requires all of:

1. The exact configuration's current owner/admin approval.
2. `LEAD_BOT_PUBLIC_ENABLED=true` (default false).
3. `LEAD_BOT_PUBLIC_CAMPAIGN_ID` matching the single selected campaign UUID.
4. Current valid representative, campaign and promotion bindings.

The builder has no activation, publish or messaging button. Approval alone
cannot open the public link. A separate explicitly approved release must set
the public gate. Do not set it as part of reviewing this draft. Vercel Git
deployment is disabled for `feat/representative-lead-bot-pilot`.

Schema additions follow the existing marketing module's lazy, idempotent
initialization. `ensureLeadBotSchema` is invoked only after the existing
marketing owner/admin middleware on an admin pilot request. It creates
`marketing_lead_bots`, `marketing_lead_bot_submissions` and
`marketing_lead_bot_visits`; it does not alter existing business records.
No live migration has been run. Review the exported `LEAD_BOT_SCHEMA` before
release. Normal public requests on a disabled deployment do not initialize it.

To stop intake, pause the bot or turn the environment gate off. Keep canonical
leads, attribution and audit records. A code rollback can leave the three
additive tables dormant. Do not automatically drop them or delete customer
records. No provider credential or new paid service is required.

## Synthetic validation

- `npm run check` and `npm run build`.
- `node --import tsx server/services/__tests__/leadBotPilot.test.ts`: real SQL,
  actual canonical HTTP handler and marketing authorization, disabled gates,
  matching/forged attribution, qualification, approval invalidation, pause,
  unique visits, duplicate submissions and atomic rollback.
- Add `--dom` for real React components → HTTP → SQL → receipt, preview
  isolation, focus, retained answers and a lost-response retry.
- Add `--postgres --browser` for independent PostgreSQL connections and actual
  Chromium at 320/390/1280px, builder save/approve/pause and end-to-end intake.
  The test permits only a disposable localhost `jc_ledger_test` database;
  contacts use `example.test`. CI supplies PostgreSQL 16 and pinned Playwright.
- Existing project-request server and DOM tests, marketing tests and the server
  regression suite are also checked. In this workspace the `tsx` CLI's IPC
  socket is unavailable, so server files run with `node --import tsx`.

Local PGlite is sequential and does not prove multi-connection races. Chromium
is not installed in the workspace; actual browser and concurrency results must
come from the dedicated `Representative lead-bot synthetic acceptance` check.
The untouched `quickBook.test.ts` date fixture currently returns `2026-09-10`
where it expects `2026-09-04`. Do not describe the entire release suite as green
while that failure remains. No live provider or customer acceptance is claimed.

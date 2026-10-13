# Homepage callback and exact-time chat — Issue #58

This change adds a short homepage front door to the existing callback and instant-booking APIs. `/book`, quote pricing, the 30% instant-booking scheduling deposit, and owner payout calculations retain their existing contracts.

The two choices are visible together. Questions start with location, size and timing, then collect scope, inventory/access, truck and contact details. The existing `estimateJobDuration` supplies advisory crew/hour ranges. Overrides include a reason and require review; unknown access, specialty inventory and work at both ends also require review. Both Central and Eastern labels come from the same slot timestamp. The service date remains the crew's Central calendar date.

Answers and an unguessable request key stay in session storage for refresh/back/path switching (24-hour draft TTL). Availability and quotes are never restored as current. The server recomputes the quote on hold submission and rejects a changed review fingerprint. A committed request is immutable from the public chat: retrying or submitting the other path with the same key returns the existing result. Staff can continue the canonical lead lifecycle. A callback creates only the existing owner-queue lead, without a booking, hold or deposit.

`public_booking_requests` stores only a SHA-256 capability hash and canonical lead ID. The binding is committed with lead creation under a shared transaction lock. No separate lead, quote, wallet or booking system is introduced. The status endpoint accepts the capability, not a lead ID, and returns an allow-list of customer totals and state. Creator identity comes from the authenticated session; referral resolution uses existing promo/rep records.

The existing hold flow now checks approved available movers, weekly hours, date overrides/day blocks, legacy work, confirmed schedule requests, and overlapping holds. Missing public worker hours fail closed. Competing starts share a service-date capacity lock. Expiry/release/admin approval/payment confirmation serialize on the hold row and capacity date. Hold expiry and parent booking state update atomically. Signed Square events must also retrieve a PAID invoice before payment effects; the hold must be unexpired, awaiting its deposit, and bound to the latest approved quote. Late/released/unapproved/stale-quote payments become `payment_review` for owner reconciliation rather than reacquiring capacity or dispatching crew. A deposit never means the full job balance is paid.

The initialization uses the repository's existing idempotent infrastructure pattern. No production migration or deployment has been executed. Worker availability must be configured before public slots can appear. Existing explicit staff scheduling/force overrides remain staff operations; the public flow cannot override capacity.

## Synthetic verification

- `npm run check`
- `node --import tsx server/services/__tests__/homepageBooking.test.ts`
- `node --import tsx server/services/__tests__/homepagePaymentGate.test.ts`
- `node scripts/homepage-booking.test.mjs`
- `node --import tsx scripts/check-homepage-booking.ts` (isolated PGlite SQL/HTTP fixtures)
- `TEST_DATABASE_URL=postgresql://...@127.0.0.1:5432/jc_ledger_test node --import tsx scripts/check-homepage-booking.ts --postgres` (separate PostgreSQL sessions; disposable schema only)
- `node scripts/homepage-booking-browser.mjs` (Chromium, actual homepage at 390/320/1280px, mocked APIs)
- Existing server suite and `npm run build`

The dedicated PR workflow provisions PostgreSQL 16 and Chromium, uses synthetic addresses/accounts, and mocks Square creation, lookup and cancellation. It has no production secrets or deployment steps. Vercel Git deployment is disabled for this draft branch. Keep this PR draft and unmerged.

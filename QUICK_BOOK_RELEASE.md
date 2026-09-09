# Quick Book owner release checks

September 8, 2026. Candidate preparation only; production is still on `25b985e4`.

## First deployment configuration

Keep these Railway variables explicit:

```dotenv
QUICK_BOOK_ENABLED=false
QUICK_BOOK_OWNER_ONLY=true
QUICK_BOOK_STAFF_DRAFT_ENABLED=false
QUICK_BOOK_LIVE_BOOKING_ENABLED=false
```

Validate a clean Node 20 install, `npm run check`, `npm run test:server`, monitoring unit tests and `npm run build`. Verify the exact published commit on `/api/health`. A successful build of a dirty worktree still bears the previous Git commit; that is not evidence of deployment.

Before enabling drafts, verify the new schema against the actual production database in an isolated branch, including privileges and repeated startup migration. The disposable migration harness uses only a minimal legacy schema and is insufficient for production drift checks.

## Owner-only drafts

After deployment/schema verification, set only `QUICK_BOOK_ENABLED=true`. Keep owner-only true and both staff drafts and live booking false. Sign in with the intended business-owner account and open `/quick-book`.

1. Start a clearly labeled synthetic draft using an owner-controlled contact number. Enter incomplete intake; verify missing fields are questions, not invented facts.
2. Correct the contact details, future Central-time date/window, service address, crew size, duration and equipment. Select SMS consent explicitly; do not infer consent from the transcript.
3. Confirm a suggested available named crew and lead. Verify unavailable workers cannot produce a ready booking.
4. Check a local three-mover/two-hour labor-only customer-truck `LOCAL3X2` quote against the canonical quote endpoint and current September policy. The expected historical fixture is $450 customer total and $525 reward basis, subject to actual extras/eligibility.
5. Reload and resume the draft. Confirm saved fields and revision are preserved.
6. Verify the final Book & Alert Crew control is disabled. A direct booking request must be denied while the live flag is false, with no booking, lead, quote, job-plan, invoice, message or notification side effects.
7. Verify admin, employee and customer accounts cannot use owner-only draft endpoints. The authenticated health response must report live completion unavailable.

The development-only `/quick-book-fixture` previews layout with screen-local controls. It cannot establish server authorization, persistence, pricing or notification delivery and is excluded from production routing.

## Controlled live completion

Only after the draft gates pass, use one separately authorized, clearly labeled internal job and its approved crew recipients. Enable live booking for that test, retain owner-only access, and verify exactly one booking/lead/quote/job-plan set plus no duplicate crew events on replay. Confirm the customer receives no automatic message or invoice from this operation. Disable live booking again if any check fails; preserve audit records for investigation.

Do not broaden staff access until real routine completion timing and quote/notification accuracy meet the release plan. Payment, payout, gift-card and push-device acceptance remain separate checks.

## Evidence to record

Record candidate commit, runtime, install/type/test/build results, migration target identity, owner role/flags, synthetic fixture IDs, quote comparison, retry outcomes, actual authorized recipient receipt, and rollback result. Never record tokens, session cookies, contact numbers or private database URLs in this document.

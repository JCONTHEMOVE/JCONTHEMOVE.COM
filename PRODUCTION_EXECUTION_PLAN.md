# JC ON THE MOVE Production Execution Plan

> September 6 incident: see [SERVICE_RECOVERY_STATUS.md](./SERVICE_RECOVERY_STATUS.md) for the reproduced bare-domain outage, working `www` customer path, current live payment diagnostics, and reconciled completion queue. The September 3 evidence below is historical, not proof that every service is ready today.

_Authoritative snapshot: September 3, 2026 (America/Chicago)._ This is the single release and operations plan for the current release train. It replaces the old Render/Replit-oriented deployment notes for the active production path. Product strategy, payment-rail sequencing, and the GSG operating model live in [`MASTER_GAME_PLAN.md`](./MASTER_GAME_PLAN.md); this document remains the release checklist.

## Decisions already made

| Area | Decision | Evidence |
| --- | --- | --- |
| Production platform | Railway is the active production host. | `www.jconthemove.com/api/health` reported `ready`, database `ready`, and application release `d9974bf5` on September 2, 2026. |
| Canonical readiness endpoint | `https://www.jconthemove.com/api/health` | Returns `status: ready`, database ready, and a deploy commit. |
| Deployment model | Railway Git integration deploys `main`; GitHub validates the public commit after each push. | Public commit matches current `main` head. |
| Card payments | Square remains the sole card/invoice processor. | Existing payment and launch-checklist design. |
| Job close-out | Quote → paid/dispatch → in progress → complete → payout review/approval → worker payout → JCMOVES issue. | Current lifecycle, payout engine tests, and admin payout surface. |
| Local PM2 | Development-only; it is not a production availability signal. | The stopped `jc-api-5012` process lacks `web-push`; do not restart it until Node 20 and a clean install are restored. |

## Current evidence

- Production scheduling and local-promo alignment shipped in `8c9a06c4`; the public health endpoint subsequently verified the final unified phone-booking release in `d9974bf5` with application and database status `ready`.
- The exact booking release passed the clean Node 20 typecheck, all 43 discovered server test files, the production build, and GitHub's public-commit verifier. A phone-width live check confirmed the canonical `/book` landing screen and shared hourly schedule controls; a follow-up prevents the detailed builder from skipping service/address and removes staff strategy panels from the customer presentation.
- Job Setup now owns one editable Confirmed Job Date, using `confirmedDate` with the historical `moveDate` fallback. Newly selected arrival windows use the shared one-hour Central list from 7:00–8:00 AM through 4:00–5:00 PM plus Flexible/TBD; saved legacy two-hour windows remain display-compatible.
- Driver premiums are Finance-only. Job Setup no longer edits or submits them, while backend payout-ledger support and stale-driver cleanup remain intact.
- Server-side address classification treats verified Ironwood and Bessemer city/state or ZIP evidence as local and leaves unmatched/outside-zone work on global pricing. Job Setup's server preview is the visible price authority.
- Promo `LOCAL3X2` is server-authoritative through September 30, 2026, 11:59 PM Central: exact three movers/two hours, qualifying load-only or unload-only labor, customer/no JC equipment, and an Ironwood/Bessemer local address produce a $450 base before permitted extras. The pre-promo rate card remains the JCMOVES basis; `LOCAL4X4` is unchanged.
- `/book` and `/book/chat` now share one phone-first customer/authorized-worker engine with address lookup, the shared hourly schedule, server quote/submission endpoints, a three-part progress cue, and a customer request-receipt email that clearly is not a final price, dispatch, or guaranteed appointment.
- The September 2 production-only dependency audit has no critical findings after targeted Node 20-compatible overrides. Seventy lower-severity findings remain a tracked remediation backlog; broad `npm audit fix` output is not safe because it proposes Node 22 and breaking Solana/Drizzle changes.
- The release train groups roughly eight connected streams: staff Job Brief, job lifecycle/crew/payout, quote and Square delivery, marketing/zone pricing, notifications, Facebook Page pilot, private gift-card rewards, and production operations.
- JC-87 completed the controlled notification test on September 3, 2026, at 8:25 AM Central. The saved plan is September 4, 2026, 10:00–11:00 AM, three movers, two hours, loading-only labor, customer truck, `LOCAL3X2`, and a $450 customer total with the original $525 rate-card amount retained as the JCMOVES basis. The job timeline records the exact tentative plan.
- Delivery produced exactly one successful in-app alert for each assigned mover—Darrell Jackson, Evan, and Troy Tom—with no duplicate in-app records. The corresponding three web-push attempts were skipped because production VAPID keys are not configured. The customer quote was not sent and no Square invoice was created.
- **Mass-update decision: controlled in-app crew rollout may begin.** Do not treat push as a working mass channel until VAPID keys are configured and a live push test passes; customer broadcasts still require separate owner authorization. Square/JCMOVES closeout and backup/alerting drills remain separate launch-readiness gates.
- The 60-Second Quick Book implementation is complete in the current working tree but is not deployed. It adds an authenticated, mobile-first conversational draft, explicit tap-only SMS consent, deterministic extraction fallback, server-authoritative quote parity, availability-based crew suggestions, a transaction-protected final booking, and fingerprinted post-commit crew-plan alerts. Raw audio is never persisted; abandoned transcript content is redacted after 30 days while non-PII timing and correction metrics remain.
- Quick Book is fail-closed behind `QUICK_BOOK_ENABLED`, `QUICK_BOOK_STAFF_DRAFT_ENABLED`, and `QUICK_BOOK_LIVE_BOOKING_ENABLED`. Production should begin with owner fixtures and live booking disabled. `AI_GATEWAY_API_KEY` enables Gateway extraction and transcription; deterministic typed intake remains available when AI is unavailable.
- Local verification for Quick Book passed the TypeScript check, all 44 server test files, and the production build. A no-write browser fixture verified September 4 date editing, the full shared hourly-window list, 44-pixel-or-larger controls, no horizontal overflow at 390px, the desktop two-column layout, and no browser errors. The workstation currently runs Node 24, so the clean Node 20 CI/release gate must still rerun before deployment.

## Reconciled work inventory

Chat titles and historical task briefs are not completion proof. An item is only closed when its current code, tests, and (where needed) production behavior prove it. The accessible evidence currently groups the active worktree as follows:

| Release area | Current implementation evidence | Required close-out proof |
| --- | --- | --- |
| Fast staff job view | `client/src/pages/lead-detail.tsx` contains the mobile Job Brief, contextual next action, compact finance/JCMOVES state, and collapsed advanced detail. | Mobile and desktop role-based browser check against representative missing-data and payout states. |
| Job handoff, crew, and payout | `admin/jobs`, `admin/ops-board`, `admin/job-payouts`, dispatch services, and `server/routes.ts` are in the active release train. | Server tests plus completed-job → payout approval → worker payout → JCMOVES production smoke test. |
| Quote, invoice, and customer contact | `server/services/square-invoice.ts`, `server/routes.ts`, `JobOrderBuilder.tsx`, and Job Detail are in the active release train. | Square sandbox/production-safe test of quote, email/SMS consent, payment link, deposit, and dispatch authorization. |
| Phone booking engine | `/book` and `/book/chat` share the three-part multi-service flow; quote authority remains on `/api/bookings/quote`, creation on `/api/bookings`, and self-service requests receive a transactional receipt. | Live non-customer smoke test of service → address → date/hour → contact → review without creating a real job; confirm authenticated worker mode separately. |
| 60-Second Quick Book | `/quick-book` provides owner/staff conversational intake, structured resumable drafts, exact canonical quote previews, crew suggestions, and an idempotent Book & Alert Crew transaction. All external side effects are disabled for incomplete/review-only drafts and feature flags default off. | Clean Node 20 CI, migration verification, owner-only no-customer fixture, then one authorized internal booking with quote parity and exact notification delivery evidence before enabling approved-staff drafts. |
| Targeted-area marketing | Zone-pricing, launch-checklist, campaign analytics, and tracked-link code are in the active release train. | Launch Checklist probe and one public tracked-link/quote smoke test; verify attribution without creating a real customer charge. |
| Notifications | Job-event routing, Discord/web-push delivery, readiness reporting, route-wiring tests, and automatic complete crew/schedule plan alerts are in the active release train. JC-87 recorded one in-app delivery per assigned mover with no duplicates; web push was skipped because VAPID keys are missing. | Use in-app alerts for the controlled crew rollout. Configure VAPID keys and pass a live push test before relying on push for mass delivery. |
| Facebook and gift-card pilots | Company Page import controls and private, staged Square gift-card bonus settings are included from production. | Keep both pilots explicitly scoped; prove consent, attribution, and payment/reward audit records before widening access. |
| Production operations | Railway workflows, public health verifier, and Launch Checklist wording were aligned in this release. | Push `main`, see the exact commit on public readiness, then observe at least one scheduled availability run. |

### Historical chat triage

The visible chat list falls into four queues. Keep them out of the release until each has a current acceptance test:

1. **P0 – revenue and operations:** duplicate scheduler cleanup, jobs that need a specific calendar/docket entry, lead recovery, and test-lead cleanup. These require a data-scope review before any mutation.
2. **P1 – conversion and customer experience:** quote wording, targeted-area marketing, website job listings, text-lead intake, and the booking funnel. These require public-path and analytics verification.
3. **P1 – crew and administration:** admin capabilities, adding or correcting workers, JCMOVES/payout linkage, and external notifications. These require authorization and payout-audit checks.
4. **P2 – integrations and outreach:** Discord/Bill, campaigns, and non-critical workflow polish. These require explicit account/recipient authorization before connection or messaging.

Do not merge data cleanup, external messaging, or calendar mutations into the current release train. They need their own reviewed inputs and rollback plan.

## Release train: complete in this order

### 1. Stabilize and publish the current batch

1. Use Node 20 in a clean checkout and run `npm ci`.
2. Run `npm run check`, `npm run test:server`, and `npm run build`.
3. Run secret/policy checks and focused role-based browser checks for:
   - a quote-ready job,
   - a dispatched job,
   - a completed job awaiting payout review,
   - payout approval and worker payout screens,
   - the compact mobile Job Brief with missing optional fields.
4. Review the combined commit as one release train; push `main` only after the validation checkout is green.
5. Let `Production Build and Deploy Verification` wait for Railway to report that exact commit on the public readiness endpoint.
6. Run the in-app Launch Checklist from an owner account after deployment. Do not mark a release live if payment, readiness, route, or payout probes fail.

For the Quick Book release, keep live booking disabled during the first production deploy. Verify authenticated draft start/resume, the exact canonical quote, access-detail encryption, crew availability, and transcript cleanup. Then enable owner/admin booking for one labeled internal job, confirm one booking/lead/quote/job-plan set and no more than one alert event per assigned mover, and only afterward consider approved-staff draft access.

### 2. Verify the lead-to-booking funnel

1. Establish the expected relationship between legacy leads and parent bookings. A lead-only request may be valid, so define the expected conversion event before changing code.
2. Add a daily dashboard or query showing: lead count, booking count, quote count, payment-link count, paid/dispatch count, and completed count.
3. Investigate the July 2 booking cutoff with a non-production test request and production logs. Check the public booking form, `/api/bookings/quote`, and booking-confirm endpoint separately.
4. Treat any request that creates a lead but cannot create/confirm the intended booking as a P1 conversion defect.

### 3. Operate the application 24/7

| Control | Implementation | Owner action still required |
| --- | --- | --- |
| Process recovery | Railway manages the web process; `/health` is its liveness probe. | Confirm Railway service is set to deploy from `main` and has its native health check enabled. |
| Readiness and deploy freshness | `scripts/check-production-deploy.mjs` verifies readiness, provider, DB state, and public commit. | Set GitHub variable `EXPECTED_HOSTING_PROVIDER=railway` (the workflow defaults to it) and keep the canonical health URL if it changes. |
| Continuous availability | `Production Availability` requests a run every 10 minutes; readiness failures trigger a separate owner Discord alert job. GitHub schedules may be delayed. | Add Actions secret `PRODUCTION_ALERT_DISCORD_WEBHOOK_URL` for an owner-only Discord channel and enable All Messages for the owner; see `DEPLOYMENT.md` for a controlled delivery check. |
| Release verification | `Production Build and Deploy Verification` validates Node 20 install, types, server tests, build, and exact public commit. | Keep Railway Git integration enabled; a delayed/missing deployment must fail this workflow. |
| Business-health monitoring | Daily lead/booking funnel review. | Choose the responsible owner and threshold for investigation. |
| Backup and recovery | No verified backup/restore evidence is in this repository. | Confirm the database provider's backup retention and perform one documented restore drill before claiming disaster-recovery readiness. |
| Secrets | Required payment and infrastructure values are checked without exposing their values. | Rotate secrets after any exposure concern and restrict Railway/GitHub administrative access. |

## Outstanding decisions that require an owner

1. **Alert escalation:** owner-only Discord failure delivery is implemented pending the Actions secret and channel notification setting in `DEPLOYMENT.md`. Decide how the owner escalates after 15, 30, and 60 minutes; timed escalation is not automated.
2. **Database recovery objective:** set backup retention and the maximum acceptable data loss/recovery time, then document the restore drill.
3. **Release authority:** name the person who approves payment, payout, and production releases after the Launch Checklist is green.
4. **Funnel expectation:** decide whether every qualified lead should become a parent booking or whether lead-only intake is an intentional business path.
5. **Dependency remediation:** schedule compatibility-tested upgrades for the remaining high/moderate findings, especially Drizzle, upload/image processing, Express middleware, and Solana mobile transitive packages. Do not use `npm audit fix --force` on production.

## Definition of production-ready

Production is ready only when all of the following are true:

- a clean Node 20 install, types, tests, and build pass;
- the pushed commit is verified on the public readiness endpoint;
- the role-based smoke tests above pass in production;
- the owner-run Launch Checklist is green for the payment and payout paths being enabled;
- a real alert recipient and escalation path is configured;
- database backup retention and a restore drill are documented; and
- the lead-to-booking conversion expectation is measured and has no unexplained production regression.

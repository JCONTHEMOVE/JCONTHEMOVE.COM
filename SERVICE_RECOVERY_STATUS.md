# JC ON THE MOVE service recovery

## Current status — September 9, 2026

- Authenticated production Launch Checklist inspection at approximately 21:34 UTC: the environment-presence, database, public-deployment and custom-domain probes passed. Square returned `environment=sandbox` with an authentication failure. This upgrades the earlier configuration-only concern to a verified failed provider probe. Verify the intended Square account and environment before repairing credentials; no credential change or live payment was performed. The Chrome developer login page is waiting for owner sign-in. These five probes are not all 29 launch checks and do not establish end-to-end payment readiness.
The September 6–7 sections below are historical incident evidence. Their statements that the apex outage remains active, Cloudflare is signed out, and the release changes are unpushed are superseded by this update and `OPEN_TASKS.md`.

- Cloudflare apex restoration is complete: active rule `f14b13f5da1e4b4582616580b2913a0e` returns a 308 to HTTPS www and preserves path/query. Both hosts and booking routes passed checks, including referral preservation.
- Draft PR #10 contains the reviewed release candidate and subsequent booking/payment/reward fixes. Full CI passed at `58948c09` in run 34385247389, including types, server tests, monitoring tests, build and PWA checks. Nothing has been merged or deployed.
- The live public booking path was exercised through final review with synthetic contact information and no submission. A misleading inventory price preview and truncated moving label were corrected on the draft branch; live acceptance after deployment remains open.
- Railway production database ownership is confirmed in Replit by matching standalone PGHOST. Seven-day point-in-time recovery and daily backups with seven-day retention are enabled. First-backup completion and an isolated restore drill remain unverified. The other two connected Neon projects do not match production.
- The candidate implements a disabled canonical payment ledger, verified Square payment/refund adapters and admin reconciliation. Automatic reward integration, live acceptance and release gates remain open. Owner acceptance remains necessary for payment/reward, push-device receipt, mailbox workflows and campaign delivery. The requested refund policy is still awaiting a response.

Use `OPEN_TASKS.md` for the current completion register. The historical investigation below is retained to explain the original failure and verification limits.

## September 7 customer failure follow-up

At approximately 10:10 AM America/Chicago, live HTTP checks returned 522 for `https://jconthemove.com/`, 200 for `https://www.jconthemove.com/` and `/book`, and ready for the `www` health endpoint (database connected; release `25b985e4`). A read-only lookup in the workspace-configured database found no leads, contacts, or bookings matching the phone number in the customer's screenshot, normalized to the last ten digits. This does not prove the customer used that phone number in the form or establish their exact failure path. The screenshot does not identify their URL or submission error.

The bare-domain outage remains active. No hosting configuration was changed, customer message sent, or request submitted. Current tool discovery exposes neither Cloudflare management nor the browser JavaScript control tool, so this follow-up could not inspect or repair the Cloudflare configuration. The working `www` booking URL is an access workaround; complete submission success has not been verified.

Evidence captured September 6, 2026, approximately 4:30 PM America/Chicago.

## Immediate customer access

Use https://www.jconthemove.com/ or https://www.jconthemove.com/book while the bare-domain incident is investigated. The website also displays call/text contact (906) 285-9312. No customer messages were sent during this investigation.

| Check | Observed result |
| --- | --- |
| `https://jconthemove.com/` | Repeated request timeouts, also failed through the external web fetch tool |
| `https://jconthemove.com/book` | Request timeout |
| `https://www.jconthemove.com/` | HTTP 200; browser renders the customer homepage |
| `https://www.jconthemove.com/book` | HTTP 200; homepage quote button reaches quote choices and the service-selection screen |
| `https://www.jconthemove.com/api/health` | HTTP 200; application and database ready |
| Live release | `25b985e4a8369bed94144421a8e2908fa15abd97`, deployed September 3 |
| Browser errors on inspected quote screens | None captured |

These checks reproduce a partial outage. They do not establish the customer's exact URL, device, or error, or verify the complete submission/payment journey.

## Domain investigation and repair

Public DNS resolves the bare domain to Cloudflare (`172.67.129.164`, `104.21.1.167`, plus IPv6). `www` resolves through `w8c3lfzj.up.railway.app` to `69.46.46.56`. Nameservers are `sid.ns.cloudflare.com` and `sierra.ns.cloudflare.com`.

The failing path is the Cloudflare-served bare domain. The exact cause remains unconfirmed because Cloudflare is signed out in both available browser sessions. Do not infer the configured origin from Cloudflare's public proxy addresses.

After Cloudflare sign-in:

1. Inspect the zone's current apex record, redirect rules, SSL/TLS status and edge/origin errors. Record existing settings before changing them.
2. Restore the apex route, preferably with a path- and query-preserving HTTPS redirect to the already-working `www` site when compatible with existing API/webhook consumers. Check those consumers before choosing redirect behavior for non-GET requests. Otherwise use Railway's verified custom-domain target and certificate configuration.
3. Preserve mail records and existing security protections. Do not replace nameservers, disable TLS verification, or hard-code the observed Railway IP.
4. Verify both HTTPS hosts at `/` and `/book`, test query preservation, and check plain HTTP upgrades to HTTPS. Then repeat the customer browser path.

No DNS or hosting settings have been changed. The Cloudflare Chrome tab is left open for sign-in.

## Monitoring correction prepared locally

The existing Production Availability workflow checked only the `www` readiness endpoint, so it could pass during this incident.

`scripts/check-public-entrypoints.mjs` now checks both domains at `/` and `/book`, with bounded requests, HTTPS and path validation, and basic JC application-HTML validation. A redirect to the working `www` host is accepted. One failed entry fails the check even when the others succeed. The workflow runs this check even after readiness fails, using the existing owner-alert job.

Verification: all 18 focused monitoring/alert tests passed on the installed Node runtime and on Node 20.20.2. The Node 20 sandbox attempt encountered a Windows path-permission error; the approved rerun outside the sandbox passed. The live probe returned failure as expected: two apex timeouts and two `www` passes. This is detection evidence, not restoration evidence. These changes are local and unpushed; they are not active in GitHub Actions. Those direct Discord activation instructions are historical; AVAILABILITY_RELEASE.md now describes the consolidated incident-service path and remaining private configuration. No alert was sent.

## Consolidated service completion queue

| Priority / area | Evidence | Completion requirement |
| --- | --- | --- |
| P0 Customer access | Partial domain outage reproduced above | Cloudflare access, targeted repair, then both domains and booking routes verified |
| P0 Payments | Public health reports Square `sandbox`, credential configured, location not configured, isolated credential not configured | Verify the intended live Square configuration and correct environment-specific credentials/location; complete an owner-controlled payment, webhook replay and exactly-once JCMOVES closeout test before claiming live payment readiness |
| P1 Public booking | Homepage, quote choices and service selection render on `www` | Verify address, schedule, canonical quote and a labeled controlled request through receipt and the owner queue; no real request was submitted here |
| P1 Quick Book | Local changes exist; latest release-preparation task was interrupted during clean Node 20 validation | Finish clean install, types, server tests, migration tests and build; inspect combined changes; begin owner-only with live booking disabled |
| P1 Push notifications | Latest task fixed key-fetch/pair validation and prepared an owner-only test; validation task interrupted | Finish validation, configure the matching production VAPID pair, deploy and perform one specifically authorized owner test |
| P1 Crew and payout | September 3 JC-87 evidence records three successful in-app deliveries; push skipped | Verify current owner/crew views and one complete job-to-payment-to-payout-review-to-reward workflow; preserve approval requirements |
| P1 Availability alerts | Previous task implemented owner Discord alert locally; this task adds missing apex coverage | Publish reviewed monitoring changes, configure dedicated secret, verify scheduled run and controlled owner delivery |
| P1 Backups | Production plan explicitly lacks verified restore evidence | Confirm provider retention and complete an isolated restore drill with recovery time/data-loss evidence |
| P2 Square gift cards | Latest task response says local changes, no deployment/public activation at that point | Reconcile current deployed code/config; verify private $50 purchase and 1,250 JCMOVES once-only bonus before wider advertising |
| P2 Northwoods imports | Prior task reports implementation and tests; live OAuth polling was not exercised | Verify mailbox configuration and controlled import through review without automatic U-Haul acceptance |
| P2 Ashley photo/email | Prior task reports code/database safeguards but missing Gmail connection and enablement | Authenticate the intended mailbox, verify setup, deploy eligible work, and test multiple-image draft with Ashley-only final approval |
| P2 Facebook pilot | Prior task reports Page-locked deployment; Matt invitation/developer/tester steps remained | Recheck acceptance/authorization and complete a separately authorized scoped campaign test |

Marketing AI/object storage also report unconfigured in current public health. They are separate from basic website availability. Optional crypto/treasury settings are not prerequisites for customer booking restoration.

## Context and limits

This document combines the checked-out source, `MASTER_GAME_PLAN.md`, `PRODUCTION_EXECUTION_PLAN.md`, live probes, the recent project task inventory, and accessible turns from these tasks:

- `finish updates` (`019e456f-3131-7f91-b4cc-b8c1b373130e`)
- `Add availability failure alerts` (`01a06f3e-f663-7e93-ac29-676ec5d68aa9`)
- `Prepare Quick Book release` (`01a06f40-0fb6-7573-a051-ce43b8977289`)
- `Fix web-push VAPID readiness` (`01a06f40-4b93-71c3-8dd9-0fd36fa81cac`)
- `Verify Square eGift launch test` (`01a057dd-5121-73e2-b58b-d68be2045756`)
- `Finish JC Marketing Bot pilot` (`01a057dc-e49b-7e40-9e78-b7b54a367ab0`)
- `Finish booking import workflows` (`01a03e45-6f27-79b3-89b9-779b2bd6c58e`)
- `Finish Ashley photo-email workflow` (`01a03e45-6c47-7c60-a7e2-416546b5f9a2`)

This is a consolidated working status, not an export or literal merge of every historical conversation. The task-list interface exposes at most 50 recent unpinned tasks per call, and older turns have not all been read. Historical claims are labeled as such and do not substitute for current production proof.

The worktree contains pre-existing, unfinished changes across Quick Book, push and operations. They were preserved. GitHub CLI is not signed in. No application release, production payment, customer/crew message, or database mutation was performed by this recovery investigation.
# September 9 Replit backup update

The existing Replit Production Database now has automatic daily backups enabled with seven-day retention. After saving, its Settings panel confirmed `Scheduled backups On · kept 7 days`; point-in-time recovery remains on for seven days. The database is Active at approximately 103.86 MB. The panel still says `No backups yet`: enabling the schedule is not evidence of a completed backup or successful recovery.

An isolated recovery drill remains required. No live restore, credential rotation, migration or additional Neon database was performed. Replit's [data recovery documentation](https://docs.replit.com/features/data-and-storage/data-recovery) says backups run daily near midnight in the browser's time zone. Its [deployment preview documentation](https://docs.replit.com/features/data-and-storage/development-and-production#test-changes-with-a-deployment-preview) describes an isolated production copy for migration testing; availability for this project still needs inspection.

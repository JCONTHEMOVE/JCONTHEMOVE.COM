# Production alerting and database recovery evidence

## September 16 acceptance review — current decision

The owner selected the existing Better Stack integration. Use Darrell's already
confirmed company Gmail as the required delivery route. Discord is deferred and
is not required to close the email acceptance gate.

Both operational gates remain **OPEN**. This review changed documentation only:
no alert or monitor was activated, no message was sent, and no database restore,
retention change, account upgrade, application change, merge or production
deployment was performed.

| Evidence inspected on September 16 (UTC) | Result and limit |
| --- | --- |
| Reviewed application/tooling commit | `5a0f222a`; Operations Tooling, PWA assets and Quick Book release checks passed on that commit. This is code-validation evidence, not live alert acceptance. |
| Current main and production | Main is `897dbbf4`. A read-only public readiness GET returned `ready` for app and database at `2026-09-16T23:07:06.333Z`, reporting that same commit. |
| Changes since the draft refresh | Main is four commits ahead of the common ancestor. The changed paths do not include the operational workflow, reporter or database schema. This review did not refresh or merge the application branch. |
| Active workflow | Main still requests `7,27,47 * * * *` (20 minutes) and has no Better Stack reporting job. The draft's ten-minute schedule and sender are not active on main. |
| Observed schedule | The latest 20 availability schedule runs retrieved span `2026-09-13T16:33:02Z` to `2026-09-16T20:20:10Z`. All succeeded; adjacent start gaps were 119.03–422.70 minutes. These are monitoring gaps, not proof of website outages. |
| Independent uptime coverage | Required before activation; Better Stack account, plan entitlements, monitor/policy assignment and live probing could not be inspected. |
| Provider history configuration | Authenticated Neon metadata for the recovery-migration project reports 21,600 seconds (six hours). Current Railway-to-project/branch mapping and actual earliest/latest usable recovery points remain unverified. |
| Snapshot inventory | Neon returned no snapshots and an empty snapshot schedule for the inspected migration branch. This does not mean PITR history is absent and does not establish off-provider backup coverage. |
| Plan discrepancy | The live provider account reports `launch_v3`, while the September 15 note records an earlier Free-plan choice. Billing/support entitlement needs private verification; no plan or retention was changed. |
| Recovery execution | Not run. A validated recovery point, independently grounded baseline and positively identified isolated target are still required. |

Private provider/endpoint identifiers and account evidence belong in the
restricted acceptance record, not this public repository. Railway access was
not connected in this review. Better Stack browser access stalled; no
authenticated configuration or delivery result is claimed. GitHub secret
configuration and workflow dispatch were not available through the connected
repository tools.

### Minimum remaining acceptance

1. Inspect the existing Better Stack account and its entitlement to the chosen
   email escalation policy. Configure the independent readiness probe and two
   distinct heartbeat records below; verify Darrell is the only required
   responder and attach the same policy to all three. Store the two heartbeat
   URLs privately in the named GitHub Actions secrets. Leave the production
   heartbeat unprimed until the automatic main workflow is ready.
2. **Drill A — failure, deduplication, escalation, recovery.** Dispatch the
   reviewed draft with `alert_drill=true`, phase `fail`. Require the reporter
   job to succeed even though the readiness job deliberately fails. Record a
   real email receipt and the provider incident ID. Repeat failure once to
   verify one open incident. Leave it unacknowledged through T0+15, +30 and +60
   minutes and retain actual receipt/timeline evidence. Dispatch phase
   `resolve`; require one recovery notice and stopped escalation.
3. **Drill B — missing check and acknowledgement.** Prime only the separate
   drill heartbeat, then withhold it for ten minutes plus five minutes of grace.
   Verify the missed-check incident and real email receipt. Darrell acknowledges
   it; retain evidence that paging stops while the incident remains unresolved.
   Observe through the next configured escalation checkpoint. Resolve using
   the drill success signal, verify recovery and pause the drill heartbeat.
   Neither drill may refresh or resolve the production heartbeat.
4. Verify delayed/queued-run behavior and continued independent uptime probing.
   Serialization does not guarantee ordering. Do not infer this proof from
   passing unit tests or a green manual run.
5. After these results and release review, the operational change can be
   considered for merge. Verify the first automatic main heartbeat and actual
   monitor timestamps before closing the alert gate; ordinary manual health
   checks do not activate or refresh production monitoring.
6. For recovery, first match Railway's active endpoint to the provider without
   exposing credentials. Record actual recoverable bounds, select retained
   point T, then restore to a new disposable branch/compute and run the existing
   SQL verifier in read-only mode with stop-on-error. Use an independently
   supported same-T baseline or explicitly limited pre-T evidence. Record
   recovery-point lag and validated data-recovery duration, confirm production
   mapping/readiness is unchanged, and record target cleanup status. Never
   restore/reset the production branch or start this app against the copy.

## September 15 status — historical context

PR #8 has been integrated with main through `f544cd45`, preserving the released
application. The draft now checks apex and www home/booking entrypoints and
referral-query preservation alongside readiness. A healthy www response cannot
hide an apex outage. These checks are skipped during isolated alert drills.

The September 14 owner instruction selects the company Gmail account for alerts
until other channels are configured. Use that confirmed address in private
incident-service configuration. Discord is a deferred optional channel, not a
prerequisite for email activation. Mailbox access is not automated delivery proof.

The database migration and Railway-only cutover completed September 10. The final
logical copy matched 202 tables, 47,690 rows, 520 public constraints, 534 indexes
and all 63 sequence states, including per-table content comparison. Source Replit
was paused and retained for rollback. The owner selected the new database's Free
plan with six-hour recovery history. Preserve the original source and archives;
never run an old target-refresh script against the now-live database. A successful
logical migration does not prove a current provider PITR restore or measured
incident RPO/RTO. The September 6 unavailable-access notes below are historical.

Alert activation remains open: incident-service account/plan, independent uptime
probe, separate production/drill heartbeat secrets, and actual email receipt,
acknowledgement, escalation, missed-check and recovery evidence are unverified.
Keep this draft unmerged until private configuration and activation are ready.
Serialized jobs prevent overlap but do not guarantee queue order; delayed-run
behavior remains an acceptance requirement and the external uptime probe is
required. No monitor, subscription or live alert was created by this integration.

## Historical September 6 evidence

Evidence date: 2026-09-06 (UTC). Scope: the two operational readiness gates in
`PRODUCTION_EXECUTION_PLAN.md`. Both gates remain **OPEN** until live evidence
is recorded. The preparation below does not certify delivery or recovery.

## Confirmed ownership

**Darrell Jackson is both the business owner and the technical responder.** He
explicitly confirmed this and his primary email in the September 6 session.
There is no separate technical-contact identity to obtain. Escalation means
repeating unacknowledged email to Darrell and having him engage the affected
provider if an incident persists. Another verified channel can be added later.

| Destination | Decision | Live configuration and proof |
| --- | --- | --- |
| Email | Darrell's directly confirmed primary address; store the exact address in private incident configuration. | Not verified; a successful test must reach that inbox. |
| Discord | Deferred optional operational alert channel. | No Discord configuration or receipt is required for the current email-only acceptance. |
| Website notification bell | Existing signed-in in-app notices need no native app download. | Supplemental only; outage alerting must work when the app/database is unavailable. Phone/browser push remains unproven following the September 3 missing-VAPID result. |
| Provider support | Darrell engages Railway for hosting or the verified database provider for data issues. | Record the account's actual support entitlement and case reference during an incident; no response-time guarantee has been verified. |

Measure existing database protection before recommending retention, maximum
acceptable data loss (RPO), or recovery time (RTO). These operational changes
do not alter booking, pricing, customer messages, payments, rewards, or crew
notification behavior.

This repository is public. Keep full alert addresses, secret URLs, database
credentials, backups, customer data, and private provider evidence outside it.
Commit sanitized results and restricted-record references only.

## Evidence obtained

| Control | Observation | Meaning |
| --- | --- | --- |
| Live readiness | At `2026-09-06T14:33:30.636Z`, `/api/health` returned HTTP 200, application/database `ready`, and commit `25b985e4a8369bed94144421a8e2908fa15abd97`. | A healthy point-in-time observation. |
| Readiness contract | `server/index.ts` calculates readiness from completed boot, database connectivity, and required environment values, then returns 200 or 503. `/health` is a separate liveness response. | The independent monitor must use `/api/health`. |
| Prior cadence | Main configured `7,27,47 * * * *`. | Twenty minutes, despite the plan's ten-minute requirement. |
| Draft cadence | `7,17,27,37,47,57 * * * *`. | Ten-minute requests after merge; GitHub scheduling remains best effort. |
| Actual execution | The latest 20 retrieved scheduled runs span September 4, 01:03:21 UTC to September 6, 13:08:47 UTC. All succeeded, with adjacent start gaps of 106.25–297.47 minutes. | Large monitoring gaps, not evidence of website outages. See `availability-runs-2026-09-06.json`. |
| Last inspected run | [34035201876](https://github.com/JCONTHEMOVE/JCONTHEMOVE.COM/actions/runs/34035201876), readiness job `101491880224`, succeeded. | Existing verifier works; main had no explicit alert sender. |
| Draft reporting | `scripts/report-availability.mjs` sends automatic main-run results to an independent heartbeat and isolates fail/resolve drills. | Implemented and tested locally; no live heartbeat or delivery is configured or proven. |
| GitHub identity | Authenticated owner and observed scheduled actor are `JCONTHEMOVE`. | Does not prove notification settings or email receipt. |
| Existing notifications | The admin layout uses `notification-bell.tsx` and `notification-list.tsx`; `jobEventBus.ts` supports job-event Discord webhooks. | Does not establish an operational outage route or its Discord audience. |
| Database | `server/db.ts` uses the Neon PostgreSQL driver and `DATABASE_URL`. No authenticated production mapping, retention evidence, or restore result was available. | Provider clue only; backup protection remains unverified. |

During the September 6 review, Neon was connected but project/branch/SQL actions
were not exposed and no authenticated CLI was available. Railway access was requested
to inspect the live host configuration and verify the production database
mapping. Neither retention settings nor production data have been changed.

## Alerting gate

### Selected monitoring arrangement

Use Better Stack, as selected by the owner on September 16, for the following
three records. Its account and entitlements remain unverified; this review has
not created an account, subscription or monitor. Inspect existing resources
before creating duplicates. Confirm any new plan cost before subscribing.

| Record | Configuration to apply | Incident meaning |
| --- | --- | --- |
| `JC production readiness` | External HTTPS GET of `https://www.jconthemove.com/api/health`; expected HTTP 200; interval no longer than 10 minutes; timeout 15 seconds; record the service's failure-confirmation/recovery settings. | Production readiness failure, including database/required-env failure. It continues probing if GitHub stops running. |
| `JC availability verifier` | Expect a successful heartbeat every 10 minutes with 5 minutes of grace; attach Darrell's incident policy. | Verifier failure or missing check. The fifteen-minute missing-check threshold is not a fifteen-minute uptime-check cadence. |
| `JC availability DRILL` | A distinct heartbeat, clearly labeled drill, with the same recipients and escalation settings as the verifier heartbeat. | Safe delivery/escalation rehearsal; never marks production recovered. |

The separate uptime probe provides coverage while GitHub's observed long gaps
are investigated. Heartbeat-only monitoring would detect those gaps but would
not restore ten-minute checks of the website.

The reporter uses Better Stack's documented success URL and `/fail` endpoint.
The service can open incidents when heartbeat requests fail to arrive. A new
heartbeat remains pending until its first request: verify activation, then
deliberately withhold a test heartbeat to prove missing-check alerting.
[Heartbeat documentation](https://betterstack.com/docs/uptime/cron-and-heartbeat-monitor/).

### Delivery configuration

1. Set Darrell as the named responder and verify his already approved email in
   the incident service. Native GitHub Actions email can remain an additional
   signal, but scheduled recipients depend on cron ownership/settings and need
   separate receipt evidence.
2. Configure email to Darrell only for the initial acceptance. Inspect the
   account's actual policy entitlement and receipt/recovery settings. Do not
   enable default team-wide or unrelated integrations.
3. Discord is deferred. If added later, separately verify its exact operational
   destination, payload, audience and receipt. Do not redirect
   `DISCORD_JOB_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL`, or the shared crew invite.
   [Outgoing webhooks](https://betterstack.com/docs/uptime/webhooks/).
4. Put the two distinct canonical heartbeat URLs in GitHub Actions secrets:
   `OPS_HEARTBEAT_URL` and `OPS_DRILL_HEARTBEAT_URL`. They are operational
   credentials, not application environment variables. The draft rejects
   missing destinations, redirects, noncanonical URLs, and a drill URL that
   equals the production URL.
5. Attach the incident policy to the uptime monitor and both heartbeats.
   Creating a policy alone does not apply it to existing monitors.
   [Escalation policy assignment](https://betterstack.com/docs/uptime/escalation-policies/).

No email, Discord message, in-app notice, or push has been sent in this review.
The service account, secrets and live email policy remain unverified. Discord,
app downloads and production VAPID changes are not prerequisites for the
selected email-only outage route.

### Single-responder escalation policy

T0 is the first detected failure or missing-check incident, not each retry.
Repeated failures stay attached to that open incident. Keep readiness and
missing-verifier incidents distinguishable; never label a missed run as a
confirmed website outage.

Configure successive delays of 15, 15, and 30 minutes to reach T0+15,
T0+30, and T0+60.

| Time | Automated notification to configure | Darrell's response |
| --- | --- | --- |
| T0 | Email Darrell and record the incident in Better Stack. | Open the incident and check its evidence; acknowledge ownership. |
| 15 minutes | If unacknowledged, repeat email to Darrell. | Inspect Railway deployment/logs and the strict readiness result; record diagnosis and next update. |
| 30 minutes | If still unacknowledged, repeat email with provider-support instructions. | If still unresolved, contact the affected provider using the account's available support route and record the case reference. |
| 60 minutes | If still unacknowledged, repeat email and request an incident decision. | Review impact and recovery/containment options; record a decision and next update time. |
| Recovery | Send one recovery notice for the affected monitor and stop its pending escalation. | Confirm a fresh successful check; retain the incident timeline. |

Acknowledgement records Darrell's ownership and may stop automated wake-up
messages; it does **not** mean recovery. Better Stack explicitly stops escalation
on acknowledgement. Once acknowledged, Darrell owns the unresolved-incident
checkpoints above and records the next update in the incident. No separate
automated post-acknowledgement reminder has been implemented or claimed.
[Acknowledgement behavior](https://betterstack.com/docs/uptime/api/acknowledge-an-ongoing-incident/).

Provider support paths: [Railway support](https://docs.railway.com/platform/support)
and, if the production database mapping confirms Neon,
[Neon support](https://neon.com/docs/introduction/support). Check account access
and support entitlement; community support is not a guaranteed on-call engineer.
There is one named human responder. No separate backup person is configured.

For each alert, include the business name, `OPEN`/`REMINDER`/`RECOVERED`/`DRILL`,
affected check, first-detected UTC time, elapsed duration, incident link, the
safe workflow-run link when relevant, and the next action. Do not include raw
health JSON, private customer information, or connection strings. Routine
successful checks should remain quiet except for recovery transitions.

### Activation and drill evidence

Status: **NOT RUN LIVE**. The reporter has automated tests with fake HTTP
responses; these are not email, Discord, timing, or recovery evidence.

1. Complete the private account/destination/secret configuration above. Verify
   Darrell can receive email at the confirmed company mailbox.
2. Run `Production Availability` on this reviewed branch with
   `alert_drill=true`, `alert_drill_phase=fail`. The readiness job intentionally
   fails before its checkout, Node setup, or production verifier. The separate
   reporting job checks out only to execute the operational reporter; it never
   runs the app or the production verifier.
3. Verify the provider created a **drill** incident and record Darrell's actual
   email receipt times. Leave this rehearsal unacknowledged to verify
   the configured 15/30/60-minute wake-up sequence. Test acknowledgement during
   the separate missed-check rehearsal in step 5.
4. Resolve the synthetic incident with `alert_drill=true`,
   `alert_drill_phase=resolve`. Record the drill recovery notice and stopped
   escalation; production monitoring must remain unaffected. Pause the drill
   heartbeat after evidence is complete so it cannot create forgotten-test
   missing-heartbeat alerts.
5. For a missed-check rehearsal, enable only the drill heartbeat, send its first
   signal, then withhold further pings for its interval plus grace. Verify the
   missing-check incident and real email receipt. Have Darrell acknowledge it;
   verify that paging stops while it remains unresolved, observing through the
   next configured escalation checkpoint. Resolve and pause the drill again.
6. After configuration and review, merge the operational change and verify the
   first automatic main run activates the production heartbeat. Record that
   the independent uptime monitor is actively probing the strict endpoint.
   Observe delivery on the normal route and measured check intervals before
   closing the gate. Account for any platform confirmation/grace delay.

Ordinary manual health verification does not send production heartbeats, so it
cannot hide a missing scheduled run or resolve the production incident using
an alternate health URL. Automatic workflows are serialized; reporting handles
success, failure, cancellation, and skipped readiness jobs. If GitHub never
starts the workflow or its reporting job, the independent service must alert
on the absent heartbeat. Missing secrets cause a visible reporting failure.

Record: private destination references; service/monitor/policy IDs; tested ref
and run; first failure time; accepted-send responses; actual email
receipt and acknowledgement times; timed escalation results; acknowledged but
unresolved handling; recovery/deduplication results; missed-check test; actual
ongoing coverage; reviewer/date. An HTTP accepted-send result is not proof that
Darrell received or read the alert.

## Database recovery gate

### Measure existing protection first

Do not change retention or plan tier as part of discovery. Using authenticated
production host and database metadata, fill in the following restricted record:

| Evidence | Current result |
| --- | --- |
| Hosting service and active production database endpoint match | Pending; match the host's active `DATABASE_URL` to the provider project/branch without exposing its password. |
| Database provider, organization, project, branch, database, region, PostgreSQL version, plan | Neon metadata for the recovery-migration project was inspected September 16 (PostgreSQL 16, AWS US West 2); current production mapping and billing entitlement remain unverified. Keep identifiers private. |
| Configured PITR/history retention | Inspected project reports 21,600 seconds on September 16; current production mapping and actual available history remain unverified. |
| Earliest and latest currently restorable time or LSN | Not verified; configured retention alone does not prove available history. |
| Scheduled snapshots/exports: successful timestamps and failures | September 16 Neon snapshot inventory and branch schedule are empty. External exports and independent backup coverage remain unverified. |
| Retention of snapshots/exports, destination, access and encryption controls | Not verified |
| Protection against loss of the primary provider/account | Not verified; same-provider PITR is not independent off-provider recovery. |
| Maximum observed backup gap and age of newest usable recovery point | Not measured |
| Existing RPO/RTO commitment | None verified; owner requested measurement before recommendation. |

Measure snapshot/export cadence separately from PITR history. An available
provider feature, a healthy connection, a filesystem snapshot, or a freshly
created dump is not proof that the existing retention policy works.

### Isolated restore procedure

Status: **NOT RUN**. Use an actual retained recovery point from the active
production database, not a schema-only branch, toy fixture, or a fresh export
presented as historical backup proof.

1. Confirm the provider/project/branch mapping and access above. Capture the
   actual earliest/latest recoverable timestamps and choose an explicit UTC
   point **T** inside the available history. For a snapshot/export, record its
   immutable identifier, completion time, and checksum when available.
2. Capture source expectations corresponding to **exactly T**: use the
   provider's read-only historical view, an independently recorded consistent
   backup manifest, or a consistent source snapshot tied to the backup's
   LSN. Record counts, relevant totals, schema/index inventory, and known
   pre-T business records. Do not require current production counts to equal
   an older restore. If no independent baseline exists, record that limitation
   and use verifiable pre-T audit records; do not claim a full equality check.
3. Start the recovery timer before the restore request. Create a uniquely
   named, private, disposable target such as `restore-drill-20260906-<suffix>`.
   Verify its project/branch/endpoint is distinct from active production before
   restoring. Do not change production's default branch, compute endpoint,
   connection string, or DNS.
4. If Neon is confirmed, create a new child branch from **Past data** at T,
   with a separate compute, and await successful provider operations. Do not
   invoke restore/reset on the production branch. If the actual provider is
   different, use its documented restore-to-new-database operation. If using
   `pg_restore`, target a fresh empty database and stop on the first error;
   never use a production target or `--clean` on an existing database.
5. Use SQL only against the restored target. **Do not start this application's
   server, run migrations, mount production credentials in an app process, or
   connect webhooks, schedulers, email/SMS, Square, push, or wallet signing to
   the restored copy.** Startup code includes data migrations and integrations
   that would invalidate an untouched restore and could emit side effects.
6. Run `scripts/verify-restored-database.sql` with a read-only transaction and
   stop-on-error enabled. It emits aggregate counts, schema/index definitions,
   financial/reward totals, and orphan/duplicate counts; it does not emit
   customer records. Run it on the same-T reference when available and compare
   results. Missing tables/columns are a validation failure to investigate,
   not permission to migrate the restore. Retain outputs privately.
7. Confirm known pre-T bookings, quotes, payment records, worker payouts,
   rewards and idempotency records exist with the expected relationships. Use
   sanitized references, not public customer details. Check post-T exclusions
   when independently known. Review any pre-existing duplicate/orphan counts
   against the baseline rather than silently repairing them.
8. Stop the timer only after the restored data is accessible and the checks
   pass. Record request time, provider-ready time, first successful query, and
   validated time. This measures isolated data-recovery time, not full
   customer-service RTO; no application cutover is being tested.
9. Record `observation time - latest usable recovery point` as measured
   recovery-point lag. The age of the deliberately selected T is the drill's
   lookback, not the system's best achievable RPO. Do not infer a contractual
   guarantee from one measurement.
10. Recheck live readiness and unchanged deployment/database mapping. Record
    the drill target's expiration/cleanup plan; remove only the positively
    identified disposable target under the applicable deletion approval.
    Preserve private evidence and a sanitized result in this record.

Example validation invocation from an authenticated operator environment:

```bash
# RESTORE_DRILL_DATABASE_URL must identify the isolated target, never production.
PGDATABASE="$RESTORE_DRILL_DATABASE_URL" psql -X -v ON_ERROR_STOP=1 -f scripts/verify-restored-database.sql
```

Do not put connection URLs, backups, SQL outputs containing business totals,
or unredacted screenshots in public GitHub Actions artifacts or this repository.

### Restore evidence fields

Drill ID; operator; private provider/project/branch mapping; measured retention;
earliest/latest recoverable point; chosen T/LSN or backup ID/checksum;
source-baseline provenance; isolated target and proof it is not production;
operation result; start/provider-ready/query/validated timestamps; recovered
schema/index and business-data validation results; orphan/duplicate comparison;
measured lag and data-recovery duration; limitations; unchanged-production
proof; cleanup status; reviewer and date. Leave unknown fields pending.

### Recommend targets after measurement

After a successful drill, report actual retained history, recoverable-point
lag, successful backup intervals, isolated data-recovery time, and untested
failure modes. Recommend retention, RPO and RTO separately, explaining any gap
between observed capability and business need. Include time for incident
detection, response, validation, and controlled application recovery in any
full-service RTO recommendation. Present changes and costs for an owner
decision; do not turn measured values into promises or silently change settings.

## Gate decision

Local validation passed for workflow YAML, six evenly spaced requested
10-minute slots, default-off drill input, exclusion of production steps from
the drill, the intentional nonzero exit, shell syntax, both evidence-summary
modes, and the public run-evidence JSON. The SQL was reviewed against the
repository schema and statically checked for read-only statements. No live
PostgreSQL execution, notification receipt, timed escalation, or restore test
is claimed by these checks.

| Gate | Status | Required to close |
| --- | --- | --- |
| Recipient and escalation | OPEN | Darrell is confirmed as owner and technical responder, and his email is confirmed. Better Stack is selected. Its account/entitlement, private secrets/policy configuration, actual email receipt/escalation/acknowledgement/missed-check/recovery evidence and measured external monitoring coverage remain open. Discord is deferred. |
| Backup retention and restore | OPEN | Authenticated production retention/recovery-point evidence and one successfully validated, documented isolated restore. |

This operational work does not approve other payment, payout, notification,
marketing, or reward release gates.

## References

- [Current production plan](../../PRODUCTION_EXECUTION_PLAN.md)
- [Availability workflow](../../.github/workflows/production-availability.yml)
- [GitHub workflow notification routing](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs)
- [GitHub scheduled-event behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [Neon backup strategies](https://neon.com/docs/manage/backups)
- [Neon branch creation and isolation](https://neon.com/docs/manage/branches)

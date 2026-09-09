# Canonical payments and rewards: release status

Updated September 9, 2026. Implementation is a draft candidate, not a deployed service. Square canonical adapters are connected behind disabled flags; the additive payment schema is not registered as a startup migration. Do not enable the production flags yet.

## Implemented

- Canonical payments: unique provider/payment identity, integer-cent USD amounts, approved source quote, current quote/lead-total agreement, cumulative coverage and gift-funded exclusions. Payments and paid markers commit together under a job row lock.
- Refunds: unique refund identity, original-payment association, cumulative amount/funding limits, and net reconciliation. Refund-first delivery records the verified original payment and refund atomically without briefly marking the job paid. Tipped refunds require explicit allocation and currently fail closed.
- Square adapters: retrieve payment/refund records from Square, validate completed status, location, currency, funding and stored order/job/quote association. Sandbox and production identities are separate. The signed webhook calls these adapters only when both ledger and Square flags are enabled.
- Reward settlement: uses the persisted award amount/rate on retry, validates recipient/job identity, and commits reward record, wallet credit and settlement marker atomically. Ambiguous legacy reward history requires reconciliation. Advisory locks remain on one checked-out connection.
- Canonical reward funding: uses net payment-ledger funding and approved quote totals. Wallet settlement rechecks completion, payment coverage, refunds and reward basis under the job lock. Gift-funded dollars do not earn ordinary customer rewards.
- Durable reward queue: unique handoffs, atomic enqueue after completed/full payment, a sweep for payment-before-completion, expiring claims, stale-worker fencing and bounded retry timing. The worker verifies durable customer/crew settlement before finishing the claim. Pending customer claims remain explicit ledger reservations.
- Admin reconciliation: an authenticated admin/owner endpoint and expandable job panel show payments, refunds, mismatches, paid/reward markers and queue attempts/status. Disabled retries display as paused. The report does not claim to audit every wallet transaction.
- Existing-path guards: wallet intent does not imply payment; underpaid/deposit invoices do not establish full-job settlement; invoice sync uses the same classification and bypasses legacy accounting in canonical mode. Shop-card grant failures propagate for webhook retry.
- Overpaid invoices retain their collected amount for reconciliation, but job accounting and cash-credit grants cap at the job total. Fourteen classification tests passed, including overpayments with and without a prior deposit. Excess collection does not authorize an automatic refund.
- Invoice effect claims distinguish completed duplicates from work in progress. Each attempt has a fresh ownership token, so an expired handler cannot complete or fail its replacement. Busy deliveries remain retryable. Disposable tests cover additive schema repeatability, legacy completed invoices, expiry, same-event retries and stale writes; the harness is also registered in PostgreSQL CI. Webhook events now also use attempt ownership tokens, and reject an existing event ID with a changed payload hash. Disposable event tests cover stale completion/failure, failed retries and legacy completed history. Complete provider-flow acceptance remains open; claim ownership does not make every side effect atomic.

## Flags and deployment prerequisites

All new flags are disabled by default:

| Flag | Effect |
| --- | --- |
| `JOB_PAYMENT_LEDGER_ENABLED` | Enables canonical ledger services and invoice coverage requirements; Square routing also requires its adapter flag. |
| `SQUARE_JOB_PAYMENT_LEDGER_ENABLED` | Routes supported signed Square payment/refund events into canonical adapters. |
| `JOB_PAYMENT_REWARDS_ENABLED` | Allows canonical reward settlement and queue operations. |
| `JOB_PAYMENT_REWARD_WORKER_ENABLED` | Along with the ledger/reward flags, starts the bounded worker sweep. |

Apply and verify the additive schema before enabling these flags. Existing ledger rows need approved-quote backfill before a non-null quote-revision column can be introduced. No production flag, payment migration, wallet issuance or live restore has been performed in this work.

## Verified evidence

- Current application candidate `c537e3cd` passed full CI in run [34392419048](https://github.com/JCONTHEMOVE/JCONTHEMOVE.COM/actions/runs/34392419048). This includes overpayment caps, invoice/event attempt ownership, payload identity, separate-session PostgreSQL initial/expired claim races, and all existing release checks. It is candidate validation, not production deployment or end-to-end provider acceptance.
- Full CI passed at `19892678` in run [34387746590](https://github.com/JCONTHEMOVE/JCONTHEMOVE.COM/actions/runs/34387746590): Node 20 type checking, server/authorization tests, PostgreSQL concurrency, monitoring tests, build and PWA checks.
- PostgreSQL concurrency includes distinct backend sessions, competing/duplicate payments, excessive concurrent refunds, advisory-lock contention, exactly-once wallet credit, canonical gift-adjusted replay and a refund racing settlement. The race test observes PostgreSQL blocking before committing the refund and verifies no reward/wallet row is created afterward.
- Local disposable database tests cover migration repeatability, payment/refund rollback and replay, changed-rate settlement retry, gift exclusions, queue deduplication/expiry/fencing, incomplete-proof and missing-crew rejection, completed worker proof, and payment-before-completion handoff.
- The queue/worker harness now also runs in a dedicated PostgreSQL CI step. Its PostgreSQL execution passed at `637ea010` in run [34388707086](https://github.com/JCONTHEMOVE/JCONTHEMOVE.COM/actions/runs/34388707086), together with the full release suite. Later commits are not validated by earlier green CI.
- A synthetic desktop browser preview verified reconciliation totals, refund display, retry warnings, paused processing and empty/disabled states. It does not prove live owner-account or mobile acceptance.
- Twelve invoice-classification tests and the server build passed for the invoice-sync correction.
- Full release CI also passed at `04c47671` in run [34389507530](https://github.com/JCONTHEMOVE/JCONTHEMOVE.COM/actions/runs/34389507530), including the staged Square event resolver.
- Atomic job cash credits passed full CI at `62a9214a` in run [34390434968](https://github.com/JCONTHEMOVE/JCONTHEMOVE.COM/actions/runs/34390434968), including concurrent cross-source grants in PostgreSQL and rollback after wallet/reward/transaction failures.

## Remaining release work

1. Complete end-to-end acceptance of the newly wired, flag-gated Square path and all legacy side effects. Known unrelated events retain their existing handlers; unmapped events remain failed and retryable for reconciliation.
   A staged resolver now retrieves payment/refund records and classifies stored order associations as job, unrelated, or unmapped. Missing/ambiguous quote associations reject for reconciliation. Focused routing tests passed. The resolver is now called by the webhook. Canonical invoice handling waits for verified payments for its stored order and uses cumulative job coverage. Deposits, early invoice delivery, unrelated orders and refund review passed disposable database tests. Provider/signature-to-effects acceptance and concurrent quote/refund coordination remain open.
   Accounting audit: job cash credits now lock the lead and commit wallet balance, reward identity and transaction together; failures propagate to the caller. Revenue allocation and contribution-count updates also commit together, retain one allocation per job, and increment counts in SQL. Disposable tests prove allocation rollback after a failed count update and cross-source replay; PostgreSQL CI now includes simultaneous same/different-job allocations. The revenue change passed full CI at `8f7e9f6a` in run [34390890663](https://github.com/JCONTHEMOVE/JCONTHEMOVE.COM/actions/runs/34390890663), including these PostgreSQL checks. These changes prevent new partial writes but do not reconcile historical ones. Broader invoice retry coordination remains open.
2. Complete tipped-refund allocation and approve treatment of already-issued rewards after refunds. No automatic reversal policy has been approved.
3. Coordinate quote/completion writers with reward settlement, including newly approved quote revisions and assignments changing during retries.
   Invoice order coverage and cumulative job coverage now share a repeatable-read snapshot. A PostgreSQL CI regression inserts a payment between these reads and requires the original attempt to retry, then see full coverage. This prevents mixed snapshots; it does not yet serialize all later invoice effects with quote/refund changes.
4. Verify migration against the actual production schema and reconcile historical paid/reward markers. Complete an isolated Replit production recovery drill. Scheduled backups are enabled; first-backup success and recovery have not been proved.
5. Complete provider/signature-to-ledger-to-worker acceptance, including actual customer/crew wallet reconciliation and both payment/completion orders. Existing tests exercise these components separately and do not replace the full flow.
6. Run one specifically authorized controlled live payment/job test, verify duplicate delivery does not duplicate rewards, and verify disabling the feature preserves ordinary checkout.
7. Complete authenticated owner/mobile UI acceptance and check the latest candidate CI before deployment. Optional PayPal/crypto adapters remain later work and must not be advertised as enabled.

## Test commands

```text
node --import tsx scripts/check-job-payment-ledger.ts <pglite-dist-index.js>
node --import tsx scripts/check-job-ledger-settlement.ts <pglite-dist-index.js>
node --import tsx scripts/check-job-ledger-settlement.ts --postgres
node --import tsx scripts/check-payment-concurrency.ts
```

PostgreSQL modes require `TEST_DATABASE_URL` targeting a local disposable database named `jc_ledger_test`. They never fall back to production `DATABASE_URL`. The worker harness creates a unique schema on one dedicated connection; concurrency tests use separate connections. Local harnesses replace connection methods only inside their process.

Square mapping follows the [Payment object](https://developer.squareup.com/reference/square/objects/payment) and [refund documentation](https://developer.squareup.com/docs/payments-api/refund-payments). Principal excludes tips; refunded payments can retain COMPLETED status, and cross-method refunds require separate verified refund handling.

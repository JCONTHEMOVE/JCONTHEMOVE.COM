# Canonical payment ledger — implementation and release gates

The initial service is `server/services/jobPaymentLedger.ts`. It is **disabled by default and not wired to any route or startup migration**. `JOB_PAYMENT_LEDGER_ENABLED=true` alone does not switch Square or wallet checkout to this service. Do not enable it in production yet.

Implemented: immutable `(provider, provider_payment_id)` identity, integer-cent input validation, USD-only settlement, a per-job row lock, cumulative confirmed payments, separately stored gift-funded cents, atomic payment recording and paid timestamp, and rejection of conflicting replays. The service does not dispatch, issue rewards, send messages, or change existing provider handling.

Verification: the policy test covers invalid amounts/currency/timestamps, partial and full payment, one-cent shortfalls, overpayment, and gift-funded exclusions. `scripts/check-job-payment-ledger.ts` runs the real service against a disposable PGlite database. It passed repeated schema execution, the disabled gate, cumulative settlement, duplicate/conflicting replay, gift exclusion, transaction rollback, and successful retry without another payment row. This is not a concurrent-session or production-schema test.

Remaining requirements from issue #7:

- Implement verified provider adapters using provider payment IDs, not invoice IDs. Never accept client payment-success claims.
- Record metadata and finalized quote/revision identity, and reconcile existing paid markers before migration. The foundation reads `leads.total_price`; approval/revision provenance must be enforced before activation.
- Add auditable refunds/reversals and determine the owner-approved treatment of already-issued rewards. No refund policy has been approved in this task yet.
- Add a durable reward-trigger queue behind a separate disabled-by-default flag, using the existing completed-and-paid gates. Preserve gift-funded exclusions and editable reward rates.
- Add the authenticated owner/admin reconciliation view and surface partial payments, conflicts, refunds, and failed reward attempts.
- Verify competing payments in separate PostgreSQL sessions, transaction failures and replay, actual provider signatures/server verification, refund ordering, both payment/completion orders, reward exactly-once behavior, and wallet/ledger balances.
- Complete an isolated production-schema/restore check and one specifically authorized live payment test before switching any adapter or enabling automatic rewards.

Run the disposable database check with an installed PGlite module:

```text
node --import tsx scripts/check-job-payment-ledger.ts <path-to-pglite-dist-index.js>
```

The harness replaces the connection method only within its own process and uses synthetic jobs. It does not read production data or apply migrations to the configured database.

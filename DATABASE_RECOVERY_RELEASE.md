# Replit production recovery gate

The production database is owned through the original Replit project. At approximately September 10, 2026 05:01 UTC, the production settings showed Active, 103.95 MB of 100 GB, seven-day point-in-time recovery and daily backups retained seven days. The first scheduled backup is now verified in the provider UI: View all backups lists `Sep 10, 2026, 12:00 AM`, type `Scheduled`, kept for seven days. This is midnight America/Chicago (05:00 UTC); the settings also showed Last backup 37 seconds ago just after midnight. This supersedes the earlier No backups yet observation. It proves a provider-listed recovery point, not restored data fidelity or an isolated recovery drill. The dialog was closed without selecting Restore; no credential, schedule or database change occurred.

Use Replit first. Additional Neon databases are optional only after identifying a suitable recovery destination. Do not use the unrelated connected Neon projects as evidence for this database.

## First scheduled backup timing and isolation

Replit's current [data recovery documentation](https://docs.replit.com/features/data-and-storage/data-recovery) says scheduled backups create one daily restore point near midnight in the browser time zone used when the schedule is enabled or updated. The first scheduled entry, recovery-point time and seven-day retention are now recorded above. The earlier empty list was observed before this midnight window and did not establish a backup failure. Do not reset the schedule.

The same documentation says restoring a scheduled backup switches the connected database to that data. The inspected restore control is not proof of an isolated destination and must not be used for the recovery drill. Replit documents production access from PostgreSQL-compatible clients in [Connection details](https://docs.replit.com/features/data-and-storage/connection-details), but that does not establish a separate restore target. The isolated destination and same-point baseline gates below remain open. A newly remixed development database is also not proof that production data was restored.

## Evidence needed to close recovery

### Production schema baseline, September 10

A metadata-only PostgreSQL inspection on September 10, 2026 connected to the previously verified Replit production hostname. The transaction used repeatable-read isolation, confirmed `transaction_read_only = on`, bounded statement and lock waits, and rolled back. It inspected public-schema columns, constraints and indexes without reading customer rows or running migrations. Raw evidence stays private outside the repository.

The inventory contains 201 public tables and 2,713 columns. Existing `leads`, `quote_revisions`, `job_closeouts`, `square_invoices`, `square_webhook_events`, `job_alert_deliveries` and `job_webhook_deliveries` are present. Alert constraints include unique `(event_id, recipient_user_id, channel)` and webhook unique `(event_id, webhook_url_hash)`.

The candidate's `quick_booking_sessions`, `job_confirmed_payments`, `job_confirmed_refunds`, `job_reward_queue`, `job_invoice_reconciliation_queue`, `job_financial_notifications` and `square_invoice_intents` are absent. Keep their release flags disabled pending migration and acceptance gates. This inventory establishes a current schema baseline only: it is not a same-recovery-point baseline, full migration compatibility check, successful backup or isolated restore.

An offline compatibility check then created the collector's 16 referenced tables in an empty local PGlite database using the saved production column inventory and executed the actual collector SQL successfully, including its read-only transaction. All referenced tables are present and the queries resolve against those columns. The inventory lacks array element types, so arrays were represented as `text[]`; constraints, indexes, defaults and rows were not reproduced. This checks column compatibility only, not production query performance, data integrity or restoration. No additional production query was made for this check.

1. Provider-listed recovery point verified: September 10, 2026 at midnight America/Chicago, scheduled, seven-day retention. Restore integrity remains unverified.
2. Prove the restore target is isolated from both production and the existing development database. Record project, endpoint and database identity privately, without credentials. Obtain specific approval for the restore operation and any added recurring cost.
3. Restore to that target without starting the application, enabling jobs or webhooks, or running migrations. Record start/end times and provider outcome.
4. With a read-only connection to the proven target, run `psql -X -v ON_ERROR_STOP=1 -f scripts/verify-restored-database.sql`. Supply connection settings privately; never put a password or full connection URL in shared logs or this document.
5. Compare its evidence to a baseline from the same recovery point. Row counts alone do not establish recovery: compare schema, indexes, constraints, financial totals, newest timestamps and relationship/duplicate anomalies. Explain every difference. Missing tables or columns must fail verification, not trigger a repair.
6. Verify the restored application's essential read paths in isolation with outbound side effects disabled. Record the achieved recovery point and elapsed recovery time against the owner's agreed objectives. Obtain owner acceptance before closing the gate.

The SQL opens a read-only repeatable-read transaction, bounds statement/lock waits, collects aggregate evidence and rolls back. It does not restore anything, validate target ownership, compare a baseline automatically, or certify PASS. Even aggregate financial evidence and schema defaults must be kept private.

The collector covers the existing booking, quote, assignment, invoice, payout, reward and notification tables. It does not yet validate the unreleased canonical payment/refund/reward-queue schema. Add that coverage after the intended recovery point and schema version are established; do not require an unreleased table on an older backup.

## Collector validation

`scripts/test-restore-evidence.ts` executes the actual SQL against disposable PostgreSQL in release CI, or an in-memory PGlite instance locally. It derives column names/types from the application schema, seeds orphan and duplicate records plus invoice totals, checks the read-only transaction and row preservation, and verifies a missing column causes failure. Fixture constraints are deliberately omitted to admit corrupt records; this does not test a real backup, actual production constraints or data fidelity.

Local invocation accepts the installed PGlite module path. CI invokes `node --import tsx scripts/test-restore-evidence.ts --postgres`; the shared harness only accepts the local `jc_ledger_test` database and creates/drops its own schema. Neither mode reads production `DATABASE_URL`.

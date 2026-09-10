# Replit production recovery gate

The production database is owned through the original Replit project. A fresh inspection at approximately September 10, 2026 00:51 UTC (September 9 evening in America/Chicago) confirms Active, 103.9 MB of 100 GB, seven-day point-in-time recovery and daily backups retained seven days. Expanding Scheduled backups still shows `No backups yet`. This is configuration evidence, not a successful backup or isolated restore. No restore, credential change, schedule change or database creation occurred during this recheck.

Use Replit first. Additional Neon databases are optional only after identifying a suitable recovery destination. Do not use the unrelated connected Neon projects as evidence for this database.

## First scheduled backup timing and isolation

Replit's current [data recovery documentation](https://docs.replit.com/features/data-and-storage/data-recovery) says scheduled backups create one daily restore point near midnight in the browser time zone used when the schedule is enabled or updated. Therefore, an empty list before the first scheduled midnight does not establish a backup failure. The next useful backup-history check is after that scheduled time; do not repeatedly reset the schedule. A successful entry, recovery-point time and retention still need to be recorded.

The same documentation says restoring a scheduled backup switches the connected database to that data. The inspected restore control is not proof of an isolated destination and must not be used for the recovery drill. Replit documents production access from PostgreSQL-compatible clients in [Connection details](https://docs.replit.com/features/data-and-storage/connection-details), but that does not establish a separate restore target. The isolated destination and same-point baseline gates below remain open. A newly remixed development database is also not proof that production data was restored.

## Evidence needed to close recovery

1. Record the successful backup/recovery point, its time and the provider's retention window.
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

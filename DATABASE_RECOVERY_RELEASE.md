# Replit production recovery gate

The production database is owned through the original Replit project. September 9 inspection confirms Active, 103.88 MB of 100 GB, seven-day point-in-time recovery and daily backups retained seven days. This is configuration evidence. A successful scheduled backup and isolated restore have not been verified. The restore dialog exposes a timestamp and Restore action, without an isolated destination selector; it was canceled.

Use Replit first. Additional Neon databases are optional only after identifying a suitable recovery destination. Do not use the unrelated connected Neon projects as evidence for this database.

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

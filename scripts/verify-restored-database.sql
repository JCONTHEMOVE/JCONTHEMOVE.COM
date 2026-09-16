-- Run only after proving the connection points to the isolated restore target.
-- Use psql -X -v ON_ERROR_STOP=1; retain output privately, not in public CI logs.
-- This is a read-only evidence collector, not an automatic PASS certificate.
-- Compare to a same-recovery-point baseline. Investigate missing schema or
-- nonzero anomaly counts; never migrate, repair, or start the application here.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
SET LOCAL TIME ZONE 'UTC';

SELECT current_database() AS database_name,
       current_setting('server_version') AS postgres_version,
       current_setting('transaction_read_only') AS read_only,
       transaction_timestamp() AS validation_started_at;

-- Missing tables or columns intentionally produce an error, never a false pass.
SELECT 'users' AS table_name, count(*) AS row_count FROM public.users
UNION ALL SELECT 'leads', count(*) FROM public.leads
UNION ALL SELECT 'bookings', count(*) FROM public.bookings
UNION ALL SELECT 'booking_service_items', count(*) FROM public.booking_service_items
UNION ALL SELECT 'quote_revisions', count(*) FROM public.quote_revisions
UNION ALL SELECT 'job_assignments', count(*) FROM public.job_assignments
UNION ALL SELECT 'job_payment_records', count(*) FROM public.job_payment_records
UNION ALL SELECT 'job_payout_calculations', count(*) FROM public.job_payout_calculations
UNION ALL SELECT 'job_worker_payouts', count(*) FROM public.job_worker_payouts
UNION ALL SELECT 'square_invoices', count(*) FROM public.square_invoices
UNION ALL SELECT 'square_webhook_events', count(*) FROM public.square_webhook_events
UNION ALL SELECT 'rewards', count(*) FROM public.rewards
UNION ALL SELECT 'wallet_transactions', count(*) FROM public.wallet_transactions
UNION ALL SELECT 'idempotency_keys', count(*) FROM public.idempotency_keys
UNION ALL SELECT 'customer_job_events', count(*) FROM public.customer_job_events
UNION ALL SELECT 'customer_notification_deliveries', count(*) FROM public.customer_notification_deliveries
ORDER BY table_name;

-- Structure and integrity metadata: compare with the recorded source at T.
SELECT table_name, column_name, ordinal_position, data_type, udt_name,
       is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

SELECT c.relname AS table_name, k.conname AS constraint_name, k.contype,
       k.convalidated, pg_get_constraintdef(k.oid) AS definition
FROM pg_constraint k
JOIN pg_class c ON c.oid = k.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
ORDER BY c.relname, k.conname;

SELECT t.relname AS table_name, i.relname AS index_name,
       x.indisvalid, x.indisready
FROM pg_index x
JOIN pg_class t ON t.oid = x.indrelid
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND (NOT x.indisvalid OR NOT x.indisready)
ORDER BY t.relname, i.relname;

-- Aggregate evidence only; no customer names, addresses, contact details,
-- payment references, wallet addresses, credentials, or record identifiers.
SELECT status, count(*) AS rows, coalesce(sum(final_total), 0) AS total_usd,
       max(created_at) AS newest_created_at
FROM public.bookings GROUP BY status ORDER BY status;

SELECT status, currency, count(*) AS rows,
       coalesce(sum(customer_total), 0) AS customer_total,
       max(created_at) AS newest_created_at
FROM public.quote_revisions GROUP BY status, currency ORDER BY status, currency;

SELECT status, payment_scope, count(*) AS rows,
       coalesce(sum(amount), 0) AS total_usd, max(paid_at) AS newest_paid_at
FROM public.job_payment_records
GROUP BY status, payment_scope ORDER BY status, payment_scope;

SELECT status, currency, count(*) AS rows, coalesce(sum(amount), 0) AS total,
       max(created_at) AS newest_created_at
FROM public.square_invoices GROUP BY status, currency ORDER BY status, currency;

SELECT payout_status, count(*) AS rows,
       coalesce(sum(total_pay), 0) AS total_pay_usd,
       coalesce(sum(jcmoves_reward_amount), 0) AS jcmoves_reward_amount,
       count(rewards_issued_at) AS rewards_issued_rows,
       max(created_at) AS newest_created_at
FROM public.job_worker_payouts GROUP BY payout_status ORDER BY payout_status;

SELECT reward_type, status, count(*) AS rows,
       coalesce(sum(token_amount), 0) AS token_amount,
       coalesce(sum(cash_value), 0) AS cash_value_usd,
       max(earned_date) AS newest_earned_at
FROM public.rewards GROUP BY reward_type, status ORDER BY reward_type, status;

SELECT event_type, status, count(*) AS rows,
       max(received_at) AS newest_received_at
FROM public.square_webhook_events
GROUP BY event_type, status ORDER BY event_type, status;

-- Relationships including the intentionally FK-free quote-to-booking link.
SELECT 'booking_item_without_booking' AS check_name, count(*) AS anomaly_count
FROM public.booking_service_items x LEFT JOIN public.bookings p ON p.id = x.booking_id
WHERE p.id IS NULL
UNION ALL
SELECT 'quote_without_lead', count(*)
FROM public.quote_revisions x LEFT JOIN public.leads p ON p.id = x.lead_id
WHERE p.id IS NULL
UNION ALL
SELECT 'quote_without_linked_booking', count(*)
FROM public.quote_revisions x LEFT JOIN public.bookings p ON p.id = x.booking_id
WHERE x.booking_id IS NOT NULL AND p.id IS NULL
UNION ALL
SELECT 'payment_without_lead', count(*)
FROM public.job_payment_records x LEFT JOIN public.leads p ON p.id = x.lead_id
WHERE p.id IS NULL
UNION ALL
SELECT 'assignment_without_lead', count(*)
FROM public.job_assignments x LEFT JOIN public.leads p ON p.id = x.lead_id
WHERE p.id IS NULL
UNION ALL
SELECT 'assignment_without_worker', count(*)
FROM public.job_assignments x LEFT JOIN public.users p ON p.id = x.worker_id
WHERE p.id IS NULL
UNION ALL
SELECT 'worker_payout_without_lead', count(*)
FROM public.job_worker_payouts x LEFT JOIN public.leads p ON p.id = x.lead_id
WHERE p.id IS NULL
UNION ALL
SELECT 'worker_payout_without_worker', count(*)
FROM public.job_worker_payouts x LEFT JOIN public.users p ON p.id = x.worker_id
WHERE p.id IS NULL
UNION ALL
SELECT 'reward_without_user', count(*)
FROM public.rewards x LEFT JOIN public.users p ON p.id = x.user_id
WHERE p.id IS NULL
UNION ALL
SELECT 'notification_delivery_without_event', count(*)
FROM public.customer_notification_deliveries x
LEFT JOIN public.customer_job_events p ON p.id = x.event_id
WHERE p.id IS NULL
ORDER BY check_name;

-- Count duplicate key groups, not the private keys themselves.
SELECT 'duplicate_quote_revision' AS check_name, count(*) AS duplicate_groups
FROM (SELECT lead_id, revision FROM public.quote_revisions
      GROUP BY lead_id, revision HAVING count(*) > 1) d
UNION ALL
SELECT 'duplicate_job_assignment', count(*)
FROM (SELECT lead_id, worker_id FROM public.job_assignments
      GROUP BY lead_id, worker_id HAVING count(*) > 1) d
UNION ALL
SELECT 'duplicate_square_invoice', count(*)
FROM (SELECT square_invoice_id FROM public.square_invoices
      WHERE square_invoice_id IS NOT NULL
      GROUP BY square_invoice_id HAVING count(*) > 1) d
UNION ALL
SELECT 'duplicate_idempotency_key', count(*)
FROM (SELECT key FROM public.idempotency_keys
      GROUP BY key HAVING count(*) > 1) d
UNION ALL
SELECT 'duplicate_notification_destination', count(*)
FROM (SELECT event_id, channel, destination_hash
      FROM public.customer_notification_deliveries
      GROUP BY event_id, channel, destination_hash HAVING count(*) > 1) d
UNION ALL
SELECT 'duplicate_reward_reference_review_against_baseline', count(*)
FROM (SELECT user_id, reward_type, reference_id FROM public.rewards
      WHERE reference_id IS NOT NULL
      GROUP BY user_id, reward_type, reference_id HAVING count(*) > 1) d
ORDER BY check_name;

SELECT clock_timestamp() AS evidence_queries_finished_at;
ROLLBACK;

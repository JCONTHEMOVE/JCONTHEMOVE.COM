import { randomUUID } from 'node:crypto';
import type { PoolClient } from '@neondatabase/serverless';
import { pool } from '../db';

export const JOB_INVOICE_RECONCILIATION_QUEUE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS job_invoice_reconciliation_queue (
    lead_id VARCHAR PRIMARY KEY REFERENCES leads(id),
    generation BIGINT NOT NULL DEFAULT 1 CHECK(generation>0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','retry','done')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_token UUID,lease_expires_at TIMESTAMPTZ,
    last_failure_code TEXT,completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_job_invoice_reconciliation_due
    ON job_invoice_reconciliation_queue(status,next_attempt_at);
`;

/** Save with the payment/refund/publication transaction even while workers are
 * disabled. New work during an active claim must not be consumed by that claim. */
export async function enqueueJobInvoiceReconciliation(client: PoolClient, leadId: string) {
  if (process.env.JOB_PAYMENT_LEDGER_ENABLED !== 'true') return;
  await client.query(`INSERT INTO job_invoice_reconciliation_queue(lead_id) VALUES($1)
    ON CONFLICT(lead_id) DO UPDATE SET
      generation=job_invoice_reconciliation_queue.generation+1,
      status=CASE WHEN job_invoice_reconciliation_queue.status='processing' THEN 'processing' ELSE 'pending' END,
      next_attempt_at=NOW(),completed_at=NULL,last_failure_code=NULL,updated_at=NOW()`, [leadId]);
}

export function invoiceReconciliationWorkerEnabled() {
  return process.env.JOB_PAYMENT_LEDGER_ENABLED === 'true'
    && process.env.JOB_INVOICE_RECONCILIATION_ENABLED === 'true';
}

export type InvoiceReconciliationClaim = { lead_id: string; generation: string; lease_token: string };

/** Recover publication acknowledgement loss and missing historical requests.
 * Do not reset active leases or bypass an existing retry's backoff. */
export async function enqueueInvoiceReconciliationBacklog() {
  if (!invoiceReconciliationWorkerEnabled()) return 0;
  const result = await pool.query(`INSERT INTO job_invoice_reconciliation_queue(lead_id)
    SELECT DISTINCT lead_id FROM square_invoices WHERE lead_id IS NOT NULL
      AND purpose='final_balance' AND status IN ('draft','sent')
    ON CONFLICT(lead_id) DO UPDATE SET generation=job_invoice_reconciliation_queue.generation+1,
      status='pending',next_attempt_at=NOW(),completed_at=NULL,last_failure_code=NULL,updated_at=NOW()
    WHERE job_invoice_reconciliation_queue.status='done' RETURNING lead_id`);
  return result.rows.length;
}

export async function claimJobInvoiceReconciliation() {
  if (!invoiceReconciliationWorkerEnabled()) return null;
  const result = await pool.query<InvoiceReconciliationClaim>(`UPDATE job_invoice_reconciliation_queue
    SET status='processing',lease_token=$1,lease_expires_at=NOW()+INTERVAL '5 minutes',
      attempts=attempts+1,updated_at=NOW()
    WHERE lead_id=(SELECT lead_id FROM job_invoice_reconciliation_queue
      WHERE (status IN ('pending','retry') AND next_attempt_at<=NOW())
        OR (status='processing' AND lease_expires_at<NOW())
      ORDER BY next_attempt_at,lead_id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING lead_id,generation::text,lease_token`, [randomUUID()]);
  return result.rows[0] || null;
}

export async function finishJobInvoiceReconciliation(claim: InvoiceReconciliationClaim, complete: boolean, transaction?: PoolClient) {
  if (!invoiceReconciliationWorkerEnabled()) return false;
  const result = await (transaction || pool).query(`UPDATE job_invoice_reconciliation_queue SET
    status=CASE WHEN generation<>$3::bigint THEN 'pending' WHEN $4 THEN 'done' ELSE 'retry' END,
    completed_at=CASE WHEN generation=$3::bigint AND $4 THEN NOW() ELSE NULL END,
    next_attempt_at=CASE WHEN generation<>$3::bigint THEN NOW() ELSE NOW()+INTERVAL '1 minute' END,
    last_failure_code=CASE WHEN generation=$3::bigint AND NOT $4 THEN 'reconciliation_incomplete' ELSE NULL END,
    lease_token=NULL,lease_expires_at=NULL,updated_at=NOW()
    WHERE lead_id=$1 AND lease_token=$2 AND status='processing' RETURNING lead_id`,
  [claim.lead_id, claim.lease_token, claim.generation, complete]);
  return result.rows.length === 1;
}

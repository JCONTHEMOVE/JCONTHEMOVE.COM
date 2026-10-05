import assert from 'node:assert/strict';
import { canRetryCloseoutInvoice } from '../closeoutRecoveryAvailability';

const prior = process.env.JOB_PAYMENT_LEDGER_ENABLED;
try {
  delete process.env.JOB_PAYMENT_LEDGER_ENABLED;
  const approved = { status:'approved',customer_approved_at:'2026-09-09T12:00:00Z' };
  assert.equal(canRetryCloseoutInvoice(approved),false);
  process.env.JOB_PAYMENT_LEDGER_ENABLED='true';
  assert.equal(canRetryCloseoutInvoice(approved),true);
  assert.equal(canRetryCloseoutInvoice({status:'approved'}),false);
  for (const status of ['awaiting_customer','balance_due','paid','customer_rejected','refund_review']) {
    assert.equal(canRetryCloseoutInvoice({...approved,status}),false);
  }
} finally {
  if (prior === undefined) delete process.env.JOB_PAYMENT_LEDGER_ENABLED;
  else process.env.JOB_PAYMENT_LEDGER_ENABLED=prior;
}

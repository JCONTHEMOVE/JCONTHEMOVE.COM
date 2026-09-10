import assert from 'node:assert/strict';
import { createDisposableLedgerDatabase } from './disposable-ledger-database';
import { pool } from '../server/db';
import { approveQuoteRevision, ensureQuoteRevisionInfrastructure, getLatestApprovedQuote, saveQuoteDraft } from '../server/services/quoteRevisions';
import { approveCanonicalCloseout } from '../server/services/canonicalCloseoutApproval';
import { assertCanonicalFinalInvoicePublication } from '../server/services/canonicalInvoicePublication';
import { confirmJobPayment, JOB_PAYMENT_LEDGER_SCHEMA } from '../server/services/jobPaymentLedger';
const database = await createDisposableLedgerDatabase(process.argv[2]);
const previousConnect = pool.connect, previousQuery = pool.query;
let failLeadWrite = false;
let failCloseoutWrite = false;
let failNoticeWrite = false;
let beforeConnect: (() => Promise<void>) | undefined;
const previousLedgerFlag = process.env.JOB_PAYMENT_LEDGER_ENABLED;
pool.query = ((sql: string, args?: unknown[]) => {
  if (/pricing_versions|pricing_rules/.test(sql)) return Promise.reject(new Error('Synthetic fixture uses fallback pricing'));
  return sql.includes('CREATE TABLE IF NOT EXISTS quote_revisions')
    ? database.exec(sql).then(() => ({ rows: [] })) : database.query(sql, args);
}) as typeof pool.query;
pool.connect = (async () => {
  const hook = beforeConnect;
  beforeConnect = undefined;
  await hook?.();
  return { query: async (sql: string, args?: unknown[]) => {
  if (failLeadWrite && sql.includes('UPDATE leads SET')) throw new Error('injected lead update failure');
  if (failCloseoutWrite && sql.includes('UPDATE job_closeouts SET')) throw new Error('injected closeout update failure');
  if (failNoticeWrite && sql.includes('INSERT INTO job_financial_notifications')) throw new Error('injected notice write failure');
  return database.query(sql, args);
}, release() {} };
}) as typeof pool.connect;
try {
  await database.exec(`CREATE TABLE users(id varchar PRIMARY KEY);
    INSERT INTO users VALUES('owner');
    CREATE TABLE leads(id varchar PRIMARY KEY,booking_id varchar,service_type text,quote_sent_at timestamptz,
      quote_snapshot jsonb,order_line_items jsonb,zone_snapshot jsonb,base_price numeric,total_price numeric,
      bundle_discount_amount numeric,quote_notes text,last_quote_updated_at timestamptz,created_at timestamptz);
    CREATE TABLE quote_approvals(lead_id varchar,booking_id varchar,submitted_by_user_id varchar,
      approved_by_user_id varchar,approval_role text,status text,notes text,created_at timestamptz DEFAULT NOW());
    INSERT INTO leads(id,base_price,total_price) VALUES('job',100,100);`);
  await ensureQuoteRevisionInfrastructure();
  const quoteId = (await database.query("SELECT id FROM quote_revisions WHERE lead_id='job'")).rows[0].id;
  await database.query("UPDATE quote_revisions SET status='approved',approved_at=NOW() WHERE id=$1", [quoteId]);
  await database.exec(`INSERT INTO quote_revisions(id,lead_id,revision,status,subtotal,final_pre_tax_total,customer_total)
    VALUES('replacement','job',2,'draft',200,200,200);`);
  assert.equal((await getLatestApprovedQuote('job'))?.id, quoteId);
  const input = { quoteId: 'replacement', actor: { userId: 'owner', isOwner: true, canApproveStandard: true },
    overrideReason: 'Controlled synthetic quote approval test' };
  failLeadWrite = true;
  await assert.rejects(approveQuoteRevision(input), /injected lead update failure/);
  assert.equal((await database.query("SELECT status FROM quote_revisions WHERE id='replacement'")).rows[0].status, 'draft');
  assert.equal((await getLatestApprovedQuote('job'))?.id, quoteId);
  assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM quote_approvals')).rows[0].n, 0);
  assert.equal(Number((await database.query('SELECT total_price FROM leads')).rows[0].total_price), 100);
  failLeadWrite = false;
  assert.equal((await approveQuoteRevision(input)).status, 'approved');
  assert.equal((await getLatestApprovedQuote('job'))?.id, 'replacement');
  process.env.JOB_PAYMENT_LEDGER_ENABLED = 'true';
  await database.exec(`ALTER TABLE leads ADD COLUMN status text,ADD COLUMN payment_paid_at timestamptz,
    ADD COLUMN closeout_status text,ADD COLUMN financial_status text;
    CREATE TABLE job_closeouts(id varchar PRIMARY KEY,lead_id varchar,status text,calculated_final_total numeric,
      balance_due numeric,pricing_snapshot jsonb,customer_approved_at timestamptz,updated_at timestamptz);
    INSERT INTO leads(id,total_price,status) VALUES('closeout-job',100,'completed');
    INSERT INTO quote_revisions(id,lead_id,revision,status,customer_total,approved_at)
      VALUES('original-closeout-quote','closeout-job',1,'approved',100,NOW());
    INSERT INTO job_closeouts VALUES('closeout','closeout-job','awaiting_customer',120,0,
      '{"quoteRevisionId":"original-closeout-quote"}',NULL,NOW());`);
  await database.exec(JOB_PAYMENT_LEDGER_SCHEMA);
  await database.exec("UPDATE leads SET total_price=120 WHERE id='closeout-job'");
  await assert.rejects(approveCanonicalCloseout('closeout'), /payment coverage requires reconciliation/);
  assert.equal((await database.query("SELECT payment_paid_at FROM leads WHERE id='closeout-job'")).rows[0].payment_paid_at, null);
  await database.exec("UPDATE leads SET total_price=100 WHERE id='closeout-job'");
  const deposit = { provider: 'square:production', providerPaymentId: 'closeout-deposit', leadId: 'closeout-job',
    quoteRevisionId: 'original-closeout-quote', amountCents: 3000, currency: 'USD' as const,
    tenderType: 'card', giftFundedCents: 0, paidAt: '2026-09-09T12:00:00Z' };
  await confirmJobPayment(deposit);
  await database.exec("UPDATE job_closeouts SET balance_due=90 WHERE id='closeout'");
  failCloseoutWrite = true;
  await assert.rejects(approveCanonicalCloseout('closeout'), /injected closeout/);
  assert.equal((await getLatestApprovedQuote('closeout-job'))?.id, 'original-closeout-quote');
  assert.equal(Number((await database.query("SELECT total_price FROM leads WHERE id='closeout-job'")).rows[0].total_price), 100);
  failCloseoutWrite = false;
  const approvedCloseout = await approveCanonicalCloseout('closeout');
  assert.equal(approvedCloseout.balanceDue, 90);
  assert.equal(Number((await database.query("SELECT total_price FROM leads WHERE id='closeout-job'")).rows[0].total_price), 120);
  assert.equal((await getLatestApprovedQuote('closeout-job'))?.id, approvedCloseout.quoteRevisionId);
  assert.equal((await getLatestApprovedQuote('closeout-job'))?.customerTotal, 120);
  // Retry the durable approval directly, without clearing its timestamp or
  // asking the customer to approve again after an ambiguous provider response.
  const approvalBefore=(await database.query("SELECT customer_approved_at FROM job_closeouts WHERE id='closeout'")).rows[0].customer_approved_at;
  failLeadWrite=true; failCloseoutWrite=true;
  const retriedCloseout = await approveCanonicalCloseout('closeout');
  failLeadWrite=false; failCloseoutWrite=false;
  assert.equal(retriedCloseout.quoteRevisionId, approvedCloseout.quoteRevisionId);
  assert.equal(retriedCloseout.invoiceDueDate, approvedCloseout.invoiceDueDate, 'retry retains the persisted due date instead of recalculating it');
  assert.equal(retriedCloseout.invoiceRequestKey, approvedCloseout.invoiceRequestKey);
  assert.deepEqual((await database.query("SELECT customer_approved_at FROM job_closeouts WHERE id='closeout'")).rows[0].customer_approved_at,approvalBefore);
  await database.exec("UPDATE job_closeouts SET customer_approved_at=NULL WHERE id='closeout'");
  await assert.rejects(approveCanonicalCloseout('closeout'),/Recorded closeout approval requires reconciliation/);
  await database.query("UPDATE job_closeouts SET customer_approved_at=$1 WHERE id='closeout'",[approvalBefore]);
  await (await import('./check-closeout-request-recovery')).checkCloseoutRequestRecovery(sql=>database.exec(sql));
  const publication = { leadId: 'closeout-job', closeoutId: 'closeout',
    quoteRevisionId: approvedCloseout.quoteRevisionId, amount: 90 };
  await assertCanonicalFinalInvoicePublication(publication);
  await confirmJobPayment({ ...deposit, providerPaymentId: 'publication-partial',
    quoteRevisionId: approvedCloseout.quoteRevisionId, amountCents: 1000 });
  await assert.rejects(assertCanonicalFinalInvoicePublication(publication), /coverage changed/);
  await assert.rejects(approveCanonicalCloseout('closeout'), /payment coverage requires reconciliation/);
  await database.exec("DELETE FROM job_confirmed_payments WHERE provider_payment_id='publication-partial'");
  await assert.rejects(assertCanonicalFinalInvoicePublication({ ...publication, amount: 0 }), /positive amount/);
  await assert.rejects(assertCanonicalFinalInvoicePublication({ ...publication, closeoutId: 'wrong-job-closeout' }), /approval changed/);
  await assert.rejects(assertCanonicalFinalInvoicePublication({ ...publication, quoteRevisionId: 'original-closeout-quote' }), /approval changed/);
  for (const update of ["status='customer_rejected'", 'customer_approved_at=NULL',
    "pricing_snapshot='{}'::jsonb", 'calculated_final_total=121', 'balance_due=91']) {
    const original = (await database.query("SELECT * FROM job_closeouts WHERE id='closeout'")).rows[0];
    await database.exec(`UPDATE job_closeouts SET ${update} WHERE id='closeout'`);
    await assert.rejects(assertCanonicalFinalInvoicePublication(publication), /reconciliation required/);
    await database.query(`UPDATE job_closeouts SET status=$1,customer_approved_at=$2,
      pricing_snapshot=$3::jsonb,calculated_final_total=$4,balance_due=$5 WHERE id='closeout'`,
    [original.status, original.customer_approved_at, JSON.stringify(original.pricing_snapshot),
      original.calculated_final_total, original.balance_due]);
  }
  await database.exec("UPDATE leads SET total_price=121 WHERE id='closeout-job'");
  await assert.rejects(assertCanonicalFinalInvoicePublication(publication), /approval changed/);
  await database.exec("UPDATE leads SET total_price=120 WHERE id='closeout-job'");
  // Even a numerically adjusted balance must not auto-publish after a refund.
  await database.exec(`INSERT INTO job_confirmed_refunds(provider,provider_refund_id,payment_id,
    amount_cents,gift_funded_cents,currency,refunded_at)
    SELECT provider,'publication-refund',id,1,0,'USD',NOW() FROM job_confirmed_payments
    WHERE provider_payment_id='closeout-deposit';
    UPDATE job_closeouts SET balance_due=90.01 WHERE id='closeout';`);
  await assert.rejects(assertCanonicalFinalInvoicePublication({ ...publication, amount: 90.01 }), /coverage changed/);
  await database.exec(`DELETE FROM job_confirmed_refunds WHERE provider_refund_id='publication-refund';
    UPDATE job_closeouts SET balance_due=90 WHERE id='closeout';`);
  await assertCanonicalFinalInvoicePublication(publication);
  {
    const { checkLateFinalInvoicePublication } = await import('./check-late-final-invoice');
    await checkLateFinalInvoicePublication({
      approval: retriedCloseout,
      recordLatePayment: () => confirmJobPayment({ ...deposit, providerPaymentId: 'closeout-balance',
        quoteRevisionId: approvedCloseout.quoteRevisionId, amountCents: 9000 }),
      paidCents: async () => Number((await database.query(
        "SELECT SUM(amount_cents) AS paid FROM job_confirmed_payments WHERE lead_id='closeout-job'",
      )).rows[0].paid),
    });
  }
  await confirmJobPayment({ ...deposit, providerPaymentId: 'closeout-balance', quoteRevisionId: approvedCloseout.quoteRevisionId, amountCents: 9000 });
  await database.exec("UPDATE job_closeouts SET status='awaiting_customer',balance_due=0 WHERE id='closeout'");
  await confirmJobPayment({ ...deposit, providerPaymentId:'closeout-overpayment',
    quoteRevisionId:approvedCloseout.quoteRevisionId,amountCents:1 }, {deferSettlement:true});
  const beforeOverpaymentApproval=(await database.query("SELECT * FROM job_closeouts WHERE id='closeout'")).rows[0];
  const beforeRewardQueue=(await database.query("SELECT * FROM job_reward_queue WHERE lead_id='closeout-job'")).rows;
  await assert.rejects(approveCanonicalCloseout('closeout'),/payment coverage requires reconciliation/);
  assert.deepEqual((await database.query("SELECT * FROM job_closeouts WHERE id='closeout'")).rows[0],beforeOverpaymentApproval);
  assert.deepEqual((await database.query("SELECT * FROM job_reward_queue WHERE lead_id='closeout-job'")).rows,beforeRewardQueue);
  assert.equal((await database.query("SELECT * FROM job_financial_notifications WHERE lead_id='closeout-job'")).rows.length,0);
  await database.exec("DELETE FROM job_confirmed_payments WHERE provider_payment_id='closeout-overpayment'");
  console.log('PASS: customer approval rejects even a one-cent overpayment without changing closeout, reward queue or notices');
  failNoticeWrite=true;
  await assert.rejects(approveCanonicalCloseout('closeout'),/injected notice write failure/);
  failNoticeWrite=false;
  assert.equal((await database.query("SELECT status FROM job_closeouts WHERE id='closeout'")).rows[0].status,'awaiting_customer');
  assert.equal((await database.query("SELECT * FROM job_financial_notifications WHERE lead_id='closeout-job'")).rows.length,0);
  assert.equal((await approveCanonicalCloseout('closeout')).balanceDue, 0);
  assert.equal((await database.query("SELECT * FROM job_financial_notifications WHERE lead_id='closeout-job'")).rows.length,1);
  assert.equal((await database.query("SELECT status FROM job_closeouts WHERE id='closeout'")).rows[0].status, 'paid');
  assert.ok((await database.query("SELECT payment_paid_at FROM leads WHERE id='closeout-job'")).rows[0].payment_paid_at);
  console.log('PASS: canonical closeout rejects unfunded zero balance, rolls back final quote, reuses retry quote and settles verified coverage');
  const previousQuote = (await database.query('SELECT status,superseded_by_quote_id FROM quote_revisions WHERE id=$1', [quoteId])).rows[0];
  assert.equal(previousQuote.status, 'superseded');
  assert.equal(previousQuote.superseded_by_quote_id, 'replacement');
  assert.equal(Number((await database.query('SELECT total_price FROM leads')).rows[0].total_price), 200);
  assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM quote_approvals')).rows[0].n, 1);
  await assert.rejects(approveQuoteRevision(input), /Only a draft/);
  await database.exec(`INSERT INTO quote_revisions(id,lead_id,revision,status) VALUES
    ('older-draft','job',3,'draft'),('newer-draft','job',4,'draft');`);
  await assert.rejects(approveQuoteRevision({ ...input, quoteId: 'older-draft' }), /newer quote revision/);
  assert.equal((await getLatestApprovedQuote('job'))?.id, 'replacement');
  console.log('PASS: actual quote approval rolls back quote/history/lead together, retries and rejects duplicate approval');
  await database.exec(`ALTER TABLE leads ADD COLUMN from_address text, ADD COLUMN to_address text,
    ADD COLUMN confirmed_from_address text, ADD COLUMN confirmed_to_address text,
    ADD COLUMN confirmed_date text, ADD COLUMN move_date text, ADD COLUMN crew_size integer,
    ADD COLUMN confirmed_hours numeric, ADD COLUMN total_special_items_fee numeric;
    INSERT INTO leads(id,service_type,crew_size,confirmed_hours,quote_notes,from_address)
      VALUES('draft-race','moving',2,2,'Original notes','Address TBD');`);
  for (const update of ["crew_size=3", "confirmed_hours=4", "quote_notes='Changed notes'",
    "quote_snapshot='{\"serviceStops\":[]}'::jsonb", "booking_id='changed-booking'"]) {
    beforeConnect = async () => { await database.exec(`UPDATE leads SET ${update} WHERE id='draft-race'`); };
    await assert.rejects(saveQuoteDraft({leadId:'draft-race',actorUserId:'owner'}), /Job details changed/);
    assert.equal(Number((await database.query("SELECT count(*) AS n FROM quote_revisions WHERE lead_id='draft-race'")).rows[0].n), 0);
  }
  const fresh = await saveQuoteDraft({leadId:'draft-race',actorUserId:'owner'});
  assert.equal(fresh.notes, 'Changed notes');
  assert.equal(fresh.bookingId, 'changed-booking');
  beforeConnect = async () => { await database.exec("UPDATE leads SET quote_notes='Newer notes' WHERE id='draft-race'"); };
  await assert.rejects(saveQuoteDraft({leadId:'draft-race',actorUserId:'owner'}), /Job details changed/);
  assert.equal((await database.query('SELECT notes FROM quote_revisions WHERE id=$1',[fresh.id])).rows[0].notes, 'Changed notes');
  const retried = await saveQuoteDraft({leadId:'draft-race',actorUserId:'owner'});
  assert.equal(retried.id, fresh.id);
  assert.equal(retried.notes, 'Newer notes');
  console.log('PASS: draft rejects job edits committed during calculation before insert/update, and fresh retries preserve current details');
} finally {
  pool.connect = previousConnect; pool.query = previousQuery;
  if (previousLedgerFlag === undefined) delete process.env.JOB_PAYMENT_LEDGER_ENABLED;
  else process.env.JOB_PAYMENT_LEDGER_ENABLED = previousLedgerFlag;
  await database.close();
}

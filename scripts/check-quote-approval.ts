import assert from 'node:assert/strict';
import { createDisposableLedgerDatabase } from './disposable-ledger-database';
import { pool } from '../server/db';
import { approveQuoteRevision, ensureQuoteRevisionInfrastructure, getLatestApprovedQuote } from '../server/services/quoteRevisions';
import { approveCanonicalCloseout } from '../server/services/canonicalCloseoutApproval';
import { confirmJobPayment, JOB_PAYMENT_LEDGER_SCHEMA } from '../server/services/jobPaymentLedger';
const database = await createDisposableLedgerDatabase(process.argv[2]);
const previousConnect = pool.connect, previousQuery = pool.query;
let failLeadWrite = false;
let failCloseoutWrite = false;
const previousLedgerFlag = process.env.JOB_PAYMENT_LEDGER_ENABLED;
pool.query = ((sql: string, args?: unknown[]) => sql.includes('CREATE TABLE IF NOT EXISTS quote_revisions')
  ? database.exec(sql).then(() => ({ rows: [] })) : database.query(sql, args)) as typeof pool.query;
pool.connect = (async () => ({ query: async (sql: string, args?: unknown[]) => {
  if (failLeadWrite && sql.includes('UPDATE leads SET')) throw new Error('injected lead update failure');
  if (failCloseoutWrite && sql.includes('UPDATE job_closeouts SET')) throw new Error('injected closeout update failure');
  return database.query(sql, args);
}, release() {} })) as typeof pool.connect;
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
  // A failed invoice request resets approval; retry must reuse the final quote.
  await database.exec("UPDATE job_closeouts SET status='awaiting_customer' WHERE id='closeout'");
  assert.equal((await approveCanonicalCloseout('closeout')).quoteRevisionId, approvedCloseout.quoteRevisionId);
  await confirmJobPayment({ ...deposit, providerPaymentId: 'closeout-balance', quoteRevisionId: approvedCloseout.quoteRevisionId, amountCents: 9000 });
  await database.exec("UPDATE job_closeouts SET status='awaiting_customer',balance_due=0 WHERE id='closeout'");
  assert.equal((await approveCanonicalCloseout('closeout')).balanceDue, 0);
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
} finally {
  pool.connect = previousConnect; pool.query = previousQuery;
  if (previousLedgerFlag === undefined) delete process.env.JOB_PAYMENT_LEDGER_ENABLED;
  else process.env.JOB_PAYMENT_LEDGER_ENABLED = previousLedgerFlag;
  await database.close();
}

import assert from 'node:assert/strict';
import { createDisposableLedgerDatabase } from './disposable-ledger-database';
import { pool } from '../server/db';
import { approveQuoteRevision, ensureQuoteRevisionInfrastructure, getLatestApprovedQuote } from '../server/services/quoteRevisions';
const database = await createDisposableLedgerDatabase(process.argv[2]);
const previousConnect = pool.connect, previousQuery = pool.query;
let failLeadWrite = false;
pool.query = ((sql: string, args?: unknown[]) => sql.includes('CREATE TABLE IF NOT EXISTS quote_revisions')
  ? database.exec(sql).then(() => ({ rows: [] })) : database.query(sql, args)) as typeof pool.query;
pool.connect = (async () => ({ query: async (sql: string, args?: unknown[]) => {
  if (failLeadWrite && sql.includes('UPDATE leads SET')) throw new Error('injected lead update failure');
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
  await database.close();
}

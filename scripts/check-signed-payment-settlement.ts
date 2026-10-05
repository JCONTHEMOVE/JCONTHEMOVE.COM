import assert from 'node:assert/strict';
import { storage } from '../server/storage';
import { processOneJobReward, enqueueCompletedPaidJobs } from '../server/services/jobRewardWorker';
import { disburseJobTokens } from '../server/services/disburse-job-tokens';
import { pool } from '../server/db';
import { processOneJobInvoiceReconciliation } from '../server/services/jobInvoiceReconciliationWorker';

/** Financial SQL and default issuance are real; storage facade uses fixture SQL.
 * Recipient notifications are disabled and provider HTTP stays intercepted. */
export async function checkSignedPaymentSettlement(database: {
  exec(sql: string): Promise<unknown>;
  query(sql: string, args?: unknown[]): Promise<{ rows: any[] }>;
}, sendPayment: (identity?: string) => Promise<Response>) {
  const original = { getLead: storage.getLead, getUser: storage.getUser, updateLeadQuote: storage.updateLeadQuote };
  const originalQuery = pool.query;
  const settings = { JOB_PAYMENT_REWARDS_ENABLED: 'true', JOB_INVOICE_RECONCILIATION_ENABLED: 'true', JC_JOB_EVENT_WEBHOOK_URLS: '', JOB_EVENT_WEBHOOK_URLS: '',
    DISCORD_JOB_WEBHOOK_URL: '', DISCORD_WEBHOOK_URL: '' };
  const previous = new Map(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  try {
    await database.exec(`DELETE FROM job_confirmed_refunds; DELETE FROM job_confirmed_payments;
      DELETE FROM job_invoice_reconciliation_queue; DELETE FROM job_reward_queue;
      ALTER TABLE leads ADD COLUMN crew_members text[], ADD COLUMN assigned_to_user_id varchar,
        ADD COLUMN jcmoves_reward_base numeric,ADD COLUMN closeout_status text,ADD COLUMN financial_status text,
        ADD COLUMN final_balance_amount numeric,ADD COLUMN final_invoice_url text;
      UPDATE leads SET status='completed',payment_paid_at=NULL,tokens_disbursed_at=NULL,completion_rewarded_at=NULL,
        crew_members=ARRAY['crew'],assigned_to_user_id='crew';
      CREATE TABLE job_closeouts(lead_id varchar PRIMARY KEY,status text,customer_approved_at timestamptz,pricing_snapshot jsonb,
        id varchar,calculated_final_total numeric,balance_due numeric,updated_at timestamptz);
      INSERT INTO job_closeouts VALUES('job','approved',NOW(),'{"finalQuoteRevisionId":"quote"}','closeout',100,100,NOW());
      ALTER TABLE square_invoices ADD COLUMN square_invoice_id text,ADD COLUMN amount numeric,ADD COLUMN currency text,
        ADD COLUMN closeout_id varchar,ADD COLUMN purpose text,ADD COLUMN status text;
      UPDATE square_invoices SET square_invoice_id='settlement-invoice',amount=100,currency='USD',closeout_id='closeout',
        purpose='final_balance',status='sent';
      CREATE TABLE spin_config(setting_key text,setting_value text);
      CREATE TABLE reward_settings(setting_key text,token_amount numeric,is_active boolean);
      INSERT INTO reward_settings VALUES('earn_rate_per_dollar',10,true);
      CREATE TABLE users(id varchar PRIMARY KEY,email text,role text,status text,is_approved boolean,
        notifications_enabled boolean,job_alert_channel_preference text);
      INSERT INTO users VALUES('customer','customer@example.invalid','customer','active',true,false,'none'),
        ('crew','crew@example.invalid','employee','active',true,false,'none');
      CREATE TABLE job_jcmoves_ledger(id serial PRIMARY KEY,lead_id text,recipient_type text,recipient_user_id text,
        recipient_label text,reward_kind text,token_amount numeric,quote_total numeric,rate_per_dollar numeric,metadata jsonb,
        UNIQUE(lead_id,recipient_type,recipient_user_id,reward_kind));
      CREATE TABLE rewards(user_id text,reward_type text,token_amount numeric,cash_value numeric,status text,
        earned_date timestamptz,reference_id text,metadata jsonb);
      CREATE TABLE wallet_accounts(user_id text PRIMARY KEY,token_balance numeric DEFAULT 0,
        total_earned numeric DEFAULT 0,last_activity timestamptz);`);
    storage.getLead = (async (id: string) => {
      const row = (await database.query('SELECT * FROM leads WHERE id=$1', [id])).rows[0];
      return row ? { id: row.id, totalPrice: row.total_price, status: row.status, email: 'customer@example.invalid',
        firstName: 'Synthetic', lastName: 'Customer', serviceType: 'moving', source: 'website',
        crewMembers: row.crew_members, assignedToUserId: row.assigned_to_user_id, crewLeadUserId: 'crew',
        tokensDisbursedAt: row.tokens_disbursed_at, completionRewardedAt: row.completion_rewarded_at } : undefined;
    }) as typeof storage.getLead;
    storage.getUser = (async (id: string) => (await database.query('SELECT * FROM users WHERE id=$1', [id])).rows[0]) as typeof storage.getUser;
    storage.updateLeadQuote = (async (id: string, data: any) => {
      assert.deepEqual(Object.keys(data).sort(), ['completionRewardedAt', 'tokensDisbursedAt']);
      await database.query('UPDATE leads SET completion_rewarded_at=$2,tokens_disbursed_at=$3 WHERE id=$1',
        [id, data.completionRewardedAt, data.tokensDisbursedAt]);
      return storage.getLead(id);
    }) as typeof storage.updateLeadQuote;
    assert.equal((await sendPayment()).status, 200);
    assert.equal((await database.query('SELECT status FROM job_reward_queue')).rows[0].status, 'pending');
    // Delegates to the real issuance function; logs errors the worker normally bounds.
    const issue = async (id: string) => {
      try { return await disburseJobTokens(id); } catch (error) { console.error(error); throw error; }
    };
    assert.equal((await processOneJobReward(issue)).status, 'retry', 'approved closeout must reconcile before wallet credit');
    assert.equal((await database.query('SELECT * FROM wallet_accounts')).rows.length, 0);
    const reconciled = await processOneJobInvoiceReconciliation();
    assert.equal(reconciled.status, 'done');
    assert.equal('closeoutPaid' in reconciled && reconciled.closeoutPaid, true);
    const closeout = (await database.query('SELECT status,balance_due::text AS balance FROM job_closeouts')).rows[0];
    assert.deepEqual(closeout, { status: 'paid', balance: '0' });
    assert.equal((await database.query('SELECT * FROM job_financial_notifications')).rows.length, 1);
    await database.exec("UPDATE job_reward_queue SET next_attempt_at=NOW()-INTERVAL '1 second'");
    pool.query = (async (query: any, args?: any[]) => {
      const text = typeof query === 'string' ? query : query.text;
      if (text.includes('UPDATE wallet_accounts') && args?.[0] === 'crew') throw new Error('Injected crew wallet failure');
      return originalQuery.call(pool, query, args);
    }) as typeof pool.query;
    assert.equal((await processOneJobReward(issue)).status, 'retry');
    assert.equal(Number((await database.query("SELECT token_balance::text AS amount FROM wallet_accounts WHERE user_id='customer'")).rows[0].amount), 1000);
    assert.equal((await database.query("SELECT * FROM wallet_accounts WHERE user_id='crew'")).rows.length, 0);
    assert.equal((await database.query('SELECT tokens_disbursed_at FROM leads')).rows[0].tokens_disbursed_at, null);
    pool.query = originalQuery;
    await database.exec("UPDATE job_reward_queue SET next_attempt_at=NOW()-INTERVAL '1 second'");
    assert.equal((await processOneJobReward(issue)).status, 'done');
    const balances = async () => (await database.query('SELECT user_id,token_balance::text,total_earned::text FROM wallet_accounts ORDER BY user_id')).rows;
    const settled = await balances();
    assert.deepEqual(settled.map(row => [row.user_id, Number(row.token_balance), Number(row.total_earned)]),
      [['crew', 1000, 1000], ['customer', 1000, 1000]]);
    assert.equal((await database.query('SELECT * FROM rewards')).rows.length, 2);
    assert.equal((await database.query('SELECT * FROM job_jcmoves_ledger')).rows.length, 2);
    assert.equal((await sendPayment()).status, 200);
    assert.equal((await processOneJobReward(issue)).status, 'idle');
    assert.equal((await processOneJobInvoiceReconciliation()).status, 'idle');
    assert.equal((await database.query('SELECT * FROM job_financial_notifications')).rows.length, 1);
    assert.deepEqual(await balances(), settled);
    assert.equal((await database.query('SELECT status FROM job_reward_queue')).rows[0].status, 'done');
    console.log('PASS: signed payment through real issuance, interrupted crew wallet recovery, durable completion and duplicate suppression');
    // Independent fixture lifecycle: retain event audit but reset this synthetic job's effects.
    await database.exec(`DELETE FROM job_financial_notifications; DELETE FROM job_reward_queue;
      DELETE FROM job_invoice_reconciliation_queue; DELETE FROM rewards; DELETE FROM wallet_accounts;
      DELETE FROM job_jcmoves_ledger; DELETE FROM job_confirmed_payments;
      UPDATE leads SET status='new',payment_paid_at=NULL,tokens_disbursed_at=NULL,completion_rewarded_at=NULL,
        closeout_status=NULL,financial_status=NULL,final_balance_amount=NULL;
      UPDATE job_closeouts SET status='approved',balance_due=100;`);
    assert.equal((await sendPayment('payment-before-completion')).status, 200);
    assert.ok((await database.query('SELECT payment_paid_at FROM leads')).rows[0].payment_paid_at);
    assert.equal((await database.query('SELECT * FROM job_reward_queue')).rows.length, 0);
    assert.equal(await enqueueCompletedPaidJobs(), 0);
    assert.equal((await processOneJobReward(issue)).status, 'idle');
    assert.equal((await processOneJobInvoiceReconciliation()).status, 'retry');
    assert.equal((await database.query('SELECT status FROM job_closeouts')).rows[0].status, 'approved');
    assert.equal((await database.query('SELECT * FROM job_financial_notifications')).rows.length, 0);
    assert.deepEqual(await balances(), []);
    // Models the persisted completion boundary; the authenticated completion route is separate acceptance.
    await database.exec("UPDATE leads SET status='completed'");
    assert.equal(await enqueueCompletedPaidJobs(), 1);
    assert.equal(await enqueueCompletedPaidJobs(), 0);
    await database.exec("UPDATE job_invoice_reconciliation_queue SET next_attempt_at=NOW()-INTERVAL '1 second'");
    assert.equal((await processOneJobInvoiceReconciliation()).status, 'done');
    assert.equal((await processOneJobReward(issue)).status, 'done');
    assert.deepEqual(await balances(), settled);
    assert.equal((await database.query('SELECT * FROM rewards')).rows.length, 2);
    assert.equal((await database.query('SELECT * FROM job_financial_notifications')).rows.length, 1);
    assert.equal((await sendPayment('payment-before-completion')).status, 200);
    assert.equal(await enqueueCompletedPaidJobs(), 0);
    assert.equal((await processOneJobReward(issue)).status, 'idle');
    assert.deepEqual(await balances(), settled);
    console.log('PASS: signed payment before completion stays unawarded, completion sweep reconciles and settles once');
  } finally {
    Object.assign(storage, original);
    pool.query = originalQuery;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

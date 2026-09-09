import assert from "node:assert/strict";
import { createDisposableLedgerDatabase } from "./disposable-ledger-database";
import { createInvoiceEffectClaims, SQUARE_INVOICE_CLAIM_UPGRADE } from "../server/services/squareInvoiceEffectClaims";

const database = await createDisposableLedgerDatabase(process.argv[2]);
try {
  await database.exec(`CREATE TABLE square_invoice_payment_effects (
    square_invoice_id text PRIMARY KEY,event_id text NOT NULL,status text NOT NULL DEFAULT 'processing',
    last_error text,started_at timestamptz NOT NULL DEFAULT NOW(),completed_at timestamptz);
    INSERT INTO square_invoice_payment_effects(square_invoice_id,event_id,status) VALUES('legacy','old','processed');`);
  await database.exec(SQUARE_INVOICE_CLAIM_UPGRADE);
  await database.exec(SQUARE_INVOICE_CLAIM_UPGRADE);
  const claims = createInvoiceEffectClaims((sql, args) => database.query(sql, args));
  assert.equal((await claims.claim('legacy', 'new')).status, 'processed');
  const first = await claims.claim('invoice', 'event');
  assert.equal(first.status, 'claimed');
  if (first.status !== 'claimed') throw new Error('Missing initial claim');
  assert.equal((await claims.claim('invoice', 'another-event')).status, 'in_progress');
  await database.exec("UPDATE square_invoice_payment_effects SET started_at=NOW()-INTERVAL '6 minutes' WHERE square_invoice_id='invoice'");
  const second = await claims.claim('invoice', 'event');
  assert.equal(second.status, 'claimed');
  if (second.status !== 'claimed') throw new Error('Missing replacement claim');
  assert.notEqual(first.claim.token, second.claim.token);
  assert.equal(await claims.complete(first.claim), false);
  assert.equal(await claims.fail(first.claim, new Error('stale error')), false);
  assert.equal((await database.query("SELECT status FROM square_invoice_payment_effects WHERE square_invoice_id='invoice'")).rows[0].status, 'processing');
  assert.equal(await claims.fail(second.claim, new Error('retryable failure')), true);
  const third = await claims.claim('invoice', 'event');
  if (third.status !== 'claimed') throw new Error('Failed invoice must retry');
  assert.equal(await claims.complete(second.claim), false);
  assert.equal(await claims.complete(third.claim), true);
  assert.equal(await claims.fail(third.claim, new Error('late failure')), false);
  assert.equal((await claims.claim('invoice', 'last-event')).status, 'processed');
  const row = (await database.query("SELECT * FROM square_invoice_payment_effects WHERE square_invoice_id='invoice'")).rows[0];
  assert.equal(row.last_error, null);
  assert.ok(row.completed_at);
  console.log('PASS: repeatable claim upgrade, legacy history, busy retry, expiry, same-event fencing and failed-claim recovery');
} finally {
  await database.close();
}

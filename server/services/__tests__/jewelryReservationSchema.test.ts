import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { JEWELRY_RESERVATION_COLUMNS } from '../jewelryReservationSchema';

const db = new PGlite();
try {
  await db.exec(`CREATE TABLE users (id VARCHAR PRIMARY KEY);
    INSERT INTO users VALUES ('existing-customer');
    CREATE TABLE jewelry_items (id VARCHAR PRIMARY KEY, title TEXT, price NUMERIC(10,2), status TEXT);
    INSERT INTO jewelry_items VALUES ('existing-piece', 'Existing bracelet', 30, 'active');`);
  await assert.rejects(() => db.query('SELECT pending_credit_user_id FROM jewelry_items'));
  await db.exec(JEWELRY_RESERVATION_COLUMNS);
  const first = (await db.query<any>('SELECT * FROM jewelry_items')).rows[0];
  assert.equal(first.title, 'Existing bracelet');
  assert.equal(Number(first.price), 30);
  assert.equal(first.status, 'active');
  assert.equal(first.pending_credit_user_id, null);
  assert.equal(first.pending_credit_cents, null);
  assert.equal(first.pending_expires_at, null);
  assert.equal(first.pending_square_order_id, null);
  await db.exec(`UPDATE jewelry_items SET pending_credit_user_id='existing-customer', pending_credit_cents=250, pending_expires_at='2026-10-01 12:00', pending_square_order_id='existing-order';`);
  await db.exec(JEWELRY_RESERVATION_COLUMNS);
  const repeated = (await db.query<any>('SELECT * FROM jewelry_items')).rows[0];
  assert.equal(repeated.pending_credit_user_id, 'existing-customer');
  assert.equal(Number(repeated.pending_credit_cents), 250);
  assert.equal(repeated.pending_square_order_id, 'existing-order');
  assert.equal(Number(repeated.price), 30);
  assert.equal(repeated.status, 'active');
  await assert.rejects(() => db.exec(`UPDATE jewelry_items SET pending_credit_user_id='unknown-customer'`));
  console.log('Legacy jewelry catalog migration preserves items and reservations and can rerun safely.');
} finally { await db.close(); }

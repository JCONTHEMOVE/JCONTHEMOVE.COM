import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../shared/schema';
import { createDisposableLedgerDatabase } from './disposable-ledger-database';

// Never reads DATABASE_URL. --postgres requires the guarded localhost test
// database and creates its own disposable schema; a module path uses PGlite.
const database = await createDisposableLedgerDatabase(process.argv[2]);
const source = await readFile(new URL('./verify-restored-database.sql', import.meta.url), 'utf8');
const namespace = (await database.query('SELECT current_schema() AS name')).rows[0].name;
const sql = source.replace(/\bpublic\b/g, namespace);
const names = new Set([...source.matchAll(/(?:FROM|JOIN) public\.([a-z_]+)/g)].map(match => match[1]));
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
try {
  // Use actual application column names/types. Omit constraints so corrupt
  // fixtures can exercise orphan/duplicate evidence; this is not a restore.
  for (const table of Object.values(schema)) {
    if (!is(table, PgTable)) continue;
    const config = getTableConfig(table);
    if (!names.delete(config.name)) continue;
    await database.exec(`CREATE TABLE ${quote(config.name)} (${config.columns.map(column =>
      `${quote(column.name)} ${column.getSQLType()}`).join(', ')})`);
  }
  assert.equal(names.size, 0, `Unrecognized application tables: ${[...names]}`);
  await database.exec(`
    INSERT INTO booking_service_items (booking_id) VALUES ('missing-booking');
    INSERT INTO square_invoices (square_invoice_id, status, currency, amount)
      VALUES ('same-provider-id', 'paid', 'USD', 12.50), ('same-provider-id', 'paid', 'USD', 7.50);
    INSERT INTO rewards (user_id, reward_type, reference_id, token_amount, cash_value)
      VALUES ('missing-user', 'test', 'same-reference', 10, 1), ('missing-user', 'test', 'same-reference', 20, 2);
  `);
  const results = await database.exec(sql);
  const rows = results.flatMap((result: { rows: Record<string, unknown>[] }) => result.rows);
  const evidence = (name: string) => rows.find((row: Record<string, unknown>) => row.check_name === name);
  assert.equal(rows.find((row: Record<string, unknown>) => 'read_only' in row)?.read_only, 'on');
  assert.equal(Number(evidence('booking_item_without_booking')?.anomaly_count), 1);
  assert.equal(Number(evidence('reward_without_user')?.anomaly_count), 2);
  assert.equal(Number(evidence('duplicate_square_invoice')?.duplicate_groups), 1);
  assert.equal(Number(evidence('duplicate_reward_reference_review_against_baseline')?.duplicate_groups), 1);
  assert.equal(Number(evidence('assignment_without_worker')?.anomaly_count), 0);
  const invoices = rows.find((row: Record<string, unknown>) => row.status === 'paid' && row.currency === 'USD');
  assert.equal(Number(invoices?.total), 20);
  assert.equal(Number(invoices?.rows), 2);
  const remaining = await database.query('SELECT count(*) AS count FROM square_invoices');
  assert.equal(Number(remaining.rows[0].count), 2);
  await database.exec('ALTER TABLE quote_revisions DROP COLUMN customer_total');
  await assert.rejects(database.exec(sql), /customer_total/);
  await database.exec('ROLLBACK');
  console.log('PASS: restore evidence SQL runs read-only against application column types, reports seeded anomalies and totals, preserves rows and fails on missing schema');
} finally {
  await database.close();
}

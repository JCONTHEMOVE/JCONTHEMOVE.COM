// Usage: node scripts/check-quick-book-migration.mjs <path-to-pglite-dist-index.js>
// Executes checked-in migration SQL in a disposable in-memory PostgreSQL engine.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const regional = readFileSync('server/services/regionalAutomationMigration.ts', 'utf8');
const sessions = readFileSync('server/services/quickBookSessions.ts', 'utf8');
const claimSource = readFileSync('server/services/squareInvoiceEffectClaims.ts', 'utf8');
const claimUpgrade = claimSource.match(/SQUARE_INVOICE_CLAIM_UPGRADE = `([\s\S]*?)`;/)?.[1];
assert.ok(claimUpgrade, 'Invoice claim migration SQL must be available');
const blocks = source => [...source.matchAll(/pool\.query\(`([\s\S]*?)`\)/g)].map(m => {
  const sql = m[1].replace('${SQUARE_INVOICE_CLAIM_UPGRADE}', claimUpgrade);
  assert.ok(!sql.includes('${'), 'Migration verifier must resolve every SQL interpolation');
  return sql;
});
assert.equal(blocks(regional).length, 2);
assert.equal(blocks(sessions).length, 1);
try {
  // Minimal legacy prerequisites: this tests this release's SQL, not a full DB restore.
  await db.exec(`CREATE TABLE users(id varchar PRIMARY KEY);
    CREATE TABLE bookings(id varchar PRIMARY KEY);
    CREATE TABLE leads(id varchar PRIMARY KEY);
    CREATE TABLE quote_revisions(id varchar PRIMARY KEY);
    CREATE TABLE square_invoices(id varchar PRIMARY KEY, lead_id varchar, created_at timestamptz);
    INSERT INTO users VALUES ('fixture-owner');`);
  const migrate = async () => { for (const sql of [...blocks(regional), ...blocks(sessions)]) await db.exec(sql); };
  await migrate();
  await db.exec(`INSERT INTO quick_booking_sessions(id,created_by_user_id,status,transcript_text,updated_at,metrics)
    VALUES ('old-draft','fixture-owner','draft','synthetic transcript',NOW()-INTERVAL '31 days','{"messageCount":2}'),
           ('old-abandoned','fixture-owner','abandoned','synthetic transcript',NOW()-INTERVAL '31 days','{}'),
           ('recent','fixture-owner','draft','keep recent',NOW(),'{}'),
           ('old-ready','fixture-owner','ready','keep ready',NOW()-INTERVAL '31 days','{}');`);
  await migrate();
  await migrate();
  const { rows } = await db.query('SELECT * FROM quick_booking_sessions ORDER BY id');
  assert.equal(rows.length, 4);
  for (const id of ['old-draft','old-abandoned']) assert.equal(rows.find(r=>r.id===id).transcript_text, null);
  assert.equal(rows.find(r=>r.id==='recent').transcript_text, 'keep recent');
  assert.equal(rows.find(r=>r.id==='old-ready').transcript_text, 'keep ready');
  assert.equal(rows.find(r=>r.id==='old-draft').metrics.messageCount, 2);
  assert.ok(new Date(rows.find(r=>r.id==='old-draft').updated_at) < new Date(Date.now()-30*86400000));
  const columns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='job_agreements'")).rows.map(r=>r.column_name);
  assert.ok(columns.includes('accepted_by_name') && columns.includes('acceptance_evidence'));
  const indexes = (await db.query("SELECT indexname FROM pg_indexes WHERE tablename='quick_booking_sessions'")).rows.map(r=>r.indexname);
  assert.ok(indexes.includes('idx_quick_booking_sessions_creator') && indexes.includes('idx_quick_booking_sessions_status'));
  await assert.rejects(db.exec("INSERT INTO quick_booking_sessions(created_by_user_id,status) VALUES ('fixture-owner','invalid')"));
  await assert.rejects(db.exec("INSERT INTO quick_booking_sessions(created_by_user_id) VALUES ('missing-owner')"));
  console.log('PASS: regional + Quick Book SQL applied three times; agreement columns, session indexes, status/FK constraints, transcript retention and metrics verified.');
  console.log('LIMIT: disposable minimal legacy schema; production schema drift, grants and migration locks require production read-only checks. Cleanup runs on schema initialization; old ready drafts are retained.');
} finally { await db.close(); }

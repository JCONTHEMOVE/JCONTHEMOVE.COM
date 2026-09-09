import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

/** Isolated test schema on one connection: these transaction tests are
 * sequential. Separate-session races have their own concurrency harness. */
export async function createDisposableLedgerDatabase(target: string | undefined) {
  if (target !== "--postgres") {
    if (!target) throw new Error("Provide a PGlite module path or --postgres");
    const { PGlite } = await import(pathToFileURL(resolve(target)).href);
    return new PGlite();
  }
  const url = new URL(process.env.TEST_DATABASE_URL || "http://missing");
  if (url.protocol !== "postgresql:" || !['localhost', '127.0.0.1'].includes(url.hostname)
      || url.pathname !== '/jc_ledger_test') throw new Error("Use a local disposable jc_ledger_test database");
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000,
    statement_timeout: 10000 });
  const schema = `ledger_check_${randomUUID().replaceAll('-', '')}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
  } catch (error) {
    await client.end();
    throw error;
  }
  return {
    query: (sql: string, args?: unknown[]) => client.query(sql, args),
    exec: (sql: string) => client.query(sql),
    close: async () => {
      try { await client.query(`DROP SCHEMA ${schema} CASCADE`); }
      finally { await client.end(); }
    },
  };
}

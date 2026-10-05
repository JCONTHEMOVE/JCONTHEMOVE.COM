import type { Pool } from "@neondatabase/serverless";

/** Session advisory locks must stay on one checked-out connection. Returning
 * that connection to the pool while locked permits reentrant acquisitions. */
export async function acquireJobDisbursementLock(pool: Pick<Pool, "connect">, key: number) {
  const client = await pool.connect();
  let released = false;
  try {
    const result = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1) AS acquired", [key]);
    if (!result.rows[0]?.acquired) {
      released = true;
      client.release();
      return null;
    }
    return async () => {
      if (released) return;
      released = true;
      try {
        const result = await client.query<{ unlocked: boolean }>("SELECT pg_advisory_unlock($1) AS unlocked", [key]);
        // A connection whose lock state is uncertain must not be reused.
        client.release(result.rows[0]?.unlocked ? undefined : new Error("Disbursement lock was not held"));
      } catch (error) {
        client.release(error instanceof Error ? error : new Error("Disbursement unlock failed"));
        throw error;
      }
    };
  } catch (error) {
    if (!released) client.release(error instanceof Error ? error : new Error("Disbursement lock failed"));
    throw error;
  }
}

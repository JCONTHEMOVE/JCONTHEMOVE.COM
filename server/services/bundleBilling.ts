// Server-side helpers for the priced bundle add-ons (Task #199).
//
// All UI/manifest logic lives in shared/bundleAddons.ts. This module just
// adds the database side-effects:
//   1) `markPendingShopCardGrants` — writes one wallet_credit_grants row
//      per priced add-on at lead/quote creation time so we have a paper
//      trail before Square ever sees the invoice. Idempotent on
//      (sourceType, sourceId, addonId).
//   2) `attachInvoiceToGrants` — once the Square invoice is published,
//      stamp every pending grant for the same source with the invoice id
//      so the webhook can look the grant up by either column.
//   3) `grantWalletCreditForSource` — called by the Square invoice-paid
//      webhook (or the dev mark-paid route). For every still-`pending`
//      grant on this source it credits the customer's wallet_accounts
//      cash_balance, writes a wallet_transactions ledger row, and flips
//      the grant to `granted`. Idempotent.
//   4) `reconcilePendingGrantsForUser` — called from registration. If
//      the customer paid before they had an account, the grant landed
//      in `granted` status with `grantedToUserId=null`; we now mint the
//      cash credit into their wallet and link them.

import { pool } from "../db";
import {
  type BundleBillableLine,
  getBundleBillableLines,
} from "@shared/bundleAddons";

export type BundleSourceType = "lead" | "lawn_care_quote";

interface MarkPendingArgs {
  sourceType: BundleSourceType;
  sourceId: string;            // string-cast — lawn_care_quote.id is a serial
  bundleAddons: string[] | null | undefined;
  customerEmail: string | null;
  customerPhone: string | null;
  metadata?: Record<string, unknown>;
}

export interface PendingShopCardGrant extends BundleBillableLine {
  grantId: string;
}

/**
 * Persist one row per priced bundle add-on so we have audit trail BEFORE
 * the customer ever pays. Idempotent: re-submitting the same lead/quote
 * is a no-op thanks to the (source_type, source_id, addon_id) unique
 * index. Returns the persisted grants (with their grantId) so callers
 * can reference them when building the Square invoice.
 */
export async function markPendingShopCardGrants(args: MarkPendingArgs): Promise<PendingShopCardGrant[]> {
  const billable = getBundleBillableLines(args.bundleAddons);
  if (billable.length === 0) return [];

  const out: PendingShopCardGrant[] = [];
  for (const line of billable) {
    if (!line.grantsWalletCredit) continue;
    try {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO wallet_credit_grants
           (source_type, source_id, addon_id, amount_usd, currency,
            customer_email, customer_phone, status, metadata)
         VALUES ($1, $2, $3, $4, 'JCMOVES_USD', $5, $6, 'pending', $7::jsonb)
         ON CONFLICT (source_type, source_id, addon_id) DO UPDATE
           SET customer_email = COALESCE(wallet_credit_grants.customer_email, EXCLUDED.customer_email),
               customer_phone = COALESCE(wallet_credit_grants.customer_phone, EXCLUDED.customer_phone)
         RETURNING id`,
        [
          args.sourceType,
          args.sourceId,
          line.addonId,
          (line.walletCreditUsd * line.quantity).toFixed(2),
          args.customerEmail,
          args.customerPhone,
          JSON.stringify({
            ...(args.metadata || {}),
            name: line.name,
            purchasePriceUsd: line.unitPriceUsd,
            walletCreditUsd: line.walletCreditUsd,
            shortDescription: line.shortDescription,
          }),
        ],
      );
      out.push({ ...line, grantId: rows[0].id });
    } catch (err) {
      console.error(
        `[bundleBilling] markPendingShopCardGrants failed for addon "${line.addonId}" on ${args.sourceType}:${args.sourceId}:`,
        (err as Error).message,
      );
    }
  }
  return out;
}

/**
 * Once the Square invoice is created, stash the invoice id on every
 * pending grant for this source. The webhook can then find the grants
 * via either (sourceType, sourceId) OR squareInvoiceId.
 */
export async function attachInvoiceToGrants(opts: {
  sourceType: BundleSourceType;
  sourceId: string;
  squareInvoiceId: string;
}): Promise<void> {
  try {
    await pool.query(
      `UPDATE wallet_credit_grants
         SET square_invoice_id = $3
       WHERE source_type = $1 AND source_id = $2
         AND (square_invoice_id IS NULL OR square_invoice_id = $3)`,
      [opts.sourceType, opts.sourceId, opts.squareInvoiceId],
    );
  } catch (err) {
    console.error(
      `[bundleBilling] attachInvoiceToGrants failed for ${opts.sourceType}:${opts.sourceId}:`,
      (err as Error).message,
    );
  }
}

interface GrantArgs {
  sourceType: BundleSourceType;
  sourceId: string;
  paymentReference: string;     // Square payment id, invoice id, or "manual:<who>"
  squareInvoiceId?: string | null;
}

interface CreditedGrant {
  grantId: string;
  amountUsd: number;
  addonId: string;
  customerEmail: string | null;
  grantedToUserId: string | null;
}

/**
 * Idempotent: for each `pending` grant on (sourceType, sourceId), credit
 * the customer's wallet cash balance, write a wallet_transactions row,
 * and flip the grant to `granted`. Already-granted rows are skipped.
 *
 * Customer linkage: looks up the user by `customer_email`. If there's
 * no user yet (unregistered customer), we still mark the grant
 * `granted` with `grantedToUserId=null` and do NOT touch any wallet —
 * the credit will land when the customer registers via
 * `reconcilePendingGrantsForUser`.
 */
export async function grantWalletCreditForSource(args: GrantArgs): Promise<CreditedGrant[]> {
  const { rows: grantRows } = await pool.query<{
    id: string;
    addon_id: string;
    amount_usd: string;
    currency: string;
    customer_email: string | null;
    customer_phone: string | null;
    status: string;
  }>(
    `SELECT id, addon_id, amount_usd, currency, customer_email, customer_phone, status
       FROM wallet_credit_grants
      WHERE source_type = $1 AND source_id = $2`,
    [args.sourceType, args.sourceId],
  );

  if (grantRows.length === 0) return [];

  const credited: CreditedGrant[] = [];

  for (const grant of grantRows) {
    if (grant.status === "granted") continue; // idempotent skip

    const amountUsd = parseFloat(grant.amount_usd);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      console.warn(`[bundleBilling] skipping grant ${grant.id} — invalid amount ${grant.amount_usd}`);
      continue;
    }

    const client = await pool.connect();
    let userId: string | null = null;
    try {
      await client.query("BEGIN");

      // Re-check status under transaction so two concurrent webhook
      // deliveries don't both pass the early-out above and double-credit.
      const { rows: lockRows } = await client.query<{ status: string }>(
        `SELECT status FROM wallet_credit_grants WHERE id = $1 FOR UPDATE`,
        [grant.id],
      );
      if (lockRows[0]?.status === "granted") {
        await client.query("ROLLBACK");
        continue;
      }

      // Look up the user inside the same transaction so a registration
      // racing with this webhook still mints to the correct user (instead
      // of leaving granted_to_user_id=null and stranding the credit).
      // Try email first, then fall back to phone — the original task
      // description called out either-or matching.
      if (grant.customer_email) {
        const { rows: userRows } = await client.query<{ id: string }>(
          `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
          [grant.customer_email],
        );
        userId = userRows[0]?.id ?? null;
      }
      if (!userId && grant.customer_phone) {
        const normalized = grant.customer_phone.replace(/\D/g, "");
        if (normalized.length >= 10) {
          const last10 = normalized.slice(-10);
          const { rows: phoneRows } = await client.query<{ id: string }>(
            `SELECT id FROM users
               WHERE phone_number IS NOT NULL
                 AND right(regexp_replace(phone_number, '\\D', '', 'g'), 10) = $1
               LIMIT 1`,
            [last10],
          );
          userId = phoneRows[0]?.id ?? null;
        }
      }

      if (userId) {
        await client.query(
          `INSERT INTO wallet_accounts (user_id, token_balance, cash_balance)
           VALUES ($1, '0', '0.00')
           ON CONFLICT (user_id) DO NOTHING`,
          [userId],
        );
        const { rows: balRows } = await client.query<{ cash_balance: string }>(
          `UPDATE wallet_accounts
              SET cash_balance = cash_balance + $1,
                  last_activity = NOW()
            WHERE user_id = $2
            RETURNING cash_balance`,
          [amountUsd.toFixed(2), userId],
        );
        const balanceAfter = balRows[0]?.cash_balance ?? amountUsd.toFixed(2);
        await client.query(
          `INSERT INTO wallet_transactions
             (transaction_type, amount, balance_after, status, metadata)
           VALUES ('reward', $1, $2, 'confirmed', $3::jsonb)`,
          [
            amountUsd.toFixed(2),
            balanceAfter,
            JSON.stringify({
              userId,
              source: "shop_card",
              kind: "jcmoves_usd_mint",
              addonId: grant.addon_id,
              grantId: grant.id,
              sourceType: args.sourceType,
              sourceId: args.sourceId,
              paymentReference: args.paymentReference,
              currency: "JCMOVES_USD",
            }),
          ],
        );
        // Mirror into rewards table so the customer's "earned" history
        // shows the shop card credit. ON CONFLICT keeps it idempotent
        // against the existing uq_rewards_jcmoves_usd_mint_ref index.
        await client.query(
          `INSERT INTO rewards
             (user_id, reward_type, token_amount, cash_value, status, reference_id, metadata)
           VALUES ($1, 'jcmoves_usd_mint', '0', $2, 'confirmed', $3, $4::jsonb)
           ON CONFLICT (reference_id) WHERE reward_type = 'jcmoves_usd_mint' AND reference_id IS NOT NULL DO NOTHING`,
          [
            userId,
            amountUsd.toFixed(2),
            `shop_card_grant:${grant.id}`,
            JSON.stringify({
              source: "shop_card",
              grantId: grant.id,
              addonId: grant.addon_id,
              sourceType: args.sourceType,
              sourceId: args.sourceId,
            }),
          ],
        );
      }

      await client.query(
        `UPDATE wallet_credit_grants
            SET status = 'granted',
                granted_to_user_id = $1,
                granted_at = NOW(),
                payment_reference = COALESCE(payment_reference, $2),
                square_invoice_id = COALESCE(square_invoice_id, $3)
          WHERE id = $4`,
        [userId, args.paymentReference, args.squareInvoiceId ?? null, grant.id],
      );

      await client.query("COMMIT");

      credited.push({
        grantId: grant.id,
        amountUsd,
        addonId: grant.addon_id,
        customerEmail: grant.customer_email,
        grantedToUserId: userId,
      });
      console.log(
        `[bundleBilling] granted $${amountUsd.toFixed(2)} ${grant.currency} for ${grant.addon_id} (grant ${grant.id}) → user ${userId || "UNREGISTERED"}`,
      );
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      console.error(
        `[bundleBilling] grantWalletCreditForSource failed for grant ${grant.id}:`,
        (err as Error).message,
      );
      // The caller must retry the invoice instead of acknowledging a lost
      // credit. Previously committed grants are skipped on the next attempt.
      throw err;
    } finally {
      client.release();
    }
  }

  return credited;
}

/**
 * Called from the customer-registration flow. Finds any `granted` grants
 * with the customer's email but no `granted_to_user_id` (i.e. they paid
 * BEFORE registering), credits the cash now, and links the user.
 */
export async function reconcilePendingGrantsForUser(opts: {
  userId: string;
  email: string | null | undefined;
  phone?: string | null | undefined;
}): Promise<{ credited: number; totalUsd: number }> {
  const email = opts.email ?? null;
  const phoneRaw = opts.phone ?? null;
  const phoneLast10 = phoneRaw
    ? (() => {
        const digits = phoneRaw.replace(/\D/g, "");
        return digits.length >= 10 ? digits.slice(-10) : null;
      })()
    : null;
  if (!email && !phoneLast10) return { credited: 0, totalUsd: 0 };
  // Match on email OR normalized phone — same fallback the grant path uses.
  const { rows } = await pool.query<{
    id: string;
    amount_usd: string;
    addon_id: string;
    source_type: string;
    source_id: string;
  }>(
    `SELECT id, amount_usd, addon_id, source_type, source_id
       FROM wallet_credit_grants
      WHERE granted_to_user_id IS NULL
        AND status = 'granted'
        AND (
          ($1::text IS NOT NULL AND LOWER(customer_email) = LOWER($1))
          OR ($2::text IS NOT NULL AND customer_phone IS NOT NULL
              AND right(regexp_replace(customer_phone, '\\D', '', 'g'), 10) = $2)
        )`,
    [email, phoneLast10],
  );

  if (rows.length === 0) return { credited: 0, totalUsd: 0 };

  let credited = 0;
  let totalUsd = 0;

  for (const row of rows) {
    const amountUsd = parseFloat(row.amount_usd);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) continue;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Re-check linkage under FOR UPDATE so a concurrent reconcile call
      // can't double-credit on a duplicate registration request.
      const { rows: lockRows } = await client.query<{ granted_to_user_id: string | null }>(
        `SELECT granted_to_user_id FROM wallet_credit_grants WHERE id = $1 FOR UPDATE`,
        [row.id],
      );
      if (lockRows[0]?.granted_to_user_id) {
        await client.query("ROLLBACK");
        continue;
      }
      await client.query(
        `INSERT INTO wallet_accounts (user_id, token_balance, cash_balance)
         VALUES ($1, '0', '0.00')
         ON CONFLICT (user_id) DO NOTHING`,
        [opts.userId],
      );
      const { rows: balRows } = await client.query<{ cash_balance: string }>(
        `UPDATE wallet_accounts
            SET cash_balance = cash_balance + $1,
                last_activity = NOW()
          WHERE user_id = $2
          RETURNING cash_balance`,
        [amountUsd.toFixed(2), opts.userId],
      );
      const balanceAfter = balRows[0]?.cash_balance ?? amountUsd.toFixed(2);
      await client.query(
        `INSERT INTO wallet_transactions
           (transaction_type, amount, balance_after, status, metadata)
         VALUES ('reward', $1, $2, 'confirmed', $3::jsonb)`,
        [
          amountUsd.toFixed(2),
          balanceAfter,
          JSON.stringify({
            userId: opts.userId,
            source: "shop_card_reconcile",
            kind: "jcmoves_usd_mint",
            addonId: row.addon_id,
            grantId: row.id,
            sourceType: row.source_type,
            sourceId: row.source_id,
            currency: "JCMOVES_USD",
          }),
        ],
      );
      await client.query(
        `INSERT INTO rewards
           (user_id, reward_type, token_amount, cash_value, status, reference_id, metadata)
         VALUES ($1, 'jcmoves_usd_mint', '0', $2, 'confirmed', $3, $4::jsonb)
         ON CONFLICT (reference_id) WHERE reward_type = 'jcmoves_usd_mint' AND reference_id IS NOT NULL DO NOTHING`,
        [
          opts.userId,
          amountUsd.toFixed(2),
          `shop_card_grant:${row.id}`,
          JSON.stringify({ source: "shop_card_reconcile", grantId: row.id }),
        ],
      );
      await client.query(
        `UPDATE wallet_credit_grants
            SET granted_to_user_id = $1
          WHERE id = $2 AND granted_to_user_id IS NULL`,
        [opts.userId, row.id],
      );
      await client.query("COMMIT");
      credited++;
      totalUsd += amountUsd;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      console.error(`[bundleBilling] reconcile grant ${row.id} failed:`, (err as Error).message);
    } finally {
      client.release();
    }
  }

  if (credited > 0) {
    console.log(
      `[bundleBilling] reconciled ${credited} pending shop-card grant(s) for user ${opts.userId} (+$${totalUsd.toFixed(2)})`,
    );
  }
  return { credited, totalUsd };
}

// Re-export the manifest helper so server code has a single import.
export { getBundleBillableLines } from "@shared/bundleAddons";

import { pool } from "../db";
import type { PoolClient } from "@neondatabase/serverless";
import { confirmJobPayment } from "./jobPaymentLedger";
import type { ConfirmedJobPayment } from "./jobPaymentLedgerPolicy";

export interface ConfirmedJobRefund {
  provider: string; providerPaymentId: string; providerRefundId: string;
  amountCents: number; giftFundedCents: number; currency: "USD"; refundedAt: string;
}

/** Record a server-verified, completed refund. No wallet deductions or provider
 * refund requests are made. An owner must reconcile any existing paid/reward
 * markers before automatic reward processing can be enabled. */
export async function recordConfirmedJobRefund(refund: ConfirmedJobRefund, transaction?: PoolClient) {
  if (process.env.JOB_PAYMENT_LEDGER_ENABLED !== "true") throw new Error("Canonical payment ledger is disabled");
  for (const value of [refund.provider, refund.providerPaymentId, refund.providerRefundId]) {
    if (typeof value !== "string" || !value.trim() || value.length > 255) throw new Error("Invalid refund identity");
  }
  if (refund.currency !== "USD" || !Number.isSafeInteger(refund.amountCents) || refund.amountCents <= 0
      || !Number.isSafeInteger(refund.giftFundedCents) || refund.giftFundedCents < 0
      || refund.giftFundedCents > refund.amountCents || typeof refund.refundedAt !== "string"
      || !Number.isFinite(Date.parse(refund.refundedAt))) {
    throw new Error("Invalid confirmed refund amount, currency or timestamp");
  }
  const client = transaction || await pool.connect();
  try {
    if (!transaction) await client.query("BEGIN");
    const { rows: payments } = await client.query<{
      id: string; lead_id: string; amount_cents: string; gift_funded_cents: string;
    }>(`SELECT id::text,lead_id,amount_cents::text,gift_funded_cents::text FROM job_confirmed_payments
        WHERE provider=$1 AND provider_payment_id=$2`, [refund.provider, refund.providerPaymentId]);
    const payment = payments[0];
    if (!payment) throw new Error("Record the verified original payment before its refund");
    await client.query("SELECT id FROM leads WHERE id=$1 FOR UPDATE", [payment.lead_id]);
    const inserted = await client.query(
      `INSERT INTO job_confirmed_refunds(provider,provider_refund_id,payment_id,amount_cents,gift_funded_cents,currency,refunded_at)
       VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(provider,provider_refund_id) DO NOTHING RETURNING id`,
      [refund.provider, refund.providerRefundId, payment.id, refund.amountCents, refund.giftFundedCents, refund.currency, refund.refundedAt]);
    const { rows: recorded } = await client.query<{ payment_id: string; amount_cents: string; gift_funded_cents: string }>(
      `SELECT payment_id::text,amount_cents::text,gift_funded_cents::text FROM job_confirmed_refunds
       WHERE provider=$1 AND provider_refund_id=$2`, [refund.provider, refund.providerRefundId]);
    const row = recorded[0];
    if (!row || row.payment_id !== payment.id || Number(row.amount_cents) !== refund.amountCents
        || Number(row.gift_funded_cents) !== refund.giftFundedCents) throw new Error("Refund ID conflicts with its recorded amount or payment");
    const { rows: totals } = await client.query<{ amount: string; gift: string }>(
      `SELECT SUM(amount_cents)::text AS amount,SUM(gift_funded_cents)::text AS gift
       FROM job_confirmed_refunds WHERE payment_id=$1`, [payment.id]);
    const refunded = Number(totals[0].amount), gift = Number(totals[0].gift);
    if (!Number.isSafeInteger(refunded) || refunded > Number(payment.amount_cents)
        || gift > Number(payment.gift_funded_cents)
        || refunded - gift > Number(payment.amount_cents) - Number(payment.gift_funded_cents)) {
      throw new Error("Refund exceeds the original payment or its funding allocation");
    }
    if (!transaction) await client.query("COMMIT");
    return { leadId: payment.lead_id, duplicate: inserted.rows.length === 0, refundedCents: refunded,
      requiresOwnerReview: true as const, rewardsReversed: false as const };
  } catch (error) {
    if (!transaction) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { if (!transaction) client.release(); }
}

/** Catch up an out-of-order refund using a freshly verified original payment.
 * Both facts commit together, and this path never sets the job's paid marker. */
export async function recordConfirmedPaymentAndRefund(payment: ConfirmedJobPayment, refund: ConfirmedJobRefund) {
  if (process.env.JOB_PAYMENT_LEDGER_ENABLED !== "true") throw new Error("Canonical payment ledger is disabled");
  if (payment.provider !== refund.provider || payment.providerPaymentId !== refund.providerPaymentId
      || payment.currency !== refund.currency) throw new Error("Refund does not belong to this payment");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const original = await confirmJobPayment(payment, { transaction: client, deferSettlement: true });
    const result = await recordConfirmedJobRefund(refund, client);
    await client.query("COMMIT");
    return { ...result, paymentDuplicate: original.duplicate };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

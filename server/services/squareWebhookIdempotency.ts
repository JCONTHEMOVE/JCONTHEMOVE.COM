import { createInvoiceEffectClaims, type InvoiceEffectClaim } from "./squareInvoiceEffectClaims";
import { createSquareEventClaims, type SquareEventInput, type SquareEventClaim } from "./squareEventClaims";
import { pool } from "../db";
import { ensureRegionalAutomationSchema } from "./regionalAutomationMigration";

const eventClaims = createSquareEventClaims((sql, args) => pool.query(sql, args));

export async function claimSquareWebhookEvent(input: SquareEventInput) {
  await ensureRegionalAutomationSchema();
  return eventClaims.claim(input);
}

export async function completeSquareWebhookEvent(claim: SquareEventClaim): Promise<void> {
  if (!(await eventClaims.complete(claim))) throw new Error("Square event claim was superseded");
}

export async function failSquareWebhookEvent(claim: SquareEventClaim, error: unknown): Promise<void> {
  await eventClaims.fail(claim, error).catch(() => undefined);
}
const invoiceClaims = createInvoiceEffectClaims((sql, args) => pool.query(sql, args));

export async function claimSquareInvoicePaymentEffect(squareInvoiceId: string, eventId: string) {
  await ensureRegionalAutomationSchema();
  return invoiceClaims.claim(squareInvoiceId, eventId);
}

export async function completeSquareInvoicePaymentEffect(claim: InvoiceEffectClaim): Promise<void> {
  if (!(await invoiceClaims.complete(claim))) throw new Error("Square invoice claim was superseded");
}

export async function failSquareInvoicePaymentEffect(claim: InvoiceEffectClaim, error: unknown): Promise<void> {
  await invoiceClaims.fail(claim, error).catch(() => undefined);
}

import type { Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from './db';
import { storage } from './storage';
import { classifyJobInvoicePayment } from './services/jobPaymentClassification';
import { emitJobEvent } from './services/jobEventBus';

type WebhookEffects = {
  writeLeadHistory(leadId: string, fromStatus: string | null, toStatus: string, changedByUserId: string | null, note?: string): Promise<unknown>;
  sendCompletedJobReviewRequest(lead: any): Promise<unknown>;
  recordRevenueSplit(amount: number, leadId: string, source?: string): Promise<void>;
  creditJcMovesUsd(leadId: string, amount: number, source?: string): Promise<void>;
  creditJcMovesUsdFromPrepaid(userId: string, amount: number, paymentId: string): Promise<void>;
  awardPrepaidCreditBonusTokens(intent: { id: number | string; user_id: string | null; amount_usd: string | number; pack_id?: string | null; bonus_tokens?: string | number | null }, paymentId: string): Promise<boolean>;
};

/** The production signed endpoint, separated from unrelated route registration. */
export function createSquareWebhookHandler(effects: WebhookEffects) {
  const { writeLeadHistory, sendCompletedJobReviewRequest, recordRevenueSplit,
    creditJcMovesUsd, creditJcMovesUsdFromPrepaid, awardPrepaidCreditBonusTokens } = effects;
  return async (req: Request, res: Response) => {
    let claimedWebhookEvent: import("./services/squareEventClaims").SquareEventClaim | null = null;
    let claimedPaymentInvoice: import("./services/squareInvoiceEffectClaims").InvoiceEffectClaim | null = null;
    try {
      const rawBody = req.body as Buffer;
      const bodyStr = rawBody.toString("utf8");

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(bodyStr) as Record<string, unknown>;
      } catch {
        return res.status(400).json({ error: "Invalid JSON body" });
      }

      const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
      if (!signatureKey) {
        console.error("[Square webhook] SQUARE_WEBHOOK_SIGNATURE_KEY is not configured — rejecting event");
        return res.status(401).json({ error: "Webhook signature key not configured" });
      }

      const signature = req.headers["x-square-hmacsha256-signature"];
      if (!signature || typeof signature !== "string") {
        console.warn("[Square webhook] Missing or malformed signature header");
        return res.status(401).json({ error: "Missing signature" });
      }

      const notificationUrl =
        process.env.SQUARE_WEBHOOK_URL || `https://${req.headers.host}/api/webhooks/square`;
      const hmac = crypto.createHmac("sha256", signatureKey);
      hmac.update(notificationUrl + bodyStr);
      const expectedBuf = hmac.digest();
      const receivedBuf = Buffer.from(signature, "base64");
      const signatureValid =
        expectedBuf.length === receivedBuf.length &&
        crypto.timingSafeEqual(expectedBuf, receivedBuf);
      if (!signatureValid) {
        console.warn("[Square webhook] Signature mismatch — rejecting event");
        return res.status(401).json({ error: "Invalid signature" });
      }

      const eventType = typeof event.type === "string" ? event.type : "";
      const data = (event.data as Record<string, unknown> | undefined)?.object as Record<string, unknown> | undefined;

      const webhookEventId = typeof event.event_id === "string"
        ? event.event_id
        : typeof event.id === "string" ? event.id : "";
      if (!webhookEventId) return res.status(400).json({ error: "Square event id is required" });
      const eventObject = (data?.invoice || data?.payment || data?.refund || data?.dispute || data?.gift_card_activity) as Record<string, unknown> | undefined;
      const squareObjectId = typeof eventObject?.id === "string" ? eventObject.id : null;
      const { claimSquareWebhookEvent, completeSquareWebhookEvent } = await import("./services/squareWebhookIdempotency");
      const webhookClaim = await claimSquareWebhookEvent({ eventId: webhookEventId, eventType, squareObjectId, rawBody: bodyStr });
      if (webhookClaim.status === "processed") {
        return res.status(200).json({ received: true, duplicate: true });
      }
      if (webhookClaim.status === "in_progress") {
        res.setHeader("Retry-After", "10");
        return res.status(503).json({ received: false, retry: true });
      }
      claimedWebhookEvent = webhookClaim.claim;

      console.log(`[Square webhook] Received event: ${eventType}`);

      const { squareInvoiceService } = await import("./services/square-invoice");

      if (eventType === "catalog.version.updated") {
        const { scanSquareCatalogDrift } = await import("./services/commerceSquareCatalog");
        const drift = await scanSquareCatalogDrift();
        console.log(`[Square webhook] Catalog drift scan checked ${drift.checked} managed objects; ${drift.drift.length} require review`);
      } else if (eventType === "gift_card.activity.created" || eventType === "gift_card.activity.updated") {
        const { handleSquareGiftCardActivityEvent } = await import("./services/giftCardBonuses");
        await handleSquareGiftCardActivityEvent(data?.gift_card_activity || data?.giftCardActivity);
      } else if (eventType === "refund.updated") {
        const { handleSquareGiftCardRefundEvent } = await import("./services/giftCardBonuses");
        await handleSquareGiftCardRefundEvent(data?.refund);
      } else if (eventType === "dispute.created" || eventType === "dispute.updated") {
        const { handleSquareGiftCardDisputeEvent } = await import("./services/giftCardBonuses");
        await handleSquareGiftCardDisputeEvent(data?.dispute);
      } else if (eventType === "invoice.payment_made" || eventType === "invoice.paid") {
        const invoice = (data?.invoice as Record<string, unknown> | undefined);
        const squareInvoiceId = typeof invoice?.id === "string" ? invoice.id : undefined;

        // INVARIANT — JCMOVES USD only mints on payment RECEIVED IN FULL.
        // `invoice.payment_made` fires on EVERY payment, including partial
        // ones (e.g. $50 paid on a $300 invoice). Only `invoice.paid` is
        // guaranteed fully-paid. We gate ALL wallet-affecting work below
        // on the actual invoice status from Square's payload — accepted
        // statuses are PAID and the legacy alias "paid". This prevents a
        // partial payment from minting the full shop-card grant, marking
        // the lead paid, dispatching crew, or recording revenue.
        const invoiceStatus = typeof invoice?.status === "string" ? invoice.status.toUpperCase() : "";
        const isFullyPaid = invoiceStatus === "PAID" || eventType === "invoice.paid";
        if (!isFullyPaid) {
          console.log(`[Square webhook] ${eventType} for ${squareInvoiceId} — invoice status=${invoiceStatus || "unknown"}, NOT fully paid, skipping wallet/lead/dispatch work (waiting for invoice.paid)`);
          await completeSquareWebhookEvent(webhookClaim.claim);
          return res.json({ received: true, skipped: "partial_payment" });
        }

        if (squareInvoiceId) {
          const { claimSquareInvoicePaymentEffect } = await import("./services/squareWebhookIdempotency");
          const invoiceClaim = await claimSquareInvoicePaymentEffect(squareInvoiceId, webhookEventId);
          if (invoiceClaim.status === "processed") {
            await completeSquareWebhookEvent(webhookClaim.claim);
            return res.status(200).json({ received: true, duplicateInvoicePayment: true });
          }
          if (invoiceClaim.status === "in_progress") {
            // Another delivery still owns this invoice. Keep this event retryable.
            throw new Error("Square invoice payment is still processing");
          }
          claimedPaymentInvoice = invoiceClaim.claim;
          // Task #199 — fire any shop-card wallet grants tied to this
          // invoice. This runs FIRST and is idempotent so duplicate
          // webhook deliveries can't double-mint. Gated on isFullyPaid
          // above per the JCMOVES USD invariant.
          try {
            const { rows: grantSourceRows } = await pool.query<{
              source_type: string;
              source_id: string;
            }>(
              `SELECT DISTINCT source_type, source_id
                 FROM wallet_credit_grants
                WHERE square_invoice_id = $1`,
              [squareInvoiceId],
            );
            if (grantSourceRows.length > 0) {
              const { grantWalletCreditForSource } = await import("./services/bundleBilling");
              for (const src of grantSourceRows) {
                await grantWalletCreditForSource({
                  sourceType: src.source_type as "lead" | "lawn_care_quote",
                  sourceId: src.source_id,
                  paymentReference: `square_invoice:${squareInvoiceId}`,
                  squareInvoiceId,
                });
              }
            }
          } catch (grantErr) {
            console.error("[Square webhook] shop-card grant disbursement failed:", (grantErr as Error).message);
            throw grantErr;
          }

          const localInvoice = await storage.getSquareInvoiceBySquareId(squareInvoiceId);
          if (localInvoice) {
            await storage.updateSquareInvoiceStatus(squareInvoiceId, "paid", new Date());
            try {
              const { markCommerceCheckoutPaid } = await import("./services/commerceCheckout");
              await markCommerceCheckoutPaid(squareInvoiceId);
            } catch (checkoutError) {
              console.error("[Square webhook] commerce checkout update failed:", checkoutError);
              throw checkoutError;
            }
            console.log(`[Square webhook] Invoice ${squareInvoiceId} marked as paid`);

            if (localInvoice.squareOrderId) {
              try {
                const { recordSquareGiftCardTenderForOrder } = await import("./services/giftCardBonuses");
                await recordSquareGiftCardTenderForOrder(localInvoice.squareOrderId);
              } catch (tenderError) {
                console.error("[Square webhook] Gift-card tender accounting failed:", (tenderError as Error).message);
                throw tenderError;
              }
            }

            if (localInvoice.leadId) {
              const lead = await storage.getLead(localInvoice.leadId);
              if (lead) {
                type SquareMoneyField = { amount?: number; currency?: string };
                type SquareInvoicePayload = { total_money?: SquareMoneyField };
                const squareCents = (invoice as SquareInvoicePayload).total_money?.amount;
                const invoiceAmount = typeof squareCents === "number" && squareCents > 0
                  ? squareCents / 100
                  : Number(localInvoice.amount || 0);
                const payment = process.env.JOB_PAYMENT_LEDGER_ENABLED === "true"
                  ? await (await import("./services/canonicalInvoicePayment")).classifyCanonicalInvoicePayment({
                    leadId: localInvoice.leadId, orderId: localInvoice.squareOrderId,
                    invoiceAmount, depositRequired: lead.depositRequired, depositAmount: lead.depositAmount,
                  })
                  : classifyJobInvoicePayment({
                  invoiceAmount,
                  jobTotal: lead.totalPrice,
                  depositAmount: lead.depositAmount,
                  depositRequired: lead.depositRequired,
                  depositAlreadyPaid: lead.depositPaid,
                  invoicePurpose: localInvoice.purpose,
                });

                if (payment.kind === "partial") {
                  // Keep the paid invoice for reconciliation without settling the job.
                  console.log(`[Square webhook] Invoice ${squareInvoiceId} is a partial job payment; reconciliation required`);
                } else if (payment.kind === "deposit") {
                  const updated = await pool.query<{ status: string }>(
                    `UPDATE leads
                        SET deposit_paid = true,
                            status = CASE
                              WHEN status IN ('new','quote_requested','quoted','awaiting_deposit','paid') THEN 'confirmed'
                              ELSE status
                            END,
                             last_quote_updated_at = NOW()
                            ,financial_status = 'deposit_paid'
                      WHERE id = $1
                      RETURNING status`,
                    [localInvoice.leadId],
                  );
                  const nextStatus = String(updated.rows[0]?.status || lead.status);
                  try {
                    await writeLeadHistory(localInvoice.leadId, lead.status, nextStatus, null, `Scheduling deposit paid: ${squareInvoiceId}`);
                  } catch (histErr) {
                    console.error("[Square webhook] deposit history write failed:", histErr);
                  }
                  console.log(`[Square webhook] Lead ${localInvoice.leadId} deposit paid; remaining job balance is still due`);
                  try {
                    const { emitCustomerLifecycleEvent } = await import("./services/customerLifecycle");
                    await emitCustomerLifecycleEvent({
                      leadId: localInvoice.leadId,
                      type: "deposit_received",
                      eventKey: `${localInvoice.leadId}:deposit_received:${squareInvoiceId}`,
                      title: "Your scheduling deposit is received",
                      message: "Your time is confirmed. JC crew assignment is now in progress.",
                      payload: { squareInvoiceId, amountUsd: payment.invoiceAmount },
                    });
                    await emitCustomerLifecycleEvent({
                      leadId: localInvoice.leadId,
                      type: "crew_confirmation_in_progress",
                      eventKey: `${localInvoice.leadId}:crew_confirmation_in_progress:${squareInvoiceId}`,
                      title: "Crew confirmation is in progress",
                      message: "The system is filling each required JC crew position. You will be notified when the full roster is confirmed.",
                    });
                  } catch (customerEventError) {
                    console.error("[Square webhook] deposit customer lifecycle notification failed:", customerEventError);
                  }
                  await emitJobEvent("job_updated", { ...lead, status: nextStatus, depositPaid: true } as any, {
                    source: "square_webhook",
                    previousStatus: lead.status,
                    status: nextStatus,
                    note: "Scheduling deposit paid. Paid-in-full rewards and accounting remain locked until the balance is paid.",
                    extra: { squareInvoiceId, paymentReceived: true, paymentScope: "deposit", amountUsd: payment.invoiceAmount },
                  });
                } else {
                  const nextStatus = lead.status === "completed" ? "completed" : "paid";
                  await pool.query(
                    `UPDATE leads
                        SET status = CASE WHEN status = 'completed' THEN status ELSE 'paid' END,
                            payment_paid_at = COALESCE(payment_paid_at, NOW()),
                            deposit_paid = CASE WHEN deposit_required THEN true ELSE deposit_paid END,
                             last_quote_updated_at = NOW()
                            ,financial_status = 'paid'
                            ,closeout_status = CASE WHEN closeout_status IS NOT NULL THEN 'paid' ELSE closeout_status END
                      WHERE id = $1`,
                    [localInvoice.leadId],
                  );
                  if (lead.status !== "paid" && lead.status !== "completed") {
                    try {
                      await writeLeadHistory(localInvoice.leadId, lead.status, "paid", null, `Square job balance paid: ${squareInvoiceId}`);
                    } catch (histErr) {
                      console.error("[Square webhook] paid history write failed:", histErr);
                    }
                  }
                  if (lead.status === "completed") {
                    try {
                      const { disburseJobTokens } = await import("./services/disburse-job-tokens");
                      await disburseJobTokens(localInvoice.leadId);
                    } catch (disbursementError) {
                      console.error("[Square webhook] completed-job JCMOVES disbursement failed:", disbursementError);
                    }
                    try {
                      if (localInvoice.closeoutId) {
                        await pool.query(
                          `UPDATE job_closeouts SET status='paid', updated_at=NOW() WHERE id=$1`,
                          [localInvoice.closeoutId],
                        );
                      }
                      const { emitCustomerLifecycleEvent } = await import("./services/customerLifecycle");
                      await emitCustomerLifecycleEvent({
                        leadId: localInvoice.leadId,
                        type: "final_payment_received",
                        eventKey: `${localInvoice.leadId}:final_payment_received:${squareInvoiceId}`,
                        title: "Final payment received",
                        message: "Your JC ON THE MOVE job is financially complete. Thank you for choosing our crew.",
                        payload: { squareInvoiceId, amountUsd: payment.invoiceAmount },
                      });
                      const paidLead = await storage.getLead(localInvoice.leadId);
                      if (paidLead) await sendCompletedJobReviewRequest(paidLead);
                    } catch (customerEventError) {
                      console.error("[Square webhook] final customer lifecycle notification failed:", customerEventError);
                    }
                  }
                  if (payment.accountingAmount > 0) {
                    await recordRevenueSplit(payment.accountingAmount, localInvoice.leadId, "square_payment_in_full");
                    await creditJcMovesUsd(localInvoice.leadId, payment.accountingAmount, "square_webhook_paid_in_full");
                  }
                  await emitJobEvent("job_updated", { ...lead, status: nextStatus, depositPaid: lead.depositRequired ? true : lead.depositPaid } as any, {
                    source: "square_webhook",
                    previousStatus: lead.status,
                    status: nextStatus,
                    note: "Square confirmed the approved job balance paid in full.",
                    extra: { squareInvoiceId, paymentReceived: true, paymentScope: "paid_in_full", amountUsd: payment.accountingAmount },
                  });
                }

                if (payment.kind !== "partial") {
                  // A paid deposit or a full payment confirms an exact-time
                  // hold. This does not imply that the full job balance is paid.
                  try {
                    await pool.query(
                      "UPDATE booking_slot_holds SET status='confirmed', updated_at=NOW() " +
                      "WHERE lead_id=$1 AND status='awaiting_deposit'",
                      [localInvoice.leadId],
                    );
                    await pool.query(
                      "UPDATE bookings SET status='booked' WHERE id IN " +
                      "(SELECT booking_id FROM booking_slot_holds WHERE lead_id=$1 AND status='confirmed')",
                      [localInvoice.leadId],
                    );
                  } catch (holdErr) {
                    console.warn("[Square webhook] booking hold confirmation skipped:", holdErr instanceof Error ? holdErr.message : holdErr);
                  }

                  if (lead.status !== "completed") {
                    try {
                      const { dispatchJob } = await import("./dispatch");
                      const dispatchResult = await dispatchJob(lead.id, { reason: `square_${payment.kind}` });
                      console.log(`[Square webhook] Dispatch request for ${lead.id}: ${dispatchResult.state}${dispatchResult.message ? ` (${dispatchResult.message})` : ""}`);
                    } catch (dispatchErr: unknown) {
                      const msg = dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr);
                      console.error(`[Square webhook] Auto-dispatch failed for lead ${localInvoice.leadId}:`, msg);
                    }
                  }
                }
              }
            }
          } else {
            throw new Error(`No local invoice found for Square ID: ${squareInvoiceId}`);
          }
        }
      } else if (eventType === "payment.created" || eventType === "payment.updated") {
        // Detect Prepaid Credit Top-Up payments by matching Square order_id against
        // our prepaid_credit_intents table. We only credit on COMPLETED payments.
        try {
          const payment = (data?.payment as Record<string, unknown> | undefined);
          const status = typeof payment?.status === "string" ? payment.status : undefined;
          const orderId = typeof payment?.order_id === "string" ? payment.order_id : undefined;
          const paymentId = typeof payment?.id === "string" ? payment.id : undefined;
          if (status === "COMPLETED" && orderId && paymentId) {
            await pool.query(`
              UPDATE commerce_checkout_intents c
              SET status='paid', square_payment_id=$2, updated_at=now()
              FROM square_invoices si
              WHERE c.square_invoice_id=si.square_invoice_id AND si.square_order_id=$1
            `, [orderId, paymentId]).catch(() => undefined);
            try {
              const { handleSquareGiftCardPaymentEvent, recordSquareGiftCardTenderForOrder } = await import("./services/giftCardBonuses");
              await handleSquareGiftCardPaymentEvent(payment);
              await recordSquareGiftCardTenderForOrder(orderId);
            } catch (giftCardError) {
              console.error("[Square webhook] Gift-card bonus/tender handling failed:", (giftCardError as Error).message);
              throw giftCardError;
            }
            const { rows } = await pool.query(
              `SELECT id, user_id, amount_usd, status, pack_id, bonus_tokens, bonus_awarded_at
               FROM prepaid_credit_intents WHERE square_order_id = $1 LIMIT 1`,
              [orderId]
            );
            if (rows.length && rows[0].status !== 'paid') {
              const intent = rows[0];
              await creditJcMovesUsdFromPrepaid(intent.user_id, parseFloat(intent.amount_usd), paymentId);
              await awardPrepaidCreditBonusTokens(intent, paymentId);
              await pool.query(
                `UPDATE prepaid_credit_intents
                 SET status='paid', square_payment_id=$1, paid_at=NOW()
                 WHERE id=$2`,
                [paymentId, intent.id]
              );
              console.log(`[Square webhook] Prepaid credit minted for intent ${intent.id} ($${intent.amount_usd})`);
            } else if (rows.length) {
              await awardPrepaidCreditBonusTokens(rows[0], paymentId);
            }
          }
        } catch (prepaidErr) {
          console.error("[Square webhook] Prepaid credit handling failed:", prepaidErr);
          throw prepaidErr;
        }
      } else if (eventType === "invoice.updated") {
        const invoice = (data?.invoice as Record<string, unknown> | undefined);
        const squareInvoiceId = typeof invoice?.id === "string" ? invoice.id : undefined;
        const squareStatus = typeof invoice?.status === "string" ? invoice.status : undefined;
        if (squareInvoiceId && squareStatus) {
          const mappedStatus = squareInvoiceService.mapSquareStatus(squareStatus);
          await storage.updateSquareInvoiceStatus(squareInvoiceId, mappedStatus);
          console.log(`[Square webhook] Invoice ${squareInvoiceId} status synced to ${mappedStatus}`);
        }
      }

      const { processCanonicalSquareWebhook } = await import("./services/canonicalSquareWebhook");
      await processCanonicalSquareWebhook(eventType, squareObjectId);
      if (claimedPaymentInvoice) {
        const { completeSquareInvoicePaymentEffect } = await import("./services/squareWebhookIdempotency");
        await completeSquareInvoicePaymentEffect(claimedPaymentInvoice);
      }
      await completeSquareWebhookEvent(webhookClaim.claim);
      res.status(200).json({ received: true });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[Square webhook] Error processing event:", msg);
      if (claimedWebhookEvent) {
        const { failSquareWebhookEvent } = await import("./services/squareWebhookIdempotency");
        await failSquareWebhookEvent(claimedWebhookEvent, error);
      }
      if (claimedPaymentInvoice) {
        const { failSquareInvoicePaymentEffect } = await import("./services/squareWebhookIdempotency");
        await failSquareInvoicePaymentEffect(claimedPaymentInvoice, error);
      }
      res.status(500).json({ error: "Webhook processing failed" });
    }

  };
}

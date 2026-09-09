/**
 * disburseJobTokens — Idempotent JCMOVES token disbursement service
 *
 * Payout rules (fires exactly once per job):
 *  A) CREW flat      — worker_job_completion_bonus setting (default 500 JCMOVES) per member
 *                      +25% bonus if the member is flagged in crewBonusFlags
 *  B) CREW hours     — 25 JCMOVES × confirmedHours per crew member (same +25% multiplier)
 *  C) CUSTOMER earn  — tokenAllocation (if set) OR earn_rate_per_dollar × totalPrice
 *  D) REFERRAL bonus — first completed job referral bonus to the referrer
 *
 * Idempotency (multi-level):
 *
 *  Level 1 — Job fast-path: skip immediately if tokens_disbursed_at is already set.
 *
 *  Level 2 — Concurrency guard: PostgreSQL advisory lock (pg_try_advisory_lock)
 *            ensures only ONE caller can proceed for a given lead at a time.
 *            All other concurrent calls receive null immediately.
 *
 *  Level 3 — Per-recipient guard: before each wallet credit, SELECT the rewards
 *            table to check if a row already exists for (leadId, userId, rewardType).
 *            The advisory lock ensures no concurrent call can insert between our
 *            SELECT and INSERT, so double-credit is impossible.
 *            Order: SELECT → INSERT reward row → credit wallet.
 *            If wallet credit fails after INSERT, the reward row acts as a sentinel:
 *            the next retry finds the row and skips both operations.
 *
 *  Level 4 — Completion stamp: tokens_disbursed_at is written only after all
 *            per-recipient operations either succeed or are confirmed already-done.
 */
import { db, pool } from "../db";
import { rewards, rewardSettings, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { storage } from "../storage";
import type { Lead } from "@shared/schema";
import { EARN_RATE_PER_DOLLAR } from "../../shared/rewards";
import { regularPaymentRewardBonus } from "@shared/paymentIncentives";
import { getJobRateCard } from "./jobRateCard";
import { emitJobEvent } from "./jobEventBus";
import { calculateCustomerRewardBase } from "../../shared/giftCardBonuses";
import { acquireJobDisbursementLock } from "./jobDisbursementLock";

const TOKEN_PRICE            = 0.00000508432;
const HOURS_RATE             = 25;    // JCMOVES per confirmed hour per crew member
const FALLBACK_FLAT          = 500;   // JCMOVES flat per worker if setting not found
const FALLBACK_EARN          = EARN_RATE_PER_DOLLAR; // JCMOVES per $1 — from shared config; DB overrides at runtime
const FALLBACK_COMPLETION    = 1500;  // JCMOVES flat bonus for customer on job completion
const FALLBACK_REFERRAL      = 1000;  // JCMOVES awarded to referrer on first confirmed job
const BONUS_MULTIPLIER       = 1.25;  // +25% for bonus-flagged movers
const FALLBACK_SERVICE_BONUS = 150;   // Default service-type completion bonus

// Strict canonical map from lead.serviceType to reward_settings key.
// Only the exact service types listed here receive a named bonus;
// all other values (including "cleaning", "demolition", "trash_valet", etc.) → default.
const SERVICE_BONUS_MAP: Record<string, string> = {
  // Moving
  residential:       "moving_completion_bonus",
  moving:            "moving_completion_bonus",
  loading:           "moving_completion_bonus",
  furniture:         "moving_completion_bonus",
  // Junk removal
  junk:              "junk_removal_completion_bonus",
  junk_removal:      "junk_removal_completion_bonus",
  "junk removal":    "junk_removal_completion_bonus",
  // Labor
  labor:             "labor_completion_bonus",
  general:           "labor_completion_bonus",
  labor_only:        "labor_completion_bonus",
  // Snow removal
  snow:              "snow_completion_bonus",
  snow_removal:      "snow_completion_bonus",
  "snow removal":    "snow_completion_bonus",
  // Lawn care
  lawn:              "lawn_completion_bonus",
  lawn_care:         "lawn_completion_bonus",
  "lawn care":       "lawn_completion_bonus",
  // Window cleaning (only explicit "window cleaning" variants)
  window_cleaning:       "window_cleaning_completion_bonus",
  "window cleaning":     "window_cleaning_completion_bonus",
  "window wash":         "window_cleaning_completion_bonus",
  // Handyman
  handyman:          "handyman_completion_bonus",
  flooring:          "handyman_completion_bonus",
  painting:          "handyman_completion_bonus",
};

function getServiceBonusKey(serviceType: string): string {
  const key = (serviceType || "").toLowerCase().trim();
  return SERVICE_BONUS_MAP[key] ?? "default_service_bonus";
}

export type DisbursementSummary = {
  customerTokens: number;
  perCrewFlatTokens: number;
  perCrewHoursTokens: number;
  crewIds: string[];
  crewTokenAmounts?: Record<string, number>;
  customerId?: string;
  disbursedAt: Date;
};

async function getSetting(key: string): Promise<number | null> {
  const rows = await db
    .select()
    .from(rewardSettings)
    .where(eq(rewardSettings.settingKey, key))
    .limit(1);
  if (rows.length > 0 && rows[0].isActive) return parseFloat(rows[0].tokenAmount);
  return null;
}

function getTierFromSpend(totalSpend: number): string {
  if (totalSpend >= 5000) return "diamond";
  if (totalSpend >= 2000) return "platinum";
  if (totalSpend >= 1000) return "gold";
  if (totalSpend >= 500)  return "silver";
  return "bronze";
}

async function awardPoints(userId: string, action: string, count = 1): Promise<void> {
  const TIER_POINTS: Record<string, number> = {
    signup: 100, daily_login: 5, first_spin: 50, spin_play: 10, lottery_entry: 15,
    profile_complete: 75, review_submitted: 100, referral_signup: 200,
    referral_confirmed: 500, job_completed: 300, employee_job_done: 200,
    employee_lead_created: 50, per_100_spent: 25, staking: 20, checkin: 10,
  };
  const pts = (TIER_POINTS[action] ?? 0) * count;
  if (pts <= 0) return;
  try {
    const { sql: sqlFn } = await import("drizzle-orm");
    await db
      .update(users)
      .set({ tierPoints: sqlFn`COALESCE(tier_points, 0) + ${pts}` })
      .where(eq(users.id, userId));
  } catch (_) {}
}

/**
 * Checks if a reward row already exists for (leadId, userId, rewardType).
 * Used as a per-recipient idempotency guard under the advisory lock.
 * Safe from TOCTOU races because the advisory lock prevents concurrent callers.
 */
async function rewardAlreadyExists(
  leadId: string,
  userId: string,
  rewardType: string
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM rewards
     WHERE user_id = $1
       AND reward_type = $2
       AND reference_id = $3
     LIMIT 1`,
    [userId, rewardType, leadId]
  );
  return rows.length > 0;
}

/** Convert a leadId string to a stable 32-bit integer for PostgreSQL advisory lock. */
function leadIdToLockKey(leadId: string): number {
  let h = 0;
  for (let i = 0; i < leadId.length; i++) {
    h = (Math.imul(31, h) + leadId.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Produces whole-token crew awards for a finalized reward pool. The selected
 * lead receives 15% first only when a lead is explicitly saved. Without a
 * saved lead, every selected crew member receives an equal share (apart from
 * an unavoidable whole-token remainder assigned to the first selected member).
 */
export function calculateCrewPoolAllocation(
  poolTokens: number,
  selectedCrewIds: Array<string | null | undefined>,
  requestedCrewLeadId?: string | null,
) {
  const crewIds = Array.from(new Set(selectedCrewIds.filter((memberId): memberId is string => Boolean(memberId))));
  const crewLeadId = crewIds.includes(requestedCrewLeadId || "") ? requestedCrewLeadId! : null;
  const leadBonus = crewLeadId ? Math.floor(poolTokens * 0.15) : 0;
  const remainingPool = poolTokens - leadBonus;
  const baseShare = crewIds.length ? Math.floor(remainingPool / crewIds.length) : 0;
  const roundingRemainder = crewIds.length ? remainingPool - (baseShare * crewIds.length) : 0;
  const roundingRecipientId = crewLeadId || crewIds[0] || null;
  const amounts = Object.fromEntries(crewIds.map((memberId) => [
    memberId,
    baseShare + (memberId === roundingRecipientId ? leadBonus + roundingRemainder : 0),
  ]));

  return { crewIds, crewLeadId, leadBonus, baseShare, roundingRemainder, amounts };
}

type JobLedgerRecipient = {
  ledgerId: number;
  leadId: string;
  userId: string;
  rewardType: "customer_paid_completed_pool" | "crew_paid_completed_pool";
  amount: number;
  quoteTotal: number;
  ratePerDollar: number;
  metadata?: Record<string, unknown>;
};

/**
 * Settles an already-recorded job ledger entry atomically. The durable ledger
 * is written before this runs; the reward row, wallet balance, and settlement
 * marker are committed together, so a retry cannot double-credit after a
 * partial failure.
 */
async function settleJobLedgerRecipient(input: JobLedgerRecipient): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: ledgerRows } = await client.query<{ metadata: Record<string, unknown> | null }>(
      "SELECT metadata FROM job_jcmoves_ledger WHERE id = $1 FOR UPDATE",
      [input.ledgerId],
    );
    if (!ledgerRows.length) throw new Error(`JCMOVES ledger ${input.ledgerId} was not found`);
    if (ledgerRows[0].metadata?.walletCreditedAt) {
      await client.query("COMMIT");
      return false;
    }

    const existingReward = await client.query(
      `SELECT 1 FROM rewards
        WHERE user_id = $1 AND reward_type = $2 AND reference_id = $3
        LIMIT 1`,
      [input.userId, input.rewardType, input.leadId],
    );
    if (existingReward.rowCount === 0) {
      await client.query(
        `INSERT INTO rewards (user_id, reward_type, token_amount, cash_value, status, earned_date, reference_id, metadata)
         VALUES ($1,$2,$3,$4,'confirmed',NOW(),$5,$6::jsonb)`,
        [
          input.userId,
          input.rewardType,
          input.amount.toFixed(8),
          (input.amount * TOKEN_PRICE).toFixed(6),
          input.leadId,
          JSON.stringify({
            jobId: input.leadId,
            ratePerDollar: input.ratePerDollar,
            quoteTotal: input.quoteTotal,
            ...(input.metadata ?? {}),
          }),
        ],
      );
    }

    await client.query(
      "INSERT INTO wallet_accounts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
      [input.userId],
    );
    await client.query(
      `UPDATE wallet_accounts
          SET token_balance = (COALESCE(token_balance, 0)::numeric + $2)::numeric(18,8),
              total_earned = (COALESCE(total_earned, 0)::numeric + $2)::numeric(18,8),
              last_activity = NOW()
        WHERE user_id = $1`,
      [input.userId, input.amount],
    );
    await client.query(
      `UPDATE job_jcmoves_ledger
          SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('walletCreditedAt', NOW()::text)
        WHERE id = $1`,
      [input.ledgerId],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Current job-card reward rule: one customer pool and one crew pool, each
 * equal to quote dollars × the editable JCMOVES rate. The crew lead receives
 * a 15% bonus; the remaining 85% is split evenly among every selected member
 * (including the lead), with whole-token rounding remainder going to the lead.
 */
async function disburseRateCardJcMoves(leadId: string, lead: Lead & { crewLeadUserId?: string | null; jcmovesRewardBase?: string | null }) {
  const { rows: paymentRows } = await pool.query<{ payment_paid_at: Date | null; jcmoves_reward_base: string | null }>(
    "SELECT payment_paid_at, jcmoves_reward_base FROM leads WHERE id = $1 LIMIT 1",
    [leadId],
  );
  if (lead.status !== "completed") {
    console.warn(`[JCMOVES] ${leadId} is not completed; ledger issuance deferred.`);
    return null;
  }
  if (!paymentRows[0]?.payment_paid_at) {
    console.warn(`[JCMOVES] ${leadId} is completed but not paid in full; ledger issuance deferred.`);
    return null;
  }

  const rateCard = await getJobRateCard();
  const quoteTotal = Number(paymentRows[0]?.jcmoves_reward_base || lead.jcmovesRewardBase || lead.totalPrice || lead.basePrice || 0);
  if (!Number.isFinite(quoteTotal) || quoteTotal <= 0) {
    console.warn(`[JCMOVES] ${leadId} has no finalized quote; ledger issuance deferred.`);
    return null;
  }
  const poolTokens = Math.round(quoteTotal * rateCard.jcmovesPerDollar);
  const giftCardTenderResult = await pool.query<{ gift_card_funded_usd: string }>(
    `SELECT COALESCE(SUM(gift_card_paid_amount), 0)::text AS gift_card_funded_usd
       FROM square_invoices
      WHERE lead_id=$1 AND status='paid'`,
    [leadId],
  );
  const giftCardFundedUsd = Math.min(quoteTotal, Number(giftCardTenderResult.rows[0]?.gift_card_funded_usd || 0));
  const customerEligibleQuoteTotal = calculateCustomerRewardBase(quoteTotal, giftCardFundedUsd);
  const customerPoolTokens = Math.round(customerEligibleQuoteTotal * rateCard.jcmovesPerDollar);
  const crewAllocation = calculateCrewPoolAllocation(poolTokens, [
    ...(Array.isArray(lead.crewMembers) ? lead.crewMembers : []),
    ...(lead.assignedToUserId ? [lead.assignedToUserId] : []),
  ], lead.crewLeadUserId);
  const { crewIds, crewLeadId, leadBonus, baseShare, roundingRemainder } = crewAllocation;
  const now = new Date();

  const customerLookup = lead.email
    ? await pool.query<{ id: string; email: string }>("SELECT id, email FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1", [lead.email.trim()])
    : { rows: [] as Array<{ id: string; email: string }> };
  const customer = customerLookup.rows[0] || null;

  async function writeLedger(input: {
    recipientType: "customer" | "crew";
    recipientUserId: string | null;
    recipientLabel: string;
    rewardKind: string;
    amount: number;
    quoteTotalUsd?: number;
    metadata: Record<string, unknown>;
  }) {
    const result = await pool.query<{ id: number }>(
      `INSERT INTO job_jcmoves_ledger
        (lead_id, recipient_type, recipient_user_id, recipient_label, reward_kind, token_amount, quote_total, rate_per_dollar, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [leadId, input.recipientType, input.recipientUserId, input.recipientLabel, input.rewardKind, input.amount, input.quoteTotalUsd ?? quoteTotal, rateCard.jcmovesPerDollar, JSON.stringify(input.metadata)],
    );
    if (result.rows[0]) return result.rows[0];
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM job_jcmoves_ledger
        WHERE lead_id = $1
          AND recipient_type = $2
          AND reward_kind = $3
          AND (($4::varchar IS NULL AND recipient_user_id IS NULL) OR recipient_user_id = $4)
        ORDER BY id ASC
        LIMIT 1`,
      [leadId, input.recipientType, input.rewardKind, input.recipientUserId],
    );
    if (!rows[0]) throw new Error(`Could not resolve JCMOVES ledger for ${input.recipientType}`);
    return rows[0];
  }

  const normalizedCustomerEmail = String(lead.email || "").trim().toLowerCase();
  const customerRewardKind = customer ? "customer_paid_completed_pool" : "customer_paid_completed_pool_pending_claim";
  const customerLedger = await writeLedger({
    recipientType: "customer",
    recipientUserId: customer?.id || null,
    recipientLabel: customer?.email?.trim().toLowerCase() || normalizedCustomerEmail || "Customer",
    rewardKind: customerRewardKind,
    amount: customerPoolTokens,
    quoteTotalUsd: customerEligibleQuoteTotal,
    metadata: {
      source: "rate_card",
      paid: true,
      completed: true,
      pendingCustomerClaim: !customer,
      finalizedQuoteUsd: quoteTotal,
      giftCardFundedUsd,
      customerEligibleQuoteUsd: customerEligibleQuoteTotal,
      giftCardDoubleEarnExcluded: giftCardFundedUsd > 0,
    },
  });
  if (customer && customerPoolTokens > 0) {
    await settleJobLedgerRecipient({
      ledgerId: customerLedger.id,
      leadId,
      userId: customer.id,
      rewardType: "customer_paid_completed_pool",
      amount: customerPoolTokens,
      quoteTotal: customerEligibleQuoteTotal,
      ratePerDollar: rateCard.jcmovesPerDollar,
      metadata: { finalizedQuoteUsd: quoteTotal, giftCardFundedUsd, customerEligibleQuoteUsd: customerEligibleQuoteTotal },
    });
  }

  for (const memberId of crewIds) {
    const amount = crewAllocation.amounts[memberId];
    const crewMember = await storage.getUser(memberId).catch(() => null);
    if (!crewMember || amount <= 0) continue;
    const crewLedger = await writeLedger({
      recipientType: "crew",
      recipientUserId: memberId,
      recipientLabel: crewMember.email || `${crewMember.firstName || ""} ${crewMember.lastName || ""}`.trim() || "Crew member",
      rewardKind: "crew_paid_completed_pool",
      amount,
      metadata: { source: "rate_card", paid: true, completed: true, crewLead: memberId === crewLeadId, leadBonus, baseShare, roundingRemainder },
    });
    await settleJobLedgerRecipient({
      ledgerId: crewLedger.id,
      leadId,
      userId: memberId,
      rewardType: "crew_paid_completed_pool",
      amount,
      quoteTotal,
      ratePerDollar: rateCard.jcmovesPerDollar,
      metadata: { crewLead: memberId === crewLeadId },
    });
  }

  await storage.updateLeadQuote(leadId, { completionRewardedAt: now, tokensDisbursedAt: now });
  return {
    customerTokens: customerPoolTokens,
    perCrewFlatTokens: 0,
    perCrewHoursTokens: 0,
    crewIds,
    crewTokenAmounts: crewAllocation.amounts,
    customerId: customer?.id,
    disbursedAt: now,
  } as DisbursementSummary;
}

export async function disburseJobTokens(leadId: string): Promise<DisbursementSummary | null> {
  const lead = await storage.getLead(leadId) as (Lead & {
    tokensDisbursedAt?: Date | string | null;
    confirmedHours?: number | null;
    crewBonusFlags?: Record<string, boolean> | null;
    email?: string;
  });
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  // Moving Help/U-Haul imports are operational records only. U-Haul owns the
  // customer transaction and settlement, so these jobs must never mint JC
  // rewards from an email-derived amount or a normal completion event.
  if (lead.source === "moving_help_uhaul") {
    console.log(`ℹ️ Job ${leadId} is an operational-only Moving Help import — JCMOVES disbursement skipped`);
    return null;
  }

  // Level 1 — fast-path: skip if already fully disbursed
  if (lead.tokensDisbursedAt || lead.completionRewardedAt) {
    console.log(`ℹ️ Job ${leadId} already disbursed — skipping`);
    return null;
  }

  // Level 2 — concurrency guard: advisory lock (only one caller proceeds at a time)
  const lockKey = leadIdToLockKey(leadId);
  const releaseLock = await acquireJobDisbursementLock(pool, lockKey);
  if (!releaseLock) {
    console.log(`ℹ️ Job ${leadId} disbursement in-progress elsewhere — skipping`);
    return null;
  }

  try {
    // Re-check after acquiring lock (a concurrent caller may have just stamped)
    const freshLead = await storage.getLead(leadId) as typeof lead;
    if (freshLead?.tokensDisbursedAt || freshLead?.completionRewardedAt) {
      console.log(`ℹ️ Job ${leadId} disbursed by concurrent caller — skipping`);
      return null;
    }

    // New awards use the paid-and-completed rate-card ledger. The legacy
    // implementation remains below only as historical reference.
    const rateCardSummary = await disburseRateCardJcMoves(leadId, (freshLead || lead) as Lead & { crewLeadUserId?: string | null });
    if (rateCardSummary) {
      const alertedLead = await storage.getLead(leadId) || freshLead || lead;
      await emitJobEvent("jcmoves_disbursed", alertedLead, {
        eventId: `jcmoves-disbursed:${leadId}:${rateCardSummary.disbursedAt.toISOString()}`,
        source: "paid_completion_disbursement",
        recipientUserIds: rateCardSummary.crewIds,
        extra: {
          crewTokenTotal: Object.values(rateCardSummary.crewTokenAmounts || {}).reduce((total, amount) => total + amount, 0),
          crewTokenAmounts: rateCardSummary.crewTokenAmounts || {},
        },
      });
    }
    return rateCardSummary;

    const legacyCrewMembers = (lead.crewMembers || []) as Array<string | null>;
    const crewIds: string[] = legacyCrewMembers.flatMap((memberId) => typeof memberId === "string" && memberId.length > 0 ? [memberId] : [])
      || (lead.assignedToUserId ? [lead.assignedToUserId] : []);

    const bonusFlags: Record<string, boolean> = (lead.crewBonusFlags as Record<string, boolean>) ?? {};

    const baseFlatReward    = (await getSetting("worker_job_completion_bonus"))
      ?? (await getSetting("employee_job_completed"))
      ?? FALLBACK_FLAT;
    const earnRate          = (await getSetting("earn_rate_per_dollar")) ?? FALLBACK_EARN;
    const completionBonus   = (await getSetting("customer_quote_completed")) ?? FALLBACK_COMPLETION;
    const referralBonus     = (await getSetting("referral_job_bonus"))    ?? FALLBACK_REFERRAL;
    const confirmedHrs = lead.confirmedHours ? Number(lead.confirmedHours) : 0;
    const baseHoursBonus = HOURS_RATE * confirmedHrs;
    const now = new Date();

    const summary: DisbursementSummary = {
      customerTokens: 0,
      perCrewFlatTokens: baseFlatReward,
      perCrewHoursTokens: baseHoursBonus,
      crewIds,
      disbursedAt: now,
    };

    let allSucceeded = true;

    // ── A. CREW: flat reward + hours bonus ────────────────────────────────────
    // For each member:
    //   1. SELECT to check if reward row already exists (idempotency check)
    //   2. If not: INSERT reward row, THEN credit wallet
    //   3. The advisory lock guarantees no concurrent caller interleaves here
    for (const memberId of crewIds) {
      try {
        const member = await storage.getUser(memberId).catch(() => null) as any;
        if (!member) {
          console.log(`⚠️ Crew member ${memberId} not found — skipping`);
          continue;
        }

        const isBonus = bonusFlags[memberId] === true;
        const multiplier = isBonus ? BONUS_MULTIPLIER : 1;
        const flatReward = Math.round(baseFlatReward * multiplier);
        const hoursBonus = Math.round(baseHoursBonus * multiplier);

        // Flat reward
        const flatExists = await rewardAlreadyExists(leadId, memberId, "worker_job_completion_bonus");
        if (!flatExists) {
          await db.insert(rewards).values({
            userId: memberId,
            rewardType: "worker_job_completion_bonus",
            tokenAmount: flatReward.toFixed(8),
            cashValue: (flatReward * TOKEN_PRICE).toFixed(6),
            status: "confirmed",
            referenceId: leadId,
            metadata: { jobId: leadId, type: "flat", flatReward, isBonusMover: isBonus, multiplier },
          });
        await storage.creditWalletTokens(memberId, flatReward, { skipRewardLedger: true });
          await awardPoints(memberId, "employee_job_done");
          console.log(`🏆 Crew ${member.email}: flat=${flatReward} JCMOVES${isBonus ? " (+25%)" : ""}`);
        } else {
          console.log(`ℹ️ Crew ${member.email}: flat reward already exists — skipping`);
        }

        // Hours bonus
        if (hoursBonus > 0) {
          const hoursExists = await rewardAlreadyExists(leadId, memberId, "worker_hours_bonus");
          if (!hoursExists) {
            await db.insert(rewards).values({
              userId: memberId,
              rewardType: "worker_hours_bonus",
              tokenAmount: hoursBonus.toFixed(8),
              cashValue: (hoursBonus * TOKEN_PRICE).toFixed(6),
              status: "confirmed",
              referenceId: leadId,
              metadata: { jobId: leadId, type: "hours", confirmedHours: confirmedHrs, ratePerHour: HOURS_RATE, isBonusMover: isBonus, multiplier },
            });
        await storage.creditWalletTokens(memberId, hoursBonus, { skipRewardLedger: true });
            console.log(`🕐 Crew ${member.email}: hours=${hoursBonus} JCMOVES${isBonus ? " (+25%)" : ""}`);
          } else {
            console.log(`ℹ️ Crew ${member.email}: hours reward already exists — skipping`);
          }
        }

        try {
          const { notificationService } = await import("./notification");
          await notificationService.notifyRewardAvailable(memberId, "job completion", flatReward + hoursBonus);
        } catch (_) {}
      } catch (err) {
        console.error(`❌ Crew reward failed for ${memberId}:`, err);
        allSucceeded = false;
      }
    }

    // ── B. CUSTOMER rewards (flat completion bonus + per-dollar earn) ─────────
    try {
      const customerEmail = lead.email;
      if (customerEmail) {
        // Case-insensitive email lookup to avoid mismatch issues
        const emailLookup = await pool.query(
          `SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
          [customerEmail.trim()]
        );
        const customer = emailLookup.rows[0] || null;

        if (customer) {
          const jobPrice   = parseFloat(lead.totalPrice || lead.basePrice || "0");
          const explicitAlloc = parseFloat(String(lead.tokenAllocation || "0"));

          // ── B1. Flat completion bonus (always awarded, configurable) ──────
          const completionExists = await rewardAlreadyExists(leadId, customer.id, "customer_quote_completed");
          if (!completionExists) {
            await db.insert(rewards).values({
              userId: customer.id,
              rewardType: "customer_quote_completed",
              tokenAmount: completionBonus.toFixed(8),
              cashValue: (completionBonus * TOKEN_PRICE).toFixed(6),
              status: "confirmed",
              referenceId: leadId,
              metadata: { jobId: leadId, type: "flat_completion" },
            });
        await storage.creditWalletTokens(customer.id, completionBonus, { skipRewardLedger: true });
            await awardPoints(customer.id, "job_completed");
            summary.customerTokens += completionBonus;
            summary.customerId = customer.id;
            console.log(`🎁 Customer ${customer.email}: flat completion bonus +${completionBonus} JCMOVES`);
          } else {
            console.log(`ℹ️ Customer ${customer.email}: flat completion bonus already exists — skipping`);
          }

          // ── B2. Per-dollar earn (tokenAllocation override OR rate × price) ─
          const baseEarnTokens = explicitAlloc > 0
            ? Math.round(explicitAlloc)
            : (jobPrice > 0 ? Math.round(jobPrice * earnRate) : 0);
          const isCryptoPayment = String(lead.paymentPlan || "").toLowerCase().includes("btc")
            || String(lead.paymentPlan || "").toLowerCase().includes("crypto");
          const regularPaymentBonus = isCryptoPayment ? 0 : regularPaymentRewardBonus(baseEarnTokens);
          const earnTokens = baseEarnTokens + regularPaymentBonus;

          if (earnTokens > 0) {
            const earnExists = await rewardAlreadyExists(leadId, customer.id, "loyalty_booking");
            if (!earnExists) {
              const prevSpend = parseFloat(customer.total_completed_spend || "0");
              const newSpend  = prevSpend + jobPrice;
              // Update lifetime spend for analytics; tier is now activity-based
              // and recomputed below from completed-job count + referral count.
              await db
                .update(users)
                .set({ totalCompletedSpend: newSpend.toFixed(2) })
                .where(eq(users.id, customer.id));
              try {
                const { recomputeUserTier } = await import("./recompute-tier");
                await recomputeUserTier(customer.id);
              } catch (tierErr) {
                console.error("[recomputeUserTier] failed:", tierErr);
              }

              await db.insert(rewards).values({
                userId: customer.id,
                rewardType: "loyalty_booking",
                tokenAmount: earnTokens.toFixed(8),
                cashValue: (earnTokens * TOKEN_PRICE).toFixed(6),
                status: "confirmed",
                referenceId: leadId,
                metadata: {
                  jobId: leadId,
                  jobPrice,
                  earnRate: explicitAlloc > 0 ? "override" : earnRate,
                  source: explicitAlloc > 0 ? "tokenAllocation" : "formula",
                  paymentRail: isCryptoPayment ? "crypto" : "regular",
                  regularPaymentBonusPercent: isCryptoPayment ? 0 : 5,
                  regularPaymentBonusMoves: regularPaymentBonus,
                },
              });
        await storage.creditWalletTokens(customer.id, earnTokens, { skipRewardLedger: true });
              const spentHundreds = Math.floor(jobPrice / 100);
              if (spentHundreds > 0) await awardPoints(customer.id, "per_100_spent", spentHundreds);

              summary.customerTokens += earnTokens;
              summary.customerId = customer.id;
              console.log(`🎁 Customer ${customer.email}: per-dollar earn +${earnTokens} JCMOVES (job $${jobPrice}${regularPaymentBonus ? `, includes +${regularPaymentBonus} regular-payment bonus` : ""})`);
            } else {
              console.log(`ℹ️ Customer ${customer.email}: earn reward already exists — skipping`);
            }
          } else {
            console.log(`ℹ️ Customer ${customer.email}: no price on file — flat bonus only`);
          }

          // ── B3. Service-type bonus ────────────────────────────────────────
          const serviceType = lead.serviceType || "";
          const bonusKey = getServiceBonusKey(serviceType);
          const serviceBonus = (await getSetting(bonusKey)) ?? FALLBACK_SERVICE_BONUS;
          const serviceBonusExists = await rewardAlreadyExists(leadId, customer.id, "service_type_bonus");
          if (!serviceBonusExists) {
            await db.insert(rewards).values({
              userId: customer.id,
              rewardType: "service_type_bonus",
              tokenAmount: serviceBonus.toFixed(8),
              cashValue: (serviceBonus * TOKEN_PRICE).toFixed(6),
              status: "confirmed",
              referenceId: leadId,
              metadata: { jobId: leadId, serviceType, bonusKey, type: "service_type_bonus" },
            });
        await storage.creditWalletTokens(customer.id, serviceBonus, { skipRewardLedger: true });
            summary.customerTokens += serviceBonus;
            summary.customerId = customer.id;
            console.log(`🎁 Customer ${customer.email}: service-type bonus +${serviceBonus} JCMOVES (${serviceType || "default"})`);
          } else {
            console.log(`ℹ️ Customer ${customer.email}: service-type bonus already exists — skipping`);
          }

          // ── C. REFERRAL BONUS (first completed job only) ──────────────────
          if (customer.referred_by_user_id) {
            const prevJobs = await pool.query(
              `SELECT 1 FROM rewards WHERE user_id = $1 AND reward_type = 'loyalty_booking' LIMIT 2`,
              [customer.id]
            );
            if (prevJobs.rows.length <= 1) {
              const referralExists = await rewardAlreadyExists(
                leadId, customer.referred_by_user_id, "referral_confirmed"
              );
              if (!referralExists) {
                await db.insert(rewards).values({
                  userId: customer.referred_by_user_id,
                  rewardType: "referral_confirmed",
                  tokenAmount: referralBonus.toFixed(8),
                  cashValue: (referralBonus * TOKEN_PRICE).toFixed(6),
                  status: "confirmed",
                  referenceId: leadId,
                  metadata: { referredUserId: customer.id, jobId: leadId },
                });
        await storage.creditWalletTokens(customer.referred_by_user_id, referralBonus, { skipRewardLedger: true });
                // Increment referral_count and recompute referrer's tier
                await pool.query(
                  `UPDATE users SET referral_count = COALESCE(referral_count, 0) + 1 WHERE id = $1`,
                  [customer.referred_by_user_id]
                );
                try {
                  const { recomputeUserTier } = await import("./recompute-tier");
                  await recomputeUserTier(customer.referred_by_user_id);
                } catch (tErr) {
                  console.error("[recomputeUserTier referrer] failed:", tErr);
                }
                console.log(`🎉 Referral ${referralBonus} JCMOVES → ${customer.referred_by_user_id}`);
              }
            }
          }
        } else {
          console.log(`⚠️ disburseJobTokens: no user account found for email "${customerEmail}" — flat completion bonus skipped`);
        }
      } else {
        console.log(`⚠️ disburseJobTokens: lead ${leadId} has no email — customer rewards skipped`);
      }
    } catch (err) {
      console.error("❌ Customer earn reward failed:", err);
      allSucceeded = false;
    }

    // Stamp completion timestamps only after all payouts succeed or are confirmed already-done
    if (allSucceeded) {
      await storage.updateLeadQuote(leadId, {
        completionRewardedAt: now,
        tokensDisbursedAt: now,
      });
      console.log(`✅ Job ${leadId} disbursement complete at ${now.toISOString()}`);
    } else {
      console.warn(`⚠️ Job ${leadId} had partial failures — not stamped; retry is safe`);
    }

    return summary;
  } finally {
    await releaseLock();
  }
}

/**
 * Customer jobs can finish before the customer creates an account. Their
 * customer-pool entry remains in the job ledger under the normalized email;
 * this claims it exactly once when that email registers.
 */
export async function claimPendingCustomerJobJcMoves(args: { userId: string; email?: string | null }): Promise<number> {
  const email = String(args.email || "").trim().toLowerCase();
  if (!email) return 0;

  await pool.query(
    `UPDATE job_jcmoves_ledger
        SET recipient_user_id = $1,
            recipient_label = $2,
            reward_kind = 'customer_paid_completed_pool',
            metadata = metadata || jsonb_build_object('pendingCustomerClaim', false, 'claimedAt', NOW()::text)
      WHERE recipient_type = 'customer'
        AND recipient_user_id IS NULL
        AND reward_kind = 'customer_paid_completed_pool_pending_claim'
        AND LOWER(recipient_label) = $2`,
    [args.userId, email],
  );

  const { rows } = await pool.query<{
    id: number;
    lead_id: string;
    token_amount: number;
    quote_total: string;
    rate_per_dollar: string;
  }>(
    `SELECT id, lead_id, token_amount, quote_total, rate_per_dollar
       FROM job_jcmoves_ledger
      WHERE recipient_type = 'customer'
        AND recipient_user_id = $1
        AND reward_kind = 'customer_paid_completed_pool'
        AND COALESCE(metadata->>'walletCreditedAt', '') = ''
      ORDER BY id ASC`,
    [args.userId],
  );

  let claimed = 0;
  for (const row of rows) {
    const credited = await settleJobLedgerRecipient({
      ledgerId: row.id,
      leadId: row.lead_id,
      userId: args.userId,
      rewardType: "customer_paid_completed_pool",
      amount: Number(row.token_amount),
      quoteTotal: Number(row.quote_total),
      ratePerDollar: Number(row.rate_per_dollar),
      metadata: { claimedAfterSignup: true },
    });
    if (credited) claimed += Number(row.token_amount);
  }
  return claimed;
}

/** Preview or repair completed, fully-paid jobs from before the durable
 * JCMOVES ledger existed. The issuer itself remains the only writer, so a
 * repair has the same advisory-lock and per-recipient protection as live jobs.
 */
export async function auditPaidCompletedJobJcMoves(repair = false) {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT l.id
       FROM leads l
      WHERE l.status = 'completed'
        AND l.payment_paid_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM job_jcmoves_ledger ledger WHERE ledger.lead_id = l.id
        )
      ORDER BY l.payment_paid_at ASC`,
  );
  const repaired: string[] = [];
  const skipped: string[] = [];
  if (repair) {
    for (const row of rows) {
      try {
        const result = await disburseJobTokens(row.id);
        if (result) repaired.push(row.id);
        else skipped.push(row.id);
      } catch (error) {
        console.error(`[JCMOVES] audit repair failed for ${row.id}:`, error);
        skipped.push(row.id);
      }
    }
  }
  return { eligibleLeadIds: rows.map((row) => row.id), repairedLeadIds: repaired, skippedLeadIds: skipped };
}

/**
 * Grant lottery tickets for a customer activity (booking or job completion).
 * Auto-creates an open round when none exists so no ticket is ever silently lost.
 * Non-fatal — any failure is logged but does not interrupt the caller.
 */
export async function grantLotteryTicketsForActivity(
  userId: string,
  count: number,
  source: string,
  roundType: 'weekly' | 'monthly' = 'weekly'
): Promise<void> {
  try {
    let { rows: roundRows } = await pool.query(
      `SELECT * FROM lottery_rounds WHERE status='open' AND round_type=$1 ORDER BY id LIMIT 1`,
      [roundType]
    );

    if (!roundRows.length) {
      const durationDays = roundType === 'monthly' ? 30 : 7;
      const seedAmount   = roundType === 'monthly' ? 2000 : 500;
      const { rows: created } = await pool.query(
        `INSERT INTO lottery_rounds
           (round_type, status, start_time, end_time, seed_amount, tickets_sold, total_entries,
            winner_pool, burn_pool, treasury_pool, displayed_jackpot, round_number)
         VALUES ($1, 'open', NOW(), NOW() + ($2 || ' days')::interval,
                 $3, 0, 0,
                 ROUND($3 * 0.70), ROUND($3 * 0.05), ROUND($3 * 0.25), $3,
                 COALESCE((SELECT MAX(round_number) FROM lottery_rounds WHERE round_type=$1), 0) + 1)
         RETURNING *`,
        [roundType, durationDays, seedAmount]
      );
      roundRows = created;
      console.log(`🎟️ Auto-created ${roundType} lottery round #${created[0]?.round_number}`);
    }

    const round = roundRows[0];

    const { rows: [updatedRound] } = await pool.query(
      `UPDATE lottery_rounds SET total_entries = total_entries + $1, updated_at = NOW()
       WHERE id=$2 AND status='open' RETURNING *`,
      [count, round.id]
    );
    if (!updatedRound) return;

    const endIdx   = updatedRound.total_entries;
    const startIdx = endIdx - count + 1;

    await pool.query(
      `INSERT INTO lottery_entries (round_id, user_id, tickets, entry_start_index, entry_end_index, source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [round.id, userId, count, startIdx, endIdx, source]
    );

    await pool.query(
      `INSERT INTO lottery_audit_logs (round_id, event_type, message, metadata)
       VALUES ($1,$2,$3,$4)`,
      [round.id, 'AUTO_GRANT',
       `Auto-granted ${count} ticket${count !== 1 ? 's' : ''} (${source})`,
       JSON.stringify({ userId, count, source, roundId: round.id })]
    );

    console.log(`🎟️ Lottery: granted ${count} ticket${count !== 1 ? 's' : ''} to ${userId} (${source})`);
  } catch (err) {
    console.error(`⚠️ grantLotteryTicketsForActivity failed (non-fatal):`, err);
  }
}

import { findPhoneRewardsCustomer } from "./phoneRewards";
// disburseBookingTokens — Customer JCMOVES reward issuer for the
// multi-service `bookings` flow (Task #131).
//
// Mirrors disburseServiceTokens / disburseJobTokens but is keyed off the
// new parent `bookings` row instead of `leads`. Awards:
//   A) Flat booking bonus  (customer_quote_accepted setting, default 250)
//   B) Per-dollar earn     (earn_rate_per_dollar setting, default 15/$)
//   C) Bonus multiplier    (bundle_definitions.bonus_multiplier when a bundle
//                            wins AND finalTotal > 0)
//
// Idempotent: each award row is keyed by (booking.id, customerId, rewardType)
// so this service is safe to call multiple times for the same booking.
//
// Pricing-guardrail respect (Task #131 Step 6) — single source of truth is
// `computeBookingReward()`, which the customer-facing quote estimate also
// calls. Two narrow rules apply on top of the normal flat + earn × multiplier
// math, both enforced inside the calculator (not duplicated here):
//   * finalTotal <= 0   → flat-only award (no earn, no multiplier)
//   * partial override  → earn paid against the override total, but the
//                         bundle bonus multiplier is suppressed
// This guarantees the issued reward always equals the displayed estimate.

import { db, pool } from "../db";
import { rewards, rewardSettings, bookings, bookingServiceItems, bundleDefinitions } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../storage";
import { EARN_RATE_PER_DOLLAR } from "../../shared/rewards";
import { computeBookingReward } from "./bookingPricing";

const TOKEN_PRICE       = 0.00000508432;
const FALLBACK_FLAT     = 250;
const FALLBACK_EARN     = EARN_RATE_PER_DOLLAR;

async function getSetting(key: string): Promise<number | null> {
  try {
    const rows = await db
      .select()
      .from(rewardSettings)
      .where(eq(rewardSettings.settingKey, key))
      .limit(1);
    if (rows.length > 0 && rows[0].isActive) return parseFloat(rows[0].tokenAmount);
    return null;
  } catch {
    return null;
  }
}

/** Resolve the active reward-engine settings (flat bonus + per-dollar earn).
 *  Exported so any caller that needs to recompute a booking's reward
 *  (e.g. the discount-override route) uses the same source as the issuer. */
export async function loadBookingRewardSettings(): Promise<{ flatBonus: number; earnRate: number }> {
  const flatBonus = (await getSetting("customer_quote_accepted")) ?? FALLBACK_FLAT;
  const earnRate  = (await getSetting("earn_rate_per_dollar")) ?? FALLBACK_EARN;
  return { flatBonus, earnRate };
}

async function alreadyRewarded(
  referenceId: string,
  userId: string,
  rewardType: string,
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM rewards WHERE user_id = $1 AND reward_type = $2 AND reference_id = $3 LIMIT 1`,
    [userId, rewardType, referenceId],
  );
  return rows.length > 0;
}

export interface BookingDisbursementSummary {
  customerId: string;
  flatAward: number;
  earnAward: number;
  bonusMultiplier: number;
  totalAwarded: number;
}

export async function disburseBookingTokens(bookingId: string): Promise<BookingDisbursementSummary | null> {
  try {
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    if (!booking) {
      console.warn(`[disburseBookingTokens] booking ${bookingId} not found — skipped`);
      return null;
    }

    const finalTotal = parseFloat(booking.finalTotal);
    // Note: finalTotal <= 0 is intentionally NOT short-circuited here.
    // computeBookingReward() converts it to a flat-only award so that the
    // estimate the customer saw on the quote screen matches what actually
    // gets credited.

    const phoneCustomer = await findPhoneRewardsCustomer(booking.customerPhone);
    const { rows: userRows } = phoneCustomer ? { rows: [phoneCustomer] } : await pool.query(
      'SELECT id, email FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [booking.customerEmail || '']);
    const customer = userRows[0];
    if (!customer) return null;

    // Detect admin discount overrides on this booking. The presence of any
    // audit-log row tells the calculator to suppress the bundle bonus
    // multiplier (per-dollar earn is still paid against finalTotal).
    const overrideRows = await pool
      .query(`SELECT 1 FROM booking_discount_audit_log WHERE booking_id = $1 LIMIT 1`, [bookingId])
      .catch(() => ({ rows: [] as unknown[] }));
    const hasOverride = overrideRows.rows.length > 0;

    // Reward parity contract — Step 6: prefer the immutable snapshot the
    // booking captured at creation time so the customer is paid exactly what
    // they were quoted, even if rewardSettings or a bundle's bonusMultiplier
    // were edited between quote and confirm. Only fall back to the live
    // settings + live bundle row when a legacy booking has no snapshot.
    let flatBonus: number;
    let earnRate: number;
    let bonusMultiplier = 1;

    if (booking.rewardFlatBonusSnapshot != null && booking.rewardEarnRateSnapshot != null) {
      flatBonus = booking.rewardFlatBonusSnapshot;
      earnRate  = parseFloat(booking.rewardEarnRateSnapshot);
      const snapMult = booking.rewardBonusMultiplierSnapshot != null
        ? parseFloat(booking.rewardBonusMultiplierSnapshot)
        : 1;
      if (Number.isFinite(snapMult) && snapMult > 1 && !hasOverride) bonusMultiplier = snapMult;
    } else {
      // Legacy booking without snapshot — load live values.
      flatBonus = (await getSetting("customer_quote_accepted")) ?? FALLBACK_FLAT;
      earnRate  = (await getSetting("earn_rate_per_dollar")) ?? FALLBACK_EARN;
      if (booking.bundleAppliedCode && !hasOverride) {
        const [bundle] = await db
          .select()
          .from(bundleDefinitions)
          .where(eq(bundleDefinitions.code, booking.bundleAppliedCode))
          .limit(1);
        if (bundle?.bonusMultiplier != null) {
          const m = parseFloat(bundle.bonusMultiplier);
          if (Number.isFinite(m) && m > 1) bonusMultiplier = m;
        }
      }
    }

    // Single source of reward truth — same calculator the quote endpoint
    // uses, so the issued total matches the displayed estimate exactly.
    const reward = computeBookingReward({
      finalTotal,
      flatBonus,
      earnRate,
      bonusMultiplier,
      hasOverride,
    });
    const flatAward = reward.flatAward;
    const earnAward = reward.earnAward;

    if (hasOverride) {
      console.log(
        `[disburseBookingTokens] booking ${bookingId} has admin override — bundle multiplier suppressed`,
      );
    }
    if (!(finalTotal > 0)) {
      console.log(
        `[disburseBookingTokens] booking ${bookingId} finalTotal=$0 — flat-only award (per Step 6 guardrail)`,
      );
    }

    const summary: BookingDisbursementSummary = {
      customerId: customer.id,
      flatAward: 0,
      earnAward: 0,
      bonusMultiplier,
      totalAwarded: 0,
    };

    // A — flat booking bonus (idempotent on referenceId+rewardType+user)
    if (flatAward > 0 && !(await alreadyRewarded(bookingId, customer.id, "booking_flat_bonus"))) {
      await db.insert(rewards).values({
        userId: customer.id,
        rewardType: "booking_flat_bonus",
        tokenAmount: flatAward.toFixed(8),
        cashValue: (flatAward * TOKEN_PRICE).toFixed(6),
        status: "confirmed",
        referenceId: bookingId,
        metadata: {
          bookingId,
          bundleAppliedCode: booking.bundleAppliedCode || null,
          bonusMultiplier,
          baseFlatBonus: flatBonus,
        },
      });
    await storage.creditWalletTokens(customer.id, flatAward, { skipRewardLedger: true });
      summary.flatAward = flatAward;
      summary.totalAwarded += flatAward;
      console.log(
        `🎁 [booking ${bookingId}] ${customer.email} +${flatAward} JCMOVES (flat${bonusMultiplier > 1 ? ` ×${bonusMultiplier}` : ""})`,
      );
    }

    // B — per-dollar loyalty earn on post-discount total
    if (earnAward > 0 && !(await alreadyRewarded(bookingId, customer.id, "booking_loyalty_earn"))) {
      await db.insert(rewards).values({
        userId: customer.id,
        rewardType: "booking_loyalty_earn",
        tokenAmount: earnAward.toFixed(8),
        cashValue: (earnAward * TOKEN_PRICE).toFixed(6),
        status: "confirmed",
        referenceId: bookingId,
        metadata: {
          bookingId,
          finalTotal,
          earnRate,
          regularPaymentBonusPercent: 5,
          regularPaymentBonusMoves: reward.regularPaymentBonus,
          bundleAppliedCode: booking.bundleAppliedCode || null,
          bonusMultiplier,
        },
      });
    await storage.creditWalletTokens(customer.id, earnAward, { skipRewardLedger: true });
      summary.earnAward = earnAward;
      summary.totalAwarded += earnAward;
      console.log(
        `🎁 [booking ${bookingId}] ${customer.email} +${earnAward} JCMOVES (earn @ $${finalTotal}${bonusMultiplier > 1 ? ` ×${bonusMultiplier}` : ""})`,
      );
    }

    return summary;
  } catch (err) {
    console.error(`[disburseBookingTokens] booking ${bookingId} failed:`, err);
    return null;
  }
}

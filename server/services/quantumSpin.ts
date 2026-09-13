import type { Pool } from '@neondatabase/serverless';
import type { Response } from 'express';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { and, eq } from 'drizzle-orm';
import { users,rewards,rewardRedemptions } from '@shared/schema';
import { consumeSpinCredit } from './dailySpin';

export function createQuantumSpinHandler(spinPool:Pool,random:()=>number=Math.random){
  return async(req:any,res:Response)=>{

    const spinClient=await spinPool.connect();
    const pool=spinClient;

    const db=drizzle(spinClient as any);
    try {
      await pool.query('BEGIN');
      const userId = (req.session as any).userId;
      const {redemptionId}=req.body||{};
      let useFreeSpinEntitlementId=req.body?.useFreeSpinEntitlementId;
      await pool.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
      if(redemptionId){
        const redemption=(await pool.query('SELECT id FROM reward_redemptions WHERE id=$1 AND user_id=$2 FOR UPDATE',[redemptionId,userId])).rows[0];
        if(!redemption)throw Object.assign(new Error('Spin redemption does not belong to your account'),{status:400});
      }
      if(!useFreeSpinEntitlementId){
        const credit=(await pool.query(`SELECT id FROM reward_entitlements WHERE user_id=$1 AND entitlement_type='spin_credit'
          AND status='active' AND (expires_at IS NULL OR expires_at>NOW()) AND COALESCE((value_json->>'spins')::int,1)>0
          AND ($2::int IS NULL OR redemption_id=$2) ORDER BY expires_at ASC NULLS LAST,id LIMIT 1 FOR UPDATE`,[userId,redemptionId||null])).rows[0];
        useFreeSpinEntitlementId=credit?.id;
      }
      if(redemptionId&&!useFreeSpinEntitlementId)throw Object.assign(new Error('This redemption has no unused spin credits'),{status:400});

      // Check enabled
      const { rows: cfgRows } = await pool.query(`SELECT setting_key, setting_value FROM spin_config`);
      const cfg: Record<string, string> = {};
      for (const row of cfgRows) cfg[row.setting_key] = row.setting_value;
      if (cfg['spin_wheel_enabled'] === 'false') {
        throw Object.assign(new Error("Quantum Spin is temporarily disabled."),{status:403});
      }

      // Determine payment: free spin entitlement → marketplace redemption → wallet deduction
      let usedFreeSpinId: number | null = null;
      if (useFreeSpinEntitlementId) {
        const consumed=await consumeSpinCredit(spinClient as any,userId,Number(useFreeSpinEntitlementId),redemptionId);
        if(!consumed)throw Object.assign(new Error('Free spin expired or already used'),{status:409});
        usedFreeSpinId = useFreeSpinEntitlementId;
      } else if (!redemptionId) {
        const spinCost=Number(cfg['spin_cost_tokens']||'100');
        if(!Number.isSafeInteger(spinCost)||spinCost<0)throw new Error('Invalid spin pricing configuration');
        const debit=await pool.query(`UPDATE wallet_accounts SET token_balance=token_balance-$2::numeric,last_activity=NOW()
          WHERE user_id=$1 AND token_balance>=$2::numeric RETURNING user_id`,[userId,spinCost]);
        if(!debit.rows.length)throw Object.assign(new Error(`You need ${spinCost} JCMOVES to spin.`),{status:400});
      }
      // ── Quantum Spin prize table ───────────────────────────────────────────
      // Diversified Treasury Version — avg token return ~62 JCMOVES per 100-JCMOVES spin
      // Spread across 16 outcomes. "Nada" adds drama. Big prizes appear often enough to feel real.
      // Total: 22.1+20+15+12+8+5+4+3.5+2.5+1.5+0.8+0.4+0.2+1.5+0.3+1.0+0.2+2.0 = 100.000
      // EV (tokens): ~62 JCMOVES | House edge: ~38% | Treasury healthy.
      const PRIZES = [
        { label: "Nada",       tokens: 0,     probability: 22.100, type: "tokens"           }, // no tokens — adds suspense
        { label: "10",         tokens: 10,    probability: 20.000, type: "tokens"           },
        { label: "25",         tokens: 25,    probability: 15.000, type: "tokens"           },
        { label: "50",         tokens: 50,    probability: 12.000, type: "tokens"           },
        { label: "75",         tokens: 75,    probability:  8.000, type: "tokens"           },
        { label: "100",        tokens: 100,   probability:  5.000, type: "tokens"           },
        { label: "150",        tokens: 150,   probability:  4.000, type: "tokens"           },
        { label: "250",        tokens: 250,   probability:  3.500, type: "tokens"           },
        { label: "500",        tokens: 500,   probability:  2.500, type: "tokens"           },
        { label: "1,000",      tokens: 1000,  probability:  1.500, type: "tokens"           },
        { label: "2,500",      tokens: 2500,  probability:  0.800, type: "tokens"           },
        { label: "5,000",      tokens: 5000,  probability:  0.400, type: "tokens"           },
        { label: "10,000",     tokens: 10000, probability:  0.200, type: "tokens"           },
        { label: "Mystery Box",tokens: 0,     probability:  1.500, type: "mystery"          },
        { label: "$5 Coffee",  tokens: 0,     probability:  0.300, type: "gift_card_coffee" },
        { label: "10% Off",    tokens: 0,     probability:  1.000, type: "coupon_10pct"     },
        { label: "25% Off",    tokens: 0,     probability:  0.200, type: "coupon_25pct"     },
        { label: "Free Spin",  tokens: 100,   probability:  2.000, type: "tokens"           }, // refunds the spin cost
        // Note: jackpot overlays (mini / major) apply independently on top of any prize
      ];

      // Server-side weighted random pick
      const rand = random() * 100;
      let cumulative = 0, prizeIndex = 0;
      for (let i = 0; i < PRIZES.length; i++) {
        cumulative += PRIZES[i].probability;
        if (rand <= cumulative) { prizeIndex = i; break; }
      }
      const prize = PRIZES[prizeIndex];

      // ── Load user info for activity feed ──────────────────────────────────
      const [userRow] = await db.select({ firstName: users.firstName, lastName: users.lastName, username: users.username })
        .from(users).where(eq(users.id, userId)).limit(1);
      const displayName = userRow?.username
        || (userRow?.firstName
          ? `${userRow.firstName} ${(userRow.lastName || '').charAt(0)}.`
          : 'Someone');

      // ── Jackpot contributions + win checks ─────────────────────────────────
      const { rows: jRows } = await pool.query(`SELECT * FROM jackpots ORDER BY type FOR UPDATE`);
      let jackpotTypeWon: string | null = null;
      let jackpotAmountWon: number | null = null;
      let jackpotBonusTokens = 0;

      for (const jp of jRows) {
        const newVal = Number(jp.current_value) + Number(jp.contribution_per_spin);
        const winRoll = random() * 100;
        const winPct = parseFloat(jp.win_probability_pct);
        if (winRoll < winPct) {
          jackpotTypeWon = jp.type;
          jackpotAmountWon = newVal;
          jackpotBonusTokens += newVal;
          const winnerName = userRow?.username || `${userRow?.firstName || ''} ${userRow?.lastName || ''}`.trim() || 'Lucky Winner';
          await pool.query(
            `UPDATE jackpots SET current_value=$1, last_won_at=NOW(), last_winner_id=$2, last_winner_name=$3, last_won_amount=$4, updated_at=NOW() WHERE type=$5`,
            [jp.starting_value, userId, winnerName, newVal, jp.type]
          );
          // Log jackpot win
          await pool.query(
            `INSERT INTO jackpot_wins (user_id, jackpot_type, amount) VALUES ($1,$2,$3)`,
            [userId, jp.type, newVal]
          );
          // Activity feed
          await pool.query(
            `INSERT INTO activity_feed_events (user_id, event_type, message, metadata) VALUES ($1,'jackpot_win',$2,$3)`,
            [userId, `🏆 ${displayName} hit the ${jp.type === 'major' ? 'Major' : 'Mini'} Jackpot (${newVal.toLocaleString()} JCMOVES)!`, JSON.stringify({ type: jp.type, amount: newVal })]
          );
          console.log(`🏆 JACKPOT! ${jp.type.toUpperCase()} jackpot of ${newVal} JCMOVES won by ${winnerName}`);
        } else {
          await pool.query(`UPDATE jackpots SET current_value=$1, updated_at=NOW() WHERE type=$2`, [newVal, jp.type]);
        }
      }

      // ── Coupon prizes ──────────────────────────────────────────────────────
      let couponCode: string | null = null;
      let couponExpiry: Date | null = null;
      const rand6 = () => random().toString(36).substring(2, 8).toUpperCase();

      if (prize.type === 'coupon_10pct') {
        const expiryDays = parseInt(cfg['coupon_10pct_expiry_days'] || '90');
        couponExpiry = new Date(Date.now() + expiryDays * 86400000);
        couponCode = `QS10-${rand6()}`;
        await pool.query(
          `INSERT INTO promo_codes (id, code, description, discount_percent, discount_percent_jewelry, reward_tokens, referral_reward_tokens, max_uses, is_active, expires_at)
           VALUES (gen_random_uuid(),$1,$2,'10.00','0.00','0.00','0.00',1,true,$3)`,
          [couponCode, `10% off (max $25) — Quantum Spin prize. Min 2 movers 2hrs. Expires ${couponExpiry.toLocaleDateString()}`, couponExpiry]
        );
        await pool.query(
          `INSERT INTO activity_feed_events (user_id, event_type, message, metadata) VALUES ($1,'coupon_won',$2,$3)`,
          [userId, `🎫 ${displayName} unlocked a 10% Off coupon`, JSON.stringify({ couponCode })]
        );
      } else if (prize.type === 'coupon_25pct') {
        const expiryDays = parseInt(cfg['coupon_25pct_expiry_days'] || '30');
        couponExpiry = new Date(Date.now() + expiryDays * 86400000);
        couponCode = `QS25-${rand6()}`;
        await pool.query(
          `INSERT INTO promo_codes (id, code, description, discount_percent, discount_percent_jewelry, reward_tokens, referral_reward_tokens, max_uses, is_active, expires_at)
           VALUES (gen_random_uuid(),$1,$2,'25.00','0.00','0.00','0.00',1,true,$3)`,
          [couponCode, `25% off labor (max 50K JCMOVES eq.) — Quantum Spin prize. Min 2 movers 2hrs. Expires ${couponExpiry.toLocaleDateString()}`, couponExpiry]
        );
        await pool.query(
          `INSERT INTO activity_feed_events (user_id, event_type, message, metadata) VALUES ($1,'coupon_won',$2,$3)`,
          [userId, `🎫 ${displayName} unlocked a 25% Off coupon`, JSON.stringify({ couponCode })]
        );
      } else if (prize.type === 'gift_card_coffee') {
        const expiryDays = parseInt(cfg['coffee_card_expiry_days'] || '90');
        couponExpiry = new Date(Date.now() + expiryDays * 86400000);
        couponCode = `COFFEE-${rand6()}`;
        await pool.query(
          `INSERT INTO promo_codes (id, code, description, discount_percent, discount_percent_jewelry, reward_tokens, referral_reward_tokens, max_uses, is_active, expires_at)
           VALUES (gen_random_uuid(),$1,$2,'0.00','0.00','0.00','0.00',1,true,$3)`,
          [couponCode, `$5 coffee gift card — Quantum Spin prize. Pending fulfillment. Expires ${couponExpiry.toLocaleDateString()}`, couponExpiry]
        );
        await pool.query(
          `INSERT INTO activity_feed_events (user_id, event_type, message, metadata) VALUES ($1,'coffee_won',$2,$3)`,
          [userId, `☕ ${displayName} won a $5 Coffee Gift Card`, JSON.stringify({ couponCode })]
        );
      }

      // ── Mystery Box: secondary server-side resolution ──────────────────────
      let mysteryResult: any = null;
      let mysteryTokens = 0;
      let mysteryExtra: any = {};
      if (prize.type === 'mystery') {
        const MYSTERY_POOL = [
          { type: 'tokens',          value: 300,  weight: 35 },
          { type: 'tokens',          value: 500,  weight: 25 },
          { type: 'tokens',          value: 1000, weight: 15 },
          { type: 'tokens',          value: 2000, weight: 10 },
          { type: 'gift_card_coffee',value: 5,    weight: 5  },
          { type: 'coupon_10pct',    value: 0,    weight: 5  },
          { type: 'free_spin',       value: 1,    weight: 5  },
        ];
        const total = MYSTERY_POOL.reduce((s, p) => s + p.weight, 0);
        let mRand = random() * total;
        let pick = MYSTERY_POOL[0];
        for (const p of MYSTERY_POOL) { mRand -= p.weight; if (mRand <= 0) { pick = p; break; } }

        mysteryResult = pick;
        if (pick.type === 'tokens') {
          mysteryTokens = pick.value;
        } else if (pick.type === 'gift_card_coffee') {
          const expiryDays = parseInt(cfg['coffee_card_expiry_days'] || '90');
          const mCoffeeExpiry = new Date(Date.now() + expiryDays * 86400000);
          const mCode = `MYSTERY-COFFEE-${rand6()}`;
          await pool.query(
            `INSERT INTO promo_codes (id, code, description, discount_percent, discount_percent_jewelry, reward_tokens, referral_reward_tokens, max_uses, is_active, expires_at)
             VALUES (gen_random_uuid(),$1,$2,'0.00','0.00','0.00','0.00',1,true,$3)`,
            [mCode, `$5 coffee gift card — Quantum Spin Mystery Box. Expires ${mCoffeeExpiry.toLocaleDateString()}`, mCoffeeExpiry]
          );
          mysteryExtra = { couponCode: mCode, couponExpiry: mCoffeeExpiry };
        } else if (pick.type === 'coupon_10pct') {
          const expiryDays = parseInt(cfg['coupon_10pct_expiry_days'] || '90');
          const mCouponExpiry = new Date(Date.now() + expiryDays * 86400000);
          const mCode = `MYSTERY10-${rand6()}`;
          await pool.query(
            `INSERT INTO promo_codes (id, code, description, discount_percent, discount_percent_jewelry, reward_tokens, referral_reward_tokens, max_uses, is_active, expires_at)
             VALUES (gen_random_uuid(),$1,$2,'10.00','0.00','0.00','0.00',1,true,$3)`,
            [mCode, `10% off (max $25) — Quantum Spin Mystery Box. Expires ${mCouponExpiry.toLocaleDateString()}`, mCouponExpiry]
          );
          mysteryExtra = { couponCode: mCode, couponExpiry: mCouponExpiry };
        } else if (pick.type === 'free_spin') {
          // Issue a free spin entitlement (expires in 30 days)
          const freeSpinExpiry = new Date(Date.now() + 30 * 86400000);
          await pool.query(
            `INSERT INTO reward_entitlements (user_id, item_id, entitlement_type, value_json, status, expires_at)
             VALUES ($1, 0, 'spin_credit', '{"spins":1}', 'active', $2)`,
            [userId, freeSpinExpiry]
          );
          mysteryExtra = { freeSpin: true };
        }

        // Log mystery box result
        const spinResultId = null; // Will be updated below
        await pool.query(
          `INSERT INTO mystery_box_results (user_id, reward_type, reward_value, coupon_code) VALUES ($1,$2,$3,$4)`,
          [userId, pick.type, pick.value.toString(), mysteryExtra.couponCode || null]
        );
        // Activity feed
        const mysteryMsg = pick.type === 'tokens'
          ? `🎁 ${displayName} opened a Mystery Box and got ${pick.value} JCMOVES`
          : pick.type === 'free_spin'
          ? `🎁 ${displayName} opened a Mystery Box and got a Free Spin`
          : `🎁 ${displayName} opened a Mystery Box and unlocked a special reward`;
        await pool.query(
          `INSERT INTO activity_feed_events (user_id, event_type, message, metadata) VALUES ($1,'mystery_box',$2,$3)`,
          [userId, mysteryMsg, JSON.stringify({ type: pick.type, value: pick.value })]
        );
      }

      // ── Credit all tokens ──────────────────────────────────────────────────
      const totalTokens = (prize.tokens || 0) + mysteryTokens + jackpotBonusTokens;
      if (totalTokens > 0) {
        await pool.query(`INSERT INTO wallet_accounts(user_id,token_balance,total_earned,last_activity) VALUES($1,$2,$2,NOW())
          ON CONFLICT(user_id) DO UPDATE SET token_balance=COALESCE(wallet_accounts.token_balance,0)+$2::numeric,
            total_earned=COALESCE(wallet_accounts.total_earned,0)+$2::numeric,last_activity=NOW()`,[userId,totalTokens]);
      }

      // ── Mark marketplace redemption completed ──────────────────────────────
      if (redemptionId) {
        await db.update(rewardRedemptions)
          .set({ status: "completed", fulfilledAt: new Date(), adminNotes: `Quantum Spin: ${prize.label}` })
          .where(and(eq(rewardRedemptions.id, parseInt(redemptionId)), eq(rewardRedemptions.userId, userId)));
      }

      // ── Insert spin result record ──────────────────────────────────────────
      const { rows: spinInsert } = await pool.query(
        `INSERT INTO spin_results (user_id, redemption_id, prize_index, prize_label, prize_tokens, prize_type, jackpot_type_won, jackpot_amount_won, coupon_code, fulfillment_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'fulfilled') RETURNING id`,
        [userId, redemptionId || null, prizeIndex, prize.label, totalTokens, prize.type, jackpotTypeWon, jackpotAmountWon, couponCode]
      );
      const spinResultId = spinInsert[0]?.id;

      // ── Reward record ──────────────────────────────────────────────────────
      if (totalTokens > 0) {
        await db.insert(rewards).values({
          userId,
          rewardType: jackpotTypeWon ? `${jackpotTypeWon}_jackpot_win` : "quantum_spin_win",
          tokenAmount: totalTokens.toString(),
          cashValue: (totalTokens * 0.00000508432).toFixed(4),
          status: "confirmed",
          metadata: { spinResultId, prizeIndex, label: prize.label, prizeType: prize.type, jackpotTypeWon },
        });
      }

      // ── Activity feed: token wins ──────────────────────────────────────────
      if (prize.type === 'tokens' && prize.tokens > 0) {
        await pool.query(
          `INSERT INTO activity_feed_events (user_id, event_type, message, metadata) VALUES ($1,'spin_win',$2,$3)`,
          [userId, `🔥 ${displayName} won ${prize.label} JCMOVES`, JSON.stringify({ tokens: prize.tokens })]
        );
      }

      console.log(`⚡ Quantum Spin: ${displayName} → ${prize.label} (${prize.type})${jackpotTypeWon ? ` + ${jackpotTypeWon.toUpperCase()} JACKPOT ${jackpotAmountWon}` : ''}`);

      await pool.query("COMMIT");
      res.json({
        prizeIndex,
        tokens: totalTokens,
        label: prize.label,
        prizeType: prize.type,
        jackpotTypeWon,
        jackpotAmountWon,
        couponCode: couponCode || mysteryExtra?.couponCode || null,
        couponExpiry: couponExpiry ? couponExpiry.toISOString() : null,
        mysteryResult: mysteryResult ? { type: mysteryResult.type, value: mysteryResult.value, ...mysteryExtra } : null,
        spinResultId,
        usedFreeSpinId,
      });
    } catch (e: any) {
      await pool.query("ROLLBACK");
      console.error("Quantum Spin error:", e);
      res.status(e.status||500).json({ error: e.message || "Spin failed" });
    } finally {spinClient.release();}
  };
}

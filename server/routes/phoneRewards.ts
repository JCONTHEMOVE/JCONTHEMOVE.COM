import { Router } from "express";
import type { PoolClient } from "@neondatabase/serverless";
import crypto from "node:crypto";
import { pool } from "../db";
import { smsService } from "../services/sms";
import { getClientIp } from "../lib/persistentRateLimit";
import { allowRewardsCode, ensurePhoneRewards, rewardsPhone, verificationHash } from "../services/phoneRewards";

export const phoneRewardsRouter = Router();

phoneRewardsRouter.get("/status", async (_req, res) => {
  // Configuration validation only: initialize does not send a provider request.
  res.json({ available: await smsService.initialize() });
});

phoneRewardsRouter.post("/code", async (req, res) => {
  const phone = rewardsPhone(req.body.phone);
  if (!phone || req.body.consent !== true) return res.status(400).json({ error: "Enter a complete phone number and choose to join rewards." });
  try {
    await ensurePhoneRewards();
    const ipKey = crypto.createHash("sha256").update(getClientIp(req)).digest("hex");
    if (!await allowRewardsCode(`ip:${ipKey}`, 10) || !await allowRewardsCode(`phone:${phone}`, 3)) {
      return res.status(429).json({ error: "Too many codes requested. Try again in an hour, or continue without rewards." });
    }
    const id = crypto.randomUUID();
    const code = crypto.randomInt(100000, 1000000).toString();
    await pool.query(`INSERT INTO phone_rewards_challenges(id,phone,code_hash,expires_at) VALUES ($1,$2,$3,now()+interval '10 minutes')`, [id, phone, verificationHash(id, code)]);
    const sent = await smsService.sendSMS(phone, `Your JC ON THE MOVE rewards code is ${code}. Expires in 10 minutes. Do not share it. This is not a payment confirmation.`);
    if (!sent.success) {
      await pool.query("DELETE FROM phone_rewards_challenges WHERE id=$1", [id]);
      return res.status(503).json({ error: "We could not send a code. You can continue booking or paying and join rewards later." });
    }
    return res.json({ challengeId: id });
  } catch {
    return res.status(503).json({ error: "Rewards enrollment is temporarily unavailable. You can still continue." });
  }
});

phoneRewardsRouter.post("/verify", async (req, res) => {
  const { challengeId, code } = req.body;
  if (typeof challengeId !== "string" || !/^[0-9a-f-]{36}$/i.test(challengeId) || typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "Enter the six-digit code from your text." });
  }
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await client.query(`UPDATE phone_rewards_challenges SET attempts=attempts+1
      WHERE id=$1 AND used=false AND attempts<5 AND expires_at>now() RETURNING *`, [challengeId]);
    const challenge = result.rows[0];
    if (!challenge || challenge.code_hash !== verificationHash(challengeId, code)) {
      await client.query("COMMIT");
      return res.status(400).json({ error: "That code is incorrect or expired. Check it or request a new code." });
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`phone-rewards:${challenge.phone}`]);
    const authenticatedId = (req.session as any)?.userId || (req as any).user?.id;
    const signedInCustomer = authenticatedId ? (await client.query("SELECT id, role FROM users WHERE id=$1 AND role='customer' AND status IN ('active','approved')", [authenticatedId])).rows[0] : null;
    let member = (await client.query("SELECT m.user_id,u.role,u.status FROM phone_rewards_members m JOIN users u ON u.id=m.user_id WHERE m.phone=$1", [challenge.phone])).rows[0];
    if (member && (member.role !== "customer" || !["active", "approved", "rewards_only"].includes(member.status))) {
      await client.query("COMMIT");
      return res.status(409).json({ error: "This rewards profile needs account assistance. Contact JC before continuing enrollment." });
    }
    if (member && signedInCustomer && member.user_id !== signedInCustomer.id) {
      await client.query("COMMIT");
      return res.status(409).json({ error: "This number is linked to another rewards profile. Contact JC to combine your profiles before continuing enrollment." });
    }
    if (!member) {
      const matches = await client.query(`SELECT id,role,status FROM users WHERE regexp_replace(phone_number,'[^0-9]','','g') IN ($1, '1' || $1)`, [challenge.phone.slice(2)]);
      // Never choose between duplicate profiles or enroll a crew/admin profile from a public form.
      if (matches.rows.length > 1 || (matches.rows[0] && (matches.rows[0].role !== "customer" || !["active", "approved", "rewards_only"].includes(matches.rows[0].status) || (signedInCustomer && matches.rows[0].id !== signedInCustomer.id)))) {
        await client.query("COMMIT");
        return res.status(409).json({ error: "Please sign in to your existing account or contact JC to link rewards to this number." });
      }
      // A rewards-only record can receive eligible rewards, but cannot recover
      // an account until normal registration validates age and terms.
      const userId = signedInCustomer?.id || matches.rows[0]?.id || (await client.query(`INSERT INTO users(phone_number,role,status,rewards_enrolled) VALUES ($1,'customer','rewards_only',true) RETURNING id`, [challenge.phone])).rows[0].id;
      await client.query("INSERT INTO phone_rewards_members(phone,user_id,consent_version) VALUES ($1,$2,'phone-rewards-v1')", [challenge.phone, userId]);
      member = { user_id: userId };
    }
    await client.query("UPDATE users SET rewards_enrolled=true WHERE id=$1", [member.user_id]);
    await client.query("UPDATE phone_rewards_challenges SET used=true WHERE id=$1", [challengeId]);
    await client.query("COMMIT");
    (req.session as any).phoneRewardsEnrollment = { userId: member.user_id, phone: challenge.phone, expiresAt: Date.now() + 30 * 60_000 };
    return res.json({ enrolled: true });
  } catch {
    await client?.query("ROLLBACK");
    return res.status(503).json({ error: "Could not finish enrollment. Please retry. Booking and payment are still available." });
  } finally { client?.release(); }
});

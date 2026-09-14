import crypto from "node:crypto";
import { pool } from "../db";
import { normalizeCustomerPhone, phoneDigits } from "@shared/phone";

export function rewardsPhone(value: unknown): string | null {
  const normalized = normalizeCustomerPhone(value);
  return normalized ? `+1${phoneDigits(normalized)}` : null;
}

export function verificationHash(id: string, code: string): string {
  return crypto.createHash("sha256").update(`${id}:${code}`).digest("hex");
}

let ready: Promise<unknown> | undefined;
export function ensurePhoneRewards() {
  return ready ??= pool.query(`
    CREATE TABLE IF NOT EXISTS phone_rewards_members (
      phone TEXT PRIMARY KEY, user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      verified_at TIMESTAMPTZ NOT NULL DEFAULT now(), consent_version TEXT NOT NULL
    );
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'phone_rewards_members'::regclass
        AND conname = 'phone_rewards_members_user_id_fkey' AND confdeltype <> 'c') THEN
        ALTER TABLE phone_rewards_members DROP CONSTRAINT phone_rewards_members_user_id_fkey;
        ALTER TABLE phone_rewards_members ADD CONSTRAINT phone_rewards_members_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
      END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS phone_rewards_challenges (
      id UUID PRIMARY KEY, phone TEXT NOT NULL, code_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, used BOOLEAN NOT NULL DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS phone_rewards_challenges_phone ON phone_rewards_challenges(phone, created_at);
    CREATE TABLE IF NOT EXISTS phone_rewards_send_limits (
      key TEXT PRIMARY KEY, window_start TIMESTAMPTZ NOT NULL DEFAULT now(), hits INTEGER NOT NULL
    );
  `).catch(error => { ready = undefined; throw error; });
}

// Atomic and fail-closed: SMS throttles cannot be bypassed with concurrent requests.
export async function allowRewardsCode(key: string, maximum: number): Promise<boolean> {
  const result = await pool.query(`INSERT INTO phone_rewards_send_limits(key, hits) VALUES ($1, 1)
    ON CONFLICT (key) DO UPDATE SET
      hits = CASE WHEN phone_rewards_send_limits.window_start < now() - interval '1 hour' THEN 1 ELSE phone_rewards_send_limits.hits + 1 END,
      window_start = CASE WHEN phone_rewards_send_limits.window_start < now() - interval '1 hour' THEN now() ELSE phone_rewards_send_limits.window_start END
    RETURNING hits`, [key]);
  return result.rows[0].hits <= maximum;
}

// Phone membership supplements the existing email-based rewards system.
// It grants no login session, wallet access, or payment status.
export async function findPhoneRewardsCustomer(phone: unknown): Promise<{
  id: string; email: string | null; total_completed_spend: string | null; referred_by_user_id: string | null;
} | null> {
  const normalized = rewardsPhone(phone);
  if (!normalized) return null;
  await ensurePhoneRewards();
  const result = await pool.query(`SELECT u.id, u.email, u.total_completed_spend, u.referred_by_user_id FROM phone_rewards_members m
    JOIN users u ON u.id = m.user_id WHERE m.phone = $1 AND u.rewards_enrolled = true
      AND u.role = 'customer' AND u.status IN ('active','approved','rewards_only')`, [normalized]);
  return result.rows[0] || null;
}

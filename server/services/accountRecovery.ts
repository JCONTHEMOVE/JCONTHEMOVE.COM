import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export interface RecoveryDatabase {
  query(text: string, values?: any[]): Promise<{ rows: any[] }>;
  transaction<T>(work: (db: RecoveryDatabase) => Promise<T>): Promise<T>;
}

export const RECOVERY_SCHEMA = `
CREATE TABLE IF NOT EXISTS account_recovery_challenges (
  id text PRIMARY KEY, user_id varchar NOT NULL REFERENCES users(id),
  contact_key text NOT NULL, code_hash text NOT NULL,
  expires_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0,
  verified_at timestamptz, reset_hash text, reset_expires_at timestamptz,
  consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_recovery_contact ON account_recovery_challenges(contact_key, created_at DESC);
CREATE INDEX IF NOT EXISTS account_recovery_user ON account_recovery_challenges(user_id);
CREATE TABLE IF NOT EXISTS account_recovery_limits (
  key text PRIMARY KEY, hits integer NOT NULL, expires_at timestamptz NOT NULL
);`;

export class RecoveryError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function normalizeRecoveryContact(contact: unknown): string {
  if (typeof contact !== "string" || contact.length > 254) throw new RecoveryError(400, "Enter the email address or phone number on your account.");
  const value = contact.trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `email:${value}`;
  if (/^[\d\s()+.-]+$/.test(value)) {
    let digits = value.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    if (digits.length === 10) return `phone:${digits}`;
  }
  throw new RecoveryError(400, "Enter a valid email address or 10-digit phone number.");
}

export function createAccountRecovery(db: RecoveryDatabase, options: {
  secret: string;
  sendCode: (email: string, code: string) => Promise<boolean>;
  hashPassword: (password: string) => Promise<string>;
}) {
  if (!options.secret) throw new Error("Account recovery requires SESSION_SECRET");
  const digest = (value: string) => createHmac("sha256", options.secret).update(value).digest("hex");
  const invalidCode = () => new RecoveryError(400, "Invalid or expired code. Request a new code and try again.");
  const invalidReset = () => new RecoveryError(401, "Your reset has expired or was already used. Request a new code.");

  async function limit(scope: string, value: string, max: number) {
    // One atomic upsert: limits survive restarts and concurrent requests. Fail closed on DB errors.
    const result = await db.query(`INSERT INTO account_recovery_limits(key,hits,expires_at)
      VALUES ($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET
      hits=CASE WHEN account_recovery_limits.expires_at <= now() THEN 1 ELSE account_recovery_limits.hits+1 END,
      expires_at=CASE WHEN account_recovery_limits.expires_at <= now() THEN now()+interval '15 minutes' ELSE account_recovery_limits.expires_at END
      RETURNING hits`, [`${scope}:${digest(value)}`]);
    if (result.rows[0].hits > max) throw new RecoveryError(429, "Too many attempts. Please wait 15 minutes before trying again.");
  }

  return {
    async request(contact: unknown, ip: string) {
      const key = normalizeRecoveryContact(contact);
      await limit("request-ip", ip, 20);
      await limit("request-contact", key, 3);
      const value = key.slice(key.indexOf(":") + 1);
      const matches = await db.query(key.startsWith("email:")
        ? "SELECT id,email,status FROM users WHERE lower(trim(email))=$1 LIMIT 2"
        : `SELECT id,email,status FROM users WHERE right(regexp_replace(phone_number,'[^0-9]','','g'),10)=$1 LIMIT 2`, [value]);
      const response = { success: true, method: "email", masked: "your account email", message: "If an account matches, a code will arrive at its email address. Check your inbox and spam folder." };
      // Never guess between duplicate contacts or reveal whether an account exists.
      if (matches.rows.length !== 1 || !matches.rows[0].email || matches.rows[0].status === "rewards_only") return response;
      const user = matches.rows[0];
      const id = randomBytes(24).toString("hex");
      const code = randomInt(100000, 1000000).toString();
      await db.transaction(async tx => {
        await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
        await tx.query("UPDATE account_recovery_challenges SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL", [user.id]);
        await tx.query(`INSERT INTO account_recovery_challenges(id,user_id,contact_key,code_hash,expires_at)
          VALUES($1,$2,$3,$4,now()+interval '15 minutes')`, [id,user.id,digest(key),digest(`${id}:${code}`)]);
      });
      let sent = false;
      try { sent = await options.sendCode(user.email.trim(), code); } catch { /* report a safe delivery failure below */ }
      if (!sent) {
        await db.query("UPDATE account_recovery_challenges SET consumed_at=now() WHERE id=$1", [id]);
        throw new RecoveryError(503, "We couldn't send the recovery email. Please try again later or call (906) 285-9312 for help.");
      }
      return response;
    },

    async verify(contact: unknown, token: unknown, ip: string) {
      const key = normalizeRecoveryContact(contact);
      await limit("verify-ip", ip, 30);
      await limit("verify-contact", key, 10);
      if (typeof token !== "string" || !/^\d{6}$/.test(token.trim())) throw invalidCode();
      const result = await db.query(`UPDATE account_recovery_challenges SET attempts=attempts+1
        WHERE id=(SELECT id FROM account_recovery_challenges WHERE contact_key=$1 ORDER BY created_at DESC LIMIT 1)
        AND consumed_at IS NULL AND verified_at IS NULL AND expires_at>now() AND attempts<5 RETURNING *`, [digest(key)]);
      const row = result.rows[0];
      if (!row || !timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(digest(`${row.id}:${token.trim()}`)))) throw invalidCode();
      const resetToken = randomBytes(32).toString("hex");
      const claimed = await db.query(`UPDATE account_recovery_challenges SET verified_at=now(),reset_hash=$2,
        reset_expires_at=now()+interval '10 minutes' WHERE id=$1 AND verified_at IS NULL AND consumed_at IS NULL
        AND expires_at>now() RETURNING id`, [row.id,digest(resetToken)]);
      if (!claimed.rows.length) throw invalidCode();
      return { success: true, resetToken };
    },

    async reset(newPassword: unknown, resetToken: unknown, ip: string) {
      await limit("reset-ip", ip, 20);
      if (typeof resetToken !== "string" || !/^[a-f0-9]{64}$/.test(resetToken)) throw invalidReset();
      if (typeof newPassword !== "string" || newPassword.length < 6 || Buffer.byteLength(newPassword,"utf8") > 72)
        throw new RecoveryError(400, "Use a password of at least 6 characters and no more than 72 bytes.");
      const grant = await db.query(`SELECT user_id FROM account_recovery_challenges WHERE reset_hash=$1
        AND verified_at IS NOT NULL AND consumed_at IS NULL AND reset_expires_at>now()`, [digest(resetToken)]);
      if (grant.rows.length !== 1) throw invalidReset();
      const hash = await options.hashPassword(newPassword);
      await db.transaction(async tx => {
        const userId = grant.rows[0].user_id;
        await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
        const consumed = await tx.query(`UPDATE account_recovery_challenges SET consumed_at=now()
          WHERE reset_hash=$1 AND consumed_at IS NULL AND reset_expires_at>now() RETURNING id`, [digest(resetToken)]);
        if (consumed.rows.length !== 1) throw invalidReset();
        await tx.query("UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1", [userId,hash]);
        await tx.query("UPDATE account_recovery_challenges SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL", [userId]);
      });
      return { success: true, message: "Password saved. Sign in with your email address and new password." };
    },
  };
}

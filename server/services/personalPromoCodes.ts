import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "@neondatabase/serverless";
import {
  personalPromoCopy, personalPromoNameSchema, personalPromoSuggestions, personalPromoReviewSchema,
  type PersonalPromo, type PersonalPromoRequest, type PersonalPromoReview,
  type PersonalPromoReviewItem, type PersonalPromoState,
} from "@shared/personalPromo";
import { jobPromoAvailabilityReason } from "./jobPromo";

type Query = (sql: string, values?: any[]) => Promise<{ rows: any[] }>;
const normalize = (code: unknown) => String(code || "").trim().toUpperCase();
const iso = (value: any) => value ? new Date(value).toISOString() : null;

export async function resolvePersonalPromoAttribution(query: Query, rawCode: string) {
  const { rows } = await query("SELECT code,referral_user_id FROM promo_codes WHERE UPPER(TRIM(code))=$1", [normalize(rawCode)]);
  return rows.length === 1 && rows[0].referral_user_id
    ? { code: normalize(rows[0].code), userId: String(rows[0].referral_user_id) } : null;
}

export class PersonalPromoError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const PERSONAL_PROMO_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS personal_promo_requests (
    id varchar PRIMARY KEY, user_id varchar NOT NULL REFERENCES users(id),
    requested_code text NOT NULL, status text NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'rejected')),
    feedback text NOT NULL DEFAULT '', approved_promo_id varchar REFERENCES promo_codes(id) ON DELETE SET NULL,
    approved_code text, review_fingerprint text, reviewed_by_user_id varchar REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz
  );
  ALTER TABLE personal_promo_requests ADD COLUMN IF NOT EXISTS review_fingerprint text;
  CREATE UNIQUE INDEX IF NOT EXISTS personal_promo_one_pending_worker ON personal_promo_requests(user_id) WHERE status='pending';
  CREATE UNIQUE INDEX IF NOT EXISTS personal_promo_pending_name ON personal_promo_requests(UPPER(requested_code)) WHERE status='pending';
`;

function promoRecord(row: any): PersonalPromo {
  const result = {
    id: row.id, code: normalize(row.code), description: row.description,
    discountPercent: String(row.discount_percent), discountPercentJewelry: String(row.discount_percent_jewelry),
    rewardTokens: String(row.reward_tokens), referralRewardTokens: String(row.referral_reward_tokens),
    maxUses: row.max_uses, usesCount: row.uses_count, expiresAt: iso(row.expires_at),
    isActive: row.is_active, jobOffer: row.job_offer,
  };
  return { ...result, unavailableReason: jobPromoAvailabilityReason(result) };
}

function requestRecord(row: any): PersonalPromoRequest {
  return {
    id: row.id, userId: row.user_id, workerName: row.worker_name || "Crew member",
    requestedCode: row.requested_code, status: row.status, feedback: row.feedback,
    approvedCode: row.approved_code, reviewedByUserId: row.reviewed_by_user_id,
    createdAt: iso(row.created_at)!, reviewedAt: iso(row.reviewed_at),
  };
}

export class PersonalPromoCodes {
  private schemaReady?: Promise<unknown>;
  constructor(private pool: Pick<Pool, "query" | "connect">) {}

  ensureSchema() {
    this.schemaReady ??= this.pool.query(PERSONAL_PROMO_SCHEMA_SQL).catch(error => {
      this.schemaReady = undefined;
      throw error;
    });
    return this.schemaReady;
  }

  private async transaction<T>(work: (query: Query) => Promise<T>) {
    await this.ensureSchema();
    const client = await this.pool.connect();
    const query: Query = (sql, values) => client.query(sql, values);
    try {
      await query("BEGIN");
      // Serialize name reservations and primary-code changes across app instances.
      await query("SELECT pg_advisory_xact_lock(186773, 1)");
      const result = await work(query);
      await query("COMMIT");
      return result;
    } catch (error: any) {
      await query("ROLLBACK");
      if (error.code === "23505") throw new PersonalPromoError(409, "That code was just reserved. Choose another name and retry.");
      throw error;
    } finally { client.release(); }
  }

  private async codeAvailable(query: Query, code: string, userId: string, unownedPromoId: string | null = null) {
    const { rows } = await query(`SELECT 1 FROM (
      SELECT referral_user_id AS owner FROM promo_codes WHERE UPPER(TRIM(code))=$1 AND NOT (id IS NOT DISTINCT FROM $3 AND referral_user_id IS NULL)
      UNION ALL SELECT id FROM users WHERE UPPER(TRIM(referral_code))=$1
      UNION ALL SELECT user_id FROM worker_profiles WHERE UPPER(TRIM(promo_code))=$1
      UNION ALL SELECT user_id FROM marketing_reps WHERE UPPER(TRIM(promo_code))=$1
      UNION ALL SELECT user_id FROM personal_promo_requests WHERE UPPER(requested_code)=$1 AND status='pending'
    ) names WHERE owner IS DISTINCT FROM $2 LIMIT 1`, [code, userId, unownedPromoId]);
    return rows.length === 0;
  }

  private async ownedPromos(query: Query, userId: string) {
    const { rows } = await query(`SELECT p.* FROM promo_codes p WHERE referral_user_id=$1 OR (referral_user_id IS NULL AND (
      EXISTS(SELECT 1 FROM worker_profiles w WHERE w.user_id=$1 AND UPPER(TRIM(w.promo_code))=UPPER(TRIM(p.code))) OR
      EXISTS(SELECT 1 FROM marketing_reps m WHERE m.user_id=$1 AND UPPER(TRIM(m.promo_code))=UPPER(TRIM(p.code)))
    )) ORDER BY code`, [userId]);
    return rows.map(row => ({ ...promoRecord(row), needsOwnershipApproval: !row.referral_user_id }));
  }

  async state(userId: string): Promise<PersonalPromoState> {
    await this.ensureSchema();
    const query: Query = (sql, values) => this.pool.query(sql, values);
    const { rows: users } = await query("SELECT id, first_name, last_name FROM users WHERE id=$1", [userId]);
    if (!users[0]) throw new PersonalPromoError(404, "Worker account not found.");
    const candidates = await this.ownedPromos(query, userId);
    const { rows: profiles } = await query("SELECT promo_code FROM worker_profiles WHERE user_id=$1", [userId]);
    const { rows: reps } = await query("SELECT slug, promo_code FROM marketing_reps WHERE user_id=$1 AND is_active=TRUE ORDER BY slug", [userId]);
    const byCode = new Map(candidates.map(promo => [normalize(promo.code), promo]));
    const pointers = [...new Set([profiles[0]?.promo_code, ...reps.map(rep => rep.promo_code)].map(normalize).filter(Boolean))];
    const { rows: assignedRecords } = await query("SELECT code FROM promo_codes WHERE UPPER(TRIM(code))=ANY($1::text[])", [pointers]);
    const assigned = [...new Set(assignedRecords.map(row => normalize(row.code)))];
    const duplicateNames = new Set(candidates.map(promo => promo.code)).size !== candidates.length;
    let status: PersonalPromoState["status"] = "unassigned";
    let reason: string | null = "Choose a personal code and send it for owner approval.";
    let promo: PersonalPromo | null = null;
    if (duplicateNames || assigned.length > 1 || assigned.some(code => !byCode.has(code)) || (assigned.length === 0 && candidates.length > 1)) {
      status = "conflict";
      reason = "Your code assignments need owner review. Request the code you want to use.";
    } else {
      const selected = assigned.length ? byCode.get(assigned[0]) : null;
      if (selected) {
        if (selected.needsOwnershipApproval || !(await this.codeAvailable(query, selected.code, userId))) {
          status = "conflict";
          reason = "This code has conflicting ownership. Ask the owner to review your assignment.";
        } else if (selected.unavailableReason) {
          status = "unavailable";
          reason = selected.unavailableReason;
        } else { promo = selected; status = "ready"; reason = null; }
      }
    }
    const { rows: requests } = await query(`SELECT r.*, concat_ws(' ', u.first_name, u.last_name) AS worker_name
      FROM personal_promo_requests r JOIN users u ON u.id=r.user_id WHERE r.user_id=$1
      ORDER BY (r.status='pending') DESC, r.created_at DESC, r.id DESC LIMIT 1`, [userId]);
    const suggestions: string[] = [];
    for (const code of personalPromoSuggestions(users[0].first_name || "", users[0].last_name || "")) {
      if (!byCode.has(code) && await this.codeAvailable(query, code, userId)) suggestions.push(code);
      if (suggestions.length === 3) break;
    }
    const matchingReps = promo ? reps.filter(rep => normalize(rep.promo_code) === promo.code) : [];
    const repSlug = matchingReps.length === 1 ? matchingReps[0].slug : null;
    return {
      status, reason, promo, candidates, suggestions, request: requests[0] ? requestRecord(requests[0]) : null,
      repSlug, bookingPath: promo ? `/book?promo=${encodeURIComponent(promo.code)}${repSlug ? `&rep=${encodeURIComponent(repSlug)}` : ""}` : null,
      offer: promo ? personalPromoCopy(promo) : null,
    };
  }

  async request(userId: string, rawCode: string) {
    const code = personalPromoNameSchema.parse(rawCode);
    await this.transaction(async query => {
      const { rows } = await query("SELECT * FROM personal_promo_requests WHERE user_id=$1 AND status='pending' FOR UPDATE", [userId]);
      if (rows[0]) {
        if (rows[0].requested_code === code) return;
        throw new PersonalPromoError(409, "Your current code request is still awaiting review.");
      }
      const linked = (await this.ownedPromos(query, userId)).find(promo => promo.code === code && promo.needsOwnershipApproval);
      if (!await this.codeAvailable(query, code, userId, linked?.id)) throw new PersonalPromoError(409, "That code is already in use. Choose another memorable name.");
      await query("INSERT INTO personal_promo_requests(id,user_id,requested_code) VALUES($1,$2,$3)", [randomUUID(), userId, code]);
    });
    return this.state(userId);
  }

  async reviewQueue(): Promise<PersonalPromoReviewItem[]> {
    await this.ensureSchema();
    const query: Query = (sql, values) => this.pool.query(sql, values);
    const { rows } = await query(`SELECT r.*, concat_ws(' ', u.first_name, u.last_name) AS worker_name
      FROM personal_promo_requests r JOIN users u ON u.id=r.user_id
      ORDER BY (r.status='pending') DESC, r.created_at DESC LIMIT 200`);
    const { rows: promos } = await query("SELECT * FROM promo_codes WHERE referral_user_id IS NULL OR referral_user_id=ANY($1::varchar[]) ORDER BY code", [[...new Set(rows.map(row => row.user_id))]]);
    return rows.map(row => ({
      ...requestRecord(row),
      candidates: promos.filter(promo => !promo.referral_user_id || promo.referral_user_id === row.user_id)
        .map(promo => ({ ...promoRecord(promo), needsOwnershipApproval: !promo.referral_user_id })),
    }));
  }

  async review(requestId: string, reviewerId: string, input: PersonalPromoReview) {
    input = personalPromoReviewSchema.parse(input);
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const userId = await this.transaction(async query => {
      const { rows } = await query("SELECT * FROM personal_promo_requests WHERE id=$1 FOR UPDATE", [requestId]);
      const request = rows[0];
      if (!request) throw new PersonalPromoError(404, "Code request not found.");
      if (request.status !== "pending") {
        const same = request.review_fingerprint === fingerprint;
        if (same) return request.user_id;
        throw new PersonalPromoError(409, "This request has already been reviewed. Reload the request list.");
      }
      if (input.action === "reject") {
        await query("UPDATE personal_promo_requests SET status='rejected',feedback=$2,reviewed_by_user_id=$3,reviewed_at=now(),review_fingerprint=$4 WHERE id=$1", [requestId, input.feedback, reviewerId, fingerprint]);
        return request.user_id;
      }
      const { rows: workers } = await query("SELECT role,status FROM users WHERE id=$1 FOR UPDATE", [request.user_id]);
      if (!workers[0] || !["employee", "admin", "business_owner"].includes(workers[0].role) || !["approved", "active"].includes(workers[0].status)) {
        throw new PersonalPromoError(409, "Only an active worker account can receive a personal marketing code.");
      }
      const { rows: unowned } = input.existingPromoId
        ? await query("SELECT id FROM promo_codes WHERE id=$1 AND referral_user_id IS NULL FOR UPDATE", [input.existingPromoId]) : { rows: [] };
      if (!await this.codeAvailable(query, input.code, request.user_id, unowned[0]?.id)) throw new PersonalPromoError(409, "That code is assigned or reserved elsewhere.");
      let promo: any;
      if (input.existingPromoId) {
        const existing = await query("SELECT * FROM promo_codes WHERE id=$1 FOR UPDATE", [input.existingPromoId]);
        promo = existing.rows[0];
        if (!promo || normalize(promo.code) !== input.code || (promo.referral_user_id !== request.user_id && !unowned[0])) {
          throw new PersonalPromoError(409, "Select an unowned code or one that already belongs to this worker.");
        }
        const matches = await query("SELECT id FROM promo_codes WHERE UPPER(TRIM(code))=$1", [input.code]);
        if (matches.rows.length !== 1) throw new PersonalPromoError(409, "Duplicate code spellings need owner review before assignment.");
        const unavailable = jobPromoAvailabilityReason(promoRecord(promo));
        if (unavailable) throw new PersonalPromoError(409, unavailable);
        if (unowned[0]) await query("UPDATE promo_codes SET referral_user_id=$2 WHERE id=$1", [promo.id, request.user_id]);
      } else {
        const terms = input.terms!;
        if (terms.expiresAt && new Date(terms.expiresAt).getTime() <= Date.now()) throw new PersonalPromoError(400, "The expiration must be in the future.");
        const existing = await query("SELECT id FROM promo_codes WHERE UPPER(TRIM(code))=$1", [input.code]);
        if (existing.rows.length) throw new PersonalPromoError(409, "This code already exists. Select its existing record to preserve the terms and history.");
        const inserted = await query(`INSERT INTO promo_codes(id,code,description,referral_user_id,discount_percent,discount_percent_jewelry,
          reward_tokens,referral_reward_tokens,max_uses,expires_at,is_active)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE) RETURNING *`,
        [randomUUID(), input.code, terms.description, request.user_id, terms.discountPercent.toFixed(2), terms.discountPercentJewelry.toFixed(2),
          terms.rewardTokens.toFixed(2), terms.referralRewardTokens.toFixed(2), terms.maxUses, terms.expiresAt]);
        promo = inserted.rows[0];
      }
      await query(`INSERT INTO worker_profiles(user_id,promo_code) VALUES($1,$2)
        ON CONFLICT(user_id) DO UPDATE SET promo_code=EXCLUDED.promo_code,updated_at=now()`, [request.user_id, promo.code]);
      await query("UPDATE marketing_reps SET promo_code=$2,updated_at=now() WHERE user_id=$1", [request.user_id, promo.code]);
      await query(`UPDATE personal_promo_requests SET status='approved',approved_promo_id=$2,approved_code=$3,
        feedback=$4,reviewed_by_user_id=$5,reviewed_at=now(),review_fingerprint=$6 WHERE id=$1`, [requestId, promo.id, normalize(promo.code), input.feedback, reviewerId, fingerprint]);
      return request.user_id;
    });
    return this.state(userId);
  }

  async forAd(userId: string) {
    const { rows } = await this.pool.query("SELECT role,status FROM users WHERE id=$1", [userId]);
    if (!rows[0] || !["employee", "admin", "business_owner"].includes(rows[0].role) || !["approved", "active"].includes(rows[0].status)) {
      throw new PersonalPromoError(403, "An active worker account is required to generate marketing ads.");
    }
    const state = await this.state(userId);
    if (!state.promo || !state.offer || !state.bookingPath) throw new PersonalPromoError(409, state.reason || "An approved personal code is required before generating an ad.");
    return { promo: state.promo, offer: state.offer, repSlug: state.repSlug, bookingPath: state.bookingPath };
  }
}

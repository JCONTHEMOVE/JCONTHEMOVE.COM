import { Router, type RequestHandler } from "express";
import { createHash, randomUUID } from "node:crypto";
import { HOME_PROJECT_CAMPAIGN, HOME_PROJECT_SERVICES, HOME_PROJECT_BOOKED_STATUSES, homeProjectRequestSchema } from "@shared/homeProjectCampaign";
import { formatOrderNumber } from "@shared/schema";

// Inject the pool to exercise this same SQL against isolated Postgres in tests.
type Query = (sql: string, values?: any[]) => Promise<{ rows: any[] }>;
export type HomeProjectPool = { query: Query; connect: () => Promise<{ query: Query; release: () => void }> };
const savedLeadQuery = "SELECT l.*, (SELECT metadata FROM quote_attributions qa WHERE qa.lead_id=l.id AND qa.attribution_type='home_project_campaign' ORDER BY qa.created_at,qa.id LIMIT 1) AS campaign_metadata FROM leads l WHERE l.id=$1";
function responseFor(row: any, duplicate = false) {
  const snapshot = row.campaign_metadata || row.quote_snapshot || {};
  return { success: true, duplicate, lead: {
    id: row.id, displayOrderNumber: formatOrderNumber(row.order_number), status: row.status,
    repName: snapshot.referral?.displayName || null, referralSlug: snapshot.referral?.slug || null,
    photoCount: (row.photos || []).length,
  } };
}
function matches(row: any, fingerprint: string) {
  return (row?.campaign_metadata || row?.quote_snapshot)?.requestFingerprint === fingerprint;
}
export function createHomeProjectRouter(pool: HomeProjectPool, onCreated: (leadId: string) => Promise<void>) {
  const router = Router();
  router.post("/", async (req, res) => {
    const parsed = homeProjectRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Check the project details." });
    const input = parsed.data;
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    let client: Awaited<ReturnType<HomeProjectPool["connect"]>> | undefined;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      const existing = (await client.query(savedLeadQuery, [input.requestId])).rows[0];
      if (existing) {
        await client.query("ROLLBACK");
        if (!matches(existing, fingerprint)) return res.status(409).json({ error: "This request was already sent with different details. Refresh before starting another project." });
        return res.json(responseFor(existing, true));
      }
      let rep: any = null;
      if (input.repSlug) {
        const result = await client.query(
          "SELECT mr.id,mr.slug,mr.display_name,mr.promo_code,COALESCE(mr.user_id," +
          "(SELECT referral_user_id FROM promo_codes WHERE code=mr.promo_code LIMIT 1)," +
          "(SELECT user_id FROM worker_profiles WHERE promo_code=mr.promo_code LIMIT 1)) AS credit_user_id " +
          "FROM marketing_reps mr WHERE mr.slug=$1 AND mr.is_active=TRUE LIMIT 1", [input.repSlug]);
        rep = result.rows[0];
        if (!rep) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "We could not verify the referral link. Please check it with the person who shared it, or call (906) 285-9312." });
        }
      }
      const service = HOME_PROJECT_SERVICES[input.projectType];
      const snapshot = {
        marketingCampaignId: HOME_PROJECT_CAMPAIGN.id, requestFingerprint: fingerprint,
        marketingTracking: { ...input.tracking, jcCampaign: HOME_PROJECT_CAMPAIGN.id, utmCampaign: HOME_PROJECT_CAMPAIGN.id, jcFocus: input.projectType },
        project: { type: input.projectType, zip: input.zip, scope: input.scope, squareFootage: input.squareFootage, preferredDeadline: input.preferredDeadline, accessNotes: input.accessNotes, haulAway: input.haulAway, furnitureHelp: input.furnitureHelp },
        referral: rep ? { id: rep.id, slug: rep.slug, displayName: rep.display_name, promoCode: rep.promo_code, userId: rep.credit_user_id } : null,
      };
      const details = [
        "[HOME PROJECT REQUEST - OWNER QUOTE REQUIRED]", "Project: " + service.label, "Work scope: " + input.scope,
        "Location: " + input.address + ", " + input.zip,
        input.squareFootage ? "Approximate area: " + input.squareFootage + " sq. ft." : "",
        input.preferredDeadline ? "Requested completion: " + input.preferredDeadline + " (not confirmed)" : "",
        "Haul away: " + (input.haulAway ? "Requested" : "Not requested"),
        "Furniture moving: " + (input.furnitureHelp ? "Requested" : "Not requested"),
        input.accessNotes ? "Access / project notes: " + input.accessNotes : "",
        "Campaign: " + HOME_PROJECT_CAMPAIGN.id,
        rep ? "Referred by: " + rep.display_name + " (" + rep.slug + ")" : "Source: Direct campaign request",
      ].filter(Boolean).join("\n");
      const result = await client.query(
        "INSERT INTO leads (id,first_name,last_name,email,phone,service_type,from_address,to_address,move_date,property_size,details,source,status,truck_config,is_quote_only,photos,quote_snapshot,promo_code) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,'','',$8,$9,'home_project_campaign','quote_requested','quote_needed',TRUE,$10::jsonb,$11::jsonb,$12) ON CONFLICT (id) DO NOTHING RETURNING *",
        [input.requestId,input.firstName,input.lastName,input.email || "project+" + input.requestId + "@jconthemove.local",input.phone,service.serviceType,
          input.address + ", " + input.zip,input.squareFootage ? input.squareFootage + "-sq-ft" : "owner-review",details,
          JSON.stringify(input.photos.map(photo => ({ ...photo, type: photo.mimeType, source: "home_project_campaign", timestamp: new Date().toISOString() }))),
          JSON.stringify(snapshot),rep?.promo_code || null]);
      const lead = result.rows[0];
      if (!lead) {
        const concurrent = (await client.query(savedLeadQuery, [input.requestId])).rows[0];
        await client.query("ROLLBACK");
        if (matches(concurrent, fingerprint)) return res.json(responseFor(concurrent, true));
        return res.status(409).json({ error: "This request ID is already in use. Refresh before starting another project." });
      }
      // Credit and the lead commit together. A quote revision cannot erase the original source.
      await client.query("INSERT INTO quote_attributions (id,lead_id,user_id,attribution_type,promo_code,metadata) VALUES ($1,$2,$3,'home_project_campaign',$4,$5::jsonb)",
        [randomUUID(),lead.id,rep?.credit_user_id || null,rep?.promo_code || null,
          JSON.stringify({ ...snapshot, source: "home_project_campaign", referralSlug: rep?.slug || null, projectType: input.projectType })]);
      await client.query("COMMIT");
      client.release(); client = undefined;
      // A notification failure must not invite a duplicate already-saved request.
      try { await onCreated(lead.id); } catch (error) { console.error("[home-projects] lead saved; notification failed", error); }
      return res.status(201).json(responseFor(lead));
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => undefined);
      console.error("[home-projects] request transaction failed", error);
      return res.status(503).json({ error: "We could not save your project yet. Your details are still here. Please retry or call (906) 285-9312." });
    } finally { client?.release(); }
  });
  return router;
}
export function homeProjectStatsHandler(pool: HomeProjectPool): RequestHandler {
  return async (_req, res) => {
    try {
      const params = [HOME_PROJECT_CAMPAIGN.id, [...HOME_PROJECT_BOOKED_STATUSES]];
      const aggregate = "COUNT(*)::int AS requests,COUNT(*) FILTER (WHERE l.status='quote_requested')::int AS needs_review," +
        "COUNT(*) FILTER (WHERE l.quote_sent_at IS NOT NULL)::int AS quoted,COUNT(*) FILTER (WHERE l.status=ANY($2::text[]))::int AS booked," +
        "COUNT(*) FILTER (WHERE l.status='completed')::int AS completed";
      // One original attribution per lead prevents inflated totals after quote revisions.
      const campaignLeads = "FROM leads l JOIN LATERAL (SELECT qa.metadata FROM quote_attributions qa WHERE qa.lead_id=l.id AND qa.attribution_type='home_project_campaign' AND qa.metadata->>'marketingCampaignId'=$1 ORDER BY qa.created_at,qa.id LIMIT 1) original ON TRUE";
      const totals = await pool.query("SELECT " + aggregate + " " + campaignLeads, params);
      const reps = await pool.query("SELECT COALESCE(original.metadata->'referral'->>'slug','direct') AS slug,COALESCE(original.metadata->'referral'->>'displayName','Direct') AS name," + aggregate + " " + campaignLeads + " GROUP BY 1,2 ORDER BY booked DESC,requests DESC", params);
      const recent = await pool.query("SELECT l.id,l.order_number,l.first_name,l.status,l.created_at,original.metadata->'project'->>'preferredDeadline' AS deadline,original.metadata->'referral'->>'displayName' AS rep_name " + campaignLeads + " ORDER BY l.created_at DESC LIMIT 12", [HOME_PROJECT_CAMPAIGN.id]);
      res.json({ campaign: HOME_PROJECT_CAMPAIGN, totals: totals.rows[0], reps: reps.rows, recent: recent.rows });
    } catch (error) {
      console.error("[home-projects] statistics failed", error);
      res.status(503).json({ error: "Campaign totals are temporarily unavailable." });
    }
  };
}


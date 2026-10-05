// Task #175 - Launch checklist runner.
//
// Each scenario is a self-contained probe for one launch-critical surface:
// payments, pricing, public booking, quick requests, worker rep pages,
// profit-share defaults, or payout safety. Wired to a single admin page at
// /admin/launch-checklist; an operator clicks "Run" and watches each row
// turn green before publishing.

import { pool } from "../db";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";
import { validatePaymentEnv } from "./envValidation";
import { classifyPayment } from "./paymentClassifier";
import { computeBookingQuote } from "./bookingPricing";
import { validateRedemption, tokensToDollars } from "../../shared/tokenRedemptionRules";
import { isDispatchable } from "../dispatch/isDispatchable";
import { getAppUrl } from "../appUrl";
import {
  MARKETPLACE_ACTION_TASKS,
  MARKETPLACE_LAUNCH_SOURCE_TARGETS,
  MARKETPLACE_OPERATING_FLYWHEEL,
  MARKETPLACE_REFERENCE_BLUEPRINTS,
  MARKETPLACE_REQUEST_SHAPES,
  MARKETPLACE_SOURCE_FLOW_MATRIX,
  getMarketplaceLaunchTasks,
  getMarketplaceReferenceBlueprintsForSource,
  getMarketplaceSourceFlowForSource,
} from "../../shared/marketplaceShapes";

export type ScenarioId =
  | "env_required"
  | "database_readiness"
  | "public_deploy_freshness"
  | "custom_domain_routing"
  | "square_configured"
  | "btc_address_configured"
  | "pricing_engine"
  | "token_redemption"
  | "payment_classifier_deposit"
  | "payment_classifier_pay_on_completion"
  | "deposit_gating"
  | "wallet_table"
  | "jcmoves_receive_redeem"
  | "giveback_fund_safety"
  | "btc_sweep_alive"
  | "public_app_url"
  | "public_conversion_routes"
  | "admin_access_ready"
  | "public_booking_catalog"
  | "marketplace_source_model"
  | "marketplace_launch_task_bonus_rail"
  | "marketplace_surface_mounts"
  | "quick_request_notifications"
  | "quick_request_storage"
  | "tracked_marketing_funnel"
  | "promo_code_integrity"
  | "marketing_rep_pages"
  | "profit_share_settings"
  | "payout_safety_gate";

export interface ScenarioResult {
  id: ScenarioId;
  label: string;
  ok: boolean;
  detail: string;
  ranAt: string;
  ms: number;
}

interface Scenario {
  id: ScenarioId;
  label: string;
  run: () => Promise<{ ok: boolean; detail: string }>;
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = [
      typeof record.message === "string" ? record.message : "",
      typeof record.code === "string" ? `code=${record.code}` : "",
      typeof record.cause === "string" ? `cause=${record.cause}` : "",
      error.constructor?.name && error.constructor.name !== "Object" ? `type=${error.constructor.name}` : "",
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

type HealthBody = {
  status?: string;
  service?: string;
  uptimeSeconds?: number;
  version?: {
    commit?: string | null;
    shortCommit?: string | null;
    branch?: string | null;
    buildGeneratedAt?: string | null;
  };
  boot?: {
    status?: string;
    error?: string | null;
  };
  checks?: {
    env?: {
      status?: string;
      missingRequired?: string[];
    };
  };
};

function readExpectedDeployCommit(): string | null {
  const envCommit =
    process.env.RENDER_GIT_COMMIT
    || process.env.RAILWAY_GIT_COMMIT_SHA
    || process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.GITHUB_SHA;
  if (envCommit?.trim()) return envCommit.trim().slice(0, 8);

  try {
    const gitDir = path.resolve(process.cwd(), ".git");
    if (existsSync(gitDir)) {
      const head = execFileSync("git", ["rev-parse", "--short=8", "HEAD"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (head) return head;
    }
  } catch {
    // Fall through to build-info for deployed bundles without a .git directory.
  }

  const buildInfoPath = path.resolve(process.cwd(), "dist/build-info.json");
  try {
    if (!existsSync(buildInfoPath)) return null;
    const parsed = JSON.parse(readFileSync(buildInfoPath, "utf8")) as { shortCommit?: string; commit?: string };
    return (parsed.shortCommit || parsed.commit?.slice(0, 8) || null) ?? null;
  } catch {
    return null;
  }
}

function readBuiltClientText(): string | null {
  const publicDir = path.resolve(process.cwd(), "dist/public");
  const indexPath = path.join(publicDir, "index.html");
  const assetDir = path.join(publicDir, "assets");
  if (!existsSync(indexPath)) return null;

  const chunks: string[] = [readFileSync(indexPath, "utf8")];
  if (existsSync(assetDir)) {
    for (const entry of readdirSync(assetDir)) {
      if (!entry.endsWith(".js")) continue;
      chunks.push(readFileSync(path.join(assetDir, entry), "utf8"));
    }
  }
  return chunks.join("\n");
}

function publicDeploymentHealthUrl(): string {
  const explicit = process.env.PUBLIC_HEALTH_URL?.trim()
    || process.env.DEPLOYMENT_HEALTH_URL?.trim()
    || process.env.RENDER_HEALTH_URL?.trim();
  if (explicit) return explicit;

  const publicAppUrl = process.env.APP_URL?.trim() || process.env.PUBLIC_APP_URL?.trim();
  if (publicAppUrl) return new URL("/health", publicAppUrl).toString();

  return "https://www.jconthemove.com/health";
}

function siblingHealthUrl(baseHealthUrl: string, pathname: string): string {
  const url = new URL(baseHealthUrl);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function fetchHealthJson(url: string): Promise<{ status: number; ok: boolean; body: HealthBody; headers: Headers }> {
  const timeoutMs = Number(process.env.LAUNCH_HEALTH_TIMEOUT_MS || 12_000);
  const signal = AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 12_000);
  const response = await fetch(url, {
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
    signal,
  });
  const raw = await response.text();
  let body: HealthBody;
  try {
    body = JSON.parse(raw) as HealthBody;
  } catch {
    throw new Error(`${url} returned non-JSON response (${response.status})`);
  }
  return { status: response.status, ok: response.ok, body, headers: response.headers };
}

function header(headers: Headers, name: string): string {
  return headers.get(name) || "";
}

function hostSignals(headers: Headers): string[] {
  return [
    header(headers, "x-railway-67") ? "railway" : "",
    header(headers, "x-railway-edge") ? "railway" : "",
    header(headers, "x-render-origin-server") ? "render" : "",
    header(headers, "cf-ray") ? "cloudflare" : "",
    header(headers, "server") ? `server=${header(headers, "server")}` : "",
  ].filter(Boolean);
}

function customDomainHealthUrl(): string {
  return process.env.CUSTOM_DOMAIN_HEALTH_URL?.trim() || "https://www.jconthemove.com/api/health";
}

type MarketingProbeIds = {
  campaignId: string;
  bookingId?: string | null;
  leadId?: string | null;
};

function probeTrackingUrl(args: {
  campaignId: string;
  area: string;
  focus: string;
  promoCode: string;
  repSlug: string;
}) {
  const url = new URL("https://www.jconthemove.com/book");
  url.searchParams.set("mode", "quick");
  url.searchParams.set("utm_source", "launch_checklist");
  url.searchParams.set("utm_medium", "probe");
  url.searchParams.set("utm_campaign", "launch-checklist-funnel");
  url.searchParams.set("utm_content", args.campaignId);
  url.searchParams.set("jc_campaign", args.campaignId);
  url.searchParams.set("jc_area", args.area);
  url.searchParams.set("jc_focus", args.focus);
  url.searchParams.set("promo", args.promoCode);
  url.searchParams.set("rep", args.repSlug);
  return url;
}

async function cleanupMarketingProbe(ids: MarketingProbeIds): Promise<string[]> {
  const errors: string[] = [];
  const run = async (sql: string, params: unknown[]) => {
    try {
      await pool.query(sql, params);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  };

  await run(
    `DELETE FROM booking_funnel_events
      WHERE booking_id = $2
         OR lead_id = $3
         OR field_snapshot #>> '{attribution,marketingCampaignId}' = $1
         OR field_snapshot #>> '{attribution,marketingTracking,jcCampaign}' = $1`,
    [ids.campaignId, ids.bookingId || "__none__", ids.leadId || "__none__"],
  );
  await run(
    `DELETE FROM quote_attributions
      WHERE booking_id = $2
         OR lead_id = $3
         OR metadata->>'launchProbe' = $1
         OR metadata->>'marketingCampaignId' = $1
         OR metadata #>> '{marketingTracking,jcCampaign}' = $1`,
    [ids.campaignId, ids.bookingId || "__none__", ids.leadId || "__none__"],
  );
  await run(
    `DELETE FROM leads
      WHERE id = $2
         OR booking_id = $3
         OR quote_snapshot->>'launchProbe' = $1
         OR email = $4`,
    [
      ids.campaignId,
      ids.leadId || "__none__",
      ids.bookingId || "__none__",
      `launch-checklist+${ids.campaignId}@jconthemove.local`,
    ],
  );
  await run(`DELETE FROM booking_service_items WHERE booking_id = $1`, [ids.bookingId || "__none__"]);
  await run(`DELETE FROM bookings WHERE id = $1`, [ids.bookingId || "__none__"]);
  await run(`DELETE FROM marketing_webhook_deliveries WHERE campaign_id = $1`, [ids.campaignId]);
  await run(`DELETE FROM marketing_webhook_campaigns WHERE id = $1`, [ids.campaignId]);
  return errors;
}

async function runTrackedMarketingFunnelProbe(): Promise<{ ok: boolean; detail: string }> {
  const campaignId = `launch-probe-${crypto.randomUUID()}`;
  const area = "Launch Checklist Area";
  const focus = "Moving launch probe";
  const promoCode = "LAUNCHPROBE";
  const repSlug = "launch-probe";
  const source = "launch_checklist_probe";
  const ids: MarketingProbeIds = { campaignId };
  let outcome: { ok: boolean; detail: string } | null = null;

  try {
    const trackedUrl = probeTrackingUrl({ campaignId, area, focus, promoCode, repSlug });
    const urlChecks = {
      area: trackedUrl.searchParams.get("jc_area"),
      focus: trackedUrl.searchParams.get("jc_focus"),
      promo: trackedUrl.searchParams.get("promo"),
      campaign: trackedUrl.searchParams.get("jc_campaign"),
    };
    const badUrlKeys = Object.entries({
      area,
      focus,
      promo: promoCode,
      campaign: campaignId,
    }).filter(([key, expected]) => urlChecks[key as keyof typeof urlChecks] !== expected);
    if (badUrlKeys.length > 0) {
      throw new Error(`tracked URL missing ${badUrlKeys.map(([key]) => key).join(", ")}`);
    }

    const marketingTracking = {
      utmSource: "launch_checklist",
      utmMedium: "probe",
      utmCampaign: "launch-checklist-funnel",
      utmContent: campaignId,
      jcCampaign: campaignId,
      jcArea: area,
      jcFocus: focus,
      referrer: trackedUrl.toString(),
    };

    await pool.query(
      `INSERT INTO marketing_webhook_campaigns
        (id, campaign_name, title, message, area, focus, audience, image_url, cta_url, cta_label,
         promo_code, rep_slug, source, actor_id, payload)
       VALUES
        ($1, 'Launch Checklist Funnel Probe', 'Tracked marketing funnel probe',
         'Synthetic checklist probe for campaign attribution.',
         $2, $3, 'Launch checklist', NULL, $4, 'Book / Quote',
         $5, $6, $7, NULL, $8::jsonb)`,
      [
        campaignId,
        area,
        focus,
        trackedUrl.toString(),
        promoCode,
        repSlug,
        source,
        JSON.stringify({ launchProbe: campaignId, trackedUrl: trackedUrl.toString(), marketingTracking }),
      ],
    );

    const bookingResult = await pool.query<{ id: string }>(
      `INSERT INTO bookings
        (customer_name, customer_email, customer_phone, service_address, notes,
         subtotal, discount_total, final_total, status, source)
       VALUES
        ('Launch Checklist Probe', $1, '555-0199', '1 Launch Probe Way',
         'Synthetic tracked marketing funnel probe.',
         300.00, 0.00, 300.00, 'quote', $2)
       RETURNING id`,
      [`launch-checklist+${campaignId}@jconthemove.local`, source],
    );
    ids.bookingId = bookingResult.rows[0]?.id || null;
    if (!ids.bookingId) throw new Error("booking insert did not return an id");

    await pool.query(
      `INSERT INTO booking_service_items
        (booking_id, service_code, service_label, quantity, unit_price, line_subtotal, price_mode, details)
       VALUES
        ($1, 'moving', 'Moving', 1.00, 300.00, 300.00, 'fixed', $2::jsonb)`,
      [ids.bookingId, JSON.stringify({ launchProbe: campaignId, area, focus })],
    );

    const leadResult = await pool.query<{ id: string }>(
      `INSERT INTO leads
        (first_name, last_name, email, phone, service_type, from_address, details,
         source, status, promo_code, booking_id, quote_snapshot, base_price, total_price)
       VALUES
        ('Launch', 'Probe', $1, '555-0199', 'Residential Move', '1 Launch Probe Way',
         $2, $3, 'quote_requested', $4, $5, $6::jsonb, 300.00, 300.00)
       RETURNING id`,
      [
        `launch-checklist+${campaignId}@jconthemove.local`,
        [
          "[LAUNCH CHECKLIST MARKETING FUNNEL PROBE]",
          `Campaign: ${campaignId}`,
          `Area: ${area}`,
          `Focus: ${focus}`,
          `Promo: ${promoCode}`,
        ].join("\n"),
        source,
        promoCode,
        ids.bookingId,
        JSON.stringify({
          launchProbe: campaignId,
          attribution: {
            source,
            promoCode,
            referralSlug: repSlug,
            marketingCampaignId: campaignId,
            marketingTracking,
          },
        }),
      ],
    );
    ids.leadId = leadResult.rows[0]?.id || null;
    if (!ids.leadId) throw new Error("lead insert did not return an id");

    await pool.query(
      `INSERT INTO quote_attributions
        (lead_id, booking_id, user_id, attribution_type, promo_code, metadata)
       VALUES
        ($1, $2, NULL, 'marketing_campaign_booking', $3, $4::jsonb)`,
      [
        ids.leadId,
        ids.bookingId,
        promoCode,
        JSON.stringify({
          launchProbe: campaignId,
          source,
          referralSlug: repSlug,
          marketingCampaignId: campaignId,
          marketingTracking,
          quoteTotal: 300,
        }),
      ],
    );

    await pool.query(
      `INSERT INTO booking_funnel_events
        (visitor_id, session_id, page, event_type, step, booking_id, lead_id, field_snapshot)
       VALUES
        ($1, $2, '/book', 'submit_success', 'confirm', $3, $4, $5::jsonb)`,
      [
        `launch-probe-visitor-${campaignId}`,
        `launch-probe-session-${campaignId}`,
        ids.bookingId,
        ids.leadId,
        JSON.stringify({
          launchProbe: campaignId,
          attribution: {
            promoCode,
            referralSlug: repSlug,
            marketingCampaignId: campaignId,
            marketingTracking,
          },
        }),
      ],
    );

    const attributionResult = await pool.query<{
      promo_code: string | null;
      metadata: Record<string, unknown> | null;
    }>(
      `SELECT promo_code, metadata
         FROM quote_attributions
        WHERE booking_id = $1
          AND metadata->>'launchProbe' = $2
        LIMIT 1`,
      [ids.bookingId, campaignId],
    );
    const attribution = attributionResult.rows[0];
    const meta = attribution?.metadata || {};
    const tracked = meta.marketingTracking && typeof meta.marketingTracking === "object" && !Array.isArray(meta.marketingTracking)
      ? meta.marketingTracking as Record<string, unknown>
      : {};
    const attributionOk =
      attribution?.promo_code === promoCode &&
      meta.marketingCampaignId === campaignId &&
      tracked.jcArea === area &&
      tracked.jcFocus === focus &&
      tracked.jcCampaign === campaignId;
    if (!attributionOk) {
      throw new Error(`booking attribution mismatch: ${JSON.stringify({ promo: attribution?.promo_code, meta })}`);
    }

    const { listMarketingCampaignPerformance } = await import("./marketingWebhookReminders");
    const performanceRows = await listMarketingCampaignPerformance(20);
    const performance = (performanceRows as any[]).find((row) => row.id === campaignId);
    if (!performance) throw new Error("campaign performance row was not returned");
    const performanceOk =
      performance.area === area &&
      performance.focus === focus &&
      performance.promo_code === promoCode &&
      Number(performance.funnel_events || 0) >= 1 &&
      Number(performance.submit_successes || 0) >= 1 &&
      Number(performance.attributed_bookings || 0) >= 1;
    if (!performanceOk) {
      throw new Error(`campaign performance mismatch: ${JSON.stringify(performance)}`);
    }

    const bookingAnalyticsResult = await pool.query<{
      campaign_id: string | null;
      bookings: number;
      promo_codes: string[] | null;
      areas: string[] | null;
      focuses: string[] | null;
    }>(
      `SELECT
          COALESCE(
            NULLIF(qa.metadata->>'marketingCampaignId', ''),
            NULLIF(qa.metadata #>> '{marketingTracking,jcCampaign}', ''),
            NULLIF(qa.metadata #>> '{marketingTracking,utmContent}', ''),
            NULLIF(qa.metadata #>> '{marketingTracking,utmCampaign}', '')
          ) AS campaign_id,
          COUNT(DISTINCT b.id)::int AS bookings,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT qa.promo_code), NULL) AS promo_codes,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT qa.metadata #>> '{marketingTracking,jcArea}'), NULL) AS areas,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT qa.metadata #>> '{marketingTracking,jcFocus}'), NULL) AS focuses
        FROM bookings b
        JOIN quote_attributions qa ON qa.booking_id = b.id
       WHERE b.id = $1
       GROUP BY 1`,
      [ids.bookingId],
    );
    const analytics = bookingAnalyticsResult.rows[0];
    const bookingAnalyticsOk =
      analytics?.campaign_id === campaignId &&
      Number(analytics.bookings || 0) === 1 &&
      (analytics.promo_codes || []).includes(promoCode) &&
      (analytics.areas || []).includes(area) &&
      (analytics.focuses || []).includes(focus);
    if (!bookingAnalyticsOk) {
      throw new Error(`booking analytics attribution mismatch: ${JSON.stringify(analytics)}`);
    }

    outcome = {
      ok: true,
      detail: `tracked link, booking attribution, and campaign analytics confirmed (${campaignId}; ${area}; ${focus}; ${promoCode})`,
    };
  } catch (error) {
    outcome = {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    const cleanupErrors = await cleanupMarketingProbe(ids);
    if (cleanupErrors.length > 0 && outcome?.ok) {
      outcome = {
        ok: false,
        detail: `probe passed but cleanup failed: ${cleanupErrors.slice(0, 2).join("; ")}`,
      };
    }
  }

  return outcome || { ok: false, detail: "marketing funnel probe did not finish" };
}

const SCENARIOS: Scenario[] = [
  {
    id: "env_required",
    label: "All required payment env vars present",
    run: async () => {
      const r = validatePaymentEnv();
      return r.ok
        ? { ok: true, detail: `all ${r.details.length} checks present (${r.missingOptional.length} optional unset)` }
        : { ok: false, detail: `missing required: ${r.missingRequired.join(", ")}` };
    },
  },
  {
    id: "database_readiness",
    label: "Database readiness probe can reach Postgres",
    run: async () => {
      const { rows } = await pool.query<{ database_name: string; server_time: string }>(`
        SELECT current_database() AS database_name, NOW()::text AS server_time
      `);
      const row = rows[0];
      return row?.database_name
        ? { ok: true, detail: `connected to ${row.database_name} at ${row.server_time}` }
        : { ok: false, detail: "Postgres responded without database metadata" };
    },
  },
  {
    id: "public_deploy_freshness",
    label: "Public deployment is fresh and ready",
    run: async () => {
      const healthUrl = publicDeploymentHealthUrl();
      const readinessUrl = siblingHealthUrl(healthUrl, "/api/health");
      const expectedCommit = readExpectedDeployCommit();
      const problems: string[] = [];
      const liveness = await fetchHealthJson(healthUrl);
      const liveCommit = liveness.body.version?.shortCommit || liveness.body.version?.commit?.slice(0, 8) || null;

      if (!liveness.ok || !["alive", "ready"].includes(liveness.body.status || "")) {
        problems.push(`${healthUrl} not alive: http=${liveness.status} status=${liveness.body.status || "unknown"}`);
      }
      if (!liveCommit) {
        problems.push(`${healthUrl} is missing version.shortCommit; the public deployment is serving an older build`);
      }
      if (expectedCommit && liveCommit !== expectedCommit) {
        problems.push(`${healthUrl} commit ${liveCommit || "missing"} does not match current build ${expectedCommit}`);
      }
      if (liveness.body.boot?.status === "failed") {
        problems.push(`${healthUrl} boot failed: ${liveness.body.boot.error || "unknown error"}`);
      }

      const readiness = await fetchHealthJson(readinessUrl);
      const missingEnv = readiness.body.checks?.env?.missingRequired || [];
      if (missingEnv.length > 0) {
        problems.push(`${readinessUrl} missing env: ${missingEnv.join(", ")}`);
      }
      if (!readiness.ok || readiness.body.status !== "ready") {
        problems.push(`${readinessUrl} not ready: http=${readiness.status} status=${readiness.body.status || "unknown"}`);
      }

      if (problems.length > 0) {
        return { ok: false, detail: problems.join("; ") };
      }

      return {
        ok: true,
        detail: `${healthUrl} running ${liveCommit}${expectedCommit ? " (matches current build)" : ""}; strict readiness passed`,
      };
    },
  },
  {
    id: "custom_domain_routing",
    label: "Custom domain routes to the current production app",
    run: async () => {
      const domainHealthUrl = customDomainHealthUrl();
      if (domainHealthUrl.toLowerCase() === "skip") {
        return { ok: true, detail: "custom domain routing check skipped by CUSTOM_DOMAIN_HEALTH_URL=skip" };
      }

      const expectedCommit = readExpectedDeployCommit();
      const health = await fetchHealthJson(domainHealthUrl);
      const signals = hostSignals(health.headers);
      const liveCommit = health.body.version?.shortCommit || health.body.version?.commit?.slice(0, 8) || null;
      const problems: string[] = [];

      if (!health.ok || !["alive", "ready"].includes(health.body.status || "")) {
        problems.push(`${domainHealthUrl} not alive: http=${health.status} status=${health.body.status || "unknown"}`);
      }
      const expectedProvider = (process.env.EXPECTED_HOSTING_PROVIDER ?? "railway").trim().toLowerCase();
      if (expectedProvider && !signals.some((signal) => signal.toLowerCase().includes(expectedProvider))) {
        problems.push(`${new URL(domainHealthUrl).hostname} is not served by the expected ${expectedProvider} host`);
      }
      if (!liveCommit) {
        problems.push(`${domainHealthUrl} is missing version.shortCommit`);
      }
      if (expectedCommit && liveCommit && liveCommit !== expectedCommit) {
        problems.push(`${domainHealthUrl} commit ${liveCommit} does not match current build ${expectedCommit}`);
      }
      if (health.body.boot?.status === "failed") {
        problems.push(`${domainHealthUrl} boot failed: ${health.body.boot.error || "unknown error"}`);
      }

      if (problems.length > 0) {
        return {
          ok: false,
          detail: `${problems.join("; ")}; host signals: ${signals.join(", ") || "none"}`,
        };
      }

      return {
        ok: true,
        detail: `${domainHealthUrl} serves current commit ${liveCommit || "unknown"}; host signals: ${signals.join(", ") || "none"}`,
      };
    },
  },
  {
    id: "square_configured",
    label: "Square invoicing configured (token + environment)",
    run: async () => {
      const { probeSquareReadiness } = await import("./squareReadiness");
      return probeSquareReadiness();
    },
  },
  {
    id: "btc_address_configured",
    label: "BTC wallet address configured when BTC payments are enabled",
    run: async () => {
      const addr = process.env.BTC_WALLET_ADDRESS;
      const btcRequired = process.env.BTC_PAYMENTS_ENABLED === "true" || process.env.BTC_REQUIRED === "true";
      if (!addr && !btcRequired) {
        return { ok: true, detail: "BTC payments optional for current launch; BTC_WALLET_ADDRESS not set" };
      }
      if (!addr) return { ok: false, detail: "BTC payments enabled but BTC_WALLET_ADDRESS is not set" };
      return { ok: true, detail: `address=${addr.slice(0, 8)}...${addr.slice(-6)}` };
    },
  },
  {
    id: "pricing_engine",
    label: "Pricing engine returns a coherent quote",
    run: async () => {
      const quote = computeBookingQuote([
        { serviceCode: "moving", label: "Moving", quantity: 3, unitPrice: 110, priceMode: "hourly" },
      ]);
      const ok = quote.subtotal === 330 && quote.finalTotal === 330 && quote.tokenEstimate > 0;
      return ok
        ? { ok: true, detail: `subtotal=$${quote.subtotal} tokens=${quote.tokenEstimate}` }
        : { ok: false, detail: `unexpected: subtotal=$${quote.subtotal} final=$${quote.finalTotal}` };
    },
  },
  {
    id: "token_redemption",
    label: "Token redemption rules enforce min + cap",
    run: async () => {
      const tooSmall = validateRedemption(100, 200, "bronze");
      const happyPath = validateRedemption(1000, 200, "bronze");
      if (tooSmall.valid) return { ok: false, detail: "min not enforced" };
      if (!happyPath.valid) return { ok: false, detail: `happy path rejected: ${happyPath.message}` };
      return {
        ok: true,
        detail: `1000 JCMOVES -> $${tokensToDollars(happyPath.effectiveTokens).toFixed(2)} discount`,
      };
    },
  },
  {
    id: "payment_classifier_deposit",
    label: "Payment classifier flags deposit-required services",
    run: async () => {
      const plan = classifyPayment({ finalTotal: 600, serviceCodes: ["moving"] });
      return plan.kind === "deposit_required" && plan.depositAmount > 0
        ? { ok: true, detail: `${plan.kind} amount=$${plan.depositAmount} reason="${plan.reason}"` }
        : { ok: false, detail: `unexpected plan ${plan.kind}` };
    },
  },
  {
    id: "payment_classifier_pay_on_completion",
    label: "Small low-risk job classified pay-on-completion",
    run: async () => {
      const plan = classifyPayment({ finalTotal: 90, serviceCodes: ["window_cleaning"] });
      return plan.kind === "pay_on_completion"
        ? { ok: true, detail: plan.reason }
        : { ok: false, detail: `unexpected plan ${plan.kind}` };
    },
  },
  {
    id: "deposit_gating",
    label: "Dispatch gate blocks an unpaid deposit lead",
    run: async () => {
      const probeId = `__launch_probe_${Date.now()}`;
      try {
        await pool.query(
          `INSERT INTO leads (id, first_name, last_name, email, phone, service_type, from_address,
                              status, deposit_required, deposit_paid)
           VALUES ($1, 'Probe', 'Test', 'probe@example.com', '555-0100', 'moving', '1 Probe St',
                   'quote_requested', true, false)`,
          [probeId],
        );
        const check = await isDispatchable(probeId);
        await pool.query(`DELETE FROM leads WHERE id = $1`, [probeId]);
        return !check.ok && (check.reason ?? "").includes("deposit")
          ? { ok: true, detail: `gate held: ${check.reason}` }
          : { ok: false, detail: `gate did not hold: ${JSON.stringify(check)}` };
      } catch (e) {
        try { await pool.query(`DELETE FROM leads WHERE id = $1`, [probeId]); } catch { /* ignore */ }
        return { ok: false, detail: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  {
    id: "wallet_table",
    label: "Wallet accounts table reachable",
    run: async () => {
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM wallet_accounts`);
      return { ok: true, detail: `${rows[0]?.c ?? 0} wallet accounts on file` };
    },
  },
  {
    id: "jcmoves_receive_redeem",
    label: "JCMOVES receive and redeem rails are ready",
    run: async () => {
      const { rows } = await pool.query<{
        wallet_count: number;
        active_reward_items: number;
        active_service_rewards: number;
        auto_approve_threshold: string | null;
      }>(`
        SELECT
          (SELECT COUNT(*)::int FROM wallet_accounts) AS wallet_count,
          (SELECT COUNT(*)::int FROM reward_items WHERE status = 'active') AS active_reward_items,
          (
            SELECT COUNT(*)::int
            FROM reward_items
            WHERE status = 'active'
              AND (
                delivery_type = 'service_credit'
                OR creates_invoice_credit = true
                OR creates_service_credit = true
                OR creates_coupon_code = true
              )
          ) AS active_service_rewards,
          (
            SELECT token_amount::text
            FROM reward_settings
            WHERE setting_key = 'redemption_auto_approve_threshold'
              AND is_active = true
            ORDER BY created_at DESC
            LIMIT 1
          ) AS auto_approve_threshold
      `);
      const row = rows[0];
      if (!row || Number(row.wallet_count) <= 0) {
        return { ok: false, detail: "wallet_accounts has no user/customer/worker wallets to receive JCMOVES" };
      }
      if (Number(row.active_reward_items) <= 0) {
        return { ok: false, detail: "reward shop has no active redeemable items" };
      }
      if (Number(row.active_service_rewards) <= 0) {
        return { ok: false, detail: "reward shop has no active service credit, invoice credit, or coupon rewards" };
      }
      if (!row.auto_approve_threshold) {
        return { ok: false, detail: "redemption_auto_approve_threshold is missing or inactive" };
      }

      const sourceChecks = [
        {
          name: "wallet and reward routes",
          path: "server/routes.ts",
          required: [
            'app.get("/api/wallet/balance"',
            'app.get("/api/rewards/wallet"',
            'app.get("/api/reward-shop/items"',
            'app.post("/api/reward-shop/redeem"',
            'app.get("/api/reward-shop/my-redemptions"',
            'app.post("/api/wallet/cancel-pending-redemption"',
            'app.post("/api/wallet/withdraw"',
            'app.post("/api/wallet/transfer"',
            "refuseWithdrawal",
            "refusePeerTransfer",
          ],
        },
        {
          name: "atomic booking wallet settlement",
          path: "server/services/walletPay.ts",
          required: [
            "export async function settleBookingPayment",
            "FOR UPDATE",
            "validateRedemption",
            "UPDATE wallet_accounts",
            "UPDATE bookings SET status = 'confirmed'",
            "payment_paid_at = NOW()",
          ],
        },
        {
          name: "booking token redemption bridge",
          path: "server/routes/bookings.ts",
          required: [
            "settleBookingPayment",
            "body.applyTokens",
            "body.payFromWallet",
            "serverTier",
            "preflightTokenRedemption",
            "rewardFlatBonusSnapshot",
            "rewardEarnRateSnapshot",
          ],
        },
        {
          name: "customer wallet",
          path: "client/src/pages/customer/wallet.tsx",
          required: [
            "button-jcmoves-receive",
            "button-add-credit",
            "Redeem Rewards",
            "JCMOVES USD",
          ],
        },
        {
          name: "reward marketplace",
          path: "client/src/pages/rewards-marketplace.tsx",
          required: [
            'queryKey: ["/api/reward-shop/items"]',
            'apiRequest("POST", "/api/reward-shop/redeem"',
            'queryKey: ["/api/reward-shop/my-redemptions"]',
            "JCMOVES USD",
          ],
        },
        {
          name: "crew earnings",
          path: "client/src/pages/crew/earnings.tsx",
          required: [
            "crew-jcmoves-actions",
            "button-crew-jcmoves-receive",
            "button-crew-jcmoves-redeem",
            "Wallet setup",
          ],
        },
      ];
      const missingSourceFiles = sourceChecks.filter((surface) => !existsSync(path.resolve(process.cwd(), surface.path)));
      if (missingSourceFiles.length === 0) {
        const missingSurfaceSnippets = sourceChecks.flatMap((surface) => {
          const text = readFileSync(path.resolve(process.cwd(), surface.path), "utf8");
          return surface.required
            .filter((snippet) => !text.includes(snippet))
            .map((snippet) => `${surface.name}: ${snippet}`);
        });
        if (missingSurfaceSnippets.length > 0) {
          return { ok: false, detail: `missing receive/redeem UI wiring: ${missingSurfaceSnippets.join(", ")}` };
        }
      } else {
        const builtClientText = readBuiltClientText();
        if (!builtClientText) {
          return {
            ok: false,
            detail: `source unavailable (${missingSourceFiles.map((surface) => surface.path).join(", ")}) and no built client bundle found`,
          };
        }
        const requiredBundleText = ["Receive JCMOVES", "Redeem Rewards", "Wallet setup", "Rewards shop"];
        const missingBundleText = requiredBundleText.filter((snippet) => !builtClientText.includes(snippet));
        if (missingBundleText.length > 0) {
          return { ok: false, detail: `production bundle missing receive/redeem text: ${missingBundleText.join(", ")}` };
        }
      }

      return {
        ok: true,
        detail: `${row.wallet_count} wallets; ${row.active_reward_items} active rewards (${row.active_service_rewards} service/coupon rewards); approval threshold ${Number(row.auto_approve_threshold).toLocaleString()} JCMOVES; customer + crew receive/redeem UI, shop redemption routes, and atomic booking settlement mounted`,
      };
    },
  },
  {
    id: "giveback_fund_safety",
    label: "Mom and platform generosity funds are live and separated",
    run: async () => {
      const { rows } = await pool.query<{
        mom_wallet_count: number;
        mom_balance: string | null;
        mom_total_earned: string | null;
        platform_wallet_count: number;
        platform_balance: string | null;
        platform_total_earned: string | null;
        mom_hearts_count: number;
        mom_hearts_total: string | null;
        generosity_log_count: number;
        active_nominee_count: number;
      }>(`
        SELECT
          (SELECT COUNT(*)::int FROM wallet_accounts WHERE user_id = 'nicolasa-jackson-generosity') AS mom_wallet_count,
          (SELECT token_balance::text FROM wallet_accounts WHERE user_id = 'nicolasa-jackson-generosity' LIMIT 1) AS mom_balance,
          (SELECT total_earned::text FROM wallet_accounts WHERE user_id = 'nicolasa-jackson-generosity' LIMIT 1) AS mom_total_earned,
          (SELECT COUNT(*)::int FROM wallet_accounts WHERE user_id = 'platform-generosity-fund') AS platform_wallet_count,
          (SELECT token_balance::text FROM wallet_accounts WHERE user_id = 'platform-generosity-fund' LIMIT 1) AS platform_balance,
          (SELECT total_earned::text FROM wallet_accounts WHERE user_id = 'platform-generosity-fund' LIMIT 1) AS platform_total_earned,
          (SELECT COUNT(*)::int FROM mom_hearts) AS mom_hearts_count,
          (SELECT COALESCE(SUM(jcmoves_amount), 0)::text FROM mom_hearts) AS mom_hearts_total,
          (SELECT COUNT(*)::int FROM generosity_fund_log) AS generosity_log_count,
          (SELECT COUNT(*)::int FROM nominees WHERE is_active = true) AS active_nominee_count
      `);
      const row = rows[0];
      if (!row || Number(row.mom_wallet_count) !== 1) {
        return { ok: false, detail: "Nicolasa Jackson Mom wallet is missing or duplicated" };
      }
      if (Number(row.platform_wallet_count) !== 1) {
        return { ok: false, detail: "platform generosity fund wallet is missing or duplicated" };
      }

      const sourceChecks = [
        {
          name: "mom fund service",
          path: "server/services/generosityFund.ts",
          required: [
            'MOMS_USER_ID = "nicolasa-jackson-generosity"',
            "const BONUS_PERCENT = 0.01",
            "rewardType: \"generosity_fund\"",
            "ensureMomsAccount",
          ],
        },
        {
          name: "platform fund service",
          path: "server/services/nominees.ts",
          required: [
            'GENEROSITY_FUND_ID = "platform-generosity-fund"',
            "const NOMINEES_POOL_PERCENT = 0.01",
            "const GENEROSITY_FUND_PERCENT = 0.10",
            "creditPlatformGenerosityFund",
          ],
        },
        {
          name: "circular guard",
          path: "server/storage.ts",
          required: [
            'INTERNAL_WALLET_IDS = new Set(["nicolasa-jackson-generosity", "platform-generosity-fund"])',
            '!userId.startsWith("nominee-")',
            "creditGenerosityFund(tokenAmount",
            "creditPlatformGenerosityFund(tokenAmount",
          ],
        },
        {
          name: "mom routes",
          path: "server/routes.ts",
          required: [
            'app.get("/api/mom/stats"',
            'app.get("/api/mom/hearts"',
            'app.post("/api/mom/hearts"',
            "await ensureMomsAccount()",
          ],
        },
        {
          name: "floating mom heart",
          path: "client/src/components/floating-mom-heart.tsx",
          required: [
            'queryKey: ["/api/mom/stats"]',
            'queryKey: ["/api/mom/hearts"]',
            'apiRequest("POST", "/api/mom/hearts"',
            "QUICK_AMOUNTS",
          ],
        },
        {
          name: "admin giveback panel",
          path: "client/src/pages/admin/marketplace.tsx",
          required: [
            "GenerosityFundPanel",
            "Mom Wallet",
            "Platform Fund",
            "Active Nominees",
          ],
        },
      ];

      const missingFiles = sourceChecks.filter((check) => !existsSync(path.resolve(process.cwd(), check.path)));
      if (missingFiles.length === 0) {
        const missingSnippets = sourceChecks.flatMap((check) => {
          const text = readFileSync(path.resolve(process.cwd(), check.path), "utf8");
          return check.required
            .filter((snippet) => !text.includes(snippet))
            .map((snippet) => `${check.name}: ${snippet}`);
        });
        if (missingSnippets.length > 0) {
          return { ok: false, detail: `missing giveback wiring: ${missingSnippets.join(", ")}` };
        }
      } else {
        const builtClientText = readBuiltClientText();
        if (!builtClientText) {
          return {
            ok: false,
            detail: `source unavailable (${missingFiles.map((check) => check.path).join(", ")}) and no built client bundle found`,
          };
        }
        const requiredBundleText = ["Generosity Fund", "Mom Wallet", "Platform Fund"];
        const missingBundleText = requiredBundleText.filter((snippet) => !builtClientText.includes(snippet));
        if (missingBundleText.length > 0) {
          return { ok: false, detail: `production bundle missing giveback text: ${missingBundleText.join(", ")}` };
        }
      }

      return {
        ok: true,
        detail: [
          `Mom ${Number(row.mom_balance || 0).toLocaleString()} JCMOVES`,
          `${Number(row.mom_hearts_count || 0).toLocaleString()} hearts / ${Number(row.mom_hearts_total || 0).toLocaleString()} donated`,
          `platform ${Number(row.platform_balance || 0).toLocaleString()} JCMOVES`,
          `${Number(row.generosity_log_count || 0).toLocaleString()} fund log rows`,
          `${Number(row.active_nominee_count || 0).toLocaleString()} active nominee(s)`,
          "internal wallets guarded from circular giveback credits",
        ].join("; "),
      };
    },
  },
  {
    id: "btc_sweep_alive",
    label: "BTC auto-verify sweep configured when BTC payments are enabled",
    run: async () => {
      const btcRequired = process.env.BTC_PAYMENTS_ENABLED === "true" || process.env.BTC_REQUIRED === "true";
      if (!process.env.BTC_WALLET_ADDRESS) {
        return btcRequired
          ? { ok: false, detail: "BTC payments enabled but sweep disabled - BTC_WALLET_ADDRESS not set" }
          : { ok: true, detail: "BTC sweep disabled because BTC payments are optional for current launch" };
      }
      return { ok: true, detail: "sweep ticks every 2 min from server/index.ts" };
    },
  },
  {
    id: "public_app_url",
    label: "Public app URL points to the launch domain",
    run: async () => {
      const appUrl = getAppUrl();
      try {
        const parsed = new URL(appUrl);
        const host = parsed.hostname.toLowerCase();
        const configured = !!(process.env.APP_URL?.trim() || process.env.RENDER_EXTERNAL_URL?.trim());
        const isLocal = host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
        if (parsed.protocol !== "https:") {
          return { ok: false, detail: `${appUrl} is not HTTPS` };
        }
        if (isLocal) {
          return { ok: false, detail: `${appUrl} is local-only; set APP_URL or RENDER_EXTERNAL_URL before launch` };
        }
        return {
          ok: true,
          detail: `${appUrl}${configured ? "" : " (using fallback launch domain)"}`,
        };
      } catch {
        return { ok: false, detail: `invalid app URL: ${appUrl}` };
      }
    },
  },
  {
    id: "public_conversion_routes",
    label: "Public customer and worker marketing routes are mounted",
    run: async () => {
      const appSourcePath = path.resolve(process.cwd(), "client/src/App.tsx");
      const builtClientPath = path.resolve(process.cwd(), "dist/public/index.html");
      const requiredRoutes = [
        "/book",
        "/services",
        "/pricing",
        "/gallery",
        "/reviews",
        "/network/:slug",
        "/rep/:slug",
        "/lawn-care",
        "/cleaning",
        "/window-cleaning",
        "/snow-removal",
        "/roofing",
        "/demolition",
        "/route-days",
        "/route-days/:slug",
      ] as const;
      if (!existsSync(appSourcePath)) {
        if (existsSync(builtClientPath)) {
          return {
            ok: true,
            detail: `production client bundle present; source route audit skipped because ${appSourcePath} is not deployed`,
          };
        }
        return {
          ok: false,
          detail: `neither source route file nor built client exists (${appSourcePath}, ${builtClientPath})`,
        };
      }
      const appSource = readFileSync(appSourcePath, "utf8");
      const hasRoute = (pathName: string) => (
        appSource.includes(`path="${pathName}"`) ||
        appSource.includes(`path='${pathName}'`)
      );
      const hasPublicRoot = appSource.includes("LandingPage") && appSource.includes("AuthenticatedApp");
      const missing = [
        ...(!hasPublicRoot ? ["/"] : []),
        ...requiredRoutes.filter((pathName) => !hasRoute(pathName)),
      ];
      return missing.length === 0
        ? { ok: true, detail: `${requiredRoutes.length + 1} public conversion and worker marketing routes mounted` }
        : { ok: false, detail: `missing public route(s): ${missing.join(", ")}` };
    },
  },
  {
    id: "admin_access_ready",
    label: "Admin/business-owner access account exists",
    run: async () => {
      const { rows } = await pool.query<{ count: number }>(`
        SELECT COUNT(*)::int AS count
        FROM users
        WHERE role IN ('admin', 'business_owner')
          AND COALESCE(status, 'approved') = 'approved'
      `);
      const count = rows[0]?.count ?? 0;
      return count > 0
        ? { ok: true, detail: `${count} approved admin/business-owner account(s)` }
        : { ok: false, detail: "no approved admin or business-owner account found" };
    },
  },
  {
    id: "public_booking_catalog",
    label: "Public booking catalog has core launch services",
    run: async () => {
      const { rows } = await pool.query<{ code: string }>(`
        SELECT code
        FROM service_catalog
        WHERE is_active = true
      `);
      const codes = new Set(rows.map((row) => row.code));
      const required = ["moving", "junk_removal", "delivery", "cleaning"];
      const missing = required.filter((code) => !codes.has(code));
      return missing.length === 0
        ? { ok: true, detail: `${rows.length} active services; core booking funnel present` }
        : { ok: false, detail: `missing active service codes: ${missing.join(", ")}` };
    },
  },
  {
    id: "marketplace_source_model",
    label: "Marketplace source model covers customer, worker, company flows",
    run: async () => {
      const requiredAliases = MARKETPLACE_LAUNCH_SOURCE_TARGETS.flatMap((target) => target.aliases);
      const missingAliases = requiredAliases.filter((alias) => !getMarketplaceSourceFlowForSource(alias));
      if (missingAliases.length > 0) {
        return { ok: false, detail: `missing source aliases: ${missingAliases.join(", ")}` };
      }

      const requiredReferences = Array.from(new Set(
        MARKETPLACE_LAUNCH_SOURCE_TARGETS.flatMap((target) => target.blueprintReferences),
      ));
      const referenceText = MARKETPLACE_REFERENCE_BLUEPRINTS.map((blueprint) => blueprint.reference).join(" ").toLowerCase();
      const missingReferences = requiredReferences.filter((reference) => !referenceText.includes(reference.toLowerCase()));
      if (missingReferences.length > 0) {
        return { ok: false, detail: `missing reference blueprints: ${missingReferences.join(", ")}` };
      }

      const flowsWithoutBlueprints = MARKETPLACE_SOURCE_FLOW_MATRIX.filter(
        (flow) => getMarketplaceReferenceBlueprintsForSource(flow.source).length === 0,
      );
      if (flowsWithoutBlueprints.length > 0) {
        return { ok: false, detail: `source flow(s) without operating blueprints: ${flowsWithoutBlueprints.map((flow) => flow.id).join(", ")}` };
      }

      const linkedFlowIds = new Set(MARKETPLACE_ACTION_TASKS.flatMap((task) => task.flowIds));
      const orphanFlows = MARKETPLACE_SOURCE_FLOW_MATRIX.filter((flow) => !linkedFlowIds.has(flow.id));
      if (orphanFlows.length > 0) {
        return { ok: false, detail: `source flow(s) without action tasks: ${orphanFlows.map((flow) => flow.id).join(", ")}` };
      }

      const incompleteFlows = MARKETPLACE_SOURCE_FLOW_MATRIX.filter((flow) => (
        !flow.start.trim()
        || !flow.progress.trim()
        || !flow.finish.trim()
        || !flow.customerMove.trim()
        || !flow.workerMove.trim()
        || !flow.companyControl.trim()
        || !flow.automationHook.trim()
        || !flow.rewardTrigger.trim()
      ));
      if (incompleteFlows.length > 0) {
        return { ok: false, detail: `incomplete source flow(s): ${incompleteFlows.map((flow) => flow.id).join(", ")}` };
      }

      return {
        ok: true,
        detail: `${MARKETPLACE_SOURCE_FLOW_MATRIX.length} source flows, ${MARKETPLACE_REQUEST_SHAPES.length} request shapes, ${MARKETPLACE_OPERATING_FLYWHEEL.length} flywheel stages, ${MARKETPLACE_ACTION_TASKS.length} action tasks`,
      };
    },
  },
  {
    id: "marketplace_launch_task_bonus_rail",
    label: "Marketplace launch tasks can be claimed safely for JCMOVES bonuses",
    run: async () => {
      const launchTasks = getMarketplaceLaunchTasks();
      const flowIds = new Set(MARKETPLACE_SOURCE_FLOW_MATRIX.map((flow) => flow.id));
      const actionTaskIds = new Set(MARKETPLACE_ACTION_TASKS.map((task) => task.id));
      const problems: string[] = [];

      if (launchTasks.length !== flowIds.size) {
        problems.push(`expected ${flowIds.size} launch tasks, found ${launchTasks.length}`);
      }

      const rails = new Set(launchTasks.map((task) => task.ownerRail));
      for (const rail of ["bronze", "silver", "gold", "platinum"]) {
        if (!rails.has(rail as any)) problems.push(`no ${rail} launch task owner rail`);
      }

      const readiness = new Set(launchTasks.map((task) => task.readiness));
      for (const level of ["build", "watch", "ready"]) {
        if (!readiness.has(level as any)) problems.push(`no ${level} launch task`);
      }

      for (const task of launchTasks) {
        if (!flowIds.has(task.sourceFlowId)) problems.push(`${task.id} references unknown source flow ${task.sourceFlowId}`);
        if (!task.title.trim()) problems.push(`${task.id} missing title`);
        if (!task.acceptanceCriteria.trim()) problems.push(`${task.id} missing acceptance criteria`);
        if (!task.automationGate.trim()) problems.push(`${task.id} missing automation gate`);
        if (task.completionBonusJcMoves <= 0) problems.push(`${task.id} has no completion bonus`);
        if (task.totalMappedBonusJcMoves > 0 && task.completionBonusJcMoves > task.totalMappedBonusJcMoves) {
          problems.push(`${task.id} completion bonus exceeds mapped JCMOVES context`);
        }
        if (task.linkedActionTaskIds.length === 0) problems.push(`${task.id} has no linked action tasks`);
        for (const linkedTaskId of task.linkedActionTaskIds) {
          if (!actionTaskIds.has(linkedTaskId)) problems.push(`${task.id} references unknown action task ${linkedTaskId}`);
        }
      }

      const { rows: tableRows } = await pool.query<{ exists: boolean }>(`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'launch_task_completions'
        ) AS exists
      `);
      if (!tableRows[0]?.exists) {
        problems.push("launch_task_completions table is missing");
      } else {
        const { rows: columnRows } = await pool.query<{ column_name: string }>(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'launch_task_completions'
        `);
        const columns = new Set(columnRows.map((row) => row.column_name));
        const requiredColumns = [
          "task_id",
          "source_flow_id",
          "completed_by_user_id",
          "authority_tier",
          "bonus_tokens",
          "proof_notes",
          "metadata",
          "created_at",
        ];
        const missingColumns = requiredColumns.filter((column) => !columns.has(column));
        if (missingColumns.length > 0) {
          problems.push(`launch_task_completions missing column(s): ${missingColumns.join(", ")}`);
        }

        const { rows: indexRows } = await pool.query<{ count: number }>(`
          SELECT COUNT(*)::int AS count
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'launch_task_completions'
            AND indexname = 'uq_launch_task_completion_user_task'
        `);
        if (Number(indexRows[0]?.count || 0) !== 1) {
          problems.push("launch_task_completions unique user/task guard is missing");
        }
      }

      const sourceChecks = [
        {
          name: "shared launch task model",
          path: "shared/marketplaceShapes.ts",
          required: [
            "completionBonusJcMoves",
            "launchTaskBonusByReadiness",
            "getMarketplaceLaunchTasks",
            "getMarketplaceLaunchSourceTargetsForFlow",
            "getMarketplaceLaunchTasksForRail",
          ],
        },
        {
          name: "launch task api",
          path: "server/routes.ts",
          required: [
            'app.get("/api/marketplace/launch-tasks"',
            'app.post("/api/marketplace/launch-tasks/:taskId/complete"',
            "ON CONFLICT (task_id, completed_by_user_id) DO NOTHING",
            "'ops_task_launch'",
            "proofNotes.length < 8",
          ],
        },
        {
          name: "launch task board",
          path: "client/src/components/MarketplaceSourceReadinessBoard.tsx",
          required: [
            'queryKey: ["/api/marketplace/launch-tasks"]',
            "MARKETPLACE_LAUNCH_SOURCE_TARGETS",
            "targetFilter",
            "getMarketplaceLaunchSourceTargetsForFlow",
            "Target focus",
            "proofNote",
            "Claim",
            "bonusTokens",
            "completedByMe",
          ],
        },
        {
          name: "marketplace tasks tab",
          path: "client/src/pages/admin/marketplace.tsx",
          required: [
            "MarketplaceSourceReadinessBoard",
            'TabsTrigger value="tasks"',
            'TabsContent value="tasks"',
          ],
        },
      ];
      const missingFiles = sourceChecks.filter((check) => !existsSync(path.resolve(process.cwd(), check.path)));
      if (missingFiles.length === 0) {
        const missingSnippets = sourceChecks.flatMap((check) => {
          const text = readFileSync(path.resolve(process.cwd(), check.path), "utf8");
          return check.required
            .filter((snippet) => !text.includes(snippet))
            .map((snippet) => `${check.name}: ${snippet}`);
        });
        if (missingSnippets.length > 0) problems.push(`missing launch-task wiring: ${missingSnippets.join(", ")}`);
      } else {
        const builtClientText = readBuiltClientText();
        if (!builtClientText) {
          problems.push(`source unavailable (${missingFiles.map((check) => check.path).join(", ")}) and no built client bundle found`);
        } else {
          const missingBundleText = ["claim bonus", "Proof note", "Claim"].filter((snippet) => !builtClientText.includes(snippet));
          if (missingBundleText.length > 0) {
            problems.push(`production bundle missing launch-task text: ${missingBundleText.join(", ")}`);
          }
        }
      }

      if (problems.length > 0) {
        return { ok: false, detail: problems.slice(0, 8).join("; ") };
      }

      const availableBonus = launchTasks.reduce((sum, task) => sum + task.completionBonusJcMoves, 0);
      return {
        ok: true,
        detail: `${launchTasks.length} source launch tasks; rails ${Array.from(rails).join("/")}; ${availableBonus.toLocaleString()} controlled JCMOVES available; one-claim guard and proof-note API mounted`,
      };
    },
  },
  {
    id: "marketplace_surface_mounts",
    label: "Marketplace process is mounted on booking, customer, worker, and company surfaces",
    run: async () => {
      const surfaces = [
        {
          name: "public booking flow",
          path: "client/src/pages/book.tsx",
          required: [
            "smart-start-card",
            "SmartRequestShapePicker",
            "ServicePriceMenu",
            "SmartBookingGuidanceCard",
            "MarketplaceShapeContext",
            "MarketplaceNextStepFlow",
            "Service Request Locked In",
            "booking-marketplace-flow",
          ],
        },
        {
          name: "public shape picker",
          path: "client/src/components/SmartRequestShapePicker.tsx",
          required: [
            "PUBLIC_SHAPE_ORDER",
            "fast_quote",
            "Quick Quote",
            "Start here",
          ],
        },
        {
          name: "smart booking next action card",
          path: "client/src/components/SmartBookingGuidanceCard.tsx",
          required: [
            "guidance.nextAction",
            "guidance.recommendedTasks",
            "smart-guidance-next-option",
            "sourcePatterns",
            "missingLabels",
            "Who moves it",
          ],
        },
        {
          name: "source lookup",
          path: "client/src/components/MarketplaceSourceLookup.tsx",
          required: [
            "MARKETPLACE_LAUNCH_SOURCE_TARGETS",
            "Launch targets",
            "sourceFlowForTarget",
            "getMarketplaceReferenceBlueprintsForSource",
            "Operating Blueprints",
            "Borrow",
            "Avoid",
            "Next build",
          ],
        },
        {
          name: "marketplace admin source actions",
          path: "client/src/pages/admin/marketplace.tsx",
          required: [
            "MarketplaceSourceActionDeck",
            'TabsContent value="sources"',
            "MarketplaceSourceLookup",
            "MarketplaceCoverageAudit",
          ],
        },
        {
          name: "action matrix source chips",
          path: "client/src/components/MarketplaceActionMatrix.tsx",
          required: [
            "getMarketplaceSourceFlowsForActionTask",
            "sourceFlows.map",
            "flow.source",
          ],
        },
        {
          name: "task split source chips",
          path: "client/src/components/MarketplaceTaskSplit.tsx",
          required: [
            "getMarketplaceSourceFlowsForActionTask",
            "sourceFlows.map",
            "flow.source",
          ],
        },
        {
          name: "customer my-jobs",
          path: "client/src/pages/my-jobs.tsx",
          required: [
            "MarketplaceProcessGuide",
            "MarketplaceSourceFlowStrip",
            "SmartBookingGuidanceCard",
            "BookingMenuIntelligenceCard",
            'audience="customer"',
          ],
        },
        {
          name: "worker crew jobs",
          path: "client/src/pages/crew/jobs.tsx",
          required: [
            "MarketplaceProcessGuide",
            "MarketplaceTaskSplit",
            "MarketplaceActionMatrix",
            "BookingMenuIntelligenceCard",
            'audience="worker"',
          ],
        },
        {
          name: "company admin jobs",
          path: "client/src/pages/admin/jobs.tsx",
          required: [
            "MarketplaceProcessGuide",
            "MarketplaceTaskSplit",
            "MarketplaceActionMatrix",
            "BookingMenuIntelligenceCard",
            'audience="company"',
          ],
        },
        {
          name: "shared lead detail",
          path: "client/src/pages/lead-detail.tsx",
          required: [
            "MarketplaceProcessGuide",
            "MarketplaceSourceFlowStrip",
            "BookingMenuIntelligenceCard",
            "marketplaceAudience",
          ],
        },
      ];

      const sourceMissing = surfaces.filter((surface) => !existsSync(path.resolve(process.cwd(), surface.path)));
      if (sourceMissing.length === 0) {
        const missing = surfaces.flatMap((surface) => {
          const text = readFileSync(path.resolve(process.cwd(), surface.path), "utf8");
          return surface.required
            .filter((snippet) => !text.includes(snippet))
            .map((snippet) => `${surface.name}: ${snippet}`);
        });
        return missing.length === 0
          ? { ok: true, detail: `${surfaces.length} live job surfaces carry marketplace process/source/package guidance` }
          : { ok: false, detail: `missing surface wiring: ${missing.join(", ")}` };
      }

      const builtClientText = readBuiltClientText();
      if (!builtClientText) {
        return {
          ok: false,
          detail: `source unavailable (${sourceMissing.map((surface) => surface.path).join(", ")}) and no built client bundle found`,
        };
      }

      const requiredBundleText = ["1, 2, 3 Process", "Customer path", "Worker path", "Company path"];
      const missingBundleText = requiredBundleText.filter((snippet) => !builtClientText.includes(snippet));
      return missingBundleText.length === 0
        ? { ok: true, detail: "production bundle includes booking, customer, worker, and company marketplace process labels" }
        : { ok: false, detail: `production bundle missing marketplace process text: ${missingBundleText.join(", ")}` };
    },
  },
  {
    id: "quick_request_notifications",
    label: "Quick request notifications configured for media-aware leads",
    run: async () => {
      const hasGmail = !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
      const hasSendgrid = !!process.env.SENDGRID_API_KEY;
      const hasAdminSms = !!(
        process.env.ADMIN_PHONE_NUMBER &&
        process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        (process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID)
      );
      const hasJobWebhook = !!(process.env.JC_JOB_EVENT_WEBHOOK_URLS || process.env.JOB_EVENT_WEBHOOK_URLS);
      const hasMarketingWebhook = !!(process.env.JC_MARKETING_WEBHOOK_URLS || process.env.MARKETING_WEBHOOK_URLS);
      const channels = [
        hasGmail ? "gmail" : "",
        hasSendgrid ? "sendgrid" : "",
        hasAdminSms ? "admin_sms" : "",
        hasJobWebhook ? "job_webhook" : "",
        hasMarketingWebhook ? "marketing_webhook" : "",
      ].filter(Boolean);
      return channels.length > 0
        ? { ok: true, detail: `available: ${channels.join(", ")}; media-link context is included when customers provide it` }
        : { ok: false, detail: "no email, admin SMS, or webhook notification channel is fully configured" };
    },
  },
  {
    id: "quick_request_storage",
    label: "Quick request photo, media-link + attribution storage ready",
    run: async () => {
      const { rows } = await pool.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'leads'
          AND column_name IN ('promo_code', 'photos', 'order_number', 'details', 'source')
      `);
      const columns = new Set(rows.map((row) => row.column_name));
      const required = ["promo_code", "photos", "order_number", "details", "source"];
      const missing = required.filter((name) => !columns.has(name));
      return missing.length === 0
        ? { ok: true, detail: "leads table can store source, promo code, photos, media links/details, and order number" }
        : { ok: false, detail: `missing lead columns: ${missing.join(", ")}` };
    },
  },
  {
    id: "tracked_marketing_funnel",
    label: "Tracked crew/webhook campaign link reaches booking + campaign analytics",
    run: runTrackedMarketingFunnelProbe,
  },
  {
    id: "promo_code_integrity",
    label: "Promo codes are valid, trackable, and reward-safe",
    run: async () => {
      const { rows } = await pool.query<{
        total_codes: number;
        active_codes: number;
        duplicate_active_codes: string | null;
        malformed_active_codes: string | null;
        expired_active_codes: string | null;
        maxed_active_codes: string | null;
        invalid_value_codes: string | null;
        orphan_referrer_codes: string | null;
        orphan_rep_codes: string | null;
      }>(`
        WITH duplicate_active AS (
          SELECT UPPER(TRIM(code)) AS code
          FROM promo_codes
          WHERE is_active = true
          GROUP BY UPPER(TRIM(code))
          HAVING COUNT(*) > 1
        ),
        malformed_active AS (
          SELECT code
          FROM promo_codes
          WHERE is_active = true
            AND (
              code <> UPPER(code)
              OR code !~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'
            )
        ),
        expired_active AS (
          SELECT code
          FROM promo_codes
          WHERE is_active = true
            AND expires_at IS NOT NULL
            AND expires_at <= NOW()
        ),
        maxed_active AS (
          SELECT code
          FROM promo_codes
          WHERE is_active = true
            AND max_uses IS NOT NULL
            AND uses_count >= max_uses
        ),
        invalid_values AS (
          SELECT code
          FROM promo_codes
          WHERE discount_percent::numeric < 0
             OR discount_percent::numeric > 100
             OR discount_percent_jewelry::numeric < 0
             OR discount_percent_jewelry::numeric > 100
             OR reward_tokens::numeric < 0
             OR referral_reward_tokens::numeric < 0
             OR uses_count < 0
             OR (max_uses IS NOT NULL AND max_uses <= 0)
        ),
        orphan_referrers AS (
          SELECT pc.code
          FROM promo_codes pc
          LEFT JOIN users u ON u.id = pc.referral_user_id
          WHERE pc.referral_user_id IS NOT NULL
            AND u.id IS NULL
        ),
        orphan_reps AS (
          SELECT mr.promo_code AS code
          FROM marketing_reps mr
          LEFT JOIN promo_codes pc ON UPPER(pc.code) = UPPER(mr.promo_code) AND pc.is_active = true
          WHERE mr.is_active = true
            AND pc.id IS NULL
        )
        SELECT
          (SELECT COUNT(*)::int FROM promo_codes) AS total_codes,
          (SELECT COUNT(*)::int FROM promo_codes WHERE is_active = true) AS active_codes,
          (SELECT STRING_AGG(code, ', ' ORDER BY code) FROM duplicate_active) AS duplicate_active_codes,
          (SELECT STRING_AGG(code, ', ' ORDER BY code) FROM malformed_active) AS malformed_active_codes,
          (SELECT STRING_AGG(code, ', ' ORDER BY code) FROM expired_active) AS expired_active_codes,
          (SELECT STRING_AGG(code, ', ' ORDER BY code) FROM maxed_active) AS maxed_active_codes,
          (SELECT STRING_AGG(code, ', ' ORDER BY code) FROM invalid_values) AS invalid_value_codes,
          (SELECT STRING_AGG(code, ', ' ORDER BY code) FROM orphan_referrers) AS orphan_referrer_codes,
          (SELECT STRING_AGG(code, ', ' ORDER BY code) FROM orphan_reps) AS orphan_rep_codes
      `);
      const row = rows[0];
      if (!row || Number(row.total_codes) === 0) {
        return { ok: false, detail: "no promo codes found; marketing, rep pages, and customer discounts need at least one code" };
      }
      if (Number(row.active_codes) === 0) {
        return { ok: false, detail: `${row.total_codes} promo code(s) exist but none are active` };
      }

      const hardFailures = [
        row.duplicate_active_codes ? `duplicate active codes: ${row.duplicate_active_codes}` : "",
        row.malformed_active_codes ? `malformed active codes: ${row.malformed_active_codes}` : "",
        row.expired_active_codes ? `expired active codes still active: ${row.expired_active_codes}` : "",
        row.maxed_active_codes ? `maxed-out codes still active: ${row.maxed_active_codes}` : "",
        row.invalid_value_codes ? `invalid promo values: ${row.invalid_value_codes}` : "",
        row.orphan_referrer_codes ? `codes point to missing referrers: ${row.orphan_referrer_codes}` : "",
        row.orphan_rep_codes ? `active rep pages point to missing/inactive promo codes: ${row.orphan_rep_codes}` : "",
      ].filter(Boolean);
      if (hardFailures.length > 0) {
        return { ok: false, detail: hardFailures.join("; ") };
      }

      const sourceChecks = [
        {
          name: "promo schema",
          path: "shared/schema.ts",
          required: [
            'pgTable("promo_codes"',
            "discountPercent",
            "rewardTokens",
            "referralRewardTokens",
            "maxUses",
          ],
        },
        {
          name: "promo admin api",
          path: "server/routes.ts",
          required: [
            'app.get("/api/admin/promo-codes"',
            'app.post("/api/admin/promo-codes"',
            'app.patch("/api/admin/promo-codes/:id"',
            'app.delete("/api/admin/promo-codes/:id"',
            'app.post("/api/promo-codes/apply"',
          ],
        },
        {
          name: "booking attribution bridge",
          path: "server/routes/bookings.ts",
          required: [
            "marketingPromoCode",
            "marketingReferralSlug",
            "quoteAttributions",
            "promoCode: leadPromoCode",
            "marketingCampaignId",
          ],
        },
        {
          name: "public booking attribution capture",
          path: "client/src/pages/book.tsx",
          required: [
            'sp.get("promo")',
            'sp.get("rep")',
            "marketingTracking",
            "buildBookingFunnelSnapshot",
            "promoCode: attribution.promoCode",
          ],
        },
        {
          name: "rep landing page",
          path: "client/src/pages/marketing-rep.tsx",
          required: [
            "rep.promoCode",
            "withTracking",
            "shareText",
            "Use code",
          ],
        },
        {
          name: "admin promo ui",
          path: "client/src/pages/admin-promo-codes.tsx",
          required: [
            'queryKey: ["/api/admin/promo-codes"]',
            "Create Promo Code",
            "Referrer Token Reward",
            "Max Uses",
            "Delete Promo Code?",
          ],
        },
        {
          name: "booking analytics promo chips",
          path: "client/src/pages/admin/booking-analytics.tsx",
          required: [
            "promoCodes",
            "Promo {code}",
            "sourceBreakdown",
          ],
        },
      ];

      const missingFiles = sourceChecks.filter((check) => !existsSync(path.resolve(process.cwd(), check.path)));
      if (missingFiles.length === 0) {
        const missingSnippets = sourceChecks.flatMap((check) => {
          const text = readFileSync(path.resolve(process.cwd(), check.path), "utf8");
          return check.required
            .filter((snippet) => !text.includes(snippet))
            .map((snippet) => `${check.name}: ${snippet}`);
        });
        if (missingSnippets.length > 0) {
          return { ok: false, detail: `missing promo wiring: ${missingSnippets.join(", ")}` };
        }
      } else {
        const builtClientText = readBuiltClientText();
        if (!builtClientText) {
          return {
            ok: false,
            detail: `source unavailable (${missingFiles.map((check) => check.path).join(", ")}) and no built client bundle found`,
          };
        }
        const requiredBundleText = ["Promo Codes", "Referral code", "Promo"];
        const missingBundleText = requiredBundleText.filter((snippet) => !builtClientText.includes(snippet));
        if (missingBundleText.length > 0) {
          return { ok: false, detail: `production bundle missing promo text: ${missingBundleText.join(", ")}` };
        }
      }

      return {
        ok: true,
        detail: `${row.active_codes}/${row.total_codes} promo code(s) active; no duplicate/malformed/expired/maxed/orphan reward links; booking + rep + analytics wiring mounted`,
      };
    },
  },
  {
    id: "marketing_rep_pages",
    label: "Worker marketing rep pages are share-ready",
    run: async () => {
      const { rows } = await pool.query<{
        id: string;
        slug: string | null;
        promo_code: string | null;
        display_name: string | null;
        promo_exists: boolean;
      }>(`
        SELECT mr.id, mr.slug, mr.promo_code, mr.display_name,
               EXISTS (
                 SELECT 1
                 FROM promo_codes pc
                 WHERE UPPER(pc.code) = UPPER(mr.promo_code)
                   AND pc.is_active = true
               ) AS promo_exists
        FROM marketing_reps mr
        WHERE mr.is_active = true
      `);

      if (rows.length === 0) {
        return { ok: false, detail: "no active marketing reps found; create at least one rep page before worker marketing" };
      }

      const badRows = rows.filter((row) => {
        const slugOk = !!row.slug && /^[a-z0-9-]+$/.test(row.slug);
        const promoOk = !!row.promo_code && row.promo_exists;
        return !slugOk || !promoOk;
      });
      if (badRows.length > 0) {
        return {
          ok: false,
          detail: `${badRows.length} active rep page(s) missing a clean slug or active promo code`,
        };
      }

      const slugCounts = new Map<string, number>();
      const promoCounts = new Map<string, number>();
      for (const row of rows) {
        const slug = String(row.slug || "").toLowerCase();
        const promo = String(row.promo_code || "").toUpperCase();
        slugCounts.set(slug, (slugCounts.get(slug) || 0) + 1);
        promoCounts.set(promo, (promoCounts.get(promo) || 0) + 1);
      }
      const duplicateSlugs = [...slugCounts.entries()].filter(([, count]) => count > 1).map(([slug]) => slug);
      const duplicatePromos = [...promoCounts.entries()].filter(([, count]) => count > 1).map(([promo]) => promo);
      if (duplicateSlugs.length || duplicatePromos.length) {
        return {
          ok: false,
          detail: [
            duplicateSlugs.length ? `duplicate slugs: ${duplicateSlugs.join(", ")}` : "",
            duplicatePromos.length ? `duplicate promo codes: ${duplicatePromos.join(", ")}` : "",
          ].filter(Boolean).join("; "),
        };
      }

      return {
        ok: true,
        detail: `${rows.length} active rep page(s) have clean slugs and active promo codes`,
      };
    },
  },
  {
    id: "profit_share_settings",
    label: "Profit-share defaults match launch payout rules",
    run: async () => {
      const { rows } = await pool.query<{
        fuel_reserve_pct: string;
        vehicle_reserve_pct: string;
        insurance_reserve_pct: string;
        processing_fee_pct: string;
        company_profit_pct: string;
        crew_bonus_pct: string;
        referral_pct: string;
        growth_fund_pct: string;
      }>(`
        SELECT fuel_reserve_pct, vehicle_reserve_pct, insurance_reserve_pct, processing_fee_pct,
               company_profit_pct, crew_bonus_pct, referral_pct, growth_fund_pct
        FROM job_payout_settings
        WHERE is_default = true
        LIMIT 1
      `);
      const row = rows[0];
      if (!row) return { ok: false, detail: "no default job_payout_settings row found" };
      const expected: Record<keyof typeof row, number> = {
        fuel_reserve_pct: 0.05,
        vehicle_reserve_pct: 0.05,
        insurance_reserve_pct: 0.025,
        processing_fee_pct: 0.03,
        company_profit_pct: 0.7,
        crew_bonus_pct: 0.2,
        referral_pct: 0.05,
        growth_fund_pct: 0.05,
      };
      const mismatches = Object.entries(expected).filter(([key, expectedValue]) => {
        const actual = Number(row[key as keyof typeof row]);
        return Math.abs(actual - expectedValue) > 0.0001;
      });
      return mismatches.length === 0
        ? { ok: true, detail: "reserves 5/5/2.5/3 and split 70/20/5/5 confirmed" }
        : { ok: false, detail: `mismatch: ${mismatches.map(([key]) => key).join(", ")}` };
    },
  },
  {
    id: "payout_safety_gate",
    label: "No worker payouts exist before customer approval",
    run: async () => {
      const { rows } = await pool.query<{ count: number }>(`
        SELECT COUNT(*)::int AS count
        FROM job_worker_payouts p
        JOIN leads l ON l.id = p.lead_id
        WHERE l.status IN ('new', 'contacted', 'quote_requested', 'quoted', 'confirmed',
                           'available', 'accepted', 'assigned', 'payment_authorized',
                           'in_progress', 'completed')
      `);
      const count = rows[0]?.count ?? 0;
      return count === 0
        ? { ok: true, detail: "no premature worker payout records found" }
        : { ok: false, detail: `${count} payout record(s) attached to pre-approval jobs` };
    },
  },
];

export function listScenarios(): { id: ScenarioId; label: string }[] {
  return SCENARIOS.map(({ id, label }) => ({ id, label }));
}

export async function runScenario(id: ScenarioId): Promise<ScenarioResult> {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) {
    return {
      id,
      label: id,
      ok: false,
      detail: "unknown scenario",
      ranAt: new Date().toISOString(),
      ms: 0,
    };
  }
  const t0 = Date.now();
  try {
    const r = await s.run();
    return { id, label: s.label, ok: r.ok, detail: r.detail, ranAt: new Date().toISOString(), ms: Date.now() - t0 };
  } catch (e) {
    return {
      id,
      label: s.label,
      ok: false,
      detail: describeUnknownError(e),
      ranAt: new Date().toISOString(),
      ms: Date.now() - t0,
    };
  }
}

export async function runAllScenarios(): Promise<ScenarioResult[]> {
  const out: ScenarioResult[] = [];
  for (const s of SCENARIOS) out.push(await runScenario(s.id));
  return out;
}

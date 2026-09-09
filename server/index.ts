import 'dotenv/config'
import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import path from "path";
import fs from "fs";
import cors from "cors";
import type { InsertRewardItem } from "@shared/schema";
import { assertRequiredEnvOrExit } from "./services/envValidation";
import { squareConfigSummary } from "./services/squareConfig";

const boot = {
  status: "starting" as "starting" | "ready" | "failed",
  error: null as string | null,
  readyAt: null as string | null,
};

function log(message: string) {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [express] ${message}`);
}

function readBuildInfo() {
  const filePath = path.resolve(process.cwd(), "dist/build-info.json");
  try {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      commit?: string | null;
      shortCommit?: string | null;
      branch?: string | null;
      generatedAt?: string | null;
    };
  } catch (error) {
    console.warn("[build-info] unable to read dist/build-info.json:", error instanceof Error ? error.message : error);
    return {};
  }
}

function getDeployVersion() {
  const buildInfo = readBuildInfo();
  const commit =
    process.env.RAILWAY_GIT_COMMIT_SHA
    || process.env.RENDER_GIT_COMMIT
    || process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.GITHUB_SHA
    || buildInfo.commit
    || null;
  const branch =
    process.env.RAILWAY_GIT_BRANCH
    || process.env.RENDER_GIT_BRANCH
    || process.env.VERCEL_GIT_COMMIT_REF
    || process.env.GITHUB_REF_NAME
    || buildInfo.branch
    || null;
  const deployId =
    process.env.RAILWAY_DEPLOYMENT_ID
    || process.env.RENDER_SERVICE_ID
    || process.env.VERCEL_DEPLOYMENT_ID
    || process.env.GITHUB_RUN_ID
    || null;

  return {
    commit,
    shortCommit: commit ? commit.slice(0, 8) : null,
    branch,
    deployId,
    buildGeneratedAt: buildInfo.generatedAt || null,
  };
}

const REQUIRED_HEALTH_ENV = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "SQUARE_ENVIRONMENT",
] as const;

const OPTIONAL_HEALTH_ENV = [
  "APP_URL",
  "MOONSHOT_TOKEN_ADDRESS",
  "TREASURY_WALLET_PRIVATE_KEY",
  "TREASURY_WALLET_PUBLIC_KEY",
  "SENDGRID_API_KEY",
  "COMPANY_EMAIL",
  "VITE_SOLANA_RPC_URL",
  "OPENAI_API_KEY",
  "OPENAI_IMAGE_MODEL",
  "PUBLIC_OBJECT_SEARCH_PATHS",
  "GOOGLE_CLOUD_PROJECT_ID",
] as const;

function envPresence(names: readonly string[]) {
  return Object.fromEntries(
    names.map((name) => [name, process.env[name]?.trim() ? "present" : "missing"]),
  );
}

function toHealthError(error: unknown) {
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: String(error) };
}

async function checkDatabaseReady() {
  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error("Database readiness probe timed out")), 1500);
  });
  const { pool } = await import("./db");
  await Promise.race([pool.query("select 1"), timeout]);
}

async function sendEarlyReadiness(_req: Request, res: Response) {
  const startedAt = Date.now();
  const missingRequiredEnv = REQUIRED_HEALTH_ENV.filter((name) => !process.env[name]?.trim());
  const squareConfig = squareConfigSummary();
  if (!squareConfig.configured) missingRequiredEnv.push("SQUARE_ACCESS_TOKEN (or environment-specific Square token)" as any);
  const envReady = missingRequiredEnv.length === 0;

  let dbCheck:
    | { status: "ready"; connected: true; latencyMs: number }
    | { status: "not_ready"; connected: false; latencyMs: number; error: { message: string } };

  if (boot.status === "ready") {
    try {
      await checkDatabaseReady();
      dbCheck = {
        status: "ready",
        connected: true,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      dbCheck = {
        status: "not_ready",
        connected: false,
        latencyMs: Date.now() - startedAt,
        error: toHealthError(error),
      };
    }
  } else {
    dbCheck = {
      status: "not_ready",
      connected: false,
      latencyMs: Date.now() - startedAt,
      error: { message: boot.status === "failed" ? boot.error || "Application bootstrap failed" : "Application bootstrap still starting" },
    };
  }

  const ready = boot.status === "ready" && dbCheck.status === "ready" && envReady;

  res.setHeader("Cache-Control", "no-store");
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    service: "jc-on-the-move",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    version: getDeployVersion(),
    boot,
    checks: {
      app: {
        status: boot.status === "ready" ? "ready" : "not_ready",
        nodeEnv: process.env.NODE_ENV || "development",
        port: process.env.PORT || "5000",
      },
      db: dbCheck,
      marketingCreative: {
        deterministicReady: true,
        openAiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
        objectStorageConfigured: Boolean(process.env.PUBLIC_OBJECT_SEARCH_PATHS?.trim()),
        aiReady: Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.PUBLIC_OBJECT_SEARCH_PATHS?.trim()),
        imageModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
      },
      env: {
        status: envReady ? "ready" : "not_ready",
        missingRequired: missingRequiredEnv,
        required: envPresence(REQUIRED_HEALTH_ENV),
        optional: envPresence(OPTIONAL_HEALTH_ENV),
      },
      square: squareConfig,
    },
  });
}

// ── Crash guard — log clearly before exiting so the auto-restart wrapper picks it up ──
process.on("uncaughtException", (err) => {
  console.error(`\n[CRASH] Uncaught exception at ${new Date().toISOString()}:`);
  console.error(err?.stack || err);
  console.error("[CRASH] Auto-restart wrapper will bring the server back up in a moment...\n");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(`\n[CRASH] Unhandled promise rejection at ${new Date().toISOString()}:`);
  console.error(reason);
  console.error("[CRASH] Auto-restart wrapper will bring the server back up in a moment...\n");
  process.exit(1);
});

assertRequiredEnvOrExit();

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

// Baseline browser protections which are safe for the current Square and OAuth
// integrations. A stricter CSP can be introduced once those external surfaces
// have been exercised under report-only monitoring.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), geolocation=(self), microphone=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

app.use((req, res, next) => {
  if (process.env.NODE_ENV === "production" && req.hostname === "jconthemove.com") {
    return res.redirect(301, `https://www.jconthemove.com${req.originalUrl}`);
  }
  next();
});

// Platforms need a fast liveness endpoint while the app finishes heavier
// route/bootstrap work. Keep this 200-level, but include enough deployment
// state to tell "socket is up" from "marketplace routes are ready".
app.get("/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    status: boot.status === "failed" ? "not_ready" : "alive",
    service: "jc-on-the-move",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    version: getDeployVersion(),
    boot,
  });
});

app.get("/version", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    service: "jc-on-the-move",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    version: getDeployVersion(),
    boot,
  });
});

app.get("/api/health", sendEarlyReadiness);

// CORS configuration for web and mobile clients.
function normalizeOrigin(origin: string | undefined | null) {
  if (!origin) return null;
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

const configuredOrigins = [
  process.env.APP_URL,
  process.env.PUBLIC_APP_URL,
  process.env.VITE_API_BASE_URL,
].map(normalizeOrigin).filter((origin): origin is string => Boolean(origin));

const allowedOrigins = new Set([
  'https://jconthemove.com',
  'https://www.jconthemove.com',
  'capacitor://localhost',
  'http://localhost',
  'http://localhost:5000',
  'http://localhost:8100',
  ...configuredOrigins,
]);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(normalizeOrigin(origin) || "")) {
      return callback(null, true);
    }
    if (process.env.NODE_ENV !== "production") {
      return callback(null, true);
    }
    return callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  exposedHeaders: ['Set-Cookie'],
}));

// CRITICAL SECURITY: Handle webhook routes BEFORE global JSON parser
// This preserves raw body bytes needed for HMAC signature validation
app.use('/api/advertising/webhook', express.raw({ type: 'application/json' }));
app.use('/api/webhooks/square', express.raw({ type: 'application/json' }));
app.use('/api/webhooks/crypto/bitpay', express.raw({ type: '*/*' }));

// Public JSON is metadata and form input, not video storage. Media uploads use
// dedicated validated endpoints instead of allowing a 4 GB request body on
// every route.
app.use(express.json({ limit: '16mb' }));
app.use(express.urlencoded({ extended: true, limit: '16mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

const port = parseInt(process.env.PORT || '5000', 10);
const server = createServer(app);

console.log(`Starting server on port ${port}...`);

server.listen(port, '0.0.0.0', () => {
  console.log('JC ON THE MOVE HTTP listener started');
  console.log(`Serving on http://0.0.0.0:${port}`);
});

(async () => {
  try {
    // Task #175 — Self-healing payment columns on leads. Additive only;
    // safe to run on every boot.
    (async () => {
      try {
        const { pool: dbPool } = await import('./db');
        await dbPool.query(`
          ALTER TABLE leads
            ADD COLUMN IF NOT EXISTS payment_plan             TEXT,
            ADD COLUMN IF NOT EXISTS payment_paid_at          TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS jcmoves_reward_base      NUMERIC(10,2),
            ADD COLUMN IF NOT EXISTS dispatch_override_reason TEXT
        `);
        console.log('✅ Task #175 payment columns ready');
      } catch (e) { console.error('payment columns init error:', e); }
    })();

    // Task #185 — Self-healing demand columns on pipeline_runs so the
    // 7-day demand & surge history chart on /admin/calibrate has the
    // data it needs. Additive only; safe to run on every boot.
    (async () => {
      try {
        const { pool: dbPool } = await import('./db');
        await dbPool.query(`
          ALTER TABLE pipeline_runs
            ADD COLUMN IF NOT EXISTS demand_score      NUMERIC(5,3),
            ADD COLUMN IF NOT EXISTS theoretical_surge NUMERIC(5,3),
            ADD COLUMN IF NOT EXISTS zone_code         VARCHAR(64)
        `);
        console.log('✅ Task #185 demand history columns ready');
      } catch (e) { console.error('demand history columns init error:', e); }
    })();

    // Marketplace card bridge: /book persists a booking snapshot, but ops,
    // calendar, crew assignment, and payouts run on leads. These additive
    // columns let every booking create/link a durable operational lead card.
    (async () => {
      try {
        const { pool: dbPool } = await import('./db');
        await dbPool.query(`
          ALTER TABLE leads
            ADD COLUMN IF NOT EXISTS booking_id     VARCHAR,
            ADD COLUMN IF NOT EXISTS quote_snapshot JSONB DEFAULT '{}'::jsonb,
            ADD COLUMN IF NOT EXISTS zone_snapshot  JSONB DEFAULT '{}'::jsonb
        `);
        await dbPool.query(`CREATE INDEX IF NOT EXISTS idx_leads_booking_id ON leads(booking_id)`);
        console.log('✅ Marketplace lead bridge columns ready');
      } catch (e) { console.error('marketplace lead bridge init error:', e); }
    })();

    // Job-card pricing and reward fields are additive so live leads retain
    // their existing history while new plans can distinguish truck, trailer,
    // and a designated crew lead.
    {
      const { pool: dbPool } = await import('./db');
      await dbPool.query(`
        ALTER TABLE leads
          ADD COLUMN IF NOT EXISTS trailer_requested BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS crew_lead_user_id VARCHAR REFERENCES users(id),
          ADD COLUMN IF NOT EXISTS job_plan_details JSONB NOT NULL DEFAULT '{}'::jsonb,
          ADD COLUMN IF NOT EXISTS access_instructions_ciphertext TEXT;
        CREATE TABLE IF NOT EXISTS job_jcmoves_ledger (
          id BIGSERIAL PRIMARY KEY,
          lead_id VARCHAR REFERENCES leads(id) ON DELETE CASCADE,
          recipient_type TEXT NOT NULL CHECK (recipient_type IN ('customer', 'crew')),
          recipient_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
          recipient_label TEXT,
          reward_kind TEXT NOT NULL,
          token_amount INTEGER NOT NULL CHECK (token_amount >= 0),
          quote_total NUMERIC(10,2) NOT NULL,
          rate_per_dollar NUMERIC(10,4) NOT NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (lead_id, recipient_type, recipient_user_id, reward_kind)
        );
        CREATE INDEX IF NOT EXISTS idx_job_jcmoves_ledger_lead ON job_jcmoves_ledger(lead_id, created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_job_jcmoves_ledger_pending_recipient
          ON job_jcmoves_ledger(lead_id, recipient_type, reward_kind)
          WHERE recipient_user_id IS NULL;
      `);
      console.log('Job rate-card and JCMOVES ledger fields ready');
    }

    // Crew acceptance routes use text[] operators (ANY(), array appends, and
    // Drizzle text().array()). Normalize older live DBs that still have the
    // prototype jsonb column before worker job routes can fail.
    (async () => {
      try {
        const { pool: dbPool } = await import('./db');
        await dbPool.query(`
          DO $$
          DECLARE
            column_type text;
          BEGIN
            SELECT data_type
              INTO column_type
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'leads'
               AND column_name = 'accepted_by_employees';

            IF column_type IS NULL THEN
              ALTER TABLE leads
                ADD COLUMN accepted_by_employees TEXT[] DEFAULT ARRAY[]::TEXT[];
            ELSIF column_type = 'jsonb' THEN
              ALTER TABLE leads
                ADD COLUMN IF NOT EXISTS accepted_by_employees_text_migration TEXT[] DEFAULT ARRAY[]::TEXT[];

              UPDATE leads
                 SET accepted_by_employees_text_migration =
                       CASE
                         WHEN accepted_by_employees IS NULL THEN ARRAY[]::TEXT[]
                         WHEN jsonb_typeof(accepted_by_employees) = 'array' THEN
                           COALESCE(
                             ARRAY(
                               SELECT jsonb_array_elements_text(accepted_by_employees)
                             ),
                             ARRAY[]::TEXT[]
                           )
                         ELSE ARRAY[]::TEXT[]
                       END;

              ALTER TABLE leads DROP COLUMN accepted_by_employees;
              ALTER TABLE leads
                RENAME COLUMN accepted_by_employees_text_migration TO accepted_by_employees;
              ALTER TABLE leads
                ALTER COLUMN accepted_by_employees SET DEFAULT ARRAY[]::TEXT[];
            ELSE
              ALTER TABLE leads
                ALTER COLUMN accepted_by_employees SET DEFAULT ARRAY[]::TEXT[];
            END IF;
          END $$;
        `);
        console.log('Lead crew acceptance column ready');
      } catch (e) { console.error('lead crew acceptance column init error:', e); }
    })();

    // Custom area/focus marketing webhook reminders. These power Discord,
    // Slack, Solbot, or generic webhook ad drops with image/text/CTA payloads
    // while keeping a delivery audit trail.
    (async () => {
      try {
        const { pool: dbPool } = await import('./db');
        await dbPool.query(`
          CREATE TABLE IF NOT EXISTS marketing_webhook_campaigns (
            id VARCHAR PRIMARY KEY,
            campaign_name TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            area TEXT,
            focus TEXT,
            audience TEXT,
            image_url TEXT,
            cta_url TEXT,
            cta_label TEXT,
            promo_code TEXT,
            rep_slug TEXT,
            source TEXT NOT NULL DEFAULT 'admin_marketing_webhook',
            actor_id VARCHAR,
            scheduled_for TIMESTAMPTZ,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE TABLE IF NOT EXISTS marketing_webhook_deliveries (
            id SERIAL PRIMARY KEY,
            campaign_id VARCHAR NOT NULL REFERENCES marketing_webhook_campaigns(id) ON DELETE CASCADE,
            webhook_url_hash TEXT NOT NULL,
            status TEXT NOT NULL,
            response_status INTEGER,
            error_message TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_marketing_webhook_campaigns_created
            ON marketing_webhook_campaigns(created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_marketing_webhook_campaigns_area_focus
            ON marketing_webhook_campaigns(area, focus);
          CREATE INDEX IF NOT EXISTS idx_marketing_webhook_deliveries_campaign
            ON marketing_webhook_deliveries(campaign_id);
        `);
        console.log('Marketing webhook reminder tables ready');
      } catch (e) { console.error('marketing webhook reminder table init error:', e); }
    })();

    // Initialize server with comprehensive error handling
    console.log('Initializing application server...');
    // Operational notifications need a delivery audit separate from the
    // in-app notification row. This exposes missing push setup, retries, and
    // provider failures instead of silently treating every alert as sent.
    {
      const { pool: dbPool } = await import('./db');
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS job_alert_deliveries (
          id BIGSERIAL PRIMARY KEY,
          event_id TEXT NOT NULL,
          lead_id VARCHAR NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
          recipient_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
          channel TEXT NOT NULL CHECK (channel IN ('in_app', 'push', 'email', 'sms', 'webhook')),
          status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
          error_message TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          attempts INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (event_id, recipient_user_id, channel)
        );
        ALTER TABLE job_alert_deliveries ALTER COLUMN lead_id DROP NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_job_alert_deliveries_lead_created
          ON job_alert_deliveries(lead_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS job_webhook_deliveries (
          id BIGSERIAL PRIMARY KEY,
          event_id TEXT NOT NULL,
          lead_id VARCHAR REFERENCES leads(id) ON DELETE CASCADE,
          webhook_url_hash TEXT NOT NULL,
          provider TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
          response_status INTEGER,
          error_message TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          attempts INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (event_id, webhook_url_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_job_webhook_deliveries_lead_created
          ON job_webhook_deliveries(lead_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_job_webhook_deliveries_status_updated
          ON job_webhook_deliveries(status, updated_at DESC);
      `);
      console.log('Job alert delivery audit table ready');
    }
    const { registerRoutes } = await import('./routes');
    await registerRoutes(app, server);
    const { createJcOperationsRouter } = await import('./routes/jcOperations');
    const { ensureJcOperationsInfrastructure } = await import('./services/jcOperations');
    await ensureJcOperationsInfrastructure();
    app.use('/api', createJcOperationsRouter());
    console.log('Application routes registered successfully');

    // Opt-in only after canonical ledger migration and owner acceptance.
    if (process.env.JOB_PAYMENT_LEDGER_ENABLED === "true"
        && process.env.JOB_PAYMENT_REWARDS_ENABLED === "true"
        && process.env.JOB_PAYMENT_REWARD_WORKER_ENABLED === "true") {
      let rewardTickRunning = false;
      const rewardTick = async () => {
        if (rewardTickRunning) return;
        rewardTickRunning = true;
        try {
          const { enqueueCompletedPaidJobs, processOneJobReward } = await import('./services/jobRewardWorker');
          await enqueueCompletedPaidJobs();
          for (let count = 0; count < 10; count++) {
            const result = await processOneJobReward();
            if (result.status === 'idle' || result.status === 'disabled') break;
          }
        } catch {
          console.error('[job-rewards] queue sweep failed; durable claims will retry');
        } finally { rewardTickRunning = false; }
      };
      setTimeout(rewardTick, 15_000);
      setInterval(rewardTick, 60_000);
    }

    // Lead-response safety net. The sweep is idempotent and guarded by a
    // Postgres advisory lock, so multiple Railway instances cannot deliver
    // the same 24-hour reminder or 48-hour red flag twice.
    if (process.env.JC_LEAD_SAFETY_SWEEP_ENABLED !== "false") {
      const LEAD_SAFETY_INTERVAL_MS = 15 * 60 * 1000;
      const tick = async () => {
        try {
          const { runLeadSafetySweep } = await import('./services/jcOperations');
          const result = await runLeadSafetySweep();
          if (!result.skipped && (result.reminders || result.redFlags)) {
            console.log(`[lead-safety] reminders=${result.reminders} redFlags=${result.redFlags}`);
          }
        } catch (error) {
          console.error('[lead-safety] sweep failed:', error);
        }
      };
      setTimeout(tick, 30_000);
      setInterval(tick, LEAD_SAFETY_INTERVAL_MS);
      console.log(' Lead safety sweep scheduled (every 15 min)');
    }

    // Square eGift purchase bonuses remain pending for 14 days, then become
    // spendable. The database advisory lock inside the sweep keeps multiple
    // Railway instances from crediting the same reward concurrently.
    if (process.env.GIFT_CARD_BONUS_ENABLED === "true") {
      const GIFT_BONUS_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
      const tick = async () => {
        try {
          const { runGiftCardBonusSweep } = await import("./services/giftCardBonuses");
          const result = await runGiftCardBonusSweep();
          if (result.assigned || result.fellBack || result.released) {
            console.log(`[gift-card-bonus] assigned=${result.assigned} fallback=${result.fellBack} released=${result.released}`);
          }
        } catch (error) {
          console.error("[gift-card-bonus] sweep error:", error);
        }
      };
      setTimeout(tick, 90_000);
      setInterval(tick, GIFT_BONUS_SWEEP_INTERVAL_MS);
      console.log("✅ Gift-card bonus sweep scheduled (every 15 min)");
    }

    // Handmade Jewels by Ashley automation. All AI-created catalog content
    // remains a draft until Ashley sets a final price and approves it.
    if (process.env.ASHLEY_SHOP_AUTOMATION_ENABLED !== "false") {
      const featureTick = async () => {
        if (process.env.ASHLEY_SHOP_FEATURED_ENABLED === "false") return;
        try {
          const { ensureDailyFeaturedItem } = await import("./services/ashleyShopFeatured");
          await ensureDailyFeaturedItem();
        } catch (error) {
          console.error("[Ashley shop] featured rotation failed:", error);
        }
      };
      const pipelineTick = async () => {
        try {
          if (process.env.ASHLEY_SHOP_EMAIL_INGEST_ENABLED === "true") {
            const { runAshleyEmailIngest } = await import("./services/ashleyShopEmail");
            await runAshleyEmailIngest();
          }
          const { processNextAshleyBatch } = await import("./services/ashleyShopAi");
          await processNextAshleyBatch();
        } catch (error) {
          console.error("[Ashley shop] intake pipeline failed:", error);
        }
      };
      const commerceTick = async () => {
        try {
          const { sweepExpiredCommerceReservations } = await import("./services/ashleyShopCommerce");
          await sweepExpiredCommerceReservations();
        } catch (error) {
          console.error("[Ashley shop] commerce reservation sweep failed:", error);
        }
      };
      const executiveTick = async () => {
        if (process.env.ASHLEY_SHOP_EXECUTIVE_ENABLED === "false") return;
        try {
          const { runAshleyExecutiveDigest } = await import("./services/ashleyShopExecutive");
          await runAshleyExecutiveDigest("daily");
          await runAshleyExecutiveDigest("weekly");
        } catch (error) {
          console.error("[Ashley shop] executive digest failed:", error);
        }
      };
      setTimeout(featureTick, 15_000);
      setInterval(featureTick, 5 * 60_000);
      setTimeout(pipelineTick, 30_000);
      setInterval(pipelineTick, 2 * 60_000);
      setTimeout(commerceTick, 60_000);
      setInterval(commerceTick, 5 * 60_000);
      setTimeout(executiveTick, 90_000);
      setInterval(executiveTick, 60 * 60_000);
      console.log("Handmade Jewels by Ashley automation scheduled");
    }

    // Task #175 — mount the consolidated payment + launch-checklist routes.
    {
      const { default: paymentsRouter } = await import('./routes/payments-task175');
      app.use('/api', paymentsRouter);
      console.log('✅ Task #175 payment routes mounted');
    }

    // Task #169 — Deprecated booking entry points redirect to the unified
    // /book front door (server-side, before Vite's SPA catch-all). The
    // worker-facing flows preserve the worker mode flag.
    app.get('/post-job', (req: Request, res: Response) => {
      // /post-job is the historical generic deep-link, so it redirects to
      // the unified /book front door. Worker mode is opt-in via explicit
      // ?worker=1 (preserved from the query string). Worker-facing UI
      // buttons already include &worker=1 in their hrefs.
      const qs = new URLSearchParams(req.query as Record<string, string>);
      const tail = qs.toString();
      res.redirect(301, `/book${tail ? `?${tail}` : ''}`);
    });
    app.get('/packages', (req: Request, res: Response) => {
      const qs = new URLSearchParams(req.query as Record<string, string>);
      const tail = qs.toString();
      res.redirect(301, `/book${tail ? `?${tail}` : ''}`);
    });
    app.get('/employee/add-job', (req: Request, res: Response) => {
      const qs = new URLSearchParams(req.query as Record<string, string>);
      qs.set('worker', '1');
      res.redirect(301, `/book?${qs.toString()}`);
    });

    // Ensure idempotency_keys table exists (extra durability layer for reward ops)
    (async () => {
      try {
        const { pool: dbPool } = await import('./db');
        await dbPool.query(`
          CREATE TABLE IF NOT EXISTS idempotency_keys (
            id         SERIAL PRIMARY KEY,
            key        TEXT NOT NULL UNIQUE,
            scope      TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        console.log('✅ idempotency_keys table ready');
      } catch (e) { console.error('idempotency_keys table init error:', e); }
    })();

    // Crew dispatch columns on leads
    (async () => {
      try {
        const { pool: dbPool } = await import('./db');
        await dbPool.query(`
          ALTER TABLE leads
            ADD COLUMN IF NOT EXISTS dispatch_sent_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS dispatch_notes   TEXT
        `);
        console.log('✅ Crew dispatch columns ready');
      } catch (e) { console.error('dispatch columns init error:', e); }
    })();

    // Task #130/#141: per-child booking lifecycle columns. Production rows
    // were missing these so booking inserts 500'd. Self-heal on boot so a
    // fresh deploy doesn't require a manual migration.
    (async () => {
      try {
        const { pool: dbPool } = await import('./db');
        await dbPool.query(`
          ALTER TABLE booking_service_items
            ADD COLUMN IF NOT EXISTS status               TEXT NOT NULL DEFAULT 'pending',
            ADD COLUMN IF NOT EXISTS assigned_to_user_id  VARCHAR,
            ADD COLUMN IF NOT EXISTS crew_members         TEXT[] DEFAULT ARRAY[]::TEXT[],
            ADD COLUMN IF NOT EXISTS notes                TEXT,
            ADD COLUMN IF NOT EXISTS scheduled_at         TIMESTAMP,
            ADD COLUMN IF NOT EXISTS completed_at         TIMESTAMP
        `);
        console.log('✅ booking_service_items lifecycle columns ready');
      } catch (e) { console.error('booking_service_items columns init error:', e); }
    })();

    // Seed the rewards marketplace catalog (idempotent)
    const { seedRewardShop } = await import('./seed-reward-shop');
    seedRewardShop().catch(e => console.error("Reward shop seed error:", e));

    // Live migration: update mover prices + insert new service-credit items
    (async () => {
      try {
        const { db } = await import('./db');
        const { pool: migPool } = await import('./db');
        const { rewardItems, rewardCategories } = await import('@shared/schema');
        const { eq } = await import('drizzle-orm');

        // (a) Rename legacy "Free 2 Movers · 2 Hours (Local)" → canonical name and ensure price is 100 000
        await migPool.query(`
          UPDATE reward_items
          SET name = '2 Movers · 2 Hours (Local)', token_price = 100000, updated_at = NOW()
          WHERE name IN ('Free 2 Movers · 2 Hours (Local)', '2 Movers · 2 Hours (Local)')
        `);

        // (b) Insert "2 Movers · 1 Hour (Local)" at 60 000 if it does not yet exist
        await migPool.query(`
          INSERT INTO reward_items
            (name, category_id, short_desc, full_desc, token_price, cash_value, status, featured,
             delivery_type, requires_approval, requires_schedule, expiration_days, promo_badge,
             fulfillment_note, admin_notes)
          SELECT
            '2 Movers · 1 Hour (Local)',
            id,
            '2 professional movers for 1 hour — local jobs only',
            'Redeem 60,000 JCMOVES for 2 professional movers for 1 hour on a local job. Admin will contact you to confirm the date and details.',
            60000, '85.00', 'active', false,
            'service_credit', true, true, 365, null,
            'Admin will reach out to schedule your 2-mover / 1-hour local job.',
            '2 movers, 1 hour local. Confirm date and logistics with customer. Approval required.'
          FROM reward_categories
          WHERE name = '🛠️ Service Credits'
          AND NOT EXISTS (
            SELECT 1 FROM reward_items WHERE name = '2 Movers · 1 Hour (Local)'
          )
          LIMIT 1
        `);
        console.log('✅ Mover items migrated (2 Movers · 1 Hr + 2 Movers · 2 Hr)');

        // (b) Find the 🛠️ Service Credits category id
        const [serviceCredits] = await db.select({ id: rewardCategories.id })
          .from(rewardCategories)
          .where(eq(rewardCategories.name, '🛠️ Service Credits'));

        if (serviceCredits) {
          const catId = serviceCredits.id;

          const newItems: InsertRewardItem[] = [
            {
              name: '10-Window Wash — Free Session',
              categoryId: catId,
              shortDesc: 'One residential window-cleaning session, up to 10 windows',
              fullDesc: 'Redeem 50,000 JCMOVES for a free residential window-cleaning session covering up to 10 windows. Admin schedules the appointment and will reach out to confirm a date that works for you.',
              tokenPrice: 50000,
              cashValue: '150.00',
              status: 'active',
              featured: false,
              deliveryType: 'service_credit',
              requiresApproval: true,
              requiresSchedule: true,
              expirationDays: 365,
              promoBadge: null,
              fulfillmentNote: 'Admin will contact you to schedule your window-cleaning session (up to 10 windows). Approval required before scheduling.',
              adminNotes: 'Schedule 10-window residential wash. Confirm date with customer before booking. Approval required.',
            },
            {
              name: '1 Month of Trash Valet — Free',
              categoryId: catId,
              shortDesc: 'One free month of weekly door-step trash pickup',
              fullDesc: 'Redeem 30,000 JCMOVES for one free month of our weekly door-step trash valet subscription. Admin applies the credit directly to your subscription — no hassle, just show up at your door.',
              tokenPrice: 30000,
              cashValue: '79.99',
              status: 'active',
              featured: false,
              deliveryType: 'service_credit',
              createsInvoiceCredit: true,
              requiresApproval: true,
              expirationDays: 365,
              promoBadge: null,
              fulfillmentNote: 'Admin will apply a one-month subscription credit to your trash valet account within 24 hours.',
              adminNotes: 'Apply 1-month trash valet subscription credit to customer account. Confirm with redemption ID.',
            },
            {
              name: 'Handyman Deposit — Long Distance or 2× Local',
              categoryId: catId,
              shortDesc: '$150 deposit credit toward one long-distance or two local handyman jobs',
              fullDesc: 'Redeem 50,000 JCMOVES for a $150 deposit credit redeemable toward one long-distance handyman call or two separate local handyman jobs. Credit expires 6 months from redemption date.',
              tokenPrice: 50000,
              cashValue: '150.00',
              status: 'active',
              featured: false,
              deliveryType: 'service_credit',
              createsInvoiceCredit: true,
              requiresSchedule: true,
              expirationDays: 180,
              promoBadge: null,
              fulfillmentNote: '$150 deposit credit applied toward your handyman job(s). Valid 6 months — covers one long-distance job or two local jobs.',
              adminNotes: 'Apply $150 handyman deposit credit. Usable for 1 long-distance job or 2 local jobs. Expires 6 months from redemption. Reference redemption ID.',
            },
            {
              name: 'Tiny Junk Removal ≤ 300 lbs (Local)',
              categoryId: catId,
              shortDesc: 'One local small-load junk haul, up to ~300 lbs',
              fullDesc: 'Redeem 60,000 JCMOVES for one local small-load junk removal job — up to approximately 300 lbs. Excludes refrigerators, mattresses, TVs, and tires. Admin confirms the load details before scheduling.',
              tokenPrice: 60000,
              cashValue: '150.00',
              status: 'active',
              featured: false,
              deliveryType: 'service_credit',
              requiresApproval: true,
              requiresSchedule: true,
              expirationDays: 365,
              promoBadge: null,
              fulfillmentNote: 'Admin will confirm your junk load details before scheduling. Excludes refrigerators, mattresses, TVs, and tires. Local area only.',
              adminNotes: 'Small junk removal, max ~300 lbs. CONFIRM load contents before scheduling — no fridges, mattresses, TVs, or tires. Local only. Admin approval required.',
            },
          ];

          for (const item of newItems) {
            const [existing] = await db.select({ id: rewardItems.id })
              .from(rewardItems)
              .where(eq(rewardItems.name, item.name));
            if (!existing) {
              await db.insert(rewardItems).values(item);
              console.log(`✅ Inserted new reward item: ${item.name}`);
            } else {
              console.log(`ℹ️  Reward item already exists, skipping: ${item.name}`);
            }
          }
        } else {
          console.warn('⚠️  Service Credits category not found — skipping new item migration');
        }

        console.log('✅ Reward shop migration complete');

        // Normalize any legacy items whose token_price is not a multiple of 500
        // (rounds up to the nearest 500-increment so redemptions don't hard-fail)
        const { pool: normPool } = await import('./db');
        await normPool.query(`
          UPDATE reward_items
          SET token_price = CEIL(token_price::numeric / 500) * 500,
              sale_price_tokens = CASE
                WHEN sale_price_tokens IS NOT NULL AND sale_price_tokens > 0
                     AND MOD(sale_price_tokens, 500) != 0
                THEN CEIL(sale_price_tokens::numeric / 500) * 500
                ELSE sale_price_tokens
              END,
              updated_at = NOW()
          WHERE (token_price > 0 AND MOD(token_price, 500) != 0)
             OR (sale_price_tokens IS NOT NULL AND sale_price_tokens > 0 AND MOD(sale_price_tokens, 500) != 0)
        `);
      } catch (err) {
        console.error('⚠️  Reward shop migration error (non-fatal):', err);
      }
    })();

    // ── Generic service re-book reminders table (snow/junk/window) ──────────
    // Created at boot to mirror the other lightweight infra tables in this
    // file. Kept in code (not just drizzle migrations) so a fresh deploy
    // always has it.
    (async () => {
      try {
        const { pool: dbPool } = await import('./db');
        await dbPool.query(`
          CREATE TABLE IF NOT EXISTS service_rebook_reminders (
            id          SERIAL PRIMARY KEY,
            service_key TEXT NOT NULL,
            lead_id     VARCHAR NOT NULL REFERENCES leads(id),
            sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            status      TEXT NOT NULL DEFAULT 'sent'
          );
          CREATE INDEX IF NOT EXISTS idx_svc_rebook_service_sent
            ON service_rebook_reminders(service_key, sent_at);
          CREATE INDEX IF NOT EXISTS idx_svc_rebook_lead
            ON service_rebook_reminders(lead_id);
        `);
        console.log('✅ service_rebook_reminders table ready');
      } catch (e) { console.error('service_rebook_reminders table init error:', e); }
    })();

    // ── Lead Funnel Alerts table (Task #196) ────────────────────────────────
    // Tracks open/resolved "no quote submissions in the last hour" alerts so
    // the admin dashboard banner survives restarts and we never email twice
    // for the same outage. Self-heals on every boot.
    (async () => {
      try {
        const { pool: dbPool } = await import('./db');
        await dbPool.query(`
          CREATE TABLE IF NOT EXISTS lead_funnel_alerts (
            id              SERIAL PRIMARY KEY,
            started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            resolved_at     TIMESTAMPTZ,
            last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            window_minutes  INTEGER NOT NULL,
            previous_count  INTEGER NOT NULL,
            email_sent_at   TIMESTAMPTZ
          );
          CREATE INDEX IF NOT EXISTS idx_lead_funnel_alerts_open
            ON lead_funnel_alerts(resolved_at) WHERE resolved_at IS NULL;
        `);
        console.log('✅ lead_funnel_alerts table ready');
      } catch (e) { console.error('lead_funnel_alerts table init error:', e); }
    })();

    // ── Lead Funnel Monitor (Task #196) ─────────────────────────────────────
    // Watches the rolling rate of customer quote submissions so a Mercer-style
    // outage (which sat unnoticed for 14 days) can never happen again. Set
    // DISABLE_LEAD_FUNNEL_MONITOR=true to turn it off.
    if (process.env.DISABLE_LEAD_FUNNEL_MONITOR !== "true") {
      const CHECK_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes
      const tick = async () => {
        try {
          const { runLeadFunnelCheck } = await import("./services/leadFunnelMonitor");
          const result = await runLeadFunnelCheck();
          if (result.alertOpened) {
            console.warn(`[lead-funnel-monitor] OPENED — window=${result.windowMinutes}min current=0 previous=${result.previous} emailSent=${result.emailSent}`);
          } else if (result.alertResolved) {
            console.log(`[lead-funnel-monitor] resolved — window=${result.windowMinutes}min current=${result.current}`);
          }
        } catch (err) {
          console.error("[lead-funnel-monitor] tick error:", err);
        }
      };
      // First run 5 min after boot so the app has time to settle, then
      // every 15 min.
      setTimeout(tick, 5 * 60 * 1000);
      setInterval(tick, CHECK_INTERVAL_MS);
      console.log("✅ Lead funnel monitor scheduled (every 15 min)");
    } else {
      console.log("ℹ️  Lead funnel monitor disabled (DISABLE_LEAD_FUNNEL_MONITOR=true)");
    }

    // ── Daily Lawn Care Re-book Reminder Sweep ──────────────────────────────
    // Off by default. Set ENABLE_REBOOK_REMINDER_EMAILS=true to enable.
    if (process.env.ENABLE_REBOOK_REMINDER_EMAILS === "true") {
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      const runSweep = async () => {
        try {
          const { runRebookReminderSweep } = await import("./services/lawnCareRebookReminder");
          const result = await runRebookReminderSweep();
          console.log(`[rebook-reminder] sweep complete — attempted=${result.attempted} sent=${result.sent} failed=${result.failed}`);
          if (result.failures.length) {
            console.warn(`[rebook-reminder] failures:`, result.failures);
          }
        } catch (err) {
          console.error("[rebook-reminder] sweep error:", err);
        }
      };
      // Run once 60s after boot, then every 24h.
      setTimeout(runSweep, 60_000);
      setInterval(runSweep, ONE_DAY_MS);
      console.log("✅ Lawn care re-book reminder sweep scheduled (daily)");
    } else {
      console.log("ℹ️  Lawn care re-book reminder sweep disabled (set ENABLE_REBOOK_REMINDER_EMAILS=true to enable)");
    }

    // ── Daily Re-book Reminder Sweeps for Snow / Junk / Window Cleaning ─────
    // Each service has its own env flag so they can be staged independently
    // (e.g. enable snow first, watch results, enable the others). All share
    // the generic engine and a per-service Postgres advisory lock, so a
    // manual admin "Send Now" can never collide with the daily tick.
    {
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      const { SERVICE_CONFIGS, runRebookSweep } = await import("./services/serviceRebookReminder");
      // Stagger the per-service first runs by 30s so logs are easier to
      // read and we don't open three pool connections at the same instant.
      let offset = 90_000;
      for (const cfg of Object.values(SERVICE_CONFIGS)) {
        if (process.env[cfg.schedulerEnvFlag] !== "true") {
          console.log(`  ${cfg.label} re-book reminder sweep disabled (set ${cfg.schedulerEnvFlag}=true to enable)`);
          continue;
        }
        const tick = async () => {
          try {
            const result = await runRebookSweep(cfg, undefined, "scheduler");
            console.log(`[rebook-reminder:${cfg.key}] sweep complete — attempted=${result.attempted} sent=${result.sent} failed=${result.failed}`);
            if (result.failures.length) {
              console.warn(`[rebook-reminder:${cfg.key}] failures:`, result.failures);
            }
          } catch (err) {
            console.error(`[rebook-reminder:${cfg.key}] sweep error:`, err);
          }
        };
        setTimeout(tick, offset);
        setInterval(tick, ONE_DAY_MS);
        console.log(` ${cfg.label} re-book reminder sweep scheduled (daily)`);
        offset += 30_000;
      }
    }

    // ── Jewelry Reservation Expiry Sweeper (Task #151) ─────────────────────
    // Releases jewelry items whose pending_balance hold has elapsed (set by
    // /api/wallet/redeem-balance partial credit + Square checkout in
    // Task #147). Refunds the held JCMOVES USD back to the customer's
    // wallet so abandoned carts don't strand inventory or credit.
    {
      const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes
      const tick = async () => {
        try {
          const { runJewelryReservationSweep } = await import("./services/jewelryReservationSweeper");
          const result = await runJewelryReservationSweep();
          if (!result) {
            console.log("[jewelry-expiry-sweep] skipped — previous run still in progress");
            return;
          }
          if (result.scanned > 0 || result.released > 0) {
            console.log(
              `[jewelry-expiry-sweep] scanned=${result.scanned} released=${result.released} refundedUsd=$${result.refundedUsdTotal.toFixed(2)}`,
            );
          }
          if (result.failures.length) {
            console.warn(`[jewelry-expiry-sweep] failures:`, result.failures);
          }
        } catch (err) {
          console.error("[jewelry-expiry-sweep] error:", err);
        }
      };
      // First run 2 min after boot, then every 10 minutes.
      setTimeout(tick, 120_000);
      setInterval(tick, SWEEP_INTERVAL_MS);
      console.log(" Jewelry reservation expiry sweep scheduled (every 10 min)");
    }

    // ── Bitcoin Payment Auto-Verify Sweeper (Task #155) ─────────────────────
    // Polls mempool.space for incoming sends to BTC_WALLET_ADDRESS and
    // auto-verifies any pending bitcoin_payment whose btcAmount matches an
    // on-chain deposit with >= MIN_CONFIRMATIONS confirmations. This finalizes
    // jewelry pending_balance holds and credits rewards without admin action,
    // so customers stop losing their hold while waiting on slow verification.
    if (process.env.BTC_WALLET_ADDRESS) {
      const BTC_SWEEP_INTERVAL_MS = 2 * 60 * 1000; // every 2 minutes
      const tick = async () => {
        try {
          const { runBitcoinPaymentSweep } = await import("./services/bitcoinPaymentVerifier");
          const result = await runBitcoinPaymentSweep();
          if (!result) {
            console.log("[btc-auto-verify] skipped — previous run still in progress");
            return;
          }
          if (result.scanned > 0 || result.verified > 0) {
            console.log(`[btc-auto-verify] scanned=${result.scanned} verified=${result.verified}`);
          }
          if (result.failures.length) {
            console.warn(`[btc-auto-verify] failures:`, result.failures);
          }
        } catch (err) {
          console.error("[btc-auto-verify] error:", err);
        }
      };
      setTimeout(tick, 90_000);
      setInterval(tick, BTC_SWEEP_INTERVAL_MS);
      console.log(" Bitcoin payment auto-verify sweep scheduled (every 2 min)");
    } else {
      console.log("  BTC_WALLET_ADDRESS not set — Bitcoin auto-verify sweep disabled");
    }

    // Serve static files from attached_assets directory with proper video support
    app.use('/attached_assets', express.static(path.resolve(process.cwd(), 'attached_assets'), {
      setHeaders: (res, filePath) => {
        // Set proper MIME types and caching for video files
        if (filePath.endsWith('.mp4')) {
          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
        } else if (filePath.endsWith('.webm')) {
          res.setHeader('Content-Type', 'video/webm');
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Cache-Control', 'public, max-age=31536000');
        }
      }
    }));

    // Serve video files from workspace root with proper MIME types
    app.get('/*.mp4', (req, res) => {
      const videoPath = path.resolve(process.cwd(), req.path.substring(1));
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.sendFile(videoPath);
    });

    // Serve specific static HTML files from client/public (dev) or dist/public (prod)
    app.get('/structure-review.html', (_req, res) => {
      const devPath = path.resolve(process.cwd(), 'client/public/structure-review.html');
      const prodPath = path.resolve(process.cwd(), 'dist/public/structure-review.html');
      const filePath = fs.existsSync(devPath) ? devPath : prodPath;
      res.setHeader('Content-Type', 'text/html');
      res.sendFile(filePath);
    });

    // Setup Vite for development or serve static files for production
    const { setupVite, serveStatic } = await import("./vite");
    if (app.get("env") === "development") {
      console.log('Setting up Vite development server...');
      await setupVite(app, server);
      console.log('Vite development server configured successfully');
    } else {
      console.log('Configuring static file serving for production...');
      serveStatic(app);
      console.log('Static file serving configured successfully');
    }

    // Error handling middleware should be last to catch all errors
    app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      // If headers are already sent, pass to default Express error handler
      if (res.headersSent) {
        return next(err);
      }

      const status = err.status || err.statusCode || 500;
      
      // Sanitize error messages for production 5xx errors
      let message: string;
      if (status >= 500 && process.env.NODE_ENV === "production") {
        message = "Internal Server Error";
      } else {
        message = err.message || "Internal Server Error";
      }

      // Log the error for debugging and monitoring
      console.error(`Error ${status} on ${req.method} ${req.path}:`, err.message);
      
      // In development, log the full stack trace
      if (process.env.NODE_ENV === "development") {
        console.error("Full error stack:", err.stack);
      }

      res.status(status).json({ message });
    });

    console.log('JC ON THE MOVE application started successfully');
    boot.status = "ready";
    boot.readyAt = new Date().toISOString();

} catch (error) {
  boot.status = "failed";
  boot.error = error instanceof Error ? error.message : String(error);
  console.error('Failed to initialize JC ON THE MOVE application:');
  console.error('Error details:', error);

  if (process.env.NODE_ENV === 'production') {
    console.error('Application bootstrap failed in production after the HTTP listener started.');
    console.error('Keeping the listener alive so platform liveness checks can still reach /health.');
  } else {
    process.exit(1);
  }
}

// close the async IIFE
})();

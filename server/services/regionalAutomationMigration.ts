import { pool } from "../db";
import { ensureQuoteRevisionInfrastructure } from "./quoteRevisions";

let migrationPromise: Promise<void> | null = null;

export function ensureRegionalAutomationSchema(): Promise<void> {
  if (migrationPromise) return migrationPromise;
  migrationPromise = ensureQuoteRevisionInfrastructure().then(runMigration).catch((error) => {
    migrationPromise = null;
    throw error;
  });
  return migrationPromise;
}

async function runMigration(): Promise<void> {
  await pool.query(`
    ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS financial_status TEXT NOT NULL DEFAULT 'quote',
      ADD COLUMN IF NOT EXISTS final_balance_amount NUMERIC(10,2),
      ADD COLUMN IF NOT EXISTS final_invoice_url TEXT,
      ADD COLUMN IF NOT EXISTS closeout_status TEXT;

    ALTER TABLE square_invoices
      ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'legacy_unknown',
      ADD COLUMN IF NOT EXISTS quote_revision_id VARCHAR,
      ADD COLUMN IF NOT EXISTS closeout_id VARCHAR;

    CREATE INDEX IF NOT EXISTS idx_square_invoices_purpose
      ON square_invoices(lead_id, purpose, created_at DESC);

    CREATE TABLE IF NOT EXISTS service_area_capabilities (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      state_code TEXT NOT NULL,
      locality TEXT,
      route_day_code TEXT,
      pricing_zone_code TEXT,
      service_types TEXT[] NOT NULL DEFAULT ARRAY['moving','labor','junk']::text[],
      truck_modes TEXT[] NOT NULL DEFAULT ARRAY['jc_on_the_move','customer','rental','none']::text[],
      verification_status TEXT NOT NULL DEFAULT 'pending',
      auto_book_enabled BOOLEAN NOT NULL DEFAULT false,
      ads_enabled BOOLEAN NOT NULL DEFAULT false,
      verified_at TIMESTAMPTZ,
      verified_by_user_id VARCHAR REFERENCES users(id),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_service_area_capabilities_lookup
      ON service_area_capabilities(state_code, lower(locality), verification_status);

    CREATE TABLE IF NOT EXISTS job_agreements (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id VARCHAR NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      quote_revision_id VARCHAR REFERENCES quote_revisions(id),
      terms_version TEXT NOT NULL,
      terms_hash TEXT NOT NULL,
      acceptance_method TEXT NOT NULL DEFAULT 'web_checkbox',
      accepted_by_user_id VARCHAR REFERENCES users(id),
      acceptance_token_id TEXT,
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(lead_id, quote_revision_id, terms_hash)
    );
    ALTER TABLE job_agreements
      ADD COLUMN IF NOT EXISTS accepted_by_name TEXT,
      ADD COLUMN IF NOT EXISTS acceptance_evidence JSONB NOT NULL DEFAULT '{}'::jsonb;

    CREATE TABLE IF NOT EXISTS dispatch_offers (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id VARCHAR NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      slot_key TEXT NOT NULL,
      role_on_job TEXT NOT NULL,
      requires_driver BOOLEAN NOT NULL DEFAULT false,
      worker_id VARCHAR NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'offered',
      score INTEGER NOT NULL DEFAULT 0,
      distance_miles NUMERIC(10,2),
      reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
      expires_at TIMESTAMPTZ NOT NULL,
      responded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(lead_id, slot_key, worker_id)
    );
    CREATE INDEX IF NOT EXISTS idx_dispatch_offers_active
      ON dispatch_offers(lead_id, status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_dispatch_offers_worker
      ON dispatch_offers(worker_id, status, expires_at);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_dispatch_offers_one_active_per_job
      ON dispatch_offers(lead_id) WHERE status='offered';

    CREATE TABLE IF NOT EXISTS job_closeouts (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id VARCHAR NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'draft',
      submitted_by_user_id VARCHAR REFERENCES users(id),
      actual_start_at TIMESTAMPTZ,
      actual_end_at TIMESTAMPTZ,
      break_minutes INTEGER NOT NULL DEFAULT 0,
      actual_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
      proof_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
      exception_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
      crew_notes TEXT,
      pricing_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      quoted_total NUMERIC(10,2) NOT NULL DEFAULT 0,
      calculated_final_total NUMERIC(10,2) NOT NULL DEFAULT 0,
      deposit_applied NUMERIC(10,2) NOT NULL DEFAULT 0,
      credits_applied NUMERIC(10,2) NOT NULL DEFAULT 0,
      balance_due NUMERIC(10,2) NOT NULL DEFAULT 0,
      customer_token_hash TEXT,
      customer_token_expires_at TIMESTAMPTZ,
      customer_approved_at TIMESTAMPTZ,
      customer_rejected_at TIMESTAMPTZ,
      reviewed_by_user_id VARCHAR REFERENCES users(id),
      reviewed_at TIMESTAMPTZ,
      square_invoice_id VARCHAR,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_job_closeouts_status ON job_closeouts(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS job_change_orders (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      closeout_id VARCHAR NOT NULL REFERENCES job_closeouts(id) ON DELETE CASCADE,
      lead_id VARCHAR NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      description TEXT NOT NULL,
      quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
      unit_price NUMERIC(10,2) NOT NULL DEFAULT 0,
      total NUMERIC(10,2) NOT NULL DEFAULT 0,
      catalog_backed BOOLEAN NOT NULL DEFAULT true,
      customer_acknowledged_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'submitted',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_job_change_orders_closeout ON job_change_orders(closeout_id);

    CREATE TABLE IF NOT EXISTS customer_job_events (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id VARCHAR NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      event_key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_customer_job_events_lead ON customer_job_events(lead_id, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS customer_notification_deliveries (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id VARCHAR NOT NULL REFERENCES customer_job_events(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      destination_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_reference TEXT,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(event_id, channel, destination_hash)
    );

    CREATE TABLE IF NOT EXISTS square_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      square_object_id TEXT,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      last_error TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS square_invoice_payment_effects (
      square_invoice_id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      last_error TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    INSERT INTO service_area_capabilities
      (code, name, state_code, locality, pricing_zone_code, verification_status, auto_book_enabled, ads_enabled, verified_at, notes)
    VALUES
      ('IRONWOOD_50_MILE', 'Ironwood 50-mile service area', 'MI', 'Ironwood', 'IRONWOOD_50_MILE', 'verified', true, true, NOW(), 'Existing primary operating area'),
      ('HOUGHTON_TUESDAY', 'Houghton Tuesday route', 'MI', 'Houghton', 'EXTENDED_SERVICE', 'pending', false, true, NULL, 'Existing scheduled route; verify operating capability before auto-booking'),
      ('IRON_RIVER_WEDNESDAY', 'Iron River Wednesday route', 'MI', 'Iron River', 'EXTENDED_SERVICE', 'pending', false, true, NULL, 'Existing scheduled route; verify operating capability before auto-booking'),
      ('ASHLAND_THURSDAY', 'Ashland Thursday route', 'WI', 'Ashland', 'EXTENDED_SERVICE', 'pending', false, true, NULL, 'Existing scheduled route; verify Wisconsin operating capability before auto-booking'),
      ('MINOCQUA_MONDAY', 'Minocqua Monday route', 'WI', 'Minocqua', 'EXTENDED_SERVICE', 'pending', false, true, NULL, 'Existing scheduled route; verify Wisconsin operating capability before auto-booking'),
      ('EAGLE_RIVER_REGION', 'Eagle River regional service', 'WI', 'Eagle River', 'EXTENDED_SERVICE', 'pending', false, false, NULL, 'Advertising and auto-booking remain paused until operating capability is verified'),
      ('UP_NORTHWOODS_CORRIDOR', 'UP / Northwoods corridor', 'MI', NULL, 'EXTENDED_SERVICE', 'pending', false, false, NULL, 'Broad corridor campaigns remain paused until each promoted service area is verified')
    ON CONFLICT (code) DO NOTHING;
  `);

  console.log("[regional-automation] schema ready");
}

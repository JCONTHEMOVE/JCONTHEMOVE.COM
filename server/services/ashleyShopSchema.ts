import { pool } from "../db";
import { getAshleyShopSetup } from "./ashleyShopPolicy";
import { JEWELRY_RESERVATION_COLUMNS } from "./jewelryReservationSchema";

let schemaPromise: Promise<void> | null = null;

export function ensureAshleyShopSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = initialize().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function initialize(): Promise<void> {
  await pool.query(`
    ${JEWELRY_RESERVATION_COLUMNS}
    ALTER TABLE jewelry_items
      ADD COLUMN IF NOT EXISTS sku TEXT,
      ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS source_batch_id UUID,
      ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved',
      ADD COLUMN IF NOT EXISTS approved_by_user_id VARCHAR,
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_featured_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS ai_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_jewelry_items_sku
      ON jewelry_items (sku) WHERE sku IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_jewelry_items_feature_rotation
      ON jewelry_items (status, in_stock, last_featured_at, created_at);

    CREATE TABLE IF NOT EXISTS ashley_shop_intake_batches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      gmail_message_id TEXT NOT NULL UNIQUE,
      gmail_thread_id TEXT,
      sender_email TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      subject TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      attachment_count INTEGER NOT NULL DEFAULT 0,
      draft_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ashley_shop_media (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      batch_id UUID NOT NULL REFERENCES ashley_shop_intake_batches(id) ON DELETE CASCADE,
      gmail_attachment_id TEXT,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      object_url TEXT NOT NULL,
      thumbnail_url TEXT,
      sha256 TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(batch_id, sha256)
    );

    CREATE TABLE IF NOT EXISTS ashley_shop_listing_drafts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      batch_id UUID NOT NULL REFERENCES ashley_shop_intake_batches(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'draft',
      title TEXT NOT NULL,
      description TEXT,
      short_description TEXT,
      category TEXT,
      materials TEXT,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      suggested_price_min NUMERIC(10,2),
      suggested_price_max NUMERIC(10,2),
      final_price NUMERIC(10,2),
      media_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      confidence NUMERIC(5,4),
      warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
      ai_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      version INTEGER NOT NULL DEFAULT 1,
      final_price_set_by_user_id VARCHAR,
      final_price_set_by_email TEXT,
      final_price_set_at TIMESTAMPTZ,
      approved_by_user_id VARCHAR,
      approved_at TIMESTAMPTZ,
      published_item_id VARCHAR REFERENCES jewelry_items(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_ashley_drafts_batch_status
      ON ashley_shop_listing_drafts(batch_id, status, created_at);

    ALTER TABLE ashley_shop_listing_drafts
      ADD COLUMN IF NOT EXISTS final_price_set_by_user_id VARCHAR,
      ADD COLUMN IF NOT EXISTS final_price_set_by_email TEXT,
      ADD COLUMN IF NOT EXISTS final_price_set_at TIMESTAMPTZ;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_ashley_draft_publish_guard'
      ) THEN
        ALTER TABLE ashley_shop_listing_drafts
          ADD CONSTRAINT ck_ashley_draft_publish_guard CHECK (
            status <> 'published' OR (
              final_price IS NOT NULL AND final_price > 0
              AND final_price_set_by_user_id IS NOT NULL
              AND final_price_set_by_email IS NOT NULL
              AND final_price_set_at IS NOT NULL
              AND approved_by_user_id IS NOT NULL
              AND approved_at IS NOT NULL
              AND published_item_id IS NOT NULL
            )
          ) NOT VALID;
      END IF;
    END $$;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_ashley_item_publish_guard'
      ) THEN
        ALTER TABLE jewelry_items
          ADD CONSTRAINT ck_ashley_item_publish_guard CHECK (
            source_batch_id IS NULL OR (
              price IS NOT NULL AND price > 0
              AND approval_status = 'approved'
              AND approved_by_user_id IS NOT NULL
              AND approved_at IS NOT NULL
              AND published_at IS NOT NULL
            )
          ) NOT VALID;
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS ashley_shop_approval_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      draft_id UUID NOT NULL REFERENCES ashley_shop_listing_drafts(id) ON DELETE CASCADE,
      actor_user_id VARCHAR,
      actor_email TEXT,
      action TEXT NOT NULL,
      previous_snapshot JSONB,
      next_snapshot JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ashley_shop_feature_schedule (
      local_date DATE PRIMARY KEY,
      item_id VARCHAR NOT NULL REFERENCES jewelry_items(id),
      discount_percent INTEGER NOT NULL DEFAULT 5,
      reward_bonus_moves INTEGER NOT NULL DEFAULT 500,
      replaced_item_id VARCHAR,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_ashley_feature_item
      ON ashley_shop_feature_schedule(item_id, local_date DESC);

    CREATE TABLE IF NOT EXISTS commerce_carts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      guest_cart_id UUID UNIQUE,
      user_id VARCHAR,
      status TEXT NOT NULL DEFAULT 'active',
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      merged_from JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_active_user_cart
      ON commerce_carts(user_id) WHERE user_id IS NOT NULL AND status = 'active';

    CREATE TABLE IF NOT EXISTS commerce_orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cart_id UUID REFERENCES commerce_carts(id),
      user_id VARCHAR,
      customer_email TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      status TEXT NOT NULL DEFAULT 'pending_payment',
      fulfillment_method TEXT,
      fulfillment_address TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      subtotal_cents INTEGER NOT NULL,
      discount_cents INTEGER NOT NULL DEFAULT 0,
      shipping_cents INTEGER NOT NULL DEFAULT 0,
      due_now_cents INTEGER NOT NULL,
      pricing_snapshot JSONB NOT NULL,
      square_order_id TEXT UNIQUE,
      square_payment_id TEXT,
      reward_moves INTEGER NOT NULL DEFAULT 0,
      reward_issued_at TIMESTAMPTZ,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_commerce_orders_user_created
      ON commerce_orders(user_id, created_at DESC);
    ALTER TABLE commerce_orders
      ADD COLUMN IF NOT EXISTS payment_rail TEXT NOT NULL DEFAULT 'card',
      ADD COLUMN IF NOT EXISTS crypto_intent_id BIGINT,
      ADD COLUMN IF NOT EXISTS provider_invoice_id TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_orders_crypto_intent
      ON commerce_orders(crypto_intent_id) WHERE crypto_intent_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rewards_ashley_order
      ON rewards(reference_id) WHERE reward_type = 'ashley_shop_purchase';

    CREATE TABLE IF NOT EXISTS commerce_order_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES commerce_orders(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL,
      reference_id TEXT,
      booking_id TEXT,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price_cents INTEGER NOT NULL,
      discount_percent INTEGER NOT NULL DEFAULT 0,
      discount_cents INTEGER NOT NULL DEFAULT 0,
      line_total_cents INTEGER NOT NULL,
      settlement_mode TEXT NOT NULL DEFAULT 'pay_now',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_commerce_order_lines_reference
      ON commerce_order_lines(item_type, reference_id);

    CREATE TABLE IF NOT EXISTS ashley_shop_ai_audit (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      action_type TEXT NOT NULL,
      authority_tier TEXT NOT NULL,
      status TEXT NOT NULL,
      model_id TEXT,
      input_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      output_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      requires_approval BOOLEAN NOT NULL DEFAULT true,
      approved_by_user_id VARCHAR,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(
    `UPDATE users
        SET capabilities = array_append(COALESCE(capabilities, ARRAY[]::text[]), 'shop_owner')
      WHERE lower(email) = lower($1)
        AND NOT ('shop_owner' = ANY(COALESCE(capabilities, ARRAY[]::text[])))`,
    [getAshleyShopSetup().authorizedSender],
  );
}

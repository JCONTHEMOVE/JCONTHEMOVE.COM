import { pool } from "../db";
import { ensureAshleyShopSchema } from "./ashleyShopSchema";
import { COPPER_CUFF_SKU } from "@shared/ashleyCopperPromotion";

// Editorial promotion is separate from the rotating daily discount/reward.
export async function getHighlightedItem() {
  await ensureAshleyShopSchema();
  const result = await pool.query(`
    SELECT * FROM jewelry_items
    WHERE sku = $1 AND featured = true AND status = 'active' AND in_stock = true
      AND approval_status = 'approved' AND COALESCE(quantity, 1) > 0 AND price::numeric > 0
      AND (source_batch_id IS NULL OR (approved_at IS NOT NULL AND published_at IS NOT NULL))
    LIMIT 1`, [COPPER_CUFF_SKU]);
  return result.rows[0] || getDailyFeaturedItem();
}

const FEATURE_LOCK_KEY = 1782202608;

export async function ensureDailyFeaturedItem() {
  await ensureAshleyShopSchema();
  const client = await pool.connect();
  let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [FEATURE_LOCK_KEY]);
    locked = lock.rows[0]?.locked === true;
    if (!locked) return null;

    const result = await client.query(`
      WITH local_day AS (
        SELECT (now() AT TIME ZONE 'America/Chicago')::date AS value
      ), current_pick AS (
        SELECT f.item_id
          FROM ashley_shop_feature_schedule f
          JOIN jewelry_items j ON j.id = f.item_id
          CROSS JOIN local_day d
         WHERE f.local_date = d.value
           AND j.status = 'active'
           AND j.in_stock = true
           AND j.approval_status = 'approved'
           AND (j.source_batch_id IS NULL OR (j.approved_at IS NOT NULL AND j.published_at IS NOT NULL))
           AND COALESCE(j.quantity, 1) > 0
         LIMIT 1
      ), candidate AS (
        SELECT j.id
          FROM jewelry_items j
         WHERE j.status = 'active'
           AND j.in_stock = true
           AND j.approval_status = 'approved'
           AND (j.source_batch_id IS NULL OR (j.approved_at IS NOT NULL AND j.published_at IS NOT NULL))
           AND COALESCE(j.quantity, 1) > 0
           AND j.price IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM current_pick)
         ORDER BY j.last_featured_at ASC NULLS FIRST, j.created_at ASC, j.id ASC
         LIMIT 1
      ), upserted AS (
        INSERT INTO ashley_shop_feature_schedule(local_date, item_id, replaced_item_id)
        SELECT d.value, c.id,
               (SELECT item_id FROM ashley_shop_feature_schedule WHERE local_date = d.value)
          FROM local_day d, candidate c
        ON CONFLICT (local_date) DO UPDATE
          SET item_id = EXCLUDED.item_id,
              replaced_item_id = ashley_shop_feature_schedule.item_id,
              created_at = now()
        RETURNING item_id, local_date, discount_percent, reward_bonus_moves
      ), touched AS (
        UPDATE jewelry_items j
           SET last_featured_at = now()
          FROM upserted u
         WHERE j.id = u.item_id
        RETURNING j.id
      )
      SELECT f.local_date, f.item_id, f.discount_percent, f.reward_bonus_moves,
             j.title, j.price, j.image_url
        FROM ashley_shop_feature_schedule f
        JOIN jewelry_items j ON j.id = f.item_id
       WHERE f.local_date = (now() AT TIME ZONE 'America/Chicago')::date
      LIMIT 1
    `);
    return result.rows[0] || null;
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [FEATURE_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

export async function getDailyFeaturedItem() {
  await ensureDailyFeaturedItem();
  const result = await pool.query(`
    SELECT j.*, f.discount_percent AS "featuredDiscountPercent",
           f.reward_bonus_moves AS "featuredRewardBonusMoves",
           f.local_date AS "featuredDate"
      FROM ashley_shop_feature_schedule f
      JOIN jewelry_items j ON j.id = f.item_id
     WHERE f.local_date = (now() AT TIME ZONE 'America/Chicago')::date
       AND j.status = 'active' AND j.in_stock = true
       AND j.approval_status = 'approved'
       AND (j.source_batch_id IS NULL OR (j.approved_at IS NOT NULL AND j.published_at IS NOT NULL))
     LIMIT 1
  `);
  return result.rows[0] || null;
}

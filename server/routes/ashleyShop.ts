import { randomUUID } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import sharp from "sharp";
import { z } from "zod";
import {
  ashleyBatchApprovalSchema,
  ashleyDraftPatchSchema,
  commerceCartSchema,
  commerceCheckoutSchema,
  commercePreviewSchema,
} from "@shared/ashleyShop";
import { isAuthenticated } from "../auth";
import { pool } from "../db";
import { ObjectStorageService } from "../objectStorage";
import { processAshleyBatch } from "../services/ashleyShopAi";
import { createCommerceCheckout, createCommerceCryptoCheckout, finalizeCommerceOrder, getCommerceOrder } from "../services/ashleyShopCommerce";
import { getAshleyEmailIntakeStatus, runAshleyEmailIngest } from "../services/ashleyShopEmail";
import { getDailyFeaturedItem, getHighlightedItem } from "../services/ashleyShopFeatured";
import { getAshleyShopSetup, isAshleyFinalApprovalActor, validateAshleyDraftPublication } from "../services/ashleyShopPolicy";
import { priceCommerceCart } from "../services/ashleyShopPricing";
import { ensureAshleyShopSchema } from "../services/ashleyShopSchema";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 100 },
  fileFilter: (_req, file, callback) => callback(null, /^image\/(jpeg|png|webp|heic|heif)$/i.test(file.mimetype)),
});

async function optionalIdentity(req: any) {
  let user = req.user || req.currentUser || null;
  const sessionUserId = req.session?.userId;
  if (!user && sessionUserId) {
    const result = await pool.query("SELECT * FROM users WHERE id = $1 LIMIT 1", [sessionUserId]);
    user = result.rows[0] || null;
  }
  return {
    user,
    userId: user?.id || null,
    email: user?.email || null,
    isAdmin: user?.role === "admin" || user?.role === "business_owner",
  };
}

function requireShopOwner(req: any, res: Response, next: NextFunction) {
  const email = String(req.user?.email || "").toLowerCase();
  const authorized = getAshleyShopSetup().authorizedSender;
  const capabilities = Array.isArray(req.user?.capabilities) ? req.user.capabilities : [];
  const allowed = req.user?.role === "admin"
    || req.user?.role === "business_owner"
    || email === authorized
    || capabilities.includes("shop_owner");
  if (!allowed) return res.status(403).json({ error: "Ashley shop owner access is required" });
  next();
}

function requireAshleyFinalApproval(req: any, res: Response, next: NextFunction) {
  if (!isAshleyFinalApprovalActor(req.user?.email)) {
    return res.status(403).json({
      error: "Ashley must sign in with the authorized shop account to set the final price or publish listings",
    });
  }
  next();
}

function sendRouteError(res: Response, error: unknown, fallback: string) {
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message || fallback });
  const message = error instanceof Error ? error.message : fallback;
  const status = /not found/i.test(message) ? 404 : /invalid|expired|unavailable|reserved|sold|choose|enter|book service|final price|reviewed photo|cannot be published/i.test(message) ? 400 : 500;
  return res.status(status).json({ error: message });
}

export async function registerAshleyShopRoutes(app: Express) {
  await ensureAshleyShopSchema();

  app.get("/api/ashley-shop/highlighted", async (_req, res) => {
    try {
      res.json(await getHighlightedItem());
    } catch (error) {
      sendRouteError(res, error, "Failed to load featured piece");
    }
  });

  app.get("/api/ashley-shop/featured", async (_req, res) => {
    try {
      res.json(await getDailyFeaturedItem());
    } catch (error) {
      sendRouteError(res, error, "Failed to load today's featured piece");
    }
  });

  app.post("/api/ashley-shop/concierge", async (req, res) => {
    try {
      const query = z.object({ message: z.string().trim().min(1).max(1_000) }).parse(req.body).message;
      const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length >= 3).slice(0, 8);
      const result = await pool.query(
        `SELECT id, title, short_description, description, price, category, materials, image_url
           FROM jewelry_items
          WHERE status = 'active' AND in_stock = true AND price IS NOT NULL
            AND approval_status = 'approved'
            AND (source_batch_id IS NULL OR (approved_at IS NOT NULL AND published_at IS NOT NULL))
            AND (cardinality($1::text[]) = 0 OR EXISTS (
              SELECT 1 FROM unnest($1::text[]) term
               WHERE lower(concat_ws(' ', title, short_description, description, category, materials)) LIKE '%' || term || '%'
            ))
          ORDER BY featured DESC, created_at DESC
          LIMIT 6`,
        [terms],
      );
      const intro = result.rows.length
        ? "I found these handmade pieces for you. I can suggest them, and you choose what goes into your cart."
        : "I couldn't find an exact match, but Ashley can help with a custom piece. Try a color, material, or jewelry type.";
      res.json({ message: intro, suggestedItems: result.rows, canAutoAdd: false });
    } catch (error) {
      sendRouteError(res, error, "The shop concierge could not answer");
    }
  });

  app.get("/api/ashley-shop/admin/batches", isAuthenticated, requireShopOwner, async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : null;
      const result = await pool.query(
        `SELECT * FROM ashley_shop_intake_batches
          WHERE ($1::text IS NULL OR status = $1)
          ORDER BY received_at DESC LIMIT 100`,
        [status],
      );
      res.json(result.rows);
    } catch (error) {
      sendRouteError(res, error, "Failed to load intake batches");
    }
  });

  app.get("/api/ashley-shop/admin/drafts", isAuthenticated, requireShopOwner, async (req, res) => {
    try {
      const batchId = typeof req.query.batch === "string" ? req.query.batch : null;
      const result = await pool.query(
        `SELECT d.*,
                COALESCE((SELECT json_agg(m ORDER BY m.created_at)
                  FROM ashley_shop_media m WHERE m.id = ANY(
                    SELECT jsonb_array_elements_text(d.media_ids)::uuid
                  )), '[]'::json) AS media
           FROM ashley_shop_listing_drafts d
          WHERE ($1::uuid IS NULL OR d.batch_id = $1)
          ORDER BY d.created_at DESC LIMIT 500`,
        [batchId],
      );
      res.json(result.rows);
    } catch (error) {
      sendRouteError(res, error, "Failed to load listing drafts");
    }
  });

  app.get("/api/ashley-shop/admin/setup-status", isAuthenticated, requireShopOwner, async (req: any, res) => {
    try {
      const status = await getAshleyEmailIntakeStatus({ verifyConnection: true });
      res.json({
        ...status,
        currentActor: {
          email: req.user?.email || null,
          canFinalizeAndPublish: isAshleyFinalApprovalActor(req.user?.email),
        },
      });
    } catch (error) {
      sendRouteError(res, error, "Failed to verify Ashley shop setup");
    }
  });

  app.post("/api/ashley-shop/admin/check-inbox", isAuthenticated, requireShopOwner, async (_req, res) => {
    try {
      res.json(await runAshleyEmailIngest());
    } catch (error) {
      sendRouteError(res, error, "Failed to check Ashley's inbox");
    }
  });

  app.patch("/api/ashley-shop/admin/drafts/:id", isAuthenticated, requireShopOwner, async (req: any, res) => {
    try {
      const patch = ashleyDraftPatchSchema.parse(req.body);
      const current = await pool.query("SELECT * FROM ashley_shop_listing_drafts WHERE id = $1", [req.params.id]);
      if (!current.rows[0]) return res.status(404).json({ error: "Draft not found" });
      if (current.rows[0].status === "published") {
        return res.status(409).json({ error: "Published listings must be edited from the live catalog" });
      }
      if (patch.finalPrice !== undefined && !isAshleyFinalApprovalActor(req.user?.email)) {
        return res.status(403).json({ error: "Ashley must sign in with the authorized shop account to set the final price" });
      }
      const finalPriceWasSet = patch.finalPrice !== undefined;
      const updated = await pool.query(
        `UPDATE ashley_shop_listing_drafts SET
           title = COALESCE($2, title), description = COALESCE($3, description),
           short_description = COALESCE($4, short_description), category = COALESCE($5, category),
           materials = COALESCE($6, materials), tags = COALESCE($7::jsonb, tags),
           final_price = COALESCE($8, final_price), status = CASE WHEN COALESCE($8, final_price) > 0 THEN 'ready' ELSE status END,
           final_price_set_by_user_id = CASE WHEN $9::boolean THEN $10 ELSE final_price_set_by_user_id END,
           final_price_set_by_email = CASE WHEN $9::boolean THEN $11 ELSE final_price_set_by_email END,
           final_price_set_at = CASE WHEN $9::boolean THEN now() ELSE final_price_set_at END,
           version = version + 1, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [req.params.id, patch.title, patch.description, patch.shortDescription, patch.category, patch.materials,
          patch.tags ? JSON.stringify(patch.tags) : null, patch.finalPrice, finalPriceWasSet, req.user.id, req.user.email],
      );
      await pool.query(
        `INSERT INTO ashley_shop_approval_events
          (draft_id, actor_user_id, actor_email, action, previous_snapshot, next_snapshot)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
        [req.params.id, req.user.id, req.user.email, finalPriceWasSet ? "final_price_set" : "edited",
          JSON.stringify(current.rows[0]), JSON.stringify(updated.rows[0])],
      );
      res.json(updated.rows[0]);
    } catch (error) {
      sendRouteError(res, error, "Failed to update draft");
    }
  });

  app.post("/api/ashley-shop/admin/drafts/approve", isAuthenticated, requireShopOwner, requireAshleyFinalApproval, async (req: any, res) => {
    const client = await pool.connect();
    try {
      const { draftIds } = ashleyBatchApprovalSchema.parse(req.body);
      await client.query("BEGIN");
      const drafts = await client.query(
        `SELECT * FROM ashley_shop_listing_drafts WHERE id = ANY($1::uuid[]) FOR UPDATE`,
        [draftIds],
      );
      if (drafts.rows.length !== draftIds.length) throw new Error("One or more drafts were not found");
      const invalidDraft = drafts.rows
        .map((draft) => ({ draft, validation: validateAshleyDraftPublication(draft, req.user?.email) }))
        .find(({ validation }) => !validation.ok);
      if (invalidDraft) throw new Error(invalidDraft.validation.errors.join("; "));
      const published: any[] = [];
      for (const draft of drafts.rows) {
        if (draft.status === "published" && draft.published_item_id) {
          published.push({ id: draft.published_item_id, draftId: draft.id, alreadyPublished: true });
          continue;
        }
        const media = await client.query<{ object_url: string }>(
          `SELECT object_url FROM ashley_shop_media
            WHERE id = ANY(SELECT jsonb_array_elements_text($1::jsonb)::uuid)
            ORDER BY created_at`,
          [JSON.stringify(draft.media_ids)],
        );
        const photos = media.rows.map((row) => row.object_url);
        if (!photos.length) throw new Error(`Draft ${draft.id} has no reviewable photos and cannot be published`);
        const item = await client.query(
          `INSERT INTO jewelry_items
            (posted_by, title, description, short_description, price, category, materials, image_url,
             photos, in_stock, quantity, tags, status, source_batch_id, approval_status,
             approved_by_user_id, approved_at, published_at, ai_metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, true, 1, $10::jsonb, 'active',
                   $11, 'approved', $1, now(), now(), $12::jsonb)
           RETURNING *`,
          [req.user.id, draft.title, draft.description, draft.short_description, draft.final_price,
            draft.category, draft.materials, photos[0] || null, JSON.stringify(photos), JSON.stringify(draft.tags || []),
            draft.batch_id, JSON.stringify({ draftId: draft.id, ai: draft.ai_metadata })],
        );
        await client.query(
          `UPDATE ashley_shop_listing_drafts
              SET status = 'published', approved_by_user_id = $2, approved_at = now(),
                  published_item_id = $3, updated_at = now()
            WHERE id = $1`,
          [draft.id, req.user.id, item.rows[0].id],
        );
        await client.query(
          `INSERT INTO ashley_shop_approval_events(draft_id, actor_user_id, actor_email, action, next_snapshot)
           VALUES ($1, $2, $3, 'approved_and_published', $4::jsonb)`,
          [draft.id, req.user.id, req.user.email, JSON.stringify({ itemId: item.rows[0].id, finalPrice: draft.final_price })],
        );
        published.push(item.rows[0]);
      }
      await client.query(
        `UPDATE ashley_shop_intake_batches b SET status = 'approved', updated_at = now()
          WHERE id IN (SELECT DISTINCT batch_id FROM ashley_shop_listing_drafts WHERE id = ANY($1::uuid[]))
            AND NOT EXISTS (SELECT 1 FROM ashley_shop_listing_drafts d WHERE d.batch_id = b.id AND d.status <> 'published')`,
        [draftIds],
      );
      await client.query("COMMIT");
      res.json({ success: true, published });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      sendRouteError(res, error, "Failed to approve drafts");
    } finally {
      client.release();
    }
  });

  app.post("/api/ashley-shop/admin/batches/:id/process", isAuthenticated, requireShopOwner, async (req, res) => {
    try {
      res.json(await processAshleyBatch(req.params.id));
    } catch (error) {
      sendRouteError(res, error, "Failed to process intake batch");
    }
  });

  app.post("/api/ashley-shop/admin/intake-upload", isAuthenticated, requireShopOwner, upload.array("photos", 100), async (req: any, res) => {
    try {
      const files = (req.files || []) as Express.Multer.File[];
      if (!files.length) return res.status(400).json({ error: "Attach at least one supported photo" });
      const batch = await pool.query<{ id: string }>(
        `INSERT INTO ashley_shop_intake_batches
          (gmail_message_id, sender_email, recipient_email, subject, status, metadata)
         VALUES ($1, $2, $2, 'Manual dashboard upload', 'receiving', $3::jsonb) RETURNING id`,
        [`manual:${randomUUID()}`, req.user.email, JSON.stringify({ source: "dashboard" })],
      );
      for (const file of files) {
        const normalized = await sharp(file.buffer).rotate().resize({ width: 2_048, height: 2_048, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
        const metadata = await sharp(normalized).metadata();
        const url = await new ObjectStorageService().savePublicFileBuffer(normalized, "image/jpeg", "jpg", "shop/ashley-intake");
        const sha = (await import("node:crypto")).createHash("sha256").update(normalized).digest("hex");
        await pool.query(
          `INSERT INTO ashley_shop_media(batch_id, filename, mime_type, object_url, sha256, width, height)
           VALUES ($1, $2, 'image/jpeg', $3, $4, $5, $6) ON CONFLICT (batch_id, sha256) DO NOTHING`,
          [batch.rows[0].id, file.originalname, url, sha, metadata.width, metadata.height],
        );
      }
      await pool.query(
        `UPDATE ashley_shop_intake_batches SET status = 'received', attachment_count = $2, updated_at = now() WHERE id = $1`,
        [batch.rows[0].id, files.length],
      );
      res.status(201).json({ batchId: batch.rows[0].id, attachmentCount: files.length });
    } catch (error) {
      sendRouteError(res, error, "Failed to upload photos");
    }
  });

  app.get("/api/ashley-shop/admin/executive-summary", isAuthenticated, requireShopOwner, async (_req, res) => {
    try {
      const [inventory, pipeline, sales] = await Promise.all([
        pool.query(`SELECT count(*) FILTER (WHERE status='active' AND in_stock=true) AS active,
                           count(*) FILTER (WHERE status='sold') AS sold,
                           count(*) AS total FROM jewelry_items`),
        pool.query(`SELECT status, count(*)::int AS count FROM ashley_shop_listing_drafts GROUP BY status`),
        pool.query(`SELECT count(*)::int AS orders, COALESCE(sum(due_now_cents),0)::int AS revenue_cents,
                           COALESCE(sum(reward_moves),0)::int AS reward_moves
                      FROM commerce_orders WHERE status='paid' AND paid_at > now() - interval '30 days'`),
      ]);
      const active = Number(inventory.rows[0]?.active || 0);
      res.json({
        authority: { auto: ["sort photos", "draft listings", "rotate featured item", "report metrics"], approvalRequired: ["final prices", "publishing", "promotions above configured rules", "customer-facing campaigns"] },
        inventory: inventory.rows[0], pipeline: pipeline.rows, last30Days: sales.rows[0],
        target: { listings: 500, hours: 48, remaining: Math.max(0, 500 - active) },
        suggestedActions: [
          active < 500 ? `Approve or upload ${Math.max(0, 500 - active)} more listings to reach 500.` : "The 500-item inventory target is complete.",
          "Review drafts with warnings or low confidence before pricing.",
          "Keep customer campaigns in draft until Ashley or an owner approves them.",
        ],
      });
    } catch (error) {
      sendRouteError(res, error, "Failed to build executive summary");
    }
  });

  app.post("/api/commerce/preview", async (req, res) => {
    try {
      const input = commercePreviewSchema.parse(req.body);
      const identity = await optionalIdentity(req);
      res.json(await priceCommerceCart(input, identity));
    } catch (error) {
      sendRouteError(res, error, "Failed to price cart");
    }
  });

  app.get("/api/commerce/cart", async (req, res) => {
    try {
      const guestCartId = z.string().uuid().optional().parse(req.query.guestCartId);
      const identity = await optionalIdentity(req);
      const result = identity.userId
        ? await pool.query(`SELECT * FROM commerce_carts WHERE user_id = $1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1`, [identity.userId])
        : guestCartId
          ? await pool.query(`SELECT * FROM commerce_carts WHERE guest_cart_id = $1 AND status = 'active' LIMIT 1`, [guestCartId])
          : { rows: [] as any[] };
      res.json(result.rows[0] || { guest_cart_id: guestCartId || null, items: [] });
    } catch (error) {
      sendRouteError(res, error, "Failed to load cart");
    }
  });

  app.put("/api/commerce/cart", async (req, res) => {
    try {
      const input = commerceCartSchema.parse(req.body);
      const identity = await optionalIdentity(req);
      let result;
      if (identity.userId) {
        result = await pool.query(
          `INSERT INTO commerce_carts(guest_cart_id, user_id, items)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (user_id) WHERE user_id IS NOT NULL AND status = 'active'
           DO UPDATE SET items = EXCLUDED.items,
                         guest_cart_id = COALESCE(commerce_carts.guest_cart_id, EXCLUDED.guest_cart_id),
                         updated_at = now()
           RETURNING *`,
          [input.guestCartId || randomUUID(), identity.userId, JSON.stringify(input.items)],
        );
      } else {
        const guestId = input.guestCartId || randomUUID();
        result = await pool.query(
          `INSERT INTO commerce_carts(guest_cart_id, items) VALUES ($1, $2::jsonb)
           ON CONFLICT (guest_cart_id) DO UPDATE SET items = EXCLUDED.items, updated_at = now()
           RETURNING *`,
          [guestId, JSON.stringify(input.items)],
        );
      }
      res.json(result.rows[0]);
    } catch (error) {
      sendRouteError(res, error, "Failed to save cart");
    }
  });

  app.post("/api/commerce/checkout", async (req, res) => {
    try {
      const input = commerceCheckoutSchema.parse(req.body);
      const identity = await optionalIdentity(req);
      const protocol = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0];
      const host = String(req.headers["x-forwarded-host"] || req.headers.host);
      res.json(await createCommerceCheckout(input, identity, `${protocol}://${host}`));
    } catch (error) {
      sendRouteError(res, error, "Checkout failed");
    }
  });

  app.post("/api/commerce/crypto-checkout", async (req, res) => {
    try {
      const input = commerceCheckoutSchema.parse(req.body);
      const identity = await optionalIdentity(req);
      const protocol = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0];
      const host = String(req.headers["x-forwarded-host"] || req.headers.host);
      res.json(await createCommerceCryptoCheckout(input, identity, `${protocol}://${host}`));
    } catch (error) {
      sendRouteError(res, error, "Crypto checkout failed");
    }
  });

  app.post("/api/commerce/orders/:id/verify", async (req, res) => {
    try {
      res.json(await finalizeCommerceOrder(z.string().uuid().parse(req.params.id)));
    } catch (error) {
      sendRouteError(res, error, "Could not verify order");
    }
  });

  app.get("/api/commerce/orders/:id", async (req, res) => {
    try {
      const order = await getCommerceOrder(z.string().uuid().parse(req.params.id));
      res.json({
        id: order.id, status: order.status, paid_at: order.paid_at, due_now_cents: order.due_now_cents,
        reward_moves: order.reward_moves, reward_issued_at: order.reward_issued_at, lines: order.lines,
      });
    } catch (error) {
      sendRouteError(res, error, "Order not found");
    }
  });
}

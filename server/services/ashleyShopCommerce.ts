import { randomUUID } from "node:crypto";
import type { CommerceCheckoutInput, CommercePriceSnapshot } from "@shared/ashleyShop";
import { pool } from "../db";
import { storage } from "../storage";
import { sendEmail } from "./email";
import { ensureAshleyShopSchema } from "./ashleyShopSchema";
import { priceCommerceCart } from "./ashleyShopPricing";
import { applySitewideCryptoDiscount, SITEWIDE_CRYPTO_DISCOUNT_PERCENT } from "@shared/paymentIncentives";
import { createBitPayCheckoutIntent } from "./cryptoPayments";
import { settlePaidShopRewards, type PaidShopRewardOrder } from "./ashleyShopRewards";

async function issuePaidOrderRewards(orderId: string) {
  const result = await pool.query<PaidShopRewardOrder>("SELECT * FROM commerce_orders WHERE id = $1", [orderId]);
  const order = result.rows[0];
  if (!order) return;
  await settlePaidShopRewards(order, {
    credit: (userId, amount, referenceId) => storage.creditWalletTokens(userId, amount, {
      rewardType: "ashley_shop_purchase", referenceId,
      metadata: { source: "verified_square_commerce_order", orderId: referenceId },
    }),
    markIssued: async (id) => {
      await pool.query("UPDATE commerce_orders SET reward_issued_at = COALESCE(reward_issued_at, now()), updated_at = now() WHERE id = $1", [id]);
    },
  });
}

type CommerceIdentity = { userId?: string | null; email?: string | null; isAdmin?: boolean };

async function resolveRewardUserId(identity: CommerceIdentity, customerEmail: string) {
  if (identity.userId) return identity.userId;
  const account = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1",
    [customerEmail.trim()],
  );
  return account.rows[0]?.id || null;
}

async function squareClient() {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) throw new Error("Payment processing is not configured. Please call 906-285-9312.");
  const { SquareClient, SquareEnvironment } = await import("square");
  return new SquareClient({
    token,
    environment: process.env.SQUARE_ENVIRONMENT === "sandbox"
      ? SquareEnvironment.Sandbox
      : SquareEnvironment.Production,
  });
}

export async function createCommerceCheckout(
  input: CommerceCheckoutInput,
  identity: CommerceIdentity,
  baseUrl: string,
) {
  await ensureAshleyShopSchema();
  const snapshot = await priceCommerceCart(
    { ...input, customerEmail: input.email },
    { ...identity, email: identity.email || input.email },
  );
  const rewardUserId = await resolveRewardUserId(identity, input.email);
  if (snapshot.dueNowCents < 50) throw new Error("Add a payable item before checking out");
  if (snapshot.lines.some((line) => (line.type === "jewelry" || line.type === "shop")) && !input.shippingMethod) {
    throw new Error("Choose free local pickup or $10 shipping");
  }
  if (input.shippingMethod === "shipping" && !input.shippingAddress?.trim()) {
    throw new Error("Enter a shipping address");
  }

  const orderId = randomUUID();
  const cartResult = await pool.query<{ id: string }>(
    `INSERT INTO commerce_carts(guest_cart_id, user_id, status, items)
     VALUES ($1, $2, 'checkout', $3::jsonb)
     ON CONFLICT (guest_cart_id) DO UPDATE SET items = EXCLUDED.items, status = 'checkout', updated_at = now()
     RETURNING id`,
    [input.guestCartId || randomUUID(), identity.userId || null, JSON.stringify(input.items)],
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO commerce_orders
        (id, cart_id, user_id, customer_email, customer_name, customer_phone, status,
         fulfillment_method, fulfillment_address, subtotal_cents, discount_cents,
         shipping_cents, due_now_cents, pricing_snapshot, reward_moves)
       VALUES ($1, $2, $3, $4, $5, $6, 'creating_checkout', $7, $8, $9, $10, $11, $12, $13::jsonb, $14)`,
      [orderId, cartResult.rows[0]?.id || null, rewardUserId, input.email.toLowerCase(),
        `${input.firstName} ${input.lastName}`.trim(), input.phone, input.shippingMethod || null,
        input.shippingMethod === "shipping" ? input.shippingAddress : null, snapshot.subtotalCents,
        snapshot.discountCents, snapshot.shippingCents, snapshot.dueNowCents, JSON.stringify(snapshot),
        rewardUserId ? snapshot.totalRewardMoves : 0],
    );

    for (const line of snapshot.lines) {
      await client.query(
        `INSERT INTO commerce_order_lines
          (order_id, item_type, reference_id, booking_id, item_name, quantity, unit_price_cents,
           discount_percent, discount_cents, line_total_cents, settlement_mode, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
        [orderId, line.type, line.referenceId || line.id, line.bookingId || null, line.name, line.quantity,
          line.unitPriceCents, line.discountPercent, line.discountCents, line.lineTotalCents,
          line.settlementMode, JSON.stringify({ discountReasons: line.discountReasons, featuredToday: line.featuredToday })],
      );
      if (line.type === "jewelry") {
        const reserved = await client.query(
          `UPDATE jewelry_items
              SET status = 'commerce_reserved', pending_expires_at = now() + interval '30 minutes',
                  pending_square_order_id = $2
            WHERE id = $1 AND status = 'active' AND in_stock = true AND COALESCE(quantity, 1) >= $3
            RETURNING id`,
          [line.referenceId, orderId, line.quantity],
        );
        if (!reserved.rows[0]) throw new Error(`${line.name} was just reserved or sold; please refresh your cart`);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  try {
    const square = await squareClient();
    const locationsResponse = await square.locations.list();
    const locationId = locationsResponse.locations?.[0]?.id;
    if (!locationId) throw new Error("Square location is not configured");
    const lineItems = snapshot.lines
      .filter((line) => line.lineTotalCents > 0)
      .map((line) => ({
        name: `${line.name}${line.discountPercent ? ` (${line.discountPercent}% savings)` : ""}`.slice(0, 255),
        quantity: "1",
        basePriceMoney: { amount: BigInt(line.lineTotalCents), currency: "USD" as const },
      }));
    if (snapshot.shippingCents > 0) {
      lineItems.push({
        name: "Flat-rate shipping",
        quantity: "1",
        basePriceMoney: { amount: BigInt(snapshot.shippingCents), currency: "USD" as const },
      });
    }
    const response = await square.checkout.paymentLinks.create({
      idempotencyKey: orderId,
      order: { locationId, lineItems },
      checkoutOptions: {
        redirectUrl: `${baseUrl}/payment-success?type=commerce&commerceOrder=${orderId}`,
        allowTipping: false,
        merchantSupportEmail: process.env.COMPANY_EMAIL || "upmichiganstatemovers@gmail.com",
      },
      paymentNote: `JC unified cart ${orderId}`,
    });
    const paymentLink = (response as any).result?.paymentLink || (response as any).paymentLink;
    if (!paymentLink?.url || !paymentLink?.orderId) throw new Error("Square did not return a payment link");
    await pool.query(
      `UPDATE commerce_orders SET status = 'pending_payment', square_order_id = $2, updated_at = now() WHERE id = $1`,
      [orderId, paymentLink.orderId],
    );
    return { orderId, checkoutUrl: paymentLink.url, pricing: snapshot };
  } catch (error) {
    await pool.query("UPDATE commerce_orders SET status = 'checkout_failed', updated_at = now() WHERE id = $1", [orderId]);
    await releaseOrderReservations(orderId);
    throw error;
  }
}

export async function createCommerceCryptoCheckout(
  input: CommerceCheckoutInput,
  identity: CommerceIdentity,
  baseUrl: string,
) {
  await ensureAshleyShopSchema();
  const regularSnapshot = await priceCommerceCart(
    { ...input, customerEmail: input.email },
    { ...identity, email: identity.email || input.email },
  );
  if (regularSnapshot.dueNowCents < 50) throw new Error("Add a payable item before checking out");
  if (regularSnapshot.lines.some((line) => line.type === "jewelry" || line.type === "shop") && !input.shippingMethod) {
    throw new Error("Choose free local pickup or $10 shipping");
  }
  if (input.shippingMethod === "shipping" && !input.shippingAddress?.trim()) throw new Error("Enter a shipping address");

  const cryptoPrice = applySitewideCryptoDiscount(regularSnapshot.dueNowCents);
  const snapshot = {
    ...regularSnapshot,
    baseRewardMoves: 0,
    regularPaymentBonusMoves: 0,
    featuredBonusMoves: 0,
    itemBonusMoves: 0,
    totalRewardMoves: 0,
    paymentIncentive: {
      rail: "crypto",
      discountPercent: SITEWIDE_CRYPTO_DISCOUNT_PERCENT,
      discountCents: cryptoPrice.discountCents,
      standardDueCents: cryptoPrice.originalCents,
    },
    dueNowCents: cryptoPrice.dueCents,
  };
  const orderId = randomUUID();
  const cart = await pool.query<{ id: string }>(
    `INSERT INTO commerce_carts(guest_cart_id, user_id, status, items)
     VALUES ($1, $2, 'checkout', $3::jsonb)
     ON CONFLICT (guest_cart_id) DO UPDATE SET items=EXCLUDED.items, status='checkout', updated_at=now()
     RETURNING id`,
    [input.guestCartId || randomUUID(), identity.userId || null, JSON.stringify(input.items)],
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO commerce_orders
        (id, cart_id, user_id, customer_email, customer_name, customer_phone, status,
         fulfillment_method, fulfillment_address, subtotal_cents, discount_cents, shipping_cents,
         due_now_cents, pricing_snapshot, reward_moves, payment_rail)
       VALUES ($1,$2,$3,$4,$5,$6,'creating_checkout',$7,$8,$9,$10,$11,$12,$13::jsonb,0,'crypto')`,
      [orderId, cart.rows[0]?.id || null, identity.userId || null, input.email.toLowerCase(),
        `${input.firstName} ${input.lastName}`.trim(), input.phone, input.shippingMethod || null,
        input.shippingMethod === "shipping" ? input.shippingAddress : null, snapshot.subtotalCents,
        snapshot.discountCents + cryptoPrice.discountCents, snapshot.shippingCents, snapshot.dueNowCents, JSON.stringify(snapshot)],
    );
    for (const line of snapshot.lines) {
      await client.query(
        `INSERT INTO commerce_order_lines
          (order_id,item_type,reference_id,booking_id,item_name,quantity,unit_price_cents,
           discount_percent,discount_cents,line_total_cents,settlement_mode,metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
        [orderId, line.type, line.referenceId || line.id, line.bookingId || null, line.name, line.quantity,
          line.unitPriceCents, line.discountPercent, line.discountCents, line.lineTotalCents, line.settlementMode,
          JSON.stringify({ discountReasons: line.discountReasons, featuredToday: line.featuredToday })],
      );
      if (line.type === "jewelry") {
        const reserved = await client.query(
          `UPDATE jewelry_items SET status='commerce_reserved', pending_expires_at=now()+interval '30 minutes', pending_square_order_id=$2
            WHERE id=$1 AND status='active' AND in_stock=true AND COALESCE(quantity,1)>=$3 RETURNING id`,
          [line.referenceId, orderId, line.quantity],
        );
        if (!reserved.rows[0]) throw new Error(`${line.name} was just reserved or sold; please refresh your cart`);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  let intentId: number | null = null;
  try {
    const statusToken = randomUUID();
    const intent = await pool.query<{ id: number }>(
      `INSERT INTO crypto_payment_intents
        (user_id,provider,amount_usd,original_amount_usd,discount_percent,discount_amount_usd,
         reward_percent,reward_value_usd,currency,status,reference_type,reference_id,bonus_tokens,
         retention_percent,payment_rail,customer_name,customer_email,customer_phone,status_token,metadata)
       VALUES ($1,'bitpay',$2,$3,$4,$5,0,0,'USD','pending','commerce_order',$6,0,100,'crypto',$7,$8,$9,$10,$11::jsonb)
       RETURNING id`,
      [identity.userId || null, (cryptoPrice.dueCents / 100).toFixed(2), (cryptoPrice.originalCents / 100).toFixed(2),
        SITEWIDE_CRYPTO_DISCOUNT_PERCENT.toFixed(2), (cryptoPrice.discountCents / 100).toFixed(2), orderId,
        `${input.firstName} ${input.lastName}`.trim(), input.email.toLowerCase(), input.phone, statusToken,
        JSON.stringify({ commerceOrderId: orderId, incentive: "sitewide_crypto_5_percent" })],
    );
    intentId = intent.rows[0].id;
    const checkout = await createBitPayCheckoutIntent({
      amountUsd: cryptoPrice.dueCents / 100,
      userId: identity.userId || `guest:${orderId}`,
      referenceType: "commerce_order",
      referenceId: orderId,
      itemDesc: `JC ON THE MOVE order - ${SITEWIDE_CRYPTO_DISCOUNT_PERCENT}% crypto discount`,
      redirectUrl: `${baseUrl}/payment-success?type=commerce-crypto&commerceOrder=${orderId}`,
      closeUrl: `${baseUrl}/cart?crypto=cancelled&commerceOrder=${orderId}`,
      notificationUrl: `${baseUrl}/api/webhooks/crypto/bitpay`,
      customer: { name: `${input.firstName} ${input.lastName}`.trim(), email: input.email, phone: input.phone },
      metadata: { cryptoIntentId: intentId, commerceOrderId: orderId },
    });
    await pool.query(
      `UPDATE crypto_payment_intents SET provider_invoice_id=$1, provider_invoice_token=$2,
          provider_checkout_url=$3, provider_status=$4, raw_provider_payload=$5::jsonb, updated_at=now()
        WHERE id=$6`,
      [checkout.providerInvoiceId, checkout.providerInvoiceToken, checkout.checkoutUrl, checkout.providerStatus,
        JSON.stringify(checkout.raw), intentId],
    );
    await pool.query(
      `UPDATE commerce_orders SET status='pending_payment', crypto_intent_id=$2, provider_invoice_id=$3, updated_at=now() WHERE id=$1`,
      [orderId, intentId, checkout.providerInvoiceId],
    );
    return { orderId, checkoutUrl: checkout.checkoutUrl, pricing: snapshot };
  } catch (error) {
    if (intentId) await pool.query("UPDATE crypto_payment_intents SET status='failed', updated_at=now() WHERE id=$1", [intentId]).catch(() => {});
    await pool.query("UPDATE commerce_orders SET status='checkout_failed', updated_at=now() WHERE id=$1", [orderId]);
    await releaseOrderReservations(orderId);
    throw error;
  }
}

async function releaseOrderReservations(orderId: string) {
  await pool.query(
    `UPDATE jewelry_items
        SET status = 'active', pending_expires_at = NULL, pending_square_order_id = NULL
      WHERE status = 'commerce_reserved' AND pending_square_order_id = $1`,
    [orderId],
  );
}

export async function finalizeCommerceOrder(orderId: string) {
  await ensureAshleyShopSchema();
  const orderResult = await pool.query<{
    id: string; status: string; square_order_id: string | null; due_now_cents: number;
    user_id: string | null; reward_moves: number; customer_email: string; customer_name: string;
  }>("SELECT * FROM commerce_orders WHERE id = $1", [orderId]);
  const order = orderResult.rows[0];
  if (!order) throw new Error("Order not found");
  if (order.status === "paid") {
    await issuePaidOrderRewards(orderId);
    return getCommerceOrder(orderId);
  }
  if (!order.square_order_id) throw new Error("Order is not connected to Square");

  const square = await squareClient();
  const squareOrderResponse = await square.orders.get({ orderId: order.square_order_id });
  const squareOrder = (squareOrderResponse as any).order || (squareOrderResponse as any).result?.order;
  const total = Number(squareOrder?.totalMoney?.amount ?? 0);
  if (squareOrder?.state !== "COMPLETED" || total !== Number(order.due_now_cents)) {
    return getCommerceOrder(orderId);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query<{ status: string }>("SELECT status FROM commerce_orders WHERE id = $1 FOR UPDATE", [orderId]);
    if (lock.rows[0]?.status !== "paid") {
      await client.query(
        `UPDATE jewelry_items j
            SET status = 'sold', in_stock = false, quantity = 0, sold_at = now(),
                pending_expires_at = NULL, pending_square_order_id = NULL
           FROM commerce_order_lines l
          WHERE l.order_id = $1 AND l.item_type = 'jewelry' AND l.reference_id = j.id
            AND j.status = 'commerce_reserved' AND j.pending_square_order_id = $1`,
        [orderId],
      );
      await client.query(
        `UPDATE commerce_orders SET status = 'paid', paid_at = now(), updated_at = now() WHERE id = $1`,
        [orderId],
      );
      await client.query("UPDATE commerce_carts SET status = 'converted', updated_at = now() WHERE id = (SELECT cart_id FROM commerce_orders WHERE id = $1)", [orderId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  await issuePaidOrderRewards(orderId).catch((error) => {
    console.error("[Ashley Shop] reward issuance failed; will retry", orderId, error);
  });

  sendEmail({
    to: order.customer_email,
    subject: "Payment confirmed — Handmade Jewels by Ashley",
    text: `Thank you, ${order.customer_name}. Your unified cart payment is verified. Order: ${orderId}`,
    html: `<h2>Payment confirmed</h2><p>Thank you, ${order.customer_name}. Your unified cart payment is verified.</p><p>Order: ${orderId}</p>`,
  }).catch(() => {});
  return getCommerceOrder(orderId);
}

// Called only after the signed BitPay webhook/reconcile path has fetched the
// provider invoice and required a credit-eligible terminal status.
export async function finalizeCommerceCryptoOrder(orderId: string, providerInvoiceId: string) {
  await ensureAshleyShopSchema();
  let customer: { customer_email: string; customer_name: string } | null = null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const order = await client.query<{ status: string; payment_rail: string; customer_email: string; customer_name: string }>(
      "SELECT status, payment_rail, customer_email, customer_name FROM commerce_orders WHERE id=$1 FOR UPDATE",
      [orderId],
    );
    if (!order.rows[0]) throw new Error("Commerce order not found");
    if (order.rows[0].payment_rail !== "crypto") throw new Error("Commerce order is not a crypto checkout");
    customer = { customer_email: order.rows[0].customer_email, customer_name: order.rows[0].customer_name };
    if (order.rows[0].status !== "paid") {
      await client.query(
        `UPDATE jewelry_items j SET status='sold', in_stock=false, quantity=0, sold_at=now(),
             pending_expires_at=NULL, pending_square_order_id=NULL
           FROM commerce_order_lines l
          WHERE l.order_id=$1 AND l.item_type='jewelry' AND l.reference_id=j.id
            AND j.status='commerce_reserved' AND j.pending_square_order_id=$1`,
        [orderId],
      );
      await client.query(
        `UPDATE commerce_orders SET status='paid', provider_invoice_id=$2, paid_at=now(), updated_at=now() WHERE id=$1`,
        [orderId, providerInvoiceId],
      );
      await client.query("UPDATE commerce_carts SET status='converted', updated_at=now() WHERE id=(SELECT cart_id FROM commerce_orders WHERE id=$1)", [orderId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (customer) {
    sendEmail({
      to: customer.customer_email,
      subject: "Crypto payment confirmed — Handmade Jewels by Ashley",
      text: `Thank you, ${customer.customer_name}. Your crypto payment is verified. Order: ${orderId}`,
      html: `<h2>Crypto payment confirmed</h2><p>Thank you, ${customer.customer_name}. Your payment is verified.</p><p>Order: ${orderId}</p>`,
    }).catch(() => {});
  }
  return getCommerceOrder(orderId);
}

export async function getCommerceOrder(orderId: string) {
  await ensureAshleyShopSchema();
  const order = await pool.query("SELECT * FROM commerce_orders WHERE id = $1", [orderId]);
  if (!order.rows[0]) throw new Error("Order not found");
  const lines = await pool.query("SELECT * FROM commerce_order_lines WHERE order_id = $1 ORDER BY created_at", [orderId]);
  return { ...order.rows[0], lines: lines.rows };
}

export async function sweepExpiredCommerceReservations() {
  await ensureAshleyShopSchema();
  const unpaidRewards = await pool.query<{ id: string }>(`
    SELECT id FROM commerce_orders WHERE status = 'paid' AND payment_rail <> 'crypto'
      AND user_id IS NOT NULL AND reward_moves > 0 AND reward_issued_at IS NULL
      AND pricing_snapshot->>'itemBonusMoves' = '555'
    ORDER BY paid_at ASC LIMIT 100`);
  for (const order of unpaidRewards.rows) {
    await issuePaidOrderRewards(order.id).catch((error) => {
      console.error("[Ashley Shop] scheduled reward retry failed", order.id, error);
    });
  }
  const candidates = await pool.query<{ id: string; payment_rail: string; square_order_id: string | null }>(
    `SELECT id, payment_rail, square_order_id
       FROM commerce_orders
      WHERE status IN ('creating_checkout', 'pending_payment')
        AND created_at < now() - interval '30 minutes'`,
  );

  // A customer may complete Square checkout without returning to our success
  // page. Reconcile first so a paid one-of-a-kind item is never released.
  for (const order of candidates.rows) {
    if (order.payment_rail !== "crypto" && order.square_order_id) {
      await finalizeCommerceOrder(order.id).catch((error) => {
        console.error("[Ashley Shop] scheduled Square reconciliation failed", order.id, error);
      });
    }
  }

  const expired = await pool.query<{ id: string }>(
    `UPDATE commerce_orders o
        SET status = 'expired', updated_at = now()
      WHERE o.status IN ('creating_checkout', 'pending_payment')
        AND o.created_at < now() - CASE WHEN o.payment_rail = 'crypto' THEN interval '2 hours' ELSE interval '30 minutes' END
      RETURNING id`,
  );
  for (const row of expired.rows) await releaseOrderReservations(row.id);
  return { expired: expired.rowCount || 0 };
}

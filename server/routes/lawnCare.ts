import { leadPhoneNumberSchema } from "@shared/schema";
import { Router, Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { db } from "../db";
import { lawnCareQuotes, lawnCarePlans, lawnCareRebookReminders, type LawnCareQuote } from "@shared/schema";
import {
  calculateLawnCareQuote,
  sizeTierFromSqFt,
  SIZE_TIER_RANGES,
  ADD_ON_LABELS,
  CONDITION_LABELS,
  FREQUENCY_LABELS,
  type LawnCarePriceBreakdown,
} from "../lib/lawnCarePricing";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { sendEmail } from "../services/email";
import { disburseServiceTokens } from "../services/disburse-service-tokens";
import { emitStandaloneQuoteOpportunity } from "../services/jobEventBus";
import {
  findEligibleRebookReminders,
  runRebookReminderSweep,
  buildRebookReminderEmail,
  getLastSweepInfo,
  REBOOK_ELIGIBILITY_DAYS,
  REBOOK_RESEND_WINDOW_DAYS,
  REBOOK_EMAIL_SOURCE,
  verifyUnsubscribeToken,
  recordOptout,
} from "../services/lawnCareRebookReminder";
import {
  checkSlidingWindow,
  checkCooldown,
  markCooldown,
  pruneStaleBuckets,
  ipRateLimit,
} from "../lib/persistentRateLimit";

const router = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = (req as any).user?.id || (req.session as any)?.userId;
  if (!userId) return res.status(401).json({ error: "Authentication required" });
  return next();
}

function requireAdminRole(req: Request, res: Response, next: NextFunction) {
  const userId = (req as any).user?.id || (req.session as any)?.userId;
  if (!userId) return res.status(401).json({ error: "Authentication required" });
  const user = (req as any).user;
  const role = user?.role || user?.userType;
  if (!role || !["admin", "business_owner"].includes(role)) {
    return res.status(403).json({ error: "Admin access required" });
  }
  return next();
}

function requireCrewOrAdminRole(req: Request, res: Response, next: NextFunction) {
  const userId = (req as any).user?.id || (req.session as any)?.userId;
  if (!userId) return res.status(401).json({ error: "Authentication required" });
  const user = (req as any).user;
  const role = user?.role || user?.userType;
  if (!role || !["admin", "business_owner", "employee"].includes(role)) {
    return res.status(403).json({ error: "Crew or admin access required" });
  }
  return next();
}

// Per-add-on scheduling info captured by the multi-service booking flow
// (Task #115). Each entry corresponds to one bundle add-on the customer ticked
// on the lawn care booking page. We persist a companion lead per entry so the
// add-on service has a real start date / frequency rather than an after-the-
// fact email back-and-forth.
const bundleScheduleSchema = z.object({
  service: z.string().min(1),
  requestedStartDate: z.string().optional(),
  frequency: z.string().optional(),       // weekly / biweekly / one_time / recurring
  callToSchedule: z.boolean().optional(), // moving / assembly opt-out of date pick
  notes: z.string().optional(),
});

const quoteRequestSchema = z.object({
  customerName: z.string().min(1),
  phone: leadPhoneNumberSchema,
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().min(3),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  serviceCategory: z.string().min(1),
  serviceFrequency: z.string().min(1),
  propertySize: z.string().min(1),
  squareFootage: z.number().optional(),
  propertyCondition: z.string().min(1),
  addOns: z.array(z.string()).default([]),
  hasFence: z.boolean().optional(),
  hasPets: z.boolean().optional(),
  hasSteepSlope: z.boolean().optional(),
  needsHaulAway: z.boolean().optional(),
  distanceMiles: z.number().optional(),
  requestedStartDate: z.string().optional(),
  requestedTimeWindow: z.string().optional(),
  notes: z.string().optional(),
  // Task #115 — bundle add-on selection + per-service scheduling collected
  // by the new Step 5 micro-UI. Both default to [] so solo lawn care
  // submissions remain unaffected.
  bundleAddons: z.array(z.string()).default([]),
  bundleSchedules: z.array(bundleScheduleSchema).default([]),
});

type JobBriefQuote = Pick<
  LawnCareQuote,
  "propertySize" | "propertyCondition" | "serviceFrequency" | "hasFence" | "hasPets" | "hasSteepSlope" | "needsHaulAway"
>;

function buildJobBriefHtml(quote: JobBriefQuote, pricing: LawnCarePriceBreakdown): string {
  const sizeLabel = SIZE_TIER_RANGES[pricing.sizeTier]?.label || quote.propertySize;
  const condLabel = CONDITION_LABELS[quote.propertyCondition] || quote.propertyCondition;
  const freqLabel = FREQUENCY_LABELS[quote.serviceFrequency] || quote.serviceFrequency;
  const flags: string[] = [];
  if (quote.hasFence) flags.push("Fenced yard — gate access needed");
  if (quote.hasPets) flags.push("Pets on property — be careful with gates");
  if (quote.hasSteepSlope) flags.push("Steep slope / hill (+15%)");
  if (quote.needsHaulAway) flags.push("Haul away debris (+$45)");
  const addOnsList = (pricing.addOnDetails || [])
    .map((a) => `<li>${a.label} <span style="color:#64748b">(+$${a.amount})</span></li>`)
    .join("") || "<li><em>None</em></li>";
  const adjList = (pricing.propertyAdjustments || [])
    .map((a) => `<li>${a.label} — ${a.explain || ""} <span style="color:#64748b">(+$${a.amount})</span></li>`)
    .join("") || "<li><em>None</em></li>";

  return `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-top:12px;font-family:system-ui,sans-serif;color:#0f172a">
      <h3 style="margin:0 0 8px;font-size:15px;color:#0f172a">📋 Job Brief</h3>
      <p style="margin:2px 0;font-size:13px"><b>Yard size:</b> ${sizeLabel}</p>
      <p style="margin:2px 0;font-size:13px"><b>Condition:</b> ${condLabel} <span style="color:#64748b">(${pricing.conditionMultiplier}× — ${pricing.explanations?.condition || ""})</span></p>
      <p style="margin:2px 0;font-size:13px"><b>Frequency:</b> ${freqLabel} <span style="color:#64748b">(${pricing.explanations?.frequency || ""})</span></p>
      <p style="margin:2px 0;font-size:13px"><b>Recommended crew:</b> ${pricing.recommendedCrewSize}-person ${pricing.recommendedCrewType}</p>
      <p style="margin:2px 0;font-size:13px"><b>Time estimate:</b> ${pricing.estimatedMinutesMin}–${pricing.estimatedMinutesMax} min on-site</p>
      <p style="margin:8px 0 2px;font-size:13px"><b>Add-ons:</b></p>
      <ul style="margin:0 0 6px;padding-left:18px;font-size:13px">${addOnsList}</ul>
      <p style="margin:6px 0 2px;font-size:13px"><b>Property flags:</b></p>
      <ul style="margin:0 0 6px;padding-left:18px;font-size:13px">${flags.map(f => `<li>${f}</li>`).join("") || "<li><em>None</em></li>"}</ul>
      <p style="margin:6px 0 2px;font-size:13px"><b>Adjustments:</b></p>
      <ul style="margin:0;padding-left:18px;font-size:13px">${adjList}</ul>
    </div>
  `;
}

function buildJobBriefText(quote: JobBriefQuote, pricing: LawnCarePriceBreakdown): string {
  const sizeLabel = SIZE_TIER_RANGES[pricing.sizeTier]?.label || quote.propertySize;
  const condLabel = CONDITION_LABELS[quote.propertyCondition] || quote.propertyCondition;
  const freqLabel = FREQUENCY_LABELS[quote.serviceFrequency] || quote.serviceFrequency;
  const flags: string[] = [];
  if (quote.hasFence) flags.push("Fenced yard — gate access needed");
  if (quote.hasPets) flags.push("Pets on property");
  if (quote.hasSteepSlope) flags.push("Steep slope / hill (+15%)");
  if (quote.needsHaulAway) flags.push("Haul away debris (+$45)");
  const addOnsList = (pricing.addOnDetails || [])
    .map((a) => ` • ${a.label} (+$${a.amount})`)
    .join("\n") || " • None";
  return `
JOB BRIEF
---------
Yard size: ${sizeLabel}
Condition: ${condLabel} (${pricing.conditionMultiplier}×)
Frequency: ${freqLabel}
Recommended crew: ${pricing.recommendedCrewSize}-person ${pricing.recommendedCrewType}
Time estimate: ${pricing.estimatedMinutesMin}–${pricing.estimatedMinutesMax} min on-site

Add-ons:
${addOnsList}

Property flags:
${flags.length ? flags.map(f => ` • ${f}`).join("\n") : " • None"}
`.trim();
}

// POST /api/lawn-care/quote — public (no auth required to submit a quote request)
router.post("/quote", async (req: Request, res: Response) => {
  try {
    const data = quoteRequestSchema.parse(req.body);
    const bundleAddons = data.bundleAddons;
    const bundleSchedules = data.bundleSchedules;

    const pricing = calculateLawnCareQuote({
      serviceCategory: data.serviceCategory,
      serviceFrequency: data.serviceFrequency,
      propertySize: data.propertySize,
      squareFootage: data.squareFootage,
      propertyCondition: data.propertyCondition,
      addOns: data.addOns,
      hasFence: data.hasFence,
      hasPets: data.hasPets,
      hasSteepSlope: data.hasSteepSlope,
      needsHaulAway: data.needsHaulAway,
      zip: data.zip,
      distanceMiles: data.distanceMiles,
    });

    // Auto-apply 10% bundle discount when the customer is bundling another
    // service (intent) or has a paid/active record in another service in the
    // last 90 days (cross-service repeat).
    const { evaluateBundleDiscount, logBundleDiscountApplication } = await import("../services/bundleDiscount");
    const bundleDiscount = await evaluateBundleDiscount({
      currentService: "lawn_care",
      phone: data.phone,
      email: data.email || null,
      bundleAddons,
      subtotal: pricing.totalQuoted,
    });
    const finalTotalQuoted = bundleDiscount.applied ? bundleDiscount.finalTotal : pricing.totalQuoted;

    // Generate a shared bundle group id whenever the customer selected at
    // least one bundle add-on. Derived from `bundleAddons` (the source of
    // truth for "is this a bundle?") rather than `bundleSchedules`, so a
    // missing/partial schedule payload can never silently break the bundle
    // linkage between the primary quote and its companion leads. Stays null
    // for solo lawn care so we don't pollute the column.
    const bundleGroupId = bundleAddons.length > 0 ? randomUUID() : null;

    const [quote] = await db.insert(lawnCareQuotes).values({
      customerName: data.customerName,
      phone: data.phone,
      email: data.email || null,
      address: data.address,
      city: data.city,
      state: data.state,
      zip: data.zip,
      serviceType: "lawn_care",
      serviceCategory: data.serviceCategory,
      serviceFrequency: data.serviceFrequency,
      propertySize: data.propertySize,
      squareFootage: data.squareFootage,
      propertyCondition: data.propertyCondition,
      addOns: data.addOns,
      notes: data.notes,
      hasFence: data.hasFence ?? false,
      hasPets: data.hasPets ?? false,
      hasSteepSlope: data.hasSteepSlope ?? false,
      needsHaulAway: data.needsHaulAway ?? false,
      recommendedCrewType: pricing.recommendedCrewType,
      recommendedCrewSize: pricing.recommendedCrewSize,
      basePrice: String(pricing.basePrice),
      conditionMultiplier: String(pricing.conditionMultiplier),
      frequencyMultiplier: String(pricing.frequencyMultiplier),
      addOnTotal: String(pricing.addOnTotal),
      travelFee: String(pricing.travelFee),
      totalQuoted: String(finalTotalQuoted),
      bundleDiscountAmount: bundleDiscount.amount.toFixed(2),
      bundleDiscountReason: bundleDiscount.reason,
      isCustomEstimate: pricing.isCustomEstimate,
      requestedStartDate: data.requestedStartDate,
      requestedTimeWindow: data.requestedTimeWindow,
      status: "quote_requested",
      bundleGroupId,
    }).returning();

    await emitStandaloneQuoteOpportunity({
      eventId: `lawn-care-quote:${quote.id}`,
      referenceId: `lawn-care-${quote.id}`,
      customerName: data.customerName,
      serviceType: "lawn_care",
      requestedDate: data.requestedStartDate || null,
      source: "lawn_care_quote",
      adminPath: "/admin/lawn-care",
    });

    // Companion leads — one per add-on the customer included with this
    // submission. The shared `bundleGroupId` lets /my-jobs and the admin
    // dashboard render the bundle as a single unit, and per-service scheduling
    // info (when the customer filled it in on the new micro-step) gives the
    // crew a concrete start date instead of an after-the-fact hand-off.
    let companionLeads: import("../services/bundleScheduling").CreatedBundleChild[] = [];
    if (bundleAddons.length > 0) {
      try {
        const { createBundleChildLeads, splitCustomerName } = await import("../services/bundleScheduling");
        const { firstName, lastName } = splitCustomerName(data.customerName);
        companionLeads = await createBundleChildLeads({
          parentRef: `lawn care quote #${quote.id}`,
          parentServiceType: "lawn_care",
          addons: bundleAddons,
          contact: {
            firstName,
            lastName,
            email: data.email || null,
            phone: data.phone,
            address: [data.address, data.city, data.state, data.zip].filter(Boolean).join(", "),
          },
          schedules: bundleSchedules,
          bundleGroupId,
        });
      } catch (childErr) {
        console.error("[lawn-care] bundle companion lead creation failed:", (childErr as Error).message);
      }
    }

    if (bundleDiscount.applied) {
      logBundleDiscountApplication({
        referenceTable: "lawn_care_quotes",
        referenceId: String(quote.id),
        serviceType: "lawn_care",
        customerEmail: data.email || null,
        customerPhone: data.phone,
        subtotalBefore: pricing.totalQuoted,
        result: bundleDiscount,
      });
    }

    // Task #199 — record pending shop-card grants up front so we have an
    // audit trail before we ever publish the Square invoice. Also drives
    // the auto-invoice block below: when at least one priced shop card
    // is selected we publish a Square invoice immediately so the
    // customer gets billed for the prepaid wallet credit alongside
    // their lawn care total.
    let pendingShopCardGrants: Awaited<ReturnType<typeof import("../services/bundleBilling").markPendingShopCardGrants>> = [];
    try {
      const { markPendingShopCardGrants } = await import("../services/bundleBilling");
      pendingShopCardGrants = await markPendingShopCardGrants({
        sourceType: "lawn_care_quote",
        sourceId: String(quote.id),
        bundleAddons,
        customerEmail: data.email || null,
        customerPhone: data.phone,
        metadata: { serviceType: "lawn_care" },
      });
    } catch (grantErr) {
      console.error("[lawn-care] markPendingShopCardGrants failed:", (grantErr as Error).message);
    }

    // Auto-publish a Square invoice when the customer bundled a priced
    // shop card. The invoice contains the lawn-care service line PLUS
    // the shop-card line; the bundle-discount math is applied to the
    // service line only — the shop card is full price (it's prepaid
    // JCMOVES USD and cannot itself be discounted).
    let lawnCareInvoiceUrl: string | null = null;
    let lawnCareInvoiceId: string | null = null;
    if (data.email && pendingShopCardGrants.length > 0) {
      try {
        const { squareInvoiceService } = await import("../services/square-invoice");
        const { attachInvoiceToGrants } = await import("../services/bundleBilling");
        if (squareInvoiceService.isConfigured()) {
          const sumShopCard = pendingShopCardGrants.reduce((s, g) => s + g.unitPriceUsd * g.quantity, 0);
          const serviceLineTotal = finalTotalQuoted; // discount is already baked in
          const lineItems = [
            {
              name: `Lawn Care — ${data.serviceCategory.replace(/_/g, " ")} (${data.serviceFrequency.replace(/_/g, " ")})`,
              qty: 1,
              unitPrice: serviceLineTotal,
              total: serviceLineTotal,
            },
            ...pendingShopCardGrants.map((g) => ({
              name: g.name,
              qty: g.quantity,
              unitPrice: g.unitPriceUsd,
              total: g.unitPriceUsd * g.quantity,
            })),
          ];
          // Lawn-care quotes don't have a leads-table row, so we shim a
          // Lead-shaped object for `createItemizedInvoiceForLead`. The
          // helper only reads firstName/lastName/email/phone/serviceType
          // and the bundle-discount fields — all available here.
          const [firstName, ...rest] = (data.customerName || "Customer").trim().split(/\s+/);
          const lastName = rest.join(" ") || "(Lawn Care)";
          const shimLead: import("../services/square-invoice").InvoiceRecipient = {
            id: `lawn_care_quote:${quote.id}`,
            firstName,
            lastName,
            email: data.email,
            phone: data.phone,
            serviceType: "lawn_care",
            // Critical: keep the bundle discount math limited to the
            // SERVICE line by reporting bundleDiscountAmount=0 to the
            // invoice helper. The discount is already baked into
            // `finalTotalQuoted`, so we don't want the helper to also
            // try to inject an order-level discount on top of the shop
            // card line.
            totalPrice: String(serviceLineTotal + sumShopCard),
            bundleDiscountAmount: "0",
          };
          const result = await squareInvoiceService.createItemizedInvoiceForLead(
            shimLead,
            lineItems,
            undefined,
            "email",
          );
          lawnCareInvoiceUrl = result.invoiceUrl || null;
          lawnCareInvoiceId = result.squareInvoiceId || null;
          if (lawnCareInvoiceId) {
            await attachInvoiceToGrants({
              sourceType: "lawn_care_quote",
              sourceId: String(quote.id),
              squareInvoiceId: lawnCareInvoiceId,
            });
          }
          console.log(`[lawn-care] auto-invoice published for quote ${quote.id} (shop_card included)`);
        }
      } catch (invErr) {
        console.error("[lawn-care] auto-invoice failed:", (invErr as Error).message);
      }
    }

    if (data.email) {
      disburseServiceTokens({
        serviceType: "lawn_care",
        referenceId: String(quote.id),
        customerEmail: data.email,
        totalPrice: pricing.totalQuoted,
      }).catch(err => console.error("Lawn care token disburse error:", err));
    }

    // (Companion leads were already created above via the unified
    // createBundleChildLeads helper, which now handles both the scheduled
    // and unscheduled cases — see the block right after the quote insert.)

    const companyEmail = process.env.COMPANY_EMAIL || "michigankid906@gmail.com";
    const bundleSubjectTag = bundleDiscount.applied
      ? (bundleDiscount.reason === "cross_service_history" ? " [REPEAT BUNDLE -10%]" : " [BUNDLE -10%]")
      : "";
    const bundleNote = bundleDiscount.applied
      ? `\n\n⚡ BUNDLE DISCOUNT APPLIED: 10% off ($${bundleDiscount.amount.toFixed(2)}) — already baked into the $${finalTotalQuoted.toFixed(2)} total. Reason: ${bundleDiscount.reason === "cross_service_history" ? `recent customer in ${bundleDiscount.triggeringServices.join(", ")}` : `bundling with ${bundleDiscount.triggeringServices.join(", ")}`}. Use this discounted total when invoicing.`
      : "";
    const bundleHtml = bundleDiscount.applied
      ? `<div style="background:#dcfce7;border:2px solid #22c55e;padding:10px 14px;border-radius:8px;margin-top:10px"><b style="color:#15803d">⚡ Bundle Discount Applied: −$${bundleDiscount.amount.toFixed(2)} (10%)</b><br><span style="color:#166534;font-size:13px">Already baked into the <b>$${finalTotalQuoted.toFixed(2)}</b> total — invoice at this rate. Reason: ${bundleDiscount.reason === "cross_service_history" ? `recent ${bundleDiscount.triggeringServices.join(", ")} customer` : `bundling with ${bundleDiscount.triggeringServices.join(", ")}`}.</span></div>`
      : "";
    const briefHtml = buildJobBriefHtml(quote, pricing);
    const briefText = buildJobBriefText(quote, pricing);

    // Companion services summary for the admin email so ops can see the full
    // bundle scope (with each add-on's preferred date) in one message.
    const bundleServicesText = companionLeads.length > 0
      ? `\n\n=== BUNDLED SERVICES (group ${bundleGroupId}) ===\n` +
        companionLeads.map(l => `• ${l.label} — ${l.startDate ? `start ${l.startDate}` : "call to schedule"}`).join("\n")
      : "";
    const bundleServicesHtml = companionLeads.length > 0
      ? `<div style="background:#eff6ff;border:1px solid #3b82f6;padding:10px 14px;border-radius:8px;margin-top:10px"><b style="color:#1d4ed8">📦 Bundled Services (group ${bundleGroupId})</b><ul style="margin:6px 0 0 18px;padding:0;color:#1e3a8a">${companionLeads.map(l => `<li><b>${l.label}</b> — ${l.startDate ? `start ${l.startDate}` : "call to schedule"}</li>`).join("")}</ul></div>`
      : "";
    // Task #199 — let admins see exactly what's about to land on the
    // Square invoice (and what wallet credit will mint on payment).
    const adminShopCardHtml = pendingShopCardGrants.length > 0
      ? `<div style="background:#fef3c7;border:1px solid #f59e0b;padding:10px 14px;border-radius:8px;margin-top:10px"><b style="color:#b45309">🛍️ Bundled Add-ons (billable on this invoice)</b><ul style="margin:6px 0 0 18px;padding:0;color:#78350f">${pendingShopCardGrants.map(g => `<li><b>${g.name}</b> — $${g.unitPriceUsd.toFixed(2)} → grants $${g.walletCreditUsd.toFixed(2)} JCMOVES USD after verified payment</li>`).join("")}</ul>${lawnCareInvoiceUrl ? `<p style="margin:8px 0 0;font-size:12px;color:#92400e">Invoice published: <a href="${lawnCareInvoiceUrl}">${lawnCareInvoiceUrl}</a></p>` : ""}</div>`
      : "";
    const adminShopCardText = pendingShopCardGrants.length > 0
      ? `\n\n=== BUNDLED ADD-ONS (BILLABLE) ===\n` +
        pendingShopCardGrants.map(g => `• ${g.name} — $${g.unitPriceUsd.toFixed(2)} → grants $${g.walletCreditUsd.toFixed(2)} JCMOVES USD after verified payment`).join("\n") +
        (lawnCareInvoiceUrl ? `\nInvoice: ${lawnCareInvoiceUrl}` : "")
      : "";

    try {
      await sendEmail({
        to: companyEmail,
        from: companyEmail,
        subject: `New Lawn Care Quote — ${data.customerName}${bundleSubjectTag}${companionLeads.length > 0 ? ` [+${companionLeads.length} bundled]` : ""}`,
        text: `New lawn care quote request.\n\nCustomer: ${data.customerName}\nPhone: ${data.phone}\nEmail: ${data.email || "N/A"}\nAddress: ${data.address}\nService: ${data.serviceCategory} — ${data.serviceFrequency}\nSubtotal: $${pricing.totalQuoted.toFixed(2)}\nTotal: $${finalTotalQuoted.toFixed(2)}${pricing.isCustomEstimate ? " (custom estimate)" : ""}\nNotes: ${data.notes || "—"}${bundleNote}${bundleServicesText}${adminShopCardText}\n\n${briefText}`,
        html: `<h2>New Lawn Care Quote</h2><p><b>Customer:</b> ${data.customerName}<br><b>Phone:</b> ${data.phone}<br><b>Email:</b> ${data.email || "N/A"}<br><b>Address:</b> ${data.address}<br><b>Service:</b> ${data.serviceCategory} — ${data.serviceFrequency}<br><b>Subtotal:</b> $${pricing.totalQuoted.toFixed(2)}<br><b>Total:</b> $${finalTotalQuoted.toFixed(2)}${pricing.isCustomEstimate ? " <em>(custom estimate)</em>" : ""}</p>${bundleHtml}${bundleServicesHtml}${adminShopCardHtml}${briefHtml}`,
      });
    } catch (emailErr) {
      console.error("Lawn care admin email failed:", emailErr);
    }

    // Customer confirmation email — only when the customer also booked add-on
    // services. Shows them everything we scheduled in one place so they don't
    // wonder whether the bundled services "took". Solo lawn-care quotes
    // continue to rely on the existing lawn-care-only flow.
    // Task #199 — bundled shop-card add-ons get their own customer-
    // facing panel so the customer knows the $100 line on the invoice
    // is going to land in their JCMOVES wallet on payment.
    const shopCardLinesText = pendingShopCardGrants.length > 0
      ? "\n\nBundled add-ons (billed alongside this quote):\n" +
        pendingShopCardGrants.map(g => `• ${g.name} — pay $${g.unitPriceUsd.toFixed(2)}; receive $${g.walletCreditUsd.toFixed(2)} JCMOVES USD after verified payment`).join("\n") +
        "\n\nWhere can you spend the JCMOVES USD? On any future JC ON THE MOVE invoice — moving, junk, cleaning, lawn, trash valet, or Ashley's Shop. Applies $1 = $1 off."
      : "";
    const shopCardLinesHtml = pendingShopCardGrants.length > 0
      ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px 14px;margin:12px 0">
           <p style="margin:0 0 6px;font-weight:700;color:#b45309">🛍️ Bundled add-ons (billed with this quote)</p>
           <ul style="margin:0 0 8px 18px;padding:0;color:#78350f">${pendingShopCardGrants.map(g => `<li><b>${g.name}</b> — pay $${g.unitPriceUsd.toFixed(2)} <span style="color:#92400e">(receive $${g.walletCreditUsd.toFixed(2)} JCMOVES USD after verified payment)</span></li>`).join("")}</ul>
           <p style="margin:0;font-size:12px;color:#92400e">Where can you spend it? On any future JC ON THE MOVE invoice — moving, junk, cleaning, lawn, trash valet, or Ashley's Shop. Applies $1 = $1 off.</p>
         </div>`
      : "";

    if (data.email && (companionLeads.length > 0 || pendingShopCardGrants.length > 0)) {
      const customerLines = [
        `Lawn Care — ${data.serviceCategory.replace(/_/g, " ")} (${data.serviceFrequency.replace(/_/g, " ")})${data.requestedStartDate ? ` — preferred start ${data.requestedStartDate}` : ""}`,
        ...companionLeads.map(l => `${l.label}${l.startDate ? ` — preferred start ${l.startDate}` : " — we'll call to schedule"}`),
      ];
      // Surface the auto-applied bundle discount to the customer so they see
      // exactly what they saved by booking multiple services together.
      const discountLineText = bundleDiscount.applied
        ? `\n\nBundle discount applied: −$${bundleDiscount.amount.toFixed(2)} (10% off) — already baked into your $${finalTotalQuoted.toFixed(2)} lawn care total.`
        : "";
      const discountLineHtml = bundleDiscount.applied
        ? `<p style="background:#dcfce7;border:1px solid #22c55e;color:#166534;padding:10px 14px;border-radius:8px;margin:12px 0"><b>Bundle discount applied: −$${bundleDiscount.amount.toFixed(2)} (10% off)</b><br><span style="font-size:13px">Already baked into your <b>$${finalTotalQuoted.toFixed(2)}</b> lawn care total.</span></p>`
        : "";
      try {
        await sendEmail({
          to: data.email,
          from: companyEmail,
          subject: `We've got your bundle — ${customerLines.length} services scheduled${bundleDiscount.applied ? " (10% off applied)" : ""}${pendingShopCardGrants.length > 0 ? " + JCMOVES Shop Card" : ""}`,
          text: `Hi ${data.customerName.split(/\s+/)[0]},\n\nThanks for booking with us! Here's what we received:\n\n${customerLines.map(l => `• ${l}`).join("\n")}${discountLineText}${shopCardLinesText}${lawnCareInvoiceUrl ? `\n\nPay your invoice: ${lawnCareInvoiceUrl}` : ""}\n\nWe'll be in touch shortly to confirm each service. Reply to this email if anything looks off.\n\n— The team`,
          html: `<p>Hi ${data.customerName.split(/\s+/)[0]},</p><p>Thanks for booking with us! Here's what we received:</p><ul style="line-height:1.7">${customerLines.map(l => `<li>${l}</li>`).join("")}</ul>${discountLineHtml}${shopCardLinesHtml}${lawnCareInvoiceUrl ? `<p style="text-align:center;margin:18px 0"><a href="${lawnCareInvoiceUrl}" target="_blank" style="display:inline-block;background:#f97316;color:#fff;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none">Pay Invoice →</a></p>` : ""}<p>We'll be in touch shortly to confirm each service. Reply to this email if anything looks off.</p><p>— The team</p>`,
        });
      } catch (emailErr) {
        console.error("Lawn care bundle customer email failed:", emailErr);
      }
    }

    const responsePricing = bundleDiscount.applied
      ? { ...pricing, totalQuoted: finalTotalQuoted }
      : pricing;
    return res.json({
      success: true,
      quote,
      pricing: responsePricing,
      bundleDiscount,
      bundleGroupId,
      companionLeads,
      // Task #199 — surface shop-card bundle add-ons to the
      // confirmation screen so the customer sees what they'll be
      // billed for and where the credit lands.
      shopCardGrants: pendingShopCardGrants.map(g => ({
        addonId: g.addonId,
        name: g.name,
        amountUsd: g.unitPriceUsd,
        walletCreditUsd: g.walletCreditUsd,
        shortDescription: g.shortDescription,
      })),
      invoice: lawnCareInvoiceUrl ? { url: lawnCareInvoiceUrl, squareInvoiceId: lawnCareInvoiceId } : null,
    });
  } catch (err: any) {
    console.error("Lawn care quote error:", err);
    if (err?.name === "ZodError") return res.status(400).json({ error: "Invalid request", details: err.errors });
    return res.status(500).json({ error: "Failed to create quote" });
  }
});

// GET /api/lawn-care/lot-size?address=... — public; best-effort lot size detection
// Tries Regrid parcel data first (high confidence, real parcel boundary), then
// falls back to geocoding viewport math (low confidence, rough estimate).
// Returns { source, confidence, sourceLabel } so the UI can show how trustworthy
// the auto-detected lot size is.
//
// Throttled per-IP because every uncached lookup costs us a Google geocode
// (and possibly a Regrid hit). 30 lookups / 5 min covers a normal user
// experimenting with addresses but blocks scrapers.
router.get(
  "/lot-size",
  ipRateLimit({
    scope: "lawn_lot_size_ip",
    windowMs: 5 * 60_000,
    maxHits: 30,
    message: "Too many lot-size lookups. Try again in a few minutes.",
  }),
  async (req: Request, res: Response) => {
    maybePruneBuckets();
  const address = String(req.query.address || "").trim();
  if (address.length < 6) return res.json({ found: false });

  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!googleKey) return res.json({ found: false });

  try {
    // Step 1: Geocode the address to lat/lng (and capture bounds for fallback math)
    const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleKey}`;
    const geoRes = await fetch(geoUrl);
    if (!geoRes.ok) return res.json({ found: false });
    const geoData: any = await geoRes.json();
    const result = geoData?.results?.[0];
    if (!result?.geometry?.location) return res.json({ found: false });
    const { lat, lng } = result.geometry.location;
    const locationType: string | undefined = result.geometry.location_type;
    const bounds = result.geometry.bounds || result.geometry.viewport;

    // Step 2: Try Regrid (real parcel polygon — highest confidence)
    const regridKey = process.env.REGRID_API_KEY;
    if (regridKey) {
      try {
        const parcelUrl = `https://app.regrid.com/api/v2/parcels/point?lat=${lat}&lon=${lng}&token=${regridKey}`;
        const parcelRes = await fetch(parcelUrl);
        if (parcelRes.ok) {
          const parcelData: any = await parcelRes.json();
          const feature = parcelData?.parcels?.features?.[0];
          const props = feature?.properties?.fields;
          const ll_gisacre = props?.ll_gisacre;
          const ll_gissqft = props?.ll_gissqft;
          let sqFt: number | null = null;
          if (typeof ll_gissqft === "number" && ll_gissqft > 0) sqFt = Math.round(ll_gissqft);
          else if (typeof ll_gisacre === "number" && ll_gisacre > 0) sqFt = Math.round(ll_gisacre * 43560);
          if (sqFt && sqFt > 200) {
            const tier = sizeTierFromSqFt(sqFt);
            return res.json({
              found: true,
              source: "parcel",
              sourceLabel: "Measured from public parcel data",
              confidence: 0.95,
              squareFootage: sqFt,
              sizeTier: tier,
              sizeLabel: SIZE_TIER_RANGES[tier].label,
              lat, lng,
            });
          }
        }
      } catch (e) {
        console.warn("Regrid lookup failed (silent):", (e as Error).message);
      }
    }

    // Step 3: Viewport-bounds fallback — estimate area from the geocoder's
    // bounding box. Only meaningful for ROOFTOP / RANGE_INTERPOLATED hits;
    // otherwise the box is a whole street or city block and useless.
    if (
      bounds?.northeast && bounds?.southwest &&
      (locationType === "ROOFTOP" || locationType === "RANGE_INTERPOLATED")
    ) {
      const ne = bounds.northeast;
      const sw = bounds.southwest;
      const latDeg = ne.lat - sw.lat;
      const lngDeg = ne.lng - sw.lng;
      const centerLatRad = ((ne.lat + sw.lat) / 2) * (Math.PI / 180);
      const heightM = latDeg * 111_320;
      const widthM = lngDeg * 111_320 * Math.cos(centerLatRad);
      const areaM2 = Math.abs(heightM * widthM);
      const sqFt = Math.round(areaM2 * 10.7639);
      // Sanity: only return if result is in a plausible residential range
      // (1,000 sq ft up to ~3 acres). Anything bigger = block-level box.
      if (sqFt >= 1000 && sqFt <= 130_680) {
        const tier = sizeTierFromSqFt(sqFt);
        return res.json({
          found: true,
          source: "viewport",
          sourceLabel: "Rough estimate from map area",
          confidence: locationType === "ROOFTOP" ? 0.45 : 0.3,
          squareFootage: sqFt,
          sizeTier: tier,
          sizeLabel: SIZE_TIER_RANGES[tier].label,
          lat, lng,
        });
      }
    }

    return res.json({ found: false, lat, lng });
  } catch (err) {
    console.warn("lot-size error (silent):", (err as Error).message);
    return res.json({ found: false });
  }
});

// Persistent anti-abuse throttles for the public rebook + summary endpoints.
// State is stored in Postgres (rate_limit_buckets), so it survives process
// restarts — a determined scraper can no longer wait for the next deploy
// to reset the counter — and is shared across processes.
const REBOOK_THROTTLE_MS = 30_000;
const SUMMARY_WINDOW_MS = 60_000;
const SUMMARY_MAX_HITS = 20;

// Opportunistic housekeeping so the table doesn't accumulate forever.
// Fires at most once every 15 min per process and is fire-and-forget.
let lastPruneAt = 0;
function maybePruneBuckets() {
  const now = Date.now();
  if (now - lastPruneAt < 15 * 60_000) return;
  lastPruneAt = now;
  pruneStaleBuckets().catch(() => {});
}

// Geocode + haversine helper. Mirrors the logic in
// /api/utility/estimate-drive-miles so rebook pricing reproduces the
// same travel-fee outcome the original quote saw without an HTTP self-call.
const BASE_LAT = 46.4539; // Ironwood, MI
const BASE_LNG = -90.1715;
function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
async function estimateDistanceMiles(address: string | null | undefined): Promise<number> {
  if (!address || address.trim().length < 4) return 0;
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=us`;
    const r = await fetch(url, { headers: { "User-Agent": "JCOnTheMove/1.0 contact@jcontmove.com" } });
    if (!r.ok) return 0;
    const data = (await r.json()) as Array<{ lat: string; lon: string }>;
    if (!data?.length) return 0;
    return haversineMiles(BASE_LAT, BASE_LNG, parseFloat(data[0].lat), parseFloat(data[0].lon));
  } catch {
    return 0;
  }
}

function maskAddress(addr: string | null | undefined): string {
  if (!addr) return "your address on file";
  // "712 Wilson St, Ironwood, MI 49938" -> "712 W••••• St, Ironwood, MI"
  const parts = addr.split(",").map(p => p.trim());
  const street = parts[0] || "";
  const tokens = street.split(/\s+/);
  const masked = tokens.map((t, i) => {
    if (i === 0) return t; // keep house number
    if (/^(St|Ave|Rd|Blvd|Ln|Dr|Ct|Way|Pl|Pkwy|Hwy)\.?$/i.test(t)) return t;
    if (t.length <= 1) return t;
    return t[0] + "•".repeat(Math.max(3, t.length - 1));
  }).join(" ");
  const tail = parts.slice(1, 3).join(", "); // city, state — drop zip
  return tail ? `${masked}, ${tail}` : masked;
}

function maskEmail(email: string | null | undefined): string {
  if (!email) return "—";
  const [local, domain] = email.split("@");
  if (!domain) return "—";
  const maskedLocal = local.length <= 2 ? local[0] + "•" : local[0] + "•".repeat(Math.max(2, local.length - 2)) + local.slice(-1);
  return `${maskedLocal}@${domain}`;
}
function maskPhone(phone: string | null | undefined): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 4) return "—";
  return `•••-•••-${digits.slice(-4)}`;
}

function maskName(name: string | null | undefined): string {
  if (!name) return "Returning customer";
  const tokens = name.trim().split(/\s+/);
  const first = tokens[0] || "";
  const last = tokens[1] || "";
  return last ? `${first} ${last[0]}.` : first;
}

// GET /api/lawn-care/last-quote-summary?phone=... — PUBLIC.
// Returns a redacted summary of the customer's most recent lawn quote so
// they can confirm "yes that's me" before tapping re-book. Never returns
// raw email, full name, full address, or notes — only what's needed to
// recognize the prior service.
router.get("/last-quote-summary", async (req: Request, res: Response) => {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
  maybePruneBuckets();
  const allowed = await checkSlidingWindow("lawn_summary_ip", ip, SUMMARY_WINDOW_MS, SUMMARY_MAX_HITS);
  if (!allowed) {
    return res.status(429).json({ found: false, error: "Too many lookups. Try again in a minute." });
  }
  const phoneRaw = String(req.query.phone || "");
  const digits = phoneRaw.replace(/\D/g, "");
  if (digits.length < 7) return res.json({ found: false });

  try {
    const rows = await db
      .select()
      .from(lawnCareQuotes)
      .where(sql`regexp_replace(${lawnCareQuotes.phone}, '\\D', '', 'g') = ${digits}`)
      .orderBy(desc(lawnCareQuotes.createdAt))
      .limit(1);

    if (rows.length === 0) return res.json({ found: false });
    const q = rows[0];
    const rawIds = ((q.addOns as string[]) || []);
    const addOnIds = rawIds;
    const addOnLabels = rawIds.map((id) => ADD_ON_LABELS[id] || id);

    return res.json({
      found: true,
      summary: {
        nameDisplay: maskName(q.customerName),
        addressMasked: maskAddress(q.address),
        serviceCategory: q.serviceCategory,
        serviceFrequency: q.serviceFrequency,
        propertySize: q.propertySize,
        propertyCondition: q.propertyCondition,
        addOnIds,
        addOnLabels,
        // Back-compat: keep `addOns` as labels for any older client cache.
        addOns: addOnLabels,
        lastTotal: q.totalQuoted,
        isCustomEstimate: !!q.isCustomEstimate,
        lastDate: q.createdAt,
      },
    });
  } catch (err) {
    console.error("last-quote-summary error:", err);
    return res.status(500).json({ error: "Lookup failed" });
  }
});

// Attribution allow-list. Anything outside this set is silently coerced to
// "organic" so arbitrary user-supplied utm strings can't pollute the
// dashboard, but the re-book is still tracked as a re-book (not lumped in
// with brand-new leads).
const ORGANIC_REBOOK_SOURCE = "organic";
const ALLOWED_REBOOK_SOURCES = new Set([REBOOK_EMAIL_SOURCE, ORGANIC_REBOOK_SOURCE]);

// GET /api/lawn-care/rebook-unsubscribe?email=...&phone=...&token=... — PUBLIC.
// One-click unsubscribe from re-book reminder emails. The token is an HMAC
// over (normalized email + phone), so we don't need to store a per-link
// secret — verifying the token is enough to know the click came from a
// legitimate email we sent. Idempotent: clicking twice still succeeds.
router.get("/rebook-unsubscribe", async (req: Request, res: Response) => {
  const email = typeof req.query.email === "string" ? req.query.email : "";
  const phone = typeof req.query.phone === "string" ? req.query.phone : "";
  const token = typeof req.query.token === "string" ? req.query.token : "";

  const renderPage = (title: string, body: string, status = 200) => {
    res.status(status).type("html").send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
</head>
<body style="margin:0;background:#0f172a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#e2e8f0;">
  <div style="max-width:520px;margin:60px auto;padding:32px 28px;background:#1e293b;border-radius:14px;text-align:center;">
    <div style="font-size:13px;font-weight:700;color:#84cc16;letter-spacing:2px;margin-bottom:10px;">JC ON THE MOVE</div>
    <h1 style="margin:0 0 12px;font-size:22px;color:#fff;">${title}</h1>
    <div style="font-size:14px;color:#94a3b8;line-height:1.6;">${body}</div>
  </div>
</body></html>`);
  };

  if ((!email && !phone) || !token) {
    return renderPage("Invalid unsubscribe link", "This unsubscribe link is missing required information. If you keep getting reminders, just reply to one of our emails and we'll remove you manually.", 400);
  }
  if (!verifyUnsubscribeToken(token, email, phone)) {
    return renderPage("Invalid unsubscribe link", "We couldn't verify this unsubscribe link. If you keep getting reminders, just reply to one of our emails and we'll remove you manually.", 400);
  }

  try {
    await recordOptout(email, phone, "email_link");
    return renderPage(
      "You're unsubscribed",
      "You won't receive any more re-book reminder emails from us. If this was a mistake, just reply to one of our past emails and we'll add you back.",
    );
  } catch (err) {
    console.error("Re-book unsubscribe error:", err);
    return renderPage(
      "Something went wrong",
      "We couldn't process your unsubscribe right now. Please try again in a moment, or reply to one of our emails and we'll remove you manually.",
      500,
    );
  }
});

// POST /api/lawn-care/rebook — PUBLIC. Body: { phone, source? }.
// Re-creates a fresh lawn-care quote from the customer's most recent
// matching quote, recomputing pricing with today's engine. Sends the
// same admin email as a brand-new quote.
router.post("/rebook", async (req: Request, res: Response) => {
  const phoneRaw = String((req.body || {}).phone || "");
  const digits = phoneRaw.replace(/\D/g, "");
  if (digits.length < 7) return res.status(400).json({ error: "Invalid phone" });

  // Accept attribution from the body (forwarded by the client from the
  // utm_source query param it received via the deep link). Drop anything
  // not on the allow-list so we never store junk.
  const sourceRaw = String((req.body || {}).source || "").trim().toLowerCase();
  // Default to "organic" so every re-book is tagged. This lets the admin
  // attribution stat distinguish a returning customer who came back on
  // their own from a brand-new lead (which still has rebookSource = NULL).
  const rebookSource = ALLOWED_REBOOK_SOURCES.has(sourceRaw) ? sourceRaw : ORGANIC_REBOOK_SOURCE;

  // Composite throttle: per-phone AND per-IP+phone, both 30s. Stops
  // accidental double-taps and stops a single client from cycling phones.
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
  const compositeKey = `${ip}|${digits}`;
  maybePruneBuckets();
  const [waitPhone, waitComposite] = await Promise.all([
    checkCooldown("lawn_rebook_phone", digits, REBOOK_THROTTLE_MS),
    checkCooldown("lawn_rebook_ip_phone", compositeKey, REBOOK_THROTTLE_MS),
  ]);
  const waitMs = Math.max(waitPhone, waitComposite);
  if (waitMs > 0) {
    res.setHeader("Retry-After", Math.ceil(waitMs / 1000).toString());
    return res.status(429).json({
      error: "Please wait a moment before requesting another quote.",
      retryAfterMs: waitMs,
    });
  }

  try {
    const rows = await db
      .select()
      .from(lawnCareQuotes)
      .where(sql`regexp_replace(${lawnCareQuotes.phone}, '\\D', '', 'g') = ${digits}`)
      .orderBy(desc(lawnCareQuotes.createdAt))
      .limit(1);

    if (rows.length === 0) {
      return res.status(404).json({ error: "No previous quote found for that phone." });
    }
    const prev = rows[0];

    // Recompute drive distance from the saved address so travel-fee
    // parity holds vs. a fresh booking. Falls back to 0 silently.
    const distanceMiles = await estimateDistanceMiles(prev.address);

    const pricing = calculateLawnCareQuote({
      serviceCategory: prev.serviceCategory,
      serviceFrequency: prev.serviceFrequency,
      propertySize: prev.propertySize,
      squareFootage: prev.squareFootage ?? undefined,
      propertyCondition: prev.propertyCondition,
      addOns: (prev.addOns as string[]) || [],
      hasFence: !!prev.hasFence,
      hasPets: !!prev.hasPets,
      hasSteepSlope: !!prev.hasSteepSlope,
      needsHaulAway: !!prev.needsHaulAway,
      zip: prev.zip || undefined,
      distanceMiles,
    });

    await Promise.all([
      markCooldown("lawn_rebook_phone", digits),
      markCooldown("lawn_rebook_ip_phone", compositeKey),
    ]);

    const [quote] = await db.insert(lawnCareQuotes).values({
      customerName: prev.customerName,
      phone: prev.phone,
      email: prev.email,
      address: prev.address,
      city: prev.city,
      state: prev.state,
      zip: prev.zip,
      serviceType: "lawn_care",
      serviceCategory: prev.serviceCategory,
      serviceFrequency: prev.serviceFrequency,
      propertySize: prev.propertySize,
      squareFootage: prev.squareFootage ?? undefined,
      propertyCondition: prev.propertyCondition,
      addOns: prev.addOns as string[],
      notes: prev.notes ? `[Re-booked] ${prev.notes}` : "[Re-booked from previous quote]",
      hasFence: !!prev.hasFence,
      hasPets: !!prev.hasPets,
      hasSteepSlope: !!prev.hasSteepSlope,
      needsHaulAway: !!prev.needsHaulAway,
      recommendedCrewType: pricing.recommendedCrewType,
      recommendedCrewSize: pricing.recommendedCrewSize,
      basePrice: String(pricing.basePrice),
      conditionMultiplier: String(pricing.conditionMultiplier),
      frequencyMultiplier: String(pricing.frequencyMultiplier),
      addOnTotal: String(pricing.addOnTotal),
      travelFee: String(pricing.travelFee),
      totalQuoted: String(pricing.totalQuoted),
      isCustomEstimate: pricing.isCustomEstimate,
      status: "quote_requested",
      rebookSource,
    }).returning();

    await emitStandaloneQuoteOpportunity({
      eventId: `lawn-care-rebook:${quote.id}`,
      referenceId: `lawn-care-${quote.id}`,
      customerName: prev.customerName,
      serviceType: "lawn_care",
      requestedDate: null,
      source: "lawn_care_rebook",
      adminPath: "/admin/lawn-care",
    });

    if (prev.email) {
      disburseServiceTokens({
        serviceType: "lawn_care",
        referenceId: String(quote.id),
        customerEmail: prev.email,
        totalPrice: pricing.totalQuoted,
      }).catch(err => console.error("Lawn care rebook token disburse error:", err));
    }

    const companyEmail = process.env.COMPANY_EMAIL || "michigankid906@gmail.com";
    const briefHtml = buildJobBriefHtml(quote, pricing);
    const briefText = buildJobBriefText(quote, pricing);
    const sourceTag = rebookSource ? ` [via ${rebookSource}]` : "";
    try {
      await sendEmail({
        to: companyEmail,
        from: companyEmail,
        subject: `Lawn Care Re-Book — ${prev.customerName}${sourceTag}`,
        text: `Returning customer re-booked their last service.\n\nCustomer: ${prev.customerName}\nPhone: ${prev.phone}\nEmail: ${prev.email || "N/A"}\nAddress: ${prev.address}\nService: ${prev.serviceCategory} — ${prev.serviceFrequency}\nTotal: $${pricing.totalQuoted}${pricing.isCustomEstimate ? " (custom estimate)" : ""}\n\n${briefText}`,
        html: `<h2>🔁 Lawn Care Re-Book</h2><p>Returning customer tapped re-book.</p><p><b>Customer:</b> ${prev.customerName}<br><b>Phone:</b> ${prev.phone}<br><b>Email:</b> ${prev.email || "N/A"}<br><b>Address:</b> ${prev.address}<br><b>Service:</b> ${prev.serviceCategory} — ${prev.serviceFrequency}<br><b>Total:</b> $${pricing.totalQuoted}${pricing.isCustomEstimate ? " <em>(custom estimate)</em>" : ""}</p>${briefHtml}`,
      });
    } catch (emailErr) {
      console.error("Lawn care rebook admin email failed:", emailErr);
    }

    return res.json({ success: true, quote, pricing, rebooked: true });
  } catch (err) {
    console.error("Lawn care rebook error:", err);
    return res.status(500).json({ error: "Failed to re-book" });
  }
});

// GET /api/lawn-care/by-phone?phone=... — crew or admin only.
// Returns the minimum fields required to render the on-job crew brief
// for the most recent matching lawn care quote.
router.get("/by-phone", requireAuth, requireCrewOrAdminRole, async (req: Request, res: Response) => {
  const phoneRaw = String(req.query.phone || "");
  const digits = phoneRaw.replace(/\D/g, "");
  if (digits.length < 7) return res.status(400).json({ error: "Invalid phone" });

  try {
    const rows = await db
      .select()
      .from(lawnCareQuotes)
      .where(sql`regexp_replace(${lawnCareQuotes.phone}, '\\D', '', 'g') = ${digits}`)
      .orderBy(desc(lawnCareQuotes.createdAt))
      .limit(1);

    if (rows.length === 0) return res.json({ found: false });
    const quote = rows[0];

    // Recompute pricing breakdown for shared rendering
    const pricing = calculateLawnCareQuote({
      serviceCategory: quote.serviceCategory,
      serviceFrequency: quote.serviceFrequency,
      propertySize: quote.propertySize,
      squareFootage: quote.squareFootage ?? undefined,
      propertyCondition: quote.propertyCondition,
      addOns: (quote.addOns as string[]) || [],
      hasFence: !!quote.hasFence,
      hasPets: !!quote.hasPets,
      hasSteepSlope: !!quote.hasSteepSlope,
      needsHaulAway: !!quote.needsHaulAway,
      zip: quote.zip || undefined,
    });

    // Least-privilege payload: only fields the crew brief renders.
    const safeQuote = {
      id: quote.id,
      serviceCategory: quote.serviceCategory,
      serviceFrequency: quote.serviceFrequency,
      propertySize: quote.propertySize,
      propertyCondition: quote.propertyCondition,
      addOns: (quote.addOns as string[]) || [],
      hasFence: !!quote.hasFence,
      hasPets: !!quote.hasPets,
      hasSteepSlope: !!quote.hasSteepSlope,
      needsHaulAway: !!quote.needsHaulAway,
      notes: quote.notes ?? null,
    };

    return res.json({ found: true, quote: safeQuote, pricing });
  } catch (err) {
    console.error("by-phone lookup error:", err);
    return res.status(500).json({ error: "Lookup failed" });
  }
});

// GET /api/lawn-care/quotes — admin only
router.get("/quotes", requireAuth, requireAdminRole, async (_req: Request, res: Response) => {
  try {
    const quotes = await db.select().from(lawnCareQuotes).orderBy(desc(lawnCareQuotes.createdAt));
    return res.json(quotes);
  } catch (err) {
    console.error("Fetch lawn care quotes error:", err);
    return res.status(500).json({ error: "Failed to fetch quotes" });
  }
});

// POST /api/lawn-care/approve/:id — admin only
router.post("/approve/:id", requireAuth, requireAdminRole, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [updated] = await db.update(lawnCareQuotes)
      .set({ status: "approved" })
      .where(eq(lawnCareQuotes.id, id))
      .returning();
    return res.json({ success: true, quote: updated });
  } catch (err) {
    console.error("Approve lawn care quote error:", err);
    return res.status(500).json({ error: "Failed to approve quote" });
  }
});

// POST /api/lawn-care/mark-paid/:id — admin only
router.post("/mark-paid/:id", requireAuth, requireAdminRole, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [updated] = await db.update(lawnCareQuotes)
      .set({ status: "paid" })
      .where(eq(lawnCareQuotes.id, id))
      .returning();
    return res.json({ success: true, quote: updated });
  } catch (err) {
    console.error("Mark paid lawn care quote error:", err);
    return res.status(500).json({ error: "Failed to mark quote as paid" });
  }
});

// POST /api/lawn-care/activate-plan/:id — admin only (idempotent)
router.post("/activate-plan/:id", requireAuth, requireAdminRole, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [quote] = await db.select().from(lawnCareQuotes).where(eq(lawnCareQuotes.id, id));
    if (!quote) return res.status(404).json({ error: "Quote not found" });

    const existing = await db.select().from(lawnCarePlans).where(eq(lawnCarePlans.quoteId, id));
    if (existing.length > 0) {
      return res.json({ success: true, plan: existing[0], alreadyActive: true });
    }

    await db.update(lawnCareQuotes)
      .set({ status: "plan_active" })
      .where(eq(lawnCareQuotes.id, id));

    const [plan] = await db.insert(lawnCarePlans).values({
      quoteId: id,
      customerName: quote.customerName,
      phone: quote.phone,
      email: quote.email,
      address: quote.address,
      city: quote.city,
      state: quote.state,
      zip: quote.zip,
      frequency: quote.serviceFrequency,
      startDate: quote.requestedStartDate || new Date().toISOString().split("T")[0],
      nextServiceDate: quote.requestedStartDate || new Date().toISOString().split("T")[0],
      isActive: true,
      crewType: quote.recommendedCrewType,
      crewSize: quote.recommendedCrewSize,
      serviceCategory: quote.serviceCategory,
      propertySize: quote.propertySize,
      propertyCondition: quote.propertyCondition,
      addOns: quote.addOns as string[],
      recurringPrice: quote.totalQuoted,
      notes: quote.notes,
    }).returning();

    return res.json({ success: true, plan });
  } catch (err) {
    console.error("Activate lawn care plan error:", err);
    return res.status(500).json({ error: "Failed to activate plan" });
  }
});

// Attribution stat: re-books in the last `windowDays`, broken down by the
// rebookSource marker (rebook_email, organic = no marker, etc.) plus the
// number of reminder emails sent in that same window so each source can
// show its own conversion rate. Computed live from existing tables — no
// new counters — so the numbers stay correct after backfills/edits.
const REBOOK_ATTRIBUTION_WINDOW_DAYS = 60;
const ORGANIC_SOURCE = "organic";
const REBOOK_SOURCE_LABELS: Record<string, string> = {
  [REBOOK_EMAIL_SOURCE]: "Re-book Email",
  [ORGANIC_SOURCE]: "Organic (no source)",
};
function labelForSource(source: string): string {
  return REBOOK_SOURCE_LABELS[source] || source.replace(/_/g, " ");
}
type SourceStat = {
  source: string;
  label: string;
  rebooks: number;
  reminders: number | null;
  conversionRate: number | null;
  paidRebooks: number;
  paidRevenue: number;
};
async function getRebookAttributionStats(windowDays: number = REBOOK_ATTRIBUTION_WINDOW_DAYS) {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // Re-books grouped by source. The /rebook endpoint always tags every
  // re-booking with a source (defaulting to "organic"), so any non-NULL
  // rebookSource row is a real re-book — brand-new leads stay NULL and
  // are correctly excluded.
  const groupRows = await db
    .select({
      source: sql<string>`${lawnCareQuotes.rebookSource}`,
      n: sql<number>`count(*)::int`,
    })
    .from(lawnCareQuotes)
    .where(sql`${lawnCareQuotes.rebookSource} IS NOT NULL AND ${lawnCareQuotes.createdAt} >= ${cutoff}`)
    .groupBy(lawnCareQuotes.rebookSource);

  // Paid revenue + count of paid/completed quotes per source — closes the
  // loop on ROI by counting dollars actually delivered, not just leads.
  const paidRows = await db
    .select({
      source: sql<string>`${lawnCareQuotes.rebookSource}`,
      n: sql<number>`count(*)::int`,
      revenue: sql<string>`coalesce(sum(${lawnCareQuotes.totalQuoted}), 0)::text`,
    })
    .from(lawnCareQuotes)
    .where(sql`${lawnCareQuotes.rebookSource} IS NOT NULL AND ${lawnCareQuotes.createdAt} >= ${cutoff} AND ${lawnCareQuotes.status} IN ('paid','completed')`)
    .groupBy(lawnCareQuotes.rebookSource);

  // Reminders dispatched (status='sent') in the window — only meaningful
  // for the rebook_email source today.
  const [remRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(lawnCareRebookReminders)
    .where(sql`${lawnCareRebookReminders.status} = 'sent' AND ${lawnCareRebookReminders.sentAt} >= ${cutoff}`);
  const reminders = Number(remRow?.n || 0);

  const counts = new Map<string, number>();
  for (const r of groupRows) counts.set(r.source, Number(r.n || 0));
  // Always include the known sources so the card has stable rows even at
  // zero. Future channels (sms, social, …) get added as soon as one
  // re-book lands with that tag.
  for (const known of [REBOOK_EMAIL_SOURCE, ORGANIC_SOURCE]) {
    if (!counts.has(known)) counts.set(known, 0);
  }

  const paidBySource = new Map<string, { count: number; revenue: number }>();
  for (const r of paidRows) {
    paidBySource.set(r.source, {
      count: Number(r.n || 0),
      revenue: Number(r.revenue || 0),
    });
  }

  const bySource: SourceStat[] = Array.from(counts.entries())
    .map(([source, rebooks]) => {
      const isEmail = source === REBOOK_EMAIL_SOURCE;
      const sourceReminders = isEmail ? reminders : null;
      const conversionRate =
        sourceReminders && sourceReminders > 0 ? rebooks / sourceReminders : null;
      const paid = paidBySource.get(source) || { count: 0, revenue: 0 };
      return {
        source,
        label: labelForSource(source),
        rebooks,
        reminders: sourceReminders,
        conversionRate,
        paidRebooks: paid.count,
        paidRevenue: paid.revenue,
      };
    })
    .sort((a, b) => b.rebooks - a.rebooks || a.label.localeCompare(b.label));

  const totalRebooks = bySource.reduce((sum, s) => sum + s.rebooks, 0);
  const emailRow = bySource.find(s => s.source === REBOOK_EMAIL_SOURCE);
  // Top-level fields preserved for back-compat with any existing readers.
  return {
    windowDays,
    rebooks: emailRow?.rebooks ?? 0,
    reminders,
    conversionRate: emailRow?.conversionRate ?? null,
    paidRebooks: emailRow?.paidRebooks ?? 0,
    paidRevenue: emailRow?.paidRevenue ?? 0,
    totalRebooks,
    bySource,
  };
}

// GET /api/lawn-care/rebook-reminders/attribution — admin only
async function rebookAttributionHandler(_req: Request, res: Response) {
  try {
    const stats = await getRebookAttributionStats();
    return res.json(stats);
  } catch (err) {
    console.error("Re-book attribution error:", err);
    return res.status(500).json({ error: "Failed to compute attribution" });
  }
}

// GET /api/lawn-care/rebook-reminders/preview — admin only
// Lists customers eligible for a re-book email, plus a render of the first email.
async function rebookReminderPreviewHandler(_req: Request, res: Response) {
  try {
    // Uncapped: preview must report the TRUE count of customers who would
    // receive a reminder. We slice for the displayed sample list separately.
    const allEligible = await findEligibleRebookReminders();
    const eligible = allEligible.slice(0, 50);
    const sample = eligible[0]
      ? buildRebookReminderEmail({
          customerName: eligible[0].customerName,
          phone: eligible[0].phone,
          email: eligible[0].email,
          serviceCategory: eligible[0].serviceCategory,
          totalQuoted: eligible[0].totalQuoted,
          lastServiceAt: eligible[0].updatedAt,
        })
      : null;
    return res.json({
      eligibilityDays: REBOOK_ELIGIBILITY_DAYS,
      resendWindowDays: REBOOK_RESEND_WINDOW_DAYS,
      eligibleCount: allEligible.length,
      sampleSize: eligible.length,
      eligible: eligible.map(q => ({
        id: q.id,
        customerName: maskName(q.customerName),
        email: maskEmail(q.email),
        phone: maskPhone(q.phone),
        serviceCategory: q.serviceCategory,
        totalQuoted: q.totalQuoted,
        lastUpdated: q.updatedAt,
      })),
      sampleEmail: sample,
      lastRun: getLastSweepInfo(),
      attribution: await getRebookAttributionStats().catch(() => null),
    });
  } catch (err) {
    console.error("Re-book reminder preview error:", err);
    return res.status(500).json({ error: "Failed to load preview" });
  }
}

async function rebookReminderSendHandler(_req: Request, res: Response) {
  try {
    const result = await runRebookReminderSweep(undefined, "manual");
    return res.json({ success: true, ...result, lastRun: getLastSweepInfo() });
  } catch (err) {
    console.error("Re-book reminder send error:", err);
    return res.status(500).json({ error: "Failed to send reminders" });
  }
}

// Canonical admin handler paths (singular "rebook-reminder"). The router
// is mounted at BOTH "/api/lawn-care" and "/api/admin/lawn-care" so these
// resolve to the spec'd "/api/admin/lawn-care/rebook-reminder/{preview,send}"
// as well as a lawn-care-prefixed twin. Both still require admin auth.
router.get("/rebook-reminder/preview", requireAuth, requireAdminRole, rebookReminderPreviewHandler);
router.post("/rebook-reminder/send", requireAuth, requireAdminRole, rebookReminderSendHandler);
router.get("/rebook-reminder/attribution", requireAuth, requireAdminRole, rebookAttributionHandler);

// Back-compat aliases — earlier versions of the admin UI used these.
router.get("/rebook-reminders/preview", requireAuth, requireAdminRole, rebookReminderPreviewHandler);
router.post("/rebook-reminders/send", requireAuth, requireAdminRole, rebookReminderSendHandler);
router.get("/rebook-reminders/attribution", requireAuth, requireAdminRole, rebookAttributionHandler);

// GET /api/lawn-care/plans — admin only
router.get("/plans", requireAuth, requireAdminRole, async (_req: Request, res: Response) => {
  try {
    const plans = await db.select().from(lawnCarePlans).orderBy(desc(lawnCarePlans.createdAt));
    return res.json(plans);
  } catch (err) {
    console.error("Fetch lawn care plans error:", err);
    return res.status(500).json({ error: "Failed to fetch plans" });
  }
});

export default router;

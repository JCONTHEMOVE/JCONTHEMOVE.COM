import crypto from "crypto";
import { getPushReadiness } from './pushConfig';
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import { notificationService } from "./notification";
import {
  hasJobAlertDelivery,
  hasSuccessfulJobWebhookDelivery,
  recordJobAlertDelivery,
  recordJobWebhookDelivery,
} from "./jobAlertDelivery";
import { leads, users, type Lead } from "@shared/schema";

export type JobEventType =
  | "quote_requested"
  | "quote_sent"
  | "job_available"
  | "crew_claimed"
  | "crew_selected"
  | "crew_plan_saved"
  | "crew_assigned"
  | "job_updated"
  | "job_completed"
  | "jcmoves_pending"
  | "jcmoves_disbursed"
  | "upcoming_job_reminder";

type RecipientScope = "owners" | "all_crew" | "eligible_crew" | "assigned_crew" | "owners_and_assigned_crew" | "owners_and_all_crew" | "owners_and_eligible_crew";

interface EmitJobEventOptions {
  /** Stable caller-provided key makes a retried mutation idempotent. */
  eventId?: string;
  actorId?: string | null;
  source?: string;
  note?: string;
  previousStatus?: string | null;
  status?: string | null;
  recipientUserIds?: string[];
  extra?: Record<string, unknown>;
}

interface JobEventMessage {
  title: string;
  message: string;
  notificationType: "quote_request" | "crew_opportunity" | "crew_selected" | "job_assigned" | "job_status_change" | "jcmoves_pending" | "upcoming_job_reminder" | "system_alert" | "reward_available";
  scope: RecipientScope;
}

type UserRecipient = {
  id: string;
  email: string | null;
  role: string | null;
  jobAlertChannelPreference: string | null;
};

const OWNER_EMAILS = new Set([
  "upmichiganstatemovers@gmail.com",
  "michigankid906@gmail.com",
]);

const WEBHOOK_ENV_KEYS = [
  "JC_JOB_EVENT_WEBHOOK_URLS",
  "JOB_EVENT_WEBHOOK_URLS",
  "DISCORD_JOB_WEBHOOK_URL",
  "DISCORD_WEBHOOK_URL",
] as const;

export function parseJobEventWebhookUrls(env: NodeJS.ProcessEnv = process.env): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const key of WEBHOOK_ENV_KEYS) {
    for (const rawUrl of String(env[key] || "").split(",")) {
      const url = rawUrl.trim();
      if (!url || seen.has(url)) continue;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
      } catch {
        continue;
      }
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

function currentWebhookUrls() {
  return parseJobEventWebhookUrls();
}

function currentWebhookSecret() {
  return process.env.JC_JOB_EVENT_WEBHOOK_SECRET || process.env.JOB_EVENT_WEBHOOK_SECRET || "";
}

function webhookProvider(url: string) {
  if (url.includes("discord.com/api/webhooks") || url.includes("discordapp.com/api/webhooks")) return "discord";
  if (url.includes("hooks.slack.com")) return "slack";
  return "generic";
}

export function getJobEventWebhookReadiness() {
  const urls = currentWebhookUrls();
  return {
    configured: urls.length > 0,
    configuredCount: urls.length,
    providers: Array.from(new Set(urls.map(webhookProvider))),
    signingSecretConfigured: Boolean(currentWebhookSecret()),
    pushConfigured: getPushReadiness().ready,
    push: getPushReadiness(),
  };
}

function customerName(lead: Pick<Lead, "firstName" | "lastName">) {
  return `${lead.firstName || ""} ${lead.lastName || ""}`.trim() || "Customer";
}

function displayService(lead: Pick<Lead, "serviceType">) {
  return String(lead.serviceType || "job").replace(/_/g, " ");
}

function formatLeadPrice(lead: Pick<Lead, "totalPrice" | "basePrice">) {
  const amount = Number(lead.totalPrice || lead.basePrice || 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return `$${amount.toFixed(2)}`;
}

function adminLeadUrl(leadId: string) {
  return `/lead/${encodeURIComponent(leadId)}?returnTo=${encodeURIComponent("/admin/schedule")}`;
}

function crewLeadUrl(leadId: string) {
  return `/lead/${encodeURIComponent(leadId)}?returnTo=${encodeURIComponent("/crew")}`;
}

function appBaseUrl() {
  return process.env.PUBLIC_APP_URL || process.env.APP_URL || process.env.CLIENT_URL || "https://www.jconthemove.com";
}

function absoluteAppUrl(path: string) {
  try {
    return new URL(path, appBaseUrl()).toString();
  } catch {
    return path;
  }
}

function messageFor(type: JobEventType, lead: Lead, options: EmitJobEventOptions): JobEventMessage {
  const name = customerName(lead);
  const service = displayService(lead);
  const date = lead.confirmedDate || lead.moveDate || "date TBD";
  const arrival = lead.arrivalWindow ? `, ${lead.arrivalWindow} Central` : "";

  switch (type) {
    case "quote_requested":
      return {
        scope: "owners_and_all_crew",
        notificationType: "crew_opportunity",
        title: "Possible Job Opportunity",
        message: `A ${service} request is ready for crew-size and quote sampling for ${date}. Open the quote board to make a selection and build booking progress.`,
      };
    case "quote_sent": {
      const total = formatLeadPrice(lead);
      const hasPaymentUrl = Boolean(options.extra?.paymentUrl);
      return {
        scope: "owners",
        notificationType: "system_alert",
        title: "Quote Sent",
        message: `${service} quote for ${name} was sent${total ? ` for ${total}` : ""}.${hasPaymentUrl ? " Payment link is ready." : ""}`,
      };
    }
    case "job_available":
      return {
        scope: "eligible_crew",
        notificationType: "system_alert",
        title: "New Job Available",
        message: `${service} job for ${name} is open for crew on ${date}.`,
      };
    case "crew_claimed":
      return {
        scope: "owners",
        notificationType: "job_status_change",
        title: "Crew Claim Needs Review",
        message: `A crew member claimed a slot on ${name}'s ${service} job. Confirm the crew and dispatch when it is ready.`,
      };
    case "crew_selected":
      return {
        scope: "assigned_crew",
        notificationType: "crew_selected",
        title: "Selected for a Job",
        message: `You've been selected for ${name}'s ${service} job on ${date}${arrival}. Open it to review your schedule and estimated earnings.`,
      };
    case "crew_plan_saved":
      return {
        scope: "assigned_crew",
        notificationType: "job_assigned",
        title: "Crew Plan Saved",
        message: `You are tentatively planned for ${name}'s ${service} job on ${date}${arrival}. This is not a dispatch confirmation yet.`,
      };
    case "crew_assigned":
      return {
        scope: "assigned_crew",
        notificationType: "job_assigned",
        title: "Job Assigned",
        message: `You are assigned to ${name}'s ${service} job on ${date}.`,
      };
    case "job_completed":
      return {
        scope: "owners_and_assigned_crew",
        notificationType: "job_status_change",
        title: "Job Completed",
        message: `${name}'s ${service} job is complete. Payout and JCMOVES flow can run.`,
      };
    case "jcmoves_pending":
      return {
        scope: "owners_and_assigned_crew",
        notificationType: "jcmoves_pending",
        title: "JCMOVES Pending",
        message: `${name}'s ${service} job is complete, but JCMOVES have not been disbursed yet. ${String(options.extra?.pendingReason || "An administrator can review the payout status.")}`,
      };
    case "jcmoves_disbursed": {
      const total = Number(options.extra?.crewTokenTotal || 0);
      return {
        scope: "owners_and_assigned_crew",
        notificationType: "reward_available",
        title: "JCMOVES Paid",
        message: `${name}'s ${service} job has been settled${total > 0 ? ` with ${total.toLocaleString()} JCMOVES paid to the crew` : " and crew JCMOVES were deposited"}. Open Earnings to review the ledger.`,
      };
    }
    case "upcoming_job_reminder":
      return {
        scope: "assigned_crew",
        notificationType: "upcoming_job_reminder",
        title: "Upcoming Job Reminder",
        message: `You are scheduled for ${name}'s ${service} job on ${date}. Check your crew calendar for the arrival window and job details.`,
      };
    case "job_updated":
    default:
      return {
        scope: "owners",
        notificationType: "job_status_change",
        title: "Job Updated",
        message: `${name}'s ${service} job was updated${options.note ? `: ${options.note}` : "."}`,
      };
  }
}

async function ownerRecipients(): Promise<UserRecipient[]> {
  return db.select({ id: users.id, email: users.email, role: users.role, jobAlertChannelPreference: users.jobAlertChannelPreference })
    .from(users)
    .where(
      and(
        or(
          inArray(users.role, ["admin", "business_owner"]),
          inArray(sql<string>`lower(${users.email})`, Array.from(OWNER_EMAILS)),
        ),
        or(eq(users.notificationsEnabled, true), sql`${users.notificationsEnabled} IS NULL`),
        sql`lower(coalesce(${users.email}, '')) NOT LIKE '%.internal'`,
        sql`lower(coalesce(${users.email}, '')) NOT LIKE '%@system.internal'`,
      ),
    );
}

async function eligibleCrewRecipients(lead: Lead): Promise<UserRecipient[]> {
  const rawService = String(lead.serviceType || "").toLowerCase();
  const serviceAliases: Record<string, string> = {
    residential: "moving",
    commercial: "moving",
    delivery: "moving",
    junk_removal: "junk",
  };
  const service = serviceAliases[rawService] || rawService;
  return db.select({ id: users.id, email: users.email, role: users.role, jobAlertChannelPreference: users.jobAlertChannelPreference })
    .from(users)
    .where(
      and(
        or(
          eq(users.role, "employee"),
          and(
            inArray(users.role, ["admin", "business_owner"]),
            sql`COALESCE(${users.capabilities}, ARRAY[]::text[]) @> ARRAY['mover']::text[]`,
          ),
        ),
        or(eq(users.status, "approved"), eq(users.status, "active")),
        or(eq(users.isApproved, true), sql`${users.isApproved} IS NULL`),
        or(eq(users.notificationsEnabled, true), sql`${users.notificationsEnabled} IS NULL`),
        sql`lower(coalesce(${users.email}, '')) NOT LIKE '%.internal'`,
        sql`lower(coalesce(${users.email}, '')) NOT LIKE '%@system.internal'`,
        service
          ? sql`(${users.acceptedJobTypes} IS NULL OR cardinality(${users.acceptedJobTypes}) = 0 OR ${users.acceptedJobTypes} @> ARRAY[${service}]::text[])`
          : sql`true`,
      ),
    );
}

async function assignedCrewRecipients(lead: Lead): Promise<UserRecipient[]> {
  const ids = new Set<string>();
  if (lead.assignedToUserId) ids.add(lead.assignedToUserId);
  if (Array.isArray(lead.crewMembers)) {
    for (const id of lead.crewMembers) {
      if (id) ids.add(id);
    }
  }
  if (ids.size === 0) return [];
  return db.select({ id: users.id, email: users.email, role: users.role, jobAlertChannelPreference: users.jobAlertChannelPreference })
    .from(users)
    .where(
      and(
        inArray(users.id, Array.from(ids)),
        or(eq(users.status, "approved"), eq(users.status, "active")),
        or(eq(users.isApproved, true), sql`${users.isApproved} IS NULL`),
        or(eq(users.notificationsEnabled, true), sql`${users.notificationsEnabled} IS NULL`),
        sql`lower(coalesce(${users.email}, '')) NOT LIKE '%.internal'`,
        sql`lower(coalesce(${users.email}, '')) NOT LIKE '%@system.internal'`,
      ),
    );
}

async function allCrewRecipients(): Promise<UserRecipient[]> {
  return eligibleCrewRecipients({ serviceType: "" } as Lead);
}

function uniqueRecipients(recipients: UserRecipient[]) {
  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    if (seen.has(recipient.id)) return false;
    seen.add(recipient.id);
    return true;
  });
}

async function recipientsFor(scope: RecipientScope, lead: Lead) {
  if (scope === "owners") return ownerRecipients();
  if (scope === "all_crew") return allCrewRecipients();
  if (scope === "eligible_crew") return eligibleCrewRecipients(lead);
  if (scope === "owners_and_all_crew") return uniqueRecipients([...(await ownerRecipients()), ...(await allCrewRecipients())]);
  if (scope === "owners_and_eligible_crew") return uniqueRecipients([...(await ownerRecipients()), ...(await eligibleCrewRecipients(lead))]);
  const assigned = await assignedCrewRecipients(lead);
  if (scope === "assigned_crew") return assigned;
  return uniqueRecipients([...(await ownerRecipients()), ...assigned]);
}

function summarizeLead(lead: Lead) {
  return {
    id: lead.id,
    orderNumber: lead.orderNumber,
    bookingId: lead.bookingId || null,
    status: lead.status,
    customerName: customerName(lead),
    customerEmail: lead.email || null,
    customerPhone: lead.phone || null,
    serviceType: lead.serviceType,
    fromAddress: lead.confirmedFromAddress || lead.fromAddress,
    toAddress: lead.confirmedToAddress || lead.toAddress || null,
    moveDate: lead.confirmedDate || lead.moveDate || null,
    crewSize: lead.crewSize || null,
    confirmedHours: lead.confirmedHours || null,
    totalPrice: lead.totalPrice || lead.basePrice || null,
    assignedToUserId: lead.assignedToUserId || null,
    crewMembers: Array.isArray(lead.crewMembers) ? lead.crewMembers : [],
  };
}

export function formatJobWebhookBody(url: string, payload: Record<string, unknown>) {
  const title = String(payload.title || payload.type || "JC Job Event");
  const message = String(payload.message || "");
  const lead = payload.lead && typeof payload.lead === "object"
    ? payload.lead as Record<string, unknown>
    : {};
  const order = lead.orderNumber ? `JC-${lead.orderNumber}` : lead.id || "";
  const service = lead.serviceType ? String(lead.serviceType).replace(/_/g, " ") : "job";
  const date = lead.moveDate ? String(lead.moveDate) : "date TBD";

  if (url.includes("discord.com/api/webhooks") || url.includes("discordapp.com/api/webhooks")) {
    const adminUrl = typeof payload.adminUrl === "string" ? payload.adminUrl : "";
    // Discord webhooks can successfully post (HTTP 204) without creating a
    // notification. Explicitly mention the shared crew channel for the event
    // types that are intended to be alerts, while preventing mentions hidden
    // in customer/admin-provided text from being parsed.
    const alertTypes = new Set([
      "crew_announcement",
      "quote_requested",
      "job_available",
      "crew_assigned",
      "job_completed",
      "jcmoves_disbursed",
    ]);
    const notifyCrew = alertTypes.has(String(payload.type || ""));
    const mentionPrefix = notifyCrew ? "@everyone\n" : "";
    const allowed_mentions = { parse: notifyCrew ? ["everyone"] : [] };
    if (payload.type === "crew_announcement") {
      return JSON.stringify({
        username: "JC ON THE MOVE",
        content: `${mentionPrefix}**${title}**\n${message}`,
        allowed_mentions,
        embeds: [{
          title,
          description: message,
          color: 0x3b82f6,
          timestamp: String(payload.createdAt || new Date().toISOString()),
        }],
      });
    }
    return JSON.stringify({
      username: "JC Job Events",
      content: `${mentionPrefix}**${title}**\n${message}${adminUrl ? `\n${adminUrl}` : ""}`,
      allowed_mentions,
      embeds: [{
        title,
        ...(adminUrl ? { url: adminUrl } : {}),
        description: message,
        color: payload.type === "job_completed" ? 0x10b981 : payload.type === "job_available" ? 0x3b82f6 : 0xf97316,
        fields: [
          { name: "Job", value: String(order || "Unknown"), inline: true },
          { name: "Service", value: service, inline: true },
          { name: "Date", value: date, inline: true },
          { name: "Customer", value: String(lead.customerName || "Customer"), inline: true },
          { name: "Status", value: String(lead.status || payload.type || "event"), inline: true },
          { name: "Source", value: String(payload.source || "job_event_bus"), inline: true },
        ],
        timestamp: String(payload.createdAt || new Date().toISOString()),
      }],
    });
  }

  if (url.includes("hooks.slack.com")) {
    return JSON.stringify({
      text: `*${title}*\n${message}\nJob: ${order || "Unknown"} | ${service} | ${date}`,
    });
  }

  return JSON.stringify(payload);
}

type WebhookDeliverySummary = { configured: number; delivered: number; failed: number; skipped: number };

function waitForRetry(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deliverWebhooks(
  payload: Record<string, unknown>,
  context: { eventId: string; leadId?: string | null },
): Promise<WebhookDeliverySummary> {
  const webhookUrls = currentWebhookUrls();
  const summary: WebhookDeliverySummary = { configured: webhookUrls.length, delivered: 0, failed: 0, skipped: 0 };
  if (webhookUrls.length === 0) return summary;

  await Promise.all(webhookUrls.map(async (url) => {
    const provider = webhookProvider(url);
    const webhookUrlHash = crypto.createHash("sha256").update(url).digest("hex");
    try {
      if (await hasSuccessfulJobWebhookDelivery(context.eventId, webhookUrlHash)) {
        summary.skipped += 1;
        return;
      }
    } catch (error) {
      console.warn("[jobEventBus] could not inspect webhook audit; delivery will still be attempted:", error instanceof Error ? error.message : error);
    }

    const body = formatJobWebhookBody(url, payload);
    const webhookSecret = currentWebhookSecret();
    const signature = webhookSecret
      ? crypto.createHmac("sha256", webhookSecret).update(body).digest("hex")
      : "";
    const isDiscord = provider === "discord";
    let attempts = 0;
    let responseStatus: number | null = null;
    let errorMessage: string | null = null;

    while (attempts < 3) {
      attempts += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(isDiscord ? {} : { "x-jc-event": String(payload.type || "") }),
            ...(!isDiscord && signature ? { "x-jc-signature": `sha256=${signature}` } : {}),
          },
          body,
          signal: controller.signal,
        });
        responseStatus = response.status;
        if (response.ok) {
          errorMessage = null;
          break;
        }
        errorMessage = `Provider returned HTTP ${response.status}`;
        if (attempts < 3 && (response.status === 429 || response.status >= 500)) {
          const retryAfter = Number(response.headers.get("retry-after") || 0);
          await waitForRetry(Math.min(3000, retryAfter > 0 ? retryAfter * 1000 : attempts * 300));
          continue;
        }
        break;
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : "Webhook request failed";
        if (attempts < 3) {
          await waitForRetry(attempts * 300);
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    const sent = errorMessage === null && responseStatus !== null && responseStatus >= 200 && responseStatus < 300;
    if (sent) summary.delivered += 1;
    else summary.failed += 1;
    try {
      await recordJobWebhookDelivery({
        eventId: context.eventId,
        leadId: context.leadId || null,
        webhookUrlHash,
        provider,
        status: sent ? "sent" : "failed",
        responseStatus,
        errorMessage,
        attempts,
        metadata: { type: String(payload.type || ""), source: String(payload.source || "job_event_bus") },
      });
    } catch (auditError) {
      console.error("[jobEventBus] webhook audit write failed:", auditError instanceof Error ? auditError.message : auditError);
    }
    if (!sent) {
      console.warn(`[jobEventBus] ${provider} webhook failed after ${attempts} attempt(s): ${errorMessage || "unknown error"}`);
    }
  }));

  return summary;
}

/**
 * Send a company-wide announcement through the already-configured job alert
 * webhooks.  This intentionally carries no customer or job data: the job
 * alert channel doubles as the crew announcement channel without creating a
 * second Discord webhook or exposing operational details.
 */
export async function deliverCrewAnnouncementToWebhooks(input: {
  title: string;
  message: string;
  source?: string;
}): Promise<{ configured: number; delivered: number }> {
  const eventId = crypto.randomUUID();
  const payload = {
    id: eventId,
    type: "crew_announcement",
    scope: "crew",
    title: input.title,
    message: input.message,
    source: input.source || "crew_announcement",
    createdAt: new Date().toISOString(),
    lead: {},
  };
  const summary = await deliverWebhooks(payload, { eventId });
  return { configured: summary.configured, delivered: summary.delivered };
}

export function eventTypeForStatus(status: string | null | undefined): JobEventType | null {
  if (!status) return null;
  if (status === "quote_requested" || status === "new") return "quote_requested";
  if (status === "available" || status === "open" || status === "confirmed") return "job_available";
  if (status === "assigned" || status === "accepted" || status === "dispatched" || status === "in_progress") return "crew_assigned";
  if (status === "completed") return "job_completed";
  return "job_updated";
}

/**
 * Some service-specific quote tools predate the shared leads table. They use
 * this adapter so the same crew audience and Discord channel still receive a
 * quote opportunity while retaining the service's original source record.
 */
export async function emitStandaloneQuoteOpportunity(input: {
  eventId: string;
  referenceId: string;
  customerName: string;
  serviceType: string;
  requestedDate?: string | null;
  source: string;
  adminPath: string;
}) {
  try {
    const title = "Possible Job Opportunity";
    const service = input.serviceType.replace(/_/g, " ");
    const date = input.requestedDate || "date TBD";
    const message = `A ${service} request is ready for crew-size and quote sampling for ${date}. Open the quote board to make a selection and build booking progress.`;
    let recipients: UserRecipient[] = [];
    let personalRecipients: UserRecipient[] = [];

    // Discord is an independent delivery channel. A user-query or in-app
    // audit problem must not prevent the configured webhook from firing.
    try {
      recipients = uniqueRecipients([...(await ownerRecipients()), ...(await allCrewRecipients())]);
      personalRecipients = recipients.filter((recipient) => recipient.jobAlertChannelPreference !== "discord");
    } catch (error) {
      console.warn("[jobEventBus] standalone personal recipient lookup failed; continuing with webhooks:", error instanceof Error ? error.message : error);
    }

    await Promise.allSettled(personalRecipients.map(async (recipient) => {
      if (await hasJobAlertDelivery(input.eventId,recipient.id)) return;
      const isOwnerRecipient = ["admin", "business_owner"].includes(String(recipient.role || ""));
      const result = await notificationService.sendNotification({
        userId: recipient.id,
        type: "crew_opportunity",
        title,
        message,
        data: {
          type: "quote_requested",
          source: input.source,
          referenceId: input.referenceId,
          eventId: input.eventId,
          url: isOwnerRecipient ? input.adminPath : "/crew",
        },
      });
      await Promise.all([
        recordJobAlertDelivery({
          eventId: input.eventId,
          leadId: null,
          recipientUserId: recipient.id,
          channel: "in_app",
          status: result.inApp.status,
          errorMessage: result.inApp.error,
          metadata: { type: "quote_requested", source: input.source, referenceId: input.referenceId },
        }),
        recordJobAlertDelivery({
          eventId: input.eventId,
          leadId: null,
          recipientUserId: recipient.id,
          channel: "push",
          status: result.push.status,
          errorMessage: result.push.error,
          metadata: { type: "quote_requested", source: input.source, referenceId: input.referenceId },
        }),
      ]);
    }));

    await deliverWebhooks({
      id: input.eventId,
      type: "quote_requested",
      scope: "owners_and_all_crew",
      title,
      message,
      createdAt: new Date().toISOString(),
      source: input.source,
      adminUrl: absoluteAppUrl(input.adminPath),
      crewUrl: absoluteAppUrl("/crew"),
      lead: {
        id: input.referenceId,
        customerName: input.customerName,
        serviceType: input.serviceType,
        moveDate: input.requestedDate || null,
        status: "quote_requested",
      },
      recipientCount: recipients.length,
      personalRecipientCount: personalRecipients.length,
    }, { eventId: input.eventId });
  } catch (error) {
    console.error("[jobEventBus] standalone quote alert failed:", error instanceof Error ? error.message : error);
  }
}

export async function emitJobEvent(
  type: JobEventType,
  leadOrId: Lead | string,
  options: EmitJobEventOptions = {},
) {
  try {
    const lead = typeof leadOrId === "string"
      ? (await db.select().from(leads).where(eq(leads.id, leadOrId)).limit(1))[0]
      : leadOrId;
    if (!lead) return;

    const eventId = options.eventId || crypto.randomUUID();
    let effectiveType = type;
    let effectiveOptions = options;
    if (type === "job_completed") {
      const [fresh] = await db.select({
        paymentPaidAt: leads.paymentPaidAt,
        completionRewardedAt: leads.completionRewardedAt,
        tokensDisbursedAt: leads.tokensDisbursedAt,
      }).from(leads).where(eq(leads.id, lead.id)).limit(1);
      if (!fresh?.completionRewardedAt && !fresh?.tokensDisbursedAt) {
        effectiveType = "jcmoves_pending";
        effectiveOptions = {
          ...options,
          extra: {
            ...(options.extra || {}),
            pendingReason: fresh?.paymentPaidAt
              ? "The paid-completion issuance needs an administrator retry."
              : "JCMOVES will issue after full customer payment is confirmed.",
          },
        };
      }
    }
    const message = messageFor(effectiveType, lead, effectiveOptions);
    let recipients: UserRecipient[] = [];
    try {
      recipients = uniqueRecipients(await recipientsFor(message.scope, lead));
      if (options.recipientUserIds?.length) {
        const allowed = new Set(options.recipientUserIds);
        recipients = recipients.filter((recipient) => allowed.has(recipient.id));
      }
    } catch (error) {
      console.warn("[jobEventBus] personal recipient lookup failed; continuing with webhooks:", error instanceof Error ? error.message : error);
    }
    const baseData = {
      type: effectiveType,
      leadId: lead.id,
      orderNumber: lead.orderNumber,
      url: adminLeadUrl(lead.id),
      adminUrl: adminLeadUrl(lead.id),
      crewUrl: crewLeadUrl(lead.id),
      source: options.source || "job_event_bus",
      previousStatus: options.previousStatus || null,
      status: options.status || lead.status || null,
      eventId,
      ...(effectiveOptions.extra || {}),
    };

    const personalRecipients = recipients.filter((recipient) => recipient.jobAlertChannelPreference !== "discord");
    await Promise.allSettled(personalRecipients.map(async (recipient) => {
      // One recipient's audit must not suppress another recipient. Retain the
      // existing no-repeat rule within each recipient until channel recovery
      // can distinguish confirmed delivery from uncertain provider outcomes.
      if (options.eventId && await hasJobAlertDelivery(eventId,recipient.id)) return;
      const isOwnerRecipient = ["admin", "business_owner"].includes(String(recipient.role || ""));
      const personalUrl = effectiveType === "jcmoves_disbursed"
        ? (isOwnerRecipient ? "/admin/finance" : "/crew/earnings")
        : (isOwnerRecipient ? adminLeadUrl(lead.id) : crewLeadUrl(lead.id));
      const crewTokenAmounts = effectiveOptions.extra?.crewTokenAmounts && typeof effectiveOptions.extra.crewTokenAmounts === "object"
        ? effectiveOptions.extra.crewTokenAmounts as Record<string, number>
        : {};
      const personalTokenAmount = Number(crewTokenAmounts[recipient.id] || 0);
      const personalMessage = effectiveType === "jcmoves_disbursed" && !isOwnerRecipient && personalTokenAmount > 0
        ? `You received ${personalTokenAmount.toLocaleString()} JCMOVES for ${customerName(lead)}'s ${displayService(lead)} job. Open Earnings to review the ledger.`
        : message.message;
      const result = await notificationService.sendNotification({
        userId: recipient.id,
        type: message.notificationType as any,
        title: message.title,
        message: personalMessage,
        data: { ...baseData, url: personalUrl },
      });

      await Promise.all([
        recordJobAlertDelivery({
          eventId,
          leadId: lead.id,
          recipientUserId: recipient.id,
          channel: "in_app",
          status: result.inApp.status,
          errorMessage: result.inApp.error,
          metadata: { type: effectiveType, source: options.source || "job_event_bus" },
        }),
        recordJobAlertDelivery({
          eventId,
          leadId: lead.id,
          recipientUserId: recipient.id,
          channel: "push",
          status: result.push.status,
          errorMessage: result.push.error,
          metadata: { type: effectiveType, source: options.source || "job_event_bus" },
        }),
      ]);
    }));

    await deliverWebhooks({
      id: eventId,
      type: effectiveType,
      scope: message.scope,
      title: message.title,
      message: message.message,
      createdAt: new Date().toISOString(),
      actorId: options.actorId || null,
      source: options.source || "job_event_bus",
      adminUrl: absoluteAppUrl(adminLeadUrl(lead.id)),
      crewUrl: absoluteAppUrl(crewLeadUrl(lead.id)),
      lead: summarizeLead(lead),
      recipientCount: recipients.length,
      personalRecipientCount: personalRecipients.length,
      extra: effectiveOptions.extra || {},
    }, { eventId, leadId: lead.id });
  } catch (error) {
    console.error("[jobEventBus] emit failed:", error instanceof Error ? error.message : error);
  }
}

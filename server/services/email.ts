import { MailService } from '@sendgrid/mail';
import { sendGmailEmail, isGmailAvailable } from './gmail';

let isEmailServiceAvailable = false;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

if (!SENDGRID_API_KEY) {
  console.warn("SENDGRID_API_KEY environment variable not set. SendGrid fallback will be disabled.");
} else if (!SENDGRID_API_KEY.startsWith('SG.')) {
  console.warn("Invalid SENDGRID_API_KEY format - SendGrid fallback will be disabled.");
} else {
  isEmailServiceAvailable = true;
}

const mailService = new MailService();

if (isEmailServiceAvailable && SENDGRID_API_KEY) {
  try {
    mailService.setApiKey(SENDGRID_API_KEY);
    console.log("SendGrid email service initialized successfully");
  } catch (error) {
    console.error("Failed to initialize SendGrid service:", error);
    isEmailServiceAvailable = false;
  }
}

isGmailAvailable().then(available => {
  if (available) {
    console.log("Gmail email service available (primary)");
  } else {
    console.log("Gmail not available, will use SendGrid as primary");
  }
}).catch(() => {});

export interface EmailParams {
  to: string;
  from?: string;
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
}

export async function sendEmail(params: EmailParams): Promise<boolean> {
  // Try Gmail first (primary)
  try {
    const gmailAvailable = await isGmailAvailable();
    if (gmailAvailable) {
      const sent = await sendGmailEmail({ ...params, from: params.from || FROM_EMAIL });
      if (sent) return true;
      console.log("Gmail send failed, falling back to SendGrid...");
    }
  } catch (err) {
    console.log("Gmail unavailable, falling back to SendGrid...");
  }

  // Fall back to SendGrid
  if (!isEmailServiceAvailable) {
    console.error('Email service not available. Email was not sent:', {
      to: params.to,
      from: params.from,
      subject: params.subject,
      hasText: !!params.text,
      hasHtml: !!params.html
    });
    return false;
  }

  try {
    const emailData: any = {
      to: params.to,
      from: params.from || FROM_EMAIL,
      subject: params.subject,
    };
    
    if (params.text) emailData.text = params.text;
    if (params.html) emailData.html = params.html;
    if (params.replyTo) emailData.replyTo = params.replyTo;
    
    await mailService.send(emailData);
    return true;
  } catch (error) {
    console.error('SendGrid email error:', error);
    return false;
  }
}

const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL ||
  process.env.NOTIFICATION_EMAIL ||
  process.env.COMPANY_EMAIL ||
  'upmichiganstatemovers@gmail.com';
const FROM_EMAIL =
  process.env.FROM_EMAIL ||
  process.env.SENDGRID_FROM_EMAIL ||
  process.env.COMPANY_EMAIL ||
  process.env.GMAIL_USER ||
  'michigankid906@gmail.com';

export async function notifyAdminNewQuote(data: {
  customerName: string;
  serviceType: string;
  phone?: string;
  email?: string;
  moveDate?: string;
}): Promise<boolean> {
  const html = `
    <h2>🚚 New Quote Request — JC ON THE MOVE</h2>
    <p><strong>Customer:</strong> ${data.customerName}</p>
    <p><strong>Service:</strong> ${data.serviceType}</p>
    <p><strong>Phone:</strong> ${data.phone || 'Not provided'}</p>
    ${data.email ? `<p><strong>Email:</strong> ${data.email}</p>` : ''}
    ${data.moveDate ? `<p><strong>Move Date:</strong> ${data.moveDate}</p>` : ''}
    <p>Check the dashboard for details.</p>
  `;
  const text = `NEW QUOTE REQUEST\n\nCustomer: ${data.customerName}\nService: ${data.serviceType}\nPhone: ${data.phone || 'Not provided'}${data.email ? `\nEmail: ${data.email}` : ''}${data.moveDate ? `\nMove Date: ${data.moveDate}` : ''}\n\nCheck the dashboard for details.`;
  return sendEmail({ to: ADMIN_EMAIL, from: FROM_EMAIL, subject: `New Quote Request — ${data.customerName} (${data.serviceType})`, html, text });
}

export type BookingRequestReceiptData = {
  to: string;
  customerName: string;
  bookingReference: string;
  serviceSummary: string;
  serviceAddress?: string | null;
  requestedDate?: string | null;
  arrivalWindow?: string | null;
  estimatedTotal: number;
};

function escapeEmailHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function generateBookingRequestReceipt(data: BookingRequestReceiptData): { html: string; text: string } {
  const safeName = escapeEmailHtml(data.customerName || "Customer");
  const safeReference = escapeEmailHtml(data.bookingReference);
  const safeServices = escapeEmailHtml(data.serviceSummary || "Service request");
  const safeAddress = data.serviceAddress ? escapeEmailHtml(data.serviceAddress) : "";
  const safeDate = data.requestedDate ? escapeEmailHtml(data.requestedDate) : "";
  const safeWindow = data.arrivalWindow ? escapeEmailHtml(data.arrivalWindow) : "";
  const estimate = Number.isFinite(data.estimatedTotal) ? Math.max(0, data.estimatedTotal) : 0;
  const estimateLabel = `$${estimate.toFixed(2)}`;
  const scheduleText = [data.requestedDate, data.arrivalWindow].filter(Boolean).join(" · ") || "Coordinator confirmation needed";

  const html = `
    <h2>We received your JC ON THE MOVE request</h2>
    <p>Hi ${safeName},</p>
    <p>Your request is saved. A crew coordinator will review the details and contact you to confirm the price and schedule.</p>
    <p><strong>Reference:</strong> ${safeReference}</p>
    <p><strong>Service:</strong> ${safeServices}</p>
    ${safeAddress ? `<p><strong>Service address:</strong> ${safeAddress}</p>` : ""}
    ${safeDate ? `<p><strong>Preferred date:</strong> ${safeDate}</p>` : ""}
    ${safeWindow ? `<p><strong>Preferred arrival window:</strong> ${safeWindow} Central</p>` : ""}
    <p><strong>Saved estimate:</strong> ${estimateLabel}</p>
    <p><em>This receipt confirms that we received your request. It is not a final price, crew assignment, or guaranteed appointment until a coordinator confirms it.</em></p>
    <p>Questions? Call or text (906) 285-9312 and mention ${safeReference}.</p>
  `;
  const text = `JC ON THE MOVE REQUEST RECEIVED\n\nHi ${data.customerName || "Customer"},\n\nYour request is saved. A crew coordinator will review it and contact you to confirm the price and schedule.\n\nReference: ${data.bookingReference}\nService: ${data.serviceSummary || "Service request"}${data.serviceAddress ? `\nService address: ${data.serviceAddress}` : ""}\nPreferred schedule: ${scheduleText}\nSaved estimate: ${estimateLabel}\n\nThis is a request receipt, not a final price, crew assignment, or guaranteed appointment.\n\nQuestions? Call or text (906) 285-9312 and mention ${data.bookingReference}.`;
  return { html, text };
}

export async function notifyCustomerBookingRequestReceived(data: BookingRequestReceiptData): Promise<boolean> {
  const { html, text } = generateBookingRequestReceipt(data);
  return sendEmail({
    to: data.to,
    from: FROM_EMAIL,
    replyTo: ADMIN_EMAIL,
    subject: `Request received — ${data.bookingReference}`,
    html,
    text,
  });
}

export async function notifyAdminNewLead(data: {
  recipient?: string;
  customerName: string;
  serviceType: string;
  phone?: string;
  email?: string;
  createdBy?: string;
  mediaLink?: string;
}): Promise<boolean> {
  const html = `
    <h2>📋 New Lead Created — JC ON THE MOVE</h2>
    <p><strong>Customer:</strong> ${data.customerName}</p>
    <p><strong>Service:</strong> ${data.serviceType}</p>
    <p><strong>Phone:</strong> ${data.phone || 'Not provided'}</p>
    ${data.email ? `<p><strong>Email:</strong> ${data.email}</p>` : ''}
    ${data.createdBy ? `<p><strong>Created By:</strong> ${data.createdBy}</p>` : ''}
    ${data.mediaLink ? `<p><strong>Customer Media:</strong> <a href="${data.mediaLink}">${data.mediaLink}</a></p>` : ''}
    <p>Check the dashboard to review.</p>
  `;
  const text = `NEW LEAD CREATED\n\nCustomer: ${data.customerName}\nService: ${data.serviceType}\nPhone: ${data.phone || 'Not provided'}${data.email ? `\nEmail: ${data.email}` : ''}${data.createdBy ? `\nCreated by: ${data.createdBy}` : ''}${data.mediaLink ? `\nCustomer media: ${data.mediaLink}` : ''}\n\nCheck the dashboard to review.`;
  return sendEmail({ to: data.recipient || ADMIN_EMAIL, from: FROM_EMAIL, subject: `New Lead Created — ${data.customerName} (${data.serviceType})`, html, text });
}

export async function notifyAdminJobCompleted(data: {
  customerName: string;
  serviceType: string;
  completedBy?: string;
}): Promise<boolean> {
  const html = `
    <h2>✅ Job Completed — JC ON THE MOVE</h2>
    <p><strong>Customer:</strong> ${data.customerName}</p>
    <p><strong>Service:</strong> ${data.serviceType}</p>
    ${data.completedBy ? `<p><strong>Completed By:</strong> ${data.completedBy}</p>` : ''}
    <p>Job has been marked as complete.</p>
  `;
  const text = `JOB COMPLETED\n\nCustomer: ${data.customerName}\nService: ${data.serviceType}${data.completedBy ? `\nCompleted by: ${data.completedBy}` : ''}\n\nJob marked as complete.`;
  return sendEmail({ to: ADMIN_EMAIL, from: FROM_EMAIL, subject: `Job Completed — ${data.customerName} (${data.serviceType})`, html, text });
}

export async function notifyEmployeeJobAvailable(employeeEmail: string, data: {
  customerName: string;
  serviceType: string;
  moveDate?: string;
  tokensReward?: number;
}): Promise<boolean> {
  const html = `
    <h2>🚚 New Job Available — JC ON THE MOVE</h2>
    <p><strong>Customer:</strong> ${data.customerName}</p>
    <p><strong>Service:</strong> ${data.serviceType}</p>
    <p><strong>Date:</strong> ${data.moveDate || 'TBD'}</p>
    ${data.tokensReward ? `<p><strong>Reward:</strong> ${data.tokensReward.toLocaleString()} JCMOVES</p>` : ''}
    <p>Open the app to claim this job!</p>
  `;
  const text = `NEW JOB AVAILABLE\n\nCustomer: ${data.customerName}\nService: ${data.serviceType}\nDate: ${data.moveDate || 'TBD'}${data.tokensReward ? `\nReward: ${data.tokensReward.toLocaleString()} JCMOVES` : ''}\n\nOpen the app to claim this job!`;
  return sendEmail({ to: employeeEmail, from: FROM_EMAIL, subject: `New Job Available — ${data.serviceType} for ${data.customerName}`, html, text });
}

export async function sendNotificationEmail(toEmail: string, subject: string, html: string, text?: string): Promise<boolean> {
  return sendEmail({ to: toEmail, from: FROM_EMAIL, subject, html, text });
}

export function generateLeadNotificationEmail(lead: any) {
  const html = `
    <h2>New Lead Submission - JC ON THE MOVE</h2>
    <p><strong>Service Type:</strong> ${lead.serviceType}</p>
    <p><strong>Customer:</strong> ${lead.firstName} ${lead.lastName}</p>
    <p><strong>Email:</strong> ${lead.email}</p>
    <p><strong>Phone:</strong> ${lead.phone}</p>
    <p><strong>From Address:</strong> ${lead.fromAddress}</p>
    ${lead.toAddress ? `<p><strong>To Address:</strong> ${lead.toAddress}</p>` : ''}
    ${lead.moveDate ? `<p><strong>Move Date:</strong> ${lead.moveDate}</p>` : ''}
    ${lead.propertySize ? `<p><strong>Property Size:</strong> ${lead.propertySize}</p>` : ''}
    ${lead.details ? `<p><strong>Additional Details:</strong> ${lead.details}</p>` : ''}
    <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
  `;

  const text = `
    New Lead Submission - JC ON THE MOVE
    
    Service Type: ${lead.serviceType}
    Customer: ${lead.firstName} ${lead.lastName}
    Email: ${lead.email}
    Phone: ${lead.phone}
    From Address: ${lead.fromAddress}
    ${lead.toAddress ? `To Address: ${lead.toAddress}` : ''}
    ${lead.moveDate ? `Move Date: ${lead.moveDate}` : ''}
    ${lead.propertySize ? `Property Size: ${lead.propertySize}` : ''}
    ${lead.details ? `Additional Details: ${lead.details}` : ''}
    Submitted: ${new Date().toLocaleString()}
  `;

  return { html, text };
}

/** Pull "City, ST" from a full address string, or return a safe fallback */
export function extractCityState(address: string | null | undefined): string {
  if (!address) return "Location TBD";
  const cleaned = address.trim();
  // Try: "123 Main St, Marquette, MI 49855"  →  ["123 Main St", "Marquette", "MI 49855"]
  const parts = cleaned.split(",").map(p => p.trim());
  if (parts.length >= 3) {
    const stateZip = parts[parts.length - 1]; // "MI 49855" or "MI"
    const city = parts[parts.length - 2];     // "Marquette"
    const stateOnly = stateZip.split(" ")[0]; // "MI"
    return `${city}, ${stateOnly}`;
  }
  if (parts.length === 2) {
    return `${parts[0]}, ${parts[1].split(" ")[0]}`;
  }
  // Last resort — return up to 30 chars
  return cleaned.slice(0, 30);
}

/** Format service type label for worker-facing email */
function formatServiceLabel(serviceType: string): string {
  const labels: Record<string, string> = {
    moving: "Moving — Residential/Commercial",
    junk_removal: "Junk Removal",
    labor: "Labor Only (Loading / Unloading)",
    snow_removal: "Snow Removal",
    lawn_care: "Lawn Care",
    window_cleaning: "Window Cleaning",
    handyman: "Handyman Services",
    cleaning: "Cleaning",
    trash_valet: "Trash Valet",
    assembly: "Furniture Assembly",
  };
  return labels[serviceType] || serviceType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function generateWorkerDispatchEmail(lead: any, worker: any): { html: string; text: string } {
  const HOURLY_RATE = 85;
  const cityState = extractCityState(lead.confirmedFromAddress || lead.fromAddress);
  const jobDate = lead.confirmedDate || lead.moveDate || "TBD";
  const arrivalWindow = lead.arrivalWindow || "Time TBD — admin will confirm";
  const hours = lead.confirmedHours ? Number(lead.confirmedHours) : null;
  const estimatedPay = hours ? (hours * HOURLY_RATE).toFixed(2) : null;
  const serviceLabel = formatServiceLabel(lead.serviceType || "service");
  const customerFirst = lead.firstName || "your customer";
  const workerFirst = worker.firstName || worker.username || "Crew Member";
  const details = lead.details || "";
  const dispatchNotes = lead.dispatchNotes || "";
  const quoteNotes = lead.quoteNotes || "";
  const combinedNotes = [quoteNotes, dispatchNotes].filter(Boolean).join("\n\n");
  const companyPhone = process.env.COMPANY_PHONE || "(906) 231-7906";
  const companyEmail = process.env.COMPANY_EMAIL || "michigankid906@gmail.com";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.10);">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);padding:28px 32px;text-align:center;">
          <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:1px;">JC ON THE MOVE</div>
          <div style="font-size:13px;color:#93c5fd;margin-top:4px;">Northwoods &amp; UP of Michigan</div>
          <div style="margin-top:16px;background:rgba(255,255,255,0.15);border-radius:8px;padding:10px 20px;display:inline-block;">
            <span style="font-size:16px;font-weight:700;color:#ffffff;">📋 You're Scheduled for a Job!</span>
          </div>
        </td></tr>

        <!-- Greeting -->
        <tr><td style="padding:24px 32px 8px;">
          <p style="margin:0;font-size:15px;color:#374151;">Hey <strong>${workerFirst}</strong>,</p>
          <p style="margin:8px 0 0;font-size:15px;color:#374151;">Here are the details for your upcoming job. Review everything below and reach out to JC if you have any questions.</p>
        </td></tr>

        <!-- Date / Time -->
        <tr><td style="padding:16px 32px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9ff;border-left:4px solid #2563eb;border-radius:6px;padding:14px 16px;">
            <tr>
              <td style="font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">📅 Date &amp; Arrival Window</td>
            </tr>
            <tr>
              <td style="font-size:18px;font-weight:700;color:#1e3a5f;padding-top:4px;">${jobDate}</td>
            </tr>
            <tr>
              <td style="font-size:15px;color:#374151;padding-top:2px;">${arrivalWindow}</td>
            </tr>
          </table>
        </td></tr>

        <!-- Location -->
        <tr><td style="padding:12px 32px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:14px 16px;">
            <tr><td style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.8px;">📍 Job Location</td></tr>
            <tr><td style="font-size:16px;font-weight:600;color:#111827;padding-top:4px;">${cityState}</td></tr>
            <tr><td style="font-size:12px;color:#9ca3af;padding-top:2px;">Full street address confirmed at dispatch — contact JC if needed</td></tr>
          </table>
        </td></tr>

        <!-- Two-column: Customer + Service -->
        <tr><td style="padding:12px 32px 0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="48%" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:14px 16px;vertical-align:top;">
                <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.8px;">👤 Customer</div>
                <div style="font-size:16px;font-weight:600;color:#111827;margin-top:4px;">${customerFirst}</div>
                <div style="font-size:12px;color:#9ca3af;margin-top:2px;">First name only</div>
              </td>
              <td width="4%"></td>
              <td width="48%" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:14px 16px;vertical-align:top;">
                <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.8px;">🔧 Service Type</div>
                <div style="font-size:14px;font-weight:600;color:#111827;margin-top:4px;">${serviceLabel}</div>
              </td>
            </tr>
          </table>
        </td></tr>

        ${details ? `
        <!-- Job Details -->
        <tr><td style="padding:12px 32px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:14px 16px;">
            <tr><td style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.8px;">📝 What the Job Involves</td></tr>
            <tr><td style="font-size:14px;color:#374151;padding-top:6px;line-height:1.6;">${details.replace(/\n/g, '<br>')}</td></tr>
          </table>
        </td></tr>` : ''}

        <!-- Pay Estimate -->
        <tr><td style="padding:12px 32px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border-left:4px solid #16a34a;border-radius:6px;padding:14px 16px;">
            <tr><td style="font-size:11px;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:0.8px;">💰 Your Estimated Pay</td></tr>
            ${hours ? `
            <tr><td style="font-size:20px;font-weight:800;color:#15803d;padding-top:6px;">$${estimatedPay}</td></tr>
            <tr><td style="font-size:13px;color:#4ade80;margin-top:2px;">${hours} hr${hours !== 1 ? 's' : ''} × $${HOURLY_RATE}/hr</td></tr>
            ` : `
            <tr><td style="font-size:14px;color:#374151;padding-top:6px;">Hours TBD — admin will confirm. Rate: $${HOURLY_RATE}/hr</td></tr>
            `}
          </table>
        </td></tr>

        ${combinedNotes ? `
        <!-- Admin Notes -->
        <tr><td style="padding:12px 32px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:6px;padding:14px 16px;">
            <tr><td style="font-size:11px;font-weight:700;color:#d97706;text-transform:uppercase;letter-spacing:0.8px;">📋 Notes from JC</td></tr>
            <tr><td style="font-size:14px;color:#374151;padding-top:6px;line-height:1.6;">${combinedNotes.replace(/\n/g, '<br>')}</td></tr>
          </table>
        </td></tr>` : ''}

        <!-- Contact Footer -->
        <tr><td style="padding:20px 32px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#1e3a5f;border-radius:8px;padding:16px 20px;">
            <tr><td style="color:#93c5fd;font-size:13px;font-weight:600;">Questions or can't make it?</td></tr>
            <tr><td style="color:#ffffff;font-size:14px;padding-top:4px;">Reply to this email or reach JC directly:</td></tr>
            <tr><td style="color:#60a5fa;font-size:14px;padding-top:4px;">📞 ${companyPhone} &nbsp;|&nbsp; ✉️ ${companyEmail}</td></tr>
          </table>
          <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;text-align:center;">JC ON THE MOVE LLC — Northwoods &amp; UP of Michigan</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `
JC ON THE MOVE — You're Scheduled for a Job!
=============================================

Hey ${workerFirst},

Here are your job details:

DATE & TIME
-----------
${jobDate}
${arrivalWindow}

LOCATION
--------
${cityState}
(Full address confirmed at dispatch — contact JC if needed)

CUSTOMER: ${customerFirst} (first name only)

SERVICE: ${serviceLabel}

${details ? `WHAT THE JOB INVOLVES\n---------------------\n${details}\n` : ''}
ESTIMATED PAY
-------------
${hours ? `${hours} hr${hours !== 1 ? 's' : ''} × $${HOURLY_RATE}/hr = $${estimatedPay}` : `Rate: $${HOURLY_RATE}/hr — hours TBD`}

${combinedNotes ? `NOTES FROM JC\n-------------\n${combinedNotes}\n` : ''}
QUESTIONS?
----------
Reply to this email or contact JC:
Phone: ${companyPhone}
Email: ${companyEmail}

— JC ON THE MOVE LLC, Northwoods & UP of Michigan
  `;

  return { html, text };
}

// ─────────────────────────────────────────────────────────────────────────────
// Monthly spotlight service rotation
// ─────────────────────────────────────────────────────────────────────────────
const MONTHLY_SPOTLIGHT: Record<number, { name: string; emoji: string; desc: string; slug: string }> = {
  1:  { name: "Moving",              emoji: "📦", desc: "Local & long-distance moves with fully insured crew. We wrap, load, haul, and unload — all for one bundled rate.", slug: "moving" },
  2:  { name: "Junk Removal",        emoji: "🗑️",  desc: "Clear out garages, basements, and estates fast. We haul everything away and dispose responsibly.", slug: "junk" },
  3:  { name: "Jump Start",          emoji: "⚡",  desc: "Stranded? We come to you with a portable jump pack. Flat rate pricing — no membership required.", slug: "jumpstart" },
  4:  { name: "Window Cleaning",     emoji: "🪟", desc: "Streak-free results inside and out. $5 per pane — 4-window minimum. Ladder access available.", slug: "window_cleaning" },
  5:  { name: "Lawn Care",           emoji: "🌿", desc: "Mowing, trimming, edging, cleanup, and more. Weekly or one-time — your yard, your schedule.", slug: "lawn" },
  6:  { name: "Trash Valet",         emoji: "♻️",  desc: "We roll your bins out and bring them back every week. Starting at $30/month for 1 can.", slug: "trash_valet" },
  7:  { name: "Painting",            emoji: "🎨", desc: "Interior & exterior painting with clean, professional results. We bring the crew, you pick the color.", slug: "painting" },
  8:  { name: "Flooring",            emoji: "🪵", desc: "Installation, removal, and haul-away. Hardwood, LVP, tile, and more. Quote-based pricing.", slug: "flooring" },
  9:  { name: "Snow Removal",        emoji: "❄️",  desc: "Per-push or seasonal contracts for driveways, walkways, and commercial lots. On-call available.", slug: "snow" },
  10: { name: "Handyman",            emoji: "🔧", desc: "General repairs, installs, and odd jobs. If it needs fixing, we can handle it.", slug: "handyman" },
  11: { name: "Move-In/Out Cleaning",emoji: "✨", desc: "Deep clean for incoming or outgoing tenants. We leave the space spotless so you don't have to.", slug: "cleaning" },
  12: { name: "Light Demolition",    emoji: "⚒️",  desc: "Tear-out, drywall removal, cleanout, and debris hauling. We demo it, bag it, and take it.", slug: "demolition" },
};

const ALL_SERVICES = [
  { name: "Moving",              emoji: "📦", slug: "moving" },
  { name: "Junk Removal",        emoji: "🗑️",  slug: "junk" },
  { name: "Jump Start",          emoji: "⚡",  slug: "jumpstart" },
  { name: "Window Cleaning",     emoji: "🪟", slug: "window_cleaning" },
  { name: "Lawn Care",           emoji: "🌿", slug: "lawn" },
  { name: "Trash Valet",         emoji: "♻️",  slug: "trash_valet" },
  { name: "Painting",            emoji: "🎨", slug: "painting" },
  { name: "Flooring",            emoji: "🪵", slug: "flooring" },
  { name: "Snow Removal",        emoji: "❄️",  slug: "snow" },
  { name: "Handyman",            emoji: "🔧", slug: "handyman" },
  { name: "Move-In/Out Cleaning",emoji: "✨", slug: "cleaning" },
  { name: "Light Demolition",    emoji: "⚒️",  slug: "demolition" },
];

function getSpotlightService(month?: number) {
  const m = month ?? (new Date().getMonth() + 1);
  return MONTHLY_SPOTLIGHT[m] ?? MONTHLY_SPOTLIGHT[1];
}

export function generateBundleFollowupEmail(opts: {
  firstName: string;
  promoCode: string;
  discountPct: 10 | 5;
  expiresAt: Date;
  month?: number;
}): { html: string; text: string } {
  const { firstName, promoCode, discountPct, expiresAt, month } = opts;
  const spotlight = getSpotlightService(month);
const BASE_URL = process.env.APP_URL?.trim()
  || process.env.RENDER_EXTERNAL_URL?.trim()
  || "https://www.jconthemove.com";
  const companyPhone = process.env.COMPANY_PHONE || "(906) 285-9312";
  const companyEmail = process.env.COMPANY_EMAIL || "michigankid906@gmail.com";
  const expiryStr = expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const isUrgent = discountPct === 10;

  // Build service grid HTML (3 cols × 4 rows, responsive)
  const serviceRows: string[] = [];
  for (let i = 0; i < ALL_SERVICES.length; i += 3) {
    const row = ALL_SERVICES.slice(i, i + 3);
    const cells = row.map(svc => `
      <td width="33%" style="padding:6px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#1e293b;border:1px solid #334155;border-radius:8px;text-align:center;">
          <tr><td style="padding:12px 8px 8px;font-size:22px;">${svc.emoji}</td></tr>
          <tr><td style="padding:0 6px 4px;font-size:11px;font-weight:700;color:#e2e8f0;">${svc.name}</td></tr>
          <tr><td style="padding:0 6px 10px;">
            <a href="${BASE_URL}/book?service=${svc.slug}" style="display:inline-block;padding:4px 10px;background:#f97316;color:#fff;font-size:10px;font-weight:700;border-radius:4px;text-decoration:none;">Book →</a>
          </td></tr>
        </table>
      </td>`).join('');
    serviceRows.push(`<tr>${cells}</tr>`);
  }
  const serviceGridHtml = serviceRows.join('\n');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Exclusive Bundle Discount — JC ON THE MOVE</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:24px 0;">
    <tr><td align="center">
      <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#1e293b;border-radius:14px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.5);">

        <!-- Hero Header -->
        <tr><td style="background:linear-gradient(135deg,#1e3a5f 0%,#0f172a 60%,#1a0a2e 100%);padding:36px 32px 28px;text-align:center;position:relative;">
          <div style="font-size:13px;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">JC ON THE MOVE LLC</div>
          <div style="font-size:28px;font-weight:900;color:#ffffff;line-height:1.2;margin-bottom:8px;">
            ${discountPct === 10 ? "🎉 You've earned a bundle deal!" : "⏰ Last chance — 5% off your next service!"}
          </div>
          <div style="font-size:14px;color:#94a3b8;margin-bottom:20px;">Northwoods &amp; UP of Michigan</div>
          <!-- Promo code callout -->
          <div style="background:${isUrgent ? 'linear-gradient(135deg,#92400e,#78350f)' : 'linear-gradient(135deg,#1e4620,#14532d)'};border:2px solid ${isUrgent ? '#f59e0b' : '#22c55e'};border-radius:12px;padding:18px 24px;display:inline-block;margin:0 auto;">
            <div style="font-size:12px;font-weight:700;color:${isUrgent ? '#fbbf24' : '#86efac'};text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;">${discountPct}% OFF YOUR NEXT SERVICE</div>
            <div style="font-size:32px;font-weight:900;color:#ffffff;letter-spacing:4px;font-family:monospace;">${promoCode}</div>
            <div style="font-size:11px;color:${isUrgent ? '#fde68a' : '#bbf7d0'};margin-top:6px;">Expires ${expiryStr} · Single use · All services</div>
          </div>
        </td></tr>

        <!-- Personalized message -->
        <tr><td style="padding:24px 32px 8px;">
          <p style="margin:0;font-size:16px;color:#e2e8f0;">Hey <strong style="color:#fff;">${firstName}</strong>,</p>
          <p style="margin:10px 0 0;font-size:14px;color:#94a3b8;line-height:1.7;">
            ${isUrgent
              ? `Thanks for trusting JC ON THE MOVE! We want to make sure you never miss out on savings — so here's your <strong style="color:#f97316;">${discountPct}% bundle discount</strong>. Book a second service within 7 days and keep the same deal you'd get by bundling at checkout.`
              : `It's been a little while since your last service — we hope everything is going great! We want to keep the savings coming your way, so here's a <strong style="color:#22c55e;">${discountPct}% discount</strong> just for you. This code expires on <strong>${expiryStr}</strong>.`
            }
          </p>
          <p style="margin:10px 0 0;font-size:14px;color:#94a3b8;">Just use code <strong style="color:#fff;font-family:monospace;">${promoCode}</strong> when you book — online or over the phone.</p>
        </td></tr>

        <!-- How to redeem -->
        <tr><td style="padding:12px 32px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:14px 16px;">
            <tr><td style="font-size:11px;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:1px;padding-bottom:8px;">How to redeem</td></tr>
            <tr><td>
              <table cellpadding="0" cellspacing="0">
                <tr><td style="font-size:13px;color:#94a3b8;padding:3px 0;">📱 <strong style="color:#e2e8f0;">Online:</strong> Book at <a href="${BASE_URL}/book" style="color:#f97316;">${BASE_URL}/book</a> — enter code at checkout</td></tr>
                <tr><td style="font-size:13px;color:#94a3b8;padding:3px 0;">📞 <strong style="color:#e2e8f0;">By phone:</strong> Call ${companyPhone} and mention the code</td></tr>
                <tr><td style="font-size:13px;color:#94a3b8;padding:3px 0;">📧 <strong style="color:#e2e8f0;">By email:</strong> Reply to this email and we'll get you set up</td></tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <!-- Monthly spotlight -->
        <tr><td style="padding:20px 32px 0;">
          <div style="font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;">⭐ This Month's Spotlight Service</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#2e1065,#1e1b4b);border:1px solid #7c3aed;border-radius:10px;padding:18px 20px;">
            <tr>
              <td width="60" style="font-size:36px;vertical-align:middle;">${spotlight.emoji}</td>
              <td style="padding-left:12px;vertical-align:middle;">
                <div style="font-size:16px;font-weight:800;color:#fff;">${spotlight.name}</div>
                <div style="font-size:13px;color:#c4b5fd;margin-top:4px;line-height:1.5;">${spotlight.desc}</div>
                <div style="margin-top:10px;">
                  <a href="${BASE_URL}/book?service=${spotlight.slug}" style="display:inline-block;padding:7px 18px;background:#7c3aed;color:#fff;font-size:12px;font-weight:700;border-radius:6px;text-decoration:none;">Book ${spotlight.name} →</a>
                </div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- All services grid -->
        <tr><td style="padding:20px 32px 0;">
          <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">All 12 Services We Offer</div>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${serviceGridHtml}
          </table>
        </td></tr>

        <!-- CTA -->
        <tr><td style="padding:24px 32px 0;text-align:center;">
          <a href="${BASE_URL}/book" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;font-size:15px;font-weight:800;border-radius:8px;text-decoration:none;letter-spacing:0.5px;">
            Book Your Next Service →
          </a>
          <p style="margin:10px 0 0;font-size:11px;color:#475569;">Use code <strong style="font-family:monospace;">${promoCode}</strong> — expires ${expiryStr}</p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 32px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:8px;padding:16px 20px;">
            <tr><td style="color:#475569;font-size:12px;line-height:1.7;">
              <strong style="color:#94a3b8;">JC ON THE MOVE LLC</strong><br>
              Ironwood, MI · Northwoods &amp; Upper Peninsula<br>
              📞 ${companyPhone} &nbsp;|&nbsp; ✉️ ${companyEmail}<br>
              <a href="${BASE_URL}" style="color:#f97316;text-decoration:none;">${BASE_URL}</a>
            </td></tr>
          </table>
          <p style="margin:10px 0 0;font-size:10px;color:#334155;text-align:center;">You're receiving this because you recently used JC ON THE MOVE. This discount code is single-use and non-transferable.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `
JC ON THE MOVE — Your ${discountPct}% Bundle Discount
=====================================================

Hey ${firstName},

${isUrgent
  ? `Thanks for trusting JC ON THE MOVE! Book a second service within 7 days and save ${discountPct}%.`
  : `It's been a little while — here's ${discountPct}% off your next service, expires ${expiryStr}.`
}

YOUR PROMO CODE: ${promoCode}
Expires: ${expiryStr}

HOW TO REDEEM
-------------
Online: ${BASE_URL}/book — enter code at checkout
Phone:  ${companyPhone}
Email:  ${companyEmail}

THIS MONTH'S SPOTLIGHT: ${spotlight.emoji} ${spotlight.name}
${spotlight.desc}
Book: ${BASE_URL}/book?service=${spotlight.slug}

ALL 12 SERVICES
---------------
${ALL_SERVICES.map(s => `${s.emoji} ${s.name} — ${BASE_URL}/book?service=${s.slug}`).join('\n')}

— JC ON THE MOVE LLC, Northwoods & UP of Michigan
  ${companyPhone} | ${companyEmail}
  `;

  return { html, text };
}

export async function sendBundleFollowupEmail(opts: {
  to: string;
  firstName: string;
  promoCode: string;
  discountPct: 10 | 5;
  expiresAt: Date;
  month?: number;
}): Promise<boolean> {
  const { to, ...templateOpts } = opts;
  const { html, text } = generateBundleFollowupEmail(templateOpts);
  const subject = opts.discountPct === 10
    ? `🎉 ${opts.discountPct}% off your next service — use code ${opts.promoCode}`
    : `⏰ Still 5% off — code ${opts.promoCode} expires soon`;
  return sendEmail({ to, from: FROM_EMAIL, subject, html, text });
}

export function generateContactNotificationEmail(contact: any) {
  const html = `
    <h2>New Contact Form Submission - JC ON THE MOVE</h2>
    <p><strong>Name:</strong> ${contact.name}</p>
    <p><strong>Email:</strong> ${contact.email}</p>
    ${contact.phone ? `<p><strong>Phone:</strong> ${contact.phone}</p>` : ''}
    <p><strong>Message:</strong></p>
    <p>${contact.message}</p>
    <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
  `;

  const text = `
    New Contact Form Submission - JC ON THE MOVE
    
    Name: ${contact.name}
    Email: ${contact.email}
    ${contact.phone ? `Phone: ${contact.phone}` : ''}
    Message: ${contact.message}
    Submitted: ${new Date().toLocaleString()}
  `;

  return { html, text };
}

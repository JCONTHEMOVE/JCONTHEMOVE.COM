import { phoneError } from "./phone";

// Final submissions only: quote previews, AI extraction, imported drafts and
// partial Quick Book sessions must remain editable with incomplete information.
const requiredPhone = [
  "/api/leads", "/api/leads/quick-request", "/api/leads/employee", "/api/leads/staff-job", "/api/leads/marketplace",
  "/api/jobs/create-junk", "/api/jobs/create-moving", "/api/jobs/create-labor",
  "/api/window-cleaning/quote", "/api/lawn-care/quote", "/api/labor-quote/submit",
  "/api/promo/half-day-checkout", "/api/cart/checkout", "/api/sponsor/checkout", "/api/trash/subscribe",
];
type PhoneRule = { field: string; required: boolean };
const policies: Record<string, PhoneRule> = Object.fromEntries(requiredPhone.map(path => [path, { field: "phone", required: true }]));
Object.assign(policies, {
  "/api/bookings": { field: "customerPhone", required: true },
  "/api/instant-booking/hold": { field: "customerPhone", required: true },
  "/api/chatbot-quote": { field: "answers.contactPhone", required: true },
  "/api/trash/gift-subscribe": { field: "contact.phone", required: true },
  "/api/contacts": { field: "phone", required: false },
  "/api/invoices": { field: "phone", required: false },
  "/api/catalog/checkout": { field: "customer.phone", required: false },
  "/api/commerce/checkout": { field: "phone", required: true },
  "/api/auth/customer/register": { field: "phoneNumber", required: false },
});

export function customerPhoneIssue(method: string, path: string, body: unknown): { field: string; message: string; value: unknown } | null {
  if (method.toUpperCase() !== "POST") return null;
  // Express routes are case-insensitive and accept a trailing slash by default.
  // Match those semantics so alternate spellings cannot bypass this guard.
  const routePath = path.split("?")[0].replace(/\/+$/, "").toLowerCase();
  const rule = policies[routePath];
  if (!rule) return null;
  let value: any = body;
  for (const part of rule.field.split(".")) value = value?.[part];
  const message = value == null && !rule.required ? null
    : typeof value !== "string" ? "Enter a complete 10-digit phone number, including the area code."
    : phoneError(value, rule.required);
  return message ? { field: rule.field, message, value } : null;
}

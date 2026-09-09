import assert from "node:assert/strict";
import { formatPhoneEntry, normalizeCustomerPhone, phoneError, unchangedLegacyPhone } from "../../../shared/phone";
import { customerPhoneIssue } from "../../../shared/customerPhonePolicy";
import { leadPhoneNumberSchema, insertContactSchema, bookingCreateRequestSchema } from "../../../shared/schema";
import { validateCustomerPhoneSubmission } from "../customerPhoneValidation";

for (const value of ["9062859312", "906-285-9312", "(906) 285-9312", "+1 (906) 285-9312", "19062859312"]) {
  assert.equal(normalizeCustomerPhone(value), "(906) 285-9312");
  assert.equal(formatPhoneEntry(value), "906-285-9312");
  assert.equal(leadPhoneNumberSchema.parse(value), "(906) 285-9312");
}
for (const value of ["", "2859312", "906285931", "90628593122", "1111111111", "0062859312", "9061859312", "9062859312 ext 3", "906abc2859312", "+449062859312"]) {
  assert.ok(phoneError(value), value);
  assert.equal(normalizeCustomerPhone(value), null, value);
  assert.equal(leadPhoneNumberSchema.safeParse(value).success, false, value);
}
assert.match(phoneError("906285931")!, /1 digit is missing/);
assert.equal(phoneError("", false), null);
assert.equal(formatPhoneEntry("90628593122"), "90628593122", "Never truncate extra digits");
assert.equal(formatPhoneEntry("906abc2859312"), "906abc2859312", "Never discard invalid letters");
assert.equal(unchangedLegacyPhone("111-111-1111", "1111111111"), true);
assert.equal(unchangedLegacyPhone("906-111-1111", "1111111111"), false);
assert.equal(insertContactSchema.safeParse({ name: "Test", email: "test@example.com", message: "Test message", phone: "" }).success, true);
assert.equal(insertContactSchema.safeParse({ name: "Test", email: "test@example.com", message: "Test message", phone: "123" }).success, false);

for (const [path, body] of [
  ["/api/leads/staff-job", { phone: "1111111111" }],
  ["/api/bookings", { customerPhone: "123" }],
  ["/api/chatbot-quote", { answers: { contactPhone: "123" } }],
  ["/api/commerce/checkout", { phone: "123" }],
  ["/api/trash/gift-subscribe", { contact: { phone: "123" } }],
] as const) {
  assert.ok(customerPhoneIssue("POST", path, body));
  let nextCalled = false;
  let status = 0;
  let response: any;
  validateCustomerPhoneSubmission({ method: "POST", path, body } as any, {
    status(code: number) { status = code; return this; },
    json(value: unknown) { response = value; },
  } as any, () => { nextCalled = true; });
  assert.equal(status, 400);
  assert.ok(response.fieldErrors);
  assert.equal(nextCalled, false, "Rejected input must never reach a side-effecting handler");
}
assert.equal(customerPhoneIssue("POST", "/api/contacts", {}), null);
for (const path of ["/api/bookings/", "/API/BOOKINGS", "/api/Bookings/?source=phone"]) {
  assert.ok(customerPhoneIssue("POST", path, { customerPhone: "123" }), `Route alias must not bypass validation: ${path}`);
  assert.equal(customerPhoneIssue("POST", path, { customerPhone: "9062859312" }), null);
}
assert.equal(customerPhoneIssue("PATCH", "/api/quick-book/sessions/draft", { customerPhone: "123" }), null);
assert.equal(customerPhoneIssue("POST", "/api/leads/staff-job", { phone: "+1 9062859312" }), null);
console.log("Customer phone formatting, schemas, legacy compatibility and submission guard tests passed");

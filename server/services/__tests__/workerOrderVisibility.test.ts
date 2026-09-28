import assert from "node:assert/strict";
import {
  getWorkerOrderVisibility,
  projectCrewBoardOrder,
  projectWorkerOrder,
} from "../workerOrderVisibility";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

const order = {
  id: "lead-1",
  orderNumber: 1042,
  firstName: "Private",
  lastName: "Customer",
  email: "private@example.com",
  phone: "906-555-0100",
  serviceType: "residential",
  status: "available",
  fromAddress: "123 Secret St, Ironwood, MI 49938",
  confirmedFromAddress: "125 Confirmed St, Ironwood, MI 49938",
  toAddress: "999 Hidden Ave, Ashland, WI 54806",
  confirmedToAddress: "998 Confirmed Ave, Ashland, WI 54806",
  details: "Customer has a fragile collection",
  jobPlanDetails: { inventory: "private inventory" },
  photos: [{ url: "https://example.com/private-home.jpg" }],
  basePrice: "2000.00",
  totalPrice: "3450.00",
  orderLineItems: [{ name: "Labor", total: 2000 }],
  quoteSnapshot: { secret: "quote" },
  zoneSnapshot: { route: "private" },
  paymentPlan: "deposit",
  squarePaymentUrl: "https://pay.example.com/private-token",
  dispatchNotes: "Owner-only note",
  accessInstructionsCiphertext: "encrypted-value",
  jobAccess: { accessCode: "1234", entryInstructions: "Back door" },
  lat: "46.4547000",
  lng: "-90.1710000",
  moveDate: "2026-09-01",
  crewSize: 2,
  confirmedHours: 4,
  crewMembers: ["worker-1"],
  flow: {
    crew: { isClaimed: true, claimed: 1, needed: 2, accepted: 0, openSlots: 1 },
    quote: { ready: true, sent: true },
    payment: { key: "paid", label: "Paid" },
    payout: { state: "paid", label: "Paid", workerPayoutCount: 2, rewardsIssued: 2 },
  },
};

test("unassigned board cards use an allow-list and never serialize private order data", () => {
  const board = projectCrewBoardOrder(order, "platinum", "worker-2");
  const serialized = JSON.stringify(board);
  assert.equal(board.fromAddress, "Ironwood, MI 49938");
  assert.equal(board.toAddress, null);
  assert.equal(board.alreadyApplied, false);
  assert.equal("firstName" in board, false);
  assert.equal("email" in board, false);
  assert.equal("totalPrice" in board, false);
  for (const secret of [
    "Private Customer", "private@example.com", "906-555-0100", "123 Secret St",
    "125 Confirmed St", "999 Hidden Ave", "fragile collection", "3450.00",
    "private-token", "Owner-only note", "encrypted-value", "1234",
  ]) assert.equal(serialized.includes(secret), false, `board response leaked ${secret}`);
});

test("new assigned workers receive operational scope but not customer or financial data", () => {
  const visible = projectWorkerOrder(order, "worker", "assigned");
  assert.equal(visible.fromAddress, order.fromAddress);
  assert.equal(visible.details, order.details);
  assert.equal(visible.firstName, null);
  assert.equal(visible.phone, null);
  assert.equal(visible.totalPrice, null);
  assert.equal(visible.squarePaymentUrl, null);
  assert.equal(visible.jobAccess, null);
  assert.equal("accessInstructionsCiphertext" in visible, false);
});

test("a provisional claim does not reveal an exact address to a new worker", () => {
  const visible = projectWorkerOrder(order, "worker", "claimed");
  assert.equal(visible.fromAddress, "Ironwood, MI 49938");
  assert.equal(visible.confirmedFromAddress, null);
  assert.equal(visible.details, null);
  assert.equal(visible.workerVisibility.exactLocation, false);
});

test("Silver claims unlock operations and contact but keep order pricing hidden", () => {
  const visible = projectWorkerOrder(order, "silver", "claimed");
  assert.equal(visible.fromAddress, order.fromAddress);
  assert.equal(visible.phone, order.phone);
  assert.equal(visible.details, order.details);
  assert.equal(visible.totalPrice, null);
  assert.equal(visible.workerVisibility.pricing, false);
});

test("Bronze unlocks assigned customer identity but not direct contact", () => {
  const visible = projectWorkerOrder(order, "bronze", "assigned");
  assert.equal(visible.firstName, "Private");
  assert.equal(visible.lastName, "Customer");
  assert.equal(visible.phone, null);
  assert.equal(visible.workerVisibility.customerIdentity, true);
  assert.equal(visible.workerVisibility.customerContact, false);
});

test("Silver unlocks assigned contact details but not order pricing", () => {
  const visible = projectWorkerOrder(order, "silver", "assigned");
  assert.equal(visible.email, order.email);
  assert.equal(visible.phone, order.phone);
  assert.equal(visible.totalPrice, null);
  assert.equal(visible.workerVisibility.pricing, false);
});

test("Gold unlocks quote pricing but not payment links", () => {
  const visible = projectWorkerOrder(order, "gold", "assigned");
  assert.equal(visible.totalPrice, order.totalPrice);
  assert.deepEqual(visible.orderLineItems, order.orderLineItems);
  assert.equal(visible.squarePaymentUrl, null);
  assert.equal(visible.dispatchNotes, null);
});

test("Platinum unlocks assigned payment and private operations", () => {
  const visible = projectWorkerOrder(order, "platinum", "assigned");
  assert.equal(visible.squarePaymentUrl, order.squarePaymentUrl);
  assert.equal(visible.dispatchNotes, order.dispatchNotes);
  assert.deepEqual(visible.jobAccess, order.jobAccess);
  assert.equal("accessInstructionsCiphertext" in visible, false);
});

test("Silver quote tasks expose quote inputs while keeping payment and access restricted", () => {
  const visible = projectWorkerOrder(order, "silver", "task");
  assert.equal(visible.fromAddress, order.fromAddress);
  assert.equal(visible.phone, order.phone);
  assert.equal(visible.totalPrice, order.totalPrice);
  assert.equal(visible.squarePaymentUrl, null);
  assert.equal(visible.jobAccess, null);
});

test("visibility metadata explains every locked group and tier", () => {
  const visibility = getWorkerOrderVisibility("bronze", "assigned");
  assert.equal(visibility.customerIdentity, true);
  assert.equal(visibility.customerContact, false);
  assert.ok(visibility.locked.some((item) => item.key === "customer_contact" && item.unlockAt === "Silver"));
  assert.ok(visibility.locked.some((item) => item.key === "pricing" && item.unlockAt === "Gold"));
  assert.ok(visibility.locked.some((item) => item.key === "payment" && item.unlockAt === "Platinum"));
});

test("workflow links, receipts and staff attestations stay out of crew projections", () => {
  const privateOrder = { ...order, flow: { ...order.flow, operations: { delivery: { quoteAccessUrl: "private-quote-link" } } }, jobPlanDetails: { inventory: "boxes", customerConfirmation: { note: "private attestation" }, quoteDelivery: { quoteAccessUrl: "private-quote-link" }, paymentReceipt: { amount: 500, actorId: "owner" } } };
  for (const tier of ["worker", "silver", "gold", "platinum"]) {
    const visible = projectWorkerOrder(privateOrder, tier, "assigned");
    assert.equal(visible.flow.operations, undefined);
    assert.equal(visible.jobPlanDetails?.customerConfirmation, undefined);
    assert.equal(visible.jobPlanDetails?.quoteDelivery, undefined);
    assert.equal(visible.jobPlanDetails?.paymentReceipt, undefined);
  }
  assert.deepEqual(projectWorkerOrder(privateOrder, "platinum", "admin").jobPlanDetails, privateOrder.jobPlanDetails);
});

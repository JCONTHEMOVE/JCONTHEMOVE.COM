import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EMPTY_QUICK_BOOK_DRAFT,
  evaluateQuickBookReadiness,
  quickBookDraftSchema,
} from "../../../shared/quickBook";
import { deterministicQuickBookExtraction, extractQuickBookMessage } from "../quickBookAi";
import { appendQuickBookTranscript, mergeQuickBookDraft, sealQuickBookDraft, sessionDraft } from "../quickBookSessions";

const fixture = deterministicQuickBookExtraction(
  "Beth in Bessemer, loading a 26-foot U-Haul Friday at 10, three movers for two hours, no stairs and no special items.",
  new Date("2026-09-03T12:00:00-05:00"),
);
assert.equal(fixture.agent.provider, "deterministic");
assert.equal(fixture.patch.customerName, "Beth");
assert.equal(fixture.patch.confirmedDate, "2026-09-04");
assert.equal(fixture.patch.arrivalWindow, "10:00 AM – 11:00 AM");
assert.equal(fixture.patch.crewSize, 3);
assert.equal(fixture.patch.estimatedHours, 2);
assert.equal(fixture.patch.truckConfig, "rental_truck");
assert.equal(fixture.patch.truckSize, "26_ft");
assert.equal(fixture.patch.workScope, "load_only");
assert.equal(fixture.patch.stairsFlights, 0);
assert.equal(fixture.patch.specialItemsConfirmed, true);

const negativeFixture = deterministicQuickBookExtraction("Customer said do not text. No elevator and no truck.");
assert.equal(negativeFixture.patch.smsConsent, false);
assert.equal(negativeFixture.patch.hasElevator, false);
assert.equal(negativeFixture.patch.truckConfig, "no_truck");
const specialtyFixture = deterministicQuickBookExtraction("There is a piano, safe, refrigerator, washer and dryer, patio furniture, and 35 boxes.");
assert.equal(specialtyFixture.patch.specialItems?.piano, true);
assert.equal(specialtyFixture.patch.specialItems?.safe, true);
assert.equal(specialtyFixture.patch.inventory?.refrigerator, true);
assert.equal(specialtyFixture.patch.inventory?.washerDryer, true);
assert.equal(specialtyFixture.patch.inventory?.patioFurniture, true);
assert.equal(specialtyFixture.patch.inventory?.boxes, 35);
const ambiguousFixture = deterministicQuickBookExtraction("Book it sometime next month around lunch.");
assert.equal(ambiguousFixture.patch.confirmedDate, null);
assert.equal(ambiguousFixture.patch.arrivalWindow, null);

const previousGatewayKey = process.env.AI_GATEWAY_API_KEY;
delete process.env.AI_GATEWAY_API_KEY;
const unavailableAi = await extractQuickBookMessage({
  message: "Three movers for two hours",
  currentDraft: EMPTY_QUICK_BOOK_DRAFT,
});
assert.equal(unavailableAi.agent.provider, "deterministic");
assert.equal(unavailableAi.agent.fallbackUsed, true);
assert.match(unavailableAi.agent.reason || "", /AI_GATEWAY_API_KEY/);
if (previousGatewayKey) process.env.AI_GATEWAY_API_KEY = previousGatewayKey;

const spokenConsent = mergeQuickBookDraft({
  current: EMPTY_QUICK_BOOK_DRAFT,
  patch: { smsConsent: true },
  source: "voice",
});
assert.equal(spokenConsent.draft.smsConsent, null, "speech must not cross the explicit consent gate");
const tappedConsent = mergeQuickBookDraft({
  current: spokenConsent.draft,
  patch: { smsConsent: false },
  source: "tap",
});
assert.equal(tappedConsent.draft.smsConsent, false, "an explicit No tap is a valid consent decision");

const rescheduled = mergeQuickBookDraft({
  current: quickBookDraftSchema.parse({
    crewSize: 2,
    crewMemberIds: ["worker-1", "worker-2"],
    crewLeadUserId: "worker-1",
    crewConfirmed: true,
  }),
  patch: { confirmedDate: "2026-09-05" },
  source: "tap",
});
assert.equal(rescheduled.draft.crewConfirmed, false, "schedule edits require named-crew reconfirmation");

const spokenCrew = mergeQuickBookDraft({
  current: quickBookDraftSchema.parse({ crewSize: 2 }),
  patch: { crewMemberIds: ["worker-1", "worker-2"], crewLeadUserId: "worker-1", crewConfirmed: true } as any,
  source: "typed",
});
assert.deepEqual(spokenCrew.draft.crewMemberIds, [], "AI/text cannot assign named crew");
assert.equal(spokenCrew.draft.crewConfirmed, false);

const draftWithAccess = quickBookDraftSchema.parse({
  pickupAccessCode: "2468",
  destinationAccessCode: "1357",
  pickupInstructions: "Use north door",
  destinationInstructions: "Call from driveway",
});
const sealed = sealQuickBookDraft(draftWithAccess) as Record<string, unknown>;
assert.equal(sealed.pickupAccessCode, "");
assert.equal(sealed.destinationInstructions, "");
assert.equal(typeof sealed.__accessCiphertext, "string");
assert.doesNotMatch(JSON.stringify(sealed), /2468|1357|north door|driveway/);
const unsealed = sessionDraft({ structuredDraft: sealed } as any);
assert.equal(unsealed.pickupAccessCode, "2468");
assert.equal(unsealed.destinationInstructions, "Call from driveway");
assert.doesNotMatch(appendQuickBookTranscript(null, "Gate code is 2468", "voice"), /2468/);

const readyDraft = quickBookDraftSchema.parse({
  customerName: "Beth Grauvnder",
  customerPhone: "920-379-5876",
  smsConsent: true,
  pickupAddress: "123 Main St, Bessemer, MI",
  confirmedDate: "2026-09-04",
  arrivalWindow: "10:00 AM – 11:00 AM",
  workScope: "load_only",
  truckConfig: "customer_truck",
  stairsFlights: 0,
  hasElevator: false,
  specialItemsConfirmed: true,
  crewSize: 3,
  estimatedHours: 2,
  crewMemberIds: ["worker-1", "worker-2", "worker-3"],
  crewLeadUserId: "worker-1",
  crewConfirmed: true,
});
assert.deepEqual(evaluateQuickBookReadiness(readyDraft, { quoteReady: true }), {
  ready: true,
  missingFields: [],
  reviewReasons: [],
});
assert.equal(evaluateQuickBookReadiness({ ...readyDraft, arrivalWindow: "10:00 AM – 12:00 PM" }, { quoteReady: true }).ready, false);
assert.ok(evaluateQuickBookReadiness({ ...readyDraft, pickupAddress: "Bessemer, MI" }, { quoteReady: true }).missingFields.includes("complete pickup address"));
assert.equal(evaluateQuickBookReadiness({
  ...readyDraft,
  specialItems: { ...readyDraft.specialItems, piano: true },
}, { quoteReady: true }).reviewReasons.length, 1, "specialty items require owner review");

const routeSource = readFileSync(resolve(process.cwd(), "server/routes.ts"), "utf8");
const pricingHelper = routeSource.slice(routeSource.indexOf("async function calculateQuickBookState"), routeSource.indexOf("function quickBookNextPrompt"));
assert.match(pricingHelper, /calculateJobQuoteWithPromo/);
const finalRouteStart = routeSource.indexOf('app.post("/api/quick-book/sessions/:id/book"');
const quickBookRoute = routeSource.slice(finalRouteStart, routeSource.indexOf("const jobPlanDetailsSchema", finalRouteStart));
assert.match(quickBookRoute, /FOR UPDATE/);
assert.ok(quickBookRoute.indexOf('client\.query("BEGIN")') !== -1 || quickBookRoute.indexOf('client.query("BEGIN")') !== -1);
assert.ok(quickBookRoute.indexOf('client.query("BEGIN")') < quickBookRoute.indexOf("calculateQuickBookState"), "final pricing must be recomputed after the booking transaction starts");
assert.match(quickBookRoute, /await client\.query\("COMMIT"\)/);
assert.ok(quickBookRoute.indexOf("COMMIT") < quickBookRoute.lastIndexOf('emitJobEvent("crew_plan_saved"'), "new crew alert must happen only after commit");
assert.match(quickBookRoute, /customerMessageSent: false/);
assert.match(quickBookRoute, /squareInvoiceCreated: false/);
assert.doesNotMatch(quickBookRoute, /createSquareInvoice|sendEmail\(/);
assert.match(quickBookRoute, /quick-book:\$\{row\.id\}:\$\{storedBookKey \|\| input\.idempotencyKey\}/);
assert.ok(quickBookRoute.indexOf("if (!state.ready || !state.quote)") < quickBookRoute.lastIndexOf('emitJobEvent("crew_plan_saved"'));

const transcribeRouteStart = routeSource.indexOf('app.post("/api/quick-book/transcribe"');
const transcribeRoute = routeSource.slice(transcribeRouteStart, finalRouteStart);
assert.match(transcribeRoute, /multer\.memoryStorage\(\)/);
assert.match(transcribeRoute, /durationInSeconds \|\| 0\) > 61/);
assert.match(transcribeRoute, /rawAudioStored: false/);
assert.match(transcribeRoute, /Type the job details instead/);

const aiSource = readFileSync(resolve(process.cwd(), "server/services/quickBookAi.ts"), "utf8");
assert.match(aiSource, /quickBookExtractionSchema\.parse\(result\.output\)/);
assert.ok(aiSource.indexOf("quickBookExtractionSchema.parse(result.output)") < aiSource.lastIndexOf("deterministicQuickBookExtraction("), "invalid AI output must fall back to deterministic extraction");

const sessionSource = readFileSync(resolve(process.cwd(), "server/services/quickBookSessions.ts"), "utf8");
assert.match(sessionSource, /INTERVAL '30 days'/);
assert.match(sessionSource, /SET transcript_text = NULL/);

const pageSource = readFileSync(resolve(process.cwd(), "client/src/pages/quick-book.tsx"), "utf8");
assert.match(pageSource, /Book & Alert Crew/);
assert.match(pageSource, /SpeechInput/);
assert.match(pageSource, /JOB_SCHEDULE_OPTIONS\.map/);
assert.match(pageSource, /smsConsent: true/);
assert.match(pageSource, /smsConsent: false/);
assert.match(pageSource, /localStorage\.getItem\(SESSION_KEY\)/);
assert.match(pageSource, /Draft resumed/);
assert.match(pageSource, /Microphone permission was denied|Voice unavailable/);
assert.match(pageSource, /recording could not be transcribed|Could not transcribe|Voice transcription is disabled/i);

const appSource = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");
assert.match(appSource, /import\.meta\.env\.DEV.*quick-book-fixture/s);

console.log("Quick Book extraction, gate, and transaction guardrail tests passed");

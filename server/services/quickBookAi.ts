import {
  Output,
  ToolLoopAgent,
  experimental_transcribe as transcribe,
  gateway,
} from "ai";
import {
  quickBookExtractionSchema,
  type QuickBookDraft,
  type QuickBookExtraction,
} from "@shared/quickBook";
import { JOB_SCHEDULE_OPTIONS } from "@shared/jcOperations";

export const QUICK_BOOK_DEFAULT_MODEL = "openai/gpt-5.4-nano";
export const QUICK_BOOK_DEFAULT_TRANSCRIPTION_MODEL = "openai/gpt-4o-mini-transcribe";

type QuickBookAgentResult = QuickBookExtraction & {
  agent: {
    provider: "gateway" | "deterministic";
    model: string;
    fallbackUsed: boolean;
    reason?: string;
  };
};

const wordNumbers: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function emptyPatch(): QuickBookExtraction["patch"] {
  return {
    serviceType: null,
    customerName: null,
    customerPhone: null,
    customerEmail: null,
    smsConsent: null,
    confirmedDate: null,
    arrivalWindow: null,
    pickupAddress: null,
    destinationAddress: null,
    pickupAccessCode: null,
    pickupInstructions: null,
    destinationAccessCode: null,
    destinationInstructions: null,
    additionalStops: null,
    propertySize: null,
    bedrooms: null,
    stairsFlights: null,
    hasElevator: null,
    workScope: null,
    truckConfig: null,
    truckSize: null,
    estimatedHours: null,
    crewSize: null,
    specialItemsConfirmed: null,
    specialItems: null,
    inventory: null,
    promoCode: null,
    notes: null,
  };
}

function centralDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseSpokenNumber(raw: string | undefined) {
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (wordNumbers[normalized]) return wordNumbers[normalized];
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function nextWeekdayDate(weekday: number, now = new Date()) {
  const today = centralDateKey(now);
  const base = new Date(`${today}T12:00:00-05:00`);
  const delta = (weekday - base.getDay() + 7) % 7 || 7;
  base.setDate(base.getDate() + delta);
  return centralDateKey(base);
}

function parseDate(text: string, now: Date) {
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    const currentYear = Number(centralDateKey(now).slice(0, 4));
    const rawYear = slash[3] ? Number(slash[3]) : currentYear;
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    return `${year}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  }
  if (/\btomorrow\b/i.test(text)) {
    const base = new Date(`${centralDateKey(now)}T12:00:00-05:00`);
    base.setDate(base.getDate() + 1);
    return centralDateKey(base);
  }
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const index = weekdays.findIndex((day) => new RegExp(`\\b${day}\\b`, "i").test(text));
  return index >= 0 ? nextWeekdayDate(index, now) : null;
}

function parseArrivalWindow(text: string) {
  const range = text.match(/\b(\d{1,2})(?::00)?\s*(am|pm)?\s*(?:-|to|through)\s*(\d{1,2})(?::00)?\s*(am|pm)\b/i);
  if (range) {
    const startPeriod = (range[2] || range[4]).toUpperCase();
    const endPeriod = range[4].toUpperCase();
    const label = `${Number(range[1])}:00 ${startPeriod} – ${Number(range[3])}:00 ${endPeriod}`;
    if (JOB_SCHEDULE_OPTIONS.some((option) => option.value === label)) return label;
  }
  const at = text.match(/\b(?:at|around|start(?:ing)? at)\s*(\d{1,2})(?::00)?\s*(am|pm)?\b/i);
  if (!at) return /flexible|tbd|any time/i.test(text) ? "Flexible / TBD" : null;
  let hour = Number(at[1]);
  const period = at[2]?.toLowerCase();
  if (period === "pm" && hour < 12) hour += 12;
  if (period === "am" && hour === 12) hour = 0;
  if (!period && hour < 7) hour += 12;
  return JOB_SCHEDULE_OPTIONS.find((option) => option.start === `${String(hour).padStart(2, "0")}:00`)?.value || null;
}

export function deterministicQuickBookExtraction(message: string, now = new Date(), reason?: string): QuickBookAgentResult {
  const text = message.trim();
  const lower = text.toLowerCase();
  const patch = emptyPatch();
  const fieldConfidence: Record<string, "high" | "medium" | "low"> = {};
  const set = <K extends keyof typeof patch>(key: K, value: (typeof patch)[K], confidence: "high" | "medium" | "low" = "high") => {
    patch[key] = value;
    fieldConfidence[key] = confidence;
  };

  const phone = text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/)?.[0];
  if (phone) set("customerPhone", phone);
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (email) set("customerEmail", email);

  const named = text.match(/(?:customer(?:'s)? name is|name is|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/);
  const commaName = text.match(/^\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s*,/);
  const localityName = text.match(/^\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+in\s+[A-Z][a-z]+\s*,/);
  if (named?.[1] || commaName?.[1] || localityName?.[1]) set("customerName", (named?.[1] || commaName?.[1] || localityName?.[1])!.trim(), "medium");

  if (/\b(?:okay|ok|yes|consent)\s+(?:to\s+)?text\b|\btexts? (?:are )?ok\b/i.test(text)) set("smsConsent", true);
  if (/\b(?:do not|don't|no)\s+text\b|\btext(?:s|ing)?\s+(?:is\s+)?not\s+ok\b/i.test(text)) set("smsConsent", false);

  const date = parseDate(text, now);
  if (date) set("confirmedDate", date, /\d/.test(text) ? "high" : "medium");
  const window = parseArrivalWindow(text);
  if (window) set("arrivalWindow", window, "medium");

  const explicitAddress = text.match(/(?:pickup|from|at|address is)\s+([^.;]+?(?:\b\d{5}(?:-\d{4})?\b|,\s*[A-Z]{2}\b))/i)?.[1];
  if (explicitAddress) set("pickupAddress", explicitAddress.trim(), "medium");
  const destination = text.match(/(?:drop(?:-| )?off|destination|to)\s+([^.;]+?(?:\b\d{5}(?:-\d{4})?\b|,\s*[A-Z]{2}\b))/i)?.[1];
  if (destination) set("destinationAddress", destination.trim(), "medium");
  const accessCode = text.match(/\b(?:gate|door|access|lockbox)\s+code\s*(?:is|:|=)?\s*([a-z0-9#*-]+)/i)?.[1];
  if (accessCode) set("pickupAccessCode", accessCode, "medium");

  const crew = text.match(/\b(one|two|three|four|five|six|\d{1,2})\s+(?:movers?|person crew|people)\b/i);
  const crewSize = parseSpokenNumber(crew?.[1]);
  if (crewSize) set("crewSize", crewSize);
  const hours = text.match(/\b(one|two|three|four|five|six|seven|eight|\d{1,2})\s*(?:hours?|hrs?)\b/i);
  const estimatedHours = parseSpokenNumber(hours?.[1]);
  if (estimatedHours) set("estimatedHours", estimatedHours);

  if (/\bload(?:ing)?\s*(?:only)?\b/i.test(text) && !/unload|both|load\s*(?:and|\+)\s*unload/i.test(text)) set("workScope", "load_only");
  if (/\bunload(?:ing)?\s*(?:only)?\b/i.test(text) && !/both|load\s*(?:and|\+)\s*unload/i.test(text)) set("workScope", "unload_only");
  if (/\bboth\b|load\s*(?:and|\+)\s*unload|full move/i.test(text)) set("workScope", "load_unload");

  if (/\b(?:customer|their|own)\s+truck\b/i.test(text)) set("truckConfig", "customer_truck");
  else if (/\b(?:u-?haul|rental)\b/i.test(text)) set("truckConfig", "rental_truck");
  else if (/\b(?:jc|company)\s+truck\b/i.test(text)) set("truckConfig", "company_truck");
  else if (/\bno\s+truck\b/i.test(text)) set("truckConfig", "no_truck");
  if (/\b26\s*-?\s*(?:foot|ft)/i.test(text)) set("truckSize", "26_ft");
  else if (/\b20\s*-?\s*(?:foot|ft)/i.test(text)) set("truckSize", "20_ft");
  else if (/\b15\s*-?\s*(?:foot|ft)/i.test(text)) set("truckSize", "15_ft");
  else if (/\bcargo\s+van\b/i.test(text)) set("truckSize", "cargo_van");

  const stairs = text.match(/\b(\d{1,2}|one|two|three|four|five)\s+(?:flights?\s+of\s+)?stairs?\b/i);
  if (/\bno\s+stairs?\b/i.test(text)) set("stairsFlights", 0);
  else if (stairs) set("stairsFlights", parseSpokenNumber(stairs[1]));
  if (/\bno\s+elevator\b/i.test(text)) set("hasElevator", false);
  else if (/\belevator\b/i.test(text)) set("hasElevator", true, "medium");

  if (/\bno\s+(?:piano|safe|hot tub|pool table|large|special)(?:\s+items?)?/i.test(text)) {
    set("specialItemsConfirmed", true);
    set("specialItems", { piano: false, safe: false, hotTub: false, poolTable: false, otherLargeItem: false, notes: null });
  } else {
    const specialItems = {
      piano: /\bpiano\b/i.test(text) ? true : null,
      safe: /\bsafe\b/i.test(text) ? true : null,
      hotTub: /\bhot\s*tub\b/i.test(text) ? true : null,
      poolTable: /\bpool\s*table\b/i.test(text) ? true : null,
      otherLargeItem: /\blarge item\b/i.test(text) ? true : null,
      notes: null,
    };
    if (Object.values(specialItems).some((value) => value === true)) {
      set("specialItemsConfirmed", true);
      set("specialItems", specialItems);
    }
  }

  const bedrooms = text.match(/\b(\d{1,2}|one|two|three|four|five|six)\s*(?:bed(?:room)?s?|br)\b/i);
  if (bedrooms) {
    const count = parseSpokenNumber(bedrooms[1]);
    set("bedrooms", count);
    if (count !== null) set("propertySize", `${count}-bedroom`, "medium");
  }
  const boxes = text.match(/\b(\d{1,4})\s+boxes\b/i);
  const inventory = {
    boxes: boxes ? Number(boxes[1]) : null,
    washerDryer: /\bwasher(?:\s*(?:and|\/|\+)?\s*dryer)?\b/i.test(text) ? true : null,
    refrigerator: /\b(?:refrigerator|fridge)\b/i.test(text) ? true : null,
    patioFurniture: /\bpatio\s+furniture\b/i.test(text) ? true : null,
    notes: null,
  };
  if (Object.values(inventory).some((value) => value !== null)) set("inventory", inventory);
  const promo = text.match(/\b(?:promo|code)\s+([A-Z0-9_-]{3,30})\b/i)?.[1];
  if (promo) set("promoCode", promo.toUpperCase());
  if (/\blabor(?:\s+only)?\b/i.test(lower)) set("serviceType", "labor");
  else if (/\bmov(?:e|ing)\b/i.test(lower)) set("serviceType", "moving");

  const extractedCount = Object.values(patch).filter((value) => value !== null).length;
  return {
    patch,
    fieldConfidence,
    ambiguities: [],
    assistantMessage: extractedCount > 0
      ? `I captured ${extractedCount} job details. Check the job card and answer the next missing item.`
      : "I did not catch a definite job detail. Try the customer, addresses, schedule, crew size, and hours.",
    nextQuestion: "",
    suggestions: [],
    agent: {
      provider: "deterministic",
      model: "shared/quick-book-parser",
      fallbackUsed: true,
      ...(reason ? { reason } : {}),
    },
  };
}

function createQuickBookAgent(model: string) {
  return new ToolLoopAgent({
    model: gateway(model),
    instructions: [
      "You extract moving-job facts for JC ON THE MOVE staff.",
      "Return only facts explicitly stated in the newest staff message; use null for every unstated patch field.",
      "Never invent an address, customer consent, crew assignment, price, fee, availability, or promotion eligibility.",
      "Resolve relative dates using the supplied America/Chicago date. If a date is ambiguous, leave it null and explain the ambiguity.",
      `Arrival windows must exactly match one of: ${JOB_SCHEDULE_OPTIONS.map((option) => option.value).join("; ")}.`,
      "A phone number never implies SMS consent. Only extract consent when the speaker explicitly says yes/okay or no/do not text.",
      "The assistant message should be one short operational sentence. Suggestions should be short tap-ready answers.",
    ].join(" "),
    output: Output.object({ schema: quickBookExtractionSchema }),
  });
}

export function isQuickBookAiConfigured() {
  return Boolean(process.env.AI_GATEWAY_API_KEY);
}

export async function extractQuickBookMessage(args: {
  message: string;
  currentDraft: QuickBookDraft;
  now?: Date;
}): Promise<QuickBookAgentResult> {
  const now = args.now || new Date();
  const model = process.env.QUICK_BOOK_MODEL || QUICK_BOOK_DEFAULT_MODEL;
  if (!isQuickBookAiConfigured()) {
    return deterministicQuickBookExtraction(args.message, now, "AI_GATEWAY_API_KEY is not configured");
  }

  try {
    const agent = createQuickBookAgent(model);
    const result = await agent.generate({
      prompt: JSON.stringify({
        currentCentralDate: centralDateKey(now),
        currentDraft: args.currentDraft,
        newestStaffMessage: args.message,
      }),
      abortSignal: AbortSignal.timeout(15_000),
    });
    return {
      ...quickBookExtractionSchema.parse(result.output),
      agent: { provider: "gateway", model, fallbackUsed: false },
    };
  } catch (error) {
    return deterministicQuickBookExtraction(
      args.message,
      now,
      error instanceof Error ? error.message : "AI extraction failed",
    );
  }
}

export async function transcribeQuickBookAudio(audio: Buffer) {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI Gateway transcription is not configured");
  const model = process.env.QUICK_BOOK_TRANSCRIPTION_MODEL || QUICK_BOOK_DEFAULT_TRANSCRIPTION_MODEL;
  const result = await transcribe({
    model: gateway.transcriptionModel(model),
    audio,
    abortSignal: AbortSignal.timeout(20_000),
  });
  return { text: result.text.trim(), model, durationInSeconds: result.durationInSeconds };
}

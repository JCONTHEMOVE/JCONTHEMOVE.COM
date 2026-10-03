/** Draft snow estimates. These are planning assumptions, never a payment authorization.
 * Shared by the public calculator and server intake so submitted prices are not trusted.
 */
export const SNOW_PRICING_VERSION = "snow-draft-2026-09-29";
export const SNOW_DEPTHS = [4, 14, 24, 36] as const;
export type SnowDepth = typeof SNOW_DEPTHS[number];
export type SnowScenario = "low" | "target" | "high";
export type SnowPlan = "single" | "monthly" | "seasonal";
export type SnowService = "driveway" | "front_steps" | "front_back_steps" | "works" | "end_only";
export const SNOW_PROPERTIES = [
  { id: "single", label: "Small single car", widthFeet: 10, lengthFeet: 40 },
  { id: "double", label: "Double driveway", widthFeet: 20, lengthFeet: 100 },
  { id: "large", label: "Extra large", widthFeet: 30, lengthFeet: 100 },
] as const;
export const SNOW_SERVICES: ReadonlyArray<{ id: SnowService; label: string }> = [
  { id: "driveway", label: "Driveway Only" },
  { id: "front_steps", label: "Driveway Front Steps" },
  { id: "front_back_steps", label: "Driveway Front + Back Steps" },
  { id: "works", label: "The Works (Driveway, Steps and Salt)" },
  { id: "end_only", label: "End of Driveway Only" },
];
export interface SnowCaseConfig {
  id: SnowScenario; label: string; base: number; minimum: number;
  backDragPercent: number; visitsPerMonth: number; bank: number;
}
export interface SnowPricingConfig {
  referenceArea: number; roundTo: number; travel: number; bankReferenceFeet: number;
  depthFactors: Record<SnowDepth, number>;
  cases: [SnowCaseConfig, SnowCaseConfig, SnowCaseConfig];
  serviceAddons: Record<SnowService, [number, number, number]>;
}
export const SNOW_PRICING_DEFAULTS: SnowPricingConfig = {
  referenceArea: 2000, roundTo: 5, travel: 0, bankReferenceFeet: 25,
  depthFactors: { 4: 1, 14: 1.75, 24: 2.75, 36: 4 },
  cases: [
    { id: "low", label: "Low", base: 50, minimum: 30, backDragPercent: 20, visitsPerMonth: 8, bank: 10 },
    { id: "target", label: "Target", base: 62.5, minimum: 35, backDragPercent: 30, visitsPerMonth: 12, bank: 15 },
    { id: "high", label: "High", base: 75, minimum: 40, backDragPercent: 40, visitsPerMonth: 15, bank: 20 },
  ],
  serviceAddons: { driveway: [0, 0, 0], front_steps: [10, 15, 20], front_back_steps: [20, 25, 30], works: [30, 40, 50], end_only: [0, 0, 0] },
};
export interface SnowQuoteInput {
  version: 1; widthFeet: number; lengthFeet: number; depthInches: SnowDepth;
  plan: SnowPlan; scenario: SnowScenario; serviceType: SnowService;
  backDrag: boolean; backDragPercent: number; streetBank: boolean; bankWidthFeet: number;
  visitsPerMonth: number; seasonMonths: number; installments: number;
  seasonalPayment: "full" | "installment";
}
export const SNOW_INITIAL_SELECTION: SnowQuoteInput = {
  version: 1, widthFeet: 20, lengthFeet: 100, depthInches: 4, plan: "single", scenario: "target",
  serviceType: "driveway", backDrag: true, backDragPercent: 30, streetBank: true,
  bankWidthFeet: 25, visitsPerMonth: 12, seasonMonths: 5, installments: 5, seasonalPayment: "full",
};
export class SnowPricingValidationError extends Error {
  constructor(message: string) { super(message); this.name = "SnowPricingValidationError"; }
}
function finite(value: unknown, min: number, max: number, label: string, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new SnowPricingValidationError(`${label} must be ${integer ? "a whole number " : ""}between ${min} and ${max}.`);
  }
  return value;
}
function choice<T extends string | number>(value: unknown, choices: readonly T[], label: string): T {
  if (!choices.includes(value as T)) throw new SnowPricingValidationError(`Choose a supported ${label}.`);
  return value as T;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new SnowPricingValidationError(`${label} must be true or false.`);
  return value;
}
/** Strictly validates untrusted input; ignores unknown client-supplied price fields. */
export function parseSnowQuoteInput(raw: unknown): SnowQuoteInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SnowPricingValidationError("Snow quote details are required.");
  const v = raw as Record<string, unknown>;
  if (v.version !== 1) throw new SnowPricingValidationError("Unsupported snow quote version.");
  const input: SnowQuoteInput = {
    version: 1,
    widthFeet: finite(v.widthFeet, 1, 1000, "Driveway width"),
    lengthFeet: finite(v.lengthFeet, 1, 10000, "Driveway length"),
    depthInches: choice(v.depthInches, SNOW_DEPTHS, "snow depth"),
    plan: choice(v.plan, ["single", "monthly", "seasonal"] as const, "plan"),
    scenario: choice(v.scenario, ["low", "target", "high"] as const, "scenario"),
    serviceType: choice(v.serviceType, SNOW_SERVICES.map(service => service.id), "service"),
    backDrag: boolean(v.backDrag, "Back-drag selection"),
    backDragPercent: finite(v.backDragPercent, 20, 40, "Back-drag adjustment"),
    streetBank: boolean(v.streetBank, "Street-bank selection"),
    bankWidthFeet: finite(v.bankWidthFeet, 1, 500, "Street-bank width"),
    visitsPerMonth: finite(v.visitsPerMonth, 1, 100, "Visits per month", true),
    seasonMonths: finite(v.seasonMonths, 1, 12, "Season months", true),
    installments: finite(v.installments, 1, 24, "Installments", true),
    seasonalPayment: choice(v.seasonalPayment, ["full", "installment"] as const, "season payment"),
  };
  if (input.serviceType === "end_only" && !input.streetBank) throw new SnowPricingValidationError("End-of-driveway service requires street-bank handling.");
  return input;
}
function validateConfig(config: SnowPricingConfig): void {
  finite(config.referenceArea, 1, 100000, "Reference area");
  finite(config.roundTo, 0.01, 1000, "Rounding increment");
  finite(config.travel, 0, 10000, "Travel charge");
  finite(config.bankReferenceFeet, 1, 500, "Bank reference width");
  if (!Array.isArray(config.cases) || config.cases.length !== 3) throw new SnowPricingValidationError("Three pricing cases are required.");
  config.cases.forEach((c, index) => {
    if (c.id !== ["low", "target", "high"][index]) throw new SnowPricingValidationError("Pricing cases must be low, target, high in order.");
    finite(c.base, 0, 10000, "Base price"); finite(c.minimum, 0, 10000, "Minimum price");
    finite(c.backDragPercent, 20, 40, "Back-drag adjustment");
    finite(c.visitsPerMonth, 1, 100, "Visits per month", true); finite(c.bank, 0, 10000, "Bank price");
  });
  SNOW_DEPTHS.forEach(depth => finite(config.depthFactors[depth], 0.1, 20, "Depth multiplier"));
  SNOW_SERVICES.forEach(service => {
    const addons = config.serviceAddons[service.id];
    if (!Array.isArray(addons) || addons.length !== 3) throw new SnowPricingValidationError("Three service add-on prices are required.");
    addons.forEach(addon => finite(addon, 0, 10000, "Service add-on"));
  });
}
function roundUp(value: number, step: number): number { return Math.round(Math.ceil((value - 1e-9) / step) * step * 100) / 100; }
export interface SnowCaseEstimate {
  id: SnowScenario; label: string; base: number; drag: number; bank: number; serviceAddon: number;
  depthFactor: number; backDragPercent: number; visitsPerMonth: number; seasonVisits: number;
  single: number; monthly: number; seasonal: number; installment: number; finalInstallment: number;
}
export interface SnowQuoteEstimate {
  input: SnowQuoteInput; areaSqFt: number; depthFactor: number; reviewRequired: boolean; manualQuoteRequired: boolean;
  reviewReasons: string[]; cases: SnowCaseEstimate[]; selected: SnowCaseEstimate;
  total: number; amount: number;
}
/** Monthly and seasonal figures are capped visit budgets at the selected depth, not unlimited plans. */
export function calculateSnowQuote(raw: SnowQuoteInput, config: SnowPricingConfig = SNOW_PRICING_DEFAULTS): SnowQuoteEstimate {
  const input = parseSnowQuoteInput(raw);
  validateConfig(config);
  const areaSqFt = input.widthFeet * input.lengthFeet;
  const factor = config.depthFactors[input.depthInches];
  const endOnly = input.serviceType === "end_only";
  const cases = config.cases.map((c, index): SnowCaseEstimate => {
    const backDragPercent = input.scenario === c.id ? input.backDragPercent : c.backDragPercent;
    const visitsPerMonth = input.scenario === c.id ? input.visitsPerMonth : c.visitsPerMonth;
    const base = endOnly ? 0 : Math.max(c.base * areaSqFt / config.referenceArea, c.minimum);
    const drag = input.backDrag && !endOnly ? base * backDragPercent / 100 : 0;
    const bank = input.streetBank ? c.bank * input.bankWidthFeet / config.bankReferenceFeet : 0;
    const serviceAddon = config.serviceAddons[input.serviceType][index];
    const work = endOnly ? Math.max(bank, c.minimum) : base + drag + bank + serviceAddon;
    const single = endOnly ? 0 : roundUp(work * factor + config.travel, config.roundTo);
    const monthly = roundUp(single * visitsPerMonth, config.roundTo);
    const seasonal = roundUp(single * visitsPerMonth * input.seasonMonths, config.roundTo);
    const installmentCents = Math.floor(Math.round(seasonal * 100) / input.installments);
    const finalCents = Math.round(seasonal * 100) - installmentCents * (input.installments - 1);
    return { id: c.id, label: c.label, base, drag, bank, serviceAddon, depthFactor: factor,
      backDragPercent, visitsPerMonth, seasonVisits: visitsPerMonth * input.seasonMonths,
      single, monthly, seasonal, installment: installmentCents / 100, finalInstallment: finalCents / 100 };
  });
  const selected = cases.find(c => c.id === input.scenario)!;
  const total = selected[input.plan];
  const amount = input.plan === "seasonal" && input.seasonalPayment === "installment" ? selected.installment : total;
  const reviewReasons = ["Draft rates require a property and scope review before a payable quote is issued."];
  if (endOnly) reviewReasons.push("End-of-driveway-only service needs an apron-specific measurement and manual quote.");
  if (input.depthInches >= 24) reviewReasons.push("24–36 inch snow requires equipment, access, compaction and removal-capacity review.");
  if (areaSqFt > 3000) reviewReasons.push("Properties larger than the extra-large preset require a site review.");
  return { input, areaSqFt, depthFactor: factor, reviewRequired: true, manualQuoteRequired: endOnly, reviewReasons, cases, selected, total, amount };
}
export function snowScenarioMatrix(input: SnowQuoteInput, config: SnowPricingConfig = SNOW_PRICING_DEFAULTS) {
  return SNOW_PROPERTIES.flatMap((property, propertyIndex) => SNOW_DEPTHS.map((depthInches, depthIndex) => ({
    id: propertyIndex * 4 + depthIndex + 1, property: property.label, widthFeet: property.widthFeet,
    lengthFeet: property.lengthFeet, depthInches,
    ...calculateSnowQuote({ ...input, widthFeet: property.widthFeet, lengthFeet: property.lengthFeet, depthInches }, config),
  })));
}
/** Only measurements and choices are handed off. Server recomputes all prices. */
export function buildSnowQuoteDetails(raw: SnowQuoteInput): Record<string, unknown> {
  const input = parseSnowQuoteInput(raw);
  const service = SNOW_SERVICES.find(s => s.id === input.serviceType)!;
  return {
    snowQuote: input, snowPricingVersion: SNOW_PRICING_VERSION, estimateOnly: true,
    snowDrivewaySize: `${input.widthFeet} × ${input.lengthFeet} ft`, snowFrequency: input.plan,
    saltRequested: input.serviceType === "works", scope: service.label,
    notes: `${service.label}; ${input.depthInches} in snow; ${input.plan} planning estimate. Property review and confirmed pricing required.`,
  };
}

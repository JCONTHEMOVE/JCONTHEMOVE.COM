import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { SNOW_INITIAL_SELECTION, SNOW_PRICING_VERSION } = await import(pathToFileURL(path.resolve("shared/snowPricing.ts")).href);

// Execute the real booking issuer with isolated persistence/provider fixtures.
// The main server suite uses esbuild; native Node 24 hooks also support this
// test in a dependency-free checkout. Neither path opens a database connection.
const state = {
  booking: null as any,
  items: [] as any[],
  lead: null as any,
  failItems: false,
  inserted: [] as any[],
  credits: [] as number[],
  leadChecks: 0,
};
const db = {
  select: () => ({ from: (table: any) => {
    const rows = () => {
      if (table.kind === "bookingServiceItems") {
        if (state.failItems) throw new Error("Injected item lookup failure");
        return state.items;
      }
      if (table.kind === "bookings") return state.booking ? [state.booking] : [];
      return [];
    };
    return {
      where() { return this; },
      limit: async () => rows(),
      then: (resolve: any, reject: any) => Promise.resolve().then(rows).then(resolve, reject),
    };
  } }),
  insert: () => ({ values: async (row: any) => { state.inserted.push(row); } }),
};
const pool = { query: async (sql: string, values: unknown[]) => {
  if (sql.includes("FROM leads WHERE booking_id")) {
    state.leadChecks++;
    return { rows: state.lead ? [state.lead] : [] };
  }
  if (sql.includes("FROM rewards WHERE")) {
    return { rows: state.inserted.filter(row => row.userId === values[0] && row.rewardType === values[1] && row.referenceId === values[2]) };
  }
  return { rows: [] };
} };
const globalKey = "__jcSnowBookingRewardTest";
(globalThis as any)[globalKey] = { db, pool, state };
const pre = `const {db,pool,state}=globalThis.${globalKey};`;
const fixtures: Record<string, string> = {
  "../db": pre + "export {db,pool};",
  "@shared/schema": 'const table=kind=>({kind,id:"id",bookingId:"bookingId",serviceCode:"serviceCode",details:"details",settingKey:"settingKey",code:"code"}); export const rewards=table("rewards"),rewardSettings=table("rewardSettings"),bookings=table("bookings"),bookingServiceItems=table("bookingServiceItems"),bundleDefinitions=table("bundleDefinitions");',
  "drizzle-orm": "export const eq=(...values)=>values;",
  "../storage": pre + "export const storage={creditWalletTokens:async(id,amount)=>{state.credits.push(amount)}};",
  "./phoneRewards": 'export const findPhoneRewardsCustomer=async()=>({id:"customer-fixture",email:"customer@example.test"});',
  "../../shared/rewards": "export const EARN_RATE_PER_DOLLAR=15;",
  "./bookingPricing": "export const computeBookingReward=()=>({flatAward:250,earnAward:1500,totalAward:1750});",
};
const directory = await mkdtemp(path.join(tmpdir(), "snow-booking-rewards-"));
let unregister: (() => void) | undefined;
let issuer: any;
const savedLog = console.log;
const savedWarn = console.warn;
const savedError = console.error;
try {
  const esbuild = await import("esbuild").catch(() => null);
  if (esbuild) {
    const outfile = path.join(directory, "issuer.mjs");
    await esbuild.build({
      entryPoints: ["server/services/disburseBookingTokens.ts"], bundle: true,
      platform: "node", format: "esm", outfile,
      plugins: [{ name: "snow-reward-fixtures", setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => fixtures[args.path] ? { path: args.path, namespace: "fixture" } : undefined);
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: fixtures[args.path], loader: "js" }));
      } }],
    });
    issuer = await import(pathToFileURL(outfile).href);
  } else {
    const moduleApi = await import("node:module") as any;
    assert.equal(typeof moduleApi.registerHooks, "function", "Install repository dependencies or run this fixture on Node 24.");
    const hook = moduleApi.registerHooks({
      resolve(specifier: string, context: any, next: any) {
        if (fixtures[specifier]) return { url: `jc-snow-fixture:${encodeURIComponent(specifier)}`, shortCircuit: true };
        if (specifier.startsWith(".") && !path.extname(specifier)) {
          return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
        }
        return next(specifier, context);
      },
      load(url: string, context: any, next: any) {
        if (url.startsWith("jc-snow-fixture:")) {
          return { format: "module", source: fixtures[decodeURIComponent(url.slice("jc-snow-fixture:".length))], shortCircuit: true };
        }
        return next(url, context);
      },
    });
    unregister = () => hook.deregister();
    issuer = await import(pathToFileURL(path.resolve("server/services/disburseBookingTokens.ts")).href);
  }
  console.log = console.warn = console.error = () => {};
  const reset = (items: any[], lead: any = { id: "lead-fixture", status: "quote_requested", paymentPaidAt: null }) => {
    state.booking = { id: "booking-fixture", status: "quote", finalTotal: "100.00", customerPhone: "2025550100", customerEmail: "customer@example.test", rewardFlatBonusSnapshot: 250, rewardEarnRateSnapshot: "15", rewardBonusMultiplierSnapshot: "1" };
    state.items = items; state.lead = lead; state.failItems = false;
    state.inserted = []; state.credits = []; state.leadChecks = 0;
  };
  const snow = (snowQuote: unknown = { ...SNOW_INITIAL_SELECTION }) => ({ serviceCode: "snow_removal", details: { snowQuote, snowPricingVersion: SNOW_PRICING_VERSION } });
  const assertDeferred = async () => {
    assert.equal(await issuer.disburseBookingTokens("booking-fixture"), null);
    assert.equal(state.inserted.length, 0, "Booking rewards must not compete with the paid-completion ledger");
    assert.equal(state.credits.length, 0, "Booking confirmation must not credit the snow customer's wallet");
  };

  // Neither quote acceptance, a scheduling deposit, nor a later retry after
  // full completion may issue a second, booking-keyed snow reward.
  for (const lead of [
    { id: "lead-fixture", status: "quote_requested", paymentPaidAt: null },
    { id: "lead-fixture", status: "confirmed", depositPaid: true, paymentPaidAt: null },
    { id: "lead-fixture", status: "completed", paymentPaidAt: "2099-01-01" },
  ]) {
    reset([snow()], lead);
    await assertDeferred(); await assertDeferred();
    assert.equal(state.leadChecks, 2);
  }
  reset([{ serviceCode: "moving", details: {} }, snow()]);
  await assertDeferred();
  reset([snow()], null); await assertDeferred();
  assert.equal(state.leadChecks, 1, "A missing lead bridge must be observed and deferred");
  for (const malformed of [null, {}, { ...SNOW_INITIAL_SELECTION, version: 2 }, { ...SNOW_INITIAL_SELECTION, widthFeet: -10 }]) {
    reset([snow(malformed)]); await assertDeferred();
  }
  reset([{ serviceCode: "snow_removal", details: { snowPricingVersion: SNOW_PRICING_VERSION } }]);
  await assertDeferred();
  reset([snow()]); state.failItems = true; await assertDeferred();

  // Historical snow and unrelated booking policies retain their existing
  // issuer and retry behavior; only a rubric snow item changes ownership.
  for (const item of [
    { serviceCode: "snow_removal", details: { snowDrivewaySize: "Double" } },
    { serviceCode: "moving", details: { snowQuote: { version: 1 } } },
  ]) {
    reset([item]);
    assert.equal((await issuer.disburseBookingTokens("booking-fixture")).totalAwarded, 1750);
    assert.equal(state.inserted.length, 2);
    assert.deepEqual(state.credits, [250, 1500]);
    await issuer.disburseBookingTokens("booking-fixture");
    assert.equal(state.inserted.length, 2);
    assert.deepEqual(state.credits, [250, 1500]);
  }
  savedLog("Snow booking reward ownership: PASS (real issuer, no external effects).");
} finally {
  console.log = savedLog; console.warn = savedWarn; console.error = savedError;
  unregister?.();
  delete (globalThis as any)[globalKey];
  await rm(directory, { recursive: true, force: true });
}

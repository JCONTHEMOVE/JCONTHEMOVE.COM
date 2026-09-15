import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Exercise the real event dispatcher with in-memory delivery adapters. No
// database, notification provider, or shared Discord channel is contacted.
const directory = await mkdtemp(path.join(process.cwd(), ".home-project-notifications-"));
const originalFetch = globalThis.fetch;
const originalWebhook = process.env.DISCORD_WEBHOOK_URL;
const otherWebhookKeys = ["JC_JOB_EVENT_WEBHOOK_URLS", "JOB_EVENT_WEBHOOK_URLS", "DISCORD_JOB_WEBHOOK_URL"];
const originalOthers = otherWebhookKeys.map(key => process.env[key]);
const outbound: any[] = [];
try {
  for (const key of otherWebhookKeys) delete process.env[key];
  process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/test/never-sent";
  globalThis.fetch = async (_url, options) => {
    outbound.push(JSON.parse(String(options?.body)));
    return new Response(null, { status: 204 });
  };
  const outfile = path.join(directory, "dispatcher.mjs");
  await build({
    stdin: {
      contents: 'export { emitJobEvent } from "./jobEventBus"; export { state } from "test-state";',
      resolveDir: path.resolve("server/services"),
    },
    bundle: true, platform: "node", format: "esm", packages: "external", outfile,
    plugins: [{ name: "isolated-notifications", setup(builder) {
      builder.onResolve({ filter: /^(test-state|\.\.\/db|\.\/notification|\.\/jobAlertDelivery)$/ }, args => ({ path: args.path, namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, args => ({ contents:
        args.path === "test-state" ? `export const state = { queries: 0, notifications: [], audits: [] };` :
        args.path === "../db" ? `import { state } from "test-state";
          const owner = { id: "owner", email: "owner@example.test", role: "business_owner", jobAlertChannelPreference: "discord" };
          const crew = { id: "crew", email: "crew@example.test", role: "employee", jobAlertChannelPreference: "in_app" };
          export const db = { select() { return { from() { return { where() {
            return Promise.resolve(++state.queries === 1 ? [owner] : [crew]);
          } }; } }; } };` :
        args.path === "./notification" ? `import { state } from "test-state";
          export const notificationService = { async sendNotification(input) {
            state.notifications.push(input); return { inApp: { status: "sent" }, push: { status: "skipped" } };
          } };` : `import { state } from "test-state";
          export async function hasJobAlertDelivery() { return false; }
          export async function hasSuccessfulJobWebhookDelivery() { return false; }
          export async function recordJobAlertDelivery(input) { state.audits.push(input); }
          export async function recordJobWebhookDelivery(input) { state.audits.push(input); }`,
      }));
    } }],
  });
  const { emitJobEvent, state } = await import(pathToFileURL(outfile).href);
  const lead = { id: "isolated-project", orderNumber: 101, firstName: "Test", lastName: "Project", serviceType: "flooring", status: "quote_requested" };
  await emitJobEvent("quote_requested", lead, { source: "home_project_campaign", ownerReviewOnly: true });
  assert.deepEqual(state.notifications.map((n: any) => n.userId), ["owner"], "campaign intake reaches the owner, including an owner who normally uses shared Discord");
  assert.equal(state.notifications[0].type, "quote_request");
  assert.equal(state.queries, 1, "campaign intake must not look up the crew audience");
  assert.equal(outbound.length, 0, "unreviewed campaign requests must not reach shared webhooks or @everyone");
  assert.ok(state.audits.some((entry: any) => entry.recipientUserId === "owner" && entry.channel === "in_app"));

  state.queries = 0; state.notifications.length = 0; state.audits.length = 0;
  await emitJobEvent("quote_requested", lead, { source: "public_quote_form" });
  assert.deepEqual(state.notifications.map((n: any) => n.userId), ["crew"], "ordinary quote notifications retain existing channel preferences");
  assert.equal(state.queries, 2);
  assert.equal(outbound.length, 1, "ordinary quote webhook delivery remains unchanged");
  assert.match(outbound[0].content, /^@everyone\n/);

  const routes = await readFile("server/routes.ts", "utf8");
  const campaignRoute = routes.slice(routes.indexOf('app.use("/api/home-projects"'), routes.indexOf("const quickRequestSchema"));
  assert.match(campaignRoute, /ownerReviewOnly:\s*true/, "the campaign HTTP route must opt into owner review");
  console.log("Home project notifications: owner delivery, no crew/webhook fan-out, and ordinary quote behavior passed.");
} finally {
  globalThis.fetch = originalFetch;
  if (originalWebhook === undefined) delete process.env.DISCORD_WEBHOOK_URL;
  else process.env.DISCORD_WEBHOOK_URL = originalWebhook;
  otherWebhookKeys.forEach((key, index) => {
    if (originalOthers[index] === undefined) delete process.env[key];
    else process.env[key] = originalOthers[index];
  });
  await rm(directory, { recursive: true, force: true });
}

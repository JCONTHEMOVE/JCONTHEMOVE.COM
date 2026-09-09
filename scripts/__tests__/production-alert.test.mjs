import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { notifyProductionFailure } from "../notify-production-failure.mjs";

const env = {
  READINESS_RESULT: "failure",
  PRODUCTION_ALERT_DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/fake-token",
  GITHUB_REPOSITORY: "JCONTHEMOVE/JCONTHEMOVE.COM",
  GITHUB_RUN_ID: "1234",
  GITHUB_RUN_ATTEMPT: "2",
};

test("failure sends one confirmed Discord message with an actionable run link", async () => {
  let calls = 0;
  const result = await notifyProductionFailure(env, async (url, options) => {
    calls++;
    assert.equal(new URL(url).searchParams.get("wait"), "true");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.allowed_mentions, { parse: [] });
    assert.match(body.content, /Production Availability FAILED/);
    assert.match(body.content, /https:\/\/github.com\/JCONTHEMOVE\/JCONTHEMOVE.COM\/actions\/runs\/1234\/attempts\/2/);
    assert.ok(!body.content.includes("fake-token"));
    return { ok: true, status: 200 };
  });
  assert.deepEqual(result, { sent: true });
  assert.equal(calls, 1);
});

test("successful, cancelled, skipped and absent results never send", async () => {
  for (const result of ["success", "cancelled", "skipped", undefined]) {
    assert.deepEqual(await notifyProductionFailure({ READINESS_RESULT: result }, () => assert.fail("unexpected delivery")), { sent: false });
  }
});

test("missing dedicated secret fails without falling back to crew destinations", async () => {
  await assert.rejects(notifyProductionFailure({ ...env, PRODUCTION_ALERT_DISCORD_WEBHOOK_URL: "", JC_JOB_EVENT_WEBHOOK_URLS: env.PRODUCTION_ALERT_DISCORD_WEBHOOK_URL, DISCORD_WEBHOOK_URL: env.PRODUCTION_ALERT_DISCORD_WEBHOOK_URL }, () => assert.fail("crew delivery")), /Set GitHub Actions secret/);
});

test("invalid or redirected destinations cannot expose credentials", async () => {
  for (const url of ["bad-secret", "http://discord.com/api/webhooks/123/token", "https://discord.com.evil.test/api/webhooks/123/token", "https://user:password@discord.com/api/webhooks/123/token", "https://discord.com/api/webhooks/123/token?thread_id=12", "https://example.com/hook", "https://discord.com/api/webhooks/123/token#secret"]) {
    await assert.rejects(notifyProductionFailure({ ...env, PRODUCTION_ALERT_DISCORD_WEBHOOK_URL: url }, () => assert.fail("unexpected delivery")), (error) => !error.message.includes(url));
  }
});

test("invalid run context fails before delivery", async () => {
  await assert.rejects(notifyProductionFailure({ ...env, GITHUB_RUN_ID: "" }, () => assert.fail("unexpected delivery")), /GitHub run context/);
});

for (const status of [302, 400, 401, 404, 429, 500]) {
  test(`HTTP ${status} fails visibly without response body or retries`, async () => {
    let calls = 0;
    await assert.rejects(notifyProductionFailure(env, async () => {
      calls++;
      return { ok: false, status, text: () => assert.fail("must not read error body") };
    }), new RegExp(`HTTP ${status}`));
    assert.equal(calls, 1);
  });
}

test("network and timeout errors are redacted", async () => {
  for (const name of ["TypeError", "TimeoutError"]) {
    await assert.rejects(notifyProductionFailure(env, async () => {
      const error = new Error(env.PRODUCTION_ALERT_DISCORD_WEBHOOK_URL);
      error.name = name;
      throw error;
    }), (error) => error.message.includes("network, timeout, or redirect") && !error.message.includes("fake-token"));
  }
});

test("CLI returns nonzero for missing configuration", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../notify-production-failure.mjs", import.meta.url))], { env: { ...process.env, READINESS_RESULT: "failure", PRODUCTION_ALERT_DISCORD_WEBHOOK_URL: "" }, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /::error::Set GitHub Actions secret/);
});

test("workflow keeps failure alert independent of readiness timeout and crew configuration", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/production-availability.yml", import.meta.url), "utf8");
  assert.match(workflow, /cron: "7,17,27,37,47,57 \* \* \* \*"/);
  assert.match(workflow, /notify-owner:\s+needs: readiness\s+if: \$\{\{ always\(\) && needs.readiness.result == 'failure' \}\}/);
  assert.match(workflow, /PRODUCTION_ALERT_DISCORD_WEBHOOK_URL: \$\{\{ secrets.PRODUCTION_ALERT_DISCORD_WEBHOOK_URL \}\}/);
  assert.match(workflow, /node --test scripts\/__tests__\/production-alert.test.mjs/);
  assert.doesNotMatch(workflow, /continue-on-error|JC_JOB_EVENT_WEBHOOK|DISCORD_WEBHOOK_URL: \$\{\{ secrets\.DISCORD_WEBHOOK_URL/);
});

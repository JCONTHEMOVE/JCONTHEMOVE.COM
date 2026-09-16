import test from "node:test";
import assert from "node:assert/strict";
import { buildReportPlan, reportAvailability } from "./report-availability.mjs";

const production = "https://uptime.betterstack.com/api/v1/heartbeat/production_test_token";
const drill = "https://uptime.betterstack.com/api/v1/heartbeat/drill_test_token";
const automatic = {
  GITHUB_REPOSITORY: "JCONTHEMOVE/JCONTHEMOVE.COM",
  GITHUB_EVENT_NAME: "schedule",
  GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_ID: "123456",
  READINESS_RESULT: "success",
  ALERT_DRILL: "false",
  OPS_HEARTBEAT_URL: production,
  OPS_DRILL_HEARTBEAT_URL: drill,
};
const rehearsal = { ...automatic, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/ops-test", ALERT_DRILL: "true", ALERT_DRILL_PHASE: "fail", READINESS_RESULT: "failure" };

test("automatic success refreshes production; all other job conclusions signal failure", () => {
  assert.equal(buildReportPlan(automatic).url, production);
  for (const result of ["failure", "cancelled", "skipped"]) {
    assert.equal(buildReportPlan({ ...automatic, READINESS_RESULT: result }).url, `${production}/fail`);
  }
  assert.throws(() => buildReportPlan({ ...automatic, READINESS_RESULT: "" }));
});

test("manual health checks cannot resolve production incidents or hide missed schedules", async () => {
  let calls = 0;
  await reportAvailability({ ...automatic, GITHUB_EVENT_NAME: "workflow_dispatch" }, { fetchImpl: async () => { calls++; } });
  assert.equal(calls, 0);
  assert.throws(() => buildReportPlan({ ...automatic, GITHUB_EVENT_NAME: "pull_request" }));
  assert.throws(() => buildReportPlan({ ...automatic, GITHUB_REF: "refs/heads/feature" }));
});

test("drill failure and resolution use only the isolated drill heartbeat", () => {
  const failure = buildReportPlan(rehearsal);
  assert.equal(failure.url, `${drill}/fail`);
  assert.equal(JSON.parse(failure.body).scope, "drill");
  assert.equal(buildReportPlan({ ...rehearsal, ALERT_DRILL_PHASE: "resolve", READINESS_RESULT: "success" }).url, drill);
  assert.equal(buildReportPlan({ ...rehearsal, ALERT_DRILL_PHASE: "resolve" }).url, `${drill}/fail`);
  assert.throws(() => buildReportPlan({ ...rehearsal, OPS_DRILL_HEARTBEAT_URL: production }));
  assert.throws(() => buildReportPlan({ ...rehearsal, OPS_HEARTBEAT_URL: "" }));
  assert.throws(() => buildReportPlan({ ...rehearsal, ALERT_DRILL_PHASE: "" }));
});

test("missing or unsafe destinations fail before any network call", async () => {
  const urls = ["", `${production}\n`, "http://uptime.betterstack.com/api/v1/heartbeat/test_token", `${production}?secret=other`, `${production}/fail`, "https://uptime.betterstack.com.attacker.invalid/api/v1/heartbeat/test_token", "https://localhost/api/v1/heartbeat/test_token"];
  for (const url of urls) {
    await assert.rejects(reportAvailability({ ...automatic, OPS_HEARTBEAT_URL: url }, { fetchImpl: async () => assert.fail("must not send") }));
  }
});

test("reporter sends sanitized metadata, refuses redirects and does not query production", async () => {
  const calls = [];
  const message = await reportAvailability(automatic, { fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response(null, { status: 200 }); } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, production);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.redirect, "error");
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.run_url, "https://github.com/JCONTHEMOVE/JCONTHEMOVE.COM/actions/runs/123456");
  assert.ok(!calls[0].options.body.includes("test_token"));
  assert.match(message, /Human receipt and escalation are not proven/);
});

test("transient failures retry; permanent failures are reported without response bodies", async () => {
  const statuses = [429, 503, 200];
  const waits = [];
  const message = await reportAvailability(automatic, { fetchImpl: async () => new Response(null, { status: statuses.shift() }), delay: async ms => waits.push(ms) });
  assert.equal(statuses.length, 0);
  assert.deepEqual(waits, [1000, 2000]);
  assert.match(message, /accepted/);
  let calls = 0;
  await assert.rejects(reportAvailability(automatic, { fetchImpl: async () => { calls++; return new Response("private response", { status: 403 }); } }), error => {
    assert.match(error.message, /HTTP 403/);
    assert.ok(!error.message.includes("private response"));
    return true;
  });
  assert.equal(calls, 1);
});

test("exhausted network retries never reveal the secret URL", async () => {
  let calls = 0;
  await assert.rejects(reportAvailability(automatic, { fetchImpl: async () => { calls++; throw new Error(`connect failed: ${production}`); }, delay: async () => {} }), error => {
    assert.match(error.message, /not accepted/);
    assert.ok(!error.message.includes("test_token"));
    return true;
  });
  assert.equal(calls, 3);
});

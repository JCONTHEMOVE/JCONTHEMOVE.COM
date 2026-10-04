#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// This reporter never queries production. The readiness job supplies its result.
// The external incident service owns recipients, deduplication and escalation.
const REPOSITORY = "JCONTHEMOVE/JCONTHEMOVE.COM";
const HEARTBEAT_PREFIX = "https://uptime.betterstack.com/api/v1/heartbeat/";
const RESULTS = new Set(["success", "failure", "cancelled", "skipped"]);

function heartbeatUrl(raw, name) {
  if (!raw) throw new Error(`${name} is missing; alert delivery is not configured.`);
  // Exact canonical HTTPS endpoint only. Never print a secret URL or redirect it.
  if (raw !== raw.trim() || !new RegExp(`^${HEARTBEAT_PREFIX.replaceAll(".", "\\.")}[A-Za-z0-9_-]{8,200}$`).test(raw)) {
    throw new Error(`${name} must be a canonical Better Stack heartbeat URL.`);
  }
  return raw;
}

export function buildReportPlan(env) {
  const drill = env.ALERT_DRILL === "true";
  if (env.GITHUB_EVENT_NAME === "workflow_dispatch" && !drill) {
    return { skipped: true, message: "Manual verification does not update production monitoring." };
  }
  if (env.GITHUB_REPOSITORY !== REPOSITORY) {
    throw new Error("Reporting is restricted to the production repository.");
  }
  if (!RESULTS.has(env.READINESS_RESULT)) throw new Error("A known readiness job result is required.");
  if (!/^\d+$/.test(env.GITHUB_RUN_ID || "")) throw new Error("A workflow run ID is required.");

  let scope;
  let signal;
  let baseUrl;
  if (drill) {
    if (env.GITHUB_EVENT_NAME !== "workflow_dispatch") {
      throw new Error("An alert drill must be a manual workflow dispatch.");
    }
    if (!["fail", "resolve"].includes(env.ALERT_DRILL_PHASE)) {
      throw new Error("The drill phase must be fail or resolve.");
    }
    // Both URLs must be configured so an accidentally shared target is rejected.
    const production = heartbeatUrl(env.OPS_HEARTBEAT_URL, "OPS_HEARTBEAT_URL");
    baseUrl = heartbeatUrl(env.OPS_DRILL_HEARTBEAT_URL, "OPS_DRILL_HEARTBEAT_URL");
    if (baseUrl === production) throw new Error("The drill heartbeat must be separate from production.");
    scope = "drill";
    signal = env.ALERT_DRILL_PHASE === "resolve" && env.READINESS_RESULT === "success" ? "success" : "failure";
  } else {
    if (!["schedule", "push"].includes(env.GITHUB_EVENT_NAME) || env.GITHUB_REF !== "refs/heads/main") {
      throw new Error("Production reporting requires an automatic run on main.");
    }
    scope = "production";
    signal = env.READINESS_RESULT === "success" ? "success" : "failure";
    baseUrl = heartbeatUrl(env.OPS_HEARTBEAT_URL, "OPS_HEARTBEAT_URL");
  }

  const runUrl = `https://github.com/${REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  return {
    skipped: false,
    scope,
    signal,
    url: `${baseUrl}${signal === "failure" ? "/fail" : ""}`,
    body: JSON.stringify({
      monitor: "Production Availability",
      scope,
      signal,
      readiness_result: env.READINESS_RESULT,
      run_url: runUrl,
      note: scope === "drill" ? "INTENTIONAL DRILL. No production request or production recovery is implied." : "Readiness verifier result; no customer data included.",
    }),
  };
}

export async function reportAvailability(env, { fetchImpl = fetch, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const plan = buildReportPlan(env);
  if (plan.skipped) return plan.message;
  let lastStatus = "network error or timeout";
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response;
    try {
      response = await fetchImpl(plan.url, {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: plan.body,
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      // Transport errors can contain the secret URL. Never log the raw error.
      lastStatus = "network error or timeout";
    }
    if (response) {
      await response.body?.cancel().catch(() => {});
      if (response.ok) {
        return `Incident service accepted the ${plan.scope} ${plan.signal} signal. Human receipt and escalation are not proven by this response.`;
      }
      lastStatus = `HTTP ${response.status}`;
      if (response.status !== 429 && response.status < 500) break;
    }
    if (attempt < 3) await delay(1000 * attempt);
  }
  throw new Error(`Incident signal was not accepted (${lastStatus}). Check monitoring delivery; heartbeat absence must alert independently.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let message;
  try {
    message = await reportAvailability(process.env);
    console.log(message);
  } catch (error) {
    message = error.message;
    console.error(`::error::${message}`);
    process.exitCode = 1;
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n### Incident delivery\n${message}\n`);
  }
}

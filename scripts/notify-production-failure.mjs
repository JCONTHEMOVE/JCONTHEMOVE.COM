import { pathToFileURL } from "node:url";

// Operations-only: never read job-event webhook aliases or import app services.
export async function notifyProductionFailure(env = process.env, fetchImpl = fetch) {
  if (env.READINESS_RESULT !== "failure") return { sent: false };

  const value = env.PRODUCTION_ALERT_DISCORD_WEBHOOK_URL?.trim();
  if (!value) throw new Error("Set GitHub Actions secret PRODUCTION_ALERT_DISCORD_WEBHOOK_URL to the owner-only Discord webhook.");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Production alert webhook must be a valid Discord HTTPS webhook URL.");
  }
  if (url.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(url.hostname)
      || url.port || url.username || url.password || url.hash
      || !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname)
      || [...url.searchParams.keys()].some((key) => key !== "wait")) {
    throw new Error("Production alert webhook must be a direct Discord HTTPS webhook URL without extra parameters.");
  }
  // Discord confirms persistence with wait=true. Do not follow redirects with a secret URL.
  url.searchParams.set("wait", "true");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY || "")
      || !/^\d+$/.test(env.GITHUB_RUN_ID || "")
      || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT || "")) {
    throw new Error("Production alert is missing valid GitHub run context.");
  }
  const runUrl = `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`;
  const body = {
    content: `Production Availability FAILED\nRepository: ${env.GITHUB_REPOSITORY}\nThe public readiness check failed or timed out. Investigate the workflow logs.\n${runUrl}`,
    allowed_mentions: { parse: [] },
  };
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Fetch errors can contain the credential-bearing URL. Never log raw errors.
    throw new Error("Production alert delivery failed (network, timeout, or redirect). Check the owner webhook and rerun the failed job.");
  }
  if (!response.ok) throw new Error(`Production alert delivery rejected (HTTP ${response.status}). Check the owner webhook and rerun the failed job.`);
  return { sent: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await notifyProductionFailure();
    console.log(result.sent ? "Owner availability alert delivered." : "No readiness failure; no alert sent.");
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}

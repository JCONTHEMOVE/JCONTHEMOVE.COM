# Railway Production Runbook

JC ON THE MOVE production runs on Railway. Do not use Render, Replit, or a local PM2 process as the production deployment path.

## Required Railway configuration

- GitHub source: `main` branch of this repository, with automatic deployments enabled.
- Runtime: Node 20.
- Build command: `npm ci && npm run build`.
- Start command: `npm run start`.
- Liveness probe: `/health`.
- Canonical public readiness probe: `https://www.jconthemove.com/api/health`.
- Public application URL: `https://www.jconthemove.com`.

Set the required database, session, Square, messaging, and wallet environment values in Railway. Never put secret values in this repository or in GitHub workflow logs.

## Release procedure

1. Start from a clean Node 20 environment and run `npm ci`, `npm run check`, `npm run test:server`, and `npm run build`.
2. Review the intended release diff. Keep data cleanup, calendar mutations, and external notifications in separate releases.
3. Commit and push `main`.
4. The `Production Build and Deploy Verification` workflow waits until the public readiness endpoint reports the pushed commit on Railway.
5. Run `npm run production:doctor` or open `/api/health` to confirm `status: ready`, database readiness, and the commit marker.
6. Run the owner-only Launch Checklist and focused browser smoke tests before driving new paid traffic.

## 24/7 operations

- `Production Availability` requests a 10-minute cadence against the public readiness endpoint. Verify actual run intervals; GitHub can delay or drop scheduled runs.
- Darrell is both owner and technical responder. His primary email is confirmed and he requested Discord alerts. Resolve the exact Discord channel, then configure email-first delivery and 15/30/60-minute unacknowledged reminders to Darrell, with provider-support checkpoints for unresolved incidents. In-app notices are available on the website without a native download, but outage delivery must be independent of the production app/database.
- Activate an independent uptime monitor and configure `OPS_HEARTBEAT_URL` plus the distinct `OPS_DRILL_HEARTBEAT_URL` in GitHub Actions secrets. The draft reporter sends automatic verifier outcomes to the external incident service; missing configuration fails visibly. No monitor, recipient route, or secret has been configured by the draft itself.
- Measure existing database retention and recovery points, then document an isolated restore drill before recommending recovery targets.
- Keep the evidence and open items in [`docs/operations/production-readiness.md`](./docs/operations/production-readiness.md). `alert_drill=true` with `alert_drill_phase=fail` or `resolve` exercises the isolated alert route without contacting production; a provider-accepted signal alone is not delivery proof.
- Treat a readiness failure, missing public commit marker, failed payment/payout probe, or unexpected funnel conversion drop as a release/operations incident.

## Local development note

The local PM2 process is only a preview helper. It must use Node 20 and a clean `npm ci` dependency tree. A stopped or broken local preview does not mean Railway production is unavailable.

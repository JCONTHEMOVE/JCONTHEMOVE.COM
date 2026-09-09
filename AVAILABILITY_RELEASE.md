# Availability alerting release

PR #10 now uses the incident-service reporter from PR #8 at b0e7606b, preserving the apex/www and referral-entrypoint checks added in PR #10. One reporting job sends the combined readiness result to the incident service. The separate direct-to-Discord failure reporter was removed.

The incident service owns email-first delivery, the Discord incident channel, acknowledgement, recovery and 15/30/60-minute unacknowledged escalation. Darrell is both owner and technical responder; the confirmed email destination is upmichiganstatemovers@gmail.com. No monitoring subscription, destination, secret, or live delivery was configured in this consolidation.

## Before activation

1. Confirm the monitoring account/plan and any recurring cost, then configure the independent external uptime probe and missed-heartbeat alert. GitHub schedule timing alone is not reliable coverage.
2. Configure the confirmed owner email and the exact owner-selected Discord alerts channel. Record the channel link and recipient configuration in private operations records.
3. Configure distinct GitHub secrets `OPS_HEARTBEAT_URL` and `OPS_DRILL_HEARTBEAT_URL`. The reporter only accepts canonical Better Stack heartbeat URLs; missing or unsafe values fail visibly. Do not use a job/crew webhook as an outage destination.
4. Review the final workflow and authorize its production activation. A main push can also trigger the existing application deployment workflow.
5. With specifically authorized delivery, run isolated fail/resolve drills and record actual email/Discord receipt, acknowledgement, reminder timing and recovery. Ordinary manual health checks do not refresh production monitoring, and drills skip all production HTTP checks.
6. Verify independent missed-check detection and real production recovery with timestamps. A successful HTTP response from the incident service is not proof of human receipt.

Automatic workflows do not run concurrently, but GitHub does not guarantee pending-run order. Validate incident state under delayed runs and retries before relying on the heartbeat as a sole recovery signal. The external uptime probe remains required.

## Local verification

Run `node --test scripts/__tests__/production-alert.test.mjs scripts/__tests__/public-entrypoints.test.mjs`. Tests use fake HTTP responses for reporting and entrypoint scenarios; they do not send a live alert.

The database recovery requirements from PR #8 remain separate. Replit has scheduled daily backups and seven-day PITR; first-backup success and an isolated restore still need evidence.

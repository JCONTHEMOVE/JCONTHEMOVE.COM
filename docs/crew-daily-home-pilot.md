# Crew daily-home pilot

`/crew/marketing` starts with Learn, Reach, and Follow through. Setup, launch checklist, and the existing ad builder remain below the missions. This change is the daily-home slice of the September 14–October 31 plan; it does not activate seasonal offers or rewards.

## Data and access

- Reuse the signed-in employee's single active Matt, Troy, Bill, or Evan profile. Its active, unexpired, unexhausted promo code must reference that same user. Eligibility is rechecked inside each save transaction. Missing, ambiguous, or unusable links show a setup message; this flow never changes links.
- Recommend a deterministic, service-relevant scenario from the existing training library. Check only that worker's current-fingerprint submission; link to the existing independent training editor. No answers, grades, or owner answers are returned.
- Reach uses the original representative variant of a campaign approved for the current Chicago calendar date, with passing safety checks, matching promo/slug, and the existing tracked campaign destination. Worker-edited captions and company variants are not used. Missing approval is an explicit empty state; older dated offers are not recycled.
- Save outreach proof in `marketing_action_assignments` under `crew-fall-2026:<day>:reach`. The row stores the approved caption, variant/revision, destination note, proof URL/note, and submission timestamp. Copying is not completion.
- In the same transaction, create its future follow-up in that table. Show the oldest due assigned follow-up belonging to the worker. Saving an outcome can create one subsequent follow-up. Retries do not overwrite evidence or create duplicate actions.
- Worker submissions have `submitted` status. The existing owner-only action review endpoint can mark submitted daily rows completed while retaining proof. The legacy worker completion endpoint cannot complete daily rows. These actions issue no XP, money, wallet credit, notifications, or outreach.

The additive, retryable migration adds `due_on`, `campaign_variant_id`, `campaign_revision`, `submitted_at`, and a due-action index to the existing assignments table. Existing campaign and training tables remain authoritative. No campaign rows are seeded.

## Verification

Run `node node_modules/tsx/dist/cli.mjs server/routes/__tests__/crewDailyHome.test.ts` on Node 20. The test uses isolated PGlite SQL and HTTP requests, covering ownership, role rejection, independent training state, approval withdrawal/revision, unsafe or mismatched tracking, Chicago midnight, campaign dates, overdue selection, duplicate requests, and transaction rollback.

The actual React component was checked in a temporary, isolated browser fixture at 360 CSS pixels: no horizontal overflow or console errors; copying left progress unchanged; outreach proof and follow-up outcome each incremented progress and collapsed to “Submitted for review.” The fixture had no external side effects and is not shipped.

## Remaining pilot acceptance

Before real outreach, the owner should confirm each pilot worker's existing profile/promo mapping and approve a current-date representative campaign. Northwoods single-Page publication remains governed by the existing Matt pilot; this UI does not expand automated publishing to the other workers.

In the deployed app, verify one real crew account can open its recommended scenario, copy the correct approved tracked destination, submit legitimate outreach proof, see its due follow-up, and have the owner review that proof. Confirm another worker cannot access it. No real outreach or test customer records are needed merely to review this PR.

Company Gmail remains the alert preference. This implementation adds no automated alerts and makes no email-delivery claim.

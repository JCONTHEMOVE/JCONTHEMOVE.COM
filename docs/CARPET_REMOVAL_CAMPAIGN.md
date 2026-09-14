# Carpet removal and holiday home projects

This change connects the branded slideshow to the existing website and quote queue. The campaign is a release candidate until this branch passes review and the production deployment reports its commit. Do not use the new advertising links in paid or public posts before that verification.

## Customer path

The homepage has a **Carpet Removal & Light Demolition** tab and project feature. Both open `/carpet-removal`, where the 30-second JC ON THE MOVE LLC slideshow leads directly to the project form.

The form collects carpet removal, nonstructural light demolition or flooring scope; contact details; address/city and ZIP; approximate area; preferred deadline; haul-away and furniture help; access notes; and up to five photos. It creates an actual `quote_requested` lead in the current owner queue. It does not set a price, collect payment or reserve a completion date. Existing owner quote, scheduling and payment review remain required.

Requests are available in the ordinary leads screen. A campaign section in **Admin → Marketing Network** shows requests, needs review, quotes sent, booked, completed, credit by representative, and links to the 12 most recent requests. An API failure displays an error instead of fabricated zero totals.

## Individual links

The owner panel creates complete tagged links for every active representative. Existing `/network/:slug` pages also link to the project page with that person's slug. These destinations can be used by buttons on other websites, in posts, or in text messages; all forms submit on the canonical main website.

| Representative | Campaign destination after release |
| --- | --- |
| Darrell | `https://www.jconthemove.com/carpet-removal?rep=darrell` |
| Evan | `https://www.jconthemove.com/carpet-removal?rep=evan` |
| Matt | `https://www.jconthemove.com/carpet-removal?rep=matt` |
| Troy | `https://www.jconthemove.com/carpet-removal?rep=troy` |
| Bill | `https://www.jconthemove.com/carpet-removal?rep=bill` |

Use the owner panel's **Copy link** button for the full Facebook/UTM-tagged version. `homeProjectLink(slug, "partner_website")` creates a version identifying website traffic. Always keep the representative parameter when placing or shortening a link. Buttons on external sites have to be updated in those sites; this change integrates the main site and its existing representative pages.

## Attribution and reliability

- On a given browser, the first representative to refer a customer to this campaign is retained for 90 days. It survives visiting the homepage and then returning. An earlier direct visit does not block the first representative link.
- The server verifies the representative is active and resolves the account and promo code from existing records. The client cannot submit a replacement promo code or payout account. Unverifiable links pause the request instead of silently assigning another person.
- The lead and original attribution are saved in one database transaction. Attribution failure rolls back the lead too. The original record is separate from the editable quote snapshot.
- A random request ID plus payload fingerprint makes retries idempotent. The same ID cannot be replayed with another representative. Customer success appears only after the server confirms an order number.
- The report counts each lead once and reads its original attribution, even if the quote snapshot changes or additional quote attribution rows are added. The normal lead list also prefers that original campaign record.
- Owner notifications are called after commit. Campaign intake stays with owners: it does not notify crew or shared job webhooks. Owners receive an in-app record even if they normally use shared Discord for other job alerts. Existing owner email notification is also attempted. If a notification fails, the saved lead is still in the queue and retries do not create extra requests.
- Direct customers stay unassigned. Browser clearing, private browsing or switching devices can remove pre-submission attribution. The recorded source on a saved request remains in the database. This is referral accounting, not automatic commission payment or a change to payout rules.

## Goal and daily operation

The working goal is **100 booked projects from September 14 through December 14, 2026**, about eight per week. Thanksgiving customers supply their requested completion date. The target is not a promise of volume or availability.

Review new project requests daily; contact customers, scope/price the work, confirm route and crew capacity, and use existing job statuses as work is booked and completed. Compare requests and bookings by representative in the campaign panel. Review any referral-account discrepancy before payout.

## Release checks

- `npm run check`
- `npm run test:server` (includes isolated PostgreSQL/HTTP campaign coverage)
- `npm run build`
- Review the homepage tab, mobile/desktop campaign page, slideshow, photo picker, success and retry states in an allowed browser before release. The Work cloud browser blocked localhost, so that visual review remains outstanding.
- Merge through the normal production process; verify `/api/health` identifies the released commit and the campaign media endpoints load before distributing advertising links.

The campaign tests cover durable photos and scope, rep-account resolution, invalid/inactive links, cross-site URL tags, original-source retention, failed-attribution rollback, repeated/concurrent requests, unchanged pricing/calendar state, private report protection, and counts after quote revisions. They use an isolated database and send no customer messages.

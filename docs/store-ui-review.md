# Store navigation and catalog recovery review

Base: JCONTHEMOVE/JCONTHEMOVE.COM main `66072226c79f912cbdf115051a1ed4eb1c183c88` (PR #24 merge).
Scope: confirm PR #23/#24 findings, prepare minimal UI fixes and focused tests, inspect store usability.

## Confirmed defects and proposed changes

| Issue | Evidence on base | Fix |
| --- | --- | --- |
| Staff Wallet tab reaches a missing route | ShopSwitcher always links to /wallet. App.tsx registers /wallet only inside CustomerApp. The staff branch falls through to NotFound; /crew/earnings is already guarded for employee, admin and business_owner. | Customer Wallet remains /wallet; those three staff roles get Earnings at /crew/earnings. Omit the account-specific tab while auth is loading, for guests, and for unknown roles. No route/permission changes. |
| A background failure hides cached catalog results | nature-made-jewls.tsx aliases isError to catalogError and displays a full catalog error before checking retained items. TanStack Query retains data after a refetch error. | Reserve the blocking error for isLoadingError. On isRefetchError keep last loaded results visible with a nonblocking status and Retry button, disabled while fetching. Retain the successful-empty state even after a failed refresh. |

The query keys, fetch function, product filtering, item data, prices, checkout/cart handlers, reward rules, inventory writes, schema and server code are unchanged.

## Focused verification

`npm run test:store` bundles and renders the actual React components against real TanStack Query caches, using existing dependencies and synthetic fixtures. No production API/database is used.

Fourteen checks cover all three staff roles, customer, guest/unknown/loading auth, selected navigation, initial loading, initial failure plus Retry, successful empty results, cached populated and empty results after refetch failure, successful recovery, and separation from other cached query keys. Prices and sold status remain intact in cached data.

Before the fix: 8 regression checks failed and 6 passed. After the fix: 14 passed. The original customer active-link assertion was corrected for HTML attribute order before recording that baseline.

Full Node 20 TypeScript validation passed. The standard server-test runner was blocked by this environment's tsx IPC socket restriction. Running the same 51 files with `node --import tsx` passed 50; marketingCreativeGenerator.test.ts could not load `attached_assets/google_movers/crew-ramp.jpg` in the sparse checkout (ENOENT). This is a missing test asset, not an assertion failure. Full build and normal CI remain required on the PR commit.

The temporary workspace was removed during validation. The prepared changes were reconstructed from the inspected base and recorded patch. PR CI must verify the final committed files.

## Additional store usability findings

These are source-confirmed findings, not claimed live-device reproductions. They are documented separately to keep this patch narrow.

| Priority | Finding | Evidence | Suggested follow-up |
| --- | --- | --- | --- |
| High | Product cards are not keyboard-operable controls | renderCard passes onClick to Card; ui/card.tsx renders a div. Cards have no link/button semantics, tabIndex or keyboard handler. | Give each item a real product link or accessible button, without nesting the Wishlist button inside it. Verify Tab, Enter, Space and focus visibility. |
| Medium | Product overlay and wishlist drawer lack dialog/focus management | Both use fixed div overlays. Product detail supports Escape but neither provides dialog semantics, a focus trap or focus restoration. | Reuse the existing accessible Dialog component; add titles and named close/photo controls. |
| Medium | Several controls lack accessible names/state | Header Back/mail/phone buttons and overlay close/photo controls are icon-only; search is placeholder-only; collection buttons do not expose aria-pressed. | Add explicit names and selected state; verify with keyboard and screen reader. |
| Medium | Footer social icons lead to generic sites | The Facebook, Instagram and Pinterest anchors target each platform's root URL. | Replace with Ashley's verified profiles or omit unavailable channels. Do not invent profile URLs. |
| Low | Search can issue a new request for each keystroke | searchQuery changes on every onChange and participates immediately in the jewelry query key. | Consider a short debounce or explicit search action; preserve category/search cache separation and recovery states. |

## Visual verification limitation

The Cloud Browser URL policy rejected the local fixture page. No bypass was attempted. The subsequent workspace/browser interruption prevented a completed visual review. Header fit, sticky-filter overlap, dialog usability at 390 px and 1280 px, and the live Retry click remain unverified.

## Review boundary

This is a draft fix, not a production release. The existing pull-request workflow now runs the focused store tests along with its normal checks. Review those results and complete the remaining visual checks before merge. No production merge, deployment, checkout, payment, reward issuance, or inventory mutation was performed.

# Store navigation, recovery, and usability review

PR #26 now includes the requested usability follow-up. The branch incorporates main `7fe1058efd4c9d49f1661ecd756a0ec26ea8187b` (PR #31). Both original September 13 findings remain present on that main commit.

## Fixes

| Issue | Result |
| --- | --- |
| Staff switcher links to customer-only Wallet | Customers keep `/wallet`; employee, admin, and business_owner users get the existing `/crew/earnings` route. Guests/loading/unknown roles do not see an inaccessible account tab. |
| A failed background refresh hides usable inventory | Initial load errors keep the blocking Retry state. Background errors preserve populated or empty cached results with a nonblocking status and Retry action. |
| Product cards cannot be operated with a keyboard | Each card has a named native button, separate from its wishlist button. Enter and Space open desktop details or preserve the existing dedicated product route on mobile. Focus has a visible outline. |
| Overlay focus and dismissal | Product details, wishlist, and the listing assistant use the existing Radix dialog primitives for titles, focus containment, scroll locking, and Escape/backdrop dismissal. Focus returns to the opener. Custom-order/edit transitions also return to the appropriate store control. |
| Missing control names and selected state | Header links, search, photo navigation, wishlist actions, upload/listing controls, and store form fields have names. Collection, photo, featured, and wishlist buttons expose selected state. Nested link/button elements are removed. |
| Signup leads to nonexistent `/register` | The CTA now uses `/login?mode=register&redirect=/handmade-jewels-by-ashley`, opening the existing registration form with the existing return path. Auth handlers are unchanged. |

## Scope preserved

Query keys, fetch/filter behavior, prices, promotions, cart/checkout handlers, reward rules, order submission, inventory writes, schema, and server behavior are unchanged by this PR. A source comparison confirmed that all 11 existing pricing/cart/reward display/order/inventory function and mutation definitions are byte-for-byte identical to current main. No live purchase, signup, custom-order request, inventory edit, or reward operation was used for acceptance.

## Focused checks

`npm run test:store` runs two suites against real React components:

- The original 14 SSR/TanStack Query tests cover role navigation and initial/cached/empty/error/recovery catalog states, preserving prices and sold state.
- Nine DOM interaction tests cover Enter/Space, Tab and Shift+Tab containment, Escape/close focus return, nested wishlist/product dialogs, photo controls, mobile product routing, accessible control names, custom-order/edit transitions, and navigation to the real registration form.

DOM tests use synthetic inventory and isolated browser storage. All fetches are stubbed; the existing cart mount/sync is allowed only for an empty fixture cart. Tests assert inventory remains unchanged and reject account, booking, payment, reward, and inventory API calls. jsdom and Testing Library are development-only dependencies.

All 23 focused tests and the Node 20 type check pass locally. The local server-test launcher encounters a `tsx` IPC socket restriction; GitHub CI runs the normal Node 20 type check, complete server suite, all store tests, and production build on the pushed commit.

## Visual review and remaining observations

On September 15, Control Browser successfully opened the public store and confirmed the unnamed header controls and non-keyboard product cards on production. The desktop layout and product overlay were visually inspected. The wishlist heart overlapped the close control, and the photo arrows lacked contrast on their light buttons. This patch gives the close control clear space, keeps the wishlist heart in the toolbar, and sets an explicit dark color for photo arrows. Several inventory photos displayed the existing “Photo unavailable” fallback; no photos or inventory records were replaced.

The earlier PR preview is marked Ready by Vercel, but direct navigation to its store path returned Vercel `404 NOT_FOUND`. The browser reported `ERR_BLOCKED_BY_CLIENT` for the preview root, including the authorized temporary Vercel access URL. A Ready build alone does not establish that this preview can serve the store. Updated-preview visual acceptance remains a separate required check; these DOM tests do not claim to verify CSS layout or a physical mobile device.

Unchanged lower-priority survey items: the footer social links still lead to platform homepages rather than verified Ashley profiles, and search still requests each changed query immediately. Do not invent profile URLs or change catalog fetching as part of these accessibility fixes.

## Release boundary

This remains a reviewable PR. Production merge/deployment is not part of this acceptance pass. Use the exact updated commit's CI and hosted-preview evidence when making a release decision.

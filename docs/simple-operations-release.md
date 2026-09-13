# Compact operations: first release

This release introduces shared task headers, mounted expandable sections, step navigation, touch-sized controls, action bars, and unsaved-change prompts. It does not complete the entire website audit.

## Included flows
- Job setup: Customer → Service/location → Schedule/crew → Review, one save action.
- Date requests: validated steps, retained inputs, final review, existing request payload and price terms.
- Reviews: rating/comment and optional appreciation, then optional tip with existing total and allocation controls.
- Marketing: ad creation and performance expand on demand; earnings no longer repeats marketing workflows.
- Training: independent scenario response remains first; standings and prize controls expand on demand.
- Rewards: daily spin, training standings, avatar customization, shared shop navigation.
- Ashley’s shop: existing daily featured catalog item on home/rewards, approximately 30% desktop feature-column width, stacked on smaller screens; full shop links in shared navigation. No pricing or revenue-share change.
- Planner, finance, and public home: shorter introductions; shared informational guides expand on demand.

## Remaining inventory work
The route inventory records 177 registrations, including aliases and role variants. Its review flags deliberately remain pending until each complete runtime flow is reviewed. Source-derived labels and action candidates are not a claim that every route is simplified or verified. Remaining public/account/admin pages and browser-history navigation guards require further page-specific work.

## Validation
- Local typecheck and production build passed during implementation.
- Synthetic browser checks exercised required-field focus and Back/Next input retention.
- Phone (360px), tablet (768px), and desktop fixtures use the actual shared and booking components.
- CI runs typecheck, server integration tests, and production build for client, shared, and server changes.
- No production customers, referrals, tips, reviews, or reward payouts are created for these UI checks.

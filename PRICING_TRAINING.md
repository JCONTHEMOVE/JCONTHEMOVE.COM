# Phone pricing training

## Team contributions

Open `/crew/pricing-training` (Crew → Options → Pricing Training). Approved crew can submit their own answers; all staff see response distributions and explanations. The business owner's existing answer records remain the final answer set, so previous progress is preserved. Each current, finalized scenario counts once toward the shared 500 goal, regardless of how many coworkers respond. Admins/owners can start a final answer from a contribution and override it; revisions are conflict-checked and audited. Completing training does not automatically change live pricing rules.

Owner review awards 100 JCMOVES for contribution, 150 for mostly correct, or 200 for correct (total amounts). Spam/invalid input can be rejected without reward. Review notes are required. An owner cannot reward their own input. Each coworker/request has one submission record, and review locks it against edits and duplicate payments. Treasury debit, wallet token credit, reward ledger and review update commit together or roll back together. Existing treasury funding and risk checks apply. These are website JCMOVES credits; cash balances are not credited and this flow does not execute blockchain withdrawals.

On first submission, a persistent thank-you record is queued for the first Discord webhook already configured for website job events. Drafts and edits do not generate additional notices. Notices use a sanitized display name, without automatic mentions or customer data. Pending/unconfigured notices retry after startup; known failed notices have an owner retry button. Ambiguous deliveries are not automatically resent, preventing duplicate thanks after a timeout. Owners can see delivery status in each contribution card.

The PostgreSQL integration test in `server/routes/__tests__/pricingTrainingTeam.test.ts` uses an isolated in-memory database and simulated treasury/Discord dependencies. It never pays real rewards or posts test messages to Discord.

Administrators and business owners can open `/admin/pricing-training`, also linked from Admin → Pricing. The test contains 500 synthetic customer requests in 25 batches of 20. Each request asks for a decision, difficulty, minimum and recommended crew, minimum scheduled and billed hours, expected duration, price, reasons, and optional explanatory notes. Numeric choices allow a custom answer. Missing information, specialist review, and decline are valid answers.

Drafts are retained on the current browser. Save draft or Save answer syncs to the signed-in account; reloading resumes the first unanswered request. Batch navigation saves changed drafts before moving. Answers are scoped to the account, stored transactionally with revision history, and protected from conflicting saves on another device. The export contains saved source scenarios, answers, and an offline replay of owner-supplied minimums.

This is an answer-collection tool, not an automatically trained pricing engine. No synthetic answer key is supplied. Neither completing the test nor exporting it activates pricing or staffing rules. Review the completed examples, resolve contradictions and special conditions, and validate proposed rules separately before release. A replay cannot reduce existing minimums or trade extra time for insufficient crew; different crew sizes require a separately reviewed time estimate.

The API lazily creates `pricing_training_answers` and `pricing_training_answer_history` in the application database on first authorized use. A changed scenario fingerprint clears its active answer for fresh review while keeping old revisions in history. This route creates no leads, dispatches, invoices, notifications, or payments.

Generate deterministic scenarios with `node scripts/generate-pricing-training.mjs`. Verify with `npm run check`, `npm run test:server`, and `npm run build`. The focused API test uses an isolated transaction double; it does not connect to the production database. Phone browser verification uses a disposable local preview with synthetic answers.

## Verification on September 10, 2026

- Release is based on production main `5b66e250`; only training-related files and three small integration edits are included.
- Type check and full client/server build passed.
- The new test verified all 500 unique scenarios, fingerprints and batches; answer validation; minimum-floor replay; account isolation; conflicting revisions; transaction rollback; scenario-version changes; and export.
- The full server suite ran 44 test files. Forty-three passed initially. `jobAlertRouteWiring.test.ts` returned a nonzero child-process exit without diagnostics, then passed its focused rerun without code changes. Run normal CI again after publication.
- At a 390-pixel phone viewport, the browser test verified tap choices, custom $625 entry, notes, save/next, reload/resume, reopening a saved answer, and jumping to batch 25. No horizontal overflow or browser console errors were observed. The preview used disposable synthetic answers; production persistence still needs deployment verification.
- The user explicitly approved publishing the code and synthetic scenarios to the public repository and deploying the test on September 11, 2026. Production verification follows deployment.

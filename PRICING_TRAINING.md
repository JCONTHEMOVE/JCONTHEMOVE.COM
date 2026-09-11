# Phone pricing training

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

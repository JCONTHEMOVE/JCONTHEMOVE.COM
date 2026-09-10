# Admin payment and JCMOVES shortcut

The job-detail header now has a green **$** button for authenticated administrators and business owners. Click or tap it five times within ten seconds to open **Payment received & JCMOVES**. Opening it only reads the job, crew, reward status, and payment reconciliation report.

The two actions are:

- **Payment received & complete job:** enter the method and date of a full cash/check payment already received, plus an optional receipt/check reference and note. This uses the existing eligible past-job closeout endpoint.
- **Pay out eligible JCMOVES:** request missing eligible awards on a completed, fully paid job through the existing disbursement retry endpoint.

Both actions show the saved job, address, date, total, customer, assigned crew, and current pool estimates. **Review for final confirmation** does not write anything. The administrator must acknowledge the facts and then choose **Confirm payment & JCMOVES** or **Confirm JCMOVES payout**. The client refreshes the evidence immediately before submitting; a changed job, payment, or recipient requires a new review. Pending controls and a synchronous submission guard prevent repeated local requests.

The shortcut preserves server authorization, idempotency, eligibility, and release flags. It does not change quotes, prices, crew assignments, job dates, payment adapters, reward rates, or production flags. The cash/check path remains blocked for quote-only, current/future, already-paid, and unassigned jobs. It is also blocked when the canonical ledger is enabled because the legacy receipt endpoint is not a canonical payment adapter. Canonical JCMOVES processing remains blocked while its release flag is off or reconciliation requires review. An issued reward or pending customer claim is not treated as permission to issue another award.

Cash/check closeout can run the existing completion notifications and customer review request; the final confirmation explicitly says so. It does not create another quote, invoice, or dispatch. This change adds no automatic messaging.

This branch is based on PR #10's `agent/open-task-completion-20260908` at `4297aa62a42a6c9313f70843f0d32e3bb087a3ae`. It requires that branch's payment reconciliation endpoint. Keep the change staged with that release; no production acceptance, rollout, payment, or JCMOVES issuance is implied by local checks. Cross-request financial coordination and live provider acceptance remain part of PR #10's release gates.

## Verification

Use Node 20 and npm 10 with the existing lockfile:

```sh
npm ci
npm run check
npm run test:server
npm run build
```

The isolated interaction test bundles the actual component and mounts it with React, Radix, and React Query in jsdom. It intercepts every request with synthetic fixtures and starts no application server. Its disposable test dependency does not change the application manifest or lockfile:

```sh
npm install --prefix /tmp/jc-payment-ui-tests --no-save --no-audit --no-fund jsdom@26.1.0
JC_UI_TEST_RUNTIME=/tmp/jc-payment-ui-tests node scripts/check-admin-payment-shortcut.mjs
```

Coverage includes four versus five clicks, no mutation before final confirmation, cancellation, receipt capture, changed totals and recipients, repeated final clicks, pending controls, server rejection, quote-only jobs, canonical release flags, and non-admin visibility. These checks do not establish production wallet settlement or owner-device visual acceptance.

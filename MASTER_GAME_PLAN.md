# JC ON THE MOVE Master Game Plan

_Authoritative strategy snapshot: September 3, 2026 (America/Chicago)._

## Operating idea

**GSG — Genuinely Smart Geniuses**

**Connections. Transactions. Rewards. Recurring Profits.**

JC should own the connection layer between a real customer need and the people, partners, payments, and software that fulfill it:

1. A customer asks for help.
2. The JC Smart Connection Engine produces a reviewed quote and schedule.
3. JC crew or an approved partner fulfills the work.
4. A confirmed payment closes the job.
5. JC records its service or referral margin and issues the correct JCMOVES reward.
6. Follow-up, rebooking, and partner attribution create the next transaction.

The system is intentionally split into three responsibilities:

- **JC ON THE MOVE** delivers and coordinates real-world services.
- **JCMOVES** provides loyalty, participation rewards, and auditable customer/crew incentives.
- **GSG** builds the agents, paid tools, payment adapters, and partner marketplace used by JC and, later, other service businesses.

## Confirmed signals and bounded conclusions

- Charles Schwab announced on August 27, 2026 that clients will be able to buy and sell SOL, AVAX, and LINK through Schwab Crypto in the coming months. The announcement confirms planned direct SOL trading; it does **not** confirm Schwab tokenized stocks or a JC opportunity in private credit. Source: [Charles Schwab press release](https://pressroom.aboutschwab.com/press-releases/press-release/2026/Charles-Schwab-Announces-Plans-to-Expand-Digital-Assets-Available-in-Schwab-Crypto-Accounts/default.aspx).
- x402 is an open HTTP payment protocol developed by Coinbase for automatic stablecoin payments by people, software, and AI agents. The current protocol supports Solana through its SVM packages and facilitator model. Sources: [Coinbase x402 documentation](https://docs.cdp.coinbase.com/x402/welcome) and [Solana agentic-payments documentation](https://solana.com/docs/payments/agentic-payments).
- Solana documents PayAI as one available x402 facilitator. That proves technical feasibility, not profitability or production readiness for JC.
- Tokenized private credit, yield products, speculative protocols, leveraged positions, collectibles, and new tokens remain a research watchlist. They are not dependencies for the operating plan and are not approved treasury activities.

## Priority and profit model

| Priority | Connection JC owns | Product | Revenue or business outcome | Release rule |
| --- | --- | --- | --- | --- |
| Build now | Customer request → reviewed quote → confirmed payment | Square-first booking and closeout | Service margin, higher conversion, repeat work | One owner-controlled end-to-end job must reconcile payment and JCMOVES exactly once |
| Build now | Lead → scheduling → crew/partner fulfillment | Moving-service agent | 24/7 lead conversion and lower administrative time | Human approval remains required for dispatch, price exceptions, and payouts |
| Next scalable play | External service agent → JC calculation | Quote, mileage, scheduling, and follow-up APIs | Monthly subscription first; optional per-call USDC later | Internal API contract and metering must prove value before x402 is enabled |
| High potential | Customer → vetted service partner | Movers, handymen, cleaners, rentals, supplies, and disposal marketplace | Referral fee or percentage of completed work | No fee is recognized until fulfillment and payment are verified |
| Controlled option | Customer/agent → alternative payment rail | USDC on Solana | Payment choice and lower-friction machine payments | Devnet first; production is optional and additive to Square, never required for customers |
| Watchlist only | Treasury → external digital asset | Cash, USDC, limited SOL | Possible yield or appreciation | Separate written policy, accounting/legal review, exposure caps, and owner approval required |

Booked-job economics outrank raw transaction volume. A verified $25 referral or completed service margin is more valuable than thousands of uneconomic micropayments. Every paid API must report requests, successful settlements, refunds, infrastructure cost, gross margin, and the downstream booked-job value it creates.

## Controlled delivery stages

### Stage 1 — Close the real-business loop

- Keep Square as the only public card/invoice processor.
- Use `/book` as the canonical phone-first customer and authorized-worker request engine: choose the work, resolve the address, select a shared Central-time hourly window, review the server quote, submit, and receive a request receipt. The receipt is not a final price, crew assignment, dispatch, or guaranteed appointment.
- Add `/quick-book` as the authenticated staff accelerator: speak or type the call, correct only uncertain fields, explicitly tap Yes/No for SMS consent, confirm the suggested named crew and lead, review the same canonical server quote, then use one final Book & Alert Crew action. Incomplete or review-only intake remains a resumable draft with no alerts, customer messages, invoices, or payment requests.
- Keep one Confirmed Job Date in Job Setup (`confirmedDate`, with historical `moveDate` fallback), preserve saved legacy arrival windows, and require new selections to use the shared 7:00–8:00 AM through 4:00–5:00 PM list or Flexible/TBD.
- Keep location and pricing authority on the server. Verified Ironwood/Bessemer work is local; unmatched/outside-zone work is global. `LOCAL3X2` is a code-required September 2026 labor-only $450 base package for exactly three movers/two hours with customer/no JC equipment, while extras and the pre-promo JCMOVES basis remain intact.
- Keep driver premiums in Finance and keep crew/schedule alerts automatic only when a complete assigned plan changes. Contact-only and quote-only edits remain audit-only.
- Use one canonical server-side payment confirmation event to close a job and issue JCMOVES.
- Make payment, reward, webhook, payout, and notification writes idempotent and auditable.
- Keep automatic public gift-card rewards, payout approval, treasury movement, and price exceptions owner-gated until their live tests pass.
- Measure the funnel daily: lead, quote, scheduled job, payment link, paid/dispatch, completed job, payout approved, reward issued, rebooked job.

**Current Stage 1 decision:** scheduling/local pricing is deployed (`8c9a06c4`) and the final unified phone-booking application release is deployed (`d9974bf5`). On September 3, 2026, JC-87 was owner-authorized and saved for September 4, 10:00–11:00 AM with three movers, two hours, loading only, customer truck, `LOCAL3X2`, and a $450 customer total while preserving the $525 JCMOVES basis. Darrell Jackson, Evan, and Troy Tom each received exactly one in-app alert; the three push attempts were skipped because VAPID keys are not configured. No customer quote was sent and no Square invoice was created. Controlled in-app crew updates may begin, but push-dependent mass delivery remains paused pending VAPID configuration and a live push test. Customer broadcasts still require separate owner authorization. Square/JCMOVES closeout plus backup/alerting drills remain separate launch-readiness gates.

The 60-Second Quick Book code is locally complete and verified, but not yet deployed. It is feature-flagged off by default, uses AI only for structured suggestions and questions, retains deterministic fallback intake, and keeps pricing, availability, saving, consent, and notification authority outside the model. Rollout remains owner-only fixtures → internal non-customer job → owner/admin live booking → approved-staff drafts. Do not widen booking permission until the median routine completion time is at most 60 seconds and quote/notification checks pass.

**Exit gate:** an owner-controlled job travels from quote through completed payment, payout review, and one correct JCMOVES issuance with no duplicate side effects.

### Stage 2 — Add an optional USDC/Solana adapter

- Start on Solana Devnet with a feature-flagged payment adapter and separate credentials/data from production.
- Record the USD amount, token/mint, network, wallet role, exchange-rate source and timestamp, transaction signature, facilitator result, payment purpose, refund state, and partner attribution.
- Verify settlement server-side before changing job, reward, access, or payout state.
- Keep customer Square checkout available; no customer should need to understand crypto to book JC.
- Do not reuse treasury keys for API-payment tests or expose signing material to the client.

**Exit gate:** replay, duplicate, failed, expired, wrong-network, wrong-token, underpayment, overpayment, and refund tests pass on Devnet, followed by explicit owner authorization for any Mainnet pilot.

### Stage 3 — Sell one proven internal tool

- Productize the canonical moving quote calculation first: crew size, labor hours, travel, service minimums, discounts, and owner-review conditions.
- Provide a versioned JSON API with an authenticated monthly plan as the initial commercial rail.
- Add x402 v2/Solana only as a metered experiment after ordinary API customers or internal usage prove demand.
- Start with a configurable price experiment, not a promise: proposed $0.01–$0.10 per successful quote or a monthly subscription.
- Return a quote explanation and policy/version identifier so every result can be audited.

**Exit gate:** pricing parity tests, rate limiting, tenant isolation, idempotent metering, usage receipts, refund handling, and positive unit economics pass before public sale.

## Cross-system adoption matrix

| Capability | Shared core | JC ON THE MOVE adapter | Environment | Sensitive data | Rollout |
| --- | --- | --- | --- | --- | --- |
| Payment confirmation | Canonical payment event and idempotency key | Square webhook/invoice mapping | Production + Square sandbox isolated | Customer/payment references | Build now; owner smoke test required |
| JCMOVES reward | Reward policy and append-only ledger | Job/customer/crew attribution | Production policy; test fixtures separate | Wallet/account balances | Build now; manual exception review |
| Job notification | Audited job event and delivery outcome | In-app, push, email, approved crew webhook | Production recipients; test message labeled | Crew identity and job scope | Code tested; live readiness check before broadcast |
| USDC payment | Payment adapter contract | Solana/x402 facilitator implementation | Devnet before Mainnet | Wallet and settlement metadata | Planned, feature flagged |
| Quote API | Versioned quote input/output | Moving-price engine | Internal, then isolated commercial tenant | Addresses minimized; no customer record required | Productize after release stabilization |
| Partner marketplace | Attribution and settlement record | Service-specific partner workflow | Pilot territory first | Customer contact shared only with consent | Planned after lead-to-payment loop |
| Treasury | Exposure policy and approval log | Custody/provider adapter | Separate test and production custody | Keys, balances, accounting records | Watchlist; no autonomous movement |

## Guardrails and scorecard

- Human approval stays mandatory for dispatch exceptions, refunds outside policy, payouts, reward overrides, partner settlement, and treasury movement.
- No private keys, tokens, customer sessions, or production payment records move between apps or environments.
- Public claims distinguish shipped behavior, controlled pilots, future options, and third-party announcements.
- Every external action produces an event ID, actor/source, timestamp, outcome, retry count, and safe-to-display error.
- Weekly scorecard: conversion rate, completed-job gross margin, repeat bookings, partner fees, reward cost, notification delivery rate, payment reconciliation exceptions, API gross margin, and unresolved security/operations exceptions.

The order of operations is fixed: **stabilize the current release → prove Square/JCMOVES closeout → improve lead conversion → pilot partners → test USDC on Devnet → sell one proven tool → consider carefully limited treasury options.**

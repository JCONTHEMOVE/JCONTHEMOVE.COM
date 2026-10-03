# Mobile quote and phone rewards

Integrated onto production commit `8fbc8656685f2380676fec8b739f27fa0c037cdb` in a separate release branch. Release validation is in progress; the original working tree is preserved.

- `/book` presents service, details (including safety), and contact/review in three sections. Existing deep links map to the appropriate section. Pickup is entered once; the existing inventory, crew, truck, date, destination, heavy-item and server-price checks remain.
- `/quote` and staff QuoteForm use service, job details, and contact/review. Optional promotions and extra services are collapsed. Service choices use simple icon buttons. Destination is only shown and submitted for moving. Photos and estimating notes remain available.
- Callback, detailed booking, date requests, and signed payment-order pages offer optional JCMOVES phone enrollment. Contact forms reuse their phone field. The signed order page asks for the booking phone without exposing customer contact data.
- Enrollment sends a verification text only after opt-in. It is separate from marketing consent and never blocks quote submission or the existing secure payment link. Square checkout and verified payment processing remain unchanged.
- Phone verification resolves an existing unambiguous customer or creates a rewards-only record. It does not log anyone in, issue rewards, mark an order paid, or grant wallet access. Normal customer registration can upgrade that record using the same verified phone and browser session; age and terms validation still applies. The enrollment proof lasts 30 minutes. Rewards-only records cannot use account recovery to bypass registration.
- Existing job and booking reward issuers can resolve verified phone membership, with their prior email lookup as fallback. Existing reward calculations and payment/completion gates still apply. Existing ambiguous customer profiles and staff/admin profiles require account assistance instead of automatic public enrollment.
- The 500-scenario questionnaire retains its scenario data, answer values, revision checks and draft behavior. Low, moderate, high and unknown difficulty now have distinct icons, explanations and selected-state checkmarks, with a single-column layout on the narrowest phones.

## Deployment dependencies

The existing Twilio SMS configuration must be working. No new SMS provider or Square product is required. Enrollment lazily creates `phone_rewards_members`, `phone_rewards_challenges`, and `phone_rewards_send_limits` in the application's existing Postgres database; the deployment database role must allow this existing project migration pattern. Codes expire after 10 minutes and allow five attempts. Atomic per-phone and per-IP send limits fail closed on database errors.

Railway's production service currently has no Twilio variables. The public availability endpoint validates configuration without sending a provider request. Until configuration is available, forms show a clear phone-verification-unavailable message with normal account setup and allow the quote/payment to continue. Live SMS configuration and delivery acceptance remain open.

## Validation

The integrated release passed TypeScript, full server tests, Quick Book guards, phone enrollment guards, production build, training and PWA checks. Review fixes must pass the same checks before deployment.

The mocked `server/routes/__tests__/phoneRewards.test.ts` checks phone normalization, consent, send failure, throttling, invalid codes, duplicate/staff profiles, single-use codes and repeat enrollment. It also verifies that enrollment never writes rewards or changes payment state. Existing Square payment policy and mobile booking alignment tests were run.

Browser verification used disposable local fixtures, with no live texts, customer records or charges: quote validation and submission, phone reuse, incorrect-code retry, success, preserved details on Back, three-section booking navigation, difficulty selection, and 320/390-pixel layouts. Those temporary fixtures were removed. Real SMS delivery and a real Square payment were not exercised.

The integrated router passed actual SQL enrollment on the existing isolated Neon branch on September 14, 2026: the rewards-only profile and membership persisted, incorrect and reused codes were rejected, and booking, lead and wallet counts stayed unchanged. SMS was intercepted in-process; zero real texts were sent and production data was untouched. Regression tests also reject inactive customers and memberships whose accounts later become inactive or privileged.

Integrated browser checks confirmed three-step quote navigation, contact-phone reuse, optional enrollment, preserved details when going Back, and no horizontal overflow at 320/390 pixels. The detailed booking path retained moving configuration and mandatory heavy-item safety checks. The client-only preview did not submit bookings or request texts.

Review fixes preserve accumulated spending and referral fields in phone-based customer lookup and make memberships cascade on account deletion. Actual SQL checks confirmed the returned fields and successful cascading deletion of the isolated synthetic customer, then rolled back that deletion. Existing restrictive test-branch constraints are upgraded idempotently; no production records were changed during verification.

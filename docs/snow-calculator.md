# Snow calculator and quote workflow

The public snow-removal page has three payment windows, property and snow sliders,
12 preset combinations, and a quote-request handoff into `/book`. It does not
publish a payable price or create an automatic subscription.

## Pricing assumptions

The starting reference is a 20 × 100 ft driveway with a $50 / $62.50 / $75
low / target / high baseline. Everything beyond that baseline is a draft
operating assumption in `shared/snowPricing.ts`, for owner calibration against
actual labor, fuel, travel, salt, equipment, and storm capacity.

| Input | Starting assumptions |
| --- | --- |
| Property presets | Small 10 × 40 ft; double 20 × 100 ft; extra large 30 × 100 ft |
| Snow depths / multipliers | 4 in / 1; 14 in / 1.75; 24 in / 2.75; 36 in / 4 |
| Back-drag | 20% / 30% / 40%; selectable and adjustable |
| Street bank | 25 ft initially; $10 / $15 / $20 per 25 ft before depth factor |
| Visit allowance | 8 / 12 / 15 visits per month; adjustable |
| Season | Five months initially; adjustable |
| Full service | Driveway, steps and salt; draft add-ons $30 / $40 / $50 before depth factor |

Per-visit price is the greater of the scaled area baseline and case minimum,
plus back-drag, street bank and service add-ons, multiplied by the selected
depth factor, plus configured travel, rounded up to $5. Monthly is per-visit
price times the visit allowance. Seasonal is monthly times season months.
The website's server may additionally apply its active geographic/offer rules;
the reviewed quote is authoritative. There is no automatic volume discount.

At the starting double-driveway/4-inch selection, with back-drag and street bank:

| Case | Single | Month | Five-month season |
| --- | ---: | ---: | ---: |
| Low | $70 | $560 | $2,800 |
| Target | $100 | $1,200 | $6,000 |
| High | $125 | $1,875 | $9,375 |

All covered visits are modeled at the chosen depth. A 36-inch monthly estimate
is a deliberately severe planning case, not an ordinary winter forecast.
End-of-driveway-only work requires a manual apron quote and displays no price.

## Staff workflow

1. Customer adjusts the calculator and requests service. Only choices and
   measurements are submitted; the server validates and recalculates prices.
2. The existing booking flow captures contact/address/date and saves a booking,
   a linked lead, and a draft quote revision. Existing notification services
   handle the request. If the bridge fails, the saved request displays a staff
   recovery status; do not ask the customer to submit it again.
3. Review property access, equipment, scope, storm trigger, response window,
   contract dates, included visits, unused-visit terms and extra-visit pricing.
   Deep snow (24/36 inches) needs specific equipment and capacity review.
4. Use the existing job-workflow report's quote review and approve/send action.
   This generates or reuses the approved Square invoice. Its copy-link option
   supports sending the payment request through your usual approved channel.
   Keep invoice totals tied to the approved revision.
5. Treat the full contract as the obligation. A seasonal installment selection
   is a scheduling preference only; staff must explicitly arrange it. The
   request stores the full season total, not one installment as the invoice total.
6. Square's verified payment workflow records payment. Mark a monthly/seasonal
   plan complete only after the whole agreed period and allowance obligations
   are fulfilled. The lead reward ledger requires completion and payment in full;
   the separate booking bonus issuer skips new calculator requests to prevent
   premature or duplicate awards.

## Operating boundaries and rollout

- Existing customer and service-log records are untouched. This release does not
  migrate historical sheets or bind old snow-log entries to new contracts.
- It does not create recurring Square subscriptions, auto-charge installments,
  automatically dispatch crews, or send storm/weather messages.
- Before accepting live quotes, review the draft rate configuration and run the
  existing quote → invoice → signed webhook → completion flow in the deployment's
  test environment. Verify owner/customer notification delivery there.
- The next operational addition should be a contract/period/visit ledger linking
  each clearing to its allowance and invoice. That enables accurate remaining
  visits, overages, monthly renewals and capacity planning without equating one
  completed clearing with a completed season.

## Verification

Targeted tests cover the 12 combinations, reference prices, input validation,
minimums, depth scaling, exact installment cents, server price authority, draft
payment blocking and reward ownership. Repository CI runs TypeScript, server
tests and the production build. A local page harness can check the real component
at phone/desktop sizes; boundary adapters do not replace live integration tests.

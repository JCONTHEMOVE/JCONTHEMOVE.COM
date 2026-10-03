# Guided job report — September 28, 2026

The job page now uses Details → Quote → Confirmation → Crew & dispatch → Closeout.
A saved price opens a server-calculated review; it no longer implies quote approval.

## Behavior

- Setup saves remain quiet and synchronize the current draft revision in the same transaction. Existing approvals are superseded after material changes.
- Final review binds the exact saved job, recipient, price, policy, and delivery method to a fingerprint. Stale reviews cannot approve or share an older price.
- Quote approval, invoice creation, email, and SMS have separate outcomes. Successful channels are not retried; uncertain provider responses require verification. Copying a signed link does not mark it sent.
- Customer agreement is recorded with a staff attestation and snapshot. Material customer/scope/location/price/schedule changes invalidate it; crew identities and internal dispatch notes do not.
- Payment recording preserves the operational stage. Staff and automated dispatch share readiness checks; automated offers can fill open crew slots. Explicit crew actions deduplicate by the reviewed plan and report email outcomes independently.
- Company alerts use upmichiganstatemovers@gmail.com. Provider acceptance is not proof of mailbox delivery.
- Historical unreconciled prices require review. No bulk repricing or destructive migration is included.
- Crew projections omit staff attestations, delivery links, and receipt metadata. Existing payout, closeout correction, and JCMOVES controls remain available.

## Verification

- TypeScript check and production build passed locally.
- Full server regression suite passed.
- Isolated PostgreSQL integration covers approval, explicit discounts, transaction rollback, stale reviews, confirmation, payment/dispatch separation, concurrent payment and approval retries, partial delivery, uncertain provider results, and signed copy links.
- All 16 existing closeout/payment acceptance scenarios passed.
- Public project-request regression checks passed.
- Browser checks used synthetic data and mocked outbound services: quote review, unavailable invoice fallback, explicit customer attestation, back navigation, retained edits after a failed save, retry, and separate payment/dispatch dialogs. Responsive layouts were inspected at rendered widths of 300 and 1012 pixels without horizontal overflow.

Deployment commit and controlled live verification are recorded in the release handoff after the Railway pipeline completes. No real customer messages or crew dispatches are authorized as tests.

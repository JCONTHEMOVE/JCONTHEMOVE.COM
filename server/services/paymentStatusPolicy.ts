export type PaymentStatusKey =
  | "deposit_paid"      // green: deposit collected, ready to dispatch
  | "fully_paid"        // green: invoice paid in full
  | "awaiting_wallet" // yellow: wallet selected, settlement not confirmed
  | "wallet_paid"       // green: paid from JCMOVES wallet
  | "awaiting_deposit"  // yellow: deposit invoice sent, not yet paid
  | "pay_on_completion" // blue: invoice goes out at completion
  | "cash_on_site"      // gray: walk-in cash / BTC at job
  | "unknown";          // gray: no payment info yet

export interface PaymentStatus {
  key: PaymentStatusKey;
  label: string;
  /** Tailwind color tokens — keeps the pill component dumb. */
  color: "green" | "yellow" | "blue" | "gray";
}

const TABLE: Record<PaymentStatusKey, Omit<PaymentStatus, "key">> = {
  deposit_paid:      { label: "Deposit paid",       color: "green"  },
  fully_paid:        { label: "Paid in full",       color: "green"  },
  awaiting_wallet:   { label: "Awaiting wallet payment", color: "yellow" },
  wallet_paid:       { label: "Paid (JCMOVES)",     color: "green"  },
  awaiting_deposit:  { label: "Awaiting deposit",   color: "yellow" },
  pay_on_completion: { label: "Pay on completion",  color: "blue"   },
  cash_on_site:      { label: "Cash on site",       color: "gray"   },
  unknown:           { label: "—",                  color: "gray"   },
};

export function makeStatus(key: PaymentStatusKey): PaymentStatus {
  return { key, ...TABLE[key] };
}

type PaymentStatusRecord = {
  depositRequired?: boolean | null;
  depositPaid?: boolean | null;
  paymentPlan?: string | null;
  paymentPaidAt?: Date | string | null;
};

/**
 * Pure status derivation used by the universal job-flow list as well as the
 * single-job endpoint below.  Keeping this here prevents a job from showing
 * one payment state in Admin and another state on a crew card.
 */
export function derivePaymentStatusFromRecord(record: PaymentStatusRecord): PaymentStatus {
  if (record.paymentPaidAt != null) {
    return record.paymentPlan === "wallet_pay_now"
      ? makeStatus("wallet_paid")
      : makeStatus("fully_paid");
  }
  if (record.paymentPlan === "wallet_pay_now") return makeStatus("awaiting_wallet");
  if (record.paymentPlan === "cash_or_btc") return makeStatus("cash_on_site");
  if (record.depositRequired) {
    return record.depositPaid ? makeStatus("deposit_paid") : makeStatus("awaiting_deposit");
  }
  if (record.paymentPlan === "pay_on_completion") return makeStatus("pay_on_completion");
  return makeStatus("unknown");
}


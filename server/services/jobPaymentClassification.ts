export type JobInvoicePaymentKind = "deposit" | "partial" | "paid_in_full";

export type JobInvoicePaymentClassification = {
  kind: JobInvoicePaymentKind;
  invoiceAmount: number;
  jobTotal: number;
  accountingAmount: number;
};

function dollars(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100) / 100) : 0;
}

/**
 * Square's PAID status describes the invoice, not the whole moving job. A
 * separately issued scheduling-deposit invoice can therefore be PAID while
 * 70% of the approved job quote remains due. Keep those states distinct so
 * deposit collection can unlock dispatch without unlocking paid-in-full
 * rewards, payouts, or completion accounting.
 */
export function classifyJobInvoicePayment(input: {
  invoiceAmount: unknown;
  jobTotal: unknown;
  depositAmount?: unknown;
  depositRequired?: boolean | null;
  depositAlreadyPaid?: boolean | null;
  invoicePurpose?: string | null;
}): JobInvoicePaymentClassification {
  const invoiceAmount = dollars(input.invoiceAmount);
  const jobTotal = dollars(input.jobTotal);
  const depositAmount = dollars(input.depositAmount);
  const isFirstRequiredPayment = input.depositRequired === true && input.depositAlreadyPaid !== true;
  const isLessThanJobTotal = jobTotal > 0 && invoiceAmount < jobTotal;
  const matchesConfiguredDeposit = depositAmount > 0 && invoiceAmount === depositAmount;
  const coversDeposit = invoiceAmount > 0 && invoiceAmount >= depositAmount;
  // Matching the configured deposit remains a deposit on duplicate webhook
  // delivery even after deposit_paid has already flipped to true. A later
  // balance invoice is classified as full payment only after that guard.
  const explicitPurpose = String(input.invoicePurpose || "").toLowerCase();
  const confirmedDeposit = input.depositAlreadyPaid === true ? depositAmount : 0;
  const coversJob = jobTotal > 0 && invoiceAmount > 0
    && Math.round((invoiceAmount + confirmedDeposit) * 100) >= Math.round(jobTotal * 100);
  const kind: JobInvoicePaymentKind = explicitPurpose === "deposit"
    ? coversDeposit ? "deposit" : "partial"
    : !["final_balance", "supplement"].includes(explicitPurpose) && input.depositRequired === true
        && coversDeposit
        && ((matchesConfiguredDeposit && isLessThanJobTotal) || (isFirstRequiredPayment && depositAmount > 0 && isLessThanJobTotal))
        ? "deposit"
        : coversJob ? "paid_in_full" : "partial";

  return {
    kind,
    invoiceAmount,
    jobTotal,
    // Full-payment accounting represents the approved job total. This also
    // includes an earlier deposit when the final Square invoice is only the
    // remaining balance. Excess collection does not enlarge the job's grant.
    accountingAmount: kind === "paid_in_full" ? jobTotal : 0,
  };
}

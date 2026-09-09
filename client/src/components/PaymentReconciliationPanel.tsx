import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import type { getJobPaymentReconciliation } from "../../../server/services/jobPaymentReconciliation";

type Report = NonNullable<Awaited<ReturnType<typeof getJobPaymentReconciliation>>>;
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dollars = (cents: number | null) => cents == null ? "Unavailable" : currency.format(cents / 100);
const reviewLabels: Record<string, string> = {
  missing_approved_usd_quote: "An approved USD quote is missing.",
  quote_total_mismatch: "The job total differs from its approved quote.",
  paid_marker_without_ledger_coverage: "The job is marked paid, but recorded payments do not cover the approved quote.",
  ledger_covered_without_paid_marker: "Recorded payments cover the quote, but the job is not marked paid.",
  overpayment: "Recorded payments exceed the approved quote.",
  reward_marker_requires_review: "A reward is marked issued while completion or payment evidence is incomplete.",
  refund_requires_review: "A refund is recorded. Review the job's paid status and any previously issued rewards.",
};

export function PaymentReconciliationView({ report }: { report: Report }) {
  if (!report.enabled) return <p className="text-sm text-muted-foreground">Payment reconciliation is not enabled for this deployment.</p>;
  return <div className="space-y-4" data-testid="payment-reconciliation-report">
    {report.reviewReasons.length > 0 ? <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <h3 className="font-semibold">Needs review</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{report.reviewReasons.map((reason) => <li key={reason}>{reviewLabels[reason] || "An additional reconciliation check needs review."}</li>)}</ul>
    </div> : <p className="text-sm">No mismatch found in the recorded payment totals.</p>}
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      {[["Approved quote", dollars(report.approvedTotalCents)], ["Net payments", dollars(report.paidCents)],
        ["Remaining", dollars(report.totals?.outstandingCents ?? null)], ["Gift-funded", dollars(report.giftFundedCents)]].map(([label, value]) =>
        <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold">{value}</dd></div>)}
    </dl>
    <p className="text-xs text-muted-foreground">Verified refunds are deducted from net payments. Reward markers show recorded issuance, not verified wallet balances. Reward reversal requires review.</p>
    <dl className="space-y-1 text-xs">
      <div><dt className="inline font-medium">Paid marker: </dt><dd className="inline">{report.paidMarkerAt ? new Date(report.paidMarkerAt).toLocaleString() : "Not recorded"}</dd></div>
      <div><dt className="inline font-medium">Reward marker: </dt><dd className="inline">{report.rewardRecordedAt ? new Date(report.rewardRecordedAt).toLocaleString() : "Not recorded"}</dd></div>
    </dl>
    <h3 className="text-sm font-semibold">Recorded payments ({report.paymentCount})</h3>
    {report.payments.length === 0 ? <p className="text-sm text-muted-foreground">No payments have been recorded in this ledger for this job.</p> :
      <ul className="space-y-2">{report.payments.map((payment) => <li key={payment.id} className="rounded-lg border p-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{payment.provider}</span><span>{dollars(Number(payment.amount_cents))}</span></div>
        <p className="mt-1 break-all font-mono text-xs">{payment.provider_payment_id}</p>
        <p className="mt-1 text-xs text-muted-foreground">{payment.tender_type.replace(/_/g, " ")} · Gift-funded {dollars(Number(payment.gift_funded_cents))}</p>
        <p className="mt-1 break-all text-xs text-muted-foreground">Quote revision: {payment.quote_revision_id}</p>
      </li>)}</ul>}
    {report.paymentsTruncated ? <p className="text-xs text-muted-foreground">Showing the latest 100 payments. Totals include all recorded payments.</p> : null}
    <h3 className="text-sm font-semibold">Recorded refunds ({report.refundCount}) · {dollars(report.refundedCents)}</h3>
    {report.refunds.length === 0 ? <p className="text-sm text-muted-foreground">No verified refunds recorded.</p> :
      <ul className="space-y-2">{report.refunds.map((refund) => <li key={refund.id} className="rounded-lg border p-3 text-sm">
        <p className="font-medium">{refund.provider} · {dollars(Number(refund.amount_cents))}</p>
        <p className="mt-1 break-all font-mono text-xs">{refund.provider_refund_id}</p>
        <p className="mt-1 break-all text-xs text-muted-foreground">Payment: {refund.provider_payment_id}</p>
      </li>)}</ul>}
    {report.refundsTruncated ? <p className="text-xs text-muted-foreground">Showing the latest 100 refunds. Totals include all recorded refunds.</p> : null}
  </div>;
}

export function PaymentReconciliationPanel({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery<Report>({
    queryKey: ["/api/admin/payments/reconciliation", leadId], enabled: open, retry: false,
    queryFn: async () => (await apiRequest("GET", `/api/admin/payments/reconciliation/${encodeURIComponent(leadId)}`)).json(),
  });
  return <section className="rounded-xl border p-4" aria-label="Payment reconciliation">
    <Button variant="outline" className="min-h-11" aria-expanded={open} onClick={() => setOpen(!open)}>Payment reconciliation</Button>
    {open ? <div className="mt-4 space-y-3">
      <Button variant="ghost" className="min-h-11" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh payments</Button>
      {query.isPending ? <p role="status" className="text-sm">Loading payment records…</p> : query.isError ?
        <p role="alert" className="text-sm text-destructive">Payment records could not be loaded. Refresh to retry.</p> : query.data ? <PaymentReconciliationView report={query.data} /> : null}
    </div> : null}
  </section>;
}

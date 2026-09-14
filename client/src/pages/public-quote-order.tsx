import { PhoneRewardsEnrollment } from "@/components/phone-rewards-enrollment";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Printer } from "lucide-react";
import { useRoute } from "wouter";
import { JobOrderTicket, type JobOrderTicketData } from "@/components/job-order-ticket";
import { Button } from "@/components/ui/button";

type PublicOrder = JobOrderTicketData & {
  id: string;
  paymentUrl?: string | null;
  lineItems?: Array<{ name: string; quantity: number; total: number }>;
};

export default function PublicQuoteOrderPage() {
  const [, params] = useRoute("/quote-order/:id");
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const { data, isLoading, isError } = useQuery<{ order: PublicOrder }>({
    queryKey: ["public-quote-order", params?.id, token],
    enabled: Boolean(params?.id && token),
    queryFn: async () => {
      const response = await fetch(`/api/quote-orders/${encodeURIComponent(params?.id || "")}?token=${encodeURIComponent(token)}`);
      if (!response.ok) throw new Error("Quote order is unavailable");
      return response.json();
    },
    retry: false,
  });
  const order = data?.order;

  return (
    <main className="min-h-screen bg-[#0d1016] px-4 py-8 text-slate-100 sm:px-6 sm:py-12">
      <style>{`@media print { body { background: #fff !important; } .quote-order-actions, .quote-order-help { display: none !important; } .quote-order-page { max-width: 720px !important; padding: 0 !important; } }`}</style>
      <div className="quote-order-page mx-auto max-w-xl">
        <div className="mb-7 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-300">JC ON THE MOVE</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-white">Your Job Order</h1>
          <p className="mt-2 text-sm text-slate-400">Review the service details, then confirm with secure payment when you are ready.</p>
        </div>

        {isLoading ? <div className="rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center text-sm text-slate-400">Loading your job order…</div> : null}
        {isError || (!isLoading && !order) ? (
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center">
            <h2 className="text-lg font-black text-white">This quote link is no longer active.</h2>
            <p className="mt-2 text-sm text-slate-400">Please call or text JC ON THE MOVE at (906) 285-9312 and we will help right away.</p>
          </div>
        ) : null}
        {order ? (
          <>
            <JobOrderTicket order={order} viewer="customer" />
            <div className="quote-order-actions mt-4"><PhoneRewardsEnrollment /></div>
            <div className="quote-order-actions mt-4 grid gap-2 sm:grid-cols-2">
              {order.paymentUrl ? (
                <Button className="min-h-12 gap-2 bg-cyan-500 font-bold text-slate-950 hover:bg-cyan-400" onClick={() => window.open(order.paymentUrl || "", "_blank", "noopener,noreferrer")} data-testid="button-pay-quote-order">
                  Review & Pay <ExternalLink className="h-4 w-4" />
                </Button>
              ) : null}
              <Button variant="outline" className="gap-2 border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800 hover:text-white" onClick={() => window.print()} data-testid="button-print-quote-order">
                <Printer className="h-4 w-4" /> Print order
              </Button>
            </div>
            <p className="quote-order-help mt-5 text-center text-xs text-slate-500">Questions or changes? Call or text (906) 285-9312.</p>
          </>
        ) : null}
      </div>
    </main>
  );
}

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AdminTreasuryPage from "@/pages/admin-treasury";
import AdminJobPayoutsPage from "@/pages/admin/job-payouts";
import AdminPaymentsPage from "@/pages/admin/AdminPaymentsPage";
import AdminWalletLedgerPage from "@/pages/admin/AdminWalletLedgerPage";
import AdminCashoutsPage from "@/pages/admin/AdminCashoutsPage";
import AdminPayrollLedgerPage from "@/pages/admin/payroll-ledger";

export default function AdminFinancePage() {
  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 pt-6">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-white">Finance</h1>
        </div>
        <Tabs defaultValue="job-payouts">
          <TabsList className="bg-slate-800/50 border border-slate-700/50 mb-6 flex-wrap">
            <TabsTrigger value="job-payouts" className="data-[state=active]:bg-blue-600/20 data-[state=active]:text-blue-300">Job Payouts</TabsTrigger>
            <TabsTrigger value="payroll" className="data-[state=active]:bg-blue-600/20 data-[state=active]:text-blue-300">Payroll, Tips & Bonus</TabsTrigger>
            <TabsTrigger value="invoices" className="data-[state=active]:bg-blue-600/20 data-[state=active]:text-blue-300">Square Links</TabsTrigger>
            <TabsTrigger value="cashouts" className="data-[state=active]:bg-blue-600/20 data-[state=active]:text-blue-300">Cashouts</TabsTrigger>
            <TabsTrigger value="treasury" className="data-[state=active]:bg-blue-600/20 data-[state=active]:text-blue-300">Treasury</TabsTrigger>
            <TabsTrigger value="ledger" className="data-[state=active]:bg-blue-600/20 data-[state=active]:text-blue-300">Ledger</TabsTrigger>
          </TabsList>
          <TabsContent value="job-payouts">
            <AdminJobPayoutsPage />
          </TabsContent>
          <TabsContent value="payroll">
            <AdminPayrollLedgerPage />
          </TabsContent>
          <TabsContent value="invoices">
            <AdminPaymentsPage />
          </TabsContent>
          <TabsContent value="cashouts">
            <AdminCashoutsPage />
          </TabsContent>
          <TabsContent value="treasury">
            <AdminTreasuryPage />
          </TabsContent>
          <TabsContent value="ledger">
            <AdminWalletLedgerPage />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

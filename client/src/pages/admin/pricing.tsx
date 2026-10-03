import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sliders, Info } from "lucide-react";
import AdminCalibratePage from "./calibrate";
import AdminPricingCalibrationPage from "./pricing-calibration";

// Task #171 — Merged pricing console.
// Combines the two prior pricing screens (`/admin/calibrate` wizard and
// `/admin/pricing-calibration` scenario tester) plus three read-only
// reference tabs (Bundle Discounts, Surge Rules, Reward Tiers) so admins
// can see — at a glance — every knob that drives pricing and rewards.

const BUNDLE_DISCOUNTS = [
  { label: "2 services bundled", value: "10% off all lines" },
  { label: "3 services bundled", value: "15% off all lines" },
  { label: "Max stackable discount", value: "25%" },
];

const SURGE_RULES = [
  { band: "Normal (demand ≤ 0.7)", value: "1.0x" },
  { band: "Elevated (0.7 – 0.9)", value: "1.1x" },
  { band: "High (0.9 – 0.95)", value: "1.25x" },
  { band: "Very high (> 0.95)", value: "1.25x (capped)" },
];

const REWARD_TIERS = [
  { tier: "Bronze (default)", multiplier: "1.0x tokens" },
  { tier: "Silver (5+ completed jobs)", multiplier: "1.1x tokens" },
  { tier: "Gold (15+ completed jobs)", multiplier: "1.2x tokens" },
  { tier: "VIP (admin-flagged)", multiplier: "1.5x tokens" },
];

function ReferenceTable({ rows }: { rows: { label?: string; band?: string; tier?: string; value?: string; multiplier?: string }[] }) {
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-800/40 border border-slate-700/40">
          <span className="text-sm text-slate-300">{r.label || r.band || r.tier}</span>
          <span className="text-sm font-semibold text-white font-mono">{r.value || r.multiplier}</span>
        </div>
      ))}
    </div>
  );
}

function ReadOnlyNote() {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-950/30 border border-blue-500/20 text-xs text-blue-200">
      <Info className="h-4 w-4 text-blue-300 flex-shrink-0 mt-0.5" />
      <span>
        These values are sourced from the server-side pricing & rewards engine.
        Edit them in <code className="text-blue-100 font-mono">server/services/bookingPricing.ts</code>
        {" "}and <code className="text-blue-100 font-mono">server/pipeline/steps/</code>.
      </span>
    </div>
  );
}

export default function AdminPricingPage() {
  // Live rate for context
  const { data: pricing } = useQuery<{ ratePerMoverHour: number }>({ queryKey: ["/api/pricing"] });

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 pt-6">
        <div className="mb-5 flex items-center gap-2">
          <Sliders className="h-5 w-5 text-teal-400" />
          <h1 className="text-2xl font-black text-white">Pricing</h1>
          {pricing && (
            <span className="ml-2 text-xs text-slate-400">
              live rate: <span className="text-white font-mono">${pricing.ratePerMoverHour}/hr</span>
            </span>
          )}
        </div>

        <a href="/admin/pricing-training" className="mb-5 block rounded-xl bg-blue-600 px-4 py-4 text-center font-bold text-white">Take the 500-request pricing test</a>
        <Tabs defaultValue="rates">
          <TabsList className="bg-slate-800/50 border border-slate-700/50 mb-6 flex-wrap h-auto">
            <TabsTrigger value="rates" data-testid="tab-rates">Rates</TabsTrigger>
            <TabsTrigger value="scenarios" data-testid="tab-scenarios">Scenarios</TabsTrigger>
            <TabsTrigger value="bundles" data-testid="tab-bundles">Bundle Discounts</TabsTrigger>
            <TabsTrigger value="surge" data-testid="tab-surge">Surge Rules</TabsTrigger>
            <TabsTrigger value="rewards" data-testid="tab-rewards">Reward Tiers</TabsTrigger>
          </TabsList>

          <TabsContent value="rates">
            <AdminCalibratePage />
          </TabsContent>

          <TabsContent value="scenarios">
            <AdminPricingCalibrationPage />
          </TabsContent>

          <TabsContent value="bundles">
            <Card className="bg-slate-900/40 border-slate-700/50">
              <CardHeader><CardTitle className="text-base text-white">Bundle Discounts</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <ReferenceTable rows={BUNDLE_DISCOUNTS} />
                <ReadOnlyNote />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="surge">
            <Card className="bg-slate-900/40 border-slate-700/50">
              <CardHeader><CardTitle className="text-base text-white">Surge Rules</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <ReferenceTable rows={SURGE_RULES} />
                <ReadOnlyNote />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rewards">
            <Card className="bg-slate-900/40 border-slate-700/50">
              <CardHeader><CardTitle className="text-base text-white">Reward Tiers</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <ReferenceTable rows={REWARD_TIERS} />
                <ReadOnlyNote />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

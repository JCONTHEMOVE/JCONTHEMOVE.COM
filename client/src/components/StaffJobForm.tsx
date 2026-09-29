import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Calculator, CheckCircle2, ClipboardCheck, Loader2, MapPin, Route, Truck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PlacesAutocomplete } from "@/components/places-autocomplete";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  marketplaceEstimateLabel,
  marketplacePreviewBillableHours,
  marketplacePreviewCrewSize,
  marketplacePreviewZoneName,
  type MarketplaceQuotePreview,
} from "@/lib/marketplaceQuotePreview";

type StaffServiceCode = "load_unload" | "pack_unpack" | "delivery" | "ubox" | "junk" | "commercial";
type TruckProvider = "jc_on_the_move" | "customer" | "rental_uhaul" | "none";
type TruckSize = "none" | "15_ft" | "20_ft" | "26_ft" | "custom";

type StaffJobFormProps = {
  prefilledDate?: string;
  onSaved?: (leadId: string) => void;
};

const SERVICES: Array<{ value: StaffServiceCode; label: string; estimateCode: string }> = [
  { value: "load_unload", label: "Moving / Load & Unload", estimateCode: "load_unload" },
  { value: "pack_unpack", label: "Packing / Unpacking", estimateCode: "pack_unpack" },
  { value: "delivery", label: "Delivery", estimateCode: "delivery" },
  { value: "ubox", label: "U-Box / Container", estimateCode: "ubox" },
  { value: "junk", label: "Junk / Cleanout", estimateCode: "load_unload" },
  { value: "commercial", label: "Commercial / Contractor", estimateCode: "load_unload" },
];

function localDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value || 0);
}

export function StaffJobForm({ prefilledDate, onSaved }: StaffJobFormProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [serviceCode, setServiceCode] = useState<StaffServiceCode>("load_unload");
  const [fromAddress, setFromAddress] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [zip, setZip] = useState("");
  const [moveDate, setMoveDate] = useState(prefilledDate || localDate());
  const [arrivalWindow, setArrivalWindow] = useState("");
  const [crewSize, setCrewSize] = useState(2);
  const [expectedHours, setExpectedHours] = useState(3);
  const [truckProvider, setTruckProvider] = useState<TruckProvider>("jc_on_the_move");
  const [truckSize, setTruckSize] = useState<TruckSize>("20_ft");
  const [internalNotes, setInternalNotes] = useState("");

  const selectedService = SERVICES.find((service) => service.value === serviceCode) ?? SERVICES[0];
  const validZip = /^\d{5}(?:-\d{4})?$/.test(zip.trim());
  const canPreview = validZip && crewSize >= 1 && expectedHours >= 1;
  const needsOwnerReview = serviceCode === "junk" || serviceCode === "commercial";

  const previewQuery = useQuery<MarketplaceQuotePreview>({
    queryKey: ["/api/marketplace/quote-preview", zip.trim(), selectedService.estimateCode, crewSize, expectedHours],
    enabled: canPreview,
    queryFn: async () => {
      const response = await apiRequest("POST", "/api/marketplace/quote-preview", {
        zip: zip.trim(),
        serviceCode: selectedService.estimateCode,
        crewSize,
        hours: expectedHours,
      });
      return response.json();
    },
    staleTime: 10_000,
  });

  const saveJob = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/leads/staff-job", {
        customerName,
        phone,
        email,
        serviceCode,
        fromAddress,
        toAddress,
        zip: zip.trim(),
        moveDate,
        arrivalWindow,
        crewSize,
        expectedHours,
        truckProvider,
        truckSize,
        internalNotes,
      });
      return response.json() as Promise<{ lead: { id: string }; requiresOwnerReview: boolean; message: string }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/available"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/my-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employee/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flow?scope=admin"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flow?scope=board"] });
      toast({
        title: result.requiresOwnerReview ? "Job saved for owner quote review" : "Available calendar job saved",
        description: result.message,
      });
      if (onSaved) {
        onSaved(result.lead.id);
      } else {
        setLocation(`/lead/${result.lead.id}`);
      }
    },
    onError: (error: Error) => {
      toast({ title: "Could not save job", description: error.message || "Review the required fields and try again.", variant: "destructive" });
    },
  });

  const preview = previewQuery.data;
  const matched = Boolean(preview?.matched) && !needsOwnerReview;
  const billableHours = preview ? marketplacePreviewBillableHours(preview, expectedHours) : expectedHours;
  const rate = preview?.quote.rate;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canPreview) {
      toast({ title: "Add a valid service ZIP", description: "The zone estimate needs a 5-digit ZIP, crew size, and expected hours.", variant: "destructive" });
      return;
    }
    saveJob.mutate();
  };

  return (
    <div className="space-y-5" data-testid="staff-job-form">
      <Card className="border-blue-500/30 bg-blue-950/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-xl text-white"><ClipboardCheck className="h-5 w-5 text-blue-300" /> Staff Job Form</CardTitle>
          <CardDescription className="text-slate-300">
            Save an unassigned available job. This does not dispatch crew, create a payout, or notify workers.
          </CardDescription>
        </CardHeader>
      </Card>

      <form className="space-y-5" onSubmit={handleSubmit}>
        <Card className="border-slate-700 bg-slate-800/50">
          <CardHeader className="pb-3"><CardTitle className="text-base text-white">Customer &amp; service</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="staff-customer-name">Customer name *</Label>
              <Input id="staff-customer-name" required value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="First and last name" data-testid="input-staff-customer-name" />
            </div>
            <div>
              <Label htmlFor="staff-phone">Customer phone *</Label>
              <Input id="staff-phone" required type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(906) 555-0123" data-testid="input-staff-phone" />
            </div>
            <div>
              <Label htmlFor="staff-email">Customer email <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="staff-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="customer@email.com" data-testid="input-staff-email" />
            </div>
            <div>
              <Label htmlFor="staff-service">Service *</Label>
              <select id="staff-service" value={serviceCode} onChange={(event) => setServiceCode(event.target.value as StaffServiceCode)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="select-staff-service">
                {SERVICES.map((service) => <option key={service.value} value={service.value}>{service.label}</option>)}
              </select>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-700 bg-slate-800/50">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base text-white"><MapPin className="h-4 w-4 text-orange-300" /> Location &amp; schedule</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label htmlFor="staff-from-address">Pickup / service address *</Label>
              <PlacesAutocomplete id="staff-from-address" required value={fromAddress} onChange={(value) => { setFromAddress(value); const embeddedZip = value.match(/\b\d{5}(?:-\d{4})?\b/); if (embeddedZip) setZip(embeddedZip[0]); }} onPlaceSelect={(place) => { setFromAddress(place.fullAddress); setZip(place.zip); }} placeholder="Start typing the pickup address" inputTestId="input-staff-from-address" />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="staff-to-address">Drop-off address <span className="text-muted-foreground">(leave blank for labor-only / same-site jobs)</span></Label>
              <PlacesAutocomplete id="staff-to-address" value={toAddress} onChange={setToAddress} placeholder="Start typing the drop-off address" inputTestId="input-staff-to-address" />
            </div>
            <div>
              <Label htmlFor="staff-zip">Service ZIP *</Label>
              <Input id="staff-zip" required inputMode="numeric" value={zip} onChange={(event) => setZip(event.target.value.replace(/[^0-9-]/g, "").slice(0, 10))} placeholder="49938" data-testid="input-staff-zip" />
            </div>
            <div>
              <Label htmlFor="staff-date">Job date *</Label>
              <Input id="staff-date" required type="date" value={moveDate} onChange={(event) => setMoveDate(event.target.value)} data-testid="input-staff-date" />
            </div>
            <div>
              <Label htmlFor="staff-window">Arrival time / window</Label>
              <Input id="staff-window" value={arrivalWindow} onChange={(event) => setArrivalWindow(event.target.value)} placeholder="9:00 AM – 11:00 AM" data-testid="input-staff-window" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-700 bg-slate-800/50">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base text-white"><Truck className="h-4 w-4 text-cyan-300" /> Crew, truck &amp; notes</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="staff-crew-size">Mover count *</Label>
              <Input id="staff-crew-size" required type="number" min="1" max="12" value={crewSize} onChange={(event) => setCrewSize(Math.max(1, Number(event.target.value) || 1))} data-testid="input-staff-crew-size" />
            </div>
            <div>
              <Label htmlFor="staff-hours">Expected hours *</Label>
              <Input id="staff-hours" required type="number" min="1" max="24" value={expectedHours} onChange={(event) => setExpectedHours(Math.max(1, Number(event.target.value) || 1))} data-testid="input-staff-hours" />
            </div>
            <div>
              <Label htmlFor="staff-truck-provider">Truck provider *</Label>
              <select id="staff-truck-provider" value={truckProvider} onChange={(event) => setTruckProvider(event.target.value as TruckProvider)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="select-staff-truck-provider">
                <option value="jc_on_the_move">JC ON THE MOVE</option><option value="customer">Customer truck</option><option value="rental_uhaul">Rental / U-Haul</option><option value="none">No truck needed</option>
              </select>
            </div>
            <div>
              <Label htmlFor="staff-truck-size">Truck size *</Label>
              <select id="staff-truck-size" value={truckSize} onChange={(event) => setTruckSize(event.target.value as TruckSize)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="select-staff-truck-size">
                <option value="none">None</option><option value="15_ft">15 ft</option><option value="20_ft">20 ft</option><option value="26_ft">26 ft</option><option value="custom">Custom / discuss</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="staff-notes">Internal notes</Label>
              <Textarea id="staff-notes" value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} placeholder="Access, stairs, special items, customer expectations, or follow-up notes" rows={4} data-testid="input-staff-notes" />
            </div>
          </CardContent>
        </Card>

        <Card className={matched ? "border-emerald-500/40 bg-emerald-950/20" : "border-amber-500/40 bg-amber-950/20"} data-testid="staff-zone-estimate-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-white"><Calculator className="h-4 w-4" /> Zone estimate</CardTitle>
            <CardDescription className="text-slate-300">This estimate updates when the ZIP, service, crew size, or expected hours changes.</CardDescription>
          </CardHeader>
          <CardContent>
            {!canPreview ? (
              <p className="text-sm text-slate-300">Enter a valid service ZIP, mover count, and expected hours to calculate the customer estimate.</p>
            ) : previewQuery.isLoading ? (
              <p className="flex items-center gap-2 text-sm text-slate-300"><Loader2 className="h-4 w-4 animate-spin" /> Matching the service zone…</p>
            ) : preview ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><p className="font-semibold text-white">{marketplacePreviewZoneName(preview)}</p><p className="text-xs text-slate-300">{matched ? "Matched zone estimate" : "Owner quote review required"}</p></div>
                  <span className="rounded-full bg-slate-950/40 px-3 py-1 text-sm font-bold text-white">{marketplaceEstimateLabel(preview)}</span>
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                  <div className="rounded-lg bg-slate-950/25 p-2"><p className="text-xs text-slate-400">Crew hourly rate</p><p className="font-semibold text-white">{rate ? `${money(rate.hourlyRate)}/hr` : "Owner review"}</p></div>
                  <div className="rounded-lg bg-slate-950/25 p-2"><p className="text-xs text-slate-400">Billable time</p><p className="font-semibold text-white">{billableHours} hour{billableHours === 1 ? "" : "s"}</p></div>
                  <div className="rounded-lg bg-slate-950/25 p-2"><p className="text-xs text-slate-400">Labor + travel</p><p className="font-semibold text-white">{money(preview.quote.labor)} + {money(preview.quote.travel)}</p></div>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-950/25 p-3 text-sm text-slate-200">
                  <p className="mb-1 flex items-center gap-1.5 font-semibold text-white"><Users className="h-4 w-4 text-blue-300" /> What to tell the customer</p>
                  {matched ? (
                    <p>“For a {marketplacePreviewCrewSize(preview, crewSize)}-mover crew, the zone rate is {money(rate?.hourlyRate || 0)} an hour with {rate?.minimumHours || billableHours} billable hour{(rate?.minimumHours || billableHours) === 1 ? "" : "s"}. Based on {expectedHours} expected hour{expectedHours === 1 ? "" : "s"}, labor and travel are estimated at {marketplaceEstimateLabel(preview)}. We will confirm access and any special-item charges before the final quote.”</p>
                  ) : (
                    <p>“This location is outside a matched pricing zone, so the {marketplaceEstimateLabel(preview)} range is a planning estimate only. I’m sending it to the owner for a confirmed quote before we promise a price.”</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-red-200">The zone estimate could not load. Check the ZIP and try again.</p>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-400"><Route className="mr-1 inline h-4 w-4" /> Need inventory, specialty items, or a full custom quote? <Link href={`/book?worker=1&date=${moveDate}`} className="font-medium text-blue-300 hover:underline">Open the full booking wizard</Link>.</p>
          <Button type="submit" disabled={saveJob.isPending || !canPreview} className="min-w-52 bg-blue-600 hover:bg-blue-500" data-testid="button-save-staff-job">
            {saveJob.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />} Save available job
          </Button>
        </div>
      </form>
    </div>
  );
}

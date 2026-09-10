import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ArrowLeft, Box, CalendarDays, CheckCircle2, Loader2, PackageCheck, ShoppingCart, Sparkles } from "lucide-react";
import type { CommerceItem } from "@shared/commerceCatalog";
import { COMMERCE_TERMS_VERSION } from "@shared/commerceCatalog";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type CatalogResponse = { revision: number | null; items: CommerceItem[] };

function money(value: number | null | undefined) {
  return value == null ? null : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function startingPrice(item: CommerceItem) {
  const prices = [item.price, ...item.variations.map((variation) => variation.price)].filter((value): value is number => value != null);
  return prices.length ? Math.min(...prices) : null;
}

function OfferCard({ item }: { item: CommerceItem }) {
  const price = startingPrice(item);
  const Icon = item.itemType === "supply" ? Box : item.itemType === "package" ? PackageCheck : Sparkles;
  return (
    <Card className="border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="rounded-xl bg-orange-50 p-2 text-orange-600"><Icon className="h-5 w-5" /></span>
          <Badge variant="outline" className="capitalize">{item.purchaseMode === "direct" ? "Book or buy" : "Custom quote"}</Badge>
        </div>
        <CardTitle className="text-xl text-slate-900">{item.name}</CardTitle>
        <CardDescription className="line-clamp-3 min-h-[3.75rem]">{item.description || "Professional JC ON THE MOVE service."}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-baseline gap-2">
          <span className="text-2xl font-black text-slate-950">{price == null ? "Quoted" : money(price)}</span>
          {price != null && <span className="text-sm text-slate-500">from</span>}
        </div>
        <Link href={`/offers/${item.code}`}>
          <Button className="w-full bg-orange-600 hover:bg-orange-700">View options</Button>
        </Link>
      </CardContent>
    </Card>
  );
}

function OfferDetail({ item, revision }: { item: CommerceItem; revision: number }) {
  const { toast } = useToast();
  const availableVariations = item.variations.filter((variation) => variation.active && variation.publicVisible && variation.price != null);
  const [variationCode, setVariationCode] = useState(availableVariations[0]?.code || "");
  const [quantity, setQuantity] = useState(1);
  const [paymentChoice, setPaymentChoice] = useState<"deposit" | "full">(item.itemType === "supply" ? "full" : "deposit");
  const [promoCode, setPromoCode] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", serviceAddress: "", serviceDate: "", scopeNotes: "" });

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/catalog/checkout", {
        offerCode: item.code,
        variationCode: variationCode || null,
        quantity,
        paymentChoice,
        promoCode: promoCode.trim() || null,
        customer: { firstName: form.firstName, lastName: form.lastName, email: form.email, phone: form.phone || null },
        serviceAddress: form.serviceAddress || null,
        serviceDate: form.serviceDate || null,
        scopeNotes: form.scopeNotes || null,
        termsVersion: COMMERCE_TERMS_VERSION,
        acceptedTerms: accepted,
        idempotencyKey: crypto.randomUUID(),
      });
      return response.json();
    },
    onSuccess: (result) => {
      sessionStorage.setItem(`jc-checkout-${result.checkoutId}`, result.accessToken || "");
      if (result.invoiceUrl) window.location.assign(result.invoiceUrl);
      else toast({ title: "Checkout created", description: "We created your request and will follow up shortly." });
    },
    onError: (error: Error) => toast({ title: "Checkout could not be created", description: error.message, variant: "destructive" }),
  });

  if (item.purchaseMode !== "direct") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/offers"><Button variant="ghost" className="mb-5"><ArrowLeft className="mr-2 h-4 w-4" />All offers</Button></Link>
        <Card>
          <CardHeader><Badge className="mb-3 w-fit bg-blue-100 text-blue-800 hover:bg-blue-100">Custom quote</Badge><CardTitle className="text-3xl">{item.name}</CardTitle><CardDescription className="text-base">{item.description}</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            {item.variations.length > 0 && <div className="grid gap-2 sm:grid-cols-2">{item.variations.map((variation) => <div key={variation.code} className="rounded-lg border p-3"><p className="font-semibold">{variation.name}</p><p className="text-sm text-slate-500">{variation.price == null ? "Priced with your quote" : `${money(variation.price)} / ${variation.unit}`}</p></div>)}</div>}
            <Link href={`/book?service=${encodeURIComponent(item.sourceServiceCode || item.code)}&offer=${encodeURIComponent(item.code)}&revision=${revision}`}>
              <Button size="lg" className="w-full bg-orange-600 hover:bg-orange-700">Get my itemized quote</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selectedPrice = availableVariations.find((variation) => variation.code === variationCode)?.price ?? item.price;
  const needsServiceDetails = item.itemType !== "supply";
  const canSubmit = accepted && form.firstName && form.lastName && form.email && selectedPrice != null
    && (!needsServiceDetails || (form.serviceAddress && form.serviceDate));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <Link href="/offers"><Button variant="ghost" className="mb-5"><ArrowLeft className="mr-2 h-4 w-4" />All offers</Button></Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Card className="h-fit"><CardHeader><Badge className="mb-3 w-fit bg-orange-100 text-orange-800 hover:bg-orange-100">{item.itemType === "supply" ? "Packing supplies" : "Book online"}</Badge><CardTitle className="text-3xl">{item.name}</CardTitle><CardDescription className="text-base">{item.description}</CardDescription></CardHeader><CardContent><p className="text-3xl font-black">{selectedPrice == null ? "Select an option" : money(selectedPrice)}</p><p className="mt-2 text-sm text-slate-500">Catalog revision {revision}. Prices and discounts are verified by JC before Square creates the invoice.</p></CardContent></Card>
        <Card>
          <CardHeader><CardTitle>Customer and payment details</CardTitle><CardDescription>We confirm availability before the appointment is finalized.</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            {availableVariations.length > 0 && <div><Label>Option</Label><Select value={variationCode} onValueChange={setVariationCode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{availableVariations.map((variation) => <SelectItem key={variation.code} value={variation.code}>{variation.name} — {money(variation.price)}</SelectItem>)}</SelectContent></Select></div>}
            <div><Label htmlFor="quantity">Quantity</Label><Input id="quantity" type="number" min={1} max={100} value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} /></div>
            <div className="grid gap-4 sm:grid-cols-2"><div><Label>First name</Label><Input value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} /></div><div><Label>Last name</Label><Input value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} /></div></div>
            <div className="grid gap-4 sm:grid-cols-2"><div><Label>Email</Label><Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div><div><Label>Phone</Label><Input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div></div>
            {needsServiceDetails && <><div><Label>Service address</Label><Input value={form.serviceAddress} onChange={(event) => setForm({ ...form, serviceAddress: event.target.value })} /></div><div><Label>Requested date</Label><Input type="date" value={form.serviceDate} onChange={(event) => setForm({ ...form, serviceDate: event.target.value })} /></div></>}
            <div><Label>Notes</Label><Textarea value={form.scopeNotes} onChange={(event) => setForm({ ...form, scopeNotes: event.target.value })} placeholder="Inventory, access, stairs, delivery, or packing details" /></div>
            {item.itemType !== "supply" && <div><Label>Payment choice</Label><RadioGroup value={paymentChoice} onValueChange={(value) => setPaymentChoice(value as "deposit" | "full")} className="mt-2 grid gap-2 sm:grid-cols-2"><Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"><RadioGroupItem value="deposit" className="mt-1" /><span><strong className="block">30% deposit</strong><span className="text-xs text-slate-500">Confirm scheduling and pay the balance later.</span></span></Label><Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"><RadioGroupItem value="full" className="mt-1" /><span><strong className="block">Pay in full — 5% off</strong><span className="text-xs text-slate-500">Eligible services only; total percentage discounts cap at 15%.</span></span></Label></RadioGroup></div>}
            <div><Label>Promotion code</Label><Input value={promoCode} onChange={(event) => setPromoCode(event.target.value.toUpperCase())} placeholder="Optional" /></div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-slate-50 p-4 text-sm"><input type="checkbox" className="mt-1" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>I agree to the 30% deposit, $175 cancellation fee when more than 24 hours ahead, deposit retention within 24 hours, and one free job switch or reschedule with more than 24 hours’ notice.</span></label>
            <Button className="w-full bg-orange-600 hover:bg-orange-700" size="lg" disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShoppingCart className="mr-2 h-4 w-4" />}{item.itemType === "supply" ? "Create secure invoice" : paymentChoice === "deposit" ? "Create 30% deposit invoice" : "Create full-payment invoice"}</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function OffersPage() {
  const params = useParams<{ code?: string }>();
  const { data, isLoading } = useQuery<CatalogResponse>({ queryKey: ["/api/catalog/offers"] });
  const groups = useMemo(() => {
    const result = new Map<string, CommerceItem[]>();
    for (const item of data?.items || []) result.set(item.category, [...(result.get(item.category) || []), item]);
    return result;
  }, [data]);

  if (isLoading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-orange-600" /></div>;
  if (params.code) {
    const item = data?.items.find((candidate) => candidate.code === params.code);
    if (!item || !data?.revision) return <div className="mx-auto max-w-xl px-4 py-20 text-center"><h1 className="text-2xl font-bold">Offer unavailable</h1><p className="mt-2 text-slate-500">This offer is not part of the active catalog.</p><Link href="/offers"><Button className="mt-6">View all offers</Button></Link></div>;
    return <OfferDetail item={item} revision={data.revision} />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <section className="bg-slate-950 px-4 py-16 text-white"><div className="mx-auto max-w-6xl"><div className="mb-4 flex items-center gap-2 text-orange-400"><CheckCircle2 className="h-5 w-5" /><span className="font-semibold">JC-owned prices · Secure Square invoices</span></div><h1 className="max-w-3xl text-4xl font-black tracking-tight sm:text-5xl">Services, moving packages, and packing supplies in one place.</h1><p className="mt-5 max-w-2xl text-lg text-slate-300">Book a fixed offer, pay a 30% deposit, save 5% with eligible full prepayment, or request an itemized quote for variable work.</p></div></section>
      <main className="mx-auto max-w-6xl space-y-12 px-4 py-12">
        {!data?.revision && <Card className="border-amber-300 bg-amber-50"><CardContent className="flex gap-3 p-5"><CalendarDays className="h-6 w-6 text-amber-700" /><div><p className="font-semibold text-amber-950">Catalog publication is awaiting owner approval.</p><p className="text-sm text-amber-800">Please use the regular booking form while offers are being prepared.</p></div></CardContent></Card>}
        {Array.from(groups.entries()).map(([category, items]) => <section key={category}><h2 className="mb-5 text-2xl font-black capitalize text-slate-950">{category.replace(/_/g, " ")}</h2><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{items.map((item) => <OfferCard key={item.code} item={item} />)}</div></section>)}
      </main>
    </div>
  );
}

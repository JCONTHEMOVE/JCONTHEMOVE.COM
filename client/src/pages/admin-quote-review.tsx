import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import SmartBookingGuidanceCard from "@/components/SmartBookingGuidanceCard";
import {
  CheckCircle2, XCircle, Clock, Users, Home, MapPin, Calendar,
  Phone, Mail, MessageSquare, ChevronDown, ChevronUp, ArrowLeft, Sparkles, Send, Save
} from "lucide-react";
import { Link } from "wouter";

interface QuoteRevision {
  id: string;
  revision: number;
  status: "draft" | "approved" | "sent" | "superseded" | "void";
  pricingVersionCode?: string | null;
  subtotal: number;
  discountTotal: number;
  finalPreTaxTotal: number;
  customerTotal: number;
  notes?: string | null;
  pricingAdjustments?: {
    insideBubble?: boolean | null;
    farthestStopMiles?: number | null;
    geographicMultiplier?: number;
    geographicAmount?: number;
    weekend?: boolean;
    weekendMultiplier?: number;
    weekendAmount?: number;
    compoundedMultiplier?: number;
  };
  travelEligibility?: {
    status?: string;
    routeVerified?: boolean;
    oneWayMinutes?: number | null;
    oneWayMiles?: number | null;
    minimumPreTax?: number;
    minimumSatisfied?: boolean;
    requiresOwner?: boolean;
    reasons?: string[];
  };
  lineItems?: Array<{ id?: string; name: string; quantity: number; unitPrice: number; total: number }>;
}

interface ChatbotLead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  serviceType: string;
  fromAddress: string;
  toAddress?: string;
  propertySize?: string;
  moveDate?: string;
  basePrice?: string;
  totalPrice?: string;
  crewSize?: number;
  details?: string;
  createdAt: string;
  status: string;
  currentQuote?: QuoteRevision | null;
  quoteHistory?: QuoteRevision[];
}

interface ParsedDetails {
  _source?: string;
  answers?: Record<string, any>;
  estimatedQuote?: {
    crew: number;
    minHrs: number;
    maxHrs: number;
    minPrice: number;
    maxPrice: number;
    tokensEstimate: number;
    specialSurcharge: number;
  };
  bookingIntake?: {
    confidence?: "high" | "medium" | "low";
    missing?: string[];
    bookingQuoteRequest?: {
      items?: Array<{
        serviceCode?: string;
        details?: Record<string, any>;
      }>;
    };
  } | null;
  bookingEngineQuote?: {
    subtotal?: number;
    discountTotal?: number;
    finalTotal?: number;
    tokenEstimate?: number;
    bundleApplied?: {
      name?: string;
      code?: string;
      discountAmount?: number;
    } | null;
    items?: Array<{
      serviceCode?: string;
      serviceLabel?: string;
      lineSubtotal?: number;
      unitPrice?: number;
      quantity?: number;
      laborMeta?: {
        crewSize?: number;
        laborHours?: number;
        ratePerHour?: number;
      };
    }>;
  } | null;
}

function parseDetails(details?: string): ParsedDetails | null {
  if (!details) return null;
  try {
    return JSON.parse(details);
  } catch {
    return null;
  }
}

function AnswerTag({ label, value }: { label: string; value: string | string[] | undefined }) {
  if (!value || (Array.isArray(value) && value.length === 0)) return null;
  const display = Array.isArray(value) ? value.join(", ") : value;
  if (!display || display === "(none)") return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
      <span className="text-xs text-slate-200">{display}</span>
    </div>
  );
}

function formatMoney(value?: number) {
  if (!Number.isFinite(value)) return "TBD";
  return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function confidenceClass(confidence?: string) {
  if (confidence === "high") return "border-emerald-500/50 text-emerald-300 bg-emerald-950/30";
  if (confidence === "medium") return "border-amber-500/50 text-amber-300 bg-amber-950/30";
  return "border-slate-600 text-slate-300 bg-slate-800/60";
}

function LeadCard({ lead, onSave, onApprove, onSend, onDismiss }: {
  lead: ChatbotLead;
  onSave: (lead: ChatbotLead, data: { basePrice: string; totalPrice: string; quoteNotes: string }) => void;
  onApprove: (id: string, data: { basePrice: string; totalPrice: string; quoteNotes: string }) => void;
  onSend: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [basePrice, setBasePrice] = useState(String(lead.currentQuote?.subtotal ?? lead.basePrice ?? ""));
  const [totalPrice, setTotalPrice] = useState(String(lead.currentQuote?.finalPreTaxTotal ?? lead.totalPrice ?? ""));
  const [quoteNotes, setQuoteNotes] = useState(lead.currentQuote?.notes || "");

  const parsed = parseDetails(lead.details);
  const a = parsed?.answers || {};
  const q = parsed?.estimatedQuote;
  const engineQuote = parsed?.bookingEngineQuote || null;
  const bookingIntake = parsed?.bookingIntake || null;
  const engineItem = engineQuote?.items?.[0];
  const intakeItem = bookingIntake?.bookingQuoteRequest?.items?.[0];
  const guidanceAnswers = {
    ...a,
    serviceType: a.serviceType || lead.serviceType,
    serviceCode: intakeItem?.serviceCode || engineItem?.serviceCode,
    fromAddress: lead.fromAddress || a.serviceAddress || a.fromAddress,
    fromZip: a.fromZip,
    toAddress: lead.toAddress || a.toAddress,
    moveDate: a.moveDate || lead.moveDate,
    phone: lead.phone,
    email: lead.email,
  };
  const revision = lead.currentQuote;
  const adjustment = revision?.pricingAdjustments;
  const eligibility = revision?.travelEligibility;

  const createdAt = new Date(lead.createdAt);
  const hoursAgo = Math.round((Date.now() - createdAt.getTime()) / 3600000);
  const timeLabel = hoursAgo < 1 ? "just now" : hoursAgo < 24 ? `${hoursAgo}h ago` : `${Math.round(hoursAgo / 24)}d ago`;

  return (
    <Card className="bg-slate-900 border border-slate-700/60 overflow-hidden">
      <CardHeader className="px-4 pt-4 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base text-white">
                {lead.firstName} {lead.lastName}
              </CardTitle>
              <Badge variant="outline" className="text-[10px] border-teal-500/50 text-teal-400">
                🤖 Chatbot
              </Badge>
              {engineQuote && (
                <Badge variant="outline" className="text-[10px] border-blue-500/50 text-blue-300 bg-blue-950/30">
                  Booking engine {formatMoney(engineQuote.finalTotal)}
                </Badge>
              )}
              {revision && (
                <Badge variant="outline" className="text-[10px] border-violet-500/50 text-violet-300 bg-violet-950/30">
                  Revision {revision.revision} · {revision.status}
                </Badge>
              )}
              <span className="text-xs text-slate-500">{timeLabel}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
              <a href={`tel:${lead.phone}`} className="flex items-center gap-1 text-xs text-slate-400 hover:text-teal-400">
                <Phone className="h-3 w-3" />{lead.phone}
              </a>
              <a href={`mailto:${lead.email}`} className="flex items-center gap-1 text-xs text-slate-400 hover:text-teal-400">
                <Mail className="h-3 w-3" />{lead.email}
              </a>
            </div>
          </div>
          {q && (
            <div className="text-right shrink-0">
              <p className="text-lg font-bold text-white">${q.minPrice.toLocaleString()}–${q.maxPrice.toLocaleString()}</p>
              <p className="text-xs text-slate-400">{q.crew} movers · {q.minHrs}–{q.maxHrs} hrs</p>
            </div>
          )}
        </div>

        {/* Key info row */}
        <div className="flex flex-wrap gap-2 mt-2">
          {a.serviceType && (
            <span className="inline-flex items-center gap-1 text-xs bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-300">
              {a.serviceType}
            </span>
          )}
          {lead.propertySize && (
            <span className="inline-flex items-center gap-1 text-xs bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-300">
              <Home className="h-3 w-3 text-slate-400" />{lead.propertySize}
            </span>
          )}
          {a.fromZip && (
            <span className="inline-flex items-center gap-1 text-xs bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-300">
              <MapPin className="h-3 w-3 text-slate-400" />{a.fromZip}{a.toZip ? ` → ${a.toZip}` : ""}
            </span>
          )}
          {a.moveDate && (
            <span className="inline-flex items-center gap-1 text-xs bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-300">
              <Calendar className="h-3 w-3 text-slate-400" />{a.moveDate}
            </span>
          )}
        </div>

        <SmartBookingGuidanceCard
          answers={guidanceAnswers}
          serviceLabel={lead.serviceType}
          compact
          className="mt-3"
        />

        {revision && (
          <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950/60 p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div>
                <p className="text-xs font-semibold text-white">Authoritative quote calculation</p>
                <p className="text-[11px] text-slate-400">Pricing {revision.pricingVersionCode || "legacy"} · {revision.lineItems?.length || 0} line item(s)</p>
              </div>
              <p className="text-lg font-bold text-white">{formatMoney(revision.finalPreTaxTotal)}</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div><span className="text-slate-500 block">Bubble</span><span className="text-slate-200">{adjustment?.insideBubble == null ? "Unverified" : adjustment.insideBubble ? "Inside · 1.0×" : `Outside · ${adjustment.geographicMultiplier || 1.5}×`}</span></div>
              <div><span className="text-slate-500 block">Weekend</span><span className="text-slate-200">{adjustment?.weekend ? `${adjustment.weekendMultiplier || 1.15}× premium` : "No premium"}</span></div>
              <div><span className="text-slate-500 block">One-way route</span><span className="text-slate-200">{eligibility?.routeVerified ? `${eligibility.oneWayMinutes} min · ${eligibility.oneWayMiles} mi` : "Manual review"}</span></div>
              <div><span className="text-slate-500 block">$2,000 rule</span><span className={eligibility?.minimumSatisfied === false ? "text-amber-300" : "text-slate-200"}>{eligibility?.minimumSatisfied == null ? "Local / unverified" : eligibility.minimumSatisfied ? "Met" : "Owner exception"}</span></div>
            </div>
            {(adjustment?.geographicAmount || adjustment?.weekendAmount || revision.discountTotal > 0) && (
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-300">
                {!!adjustment?.geographicAmount && <span>Geographic: +{formatMoney(adjustment.geographicAmount)}</span>}
                {!!adjustment?.weekendAmount && <span>Weekend: +{formatMoney(adjustment.weekendAmount)}</span>}
                {revision.discountTotal > 0 && <span>Discounts: −{formatMoney(revision.discountTotal)}</span>}
              </div>
            )}
            {eligibility?.reasons?.length ? (
              <p className="mt-2 text-[11px] text-amber-200">{eligibility.reasons.join(" ")}</p>
            ) : null}
            {(lead.quoteHistory?.length || 0) > 1 && (
              <p className="mt-2 text-[11px] text-slate-500">{lead.quoteHistory?.length} immutable revisions in history</p>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="px-4 pb-4">
        {/* Expand / collapse full answers */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-teal-400 mb-3 transition-colors"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {expanded ? "Hide" : "Show"} full chatbot answers
        </button>

        {expanded && (
          <div className="space-y-3 mb-3">
            {engineQuote && (
              <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-3">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <p className="text-xs font-semibold text-blue-200">Booking engine quote</p>
                    <p className="text-[11px] text-blue-300/70">Canonical no-persist quote from /api/bookings/quote</p>
                  </div>
                  <Badge variant="outline" className={`text-[10px] ${confidenceClass(bookingIntake?.confidence)}`}>
                    {bookingIntake?.confidence || "unknown"} confidence
                  </Badge>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                  <AnswerTag label="Service Code" value={engineItem?.serviceCode || intakeItem?.serviceCode} />
                  <AnswerTag label="Line Label" value={engineItem?.serviceLabel} />
                  <AnswerTag label="Subtotal" value={formatMoney(engineQuote.subtotal)} />
                  <AnswerTag label="Final Total" value={formatMoney(engineQuote.finalTotal)} />
                  {Number(engineQuote.discountTotal || 0) > 0 && (
                    <AnswerTag label="Discount" value={formatMoney(engineQuote.discountTotal)} />
                  )}
                  {engineQuote.bundleApplied && (
                    <AnswerTag label="Bundle" value={engineQuote.bundleApplied.name || engineQuote.bundleApplied.code} />
                  )}
                  {Number(engineQuote.tokenEstimate || 0) > 0 && (
                    <AnswerTag label="JCMOVES Est." value={`${engineQuote.tokenEstimate?.toLocaleString()} tokens`} />
                  )}
                  {engineItem?.laborMeta && (
                    <AnswerTag
                      label="Labor"
                      value={`${engineItem.laborMeta.crewSize || "?"} crew x ${engineItem.laborMeta.laborHours || "?"} hrs`}
                    />
                  )}
                </div>
                {bookingIntake?.missing && bookingIntake.missing.length > 0 && (
                  <p className="text-[11px] text-amber-300 mt-2">
                    Missing intake fields: {bookingIntake.missing.join(", ")}
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 bg-slate-800/40 rounded-xl p-3 text-sm">
              <AnswerTag label="Origin Floor" value={a.originFloor} />
              <AnswerTag label="Origin Elevator" value={a.originElevator} />
              <AnswerTag label="Dest Floor" value={a.destFloor} />
              <AnswerTag label="Dest Elevator" value={a.destElevator} />
              <AnswerTag label="Parking Distance" value={a.parkingDistance} />
              <AnswerTag label="Boxes" value={a.boxCount} />
              <AnswerTag label="Packing Help" value={a.packingHelp} />
              <AnswerTag label="Truck" value={a.truckSituation} />
              <div className="col-span-2">
                <AnswerTag label="Furniture" value={a.furniture} />
              </div>
              <div className="col-span-2">
                <AnswerTag label="Special Items" value={a.specialItems} />
              </div>
              {a.notes && a.notes !== "(no additional notes)" && (
                <div className="col-span-2">
                  <AnswerTag label="Customer Notes" value={a.notes} />
                </div>
              )}
              {q?.specialSurcharge && q.specialSurcharge > 0 && (
                <div className="col-span-2">
                  <span className="text-[10px] text-orange-400 uppercase tracking-wide">Specialty Surcharge</span>
                  <p className="text-xs text-orange-300">${q.specialSurcharge} (piano / pool table / safe / hot tub)</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setApproveOpen(true)}
            size="sm"
            variant="outline"
            className="flex-1 border-slate-600 text-slate-200"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {revision?.status === "approved" || revision?.status === "sent" ? "Edit as New Revision" : "Edit Draft"}
          </Button>
          {revision?.status === "draft" && (
            <Button
              onClick={() => onApprove(lead.id, { basePrice, totalPrice, quoteNotes })}
              size="sm"
              className="flex-1 bg-green-600 hover:bg-green-500 text-white font-semibold"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Approve
            </Button>
          )}
          {(revision?.status === "approved" || revision?.status === "sent") && (
            <Button onClick={() => onSend(lead.id)} size="sm" className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold">
              <Send className="h-3.5 w-3.5 mr-1.5" />{revision.status === "sent" ? "Re-send" : "Send"}
            </Button>
          )}
          <Button
            onClick={() => onDismiss(lead.id)}
            size="sm"
            variant="outline"
            className="border-slate-600 text-slate-400 hover:bg-red-900/30 hover:border-red-500/50 hover:text-red-400"
          >
            <XCircle className="h-3.5 w-3.5 mr-1" />
            Dismiss
          </Button>
        </div>
      </CardContent>

      {/* Approve dialog */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Quote Draft — {lead.firstName} {lead.lastName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {q && (
              <div className="bg-slate-800/60 rounded-lg p-3 text-sm text-slate-300 space-y-1">
                <p>Chatbot estimate: <strong className="text-white">${q.minPrice}–${q.maxPrice}</strong></p>
                <p>Crew: <strong className="text-white">{q.crew} movers · {q.minHrs}–{q.maxHrs} hrs</strong></p>
              </div>
            )}
            <div>
              <label className="text-xs text-slate-400 block mb-1">Pre-adjustment service subtotal</label>
              <Input
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                placeholder="e.g. 450"
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Final pre-tax target</label>
              <Input
                value={totalPrice}
                onChange={(e) => setTotalPrice(e.target.value)}
                placeholder="e.g. 650"
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Internal quote / override notes</label>
              <Textarea
                value={quoteNotes}
                onChange={(e) => setQuoteNotes(e.target.value)}
                placeholder="Any notes to include with the quote…"
                className="bg-slate-800 border-slate-700 text-white resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)} className="border-slate-600 text-slate-400">Cancel</Button>
            <Button
              onClick={() => {
                onSave(lead, { basePrice, totalPrice, quoteNotes });
                setApproveOpen(false);
              }}
              className="bg-blue-600 hover:bg-blue-500 text-white"
            >
              Save Draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function AdminQuoteReviewPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: leads = [], isLoading } = useQuery<ChatbotLead[]>({
    queryKey: ["/api/admin/chatbot-quotes"],
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) =>
      apiRequest("PATCH", `/api/admin/chatbot-quotes/${id}/approve`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chatbot-quotes"] });
      toast({ title: "✅ Quote approved", description: "Lead moved to the active pipeline." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: async ({ lead, data }: { lead: ChatbotLead; data: { basePrice: string; totalPrice: string; quoteNotes: string } }) => {
      const base = Math.max(0, Number(data.basePrice) || 0);
      const target = Math.max(0, Number(data.totalPrice) || base);
      const multiplier = Number(lead.currentQuote?.pricingAdjustments?.compoundedMultiplier || 1);
      const payload = {
        lineItems: [{ name: lead.serviceType || "Service", quantity: 1, unitPrice: base, total: base, discountEligible: true }],
        discountTotal: Math.max(0, base * multiplier - target),
        notes: data.quoteNotes || null,
        serviceDate: lead.moveDate || null,
      };
      return lead.currentQuote
        ? apiRequest("PATCH", `/api/quotes/${lead.currentQuote.id}`, payload)
        : apiRequest("POST", `/api/leads/${lead.id}/quotes/draft`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chatbot-quotes"] });
      toast({ title: "Draft saved", description: "The server recalculated pricing and travel eligibility." });
    },
    onError: (e: any) => toast({ title: "Unable to save draft", description: e.message, variant: "destructive" }),
  });

  const sendMutation = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/leads/${id}/send-quote`, {})).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chatbot-quotes"] });
      toast({ title: "Quote sent", description: "The approved revision and refreshed payment link were sent to the customer." });
    },
    onError: (e: any) => toast({ title: "Unable to send quote", description: e.message, variant: "destructive" }),
  });

  const dismissMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("PATCH", `/api/admin/chatbot-quotes/${id}/dismiss`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chatbot-quotes"] });
      toast({ title: "Dismissed", description: "Quote removed from review queue." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reviewLeads = leads.filter((lead) => lead.currentQuote && ["draft", "approved", "sent"].includes(lead.currentQuote.status));
  const pendingLeads = reviewLeads.filter((lead) => lead.currentQuote?.status !== "sent");

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/in-god-we-trust">
            <button className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
              <ArrowLeft className="h-4 w-4" /> Admin Hub
            </button>
          </Link>
        </div>

        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-xl bg-gradient-to-br from-teal-500 to-blue-600">
            <MessageSquare className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Chatbot Quote Review</h1>
            <p className="text-sm text-slate-400">Review and approve quotes submitted by customers via the booking chatbot.</p>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 mb-6 mt-4">
          <div className="flex items-center gap-2 bg-slate-800/60 border border-slate-700/60 rounded-xl px-4 py-2.5">
            <Clock className="h-4 w-4 text-yellow-400" />
            <span className="text-sm font-semibold text-white">{pendingLeads.length}</span>
            <span className="text-xs text-slate-400">pending review</span>
          </div>
          <p className="text-xs text-slate-500">
            Approving a quote moves it into the active job pipeline where you can set a final price and send it to the customer.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-32 bg-slate-800/40 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : reviewLeads.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-full bg-teal-500/10 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="h-8 w-8 text-teal-400" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">All caught up!</h3>
            <p className="text-slate-400 text-sm max-w-sm mx-auto">
              No chatbot quote submissions are pending review right now. New submissions will appear here automatically.
            </p>
            <Link href="/dashboard">
              <Button variant="outline" size="sm" className="mt-4 border-slate-600 text-slate-400">
                Go to Job Dashboard
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {reviewLeads.map(lead => (
              <LeadCard
                key={lead.id}
                lead={lead}
                onSave={(selectedLead, data) => saveMutation.mutate({ lead: selectedLead, data })}
                onApprove={(id, data) => approveMutation.mutate({ id, data })}
                onSend={(id) => sendMutation.mutate(id)}
                onDismiss={(id) => dismissMutation.mutate(id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  MapPin, Calendar, Loader2, Phone, Mail, Users, DollarSign, Bitcoin,
  CheckCircle2, Clock, Send, Star, ArrowLeftRight, ChevronLeft, ChevronRight, CalendarDays,
  Coins, Search, Truck, Minus, Plus, RefreshCw, Receipt, UserCheck,
  UserX, XCircle, Check, X, Image, ExternalLink, EyeOff
} from "lucide-react";
import type { User } from "@shared/schema";
import type { JobFlow } from "@shared/job-flow";
import { PaymentStatusPill } from "@/components/PaymentStatusPill";
import JobLifecycleRail from "@/components/JobLifecycleRail";
import { extractCustomerMediaLink } from "@/lib/lead-details";
import { ScheduleRequestQueue } from "@/components/schedule-request-queue";

const SERVICE_ICONS: Record<string, string> = {
  residential: "🚛", commercial: "🏢", junk: "🗑️", snow: "❄️",
  cleaning: "✨", handyman: "🔧", demolition: "⚒️", flooring: "🪵",
  painting: "🎨", moving: "🚛", labor: "💪",
};

const SERVICE_LABELS: Record<string, string> = {
  residential: "Residential Move", commercial: "Commercial Move", junk: "Junk Removal",
  snow: "Snow Removal", cleaning: "Cleaning", handyman: "Handyman", demolition: "Demolition",
  flooring: "Flooring", painting: "Painting", moving: "Moving", labor: "Labor",
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  quote_requested: { label: "Quote Req.", color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" },
  chatbot_pending: { label: "Chatbot", color: "bg-teal-500/20 text-teal-300 border-teal-500/30" },
  available: { label: "Confirmed", color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  in_progress: { label: "In Progress", color: "bg-purple-500/20 text-purple-300 border-purple-500/30" },
  completed: { label: "Completed", color: "bg-green-500/20 text-green-300 border-green-500/30" },
  cancelled: { label: "Cancelled", color: "bg-red-500/20 text-red-300 border-red-500/30" },
};

function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return "TBD";
  try {
    const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch { return dateStr; }
}

function formatDateInput(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const raw = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

type JobCalendarView = "list" | "month" | "week" | "day";

const CALENDAR_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const JOB_VIEW_OPTIONS: ReadonlyArray<{ value: JobCalendarView; label: string }> = [
  { value: "list", label: "List" },
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
];

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getWeekDays(anchor: Date): Date[] {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function getMonthDays(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

type Lead = {
  id: string;
  orderNumber?: number | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  serviceType: string;
  fromAddress: string;
  toAddress?: string;
  moveDate?: string;
  confirmedDate?: string;
  arrivalWindow?: string;
  crewSize?: number;
  truckProvider?: string | null;
  truckSize?: string | null;
  status: string;
  basePrice?: string;
  totalPrice?: string;
  depositRequired?: boolean;
  depositAmount?: string;
  depositPaid?: boolean;
  isQuoteOnly?: boolean;
  confirmedHours?: number;
  crewMembers?: string[];
  crewBonusFlags?: Record<string, boolean>;
  hasHotTub?: boolean;
  hasPiano?: boolean;
  hasHeavySafe?: boolean;
  hasPoolTable?: boolean;
  squarePaymentUrl?: string;
  details?: string;
  quoteNotes?: string;
  dispatchNotes?: string;
  source?: string | null;
  promoCode?: string | null;
  quoteSnapshot?: LeadQuoteSnapshot | null;
  zoneSnapshot?: { preview?: { matched?: boolean; quote?: { minEstimate?: number; maxEstimate?: number; rate?: { hourlyRate?: number; minimumHours?: number } | null } } } | null;
  attribution?: {
    attributionType: string;
    promoCode: string | null;
    referralSlug: string | null;
    repName: string | null;
    source: string | null;
    marketingCampaignId?: string | null;
    utmCampaign?: string | null;
    utmSource?: string | null;
    createdAt: string;
  } | null;
  photos?: Array<{ url?: string; mimeType?: string; name?: string; source?: string; timestamp?: string }>;
  reviewToken?: string;
  archivedAt?: string | null;
  flow?: JobFlow;
};

function leadCalendarDate(lead: Lead): Date | null {
  const raw = String(lead.confirmedDate || lead.moveDate || "").trim().slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
    ? parsed
    : null;
}

type LeadQuoteSnapshot = {
  source?: string;
  promoCode?: string | null;
  referralSlug?: string | null;
  marketingCampaignId?: string | null;
  attribution?: {
    source?: string | null;
    promoCode?: string | null;
    referralSlug?: string | null;
    marketingCampaignId?: string | null;
    marketingTracking?: {
      utmSource?: string | null;
      utmCampaign?: string | null;
    };
  };
  marketplaceShapeId?: string;
  marketplaceShape?: {
    id?: string;
    shape?: string;
    customer?: string;
    worker?: string;
    company?: string;
  };
  requestedItems?: Array<{
    serviceCode?: string;
    serviceLabel?: string;
    quantity?: number;
    priceMode?: string;
    unitPrice?: number | string;
    details?: Record<string, unknown> | null;
    priceMenuTaskId?: string | null;
    priceMenuCategory?: string | null;
    priceMenuRange?: string | null;
    priceMenuUnit?: string | null;
    priceMenuCustomerNeeds?: string[] | null;
    priceMenuOperationsSignal?: string | null;
    priceMenuSourceSignal?: string | null;
  }>;
};

type EnrichedTradeRequest = {
  id: string;
  leadId: string;
  requesterId: string;
  targetId: string;
  status: string;
  requesterNote: string | null;
  adminNote: string | null;
  requester: { id: string; firstName: string | null; lastName: string | null } | null;
  target: { id: string; firstName: string | null; lastName: string | null } | null;
  job: { id: string; firstName: string; lastName: string; serviceType: string } | null;
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || { label: status, color: "bg-slate-700/50 text-slate-400" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function extractCity(address: string | null | undefined): string {
  if (!address) return "";
  const parts = address.split(",").map(s => s.trim());
  return parts[1] || parts[0] || "";
}

function isQuickRequestLead(lead: Lead): boolean {
  return lead.source === "quick_request" || (lead.details || "").includes("[QUICK REQUEST");
}

function leadPhotoCount(lead: Lead): number {
  return Array.isArray(lead.photos) ? lead.photos.length : 0;
}

function numericPrice(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function AdminJobCard({ lead, onClick, employees }: {
  lead: Lead;
  onClick: () => void;
  employees: User[];
}) {
  const effectiveDate = lead.confirmedDate || lead.moveDate;
  const crewMembers = Array.isArray(lead.crewMembers) ? lead.crewMembers : [];
  const crewSlotsFilled = crewMembers.length;
  const crewSlotsNeeded = lead.crewSize || 2;
  const crewFull = crewSlotsFilled >= crewSlotsNeeded;

  const crewNames = crewMembers
    .map(id => employees.find(e => e.id === id))
    .filter(Boolean)
    .map(e => `${(e as User).firstName || ""}`.trim())
    .slice(0, 3);

  const city = extractCity(lead.fromAddress);
  const hasPremiums = lead.hasHotTub || lead.hasPiano || lead.hasHeavySafe || lead.hasPoolTable;
  const quickRequest = isQuickRequestLead(lead);
  const photoCount = leadPhotoCount(lead);
  const customerMediaLink = extractCustomerMediaLink(lead.details);

  return (
    <Card
      className="bg-slate-800/40 border border-slate-700/50 hover:border-blue-500/40 transition-all cursor-pointer active:scale-[0.99]"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="text-2xl leading-none mt-0.5 flex-shrink-0">
            {SERVICE_ICONS[lead.serviceType] || "📦"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-white text-sm truncate">{lead.firstName} {lead.lastName}</p>
                  <StatusBadge status={lead.status} />
                  {lead.flow && <span className="rounded-full border border-blue-400/25 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-200">{lead.flow.operations?.label || lead.flow.label}</span>}
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                  <p className="text-xs text-slate-400">{SERVICE_LABELS[lead.serviceType] || lead.serviceType}</p>
                  {quickRequest && (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-full px-2 py-0.5">
                      Quick request
                    </span>
                  )}
                  {city && (
                    <span className="text-xs text-slate-500 flex items-center gap-0.5">
                      <MapPin className="h-3 w-3" />{city}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                {lead.totalPrice ? (
                  <p className="font-black text-green-400 text-sm">${parseFloat(lead.totalPrice).toLocaleString()}</p>
                ) : lead.basePrice ? (
                  <p className="font-bold text-slate-300 text-sm">${parseFloat(lead.basePrice).toLocaleString()}</p>
                ) : (
                  <p className="text-xs text-slate-600">No quote</p>
                )}
                {lead.depositRequired && (
                  <span className={`text-[10px] flex items-center gap-0.5 justify-end mt-0.5 ${lead.depositPaid ? "text-green-400" : "text-yellow-400"}`}>
                    {lead.depositPaid ? <Check className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                    Deposit {lead.depositPaid ? "paid" : "due"}
                  </span>
                )}
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {lead.phone && (
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Phone className="h-3 w-3 text-slate-500" />
                  {lead.phone}
                </span>
              )}
              {effectiveDate && (
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-slate-500" />
                  {formatDateShort(effectiveDate)}
                </span>
              )}
              <span className={`text-xs flex items-center gap-1 ${crewFull ? "text-green-400" : "text-yellow-400"}`}>
                <Users className="h-3 w-3" />
                {crewSlotsFilled}/{crewSlotsNeeded}
                {crewFull ? " full" : " open"}
              </span>
              {photoCount > 0 && (
                <span className="text-xs text-blue-300 flex items-center gap-1">
                  <Image className="h-3 w-3" />
                  {photoCount} photo{photoCount === 1 ? "" : "s"}
                </span>
              )}
              {customerMediaLink && (
                <span className="text-xs text-blue-300 flex items-center gap-1">
                  <ExternalLink className="h-3 w-3" />
                  Media link
                </span>
              )}
            </div>
            {hasPremiums && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {lead.hasHotTub && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300">🛁 Hot Tub</span>}
                {lead.hasPiano && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300">🎹 Piano</span>}
                {lead.hasHeavySafe && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300">🔒 Safe</span>}
                {lead.hasPoolTable && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300">🎱 Pool Table</span>}
              </div>
            )}
          </div>
          <ChevronRight className="h-4 w-4 text-slate-600 flex-shrink-0 mt-1" />
        </div>
      </CardContent>
    </Card>
  );
}

function CalendarJobChip({ lead, onOpen, compact = false }: {
  lead: Lead;
  onOpen: (lead: Lead) => void;
  compact?: boolean;
}) {
  const price = lead.totalPrice || lead.basePrice;
  const crewSlots = lead.crewSize || 2;
  const crewFilled = Array.isArray(lead.crewMembers) ? lead.crewMembers.length : 0;
  const crewLabel = `${crewFilled}/${crewSlots} crew`;

  return (
    <button
      type="button"
      onClick={() => onOpen(lead)}
      className={`w-full rounded-lg border border-slate-700/70 bg-slate-900/80 text-left transition-colors hover:border-blue-400/60 hover:bg-slate-800 ${compact ? "px-2 py-1.5" : "px-3 py-2.5"}`}
      data-testid={`button-calendar-job-${lead.id}`}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className={compact ? "text-base leading-none" : "text-xl leading-none"}>{SERVICE_ICONS[lead.serviceType] || "📦"}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-semibold text-white ${compact ? "text-[11px]" : "text-sm"}`}>
            {lead.firstName} {lead.lastName}
          </span>
          <span className={`mt-0.5 block truncate text-slate-400 ${compact ? "text-[10px]" : "text-xs"}`}>
            {lead.arrivalWindow || "Time TBD"} · {SERVICE_LABELS[lead.serviceType] || lead.serviceType}
          </span>
        </span>
        {price && (
          <span className={`shrink-0 font-bold text-emerald-300 ${compact ? "text-[10px]" : "text-xs"}`}>
            ${Number(price).toLocaleString()}
          </span>
        )}
      </div>
      {!compact && (
        <span className={`mt-2 flex items-center gap-1 text-[11px] ${crewFilled >= crewSlots ? "text-emerald-300" : "text-amber-300"}`}>
          <Users className="h-3 w-3" /> {crewLabel}
        </span>
      )}
    </button>
  );
}

function POSRow({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-800/60 last:border-0">
      <span className="text-xs text-slate-500 uppercase tracking-wide">{label}</span>
      <span className={`text-sm font-semibold ${accent ? "text-green-400" : "text-white"}`}>{value}</span>
    </div>
  );
}

function AdminJobDetailPanel({ lead, onClose, employees, tradeRequests, open }: {
  lead: Lead | null;
  onClose: () => void;
  employees: User[];
  tradeRequests: EnrichedTradeRequest[];
  open: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [basePrice, setBasePrice] = useState("");
  const [totalPrice, setTotalPrice] = useState("");
  const [quoteNote, setQuoteNote] = useState("");
  const [btcAmount, setBtcAmount] = useState("");
  const [btcLink, setBtcLink] = useState<string | null>(null);
  const [tradeNote, setTradeNote] = useState<Record<string, string>>({});
  const [overrideReason, setOverrideReason] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleWindow, setScheduleWindow] = useState("Morning");
  const [scheduleCrewSize, setScheduleCrewSize] = useState("2");
  const [scheduleHours, setScheduleHours] = useState("3");

  const jobTradeRequests = tradeRequests.filter(r => r.leadId === lead?.id && r.status === "pending");

  useEffect(() => {
    if (!lead || !open) return;
    setBasePrice(lead.basePrice || "");
    setTotalPrice(lead.totalPrice || "");
    setQuoteNote(lead.quoteNotes || "");
    setBtcAmount("");
    setBtcLink(null);
    setOverrideReason("");
    setTradeNote({});
    setDeleteConfirmOpen(false);
    setScheduleDate(formatDateInput(lead.confirmedDate || lead.moveDate));
    setScheduleWindow(lead.arrivalWindow || "Morning");
    setScheduleCrewSize(String(lead.crewSize || 2));
    setScheduleHours(String(lead.confirmedHours || 3));
  }, [lead?.id, open]);

  type PaymentPanel = {
    status: { key: string; label: string; color: "green" | "yellow" | "blue" | "gray" } | null;
    lead: { dispatch_override_reason: string | null } | null;
    invoices: Array<{
      id: string; square_invoice_id: string | null; status: string | null;
      amount: string | number | null; sent_at: string | null; paid_at: string | null;
      public_url: string | null;
    }>;
    btcPayments: Array<{
      id: string; btc_amount: string | number | null; usd_amount: string | number | null;
      tx_hash: string | null; status: string | null; verified_at: string | null; created_at: string;
    }>;
    walletEntries: Array<{
      id: string; kind: string; amount_usd: string | number | null;
      balance_after: string | number | null; note: string | null; created_at: string;
    }>;
  };

  const paymentPanelKey = ["/api/admin/leads", lead?.id, "payment-panel"] as const;

  const { data: panel, isLoading: panelLoading } = useQuery<PaymentPanel>({
    queryKey: paymentPanelKey,
    enabled: !!lead?.id && open,
    refetchInterval: open ? 30_000 : false,
  });

  const crewMembersArr = Array.isArray(lead?.crewMembers) ? lead!.crewMembers! : [];
  const crewEmployees = crewMembersArr
    .map(id => employees.find(e => e.id === id))
    .filter(Boolean) as User[];

  const availableToAdd = employees.filter(
    e => !crewMembersArr.includes(e.id) && (e.status === "approved" || e.role === "admin")
  );

  const savePriceMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/leads/${lead!.id}/quote`, {
        ...(basePrice ? { basePrice } : {}),
        ...(totalPrice ? { totalPrice } : {}),
        ...(quoteNote ? { quoteNotes: quoteNote } : {}),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Saved", description: "Quote updated." });
    },
    onError: () => toast({ title: "Error", description: "Could not save.", variant: "destructive" }),
  });

  const sendInvoiceMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(totalPrice || lead?.totalPrice || "0");
      if (!amount) throw new Error("No price set");
      const res = await apiRequest("POST", `/api/invoices/lead/${lead!.id}`, {
        amount,
        description: `${lead!.serviceType} — ${lead!.firstName} ${lead!.lastName}`,
        deliveryMethod: "email",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Failed to send invoice");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Invoice sent!", description: "Square invoice sent to customer." });
    },
    onError: (e: Error) => toast({ title: "Invoice failed", description: e.message, variant: "destructive" }),
  });

  const generateBtcMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(btcAmount || totalPrice || lead?.totalPrice || "0");
      if (!amount) throw new Error("No amount set");
      const res = await apiRequest("POST", `/api/crypto/lightning/job-checkout/${lead!.id}`, {
        referenceType: "job_payment",
        referenceId: lead!.id,
        customerName: `${lead!.firstName} ${lead!.lastName}`,
        customerEmail: lead!.email,
        customerPhone: lead!.phone,
        originalAmountUsd: amount,
        notes: `Moving job — ${lead!.firstName} ${lead!.lastName}`,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Failed to generate Lightning checkout");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setBtcLink(data.paymentUrl || data.checkoutUrl || null);
      toast({ title: "Lightning checkout ready", description: "5% discount and 5% JCMOVES offer applied." });
    },
    onError: (e: Error) => toast({ title: "Lightning checkout failed", description: e.message, variant: "destructive" }),
  });

  const markDepositMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/leads/${lead!.id}/mark-deposit-received`, {});
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Deposit marked paid" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const addCrewMutation = useMutation({
    mutationFn: async (userId: string) => {
      const newCrew = [...crewMembersArr, userId];
      const res = await apiRequest("PATCH", `/api/leads/${lead!.id}/quote`, { crewMembers: newCrew });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Crew updated" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const removeCrewMutation = useMutation({
    mutationFn: async (userId: string) => {
      const newCrew = crewMembersArr.filter(id => id !== userId);
      const res = await apiRequest("PATCH", `/api/leads/${lead!.id}/quote`, { crewMembers: newCrew });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Crew updated" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const reviewTradeMutation = useMutation({
    mutationFn: async ({ tradeId, status }: { tradeId: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/trade-requests/${tradeId}/review`, {
        status,
        adminNote: tradeNote[tradeId] || undefined,
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trade-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: status === "approved" ? "Trade approved" : "Trade denied" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const overrideMutation = useMutation({
    mutationFn: async () => {
      const reason = overrideReason.trim();
      if (!reason) throw new Error("Reason required");
      const res = await apiRequest("POST", `/api/admin/leads/${lead!.id}/dispatch-override`, { reason });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setOverrideReason("");
      queryClient.invalidateQueries({ queryKey: paymentPanelKey });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payment-status", lead!.id] });
      toast({ title: "Override applied", description: "Deposit gate is now overridden." });
    },
    onError: (e: Error) => toast({ title: "Override failed", description: e.message, variant: "destructive" }),
  });

  const clearOverrideMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/leads/${lead!.id}/dispatch-override/clear`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: paymentPanelKey });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payment-status", lead!.id] });
      toast({ title: "Override cleared", description: "Deposit gate re-enabled." });
    },
    onError: (e: Error) => toast({ title: "Clear failed", description: e.message, variant: "destructive" }),
  });

  const sendReviewLinkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/leads/${lead!.id}/request-review`, {});
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => toast({ title: "Review link sent", description: "Customer will receive the review link." }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const archiveLeadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/leads/${lead!.id}`);
      if (!res.ok) throw new Error("Failed to delete lead");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/archived"] });
      setDeleteConfirmOpen(false);
      toast({
        title: "Job archived",
        description: `${lead?.firstName || "Lead"} ${lead?.lastName || ""}`.trim() + " was removed from active jobs.",
      });
      onClose();
    },
    onError: (e: Error) => {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    },
  });

  const scheduleJobMutation = useMutation({
    mutationFn: async () => {
      if (!lead) throw new Error("No lead selected");
      const status = String(lead.status || "").toLowerCase();
      const canConvert = new Set(["new", "quote_requested", "contacted", "quoted", "chatbot_pending"]).has(status);
      const confirmedDate = scheduleDate.trim();
      const crewSize = Math.max(1, Math.min(12, Number(scheduleCrewSize) || Number(lead.crewSize) || 2));
      const confirmedHours = Math.max(0.5, Math.min(24, Number(scheduleHours) || Number(lead.confirmedHours) || 3));
      const base = numericPrice(basePrice || lead.basePrice || totalPrice || lead.totalPrice);
      const total = numericPrice(totalPrice || lead.totalPrice || basePrice || lead.basePrice);

      if (!confirmedDate) throw new Error("Pick a date first");
      if (base <= 0) throw new Error("Set a price before adding this to the calendar");

      const payload = {
        basePrice: base,
        totalPrice: total > 0 ? total : base,
        confirmedDate,
        arrivalWindow: scheduleWindow.trim() || undefined,
        crewSize,
        confirmedHours,
        crewMembers: crewMembersArr,
        confirmedFromAddress: lead.fromAddress || undefined,
        confirmedToAddress: lead.toAddress || undefined,
        quoteNotes: quoteNote.trim() || undefined,
      };

      const res = canConvert
        ? await apiRequest("POST", `/api/leads/${lead.id}/convert-to-job`, payload)
        : await apiRequest("PATCH", `/api/leads/${lead.id}`, payload);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to schedule job" }));
        throw new Error(err.error || "Failed to schedule job");
      }
      return res.json();
    },
    onSuccess: (updatedLead: Lead) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/available"] });
      toast({
        title: "Calendar updated",
        description: `${updatedLead.firstName || "Job"} ${updatedLead.lastName || ""}`.trim() + " is ready for the crew board.",
      });
    },
    onError: (e: Error) => {
      toast({ title: "Calendar update failed", description: e.message, variant: "destructive" });
    },
  });

  if (!lead) return null;

  const effectiveDate = lead.confirmedDate || lead.moveDate;
  const displayPrice = totalPrice || lead.totalPrice;
  const displayBasePrice = basePrice || lead.basePrice;
  const quickRequest = isQuickRequestLead(lead);
  const photos = Array.isArray(lead.photos) ? lead.photos : [];
  const customerMediaLink = extractCustomerMediaLink(lead.details);
  const statusKey = String(lead.status || "").toLowerCase();
  const canConvertToCalendar = new Set(["new", "quote_requested", "contacted", "quoted", "chatbot_pending"]).has(statusKey);
  const savedZonePreview = lead.zoneSnapshot?.preview;
  const savedZoneQuote = savedZonePreview?.quote;
  const savedZoneEstimate = Number.isFinite(Number(savedZoneQuote?.minEstimate)) && Number.isFinite(Number(savedZoneQuote?.maxEstimate))
    ? `$${Math.round(Number(savedZoneQuote?.minEstimate))}–$${Math.round(Number(savedZoneQuote?.maxEstimate))}`
    : null;

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent
        side="right"
        className="bg-slate-900 border-l border-slate-700 text-white w-full sm:max-w-2xl overflow-y-auto"
      >
        <SheetHeader className="pb-4 border-b border-slate-700/60">
          <div className="flex items-start gap-3">
            <span className="text-3xl">{SERVICE_ICONS[lead.serviceType] || "📦"}</span>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-white text-lg leading-tight">
                {lead.firstName} {lead.lastName}
              </SheetTitle>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <StatusBadge status={lead.status} />
                <span className="text-xs text-slate-400">{SERVICE_LABELS[lead.serviceType] || lead.serviceType}</span>
                {quickRequest && (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-full px-2 py-0.5">
                    Quick request
                  </span>
                )}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setDeleteConfirmOpen(true)}
              className="h-9 w-9 flex-shrink-0 rounded-full border border-red-500/30 bg-red-950/20 text-red-300 hover:bg-red-500/20 hover:text-red-100"
              title="Remove from active jobs"
              aria-label="Remove from active jobs"
              data-testid={`button-delete-lead-${lead.id}`}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>

        <div className="pt-4 space-y-5 pb-8">
          <JobLifecycleRail lead={lead} />
          <div className="rounded-lg border border-slate-700/70 bg-slate-950/40 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              <EyeOff className="h-3.5 w-3.5" /> Private operator tip
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-300">
              Share only confirmed customer details, pricing, timing, and crew plans. Keep company strategy, sourcing, and campaign notes out of the job conversation.
            </p>
          </div>
          <div id="admin-job-calendar" className="scroll-mt-4 rounded-xl border border-blue-500/25 bg-blue-950/20 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-blue-200">
                <Calendar className="h-3.5 w-3.5" /> Quick calendar
              </p>
              <Badge className="border-blue-500/30 bg-blue-500/15 text-blue-200">
                {canConvertToCalendar ? "Request -> job" : "Calendar edit"}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] uppercase text-slate-500">Date</label>
                <Input
                  type="date"
                  value={scheduleDate}
                  onChange={e => setScheduleDate(e.target.value)}
                  className="mt-0.5 h-9 bg-slate-900/70 border-slate-700 text-white"
                  data-testid="input-admin-job-calendar-date"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">Window</label>
                <Input
                  value={scheduleWindow}
                  onChange={e => setScheduleWindow(e.target.value)}
                  placeholder="Morning"
                  className="mt-0.5 h-9 bg-slate-900/70 border-slate-700 text-white"
                  data-testid="input-admin-job-calendar-window"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">Crew</label>
                <Input
                  type="number"
                  min={1}
                  max={12}
                  value={scheduleCrewSize}
                  onChange={e => setScheduleCrewSize(e.target.value)}
                  className="mt-0.5 h-9 bg-slate-900/70 border-slate-700 text-white"
                  data-testid="input-admin-job-calendar-crew"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">Hours</label>
                <Input
                  type="number"
                  min={0.5}
                  max={24}
                  step={0.5}
                  value={scheduleHours}
                  onChange={e => setScheduleHours(e.target.value)}
                  className="mt-0.5 h-9 bg-slate-900/70 border-slate-700 text-white"
                  data-testid="input-admin-job-calendar-hours"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] uppercase text-slate-500">Price used</label>
                <Input
                  value={basePrice || totalPrice || ""}
                  onChange={e => {
                    setBasePrice(e.target.value);
                    if (!totalPrice) setTotalPrice(e.target.value);
                  }}
                  placeholder="400.00"
                  className="mt-0.5 h-9 bg-slate-900/70 border-slate-700 text-white font-bold"
                  data-testid="input-admin-job-calendar-price"
                />
              </div>
            </div>

            {(savedZoneEstimate || lead.truckProvider || lead.confirmedHours) && (
              <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/25 p-3 text-xs">
                <p className="mb-1 font-semibold uppercase tracking-wide text-slate-400">Saved staff intake</p>
                {savedZoneEstimate && <p className={lead.isQuoteOnly || !savedZonePreview?.matched ? "text-amber-300" : "text-emerald-300"}>Zone estimate: {savedZoneEstimate}{lead.isQuoteOnly || !savedZonePreview?.matched ? " · owner review" : ""}</p>}
                {savedZoneQuote?.rate && <p className="text-slate-300">Rate: ${savedZoneQuote.rate.hourlyRate}/hr · {savedZoneQuote.rate.minimumHours} hour minimum</p>}
                <p className="text-slate-300">Plan: {lead.confirmedHours || scheduleHours || "—"} hours · {lead.truckProvider === "jc_on_the_move" ? "JC ON THE MOVE truck" : lead.truckProvider === "rental_uhaul" ? "Rental / U-Haul" : lead.truckProvider === "customer" ? "Customer truck" : lead.truckProvider === "none" ? "No truck" : "Truck to confirm"}{lead.truckSize && lead.truckSize !== "none" ? ` · ${lead.truckSize.replace("_", " ")}` : ""}</p>
              </div>
            )}

            <Button
              type="button"
              onClick={() => scheduleJobMutation.mutate()}
              disabled={scheduleJobMutation.isPending}
              className="mt-3 w-full bg-blue-600 text-white hover:bg-blue-500"
              data-testid="button-admin-job-add-to-calendar"
            >
              {scheduleJobMutation.isPending
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Calendar className="mr-2 h-4 w-4" />}
              {canConvertToCalendar ? "Add to calendar and crew board" : "Update calendar"}
            </Button>
            <p className="mt-2 text-xs text-slate-400">
              Sets date, hours, crew, and price. Request cards become available jobs for dispatch.
            </p>
          </div>
          {/* Customer Info — POS Receipt Style */}
          <div id="admin-job-customer" className="scroll-mt-4 bg-slate-800/60 rounded-xl p-4">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-3 flex items-center gap-1.5">
              <Receipt className="h-3 w-3" /> Customer
            </p>
            <POSRow label="Name" value={`${lead.firstName} ${lead.lastName}`} />
            <POSRow label="Phone" value={
              <a href={`tel:${lead.phone}`} className="text-blue-400 hover:text-blue-300">{lead.phone}</a>
            } />
            <POSRow label="Email" value={lead.email ? <a href={`mailto:${lead.email}`} className="text-blue-400 hover:text-blue-300 truncate max-w-[180px] block">{lead.email}</a> : "Not provided"} />
            <POSRow label="Date" value={formatDateShort(effectiveDate)} />
            {lead.arrivalWindow && <POSRow label="Arrival" value={lead.arrivalWindow} />}
            {photos.length > 0 && <POSRow label="Photos" value={`${photos.length} attached`} />}
            {customerMediaLink && (
              <POSRow
                label="Media Link"
                value={
                  <a
                    href={customerMediaLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-300 hover:text-blue-200"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                }
              />
            )}
            {lead.fromAddress && <POSRow label="From" value={<span className="text-xs text-right max-w-[200px] block">{lead.fromAddress}</span>} />}
            {lead.toAddress && <POSRow label="To" value={<span className="text-xs text-right max-w-[200px] block">{lead.toAddress}</span>} />}
          </div>

          {/* Quote Block — POS style */}
          <div id="admin-job-quote" className="scroll-mt-4 bg-slate-800/60 rounded-xl p-4">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-3 flex items-center gap-1.5">
              <DollarSign className="h-3 w-3" /> Quote
            </p>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="text-[10px] text-slate-500 uppercase">Base Price</label>
                <Input
                  value={basePrice || lead.basePrice || ""}
                  onChange={e => setBasePrice(e.target.value)}
                  placeholder="0.00"
                  className="bg-slate-700/60 border-slate-600 text-white font-bold text-sm mt-0.5 h-9"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase">Total Price</label>
                <Input
                  value={totalPrice || lead.totalPrice || ""}
                  onChange={e => setTotalPrice(e.target.value)}
                  placeholder="0.00"
                  className="bg-slate-700/60 border-slate-600 text-white font-bold text-sm mt-0.5 h-9"
                />
              </div>
            </div>

            {(basePrice || totalPrice) && (
              <Button
                size="sm"
                onClick={() => savePriceMutation.mutate()}
                disabled={savePriceMutation.isPending}
                className="w-full bg-slate-700 hover:bg-slate-600 text-white text-xs mb-3"
              >
                {savePriceMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                Save Price
              </Button>
            )}

            {/* POS action buttons */}
            <div className="space-y-2">
              <Button
                size="sm"
                onClick={() => sendInvoiceMutation.mutate()}
                disabled={sendInvoiceMutation.isPending || (!displayPrice && !displayBasePrice)}
                className="w-full bg-green-700 hover:bg-green-600 text-white font-semibold text-xs"
              >
                {sendInvoiceMutation.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                  : <Receipt className="h-3.5 w-3.5 mr-2" />}
                Send Square Invoice
              </Button>

              <div className="flex gap-2">
                <Input
                  value={btcAmount}
                  onChange={e => setBtcAmount(e.target.value)}
                  placeholder="Saved job total"
                  className="bg-slate-700/60 border-slate-600 text-white text-xs h-8 flex-1"
                />
                <Button
                  size="sm"
                  onClick={() => generateBtcMutation.mutate()}
                  disabled={generateBtcMutation.isPending}
                  className="bg-orange-700 hover:bg-orange-600 text-white text-xs h-8 px-3 flex-shrink-0"
                >
                  {generateBtcMutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Bitcoin className="h-3.5 w-3.5" />}
                  Lightning
                </Button>
              </div>

              {btcLink && (
                <div className="bg-orange-950/40 border border-orange-500/30 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-orange-400 mb-1">Bitcoin Lightning checkout · 5% off + 5% JCMOVES:</p>
                  <a href={btcLink} target="_blank" rel="noopener noreferrer" className="text-xs text-orange-300 break-all hover:underline">{btcLink}</a>
                </div>
              )}

              {lead.depositRequired && (
                <Button
                  size="sm"
                  onClick={() => markDepositMutation.mutate()}
                  disabled={markDepositMutation.isPending || lead.depositPaid}
                  className={`w-full text-xs font-semibold ${lead.depositPaid ? "bg-green-800/40 text-green-400 cursor-default" : "bg-blue-700 hover:bg-blue-600 text-white"}`}
                >
                  {lead.depositPaid
                    ? <><Check className="h-3.5 w-3.5 mr-1.5" /> Deposit Paid</>
                    : <><DollarSign className="h-3.5 w-3.5 mr-1.5" /> Mark Deposit Paid</>}
                </Button>
              )}
            </div>

            {lead.squarePaymentUrl && (
              <div className="mt-3 pt-3 border-t border-slate-700/60">
                <a
                  href={lead.squarePaymentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> View Square Payment Page
                </a>
              </div>
            )}
          </div>

          {/* Payments Block — Task #182 */}
          <div id="admin-job-payments" className="scroll-mt-4 bg-slate-800/60 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold flex items-center gap-1.5">
                <DollarSign className="h-3 w-3" /> Payments
              </p>
              {panel?.status ? (
                <span className={`inline-block px-2 py-0.5 rounded-full border text-xs ${
                  panel.status.color === "green"  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                  panel.status.color === "yellow" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
                  panel.status.color === "blue"   ? "bg-blue-500/15 text-blue-400 border-blue-500/30" :
                                                    "bg-slate-500/15 text-slate-300 border-slate-500/30"
                }`}>{panel.status.label}</span>
              ) : (
                <PaymentStatusPill leadId={lead.id} />
              )}
            </div>

            {panelLoading && !panel ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
              </div>
            ) : (
              <>
                {/* Override state */}
                {panel?.lead?.dispatch_override_reason ? (
                  <div className="bg-amber-950/30 border border-amber-500/30 rounded-lg p-2.5 mb-3">
                    <p className="text-[10px] text-amber-400 uppercase tracking-wide mb-1">Deposit gate overridden</p>
                    <p className="text-xs text-amber-200 mb-2">"{panel.lead.dispatch_override_reason}"</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => clearOverrideMutation.mutate()}
                      disabled={clearOverrideMutation.isPending}
                      className="w-full border-amber-500/40 text-amber-300 hover:bg-amber-950/40 text-xs h-7"
                    >
                      {clearOverrideMutation.isPending
                        ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        : <X className="h-3 w-3 mr-1" />}
                      Clear Override
                    </Button>
                  </div>
                ) : (
                  <div className="bg-slate-900/40 border border-slate-700/40 rounded-lg p-2.5 mb-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">Override Deposit Gate</p>
                    <Textarea
                      value={overrideReason}
                      onChange={e => setOverrideReason(e.target.value)}
                      placeholder="Reason (required, max 500 chars)…"
                      maxLength={500}
                      rows={2}
                      className="bg-slate-700/60 border-slate-600 text-white text-xs mb-2 resize-none"
                    />
                    <Button
                      size="sm"
                      onClick={() => overrideMutation.mutate()}
                      disabled={overrideMutation.isPending || !overrideReason.trim()}
                      className="w-full bg-amber-700 hover:bg-amber-600 text-white text-xs h-7"
                    >
                      {overrideMutation.isPending
                        ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        : <Check className="h-3 w-3 mr-1" />}
                      Override Deposit Gate
                    </Button>
                  </div>
                )}

                {/* Square Invoices */}
                <div className="mb-3">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                    <Receipt className="h-3 w-3" /> Square Invoices ({panel?.invoices?.length ?? 0})
                  </p>
                  {(!panel?.invoices || panel.invoices.length === 0) ? (
                    <p className="text-xs text-slate-600 italic px-1">No invoices yet</p>
                  ) : (
                    <div className="space-y-1.5">
                      {panel.invoices.map(inv => (
                        <div key={inv.id} className="bg-slate-900/40 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-white">
                                ${Number(inv.amount ?? 0).toFixed(2)}
                              </span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                inv.status === "PAID" || inv.paid_at
                                  ? "bg-green-500/20 text-green-300"
                                  : inv.status === "SENT" || inv.sent_at
                                  ? "bg-blue-500/20 text-blue-300"
                                  : "bg-slate-700/60 text-slate-400"
                              }`}>{inv.status || (inv.paid_at ? "PAID" : inv.sent_at ? "SENT" : "DRAFT")}</span>
                            </div>
                            {inv.sent_at && (
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                Sent {formatDateShort(inv.sent_at)}
                                {inv.paid_at && ` · Paid ${formatDateShort(inv.paid_at)}`}
                              </p>
                            )}
                          </div>
                          {inv.public_url && (
                            <a
                              href={inv.public_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-blue-400 hover:text-blue-300 flex-shrink-0"
                            >
                              View →
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* BTC Payments */}
                <div className="mb-3">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                    <Bitcoin className="h-3 w-3" /> Bitcoin Payments ({panel?.btcPayments?.length ?? 0})
                  </p>
                  {(!panel?.btcPayments || panel.btcPayments.length === 0) ? (
                    <p className="text-xs text-slate-600 italic px-1">No BTC payments</p>
                  ) : (
                    <div className="space-y-1.5">
                      {panel.btcPayments.map(btc => (
                        <div key={btc.id} className="bg-slate-900/40 rounded-lg px-2.5 py-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-white">
                                  ${Number(btc.usd_amount ?? 0).toFixed(2)}
                                </span>
                                <span className="text-[10px] text-orange-400">
                                  ₿{Number(btc.btc_amount ?? 0).toFixed(8)}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                {formatDateShort(btc.created_at)}
                                {btc.verified_at && ` · Verified ${formatDateShort(btc.verified_at)}`}
                              </p>
                            </div>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                              btc.verified_at || btc.status === "verified" || btc.status === "completed"
                                ? "bg-green-500/20 text-green-300"
                                : btc.status === "pending"
                                ? "bg-yellow-500/20 text-yellow-300"
                                : "bg-slate-700/60 text-slate-400"
                            }`}>{btc.status || "pending"}</span>
                          </div>
                          {btc.tx_hash && (
                            <p className="text-[10px] text-slate-600 truncate mt-1 font-mono">{btc.tx_hash}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Wallet Ledger */}
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                    <Coins className="h-3 w-3" /> Wallet Ledger ({panel?.walletEntries?.length ?? 0})
                  </p>
                  {(!panel?.walletEntries || panel.walletEntries.length === 0) ? (
                    <p className="text-xs text-slate-600 italic px-1">No wallet activity</p>
                  ) : (
                    <div className="space-y-1.5">
                      {panel.walletEntries.map(w => {
                        const amt = Number(w.amount_usd ?? 0);
                        return (
                          <div key={w.id} className="bg-slate-900/40 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700/60 text-slate-300">{w.kind}</span>
                                <span className={`text-xs font-semibold ${amt >= 0 ? "text-green-400" : "text-red-400"}`}>
                                  {amt >= 0 ? "+" : ""}${amt.toFixed(2)}
                                </span>
                              </div>
                              {w.note && <p className="text-[10px] text-slate-500 mt-0.5 truncate">{w.note}</p>}
                              <p className="text-[10px] text-slate-600">{formatDateShort(w.created_at)}</p>
                            </div>
                            {w.balance_after != null && (
                              <span className="text-[10px] text-slate-500 flex-shrink-0">
                                bal ${Number(w.balance_after).toFixed(2)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Crew Block */}
          <div id="admin-job-crew" className="scroll-mt-4 bg-slate-800/60 rounded-xl p-4">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-3 flex items-center gap-1.5">
              <Users className="h-3 w-3" /> Crew ({crewMembersArr.length}/{lead.crewSize || 2})
            </p>

            {crewEmployees.length > 0 && (
              <div className="space-y-2 mb-3">
                {crewEmployees.map(emp => (
                  <div key={emp.id} className="flex items-center gap-2.5 bg-slate-700/40 rounded-lg px-3 py-2">
                    <div className="w-7 h-7 rounded-full bg-blue-700 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                      {((emp.firstName || "?")[0] + (emp.lastName || "?")[0]).toUpperCase()}
                    </div>
                    <span className="text-sm text-white flex-1">{emp.firstName} {emp.lastName}</span>
                    <button
                      onClick={() => removeCrewMutation.mutate(emp.id)}
                      className="text-slate-500 hover:text-red-400 transition-colors"
                    >
                      <UserX className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {availableToAdd.length > 0 && (
              <div>
                <p className="text-[10px] text-slate-500 mb-2">Add crew member:</p>
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {availableToAdd.slice(0, 10).map(emp => (
                    <button
                      key={emp.id}
                      onClick={() => addCrewMutation.mutate(emp.id)}
                      disabled={addCrewMutation.isPending}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-700/30 hover:bg-slate-700/70 text-slate-300 hover:text-white transition-colors text-sm"
                    >
                      <UserCheck className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                      {emp.firstName} {emp.lastName}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Trade Requests Block */}
          {jobTradeRequests.length > 0 && (
            <div className="bg-slate-800/60 rounded-xl p-4">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-3 flex items-center gap-1.5">
                <ArrowLeftRight className="h-3 w-3" /> Trade Requests ({jobTradeRequests.length})
              </p>
              <div className="space-y-3">
                {jobTradeRequests.map(tr => (
                  <div key={tr.id} className="bg-slate-700/40 rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-white">
                        {tr.requester?.firstName} {tr.requester?.lastName}
                      </span>
                      <ArrowLeftRight className="h-3.5 w-3.5 text-slate-500" />
                      <span className="font-medium text-white">
                        {tr.target?.firstName} {tr.target?.lastName}
                      </span>
                    </div>
                    {tr.requesterNote && (
                      <p className="text-xs text-slate-400 bg-slate-800/40 rounded px-2 py-1">"{tr.requesterNote}"</p>
                    )}
                    <Input
                      placeholder="Optional admin note…"
                      value={tradeNote[tr.id] || ""}
                      onChange={e => setTradeNote(prev => ({ ...prev, [tr.id]: e.target.value }))}
                      className="bg-slate-800 border-slate-700 text-white text-xs h-8"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => reviewTradeMutation.mutate({ tradeId: tr.id, status: "approved" })}
                        disabled={reviewTradeMutation.isPending}
                        className="flex-1 bg-green-700 hover:bg-green-600 text-white text-xs"
                      >
                        <Check className="h-3.5 w-3.5 mr-1" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => reviewTradeMutation.mutate({ tradeId: tr.id, status: "denied" })}
                        disabled={reviewTradeMutation.isPending}
                        variant="outline"
                        className="flex-1 border-red-500/40 text-red-400 hover:bg-red-950/20 text-xs"
                      >
                        <X className="h-3.5 w-3.5 mr-1" /> Deny
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Review Block */}
          <div className="bg-slate-800/60 rounded-xl p-4">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-3 flex items-center gap-1.5">
              <Star className="h-3 w-3" /> Review
            </p>
            <Button
              size="sm"
              onClick={() => sendReviewLinkMutation.mutate()}
              disabled={sendReviewLinkMutation.isPending}
              className="w-full bg-purple-700 hover:bg-purple-600 text-white font-semibold text-xs"
            >
              {sendReviewLinkMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                : <Send className="h-3.5 w-3.5 mr-2" />}
              Send Review Link
            </Button>
          </div>

          {/* Notes */}
          {lead.quoteNotes && (
            <div className="bg-slate-800/40 rounded-xl p-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Quote Notes</p>
              <p className="text-sm text-slate-300">{lead.quoteNotes}</p>
            </div>
          )}
          {customerMediaLink && (
            <div className="bg-blue-500/10 border border-blue-500/25 rounded-xl p-3">
              <p className="text-[10px] text-blue-300 uppercase tracking-wide mb-2 flex items-center gap-1">
                <ExternalLink className="h-3 w-3" /> Customer Media
              </p>
              <a
                href={customerMediaLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-500"
              >
                <span className="truncate">Open photos/video/album link</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
            </div>
          )}
          {photos.length > 0 && (
            <div className="bg-slate-800/40 rounded-xl p-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                <Image className="h-3 w-3" /> Photos
              </p>
              <div className="grid grid-cols-3 gap-2">
                {photos.slice(0, 6).map((photo, index) => (
                  <div key={`${photo.name || "photo"}-${index}`} className="relative aspect-square overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
                    {photo.url ? (
                      <img src={photo.url} alt={photo.name || `Job photo ${index + 1}`} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">No preview</div>
                    )}
                  </div>
                ))}
              </div>
              {photos.length > 6 && (
                <p className="mt-2 text-xs text-slate-500">{photos.length - 6} more photo{photos.length - 6 === 1 ? "" : "s"} on the full lead.</p>
              )}
            </div>
          )}
          {lead.details && (
            <div className="bg-slate-800/40 rounded-xl p-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Job Details</p>
              <p className="text-sm text-slate-300 whitespace-pre-wrap">{lead.details}</p>
            </div>
          )}
        </div>
      </SheetContent>
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent className="bg-slate-900 border-slate-700 text-white" data-testid="dialog-admin-job-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Remove this job from active jobs?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              This removes{" "}
              <strong className="text-slate-100">{lead.firstName} {lead.lastName}</strong>{" "}
              from active jobs and keeps the record archived for recovery. Click Yes to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
              data-testid="button-cancel-delete-lead"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => archiveLeadMutation.mutate()}
              className="bg-red-600 text-white hover:bg-red-500"
              disabled={archiveLeadMutation.isPending}
              data-testid="button-confirm-delete-lead"
            >
              {archiveLeadMutation.isPending ? "Archiving..." : "Archive job"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

export default function AdminJobsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [location] = useLocation();
  const [search, setSearch] = useState("");
  const [calendarView, setCalendarView] = useState<JobCalendarView>("month");
  const [calendarAnchor, setCalendarAnchor] = useState(() => new Date());
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const handledDeepLinkRef = useRef<string | null>(null);
  const requestedLeadId = useMemo(() => new URLSearchParams(location.split("?")[1] || "").get("lead"), [location]);

  const { data: leads = [], isLoading } = useQuery<Lead[]>({
    queryKey: ["/api/jobs/flow?scope=admin"],
    staleTime: 0,
    refetchOnMount: true,
    refetchInterval: 30000,
  });

  const { data: employees = [] } = useQuery<User[]>({
    queryKey: ["/api/employees"],
  });

  const { data: tradeRequests = [] } = useQuery<EnrichedTradeRequest[]>({
    queryKey: ["/api/trade-requests"],
    staleTime: 30000,
  });

  const filteredLeads = useMemo(() => {
    const q = search.toLowerCase();
    const active = leads.filter(l => !["completed", "cancelled"].includes(l.status) && !l.archivedAt);
    if (!q) return active;
    return active.filter(l =>
      `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
      l.phone?.includes(q) ||
      l.email?.toLowerCase().includes(q) ||
      l.serviceType?.toLowerCase().includes(q) ||
      l.details?.toLowerCase().includes(q)
    );
  }, [leads, search]);

  const completedLeads = useMemo(() => leads.filter(l => l.status === "completed"), [leads]);

  useEffect(() => {
    if (!requestedLeadId || handledDeepLinkRef.current === requestedLeadId) return;
    const lead = leads.find((item) => item.id === requestedLeadId);
    if (!lead) return;
    handledDeepLinkRef.current = requestedLeadId;
    setSelectedLead(lead);
    setDetailOpen(true);
    const scheduled = leadCalendarDate(lead);
    if (scheduled) setCalendarAnchor(scheduled);
  }, [leads, requestedLeadId]);

  const calendarBuckets = useMemo(() => {
    const scheduled: Record<string, Lead[]> = {};
    const unscheduled: Lead[] = [];

    for (const lead of filteredLeads) {
      const date = leadCalendarDate(lead);
      if (!date) {
        unscheduled.push(lead);
        continue;
      }
      const key = localDateKey(date);
      (scheduled[key] ||= []).push(lead);
    }

    return { scheduled, unscheduled };
  }, [filteredLeads]);

  const monthDays = useMemo(() => getMonthDays(calendarAnchor), [calendarAnchor]);
  const weekDays = useMemo(() => getWeekDays(calendarAnchor), [calendarAnchor]);
  const todayKey = localDateKey(new Date());
  const activeDayKey = localDateKey(calendarAnchor);
  const calendarLabel = calendarView === "month"
    ? calendarAnchor.toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : calendarView === "week"
    ? `${weekDays[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekDays[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : calendarAnchor.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const pendingTradeCount = tradeRequests.filter(r => r.status === "pending").length;

  const openDetail = (lead: Lead) => {
    setSelectedLead(lead);
    setDetailOpen(true);
  };

  const shiftCalendar = (amount: number) => {
    setCalendarAnchor((current) => {
      if (calendarView === "month") return new Date(current.getFullYear(), current.getMonth() + amount, 1);
      const next = new Date(current.getFullYear(), current.getMonth(), current.getDate());
      next.setDate(next.getDate() + (calendarView === "week" ? amount * 7 : amount));
      return next;
    });
  };

  const openDay = (date: Date) => {
    setCalendarAnchor(new Date(date.getFullYear(), date.getMonth(), date.getDate()));
    setCalendarView("day");
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-8">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-black text-white">Jobs</h1>
          <p className="text-slate-400 text-sm">Tap a job to manage it</p>
        </div>
        <div className="flex items-center gap-2">
          {pendingTradeCount > 0 && (
            <Badge className="bg-orange-500/20 text-orange-300 border border-orange-500/30">
              <ArrowLeftRight className="h-3 w-3 mr-1" />
              {pendingTradeCount} trade{pendingTradeCount !== 1 ? "s" : ""}
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            className="border-slate-600 text-slate-400"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/leads"] })}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScheduleRequestQueue className="mb-5" />

      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-slate-700/60 bg-slate-900/50 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
            <CalendarDays className="h-4 w-4 text-blue-300" /> Job views
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Use the calendar for scheduled work; TBD jobs stay visible for review.</p>
        </div>
        <div aria-label="Jobs view selection" className="grid grid-cols-4 rounded-lg border border-slate-700 bg-slate-950 p-1">
          {JOB_VIEW_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={calendarView === value}
              onClick={() => setCalendarView(value)}
              className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${calendarView === value ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}
              data-testid={`tab-jobs-${value}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, phone, email…"
          className="pl-9 bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500"
        />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 text-center">
          <div className="text-xl font-black text-white">{filteredLeads.length}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Active</div>
        </div>
        <div className="bg-slate-800/60 border border-green-500/20 rounded-xl p-3 text-center">
          <div className="text-xl font-black text-green-400">{completedLeads.length}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Completed</div>
        </div>
        <div className="bg-slate-800/60 border border-orange-500/20 rounded-xl p-3 text-center">
          <div className="text-xl font-black text-orange-400">{pendingTradeCount}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Trade Req.</div>
        </div>
      </div>

      {!isLoading && calendarView !== "list" && calendarBuckets.unscheduled.length > 0 && (
        <button
          type="button"
          onClick={() => openDetail(calendarBuckets.unscheduled[0])}
          className="mb-5 flex w-full items-center justify-between gap-3 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-left transition-colors hover:bg-amber-500/15"
        >
          <span>
            <span className="block text-sm font-bold text-amber-100">Needs date or review</span>
            <span className="mt-0.5 block text-xs text-amber-200/70">TBD jobs and crew claims stay visible even when the calendar is empty.</span>
          </span>
          <Badge className="border-amber-400/30 bg-amber-500/15 text-amber-100">{calendarBuckets.unscheduled.length} open</Badge>
        </button>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="text-center py-14 text-slate-500">
          <Truck className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">{search ? "No jobs match your search" : "No active jobs"}</p>
        </div>
      ) : calendarView === "list" ? (
        <div className="space-y-3">
          {filteredLeads.map(lead => (
            <AdminJobCard
              key={lead.id}
              lead={lead}
              onClick={() => openDetail(lead)}
              employees={employees}
            />
          ))}
          {completedLeads.length > 0 && !search && (
            <div className="mt-6 space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Completed ({completedLeads.length})</p>
              {completedLeads.slice(0, 5).map(lead => (
                <AdminJobCard key={lead.id} lead={lead} onClick={() => openDetail(lead)} employees={employees} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <section className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3 sm:p-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-300">Calendar</p>
              <h2 className="mt-1 text-lg font-black text-white">{calendarLabel}</h2>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="icon" className="border-slate-700 text-slate-200" onClick={() => shiftCalendar(-1)} aria-label="Previous calendar period">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" className="border-slate-700 text-slate-200" onClick={() => setCalendarAnchor(new Date())}>
                Today
              </Button>
              <Button type="button" variant="outline" size="icon" className="border-slate-700 text-slate-200" onClick={() => shiftCalendar(1)} aria-label="Next calendar period">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {calendarView === "month" && (
            <div className="overflow-x-auto">
              <div className="grid min-w-[840px] grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-700 bg-slate-700">
                {CALENDAR_WEEKDAYS.map((weekday) => (
                  <div key={weekday} className="bg-slate-950 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {weekday}
                  </div>
                ))}
                {monthDays.map((day) => {
                  const dayKey = localDateKey(day);
                  const dayJobs = calendarBuckets.scheduled[dayKey] || [];
                  const isCurrentMonth = day.getMonth() === calendarAnchor.getMonth();
                  const isToday = dayKey === todayKey;
                  return (
                    <div key={dayKey} className={`min-h-36 bg-slate-950 p-2 ${isCurrentMonth ? "" : "opacity-40"} ${isToday ? "ring-1 ring-inset ring-blue-400" : ""}`}>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <button type="button" onClick={() => openDay(day)} className={`rounded px-1 text-xs font-bold hover:bg-slate-800 ${isToday ? "text-blue-200" : "text-slate-400"}`}>
                          {day.getDate()}
                        </button>
                        {dayJobs.length > 0 && <span className="rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-200">{dayJobs.length}</span>}
                      </div>
                      <div className="space-y-1.5">
                        {dayJobs.slice(0, 2).map((lead) => <CalendarJobChip key={lead.id} lead={lead} onOpen={openDetail} compact />)}
                        {dayJobs.length > 2 && (
                          <button type="button" onClick={() => openDay(day)} className="w-full rounded-md bg-slate-900 px-2 py-1 text-center text-[10px] text-slate-400 hover:bg-slate-800 hover:text-white">
                            +{dayJobs.length - 2} more job{dayJobs.length === 3 ? "" : "s"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {calendarView === "week" && (
            <div className="overflow-x-auto">
              <div className="grid min-w-[960px] grid-cols-7 gap-3">
                {weekDays.map((day) => {
                  const dayKey = localDateKey(day);
                  const dayJobs = calendarBuckets.scheduled[dayKey] || [];
                  const isToday = dayKey === todayKey;
                  return (
                    <div key={dayKey} className={`min-h-[360px] rounded-lg border p-2 ${isToday ? "border-blue-400 bg-blue-950/20" : "border-slate-700 bg-slate-950/50"}`}>
                      <button type="button" onClick={() => openDay(day)} className="mb-3 w-full rounded-md px-2 py-1 text-left hover:bg-slate-800">
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">{day.toLocaleDateString("en-US", { weekday: "short" })}</span>
                        <span className={`text-sm font-black ${isToday ? "text-blue-200" : "text-white"}`}>{day.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      </button>
                      <div className="space-y-2">
                        {dayJobs.length === 0 ? <p className="px-2 py-6 text-center text-xs text-slate-600">No jobs</p> : dayJobs.map((lead) => <CalendarJobChip key={lead.id} lead={lead} onOpen={openDetail} />)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {calendarView === "day" && (
            <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-3 sm:p-4">
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <p className="text-sm font-bold text-white">{calendarAnchor.toLocaleDateString("en-US", { weekday: "long" })}</p>
                  <p className="text-xs text-slate-500">{calendarBuckets.scheduled[activeDayKey]?.length || 0} scheduled job{(calendarBuckets.scheduled[activeDayKey]?.length || 0) === 1 ? "" : "s"}</p>
                </div>
                {activeDayKey === todayKey && <Badge className="border-blue-400/30 bg-blue-500/15 text-blue-200">Today</Badge>}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {(calendarBuckets.scheduled[activeDayKey] || []).map((lead) => <CalendarJobChip key={lead.id} lead={lead} onOpen={openDetail} />)}
              </div>
              {(calendarBuckets.scheduled[activeDayKey] || []).length === 0 && <p className="py-10 text-center text-sm text-slate-500">No jobs scheduled for this day.</p>}
            </div>
          )}

          {calendarBuckets.unscheduled.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-amber-100">Needs a date or review</p>
                  <p className="text-xs text-amber-200/65">These active jobs are kept visible until a valid date is set.</p>
                </div>
                <Badge className="border-amber-400/30 bg-amber-500/15 text-amber-200">{calendarBuckets.unscheduled.length}</Badge>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {calendarBuckets.unscheduled.map((lead) => <CalendarJobChip key={lead.id} lead={lead} onOpen={openDetail} compact />)}
              </div>
            </div>
          )}
        </section>
      )}

      <AdminJobDetailPanel
        open={detailOpen}
        lead={selectedLead}
        onClose={() => { setDetailOpen(false); setSelectedLead(null); }}
        employees={employees}
        tradeRequests={tradeRequests}
      />
    </div>
  );
}

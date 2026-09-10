import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import {
  MapPin, Calendar, Loader2, Truck, Trash2, Snowflake, Wrench,
  Plus, CheckCircle, Clock, AlertCircle, Users, DollarSign, X,
  Package, ChevronRight, RefreshCw, Coins, HelpCircle, Phone,
  FileText, Star, ArrowRight, Info, ExternalLink, Zap,
  Sprout, Sparkles, Recycle, Hammer, CalendarClock, ChevronDown,
  Pause, SkipForward, RotateCw
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import MarketplaceActionMatrix from "@/components/MarketplaceActionMatrix";
import MarketplaceShapeBadge from "@/components/MarketplaceShapeBadge";
import MarketplaceShapeContext from "@/components/MarketplaceShapeContext";
import MarketplaceProcessGuide from "@/components/MarketplaceProcessGuide";
import MarketplaceSourceFlowStrip from "@/components/MarketplaceSourceFlowStrip";
import SmartBookingGuidanceCard from "@/components/SmartBookingGuidanceCard";
import { BookingMenuIntelligenceCard } from "@/components/BookingMenuIntelligenceCard";
import { extractBookingMenuIntelligence, extractSmartBookingAnswersFromQuoteSnapshot } from "@/lib/booking-menu-intelligence";
import type { LucideIcon } from "lucide-react";
import type { SmartBookingAnswers } from "@shared/smartBookingEngine";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

// Task #130: shape returned by GET /api/customer/bookings — parent bookings
// from the new multi-service `bookings` table with their child service items.
interface BookingItem {
  id: string;
  serviceCode: string;
  serviceLabel: string;
  status: string;
  notes?: string | null;
  scheduledAt?: string | null;
  completedAt?: string | null;
}
interface CustomerBooking {
  id: string;
  customerName: string;
  serviceAddress?: string | null;
  notes?: string | null;
  subtotal: string;
  discountTotal: string;
  finalTotal: string;
  bundleAppliedCode?: string | null;
  status: string;
  rolledUpStatus: string;
  createdAt: string;
  items: BookingItem[];
}

interface CustomerJob {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  serviceType: string;
  pickupAddress: string;
  dropoffAddress: string;
  moveDate: string;
  status: string;
  estimatedTotal: string;
  quotedPrice: string;
  crewSize?: number | null;
  details?: string;
  notes?: string;
  createdAt: string;
  squarePaymentUrl?: string | null;
  depositRequired?: boolean;
  depositAmount?: number;
  depositPaid?: boolean;
  operationalStatus?: string;
  paymentStatus?: string;
  finalBalanceAmount?: number | null;
  finalInvoiceUrl?: string | null;
  closeoutStatus?: string | null;
  arrivalWindow?: string | null;
  enRouteAt?: string | null;
  onSiteAt?: string | null;
  completedAt?: string | null;
  crewSummary?: Array<{ id: string; name: string }>;
  timeline?: Array<{ id: string; type: string; title: string; message: string; occurredAt: string; actionUrl?: string | null }>;
  closeout?: {
    id: string;
    status: string;
    canRetryInvoice?: boolean;
    actual_hours: string;
    calculated_final_total: string;
    deposit_applied: string;
    balance_due: string;
    updated_at: string;
  } | null;
  quoteSnapshot?: unknown;
  // Task #115: shared id grouping all leads booked in the same multi-service
  // submission. Leads with the same bundleGroupId render as one card on /my-jobs.
  bundleGroupId?: string | null;
}

// ── Status Tracker ────────────────────────────────────────────────────────────
const STATUS_STEPS = [
  { key: "submitted", label: "Submitted", icon: FileText },
  { key: "under_review", label: "Under Review", icon: Clock },
  { key: "quote_sent", label: "Quote Sent", icon: DollarSign },
  { key: "paid", label: "Paid", icon: CheckCircle },
  { key: "dispatched", label: "Dispatched", icon: Zap },
];

function getStepIndex(status: string): number {
  if (["chatbot_pending", "quote_requested", "new", "deposit_pending"].includes(status)) return 0;
  if (["quoted", "under_review"].includes(status)) return 1;
  if (["quote_sent", "invoice_sent"].includes(status)) return 2;
  if (["paid", "completed"].includes(status)) return 3;
  if (["awaiting_customer", "owner_review", "customer_rejected", "refund_review", "balance_due"].includes(status)) return 3;
  if (["dispatched", "available", "confirmed", "in_progress", "accepted"].includes(status)) return 4;
  if (status === "cancelled") return -1;
  return 0;
}

function customerActionPhaseForJob(job: CustomerJob): "start" | "progress" | "finish" {
  const status = String(job.closeoutStatus || job.operationalStatus || job.status || "").toLowerCase();
  if (["completed", "paid"].includes(status)) return "finish";
  if (["quoted", "quote_sent", "invoice_sent", "available", "confirmed", "accepted", "in_progress", "dispatched"].includes(status)) {
    return "progress";
  }
  return "start";
}

function customerDisplayStatus(job: CustomerJob) {
  return job.closeoutStatus || job.operationalStatus || job.status;
}

function StatusTracker({ status }: { status: string }) {
  const stepIdx = getStepIndex(status);
  if (status === "cancelled") return null;

  return (
    <div className="flex items-center gap-0 mb-3">
      {STATUS_STEPS.map((step, i) => {
        const Icon = step.icon;
        const isComplete = i < stepIdx;
        const isActive = i === stepIdx;
        return (
          <div key={step.key} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center flex-shrink-0">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                isComplete ? "bg-teal-500" : isActive ? "bg-orange-500 ring-2 ring-orange-500/30" : "bg-zinc-800 border border-zinc-700"
              }`}>
                <Icon className={`h-3 w-3 ${isComplete || isActive ? "text-white" : "text-zinc-600"}`} />
              </div>
              <p className={`text-[9px] font-medium mt-0.5 text-center leading-tight ${
                isComplete ? "text-teal-400" : isActive ? "text-orange-400" : "text-zinc-600"
              }`}>{step.label}</p>
            </div>
            {i < STATUS_STEPS.length - 1 && (
              <div className={`h-0.5 flex-1 mx-0.5 mb-3.5 ${i < stepIdx ? "bg-teal-500" : "bg-zinc-800"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Service config — covers all serviceType values ────────────────────────────
const SERVICE_CONFIG: Record<string, { icon: LucideIcon; color: string; bg: string; label: string }> = {
  moving:          { icon: Truck,      color: "text-blue-400",   bg: "bg-blue-500/15",   label: "Moving"          },
  residential:     { icon: Truck,      color: "text-blue-400",   bg: "bg-blue-500/15",   label: "Moving"          },
  labor:           { icon: Wrench,     color: "text-amber-400",  bg: "bg-amber-500/15",  label: "Labor Only"      },
  handyman:        { icon: Wrench,     color: "text-amber-400",  bg: "bg-amber-500/15",  label: "Labor Only"      },
  junk:            { icon: Trash2,     color: "text-orange-400", bg: "bg-orange-500/15", label: "Junk Removal"    },
  snow:            { icon: Snowflake,  color: "text-cyan-400",   bg: "bg-cyan-500/15",   label: "Snow Removal"    },
  cleaning:        { icon: Sparkles,   color: "text-green-400",  bg: "bg-green-500/15",  label: "Cleaning"        },
  demolition:      { icon: Truck,      color: "text-red-400",    bg: "bg-red-500/15",    label: "Demolition"      },
  custom:          { icon: HelpCircle, color: "text-violet-400", bg: "bg-violet-500/15", label: "Custom Job"      },
  // Task #115: bundle add-on service types so the grouped /my-jobs card
  // labels each chip with its real service name + icon (no "Moving" fallback).
  lawn_care:       { icon: Sprout,     color: "text-lime-400",   bg: "bg-lime-500/15",   label: "Lawn Care"       },
  trash_valet:     { icon: Recycle,    color: "text-emerald-400",bg: "bg-emerald-500/15",label: "Trash Valet"     },
  window_cleaning: { icon: Sparkles,   color: "text-sky-400",    bg: "bg-sky-500/15",    label: "Window Cleaning" },
  assembly:        { icon: Hammer,     color: "text-yellow-400", bg: "bg-yellow-500/15", label: "Assembly"        },
};

function getSvcConfig(type: string) {
  return SERVICE_CONFIG[type] ?? SERVICE_CONFIG.moving;
}

// ── Status config ──────────────────────────────────────────────────────────────
type StatusInfo = {
  label: string;
  cls: string;
  icon: LucideIcon;
  banner: {
    bg: string;
    border: string;
    iconColor: string;
    headline: string;
    body: string;
  };
};

function getStatus(status: string): StatusInfo {
  switch (status) {
    case "awaiting_customer":
      return {
        label: "Review Final",
        cls: "bg-amber-500/15 text-amber-300",
        icon: FileText,
        banner: { bg: "bg-amber-500/10", border: "border-amber-500/20", iconColor: "text-amber-300", headline: "Review the completed job", body: "Check the crew's actual hours and final total. A final balance invoice is only created after you approve." },
      };
    case "balance_due":
      return {
        label: "Balance Due",
        cls: "bg-orange-500/15 text-orange-300",
        icon: DollarSign,
        banner: { bg: "bg-orange-500/10", border: "border-orange-500/20", iconColor: "text-orange-300", headline: "Final balance ready", body: "Your closeout was approved. Use the secure Square link below to finish payment." },
      };
    case "owner_review":
    case "customer_rejected":
    case "refund_review":
      return {
        label: "Owner Review",
        cls: "bg-violet-500/15 text-violet-300",
        icon: AlertCircle,
        banner: { bg: "bg-violet-500/10", border: "border-violet-500/20", iconColor: "text-violet-300", headline: "The final details are under review", body: "No automatic final charge will be created until the owner resolves the exception." },
      };
    case "completed":
      return {
        label: "Done",
        cls: "bg-green-500/15 text-green-400",
        icon: CheckCircle,
        banner: {
          bg: "bg-green-500/10", border: "border-green-500/20", iconColor: "text-green-400",
          headline: "Job Complete!",
          body: "Your job is finished. Tokens will be credited to your wallet shortly. Thank you for choosing JC on the Move!",
        },
      };
    case "paid":
      return {
        label: "Paid",
        cls: "bg-emerald-500/15 text-emerald-400",
        icon: CheckCircle,
        banner: {
          bg: "bg-emerald-500/10", border: "border-emerald-500/20", iconColor: "text-emerald-400",
          headline: "Payment confirmed!",
          body: "Your payment has been received. Your crew will be dispatched shortly. Questions? Call (906) 222-6009.",
        },
      };
    case "in_progress":
      return {
        label: "In Progress",
        cls: "bg-blue-500/15 text-blue-400",
        icon: Clock,
        banner: {
          bg: "bg-blue-500/10", border: "border-blue-500/20", iconColor: "text-blue-400",
          headline: "Your crew is working now",
          body: "Everything is underway. Questions or concerns? Call or text us anytime: (906) 285-9312",
        },
      };
    case "available":
    case "confirmed":
    case "accepted":
      return {
        label: "Crew Assigned",
        cls: "bg-blue-500/15 text-blue-400",
        icon: Users,
        banner: {
          bg: "bg-blue-500/10", border: "border-blue-500/20", iconColor: "text-blue-400",
          headline: "Crew confirmed!",
          body: "Your crew is set and ready to go. They'll reach out 30 minutes before arrival to confirm. Call us with any changes: (906) 285-9312",
        },
      };
    case "quoted":
      return {
        label: "Quote Ready",
        cls: "bg-emerald-500/15 text-emerald-400",
        icon: DollarSign,
        banner: {
          bg: "bg-emerald-500/10", border: "border-emerald-500/20", iconColor: "text-emerald-400",
          headline: "Your quote is ready!",
          body: "We've reviewed your request and put together a price. Call us to confirm and schedule your crew.",
        },
      };
    case "quote_sent":
    case "invoice_sent":
      return {
        label: "Quote Sent",
        cls: "bg-emerald-500/15 text-emerald-400",
        icon: DollarSign,
        banner: {
          bg: "bg-emerald-500/10", border: "border-emerald-500/20", iconColor: "text-emerald-400",
          headline: "Your quote is ready — pay to lock it in!",
          body: "Use the Pay Now button below to secure your booking. Questions? Call (906) 285-9312.",
        },
      };
    case "dispatched":
      return {
        label: "Dispatched",
        cls: "bg-teal-500/15 text-teal-400",
        icon: Zap,
        banner: {
          bg: "bg-teal-500/10", border: "border-teal-500/20", iconColor: "text-teal-400",
          headline: "Your crew is on the way!",
          body: "Your crew has been dispatched and will contact you before arrival. Call (906) 285-9312 with any last-minute changes.",
        },
      };
    case "under_review":
      return {
        label: "Under Review",
        cls: "bg-orange-500/15 text-orange-400",
        icon: Clock,
        banner: {
          bg: "bg-orange-500/10", border: "border-orange-500/20", iconColor: "text-orange-400",
          headline: "Request under review",
          body: "Our team is reviewing your request. We'll reach out within a few hours with your quote.",
        },
      };
    case "deposit_pending":
      return {
        label: "Deposit Pending",
        cls: "bg-orange-500/15 text-orange-400",
        icon: DollarSign,
        banner: {
          bg: "bg-orange-500/10", border: "border-orange-500/20", iconColor: "text-orange-400",
          headline: "Estimate deposit required",
          body: "An estimate deposit is required before we can schedule your in-person visit. Contact us to pay: (906) 222-6009.",
        },
      };
    case "cancelled":
      return {
        label: "Cancelled",
        cls: "bg-red-500/15 text-red-400",
        icon: AlertCircle,
        banner: {
          bg: "bg-red-500/10", border: "border-red-500/20", iconColor: "text-red-400",
          headline: "Job cancelled",
          body: "This job was cancelled. Book a new service whenever you're ready.",
        },
      };
    default:
      return {
        label: "Submitted",
        cls: "bg-orange-500/15 text-orange-400",
        icon: Clock,
        banner: {
          bg: "bg-orange-500/10", border: "border-orange-500/20", iconColor: "text-orange-400",
          headline: "We're reviewing your request",
          body: "Our team will reach out within a few hours to confirm details and send your quote. Watch for a call or text from (906) 285-9312.",
        },
      };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isJustZip(addr: string) {
  return /^\d{5}(-\d{4})?$/.test(addr.trim());
}

function formatAddress(addr: string) {
  if (!addr || isJustZip(addr)) return null;
  return addr;
}

function extractZipFromText(value: string | null | undefined): string | undefined {
  const match = value?.match(/\b\d{5}(?:-\d{4})?\b/);
  return match?.[0];
}

function readChatbotAnswers(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?._source !== "chatbot" || typeof parsed.answers !== "object" || Array.isArray(parsed.answers)) {
      return null;
    }
    return parsed.answers;
  } catch {
    return null;
  }
}

function inferCustomerLoadType(value: string | null | undefined): string | undefined {
  const raw = (value || "").toLowerCase();
  if (!raw) return undefined;
  if (/\b(load\s*(?:and|\+|\/)\s*unload|unload\s*(?:and|\+|\/)\s*load|both)\b/.test(raw)) return "Load + unload";
  if (/\bunload(ing)?\b/.test(raw)) return "Unload only";
  if (/\bload(ing)?\b/.test(raw)) return "Load only";
  if (/\bdeliver(y)?|drop[-\s]?off|pickup|pick up|transport\b/.test(raw)) return "Delivery";
  return undefined;
}

function inferCustomerTruckContext(value: string | null | undefined): string | undefined {
  const raw = (value || "").toLowerCase();
  if (!raw) return undefined;
  if (/\bu-?haul|customer truck|my truck|rental truck|truck|trailer|pods?|u-?box|container\b/.test(raw)) return value || undefined;
  if (/\bstairs?|elevator|garage|driveway|parking|basement|storage|long carry\b/.test(raw)) return value || undefined;
  return undefined;
}

function smartBookingAnswersForCustomerJob(job: CustomerJob): SmartBookingAnswers {
  const rawNotes = [job.details, job.notes].filter(Boolean).join("\n");
  const chatbotAnswers = readChatbotAnswers(job.details || "") || readChatbotAnswers(job.notes || "") || {};
  const snapshotAnswers = extractSmartBookingAnswersFromQuoteSnapshot(job.quoteSnapshot);
  const chatbotFromZip = typeof chatbotAnswers.fromZip === "string" ? chatbotAnswers.fromZip : undefined;
  const parsedCrew = typeof chatbotAnswers.selectedMovingRecCrew === "string" ? Number(chatbotAnswers.selectedMovingRecCrew) : null;
  const crewSize = job.crewSize || (Number.isFinite(parsedCrew) && parsedCrew ? parsedCrew : undefined);

  return {
    ...snapshotAnswers,
    ...chatbotAnswers,
    serviceType: job.serviceType,
    serviceCode: job.serviceType,
    serviceLabel: getSvcConfig(job.serviceType).label,
    fromAddress: job.pickupAddress,
    pickupAddress: job.pickupAddress,
    serviceAddress: job.pickupAddress || chatbotFromZip,
    fromZip: extractZipFromText(job.pickupAddress) || chatbotFromZip,
    toAddress: job.dropoffAddress,
    dropoffAddress: job.dropoffAddress,
    moveDate: job.moveDate || chatbotAnswers.moveDate,
    requestedDate: job.moveDate || chatbotAnswers.moveDate,
    crewSize,
    phone: job.phone,
    email: job.email,
    fullName: job.fullName,
    notes: rawNotes,
    loadType: chatbotAnswers.loadType || inferCustomerLoadType(rawNotes),
    truckSituation: chatbotAnswers.truckSituation || inferCustomerTruckContext(rawNotes),
    truckSize: chatbotAnswers.truckSize || inferCustomerTruckContext(rawNotes),
  };
}

// Strip leading emoji chars (like "🔥 ", "✅ ") from chatbot answer text
function stripEmoji(str: string): string {
  return str.replace(/^[\p{Emoji}\s]+/u, "").trim();
}

// Parse chatbot JSON details into structured, human-readable lines
type DetailLine = { label: string; value: string };

function parseChatbotDetails(raw: string): DetailLine[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed._source !== "chatbot" || !parsed.answers) return null;
    const a = parsed.answers;
    const lines: DetailLine[] = [];

    if (a.serviceType) lines.push({ label: "Service", value: stripEmoji(a.serviceType) });
    if (a.homeSize)    lines.push({ label: "Home size", value: a.homeSize });
    if (a.moveDate)    lines.push({ label: "Preferred date", value: stripEmoji(a.moveDate) });
    if (a.fromZip)     lines.push({ label: "ZIP / From", value: a.fromZip });
    if (a.originFloor) lines.push({ label: "Floor", value: a.originFloor });
    if (a.parkingDistance) lines.push({ label: "Parking", value: stripEmoji(a.parkingDistance) });

    if (Array.isArray(a.furniture) && a.furniture.length > 0) {
      lines.push({ label: "Large furniture", value: a.furniture.join(", ") });
    }
    if (a.boxCount)    lines.push({ label: "Boxes", value: a.boxCount });
    if (Array.isArray(a.specialItems) && a.specialItems.some((s: string) => !s.toLowerCase().includes("none"))) {
      lines.push({ label: "Special items", value: a.specialItems.filter((s: string) => !s.toLowerCase().includes("none")).join(", ") });
    }
    if (a.packingHelp) lines.push({ label: "Packing help", value: stripEmoji(a.packingHelp) });
    if (a.notes && a.notes !== "(none)") lines.push({ label: "Notes", value: a.notes });

    return lines.length > 0 ? lines : null;
  } catch {
    return null;
  }
}

// ── JobSheet ──────────────────────────────────────────────────────────────────
function JobSheet({ job, open, onClose, onNewJob }: {
  job: CustomerJob; open: boolean; onClose: () => void; onNewJob: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [closeoutNote, setCloseoutNote] = useState("");
  const svc = getSvcConfig(job.serviceType);
  const Icon = svc.icon;
  const displayStatus = customerDisplayStatus(job);
  const st = getStatus(displayStatus);
  const StatusIcon = st.icon;

  const price = parseFloat(job.quotedPrice || job.estimatedTotal || "0");
  const hasCost = price > 0;
  const estimatedTokens = hasCost ? Math.floor(price * 15) + 1500 : 0;

  const pickupAddr = formatAddress(job.pickupAddress);
  const dropoffAddr = formatAddress(job.dropoffAddress);

  const rawDescription = job.details || job.notes || "";
  const chatbotLines = rawDescription ? parseChatbotDetails(rawDescription) : null;
  const jobDescription = chatbotLines ? "" : rawDescription;
  const showReschedule = ["new", "quote_requested", "quoted", "available", "confirmed"].includes(job.status);
  const isQuoted = job.status === "quoted";
  const isActive = ["available", "confirmed", "in_progress", "accepted"].includes(job.status);
  const isDone = job.paymentStatus === "paid" || ["paid"].includes(displayStatus);
  const guidanceAnswers = smartBookingAnswersForCustomerJob(job);
  const menuIntelligence = extractBookingMenuIntelligence(job.quoteSnapshot, svc.label);
  const marketplaceSourceContext = menuIntelligence?.sourceSignal || null;
  const marketplaceServiceLabel = menuIntelligence?.serviceLabel || svc.label;
  const refreshCustomerJobs = () => queryClient.invalidateQueries({ queryKey: ["/api/customer/my-leads"] });
  const approveCloseout = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/customer/jobs/${job.id}/closeout/approve`, {});
      return response.json();
    },
    onSuccess: (data) => {
      refreshCustomerJobs();
      toast({ title: data.invoiceUrl ? "Final amount approved" : "Job financially complete" });
      if (data.invoiceUrl) window.open(data.invoiceUrl, "_blank", "noopener,noreferrer");
    },
    onError: (error: Error) => {
      void refreshCustomerJobs();
      toast({ title: "Could not finish the invoice request", description: error.message, variant: "destructive" });
    },
  });
  const rejectCloseout = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/customer/jobs/${job.id}/closeout/reject`, { note: closeoutNote });
      return response.json();
    },
    onSuccess: () => {
      refreshCustomerJobs();
      toast({ title: "Correction sent to the owner" });
    },
    onError: (error: Error) => toast({ title: "Could not request correction", description: error.message, variant: "destructive" }),
  });

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent
        side="bottom"
        className="bg-zinc-900 border-zinc-800 rounded-t-3xl pb-10 max-h-[90vh] overflow-y-auto"
      >
        <SheetHeader className="text-left mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${svc.bg}`}>
              <Icon className={`h-6 w-6 ${svc.color}`} />
            </div>
            <div>
              <SheetTitle className="text-white text-lg font-black">{svc.label}</SheetTitle>
              <MarketplaceShapeBadge serviceCode={job.serviceType} className="mt-1" />
              <div className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>
                <StatusIcon className="h-3 w-3" />
                {st.label}
              </div>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-3">

          {/* Visual Status Tracker */}
          <StatusTracker status={displayStatus} />
          <SmartBookingGuidanceCard
            answers={guidanceAnswers}
            serviceLabel={svc.label}
            compact
          />
          <MarketplaceProcessGuide
            source={marketplaceSourceContext}
            serviceCode={job.serviceType}
            serviceLabel={marketplaceServiceLabel}
            audience="customer"
            compact
          />
          <MarketplaceActionMatrix
            rail="customer"
            phase={customerActionPhaseForJob(job)}
            source={marketplaceSourceContext}
            serviceCode={job.serviceType}
            serviceLabel={marketplaceServiceLabel}
            compact
            limit={2}
          />
          <MarketplaceSourceFlowStrip
            source={marketplaceSourceContext}
            serviceCode={job.serviceType}
            serviceLabel={marketplaceServiceLabel}
            audience="customer"
            phase={customerActionPhaseForJob(job)}
          />
          <MarketplaceShapeContext
            serviceCode={job.serviceType}
            source={marketplaceSourceContext}
            audience="customer"
            maxIdeas={2}
          />
          <BookingMenuIntelligenceCard
            quoteSnapshot={job.quoteSnapshot}
            fallbackServiceLabel={marketplaceServiceLabel}
            audience="customer"
          />

          {/* Deposit Pending badge */}
          {job.depositRequired && !job.depositPaid && (
            <div className="bg-orange-900/20 border border-orange-500/30 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-orange-400 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-orange-300">Estimate Deposit Pending</p>
                  <p className="text-xs text-orange-200/70">
                    ${job.depositAmount} deposit required to schedule your estimate. Contact us to pay.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Status banner */}
          <div className={`rounded-2xl border p-4 ${st.banner.bg} ${st.banner.border}`}>
            <div className="flex items-start gap-3">
              <StatusIcon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${st.banner.iconColor}`} />
              <div>
                <p className="text-white font-bold text-sm">
                  {job.status === "quoted" && job.serviceType === "junk"
                    ? "Price locked in!"
                    : st.banner.headline}
                </p>
                <p className="text-zinc-400 text-xs mt-0.5 leading-relaxed">
                  {job.status === "quoted" && job.serviceType === "junk"
                    ? "Your pickup price is set — no review needed. Call us to schedule your crew."
                    : st.banner.body}
                </p>
              </div>
            </div>
          </div>

          {job.closeout && (
            <div className="rounded-2xl border border-blue-500/25 bg-blue-500/5 p-4" data-testid={`customer-closeout-${job.id}`}>
              <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-blue-300">Completion closeout</p><p className="mt-1 text-sm text-zinc-300">{Number(job.closeout.actual_hours || 0).toFixed(2)} actual hours</p></div><p className="text-2xl font-black text-white">${Number(job.closeout.calculated_final_total || 0).toFixed(2)}</p></div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-zinc-950/60 p-2"><p className="text-zinc-500">Deposit applied</p><p className="font-bold text-emerald-300">− ${Number(job.closeout.deposit_applied || 0).toFixed(2)}</p></div><div className="rounded-lg bg-zinc-950/60 p-2"><p className="text-zinc-500">Balance</p><p className="font-bold text-orange-300">${Number(job.closeout.balance_due || 0).toFixed(2)}</p></div></div>
              {job.closeout.status === "awaiting_customer" && <div className="mt-4 space-y-2"><Button className="w-full bg-emerald-600 hover:bg-emerald-500" disabled={approveCloseout.isPending} onClick={() => approveCloseout.mutate()}>{approveCloseout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve final amount"}</Button><Textarea value={closeoutNote} onChange={(event) => setCloseoutNote(event.target.value)} placeholder="Explain any hours, damage, or charge that needs correction" className="border-zinc-700 bg-zinc-950" /><Button className="w-full" variant="outline" disabled={!closeoutNote.trim() || rejectCloseout.isPending} onClick={() => rejectCloseout.mutate()}>Request owner review</Button></div>}
              {job.closeout.status === 'approved' && job.closeout.canRetryInvoice === true && <div className="mt-4 space-y-3">
                <p className="text-sm text-zinc-300">Your approval is saved. Retry to finish preparing your final invoice.</p>
                <Button className="min-h-11 h-auto w-full whitespace-normal bg-emerald-600 py-3" disabled={approveCloseout.isPending} onClick={() => approveCloseout.mutate()}>{approveCloseout.isPending ? 'Preparing final invoice…' : 'Retry final invoice'}</Button>
              </div>}
              {job.finalInvoiceUrl && <Button className="mt-4 w-full bg-orange-500 hover:bg-orange-400" asChild><a href={job.finalInvoiceUrl} target="_blank" rel="noreferrer">Pay final balance with Square <ExternalLink className="ml-2 h-4 w-4" /></a></Button>}
            </div>
          )}

          {job.crewSummary && job.crewSummary.length > 0 && <div className="rounded-2xl border border-zinc-800 bg-zinc-800/30 p-4"><p className="text-xs font-bold uppercase tracking-widest text-zinc-500">Confirmed crew</p><p className="mt-2 text-sm text-white">{job.crewSummary.map((member) => member.name).join(" · ")}</p>{job.arrivalWindow && <p className="mt-1 text-xs text-zinc-400">Arrival window: {job.arrivalWindow}</p>}</div>}

          {job.timeline && job.timeline.length > 0 && <div className="rounded-2xl border border-zinc-800 bg-zinc-800/30 p-4"><p className="text-xs font-bold uppercase tracking-widest text-zinc-500">Job timeline</p><div className="mt-3 space-y-3">{job.timeline.map((event) => <div key={event.id} className="flex gap-3"><div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-teal-400" /><div><p className="text-sm font-semibold text-white">{event.title}</p><p className="text-xs leading-relaxed text-zinc-400">{event.message}</p><p className="mt-0.5 text-[10px] text-zinc-600">{new Date(event.occurredAt).toLocaleString()}</p></div></div>)}</div></div>}

          {/* Pay Now button — shown when quote_sent with a payment URL */}
          {(job.status === "quote_sent" || job.status === "invoice_sent") && job.squarePaymentUrl && (
            <a
              href={job.squarePaymentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 h-12 rounded-2xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] transition-all text-white font-bold text-sm"
            >
              <DollarSign className="h-4 w-4" />
              Pay Now
              <ExternalLink className="h-3.5 w-3.5 ml-1 opacity-70" />
            </a>
          )}

          {/* Quote price highlight — shown when quoted or quote_sent */}
          {(isQuoted || job.status === "quote_sent" || job.status === "invoice_sent") && hasCost && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4">
              <p className="text-xs text-zinc-400 mb-1 font-semibold uppercase tracking-widest">Your Quote</p>
              <p className="text-3xl font-black text-emerald-400">${price.toFixed(0)}</p>
              {!job.squarePaymentUrl && (
                <p className="text-xs text-zinc-500 mt-1">Call to confirm: <span className="text-white font-semibold">(906) 285-9312</span></p>
              )}
            </div>
          )}

          {/* Job details block */}
          <div className="bg-zinc-800/50 rounded-2xl p-4 space-y-3">

            {pickupAddr && (
              <div className="flex items-start gap-3">
                <MapPin className="h-4 w-4 text-zinc-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">{job.serviceType === "moving" || job.serviceType === "residential" ? "Pickup Address" : "Address"}</p>
                  <p className="text-sm text-white">{pickupAddr}</p>
                </div>
              </div>
            )}

            {dropoffAddr && (
              <div className="flex items-start gap-3">
                <MapPin className="h-4 w-4 text-zinc-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Drop-off Address</p>
                  <p className="text-sm text-white">{dropoffAddr}</p>
                </div>
              </div>
            )}

            {job.moveDate && (
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-zinc-500 flex-shrink-0" />
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Scheduled Date</p>
                  <p className="text-sm text-white font-semibold">
                    {new Date(job.moveDate).toLocaleDateString("en-US", {
                      weekday: "long", month: "long", day: "numeric", year: "numeric"
                    })}
                  </p>
                </div>
              </div>
            )}

            {job.crewSize && (
              <div className="flex items-center gap-3">
                <Users className="h-4 w-4 text-zinc-500 flex-shrink-0" />
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Crew Size</p>
                  <p className="text-sm text-white">
                    {job.crewSize}{" "}
                    {svc.label === "Labor Only" ? "helper" : svc.label === "Junk Removal" ? "crew member" : "mover"}
                    {job.crewSize > 1 ? "s" : ""}
                  </p>
                </div>
              </div>
            )}

            {chatbotLines && chatbotLines.length > 0 && (
              <div className="flex items-start gap-3">
                <FileText className="h-4 w-4 text-zinc-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-zinc-500 mb-2">Job Details</p>
                  <div className="space-y-1.5">
                    {chatbotLines.map((line, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-xs text-zinc-500 w-24 flex-shrink-0 pt-0.5">{line.label}</span>
                        <span className="text-xs text-white leading-relaxed">{line.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {jobDescription && (
              <div className="flex items-start gap-3">
                <FileText className="h-4 w-4 text-zinc-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Job Description</p>
                  <p className="text-sm text-white leading-relaxed">{jobDescription}</p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-zinc-500 flex-shrink-0" />
              <div>
                <p className="text-xs text-zinc-500 mb-0.5">Submitted</p>
                <p className="text-sm text-zinc-400">
                  {new Date(job.createdAt).toLocaleDateString("en-US", {
                    month: "short", day: "numeric", year: "numeric"
                  })}
                </p>
              </div>
            </div>
          </div>

          {/* Price + tokens (non-quoted) */}
          {hasCost && !isQuoted && (
            <div className="flex gap-3">
              <div className="flex-1 bg-zinc-800/50 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-green-400" />
                  <p className="text-xs text-zinc-500">{isDone ? "Final Total" : "Estimated"}</p>
                </div>
                <p className="text-xl font-black text-green-400">${price.toFixed(0)}</p>
              </div>
              {estimatedTokens > 0 && (
                <div className="flex-1 bg-zinc-800/50 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Coins className="h-4 w-4 text-orange-400" />
                    <p className="text-xs text-zinc-500">{isDone ? "Earned" : "Earn"}</p>
                  </div>
                  <p className="text-xl font-black text-orange-400">~{estimatedTokens.toLocaleString()}</p>
                  <p className="text-[10px] text-zinc-600">JCMOVES</p>
                </div>
              )}
            </div>
          )}

          {/* Call to confirm button when quoted */}
          {isQuoted && (
            <a
              href="tel:+19062859312"
              className="w-full flex items-center justify-center gap-2 h-12 rounded-2xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] transition-all text-white font-bold text-sm"
            >
              <Phone className="h-4 w-4" />
              {job.serviceType === "junk" ? "Call to Schedule Pickup" : "Call to Confirm Booking"}
            </a>
          )}

          {/* Actions */}
          {showReschedule && !isQuoted && (
            <button className="w-full flex items-center justify-center gap-2 h-11 rounded-2xl border border-zinc-700 text-zinc-300 text-sm font-semibold hover:bg-zinc-800 active:scale-[0.98] transition-all">
              <RefreshCw className="h-4 w-4" />
              Request Reschedule
            </button>
          )}

          {/* Need help — always visible when active */}
          {(isActive || isQuoted) && (
            <a
              href="tel:+19062859312"
              className="w-full flex items-center justify-center gap-2 h-11 rounded-2xl border border-zinc-700 text-zinc-400 text-sm font-semibold hover:bg-zinc-800 active:scale-[0.98] transition-all"
            >
              <Phone className="h-4 w-4" />
              Call JC on the Move
            </a>
          )}

          <button
            onClick={onNewJob}
            className="w-full h-11 rounded-2xl bg-orange-500 hover:bg-orange-400 text-white font-bold text-sm active:scale-[0.98] transition-all"
          >
            Book Another Service
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── MyJobsPage ────────────────────────────────────────────────────────────────

// Task #116: Active Recurring Plans payload from /api/customer/recurring-plans
interface RecurringPlan {
  id: string;
  serviceKey: string;
  serviceLabel: string;
  frequency: string;
  address: string;
  nextVisitDate: string | null;
  rebookHref: string;
}

function formatNextVisit(iso: string | null): string {
  if (!iso) return "Not scheduled";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function MyJobsPage() {
  const [, setLocation] = useLocation();
  const [selectedJob, setSelectedJob] = useState<CustomerJob | null>(null);
  const [filter, setFilter] = useState<"all" | "active">("all");
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data: jobs = [], isLoading, isError, refetch } = useQuery<CustomerJob[]>({
    queryKey: ["/api/customer/my-leads"],
    retry: 2,
  });

  const { data: recurringPlans = [] } = useQuery<RecurringPlan[]>({
    queryKey: ["/api/customer/recurring-plans"],
    retry: 1,
  });

  // Task #130: parent bookings (with children) from the new bookings table.
  // Rendered above legacy lead cards as "Bundle · N services" tiles, with
  // one chip per child service showing its individual status.
  const { data: bookingResp } = useQuery<{ bookings: CustomerBooking[] }>({
    queryKey: ["/api/customer/bookings"],
    retry: 1,
  });
  const customerBookings = bookingResp?.bookings ?? [];
  const [openBooking, setOpenBooking] = useState<CustomerBooking | null>(null);

  // Past statuses are folded into the History accordion (Task #116). The
  // top grid only shows currently in-flight jobs (regardless of the All/
  // Active/Done pill); the History accordion below holds completed/paid/
  // cancelled jobs so /my-jobs doesn't get noisy as the customer accrues
  // history.
  const sortedJobs = jobs.slice().sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const isPast = (j: CustomerJob) =>
    j.status === "cancelled"
    || j.paymentStatus === "paid"
    || j.status === "paid"
    || (j.status === "completed" && !j.closeout);
  const activeJobs = sortedJobs.filter(j => !isPast(j));
  const pastJobs = sortedJobs.filter(isPast);

  // Past jobs always live in the History accordion below — Active/All only
  // ever shows currently-active jobs to keep the main grid focused (Task #116).
  const filtered = activeJobs.filter(j => {
    if (filter === "active") return !["completed", "cancelled", "paid"].includes(j.status);
    return true;
  });

  // Task #115: collapse companion bundle leads into one card per group. We
  // render a single tile per bundleGroupId with all sibling services listed
  // inside; ungrouped leads render as their existing one-card-per-job UI.
  type Card =
    | { kind: "single"; job: CustomerJob }
    | { kind: "bundle"; groupId: string; jobs: CustomerJob[] };
  const cards: Card[] = [];
  const seenGroups = new Set<string>();
  for (const j of filtered) {
    if (j.bundleGroupId) {
      if (seenGroups.has(j.bundleGroupId)) continue;
      seenGroups.add(j.bundleGroupId);
      const siblings = filtered.filter(x => x.bundleGroupId === j.bundleGroupId);
      cards.push({ kind: "bundle", groupId: j.bundleGroupId, jobs: siblings });
    } else {
      cards.push({ kind: "single", job: j });
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 pb-28">
      <div className="max-w-[430px] mx-auto px-4 pt-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-2xl font-black text-white">My Jobs</h1>
          <button
            onClick={() => setLocation("/book")}
            className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-400 text-white text-sm font-bold px-3 py-1.5 rounded-xl active:scale-95 transition-all"
          >
            <Plus className="h-3.5 w-3.5" /> New
          </button>
        </div>

        {/* Task #116: Active Recurring Plans — surface lawn + trash subscriptions */}
        {recurringPlans.length > 0 && (
          <div className="mb-5" data-testid="section-recurring-plans">
            <h2 className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-2">
              Active Recurring Plans
            </h2>
            <div className="space-y-2">
              {recurringPlans.map(plan => {
                const cfg = getSvcConfig(plan.serviceKey);
                const Icon = cfg.icon;
                return (
                  <div
                    key={plan.id}
                    data-testid={`recurring-plan-${plan.id}`}
                    className="bg-zinc-900 border border-emerald-500/30 rounded-2xl p-4"
                  >
                    <div className="flex items-start gap-3 mb-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${cfg.bg}`}>
                        <Icon className={`h-5 w-5 ${cfg.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="font-bold text-white text-sm leading-tight truncate">{plan.serviceLabel}</p>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-400 capitalize">
                            {plan.frequency || "Recurring"}
                          </span>
                        </div>
                        {plan.address && (
                          <p className="text-[11px] text-zinc-500 truncate flex items-center gap-1">
                            <MapPin className="h-3 w-3" /> {plan.address}
                          </p>
                        )}
                        <p className="text-xs text-emerald-300 font-semibold mt-1 flex items-center gap-1">
                          <CalendarClock className="h-3.5 w-3.5" />
                          Next visit: {formatNextVisit(plan.nextVisitDate)}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <a
                        href="tel:+19062859312"
                        data-testid={`button-skip-${plan.id}`}
                        className="flex items-center justify-center gap-1 h-9 rounded-xl border border-zinc-700 text-zinc-300 text-[11px] font-semibold hover:bg-zinc-800 active:scale-[0.97] transition-all"
                      >
                        <SkipForward className="h-3.5 w-3.5" /> Skip
                      </a>
                      <a
                        href="tel:+19062859312"
                        data-testid={`button-pause-${plan.id}`}
                        className="flex items-center justify-center gap-1 h-9 rounded-xl border border-zinc-700 text-zinc-300 text-[11px] font-semibold hover:bg-zinc-800 active:scale-[0.97] transition-all"
                      >
                        <Pause className="h-3.5 w-3.5" /> Pause
                      </a>
                      <Link href={plan.rebookHref}>
                        <a
                          data-testid={`button-rebook-${plan.id}`}
                          className="flex items-center justify-center gap-1 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold hover:bg-emerald-500/25 active:scale-[0.97] transition-all"
                        >
                          <RotateCw className="h-3.5 w-3.5" /> Re-book
                        </a>
                      </Link>
                    </div>
                    <p className="text-[10px] text-zinc-600 mt-2 text-center">
                      Skip / Pause routes through Darrell at (906) 285-9312 — confirmed within 1 business day.
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Filter pills */}
        <div className="flex gap-2 mb-5">
          {([
            { value: "all",    label: "All"    },
            { value: "active", label: "Active" },
          ] as const).map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                filter === f.value
                  ? "bg-orange-500 text-white"
                  : "bg-zinc-900 border border-zinc-800 text-zinc-400"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
          </div>
        ) : isError ? (
          <div className="bg-zinc-900 rounded-2xl border border-red-900/30 p-8 text-center">
            <p className="text-red-400 font-semibold mb-2">Couldn't load your jobs</p>
            <button onClick={() => refetch()} className="text-sm text-orange-400 font-semibold">Try Again</button>
          </div>
        ) : filtered.length === 0 && customerBookings.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-orange-500/10 flex items-center justify-center mx-auto mb-4">
              <Truck className="h-8 w-8 text-orange-400" />
            </div>
            <p className="font-bold text-white mb-1">
              {filter === "all" ? "No jobs yet" : `No ${filter} jobs`}
            </p>
            <p className="text-zinc-500 text-sm mb-5">
              {filter === "all" ? "Post a job and earn JCMOVES tokens" : "Book a new service to get started"}
            </p>
            <button
              onClick={() => setLocation("/book")}
              className="h-11 px-8 rounded-xl bg-orange-500 text-white font-bold text-sm hover:bg-orange-400 active:scale-[0.97] transition-all"
            >
              Book a Service
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {/* Task #130: parent-bookings rendered first, full-width, with
                one chip per child service so the customer sees their bundle
                as a single unit alongside their existing legacy lead cards. */}
            {customerBookings.map(b => {
              const st = getStatus(b.rolledUpStatus || b.status);
              const final = parseFloat(b.finalTotal || "0");
              const discount = parseFloat(b.discountTotal || "0");
              const bookedDate = new Date(b.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
              return (
                <button
                  key={`booking-${b.id}`}
                  data-testid={`booking-card-${b.id}`}
                  onClick={() => setOpenBooking(b)}
                  className="bg-zinc-900 border border-teal-500/40 rounded-2xl p-4 col-span-2 text-left hover:border-teal-500/60 active:scale-[0.99] transition-all"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-teal-500/15">
                        <Package className="h-5 w-5 text-teal-400" />
                      </div>
                      <div>
                        <p className="font-bold text-white text-sm leading-tight">
                          Bundle · {b.items.length} service{b.items.length !== 1 ? "s" : ""}
                        </p>
                        <p className="text-[10px] text-teal-400 uppercase tracking-wider font-bold mt-0.5">
                          {b.bundleAppliedCode ? `Bundle: ${b.bundleAppliedCode}` : "Booked together"}
                        </p>
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-lg ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {b.items.map(it => {
                      const cfg = getSvcConfig(it.serviceCode);
                      const Ico = cfg.icon;
                      const itemSt = getStatus(it.status);
                      // Per spec: chip shows label + scheduled date + status.
                      // Prefer the per-child scheduledAt (admin-set); fall back
                      // to completion date if already done, else show "TBD".
                      const dateLabel = it.scheduledAt
                        ? new Date(it.scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                        : it.completedAt
                          ? `done ${new Date(it.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                          : "TBD";
                      return (
                        <span
                          key={it.id}
                          data-testid={`booking-chip-${it.serviceCode}`}
                          className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full ${cfg.bg} ${cfg.color}`}
                        >
                          <Ico className="h-3 w-3" />
                          {it.serviceLabel || cfg.label}
                          <span className="text-[9px] opacity-75">· {dateLabel}</span>
                          <span className={`ml-1 text-[9px] font-bold px-1 py-0.5 rounded ${itemSt.cls}`}>
                            {itemSt.label}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                  {final > 0 && (
                    <p className="text-xs text-emerald-400 font-semibold mt-2">
                      ${final.toFixed(0)} total
                      {discount > 0 && (
                        <span className="text-zinc-500 font-normal"> · ${discount.toFixed(0)} bundle discount</span>
                      )}
                    </p>
                  )}
                  {b.serviceAddress && (
                    <p className="text-[11px] text-zinc-500 mt-1 truncate flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {b.serviceAddress}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-1 text-zinc-500">
                    <ChevronRight className="h-3.5 w-3.5" />
                    <span className="text-[10px]">View bundle details</span>
                  </div>
                </button>
              );
            })}
            {cards.map(card => {
              if (card.kind === "bundle") {
                // Render the primary lead's tile but stack mini chips for the
                // other services in the same bundle so the customer sees the
                // full scope at a glance. Tapping the card opens the primary
                // lead's detail sheet (existing UX), keeping the change low
                // risk while still surfacing the bundle.
                const primary = card.jobs[0];
                const st = getStatus(customerDisplayStatus(primary));
                return (
                  <button
                    key={`bundle-${card.groupId}`}
                    data-testid={`bundle-card-${card.groupId}`}
                    onClick={() => setSelectedJob(primary)}
                    className="bg-zinc-900 border border-teal-500/40 rounded-2xl p-4 text-left hover:border-teal-500/60 active:scale-[0.97] transition-all col-span-2"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-teal-500/15">
                          <Package className="h-5 w-5 text-teal-400" />
                        </div>
                        <div>
                          <p className="font-bold text-white text-sm leading-tight">Bundle · {card.jobs.length} services</p>
                          <p className="text-[10px] text-teal-400 uppercase tracking-wider font-bold mt-0.5">Booked together</p>
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-lg ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {card.jobs.map(j => {
                        const cfg = getSvcConfig(j.serviceType);
                        const Ico = cfg.icon;
                        return (
                          <span
                            key={j.id}
                            data-testid={`bundle-chip-${j.serviceType}`}
                            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full ${cfg.bg} ${cfg.color}`}
                          >
                            <Ico className="h-3 w-3" />
                            {cfg.label}
                            {j.moveDate ? ` · ${new Date(j.moveDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                          </span>
                        );
                      })}
                    </div>
                    <div className="mt-2 flex items-center gap-1 text-zinc-500">
                      <ChevronRight className="h-3.5 w-3.5" />
                      <span className="text-[10px]">View bundle details</span>
                    </div>
                  </button>
                );
              }

              const job = card.job;
              const svc = getSvcConfig(job.serviceType);
              const Icon = svc.icon;
              const st = getStatus(customerDisplayStatus(job));
              const price = parseFloat(job.estimatedTotal || "0");

              const pickupAddr = formatAddress(job.pickupAddress);
              const rawDesc = job.details || job.notes || "";
              const chatbotParsed = rawDesc ? parseChatbotDetails(rawDesc) : null;
              const shortDesc = chatbotParsed
                ? (chatbotParsed[0]?.value || "").slice(0, 40)
                : rawDesc.slice(0, 40);

              return (
                <button
                  key={job.id}
                  onClick={() => setSelectedJob(job)}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-left hover:border-zinc-700 active:scale-[0.97] transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${svc.bg}`}>
                      <Icon className={`h-5 w-5 ${svc.color}`} />
                    </div>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-lg ${st.cls}`}>
                      {st.label}
                    </span>
                  </div>

                  <p className="font-bold text-white text-sm leading-tight mb-1">{svc.label}</p>
                  <MarketplaceShapeBadge serviceCode={job.serviceType} className="mb-2" />

                  {job.moveDate ? (
                    <p className="text-xs text-zinc-500 flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(job.moveDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                  ) : pickupAddr ? (
                    <p className="text-xs text-zinc-500 truncate">{pickupAddr}</p>
                  ) : shortDesc ? (
                    <p className="text-xs text-zinc-500 truncate">{shortDesc}</p>
                  ) : (
                    <p className="text-xs text-zinc-600 italic">Details on file</p>
                  )}

                  {price > 0 && (
                    <p className={`text-xs font-semibold mt-1 ${
                      job.status === "quoted" ? "text-emerald-400" : "text-green-400"
                    }`}>
                      ${price.toFixed(0)} {job.status === "quoted" ? "quoted" : "est."}
                    </p>
                  )}

                  <div className="mt-2 flex items-center gap-1 text-zinc-600">
                    <ChevronRight className="h-3.5 w-3.5" />
                    <span className="text-[10px]">View details</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Task #116: History accordion — collapse completed/paid/cancelled jobs */}
        {pastJobs.length > 0 && (
          <div className="mt-6" data-testid="section-history">
            <button
              onClick={() => setHistoryOpen(o => !o)}
              data-testid="button-toggle-history"
              className="w-full flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 hover:border-zinc-700 transition-all"
            >
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-zinc-400" />
                <p className="text-sm font-bold text-white">History</p>
                <span className="text-xs text-zinc-500">({pastJobs.length})</span>
              </div>
              <ChevronDown
                className={`h-4 w-4 text-zinc-400 transition-transform ${historyOpen ? "rotate-180" : ""}`}
              />
            </button>
            {historyOpen && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                {pastJobs.map(job => {
                  const svc = getSvcConfig(job.serviceType);
                  const Icon = svc.icon;
                  const st = getStatus(customerDisplayStatus(job));
                  const price = parseFloat(job.estimatedTotal || "0");
                  return (
                    <button
                      key={job.id}
                      onClick={() => setSelectedJob(job)}
                      data-testid={`history-card-${job.id}`}
                      className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 text-left hover:border-zinc-700 active:scale-[0.97] transition-all"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${svc.bg} opacity-70`}>
                          <Icon className={`h-5 w-5 ${svc.color}`} />
                        </div>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-lg ${st.cls}`}>
                          {st.label}
                        </span>
                      </div>
                      <p className="font-bold text-zinc-300 text-sm leading-tight mb-1">{svc.label}</p>
                      <MarketplaceShapeBadge serviceCode={job.serviceType} className="mb-2" />
                      {job.moveDate && (
                        <p className="text-xs text-zinc-500 flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(job.moveDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </p>
                      )}
                      {price > 0 && (
                        <p className="text-xs font-semibold mt-1 text-zinc-400">${price.toFixed(0)}</p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {selectedJob && (
        <JobSheet
          job={jobs.find((job) => job.id === selectedJob.id) || selectedJob}
          open={true}
          onClose={() => setSelectedJob(null)}
          onNewJob={() => { setSelectedJob(null); setLocation("/book"); }}
        />
      )}

      {/* Task #130: bundle detail sheet — opens when a parent booking card is
          tapped; lists each child service with its individual status, label,
          notes, and completion timestamp so the customer sees the full
          contents of their bundle. */}
      <Sheet open={!!openBooking} onOpenChange={(o) => { if (!o) setOpenBooking(null); }}>
        <SheetContent side="bottom" className="bg-zinc-950 border-zinc-800 text-white max-h-[85vh] overflow-y-auto">
          {openBooking && (
            <>
              <SheetHeader>
                <SheetTitle className="text-white flex items-center gap-2">
                  <Package className="h-5 w-5 text-teal-400" />
                  Bundle · {openBooking.items.length} service{openBooking.items.length !== 1 ? "s" : ""}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap gap-3 text-xs text-zinc-400">
                  <span>
                    Total: <span className="text-emerald-400 font-bold">${parseFloat(openBooking.finalTotal).toFixed(2)}</span>
                  </span>
                  {parseFloat(openBooking.discountTotal) > 0 && (
                    <span>
                      Bundle discount: <span className="text-teal-400 font-bold">-${parseFloat(openBooking.discountTotal).toFixed(2)}</span>
                    </span>
                  )}
                  {openBooking.bundleAppliedCode && (
                    <span>Bundle: <span className="text-teal-400 font-mono">{openBooking.bundleAppliedCode}</span></span>
                  )}
                </div>
                {openBooking.serviceAddress && (
                  <p className="text-xs text-zinc-500 flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {openBooking.serviceAddress}
                  </p>
                )}
                <div className="space-y-2 mt-2">
                  {openBooking.items.map(it => {
                    const cfg = getSvcConfig(it.serviceCode);
                    const Ico = cfg.icon;
                    const itemSt = getStatus(it.status);
                    return (
                      <div
                        key={it.id}
                        data-testid={`booking-detail-item-${it.id}`}
                        className="bg-zinc-900 border border-zinc-800 rounded-xl p-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${cfg.bg}`}>
                              <Ico className={`h-4 w-4 ${cfg.color}`} />
                            </div>
                            <div>
                              <p className="font-bold text-white text-sm">{it.serviceLabel || cfg.label}</p>
                              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{it.serviceCode}</p>
                            </div>
                          </div>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-lg ${itemSt.cls}`}>
                            {itemSt.label}
                          </span>
                        </div>
                        {it.scheduledAt && (
                          <p className="text-[11px] text-teal-400 mt-2 flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Scheduled {new Date(it.scheduledAt).toLocaleString()}
                          </p>
                        )}
                        {it.notes && (
                          <p className="text-[11px] text-zinc-400 mt-2">{it.notes}</p>
                        )}
                        {it.completedAt && (
                          <p className="text-[10px] text-green-400 mt-1">
                            Completed {new Date(it.completedAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

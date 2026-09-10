import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  MapPin, Calendar, Loader2, ChevronRight, Briefcase, Coins, Users,
  CheckCircle2, ClipboardList, Plus, Truck, Clock, ArrowLeftRight,
  Star, AlertCircle, ChevronDown, Navigation, Play, Flag, XCircle, DollarSign,
  Archive, Trash2, Pencil, Save
} from "lucide-react";
import { useLocation } from "wouter";
import type { User } from "@shared/schema";
import LawnJobBrief from "@/components/LawnJobBrief";
import { PaymentStatusPill } from "@/components/PaymentStatusPill";
import MarketplaceShapeBadge from "@/components/MarketplaceShapeBadge";
import SmartBookingGuidanceCard from "@/components/SmartBookingGuidanceCard";
import { BookingMenuIntelligenceCard } from "@/components/BookingMenuIntelligenceCard";
import { extractBookingMenuIntelligence, extractSmartBookingAnswersFromQuoteSnapshot } from "@/lib/booking-menu-intelligence";
import type { SmartBookingAnswers } from "@shared/smartBookingEngine";
import type { JobFlow } from "@shared/job-flow";
import { useAdminViewMode } from "@/hooks/useAdminViewMode";
import { CrewCloseoutDialog } from "@/components/crew-closeout-dialog";
import { ScheduleRequestQueue } from "@/components/schedule-request-queue";

const SERVICE_ICONS: Record<string, string> = {
  residential: "🚛", commercial: "🏢", junk: "🗑️", snow: "❄️",
  cleaning: "✨", handyman: "🔧", demolition: "⚒️", flooring: "🪵",
  painting: "🎨", moving: "🚛", labor: "💪",
  lawn_care: "🌿", lawn: "🌿",
};

const SERVICE_LABELS: Record<string, string> = {
  residential: "Residential Move", commercial: "Commercial Move", junk: "Junk Removal",
  snow: "Snow Removal", cleaning: "Cleaning", handyman: "Handyman", demolition: "Demolition",
  flooring: "Flooring", painting: "Painting", moving: "Moving", labor: "Labor",
  lawn_care: "Lawn Care", lawn: "Lawn Care",
};

const LAWN_SERVICE_TYPES = new Set(["lawn_care", "lawn"]);

function extractCity(address: string | null): string {
  if (!address) return "";
  const parts = address.split(",").map(s => s.trim());
  return parts[1] || parts[0] || "";
}

function extractState(address: string | null): string {
  if (!address) return "";
  const parts = address.split(",").map(s => s.trim());
  if (parts.length >= 3) return parts[2].split(" ")[0];
  if (parts.length >= 2) {
    const last = parts[parts.length - 1].split(" ");
    return last.find(p => /^[A-Z]{2}$/.test(p)) || "";
  }
  return "";
}

function formatDateShort(dateStr: string | null): string {
  if (!dateStr) return "TBD";
  try {
    const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch { return dateStr; }
}

const FLAT_TOKEN_BASE = 500;
const TOKENS_PER_HOUR = 25;
const DEFAULT_HOURS = 3;

function calcEstimatedTokens(hours: number | null): number {
  return FLAT_TOKEN_BASE + TOKENS_PER_HOUR * (hours || DEFAULT_HOURS);
}

function extractZipFromText(value: string | null | undefined): string | undefined {
  const match = value?.match(/\b\d{5}(?:-\d{4})?\b/);
  return match?.[0];
}

function inferLoadType(value: string | null | undefined): string | undefined {
  const raw = (value || "").toLowerCase();
  if (!raw) return undefined;
  if (/\b(load\s*\+?\s*unload|both|load and unload)\b/.test(raw)) return "Load + unload";
  if (/\bunload(ing)?\b/.test(raw)) return "Unload only";
  if (/\bload(ing)?\b/.test(raw)) return "Load only";
  if (/\bdeliver(y)?|drop[-\s]?off|pickup|pick up\b/.test(raw)) return "Delivery";
  return undefined;
}

function inferTruckContext(value: string | null | undefined): string | undefined {
  const raw = (value || "").toLowerCase();
  if (!raw) return undefined;
  if (/\bu-?haul|customer truck|rental truck|truck|trailer|pods?|u-?box|container\b/.test(raw)) return value || undefined;
  if (/\bstairs?|elevator|garage|driveway|parking|basement|storage\b/.test(raw)) return value || undefined;
  return undefined;
}

function smartBookingAnswersForCrewLead(lead: JobBoardLead | EnrichedLead): SmartBookingAnswers {
  const notes = [lead.details, "dispatchNotes" in lead ? lead.dispatchNotes : null].filter(Boolean).join("\n");
  const snapshotAnswers = extractSmartBookingAnswersFromQuoteSnapshot(lead.quoteSnapshot);

  return {
    ...snapshotAnswers,
    serviceType: lead.serviceType,
    serviceCode: lead.serviceType,
    serviceLabel: SERVICE_LABELS[lead.serviceType] || lead.serviceType,
    fromAddress: lead.fromAddress,
    fromZip: extractZipFromText(lead.fromAddress),
    toAddress: lead.toAddress,
    moveDate: lead.confirmedDate || lead.moveDate,
    arrivalWindow: lead.arrivalWindow,
    crewSize: lead.crewSize,
    confirmedHours: lead.confirmedHours,
    loadType: inferLoadType(notes),
    truckSituation: inferTruckContext(notes),
    accessNotes: notes,
    notes,
  };
}

type JobBoardLead = {
  id: string;
  serviceType: string;
  fromAddress: string | null;
  toAddress: string | null;
  moveDate: string | null;
  confirmedDate: string | null;
  arrivalWindow: string | null;
  crewSize: number | null;
  status: string;
  basePrice: string | null;
  totalPrice: string | null;
  details: string | null;
  estimatedTokens: number;
  alreadyApplied: boolean;
  crewSlotsFilled: number;
  confirmedHours: number | null;
  hasHotTub: boolean | null;
  hasPiano: boolean | null;
  hasHeavySafe: boolean | null;
  hasPoolTable: boolean | null;
  crewMembers: string[] | null;
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  email?: string | null;
  dispatchNotes?: string | null;
  dispatchState?: string | null;
  quoteSnapshot?: unknown;
  bonus?: { amount: number; reasons: string[] } | null;
  flow: JobFlow;
};

type EnrichedLead = {
  id: string;
  serviceType: string;
  fromAddress: string | null;
  toAddress: string | null;
  moveDate: string | null;
  confirmedDate: string | null;
  arrivalWindow: string | null;
  crewSize: number | null;
  status: string;
  basePrice: string | null;
  totalPrice: string | null;
  details: string | null;
  confirmedHours: number | null;
  hasHotTub: boolean | null;
  hasPiano: boolean | null;
  hasHeavySafe: boolean | null;
  hasPoolTable: boolean | null;
  crewMembers: string[] | null;
  firstName: string;
  lastName: string;
  email?: string | null;
  dispatchNotes: string | null;
  phone?: string | null;
  dispatchState?: string | null;
  dispatchOfferedTo?: string | null;
  dispatchOfferExpiresAt?: string | null;
  quoteSnapshot?: unknown;
  enRouteAt?: string | null;
  onSiteAt?: string | null;
  completedAt?: string | null;
  bonus?: {
    amount?: number;
    reasons?: string[];
  } | null;
  flow: JobFlow;
};

type TradeRequestStatus = {
  id: string;
  leadId: string;
  requesterId: string;
  targetId: string;
  status: string;
  requesterNote: string | null;
};

type AdminJobStatus =
  | "new"
  | "contacted"
  | "quoted"
  | "confirmed"
  | "available"
  | "accepted"
  | "dispatched"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "quote_requested";

type JobEditForm = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  date: string;
  arrivalWindow: string;
  fromAddress: string;
  toAddress: string;
  confirmedHours: string;
  crewSize: string;
  basePrice: string;
  totalPrice: string;
  details: string;
  dispatchNotes: string;
  status: AdminJobStatus;
  crewMemberIds: string[];
};

const ADMIN_STATUS_OPTIONS: { value: AdminJobStatus; label: string }[] = [
  { value: "quote_requested", label: "Quote requested" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "quoted", label: "Quoted" },
  { value: "confirmed", label: "Confirmed" },
  { value: "available", label: "Available to crew" },
  { value: "accepted", label: "Crew full / accepted" },
  { value: "dispatched", label: "Dispatched" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

function dateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  return value.includes("T") ? value.slice(0, 10) : value;
}

function moneyText(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "";
}

function statusForForm(value: string | null | undefined): AdminJobStatus {
  return ADMIN_STATUS_OPTIONS.some(option => option.value === value)
    ? value as AdminJobStatus
    : "quote_requested";
}

function numberOrNull(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function moneyOrNull(value: string): string | null {
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed.toFixed(2) : null;
}

function dispatchStateForLeadStatus(status: AdminJobStatus): string | null {
  if (status === "completed") return "completed";
  if (status === "in_progress") return "en_route";
  if (status === "accepted" || status === "dispatched") return "assigned";
  if (status === "available" || status === "confirmed" || status === "quoted" || status === "quote_requested" || status === "new") return "pending";
  if (status === "cancelled") return "failed";
  return null;
}

function buildJobEditForm(lead: JobBoardLead | EnrichedLead): JobEditForm {
  return {
    firstName: lead.firstName || "",
    lastName: lead.lastName || "",
    phone: lead.phone || "",
    email: lead.email || "",
    date: dateInputValue(lead.confirmedDate || lead.moveDate),
    arrivalWindow: lead.arrivalWindow || "",
    fromAddress: lead.fromAddress || "",
    toAddress: lead.toAddress || "",
    confirmedHours: lead.confirmedHours ? String(lead.confirmedHours) : "",
    crewSize: String(lead.crewSize || 2),
    basePrice: moneyText(lead.basePrice),
    totalPrice: moneyText(lead.totalPrice),
    details: lead.details || "",
    dispatchNotes: lead.dispatchNotes || "",
    status: statusForForm(lead.status),
    crewMemberIds: Array.isArray(lead.crewMembers) ? lead.crewMembers : [],
  };
}

function leadNeedsAdminInfo(lead: JobBoardLead | EnrichedLead): boolean {
  const tbdText = [lead.fromAddress, lead.toAddress, lead.arrivalWindow, lead.dispatchNotes, lead.details]
    .filter(Boolean)
    .join(" ");
  return (
    !dateInputValue(lead.confirmedDate || lead.moveDate) ||
    !lead.arrivalWindow ||
    !lead.confirmedHours ||
    !lead.fromAddress ||
    /\bTBD\b|exact address|local job/i.test(tbdText)
  );
}

function PremiumBadge({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${color}`}>
      {label}
    </span>
  );
}

function CrewAvatarChip({ name }: { name: string }) {
  const initials = name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white text-[10px] font-bold ring-2 ring-slate-800 -ml-1.5 first:ml-0">
      {initials}
    </span>
  );
}

function JobBoardCard({
  job,
  onApply,
  onViewDetail,
  onArchive,
  isPending,
  archivePending,
  crewNames,
}: {
  job: JobBoardLead;
  onApply: () => void;
  onViewDetail: () => void;
  onArchive?: () => void;
  isPending: boolean;
  archivePending?: boolean;
  crewNames: string[];
}) {
  const isFull = job.crewSlotsFilled >= (job.crewSize || 2);
  const slotsOpen = (job.crewSize || 2) - job.crewSlotsFilled;
  const effectiveDate = job.confirmedDate || job.moveDate;
  const city = extractCity(job.fromAddress);
  const state = extractState(job.fromAddress);
  const estimatedTokens = job.estimatedTokens || calcEstimatedTokens(job.confirmedHours);
  const estimatedHrs = job.confirmedHours || 3;

  const hasPremiums = job.hasHotTub || job.hasPiano || job.hasHeavySafe || job.hasPoolTable;

  return (
    <Card className="bg-slate-800/40 border border-slate-700/50 hover:border-blue-500/40 transition-all cursor-pointer active:scale-[0.99]"
      onClick={onViewDetail}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="text-3xl leading-none mt-0.5 flex-shrink-0">
            {SERVICE_ICONS[job.serviceType] || "📦"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold text-white text-sm leading-tight">
                  {SERVICE_LABELS[job.serviceType] || job.serviceType}
                </p>
                <MarketplaceShapeBadge serviceCode={job.serviceType} className="mt-1" />
                {(city || state) && (
                  <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                    <MapPin className="h-3 w-3 text-slate-500 flex-shrink-0" />
                    {[city, state].filter(Boolean).join(", ")}
                  </p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-orange-400 font-black text-base flex items-center gap-1 justify-end">
                  <Coins className="h-3.5 w-3.5" />
                  ~{estimatedTokens.toLocaleString()}
                </p>
                <p className="text-slate-500 text-[10px]">JCMOVES</p>
                {job.bonus && job.bonus.amount > 0 && (
                  <p className="mt-1 inline-flex items-center gap-0.5 text-emerald-300 font-bold text-xs bg-emerald-500/15 border border-emerald-500/30 rounded-full px-2 py-0.5"
                     data-testid={`bonus-${job.id}`}
                     title={job.bonus.reasons.join(" · ")}>
                    <DollarSign className="h-3 w-3" />
                    +${job.bonus.amount} bonus
                  </p>
                )}
              </div>
            </div>
            {job.bonus && job.bonus.reasons.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {job.bonus.reasons.map((r, i) => (
                  <span key={i} className="text-[10px] font-semibold text-emerald-300/90 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5">
                    {r}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {effectiveDate && (
                <span className="flex items-center gap-1 text-xs text-slate-300">
                  <Calendar className="h-3 w-3 text-slate-500" />
                  {formatDateShort(effectiveDate)}
                </span>
              )}
              {job.arrivalWindow && (
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  <Clock className="h-3 w-3 text-slate-500" />
                  {job.arrivalWindow}
                </span>
              )}
              <span className="flex items-center gap-1 text-xs text-slate-400">
                <Users className="h-3 w-3 text-slate-500" />
                {job.crewSlotsFilled}/{job.crewSize || 2} crew
                {isFull
                  ? <span className="text-green-400 ml-0.5">full</span>
                  : <span className="text-yellow-400 ml-0.5">{slotsOpen} open</span>
                }
              </span>
              <span className="text-xs text-slate-400">
                ~{estimatedHrs}h · ~${(Math.round(estimatedTokens * 0.00000508432 * 100) / 100).toFixed(0)}
              </span>
            </div>

            {hasPremiums && (
              <div className="mt-2 flex flex-wrap gap-1">
                {job.hasHotTub && <PremiumBadge label="🛁 Hot Tub" color="bg-orange-500/20 text-orange-300" />}
                {job.hasPiano && <PremiumBadge label="🎹 Piano" color="bg-purple-500/20 text-purple-300" />}
                {job.hasHeavySafe && <PremiumBadge label="🔒 Safe" color="bg-red-500/20 text-red-300" />}
                {job.hasPoolTable && <PremiumBadge label="🎱 Pool Table" color="bg-blue-500/20 text-blue-300" />}
              </div>
            )}

            {crewNames.length > 0 && (
              <div className="mt-2 flex items-center gap-1">
                <div className="flex">
                  {crewNames.slice(0, 4).map((name, i) => (
                    <CrewAvatarChip key={i} name={name} />
                  ))}
                </div>
                <span className="text-xs text-slate-500 ml-2">
                  {crewNames.slice(0, 2).map(n => n.split(" ")[0]).join(", ")}
                  {crewNames.length > 2 ? ` +${crewNames.length - 2}` : ""}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex gap-2" onClick={e => e.stopPropagation()}>
          {job.alreadyApplied ? (
            <div className="flex items-center gap-2 text-green-400 text-sm w-full">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              <span className="font-medium">Signed up — awaiting confirmation</span>
            </div>
          ) : isFull ? (
            <Button size="sm" disabled className="flex-1 bg-slate-700 text-slate-500 cursor-not-allowed text-xs">
              Crew Full
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onApply}
              disabled={isPending}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign Up for This Job"}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={onViewDetail}
            className="border-slate-600 text-slate-400 hover:text-white text-xs"
          >
            Details <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
        {onArchive && (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => { e.stopPropagation(); onArchive(); }}
            disabled={archivePending}
            className="mt-2 w-full min-h-[40px] border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20 hover:text-white text-xs font-semibold"
          >
            {archivePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
            Delete test lead
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// Task #173 — builds the Google Maps deep link crews tap to navigate
// to the pickup. Prefers the lat,lng pair stored on the lead (no
// geocode ambiguity); falls back to the address string when geocoding
// has not produced coordinates yet. Uses the universal
// `dir/?api=1&destination=` URL so iOS/Android/web all route into the
// user's default maps app.
function buildMapsLink(lead: Pick<EnrichedLead, "fromAddress" | "confirmedDate" | "moveDate"> & { lat?: string | number | null; lng?: string | number | null }): string {
  const latN = lead.lat != null ? Number(lead.lat) : NaN;
  const lngN = lead.lng != null ? Number(lead.lng) : NaN;
  const hasCoords = Number.isFinite(latN) && Number.isFinite(lngN) && latN !== 0 && lngN !== 0;
  const dest = hasCoords
    ? `${latN},${lngN}`
    : encodeURIComponent(lead.fromAddress || "");
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}

const STATUS_STEPS: { key: "accepted"|"en_route"|"on_site"|"completed"; label: string }[] = [
  { key: "accepted", label: "Accepted" },
  { key: "en_route", label: "En Route" },
  { key: "on_site", label: "On Site" },
  { key: "completed", label: "Complete" },
];

function MyJobCard({
  lead,
  onViewDetail,
  crewNames,
  myTradeRequest,
  myId,
  onStatus,
  onAccept,
  onDecline,
  onArchive,
  statusPending,
  acceptPending,
  declinePending,
  archivePending,
}: {
  lead: EnrichedLead;
  onViewDetail: () => void;
  crewNames: string[];
  myTradeRequest: TradeRequestStatus | null;
  myId: string;
  onStatus: (leadId: string, status: "en_route"|"on_site"|"completed") => void;
  onAccept: (leadId: string) => void;
  onDecline: (leadId: string) => void;
  onArchive?: () => void;
  statusPending: string | null;
  acceptPending: string | null;
  declinePending: string | null;
  archivePending?: boolean;
}) {
  const effectiveDate = lead.confirmedDate || lead.moveDate;
  const city = extractCity(lead.fromAddress);
  const state = extractState(lead.fromAddress);
  const estimatedTokens = calcEstimatedTokens(lead.confirmedHours);

  const statusBadge: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-300",
    approved: "bg-green-500/20 text-green-300",
    denied: "bg-red-500/20 text-red-300",
  };

  // Which step am I on?
  const ds = (lead.dispatchState || "").toLowerCase();
  const crewList: string[] = Array.isArray(lead.crewMembers) ? lead.crewMembers : [];
  const amCrewMember = !!myId && crewList.includes(myId);
  // Only show state-machine progress when the dispatch state is one of
  // the genuinely actionable states (assigned/accepted/en_route/on_site)
  // AND the viewer is in the crewMembers list. Otherwise we render a
  // plain status — no CTA that would 403 downstream.
  const actionable =
    amCrewMember && (ds === "assigned" || ds === "accepted" || ds === "en_route" || ds === "on_site" || ds === "completed");
  // Normalize: assigned = freshly pinned by admin; treat as "accepted"
  // so the crew can proceed to the En Route step immediately.
  const currentKey: typeof STATUS_STEPS[number]["key"] =
    ds === "completed" ? "completed"
    : ds === "on_site" ? "on_site"
    : ds === "en_route" ? "en_route"
    : "accepted";
  const currentIdx = STATUS_STEPS.findIndex(s => s.key === currentKey);

  type LucideIcon = React.ComponentType<{ className?: string }>;
  const nextAction: { label: string; icon: LucideIcon; next: "en_route"|"on_site"|"completed" } | null =
    !actionable ? null
    : currentKey === "accepted" ? { label: "Start — I'm En Route", icon: Play, next: "en_route" }
    : currentKey === "en_route" ? { label: "I've Arrived On Site", icon: Flag, next: "on_site" }
    : currentKey === "on_site" ? { label: "Mark Complete", icon: CheckCircle2, next: "completed" }
    : null;

  const iAmActiveOffer = ds === "offering" && lead.dispatchOfferedTo === myId;
  const mapsLink = buildMapsLink(lead);
  const isStatusBusy = statusPending === lead.id;
  const isAcceptBusy = acceptPending === lead.id;
  const isDeclineBusy = declinePending === lead.id;

  return (
    <Card
      className="bg-slate-800/40 border border-slate-700/50 hover:border-blue-500/40 transition-all"
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3 cursor-pointer" onClick={onViewDetail}>
          <div className="text-2xl leading-none mt-0.5 flex-shrink-0">
            {SERVICE_ICONS[lead.serviceType] || "📦"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold text-white text-sm">{SERVICE_LABELS[lead.serviceType] || lead.serviceType}</p>
                <MarketplaceShapeBadge serviceCode={lead.serviceType} className="mt-1" />
                <p className="text-xs text-slate-400">{lead.firstName} {lead.lastName}</p>
              </div>
              <div className="text-right">
                <p className="text-orange-400 font-bold text-sm flex items-center gap-1 justify-end">
                  <Coins className="h-3 w-3" />
                  ~{estimatedTokens.toLocaleString()}
                </p>
                <p className="text-slate-600 text-[10px]">JCMOVES</p>
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {(city || state) && (
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <MapPin className="h-3 w-3 text-slate-500" />
                  {[city, state].filter(Boolean).join(", ")}
                </span>
              )}
              {effectiveDate && (
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-slate-500" />
                  {formatDateShort(effectiveDate)}
                </span>
              )}
              {lead.arrivalWindow && (
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Clock className="h-3 w-3 text-slate-500" />
                  {lead.arrivalWindow}
                </span>
              )}
            </div>
            {myTradeRequest && (
              <div className={`mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[myTradeRequest.status] || "bg-slate-700 text-slate-400"}`}>
                <ArrowLeftRight className="h-3 w-3" />
                Trade {myTradeRequest.status.charAt(0).toUpperCase() + myTradeRequest.status.slice(1)}
              </div>
            )}
          </div>
        </div>

        {/* Task #175 — payment status at a glance for the crew */}
        <div className="mt-2">
          <PaymentStatusPill leadId={lead.id} />
        </div>

        {/* Step tracker — only when the viewer is genuinely on the crew
            (actionable state) or when we're showing Accept/Decline to
            them. For open/unassigned jobs we hide the tracker entirely. */}
        {(actionable || iAmActiveOffer) && (
          <>
            <div className="mt-3 flex items-center gap-1">
              {STATUS_STEPS.map((s, i) => {
                const done = currentIdx >= i;
                const active = currentIdx === i && currentKey !== "completed";
                return (
                  <div key={s.key} className="flex-1 flex items-center gap-1" data-testid={`step-${lead.id}-${s.key}`}>
                    <div className={`flex-1 h-1.5 rounded-full transition-colors ${
                      done ? (active ? "bg-blue-500" : "bg-emerald-500") : "bg-slate-700"
                    }`} />
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide">
              {STATUS_STEPS.map((s, i) => (
                <span key={s.key} className={
                  currentIdx > i ? "text-emerald-400"
                  : currentIdx === i ? "text-blue-300"
                  : "text-slate-600"
                }>{s.label}</span>
              ))}
            </div>
          </>
        )}

        {/* Bonus preview — shown BEFORE accept so the worker sees the
            same $ incentive the job-board card advertises. */}
        {iAmActiveOffer && (lead.bonus?.amount ?? 0) > 0 && (
          <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-300">Crew Bonus</span>
              <span className="text-sm font-black text-emerald-300" data-testid={`bonus-amount-${lead.id}`}>
                +${lead.bonus?.amount ?? 0}
              </span>
            </div>
            {Array.isArray(lead.bonus?.reasons) && lead.bonus.reasons.length > 0 && (
              <p className="text-[10px] text-emerald-200/80 mt-0.5 leading-snug">
                {lead.bonus.reasons.join(" • ")}
              </p>
            )}
          </div>
        )}

        {/* Action row: navigate + primary action, plus decline while offering */}
        <div className="mt-3 flex gap-2">
          <a
            href={mapsLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-600 text-slate-200 bg-slate-800/60 hover:bg-slate-700/60 text-sm font-semibold px-3"
            data-testid={`nav-${lead.id}`}
          >
            <Navigation className="h-4 w-4" /> Navigate
          </a>
          {iAmActiveOffer ? (
            <>
              <Button
                onClick={e => { e.stopPropagation(); onAccept(lead.id); }}
                disabled={isAcceptBusy}
                className="flex-1 min-h-[44px] bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm"
                data-testid={`accept-${lead.id}`}
              >
                {isAcceptBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="h-4 w-4 mr-1" /> Accept</>}
              </Button>
              <Button
                onClick={e => { e.stopPropagation(); onDecline(lead.id); }}
                disabled={isDeclineBusy}
                className="flex-1 min-h-[44px] bg-red-600 hover:bg-red-500 text-white font-bold text-sm"
                data-testid={`decline-${lead.id}`}
              >
                {isDeclineBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><XCircle className="h-4 w-4 mr-1" /> Decline</>}
              </Button>
            </>
          ) : nextAction ? (
            <Button
              onClick={e => { e.stopPropagation(); onStatus(lead.id, nextAction.next); }}
              disabled={isStatusBusy}
              className="flex-1 min-h-[44px] bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm"
              data-testid={`status-${lead.id}-${nextAction.next}`}
            >
              {isStatusBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                <>
                  <nextAction.icon className="h-4 w-4 mr-1" />
                  {nextAction.label}
                </>
              )}
            </Button>
          ) : ds === "completed" ? (
            <div className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm font-semibold" data-testid={`status-label-${lead.id}`}>
              <CheckCircle2 className="h-4 w-4" /> Completed
            </div>
          ) : ds === "offering" ? (
            // Offered to a teammate — viewer should not see Accept/Decline
            <div className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm font-semibold" data-testid={`status-label-${lead.id}`}>
              <Clock className="h-4 w-4" /> Offered to teammate
            </div>
          ) : amCrewMember ? (
            // Edge case: on crew but dispatchState is unrecognized.
            <div className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-700/40 border border-slate-600 text-slate-300 text-sm font-semibold" data-testid={`status-label-${lead.id}`}>
              <Clock className="h-4 w-4" /> Awaiting dispatch
            </div>
          ) : (
            // Open job listed in my-jobs feed (viewer isn't on crew yet).
            <div className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-500/10 border border-blue-500/30 text-blue-300 text-sm font-semibold" data-testid={`status-label-${lead.id}`}>
              <Clock className="h-4 w-4" /> Open — available to claim
            </div>
          )}
        </div>
        {onArchive && (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => { e.stopPropagation(); onArchive(); }}
            disabled={archivePending}
            className={`mt-2 w-full min-h-[40px] text-xs font-semibold ${
              lead.status === "completed"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 hover:text-white"
                : "border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20 hover:text-white"
            }`}
          >
            {archivePending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : lead.status === "completed" ? (
              <Archive className="h-3.5 w-3.5 mr-1.5" />
            ) : (
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            )}
            {lead.status === "completed" ? "Archive completed lead" : "Delete test lead"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function JobDetailSheet({
  open,
  onClose,
  lead,
  isAssigned,
  isAdmin,
  myId,
  employees,
  tradeRequests,
  onLeadUpdated,
}: {
  open: boolean;
  onClose: () => void;
  lead: JobBoardLead | EnrichedLead | null;
  isAssigned: boolean;
  isAdmin: boolean;
  myId: string;
  employees: User[];
  tradeRequests: TradeRequestStatus[];
  onLeadUpdated: (lead: JobBoardLead | EnrichedLead) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showTradeForm, setShowTradeForm] = useState(false);
  const [tradeTargetId, setTradeTargetId] = useState("");
  const [tradeNote, setTradeNote] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<JobEditForm | null>(null);

  const myTradeRequest = tradeRequests.find(r => r.leadId === lead?.id && r.requesterId === myId) || null;

  useEffect(() => {
    if (!lead) {
      setEditForm(null);
      setEditOpen(false);
      return;
    }
    setEditForm(buildJobEditForm(lead));
    setEditOpen(isAdmin && leadNeedsAdminInfo(lead));
  }, [lead?.id, isAdmin]);

  const tradeMutation = useMutation({
    mutationFn: async () => {
      if (!lead) throw new Error("No lead");
      const res = await apiRequest("POST", `/api/leads/${lead.id}/trade-request`, {
        targetId: tradeTargetId,
        requesterNote: tradeNote || undefined,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Failed to submit trade request");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trade-requests/my"] });
      setShowTradeForm(false);
      setTradeTargetId("");
      setTradeNote("");
      toast({ title: "Trade request submitted", description: "The admin will review your request." });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const saveJobMutation = useMutation({
    mutationFn: async () => {
      if (!lead || !editForm) throw new Error("No job selected");

      const date = editForm.date.trim();
      const fromAddress = editForm.fromAddress.trim();
      if (!fromAddress) {
        throw new Error("Pickup address is required. Use a clear TBD note if the exact address is not known yet.");
      }

      const selectedCrew = editForm.crewMemberIds;
      const crewSize = numberOrNull(editForm.crewSize) || Math.max(1, selectedCrew.length || 2);
      const confirmedHours = numberOrNull(editForm.confirmedHours);
      const statusChanged = editForm.status !== statusForForm(lead.status);
      const dispatchState = statusChanged ? dispatchStateForLeadStatus(editForm.status) : lead.dispatchState || null;

      const payload: Record<string, unknown> = {
        firstName: editForm.firstName.trim() || lead.firstName || "Customer",
        lastName: editForm.lastName.trim() || lead.lastName || "Job",
        phone: editForm.phone.trim() || lead.phone || "TBD",
        confirmedDate: date || null,
        moveDate: date || null,
        arrivalWindow: editForm.arrivalWindow.trim() || null,
        fromAddress,
        confirmedFromAddress: fromAddress,
        toAddress: editForm.toAddress.trim() || null,
        confirmedToAddress: editForm.toAddress.trim() || null,
        details: editForm.details.trim() || null,
        dispatchNotes: editForm.dispatchNotes.trim() || null,
        confirmedHours,
        crewSize,
        crewMembers: selectedCrew,
        assignedToUserId: selectedCrew[0] || null,
        basePrice: moneyOrNull(editForm.basePrice),
        totalPrice: moneyOrNull(editForm.totalPrice),
      };

      if (editForm.email.trim()) {
        payload.email = editForm.email.trim();
      }
      if (dispatchState) {
        payload.dispatchState = dispatchState;
      }

      const updateRes = await apiRequest("PATCH", `/api/leads/${lead.id}`, payload);
      if (!updateRes.ok) {
        const err = await updateRes.json().catch(() => ({ error: "Failed to save job details" }));
        throw new Error(err.error || err.message || "Failed to save job details");
      }
      let updated = await updateRes.json();

      if (statusChanged) {
        const statusRes = await apiRequest("PATCH", `/api/leads/${lead.id}/status/force`, {
          status: editForm.status,
          note: `Admin job editor: ${lead.status} -> ${editForm.status}`,
        });
        if (!statusRes.ok) {
          const err = await statusRes.json().catch(() => ({ error: "Job details saved, but status update failed" }));
          throw new Error(err.error || err.message || "Job details saved, but status update failed");
        }
        updated = await statusRes.json();
      }

      return updated as JobBoardLead | EnrichedLead;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flow?scope=board"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flow?scope=mine"] });
      onLeadUpdated(updated);
      setEditForm(buildJobEditForm(updated));
      setEditOpen(false);
      toast({ title: "Job updated", description: "The crew job details and status are saved." });
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  if (!lead) return null;

  const effectiveDate = lead.confirmedDate || lead.moveDate;
  const city = extractCity(lead.fromAddress);
  const state = extractState(lead.fromAddress);
  const estimatedTokens = calcEstimatedTokens(lead.confirmedHours);
  const estimatedHrs = lead.confirmedHours || 3;
  const flatPay = 500;
  const hrPay = 25;
  const crewMembersArr: string[] = Array.isArray(lead.crewMembers) ? lead.crewMembers : [];
  const guidanceAnswers = smartBookingAnswersForCrewLead(lead);
  const fallbackServiceLabel = SERVICE_LABELS[lead.serviceType] || lead.serviceType;
  const menuIntelligence = extractBookingMenuIntelligence(lead.quoteSnapshot, fallbackServiceLabel);
  const marketplaceServiceLabel = menuIntelligence?.serviceLabel || fallbackServiceLabel;

  const crewEmployees = crewMembersArr
    .map(id => employees.find(e => e.id === id))
    .filter(Boolean) as User[];

  const editorNeedsInfo = leadNeedsAdminInfo(lead);
  const selectedCrewCount = editForm?.crewMemberIds.length || 0;

  const availableForTrade = employees.filter(
    e => e.id !== myId && !crewMembersArr.includes(e.id) && e.status === "approved"
  );

  const statusBadge: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    approved: "bg-green-500/20 text-green-300 border-green-500/30",
    denied: "bg-red-500/20 text-red-300 border-red-500/30",
  };

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="bottom" className="bg-slate-900 border-t border-slate-700 text-white h-[92vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="pb-4 border-b border-slate-700/60">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{SERVICE_ICONS[lead.serviceType] || "📦"}</span>
            <div>
              <SheetTitle className="text-white text-lg">
                {SERVICE_LABELS[lead.serviceType] || lead.serviceType}
              </SheetTitle>
              <MarketplaceShapeBadge serviceCode={lead.serviceType} className="mt-1" />
              {(city || state) && (
                <p className="text-slate-400 text-sm flex items-center gap-1 mt-0.5">
                  <MapPin className="h-3.5 w-3.5 text-slate-500" />
                  {[city, state].filter(Boolean).join(", ")}
                </p>
              )}
            </div>
          </div>
        </SheetHeader>

        <div className="pt-4 space-y-5">
          {isAdmin && editForm && (
            <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-blue-300">Admin job editor</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Fill the TBD fields, crew, pay, and status without leaving this job.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {editorNeedsInfo && (
                    <Badge className="bg-orange-500/15 text-orange-200 border-orange-500/30 text-[10px]">
                      Needs info
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditOpen(open => !open)}
                    className="border-blue-500/40 text-blue-200 hover:bg-blue-500/10 hover:text-white"
                    data-testid="button-toggle-admin-job-editor"
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    {editOpen ? "Hide" : "Edit"}
                  </Button>
                </div>
              </div>

              {!editOpen ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-950/40 border border-slate-800 p-2">
                    <p className="text-slate-500 uppercase tracking-wide">Status</p>
                    <p className="mt-0.5 text-white font-semibold capitalize">{lead.status.replaceAll("_", " ")}</p>
                  </div>
                  <div className="rounded-lg bg-slate-950/40 border border-slate-800 p-2">
                    <p className="text-slate-500 uppercase tracking-wide">Date</p>
                    <p className="mt-0.5 text-white font-semibold">{formatDateShort(effectiveDate)}</p>
                  </div>
                  <div className="rounded-lg bg-slate-950/40 border border-slate-800 p-2">
                    <p className="text-slate-500 uppercase tracking-wide">Arrival</p>
                    <p className="mt-0.5 text-white font-semibold">{lead.arrivalWindow || "TBD"}</p>
                  </div>
                  <div className="rounded-lg bg-slate-950/40 border border-slate-800 p-2">
                    <p className="text-slate-500 uppercase tracking-wide">Crew</p>
                    <p className="mt-0.5 text-white font-semibold">{crewMembersArr.length}/{lead.crewSize || 2}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      First name
                      <Input
                        value={editForm.firstName}
                        onChange={e => setEditForm(form => form ? { ...form, firstName: e.target.value } : form)}
                        className="mt-1 bg-slate-950/60 border-slate-700 text-white"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Last name
                      <Input
                        value={editForm.lastName}
                        onChange={e => setEditForm(form => form ? { ...form, lastName: e.target.value } : form)}
                        className="mt-1 bg-slate-950/60 border-slate-700 text-white"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Phone
                      <Input type="tel"
                        legacyPhoneValue={lead.phone} value={editForm.phone}
                        onChange={e => setEditForm(form => form ? { ...form, phone: e.target.value } : form)}
                        className="mt-1 bg-slate-950/60 border-slate-700 text-white"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Email
                      <Input
                        value={editForm.email}
                        onChange={e => setEditForm(form => form ? { ...form, email: e.target.value } : form)}
                        className="mt-1 bg-slate-950/60 border-slate-700 text-white"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Date
                      <Input
                        type="date"
                        value={editForm.date}
                        onChange={e => setEditForm(form => form ? { ...form, date: e.target.value } : form)}
                        className="mt-1 bg-slate-950/60 border-slate-700 text-white"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Arrival
                      <Input
                        value={editForm.arrivalWindow}
                        placeholder="8 AM - 9 AM"
                        onChange={e => setEditForm(form => form ? { ...form, arrivalWindow: e.target.value } : form)}
                        className="mt-1 bg-slate-950/60 border-slate-700 text-white"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Hours
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={editForm.confirmedHours}
                        onChange={e => setEditForm(form => form ? { ...form, confirmedHours: e.target.value } : form)}
                        className="mt-1 bg-slate-950/60 border-slate-700 text-white"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Status
                      <select
                        value={editForm.status}
                        onChange={e => setEditForm(form => form ? { ...form, status: e.target.value as AdminJobStatus } : form)}
                        className="mt-1 h-10 w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 text-sm text-white outline-none focus:border-blue-500"
                      >
                        {ADMIN_STATUS_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Pickup
                      <Textarea
                        value={editForm.fromAddress}
                        onChange={e => setEditForm(form => form ? { ...form, fromAddress: e.target.value } : form)}
                        className="mt-1 bg-slate-950/60 border-slate-700 text-white text-sm resize-none"
                        rows={2}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Dropoff / delivery
                      <Textarea
                        value={editForm.toAddress}
                        onChange={e => setEditForm(form => form ? { ...form, toAddress: e.target.value } : form)}
                        className="mt-1 bg-slate-950/60 border-slate-700 text-white text-sm resize-none"
                        rows={2}
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Crew needed
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={editForm.crewSize}
                        onChange={e => setEditForm(form => form ? { ...form, crewSize: e.target.value } : form)}
                        className="mt-1 bg-slate-950/60 border-slate-700 text-white"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Base price
                      <Input
                        inputMode="decimal"
                        value={editForm.basePrice}
                        onChange={e => setEditForm(form => form ? { ...form, basePrice: e.target.value } : form)}
                        className="mt-1 bg-slate-950/60 border-slate-700 text-white"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Total price
                      <Input
                        inputMode="decimal"
                        value={editForm.totalPrice}
                        onChange={e => setEditForm(form => form ? { ...form, totalPrice: e.target.value } : form)}
                        className="mt-1 bg-slate-950/60 border-slate-700 text-white"
                      />
                    </label>
                  </div>

                  <div className="rounded-xl border border-slate-700/60 bg-slate-950/30 p-3">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Crew assigned ({selectedCrewCount}/{editForm.crewSize || 2})
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={selectedCrewCount === 0}
                        onClick={() => setEditForm(form => form ? { ...form, crewSize: String(Math.max(1, form.crewMemberIds.length)) } : form)}
                        className="h-8 border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10 hover:text-white text-xs"
                      >
                        Set crew full
                      </Button>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                      {employees.map(emp => {
                        const checked = editForm.crewMemberIds.includes(emp.id);
                        return (
                          <button
                            key={emp.id}
                            type="button"
                            onClick={() => setEditForm(form => {
                              if (!form) return form;
                              const exists = form.crewMemberIds.includes(emp.id);
                              return {
                                ...form,
                                crewMemberIds: exists
                                  ? form.crewMemberIds.filter(id => id !== emp.id)
                                  : [...form.crewMemberIds, emp.id],
                              };
                            })}
                            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                              checked
                                ? "border-blue-500/50 bg-blue-500/15 text-white"
                                : "border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-600"
                            }`}
                          >
                            <span className={`h-4 w-4 rounded border flex-shrink-0 ${checked ? "border-blue-400 bg-blue-500" : "border-slate-600"}`} />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{emp.firstName} {emp.lastName}</span>
                              <span className="block truncate text-[10px] text-slate-500">{emp.email}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Job details
                    <Textarea
                      value={editForm.details}
                      onChange={e => setEditForm(form => form ? { ...form, details: e.target.value } : form)}
                      className="mt-1 bg-slate-950/60 border-slate-700 text-white text-sm resize-none"
                      rows={3}
                    />
                  </label>

                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Dispatch notes
                    <Textarea
                      value={editForm.dispatchNotes}
                      onChange={e => setEditForm(form => form ? { ...form, dispatchNotes: e.target.value } : form)}
                      className="mt-1 bg-slate-950/60 border-slate-700 text-white text-sm resize-none"
                      rows={3}
                    />
                  </label>

                  <div className="flex gap-2">
                    <Button
                      onClick={() => saveJobMutation.mutate()}
                      disabled={saveJobMutation.isPending}
                      className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                      data-testid="button-save-admin-job-editor"
                    >
                      {saveJobMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Save className="h-4 w-4 mr-2" />
                          Save job
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditForm(buildJobEditForm(lead));
                        setEditOpen(false);
                      }}
                      className="border-slate-700 text-slate-300 hover:text-white"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-blue-500/25 bg-blue-500/10 px-3 py-2.5">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-300">Next action</p>
            <p className="mt-0.5 text-sm font-bold text-white">{lead.flow?.nextAction.label || "Open job"}</p>
            <p className="mt-0.5 text-xs text-slate-300">{lead.flow?.nextAction.description || "Review the job details and complete the next permitted step."}</p>
          </div>
          <SmartBookingGuidanceCard answers={guidanceAnswers} serviceLabel={lead.serviceType} compact />
          <BookingMenuIntelligenceCard
            quoteSnapshot={lead.quoteSnapshot}
            fallbackServiceLabel={marketplaceServiceLabel}
            audience="worker"
          />

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-800/60 rounded-xl p-3">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Date</p>
              <p className="text-sm font-semibold text-white">{formatDateShort(effectiveDate)}</p>
            </div>
            <div className="bg-slate-800/60 rounded-xl p-3">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Arrival</p>
              <p className="text-sm font-semibold text-white">{lead.arrivalWindow || "TBD"}</p>
            </div>
          </div>

          {/* Pickup Address */}
          {lead.fromAddress && (
            <div className="bg-slate-800/60 rounded-xl p-3">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Pickup</p>
              <p className="text-sm text-white">{lead.fromAddress}</p>
              {lead.toAddress && (
                <>
                  <p className="text-xs text-slate-500 mt-2 mb-1">Delivery</p>
                  <p className="text-sm text-white">{lead.toAddress}</p>
                </>
              )}
            </div>
          )}

          {/* Pay Breakdown */}
          <div className="bg-gradient-to-br from-orange-950/40 to-slate-800/60 border border-orange-500/20 rounded-xl p-4">
            <p className="text-xs text-orange-400 uppercase tracking-wide font-semibold mb-3">Estimated Pay</p>
            <div className="flex items-end justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Coins className="h-4 w-4 text-orange-400" />
                  <span className="text-2xl font-black text-orange-400">~{estimatedTokens.toLocaleString()}</span>
                  <span className="text-slate-400 text-sm">JCMOVES</span>
                </div>
                <p className="text-xs text-slate-400 pl-6">{flatPay} flat + {hrPay}/hr × {estimatedHrs}h</p>
              </div>
            </div>
            {(lead.hasHotTub || lead.hasPiano || lead.hasHeavySafe || lead.hasPoolTable) && (
              <div className="mt-3 pt-3 border-t border-orange-500/20">
                <p className="text-xs text-orange-300 font-semibold mb-1.5">Premium items:</p>
                <div className="flex flex-wrap gap-1.5">
                  {lead.hasHotTub && <PremiumBadge label="🛁 Hot Tub" color="bg-orange-500/20 text-orange-300" />}
                  {lead.hasPiano && <PremiumBadge label="🎹 Piano" color="bg-purple-500/20 text-purple-300" />}
                  {lead.hasHeavySafe && <PremiumBadge label="🔒 Safe" color="bg-red-500/20 text-red-300" />}
                  {lead.hasPoolTable && <PremiumBadge label="🎱 Pool Table" color="bg-blue-500/20 text-blue-300" />}
                </div>
              </div>
            )}
          </div>

          {/* Crew */}
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-2">
              Crew ({crewMembersArr.length}/{lead.crewSize || 2})
            </p>
            {crewEmployees.length === 0 ? (
              <p className="text-sm text-slate-500">No crew assigned yet</p>
            ) : (
              <div className="space-y-2">
                {crewEmployees.map(emp => (
                  <div key={emp.id} className="flex items-center gap-3 bg-slate-800/40 rounded-lg px-3 py-2">
                    <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center text-white text-xs font-bold">
                      {((emp.firstName || "?")[0] + (emp.lastName || "?")[0]).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{emp.firstName} {emp.lastName}</p>
                      <p className="text-xs text-slate-500">{emp.id === myId ? "You" : "Crew member"}</p>
                    </div>
                    {emp.id === myId && (
                      <Badge className="ml-auto bg-blue-600/20 text-blue-300 border-blue-500/30 text-[10px]">You</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          {lead.dispatchNotes && (
            <div className="bg-slate-800/40 rounded-xl p-3">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Dispatch Notes</p>
              <p className="text-sm text-slate-300">{lead.dispatchNotes}</p>
            </div>
          )}

          {/* Lawn-care job brief (only for lawn-related service types) */}
          {LAWN_SERVICE_TYPES.has(lead.serviceType) && "phone" in lead && (
            <LawnJobBrief phone={lead.phone ?? null} />
          )}

          {/* Trade Request Section */}
          {isAssigned && (
            <div className="border border-slate-700/60 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-3 flex items-center gap-2">
                <ArrowLeftRight className="h-3.5 w-3.5" /> Trade Request
              </p>

              {myTradeRequest ? (
                <div>
                  <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border ${statusBadge[myTradeRequest.status] || "bg-slate-700 text-slate-400"}`}>
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                    Trade request {myTradeRequest.status}
                  </div>
                  {myTradeRequest.status === "pending" && (
                    <p className="text-xs text-slate-400 mt-2">Waiting for admin review.</p>
                  )}
                  {myTradeRequest.status === "approved" && (
                    <p className="text-xs text-green-400 mt-2">Trade approved — you've been swapped off this job.</p>
                  )}
                  {myTradeRequest.status === "denied" && (
                    <p className="text-xs text-red-400 mt-2">Trade was denied. You remain on this job.</p>
                  )}
                </div>
              ) : showTradeForm ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-slate-400 mb-2">Who should take your spot?</p>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {availableForTrade.length === 0 ? (
                        <p className="text-xs text-slate-500">No available crew members to trade with.</p>
                      ) : (
                        availableForTrade.map(emp => (
                          <button
                            key={emp.id}
                            onClick={() => setTradeTargetId(emp.id)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                              tradeTargetId === emp.id
                                ? "bg-blue-600/20 border border-blue-500/50 text-white"
                                : "bg-slate-800/60 text-slate-300 hover:bg-slate-700/60"
                            }`}
                          >
                            <div className="w-7 h-7 rounded-full bg-slate-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                              {((emp.firstName || "?")[0] + (emp.lastName || "?")[0]).toUpperCase()}
                            </div>
                            <span className="text-sm">{emp.firstName} {emp.lastName}</span>
                            {tradeTargetId === emp.id && <CheckCircle2 className="h-4 w-4 ml-auto text-blue-400" />}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                  <Textarea
                    placeholder="Optional note to admin…"
                    value={tradeNote}
                    onChange={e => setTradeNote(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white text-sm resize-none"
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => tradeMutation.mutate()}
                      disabled={!tradeTargetId || tradeMutation.isPending}
                      className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-semibold"
                    >
                      {tradeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit Trade Request"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowTradeForm(false)} className="border-slate-600 text-slate-400">
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowTradeForm(true)}
                  className="border-slate-600 text-slate-300 hover:text-white hover:border-orange-500/50"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5 mr-2" />
                  Request Trade
                </Button>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function CrewJobsPage() {
  const { user } = useAuth();
  const { isCrewPreview } = useAdminViewMode();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [location, navigate] = useLocation();
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<JobBoardLead | EnrichedLead | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const isAdmin = ["admin", "business_owner"].includes(user?.role || "") && !isCrewPreview;

  const { data: boardJobs = [], isLoading: boardLoading } = useQuery<JobBoardLead[]>({
    queryKey: ["/api/jobs/flow?scope=board"],
    staleTime: 0,
    refetchOnMount: true,
    refetchInterval: 30000,
  });

  const { data: myJobs = [], isLoading: myJobsLoading } = useQuery<EnrichedLead[]>({
    queryKey: ["/api/jobs/flow?scope=mine"],
    staleTime: 0,
    refetchOnMount: true,
  });

  const { data: employees = [] } = useQuery<User[]>({
    queryKey: ["/api/employees"],
  });

  const { data: myTradeRequests = [] } = useQuery<TradeRequestStatus[]>({
    queryKey: ["/api/trade-requests/my"],
    staleTime: 30000,
  });

  const applyMutation = useMutation({
    mutationFn: async (leadId: string) => {
      const res = await apiRequest("POST", `/api/jobs/${leadId}/claim`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to sign up" }));
        throw new Error(err.error || "Failed to sign up");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flow?scope=board"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flow?scope=mine"] });
      setApplyingId(null);
      if (data?.job) {
        setSelectedJob(data.job);
        setDetailOpen(true);
      }
      toast({ title: "Job claimed", description: "Admin will confirm the crew and dispatch it when ready." });
    },
    onError: (e: Error) => {
      setApplyingId(null);
      toast({ title: "Couldn't sign up", description: e.message, variant: "destructive" });
    },
  });

  // Task #173 — crew execution state machine transitions.
  const [acceptPending, setAcceptPending] = useState<string | null>(null);
  const acceptOfferMutation = useMutation({
    mutationFn: async (leadId: string) => {
      const res = await apiRequest("POST", `/api/crew/jobs/${leadId}/accept`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Offer no longer yours" }));
        throw new Error(err.error || "Offer no longer yours");
      }
      return res.json();
    },
    onMutate: (leadId) => setAcceptPending(leadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flow?scope=mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flow?scope=board"] });
      setAcceptPending(null);
      toast({ title: "✅ Offer accepted", description: "You're on the job — tap Start when en route." });
    },
    onError: (e: Error) => {
      setAcceptPending(null);
      toast({ title: "Couldn't accept", description: e.message, variant: "destructive" });
    },
  });

  const [statusPending, setStatusPending] = useState<string | null>(null);
  const [closeoutLeadId, setCloseoutLeadId] = useState<string | null>(null);
  const statusMutation = useMutation({
    mutationFn: async ({ leadId, status }: { leadId: string; status: "en_route"|"on_site"|"completed" }) => {
      const res = await apiRequest("POST", `/api/crew/jobs/${leadId}/status`, { status });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Couldn't update status" }));
        throw new Error(err.error || "Couldn't update status");
      }
      return res.json();
    },
    onMutate: ({ leadId }) => setStatusPending(leadId),
    onSuccess: (_d, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flow?scope=mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      // On completion, also refresh earnings so the crew sees their
      // base + bonus payout land on the Earnings tab immediately.
      if (status === "completed") {
        queryClient.invalidateQueries({ queryKey: ["/api/rewards/wallet"] });
        queryClient.invalidateQueries({ queryKey: ["/api/rewards/history"] });
        queryClient.invalidateQueries({ queryKey: ["/api/rewards/balance"] });
      }
      setStatusPending(null);
      const labels: Record<string, string> = { en_route: "🚚 En route", on_site: "📍 On site", completed: "✅ Job complete!" };
      toast({ title: labels[status] });
    },
    onError: (e: Error) => {
      setStatusPending(null);
      toast({ title: "Status update failed", description: e.message, variant: "destructive" });
    },
  });
  const advanceJob = (leadId: string, status: "en_route" | "on_site" | "completed") => {
    if (status === "completed") {
      setCloseoutLeadId(leadId);
      return;
    }
    statusMutation.mutate({ leadId, status });
  };

  const [declinePending, setDeclinePending] = useState<string | null>(null);
  const declineMutation = useMutation({
    mutationFn: async (leadId: string) => {
      const res = await apiRequest("POST", `/api/crew/jobs/${leadId}/decline`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Couldn't decline" }));
        throw new Error(err.error || "Couldn't decline");
      }
      return res.json();
    },
    onMutate: (leadId) => setDeclinePending(leadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flow?scope=mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flow?scope=board"] });
      setDeclinePending(null);
      toast({ title: "Offer declined", description: "We'll offer it to the next available crew." });
    },
    onError: (e: Error) => {
      setDeclinePending(null);
      toast({ title: "Couldn't decline", description: e.message, variant: "destructive" });
    },
  });

  const archiveLeadMutation = useMutation({
    mutationFn: async ({ leadId }: { leadId: string; label: string }) => {
      const res = await apiRequest("DELETE", `/api/leads/${leadId}`);
      return res.json();
    },
    onMutate: ({ leadId }) => setArchivingId(leadId),
    onSuccess: (_data, { label }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flow?scope=board"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flow?scope=mine"] });
      setArchivingId(null);
      setDetailOpen(false);
      setSelectedJob(null);
      toast({ title: label, description: "Lead moved out of active job views." });
    },
    onError: (e: Error) => {
      setArchivingId(null);
      toast({ title: "Cleanup failed", description: e.message, variant: "destructive" });
    },
  });

  const archiveCompletedMutation = useMutation({
    mutationFn: async (leadIds: string[]) => {
      const res = await apiRequest("DELETE", "/api/leads", { ids: leadIds });
      return res.json();
    },
    onMutate: () => setArchivingId("completed-bulk"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flow?scope=board"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flow?scope=mine"] });
      setArchivingId(null);
      toast({ title: "Completed leads archived", description: "Completed customer leads moved out of active job views." });
    },
    onError: (e: Error) => {
      setArchivingId(null);
      toast({ title: "Bulk archive failed", description: e.message, variant: "destructive" });
    },
  });

  function archiveLead(lead: Pick<EnrichedLead, "id" | "status" | "firstName" | "lastName"> | Pick<JobBoardLead, "id" | "status" | "firstName" | "lastName">) {
    const isCompleted = lead.status === "completed";
    const name = `${lead.firstName || ""} ${lead.lastName || ""}`.trim() || "this lead";
    const prompt = isCompleted
      ? `Archive completed customer lead for ${name}? It will leave active job screens but stay in archived records.`
      : `Delete/archive test lead for ${name}? It will leave active job screens but stay in archived records.`;
    if (!window.confirm(prompt)) return;
    archiveLeadMutation.mutate({
      leadId: lead.id,
      label: isCompleted ? "Completed lead archived" : "Test lead deleted",
    });
  }

  function archiveCompletedLeads() {
    if (completedJobs.length === 0) return;
    if (!window.confirm(`Archive all ${completedJobs.length} completed customer leads shown here? They will stay in archived records.`)) return;
    archiveCompletedMutation.mutate(completedJobs.map((lead) => lead.id));
  }

  const activeJobs = useMemo(
    () => myJobs.filter(l => !["completed", "cancelled"].includes(l.status)),
    [myJobs]
  );
  const completedJobs = useMemo(
    () => myJobs.filter(l => l.status === "completed"),
    [myJobs]
  );

  const getCrewNames = (crewMembers: string[] | null): string[] => {
    if (!crewMembers) return [];
    return crewMembers
      .map(id => employees.find(e => e.id === id))
      .filter(Boolean)
      .map(e => `${(e as User).firstName || ""} ${(e as User).lastName || ""}`.trim());
  };

  const openDetail = (job: JobBoardLead | EnrichedLead) => {
    setSelectedJob(job);
    setDetailOpen(true);
  };

  useEffect(() => {
    const leadId = new URLSearchParams(location.split("?")[1] || "").get("lead");
    if (!leadId || detailOpen) return;
    const job = [...boardJobs, ...myJobs].find((item) => item.id === leadId);
    if (job) openDetail(job);
  }, [boardJobs, myJobs, location, detailOpen]);

  const isAssigned = selectedJob
    ? Array.isArray(selectedJob.crewMembers) && selectedJob.crewMembers.includes(user?.id || "")
    : false;

  const openCount = boardJobs.filter(j => !j.alreadyApplied && (j.crewSize || 2) > j.crewSlotsFilled).length;
  const nextActionJob = myJobs.find((job) => job.flow?.stage !== "completed" && job.flow?.stage !== "closed")
    || boardJobs.find((job) => job.flow?.canClaim)
    || null;

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-8">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-black text-white">Jobs</h1>
          <p className="text-slate-400 text-sm">Job board & your assignments</p>
        </div>
        <Button size="sm" className="bg-blue-600 hover:bg-blue-500" onClick={() => navigate("/leads?tab=add")}>
          <Plus className="h-4 w-4 mr-1" /> Add Lead
        </Button>
      </div>

      {nextActionJob && (
        <button
          type="button"
          onClick={() => openDetail(nextActionJob)}
          className="mb-4 flex w-full items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-left hover:bg-blue-500/15"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-blue-300" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-black uppercase tracking-widest text-blue-300">Next action</span>
            <span className="block truncate text-sm font-bold text-white">{nextActionJob.flow.nextAction.label} · {nextActionJob.flow.label}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-blue-200" />
        </button>
      )}

      <ScheduleRequestQueue className="mb-5" />

      <Tabs defaultValue="board">
        <TabsList className="bg-slate-800/50 border border-slate-700/50 mb-5 w-full">
          <TabsTrigger value="board" className="flex-1 data-[state=active]:bg-blue-600/20 data-[state=active]:text-blue-300">
            <Briefcase className="h-3.5 w-3.5 mr-1.5" />
            Job Board
            {openCount > 0 && (
              <span className="ml-1.5 bg-blue-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                {openCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="my-jobs" className="flex-1 data-[state=active]:bg-blue-600/20 data-[state=active]:text-blue-300">
            <ClipboardList className="h-3.5 w-3.5 mr-1.5" />
            My Jobs
            {activeJobs.length > 0 && (
              <span className="ml-1.5 bg-slate-600 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                {activeJobs.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="space-y-3">
          <p className="text-slate-500 text-xs">Tap a card for full details. Sign up to be assigned.</p>
          {boardLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-7 w-7 animate-spin text-blue-400" /></div>
          ) : boardJobs.length === 0 ? (
            <div className="text-center py-14 text-slate-500">
              <Truck className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No open jobs right now</p>
              <p className="text-xs mt-1">Check back soon</p>
            </div>
          ) : (
            boardJobs.map(job => (
              <JobBoardCard
                key={job.id}
                job={job}
                onApply={() => { setApplyingId(job.id); applyMutation.mutate(job.id); }}
                onViewDetail={() => openDetail(job)}
                onArchive={isAdmin ? () => archiveLead(job) : undefined}
                isPending={applyingId === job.id && applyMutation.isPending}
                archivePending={archivingId === job.id}
                crewNames={getCrewNames(job.crewMembers)}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="my-jobs" className="space-y-3">
          {myJobsLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-7 w-7 animate-spin text-blue-400" /></div>
          ) : myJobs.length === 0 ? (
            <div className="text-center py-14 text-slate-500">
              <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No assigned jobs yet</p>
              <p className="text-xs mt-1">Sign up for jobs on the Job Board tab</p>
            </div>
          ) : (
            <>
              {activeJobs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Active ({activeJobs.length})</p>
                  {activeJobs.map(lead => {
                    const myTrade = myTradeRequests.find(r => r.leadId === lead.id && r.requesterId === user?.id) || null;
                    return (
                      <MyJobCard
                        key={lead.id}
                        lead={lead}
                        onViewDetail={() => openDetail(lead)}
                        crewNames={getCrewNames(lead.crewMembers)}
                        myTradeRequest={myTrade}
                        myId={user?.id || ""}
                        onStatus={advanceJob}
                        onAccept={(leadId) => acceptOfferMutation.mutate(leadId)}
                        onDecline={(leadId) => declineMutation.mutate(leadId)}
                        onArchive={isAdmin ? () => archiveLead(lead) : undefined}
                        statusPending={statusPending}
                        acceptPending={acceptPending}
                        declinePending={declinePending}
                        archivePending={archivingId === lead.id}
                      />
                    );
                  })}
                </div>
              )}
              {completedJobs.length > 0 && (
                <div className="space-y-2 mt-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Completed ({completedJobs.length})</p>
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={archiveCompletedLeads}
                        disabled={archiveCompletedMutation.isPending}
                        className="min-h-[36px] border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 hover:text-white text-xs font-semibold"
                      >
                        {archiveCompletedMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5 mr-1.5" />}
                        Archive all
                      </Button>
                    )}
                  </div>
                  {completedJobs.slice(0, 5).map(lead => (
                    <Card key={lead.id} className="bg-white/[0.02] border border-slate-800/60 cursor-pointer" onClick={() => openDetail(lead)}>
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm text-slate-300 font-medium">{lead.firstName} {lead.lastName}</p>
                            <p className="text-xs text-slate-500">
                              {SERVICE_LABELS[lead.serviceType] || lead.serviceType} · {formatDateShort(lead.confirmedDate || lead.moveDate)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            {isAdmin && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => archiveLead(lead)}
                                disabled={archivingId === lead.id}
                                className="min-h-[34px] border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 hover:text-white text-xs font-semibold"
                              >
                                {archivingId === lead.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5 mr-1" />}
                                Archive
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      <JobDetailSheet
        open={detailOpen}
        onClose={() => { setDetailOpen(false); setSelectedJob(null); }}
        lead={selectedJob}
        isAssigned={isAssigned}
        isAdmin={isAdmin}
        myId={user?.id || ""}
        employees={employees}
        tradeRequests={myTradeRequests}
        onLeadUpdated={(updated) => {
          setSelectedJob(prev => prev?.id === updated.id ? { ...prev, ...updated } : updated);
        }}
      />
      <CrewCloseoutDialog
        leadId={closeoutLeadId}
        onClose={() => setCloseoutLeadId(null)}
        onSuccess={() => {
          setCloseoutLeadId(null);
          queryClient.invalidateQueries({ queryKey: ["/api/jobs/flow?scope=mine"] });
          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        }}
      />
    </div>
  );
}

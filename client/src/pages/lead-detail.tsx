import { useQuery, useMutation } from "@tanstack/react-query";
import { customerNotesFromDetails } from "@shared/leadDetails";
import { useRoute, Link, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Mail, Phone, MapPin, Calendar, Users, DollarSign, Award, TrendingUp, CheckCircle, Clock, Star, ExternalLink, Sparkles, Send, FileText, Loader2, Bitcoin, Copy, Check, Zap, ShoppingBag, AlertTriangle, UserCheck, Camera, Image, ChevronRight, PlayCircle, ChevronDown, ChevronUp, MessageSquare, Hash, Archive, Trash2, X, Truck, CircleHelp, LockKeyhole } from "lucide-react";
import { useState, useEffect, useRef, useMemo } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { extractCustomerMediaLink } from "@/lib/lead-details";
import { formatOrderNumber } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import { CrewSuggestionsDialog } from "@/components/crew-suggestions-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { JobOrderTicket } from "@/components/job-order-ticket";
import { JobSetupWorkspace } from "@/components/job-setup-workspace";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import MarketplaceSourceFlowStrip from "@/components/MarketplaceSourceFlowStrip";
import MarketplaceProcessGuide from "@/components/MarketplaceProcessGuide";
import { BookingMenuIntelligenceCard } from "@/components/BookingMenuIntelligenceCard";
import { extractBookingMenuIntelligence } from "@/lib/booking-menu-intelligence";
import type { MarketplaceActionPhase } from "@shared/marketplaceShapes";
import type { JobFlow } from "@shared/job-flow";
import { calculateBtcLightningOffer } from "@shared/btcLightningOffer";

interface SquareInvoice {
  id: string;
  squareInvoiceId: string;
  squareInvoiceNumber: string | null;
  status: string;
  amount: string;
  invoiceUrl: string | null;
  customerEmail: string;
  dueDate: string | null;
  paidAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface LeadHistoryEntry {
  id: number;
  lead_id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
}

interface JobAlertDelivery {
  event_id: string;
  recipient_user_id: string | null;
  channel: "in_app" | "push" | "email" | "sms" | "webhook";
  status: "sent" | "failed" | "skipped";
  error_message: string | null;
  attempts: number;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface OrderLineItem {
  id?: string;
  name: string;
  qty: number;
  unitPrice: number;
  total: number;
  category?: string;
}

type LeadQuoteSnapshot = {
  rateCardAutoQuote?: { total?: number; projectedCustomerJcMoves?: number; projectedCrewPoolJcMoves?: number } | null;
  manualQuoteOverride?: { submittedBasePrice?: number; automaticBasePrice?: number; savedAt?: string } | null;
  source?: string | null;
  marketplaceShapeId?: string | null;
  marketplaceShape?: { id?: string | null } | null;
  selectedPackage?: unknown;
  packageId?: string | null;
  packageLabel?: string | null;
  minPrice?: number | string | null;
  maxPrice?: number | string | null;
  crew?: number | string | null;
  hours?: number | string | null;
  requestedItems?: Array<{
    serviceCode?: string | null;
    serviceLabel?: string | null;
    packageId?: string | null;
    packageLabel?: string | null;
    minPrice?: number | string | null;
    maxPrice?: number | string | null;
    crew?: number | string | null;
    hours?: number | string | null;
    details?: Record<string, unknown> | null;
  }>;
  attribution?: {
    source?: string | null;
    referralSlug?: string | null;
    marketingCampaignId?: string | null;
  } | null;
};

interface Lead {
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
  propertySize?: string;
  details?: string;
  source?: string | null;
  quoteSnapshot?: LeadQuoteSnapshot | null;
  zoneSnapshot?: (Record<string, unknown> & {
    preview?: { matched?: boolean; quote?: { minEstimate?: number; maxEstimate?: number; rate?: { hourlyRate?: number; minimumHours?: number } | null } };
  }) | null;
  status: string;
  assignedToUserId?: string;
  createdByUserId?: string;
  truckConfig?: string;
  trailerRequested?: boolean;
  truckProvider?: string;
  truckSize?: string;
  crewSize?: number;
  basePrice?: string;
  totalPrice?: string;
  confirmedDate?: string;
  confirmedFromAddress?: string;
  confirmedToAddress?: string;
  crewMembers?: string[];
  crewLeadUserId?: string | null;
  jobPlanDetails?: {
    stairsFlights?: number;
    hasElevator?: boolean;
    specialItemsNotes?: string;
    additionalStops?: Array<{ address?: string; note?: string }>;
    propertySize?: string;
    bedrooms?: number | null;
    truckSize?: string;
    inventory?: Record<string, unknown>;
    specialItems?: Record<string, unknown>;
  } | null;
  jobAccess?: {
    accessCode?: string;
    entryInstructions?: string;
  } | null;
  crewBonusFlags?: Record<string, boolean>;
  hasHotTub?: boolean;
  hotTubWeight?: number;
  hotTubFee?: string;
  hasHeavySafe?: boolean;
  heavySafeWeight?: number;
  heavySafeFee?: string;
  hasPoolTable?: boolean;
  poolTableWeight?: number;
  poolTableFee?: string;
  hasPiano?: boolean;
  pianoWeight?: number;
  pianoFee?: string;
  totalSpecialItemsFee?: string;
  quoteNotes?: string;
  smsConsent?: boolean;
  smsConsentRecordedAt?: string | null;
  smsConsentSource?: string | null;
  lastQuoteUpdatedAt?: string;
  tokenAllocation?: number;
  confirmedHours?: number;
  orderLineItems?: OrderLineItem[];
  completionRewardedAt?: string;
  checkedInAt?: string;
  completedAt?: string;
  createdAt: string;
  redemptionId?: number;
  appliedCreditNote?: string;
  photos?: Array<{ url: string; mimeType: string; name: string }>;
  quoteSentAt?: string;
  quoteViewedAt?: string;
  arrivalWindow?: string;
  squarePaymentUrl?: string;
  depositRequired?: boolean;
  depositAmount?: string | number | null;
  workerVisibility?: {
    tier: string;
    context: "board" | "claimed" | "assigned" | "task" | "admin";
    customerIdentity: boolean;
    customerContact: boolean;
    exactLocation: boolean;
    jobScope: boolean;
    pricing: boolean;
    payment: boolean;
    privateOperations: boolean;
    locked: Array<{ key: string; label: string; unlockAt: string }>;
  };
  depositPaid?: boolean;
  paymentPaidAt?: string | null;
  paymentPlan?: string | null;
  financialStatus?: string | null;
  isQuoteOnly?: boolean;
  selectedPackageId?: string;
  flow?: JobFlow;
}

interface Reward {
  id: string;
  userId: string;
  rewardType: string;
  tokenAmount: string;
  cashValue: string;
  status: string;
  earnedDate: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
}

interface DisbursementRecord {
  id: string;
  user_id: string;
  reward_type: string;
  token_amount: string;
  cash_value?: string;
  earned_date?: string;
  first_name?: string;
  username?: string;
  metadata?: Record<string, unknown>;
}

interface JcMovesPayoutStatus {
  state: "full_payment_missing" | "completion_missing" | "ready_to_issue" | "pending_customer_claim" | "issued";
  paidInFull: boolean;
  completed: boolean;
  rewardEligibleTotal: number;
  customerPool: number;
  crewPool: number;
  records: Array<{ recipient_type: string; recipient_label: string | null; reward_kind: string; token_amount: string; created_at: string }>;
}

interface OfflineCloseoutResponse {
  success: boolean;
  alreadyRecorded: boolean;
  completion: { ok: boolean; tokensAwarded?: number; error?: string };
  jcmoves: {
    creditedAccountIds: string[];
    creditedAccountCount: number;
    pendingCustomerClaim: boolean;
  };
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  isApproved: boolean;
  status: string;
}

function leadSnapshot(lead: Lead): LeadQuoteSnapshot | null {
  return lead.quoteSnapshot && typeof lead.quoteSnapshot === "object" && !Array.isArray(lead.quoteSnapshot)
    ? lead.quoteSnapshot
    : null;
}

function leadFirstRequestedItem(lead: Lead): NonNullable<LeadQuoteSnapshot["requestedItems"]>[number] | null {
  const snapshot = leadSnapshot(lead);
  return Array.isArray(snapshot?.requestedItems) ? snapshot.requestedItems[0] || null : null;
}

function leadMarketplaceShapeId(lead: Lead): string | null {
  const snapshot = leadSnapshot(lead);
  return snapshot?.marketplaceShapeId || snapshot?.marketplaceShape?.id || null;
}

function leadMarketplaceSource(lead: Lead): string | null {
  const snapshot = leadSnapshot(lead);
  return lead.source || snapshot?.attribution?.source || snapshot?.source || null;
}

function marketplacePhaseForLeadDetail(status: string | null | undefined): MarketplaceActionPhase {
  const normalized = String(status || "").toLowerCase();
  if (["completed", "customer_approved", "payout_calculated", "payout_sent", "closed", "paid"].includes(normalized)) {
    return "finish";
  }
  if (["quote_requested", "new", "chatbot_pending", "deposit_pending"].includes(normalized)) {
    return "start";
  }
  return "progress";
}

type PackageDraft = {
  id: string;
  label: string;
  crew: number | null;
  hours: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  priceLabel?: string | null;
  source: "quoteSnapshot" | "details" | "requestedItem";
};

function numericValue(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function packageDraftFromUnknown(raw: unknown, source: PackageDraft["source"]): PackageDraft | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const nestedDetails = obj.details && typeof obj.details === "object" && !Array.isArray(obj.details)
    ? obj.details as Record<string, unknown>
    : {};
  const id = stringValue(obj.id) || stringValue(obj.packageId) || stringValue(nestedDetails.packageId);
  const label = stringValue(obj.label)
    || stringValue(obj.packageLabel)
    || stringValue(obj.serviceLabel)
    || stringValue(nestedDetails.packageLabel)
    || id;
  if (!id && !label) return null;
  return {
    id: id || label || "selected_package",
    label: label || id || "Selected package",
    crew: numericValue(obj.crew ?? obj.crewSize ?? nestedDetails.crew ?? nestedDetails.crewSize),
    hours: numericValue(obj.hours ?? obj.confirmedHours ?? nestedDetails.hours ?? nestedDetails.confirmedHours),
    minPrice: numericValue(obj.minPrice ?? obj.basePrice ?? obj.unitPrice ?? nestedDetails.minPrice ?? nestedDetails.basePrice),
    maxPrice: numericValue(obj.maxPrice ?? obj.totalPrice ?? obj.price ?? nestedDetails.maxPrice ?? nestedDetails.totalPrice),
    priceLabel: stringValue(obj.priceLabel ?? nestedDetails.priceLabel),
    source,
  };
}

function parseLeadDetailsJson(lead: Lead): Record<string, unknown> | null {
  if (!lead.details) return null;
  try {
    const parsed = JSON.parse(lead.details);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function selectedPackageDraftForLead(lead: Lead): PackageDraft | null {
  const snapshot = leadSnapshot(lead);
  const fromSnapshot = packageDraftFromUnknown(snapshot?.selectedPackage || snapshot, "quoteSnapshot");
  if (fromSnapshot && (fromSnapshot.minPrice || fromSnapshot.maxPrice || fromSnapshot.crew || fromSnapshot.hours)) return fromSnapshot;

  const details = parseLeadDetailsJson(lead);
  const fromDetails = packageDraftFromUnknown(details?.selectedPackage, "details");
  if (fromDetails) return fromDetails;

  const item = leadFirstRequestedItem(lead);
  return packageDraftFromUnknown(item, "requestedItem");
}

function hasSavedQuote(lead: Lead): boolean {
  const price = numericValue(lead.totalPrice ?? lead.basePrice);
  return !!(price && price > 0) || (Array.isArray(lead.orderLineItems) && lead.orderLineItems.length > 0);
}

function packageDraftPrice(draft: PackageDraft): number | null {
  return draft.maxPrice ?? draft.minPrice ?? null;
}

function formatMoney(value: unknown): string {
  const n = numericValue(value);
  return n && n > 0 ? `$${n.toFixed(2)}` : "Not set";
}

function businessDateString(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function normalizeJobDate(value: unknown): string | null {
  const text = String(value || "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : null;
}

function displayStatus(status: string | null | undefined): string {
  return String(status || "new").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isSyntheticOrInvalidEmail(email: string | null | undefined): boolean {
  const value = String(email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return true;
  return /@(?:jconthemove\.local|example\.(?:com|org|net)|test)$/i.test(value);
}

function DisbursementSummaryCard({ lead }: { lead: Lead }) {
  const { data, isLoading } = useQuery<{ records: DisbursementRecord[] }>({
    queryKey: [`/api/leads/${lead.id}/disbursement-summary`],
    enabled: !!lead.completionRewardedAt,
  });

  const records = data?.records ?? [];
  const totalDisburse = records.reduce((s, r) => s + parseFloat(r.token_amount || "0"), 0);
  const crewRecords = records.filter((r) => r.reward_type === "worker_job_completion_bonus" || r.reward_type === "worker_hours_bonus");
  const customerRecords = records.filter((r) => r.reward_type === "loyalty_booking");
  const referralRecords = records.filter((r) => r.reward_type === "referral_confirmed");

  return (
    <Card className="border-amber-500/30 bg-gradient-to-br from-amber-950/30 to-slate-900/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-amber-400">
          <Zap className="h-5 w-5" />
          JCMOVES Disbursement
          <Badge className="ml-auto bg-green-600/30 text-green-300 border-green-500/30 text-[10px]">Complete</Badge>
        </CardTitle>
        <CardDescription className="text-amber-300/60 text-xs">
          Distributed at {lead.completionRewardedAt ? new Date(lead.completionRewardedAt).toLocaleString() : "Unknown"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading records…
          </div>
        ) : records.length === 0 ? (
          <p className="text-xs text-slate-500">No reward records found in database for this lead.</p>
        ) : (
          <>
            {crewRecords.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Crew</p>
                {crewRecords.map((r) => (
                  <div key={r.id} className="flex justify-between text-sm">
                    <span className="text-slate-400 truncate max-w-[60%]">
                      {r.first_name || r.username || `User #${r.user_id}`}{" "}
                      <span className="text-[10px] text-slate-600">({r.reward_type})</span>
                    </span>
                    <span className="text-amber-300 font-bold">{parseFloat(r.token_amount || "0").toLocaleString()} JC</span>
                  </div>
                ))}
              </div>
            )}
            {customerRecords.length > 0 && (
              <div className="pt-1">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Customer</p>
                {customerRecords.map((r) => (
                  <div key={r.id} className="flex justify-between text-sm">
                    <span className="text-slate-400">{r.first_name || r.username || `User #${r.user_id}`}</span>
                    <span className="text-amber-300 font-bold">{parseFloat(r.token_amount || "0").toLocaleString()} JC</span>
                  </div>
                ))}
              </div>
            )}
            {referralRecords.length > 0 && (
              <div className="pt-1">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Referral Bonus</p>
                {referralRecords.map((r) => (
                  <div key={r.id} className="flex justify-between text-sm">
                    <span className="text-slate-400">{r.first_name || r.username || `User #${r.user_id}`}</span>
                    <span className="text-amber-300 font-bold">{parseFloat(r.token_amount || "0").toLocaleString()} JC</span>
                  </div>
                ))}
              </div>
            )}
            <div className="pt-2 border-t border-amber-500/20 flex justify-between text-sm font-semibold">
              <span className="text-slate-400">Total Disbursed</span>
              <span className="text-amber-300">{totalDisburse.toLocaleString()} JCMOVES</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function LeadDetailPage() {
  const [, params] = useRoute("/lead/:id");
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const [tokenAllocation, setTokenAllocation] = useState("");
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [showCrewSuggestions, setShowCrewSuggestions] = useState(false);
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [removeIntent, setRemoveIntent] = useState<"archive" | "delete" | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [invoiceDescription, setInvoiceDescription] = useState("");
  const [invoiceDeliveryMethod, setInvoiceDeliveryMethod] = useState<"email" | "sms" | "both">("email");
  const [orderApplied, setOrderApplied] = useState(false);
  const [showBtcDialog, setShowBtcDialog] = useState(false);
  const [btcAmount, setBtcAmount] = useState("");
  const [btcPaymentLink, setBtcPaymentLink] = useState<string | null>(null);
  const [copiedBtcLink, setCopiedBtcLink] = useState(false);
  const btcOfferPreview = useMemo(() => {
    const amount = Number(btcAmount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return calculateBtcLightningOffer(amount);
  }, [btcAmount]);
  const [selectedCrewMembers, setSelectedCrewMembers] = useState<string[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const { hasAdminAccess, isEmployee } = useAuth();
  const requestedReturnTo = new URLSearchParams(location.includes("?") ? location.slice(location.indexOf("?") + 1) : "").get("returnTo");
  const returnTarget = requestedReturnTo && (requestedReturnTo.startsWith("/crew") || requestedReturnTo.startsWith("/admin"))
    ? requestedReturnTo
    : hasAdminAccess ? "/admin/schedule" : "/crew";

  // Only secondary notes, media, timeline, and rewards live below the job
  // essentials. Quote delivery is a focused dialog from the primary action.
  const [activeTab, setActiveTab] = useState("notes");
  const [showQuoteDeliveryDialog, setShowQuoteDeliveryDialog] = useState(false);
  const [showOfflineCloseoutDialog, setShowOfflineCloseoutDialog] = useState(false);
  const [offlinePaymentMethod, setOfflinePaymentMethod] = useState<"cash" | "check">("cash");
  const [offlinePaymentDate, setOfflinePaymentDate] = useState("");
  const [offlinePaymentReference, setOfflinePaymentReference] = useState("");
  const [offlinePaymentNote, setOfflinePaymentNote] = useState("");
  const [quoteNote, setQuoteNote] = useState("");
  const [quoteDeliveryMethod, setQuoteDeliveryMethod] = useState<"email" | "sms" | "both">("email");
  const [recordSmsConsent, setRecordSmsConsent] = useState(false);
  const [quoteSentAt, setQuoteSentAt] = useState<string | null>(null);
  const [squarePaymentUrl, setSquarePaymentUrl] = useState<string | null>(null);
  const [copiedPaymentLink, setCopiedPaymentLink] = useState(false);
  const [showJobSetup, setShowJobSetup] = useState(true);
  const jobSetupRef = useRef<HTMLDivElement>(null);

  const openJobSetup = (targetId = "job-setup") => {
    setShowJobSetup(true);
    window.setTimeout(() => {
      const target = document.getElementById(targetId) || jobSetupRef.current;
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      target?.querySelector<HTMLElement>("button, input, [tabindex='0']")?.focus({ preventScroll: true });
    }, 0);
  };
  const openJobSetupSchedule = () => openJobSetup("job-setup-schedule");

  const { data: lead, isLoading, isError, error } = useQuery<Lead>({
    queryKey: ["/api/leads", params?.id],
    queryFn: async () => {
      const response = await fetch(`/api/jobs/${params?.id}/flow`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load job");
      return response.json();
    },
    enabled: !!params?.id,
    retry: 1,
    retryDelay: 1000,
    staleTime: 0, // Always fetch fresh data
  });
  
  // If lead returns null (unauthenticated 401→returnNull), clear the leads cache so list updates
  // Note: do NOT invalidate on isError — that causes an infinite refetch loop when access is denied
  useEffect(() => {
    if (lead === null && !isLoading && !isError) {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    }
  }, [lead, isLoading, isError]);

  const { data: rewards = [] } = useQuery<Reward[]>({
    queryKey: ["/api/rewards"],
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
    enabled: hasAdminAccess,
  });

  const { data: jcmovesPayout } = useQuery<JcMovesPayoutStatus>({
    queryKey: ["/api/leads", params?.id, "jcmoves-status"],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${params?.id}/jcmoves-status`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch JCMOVES payout status");
      return res.json();
    },
    enabled: !!params?.id && hasAdminAccess,
  });

  const { data: leadInvoices = [] } = useQuery<SquareInvoice[]>({
    queryKey: ["/api/invoices/lead", params?.id],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/lead/${params?.id}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!params?.id && hasAdminAccess,
    refetchInterval: 60000,
  });

  const { data: leadHistory = [], isLoading: historyLoading } = useQuery<LeadHistoryEntry[]>({
    queryKey: ["/api/leads", params?.id, "history"],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${params?.id}/history`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch history");
      return res.json();
    },
    enabled: !!params?.id,
  });

  const { data: alertDeliveries = [] } = useQuery<JobAlertDelivery[]>({
    queryKey: ["/api/leads", params?.id, "alert-deliveries"],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${params?.id}/alert-deliveries`, { credentials: "include" });
      if (!res.ok) return [];
      const body = await res.json();
      return Array.isArray(body.deliveries) ? body.deliveries : [];
    },
    enabled: !!params?.id && hasAdminAccess,
    refetchInterval: 60_000,
  });

  const packageDraft = useMemo(() => lead ? selectedPackageDraftForLead(lead) : null, [lead]);
  const leadHasQuote = lead ? hasSavedQuote(lead) : false;

  // Keep local delivery and crew state aligned with the saved job.
  useEffect(() => {
    if (lead) {
      const members = lead.crewMembers || [];
      setSelectedCrewMembers(members);
      setQuoteSentAt(lead.quoteSentAt || null);
      setSquarePaymentUrl(lead.squarePaymentUrl || null);
      setQuoteDeliveryMethod(isSyntheticOrInvalidEmail(lead.email) && !!lead.phone ? "sms" : "email");
      setInvoiceDeliveryMethod(isSyntheticOrInvalidEmail(lead.email) && !!lead.phone ? "sms" : "email");
      setRecordSmsConsent(false);
    }
  }, [lead]);

  const updateLead = useMutation({
    mutationFn: async (data: Partial<Lead>) => {
      return await apiRequest("PATCH", `/api/leads/${params?.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/planner"] });
      toast({
        title: "Success",
        description: "Lead updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update lead",
        variant: "destructive",
      });
    },
  });

  const claimJobMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/jobs/${params?.id}/claim`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/planner"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flow"] });
      toast({ title: "Job claimed", description: "Admin will confirm the crew and dispatch the job." });
    },
    onError: (error: Error) => {
      toast({ title: "Could not claim job", description: error.message || "Please try again.", variant: "destructive" });
    },
  });

  const archiveLeadMutation = useMutation({
    mutationFn: async (intent: "archive" | "delete" = "archive") => {
      void intent;
      return await apiRequest("DELETE", `/api/leads/${params?.id}`);
    },
    onSuccess: (_response, intent) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/archived"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/planner"] });
      toast({
        title: intent === "delete" ? "Lead removed" : "Lead archived",
        description: "It was removed from active jobs and can be restored from Archived.",
      });
      setShowArchiveDialog(false);
      setRemoveIntent(null);
      setLocation(returnTarget);
    },
    onError: (error: Error) => {
      toast({ title: "Archive failed", description: error.message || "Could not archive this lead.", variant: "destructive" });
    },
  });

  const applyPackageDraftMutation = useMutation({
    mutationFn: async () => {
      if (!packageDraft) throw new Error("No selected package was found for this lead.");
      const price = packageDraftPrice(packageDraft);
      if (!price || price <= 0) throw new Error("Selected package does not include a usable price.");
      const lineItem: OrderLineItem = {
        id: packageDraft.id,
        name: packageDraft.label,
        qty: 1,
        unitPrice: price,
        total: price,
        category: "package",
      };
      return await apiRequest("PATCH", `/api/leads/${params?.id}/quote`, {
        basePrice: price.toFixed(2),
        crewSize: packageDraft.crew || lead?.crewSize || 2,
        confirmedHours: Math.max(2, packageDraft.hours || lead?.confirmedHours || 2),
        ...(lead?.confirmedDate ? { confirmedDate: lead.confirmedDate } : {}),
        ...(lead?.arrivalWindow ? { arrivalWindow: lead.arrivalWindow } : {}),
        selectedPackageId: packageDraft.id,
        orderLineItems: [lineItem],
        quoteNotes: [
          lead?.quoteNotes,
          `Package draft confirmed: ${packageDraft.label}${packageDraft.priceLabel ? ` (${packageDraft.priceLabel})` : ""}.`,
        ].filter(Boolean).join("\n"),
      });
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/planner"] });
      toast({ title: "Package quote ready", description: "Review it, then send the quote and invoice when ready." });
    },
    onError: (error: Error) => {
      toast({ title: "Package draft failed", description: error.message || "Could not build the package quote.", variant: "destructive" });
    },
  });

  const sendQuoteMutation = useMutation({
    mutationFn: async (deliveryMethod: "email" | "sms" | "both") => {
      return await apiRequest("POST", `/api/leads/${params?.id}/send-quote`, {
        message: quoteNote || undefined,
        deliveryMethod,
        recordSmsConsent: (deliveryMethod === "sms" || deliveryMethod === "both") ? recordSmsConsent : undefined,
      });
    },
    onSuccess: async (res) => {
      const data = await res.json();
      setQuoteSentAt(data.quoteSentAt);
      if (data.paymentUrl) setSquarePaymentUrl(data.paymentUrl);
      setShowQuoteDeliveryDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id, "history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id, "jcmoves-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/planner"] });
      const invoiceNote = data.squareInvoiceCreated ? " + invoice" : "";
      toast({
        title: `Quote${invoiceNote} sent!`,
        description: `Email: ${data.emailSent ? "sent" : "not sent"} - Text: ${data.smsSent ? "sent" : "not sent"}${data.paymentUrl ? " - pay link included" : ""}`,
      });
    },
    onError: (error: Error) => {
      let msg = error?.message || "Failed to send quote";
      try {
        const jsonStart = msg.indexOf("{");
        if (jsonStart !== -1) {
          const parsed = JSON.parse(msg.slice(jsonStart));
          if (parsed?.error) msg = parsed.error;
        }
      } catch (_) {}
      toast({ title: "Send failed", description: msg, variant: "destructive" });
    },
  });

  const createInvoiceMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(invoiceAmount);
      if (!amount || amount <= 0) throw new Error("Please enter a valid amount");
      if (lead?.orderLineItems && lead.orderLineItems.length > 0) {
        return await apiRequest("POST", `/api/square/invoice-lead/${params?.id}`, {
          lineItems: lead.orderLineItems,
          deliveryMethod: invoiceDeliveryMethod,
          recordSmsConsent: (invoiceDeliveryMethod === "sms" || invoiceDeliveryMethod === "both") ? recordSmsConsent : undefined,
        });
      }
      return await apiRequest("POST", `/api/invoices/lead/${params?.id}`, {
        amount,
        description: invoiceDescription || `${lead?.serviceType} - ${lead?.firstName} ${lead?.lastName}`,
        deliveryMethod: invoiceDeliveryMethod,
        recordSmsConsent: (invoiceDeliveryMethod === "sms" || invoiceDeliveryMethod === "both") ? recordSmsConsent : undefined,
      });
    },
    onSuccess: async (response) => {
      const data = await response.json();
      const deliveryDesc = invoiceDeliveryMethod === "both"
        ? "Invoice sent by email and text message."
        : invoiceDeliveryMethod === "sms"
          ? "Invoice sent by text message."
          : "Invoice sent by email.";
      toast({
        title: "Invoice Sent!",
        description: data.invoiceUrl
          ? deliveryDesc
          : "Invoice created successfully.",
      });
      setShowInvoiceDialog(false);
      setInvoiceAmount("");
      setInvoiceDescription("");
      setInvoiceDeliveryMethod("email");
      setRecordSmsConsent(false);
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/lead", params?.id] });
      if (data.invoiceUrl) {
        window.open(data.invoiceUrl, '_blank');
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create invoice",
        description: error.message || "Something went wrong",
        variant: "destructive",
      });
    },
  });

  const createBtcPaymentMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(btcAmount);
      if (!amount || amount <= 0) throw new Error("Please enter a valid amount");
      if (!lead) throw new Error("Lead not found");
      const response = await apiRequest("POST", `/api/crypto/lightning/job-checkout/${lead.id}`, {
        originalAmountUsd: amount,
      });
      return response.json();
    },
    onSuccess: (data) => {
      setBtcPaymentLink(data.checkoutUrl);
      toast({ title: "Bitcoin Lightning checkout created!", description: "Share the secure checkout link with the customer." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create Lightning checkout", description: error.message, variant: "destructive" });
    },
  });

  const advanceToStep = useMutation({
    mutationFn: async (targetStep: number) => {
      let newStatus: string | null = null;
      let nonStatusData: Record<string, unknown> = {};
      switch (targetStep) {
        case 2:
          newStatus = "available";
          if (tokenAllocation) nonStatusData.tokenAllocation = parseFloat(tokenAllocation);
          nonStatusData.crewMembers = selectedCrewMembers;
          nonStatusData.crewSize = computeEffectiveCrewSize();
          break;
        case 3:
          newStatus = "in_progress";
          break;
        case 4:
          newStatus = "completed";
          nonStatusData.completedAt = new Date().toISOString();
          break;
      }
      if (Object.keys(nonStatusData).length > 0) {
        await apiRequest("PATCH", `/api/leads/${params?.id}`, nonStatusData);
      }
      if (newStatus) {
        return await apiRequest("PATCH", `/api/leads/${params?.id}/status`, { status: newStatus });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id, "history"] });
      toast({ title: "Step completed", description: "Job workflow advanced successfully" });
      setIsCheckingIn(false);
    },
    onError: (error: Error) => {
      let msg = error?.message || "Failed to advance step";
      try {
        const jsonStart = msg.indexOf("{");
        if (jsonStart !== -1) {
          const parsed = JSON.parse(msg.slice(jsonStart));
          if (parsed?.error) msg = parsed.error;
        }
      } catch (_) {}
      toast({ title: "Step blocked", description: msg, variant: "destructive" });
    },
  });

  const sendReminder = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/leads/${params?.id}/reminder`, {});
    },
    onSuccess: () => {
      toast({ title: "Reminder sent", description: "Customer has been notified about tomorrow's move" });
    },
  });

  const updateStatus = useMutation({
    mutationFn: async (newStatus: string) => {
      return await apiRequest("PATCH", `/api/leads/${params?.id}/status`, { status: newStatus });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id, "history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id, "jcmoves-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/planner"] });
      toast({ title: "Status updated", description: "Lead pipeline stage advanced." });
    },
    onError: (error: Error) => {
      let msg = error?.message || "Failed to update status";
      try {
        const jsonStart = msg.indexOf("{");
        if (jsonStart !== -1) {
          const parsed = JSON.parse(msg.slice(jsonStart));
          if (parsed?.error) msg = parsed.error;
        }
      } catch (_) {}
      toast({ title: "Transition blocked", description: msg, variant: "destructive" });
    },
  });

  const markAsPaidMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/leads/${params?.id}/mark-paid`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id, "history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id, "jcmoves-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/planner"] });
      toast({ title: "Dispatched!", description: "Job marked as paid and crew SMS sent." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to dispatch", variant: "destructive" });
    },
  });

  const offlineCloseoutMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/leads/${params?.id}/record-offline-payment`, {
        method: offlinePaymentMethod,
        paidDate: offlinePaymentDate,
        reference: offlinePaymentReference.trim() || null,
        note: offlinePaymentNote.trim() || null,
        completeJob: true,
      });
      return await response.json() as OfflineCloseoutResponse;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id, "history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id, "jcmoves-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/planner"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rewards"] });
      setShowOfflineCloseoutDialog(false);
      const accountText = `${data.jcmoves.creditedAccountCount} linked account${data.jcmoves.creditedAccountCount === 1 ? "" : "s"}`;
      toast({
        title: data.completion.ok ? "Paid job closed out" : "Paid job closed; JCMOVES needs review",
        description: data.completion.ok
          ? `Payment and completion were recorded. JCMOVES was credited to ${accountText}${data.jcmoves.pendingCustomerClaim ? "; the customer portion is safely held for account claim" : ""}.`
          : `Payment and completion were recorded, but JCMOVES issuance needs a safe retry: ${data.completion.error || "unknown error"}`,
        variant: data.completion.ok ? "default" : "destructive",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not close out this job",
        description: error.message || "Failed to record the offline payment",
        variant: "destructive",
      });
    },
  });

  const retryDisbursementMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/leads/${params?.id}/retry-disbursement`, {}),
    onSuccess: async (response) => {
      const data = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id, "jcmoves-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rewards/lead", params?.id] });
      toast({ title: "JCMOVES payout checked", description: data.note || "Missing eligible awards were issued safely." });
    },
    onError: (error: Error) => {
      toast({ title: "Could not retry JCMOVES payout", description: error.message, variant: "destructive" });
    },
  });

  const markDepositReceivedMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/leads/${params?.id}/mark-deposit-received`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id, "history"] });
      toast({ title: "Deposit confirmed!", description: "Customer notified via SMS." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to confirm deposit", variant: "destructive" });
    },
  });

  const computeEffectiveCrewSize = () => Math.max(1, selectedCrewMembers.length);

  const handleJobSetupSaved = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id] });
    queryClient.invalidateQueries({ queryKey: ["/api/jobs/planner"] });
    queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id, "alert-deliveries"] });
  };

  const handleOrderApply = (orderData: {
    basePrice: string;
    totalPrice: string;
    crewSize: number;
    confirmedHours: number;
    quoteNotes: string;
    hasHotTub: boolean;
    hotTubFee: string;
    hasHeavySafe: boolean;
    heavySafeFee: string;
    hasPoolTable: boolean;
    poolTableFee: string;
    hasPiano: boolean;
    pianoFee: string;
    totalSpecialItemsFee: string;
    lineItems: OrderLineItem[];
    zoneSnapshot?: Record<string, unknown>;
  }) => {
    updateLead.mutate({
      ...orderData,
      orderLineItems: orderData.lineItems,
      lastQuoteUpdatedAt: new Date().toISOString(),
    }, {
      onSuccess: () => {
        setOrderApplied(true);
        const price = orderData.totalPrice;
        setInvoiceAmount(price ? parseFloat(price).toString() : "");
        setInvoiceDescription(`${lead?.serviceType} - ${lead?.firstName} ${lead?.lastName}`);
        toast({ title: "Order applied!", description: `$${parseFloat(orderData.totalPrice).toFixed(2)} total saved to job.` });
      }
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md w-full" data-testid="card-loading">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
              <p className="text-muted-foreground">Loading job details...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError || !lead) {
    const errorMessage = error?.message || "Lead not found";
    const isNotFound = errorMessage.includes("404") || !lead;
    
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full" data-testid="card-error">
          <CardHeader>
            <CardTitle className="text-center">
              {isNotFound ? "Job Not Found" : "Error Loading Job"}
            </CardTitle>
            <CardDescription className="text-center">
              {isNotFound 
                ? "This job may have been deleted or doesn't exist."
                : "We couldn't load this job. Please try again."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!isNotFound && (
              <p className="text-sm text-muted-foreground text-center bg-muted p-3 rounded">
                {errorMessage}
              </p>
            )}
            <div className="flex flex-col gap-2">
              <Button 
                className="w-full" 
                onClick={() => setLocation(returnTarget)}
                data-testid="button-back-to-leads"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to All Jobs
              </Button>
              {!isNotFound && (
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={() => window.location.reload()}
                  data-testid="button-retry"
                >
                  Try Again
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Calculate potential earnings
  const baseReward = 100; // points
  const baseTokens = 500; // JCMOVES
  const onTimeBonus = 0.2; // 20%
  const ratingBonus = 0.3; // 30% for 4.0+ rating
  
  const potentialEarnings = {
    base: { points: baseReward, tokens: baseTokens },
    withOnTime: { 
      points: Math.round(baseReward * (1 + onTimeBonus)), 
      tokens: Math.round(baseTokens * (1 + onTimeBonus)) 
    },
    withRating: { 
      points: Math.round(baseReward * (1 + ratingBonus)), 
      tokens: Math.round(baseTokens * (1 + ratingBonus)) 
    },
    withBoth: { 
      points: Math.round(baseReward * (1 + onTimeBonus + ratingBonus)), 
      tokens: Math.round(baseTokens * (1 + onTimeBonus + ratingBonus)) 
    },
  };
  const customerMediaLink = extractCustomerMediaLink(lead.details);

  // Filter rewards related to this lead
  const leadRewards = rewards.filter(r => r.referenceId === lead.id);
  const pendingRewards = leadRewards.filter(r => r.status === "pending");
  const creditedRewards = leadRewards.filter(r => r.status === "confirmed");

  const serviceTypeBadge = () => {
    switch (lead.serviceType) {
      case "residential": return "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200";
      case "commercial": return "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200";
      case "junk": return "bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200";
      default: return "bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200";
    }
  };

  // 4-step workflow system (matches enforced pipeline)
  const workflow = [
    { step: 1, name: "Quote Requested", status: ["quote_requested"] },
    { step: 2, name: "Job Available", status: ["available"] },
    { step: 3, name: "In Progress", status: ["in_progress"] },
    { step: 4, name: "Completed", status: ["completed"] }
  ];

  const getCurrentStep = () => {
    if (!lead) return 1;
    if (lead.status === "completed" || lead.status === "paid") return 4;
    if (lead.status === "in_progress") return 3;
    if (lead.status === "available") return 2;
    return 1;
  };

  const currentStep = getCurrentStep();
  const marketplaceFirstItem = leadFirstRequestedItem(lead);
  const marketplaceShapeId = leadMarketplaceShapeId(lead);
  const marketplaceAudience: "customer" | "worker" | "company" = hasAdminAccess ? "company" : isEmployee ? "worker" : "customer";
  const marketplacePhase = marketplacePhaseForLeadDetail(lead.status);
  const marketplaceServiceCode = marketplaceFirstItem?.serviceCode || lead.serviceType;
  const fallbackMarketplaceServiceLabel =
    marketplaceFirstItem?.serviceLabel || lead.serviceType?.replace(/_/g, " ") || "Service";
  const menuIntelligence = extractBookingMenuIntelligence(lead.quoteSnapshot, fallbackMarketplaceServiceLabel);
  const marketplaceSource = menuIntelligence?.sourceSignal || leadMarketplaceSource(lead);
  const marketplaceServiceLabel = menuIntelligence?.serviceLabel || fallbackMarketplaceServiceLabel;

  const handlePhotoUpload = async (files: FileList) => {
    if (!files.length) return;
    const existingCount = lead?.photos?.length ?? 0;
    if (existingCount + files.length > 10) {
      toast({ title: "Max 10 photos", description: "Only 10 photos allowed per job.", variant: "destructive" });
      return;
    }
    setPhotoUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(`/api/leads/${params?.id}/upload`, { method: "POST", body: formData, credentials: "include" });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Upload failed");
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/leads", params?.id] });
      toast({ title: "Photos uploaded!", description: "Photos saved to this job." });
    } catch {
      toast({ title: "Upload failed", description: "Could not upload photo. Try again.", variant: "destructive" });
    } finally {
      setPhotoUploading(false);
    }
  };

  const requestReview = (platform: string) => {
    const customerEmail = lead?.email;
    const customerName = `${lead?.firstName} ${lead?.lastName}`;
    
    let url = "";
    switch (platform) {
      case "google":
        // JC ON THE MOVE Google review URL
        url = "https://www.google.com/search?q=jc+on+the+move&rlz=1C1GCEU_enUS832US832#lrd=0x8823f6fa63b16c07:0x9c6a4b3d4e5f6c8a,3";
        break;
      case "facebook":
        // JC ON THE MOVE Facebook reviews
        url = "https://www.facebook.com/JCOnTheMove/reviews";
        break;
      case "inapp":
        // This would open an in-app review modal
        toast({
          title: "Review request sent",
          description: "Customer will receive an in-app review request",
        });
        return;
    }
    
    if (url) {
      window.open(url, "_blank");
    }
  };

  const statusKey = lead.status === "confirmed" ? "available" : String(lead.status || "new").toLowerCase();
  const quoteSent = Boolean(quoteSentAt || lead.quoteSentAt || lead.squarePaymentUrl || squarePaymentUrl);
  const packageDraftReady = Boolean(packageDraft && !leadHasQuote);
  const packagePrice = packageDraft ? packageDraftPrice(packageDraft) : null;
  const selectedCrewNames = (lead.crewMembers || [])
    .map(id => employees.find(e => e.id === id))
    .filter(Boolean)
    .map(emp => `${emp!.firstName || ""} ${emp!.lastName || ""}`.trim() || emp!.email);
  const rewardCrewIds = Array.from(new Set([
    ...(lead.crewMembers || []),
    ...(lead.assignedToUserId ? [lead.assignedToUserId] : []),
  ].filter(Boolean)));
  const rewardCrewNames = rewardCrewIds.map((id) => {
    const employee = employees.find((candidate) => candidate.id === id);
    return employee
      ? `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || employee.email
      : `Assigned account ${id.slice(0, 8)}`;
  });
  const scheduledJobDate = normalizeJobDate(lead.confirmedDate || lead.moveDate);
  const currentBusinessDate = businessDateString();
  const isPastScheduledJob = Boolean(scheduledJobDate && scheduledJobDate < currentBusinessDate);
  const paymentRecorded = Boolean(lead.paymentPaidAt)
    || ["fully_paid", "wallet_paid"].includes(String(lead.flow?.payment?.key || ""));
  const canCloseOutPastJob = hasAdminAccess
    && isPastScheduledJob
    && !paymentRecorded
    && ["confirmed", "available", "assigned", "accepted", "dispatched", "in_progress", "completed"].includes(statusKey);
  const openOfflineCloseout = () => {
    setOfflinePaymentMethod("cash");
    setOfflinePaymentDate(scheduledJobDate || currentBusinessDate);
    setOfflinePaymentReference("");
    setOfflinePaymentNote("");
    setShowOfflineCloseoutDialog(true);
  };
  // Keep the default view intentionally small. The detailed workflow below remains
  // the source of truth for editing, quoting, payment, media, and payout controls.
  const jobBrief = (() => {
    const address = String(lead.confirmedFromAddress || lead.fromAddress || "").trim();
    const date = String(lead.confirmedDate || lead.moveDate || "").trim();
    const arrivalWindow = String(lead.arrivalWindow || "").trim();
    const configuredCrewSize = Number(lead.crewSize);
    const assignedCrewSize = lead.crewMembers?.length || 0;
    const crewSize = Number.isFinite(configuredCrewSize) && configuredCrewSize > 0
      ? configuredCrewSize
      : assignedCrewSize || null;
    const confirmedHours = Number(lead.confirmedHours);
    const packageHours = Number(packageDraft?.hours);
    const expectedHours = Number.isFinite(confirmedHours) && confirmedHours > 0
      ? confirmedHours
      : Number.isFinite(packageHours) && packageHours > 0
        ? packageHours
        : null;

    return {
      address,
      email: String(lead.email || "").trim() || null,
      phone: String(lead.phone || "").trim() || null,
      schedule: [date, arrivalWindow].filter(Boolean).join(" · ") || "TBD",
      crewSize,
      expectedHours,
      notesPreview: customerNotesFromDetails(lead.details) || null,
      photos: lead.photos || [],
    };
  })();
  const actionPending = updateStatus.isPending
    || markAsPaidMutation.isPending
    || offlineCloseoutMutation.isPending
    || sendQuoteMutation.isPending
    || applyPackageDraftMutation.isPending;
  const nextStep = (() => {
    if (canCloseOutPastJob) {
      return {
        key: "offline_closeout",
        title: "Past job needs closeout",
        detail: rewardCrewIds.length > 0
          ? "Record the cash or check payment, complete the job, and credit JCMOVES without sending a late dispatch."
          : "Assign the crew accounts that performed this job, then record payment so JCMOVES goes to the right users.",
        button: "Close Out Past Job",
        icon: CheckCircle,
      };
    }
    if (statusKey === "completed" && hasAdminAccess) {
      return {
        key: "review_payout",
        title: "Payout review ready",
        detail: "Review and approve the completed job payout before worker payment and JCMOVES issuance.",
        button: "Review Payout",
        icon: Award,
      };
    }
    if (statusKey === "completed" || statusKey === "customer_approved" || statusKey === "payout_calculated" || statusKey === "payout_sent" || statusKey === "closed") {
      return {
        key: "done",
        title: "Job complete",
        detail: "This job is finished. Review payout and rewards in Advanced if needed.",
        button: "Complete",
        icon: CheckCircle,
      };
    }
    if (statusKey === "in_progress") {
      return {
        key: "complete",
        title: "Finish the job",
        detail: "Mark complete when the work is done so rewards and completion steps can run.",
        button: "Complete Job",
        icon: CheckCircle,
      };
    }
    if (["dispatched", "accepted"].includes(statusKey) || (statusKey === "available" && !leadHasQuote)) {
      return {
        key: "start",
        title: "Crew can start",
        detail: "The job is ready for field work. Start it when the crew is heading into execution.",
        button: "Start Job",
        icon: PlayCircle,
      };
    }
    if (statusKey === "paid" || ((statusKey === "quoted" || statusKey === "available") && quoteSent)) {
      return {
        key: "dispatch",
        title: "Payment is ready",
        detail: "Mark paid and dispatch assigned crew. This sends the crew/customer dispatch notifications.",
        button: "Mark Paid & Dispatch",
        icon: Zap,
      };
    }
    if (leadHasQuote) {
      return {
        key: "send_quote",
        title: "Quote is ready",
        detail: "Send the quote and Square invoice when the plan looks right.",
        button: quoteSent ? "Re-send Quote & Invoice" : "Send Quote & Invoice",
        icon: Send,
      };
    }
    if (packageDraftReady) {
      return {
        key: "apply_package",
        title: "Package selected",
        detail: `Confirm ${packageDraft!.label}${packagePrice ? ` at ${formatMoney(packagePrice)}` : ""} as the draft quote.`,
        button: "Use Package Quote",
        icon: ShoppingBag,
      };
    }
    return {
      key: "build_quote",
      title: "Build the quote",
      detail: "Set the price, crew, hours, and schedule before sending anything to the customer.",
      button: "Build Quote",
      icon: DollarSign,
    };
  })();

  const handleNextStep = () => {
    switch (nextStep.key) {
      case "apply_package":
        applyPackageDraftMutation.mutate();
        break;
      case "build_quote":
        openJobSetup();
        break;
      case "send_quote":
        setShowQuoteDeliveryDialog(true);
        break;
      case "offline_closeout":
        openOfflineCloseout();
        break;
      case "dispatch":
        markAsPaidMutation.mutate();
        break;
      case "start":
        updateStatus.mutate("in_progress");
        break;
      case "complete":
        updateStatus.mutate("completed");
        break;
      case "review_payout":
        setLocation("/admin/job-payouts");
        break;
      default:
        break;
    }
  };

  const NextIcon = nextStep.icon;
  const canClaimJob = Boolean(isEmployee && !hasAdminAccess && lead.flow?.canClaim);
  const ticketAction = canClaimJob ? (
    <Button
      size="sm"
      onClick={() => claimJobMutation.mutate()}
      disabled={claimJobMutation.isPending}
      className="bg-cyan-500 font-bold text-slate-950 hover:bg-cyan-400"
      data-testid="button-claim-job-ticket"
    >
      {claimJobMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Users className="mr-1.5 h-4 w-4" />}
      Claim job
    </Button>
  ) : hasAdminAccess ? (
    <Button
      size="sm"
      onClick={handleNextStep}
      disabled={actionPending || nextStep.key === "done" || (nextStep.key === "send_quote" && !leadHasQuote)}
      className="bg-cyan-500 font-bold text-slate-950 hover:bg-cyan-400"
      data-testid="button-job-ticket-next-step"
    >
      {actionPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <NextIcon className="mr-1.5 h-4 w-4" />}
      {nextStep.button}
    </Button>
  ) : null;
  const savedZonePreview = lead.zoneSnapshot?.preview;
  const savedZoneEstimate = savedZonePreview?.quote;
  const hasSavedZoneEstimate = Number.isFinite(Number(savedZoneEstimate?.minEstimate)) && Number.isFinite(Number(savedZoneEstimate?.maxEstimate));
  const savedZoneEstimateLabel = hasSavedZoneEstimate
    ? `$${Math.round(Number(savedZoneEstimate?.minEstimate))}–$${Math.round(Number(savedZoneEstimate?.maxEstimate))}`
    : null;
  const truckProviderLabel = lead.truckProvider === "jc_on_the_move" ? "JC ON THE MOVE truck"
    : lead.truckProvider === "rental_uhaul" ? "Rental / U-Haul"
      : lead.truckProvider === "customer" ? "Customer truck"
        : lead.truckProvider === "none" ? "No truck needed" : null;
  const latestInvoice = [...leadInvoices]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const paymentConfirmed = ["paid", "dispatched", "in_progress", "completed", "customer_approved", "payout_calculated", "payout_sent", "closed"].includes(statusKey)
    && Boolean(lead.depositPaid);
  const paymentState = paymentConfirmed || Boolean(latestInvoice?.paidAt)
    ? "Paid"
    : lead.depositPaid
      ? "Deposit paid"
      : latestInvoice
        ? `Invoice ${latestInvoice.status.replace(/_/g, " ")}`
        : squarePaymentUrl || lead.squarePaymentUrl
          ? "Payment link ready"
          : quoteSent
            ? "Quote sent"
            : leadHasQuote
              ? "Quote ready"
              : "No quote yet";
  const jcmovesState = jcmovesPayout?.state === "issued"
    ? "JCMOVES issued"
    : jcmovesPayout?.state === "pending_customer_claim"
      ? "Customer JCMOVES held for signup"
      : jcmovesPayout?.state === "full_payment_missing"
        ? "Waiting for full payment"
        : jcmovesPayout?.state === "completion_missing"
          ? "Waiting for job completion"
          : jcmovesPayout?.state === "ready_to_issue"
            ? "JCMOVES ready to issue"
            : lead.completionRewardedAt || creditedRewards.length > 0
              ? "JCMOVES issued"
              : pendingRewards.length > 0
                ? "JCMOVES pending"
                : statusKey === "completed"
                  ? "Payout review pending"
                  : "Not issued";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation(returnTarget)}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
              data-testid="button-back-to-leads"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCrewSuggestions(true)}
                data-testid="button-crew-suggestions"
                className="flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Crew Suggestions
              </Button>
              {hasAdminAccess && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRemoveIntent("archive");
                    setShowArchiveDialog(true);
                  }}
                  data-testid="button-remove-lead"
                  className="text-muted-foreground hover:text-red-300"
                  title="Remove job request"
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Remove job request</span>
                </Button>
              )}
              <Button size="sm" onClick={() => openJobSetup()} data-testid="button-edit">
                Set up job
              </Button>
            </div>
          </div>
          
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground">
              {lead.workerVisibility?.customerIdentity === false
                ? "Customer details protected"
                : `${lead.firstName || ""} ${lead.lastName || ""}`.trim()}
            </h1>
            {lead.orderNumber != null && (
              <button
                onClick={() => navigator.clipboard.writeText(formatOrderNumber(lead.orderNumber!))}
                className="flex items-center gap-1.5 text-sm font-mono font-semibold text-blue-300 border border-blue-500/30 rounded-md px-2 py-1 hover:bg-blue-500/10 transition-colors"
                title="Click to copy order number"
              >
                <Hash className="h-3.5 w-3.5" />
                {formatOrderNumber(lead.orderNumber)}
                <Copy className="h-3 w-3 opacity-60" />
              </button>
            )}
            <Badge className={serviceTypeBadge()}>
              {lead.serviceType === "residential" && "Residential"}
              {lead.serviceType === "commercial" && "Commercial"}
              {lead.serviceType === "junk" && "Junk Removal"}
              {!["residential", "commercial", "junk"].includes(lead.serviceType) && lead.serviceType}
            </Badge>
            <Badge className={lead.status === "paid" ? "bg-green-600 text-white" : lead.status === "completed" ? "" : ""} variant={lead.status === "completed" ? "default" : "secondary"}>
              {lead.status === "paid" ? "Paid (Confirmed)" : lead.status.charAt(0).toUpperCase() + lead.status.slice(1).replace(/_/g, " ")}
            </Badge>
          </div>

          {lead.workerVisibility && lead.workerVisibility.locked.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3" data-testid="worker-order-visibility-notice">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-200">
                <LockKeyhole className="h-4 w-4" />
                Order details are limited for your {lead.workerVisibility.tier} authority level
              </p>
              <p className="mt-1 text-xs text-amber-100/80">
                {lead.workerVisibility.locked.slice(0, 3).map((item) => `${item.label}: ${item.unlockAt}`).join(" · ")}
              </p>
            </div>
          )}

          {/* Reward Credit Banner */}
          {lead.appliedCreditNote && (
            <div className="mt-3 p-3 rounded-xl border border-orange-500/40 bg-orange-500/10 flex items-start gap-3">
              <span className="text-xl">🎁</span>
              <div>
                <p className="font-semibold text-orange-400 text-sm mb-0.5">JCMOVES Reward Applied</p>
                <p className="text-sm text-foreground/80">{lead.appliedCreditNote}</p>
              </div>
            </div>
          )}
        </div>

        <JobOrderTicket
          order={lead}
          viewer={hasAdminAccess ? "admin" : "crew"}
          action={canClaimJob ? ticketAction : undefined}
          onScheduleEdit={hasAdminAccess ? openJobSetupSchedule : undefined}
          className="mb-4"
        />

        <Card className="mb-4 border-blue-500/30 bg-blue-950/10">
          <CardContent className="pt-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3 min-w-0">
                <div className="h-10 w-10 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
                  <NextIcon className="h-5 w-5 text-blue-300" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">Next Step</p>
                  <h2 className="text-lg font-bold text-foreground">{nextStep.title}</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">{nextStep.detail}</p>
                  {packageDraftReady && (
                    <p className="text-xs text-emerald-300 mt-2">
                      Package: {packageDraft?.label} {packagePrice ? `- ${formatMoney(packagePrice)}` : ""}
                    </p>
                  )}
                </div>
              </div>
              <Button
                onClick={handleNextStep}
                disabled={actionPending || nextStep.key === "done" || (nextStep.key === "send_quote" && !leadHasQuote)}
                className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white"
                data-testid="button-primary-next-step"
              >
                {actionPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <NextIcon className="h-4 w-4 mr-2" />}
                {nextStep.button}
              </Button>
            </div>
            {nextStep.key === "apply_package" && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full sm:w-auto"
                onClick={() => openJobSetup()}
              >
                <DollarSign className="h-4 w-4 mr-2" />
                Adjust Manually Instead
              </Button>
            )}
          </CardContent>
        </Card>

        {showJobSetup && (
          <div ref={jobSetupRef}>
            <JobSetupWorkspace
              lead={lead}
              employees={employees}
              canManageSetup={hasAdminAccess}
              onSaved={handleJobSetupSaved}
            />
          </div>
        )}

        <details className="group mb-4 rounded-xl border border-border bg-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            More job details
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
        <Card className="border-0 shadow-none" data-testid="job-brief">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Job Brief</CardTitle>
                <CardDescription>What the crew needs to act now.</CardDescription>
              </div>
              <Badge variant="secondary" className="shrink-0 capitalize">
                {lead.status.replace(/_/g, " ")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex min-w-0 items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Address</p>
                  {jobBrief.address ? (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(jobBrief.address)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-start gap-1 text-sm font-medium hover:underline"
                      data-testid="link-job-brief-map"
                    >
                      <span className="break-words">{jobBrief.address}</span>
                      <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </a>
                  ) : (
                    <p className="text-sm font-medium text-muted-foreground">Address TBD</p>
                  )}
                </div>
              </div>
              <div className="flex min-w-0 items-start gap-3">
                <Phone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Phone</p>
                  {jobBrief.phone ? (
                    <>
                      <p className="text-sm font-medium">{jobBrief.phone}</p>
                      <div className="mt-1.5 flex gap-2">
                        <a href={`tel:${jobBrief.phone}`} className="text-xs font-medium text-blue-400 hover:underline" data-testid="link-job-brief-call">Call</a>
                        <a href={`sms:${jobBrief.phone}`} className="text-xs font-medium text-green-400 hover:underline" data-testid="link-job-brief-text">Text</a>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm font-medium text-muted-foreground">Not provided</p>
                  )}
                </div>
              </div>
              {jobBrief.email && (
                <div className="flex min-w-0 items-start gap-3">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Email</p>
                    <a href={`mailto:${jobBrief.email}`} className="block truncate text-sm font-medium hover:underline" data-testid="link-job-brief-email">{jobBrief.email}</a>
                  </div>
                </div>
              )}
              <div className="flex min-w-0 items-start gap-3">
                <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Date & time</p>
                  <p className="break-words text-sm font-medium">{jobBrief.schedule}</p>
                </div>
              </div>
              <div className="flex min-w-0 items-start gap-3">
                <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Crew size</p>
                  <p className="text-sm font-medium">{jobBrief.crewSize ? `${jobBrief.crewSize} mover${jobBrief.crewSize === 1 ? "" : "s"}` : "Crew TBD"}</p>
                </div>
              </div>
              <div className="flex min-w-0 items-start gap-3">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Expected hours</p>
                  <p className="text-sm font-medium">{jobBrief.expectedHours ? `${jobBrief.expectedHours} hour${jobBrief.expectedHours === 1 ? "" : "s"}` : "Hours TBD"}</p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</p>
                <p className="mt-1 max-h-10 overflow-hidden text-sm leading-5 text-foreground/90">
                  {jobBrief.notesPreview || "No notes added."}
                </p>
              </div>
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Photos</p>
                  <button
                    type="button"
                    onClick={() => { setShowAdvanced(true); setActiveTab("notes"); }}
                    className="text-xs font-medium text-blue-400 hover:underline"
                    data-testid="button-open-job-media"
                  >
                    Open media
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  {jobBrief.photos.slice(0, 3).map((photo, index) => (
                    <img
                      key={`${photo.url}-${index}`}
                      src={photo.url}
                      alt={photo.name || `Job photo ${index + 1}`}
                      className="h-9 w-9 rounded-md border object-cover"
                    />
                  ))}
                  <span className="text-sm text-muted-foreground">{jobBrief.photos.length} photo{jobBrief.photos.length === 1 ? "" : "s"}</span>
                </div>
              </div>
            </div>

            <div className="grid gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 sm:grid-cols-2">
              <div className="flex items-start gap-3">
                <DollarSign className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <div className="min-w-0">
                  <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quote<Popover><PopoverTrigger asChild><button type="button" aria-label="Explain quote"><CircleHelp className="h-3 w-3" /></button></PopoverTrigger><PopoverContent className="w-64 text-xs">The live rate card calculates labor, truck, trailer, stairs, and elevator fees on the server. Manual changes stay labeled for audit.</PopoverContent></Popover></p>
                  <p className="capitalize text-sm font-medium">{paymentState}</p>
                  {hasAdminAccess && (
                    <button type="button" onClick={() => leadHasQuote ? setShowQuoteDeliveryDialog(true) : openJobSetup()} className="mt-1 text-xs font-medium text-blue-400 hover:underline">
                      {leadHasQuote ? "Send quote & invoice" : "Open job setup"}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Zap className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div className="min-w-0">
                  <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">JCMOVES<Popover><PopoverTrigger asChild><button type="button" aria-label="Explain JCMOVES"><CircleHelp className="h-3 w-3" /></button></PopoverTrigger><PopoverContent className="w-64 text-xs">Projections use the saved rate card. Permanent customer and crew ledger entries are created only after this job is paid and completed.</PopoverContent></Popover></p>
                  <p className="text-sm font-medium">{jcmovesState}</p>
                  {jcmovesPayout && <p className="mt-0.5 text-xs text-amber-300">${jcmovesPayout.rewardEligibleTotal.toFixed(2)} reward base · {jcmovesPayout.customerPool.toLocaleString()} customer + {jcmovesPayout.crewPool.toLocaleString()} crew-pool JCMOVES</p>}
                  {jcmovesPayout?.records.length ? (
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {jcmovesPayout.records.map((record, index) => (
                        <p key={`${record.recipient_type}-${record.recipient_label || "recipient"}-${index}`}>
                          Receipt: {record.recipient_label || record.recipient_type} · {Number(record.token_amount).toLocaleString()} JCMOVES · {new Date(record.created_at).toLocaleString()}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {hasAdminAccess && (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      <button type="button" onClick={() => { setShowAdvanced(true); setActiveTab("history"); }} className="text-xs font-medium text-blue-400 hover:underline">
                        Open reward and payout details
                      </button>
                      {jcmovesPayout?.state === "ready_to_issue" && (
                        <button
                          type="button"
                          onClick={() => retryDisbursementMutation.mutate()}
                          disabled={retryDisbursementMutation.isPending}
                          className="text-xs font-medium text-amber-300 hover:underline disabled:opacity-60"
                        >
                          {retryDisbursementMutation.isPending ? "Checking payout…" : "Retry safe payout check"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        </details>

        <Card className="mb-4 hidden" aria-hidden="true">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Job Basics</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-3">
              <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">From</p>
                <p className="text-sm font-medium break-words">{lead.confirmedFromAddress || lead.fromAddress}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Date & Time</p>
                <p className="text-sm font-medium">{lead.confirmedDate || lead.moveDate || "Not set"}{lead.arrivalWindow ? ` - ${lead.arrivalWindow}` : ""}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <DollarSign className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">{savedZoneEstimateLabel && !(lead.totalPrice || lead.basePrice) ? "Zone estimate" : "Quote"}</p>
                <p className="text-sm font-medium">{lead.totalPrice || lead.basePrice ? formatMoney(lead.totalPrice || lead.basePrice) : savedZoneEstimateLabel || "Not quoted"}</p>
                {savedZoneEstimateLabel && !(lead.totalPrice || lead.basePrice) && <p className={`text-xs ${lead.isQuoteOnly || !savedZonePreview?.matched ? "text-amber-400" : "text-emerald-400"}`}>{lead.isQuoteOnly || !savedZonePreview?.matched ? "Owner review required" : "Saved with job"}</p>}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Users className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Crew</p>
                <p className="text-sm font-medium truncate">
                  {selectedCrewNames.length > 0 ? selectedCrewNames.join(", ") : `${lead.crewSize || 2} mover${(lead.crewSize || 2) !== 1 ? "s" : ""}`}
                </p>
              </div>
            </div>
            {(lead.confirmedHours || truckProviderLabel) && (
              <div className="flex items-start gap-3">
                <Truck className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Plan</p>
                  <p className="text-sm font-medium truncate">{lead.confirmedHours ? `${lead.confirmedHours} expected hour${lead.confirmedHours === 1 ? "" : "s"}` : "Hours to confirm"}{truckProviderLabel ? ` · ${truckProviderLabel}` : ""}{lead.truckSize && lead.truckSize !== "none" ? ` · ${lead.truckSize.replace("_", " ")}` : ""}</p>
                </div>
              </div>
            )}
            {savedZonePreview?.quote?.rate && (
              <div className="flex items-start gap-3">
                <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div><p className="text-xs text-muted-foreground">Saved zone rate</p><p className="text-sm font-medium">${savedZonePreview.quote.rate.hourlyRate}/hr · {savedZonePreview.quote.rate.minimumHours} hour minimum</p></div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="mb-4">
          <Button
            variant="outline"
            className="w-full justify-between"
            onClick={() => setShowAdvanced(v => !v)}
            data-testid="button-toggle-advanced"
          >
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              More job activity
            </span>
            {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>

        {showAdvanced && (
          <>
            <MarketplaceSourceFlowStrip
              source={marketplaceSource}
              shapeId={marketplaceShapeId}
              serviceCode={marketplaceServiceCode}
              serviceLabel={marketplaceServiceLabel}
              audience={marketplaceAudience}
              phase={marketplacePhase}
              className="mt-3"
            />
            <MarketplaceProcessGuide
              source={marketplaceSource}
              shapeId={marketplaceShapeId}
              serviceCode={marketplaceServiceCode}
              serviceLabel={marketplaceServiceLabel}
              audience={marketplaceAudience}
              compact
              className="mt-3"
            />
            <BookingMenuIntelligenceCard
              quoteSnapshot={lead.quoteSnapshot}
              fallbackServiceLabel={marketplaceServiceLabel}
              audience={marketplaceAudience}
              className="mt-3"
            />

            {hasAdminAccess && (
              <Card className="mt-3">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Alert delivery</CardTitle>
                  <CardDescription>Actual crew and owner delivery results for this job.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {alertDeliveries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No job alerts have been sent yet.</p>
                  ) : alertDeliveries.slice(0, 8).map((delivery, index) => {
                    const recipient = [delivery.first_name, delivery.last_name].filter(Boolean).join(" ") || delivery.email || "Recipient";
                    const statusClass = delivery.status === "sent"
                      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                      : delivery.status === "failed"
                        ? "bg-red-500/15 text-red-300 border-red-500/30"
                        : "bg-amber-500/15 text-amber-300 border-amber-500/30";
                    return (
                      <div key={`${delivery.event_id}-${delivery.recipient_user_id}-${delivery.channel}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-muted p-2 text-xs">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{recipient} · {delivery.channel.replace(/_/g, " ")}</p>
                          {delivery.error_message && <p className="mt-0.5 truncate text-muted-foreground">{delivery.error_message}</p>}
                        </div>
                        <Badge variant="outline" className={`shrink-0 capitalize ${statusClass}`}>{delivery.status}</Badge>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

        {/* === Sticky Customer Summary Bar === */}
        {hasAdminAccess && (
          <div className="hidden sticky top-0 z-20 mb-4 p-3 rounded-xl border border-slate-700/50 bg-slate-900/95 backdrop-blur-sm flex flex-wrap items-center gap-3 text-sm shadow-md">
            <div className="flex items-center gap-1.5 font-semibold text-foreground">
              <Users className="h-4 w-4 text-slate-400" />
              {lead.firstName} {lead.lastName}
            </div>
            {lead.phone && (
              <a href={`tel:${lead.phone}`} className="flex items-center gap-1 text-blue-400 hover:underline">
                <Phone className="h-3.5 w-3.5" /> {lead.phone}
              </a>
            )}
            {lead.email && (
              <a href={`mailto:${lead.email}`} className="flex items-center gap-1 text-slate-400 hover:text-slate-200 hover:underline truncate max-w-[180px]">
                <Mail className="h-3.5 w-3.5 shrink-0" /> {lead.email}
              </a>
            )}
            <div className="hidden sm:block w-px h-4 bg-slate-600" />
            <span className="text-slate-400 capitalize">
              {lead.serviceType?.replace(/_/g, " ")}
              {(lead.totalPrice || lead.basePrice) && (
                <span className="text-emerald-400 font-semibold ml-1">
                  · ${parseFloat(lead.totalPrice || lead.basePrice || "0").toFixed(0)}
                </span>
              )}
            </span>
            <Badge
              variant="secondary"
              className={lead.status === "quoted" || lead.status === "completed" ? "bg-amber-600/20 text-amber-300 border-amber-500/30" : ""}
            >
              {lead.status.replace(/_/g, " ").charAt(0).toUpperCase() + lead.status.replace(/_/g, " ").slice(1)}
            </Badge>
            {(quoteSentAt || lead.quoteSentAt) && (
              <Badge className="bg-green-600/20 text-green-300 border-green-500/30 text-[10px]">
                <CheckCircle className="h-3 w-3 mr-1" /> Quote Sent
              </Badge>
            )}
            {(squarePaymentUrl || lead.squarePaymentUrl) && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(squarePaymentUrl || lead.squarePaymentUrl || "");
                  setCopiedPaymentLink(true);
                  setTimeout(() => setCopiedPaymentLink(false), 2000);
                }}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 text-[10px] hover:bg-emerald-600/30 transition-colors"
                title="Copy customer payment link"
              >
                {copiedPaymentLink ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                Pay link
              </button>
            )}
            <div className="ml-auto">
              <Button
                size="sm"
                className="bg-orange-600 hover:bg-orange-700 text-white"
                onClick={() => setShowQuoteDeliveryDialog(true)}
              >
                <Send className="h-3.5 w-3.5 mr-1.5" /> Send Quote
              </Button>
            </div>
          </div>
        )}

        {/* === 4-Tab Interface === */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid h-auto w-full grid-cols-2 mb-6">
            <TabsTrigger className="min-h-11 whitespace-normal text-sm" value="notes">Notes & Media</TabsTrigger>
            <TabsTrigger className="min-h-11 whitespace-normal text-sm" value="history">Timeline & Rewards</TabsTrigger>
          </TabsList>

          {/* ─────────── TAB: QUOTE & SEND ─────────── */}
          <TabsContent value="quote" className="hidden space-y-4">

            {/* Crew, schedule, equipment, and pricing edit only in Job Setup. */}
            {/* Section B — Quote Summary */}
            <Card className="border-emerald-500/30 bg-slate-900/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base text-emerald-400">
                  <ShoppingBag className="h-4 w-4" />
                  Quote Summary
                  {orderApplied && <Badge className="ml-1 bg-emerald-600/30 text-emerald-300 border-emerald-500/30 text-[10px]">Just updated</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(lead.totalPrice || lead.basePrice) ? (
                  <>
                    {lead.orderLineItems && lead.orderLineItems.length > 0 ? (
                      <div className="space-y-1.5">
                        {lead.orderLineItems.map((li: OrderLineItem, i: number) => (
                          <div key={i} className="flex justify-between text-sm text-slate-300">
                            <span>{li.name}{li.qty > 1 ? ` × ${li.qty}` : ""}</span>
                            <span className="font-medium">${li.total?.toFixed(2) ?? "0.00"}</span>
                          </div>
                        ))}
                        <div className="flex justify-between font-bold text-white pt-2 border-t border-slate-600/50">
                          <span>Subtotal</span>
                          <span>${parseFloat(lead.totalPrice || lead.basePrice || "0").toFixed(2)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-400">Base Quote</span>
                        <span className="font-medium">${parseFloat(lead.basePrice || "0").toFixed(2)}</span>
                      </div>
                    )}
                    {/* Special item surcharges */}
                    {parseFloat(String(lead.totalSpecialItemsFee || "0")) > 0 && (
                      <div className="flex justify-between text-sm border-t border-slate-700/30 pt-1.5">
                        <span className="text-slate-400">Special Items Surcharge</span>
                        <span className="text-orange-400 font-medium">+${parseFloat(String(lead.totalSpecialItemsFee || "0")).toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-lg font-bold text-emerald-400 border-t border-slate-600/60 pt-2">
                      <span>Total</span>
                      <span>${parseFloat(lead.totalPrice || lead.basePrice || "0").toFixed(2)}</span>
                    </div>
                    {/* Token preview */}
                    {(() => {
                      const price = parseFloat(lead.totalPrice || lead.basePrice || "0");
                      const crewCount = lead.crewSize ? parseInt(String(lead.crewSize)) : 0;
                      const jobTokens = Math.round(price * 15);
                      const perWorker = crewCount > 0 ? Math.round(jobTokens / crewCount) : jobTokens;
                      return (
                        <div className="pt-1.5 border-t border-slate-700/50 space-y-1">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Token conversion · $1 = 15 JCMOVES</p>
                          <div className="flex items-center gap-1.5 text-xs text-amber-400">
                            <Zap className="h-3.5 w-3.5 shrink-0" />
                            <span>Customer earns <strong>~{jobTokens.toLocaleString()}</strong> JCMOVES</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-orange-400">
                            <Zap className="h-3.5 w-3.5 shrink-0" />
                            <span>Crew earns <strong>~{jobTokens.toLocaleString()}</strong> JCMOVES{crewCount > 0 && <span className="text-orange-400/70"> (~{perWorker.toLocaleString()} each)</span>}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <p className="text-sm text-slate-500 italic text-center py-3">No quote set yet. Use "Adjust Quote" to build the quote.</p>
                )}

                {/* Quote changes use the unified inline Job Setup workspace. */}
                {hasAdminAccess && (
                  <div className="pt-1">
                    <Button variant="outline" className="w-full" onClick={() => openJobSetup()}>
                      <DollarSign className="h-4 w-4 mr-2" /> Open Job Setup
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Section C — Unified Send: Quote Email + Square Invoice */}
            {hasAdminAccess && (
              <Card className="border-orange-500/30 bg-orange-950/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Send className="h-4 w-4 text-orange-400" />
                    Send Quote &amp; Invoice
                  </CardTitle>
                  <CardDescription>Send the quote email and Square invoice together in one click</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Preview box */}
                  <div className="p-3 rounded-lg bg-slate-800/60 border border-slate-700/50 text-sm space-y-1.5">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">What the customer will receive</p>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Customer</span>
                      <span className="font-medium">{lead.firstName} {lead.lastName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Email</span>
                      <span className="font-medium">{lead.email}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Phone</span>
                      <span className="font-medium">{lead.phone || "Not set"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Service</span>
                      <span className="font-medium capitalize">{lead.serviceType?.replace(/_/g, " ")}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="shrink-0 text-slate-400">Location</span>
                      <span className="truncate text-right font-medium">{lead.confirmedFromAddress || lead.fromAddress || "Not set"}</span>
                    </div>
                    {lead.crewSize && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Crew</span>
                        <span className="font-medium">{lead.crewSize} mover{lead.crewSize !== 1 ? "s" : ""}</span>
                      </div>
                    )}
                    {lead.confirmedDate && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Date</span>
                        <span className="font-medium">{lead.confirmedDate}</span>
                      </div>
                    )}
                    {lead.arrivalWindow && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Arrival window</span>
                        <span className="font-medium">{lead.arrivalWindow}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-slate-700/50 pt-1.5 mt-1.5">
                      <span className="text-slate-400">Quote total</span>
                      <span className="font-bold text-emerald-400 text-base">
                        {(lead.totalPrice || lead.basePrice) ? `$${parseFloat(lead.totalPrice || lead.basePrice || "0").toFixed(2)}` : "Not set"}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Send by</Label>
                    <Select value={quoteDeliveryMethod} onValueChange={(value) => setQuoteDeliveryMethod(value as "email" | "sms" | "both")}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="email" disabled={isSyntheticOrInvalidEmail(lead.email) && !!lead.phone}>Email only</SelectItem>
                        <SelectItem value="sms" disabled={!lead.phone}>Text message only</SelectItem>
                        <SelectItem value="both" disabled={!lead.phone || isSyntheticOrInvalidEmail(lead.email)}>Email and text message</SelectItem>
                      </SelectContent>
                    </Select>
                    {isSyntheticOrInvalidEmail(lead.email) && lead.phone && (
                      <p className="text-xs text-amber-300">This customer has a test or invalid email, so text message delivery is selected.</p>
                    )}
                    {(quoteDeliveryMethod === "sms" || quoteDeliveryMethod === "both") && !lead.smsConsent && (
                      <label className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                        <Checkbox checked={recordSmsConsent} onCheckedChange={(value) => setRecordSmsConsent(value === true)} />
                        <span>I verified the customer gave verbal consent to receive this quote by text message.</span>
                      </label>
                    )}
                    {(quoteDeliveryMethod === "sms" || quoteDeliveryMethod === "both") && lead.smsConsent && (
                      <p className="text-xs text-emerald-300">SMS consent is already recorded for this customer.</p>
                    )}
                  </div>

                  {/* Note textarea */}
                  <div>
                    <Label className="text-sm font-medium mb-1 block">Add a personal note (optional)</Label>
                    <Textarea
                      placeholder="e.g. Thanks for reaching out! We're excited to help with your move."
                      value={quoteNote}
                      onChange={(e) => setQuoteNote(e.target.value)}
                      rows={2}
                      className="resize-none text-sm"
                    />
                  </div>

                  {/* Already sent status */}
                  {(quoteSentAt || lead.quoteSentAt) && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm text-green-400 bg-green-600/10 border border-green-500/20 rounded-lg px-3 py-2">
                        <CheckCircle className="h-4 w-4 shrink-0" />
                        <span>
                          {(squarePaymentUrl || lead.squarePaymentUrl) ? "Quote + invoice sent" : "Quote sent"}{" "}
                          {new Date(quoteSentAt || lead.quoteSentAt!).toLocaleString()}
                        </span>
                      </div>
                      {(squarePaymentUrl || lead.squarePaymentUrl) && (
                        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-900/20 border border-emerald-500/30">
                          <span className="text-xs text-emerald-400 font-medium shrink-0">Customer pay link:</span>
                          <a
                            href={squarePaymentUrl || lead.squarePaymentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-emerald-300 underline truncate flex-1"
                          >
                            {(squarePaymentUrl || lead.squarePaymentUrl)?.replace("https://", "")}
                          </a>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(squarePaymentUrl || lead.squarePaymentUrl || "");
                              setCopiedPaymentLink(true);
                              setTimeout(() => setCopiedPaymentLink(false), 2000);
                            }}
                            className="text-emerald-400 hover:text-emerald-300 shrink-0"
                            title="Copy payment link"
                          >
                            {copiedPaymentLink ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Existing invoices */}
                  {leadInvoices.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Square Invoices</p>
                      {leadInvoices.map((inv) => {
                        const statusColors: Record<string, string> = {
                          draft: "bg-slate-600/20 text-slate-300 border-slate-500/30",
                          sent: "bg-blue-600/20 text-blue-300 border-blue-500/30",
                          paid: "bg-green-600/20 text-green-300 border-green-500/30",
                          canceled: "bg-red-600/20 text-red-300 border-red-500/30",
                          failed: "bg-red-600/20 text-red-300 border-red-500/30",
                        };
                        const badgeCls = statusColors[inv.status] ?? "bg-slate-600/20 text-slate-300 border-slate-500/30";
                        return (
                          <div key={inv.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/30 border border-muted text-sm">
                            <div className="min-w-0">
                              <p className="font-medium truncate">${parseFloat(inv.amount).toFixed(2)}</p>
                              {inv.squareInvoiceNumber && (
                                <p className="text-[10px] font-mono text-slate-400">{inv.squareInvoiceNumber}</p>
                              )}
                              <p className="text-[10px] text-muted-foreground">{new Date(inv.createdAt).toLocaleDateString()}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge className={`text-[10px] px-1.5 py-0 capitalize ${badgeCls}`}>{inv.status}</Badge>
                              {inv.invoiceUrl && (
                                <a href={inv.invoiceUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Primary action: Send Quote Email + Square Invoice + SMS together */}
                  <Button
                    className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold"
                    onClick={() => sendQuoteMutation.mutate(quoteDeliveryMethod)}
                    disabled={sendQuoteMutation.isPending || !(lead.totalPrice || lead.basePrice) || ((quoteDeliveryMethod === "sms" || quoteDeliveryMethod === "both") && !lead.smsConsent && !recordSmsConsent)}
                  >
                    {sendQuoteMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    {(quoteSentAt || lead.quoteSentAt) ? "Re-send Quote & Invoice" : "Send Quote & Invoice"}
                  </Button>
                  <p className="text-[10px] text-slate-500 text-center">Square creates the secure payment link; text delivery uses the recorded customer consent.</p>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-red-500/40 text-red-300 hover:bg-red-950/40 hover:text-red-200"
                    onClick={() => { setRemoveIntent("delete"); setShowArchiveDialog(true); }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />Delete Job
                  </Button>

                  {!(lead.totalPrice || lead.basePrice) && (
                    <p className="text-xs text-amber-400 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      Build a quote first before sending.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Bitcoin Lightning Payment (Admin Only) */}
            {hasAdminAccess && (
              <Card className="border-orange-500/30">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Bitcoin className="h-4 w-4 text-orange-500" /> Bitcoin Lightning Payment
                  </CardTitle>
                  <CardDescription>5% discount + 5% of the discounted payment back in JCMOVES</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button onClick={() => { const price = lead.totalPrice || lead.basePrice || ""; setBtcAmount(price ? parseFloat(price).toString() : ""); setBtcPaymentLink(null); setShowBtcDialog(true); }} className="w-full bg-orange-600 hover:bg-orange-700 text-white">
                    <Zap className="h-4 w-4 mr-2" /> Generate Lightning Checkout
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ─────────── TAB: NOTES ─────────── */}
          <TabsContent value="notes" className="space-y-4">
            {/* Job Notes */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {customerNotesFromDetails(lead.details) && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">Customer Notes</p>
                    <p className="text-sm whitespace-pre-wrap break-words">{customerNotesFromDetails(lead.details)}</p>
                  </div>
                )}
                {lead.quoteNotes ? (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">Quote Notes</p>
                    <p className="text-sm whitespace-pre-wrap">{lead.quoteNotes}</p>
                  </div>
                ) : !customerNotesFromDetails(lead.details) ? (
                  <p className="text-sm text-muted-foreground italic text-center py-4">No notes added yet. Notes from the quote builder will appear here.</p>
                ) : null}
              </CardContent>
            </Card>

            {/* Photo Upload */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Camera className="h-4 w-4" /> Photos
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Existing photos grid */}
                {lead.photos && lead.photos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {lead.photos.map((photo, i) => (
                      <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-muted bg-muted/20">
                        {photo.mimeType?.startsWith("video/") ? (
                          <video src={photo.url} className="w-full h-full object-cover" />
                        ) : (
                          <img src={photo.url} alt={photo.name || `Photo ${i + 1}`} className="w-full h-full object-cover" />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Upload button */}
                <div>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={(e) => e.target.files && handlePhotoUpload(e.target.files)}
                  />
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={photoUploading}
                  >
                    {photoUploading ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading...</>
                    ) : (
                      <><Image className="h-4 w-4 mr-2" />Add Photos / Videos</>
                    )}
                  </Button>
                  {lead.photos && lead.photos.length > 0 && (
                    <p className="text-xs text-muted-foreground text-center mt-1.5">{lead.photos.length}/10 photos attached</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Quick Contact */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Phone className="h-4 w-4" /> Quick Contact
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <a href={`tel:${lead.phone}`} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600/10 border border-blue-500/20 text-blue-400 text-sm font-medium hover:bg-blue-600/20 transition-colors">
                  <Phone className="h-4 w-4" /> Call {lead.firstName}
                </a>
                <a href={`mailto:${lead.email}`} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700/30 border border-slate-600/30 text-slate-300 text-sm font-medium hover:bg-slate-700/50 transition-colors">
                  <Mail className="h-4 w-4" /> Email {lead.firstName}
                </a>
                <a href={`sms:${lead.phone}`} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-600/10 border border-green-500/20 text-green-400 text-sm font-medium hover:bg-green-600/20 transition-colors">
                  <Send className="h-4 w-4" /> Text {lead.firstName}
                </a>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─────────── TAB: HISTORY ─────────── */}
          <TabsContent value="history" className="space-y-4">
            {/* Stage Transition Timeline */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Stage History
                </CardTitle>
              </CardHeader>
              <CardContent>
                {historyLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
                  </div>
                ) : (
                  <div className="relative pl-5 border-l-2 border-muted space-y-4">
                    {/* Always show "Job Created" as first entry */}
                    <div className="relative flex items-start gap-3">
                      <div className="absolute -left-[22px] w-3 h-3 rounded-full border-2 border-background bg-blue-500 mt-0.5" />
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge className="text-[10px] px-1.5 py-0 bg-blue-600/20 text-blue-300 border-blue-500/30">Job Created</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{new Date(lead.createdAt).toLocaleString()}</p>
                      </div>
                    </div>
                    {leadHistory.map((entry) => {
                      const stageColors: Record<string, string> = {
                        quoted: "bg-amber-500",
                        confirmed: "bg-purple-500",
                        available: "bg-cyan-500",
                        in_progress: "bg-blue-500",
                        completed: "bg-green-500",
                        cancelled: "bg-red-500",
                      };
                      const dotColor = stageColors[entry.to_status] ?? "bg-slate-400";
                      const badgeColors: Record<string, string> = {
                        quoted: "bg-amber-600/20 text-amber-300 border-amber-500/30",
                        confirmed: "bg-purple-600/20 text-purple-300 border-purple-500/30",
                        available: "bg-cyan-600/20 text-cyan-300 border-cyan-500/30",
                        in_progress: "bg-blue-600/20 text-blue-300 border-blue-500/30",
                        completed: "bg-green-600/20 text-green-300 border-green-500/30",
                        cancelled: "bg-red-600/20 text-red-300 border-red-500/30",
                      };
                      const badgeClass = badgeColors[entry.to_status] ?? "bg-slate-600/20 text-slate-300 border-slate-500/30";
                      const changedBy = entry.first_name
                        ? `${entry.first_name}${entry.last_name ? " " + entry.last_name : ""}`
                        : "System";
                      return (
                        <div key={entry.id} className="relative flex items-start gap-3">
                          <div className={`absolute -left-[22px] w-3 h-3 rounded-full border-2 border-background ${dotColor} mt-0.5`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              {entry.from_status && (
                                <>
                                  <Badge className="text-[10px] px-1.5 py-0 bg-slate-600/20 text-slate-400 border-slate-500/30 capitalize">
                                    {entry.from_status.replace(/_/g, " ")}
                                  </Badge>
                                  <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                </>
                              )}
                              <Badge className={`text-[10px] px-1.5 py-0 capitalize ${badgeClass}`}>
                                {entry.to_status.replace(/_/g, " ")}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {new Date(entry.created_at).toLocaleString()} · {changedBy}
                              {entry.note && <span className="italic ml-1">— {entry.note}</span>}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    {leadHistory.length === 0 && (
                      <p className="text-sm text-muted-foreground">No stage changes recorded yet.</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Timestamps */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Key Timestamps</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { label: "Lead Created", ts: lead.createdAt },
                  { label: "Completed", ts: lead.completedAt },
                  { label: "Rewards Distributed", ts: lead.completionRewardedAt },
                  { label: "Last Quote Updated", ts: lead.lastQuoteUpdatedAt },
                ].filter(e => e.ts).map(({ label, ts }) => (
                  <div key={label} className="flex justify-between text-sm border-b border-muted/50 pb-1.5">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium">{new Date(ts!).toLocaleString()}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Potential Earnings */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-4 w-4" /> Potential Earnings
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                {[
                  { label: "Base Completion", pts: potentialEarnings.base.points, tokens: potentialEarnings.base.tokens },
                  { label: "+On-Time (20%)", pts: potentialEarnings.withOnTime.points, tokens: potentialEarnings.withOnTime.tokens },
                  { label: "+Rating (30%)", pts: potentialEarnings.withRating.points, tokens: potentialEarnings.withRating.tokens },
                  { label: "Maximum Potential", pts: potentialEarnings.withBoth.points, tokens: potentialEarnings.withBoth.tokens },
                ].map(e => (
                  <div key={e.label} className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">{e.label}</p>
                    <p className="font-bold">{e.pts} pts</p>
                    <p className="text-xs text-muted-foreground">{e.tokens} JCMOVES</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Rewards Status */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Award className="h-4 w-4" /> Rewards Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="pending">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="pending" data-testid="tab-pending">Pending ({pendingRewards.length})</TabsTrigger>
                    <TabsTrigger value="credited" data-testid="tab-credited">Credited ({creditedRewards.length})</TabsTrigger>
                  </TabsList>
                  <TabsContent value="pending" className="space-y-3 mt-4">
                    {pendingRewards.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No pending rewards</p>
                    ) : (
                      pendingRewards.map(reward => (
                        <div key={reward.id} className="p-3 border rounded-lg" data-testid={`pending-reward-${reward.id}`}>
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-medium text-sm">{reward.rewardType}</p>
                              <p className="text-xs text-muted-foreground">{new Date(reward.earnedDate).toLocaleDateString()}</p>
                            </div>
                            <Badge variant="outline">Pending</Badge>
                          </div>
                          <p className="mt-2 text-sm font-semibold">{parseFloat(reward.tokenAmount).toFixed(2)} JCMOVES</p>
                        </div>
                      ))
                    )}
                  </TabsContent>
                  <TabsContent value="credited" className="space-y-3 mt-4">
                    {creditedRewards.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No credited rewards yet</p>
                    ) : (
                      creditedRewards.map(reward => (
                        <div key={reward.id} className="p-3 border rounded-lg bg-muted/30" data-testid={`credited-reward-${reward.id}`}>
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-medium text-sm">{reward.rewardType}</p>
                              <p className="text-xs text-muted-foreground">{new Date(reward.earnedDate).toLocaleDateString()}</p>
                            </div>
                            <Badge className="bg-green-600">Credited</Badge>
                          </div>
                          <p className="mt-2 text-sm font-semibold">{parseFloat(reward.tokenAmount).toFixed(2)} JCMOVES</p>
                        </div>
                      ))
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* Disbursement Summary */}
            {lead.completionRewardedAt && hasAdminAccess && (
              <DisbursementSummaryCard lead={lead} />
            )}
          </TabsContent>
        </Tabs>
          </>
        )}
      </div>

      {/* Crew Suggestions Dialog */}
      <CrewSuggestionsDialog
        jobId={lead.id}
        jobTitle={`${lead.firstName} ${lead.lastName} - ${lead.serviceType}`}
        open={showCrewSuggestions}
        onOpenChange={setShowCrewSuggestions}
      />

      {/* Remove Lead Dialog */}
      <Dialog
        open={showArchiveDialog}
        onOpenChange={(open) => {
          setShowArchiveDialog(open);
          if (!open) setRemoveIntent(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {removeIntent === "delete"
                ? <Trash2 className="h-5 w-5 text-red-400" />
                : removeIntent === "archive"
                  ? <Archive className="h-5 w-5 text-orange-400" />
                  : <X className="h-5 w-5 text-red-300" />}
              Remove job from active jobs?
            </DialogTitle>
            <DialogDescription>
              This archives the job from active views. It stays recoverable from Archived Jobs.
            </DialogDescription>
          </DialogHeader>
          {!removeIntent ? (
            <div className="grid gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRemoveIntent("archive")}
                className="flex w-full items-start gap-3 rounded-lg border border-orange-500/30 bg-orange-500/10 p-3 text-left transition hover:bg-orange-500/15"
                data-testid="button-choose-archive-lead"
              >
                <Archive className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-300" />
                <span>
                  <span className="block font-semibold text-foreground">Archive</span>
                  <span className="block text-sm text-muted-foreground">Best for real jobs you may need later. Removes it from active views.</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setRemoveIntent("delete")}
                className="flex w-full items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-left transition hover:bg-red-500/15"
                data-testid="button-choose-delete-lead"
              >
                <Trash2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-300" />
                <span>
                  <span className="block font-semibold text-foreground">Delete from active jobs</span>
                  <span className="block text-sm text-muted-foreground">Best for test leads and clutter. It still goes to Archived for recovery.</span>
                </span>
              </button>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowArchiveDialog(false)}>Cancel</Button>
              </DialogFooter>
            </div>
          ) : (
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setRemoveIntent(null)} disabled={archiveLeadMutation.isPending}>
                Back
              </Button>
              <Button
                onClick={() => archiveLeadMutation.mutate(removeIntent)}
                disabled={archiveLeadMutation.isPending}
                className={removeIntent === "delete" ? "bg-red-600 hover:bg-red-700 text-white" : "bg-orange-600 hover:bg-orange-700 text-white"}
                data-testid={removeIntent === "delete" ? "button-confirm-delete-lead" : "button-confirm-archive-lead"}
              >
                {archiveLeadMutation.isPending
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : removeIntent === "delete"
                    ? <Trash2 className="h-4 w-4 mr-2" />
                    : <Archive className="h-4 w-4 mr-2" />}
                {removeIntent === "delete" ? "Delete job" : "Archive job"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showOfflineCloseoutDialog} onOpenChange={setShowOfflineCloseoutDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-emerald-400" />
              Record Payment &amp; Complete Past Job
            </DialogTitle>
            <DialogDescription>
              This records a paid-in-full cash or check payment, completes the past job, and issues JCMOVES to eligible linked accounts. It does not dispatch the crew.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Paid-in-full amount</span>
                <span className="font-bold text-emerald-300">{formatMoney(lead.totalPrice || lead.basePrice)}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <span className="text-muted-foreground">Job date</span>
                <span className="font-medium">{scheduledJobDate || "Not set"}</span>
              </div>
            </div>

            <div className={`rounded-lg border p-3 text-sm ${rewardCrewIds.length > 0 ? "border-amber-500/25 bg-amber-500/10" : "border-red-500/30 bg-red-500/10"}`}>
              <p className="font-semibold">JCMOVES recipients</p>
              {rewardCrewNames.length > 0 ? (
                <>
                  <p className="mt-1 text-muted-foreground">Assigned crew accounts:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {rewardCrewNames.map((name, index) => (
                      <li key={`${rewardCrewIds[index]}-${name}`}>{name}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Customer JCMOVES is credited to a matching customer account or held safely for account claim.
                  </p>
                </>
              ) : (
                <div className="mt-1">
                  <p className="text-red-200">Assign the user accounts that worked this job before closing it. This prevents JCMOVES from going to the wrong people.</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      setShowOfflineCloseoutDialog(false);
                      openJobSetup();
                    }}
                  >
                    <Users className="mr-2 h-4 w-4" />Assign Crew in Job Setup
                  </Button>
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Payment method</Label>
                <Select value={offlinePaymentMethod} onValueChange={(value) => setOfflinePaymentMethod(value as "cash" | "check")}>
                  <SelectTrigger className="mt-1" data-testid="select-offline-payment-method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="check">Check</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="offline-payment-date">Payment date</Label>
                <Input
                  id="offline-payment-date"
                  type="date"
                  className="mt-1"
                  value={offlinePaymentDate}
                  max={currentBusinessDate}
                  onChange={(event) => setOfflinePaymentDate(event.target.value)}
                  data-testid="input-offline-payment-date"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="offline-payment-reference">{offlinePaymentMethod === "check" ? "Check number / reference" : "Receipt reference"} (optional)</Label>
              <Input
                id="offline-payment-reference"
                className="mt-1"
                value={offlinePaymentReference}
                maxLength={200}
                onChange={(event) => setOfflinePaymentReference(event.target.value)}
                placeholder={offlinePaymentMethod === "check" ? "e.g. Check 1042" : "e.g. Cash receipt 0824"}
              />
            </div>
            <div>
              <Label htmlFor="offline-payment-note">Closeout note (optional)</Label>
              <Textarea
                id="offline-payment-note"
                className="mt-1 resize-none"
                rows={3}
                value={offlinePaymentNote}
                maxLength={1000}
                onChange={(event) => setOfflinePaymentNote(event.target.value)}
                placeholder="Anything the payment and job history should preserve."
              />
            </div>
            <div className="flex items-start gap-2 rounded-md border border-blue-500/25 bg-blue-500/10 p-3 text-xs text-blue-100">
              <Check className="mt-0.5 h-4 w-4 shrink-0" />
              <span>No dispatch text, email, or crew offer is sent. Payment, completion, accounting, and JCMOVES issuance are recorded with an owner audit trail.</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOfflineCloseoutDialog(false)} disabled={offlineCloseoutMutation.isPending}>Cancel</Button>
            <Button
              onClick={() => offlineCloseoutMutation.mutate()}
              disabled={offlineCloseoutMutation.isPending || rewardCrewIds.length === 0 || !offlinePaymentDate}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              data-testid="button-confirm-offline-closeout"
            >
              {offlineCloseoutMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
              Record {formatMoney(lead.totalPrice || lead.basePrice)} Paid &amp; Complete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single, consent-aware quote delivery control. The old standalone
          quote tab is intentionally retired to keep this job card focused. */}
      <Dialog open={showQuoteDeliveryDialog} onOpenChange={setShowQuoteDeliveryDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-cyan-400" />
              Send Quote &amp; Invoice
            </DialogTitle>
            <DialogDescription>
              The saved quote is sent with its Square payment link. Text delivery requires recorded customer consent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-muted bg-muted/30 p-3 text-sm">
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Customer</span><span className="text-right font-medium">{lead.firstName} {lead.lastName}</span></div>
              <div className="mt-1 flex justify-between gap-3"><span className="text-muted-foreground">Saved total</span><span className="font-bold text-emerald-400">{leadHasQuote ? `$${parseFloat(lead.totalPrice || lead.basePrice || "0").toFixed(2)}` : "Not set"}</span></div>
            </div>
            <div>
              <Label>Send by</Label>
              <Select value={quoteDeliveryMethod} onValueChange={(value) => setQuoteDeliveryMethod(value as "email" | "sms" | "both")}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email" disabled={isSyntheticOrInvalidEmail(lead.email) && !!lead.phone}>Email only</SelectItem>
                  <SelectItem value="sms" disabled={!lead.phone}>Text message only</SelectItem>
                  <SelectItem value="both" disabled={!lead.phone || isSyntheticOrInvalidEmail(lead.email)}>Email and text message</SelectItem>
                </SelectContent>
              </Select>
              {(quoteDeliveryMethod === "sms" || quoteDeliveryMethod === "both") && !lead.smsConsent && (
                <label className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                  <Checkbox checked={recordSmsConsent} onCheckedChange={(value) => setRecordSmsConsent(value === true)} />
                  <span>I verified the customer gave verbal consent to receive this quote by text message.</span>
                </label>
              )}
            </div>
            <div>
              <Label>Personal note (optional)</Label>
              <Textarea className="mt-1 resize-none" rows={3} value={quoteNote} onChange={(event) => setQuoteNote(event.target.value)} placeholder="Thanks for reaching out — we're ready to help." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowQuoteDeliveryDialog(false)}>Cancel</Button>
            <Button
              onClick={() => sendQuoteMutation.mutate(quoteDeliveryMethod)}
              disabled={sendQuoteMutation.isPending || !leadHasQuote || ((quoteDeliveryMethod === "sms" || quoteDeliveryMethod === "both") && !lead.smsConsent && !recordSmsConsent)}
              className="bg-cyan-600 text-white hover:bg-cyan-700"
            >
              {sendQuoteMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send quote &amp; invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Invoice Dialog */}
      <Dialog open={showInvoiceDialog} onOpenChange={setShowInvoiceDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-emerald-500" />
              Send Invoice via Square
            </DialogTitle>
            <DialogDescription>
              Square will deliver this invoice directly to {lead.firstName} {lead.lastName}. Choose how they receive it below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Delivery Method</Label>
              <Select value={invoiceDeliveryMethod} onValueChange={(v) => setInvoiceDeliveryMethod(v as "email" | "sms" | "both")}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email" disabled={isSyntheticOrInvalidEmail(lead.email) && !!lead.phone}>
                    <span className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" /> Email only — {lead.email}</span>
                  </SelectItem>
                  <SelectItem value="sms" disabled={!lead.phone}>
                    <span className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> Text (SMS) only{lead.phone ? ` — ${lead.phone}` : " — no phone on file"}</span>
                  </SelectItem>
                  <SelectItem value="both" disabled={!lead.phone || isSyntheticOrInvalidEmail(lead.email)}>
                    <span className="flex items-center gap-2"><Send className="h-3.5 w-3.5" /> Email + Text{!lead.phone ? " — no phone on file" : ""}</span>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">Square creates the payment link. Text delivery is sent by JC ON THE MOVE after consent is recorded.</p>
              {(invoiceDeliveryMethod === "sms" || invoiceDeliveryMethod === "both") && !lead.smsConsent && (
                <label className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                  <Checkbox checked={recordSmsConsent} onCheckedChange={(value) => setRecordSmsConsent(value === true)} />
                  <span>I verified the customer gave verbal consent to receive this invoice by text message.</span>
                </label>
              )}
            </div>
            <div>
              <Label>Amount ($)</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="pl-9"
                  value={invoiceAmount}
                  onChange={(e) => setInvoiceAmount(e.target.value)}
                  placeholder="Enter invoice amount"
                />
              </div>
              {parseFloat(invoiceAmount) > 0 && (() => {
                const amt = parseFloat(invoiceAmount);
                const crewCount = lead?.crewSize ? parseInt(String(lead.crewSize)) : 0;
                const tokens = Math.round(amt * 15);
                const perWorker = crewCount > 0 ? Math.round(tokens / crewCount) : tokens;
                return (
                  <div className="mt-2 p-2.5 rounded-lg bg-amber-950/30 border border-amber-500/20 space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-500/70">$1 = 15 JCMOVES conversion</p>
                    <div className="flex items-center gap-1.5 text-xs text-amber-400">
                      <Zap className="h-3 w-3 shrink-0" /><span>Customer earns <strong>~{tokens.toLocaleString()}</strong> JCMOVES</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-orange-400">
                      <Zap className="h-3 w-3 shrink-0" /><span>Workers earn <strong>~{tokens.toLocaleString()}</strong> JCMOVES{crewCount > 0 && <span className="text-orange-400/70"> (~{perWorker.toLocaleString()} each × {crewCount})</span>}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div>
              <Label>Description</Label>
              <Input value={invoiceDescription} onChange={(e) => setInvoiceDescription(e.target.value)} placeholder="Service description" />
            </div>
            {lead.orderLineItems && lead.orderLineItems.length > 0 && (
              <div className="p-3 bg-emerald-950/20 border border-emerald-500/20 rounded-lg text-xs space-y-1">
                <p className="font-semibold text-emerald-400 mb-1.5">Itemized order ({lead.orderLineItems.length} line items):</p>
                {lead.orderLineItems.map((li: OrderLineItem, i: number) => (
                  <div key={i} className="flex justify-between text-slate-400">
                    <span>{li.name}{li.qty > 1 ? ` × ${li.qty}` : ""}</span>
                    <span>${li.total?.toFixed(2)}</span>
                  </div>
                ))}
                <p className="text-[10px] text-slate-500 pt-1 border-t border-emerald-500/10">Invoice will use Square order line items.</p>
              </div>
            )}
            <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
              <p className="font-medium">Payment methods accepted:</p>
              <p className="text-muted-foreground">Credit/Debit Card, Bank Transfer, Cash App Pay</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvoiceDialog(false)}>Cancel</Button>
            <Button onClick={() => createInvoiceMutation.mutate()} disabled={createInvoiceMutation.isPending || !invoiceAmount || parseFloat(invoiceAmount) <= 0 || ((invoiceDeliveryMethod === "sms" || invoiceDeliveryMethod === "both") && !lead.smsConsent && !recordSmsConsent)} className="bg-emerald-600 hover:bg-emerald-700">
              {createInvoiceMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              {createInvoiceMutation.isPending ? "Sending..." : "Send Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bitcoin Lightning Payment Dialog */}
      <Dialog open={showBtcDialog} onOpenChange={(open) => { setShowBtcDialog(open); if (!open) setBtcPaymentLink(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bitcoin className="h-5 w-5 text-orange-500" />
              Generate Bitcoin Lightning Checkout
            </DialogTitle>
            <DialogDescription>
              Customer receives 5% off eligible job charges and 5% of the discounted payment back in JCMOVES. Tips are excluded.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {!btcPaymentLink ? (
              <>
                <div>
                  <Label>Amount ($)</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input type="number" step="0.01" min="0.01" className="pl-9" value={btcAmount} onChange={(e) => setBtcAmount(e.target.value)} placeholder="Enter amount in USD" />
                  </div>
                </div>
                {btcOfferPreview && (
                  <div className="p-3 bg-orange-950/30 border border-orange-500/30 rounded-lg text-sm space-y-1">
                    <div className="flex justify-between"><span className="text-muted-foreground">Eligible job charges</span><span>${btcOfferPreview.originalAmountUsd.toFixed(2)}</span></div>
                    <div className="flex justify-between text-green-400"><span>Lightning discount (5%)</span><span>-${btcOfferPreview.discountAmountUsd.toFixed(2)}</span></div>
                    <div className="flex justify-between text-orange-400 font-medium"><span>Customer pays</span><span>${btcOfferPreview.amountDueUsd.toFixed(2)}</span></div>
                    <div className="flex justify-between text-amber-300"><span>JCMOVES reward (5%)</span><span>{btcOfferPreview.rewardTokens.toLocaleString()} (${btcOfferPreview.rewardValueUsd.toFixed(2)})</span></div>
                    <div className="pt-1 text-xs text-muted-foreground">Treasury policy: BTC remains BTC. USD is the receipt value for bookkeeping only; automatic conversion is disabled.</div>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-orange-950/30 border border-orange-500/30 rounded-xl">
                  <p className="text-xs text-muted-foreground mb-2 font-medium">Secure Lightning-enabled checkout — share with the customer:</p>
                  <p className="text-xs font-mono break-all text-orange-300 leading-relaxed">{btcPaymentLink}</p>
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1" variant="outline" onClick={async () => { await navigator.clipboard.writeText(btcPaymentLink); setCopiedBtcLink(true); setTimeout(() => setCopiedBtcLink(false), 3000); }}>
                    {copiedBtcLink ? <Check className="h-4 w-4 mr-2 text-green-500" /> : <Copy className="h-4 w-4 mr-2" />}
                    {copiedBtcLink ? "Copied!" : "Copy Link"}
                  </Button>
                  <Button className="flex-1 bg-orange-600 hover:bg-orange-700" onClick={() => window.open(btcPaymentLink, "_blank")}>
                    <ExternalLink className="h-4 w-4 mr-2" /> Open
                  </Button>
                </div>
              </div>
            )}
          </div>
          {!btcPaymentLink && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowBtcDialog(false)}>Cancel</Button>
              <Button onClick={() => createBtcPaymentMutation.mutate()} disabled={createBtcPaymentMutation.isPending || !btcAmount || parseFloat(btcAmount) <= 0} className="bg-orange-600 hover:bg-orange-700">
                {createBtcPaymentMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Bitcoin className="h-4 w-4 mr-2" />}
                {createBtcPaymentMutation.isPending ? "Generating..." : "Generate Checkout"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

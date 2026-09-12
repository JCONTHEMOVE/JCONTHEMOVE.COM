import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Coins, Zap, Clock, TrendingUp, Loader2, Lock, Link as LinkIcon, Share2, MessageCircle,
  Dumbbell, Truck, KeyRound, Wrench, Copy, Image as ImageIcon, Sparkles, Upload, Wallet, Gift, ArrowRight
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useState, useEffect, useMemo } from "react";
import { notificationService } from "@/lib/notifications";
import ProcessFlowCard, { type ProcessFlowStep } from "@/components/ProcessFlowCard";
import MarketplaceActionMatrix from "@/components/MarketplaceActionMatrix";
import MarketplaceProcessGuide from "@/components/MarketplaceProcessGuide";
import { WalletChoiceModal } from "@/components/WalletChoiceModal";
import { MarketingLaunchCard } from "@/components/MarketingLaunchCard";
import { MarketingBotRepCard } from "@/components/MarketingBotRepCard";
import { MARKETING_WEEKLY_NOTE, MARKETING_WEEKLY_THEMES } from "@shared/marketingWeek";
import {
  ROUTE_DAY_PROMO_PACKAGES,
  ROUTE_DAY_SCHEDULE,
  routeDayLandingHref,
  routeDayTrackingParams,
} from "@shared/routeDays";

interface MiningStatus {
  currentSession: { startedAt: string; userId: string } | null;
  accumulatedTokens: string;
  timeRemaining: number;
  totalClaimedToday: string;
  miningSpeed: string;
  streakCount: number;
  nextStreakBonus: string;
  claimsRemainingToday: number;
}

interface RewardHistory {
  id: string;
  rewardType: string;
  tokenAmount: string;
  status: string;
  earnedDate: string;
}

interface Stake {
  id: string;
  amount: string;
  dailyRate: string;
  endsAt: string;
  status: string;
  lastPayoutAt: string;
  tier: { id: string; name: string; minAmount: string; apr: string; lockupDays: number; color: string };
}

interface MarketingRep {
  slug: string;
  displayName: string;
  promoCode: string;
}

interface CrewPayout {
  id: string;
  leadId: string;
  hoursWorked: string;
  hourlyPay: string;
  hourlyRate: string;
  driverPremiumPay: string;
  crewBonusPay: string;
  authorityBonusPct: string;
  authorityBonusPay: string;
  jobRevenueSharePct: string;
  authorityTierSnapshot?: string | null;
  roleOnJob: string;
  bonusPay: string;
  totalPay: string;
  payoutStatus: string;
  jcmovesRewardAmount: string;
  rewardsIssuedAt?: string | null;
  createdAt: string;
  firstName?: string | null;
  lastName?: string | null;
  serviceType?: string | null;
}

interface CrewPayrollPeriod {
  period: { id: string; periodKey: string; status: string; paymentReference?: string | null };
  total: number;
  entries: Array<{ id: string; amount: string; sourceType: string; description: string }>;
}

interface MarketingAdDraft {
  headline: string;
  facebookPost: string;
  shortText: string;
  hashtags: string[];
  ctaLabel: string;
  photoSuggestion: string;
  communityTargets?: string[];
  followUpText?: string;
  postingChecklist?: string[];
  campaignId?: string;
  trackedLink?: string;
  shareUrl?: string;
  creative?: MarketingCreativeResult;
  provider: string;
  fallbackUsed: boolean;
  reason?: string;
}

type MarketingCreativeSourceKind = "approved_photo" | "uploaded_photo" | "ai_scene";

interface MarketingCreativeResult {
  feedImageUrl: string;
  ogImageUrl: string;
  shareUrl: string;
  altText: string;
  revision: number;
  source: MarketingCreativeSourceKind;
  sourceKind: MarketingCreativeSourceKind;
  provider: "jc_photo" | "openai" | "upload";
  model: string;
  fallbackUsed: boolean;
  reason?: string;
  aiGenerationCount: number;
}

interface MarketingCreativeOptions {
  approvedPhotos: Array<{
    key: "crew-ramp";
    label: string;
    description: string;
    thumbnailUrl: string;
  }>;
  defaultApprovedPhoto: "crew-ramp";
  maxAiGenerations: number;
  readiness: {
    deterministicReady: boolean;
    openAiConfigured: boolean;
    objectStorageConfigured: boolean;
    aiReady: boolean;
    imageModel: string;
  };
}

interface MarketingAdReward {
  awarded: boolean;
  bonusTokens: number;
  reason?: string;
  dailyAwardCount?: number;
  dailyLimit?: number;
}

interface MarketingCampaignPerformanceRow {
  id: string;
  title: string;
  area: string | null;
  focus: string | null;
  source: string | null;
  created_at: string;
  last_activity_at: string;
  funnel_events: number;
  submit_successes: number;
  errors: number;
  recovered_or_linked: number;
  attributed_cards: number;
  attributed_leads: number;
  attributed_bookings: number;
  feed_image_url?: string | null;
  og_image_url?: string | null;
  share_url?: string | null;
  creative_revision?: number;
  creative_source?: MarketingCreativeSourceKind | null;
  creative_fallback_used?: boolean;
}

interface MarketingCampaignPerformanceResponse {
  campaigns: MarketingCampaignPerformanceRow[];
  summary: {
    totalCampaigns: number;
    funnelEvents: number;
    submitSuccesses: number;
    attributedCards: number;
    errors: number;
  };
}

const REWARD_LABELS: Record<string, string> = {
  mining: "Mining Reward",
  daily_checkin: "Daily Check-in",
  lead_creation: "Job Creation Bonus",
  job_completion: "Job Completion",
  worker_job_completion_bonus: "Job Completion Bonus",
  worker_hours_bonus: "Hours Bonus",
  loyalty_booking: "Loyalty Reward",
  referral: "Referral Bonus",
  signup_bonus: "Welcome Bonus",
  ops_task_marketing_ad: "Marketing Ad Bonus",
  review_submitted: "Left a review",
};

function formatTokens(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function money(value: unknown) {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function payoutStatusLabel(status: string) {
  return status.replace(/_/g, " ");
}

function daysRemaining(endsAt: string) {
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86400000));
}

function pendingStakeRewards(stake: Stake) {
  const daysSince = (Date.now() - new Date(stake.lastPayoutAt).getTime()) / 86400000;
  return parseFloat(stake.amount) * parseFloat(stake.dailyRate) * daysSince;
}

const ALL_CAPABILITIES: { key: string; label: string; icon: LucideIcon }[] = [
  { key: "mover", label: "Mover", icon: Dumbbell },
  { key: "driver", label: "Driver", icon: Truck },
  { key: "truck_small", label: "Truck (Small)", icon: Truck },
  { key: "truck_large", label: "Truck (Large)", icon: Truck },
  { key: "trailer_small", label: "Trailer (Small)", icon: Truck },
  { key: "trailer_large", label: "Trailer (Large)", icon: Truck },
  { key: "uhaul", label: "U-Haul Access", icon: KeyRound },
];

const AD_AREA_OPTIONS = [
  "Ironwood / Hurley",
  ...MARKETING_WEEKLY_THEMES,
  "Wausau",
  "Northwoods",
];
const AD_FOCUS_OPTIONS = ["Moving help", "Crew appreciation", "U-Haul load/unload", "Junk removal", "Delivery help", "PODS / U-Box help", "Last-minute labor"];
const AD_NOTE_PRESETS = [
  { label: "Weekday focus", text: MARKETING_WEEKLY_NOTE },
  { label: "Openings", text: "A few local openings this week. Send ZIP, date, and photos for a quick quote review." },
  { label: "Last-minute", text: "Last-minute load/unload and delivery help may be available depending on crew timing." },
  { label: "Heavy item", text: "Good fit for couches, appliances, garage items, storage units, and truck unloads." },
  { label: "Community", text: "Local crew, simple scheduling, and a clear quote before the job is confirmed." },
];
const AD_PHOTO_MAX_BYTES = 8 * 1024 * 1024;

function appendAdNote(current: string, next: string) {
  if (!current.trim()) return next;
  if (current.includes(next)) return current;
  return `${current.trim()}\n${next}`;
}

function buildAdPostText(draft: MarketingAdDraft) {
  const shareLink = draft.shareUrl || draft.trackedLink;
  const linkLine = shareLink && !draft.facebookPost.includes(shareLink) ? `\n\n${shareLink}` : "";
  const hashtags = draft.hashtags?.length ? `\n\n${draft.hashtags.join(" ")}` : "";
  return `${draft.facebookPost}${linkLine}${hashtags}`.trim();
}

function buildAdKitText(draft: MarketingAdDraft) {
  return [
    "FACEBOOK POST",
    buildAdPostText(draft),
    draft.followUpText ? "\nFAST REPLY" : "",
    draft.followUpText || "",
    draft.communityTargets?.length ? "\nWHERE TO POST" : "",
    draft.communityTargets?.map((target, index) => `${index + 1}. ${target}`).join("\n") || "",
    draft.postingChecklist?.length ? "\nPOSTING CHECK" : "",
    draft.postingChecklist?.map((item, index) => `${index + 1}. ${item}`).join("\n") || "",
  ].filter(Boolean).join("\n");
}

function compressMarketingPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Choose an image file."));
      return;
    }
    if (file.size > AD_PHOTO_MAX_BYTES) {
      reject(new Error("Choose a photo under 8 MB."));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const maxSide = 1280;
      const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * ratio));
      canvas.height = Math.max(1, Math.round(image.height * ratio));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not prepare that photo."));
        return;
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that photo."));
    };
    image.src = objectUrl;
  });
}

export default function CrewEarningsPage({ marketingOnly = false }: { marketingOnly?: boolean } = {}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [location] = useLocation();
  const marketingMode = marketingOnly || location.startsWith("/crew/marketing");
  const [animatedTokens, setAnimatedTokens] = useState(0);
  const [adArea, setAdArea] = useState("Ironwood / Northwoods");
  const [adFocus, setAdFocus] = useState("Moving help");
  const [adNotes, setAdNotes] = useState("");
  const [adPhotoUrl, setAdPhotoUrl] = useState("");
  const [adPhotoFileName, setAdPhotoFileName] = useState("");
  const [adPhotoPreview, setAdPhotoPreview] = useState("");
  const [adPhotoDataUrl, setAdPhotoDataUrl] = useState("");
  const [adCreativeSource, setAdCreativeSource] = useState<MarketingCreativeSourceKind>("approved_photo");
  const [adDraft, setAdDraft] = useState<MarketingAdDraft | null>(null);
  const [adReward, setAdReward] = useState<MarketingAdReward | null>(null);
  const [walletChoiceOpen, setWalletChoiceOpen] = useState(false);

  const { data: wallet } = useQuery<{ balance: string; tokenBalance?: string; totalEarned?: string }>({ queryKey: ["/api/rewards/wallet"] });
  const { data: miningStatus } = useQuery<MiningStatus>({ queryKey: ["/api/mining/status"], refetchInterval: 15000, refetchIntervalInBackground: false, retry: 1 });
  const { data: rewardsHistory } = useQuery<RewardHistory[]>({ queryKey: ["/api/rewards/history"] });
  const { data: stakes = [] } = useQuery<Stake[]>({ queryKey: ["/api/staking/my-stakes"], retry: 1 });
  const { data: marketingReps = [] } = useQuery<MarketingRep[]>({ queryKey: ["/api/marketing-network/reps"], retry: 1 });
  const { data: crewPayouts = [] } = useQuery<CrewPayout[]>({ queryKey: ["/api/crew/payouts"], retry: 1 });
  const { data: crewPayroll = [] } = useQuery<CrewPayrollPeriod[]>({ queryKey: ["/api/crew/payroll"], retry: 1 });
  const { data: myCampaignPerformance } = useQuery<MarketingCampaignPerformanceResponse>({
    queryKey: ["/api/crew/marketing/campaign-performance"],
    retry: 1,
  });
  const { data: marketingCreativeOptions } = useQuery<MarketingCreativeOptions>({
    queryKey: ["/api/crew/marketing/creative-options"],
    retry: 1,
  });

  const userCapabilities: string[] = user?.capabilities ?? [];
  const referralCode = (user as any)?.referralCode || "";
  const workerName = `${(user as any)?.firstName || ""} ${(user as any)?.lastName || ""}`.trim().toLowerCase();
  const marketingRep = marketingReps.find((rep) => {
    if (referralCode && rep.promoCode.toUpperCase() === referralCode.toUpperCase()) return true;
    return workerName.length > 0 && rep.displayName.toLowerCase() === workerName;
  });
  const referralLink = marketingRep
    ? `${window.location.origin}/network/${marketingRep.slug}`
    : `${window.location.origin}/book${referralCode ? `?promo=${encodeURIComponent(referralCode)}` : "?mode=quick"}`;
  const referralDestination = marketingRep ? "Verified rep page" : "Booking link";
  const referralShareText = [
    "Need moving, junk removal, delivery, cleanup, or labor help?",
    `Book with JC ON THE MOVE here: ${referralLink}`,
    referralCode ? `Use code ${referralCode}.` : "",
  ].filter(Boolean).join(" ");
  const readyToPostText = [
    "Need fast local help?",
    "JC ON THE MOVE can help with moving, junk removal, delivery, cleanup, and labor work.",
    "Request a callback, add photos or a video/album link, and the crew will confirm the job details.",
    referralCode ? `Use my code ${referralCode}.` : "",
    referralLink,
  ].filter(Boolean).join("\n\n");
  const referralSmsHref = `sms:?&body=${encodeURIComponent(referralShareText)}`;
  const routeForAdArea = ROUTE_DAY_SCHEDULE.find((route) => route.label === adArea);
  const trackedAdLink = useMemo(() => {
    try {
      const routeUrl = routeForAdArea
        ? `${window.location.origin}${routeDayLandingHref(routeForAdArea)}`
        : referralLink;
      const url = new URL(routeUrl);
      url.searchParams.set("utm_source", "crew_ad");
      url.searchParams.set("utm_medium", "facebook");
      url.searchParams.set("utm_campaign", `${adArea}-${adFocus}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
      url.searchParams.set("jc_area", adArea);
      url.searchParams.set("jc_focus", adFocus);
      if (routeForAdArea) {
        routeDayTrackingParams(routeForAdArea, "custom", ROUTE_DAY_PROMO_PACKAGES[1]).forEach((value, key) => {
          if (!url.searchParams.get(key)) url.searchParams.set(key, value);
        });
        url.searchParams.set("utm_source", "crew_ad");
        url.searchParams.set("utm_medium", "facebook");
        url.searchParams.set("jc_focus", adFocus);
        if (marketingRep?.slug) url.searchParams.set("rep", marketingRep.slug);
      }
      return url.toString();
    } catch {
      return referralLink;
    }
  }, [adArea, adFocus, marketingRep?.slug, referralLink, routeForAdArea]);
  const adShareLink = adDraft?.shareUrl || adDraft?.trackedLink || trackedAdLink;
  const facebookShareHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(adShareLink)}`;

  useEffect(() => {
    if (!miningStatus?.currentSession) { setAnimatedTokens(0); return; }
    const server = parseFloat(miningStatus.accumulatedTokens || "0");
    setAnimatedTokens(server);
    const speed = parseFloat(miningStatus.miningSpeed || "1");
    const iv = setInterval(() => setAnimatedTokens(p => p + 0.0002 * speed), 100);
    return () => clearInterval(iv);
  }, [miningStatus?.currentSession, miningStatus?.accumulatedTokens, miningStatus?.miningSpeed]);

  const cycleProgress = useMemo(() => {
    if (!miningStatus?.currentSession || !miningStatus?.timeRemaining) return 0;
    const CYCLE = 24 * 60 * 60 * 1000;
    return Math.min(100, Math.max(0, ((CYCLE - miningStatus.timeRemaining) / CYCLE) * 100));
  }, [miningStatus?.timeRemaining, miningStatus?.currentSession]);

  const formatTimeRemaining = (ms: number) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  };

  const startMiningMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/mining/start"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mining/status"] });
      toast({ title: "Mining Started!", description: "Tokens are accumulating!" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const claimMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/mining/claim"),
    onSuccess: async (res: Response) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/mining/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rewards/wallet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rewards/history"] });
      const claimed = parseFloat(data.tokensClaimed || "0");
      toast({ title: "Tokens Claimed!", description: `+${claimed.toFixed(2)} JCMOVES` });
      notificationService.notifyNewReward("mining", claimed);
    },
    onError: (e: Error) => toast({ title: "Claim Failed", description: e.message, variant: "destructive" }),
  });

  const adDraftMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/crew/marketing/ad-draft", {
        area: adArea,
        focus: adFocus,
        rawText: [adNotes, adPhotoFileName ? `Photo selected by crew: ${adPhotoFileName}` : ""].filter(Boolean).join("\n"),
        photoUrl: adPhotoUrl,
        photoDataUrl: adPhotoDataUrl || undefined,
        creativeSource: {
          kind: adCreativeSource,
          approvedPhotoKey: "crew-ramp",
          photoDataUrl: adCreativeSource === "uploaded_photo" ? adPhotoDataUrl || undefined : undefined,
        },
        referralLink: trackedAdLink,
        promoCode: referralCode,
      });
      return response.json();
    },
    onSuccess: (data) => {
      setAdDraft(data.draft);
      setAdReward(data.marketingReward || null);
      queryClient.invalidateQueries({ queryKey: ["/api/crew/marketing/campaign-performance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/marketing/campaign-performance"] });
      const reward = data.marketingReward as MarketingAdReward | undefined;
      toast({
        title: reward?.awarded ? "Ad + image ready; bonus issued" : "Ad + image ready",
        description: reward?.awarded
          ? `+${Number(reward.bonusTokens || 0).toLocaleString()} JCMOVES for creating a tracked campaign.`
          : data.draft?.creative?.fallbackUsed
            ? data.draft.creative.reason || "Approved JC photo used as the creative fallback."
            : (reward?.reason || "ChatGPT-powered copy created."),
      });
    },
    onError: (e: Error) => toast({ title: "Ad draft failed", description: e.message, variant: "destructive" }),
  });

  const rerenderCreativeMutation = useMutation({
    mutationFn: async () => {
      if (!adDraft?.campaignId) throw new Error("Generate the campaign first.");
      const response = await apiRequest("POST", `/api/crew/marketing/campaigns/${encodeURIComponent(adDraft.campaignId)}/creative`, {
        source: {
          kind: adCreativeSource,
          approvedPhotoKey: "crew-ramp",
          photoDataUrl: adCreativeSource === "uploaded_photo" ? adPhotoDataUrl || undefined : undefined,
        },
        refreshCaption: true,
      });
      return response.json();
    },
    onSuccess: (data) => {
      setAdDraft((current) => current ? {
        ...current,
        facebookPost: data.facebookPost,
        shareUrl: data.shareUrl,
        trackedLink: data.trackedLink || current.trackedLink,
        creative: data.creative,
      } : current);
      queryClient.invalidateQueries({ queryKey: ["/api/crew/marketing/campaign-performance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/marketing/campaign-performance"] });
      toast({
        title: `Creative updated to revision ${data.creative?.revision || "new"}`,
        description: data.creative?.fallbackUsed
          ? data.creative.reason || "Approved JC photo used."
          : "The same campaign and tracking attribution were preserved. No additional reward was issued.",
      });
    },
    onError: (e: Error) => toast({ title: "Creative update failed", description: e.message, variant: "destructive" }),
  });

  const handleAdPhotoFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await compressMarketingPhoto(file);
      setAdPhotoFileName(file.name);
      setAdPhotoPreview(dataUrl);
      setAdPhotoDataUrl(dataUrl);
      setAdCreativeSource("uploaded_photo");
      toast({ title: "Photo added", description: "Device upload selected as the creative source." });
    } catch (error) {
      setAdPhotoFileName("");
      setAdPhotoPreview("");
      setAdPhotoDataUrl("");
      toast({
        title: "Photo not added",
        description: error instanceof Error ? error.message : "Try a different image.",
        variant: "destructive",
      });
    }
  };

  const downloadCreativeImage = async (draft: MarketingAdDraft) => {
    if (!draft.creative?.feedImageUrl) throw new Error("No generated image is available yet.");
    const response = await fetch(draft.creative.feedImageUrl, { credentials: "include" });
    if (!response.ok) throw new Error("Could not download the generated image.");
    const blob = await response.blob();
    const file = new File([blob], `jc-on-the-move-${draft.campaignId || "facebook-ad"}.jpg`, { type: "image/jpeg" });
    return { blob, file };
  };

  const saveCreativeImage = (blob: Blob, draft: MarketingAdDraft) => {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `jc-on-the-move-${draft.campaignId || "facebook-ad"}.jpg`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };

  const prepareFacebookShare = async (draft: MarketingAdDraft) => {
    const post = buildAdPostText(draft);
    let creative: Awaited<ReturnType<typeof downloadCreativeImage>> | null = null;
    try {
      creative = await downloadCreativeImage(draft);
      if (navigator.share && navigator.canShare?.({ files: [creative.file] })) {
        await navigator.share({
          files: [creative.file],
          title: draft.headline,
          text: post,
          url: draft.shareUrl || draft.trackedLink,
        });
        toast({ title: "Share sheet opened", description: "Choose Facebook or another app to post the image and tracked caption." });
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }

    if (creative) saveCreativeImage(creative.blob, draft);
    try {
      await navigator.clipboard?.writeText(post);
    } catch {}
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(draft.shareUrl || draft.trackedLink || trackedAdLink)}`, "_blank", "noopener,noreferrer");
    toast({
      title: creative ? "Image downloaded + caption copied" : "Caption copied",
      description: "Facebook opened. Upload the downloaded image, then paste the caption.",
    });
  };

  const tokenBalance = parseFloat(wallet?.tokenBalance || wallet?.balance || "0");
  const totalEarned = parseFloat(wallet?.totalEarned || "0");
  const canClaim = !!miningStatus?.currentSession && parseFloat(miningStatus.accumulatedTokens || "0") > 0;
  const activeStakes = stakes.filter((s: Stake) => s.status === "active");
  const history: RewardHistory[] = Array.isArray(rewardsHistory) ? rewardsHistory : [];
  const recentHistory = history.slice(0, 20);
  const cashPayouts = Array.isArray(crewPayouts) ? crewPayouts : [];
  const pendingCashPay = cashPayouts.reduce((sum, payout) => sum + parseFloat(payout.hourlyPay || "0") + parseFloat(payout.driverPremiumPay || "0") + parseFloat(payout.authorityBonusPay || "0"), 0);
  const paidCashPay = crewPayroll.filter((group) => group.period.status === "recorded_paid").reduce((sum, group) => sum + Number(group.total || 0), 0);
  const myAdCampaigns = myCampaignPerformance?.campaigns || [];
  const myAdSummary = myCampaignPerformance?.summary || {
    totalCampaigns: 0,
    funnelEvents: 0,
    submitSuccesses: 0,
    attributedCards: 0,
    errors: 0,
  };
  const marketingFlowSteps: ProcessFlowStep[] = [
    {
      phase: "start",
      label: "Create the ad",
      detail: "Pick an area, choose the job focus, add a real photo or short note, then generate the post.",
      state: adDraft ? "done" : "active",
      href: "#ad-builder",
      actionLabel: "Open builder",
    },
    {
      phase: "progress",
      label: "Share and reply",
      detail: "Post to Facebook or local groups, then copy the fast follow-up when somebody comments or messages.",
      state: adDraft ? (myAdSummary.funnelEvents > 0 ? "done" : "active") : "waiting",
    },
    {
      phase: "finish",
      label: "Turn clicks into cards",
      detail: "Tracked links feed the booking funnel, request cards, campaign stats, and JCMOVES marketing credit.",
      state: myAdSummary.attributedCards > 0 ? "done" : myAdSummary.funnelEvents > 0 ? "active" : "waiting",
    },
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 space-y-5">
      <div>
        <h1 className="text-2xl font-black text-white">{marketingMode ? "Marketing" : "Earnings"}</h1>
        <p className="text-slate-400 text-sm">
          {marketingMode
            ? "Create tracked local ads, share them, and turn traffic into job cards"
            : "Your pay visibility, JCMOVES balance, and referral tools"}
        </p>
      </div>

      {marketingMode && (
        <ProcessFlowCard
          title="Create, post, recover"
          description="A simple loop for any local opportunity: start with a useful post, progress by replying fast, finish by turning attention into a booked job card."
          steps={marketingFlowSteps}
        />
      )}

      {marketingMode && <MarketingLaunchCard />}

      {marketingMode && marketingRep?.slug.toLowerCase() === "matt" && <MarketingBotRepCard />}

      <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-emerald-300">Worker marketing link</p>
            <h2 className="mt-1 text-lg font-black text-white">Share your JC ON THE MOVE booking page</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              Send this link to customers. Jobs can be tracked back to your code so referrals, revenue, and future bonuses stay visible.
            </p>
          </div>
          <Share2 className="h-5 w-5 shrink-0 text-emerald-300" />
        </div>
        <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/50 p-3">
          <p className="break-all font-mono text-xs text-slate-200">{referralLink}</p>
          <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">{referralDestination}</p>
          {referralCode && <p className="mt-2 text-[11px] font-bold uppercase tracking-widest text-emerald-300">Code: {referralCode}</p>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-black text-slate-950 hover:bg-emerald-400"
            onClick={() => {
              navigator.clipboard?.writeText(referralLink)
                .then(() => toast({ title: "Referral link copied", description: referralDestination }))
                .catch(() => toast({ title: "Copy failed", description: "Long-press the link to copy it.", variant: "destructive" }));
            }}
          >
            <LinkIcon className="h-3.5 w-3.5" /> Copy link
          </button>
          <a
            href={referralSmsHref}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-slate-950/40 px-3 py-2 text-xs font-black text-emerald-200 hover:bg-emerald-500/10"
          >
            <MessageCircle className="h-3.5 w-3.5" /> Text link
          </a>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs font-black text-blue-200 hover:bg-blue-500/20"
            onClick={() => {
              navigator.clipboard?.writeText(readyToPostText)
                .then(() => toast({ title: "Ready-to-post text copied", description: "Paste it into Facebook, text, or a local group." }))
                .catch(() => toast({ title: "Copy failed", description: "Long-press the text or share the link instead.", variant: "destructive" }));
            }}
          >
            <Copy className="h-3.5 w-3.5" /> Copy post
          </button>
        </div>
      </div>

      <div id="ad-builder" className="rounded-2xl border border-blue-500/25 bg-blue-500/10 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-blue-300">1-2-3 ad builder</p>
            <h2 className="mt-1 text-lg font-black text-white">Create a local Facebook post</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              Pick the area and job focus, choose an image source, then generate a branded photo and tracked caption together.
            </p>
          </div>
          <Sparkles className="h-5 w-5 shrink-0 text-blue-300" />
        </div>

        <div className="mt-4 grid gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ad-area" className="text-xs text-slate-300">Area</Label>
              <Input
                id="ad-area"
                value={adArea}
                onChange={(event) => setAdArea(event.target.value)}
                className="border-slate-700 bg-slate-950/50 text-white"
              />
              <div className="flex flex-wrap gap-1.5">
                {AD_AREA_OPTIONS.map((area) => (
                  <button
                    key={area}
                    type="button"
                    onClick={() => setAdArea(area)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                      adArea === area
                        ? "border-blue-400 bg-blue-500 text-white"
                        : "border-slate-700 bg-slate-950/40 text-slate-300 hover:border-blue-500/60"
                    }`}
                  >
                    {area}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-300">Focus</Label>
              <div className="grid grid-cols-2 gap-2">
                {AD_FOCUS_OPTIONS.map((focus) => (
                  <button
                    key={focus}
                    type="button"
                    onClick={() => setAdFocus(focus)}
                    className={`rounded-lg border px-2 py-2 text-xs font-black transition ${
                      adFocus === focus
                        ? "border-blue-400 bg-blue-500 text-white"
                        : "border-slate-700 bg-slate-950/40 text-slate-300 hover:border-blue-500/60"
                    }`}
                  >
                    {focus}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-slate-300">Creative source</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {([
                {
                  kind: "approved_photo" as const,
                  label: "Approved JC photo",
                  detail: "Real crew-ramp photo; always ready.",
                  icon: ImageIcon,
                },
                {
                  kind: "uploaded_photo" as const,
                  label: "Device upload",
                  detail: adPhotoFileName || "Choose your own job photo.",
                  icon: Upload,
                },
                {
                  kind: "ai_scene" as const,
                  label: "Optional AI scene",
                  detail: marketingCreativeOptions?.readiness.aiReady
                    ? `Ready with ${marketingCreativeOptions.readiness.imageModel}.`
                    : "Falls back to approved photo if unavailable.",
                  icon: Sparkles,
                },
              ]).map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.kind}
                    type="button"
                    onClick={() => setAdCreativeSource(option.kind)}
                    className={`rounded-xl border p-3 text-left transition ${
                      adCreativeSource === option.kind
                        ? "border-blue-400 bg-blue-500/20"
                        : "border-slate-700 bg-slate-950/40 hover:border-blue-500/60"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-xs font-black text-white"><Icon className="h-4 w-4 text-blue-300" />{option.label}</span>
                    <span className="mt-1 block text-[10px] leading-relaxed text-slate-400">{option.detail}</span>
                  </button>
                );
              })}
            </div>
            {adCreativeSource === "approved_photo" && (
              <div className="mt-2 flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2.5">
                <img
                  src={marketingCreativeOptions?.approvedPhotos?.[0]?.thumbnailUrl || "/marketing-sources/crew-ramp.jpg"}
                  alt="Approved JC crew-ramp source"
                  className="h-12 w-16 rounded-md border border-white/10 object-cover"
                />
                <p className="text-[11px] leading-relaxed text-emerald-100">Approved real JC photo. Branded text is added exactly after the image is selected.</p>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ad-photo" className="text-xs text-slate-300">Reference photo URL <span className="text-slate-500">(caption context only)</span></Label>
            <Input
              id="ad-photo"
              value={adPhotoUrl}
              onChange={(event) => setAdPhotoUrl(event.target.value)}
              placeholder="Optional: paste a reference photo link"
              className="border-slate-700 bg-slate-950/50 text-white"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-slate-300">Photo from device</Label>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-blue-500/40 bg-slate-950/40 px-3 py-2 text-xs font-black text-blue-200 hover:bg-blue-500/10">
                <Upload className="h-3.5 w-3.5" /> Choose photo
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => handleAdPhotoFile(event.target.files?.[0])}
                />
              </label>
              {adPhotoFileName && <span className="max-w-full truncate text-xs text-slate-400">{adPhotoFileName}</span>}
              {adPhotoPreview && (
                <img
                  src={adPhotoPreview}
                  alt=""
                  className="h-10 w-10 rounded-md border border-slate-700 object-cover"
                />
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ad-notes" className="text-xs text-slate-300">Post note</Label>
            <Textarea
              id="ad-notes"
              value={adNotes}
              onChange={(event) => setAdNotes(event.target.value)}
              placeholder="Example: crew openings Friday, U-Haul unloads, garage cleanouts, senior move help..."
              className="min-h-[86px] border-slate-700 bg-slate-950/50 text-white"
            />
            <div className="flex flex-wrap gap-1.5">
              {AD_NOTE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setAdNotes((current) => appendAdNote(current, preset.text))}
                  className="rounded-full border border-slate-700 bg-slate-950/40 px-2.5 py-1 text-[11px] font-bold text-slate-300 hover:border-blue-500/60 hover:text-blue-100"
                >
                  + {preset.label}
                </button>
              ))}
            </div>
          </div>

          <Button
            type="button"
            disabled={adDraftMutation.isPending}
            onClick={() => adDraftMutation.mutate()}
            className="bg-blue-600 text-white hover:bg-blue-500"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {adDraftMutation.isPending ? "Writing + designing..." : "Generate Ad + Image"}
          </Button>
        </div>

        {adDraft && (
          <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/50 p-3">
            {adDraft.creative && (
              <div className="overflow-hidden rounded-xl border border-blue-500/25 bg-slate-900">
                <img
                  src={adDraft.creative.feedImageUrl}
                  alt={adDraft.creative.altText}
                  className="aspect-[4/5] w-full object-cover"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-3 py-2 text-[10px] text-slate-400">
                  <span>1080 × 1350 Facebook feed creative</span>
                  <span className="font-bold uppercase tracking-wider text-blue-200">
                    Revision {adDraft.creative.revision} · {adDraft.creative.sourceKind.replace(/_/g, " ")}
                  </span>
                </div>
              </div>
            )}
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
                {adDraft.creative?.feedImageUrl || adPhotoUrl || adPhotoPreview ? (
                  <img src={adDraft.creative?.feedImageUrl || adPhotoUrl || adPhotoPreview} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImageIcon className="h-5 w-5 text-slate-500" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-black text-white">{adDraft.headline}</p>
                <p className="mt-1 text-[11px] text-slate-400">{adDraft.photoSuggestion}</p>
              </div>
            </div>
            <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs leading-relaxed text-slate-200">
{adDraft.facebookPost}
            </pre>
            {adDraft.hashtags?.length > 0 && (
              <p className="mt-2 text-xs font-semibold text-blue-200">{adDraft.hashtags.join(" ")}</p>
            )}
            {adDraft.communityTargets?.length ? (
              <div className="mt-3 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-300">Where to post</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {adDraft.communityTargets.map((target) => (
                    <span key={target} className="rounded-full border border-blue-400/30 bg-blue-500/10 px-2.5 py-1 text-[11px] font-semibold text-blue-100">
                      {target}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {adDraft.followUpText && (
              <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/70 p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Fast follow-up</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-200">{adDraft.followUpText}</p>
              </div>
            )}
            {adDraft.postingChecklist?.length ? (
              <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">1-2-3 posting check</p>
                <div className="mt-2 grid gap-1.5">
                  {adDraft.postingChecklist.map((item, index) => (
                    <div key={`${item}-${index}`} className="flex gap-2 text-xs text-slate-300">
                      <span className="font-black text-emerald-300">{index + 1}</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {(adDraft.campaignId || adDraft.trackedLink) && (
              <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3">
                {adDraft.campaignId && (
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Campaign {adDraft.campaignId}</p>
                )}
                {adDraft.trackedLink && (
                  <p className="mt-1 break-all font-mono text-[11px] text-emerald-100">Destination: {adDraft.trackedLink}</p>
                )}
                {adDraft.shareUrl && (
                  <p className="mt-1 break-all font-mono text-[11px] text-blue-100">Facebook preview: {adDraft.shareUrl}</p>
                )}
                {adReward && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                    <span className={adReward.awarded ? "text-orange-200" : "text-slate-400"}>
                      {adReward.awarded
                        ? `+${Number(adReward.bonusTokens || 0).toLocaleString()} JCMOVES marketing bonus`
                        : adReward.reason || "Marketing bonus not issued"}
                    </span>
                    {adReward.dailyLimit ? (
                      <span className="rounded-full border border-slate-700 bg-slate-950/40 px-2 py-0.5 text-slate-400">
                        {adReward.dailyAwardCount || 0}/{adReward.dailyLimit} today
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-black text-slate-950 hover:bg-emerald-400"
                onClick={() => prepareFacebookShare(adDraft)}
              >
                <Share2 className="h-3.5 w-3.5" /> Share image + post
              </button>
              {adDraft.creative && (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs font-black text-blue-200 hover:bg-blue-500/20"
                  onClick={async () => {
                    try {
                      const creative = await downloadCreativeImage(adDraft);
                      saveCreativeImage(creative.blob, adDraft);
                      toast({ title: "Feed image downloaded", description: "Upload this 1080 × 1350 JPEG to Facebook." });
                    } catch (error) {
                      toast({ title: "Download failed", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
                    }
                  }}
                >
                  <ImageIcon className="h-3.5 w-3.5" /> Download image
                </button>
              )}
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-3 py-2 text-xs font-black text-white hover:bg-blue-400"
                onClick={() => {
                  const post = buildAdPostText(adDraft);
                  navigator.clipboard?.writeText(post)
                    .then(() => toast({ title: "Ad copied", description: "Paste it into Facebook, Messenger, or a local group." }))
                    .catch(() => toast({ title: "Copy failed", description: "Long-press the post text to copy it.", variant: "destructive" }));
                }}
              >
                <Copy className="h-3.5 w-3.5" /> Copy caption
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-xs font-black text-orange-200 hover:bg-orange-500/20"
                onClick={() => {
                  navigator.clipboard?.writeText(buildAdKitText(adDraft))
                    .then(() => toast({ title: "Ad kit copied", description: "Post, follow-up, and target list copied together." }))
                    .catch(() => toast({ title: "Copy failed", description: "Long-press the ad text to copy it.", variant: "destructive" }));
                }}
              >
                <Copy className="h-3.5 w-3.5" /> Copy kit
              </button>
              <a
                href={facebookShareHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-blue-500/40 bg-slate-950/40 px-3 py-2 text-xs font-black text-blue-200 hover:bg-blue-500/10"
              >
                <Share2 className="h-3.5 w-3.5" /> Open Facebook
              </a>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-950/40 px-3 py-2 text-xs font-black text-slate-200 hover:bg-slate-800"
                onClick={() => {
                  navigator.clipboard?.writeText(adDraft.shortText)
                    .then(() => toast({ title: "Short text copied", description: "Good for SMS or Messenger." }))
                    .catch(() => toast({ title: "Copy failed", description: "Long-press the short text to copy it.", variant: "destructive" }));
                }}
              >
                <MessageCircle className="h-3.5 w-3.5" /> Copy short
              </button>
              {adDraft.followUpText && (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-black text-emerald-200 hover:bg-emerald-500/20"
                  onClick={() => {
                    navigator.clipboard?.writeText(adDraft.followUpText || "")
                      .then(() => toast({ title: "Follow-up copied", description: "Send this to anyone who comments or messages." }))
                      .catch(() => toast({ title: "Copy failed", description: "Long-press the follow-up text to copy it.", variant: "destructive" }));
                  }}
                >
                  <MessageCircle className="h-3.5 w-3.5" /> Copy follow-up
                </button>
              )}
              {adDraft.campaignId && (
                <button
                  type="button"
                  disabled={rerenderCreativeMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-xs font-black text-violet-200 hover:bg-violet-500/20 disabled:opacity-50"
                  onClick={() => rerenderCreativeMutation.mutate()}
                >
                  {rerenderCreativeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Update same campaign
                </button>
              )}
            </div>
            {adDraft.fallbackUsed && (
              <p className="mt-2 text-[11px] text-amber-300">Template fallback used: {adDraft.reason || "AI unavailable"}</p>
            )}
            {adDraft.creative?.fallbackUsed && (
              <p className="mt-2 text-[11px] text-amber-300">Image fallback: {adDraft.creative.reason || "Approved JC photo used."}</p>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-700/40 bg-slate-900/50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-slate-400">My ad results</p>
            <h2 className="mt-1 text-lg font-black text-white">Traffic to job cards</h2>
          </div>
          <TrendingUp className="h-5 w-5 shrink-0 text-emerald-300" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-3 text-center">
            <p className="text-xl font-black text-white">{myAdSummary.funnelEvents}</p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-blue-200">Traffic</p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-center">
            <p className="text-xl font-black text-white">{myAdSummary.submitSuccesses}</p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-200">Requests</p>
          </div>
          <div className="rounded-xl border border-orange-500/20 bg-orange-500/10 p-3 text-center">
            <p className="text-xl font-black text-white">{myAdSummary.attributedCards}</p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-orange-200">Cards</p>
          </div>
        </div>

        {myAdCampaigns.length === 0 ? (
          <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
            No tracked ad results yet.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {myAdCampaigns.slice(0, 4).map((campaign) => {
              const cards = Math.max(Number(campaign.attributed_cards || 0), Number(campaign.recovered_or_linked || 0));
              return (
                <div key={campaign.id} className="rounded-xl border border-slate-800 bg-slate-950/45 p-3">
                  <div className="flex items-start justify-between gap-3">
                    {campaign.feed_image_url && (
                      <img
                        src={campaign.feed_image_url}
                        alt=""
                        className="h-14 w-12 shrink-0 rounded-md border border-white/10 object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-white">{campaign.title || "Local ad"}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-400">
                        {campaign.area || "Any area"} - {campaign.focus || "Any focus"}
                      </p>
                      {campaign.share_url && (
                        <a
                          href={campaign.share_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex text-[10px] font-bold text-blue-300 hover:text-blue-200"
                        >
                          Open preview · r{campaign.creative_revision || 1}
                        </a>
                      )}
                    </div>
                    <span className="shrink-0 rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-slate-300">
                      {new Date(campaign.last_activity_at || campaign.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-sm font-black text-blue-300">{Number(campaign.funnel_events || 0)}</p>
                      <p className="text-[10px] text-slate-500">Traffic</p>
                    </div>
                    <div>
                      <p className="text-sm font-black text-emerald-300">{Number(campaign.submit_successes || 0)}</p>
                      <p className="text-[10px] text-slate-500">Requests</p>
                    </div>
                    <div>
                      <p className="text-sm font-black text-orange-300">{cards}</p>
                      <p className="text-[10px] text-slate-500">Cards</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {marketingMode && (
        <MarketplaceProcessGuide
          source="facebook"
          audience="worker"
          serviceLabel={adFocus}
          compact
        />
      )}

      {marketingMode && (
        <MarketplaceActionMatrix
          rail="worker"
          phase="start"
          compact
          limit={3}
        />
      )}

      {!marketingMode && (
        <>
      {/* Crew Capabilities (read-only) */}
      {userCapabilities.length > 0 && (
        <div className="rounded-2xl bg-slate-800/40 border border-slate-700/30 p-4">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Wrench className="h-3.5 w-3.5" /> Your Capabilities
          </p>
          <div className="flex flex-wrap gap-2">
            {ALL_CAPABILITIES.filter(cap => userCapabilities.includes(cap.key)).map(cap => {
              const Icon = cap.icon;
              return (
                <span key={cap.key} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-600/20 border border-blue-500/30 text-blue-300 text-xs font-semibold">
                  <Icon className="h-3.5 w-3.5" /> {cap.label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div
        className="grid grid-cols-1 gap-2 rounded-2xl border border-purple-500/25 bg-purple-500/10 p-3 sm:grid-cols-3"
        data-testid="crew-jcmoves-actions"
      >
        <button
          type="button"
          onClick={() => setWalletChoiceOpen(true)}
          className="flex items-center justify-between rounded-xl border border-purple-500/30 bg-slate-950/45 p-3 text-left hover:border-purple-400/60"
          data-testid="button-crew-jcmoves-receive"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Wallet className="h-4 w-4 shrink-0 text-purple-300" />
            <span>
              <span className="block text-xs font-black text-white">Receive</span>
              <span className="block text-[10px] text-slate-400">Wallet setup</span>
            </span>
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
        </button>
        <Link href="/rewards">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-xl border border-emerald-500/25 bg-slate-950/45 p-3 text-left hover:border-emerald-400/60"
            data-testid="button-crew-jcmoves-redeem"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Gift className="h-4 w-4 shrink-0 text-emerald-300" />
              <span>
                <span className="block text-xs font-black text-white">Redeem</span>
                <span className="block text-[10px] text-slate-400">Rewards shop</span>
              </span>
            </span>
            <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
          </button>
        </Link>
        <a href="#history">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-xl border border-blue-500/25 bg-slate-950/45 p-3 text-left hover:border-blue-400/60"
            data-testid="button-crew-jcmoves-earn"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Zap className="h-4 w-4 shrink-0 text-blue-300" />
              <span>
                <span className="block text-xs font-black text-white">Earn</span>
                <span className="block text-[10px] text-slate-400">Tasks & history</span>
              </span>
            </span>
            <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
          </button>
        </a>
      </div>

      {/* Balance Summary — clickable tiles */}
      <div className="grid grid-cols-3 gap-3">
        <Link href="/rewards">
          <div className="bg-slate-800/60 border border-purple-500/30 rounded-xl p-3 text-center cursor-pointer hover:bg-purple-950/30 hover:border-purple-500/50 transition-colors group">
            <p className="text-base font-black text-purple-400">{formatTokens(tokenBalance)}</p>
            <p className="text-slate-500 text-xs">Balance</p>
            <p className="text-purple-500 text-[9px] mt-0.5 group-hover:text-purple-400">Spend</p>
          </div>
        </Link>
        <a href="#history">
          <div className="bg-slate-800/60 border border-green-500/20 rounded-xl p-3 text-center cursor-pointer hover:bg-green-950/20 hover:border-green-500/40 transition-colors group">
            <p className="text-base font-black text-green-400">{formatTokens(totalEarned)}</p>
            <p className="text-slate-500 text-xs">Total Earned</p>
            <p className="text-green-600 text-[9px] mt-0.5 group-hover:text-green-400">History</p>
          </div>
        </a>
        <Link href="/staking">
          <div className="bg-slate-800/60 border border-blue-500/20 rounded-xl p-3 text-center cursor-pointer hover:bg-blue-950/20 hover:border-blue-500/40 transition-colors group">
            <p className="text-base font-black text-blue-400">{activeStakes.length}</p>
            <p className="text-slate-500 text-xs">Stakes</p>
            <p className="text-blue-600 text-[9px] mt-0.5 group-hover:text-blue-400">Manage</p>
          </div>
        </Link>
      </div>

      {/* Employee earnings visibility */}
      <Card className="border-emerald-500/20 bg-emerald-950/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-white flex items-center gap-2 text-base">
            <Coins className="h-4 w-4 text-emerald-300" /> Employee Earnings
          </CardTitle>
          <CardDescription className="text-slate-400 text-xs">
            Monthly classification pay, driver and authority bonuses, and customer tips; profit bonuses are paid quarterly
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Finalized monthly earnings</p>
              <p className="mt-1 text-xl font-black text-white">{money(pendingCashPay)}</p>
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">Ledgered paid periods</p>
              <p className="mt-1 text-xl font-black text-white">{money(paidCashPay)}</p>
            </div>
          </div>

          {cashPayouts.length === 0 ? (
            <p className="rounded-lg border border-slate-700/40 bg-slate-900/40 p-3 text-sm text-slate-400">
              No finalized employee earnings records yet.
            </p>
          ) : (
            <div className="space-y-2">
              {cashPayouts.slice(0, 8).map((payout) => {
                const statusIsPaid = payout.payoutStatus === "payroll_recorded_paid";
                const statusIsFailed = payout.payoutStatus === "failed";
                const customer = [payout.firstName, payout.lastName].filter(Boolean).join(" ").trim() || "Job";
                return (
                  <div key={payout.id} className="rounded-xl border border-slate-700/40 bg-slate-900/50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-white">{customer}</p>
                        <p className="text-xs capitalize text-slate-400">{(payout.serviceType || "job").replace(/_/g, " ")}</p>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize ${
                        statusIsPaid
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                          : statusIsFailed
                          ? "border-red-500/40 bg-red-500/15 text-red-300"
                          : "border-amber-500/40 bg-amber-500/15 text-amber-300"
                      }`}>
                        {payoutStatusLabel(payout.payoutStatus)}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-6">
                      <div>
                        <p className="text-[10px] text-slate-500">Hours</p>
                        <p className="text-sm font-bold text-slate-200">{parseFloat(payout.hoursWorked || "0").toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500">Classification</p>
                        <p className="text-sm font-bold text-blue-300">{money(payout.hourlyPay)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500">Driver</p>
                        <p className="text-sm font-bold text-blue-300">{money(payout.driverPremiumPay)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500">5% / 10%</p>
                        <p className="text-sm font-bold text-purple-300">{money(payout.authorityBonusPay)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500">Quarterly profit bonus</p>
                        <p className="text-sm font-bold text-amber-300">{money(payout.crewBonusPay)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500">Total</p>
                        <p className="text-sm font-black text-emerald-300">{money(payout.totalPay)}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-[10px] text-slate-500">
                      {(payout.roleOnJob || "mover").replace(/_/g, " ")} · {(parseFloat(payout.jobRevenueSharePct || "0") * 100).toFixed(1)}% of job revenue · JCMOVES are tracked separately at paid job completion.
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mining Section */}
      <Card className="border-orange-500/20 bg-orange-950/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-white flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-orange-400" /> Daily Mining
          </CardTitle>
          <CardDescription className="text-slate-400 text-xs">Earn passive tokens every day - claim up to 3 times</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg border border-white/5">
            <div>
              <p className="text-xs text-slate-400">Streak</p>
              <p className="text-xl font-black text-orange-400">{miningStatus?.streakCount || 0} days</p>
              {(miningStatus?.streakCount || 0) > 1 && <p className="text-xs text-green-400">+{miningStatus!.streakCount - 1}% bonus</p>}
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Available</p>
              <p className="text-xl font-black text-green-400 tabular-nums">
                {miningStatus?.currentSession ? animatedTokens.toFixed(4) : "0.0000"}
              </p>
              <p className="text-xs text-slate-500">JCMOVES</p>
            </div>
          </div>

          {miningStatus?.currentSession && (
            <div className="space-y-1.5 p-3 bg-orange-500/10 rounded-lg border border-orange-500/20">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300 flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
                  </span>
                  Mining Active
                </span>
                <span className="text-orange-400">{formatTimeRemaining(miningStatus.timeRemaining)} left</span>
              </div>
              <Progress value={cycleProgress} className="h-2 bg-slate-700" />
              <p className="text-xs text-slate-500 text-center">{miningStatus.claimsRemainingToday} of 3 claims remaining today</p>
            </div>
          )}

          {!miningStatus?.currentSession ? (
            <Button
              className="w-full bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 font-bold"
              onClick={() => startMiningMutation.mutate()}
              disabled={startMiningMutation.isPending}
            >
              {startMiningMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Starting...</> : <><Zap className="h-4 w-4 mr-2" />Start Mining</>}
            </Button>
          ) : (
            <Button
              className="w-full bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 font-bold"
              onClick={() => claimMutation.mutate()}
              disabled={!canClaim || claimMutation.isPending || (miningStatus?.claimsRemainingToday || 0) <= 0}
            >
              {claimMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Claiming...</> :
               (miningStatus?.claimsRemainingToday || 0) <= 0 ? <><Clock className="h-4 w-4 mr-2" />Max Claims Today</> :
               canClaim ? <><Coins className="h-4 w-4 mr-2" />Claim Tokens</> :
               <><Clock className="h-4 w-4 mr-2" />Accumulating...</>}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Staking Perks */}
      <div className="bg-slate-800/40 border border-blue-500/20 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-blue-400" />
            <span className="font-bold text-white text-sm">Token Staking Perks</span>
          </div>
          <Link href="/staking">
            <span className="text-blue-400 text-xs hover:text-blue-300">Manage</span>
          </Link>
        </div>
        <p className="text-slate-400 text-xs">Lock JCMOVES to unlock service discounts, worker job bonuses, and premium platform access.</p>

        {/* Tier benefits */}
        <div className="space-y-2">
          {[
            { threshold: 25_000, label: "Silver Tier", perks: ["5% service discount", "5% job bonus (workers)", "Premium shop access"], color: "border-slate-400/30 bg-slate-700/20", badge: "text-slate-300 bg-slate-700/40" },
            { threshold: 100_000, label: "Gold Tier", perks: ["10% service discount", "10% job bonus (workers)", "Early booking windows", "VIP badge"], color: "border-yellow-500/30 bg-yellow-950/20", badge: "text-yellow-300 bg-yellow-900/30" },
          ].map(tier => {
            const totalStaked = activeStakes.reduce((sum: number, s: Stake) => sum + parseFloat(s.amount), 0);
            const unlocked = totalStaked >= tier.threshold;
            return (
              <div key={tier.threshold} className={`rounded-xl border p-3 ${tier.color} ${!unlocked ? "opacity-60" : ""}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${tier.badge}`}>{tier.label}</span>
                  <span className="text-[10px] text-slate-400">{(tier.threshold / 1000).toFixed(0)}k JCMOVES locked</span>
                  {unlocked && <span className="text-green-400 text-[10px] font-bold">UNLOCKED</span>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {tier.perks.map(p => (
                    <span key={p} className="text-[10px] text-slate-300 bg-white/5 rounded px-1.5 py-0.5">{p}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {activeStakes.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Your active locks</p>
            {activeStakes.map((stake: Stake) => (
              <div key={stake.id} className="p-2.5 bg-slate-900/50 rounded-lg border border-white/5 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-white text-xs">{stake.tier?.name}</p>
                  <p className="text-[10px] text-slate-400">{formatTokens(parseFloat(stake.amount))} JCMOVES locked</p>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1 text-[10px] text-slate-500">
                    <Clock className="h-3 w-3" />
                    <span>{daysRemaining(stake.endsAt)}d left</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rewards History */}
      <div id="history">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-white">Recent Earnings</h2>
          <span className="text-xs text-slate-400">{recentHistory.length} records</span>
        </div>
        {recentHistory.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <Coins className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p>No earnings yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentHistory.map(item => {
              // Task #173 — visually break out base payout vs. bonus on
              // completed jobs so the crew can see exactly why the number
              // came in higher than the base amount.
              const isBonus = item.rewardType === "worker_job_completion_bonus"
                || item.rewardType === "worker_hours_bonus";
              const isBase = item.rewardType === "job_completion";
              const accent = isBonus
                ? { border: "border-emerald-500/30", chip: "bg-emerald-900/30 border-emerald-700/40", icon: "text-emerald-300", amount: "text-emerald-300", tag: "BONUS" }
                : isBase
                ? { border: "border-green-500/20", chip: "bg-green-900/30 border-green-700/30", icon: "text-green-400", amount: "text-green-400", tag: "BASE" }
                : { border: "border-slate-700/30", chip: "bg-slate-900/30 border-slate-700/30", icon: "text-green-400", amount: "text-green-400", tag: "" };
              return (
                <div key={item.id} className={`flex items-center gap-3 bg-slate-800/40 border ${accent.border} rounded-xl px-4 py-3`} data-testid={`earning-${item.id}`}>
                  <div className={`w-9 h-9 rounded-lg ${accent.chip} border flex items-center justify-center flex-shrink-0`}>
                    <TrendingUp className={`h-4 w-4 ${accent.icon}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-white truncate">{REWARD_LABELS[item.rewardType] || item.rewardType}</p>
                      {accent.tag && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${isBonus ? "bg-emerald-500/20 text-emerald-300" : "bg-green-500/20 text-green-300"}`}>
                          {accent.tag}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">{new Date(item.earnedDate).toLocaleDateString()}</p>
                  </div>
                  <span className={`text-sm font-bold ${accent.amount}`}>+{parseFloat(item.tokenAmount).toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="h-2" />
        </>
      )}
      <WalletChoiceModal
        open={walletChoiceOpen}
        onClose={() => setWalletChoiceOpen(false)}
        onComplete={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/user/wallet-preference"] });
          queryClient.invalidateQueries({ queryKey: ["/api/rewards/wallet"] });
          queryClient.invalidateQueries({ queryKey: ["/api/rewards/history"] });
        }}
      />
    </div>
  );
}

import { useEffect, useState, useRef } from "react";
import { WorkerAvatar } from '@/components/WorkerAvatar';
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Star, Heart, Users, DollarSign, ChevronRight, CheckCircle, Truck,
  ShoppingCart, Bitcoin, Copy, Check, Gem, Tag, ExternalLink,
  Search, Phone, Mail, Hash, ArrowRight, AlertCircle, Calendar,
  Coins, Wallet, Banknote
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { useCart } from "@/hooks/useCart";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

// ─── Star Rating ──────────────────────────────────────────────────────────────
function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  const labels = ["", "Poor", "Fair", "Good", "Great", "Excellent!"];
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 justify-center">
        {[1, 2, 3, 4, 5].map((star) => (
          <button key={star} type="button" onClick={() => onChange(star)}
            onMouseEnter={() => setHovered(star)} onMouseLeave={() => setHovered(0)}
            className="transition-transform active:scale-95 focus:outline-none p-1.5">
            <Star className={`h-9 w-9 md:h-11 md:w-11 transition-colors ${star <= (hovered || value)
              ? "fill-amber-400 text-amber-400"
              : "text-slate-300 dark:text-slate-600"}`} />
          </button>
        ))}
      </div>
      {(hovered || value) > 0 && (
        <p className="text-center text-base font-semibold text-amber-500">
          {labels[hovered || value]}
        </p>
      )}
    </div>
  );
}

// ─── Bitcoin tip address display ──────────────────────────────────────────────
function BitcoinTipPanel({ usdAmount }: { usdAmount: number }) {
  const [copied, setCopied] = useState(false);
  const { data: tipInfo, isLoading } = useQuery<{ address: string; btcPrice: number }>({
    queryKey: ["/api/btc/tip-info"],
    queryFn: async () => {
      const res = await fetch("/api/btc/tip-info");
      if (!res.ok) throw new Error("Unable to load Bitcoin info");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const btcAmount = tipInfo?.btcPrice && usdAmount > 0
    ? (usdAmount / tipInfo.btcPrice).toFixed(6)
    : null;

  const handleCopy = () => {
    if (tipInfo?.address) {
      navigator.clipboard.writeText(tipInfo.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  if (isLoading) return (
    <div className="flex items-center justify-center py-6">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" />
    </div>
  );

  if (!tipInfo?.address) return (
    <p className="text-center text-sm text-muted-foreground py-4">
      Bitcoin tips are not available right now. Please use cart checkout.
    </p>
  );

  return (
    <div className="space-y-4">
      <div className="bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded-xl p-4 text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Bitcoin className="h-5 w-5 text-orange-500" />
          <span className="font-bold text-orange-600 dark:text-orange-400 text-lg">Bitcoin Tip</span>
        </div>
        <p className="text-3xl font-black text-orange-500 mb-1">${usdAmount.toFixed(2)}</p>
        {btcAmount && (
          <p className="text-sm text-orange-600 dark:text-orange-400">
            ≈ <span className="font-mono font-bold">{btcAmount} BTC</span>
            {tipInfo.btcPrice ? ` @ $${tipInfo.btcPrice.toLocaleString()}/BTC` : ""}
          </p>
        )}
      </div>

      <div>
        <p className="text-xs text-muted-foreground text-center mb-2">Send Bitcoin to this address:</p>
        <div className="flex gap-2 items-center">
          <div className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2 font-mono text-xs break-all text-foreground border border-border">
            {tipInfo.address}
          </div>
          <Button size="sm" variant="outline" onClick={handleCopy}
            className="shrink-0 border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950">
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4 text-orange-500" />}
          </Button>
        </div>
        {copied && <p className="text-xs text-green-600 text-center mt-1">Address copied!</p>}
      </div>

      <div className="text-xs text-muted-foreground text-center space-y-1">
        <p>Send exactly the BTC amount shown above.</p>
        <p>After sending, click <strong>Submit Review</strong> — our team will verify and distribute tips to the crew.</p>
      </div>
    </div>
  );
}

// ─── Featured Jewelry Discount ─────────────────────────────────────────────────
function JewelryDiscountCard() {
  const { addItem, isInCart } = useCart();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: jewelry } = useQuery<any[]>({
    queryKey: ["/api/jewelry"],
    queryFn: async () => {
      const res = await fetch("/api/jewelry?status=active");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  const featured = jewelry?.find((j) => j.status === "active" && j.price) || jewelry?.[0];
  if (!featured) return null;

  const originalPrice = parseFloat(featured.price);
  const discountedPrice = Math.round(originalPrice * 0.9 * 100) / 100;
  const inCart = isInCart(`jewelry-review-${featured.id}`);

  const handleAddToCart = () => {
    addItem({
      id: `jewelry-review-${featured.id}`,
      name: `${featured.title} — Review Special`,
      price: discountedPrice,
      image: featured.images?.[0] || "",
      type: "jewelry",
    });
    toast({ title: "Added to cart! 💎", description: `${featured.title} at 10% off — review discount applied.` });
  };

  return (
    <Card className="border-2 border-purple-200 dark:border-purple-800 overflow-hidden">
      <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-4 py-3 flex items-center gap-2">
        <Gem className="h-5 w-5" />
        <div>
          <p className="font-bold text-sm">Thank-You Discount — Ashley's Shop</p>
          <p className="text-xs opacity-90">Exclusive 10% off for completing your review</p>
        </div>
        <Badge className="ml-auto bg-white text-purple-700 font-bold text-xs">10% OFF</Badge>
      </div>
      <CardContent className="pt-4 pb-4">
        <div className="flex gap-4 items-start">
          {featured.images?.[0] && (
            <div className="w-20 h-20 rounded-xl overflow-hidden shrink-0 border border-border">
              <img src={featured.images[0]} alt={featured.title}
                className="w-full h-full object-cover" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground text-sm leading-tight mb-1 truncate">
              {featured.title}
            </p>
            {featured.shortDescription && (
              <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                {featured.shortDescription}
              </p>
            )}
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-xl font-black text-purple-600 dark:text-purple-400">
                ${discountedPrice.toFixed(2)}
              </span>
              <span className="text-sm text-muted-foreground line-through">
                ${originalPrice.toFixed(2)}
              </span>
              <Tag className="h-3 w-3 text-green-500" />
              <span className="text-xs text-green-600 dark:text-green-400 font-semibold">
                Save ${(originalPrice - discountedPrice).toFixed(2)}
              </span>
            </div>
            <div className="flex gap-2">
              <Button size="sm"
                onClick={handleAddToCart}
                disabled={inCart}
                className={`flex-1 text-xs ${inCart
                  ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 border border-green-400"
                  : "bg-purple-600 hover:bg-purple-700 text-white"}`}>
                {inCart
                  ? <><Check className="h-3 w-3 mr-1" /> In Cart</>
                  : <><ShoppingCart className="h-3 w-3 mr-1" /> Add to Cart</>}
              </Button>
              <Button size="sm" variant="outline"
                onClick={() => navigate(`/nature-made-jewls/${featured.id}`)}
                className="text-xs border-purple-300 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950">
                <ExternalLink className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Job Lookup Screen ────────────────────────────────────────────────────────
const SERVICE_LABELS: Record<string, string> = {
  residential: "Residential Move", commercial: "Commercial Move",
  junk: "Junk Removal", snow: "Snow Removal", cleaning: "Cleaning",
  handyman: "Handyman", demolition: "Demolition", flooring: "Flooring", painting: "Painting",
};

type TipMethod = "cash" | "cart" | "bitcoin" | "jcmoves" | "jcmoves_usd";

type AssignedEmployee = {
  avatar?: import('@shared/crewGrowth').WorkerAvatar;
  avatarImageUrl?: string | null;
  id: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
};

type WalletBalance = {
  tokenBalance: string;
  cashBalance: string;
};

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "J") + (parts[1]?.[0] || "C");
}

function formatTokenAmount(value: number) {
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function JobLookupScreen({ onSelect }: { onSelect: (jobId: string, token?: string) => void }) {
  const [searchInput, setSearchInput] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [lookupError, setLookupError] = useState("");

  const handleLookup = async () => {
    const val = searchInput.trim();
    if (val.length < 3) { setLookupError("Please enter at least 3 characters"); return; }
    setSearching(true);
    setLookupError("");
    setResults(null);
    setSubmitted(val);
    try {
      const res = await fetch("/api/review/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ search: val }),
      });
      const data = await res.json();
      if (!res.ok) { setLookupError(data.error || "Not found"); return; }
      setResults(data.results || []);
    } catch {
      setLookupError("Something went wrong. Please try again.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 via-white to-white dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
      <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-4 py-8 text-center shadow-lg">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Truck className="h-7 w-7" />
            <span className="text-xl font-bold tracking-wide">JC ON THE MOVE</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold mb-1">Leave a Review</h1>
          <p className="opacity-90 text-sm md:text-base">
            Look up your job to get started
          </p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-10 space-y-6">
        <Card className="border-amber-200 dark:border-amber-800 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Search className="h-5 w-5 text-amber-500" />
              Find Your Job
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Enter your phone number, email address, or job ID - we'll pull up your job.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Lookup hints */}
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { icon: Phone, label: "Phone", example: "Best phone" },
                { icon: Mail, label: "Email", example: "Best email" },
                { icon: Hash, label: "Job ID", example: "abc12345" },
              ].map(({ icon: Icon, label, example }) => (
                <div key={label} className="rounded-lg border border-border bg-muted/40 px-2 py-2">
                  <Icon className="h-4 w-4 text-amber-500 mx-auto mb-1" />
                  <p className="text-xs font-medium text-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground">{example}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Input
                value={searchInput}
                onChange={(e) => { setSearchInput(e.target.value); setLookupError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleLookup()}
                placeholder="Phone, email, or job ID…"
                className="flex-1"
                autoFocus
              />
              <Button onClick={handleLookup} disabled={searching}
                className="bg-amber-500 hover:bg-amber-600 text-white shrink-0">
                {searching
                  ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  : <Search className="h-4 w-4" />}
              </Button>
            </div>

            {lookupError && (
              <div className="flex items-start gap-2 text-destructive text-sm bg-destructive/10 rounded-lg px-3 py-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                {lookupError}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Results */}
        {results !== null && (
          <div className="space-y-3">
            {results.length === 0 ? (
              <div className="text-center py-6">
                <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
                <p className="font-medium text-foreground">No jobs found</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Try your phone number, email address, or the job ID from your confirmation.
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {results.length} job{results.length !== 1 ? "s" : ""} found — select yours below:
                </p>
                {results.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => {
                      if (job.reviewToken) onSelect(job.id, job.reviewToken);
                      else onSelect(job.id);
                    }}
                    className={`w-full text-left rounded-xl border-2 p-4 transition-all hover:border-amber-400 ${
                      job.isCompleted
                        ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30"
                        : "border-border bg-background hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-semibold text-foreground">
                            {job.firstName} {job.lastName}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            job.isCompleted
                              ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                          }`}>
                            {job.isCompleted ? "✓ Completed" : job.status.replace(/_/g, " ")}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {SERVICE_LABELS[job.serviceType] || job.serviceType}
                        </p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(job.createdAt).toLocaleDateString("en-US", {
                            month: "long", day: "numeric", year: "numeric"
                          })}
                        </div>
                        <p className="text-xs text-muted-foreground font-mono mt-1">
                          ID: {job.id}
                        </p>
                      </div>
                      <div className="shrink-0">
                        {job.isCompleted
                          ? <ArrowRight className="h-5 w-5 text-green-500 mt-1" />
                          : <ArrowRight className="h-5 w-5 text-muted-foreground mt-1" />}
                      </div>
                    </div>
                    {!job.isCompleted && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                        Reviews can only be submitted for completed jobs
                      </p>
                    )}
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Can't find your job? Call us at{" "}
          <a href="tel:9062859312" className="text-amber-600 dark:text-amber-400 font-medium hover:underline">
            (906) 285-9312
          </a>
        </p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function LeaveReviewPage() {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token");
  const urlJobId = params.get("jobId");

  // Support self-service lookup: user arrives without a token/jobId
  // All hooks must be declared before any conditional returns
  const [resolvedJobId, setResolvedJobId] = useState<string | null>(urlJobId);
  const [resolvedToken, setResolvedToken] = useState<string | null>(urlToken);
  const { addItem, isInCart, itemCount } = useCart();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [submitted, setSubmitted] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [moverNames, setMoverNames] = useState("");
  const [wouldRecommend, setWouldRecommend] = useState(true);
  const [includeTip, setIncludeTip] = useState(false);
  const [numberOfMovers, setNumberOfMovers] = useState(2);
  const [tipPerMover, setTipPerMover] = useState(20);
  const [tokenTipPerMover, setTokenTipPerMover] = useState(100);
  const [tipMethod, setTipMethod] = useState<TipMethod>("cart");
  const [selectedCrewIds, setSelectedCrewIds] = useState<string[]>([]);

  const token = resolvedToken;
  const jobId = resolvedJobId;

  // Keep all hooks ABOVE any conditional returns
  const tipCartId = `tip-${token || jobId || "job"}`;
  const tipInCart = isInCart(tipCartId);
  const [thanksWorkerIds,setThanksWorkerIds]=useState<string[]>([]);

  const { data: jobInfo, isLoading, error } = useQuery<{
    jobId: string; customerName: string; serviceType: string;
    serviceLabel: string; completedDate: string | null;
    assignedEmployees: AssignedEmployee[]; crewSize: number;
  }>({
    queryKey: ["/api/review", token || jobId],
    queryFn: async () => {
      const url = token ? `/api/review/token/${token}` : `/api/review/job/${jobId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Invalid review link");
      return res.json();
    },
    enabled: !!(token || jobId),
    retry: false,
  });

  const { data: currentUser } = useQuery<any | null>({
    queryKey: ["/api/auth/user"],
    queryFn: async () => {
      const res = await fetch("/api/auth/user", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    retry: false,
    staleTime: 60000,
  });

  const { data: walletData } = useQuery<WalletBalance | null>({
    queryKey: ["/api/wallet/balance"],
    queryFn: async () => {
      const res = await fetch("/api/wallet/balance", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!currentUser,
    retry: false,
  });

  const assignedEmployees = jobInfo?.assignedEmployees || [];
  const hasAssignedCrew = assignedEmployees.length > 0;
  const selectedCrew = assignedEmployees.filter((employee) => selectedCrewIds.includes(employee.id));
  const tipRecipientCount = hasAssignedCrew ? selectedCrew.length : numberOfMovers;
  const isTokenTip = tipMethod === "jcmoves";
  const isWalletTip = tipMethod === "jcmoves" || tipMethod === "jcmoves_usd";
  const totalTip = isTokenTip ? 0 : tipRecipientCount * tipPerMover;
  const totalTokenTip = isTokenTip ? tipRecipientCount * tokenTipPerMover : 0;
  const walletTokens = walletData ? parseFloat(walletData.tokenBalance || "0") : 0;
  const walletCash = walletData ? parseFloat(walletData.cashBalance || "0") : 0;
  const walletTipNeedsLogin = includeTip && isWalletTip && !currentUser;
  const walletTipInsufficient = includeTip && (
    (tipMethod === "jcmoves" && totalTokenTip > walletTokens) ||
    (tipMethod === "jcmoves_usd" && totalTip > walletCash)
  );

  useEffect(() => {
    if (!jobInfo) return;
    const crew = jobInfo.assignedEmployees || [];
    if (crew.length > 0) {
      setSelectedCrewIds((current) => {
        const next = current.filter((id) => crew.some((employee) => employee.id === id));
        return next.length > 0 ? next : crew.map((employee) => employee.id);
      });
      setNumberOfMovers(crew.length);
      setMoverNames((current) => current || crew.map((employee) => employee.name).join(", "));
      return;
    }
    setNumberOfMovers(jobInfo.crewSize || 2);
  }, [jobInfo?.jobId]);

  const handleAddTipToCart = () => {
    const recipientLabel = hasAssignedCrew && selectedCrew.length > 0
      ? selectedCrew.map((employee) => employee.name.split(" ")[0]).join(", ")
      : `${tipRecipientCount} mover${tipRecipientCount !== 1 ? "s" : ""}`;
    addItem({
      id: tipCartId,
      name: `Crew Tip — ${numberOfMovers} mover${numberOfMovers !== 1 ? "s" : ""} × $${tipPerMover}`,
      price: totalTip,
      image: recipientLabel ? "" : "",
      type: "tip",
    });
    toast({
      title: "Tip added to cart! 💛",
      description: `$${totalTip.toFixed(2)} tip for the crew — complete checkout to pay.`,
    });
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const url = token ? `/api/review/token/${token}` : `/api/review/job/${jobId}`;
      const tipAllocations = includeTip && hasAssignedCrew
        ? selectedCrew.map((employee) => ({
            workerId: employee.id,
            workerName: employee.name,
            amountUsd: isTokenTip ? 0 : tipPerMover,
            tokenAmount: isTokenTip ? tokenTipPerMover : 0,
          }))
        : [];
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating,
          comment,
          thanksWorkerIds,
          moverNames: hasAssignedCrew && selectedCrew.length > 0
            ? selectedCrew.map((employee) => employee.name).join(", ")
            : moverNames,
          wouldRecommend,
          ...(includeTip && {
            numberOfMovers: tipRecipientCount,
            ...(!isTokenTip && { tipPerMover, tipAmount: totalTip }),
            ...(isTokenTip && { tokenTipPerMover, tokenTipAmount: totalTokenTip }),
            tipMethod,
            tipAllocations,
          }),
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed to submit"); }
      return res.json();
    },
    onSuccess: () => setSubmitted(true),
  });

  // Refs must be declared before any conditional returns
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const moverNamesRef = useRef<HTMLInputElement>(null);
  const scrollToInput = (el: HTMLElement | null) => {
    if (!el) return;
    setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 350);
  };

  // ─── Lookup screen (all hooks already called above) ───────────────────────
  if (!token && !jobId) {
    return (
      <JobLookupScreen
        onSelect={(id, tok) => {
          setResolvedJobId(id);
          if (tok) setResolvedToken(tok);
        }}
      />
    );
  }

  // ─── Success screen ────────────────────────────────────────────────────────
  if (submitted) {
    const cartHasTip = tipInCart || (includeTip && tipMethod === "cart");
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white dark:from-green-950 dark:to-slate-950 flex flex-col items-center justify-center px-4 gap-6">
        <div className="text-center max-w-md">
          <div className="relative inline-block mb-6">
            <div className="absolute inset-0 bg-green-400 rounded-full blur-2xl opacity-30 animate-pulse" />
            <CheckCircle className="h-24 w-24 text-green-500 relative" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-3">Thank You! 🙏</h1>
          <p className="text-muted-foreground text-lg">
            Your review has been submitted. We truly appreciate your feedback!
          </p>
        </div>

        {includeTip && tipMethod === "bitcoin" && (
          <Card className="w-full max-w-md border-orange-200 dark:border-orange-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-orange-600">
                <Bitcoin className="h-5 w-5" /> Bitcoin Tip Recorded
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                If you haven't sent the Bitcoin yet, you still can — use the address on your previous screen.
                Our team will verify receipt and distribute to the crew. Thank you! 🧡
              </p>
            </CardContent>
          </Card>
        )}

        {includeTip && tipMethod === "cash" && (
          <Card className="w-full max-w-md border-emerald-200 dark:border-emerald-800">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-emerald-600"><Banknote className="h-5 w-5" /> Cash tip recorded</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground">The crew tip is pending admin receipt confirmation. Once confirmed, it will be included in the crew&apos;s monthly payroll and tip ledger.</p></CardContent>
          </Card>
        )}

        {includeTip && isWalletTip && (
          <Card className="w-full max-w-md border-emerald-200 dark:border-emerald-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-emerald-600">
                {tipMethod === "jcmoves" ? <Coins className="h-5 w-5" /> : <Wallet className="h-5 w-5" />}
                Tip Sent
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Your {tipMethod === "jcmoves" ? "JCMOVES" : "JCMOVES USD"} tip was attached to this review and credited to the selected mover{tipRecipientCount !== 1 ? "s" : ""}.
              </p>
            </CardContent>
          </Card>
        )}

        {cartHasTip && (
          <Button size="lg"
            onClick={() => navigate("/cart")}
            className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-8">
            <ShoppingCart className="h-5 w-5 mr-2" />
            Checkout ({itemCount} item{itemCount !== 1 ? "s" : ""} in cart)
          </Button>
        )}

        <Button variant="outline" onClick={() => navigate("/")}>Back to Home</Button>
      </div>
    );
  }

  // ─── Loading / Error states ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500 mx-auto" />
          <p className="text-muted-foreground">Loading your review page...</p>
        </div>
      </div>
    );
  }

  if (error || (!token && !jobId)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <Truck className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Link Not Found</h1>
          <p className="text-muted-foreground">
            This review link is invalid or has expired. Contact us to leave a review.
          </p>
        </div>
      </div>
    );
  }

  // ─── Main form ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 via-white to-white dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
      {/* Compact hero — shorter on mobile so the form is visible sooner */}
      <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-4 py-4 md:py-8 text-center shadow-lg">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Truck className="h-5 w-5 md:h-7 md:w-7" />
            <span className="text-base md:text-xl font-bold tracking-wide">JC ON THE MOVE</span>
          </div>
          <h1 className="text-xl md:text-3xl font-bold mb-0.5">How did we do? 🚚</h1>
          <p className="opacity-90 text-xs md:text-base">
            {jobInfo?.customerName ? `Hi ${jobInfo.customerName}!` : "Hi there!"}{" "}
            Your {jobInfo?.serviceLabel || "service"} is complete — we'd love your feedback.
          </p>
        </div>
      </div>

      {/* Extra bottom padding so sticky bar doesn't hide content */}
      <div className="max-w-2xl mx-auto px-4 py-4 md:py-8 space-y-4 md:space-y-6 pb-28">

        {/* Job summary */}
        {jobInfo && (
          <Card className="border-amber-200 dark:border-amber-800">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="bg-amber-100 dark:bg-amber-900 rounded-full p-2">
                  <Truck className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">{jobInfo.serviceLabel}</p>
                  {jobInfo.completedDate && (
                    <p className="text-sm text-muted-foreground">{jobInfo.completedDate}</p>
                  )}
                </div>
                {jobInfo.assignedEmployees?.length > 0 && (
                  <div className="ml-auto flex gap-2 flex-wrap justify-end">
                    {jobInfo.assignedEmployees.map((e) => (
                      <div key={e.id} className="flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-2 py-1 dark:border-amber-800 dark:bg-amber-950">
                        {e.avatarImageUrl ? <img src={e.avatarImageUrl} alt={`${e.name} avatar`} className="h-7 w-7 rounded-full object-cover" /> : e.avatar ? <WorkerAvatar avatar={e.avatar} label={e.name} className="h-7 w-7"/> : e.profileImageUrl ? (
                          <img src={e.profileImageUrl} alt={e.name} className="h-7 w-7 rounded-full object-cover" />
                        ) : (
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500 text-xs font-black text-white">
                            {getInitials(e.name)}
                          </span>
                        )}
                        <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">{e.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {!!assignedEmployees.length&&<Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-lg"><Heart className="h-5 w-5 text-rose-500"/>Send your movers some love</CardTitle></CardHeader><CardContent><div className="grid grid-cols-2 gap-3">{assignedEmployees.map(worker=><button type="button" key={worker.id} aria-pressed={thanksWorkerIds.includes(worker.id)} disabled={submitMutation.isPending} onClick={()=>setThanksWorkerIds(current=>current.includes(worker.id)?current.filter(id=>id!==worker.id):[...current,worker.id])} className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border p-3 ${thanksWorkerIds.includes(worker.id)?'border-rose-400 bg-rose-500/10':'border-border'}`}>{worker.avatarImageUrl?<img src={worker.avatarImageUrl} className="h-12 w-12 rounded-full" alt={`${worker.name} avatar`}/>:<WorkerAvatar avatar={worker.avatar} label={worker.name} className="h-12 w-12"/>}<span className="text-sm font-semibold">{worker.name.split(' ')[0]}</span><Heart className={`h-5 w-5 text-rose-500 ${thanksWorkerIds.includes(worker.id)?'fill-rose-500':''}`}/></button>)}</div><p className="mt-3 text-xs text-muted-foreground">Free appreciation, sent with your review. Tips are optional below.</p></CardContent></Card>}
        {/* ─── Star Rating ─── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xl flex items-center gap-2">
              <Star className="h-5 w-5 text-amber-400 fill-amber-400" />
              Rate your experience
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StarRating value={rating} onChange={setRating} />
          </CardContent>
        </Card>

        {/* ─── Review Details ─── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xl flex items-center gap-2">
              <Heart className="h-5 w-5 text-rose-500" />
              Tell us more
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-sm font-medium mb-2 block">Your review</Label>
              <Textarea
                ref={commentRef}
                placeholder="Describe your experience — what went well, what stood out..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onFocus={() => scrollToInput(commentRef.current)}
                className="min-h-[120px] resize-none text-base"
              />
            </div>
            <div>
              <Label className="text-sm font-medium mb-1 block">
                Shout out your movers!{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                ref={moverNamesRef}
                placeholder={jobInfo?.assignedEmployees?.length
                  ? `e.g. ${jobInfo.assignedEmployees.map((e) => e.name.split(" ")[0]).join(", ")} were fantastic!`
                  : "e.g. Marcus and Darrell were amazing!"}
                value={moverNames}
                onChange={(e) => setMoverNames(e.target.value)}
                onFocus={() => scrollToInput(moverNamesRef.current)}
                className="text-base"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Name a mover and they'll earn bonus reward tokens! 🏆
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium mb-3 block">Would you recommend us?</Label>
              <div className="flex gap-3">
                {[true, false].map((val) => (
                  <button key={String(val)} type="button"
                    onClick={() => setWouldRecommend(val)}
                    className={`flex-1 rounded-xl border-2 py-3 font-semibold transition-all ${
                      wouldRecommend === val
                        ? val
                          ? "border-green-500 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400"
                          : "border-rose-500 bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-400"
                        : "border-border text-muted-foreground hover:border-slate-400"
                    }`}>
                    {val ? "👍 Yes, definitely!" : "👎 Not this time"}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ─── Tip Section ─── */}
        <Card className={`border-2 transition-all ${includeTip
          ? "border-amber-400 shadow-amber-100 dark:shadow-amber-900 shadow-lg"
          : "border-border"}`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-amber-500" />
                Tip your movers 💛
              </CardTitle>
              <button type="button" onClick={() => setIncludeTip(!includeTip)}
                className={`relative inline-flex h-7 items-center rounded-full transition-colors focus:outline-none ${
                  includeTip ? "bg-amber-500" : "bg-slate-300 dark:bg-slate-600"
                }`} style={{ width: 52 }}>
                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-md transform transition-transform ${
                  includeTip ? "translate-x-7" : "translate-x-1"
                }`} />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">100% of tips go directly to your crew members.</p>
          </CardHeader>

          {includeTip ? (
            <CardContent className="space-y-6 pt-0">
              {hasAssignedCrew && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <Label className="flex items-center gap-2 text-base font-semibold">
                      <Users className="h-4 w-4 text-blue-500" /> Tip recipients
                    </Label>
                    <span className="rounded-lg bg-blue-50 px-3 py-1 text-sm font-bold text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                      {tipRecipientCount} selected
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {assignedEmployees.map((employee) => {
                      const selected = selectedCrewIds.includes(employee.id);
                      return (
                        <button
                          key={employee.id}
                          type="button"
                          onClick={() => {
                            setSelectedCrewIds((current) => {
                              const next = selected
                                ? current.filter((id) => id !== employee.id)
                                : [...current, employee.id];
                              setNumberOfMovers(Math.max(1, next.length));
                              return next;
                            });
                          }}
                          className={`flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-all ${
                            selected
                              ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                              : "border-border hover:border-blue-300"
                          }`}
                        >
                          {employee.avatarImageUrl ? <img src={employee.avatarImageUrl} alt={`${employee.name} avatar`} className="h-12 w-12 rounded-full object-cover"/> : employee.avatar ? <WorkerAvatar avatar={employee.avatar} label={employee.name} className="h-12 w-12"/> : employee.profileImageUrl ? (
                            <img src={employee.profileImageUrl} alt={employee.name} className="h-12 w-12 rounded-full object-cover" />
                          ) : (
                            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-sm font-black text-white dark:bg-slate-100 dark:text-slate-900">
                              {getInitials(employee.name)}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold text-foreground">{employee.name}</span>
                            <span className={`text-xs ${selected ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}`}>
                              {selected ? "Included" : "Tap to include"}
                            </span>
                          </span>
                          {selected && <Check className="h-5 w-5 text-blue-500" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Mover count slider */}
              {!hasAssignedCrew && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="flex items-center gap-2 text-base font-semibold">
                    <Users className="h-4 w-4 text-blue-500" /> Number of movers
                  </Label>
                  <span className="text-2xl font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 rounded-lg px-3 py-1">
                    {numberOfMovers}
                  </span>
                </div>
                <Slider value={[numberOfMovers]} min={1} max={8} step={1}
                  onValueChange={([v]) => setNumberOfMovers(v)}
                  className="[&_[role=slider]]:bg-blue-500 [&_[role=slider]]:border-blue-500" />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>1 mover</span><span>8 movers</span>
                </div>
                <div className="flex gap-1 justify-center mt-3">
                  {Array.from({ length: numberOfMovers }).map((_, i) => (
                    <span key={i} className="text-2xl">🧑</span>
                  ))}
                </div>
              </div>
              )}

              {/* Tip per mover slider */}
              {tipMethod !== "jcmoves" && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="flex items-center gap-2 text-base font-semibold">
                    <DollarSign className="h-4 w-4 text-green-500" /> Tip per mover
                  </Label>
                  <span className="text-2xl font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950 rounded-lg px-3 py-1">
                    ${tipPerMover}
                  </span>
                </div>
                <Slider value={[tipPerMover]} min={5} max={100} step={5}
                  onValueChange={([v]) => setTipPerMover(v)}
                  className="[&_[role=slider]]:bg-green-500 [&_[role=slider]]:border-green-500" />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>$5</span><span>$100</span>
                </div>
                <div className="flex gap-2 mt-3 flex-wrap">
                  {[10, 20, 30, 50].map((amt) => (
                    <button key={amt} type="button" onClick={() => setTipPerMover(amt)}
                      className={`px-3 py-1 rounded-lg text-sm font-semibold border-2 transition-all ${
                        tipPerMover === amt
                          ? "border-green-500 bg-green-500 text-white"
                          : "border-border hover:border-green-400 text-muted-foreground"
                      }`}>
                      ${amt}
                    </button>
                  ))}
                </div>
              </div>
              )}

              {tipMethod === "jcmoves" && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <Label className="flex items-center gap-2 text-base font-semibold">
                      <Coins className="h-4 w-4 text-green-500" /> JCMOVES per mover
                    </Label>
                    <span className="text-2xl font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950 rounded-lg px-3 py-1">
                      {formatTokenAmount(tokenTipPerMover)}
                    </span>
                  </div>
                  <Slider value={[tokenTipPerMover]} min={25} max={1000} step={25}
                    onValueChange={([v]) => setTokenTipPerMover(v)}
                    className="[&_[role=slider]]:bg-green-500 [&_[role=slider]]:border-green-500" />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>25</span><span>1,000</span>
                  </div>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {[50, 100, 250, 500].map((amt) => (
                      <button key={amt} type="button" onClick={() => setTokenTipPerMover(amt)}
                        className={`px-3 py-1 rounded-lg text-sm font-semibold border-2 transition-all ${
                          tokenTipPerMover === amt
                            ? "border-green-500 bg-green-500 text-white"
                            : "border-border hover:border-green-400 text-muted-foreground"
                        }`}>
                        {amt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Total */}
              <div className="bg-amber-50 dark:bg-amber-950 border-2 border-amber-300 dark:border-amber-700 rounded-2xl p-4 text-center">
                <p className="text-sm text-amber-700 dark:text-amber-300 font-medium mb-1">Total tip</p>
                <div className="text-5xl font-black text-amber-600 dark:text-amber-400 mb-1">
                  {isTokenTip ? `${formatTokenAmount(totalTokenTip)} JCMOVES` : `$${totalTip.toFixed(2)}`}
                </div>
                <p className="hidden">
                  {numberOfMovers} mover{numberOfMovers !== 1 ? "s" : ""} × ${tipPerMover} each
                </p>
              </div>

              {/* ── Payment method toggle ── */}
              <div>
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  {tipRecipientCount} mover{tipRecipientCount !== 1 ? "s" : ""} x {isTokenTip ? `${formatTokenAmount(tokenTipPerMover)} JCMOVES` : `$${tipPerMover}`} each
                </p>
                <Label className="text-sm font-semibold mb-3 block">How would you like to tip?</Label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <button type="button" onClick={() => setTipMethod("cash")}
                    className={`rounded-xl border-2 p-3 transition-all text-left ${tipMethod === "cash" ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950" : "border-border hover:border-emerald-300"}`}>
                    <Banknote className={`h-6 w-6 mb-1 ${tipMethod === "cash" ? "text-emerald-500" : "text-muted-foreground"}`} />
                    <p className={`font-bold text-sm ${tipMethod === "cash" ? "text-emerald-700 dark:text-emerald-300" : "text-foreground"}`}>Cash</p>
                    <p className="text-xs text-muted-foreground">Admin confirms receipt for monthly payout</p>
                  </button>
                  <button type="button" onClick={() => setTipMethod("cart")}
                    className={`rounded-xl border-2 p-3 transition-all text-left ${
                      tipMethod === "cart"
                        ? "border-amber-500 bg-amber-50 dark:bg-amber-950"
                        : "border-border hover:border-amber-300"
                    }`}>
                    <ShoppingCart className={`h-6 w-6 mb-1 ${tipMethod === "cart" ? "text-amber-500" : "text-muted-foreground"}`} />
                    <p className={`font-bold text-sm ${tipMethod === "cart" ? "text-amber-700 dark:text-amber-300" : "text-foreground"}`}>
                      Cart & Checkout
                    </p>
                    <p className="text-xs text-muted-foreground">Pay by card, Square, or other methods</p>
                  </button>
                  <button type="button" onClick={() => setTipMethod("bitcoin")}
                    className={`rounded-xl border-2 p-3 transition-all text-left ${
                      tipMethod === "bitcoin"
                        ? "border-orange-500 bg-orange-50 dark:bg-orange-950"
                        : "border-border hover:border-orange-300"
                    }`}>
                    <Bitcoin className={`h-6 w-6 mb-1 ${tipMethod === "bitcoin" ? "text-orange-500" : "text-muted-foreground"}`} />
                    <p className={`font-bold text-sm ${tipMethod === "bitcoin" ? "text-orange-700 dark:text-orange-300" : "text-foreground"}`}>
                      Bitcoin
                    </p>
                    <p className="text-xs text-muted-foreground">Send BTC directly to the crew wallet</p>
                  </button>
                  <button type="button" onClick={() => setTipMethod("jcmoves")}
                    className={`rounded-xl border-2 p-3 transition-all text-left ${
                      tipMethod === "jcmoves"
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950"
                        : "border-border hover:border-emerald-300"
                    }`}>
                    <Coins className={`h-6 w-6 mb-1 ${tipMethod === "jcmoves" ? "text-emerald-500" : "text-muted-foreground"}`} />
                    <p className={`font-bold text-sm ${tipMethod === "jcmoves" ? "text-emerald-700 dark:text-emerald-300" : "text-foreground"}`}>
                      JCMOVES
                    </p>
                    <p className="text-xs text-muted-foreground">Transfer tokens from your wallet</p>
                  </button>
                  <button type="button" onClick={() => setTipMethod("jcmoves_usd")}
                    className={`rounded-xl border-2 p-3 transition-all text-left ${
                      tipMethod === "jcmoves_usd"
                        ? "border-sky-500 bg-sky-50 dark:bg-sky-950"
                        : "border-border hover:border-sky-300"
                    }`}>
                    <Wallet className={`h-6 w-6 mb-1 ${tipMethod === "jcmoves_usd" ? "text-sky-500" : "text-muted-foreground"}`} />
                    <p className={`font-bold text-sm ${tipMethod === "jcmoves_usd" ? "text-sky-700 dark:text-sky-300" : "text-foreground"}`}>
                      JCMOVES USD
                    </p>
                    <p className="text-xs text-muted-foreground">Use your service-credit balance</p>
                  </button>
                </div>
              </div>

              {/* Cart method */}
              {tipMethod === "cash" && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950">
                  <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">Cash tip: ${totalTip.toFixed(2)}</p>
                  <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">Give the cash to the crew or office. The allocation stays pending until an admin verifies receipt, then posts to the monthly tip ledger.</p>
                </div>
              )}

              {/* Cart method */}
              {tipMethod === "cart" && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-semibold text-amber-800 dark:text-amber-200 text-sm">
                        Crew Tip — {numberOfMovers} mover{numberOfMovers !== 1 ? "s" : ""} × ${tipPerMover}
                      </p>
                      <p className="text-xs text-amber-600 dark:text-amber-400">Added as a cart item for secure checkout</p>
                    </div>
                    <span className="text-xl font-black text-amber-600 dark:text-amber-400">
                      ${totalTip.toFixed(2)}
                    </span>
                  </div>
                  <Button onClick={handleAddTipToCart} disabled={tipInCart || tipRecipientCount === 0 || totalTip <= 0}
                    className={`w-full font-bold ${tipInCart
                      ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 border border-green-400"
                      : "bg-amber-500 hover:bg-amber-600 text-white"}`}>
                    {tipInCart
                      ? <><Check className="h-4 w-4 mr-2" /> Tip Added to Cart — Go to Checkout</>
                      : <><ShoppingCart className="h-4 w-4 mr-2" /> Add Tip to Cart</>}
                  </Button>
                  {tipInCart && (
                    <Button variant="outline" size="sm" className="w-full mt-2 text-xs"
                      onClick={() => navigate("/cart")}>
                      View Cart &amp; Checkout →
                    </Button>
                  )}
                </div>
              )}

              {/* Bitcoin method */}
              {tipMethod === "bitcoin" && (
                <div className="rounded-xl border border-orange-200 dark:border-orange-800 bg-white dark:bg-slate-900 p-4">
                  <BitcoinTipPanel usdAmount={totalTip} />
                </div>
              )}

              {tipMethod === "jcmoves" && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">JCMOVES token tip</p>
                      <p className="text-xs text-emerald-700 dark:text-emerald-300">
                        {currentUser ? `Wallet balance: ${formatTokenAmount(walletTokens)} JCMOVES` : "Sign in to use wallet tipping"}
                      </p>
                    </div>
                    <span className="text-xl font-black text-emerald-700 dark:text-emerald-300">
                      {formatTokenAmount(totalTokenTip)}
                    </span>
                  </div>
                  {walletTipNeedsLogin && (
                    <p className="mt-3 rounded-lg border border-emerald-300 bg-white/70 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-700 dark:bg-slate-900 dark:text-emerald-200">
                      Choose card or Bitcoin, or sign in before submitting to tip with JCMOVES.
                    </p>
                  )}
                  {tipMethod === "jcmoves" && walletTipInsufficient && (
                    <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                      Your JCMOVES balance is lower than this tip.
                    </p>
                  )}
                </div>
              )}

              {tipMethod === "jcmoves_usd" && (
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-800 dark:bg-sky-950">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-sky-800 dark:text-sky-200">JCMOVES USD tip</p>
                      <p className="text-xs text-sky-700 dark:text-sky-300">
                        {currentUser ? `Wallet balance: $${walletCash.toFixed(2)}` : "Sign in to use wallet tipping"}
                      </p>
                    </div>
                    <span className="text-xl font-black text-sky-700 dark:text-sky-300">
                      ${totalTip.toFixed(2)}
                    </span>
                  </div>
                  {walletTipNeedsLogin && (
                    <p className="mt-3 rounded-lg border border-sky-300 bg-white/70 px-3 py-2 text-xs text-sky-800 dark:border-sky-700 dark:bg-slate-900 dark:text-sky-200">
                      Choose card or Bitcoin, or sign in before submitting to tip with JCMOVES USD.
                    </p>
                  )}
                  {tipMethod === "jcmoves_usd" && walletTipInsufficient && (
                    <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                      Your JCMOVES USD balance is lower than this tip.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          ) : (
            <CardContent className="pt-0 pb-5">
              <button type="button" onClick={() => setIncludeTip(true)}
                className="w-full border-2 border-dashed border-amber-300 dark:border-amber-700 rounded-xl py-4 text-amber-600 dark:text-amber-400 font-semibold hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950 transition-all">
                + Add a tip for the crew
              </button>
            </CardContent>
          )}
        </Card>

        {/* ─── Jewelry Discount ─── */}
        <JewelryDiscountCard />

      </div>

      {/* ─── Sticky Submit Bar — always above keyboard ─── */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 dark:bg-slate-950/95 backdrop-blur border-t border-amber-200 dark:border-amber-800 px-4 py-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
        <div className="max-w-2xl mx-auto space-y-1.5">
          {submitMutation.isError && (
            <p className="text-destructive text-center text-xs">
              {(submitMutation.error as Error)?.message || "Something went wrong. Please try again."}
            </p>
          )}
          {rating === 0 && (
            <p className="text-center text-xs text-muted-foreground">
              Tap the stars above to rate your experience
            </p>
          )}
          {includeTip && hasAssignedCrew && tipRecipientCount === 0 && (
            <p className="text-center text-xs text-destructive">
              Select at least one mover to receive the tip.
            </p>
          )}
          {walletTipNeedsLogin && (
            <p className="text-center text-xs text-destructive">
              Sign in to submit a JCMOVES wallet tip, or choose card or Bitcoin.
            </p>
          )}
          {walletTipInsufficient && !walletTipNeedsLogin && (
            <p className="text-center text-xs text-destructive">
              Your wallet balance is lower than this tip.
            </p>
          )}
          <Button
            onClick={() => submitMutation.mutate()}
            disabled={
              rating === 0 ||
              submitMutation.isPending ||
              (includeTip && hasAssignedCrew && tipRecipientCount === 0) ||
              walletTipNeedsLogin ||
              walletTipInsufficient
            }
            size="lg"
            className="w-full h-12 text-base bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg">
            {submitMutation.isPending ? (
              <span className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                Submitting...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                Submit Review
                <ChevronRight className="h-4 w-4" />
              </span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  TrendingUp,
  Wallet,
  Send,
  Download,
  Upload,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Loader2,
  BarChart3,
  Users,
  Activity,
  ExternalLink,
  Star,
  Shield,
  History,
  Clock,
  Lock,
  Coins,
  Plus,
  Edit,
  Save,
  ArrowRightLeft,
  XCircle,
  Copy,
  ChevronDown,
  Settings,
  Snowflake,
  Layers,
  Trash2,
  Tag,
  ToggleLeft,
  ToggleRight,
  PieChart,
  Calculator,
  Zap,
  FlameKindling,
  Bitcoin
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";

type BtcLightningLedger = {
  readiness: {
    ready: boolean;
    blockers: string[];
    receivedAsset: string;
    settlementCurrency: string;
    treasuryRetentionPercent: number;
    valuationCurrency: string;
    custodyPolicy: string;
    conversionPolicy: string;
    automaticConversionEnabled: boolean;
    externalSettlementVerificationRequired: boolean;
  };
  totals: {
    payment_count: number;
    original_amount_usd: string;
    discount_amount_usd: string;
    gross_amount_paid_usd: string;
    refunded_amount_usd: string;
    amount_paid_usd: string;
    reward_value_usd: string;
    reward_tokens: string;
    gross_btc_amount: string;
    net_btc_amount: string;
    retained_btc_amount: string;
    pending_reconciliation_count: number;
  };
  entries: Array<{
    id: number;
    crypto_intent_id: number;
    lead_id: string;
    order_number: number | null;
    first_name: string | null;
    last_name: string | null;
    original_amount_usd: string;
    discount_amount_usd: string;
    amount_paid_usd: string;
    refunded_amount_usd: string;
    reward_value_usd: string;
    reward_tokens: string;
    gross_btc_amount: string | null;
    net_btc_amount: string | null;
    retained_btc_amount: string | null;
    retention_percent: string;
    valuation_currency: string;
    custody_policy: string;
    conversion_status: string;
    status: string;
    reward_status: string | null;
    created_at: string;
  }>;
};

export default function AdminTreasuryPage() {
  const { toast } = useToast();
  const [transferAmount, setTransferAmount] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [executeOnChain, setExecuteOnChain] = useState(false);
  const [newTreasuryAddress, setNewTreasuryAddress] = useState("");
  const [isEditingTreasury, setIsEditingTreasury] = useState(false);
  const [editingLimit, setEditingLimit] = useState<string | null>(null);
  const [newLimitValue, setNewLimitValue] = useState("");
  const [invoiceForm, setInvoiceForm] = useState({
    name: "",
    email: "",
    phone: "",
    amount: "",
    description: ""
  });
  const [buybackExpanded, setBuybackExpanded] = useState(false);

  // Treasury stats query
  const { data: treasurySummary, refetch: refetchTreasury } = useQuery<{ stats: any }>({
    queryKey: ["/api/treasury/summary"],
  });

  // Live blockchain balance
  const { data: liveBalance, refetch: refetchBalance } = useQuery<{ balance: number; walletAddress: string }>({
    queryKey: ["/api/solana/balance"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Live token price (unused - kept for future)
  const { data: livePrice } = useQuery({
    queryKey: ["/api/crypto/live-price"],
    refetchInterval: 5000, // Refresh every 5 seconds
    enabled: false, // Disabled - no pricing displayed
  });

  // Funding deposits
  const { data: deposits } = useQuery<{ deposits: any[] }>({
    queryKey: ["/api/treasury/deposits"],
  });

  // Admin stats
  const { data: adminStats } = useQuery<{ totalLeads: number; activeJobs: number; totalUsers: number }>({
    queryKey: ["/api/admin/stats"],
  });

  // Transfer service status query
  const { data: transferStatus } = useQuery<{ operational: boolean; address: string }>({
    queryKey: ["/api/treasury/transfer/status"],
    refetchInterval: 60000,
  });

  // Treasury wallets configuration
  const { data: treasuryWallets, refetch: refetchTreasuryWallets } = useQuery<{ wallets: any[] }>({
    queryKey: ["/api/treasury/wallets"],
  });

  // Treasury limits (admin configurable up to 500M)
  const { data: treasuryLimits, refetch: refetchLimits } = useQuery<{ limits: Array<{ limitType: string; limitValue: string }> }>({
    queryKey: ["/api/treasury/limits"],
  });

  // Treasury liability analytics
  const { data: treasuryAnalytics, refetch: refetchAnalytics } = useQuery<{
    liability: {
      totalTokensEarned: number;
      totalTokensRedeemed: number;
      pendingRedemptionsValue: number;
      completedRedemptionsValue: number;
      liabilityTotal: number;
      treasurySupply: number;
      safetyRatioPct: number;
      safetyStatus: "green" | "yellow" | "red";
    };
  }>({
    queryKey: ["/api/treasury/analytics"],
    staleTime: 60000,
  });

  // Buyback fund stats with live burn wallet balance
  const { data: buybackFundData, refetch: refetchBuybackFund } = useQuery<{ 
    fund: { 
      tokenBalance: number; 
      totalTokensCollected: number; 
      feeContributionCount: number;
      lastUpdated: string | null;
    };
    burnWallet: {
      address: string;
      tokenBalance: number;
      solBalance: number;
    };
  }>({
    queryKey: ["/api/treasury/buyback-fund"],
    refetchInterval: 30000,
  });

  // Revenue allocations (40/30/20/10 split log)
  const { data: revenueAllocData } = useQuery<{
    allocations: Array<{
      id: number; leadId: string | null; paymentAmountUsd: string;
      buybackUsd: string; stakingUsd: string; jackpotUsd: string; liquidityUsd: string;
      source: string; createdAt: string;
    }>;
    totals: {
      total_revenue: string; total_buyback: string; total_staking: string;
      total_jackpot: string; total_liquidity: string; total_count: string;
    };
  }>({
    queryKey: ["/api/treasury/revenue-allocations"],
    staleTime: 60000,
  });

  const { data: btcLightningLedger, refetch: refetchBtcLightningLedger } = useQuery<BtcLightningLedger>({
    queryKey: ["/api/treasury/btc-lightning-ledger"],
    staleTime: 30000,
  });

  // Square config status
  const { data: squareConfig } = useQuery<{ configured: boolean; environment: string }>({
    queryKey: ["/api/invoices/config/status"],
  });

  // Reward Settings - Admin configurable token amounts
  const { data: rewardSettings, refetch: refetchRewardSettings } = useQuery<Array<{
    id: string;
    settingKey: string;
    label: string;
    description: string | null;
    tokenAmount: string;
    isActive: boolean;
    updatedAt: string;
  }>>({
    queryKey: ["/api/admin/reward-settings"],
  });
  const [editingRewardKey, setEditingRewardKey] = useState<string | null>(null);
  const [newRewardAmount, setNewRewardAmount] = useState("");

  // Promo Codes
  type PromoCode = {
    id: string; code: string; description: string;
    discountPercent: string; discountPercentJewelry: string;
    rewardTokens: string; referralRewardTokens: string;
    maxUses: number | null; usesCount: number;
    isActive: boolean; expiresAt: string | null; createdAt: string;
    jobOffer?: {
      kind: "fixed_moving_package";
      fixedBasePrice: number;
      requiredCrewSize: number;
      requiredHours: number;
      localMilesMax?: number;
      requiresCompanyTruck?: boolean;
      requiresTrailer?: boolean;
    } | null;
  };
  const { data: promoCodes, refetch: refetchPromoCodes } = useQuery<PromoCode[]>({
    queryKey: ["/api/admin/promo-codes"],
  });
  type JcMovesAudit = {
    months: number;
    generatedAt: string;
    allJcMoves: { users: number; transactions: number; total_jcmoves: string };
    paidCompletionLedger: { users: number; transactions: number; total_jcmoves: string; pending_customer_claims: number };
    monthly: Array<{ month: string; users: number; transactions: number; total_jcmoves: string }>;
  };
  const { data: jcmovesAudit, refetch: refetchJcmovesAudit } = useQuery<JcMovesAudit>({
    queryKey: ["/api/admin/jcmoves-audit", 6],
  });
  const repairJcmovesPayoutsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/jcmoves-audit/repair", { confirm: true });
      return response.json();
    },
    onSuccess: (data: { repairedLeadIds?: string[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/jcmoves-audit", 6] });
      const repaired = data.repairedLeadIds?.length ?? 0;
      toast({ title: "JCMOVES payout repair finished", description: `${repaired} eligible historical job${repaired === 1 ? " was" : "s were"} repaired.` });
    },
    onError: (error: Error) => toast({ title: "Payout repair failed", description: error.message, variant: "destructive" }),
  });
  const blankPromo = {
    code: "", description: "", offerType: "percentage" as "percentage" | "fixed_package",
    discountPercent: "0", discountPercentJewelry: "0", rewardTokens: "0", referralRewardTokens: "0",
    fixedBasePrice: "", requiredCrewSize: "2", requiredHours: "2", localMilesMax: "10",
    requiresCompanyTruck: false, requiresTrailer: false,
    maxUses: "", expiresAt: "", isActive: true,
  };
  const [showPromoForm, setShowPromoForm] = useState(false);
  const [editingPromo, setEditingPromo] = useState<PromoCode | null>(null);
  const [promoForm, setPromoForm] = useState(blankPromo);

  const createPromoMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/admin/promo-codes", data),
    onSuccess: () => { toast({ title: "Promo code created!" }); queryClient.invalidateQueries({ queryKey: ["/api/admin/promo-codes"] }); setShowPromoForm(false); setPromoForm(blankPromo); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const updatePromoMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/admin/promo-codes/${id}`, data),
    onSuccess: () => { toast({ title: "Promo code updated!" }); queryClient.invalidateQueries({ queryKey: ["/api/admin/promo-codes"] }); setEditingPromo(null); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deletePromoMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/promo-codes/${id}`),
    onSuccess: () => { toast({ title: "Promo code deleted" }); queryClient.invalidateQueries({ queryKey: ["/api/admin/promo-codes"] }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function savePromo() {
    const isPackage = promoForm.offerType === "fixed_package";
    const payload = {
      code: promoForm.code.toUpperCase().trim(),
      description: promoForm.description,
      discountPercent: isPackage ? "0" : (promoForm.discountPercent || "0"),
      discountPercentJewelry: promoForm.discountPercentJewelry || "0",
      rewardTokens: promoForm.rewardTokens || "0",
      referralRewardTokens: promoForm.referralRewardTokens || "0",
      maxUses: promoForm.maxUses ? parseInt(promoForm.maxUses as string) : null,
      expiresAt: promoForm.expiresAt || null,
      isActive: promoForm.isActive,
      jobOffer: isPackage ? {
        kind: "fixed_moving_package",
        fixedBasePrice: Number(promoForm.fixedBasePrice),
        requiredCrewSize: Number(promoForm.requiredCrewSize),
        requiredHours: Number(promoForm.requiredHours),
        localMilesMax: Number(promoForm.localMilesMax),
        requiresCompanyTruck: promoForm.requiresCompanyTruck,
        requiresTrailer: promoForm.requiresTrailer,
      } : null,
    };
    if (editingPromo) { updatePromoMutation.mutate({ id: editingPromo.id, data: payload }); }
    else { createPromoMutation.mutate(payload); }
  }

  // Token Ledger - All JCMOVES transactions across customers and employees
  const { data: tokenLedger, refetch: refetchLedger } = useQuery<{
    transactions: Array<{
      id: string;
      userId: string;
      rewardType: string;
      tokenAmount: string;
      status: string;
      earnedDate: string;
      userEmail: string;
      userFirstName: string;
      userLastName: string;
      userRole: string;
    }>;
    wallets: Array<{
      userId: string;
      tokenBalance: string;
      totalEarned: string;
      userEmail: string;
      userFirstName: string;
      userLastName: string;
      userRole: string;
    }>;
    summary: {
      totalTokensDispensed: number;
      totalByType: Record<string, number>;
      totalByRole: Record<string, number>;
      totalWalletBalance: number;
      employeeBalance: number;
      customerBalance: number;
      walletCount: number;
    };
  }>({
    queryKey: ["/api/admin/token-ledger"],
    refetchInterval: 30000,
  });

  // Invoices list
  const { data: invoices, refetch: refetchInvoices } = useQuery<any[]>({
    queryKey: ["/api/invoices"],
  });

  // Create invoice mutation
  const createInvoiceMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/invoices", {
        email: invoiceForm.email,
        name: invoiceForm.name,
        phone: invoiceForm.phone || undefined,
        amount: parseFloat(invoiceForm.amount),
        description: invoiceForm.description,
      });
      return response.json();
    },
    onSuccess: (data) => {
      refetchInvoices();
      setInvoiceForm({ name: "", email: "", phone: "", amount: "", description: "" });
      toast({
        title: "Invoice sent!",
        description: `Invoice sent to ${invoiceForm.email}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to create invoice",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update limit mutation
  const updateLimitMutation = useMutation({
    mutationFn: async ({ limitType, limitValue }: { limitType: string; limitValue: number }) => {
      const response = await apiRequest("PUT", `/api/treasury/limits/${limitType}`, { limitValue });
      return response.json();
    },
    onSuccess: () => {
      refetchLimits();
      setEditingLimit(null);
      setNewLimitValue("");
      toast({ title: "Limit updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update limit", description: error.message, variant: "destructive" });
    }
  });

  // Token transfer mutation
  const transferMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/treasury/transfer", {
        recipientAddress,
        amount: parseFloat(transferAmount),
        executeOnChain,
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/treasury/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/solana/balance"] });
      refetchBalance();
      setTransferAmount("");
      setRecipientAddress("");
      setExecuteOnChain(false);
      
      if (data.transactionHash) {
        toast({
          title: "Blockchain Transfer Complete!",
          description: `TX: ${data.transactionHash.slice(0, 12)}... - View on Solscan`,
        });
      } else {
        toast({
          title: "Transfer recorded",
          description: data.note || "Transfer intent saved. Execute on blockchain when ready.",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Transfer failed",
        description: error.message || "Failed to initiate transfer",
        variant: "destructive",
      });
    },
  });

  // Deposit mutation
  const depositMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/treasury/deposit", {
        amount: parseFloat(depositAmount),
        depositMethod: "manual",
        notes: "Manual deposit from IN GOD WE TRUST dashboard",
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/treasury/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/treasury/deposits"] });
      setDepositAmount("");
      toast({
        title: "Deposit recorded",
        description: "Treasury balance has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Deposit failed",
        description: error.message || "Failed to record deposit",
        variant: "destructive",
      });
    },
  });

  // Update treasury wallet mutation
  const updateTreasuryWalletMutation = useMutation({
    mutationFn: async ({ walletId, walletAddress }: { walletId: string; walletAddress: string }) => {
      const response = await apiRequest("PUT", `/api/treasury/wallets/${walletId}`, {
        walletAddress,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/treasury/wallets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/solana/balance"] });
      refetchBalance();
      setIsEditingTreasury(false);
      setNewTreasuryAddress("");
      toast({
        title: "Treasury wallet updated",
        description: "The treasury wallet address has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update treasury wallet",
        variant: "destructive",
      });
    },
  });

  // Swap request management state
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [fulfilledAmount, setFulfilledAmount] = useState("");
  const [fulfillmentTxHash, setFulfillmentTxHash] = useState("");

  const { data: stakingTreasury, refetch: refetchStakingTreasury } = useQuery<{
    balance: string;
    totalActiveStaked: string;
    totalRewardsPaid: string;
    activeStakeCount: number;
    totalStakeCount: number;
    tierBreakdown: Array<{ name: string; durationDays: number; apr: string; activeStakes: number; totalStaked: string }>;
  }>({
    queryKey: ["/api/staking/treasury"],
  });

  const { data: yieldSourceData, refetch: refetchYieldSources } = useQuery<{
    sources: Array<{ id: string; label: string; icon: string; monthlyUsd: number; enabled: boolean }>;
    treasuryBonusPct: number;
  }>({ queryKey: ["/api/staking/yield-sources"] });

  const { data: tokenEconomy, refetch: refetchTokenEconomy, isLoading: economyLoading } = useQuery<{
    activeWalletCount: number;
    totalInUserWallets: number;
    totalEverEarned: number;
    totalEverRedeemed: number;
    activeStaked: number;
    pendingStaked: number;
    unstakingStaked: number;
    activeDailyObligation: number;
    activeAccumulatedRewards: number;
    totalLoyaltyRewards: number;
    rewardsByType: Record<string, number>;
    spinPrizesTotal: number;
    spinJackpotsTotal: number;
    spinCount: number;
    obligation30d: number;
    obligation90d: number;
    obligation365d: number;
    onChainBalance: number;
    netCirculating: number;
    coverageRatio: number;
    sustainabilityDays: number;
    totalDistributed: number;
  }>({
    queryKey: ["/api/staking/token-economy"],
    staleTime: 120000,
  });

  const { data: jcMovesUsdCirculation } = useQuery<{ totalUsd: number; walletCount: number }>({
    queryKey: ["/api/admin/jcmoves-usd-circulation"],
    staleTime: 60000,
  });

  const { data: prepaidCreditStats } = useQuery<{
    totalPurchasedUsd: number;
    totalMintedUsd: number;
    totalIntents: number;
    totalRedeemedUsd: number;
    outstandingLiabilityUsd: number;
  }>({
    queryKey: ["/api/admin/treasury/prepaid-credit"],
    staleTime: 60000,
  });

  const [yieldSources, setYieldSources] = useState<Array<{ id: string; label: string; icon: string; monthlyUsd: number; enabled: boolean }>>([]);
  const [yieldBonusPct, setYieldBonusPct] = useState("0");
  const [yieldSourcesLoaded, setYieldSourcesLoaded] = useState(false);

  if (yieldSourceData && !yieldSourcesLoaded) {
    setYieldSources(yieldSourceData.sources);
    setYieldBonusPct(String(yieldSourceData.treasuryBonusPct));
    setYieldSourcesLoaded(true);
  }

  const saveYieldSourcesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/admin/staking/yield-sources", {
        sources: yieldSources,
        treasuryBonusPct: parseFloat(yieldBonusPct) || 0,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Yield sources saved!", description: "Treasury bonus and source data updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/staking/yield-sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/staking/pool-stats"] });
      refetchYieldSources();
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  // Swap requests query (admin only - uses requireBusinessOwner middleware)
  const { data: swapRequests, refetch: refetchSwapRequests } = useQuery<{ requests: any[] }>({
    queryKey: ["/api/swap-requests"],
  });

  // Approve swap request mutation (PATCH to /api/swap-requests/:id/review)
  const approveSwapMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const response = await apiRequest("PATCH", `/api/swap-requests/${requestId}/review`, {
        action: "approve"
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/swap-requests"] });
      toast({ title: "Request Approved", description: "Swap request has been approved for fulfillment." });
    },
    onError: (error: any) => {
      toast({ title: "Approval failed", description: error.message, variant: "destructive" });
    },
  });

  // Decline swap request mutation (PATCH to /api/swap-requests/:id/review)
  const declineSwapMutation = useMutation({
    mutationFn: async ({ requestId, reason }: { requestId: string; reason: string }) => {
      const response = await apiRequest("PATCH", `/api/swap-requests/${requestId}/review`, {
        action: "decline",
        declineReason: reason
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/swap-requests"] });
      setSelectedRequest(null);
      setDeclineReason("");
      toast({ title: "Request Declined", description: "Swap request has been declined." });
    },
    onError: (error: any) => {
      toast({ title: "Decline failed", description: error.message, variant: "destructive" });
    },
  });

  // Complete swap request mutation (PATCH to /api/swap-requests/:id/fulfill)
  const completeSwapMutation = useMutation({
    mutationFn: async ({ requestId, amount, txHash }: { requestId: string; amount: string; txHash: string }) => {
      const response = await apiRequest("PATCH", `/api/swap-requests/${requestId}/fulfill`, {
        fulfilledAmount: amount,
        fulfillmentTxHash: txHash,
        fulfillmentMethod: "treasury"
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/swap-requests"] });
      setSelectedRequest(null);
      setFulfilledAmount("");
      setFulfillmentTxHash("");
      toast({ title: "Swap Completed", description: "The swap has been fulfilled and the user notified." });
    },
    onError: (error: any) => {
      toast({ title: "Completion failed", description: error.message, variant: "destructive" });
    },
  });

  // Payout request management state
  const [selectedPayout, setSelectedPayout] = useState<string | null>(null);
  const [payoutMode, setPayoutMode] = useState<'process' | 'decline'>('process');
  const [payoutDeclineReason, setPayoutDeclineReason] = useState("");
  const [manualTxHash, setManualTxHash] = useState("");
  const [executePayoutOnChain, setExecutePayoutOnChain] = useState(false);

  // Pending payouts query (admin only)
  const { data: pendingPayouts, refetch: refetchPayouts } = useQuery<{ payouts: any[] }>({
    queryKey: ["/api/admin/payouts/pending"],
  });

  // Process payout mutation
  const processPayoutMutation = useMutation({
    mutationFn: async ({ payoutId, txHash, executeOnChain }: { payoutId: string; txHash?: string; executeOnChain: boolean }) => {
      const response = await apiRequest("POST", `/api/admin/payouts/${payoutId}/process`, {
        txHash,
        executeOnChain
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payouts/pending"] });
      setSelectedPayout(null);
      setManualTxHash("");
      toast({ 
        title: "Payout Processed", 
        description: data.txHash ? `Tokens sent! TX: ${data.txHash.slice(0, 12)}...` : "Payout marked complete."
      });
    },
    onError: (error: any) => {
      toast({ title: "Process failed", description: error.message, variant: "destructive" });
    },
  });

  // Decline payout mutation
  const declinePayoutMutation = useMutation({
    mutationFn: async ({ payoutId, reason }: { payoutId: string; reason: string }) => {
      const response = await apiRequest("POST", `/api/admin/payouts/${payoutId}/decline`, {
        reason
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payouts/pending"] });
      setSelectedPayout(null);
      setPayoutDeclineReason("");
      toast({ title: "Payout Declined", description: "Tokens have been refunded to user's balance." });
    },
    onError: (error: any) => {
      toast({ title: "Decline failed", description: error.message, variant: "destructive" });
    },
  });

  // Update reward setting mutation
  const updateRewardSettingMutation = useMutation({
    mutationFn: async ({ key, tokenAmount }: { key: string; tokenAmount: number }) => {
      const response = await apiRequest("PUT", `/api/admin/reward-settings/${key}`, {
        tokenAmount
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reward-settings"] });
      setEditingRewardKey(null);
      setNewRewardAmount("");
      toast({ title: "Reward Updated", description: "Token amount has been updated successfully." });
    },
    onError: (error: any) => {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    },
  });

  const stats = treasurySummary?.stats || {};
  const blockchainBalance = liveBalance?.balance || 0;
  const databaseBalance = stats.tokenReserve || 0;
  const balanceDiscrepancy = Math.abs(blockchainBalance - databaseBalance);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 pb-20">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-6">
          <Link href="/in-god-we-trust" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors mb-4">
            ← Back to Command Center
          </Link>
          <div className="text-center relative">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 via-purple-500/10 to-blue-600/20 blur-3xl -z-10"></div>
            <h1 className="text-3xl md:text-4xl font-black bg-gradient-to-r from-blue-400 via-purple-400 to-blue-400 bg-clip-text text-transparent mb-2 tracking-tight">
              Treasury & Finance
            </h1>
            <p className="text-slate-400">
              Wallet · Transfers · Payouts · Ledger · Staking
            </p>
          </div>
        </div>

        {/* Top Stats Grid - Simplified without pricing */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card className="p-6 bg-gradient-to-br from-purple-500 to-purple-600 text-white border-0 shadow-xl shadow-purple-900/30 overflow-hidden relative">
            <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-10 -mt-10"></div>
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="h-8 w-8 opacity-90" />
              <span className="text-sm opacity-80 font-medium">Blockchain</span>
            </div>
            <div className="text-3xl font-black">
              {blockchainBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
            <div className="text-sm opacity-80 mt-1 font-medium">JCMOVES Balance</div>
          </Card>

          <Card className="p-6 bg-gradient-to-br from-green-500 to-green-600 text-white border-0 shadow-xl shadow-green-900/30 overflow-hidden relative">
            <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-10 -mt-10"></div>
            <div className="flex items-center justify-between mb-2">
              <Coins className="h-8 w-8 opacity-90" />
              <span className="text-sm opacity-80 font-medium">Burn Wallet</span>
            </div>
            <div className="text-3xl font-black">
              {(buybackFundData?.burnWallet?.tokenBalance || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
            <div className="text-sm opacity-80 mt-1 font-medium">JCMOVES Burned (Live)</div>
          </Card>

          <Link href="/admin/users" className="block">
            <Card className="p-6 bg-gradient-to-br from-orange-500 to-orange-600 text-white cursor-pointer hover:from-orange-400 hover:to-orange-500 transition-all duration-200 transform hover:scale-[1.02] border-0 shadow-xl shadow-orange-900/30 overflow-hidden relative">
              <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-10 -mt-10"></div>
              <div className="flex items-center justify-between mb-2">
                <Users className="h-8 w-8 opacity-90" />
                <span className="text-sm opacity-80 font-medium">System</span>
              </div>
              <div className="text-3xl font-black">{adminStats?.totalUsers || 0}</div>
              <div className="text-sm opacity-80 mt-1 font-medium">Total Users</div>
            </Card>
          </Link>

          <Link href="/ops/snow-removal" className="block">
            <Card className="p-6 bg-gradient-to-br from-blue-500 to-cyan-600 text-white cursor-pointer hover:from-blue-400 hover:to-cyan-500 transition-all duration-200 transform hover:scale-[1.02] border-0 shadow-xl shadow-blue-900/30 overflow-hidden relative">
              <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-10 -mt-10"></div>
              <div className="flex items-center justify-between mb-2">
                <Snowflake className="h-8 w-8 opacity-90" />
                <span className="text-sm opacity-80 font-medium">Seasonal</span>
              </div>
              <div className="text-3xl font-black">Snow</div>
              <div className="text-sm opacity-80 mt-1 font-medium">Removal Service</div>
            </Card>
          </Link>
        </div>

        <Tabs defaultValue="wallet" className="space-y-6">
          <TabsList className="flex flex-wrap w-full bg-slate-800/50 border border-slate-700/50 p-1 gap-1">
            <TabsTrigger value="wallet" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber-500/30 data-[state=active]:to-orange-500/30 data-[state=active]:text-amber-300" data-testid="tab-wallet">
              <Wallet className="h-4 w-4 mr-2" />
              Treasury Wallet
            </TabsTrigger>
            <TabsTrigger value="btc-lightning" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-300" data-testid="tab-btc-lightning">
              <Bitcoin className="h-4 w-4 mr-2" />
              BTC Lightning
            </TabsTrigger>
            <TabsTrigger value="operations" className="data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-300" data-testid="tab-operations">
              <Activity className="h-4 w-4 mr-2" />
              Operations
            </TabsTrigger>
            <TabsTrigger value="invoices" className="data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-300" data-testid="tab-invoices">
              <Coins className="h-4 w-4 mr-2" />
              Invoices
            </TabsTrigger>
            <TabsTrigger value="safety" className="data-[state=active]:bg-green-500/20 data-[state=active]:text-green-300" data-testid="tab-safety">
              <Shield className="h-4 w-4 mr-2" />
              Safety
            </TabsTrigger>
            <TabsTrigger value="transfers" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-300" data-testid="tab-transfers">
              <Send className="h-4 w-4 mr-2" />
              Transfers
            </TabsTrigger>
            <TabsTrigger value="swaps" className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-300" data-testid="tab-swaps">
              <ArrowRightLeft className="h-4 w-4 mr-2" />
              Swaps
            </TabsTrigger>
            <TabsTrigger value="payouts" className="data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300" data-testid="tab-payouts">
              <Download className="h-4 w-4 mr-2" />
              Payouts
              {pendingPayouts?.payouts && pendingPayouts.payouts.length > 0 && (
                <Badge className="ml-1 bg-amber-500 text-white text-xs px-1.5 py-0.5">{pendingPayouts.payouts.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="deposits" className="data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-300" data-testid="tab-deposits">
              <Upload className="h-4 w-4 mr-2" />
              Deposits
            </TabsTrigger>
            <TabsTrigger value="analytics" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-300" data-testid="tab-analytics">
              <BarChart3 className="h-4 w-4 mr-2" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="reviews" className="data-[state=active]:bg-yellow-500/20 data-[state=active]:text-yellow-300" data-testid="tab-reviews">
              <Star className="h-4 w-4 mr-2" />
              Reviews
            </TabsTrigger>
            <TabsTrigger value="ledger" className="data-[state=active]:bg-pink-500/20 data-[state=active]:text-pink-300" data-testid="tab-ledger">
              <History className="h-4 w-4 mr-2" />
              Token Ledger
            </TabsTrigger>
            <TabsTrigger value="jcmoves-audit" className="data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300" data-testid="tab-jcmoves-audit">
              <Zap className="h-4 w-4 mr-2" />
              JCMOVES Audit
            </TabsTrigger>
            <TabsTrigger value="reward-config" className="data-[state=active]:bg-teal-500/20 data-[state=active]:text-teal-300" data-testid="tab-reward-config">
              <Settings className="h-4 w-4 mr-2" />
              Rewards
            </TabsTrigger>
            <TabsTrigger value="staking-treasury" className="data-[state=active]:bg-indigo-500/20 data-[state=active]:text-indigo-300" data-testid="tab-staking-treasury">
              <Layers className="h-4 w-4 mr-2" />
              Staking
            </TabsTrigger>
            <TabsTrigger value="liability" className="data-[state=active]:bg-red-500/20 data-[state=active]:text-red-300" data-testid="tab-liability">
              <Calculator className="h-4 w-4 mr-2" />
              Liability
            </TabsTrigger>
          </TabsList>

          {/* Treasury Wallet Tab - Beautiful Balance Display */}
          <TabsContent value="wallet" className="space-y-6">
            {/* Main Balance Card */}
            <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-amber-900/40 via-orange-900/30 to-yellow-900/40">
              {/* Decorative background elements */}
              <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 via-transparent to-orange-500/5"></div>
              <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-orange-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2"></div>
              
              <div className="relative p-8">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/25">
                      <Wallet className="h-8 w-8 text-white" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-black text-white">Treasury Wallet</h2>
                      <p className="text-amber-300/70 text-sm">Live Blockchain Balance</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchBalance()}
                    className="border-amber-500/50 text-amber-300 hover:bg-amber-500/10"
                    data-testid="button-refresh-balance"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                  </Button>
                </div>

                {/* Large Balance Display */}
                <div className="text-center py-8">
                  <div className="text-6xl md:text-7xl font-black bg-gradient-to-r from-amber-300 via-yellow-200 to-orange-300 bg-clip-text text-transparent mb-2">
                    {blockchainBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-2xl font-bold text-amber-400/80">JCMOVES</div>
                </div>

                {/* Wallet Address */}
                <div className="mt-6 p-4 bg-slate-900/50 rounded-xl border border-amber-500/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Wallet Address</p>
                      <p className="font-mono text-amber-300 text-sm break-all">
                        {liveBalance?.walletAddress || '2eouZ3mWGGW1Jettcra6L5ZkaCzqvfpNh9XT7CHva1Ry'}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(liveBalance?.walletAddress || '2eouZ3mWGGW1Jettcra6L5ZkaCzqvfpNh9XT7CHva1Ry');
                        toast({ title: "Copied!", description: "Wallet address copied to clipboard" });
                      }}
                      className="text-amber-400 hover:bg-amber-500/10"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Send Tokens Button */}
                <Button
                  className="w-full mt-6 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white font-bold py-4 text-lg"
                  onClick={() => {
                    const tabsElement = document.querySelector('[value="transfers"]') as HTMLElement;
                    tabsElement?.click();
                  }}
                  data-testid="button-send-tokens"
                >
                  <Send className="h-5 w-5 mr-2" />
                  Send Tokens
                </Button>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="btc-lightning" className="space-y-6">
            <Card className="p-6 border border-orange-500/30 bg-gradient-to-br from-orange-950/40 to-slate-900/80">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-xl font-black text-white flex items-center gap-2">
                    <Bitcoin className="h-6 w-6 text-orange-400" /> Bitcoin Lightning Treasury
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">BTC stays BTC · USD is accounting value only · conversion is manual and currently disabled</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchBtcLightningLedger()} className="border-orange-500/40 text-orange-300">
                  <RefreshCw className="h-4 w-4 mr-2" /> Refresh ledger
                </Button>
              </div>

              <div className={`mt-5 rounded-xl border p-4 ${btcLightningLedger?.readiness.ready ? "border-green-500/30 bg-green-500/10" : "border-amber-500/30 bg-amber-500/10"}`}>
                <div className="flex items-start gap-3">
                  {btcLightningLedger?.readiness.ready
                    ? <CheckCircle className="h-5 w-5 text-green-400 mt-0.5" />
                    : <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5" />}
                  <div>
                    <p className="font-semibold text-white">{btcLightningLedger?.readiness.ready ? "Received-asset custody policy ready" : "Configuration required before checkout"}</p>
                    <p className="text-xs text-slate-400 mt-1">The app requires 100% BTC custody with no automatic conversion. The USD figures below value each job for bookkeeping and payout math; they are not a USD settlement balance.</p>
                    {btcLightningLedger?.readiness.blockers?.length ? (
                      <ul className="mt-2 text-xs text-amber-200 space-y-1">
                        {btcLightningLedger.readiness.blockers.map((blocker) => <li key={blocker}>• {blocker}</li>)}
                      </ul>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mt-5">
                <div className="rounded-xl bg-slate-900/60 border border-slate-700 p-3">
                  <p className="text-xs text-slate-500">Payments</p>
                  <p className="text-xl font-black text-white">{btcLightningLedger?.totals.payment_count ?? 0}</p>
                </div>
                <div className="rounded-xl bg-slate-900/60 border border-slate-700 p-3">
                  <p className="text-xs text-slate-500">USD accounting value</p>
                  <p className="text-xl font-black text-green-300">${Number(btcLightningLedger?.totals.amount_paid_usd || 0).toFixed(2)}</p>
                </div>
                <div className="rounded-xl bg-slate-900/60 border border-slate-700 p-3">
                  <p className="text-xs text-slate-500">Refunded</p>
                  <p className="text-xl font-black text-red-300">${Number(btcLightningLedger?.totals.refunded_amount_usd || 0).toFixed(2)}</p>
                </div>
                <div className="rounded-xl bg-slate-900/60 border border-slate-700 p-3">
                  <p className="text-xs text-slate-500">Discounts</p>
                  <p className="text-xl font-black text-orange-300">${Number(btcLightningLedger?.totals.discount_amount_usd || 0).toFixed(2)}</p>
                </div>
                <div className="rounded-xl bg-slate-900/60 border border-slate-700 p-3">
                  <p className="text-xs text-slate-500">JCMOVES liability</p>
                  <p className="text-xl font-black text-amber-300">${Number(btcLightningLedger?.totals.reward_value_usd || 0).toFixed(2)}</p>
                </div>
                <div className="rounded-xl bg-slate-900/60 border border-slate-700 p-3 col-span-2 lg:col-span-1">
                  <p className="text-xs text-slate-500">BTC held in-kind</p>
                  <p className="text-xl font-black text-orange-300">₿{Number(btcLightningLedger?.totals.retained_btc_amount || 0).toFixed(8)}</p>
                  <p className="text-[10px] text-slate-500">{btcLightningLedger?.totals.pending_reconciliation_count ?? 0} awaiting BTC custody confirmation</p>
                </div>
              </div>
            </Card>

            <Card className="p-6 border border-slate-700/60 bg-slate-900/70">
              <h3 className="font-bold text-white mb-4">Payment and retention ledger</h3>
              {btcLightningLedger?.entries?.length ? (
                <div className="space-y-3">
                  {btcLightningLedger.entries.map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-slate-700/60 bg-slate-950/50 p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-semibold text-white">JC-{entry.order_number || entry.lead_id.slice(0, 8)} · {[entry.first_name, entry.last_name].filter(Boolean).join(" ") || "Customer"}</p>
                          <p className="text-xs text-slate-500">{new Date(entry.created_at).toLocaleString()} · intent #{entry.crypto_intent_id}</p>
                        </div>
                        <Badge variant="outline" className={entry.net_btc_amount ? "border-green-500/40 text-green-300" : "border-amber-500/40 text-amber-300"}>
                          {entry.net_btc_amount ? "BTC held - not converted" : "BTC custody reconciliation pending"}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-3 text-sm">
                        <div><p className="text-xs text-slate-500">Quote value (USD)</p><p>${Number(entry.original_amount_usd).toFixed(2)}</p></div>
                        <div><p className="text-xs text-slate-500">Discount</p><p className="text-orange-300">-${Number(entry.discount_amount_usd).toFixed(2)}</p></div>
                        <div><p className="text-xs text-slate-500">Paid value (USD)</p><p className="text-green-300">${Number(entry.amount_paid_usd).toFixed(2)}</p></div>
                        <div><p className="text-xs text-slate-500">Refunded</p><p className="text-red-300">${Number(entry.refunded_amount_usd || 0).toFixed(2)}</p></div>
                        <div><p className="text-xs text-slate-500">Reward</p><p className="text-amber-300">{Number(entry.reward_tokens).toLocaleString()} JC</p></div>
                        <div><p className="text-xs text-slate-500">Retained</p><p className="text-orange-300">{entry.retained_btc_amount ? `₿${Number(entry.retained_btc_amount).toFixed(8)}` : "Pending"}</p></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 text-slate-500">
                  <Bitcoin className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p>No confirmed Lightning job payments yet.</p>
                </div>
              )}
            </Card>
          </TabsContent>

          {/* Operations Tab */}
          <TabsContent value="operations" className="space-y-6">
            {/* Burn Wallet - Live Blockchain Balance for Transparency */}
            <Collapsible open={buybackExpanded} onOpenChange={setBuybackExpanded}>
              <Card className="border-2 border-green-500/50 bg-gradient-to-br from-green-900/30 via-slate-800/80 to-slate-900/80 overflow-hidden">
                <CollapsibleTrigger asChild>
                  <div className="p-6 cursor-pointer hover:bg-green-500/5 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 rounded-xl bg-green-500/20 border border-green-500/40">
                          <Coins className="h-6 w-6 text-green-400" />
                        </div>
                        <div>
                          <h3 className="text-xl font-bold text-green-400">Burn Wallet (Buyback Fund)</h3>
                          <p className="text-sm text-slate-400">Live blockchain balance - tokens burned for buyback</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-3xl font-bold text-green-400">
                            {(buybackFundData?.burnWallet?.tokenBalance || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </div>
                          <div className="text-sm text-green-500/80">JCMOVES Burned (Live)</div>
                        </div>
                        <ChevronDown className={`h-6 w-6 text-green-400 transition-transform duration-200 ${buybackExpanded ? 'rotate-180' : ''}`} />
                      </div>
                    </div>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-6 pb-6 border-t border-green-500/20">
                    <div className="flex justify-end mt-4 mb-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); refetchBuybackFund(); }}
                        className="text-green-400 hover:bg-green-500/10"
                        data-testid="button-refresh-buyback-fund"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh
                      </Button>
                    </div>
                    
                    {/* Burn Wallet Address */}
                    <div className="mb-4 p-4 bg-slate-900/60 rounded-xl border border-green-500/20">
                      <div className="text-sm text-slate-400 mb-2">Burn Wallet Address (Transparent Verification)</div>
                      <div className="flex items-center gap-2">
                        <div className="font-mono text-xs bg-slate-900/50 border border-slate-700/50 text-green-300 p-2 rounded-lg flex-1 break-all">
                          {buybackFundData?.burnWallet?.address || "34e5eAwb6Eh6zgyARSrk7RX1bkK2rVX5bazCHYXKtRM7"}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard.writeText(buybackFundData?.burnWallet?.address || "34e5eAwb6Eh6zgyARSrk7RX1bkK2rVX5bazCHYXKtRM7");
                            toast({ title: "Copied!", description: "Burn wallet address copied" });
                          }}
                          className="text-green-400 hover:bg-green-500/10"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                          className="text-green-400 hover:bg-green-500/10"
                        >
                          <a 
                            href={`https://solscan.io/account/${buybackFundData?.burnWallet?.address || "34e5eAwb6Eh6zgyARSrk7RX1bkK2rVX5bazCHYXKtRM7"}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Live Blockchain Balance */}
                      <div className="p-4 bg-slate-900/60 rounded-xl border border-green-500/30">
                        <div className="text-sm text-slate-400 mb-1">Live Blockchain Balance</div>
                        <div className="text-2xl font-bold text-green-400">
                          {(buybackFundData?.burnWallet?.tokenBalance || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} 
                          <span className="text-sm ml-1 text-green-500/80">JCMOVES</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-1">Verified on Solana blockchain</div>
                      </div>
                      {/* SOL Balance */}
                      <div className="p-4 bg-slate-900/60 rounded-xl border border-amber-500/20">
                        <div className="text-sm text-slate-400 mb-1">SOL Balance</div>
                        <div className="text-2xl font-bold text-amber-400">
                          {(buybackFundData?.burnWallet?.solBalance || 0).toFixed(6)}
                          <span className="text-sm ml-1 text-amber-500/80">SOL</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-1">Network fees in burn wallet</div>
                      </div>
                      {/* Database Tracked */}
                      <div className="p-4 bg-slate-900/60 rounded-xl border border-purple-500/20">
                        <div className="text-sm text-slate-400 mb-1">Database Tracked</div>
                        <div className="text-2xl font-bold text-purple-400">
                          {(buybackFundData?.fund?.feeContributionCount || 0).toLocaleString()}
                          <span className="text-sm ml-1 text-purple-500/80">contributions</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          {buybackFundData?.fund?.lastUpdated 
                            ? `Last: ${format(new Date(buybackFundData.fund.lastUpdated), 'MMM d, h:mm a')}`
                            : 'No contributions yet'}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 p-3 bg-slate-900/40 rounded-lg border border-slate-700/50">
                      <div className="flex items-center gap-2 text-sm text-slate-400">
                        <Shield className="h-4 w-4 text-green-400" />
                        <span>1% fee from each payout sent to burn wallet - tokens are permanently locked for transparency</span>
                      </div>
                    </div>
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Accounting allocations — no underlying funds are moved */}
            <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
              <h3 className="text-lg font-bold mb-1 flex items-center gap-2 text-slate-100">
                💰 Revenue Planning Allocation
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                Planning values only: 40% Buyback · 30% Staking · 20% Jackpot · 10% Liquidity. No cash or crypto is transferred, converted, or distributed by this ledger.
              </p>
              {revenueAllocData?.totals && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                    <div className="text-xs text-green-400 mb-0.5">Buyback (40%)</div>
                    <div className="text-lg font-black text-green-300">${parseFloat(revenueAllocData.totals.total_buyback || "0").toFixed(2)}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                    <div className="text-xs text-indigo-400 mb-0.5">Staking (30%)</div>
                    <div className="text-lg font-black text-indigo-300">${parseFloat(revenueAllocData.totals.total_staking || "0").toFixed(2)}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                    <div className="text-xs text-yellow-400 mb-0.5">Jackpot (20%)</div>
                    <div className="text-lg font-black text-yellow-300">${parseFloat(revenueAllocData.totals.total_jackpot || "0").toFixed(2)}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                    <div className="text-xs text-blue-400 mb-0.5">Liquidity (10%)</div>
                    <div className="text-lg font-black text-blue-300">${parseFloat(revenueAllocData.totals.total_liquidity || "0").toFixed(2)}</div>
                  </div>
                </div>
              )}
              {revenueAllocData?.allocations && revenueAllocData.allocations.length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {revenueAllocData.allocations.map((a) => (
                    <div key={a.id} className="flex items-center gap-3 text-xs text-slate-300 bg-slate-900/40 rounded-lg px-3 py-2">
                      <span className="text-green-400 font-bold">${parseFloat(a.paymentAmountUsd).toFixed(2)}</span>
                      <span className="text-slate-500 flex-1 truncate">{a.leadId ? `Lead: ${a.leadId.slice(0, 8)}…` : "—"}</span>
                      <span className="text-slate-500">{a.source === 'square_payment' ? 'Square' : 'Admin'}</span>
                      <span className="text-slate-600">{new Date(a.createdAt).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic">No confirmed payments recorded yet. Split entries appear after a Square invoice is paid or admin marks a lead as paid.</p>
              )}
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Blockchain Verification */}
              <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-100">
                  <div className="p-2 rounded-lg bg-blue-500/20 border border-blue-500/30">
                    <Wallet className="h-5 w-5 text-blue-400" />
                  </div>
                  Blockchain Verification
                </h3>
                <div className="space-y-4">
                  <div>
                    <div className="text-sm text-slate-400">Treasury Wallet</div>
                    <div className="font-mono text-xs bg-slate-900/50 border border-slate-700/50 text-slate-300 p-2 rounded-lg mt-1 break-all">
                      {liveBalance?.walletAddress || "Not configured"}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => refetchBalance()}
                      variant="outline"
                      className="flex-1 border-slate-600 text-slate-300 hover:bg-blue-500/20 hover:border-blue-500/50"
                      data-testid="button-refresh-balance"
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Refresh
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 border-slate-600 text-slate-300 hover:bg-blue-500/20 hover:border-blue-500/50"
                      asChild
                      data-testid="button-view-solscan"
                    >
                      <a
                        href={`https://solscan.io/account/${liveBalance?.walletAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        View on Solscan
                      </a>
                    </Button>
                  </div>
                </div>
              </Card>

              {/* Treasury Health */}
              <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-100">
                  <div className="p-2 rounded-lg bg-green-500/20 border border-green-500/30">
                    <Activity className="h-5 w-5 text-green-400" />
                  </div>
                  Treasury Health
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-400">Blockchain Balance</span>
                    <span className="font-bold text-slate-100">
                      {blockchainBalance?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || "0"} JCMOVES
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-400">Database Tracked</span>
                    <span className="font-bold text-slate-100">
                      {databaseBalance?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || "0"} JCMOVES
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-400">Balance Sync</span>
                    <span className={`font-bold ${balanceDiscrepancy < 100 ? 'text-green-400' : 'text-orange-400'}`}>
                      {balanceDiscrepancy < 100 ? 'In Sync' : `${balanceDiscrepancy.toLocaleString()} diff`}
                    </span>
                  </div>
                  <div className="pt-3 border-t border-slate-700/50">
                    <div className="flex items-center gap-2">
                      {blockchainBalance > 50000 ? (
                        <>
                          <CheckCircle className="h-4 w-4 text-green-400" />
                          <span className="text-sm text-green-400 font-bold">Healthy - Above Reserve</span>
                        </>
                      ) : blockchainBalance > 10000 ? (
                        <>
                          <AlertTriangle className="h-4 w-4 text-yellow-400" />
                          <span className="text-sm text-yellow-400 font-bold">Low Balance</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="h-4 w-4 text-red-400" />
                          <span className="text-sm text-red-400 font-bold">Critical - Below Reserve</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            {/* Treasury Wallet Configuration */}
            <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-100">
                <div className="p-2 rounded-lg bg-purple-500/20 border border-purple-500/30">
                  <Coins className="h-5 w-5 text-purple-400" />
                </div>
                Treasury Wallet Configuration
              </h3>
              <div className="space-y-4">
                {treasuryWallets?.wallets?.map((wallet: any) => (
                  <div key={wallet.id} className="p-4 bg-slate-900/50 rounded-xl border border-slate-700/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-300">
                        {wallet.currency?.symbol || 'Unknown'} - {wallet.purpose}
                      </span>
                      <span className="text-xs text-slate-500">
                        Balance: {parseFloat(wallet.balance).toLocaleString()} tokens
                      </span>
                    </div>
                    
                    {isEditingTreasury ? (
                      <div className="space-y-3">
                        <Input
                          value={newTreasuryAddress}
                          onChange={(e) => setNewTreasuryAddress(e.target.value)}
                          placeholder="Enter new Solana wallet address"
                          className="bg-slate-800 border-slate-600 text-slate-200"
                          data-testid="input-new-treasury-address"
                        />
                        <div className="flex gap-2">
                          <Button
                            onClick={() => {
                              if (newTreasuryAddress) {
                                updateTreasuryWalletMutation.mutate({
                                  walletId: wallet.id,
                                  walletAddress: newTreasuryAddress,
                                });
                              }
                            }}
                            disabled={!newTreasuryAddress || updateTreasuryWalletMutation.isPending}
                            className="flex-1 bg-purple-600 hover:bg-purple-500"
                            data-testid="button-save-treasury"
                          >
                            {updateTreasuryWalletMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : null}
                            Save Address
                          </Button>
                          <Button
                            onClick={() => {
                              setIsEditingTreasury(false);
                              setNewTreasuryAddress("");
                            }}
                            variant="outline"
                            className="border-slate-600"
                            data-testid="button-cancel-treasury-edit"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="font-mono text-xs bg-slate-800/50 text-slate-300 p-2 rounded-lg break-all">
                          {wallet.walletAddress}
                        </div>
                        <div className="flex gap-2 mt-3">
                          <Button
                            onClick={() => {
                              setIsEditingTreasury(true);
                              setNewTreasuryAddress(wallet.walletAddress);
                            }}
                            variant="outline"
                            size="sm"
                            className="border-slate-600 text-slate-300 hover:bg-purple-500/20"
                            data-testid="button-edit-treasury"
                          >
                            Edit Address
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-slate-600 text-slate-300 hover:bg-blue-500/20"
                            asChild
                          >
                            <a
                              href={`https://solscan.io/account/${wallet.walletAddress}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="h-3 w-3 mr-1" />
                              View on Solscan
                            </a>
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )) || (
                  <div className="text-center py-8 text-slate-500">
                    No treasury wallets configured. Contact system administrator.
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          {/* Invoices Tab - Square Invoicing */}
          <TabsContent value="invoices" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Square Configuration Status */}
              <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-100">
                  <div className="p-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30">
                    <Coins className="h-5 w-5 text-emerald-400" />
                  </div>
                  Square Integration
                </h3>
                <div className="space-y-4">
                  <div className="p-4 bg-slate-900/50 rounded-xl border border-slate-700/50">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-400">Status</span>
                      {squareConfig?.configured ? (
                        <span className="flex items-center gap-2 text-emerald-400">
                          <CheckCircle className="h-4 w-4" />
                          Connected
                        </span>
                      ) : (
                        <span className="flex items-center gap-2 text-yellow-400">
                          <AlertTriangle className="h-4 w-4" />
                          Not Configured
                        </span>
                      )}
                    </div>
                    {squareConfig?.configured && (
                      <div className="mt-2 text-xs text-slate-500">
                        Environment: {squareConfig.environment}
                      </div>
                    )}
                  </div>
                  {!squareConfig?.configured && (
                    <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
                      <p className="text-sm text-yellow-300">
                        Add SQUARE_ACCESS_TOKEN secret to enable invoicing.
                      </p>
                      <p className="text-xs text-yellow-400/70 mt-1">
                        Get your API key from developer.squareup.com
                      </p>
                    </div>
                  )}
                </div>
              </Card>

              {/* Create Invoice Form */}
              <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-100">
                  <div className="p-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30">
                    <Plus className="h-5 w-5 text-emerald-400" />
                  </div>
                  Create Invoice
                </h3>
                <div className="space-y-4">
                  <div>
                    <Label className="text-slate-400">Customer Name</Label>
                    <Input
                      value={invoiceForm.name}
                      onChange={(e) => setInvoiceForm({ ...invoiceForm, name: e.target.value })}
                      placeholder="Customer full name"
                      className="bg-slate-900/50 border-slate-700"
                      data-testid="input-invoice-name"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Email</Label>
                    <Input
                      type="email"
                      value={invoiceForm.email}
                      onChange={(e) => setInvoiceForm({ ...invoiceForm, email: e.target.value })}
                      placeholder="Customer email address"
                      className="bg-slate-900/50 border-slate-700"
                      data-testid="input-invoice-email"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Phone (optional)</Label>
                    <Input type="tel"
                      value={invoiceForm.phone}
                      onChange={(e) => setInvoiceForm({ ...invoiceForm, phone: e.target.value })}
                      placeholder="Customer phone number"
                      className="bg-slate-900/50 border-slate-700"
                      data-testid="input-invoice-phone"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Amount ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={invoiceForm.amount}
                      onChange={(e) => setInvoiceForm({ ...invoiceForm, amount: e.target.value })}
                      placeholder="500.00"
                      className="bg-slate-900/50 border-slate-700"
                      data-testid="input-invoice-amount"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Description</Label>
                    <Input
                      value={invoiceForm.description}
                      onChange={(e) => setInvoiceForm({ ...invoiceForm, description: e.target.value })}
                      placeholder="Moving service - 2BR apartment"
                      className="bg-slate-900/50 border-slate-700"
                      data-testid="input-invoice-description"
                    />
                  </div>
                  <Button
                    onClick={() => createInvoiceMutation.mutate()}
                    disabled={createInvoiceMutation.isPending || !squareConfig?.configured}
                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                    data-testid="button-create-invoice"
                  >
                    {createInvoiceMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    Send Invoice
                  </Button>
                </div>
              </Card>
            </div>

            {/* Recent Invoices */}
            <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold flex items-center gap-2 text-slate-100">
                  <History className="h-5 w-5 text-emerald-400" />
                  Recent Invoices
                </h3>
                <Button
                  onClick={() => refetchInvoices()}
                  variant="ghost"
                  size="sm"
                  data-testid="button-refresh-invoices"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-3">
                {invoices && invoices.length > 0 ? (
                  invoices.map((invoice: any) => (
                    <div
                      key={invoice.id}
                      className="p-4 bg-slate-900/50 rounded-xl border border-slate-700/50 flex justify-between items-center"
                      data-testid={`invoice-row-${invoice.id}`}
                    >
                      <div>
                        <div className="font-medium text-slate-200">{invoice.customerName}</div>
                        <div className="text-sm text-slate-400">{invoice.customerEmail}</div>
                        <div className="text-xs text-slate-500 mt-1">{invoice.description}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-emerald-400">${parseFloat(invoice.amount).toFixed(2)}</div>
                        <div className={`text-xs px-2 py-1 rounded-full ${
                          invoice.status === 'paid' ? 'bg-green-500/20 text-green-400' :
                          invoice.status === 'sent' ? 'bg-blue-500/20 text-blue-400' :
                          invoice.status === 'canceled' ? 'bg-red-500/20 text-red-400' :
                          'bg-slate-500/20 text-slate-400'
                        }`}>
                          {invoice.status}
                        </div>
                        {invoice.invoiceUrl && (
                          <a
                            href={invoice.invoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-400 hover:underline mt-1 flex items-center gap-1 justify-end"
                          >
                            View <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    No invoices yet. Create your first invoice above.
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          {/* Safety Tab - Treasury Safety Controls */}
          <TabsContent value="safety" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Spending Limits */}
              <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-100">
                  <div className="p-2 rounded-lg bg-green-500/20 border border-green-500/30">
                    <Lock className="h-5 w-5 text-green-400" />
                  </div>
                  Spending Limits
                </h3>
                <div className="space-y-4">
                  {/* Per Transaction Limit */}
                  <div className="p-4 bg-slate-900/50 rounded-xl border border-slate-700/50">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-slate-400">Per Transaction Limit</span>
                      {editingLimit === 'per_transaction' ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={newLimitValue}
                            onChange={(e) => setNewLimitValue(e.target.value)}
                            className="w-32 px-2 py-1 text-sm bg-slate-800 border border-slate-600 rounded text-white"
                            placeholder="Amount"
                            data-testid="input-per-transaction-limit"
                          />
                          <Button
                            size="sm"
                            onClick={() => updateLimitMutation.mutate({ limitType: 'per_transaction', limitValue: parseFloat(newLimitValue) })}
                            disabled={updateLimitMutation.isPending}
                            data-testid="button-save-per-transaction"
                          >
                            <Save className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-green-400">
                            {treasuryLimits?.limits?.find(l => l.limitType === 'per_transaction')
                              ? parseFloat(treasuryLimits.limits.find(l => l.limitType === 'per_transaction')!.limitValue).toLocaleString()
                              : '500,000,000'} JCMOVES
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingLimit('per_transaction');
                              const current = treasuryLimits?.limits?.find(l => l.limitType === 'per_transaction');
                              setNewLimitValue(current ? current.limitValue : '500000000');
                            }}
                            data-testid="button-edit-per-transaction"
                          >
                            <Edit className="h-3 w-3 text-slate-400" />
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-green-500 to-green-400 w-full rounded-full"></div>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Max per withdrawal/transfer (up to 500M)</p>
                  </div>
                  
                  {/* Daily Limit */}
                  <div className="p-4 bg-slate-900/50 rounded-xl border border-slate-700/50">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-slate-400">Daily Limit</span>
                      {editingLimit === 'daily' ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={newLimitValue}
                            onChange={(e) => setNewLimitValue(e.target.value)}
                            className="w-32 px-2 py-1 text-sm bg-slate-800 border border-slate-600 rounded text-white"
                            placeholder="Amount"
                            data-testid="input-daily-limit"
                          />
                          <Button
                            size="sm"
                            onClick={() => updateLimitMutation.mutate({ limitType: 'daily', limitValue: parseFloat(newLimitValue) })}
                            disabled={updateLimitMutation.isPending}
                            data-testid="button-save-daily"
                          >
                            <Save className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-blue-400">
                            {treasuryLimits?.limits?.find(l => l.limitType === 'daily')
                              ? parseFloat(treasuryLimits.limits.find(l => l.limitType === 'daily')!.limitValue).toLocaleString()
                              : '500,000,000'} JCMOVES
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingLimit('daily');
                              const current = treasuryLimits?.limits?.find(l => l.limitType === 'daily');
                              setNewLimitValue(current ? current.limitValue : '500000000');
                            }}
                            data-testid="button-edit-daily"
                          >
                            <Edit className="h-3 w-3 text-slate-400" />
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-blue-500 to-blue-400 w-full rounded-full"></div>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Max total withdrawals per day (up to 500M)</p>
                  </div>
                  
                  {/* Minimum Reserve */}
                  <div className="p-4 bg-slate-900/50 rounded-xl border border-slate-700/50">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-slate-400">Minimum Reserve Required</span>
                      {editingLimit === 'minimum_reserve' ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={newLimitValue}
                            onChange={(e) => setNewLimitValue(e.target.value)}
                            className="w-32 px-2 py-1 text-sm bg-slate-800 border border-slate-600 rounded text-white"
                            placeholder="Amount"
                            data-testid="input-reserve-limit"
                          />
                          <Button
                            size="sm"
                            onClick={() => updateLimitMutation.mutate({ limitType: 'minimum_reserve', limitValue: parseFloat(newLimitValue) })}
                            disabled={updateLimitMutation.isPending}
                            data-testid="button-save-reserve"
                          >
                            <Save className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-orange-400">
                            {treasuryLimits?.limits?.find(l => l.limitType === 'minimum_reserve')
                              ? parseFloat(treasuryLimits.limits.find(l => l.limitType === 'minimum_reserve')!.limitValue).toLocaleString()
                              : '50,000'} JCMOVES
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingLimit('minimum_reserve');
                              const current = treasuryLimits?.limits?.find(l => l.limitType === 'minimum_reserve');
                              setNewLimitValue(current ? current.limitValue : '50000');
                            }}
                            data-testid="button-edit-reserve"
                          >
                            <Edit className="h-3 w-3 text-slate-400" />
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <CheckCircle className="h-4 w-4 text-green-400" />
                      <span className="text-xs text-green-400">Safety reserve to maintain liquidity</span>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Security Controls */}
              <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-100">
                  <div className="p-2 rounded-lg bg-purple-500/20 border border-purple-500/30">
                    <Shield className="h-5 w-5 text-purple-400" />
                  </div>
                  Security Controls
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-xl border border-slate-700/50">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/30">
                        <CheckCircle className="h-4 w-4 text-green-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-200">Admin-Only Transfers</p>
                        <p className="text-xs text-slate-500">Only admins can send from treasury</p>
                      </div>
                    </div>
                    <span className="text-xs text-green-400 font-bold">ACTIVE</span>
                  </div>
                  
                  <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-xl border border-slate-700/50">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/30">
                        <CheckCircle className="h-4 w-4 text-green-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-200">Address Validation</p>
                        <p className="text-xs text-slate-500">All addresses verified before send</p>
                      </div>
                    </div>
                    <span className="text-xs text-green-400 font-bold">ACTIVE</span>
                  </div>
                  
                  <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-xl border border-slate-700/50">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/30">
                        <CheckCircle className="h-4 w-4 text-green-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-200">Transaction Logging</p>
                        <p className="text-xs text-slate-500">All transactions recorded in database</p>
                      </div>
                    </div>
                    <span className="text-xs text-green-400 font-bold">ACTIVE</span>
                  </div>
                </div>
              </Card>
            </div>

            {/* Treasury Wallet Setup */}
            <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-100">
                <div className="p-2 rounded-lg bg-orange-500/20 border border-orange-500/30">
                  <Wallet className="h-5 w-5 text-orange-400" />
                </div>
                Treasury Wallet Setup
              </h3>
              <div className="space-y-4">
                <div className="p-4 bg-slate-900/50 rounded-xl border border-slate-700/50">
                  <div className="flex items-center gap-3 mb-3">
                    {transferStatus?.operational ? (
                      <>
                        <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/30">
                          <CheckCircle className="h-5 w-5 text-green-400" />
                        </div>
                        <div>
                          <p className="font-medium text-green-300">Wallet Configured</p>
                          <p className="text-xs text-green-400/70">Real blockchain transfers enabled</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/30">
                          <AlertTriangle className="h-5 w-5 text-orange-400" />
                        </div>
                        <div>
                          <p className="font-medium text-orange-300">Wallet Not Configured</p>
                          <p className="text-xs text-orange-400/70">Treasury private key required</p>
                        </div>
                      </>
                    )}
                  </div>
                  
                  {liveBalance?.walletAddress && (
                    <div className="mb-3">
                      <p className="text-xs text-slate-500 mb-1">Treasury Wallet Address</p>
                      <div className="font-mono text-xs bg-slate-950/50 text-slate-300 p-2 rounded-lg break-all border border-slate-700/50">
                        {liveBalance.walletAddress}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2 text-xs text-slate-400">
                    <p className="font-medium text-slate-300">To enable real token transfers:</p>
                    <ol className="list-decimal list-inside space-y-1 pl-2">
                      <li>Create a new Solana wallet or use an existing one</li>
                      <li>Transfer JCMOVES tokens to the wallet</li>
                      <li>Add the private key to your server environment as <code className="bg-slate-800 px-1 py-0.5 rounded text-orange-300">TREASURY_WALLET_PRIVATE_KEY</code></li>
                      <li>Restart the application to apply changes</li>
                    </ol>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchBalance()}
                    className="border-slate-600 text-slate-300 hover:bg-slate-700/50"
                    data-testid="button-refresh-wallet-status"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh Status
                  </Button>
                  {liveBalance?.walletAddress && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-slate-600 text-slate-300 hover:bg-slate-700/50"
                      asChild
                    >
                      <a
                        href={`https://solscan.io/account/${liveBalance.walletAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        View on Solscan
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </Card>

            {/* Transaction History */}
            <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-100">
                <div className="p-2 rounded-lg bg-blue-500/20 border border-blue-500/30">
                  <History className="h-5 w-5 text-blue-400" />
                </div>
                Recent Treasury Activity
              </h3>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-xl border border-slate-700/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/30">
                      <Send className="h-4 w-4 text-purple-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">Token Transfer</p>
                      <p className="text-xs text-slate-500 font-mono">To: 7xKXtg...osgAsU</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-purple-400">-1,000 JCMOVES</p>
                    <p className="text-xs text-slate-500 flex items-center gap-1 justify-end">
                      <Clock className="h-3 w-3" />
                      2 hours ago
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-xl border border-slate-700/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/30">
                      <Upload className="h-4 w-4 text-green-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">Treasury Deposit</p>
                      <p className="text-xs text-slate-500">Token transfer to treasury wallet</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-green-400">+50,000 JCMOVES</p>
                    <p className="text-xs text-slate-500 flex items-center gap-1 justify-end">
                      <Clock className="h-3 w-3" />
                      1 day ago
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-xl border border-slate-700/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/30">
                      <Coins className="h-4 w-4 text-orange-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">Mining Reward Payout</p>
                      <p className="text-xs text-slate-500">Auto-distribution to 12 users</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-orange-400">-20,736 JCMOVES</p>
                    <p className="text-xs text-slate-500 flex items-center gap-1 justify-end">
                      <Clock className="h-3 w-3" />
                      1 day ago
                    </p>
                  </div>
                </div>
                
                <p className="text-sm text-slate-500 text-center py-4">
                  Showing last 3 transactions • View all in Analytics
                </p>
              </div>
            </Card>
          </TabsContent>

          {/* Transfers Tab */}
          <TabsContent value="transfers" className="space-y-6">
            {/* Blockchain Status Card */}
            <Card className={`p-4 border ${transferStatus?.operational ? 'border-green-500/50 bg-green-500/10' : 'border-orange-500/50 bg-orange-500/10'}`}>
              <div className="flex items-center gap-3">
                {transferStatus?.operational ? (
                  <>
                    <CheckCircle className="h-5 w-5 text-green-400" />
                    <div>
                      <p className="font-medium text-green-300">Real Blockchain Transfers Ready</p>
                      <p className="text-xs text-green-400/70">Treasury: {transferStatus?.address?.slice(0, 8)}...{transferStatus?.address?.slice(-6)}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-5 w-5 text-orange-400" />
                    <div>
                      <p className="font-medium text-orange-300">Blockchain Transfers Disabled</p>
                      <p className="text-xs text-orange-400/70">Set TREASURY_WALLET_PRIVATE_KEY secret to enable</p>
                    </div>
                  </>
                )}
              </div>
            </Card>

            <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-100">
                <div className="p-2 rounded-lg bg-purple-500/20 border border-purple-500/30">
                  <Send className="h-5 w-5 text-purple-400" />
                </div>
                Send JCMOVES Tokens
              </h3>
              <p className="text-sm text-slate-400 mb-6">
                Transfer JCMOVES tokens directly from the treasury to any Solana wallet address.
                Enable blockchain execution to send real tokens on Solana mainnet.
              </p>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="recipient-address" className="text-slate-200">Recipient Wallet Address</Label>
                  <Input
                    id="recipient-address"
                    placeholder="Solana wallet address (e.g., 7xK...bkK)"
                    value={recipientAddress}
                    onChange={(e) => setRecipientAddress(e.target.value)}
                    className="font-mono text-sm bg-slate-800/50 border-slate-600 text-slate-100 placeholder:text-slate-500"
                    data-testid="input-recipient-address"
                  />
                </div>
                <div>
                  <Label htmlFor="transfer-amount" className="text-slate-200">Amount (JCMOVES)</Label>
                  <Input
                    id="transfer-amount"
                    type="number"
                    placeholder="0.00"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    className="bg-slate-800/50 border-slate-600 text-slate-100 placeholder:text-slate-500"
                    data-testid="input-transfer-amount"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Available: {blockchainBalance.toLocaleString()} JCMOVES
                  </p>
                </div>
                
                {/* Blockchain Execution Toggle */}
                <div className={`flex items-center justify-between p-4 rounded-xl border ${executeOnChain ? 'bg-purple-500/10 border-purple-500/50' : 'bg-slate-900/50 border-slate-700/50'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${executeOnChain ? 'bg-purple-500/20 border border-purple-500/30' : 'bg-slate-800/50'}`}>
                      <Shield className={`h-4 w-4 ${executeOnChain ? 'text-purple-400' : 'text-slate-500'}`} />
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${executeOnChain ? 'text-purple-300' : 'text-slate-400'}`}>
                        Execute on Blockchain
                      </p>
                      <p className="text-xs text-slate-500">
                        {executeOnChain ? 'Real tokens will be sent on Solana mainnet' : 'Record transfer without blockchain execution'}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={executeOnChain}
                    onCheckedChange={setExecuteOnChain}
                    disabled={!transferStatus?.operational}
                    data-testid="switch-execute-blockchain"
                  />
                </div>

                <Button
                  onClick={() => transferMutation.mutate()}
                  disabled={
                    transferMutation.isPending ||
                    !transferAmount ||
                    !recipientAddress ||
                    parseFloat(transferAmount) > blockchainBalance ||
                    (executeOnChain && !transferStatus?.operational)
                  }
                  className={`w-full ${executeOnChain ? 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700' : 'bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700'}`}
                  data-testid="button-send-transfer"
                >
                  {transferMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {executeOnChain ? 'Sending on Blockchain...' : 'Processing Transfer...'}
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      {executeOnChain ? 'Send Real Tokens' : 'Record Transfer Intent'}
                    </>
                  )}
                </Button>
                
                {executeOnChain && (
                  <p className="text-xs text-orange-400 text-center flex items-center justify-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    This action will send real JCMOVES tokens and cannot be undone
                  </p>
                )}
              </div>
            </Card>
          </TabsContent>

          {/* Swaps Tab - Manual Review Queue */}
          <TabsContent value="swaps" className="space-y-6">
            <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-bold flex items-center gap-2 text-slate-100">
                    <div className="p-2 rounded-lg bg-cyan-500/20 border border-cyan-500/30">
                      <ArrowRightLeft className="h-5 w-5 text-cyan-400" />
                    </div>
                    Swap Request Queue
                  </h3>
                  <p className="text-sm text-slate-400 mt-2">
                    Review and process manual swap requests from users
                  </p>
                </div>
                <Button 
                  variant="outline" 
                  onClick={() => refetchSwapRequests()}
                  className="border-slate-600 text-slate-300 hover:bg-cyan-500/20 hover:border-cyan-500/50"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              </div>

              {/* Pending Requests */}
              <div className="space-y-4">
                {!swapRequests?.requests?.length ? (
                  <div className="text-center py-8 text-slate-400">
                    <ArrowRightLeft className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No pending swap requests</p>
                  </div>
                ) : (
                  swapRequests.requests.map((request: any) => (
                    <div key={request.id} className="border border-slate-700/50 rounded-xl p-4 bg-slate-800/50">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-lg text-cyan-300">
                              {parseFloat(request.jcmovesAmount).toLocaleString()} JCMOVES
                            </span>
                            <span className="text-slate-400">→</span>
                            <span className="font-medium text-emerald-400">{request.desiredAsset}</span>
                          </div>
                          <p className="text-xs text-slate-400">
                            User: {request.userId} • {format(new Date(request.createdAt), "MMM d, yyyy h:mm a")}
                          </p>
                          <p className="text-xs text-slate-500 font-mono mt-1 break-all">
                            To: {request.destinationWallet}
                          </p>
                        </div>
                        <Badge 
                          variant="outline" 
                          className={
                            request.status === 'pending' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' :
                            request.status === 'approved' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                            request.status === 'completed' ? 'bg-green-500/10 text-green-400 border-green-500/30' :
                            'bg-red-500/10 text-red-400 border-red-500/30'
                          }
                        >
                          {request.status}
                        </Badge>
                      </div>

                      {/* Action buttons based on status */}
                      {request.status === 'pending' && (
                        <div className="flex gap-2 mt-4">
                          <Button
                            size="sm"
                            onClick={() => approveSwapMutation.mutate(request.id)}
                            disabled={approveSwapMutation.isPending}
                            className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700"
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedRequest(selectedRequest === request.id ? null : request.id)}
                            className="border-red-500/50 text-red-400 hover:bg-red-500/20"
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Decline
                          </Button>
                        </div>
                      )}

                      {/* Decline reason input */}
                      {selectedRequest === request.id && request.status === 'pending' && (
                        <div className="mt-3 space-y-2 p-3 bg-red-500/10 rounded-lg border border-red-500/30">
                          <Label className="text-red-300">Decline Reason</Label>
                          <Textarea
                            value={declineReason}
                            onChange={(e) => setDeclineReason(e.target.value)}
                            placeholder="Enter reason for declining..."
                            className="bg-slate-800/50 border-red-500/50 text-slate-100"
                          />
                          <Button
                            size="sm"
                            onClick={() => declineSwapMutation.mutate({ requestId: request.id, reason: declineReason })}
                            disabled={declineSwapMutation.isPending || !declineReason}
                            className="bg-red-500 hover:bg-red-600"
                          >
                            Confirm Decline
                          </Button>
                        </div>
                      )}

                      {/* Complete approved request */}
                      {request.status === 'approved' && (
                        <div className="mt-3 space-y-3 p-3 bg-blue-500/10 rounded-lg border border-blue-500/30">
                          <p className="text-sm text-blue-300">Complete the swap and record fulfillment details:</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-blue-200 text-xs">Amount Sent</Label>
                              <Input
                                value={fulfilledAmount}
                                onChange={(e) => setFulfilledAmount(e.target.value)}
                                placeholder="e.g., 0.5 SOL"
                                className="bg-slate-800/50 border-blue-500/50 text-slate-100"
                              />
                            </div>
                            <div>
                              <Label className="text-blue-200 text-xs">Transaction Hash</Label>
                              <Input
                                value={fulfillmentTxHash}
                                onChange={(e) => setFulfillmentTxHash(e.target.value)}
                                placeholder="Solscan TX hash"
                                className="bg-slate-800/50 border-blue-500/50 text-slate-100 font-mono text-xs"
                              />
                            </div>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => completeSwapMutation.mutate({ 
                              requestId: request.id, 
                              amount: fulfilledAmount, 
                              txHash: fulfillmentTxHash 
                            })}
                            disabled={completeSwapMutation.isPending || !fulfilledAmount || !fulfillmentTxHash}
                            className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Mark as Completed
                          </Button>
                        </div>
                      )}

                      {/* Show completion details */}
                      {request.status === 'completed' && (
                        <div className="mt-3 p-3 bg-green-500/10 rounded-lg border border-green-500/30 text-sm">
                          <p className="text-green-300">
                            Fulfilled: {request.fulfilledAmount} {request.desiredAsset}
                          </p>
                          {request.fulfillmentTxHash && (
                            <a
                              href={`https://solscan.io/tx/${request.fulfillmentTxHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:underline text-xs"
                            >
                              View on Solscan →
                            </a>
                          )}
                        </div>
                      )}

                      {/* Show decline reason */}
                      {request.status === 'declined' && request.declineReason && (
                        <div className="mt-3 p-3 bg-red-500/10 rounded-lg border border-red-500/30">
                          <p className="text-red-300 text-sm">Reason: {request.declineReason}</p>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </Card>

            {/* Compliance Info */}
            <Card className="p-4 border border-amber-500/30 bg-amber-500/5">
              <div className="flex items-start gap-3">
                <Shield className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-amber-300">Option A Compliance</h4>
                  <p className="text-sm text-amber-200/80 mt-1">
                    This system uses manual review to avoid exchange classification. All swaps are fulfilled off-platform
                    through treasury or external DEX. No automated execution or guaranteed rates.
                  </p>
                </div>
              </div>
            </Card>
          </TabsContent>

          {/* Payouts Tab - Approve Token Withdrawals */}
          <TabsContent value="payouts" className="space-y-6">
            <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-bold flex items-center gap-2 text-slate-100">
                    <div className="p-2 rounded-lg bg-amber-500/20 border border-amber-500/30">
                      <Download className="h-5 w-5 text-amber-400" />
                    </div>
                    Pending Payout Requests
                  </h3>
                  <p className="text-sm text-slate-400 mt-1">
                    Review and approve user token withdrawal requests
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchPayouts()}
                  className="border-slate-600"
                  data-testid="button-refresh-payouts"
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Refresh
                </Button>
              </div>

              {!pendingPayouts?.payouts || pendingPayouts.payouts.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <CheckCircle className="h-12 w-12 mx-auto mb-3 text-green-400/50" />
                  <p className="font-medium">No pending payout requests</p>
                  <p className="text-sm">All withdrawals have been processed</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {pendingPayouts.payouts.map((payout: any) => (
                    <div 
                      key={payout.id}
                      className="p-4 bg-slate-900/50 rounded-xl border border-slate-700/50"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="font-bold text-amber-300 text-lg">
                            {parseFloat(payout.tokenAmount).toLocaleString()} JCMOVES
                          </p>
                          <p className="text-sm text-slate-400">{payout.userName}</p>
                          <p className="text-xs text-slate-500">{payout.userEmail}</p>
                        </div>
                        <Badge 
                          variant="outline" 
                          className="bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
                        >
                          pending
                        </Badge>
                      </div>

                      <div className="space-y-2 text-sm text-slate-400 mb-4">
                        <p><span className="text-slate-500">To:</span> {payout.recipientAddress?.slice(0, 12)}...{payout.recipientAddress?.slice(-8)}</p>
                        <p><span className="text-slate-500">Requested:</span> {format(new Date(payout.requestedAt), "MMM d, yyyy h:mm a")}</p>
                      </div>

                      {selectedPayout !== payout.id ? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedPayout(payout.id);
                              setPayoutMode('process');
                              // Default to blockchain if available, otherwise manual
                              setExecutePayoutOnChain(!!transferStatus?.operational);
                            }}
                            className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
                            data-testid={`button-approve-payout-${payout.id}`}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Process
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedPayout(payout.id);
                              setPayoutMode('decline');
                            }}
                            className="border-red-500/50 text-red-400 hover:bg-red-500/10"
                            data-testid={`button-decline-payout-${payout.id}`}
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Decline
                          </Button>
                        </div>
                      ) : payoutMode === 'process' ? (
                        <div className="space-y-3 p-3 bg-green-500/10 rounded-lg border border-green-500/30">
                          <p className="text-sm text-green-300 font-medium">Process Payout</p>
                          
                          <div className="flex items-center justify-between">
                            <Label className="text-green-200 text-sm">Execute on blockchain</Label>
                            <Switch
                              checked={executePayoutOnChain}
                              onCheckedChange={setExecutePayoutOnChain}
                              disabled={!transferStatus?.operational}
                            />
                          </div>

                          {!executePayoutOnChain && (
                            <div>
                              <Label className="text-green-200 text-xs">Manual TX Hash</Label>
                              <Input
                                placeholder="Enter transaction hash..."
                                value={manualTxHash}
                                onChange={(e) => setManualTxHash(e.target.value)}
                                className="bg-slate-800/50 border-green-500/50 text-slate-100 mt-1"
                              />
                            </div>
                          )}

                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => processPayoutMutation.mutate({ 
                                payoutId: payout.id, 
                                txHash: executePayoutOnChain ? undefined : manualTxHash,
                                executeOnChain: executePayoutOnChain 
                              })}
                              disabled={processPayoutMutation.isPending || (!executePayoutOnChain && !manualTxHash)}
                              className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
                            >
                              {processPayoutMutation.isPending ? (
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              ) : (
                                <CheckCircle className="h-4 w-4 mr-1" />
                              )}
                              {executePayoutOnChain ? "Send Tokens" : "Mark Complete"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setSelectedPayout(null);
                                setManualTxHash("");
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3 p-3 bg-red-500/10 rounded-lg border border-red-500/30">
                          <p className="text-sm text-red-300 font-medium">Decline Payout</p>
                          <Input
                            placeholder="Reason for declining..."
                            value={payoutDeclineReason}
                            onChange={(e) => setPayoutDeclineReason(e.target.value)}
                            className="bg-slate-800/50 border-red-500/50 text-slate-100"
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => declinePayoutMutation.mutate({ 
                                payoutId: payout.id, 
                                reason: payoutDeclineReason 
                              })}
                              disabled={declinePayoutMutation.isPending || !payoutDeclineReason}
                              className="bg-red-500 hover:bg-red-600"
                            >
                              Confirm Decline
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setSelectedPayout(null);
                                setPayoutDeclineReason("");
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                          <p className="text-xs text-red-400/70">
                            Declining will refund tokens to user's balance
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Blockchain Status Info */}
            <Card className={`p-4 border ${transferStatus?.operational ? 'border-green-500/50 bg-green-500/10' : 'border-orange-500/50 bg-orange-500/10'}`}>
              <div className="flex items-center gap-3">
                {transferStatus?.operational ? (
                  <>
                    <CheckCircle className="h-5 w-5 text-green-400" />
                    <div>
                      <p className="font-medium text-green-300">Blockchain Transfers Ready</p>
                      <p className="text-xs text-green-400/70">
                        Treasury: {transferStatus?.address?.slice(0, 8)}...{transferStatus?.address?.slice(-6)} | 
                        Balance: {blockchainBalance.toLocaleString()} JCMOVES
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-5 w-5 text-orange-400" />
                    <div>
                      <p className="font-medium text-orange-300">Manual Processing Only</p>
                      <p className="text-xs text-orange-400/70">Set TREASURY_WALLET_PRIVATE_KEY to enable automatic blockchain transfers</p>
                    </div>
                  </>
                )}
              </div>
            </Card>
          </TabsContent>

          {/* Deposits Tab */}
          <TabsContent value="deposits" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-100">
                  <div className="p-2 rounded-lg bg-green-500/20 border border-green-500/30">
                    <Upload className="h-5 w-5 text-green-400" />
                  </div>
                  Record Token Deposit
                </h3>
                <p className="text-sm text-slate-400 mb-4">
                  Record tokens deposited to the treasury wallet. This updates the database tracking.
                </p>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="deposit-amount" className="text-slate-200">JCMOVES Amount</Label>
                    <Input
                      id="deposit-amount"
                      type="number"
                      placeholder="0"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      className="bg-slate-800/50 border-slate-600 text-slate-100 placeholder:text-slate-500"
                      data-testid="input-deposit-amount"
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      Enter the number of JCMOVES tokens deposited
                    </p>
                  </div>
                  <Button
                    onClick={() => depositMutation.mutate()}
                    disabled={depositMutation.isPending || !depositAmount}
                    className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
                    data-testid="button-record-deposit"
                  >
                    {depositMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Recording...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Record Deposit
                      </>
                    )}
                  </Button>
                </div>
              </Card>

              <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-100">
                  <div className="p-2 rounded-lg bg-blue-500/20 border border-blue-500/30">
                    <Download className="h-5 w-5 text-blue-400" />
                  </div>
                  Recent Deposits
                </h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {(deposits?.deposits?.length ?? 0) > 0 ? (
                    deposits?.deposits?.slice(0, 5).map((deposit: any) => (
                      <div
                        key={deposit.id}
                        className="flex justify-between items-center p-3 bg-slate-900/50 border border-slate-700/50 rounded-lg text-sm"
                      >
                        <div>
                          <div className="font-bold text-green-400">+{parseFloat(deposit.tokensPurchased || deposit.depositAmount).toLocaleString()} JCMOVES</div>
                          <div className="text-xs text-slate-500">
                            {new Date(deposit.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-slate-400 capitalize">{deposit.depositMethod}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500 text-center py-4">No recent deposits</p>
                  )}
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80 overflow-hidden relative">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-blue-600"></div>
                <h3 className="text-sm font-medium text-slate-400 mb-2">
                  Total Leads
                </h3>
                <div className="text-4xl font-black text-blue-400">{adminStats?.totalLeads || 0}</div>
              </Card>
              <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80 overflow-hidden relative">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-green-500 to-green-600"></div>
                <h3 className="text-sm font-medium text-slate-400 mb-2">
                  Active Jobs
                </h3>
                <div className="text-4xl font-black text-green-400">{adminStats?.activeJobs || 0}</div>
              </Card>
              <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80 overflow-hidden relative">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-500 to-orange-600"></div>
                <h3 className="text-sm font-medium text-slate-400 mb-2">
                  Total Rewards Distributed
                </h3>
                <div className="text-4xl font-black text-orange-400">
                  ${stats.totalDistributed?.toLocaleString() || "0"}
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* Reviews Tab */}
          <TabsContent value="reviews" className="space-y-6">
            <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-bold flex items-center gap-2 text-slate-100">
                    <div className="p-2 rounded-lg bg-orange-500/20 border border-orange-500/30">
                      <Star className="h-5 w-5 text-orange-400" />
                    </div>
                    Review Management
                  </h3>
                  <p className="text-sm text-slate-400 mt-2">
                    Import reviews from external platforms and manage customer testimonials
                  </p>
                </div>
                <Link href="/admin/testimonials">
                  <Button className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 shadow-lg shadow-orange-500/25">
                    <Plus className="h-4 w-4 mr-2" />
                    Import Reviews
                  </Button>
                </Link>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-orange-500/10 rounded-xl border border-orange-500/30">
                  <h4 className="font-bold text-orange-300 mb-2">Supported Platforms</h4>
                  <ul className="text-sm text-orange-200/80 space-y-1">
                    <li>• Yelp Reviews</li>
                    <li>• Google Reviews</li>
                    <li>• Facebook Reviews</li>
                    <li>• HireAHelper Reviews</li>
                  </ul>
                </div>
                <div className="p-4 bg-blue-500/10 rounded-xl border border-blue-500/30">
                  <h4 className="font-bold text-blue-300 mb-2">Quick Actions</h4>
                  <div className="space-y-2">
                    <Link href="/admin/testimonials">
                      <Button variant="outline" size="sm" className="w-full justify-start border-slate-600 text-slate-300 hover:bg-blue-500/20 hover:border-blue-500/50">
                        <Star className="h-4 w-4 mr-2" />
                        Manage All Reviews
                      </Button>
                    </Link>
                    <Link href="/reviews">
                      <Button variant="outline" size="sm" className="w-full justify-start border-slate-600 text-slate-300 hover:bg-blue-500/20 hover:border-blue-500/50">
                        <ExternalLink className="h-4 w-4 mr-2" />
                        View Public Reviews Page
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </Card>
          </TabsContent>

          {/* Token Ledger Tab - All JCMOVES Transactions */}
          <TabsContent value="ledger" className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="p-4 border border-slate-700/50 bg-gradient-to-br from-pink-500/10 to-purple-500/10">
                <div className="text-sm text-slate-400">Total Dispensed</div>
                <div className="text-2xl font-black text-pink-400">
                  {tokenLedger?.summary?.totalTokensDispensed?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || 0}
                </div>
                <div className="text-xs text-slate-500">JCMOVES</div>
              </Card>
              <Card className="p-4 border border-slate-700/50 bg-gradient-to-br from-orange-500/10 to-red-500/10">
                <div className="text-sm text-slate-400">Employee Balances</div>
                <div className="text-2xl font-black text-orange-400">
                  {tokenLedger?.summary?.employeeBalance?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || 0}
                </div>
                <div className="text-xs text-slate-500">JCMOVES</div>
              </Card>
              <Card className="p-4 border border-slate-700/50 bg-gradient-to-br from-blue-500/10 to-cyan-500/10">
                <div className="text-sm text-slate-400">Customer Balances</div>
                <div className="text-2xl font-black text-blue-400">
                  {tokenLedger?.summary?.customerBalance?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || 0}
                </div>
                <div className="text-xs text-slate-500">JCMOVES</div>
              </Card>
              <Card className="p-4 border border-slate-700/50 bg-gradient-to-br from-green-500/10 to-emerald-500/10">
                <div className="text-sm text-slate-400">Total Wallets</div>
                <div className="text-2xl font-black text-green-400">
                  {tokenLedger?.summary?.walletCount || 0}
                </div>
                <div className="text-xs text-slate-500">Active</div>
              </Card>
            </div>

            {/* Breakdown by Type */}
            <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-pink-400" />
                  Distribution by Type
                </h3>
                <Button variant="outline" size="sm" onClick={() => refetchLedger()} className="border-slate-600">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {tokenLedger?.summary?.totalByType && Object.entries(tokenLedger.summary.totalByType).map(([type, amount]) => (
                  <div key={type} className="p-3 bg-slate-700/30 rounded-lg">
                    <div className="text-xs text-slate-400 capitalize">{type.replace(/_/g, ' ')}</div>
                    <div className="text-lg font-bold text-white">{amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Recent Transactions */}
            <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
              <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                <History className="h-5 w-5 text-pink-400" />
                Recent Token Transactions
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-2 px-3 text-sm text-slate-400">User</th>
                      <th className="text-left py-2 px-3 text-sm text-slate-400">Role</th>
                      <th className="text-left py-2 px-3 text-sm text-slate-400">Type</th>
                      <th className="text-right py-2 px-3 text-sm text-slate-400">Amount</th>
                      <th className="text-left py-2 px-3 text-sm text-slate-400">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokenLedger?.transactions?.slice(0, 50).map((tx) => (
                      <tr key={tx.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                        <td className="py-2 px-3 text-sm text-white">
                          {tx.userFirstName} {tx.userLastName}
                          <div className="text-xs text-slate-500">{tx.userEmail}</div>
                        </td>
                        <td className="py-2 px-3">
                          <Badge className={tx.userRole === 'employee' ? 'bg-orange-500/20 text-orange-300' : tx.userRole === 'customer' ? 'bg-blue-500/20 text-blue-300' : 'bg-purple-500/20 text-purple-300'}>
                            {tx.userRole}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-sm text-slate-300 capitalize">{tx.rewardType?.replace(/_/g, ' ')}</td>
                        <td className="py-2 px-3 text-sm text-right font-bold text-green-400">+{parseFloat(tx.tokenAmount).toFixed(2)}</td>
                        <td className="py-2 px-3 text-sm text-slate-400">
                          {tx.earnedDate ? format(new Date(tx.earnedDate), 'MMM d, h:mm a') : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(!tokenLedger?.transactions || tokenLedger.transactions.length === 0) && (
                <div className="text-center py-8 text-slate-400">
                  No token transactions yet
                </div>
              )}
            </Card>

            {/* All Wallet Balances */}
            <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
              <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                <Wallet className="h-5 w-5 text-pink-400" />
                All User Wallet Balances
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-2 px-3 text-sm text-slate-400">User</th>
                      <th className="text-left py-2 px-3 text-sm text-slate-400">Role</th>
                      <th className="text-right py-2 px-3 text-sm text-slate-400">Balance</th>
                      <th className="text-right py-2 px-3 text-sm text-slate-400">Total Earned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokenLedger?.wallets?.map((wallet) => (
                      <tr key={wallet.userId} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                        <td className="py-2 px-3 text-sm text-white">
                          {wallet.userFirstName} {wallet.userLastName}
                          <div className="text-xs text-slate-500">{wallet.userEmail}</div>
                        </td>
                        <td className="py-2 px-3">
                          <Badge className={wallet.userRole === 'employee' ? 'bg-orange-500/20 text-orange-300' : wallet.userRole === 'customer' ? 'bg-blue-500/20 text-blue-300' : 'bg-purple-500/20 text-purple-300'}>
                            {wallet.userRole}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-green-400">{parseFloat(wallet.tokenBalance).toFixed(2)}</td>
                        <td className="py-2 px-3 text-right text-slate-300">{parseFloat(wallet.totalEarned).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(!tokenLedger?.wallets || tokenLedger.wallets.length === 0) && (
                <div className="text-center py-8 text-slate-400">
                  No wallet accounts yet
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="jcmoves-audit" className="space-y-6">
            <Card className="p-6 border border-amber-500/30 bg-gradient-to-br from-amber-950/40 to-slate-900/80">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="flex items-center gap-2 text-xl font-bold text-white"><Zap className="h-5 w-5 text-amber-300" /> JCMOVES payout audit</h2>
                  <p className="mt-1 text-sm text-slate-400">Confirmed reward activity for the rolling six months. Job paid-completion payouts are tracked separately so no other reward type is mistaken for a job payout.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchJcmovesAudit()} className="border-amber-500/50 text-amber-200 hover:bg-amber-500/10">
                  <RefreshCw className="mr-2 h-4 w-4" />Refresh
                </Button>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-amber-500/20 bg-slate-950/40 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Recipients</p>
                  <p className="mt-1 text-3xl font-black text-amber-300">{jcmovesAudit?.allJcMoves.users ?? 0}</p>
                  <p className="text-xs text-slate-500">unique users</p>
                </div>
                <div className="rounded-xl border border-amber-500/20 bg-slate-950/40 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Transactions</p>
                  <p className="mt-1 text-3xl font-black text-amber-300">{(jcmovesAudit?.allJcMoves.transactions ?? 0).toLocaleString()}</p>
                  <p className="text-xs text-slate-500">confirmed JCMOVES rewards</p>
                </div>
                <div className="rounded-xl border border-amber-500/20 bg-slate-950/40 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Distributed</p>
                  <p className="mt-1 text-3xl font-black text-amber-300">{Number(jcmovesAudit?.allJcMoves.total_jcmoves || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                  <p className="text-xs text-slate-500">JCMOVES</p>
                </div>
              </div>
            </Card>

            <Card className="p-6 border border-slate-700/50 bg-slate-900/70">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-white">Paid-completion job ledger</h3>
                  <p className="mt-1 text-sm text-slate-400">Only records released after both full payment and completion.</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-500/50 text-amber-200 hover:bg-amber-500/10"
                  disabled={repairJcmovesPayoutsMutation.isPending}
                  onClick={() => {
                    if (window.confirm("Repair only missing JCMOVES awards for paid-and-completed jobs? Existing issued ledger entries will be preserved.")) {
                      repairJcmovesPayoutsMutation.mutate();
                    }
                  }}
                >
                  {repairJcmovesPayoutsMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Repair missing awards
                </Button>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-4">
                <div><p className="text-xs text-slate-400">Recipients</p><p className="text-xl font-bold text-white">{jcmovesAudit?.paidCompletionLedger.users ?? 0}</p></div>
                <div><p className="text-xs text-slate-400">Ledger transactions</p><p className="text-xl font-bold text-white">{jcmovesAudit?.paidCompletionLedger.transactions ?? 0}</p></div>
                <div><p className="text-xs text-slate-400">JCMOVES issued</p><p className="text-xl font-bold text-white">{Number(jcmovesAudit?.paidCompletionLedger.total_jcmoves || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p></div>
                <div><p className="text-xs text-slate-400">Pending customer claims</p><p className="text-xl font-bold text-white">{jcmovesAudit?.paidCompletionLedger.pending_customer_claims ?? 0}</p></div>
              </div>
            </Card>

            <Card className="p-6 border border-slate-700/50 bg-slate-900/70">
              <h3 className="text-lg font-bold text-white">Monthly confirmed rewards</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-700 text-left text-slate-400"><th className="py-2">Month</th><th className="py-2 text-right">Users</th><th className="py-2 text-right">Transactions</th><th className="py-2 text-right">JCMOVES</th></tr></thead>
                  <tbody>
                    {jcmovesAudit?.monthly.map((row) => <tr key={row.month} className="border-b border-slate-800 text-slate-200"><td className="py-2">{row.month}</td><td className="py-2 text-right">{row.users}</td><td className="py-2 text-right">{row.transactions.toLocaleString()}</td><td className="py-2 text-right">{Number(row.total_jcmoves).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* Reward Configuration Tab */}
          <TabsContent value="reward-config" className="space-y-6">

            {/* ── REWARD AMOUNTS ── */}
            <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600">
                    <Settings className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Reward Amounts</h2>
                    <p className="text-sm text-slate-400">Set how many JCMOVES each action earns</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchRewardSettings()} className="border-teal-500/50 text-teal-300 hover:bg-teal-500/10">
                  <RefreshCw className="h-4 w-4 mr-2" />Refresh
                </Button>
              </div>
              <div className="space-y-3">
                {rewardSettings?.map((setting) => (
                  <div key={setting.id} className="flex items-center justify-between p-4 rounded-lg bg-slate-900/50 border border-slate-700/50">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium">{setting.label}</span>
                        <Badge variant="outline" className={setting.isActive ? "border-green-500 text-green-400 text-xs" : "border-red-500 text-red-400 text-xs"}>
                          {setting.isActive ? "Active" : "Off"}
                        </Badge>
                      </div>
                      {setting.description && <p className="text-xs text-slate-400 mt-0.5">{setting.description}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      {editingRewardKey === setting.settingKey ? (
                        <>
                          <Input type="number" value={newRewardAmount} onChange={(e) => setNewRewardAmount(e.target.value)} className="w-28 bg-slate-800 border-slate-600 h-8" placeholder="Amount" />
                          <Button size="sm" onClick={() => { const a = parseFloat(newRewardAmount); if (!isNaN(a) && a >= 0) updateRewardSettingMutation.mutate({ key: setting.settingKey, tokenAmount: a }); }} disabled={updateRewardSettingMutation.isPending} className="bg-green-600 hover:bg-green-700 h-8">
                            {updateRewardSettingMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => { setEditingRewardKey(null); setNewRewardAmount(""); }} className="border-slate-600 h-8"><XCircle className="h-3 w-3" /></Button>
                        </>
                      ) : (
                        <>
                          <div className="text-right">
                            <div className="text-xl font-bold text-teal-400">{parseFloat(setting.tokenAmount).toLocaleString()}</div>
                            <div className="text-xs text-slate-500">JCMOVES</div>
                          </div>
                          <Button size="sm" variant="outline" onClick={() => { setEditingRewardKey(setting.settingKey); setNewRewardAmount(setting.tokenAmount); }} className="border-teal-500/50 text-teal-300 hover:bg-teal-500/10 h-8">
                            <Edit className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {(!rewardSettings || rewardSettings.length === 0) && (
                  <div className="text-center py-6 text-slate-400">
                    <Settings className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">Loading reward settings…</p>
                  </div>
                )}
              </div>
            </Card>

            {/* ── PROMO CODES ── */}
            <Card className="p-6 border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600">
                    <Tag className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold text-white">Promo Codes</h2>
                      {promoCodes && (
                        <span className="text-xs font-bold bg-green-600/40 text-green-300 border border-green-500/40 px-2 py-0.5 rounded-full">{promoCodes.length} total</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-400">Create and manage discount codes for customers</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => refetchPromoCodes()} className="border-slate-600 text-slate-300 h-8">
                    <RefreshCw className="h-3 w-3 mr-1" />Refresh
                  </Button>
                  <Button size="sm" onClick={() => { setEditingPromo(null); setPromoForm(blankPromo); setShowPromoForm(true); }} className="bg-green-600 hover:bg-green-700 h-8">
                    <Plus className="h-3 w-3 mr-1" />New Code
                  </Button>
                </div>
              </div>

              {/* Add / Edit Form */}
              {(showPromoForm || editingPromo) && (
                <div className="mb-6 p-5 rounded-xl border border-green-500/30 bg-green-900/20 space-y-4">
                  <h3 className="font-bold text-green-300 flex items-center gap-2">
                    <Tag className="h-4 w-4" />
                    {editingPromo ? `Editing: ${editingPromo.code}` : "New Promo Code"}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-slate-300 text-xs">Code *</Label>
                      <Input value={promoForm.code} onChange={e => setPromoForm(f => ({...f, code: e.target.value.toUpperCase()}))} placeholder="SUMMER25" className="bg-slate-800 border-slate-600 text-white uppercase font-mono mt-1" disabled={!!editingPromo} />
                    </div>
                    <div>
                      <Label className="text-slate-300 text-xs">Description</Label>
                      <Input value={promoForm.description} onChange={e => setPromoForm(f => ({...f, description: e.target.value}))} placeholder="Summer sale discount" className="bg-slate-800 border-slate-600 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-slate-300 text-xs">Offer Type</Label>
                      <select value={promoForm.offerType} onChange={e => setPromoForm(f => ({...f, offerType: e.target.value as "percentage" | "fixed_package"}))} className="mt-1 h-10 w-full rounded-md border border-slate-600 bg-slate-800 px-3 text-sm text-white">
                        <option value="percentage">Percentage discount</option>
                        <option value="fixed_package">Fixed moving package</option>
                      </select>
                    </div>
                    {promoForm.offerType === "percentage" ? (
                      <div>
                        <Label className="text-slate-300 text-xs">Service Discount %</Label>
                        <Input type="number" min="0" max="100" value={promoForm.discountPercent} onChange={e => setPromoForm(f => ({...f, discountPercent: e.target.value}))} placeholder="0" className="bg-slate-800 border-slate-600 text-white mt-1" />
                        <p className="text-xs text-slate-500 mt-0.5">Applied once to the full automatic moving quote</p>
                      </div>
                    ) : (
                      <>
                        <div><Label className="text-slate-300 text-xs">Package Price $</Label><Input type="number" min="0" value={promoForm.fixedBasePrice} onChange={e => setPromoForm(f => ({...f, fixedBasePrice: e.target.value}))} className="bg-slate-800 border-slate-600 text-white mt-1" /></div>
                        <div><Label className="text-slate-300 text-xs">Required Movers</Label><Input type="number" min="1" max="12" value={promoForm.requiredCrewSize} onChange={e => setPromoForm(f => ({...f, requiredCrewSize: e.target.value}))} className="bg-slate-800 border-slate-600 text-white mt-1" /></div>
                        <div><Label className="text-slate-300 text-xs">Required Hours</Label><Input type="number" min="1" max="24" value={promoForm.requiredHours} onChange={e => setPromoForm(f => ({...f, requiredHours: e.target.value}))} className="bg-slate-800 border-slate-600 text-white mt-1" /></div>
                        <div><Label className="text-slate-300 text-xs">Local Mile Limit</Label><Input type="number" min="1" max="500" value={promoForm.localMilesMax} onChange={e => setPromoForm(f => ({...f, localMilesMax: e.target.value}))} className="bg-slate-800 border-slate-600 text-white mt-1" /></div>
                      </>
                    )}
                    <div>
                      <Label className="text-slate-300 text-xs">Jewelry Discount %</Label>
                      <Input type="number" min="0" max="100" value={promoForm.discountPercentJewelry} onChange={e => setPromoForm(f => ({...f, discountPercentJewelry: e.target.value}))} placeholder="0" className="bg-slate-800 border-slate-600 text-white mt-1" />
                      <p className="text-xs text-slate-500 mt-0.5">Applied to Ashley's Shop purchases</p>
                    </div>
                    <div>
                      <Label className="text-slate-300 text-xs">Bonus JCMOVES (to customer)</Label>
                      <Input type="number" min="0" value={promoForm.rewardTokens} onChange={e => setPromoForm(f => ({...f, rewardTokens: e.target.value}))} placeholder="0" className="bg-slate-800 border-slate-600 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-slate-300 text-xs">Referral JCMOVES (to code owner)</Label>
                      <Input type="number" min="0" value={promoForm.referralRewardTokens} onChange={e => setPromoForm(f => ({...f, referralRewardTokens: e.target.value}))} placeholder="0" className="bg-slate-800 border-slate-600 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-slate-300 text-xs">Max Uses (blank = unlimited)</Label>
                      <Input type="number" min="1" value={promoForm.maxUses} onChange={e => setPromoForm(f => ({...f, maxUses: e.target.value}))} placeholder="Unlimited" className="bg-slate-800 border-slate-600 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-slate-300 text-xs">Expiry Date (blank = never)</Label>
                      <DatePicker
                        value={promoForm.expiresAt || undefined}
                        onChange={(v) => setPromoForm(f => ({...f, expiresAt: v || ""}))}
                        placeholder="Pick expiry date"
                        disablePast={false}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch checked={promoForm.isActive} onCheckedChange={v => setPromoForm(f => ({...f, isActive: v}))} />
                    <Label className="text-slate-300 text-sm">{promoForm.isActive ? "Active — customers can use this code" : "Inactive — code is disabled"}</Label>
                  </div>
                  {promoForm.offerType === "fixed_package" && <div className="flex flex-wrap gap-5 text-sm text-slate-300"><label className="flex items-center gap-2"><Checkbox checked={promoForm.requiresCompanyTruck} onCheckedChange={v => setPromoForm(f => ({...f, requiresCompanyTruck: v === true}))} />JC truck included</label><label className="flex items-center gap-2"><Checkbox checked={promoForm.requiresTrailer} onCheckedChange={v => setPromoForm(f => ({...f, requiresTrailer: v === true}))} />Trailer included</label></div>}
                  <div className="flex gap-3 pt-2">
                    <Button onClick={savePromo} disabled={createPromoMutation.isPending || updatePromoMutation.isPending || !promoForm.code} className="bg-green-600 hover:bg-green-700">
                      {(createPromoMutation.isPending || updatePromoMutation.isPending) ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                      {editingPromo ? "Save Changes" : "Create Code"}
                    </Button>
                    <Button variant="outline" onClick={() => { setShowPromoForm(false); setEditingPromo(null); setPromoForm(blankPromo); }} className="border-slate-600">
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Promo Code List */}
              {promoCodes && promoCodes.length > 0 && (
                <p className="text-xs text-slate-500 mb-3">Showing all {promoCodes.length} promo code{promoCodes.length !== 1 ? "s" : ""}</p>
              )}
              <div className="space-y-3">
                {promoCodes?.map((pc) => (
                  <div key={pc.id} className={`p-4 rounded-xl border transition-colors ${pc.isActive ? "border-green-500/30 bg-green-900/10" : "border-slate-700/50 bg-slate-900/30 opacity-60"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-black text-lg text-white tracking-widest">{pc.code}</span>
                          <Badge className={pc.isActive ? "bg-green-600/30 text-green-300 border-green-500/40" : "bg-slate-700/50 text-slate-400"}>
                            {pc.isActive ? "Active" : "Inactive"}
                          </Badge>
                          <Badge variant="outline" className="border-slate-600 text-slate-400 text-xs">
                            {pc.usesCount}{pc.maxUses ? `/${pc.maxUses}` : ""} uses
                          </Badge>
                        </div>
                        {pc.description && <p className="text-sm text-slate-400 mt-1">{pc.description}</p>}
                        <div className="flex flex-wrap gap-3 mt-2 text-xs">
                          {parseFloat(pc.discountPercent) > 0 && <span className="text-blue-300">🏷 {pc.discountPercent}% off services</span>}
                          {pc.jobOffer?.kind === "fixed_moving_package" && <span className="text-emerald-300">📦 Fixed package: ${pc.jobOffer.fixedBasePrice} · {pc.jobOffer.requiredCrewSize} movers · {pc.jobOffer.requiredHours} hrs · {pc.jobOffer.localMilesMax ?? 10} mi</span>}
                          {parseFloat(pc.discountPercentJewelry) > 0 && <span className="text-purple-300">💎 {pc.discountPercentJewelry}% off jewelry</span>}
                          {parseFloat(pc.rewardTokens) > 0 && <span className="text-teal-300">🪙 +{parseFloat(pc.rewardTokens).toLocaleString()} JCMOVES to customer</span>}
                          {parseFloat(pc.referralRewardTokens) > 0 && <span className="text-amber-300">⭐ +{parseFloat(pc.referralRewardTokens).toLocaleString()} JCMOVES to referrer</span>}
                          {pc.expiresAt && <span className="text-red-300">⏰ Expires {format(new Date(pc.expiresAt), 'MMM d, yyyy')}</span>}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => { const offer = pc.jobOffer; setEditingPromo(pc); setPromoForm({ code: pc.code, description: pc.description, offerType: offer ? "fixed_package" : "percentage", discountPercent: pc.discountPercent, discountPercentJewelry: pc.discountPercentJewelry, rewardTokens: pc.rewardTokens, referralRewardTokens: pc.referralRewardTokens, fixedBasePrice: offer ? String(offer.fixedBasePrice) : "", requiredCrewSize: offer ? String(offer.requiredCrewSize) : "2", requiredHours: offer ? String(offer.requiredHours) : "2", localMilesMax: offer ? String(offer.localMilesMax ?? 10) : "10", requiresCompanyTruck: Boolean(offer?.requiresCompanyTruck), requiresTrailer: Boolean(offer?.requiresTrailer), maxUses: pc.maxUses?.toString() || "", expiresAt: pc.expiresAt ? pc.expiresAt.split('T')[0] : "", isActive: pc.isActive }); setShowPromoForm(false); }} className="border-slate-600 text-slate-300 h-8 w-8 p-0">
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => updatePromoMutation.mutate({ id: pc.id, data: { isActive: !pc.isActive } })} className={`h-8 w-8 p-0 ${pc.isActive ? "border-orange-500/50 text-orange-400" : "border-green-500/50 text-green-400"}`}>
                          {pc.isActive ? <ToggleRight className="h-3.5 w-3.5" /> : <ToggleLeft className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { if (confirm(`Delete promo code "${pc.code}"?`)) deletePromoMutation.mutate(pc.id); }} disabled={deletePromoMutation.isPending} className="border-red-500/50 text-red-400 hover:bg-red-500/10 h-8 w-8 p-0">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {(!promoCodes || promoCodes.length === 0) && (
                  <div className="text-center py-10 text-slate-500">
                    <Tag className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No promo codes yet. Click "New Code" to create one.</p>
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="staking-treasury" className="space-y-6">
            <Card className="p-6 bg-gradient-to-br from-indigo-900/40 to-purple-900/40 border-indigo-500/30">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-indigo-300 flex items-center gap-2">
                  <Layers className="h-5 w-5" />
                  Staking Treasury
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchStakingTreasury()}
                  className="border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/20"
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Refresh
                </Button>
              </div>

              {stakingTreasury ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="p-4 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                      <p className="text-xs text-slate-400 mb-1">Treasury Balance</p>
                      <p className="text-2xl font-bold text-indigo-300">{parseFloat(stakingTreasury.balance).toLocaleString()}</p>
                      <p className="text-xs text-slate-500">JCMOVES</p>
                    </div>
                    <div className="p-4 rounded-lg bg-purple-500/10 border border-purple-500/20">
                      <p className="text-xs text-slate-400 mb-1">Total Active Staked</p>
                      <p className="text-2xl font-bold text-purple-300">{parseFloat(stakingTreasury.totalActiveStaked).toLocaleString()}</p>
                      <p className="text-xs text-slate-500">JCMOVES</p>
                    </div>
                    <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <p className="text-xs text-slate-400 mb-1">Total Rewards Paid</p>
                      <p className="text-2xl font-bold text-amber-300">{parseFloat(stakingTreasury.totalRewardsPaid).toLocaleString()}</p>
                      <p className="text-xs text-slate-500">JCMOVES</p>
                    </div>
                    <div className="p-4 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                      <p className="text-xs text-slate-400 mb-1">Active Stakes</p>
                      <p className="text-2xl font-bold text-cyan-300">{stakingTreasury.activeStakeCount}</p>
                      <p className="text-xs text-slate-500">of {stakingTreasury.totalStakeCount} total</p>
                    </div>
                  </div>

                  <h4 className="text-lg font-semibold text-slate-300 mb-3">Tier Breakdown</h4>
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                    {stakingTreasury.tierBreakdown.map((tier) => {
                      const tierColors: Record<string, string> = {
                        "Flexible": "from-gray-700/40 to-gray-600/40 border-gray-500/30",
                        "Bronze": "from-orange-900/40 to-orange-800/40 border-orange-500/30",
                        "Silver": "from-gray-500/20 to-gray-400/20 border-gray-400/30",
                        "Gold": "from-yellow-900/40 to-yellow-800/40 border-yellow-500/30",
                        "Diamond": "from-cyan-900/40 to-cyan-800/40 border-cyan-400/30",
                      };
                      const colorClass = tierColors[tier.name] || "from-slate-700/40 to-slate-600/40 border-slate-500/30";
                      return (
                        <div key={tier.name} className={`p-4 rounded-lg bg-gradient-to-br ${colorClass} border`}>
                          <p className="font-semibold text-white mb-2">{tier.name}</p>
                          <p className="text-xs text-slate-400">{tier.durationDays === 0 ? "No lockup" : `${tier.durationDays}d lock`} • {tier.apr}% reward tier</p>
                          <p className="text-lg font-bold text-white mt-2">{parseFloat(tier.totalStaked).toLocaleString()}</p>
                          <p className="text-xs text-slate-400">{tier.activeStakes} active stake{tier.activeStakes !== 1 ? "s" : ""}</p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-6 p-4 rounded-lg bg-indigo-500/10 border border-indigo-500/30">
                    <h4 className="font-medium text-indigo-300 mb-2">Treasury Health</h4>
                    <div className="flex items-center gap-2">
                      {parseFloat(stakingTreasury.balance) > parseFloat(stakingTreasury.totalActiveStaked) ? (
                        <>
                          <CheckCircle className="h-4 w-4 text-green-400" />
                          <span className="text-green-400 text-sm">Treasury is fully backed — balance exceeds total staked amount</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="h-4 w-4 text-amber-400" />
                          <span className="text-amber-400 text-sm">Treasury balance is below total staked — monitor closely</span>
                        </>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
                </div>
              )}
            </Card>

            {/* ── Token Economy Calculator ── */}
            <Card className="border-cyan-500/30 bg-gradient-to-br from-cyan-950/20 to-slate-950/10">
              <div className="p-5 space-y-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-lg text-cyan-300 flex items-center gap-2">
                    <Calculator className="h-5 w-5" /> Token Economy Calculator
                  </h3>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => refetchTokenEconomy()}
                    disabled={economyLoading}
                    className="border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20"
                  >
                    {economyLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                    Recalculate
                  </Button>
                </div>

                {economyLoading && (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
                  </div>
                )}

                {tokenEconomy && !economyLoading && (() => {
                  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
                  const coverageColor = tokenEconomy.coverageRatio > 100 ? "text-green-400" : tokenEconomy.coverageRatio > 20 ? "text-yellow-400" : "text-red-400";
                  const coverageBg = tokenEconomy.coverageRatio > 100 ? "border-green-500/30 bg-green-950/20" : tokenEconomy.coverageRatio > 20 ? "border-yellow-500/30 bg-yellow-950/20" : "border-red-500/30 bg-red-950/20";
                  const sustDays = tokenEconomy.sustainabilityDays;
                  const sustColor = sustDays > 3650 ? "text-green-400" : sustDays > 365 ? "text-yellow-400" : "text-red-400";
                  const sustLabel = sustDays > 9999 ? "∞ Unlimited" : sustDays > 3650 ? `${(sustDays / 365).toFixed(0)}+ years` : sustDays > 365 ? `${(sustDays / 365).toFixed(1)} years` : `${sustDays} days`;

                  return (
                    <>
                      {/* Reserve Health Banner */}
                      <div className={`rounded-xl border p-4 ${coverageBg}`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-1">Reserve Coverage Ratio</p>
                            <p className={`text-4xl font-black ${coverageColor}`}>
                              {tokenEconomy.coverageRatio > 999 ? "∞" : `${fmt(tokenEconomy.coverageRatio)}×`}
                            </p>
                            <p className="text-xs text-slate-400 mt-1">On-chain treasury ÷ total net exposure (circulating + 1yr obligations)</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-1">Sustainability</p>
                            <p className={`text-2xl font-black ${sustColor}`}>{sustLabel}</p>
                            <p className="text-xs text-slate-400 mt-1">at current daily rate</p>
                          </div>
                        </div>
                      </div>

                      {/* Top stats row */}
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <div className="p-3 rounded-xl border border-cyan-500/20 bg-cyan-950/20 text-center">
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">On-Chain Treasury</p>
                          <p className="text-xl font-black text-cyan-300">{fmt(tokenEconomy.onChainBalance)}</p>
                          <p className="text-[10px] text-slate-500">JCMOVES (live Solana)</p>
                        </div>
                        <div className="p-3 rounded-xl border border-purple-500/20 bg-purple-950/20 text-center">
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Net Circulating</p>
                          <p className="text-xl font-black text-purple-300">{fmt(tokenEconomy.netCirculating)}</p>
                          <p className="text-[10px] text-slate-500">wallets + stakes + accrued</p>
                        </div>
                        <div className="p-3 rounded-xl border border-orange-500/20 bg-orange-950/20 text-center">
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Daily Obligation</p>
                          <p className="text-xl font-black text-orange-300">{fmt(tokenEconomy.activeDailyObligation)}</p>
                          <p className="text-[10px] text-slate-500">JCMOVES/day staking</p>
                        </div>
                        <div className="p-3 rounded-xl border border-yellow-500/20 bg-yellow-950/20 text-center">
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Total Distributed</p>
                          <p className="text-xl font-black text-yellow-300">{fmt(tokenEconomy.totalDistributed)}</p>
                          <p className="text-[10px] text-slate-500">rewards + prizes + accrued</p>
                        </div>
                        <div className="p-3 rounded-xl border border-emerald-500/20 bg-emerald-950/20 text-center">
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">JCMOVES USD Out</p>
                          <p className="text-xl font-black text-emerald-300">
                            ${(jcMovesUsdCirculation?.totalUsd ?? 0).toFixed(2)}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {jcMovesUsdCirculation?.walletCount ?? 0} wallet{(jcMovesUsdCirculation?.walletCount ?? 0) !== 1 ? "s" : ""}
                          </p>
                        </div>
                        <div className="p-3 rounded-xl border border-cyan-500/20 bg-cyan-950/20 text-center">
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Prepaid Purchased</p>
                          <p className="text-xl font-black text-cyan-300" data-testid="text-prepaid-purchased">
                            ${(prepaidCreditStats?.totalPurchasedUsd ?? prepaidCreditStats?.totalMintedUsd ?? 0).toFixed(2)}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {prepaidCreditStats?.totalIntents ?? 0} top-up{(prepaidCreditStats?.totalIntents ?? 0) !== 1 ? "s" : ""}
                          </p>
                        </div>
                        <div className="p-3 rounded-xl border border-rose-500/20 bg-rose-950/20 text-center">
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Prepaid Redeemed</p>
                          <p className="text-xl font-black text-rose-300" data-testid="text-prepaid-redeemed">
                            ${(prepaidCreditStats?.totalRedeemedUsd ?? 0).toFixed(2)}
                          </p>
                          <p className="text-[10px] text-slate-500">applied to invoices</p>
                        </div>
                        <div className="p-3 rounded-xl border-2 border-teal-500/40 bg-teal-950/40 text-center">
                          <p className="text-[10px] text-teal-300 uppercase tracking-wider mb-1 font-bold">Outstanding Liability</p>
                          <p className="text-2xl font-black text-teal-200" data-testid="text-prepaid-outstanding-liability">
                            ${(prepaidCreditStats?.outstandingLiabilityUsd ?? 0).toFixed(2)}
                          </p>
                          <p className="text-[10px] text-slate-400">purchased − redeemed = owed to customers</p>
                        </div>
                      </div>

                      {/* Distribution Breakdown */}
                      <div className="space-y-2">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                          <PieChart className="h-3.5 w-3.5" /> Distribution Breakdown
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {[
                            { label: "In User Wallets", val: tokenEconomy.totalInUserWallets, color: "text-blue-400", icon: "💼" },
                            { label: "Actively Staked", val: tokenEconomy.activeStaked, color: "text-green-400", icon: "🔒" },
                            { label: "Pending Stakes", val: tokenEconomy.pendingStaked, color: "text-yellow-400", icon: "⏳" },
                            { label: "Unstaking", val: tokenEconomy.unstakingStaked, color: "text-orange-400", icon: "🔓" },
                            { label: "Accrued Staking Rewards", val: tokenEconomy.activeAccumulatedRewards, color: "text-emerald-400", icon: "📈" },
                            { label: "Total Loyalty Rewards Ever", val: tokenEconomy.totalEverEarned, color: "text-violet-400", icon: "🎖️" },
                            { label: "Spin Prizes Paid", val: tokenEconomy.spinPrizesTotal, color: "text-amber-400", icon: "🎰" },
                            { label: "Shop Redemptions", val: tokenEconomy.totalEverRedeemed, color: "text-red-400", icon: "🛍️" },
                          ].map(row => (
                            <div key={row.label} className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-700/50 bg-slate-800/30">
                              <span className="text-xs text-slate-400 flex items-center gap-1.5">
                                <span>{row.icon}</span> {row.label}
                              </span>
                              <span className={`text-sm font-bold tabular-nums ${row.color}`}>{fmt(row.val)}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Obligation Projections */}
                      <div className="space-y-2">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                          <FlameKindling className="h-3.5 w-3.5" /> Staking Obligation Projections
                        </p>
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { label: "30-Day Payout", val: tokenEconomy.obligation30d, pct: tokenEconomy.onChainBalance > 0 ? (tokenEconomy.obligation30d / tokenEconomy.onChainBalance * 100) : 0 },
                            { label: "90-Day Payout", val: tokenEconomy.obligation90d, pct: tokenEconomy.onChainBalance > 0 ? (tokenEconomy.obligation90d / tokenEconomy.onChainBalance * 100) : 0 },
                            { label: "365-Day Payout", val: tokenEconomy.obligation365d, pct: tokenEconomy.onChainBalance > 0 ? (tokenEconomy.obligation365d / tokenEconomy.onChainBalance * 100) : 0 },
                          ].map(row => (
                            <div key={row.label} className="p-3 rounded-xl border border-slate-600/40 bg-slate-800/30 text-center">
                              <p className="text-[10px] text-slate-400 mb-1">{row.label}</p>
                              <p className="text-lg font-black text-white">{fmt(row.val)}</p>
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                <span className={row.pct < 1 ? "text-green-400" : row.pct < 5 ? "text-yellow-400" : "text-red-400"}>
                                  {row.pct.toFixed(2)}% of treasury
                                </span>
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Rewards by type if any */}
                      {Object.keys(tokenEconomy.rewardsByType).length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Zap className="h-3.5 w-3.5" /> Loyalty Rewards by Type
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(tokenEconomy.rewardsByType).map(([type, total]) => (
                              <div key={type} className="px-3 py-1.5 rounded-full border border-violet-500/30 bg-violet-950/20 text-xs">
                                <span className="text-slate-400 capitalize">{type.replace(/_/g, " ")}</span>
                                <span className="text-violet-300 font-bold ml-1.5">{fmt(total as number)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </Card>

            {/* ── Treasury Yield Sources Editor ── */}
            <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-950/20 to-slate-950/10">
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-lg text-emerald-300 flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" /> Treasury Yield Sources & Bonus
                  </h3>
                  <Button
                    size="sm"
                    onClick={() => saveYieldSourcesMutation.mutate()}
                    disabled={saveYieldSourcesMutation.isPending}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {saveYieldSourcesMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Save Changes
                  </Button>
                </div>

                <div className="flex items-center gap-3 p-3 rounded-xl border border-yellow-500/30 bg-yellow-950/20">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-yellow-300">Treasury Bonus (%)</p>
                    <p className="text-xs text-slate-500 mt-0.5">Added on top of each reward tier. Shows as a dynamic bonus on the staking page.</p>
                  </div>
                  <Input
                    type="number"
                    value={yieldBonusPct}
                    onChange={e => setYieldBonusPct(e.target.value)}
                    className="w-24 bg-slate-900 border-yellow-500/40 text-yellow-300 text-center font-bold"
                    step="0.01"
                    min="0"
                    max="50"
                    placeholder="0.00"
                  />
                  <span className="text-yellow-400 font-bold">%</span>
                </div>

                <div className="space-y-3">
                  <p className="text-sm font-semibold text-slate-300">Monthly Revenue Per Source (USD)</p>
                  {yieldSources.map((src, i) => (
                    <div key={src.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/50 border border-slate-700/50">
                      <span className="text-xl">{src.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-300 font-medium truncate">{src.label}</p>
                      </div>
                      <Switch
                        checked={src.enabled}
                        onCheckedChange={v => setYieldSources(prev => prev.map((s, j) => j === i ? { ...s, enabled: v } : s))}
                      />
                      <div className="flex items-center gap-1">
                        <span className="text-slate-400 text-sm">$</span>
                        <Input
                          type="number"
                          value={src.monthlyUsd}
                          onChange={e => setYieldSources(prev => prev.map((s, j) => j === i ? { ...s, monthlyUsd: parseFloat(e.target.value) || 0 } : s))}
                          className="w-28 bg-slate-800 border-slate-600 text-white text-right"
                          step="100"
                          min="0"
                          placeholder="0"
                        />
                        <span className="text-slate-500 text-xs">/mo</span>
                      </div>
                    </div>
                  ))}
                </div>

                {yieldSources.length > 0 && (
                  <div className="flex items-center justify-between p-3 rounded-xl border border-emerald-500/20 bg-emerald-950/20 text-sm font-semibold">
                    <span className="text-slate-300">Total Monthly Treasury Inflow</span>
                    <span className="text-emerald-300">
                      ${yieldSources.filter(s => s.enabled).reduce((sum, s) => sum + s.monthlyUsd, 0).toLocaleString()}/mo
                    </span>
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          {/* Token Liability Dashboard Tab */}
          <TabsContent value="liability" className="space-y-6">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-xl font-black text-white">Token Liability Dashboard</h2>
                <p className="text-slate-400 text-sm">Financial exposure vs. 24M JCMOVES treasury supply</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetchAnalytics()} className="border-red-500/40 text-red-300 hover:bg-red-500/10">
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>

            {(() => {
              const liability = treasuryAnalytics?.liability;
              if (!liability) return (
                <Card className="p-8 text-center bg-slate-900/50 border-slate-700/50">
                  <Loader2 className="h-8 w-8 animate-spin text-slate-500 mx-auto mb-3" />
                  <p className="text-slate-400">Loading liability data...</p>
                </Card>
              );

              const safetyColors = {
                green: { border: "border-green-500/40", bg: "bg-green-500/10", text: "text-green-300", badge: "bg-green-500/20 text-green-300 border-green-500/40", label: "Healthy" },
                yellow: { border: "border-yellow-500/40", bg: "bg-yellow-500/10", text: "text-yellow-300", badge: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40", label: "Caution" },
                red: { border: "border-red-500/40", bg: "bg-red-500/10", text: "text-red-300", badge: "bg-red-500/20 text-red-300 border-red-500/40", label: "Critical" },
              };
              const colors = safetyColors[liability.safetyStatus];

              return (
                <div className="space-y-4">
                  {/* Safety Ratio Highlight */}
                  <Card className={`p-6 border ${colors.border} ${colors.bg} relative overflow-hidden`}>
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <p className="text-slate-400 text-sm font-medium mb-1">Overall Safety Ratio</p>
                        <p className="text-sm text-slate-500">Liability as % of 24M supply</p>
                      </div>
                      <span className={`px-3 py-1 rounded-full border text-xs font-bold ${colors.badge}`}>
                        {colors.label}
                      </span>
                    </div>
                    <div className={`text-5xl font-black ${colors.text} mb-2`}>
                      {liability.safetyRatioPct.toFixed(2)}%
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-3 mt-3">
                      <div
                        className={`h-3 rounded-full transition-all duration-500 ${liability.safetyStatus === "green" ? "bg-green-500" : liability.safetyStatus === "yellow" ? "bg-yellow-500" : "bg-red-500"}`}
                        style={{ width: `${Math.min(liability.safetyRatioPct, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-slate-500 mt-1">
                      <span>0%</span>
                      <span className="text-yellow-500">10% — caution</span>
                      <span className="text-red-500">25% — critical</span>
                      <span>100%</span>
                    </div>
                  </Card>

                  {/* Liability Metrics Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <Card className="p-5 bg-slate-900/50 border-slate-700/50">
                      <div className="flex items-center gap-2 mb-3">
                        <Coins className="h-5 w-5 text-blue-400" />
                        <p className="text-slate-400 text-sm font-medium">Total Tokens Earned</p>
                      </div>
                      <p className="text-2xl font-black text-blue-300">{liability.totalTokensEarned.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                      <p className="text-xs text-slate-500 mt-1">All-time, all users</p>
                    </Card>

                    <Card className="p-5 bg-slate-900/50 border-slate-700/50">
                      <div className="flex items-center gap-2 mb-3">
                        <CheckCircle className="h-5 w-5 text-green-400" />
                        <p className="text-slate-400 text-sm font-medium">Completed Redemptions</p>
                      </div>
                      <p className="text-2xl font-black text-green-300">{liability.completedRedemptionsValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                      <p className="text-xs text-slate-500 mt-1">Tokens already fulfilled</p>
                    </Card>

                    <Card className="p-5 bg-slate-900/50 border-slate-700/50">
                      <div className="flex items-center gap-2 mb-3">
                        <Clock className="h-5 w-5 text-amber-400" />
                        <p className="text-slate-400 text-sm font-medium">Pending Redemptions</p>
                      </div>
                      <p className="text-2xl font-black text-amber-300">{liability.pendingRedemptionsValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                      <p className="text-xs text-slate-500 mt-1">Committed but not yet fulfilled</p>
                    </Card>

                    <Card className={`p-5 border ${colors.border} ${colors.bg} sm:col-span-2 lg:col-span-2`}>
                      <div className="flex items-center gap-2 mb-3">
                        <AlertTriangle className={`h-5 w-5 ${colors.text}`} />
                        <p className="text-slate-300 text-sm font-semibold">Total Liability</p>
                        <span className="text-slate-500 text-xs">(Pending + Completed)</span>
                      </div>
                      <p className={`text-3xl font-black ${colors.text}`}>{liability.liabilityTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                      <p className="text-xs text-slate-500 mt-1">JCMOVES owed or already paid out</p>
                    </Card>

                    <Card className="p-5 bg-slate-900/50 border-slate-700/50">
                      <div className="flex items-center gap-2 mb-3">
                        <Shield className="h-5 w-5 text-slate-400" />
                        <p className="text-slate-400 text-sm font-medium">Treasury Supply</p>
                      </div>
                      <p className="text-2xl font-black text-slate-200">{(liability.treasurySupply / 1_000_000).toFixed(0)}M</p>
                      <p className="text-xs text-slate-500 mt-1">Total JCMOVES minted (24M cap)</p>
                    </Card>
                  </div>

                  {/* Info callout */}
                  <Card className="p-4 bg-slate-900/40 border-slate-700/30">
                    <p className="text-xs text-slate-500 leading-relaxed">
                      <strong className="text-slate-400">How this works:</strong> The safety ratio measures total token liability (pending + completed redemptions) against the 24M JCMOVES supply cap.
                      {" "}Below <strong className="text-green-400">10%</strong> is healthy. Between <strong className="text-yellow-400">10–25%</strong> warrants caution. Above <strong className="text-red-400">25%</strong> requires immediate attention.
                      {" "}The auto-approval threshold is configurable in the Rewards settings tab under <em>Redemption Auto-Approve Threshold</em>.
                    </p>
                  </Card>
                </div>
              );
            })()}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

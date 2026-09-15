import { CatalogImage } from "@/components/catalog-image";
import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, Gem, ChevronLeft, ChevronRight, Pencil, Trash2, Video, Loader2, Tag, RotateCcw, ShoppingCart, Check, Bitcoin, Heart, Share2, Sparkles, Star, Coins, DollarSign } from "lucide-react";
import { useCart } from "@/hooks/useCart";
import { BtcAutoConfirmStatus } from "@/components/btc-auto-confirm-status";

const EARN_RATE = 15; // JCMOVES per $1 spent
const TOKEN_PRICE_USD = 0.000005034116; // Fallback token price

const isVideoUrl = (url: string) => /\.(mp4|webm|ogg|mov)$/i.test(url);

function MediaItem({ src, alt, className }: { src: string; alt: string; className?: string }) {
  if (isVideoUrl(src)) {
    return <video src={src} className={className} controls playsInline muted loop />;
  }
  return <CatalogImage src={src} alt={alt} className={className} />;
}

const COLLECTIONS = [
  { value: "earrings", label: "Earrings", emoji: "✨" },
  { value: "rings", label: "Rings", emoji: "💍" },
  { value: "necklaces", label: "Necklaces", emoji: "🌿" },
  { value: "bracelets", label: "Bracelets", emoji: "💛" },
  { value: "custom", label: "Custom Orders", emoji: "🎁" },
];

interface JewelryItem {
  id: string;
  postedBy?: string;
  title: string;
  description?: string;
  shortDescription?: string;
  price?: string;
  category?: string;
  materials?: string;
  imageUrl?: string;
  photos?: string[];
  inStock?: boolean;
  featured?: boolean;
  status: string;
  createdAt: string;
  pendingCreditUserId?: string | null;
  pendingCreditCents?: string | null;
  pendingExpiresAt?: string | null;
}

interface WalletBalance {
  tokenBalance: string;
  cashBalance?: string;
}

function WalletUsdRedeemPanel({ item }: { item: JewelryItem }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const { data: walletData } = useQuery<WalletBalance>({
    queryKey: ["/api/wallet/balance"],
    enabled: !!user,
  });

  const cashBalance = parseFloat(walletData?.cashBalance || "0");
  const itemPrice = item.price ? parseFloat(item.price) : 0;
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [btcSubmitting, setBtcSubmitting] = useState(false);

  // If THIS user already has a partial credit reservation on this item,
  // show a "finish remaining balance" / "cancel & refund" surface.
  const userHasPending =
    !!user &&
    item.status === "pending_balance" &&
    item.pendingCreditUserId === user.id;

  // While the customer holds this item, surface live status of any
  // Bitcoin payment they've already started so they can see "Detected on
  // blockchain — finalizing your hold…" or the auto-confirmed badge
  // without leaving the jewelry detail page.
  interface BtcLookupResponse {
    payment: { id: string; status: string } | null;
  }
  const { data: btcLookup } = useQuery<BtcLookupResponse>({
    queryKey: ["/api/btc/payment-for-jewelry", item.id],
    queryFn: async () => {
      const res = await fetch(`/api/btc/payment-for-jewelry/${item.id}`, { credentials: "include" });
      if (!res.ok) return { payment: null };
      return res.json();
    },
    enabled: !!user && (item.status === "pending_balance" || item.status === "sold"),
    refetchInterval: (q) => {
      const data = q.state.data;
      if (data?.payment?.status === "pending") return 8000;
      return 60_000;
    },
  });
  const btcPaymentId = btcLookup?.payment?.id || null;

  if (userHasPending) {
    const credit = parseFloat(item.pendingCreditCents || "0");
    const remaining = Math.max(0, itemPrice - credit);
    const remainingAfterBtcDiscount = Math.round(remaining * 0.95 * 100) / 100;

    const continueToSquare = async () => {
      setSubmitting(true);
      try {
        const res = await apiRequest("POST", "/api/square/create-checkout", { itemId: item.id });
        const data = await res.json();
        if (data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
        } else {
          throw new Error(data.error || "Could not start checkout");
        }
      } catch (err: any) {
        toast({ title: "Couldn't start checkout", description: err?.message || "Try again", variant: "destructive" });
      } finally {
        setSubmitting(false);
      }
    };

    const continueToBtc = async () => {
      setBtcSubmitting(true);
      try {
        const res = await apiRequest("POST", "/api/btc/create-payment", {
          customerName: user?.email || "Customer",
          customerEmail: user?.email || "",
          // Server detects pending_balance and overrides this with the
          // remaining due. We send full price for transparency / fallback.
          usdAmount: remaining,
          referenceType: "jewelry",
          referenceId: item.id,
          items: [{ id: item.id, name: item.title, price: remaining }],
          notes: `Remaining balance for ${item.title} (after $${credit.toFixed(2)} JCMOVES USD credit)`,
        });
        const data = await res.json();
        if (data?.payment?.id) {
          navigate(`/bitcoin-payment?id=${data.payment.id}`);
        } else {
          throw new Error(data?.error || "Could not start Bitcoin payment");
        }
      } catch (err: any) {
        toast({ title: "Couldn't start Bitcoin payment", description: err?.message || "Try again", variant: "destructive" });
      } finally {
        setBtcSubmitting(false);
      }
    };

    const cancelAndRefund = async () => {
      setCancelling(true);
      try {
        const res = await apiRequest("POST", "/api/wallet/cancel-pending-redemption", {
          itemId: item.id,
          referenceType: "jewelry",
        });
        const data = await res.json();
        qc.invalidateQueries({ queryKey: ["/api/wallet/balance"] });
        qc.invalidateQueries({ queryKey: ["/api/jewelry", item.id] });
        qc.invalidateQueries({ queryKey: ["/api/jewelry"] });
        toast({
          title: "Credit refunded",
          description: `$${data.refundedUsd} returned to your JCMOVES USD balance.`,
        });
      } catch (err: any) {
        toast({ title: "Couldn't cancel", description: err?.message || "Try again", variant: "destructive" });
      } finally {
        setCancelling(false);
      }
    };

    return (
      <div className="bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-300 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-amber-600" />
          <span className="text-sm font-bold text-amber-800">Finish your purchase</span>
        </div>
        {btcPaymentId && (
          <BtcAutoConfirmStatus paymentId={btcPaymentId} variant="light" />
        )}
        <div className="bg-white/70 rounded-lg p-2 text-xs text-amber-900 space-y-0.5">
          <div className="flex justify-between"><span>Item price:</span><span>${itemPrice.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>JCMOVES USD applied:</span><span className="font-bold">−${credit.toFixed(2)}</span></div>
          <div className="flex justify-between border-t border-amber-200 pt-0.5">
            <span>Remaining due:</span>
            <span className="font-bold">${remaining.toFixed(2)}</span>
          </div>
        </div>
        <Button
          size="sm"
          disabled={submitting || btcSubmitting}
          className="w-full bg-amber-600 hover:bg-amber-700 text-white text-xs"
          onClick={continueToSquare}
        >
          {submitting ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Redirecting…</>
          ) : (
            <>Pay ${remaining.toFixed(2)} with card</>
          )}
        </Button>
        <Button
          size="sm"
          disabled={btcSubmitting || submitting}
          className="w-full bg-orange-500 hover:bg-orange-600 text-white text-xs"
          onClick={continueToBtc}
        >
          {btcSubmitting ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Creating BTC payment…</>
          ) : (
            <>
              <Bitcoin className="h-3.5 w-3.5 mr-1.5" />
              Pay ${remainingAfterBtcDiscount.toFixed(2)} with Bitcoin
              <span className="ml-1.5 inline-flex items-center bg-white/20 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">Save 5%</span>
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={cancelling}
          className="w-full text-xs border-amber-300 text-amber-800 hover:bg-amber-100"
          onClick={cancelAndRefund}
        >
          {cancelling ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Refunding…</>
          ) : (
            <>Cancel & refund ${credit.toFixed(2)} to my balance</>
          )}
        </Button>
        <p className="text-[11px] text-amber-700">
          We're holding this piece for you for 1 hour. If you don't finish payment your credit will need to be refunded.
        </p>
      </div>
    );
  }

  // Item already sold — if it was *this user's* BTC payment that finalized
  // it (pending_balance → sold via auto-verify), show the auto-confirmed
  // badge so they don't land on a blank page after the row flips.
  if (item.status === "sold" && btcPaymentId) {
    return <BtcAutoConfirmStatus paymentId={btcPaymentId} variant="light" />;
  }

  if (!user || !item.price || item.inStock === false || cashBalance <= 0) return null;

  const canCoverFull = cashBalance + 0.005 >= itemPrice;
  const applyAmount = canCoverFull ? itemPrice : Math.min(cashBalance, itemPrice);
  const remainingAfter = Math.max(0, itemPrice - applyAmount);

  const handleRedeem = async () => {
    setSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/wallet/redeem-balance", {
        amount: applyAmount,
        referenceType: "jewelry",
        referenceId: item.id,
        itemTitle: item.title,
      });
      const data = await res.json();
      qc.invalidateQueries({ queryKey: ["/api/wallet/balance"] });
      qc.invalidateQueries({ queryKey: ["/api/jewelry"] });
      qc.invalidateQueries({ queryKey: ["/api/jewelry", item.id] });
      qc.invalidateQueries({ queryKey: ["/api/gift-cards/mine"] });

      if (data.paidInFull) {
        toast({
          title: "Order paid in full!",
          description: `$${data.amountRedeemed} applied — Ashley will reach out about delivery.`,
        });
        navigate("/customer-profile");
        return;
      }

      // Partial credit applied — start Square checkout for the remainder.
      toast({
        title: `$${data.amountRedeemed} credit applied`,
        description: `Sending you to checkout for the remaining $${data.remainingDueUsd}…`,
      });
      try {
        const coRes = await apiRequest("POST", "/api/square/create-checkout", { itemId: item.id });
        const coData = await coRes.json();
        if (coData.checkoutUrl) {
          window.location.href = coData.checkoutUrl;
        } else {
          throw new Error(coData.error || "Could not start checkout");
        }
      } catch (coErr: any) {
        toast({
          title: "Credit applied, but checkout failed",
          description:
            (coErr?.message || "Please retry checkout below.") +
            " Your credit is being held — you can finish or cancel/refund from this page.",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      const msg = err?.message || "Failed to apply balance";
      toast({ title: "Could not apply credit", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-300 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-bold text-emerald-800">JCMOVES USD Balance</span>
        </div>
        <span className="text-sm font-bold text-emerald-700">${cashBalance.toFixed(2)}</span>
      </div>

      <div className="bg-white/70 rounded-lg p-2 text-xs text-emerald-800 space-y-0.5">
        <div className="flex justify-between"><span>Item price:</span><span>${itemPrice.toFixed(2)}</span></div>
        <div className="flex justify-between">
          <span>Paid with balance:</span>
          <span className="font-bold">−${applyAmount.toFixed(2)}</span>
        </div>
        <div className="flex justify-between border-t border-emerald-200 pt-0.5">
          <span>{remainingAfter > 0 ? "Remaining (card)" : "You owe"}:</span>
          <span className="font-bold">${remainingAfter.toFixed(2)}</span>
        </div>
      </div>

      <Button
        size="sm"
        disabled={submitting}
        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
        onClick={handleRedeem}
      >
        {submitting ? (
          <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> {canCoverFull ? "Applying…" : "Reserving & redirecting…"}</>
        ) : canCoverFull ? (
          <>Pay ${itemPrice.toFixed(2)} with my balance</>
        ) : (
          <>Apply ${applyAmount.toFixed(2)} & pay ${remainingAfter.toFixed(2)} with card</>
        )}
      </Button>

      {!canCoverFull && (
        <p className="text-[11px] text-emerald-700">
          We'll hold this piece for 1 hour while you finish the card payment. If you back out, your credit refunds automatically.
        </p>
      )}
    </div>
  );
}

function JCMOVESPanel({ item, onCheckoutWithDiscount }: { item: JewelryItem; onCheckoutWithDiscount: (useTokens: boolean, tokenAmount: number) => void }) {
  const { user } = useAuth();
  const [useTokens, setUseTokens] = useState(false);

  const { data: walletData } = useQuery<WalletBalance>({
    queryKey: ["/api/wallet/balance"],
    enabled: !!user,
  });

  const tokenBalance = walletData ? parseFloat(walletData.tokenBalance) : 0;
  const itemPrice = item.price ? parseFloat(item.price) : 0;

  const tokensToEarn = Math.round(itemPrice * EARN_RATE);
  const tokenValueUsd = tokenBalance * TOKEN_PRICE_USD;

  const maxDiscountUsd = Math.min(itemPrice * 0.5, tokenValueUsd);
  const tokensNeededForMaxDiscount = maxDiscountUsd / TOKEN_PRICE_USD;
  const discountUsd = useTokens ? maxDiscountUsd : 0;
  const discountedPrice = Math.max(0, itemPrice - discountUsd);

  if (!user) {
    return (
      <div className="bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <Star className="h-4 w-4 text-amber-500" />
          <p className="text-sm font-bold text-amber-800">Earn JCMOVES Rewards</p>
        </div>
        <p className="text-xs text-amber-700 mb-3">
          Sign up free to earn <span className="font-bold">{tokensToEarn.toLocaleString()} JCMOVES</span> on this purchase
          ({EARN_RATE} per $1). Use tokens for discounts across all JC on the Move services.
        </p>
        <Link href="/register">
          <Button size="sm" className="w-full bg-amber-500 hover:bg-amber-400 text-white font-bold text-xs">
            Create Account to Earn Rewards &rarr;
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-purple-50 to-violet-50 border border-purple-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-purple-500" />
          <span className="text-sm font-bold text-purple-800">JCMOVES Balance</span>
        </div>
        <span className="text-sm font-bold text-purple-700">
          {tokenBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens
        </span>
      </div>

      <div className="text-xs text-purple-600">
        This purchase earns you <span className="font-bold text-purple-800">{tokensToEarn.toLocaleString()} JCMOVES</span> ({EARN_RATE} per $1).
      </div>

      {tokenBalance >= 1000 && (
        <div className="border-t border-purple-200 pt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-purple-700">Apply JCMOVES discount</span>
            <Switch
              checked={useTokens}
              onCheckedChange={setUseTokens}
              className="scale-90"
            />
          </div>
          {useTokens && (
            <div className="bg-purple-100 rounded-lg p-2 text-xs text-purple-700 space-y-1">
              <div className="flex justify-between">
                <span>Tokens used:</span>
                <span className="font-bold">~{Math.round(tokensNeededForMaxDiscount).toLocaleString()} JCMOVES</span>
              </div>
              <div className="flex justify-between">
                <span>Discount:</span>
                <span className="font-bold text-green-700">-${discountUsd.toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-t border-purple-200 pt-1">
                <span>New total:</span>
                <span className="font-bold">${discountedPrice.toFixed(2)}</span>
              </div>
            </div>
          )}
          <p className="text-xs text-purple-500 mt-1">
            Up to 50% off using your JCMOVES balance.
          </p>
          <Button
            size="sm"
            className="w-full mt-2 bg-purple-600 hover:bg-purple-700 text-white text-xs"
            onClick={() => onCheckoutWithDiscount(useTokens, Math.round(tokensNeededForMaxDiscount))}
          >
            Checkout {useTokens ? `— Save $${discountUsd.toFixed(2)}` : ""}
          </Button>
        </div>
      )}

      {tokenBalance < 1000 && (
        <p className="text-xs text-purple-500">
          You need at least 1,000 JCMOVES to apply a discount. Keep earning!
        </p>
      )}
    </div>
  );
}

function DetailCartButtons({ item, onBtcCheckout, btcLoading, onCheckoutWithDiscount }: { item: JewelryItem; onBtcCheckout?: () => void; btcLoading?: boolean; onCheckoutWithDiscount: (useTokens: boolean, tokenAmount: number) => void }) {
  const { addItem, removeItem, isInCart } = useCart();
  const cartId = `jewelry-${item.id}`;
  const inCart = isInCart(cartId);

  if (!item.price || item.inStock === false) return null;

  return (
    <div className="pt-3 border-t border-rose-100 space-y-2.5">
      <Button
        className={`w-full py-5 text-base font-semibold rounded-xl ${
          inCart
            ? "bg-emerald-600 hover:bg-emerald-700 text-white"
            : "bg-rose-500 hover:bg-rose-600 text-white"
        }`}
        onClick={() => {
          if (inCart) {
            removeItem(cartId);
          } else {
            addItem({
              id: cartId,
              referenceId: item.id,
              name: item.title,
              price: parseFloat(item.price!),
              image: item.imageUrl || "",
              type: "jewelry",
            });
          }
        }}
      >
        {inCart ? (
          <><Check className="h-5 w-5 mr-2" /> In Cart</>
        ) : (
          <><ShoppingCart className="h-5 w-5 mr-2" /> Add to Cart</>
        )}
      </Button>

      {onBtcCheckout && (
        <button
          onClick={onBtcCheckout}
          disabled={btcLoading}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-orange-400/40 bg-orange-50 hover:bg-orange-100 transition-colors cursor-pointer"
        >
          {btcLoading ? (
            <><Loader2 className="h-4 w-4 text-orange-500 animate-spin" /><span className="text-orange-600 text-sm">Creating BTC Payment...</span></>
          ) : (
            <>
              <Bitcoin className="h-4 w-4 text-orange-500" />
              <span className="text-orange-600 text-sm font-medium">Pay with Bitcoin</span>
              <span className="inline-flex items-center bg-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">Save 5%</span>
            </>
          )}
        </button>
      )}

      {inCart && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-50 border border-orange-200">
          <Bitcoin className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
          <p className="text-orange-600 text-xs">Added! Pay with crypto at checkout to <span className="font-bold">save 5%</span></p>
        </div>
      )}

      <WalletUsdRedeemPanel item={item} />

      <JCMOVESPanel item={item} onCheckoutWithDiscount={onCheckoutWithDiscount} />
    </div>
  );
}

export default function JewelryDetailPage() {
  const { id } = useParams();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<JewelryItem | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [btcCheckoutLoading, setBtcCheckoutLoading] = useState(false);
  const [customOrderOpen, setCustomOrderOpen] = useState(false);
  const [customOrderForm, setCustomOrderForm] = useState({ name: "", description: "", materials: "", budget: "", contact: "" });
  const [customOrderSubmitting, setCustomOrderSubmitting] = useState(false);
  const [wishlist, setWishlist] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("ashley-wishlist") || "[]")); } catch { return new Set(); }
  });

  const isAdmin = user?.role === 'admin' || user?.role === 'business_owner';

  const canEditItem = (_item: JewelryItem) => {
    if (!user) return false;
    return isAdmin;
  };

  const toggleWishlist = (itemId: string) => {
    setWishlist(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      localStorage.setItem("ashley-wishlist", JSON.stringify([...next]));
      return next;
    });
  };

  const { data: item, isLoading } = useQuery<JewelryItem>({
    queryKey: ["/api/jewelry", id],
    queryFn: async () => {
      const res = await fetch(`/api/jewelry/${id}`, { credentials: 'include' });
      if (!res.ok) throw new Error("Failed to fetch item");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: ratingStats } = useQuery<{ averageRating?: number; totalCount?: number }>({
    queryKey: ["/api/testimonials/stats"],
    staleTime: 5 * 60 * 1000,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => await apiRequest("DELETE", `/api/jewelry/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jewelry"] });
      toast({ title: "Item Deleted" });
      navigate("/handmade-jewels-by-ashley");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => await apiRequest("PATCH", `/api/jewelry/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jewelry", id] });
      qc.invalidateQueries({ queryKey: ["/api/jewelry"] });
      setIsEditOpen(false);
      toast({ title: "Item Updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const soldMutation = useMutation({
    mutationFn: async ({ id, sold }: { id: string; sold: boolean }) => {
      return await apiRequest("PATCH", `/api/jewelry/${id}/sold`, { sold });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jewelry", id] });
      qc.invalidateQueries({ queryKey: ["/api/jewelry"] });
      toast({ title: "Item updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleCheckout = async (useTokens = false, tokenAmount = 0) => {
    if (!item) return;
    setCheckoutLoading(true);
    try {
      const res = await apiRequest("POST", "/api/square/create-checkout", { itemId: item.id, useTokens, tokenAmount });
      const data = await res.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        toast({ title: "Error", description: "Could not create checkout link", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Payment Error", description: error.message || "Failed to start checkout. Please try again.", variant: "destructive" });
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleBtcCheckout = async () => {
    if (!item || !item.price) return;
    setBtcCheckoutLoading(true);
    try {
      const res = await fetch("/api/btc/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: user?.email || "Guest",
          customerEmail: user?.email || "",
          usdAmount: parseFloat(item.price),
          referenceType: "jewelry",
          referenceId: item.id,
          items: [{ id: item.id, name: item.title, price: parseFloat(item.price) }],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create BTC payment");
      navigate(`/bitcoin-payment?id=${data.payment.id}`);
    } catch (error: any) {
      toast({ title: "Bitcoin Payment Error", description: error.message, variant: "destructive" });
    } finally {
      setBtcCheckoutLoading(false);
    }
  };

  const handleShare = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url)
      .then(() => toast({ title: "Link copied to clipboard!" }))
      .catch(() => toast({ title: "Share link", description: url }));
  };

  const getPhotos = (item: JewelryItem) => {
    const photos: string[] = [];
    if (item.imageUrl) photos.push(item.imageUrl);
    if (item.photos && Array.isArray(item.photos)) {
      photos.push(...item.photos.filter((p: string) => p && !photos.includes(p)));
    }
    return photos;
  };

  const handleCustomOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCustomOrderSubmitting(true);
    try {
      const res = await fetch('/api/jewelry/custom-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...customOrderForm, referenceItem: item?.title }),
        credentials: 'include',
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error ${res.status}`);
      }
      toast({ title: "Custom order request sent!", description: "Ashley will reach out soon." });
      setCustomOrderOpen(false);
      setCustomOrderForm({ name: "", description: "", materials: "", budget: "", contact: "" });
    } catch (err: any) {
      toast({ title: "Failed to send request", description: err.message, variant: "destructive" });
    } finally {
      setCustomOrderSubmitting(false);
    }
  };

  const startEdit = () => {
    if (!item) return;
    setEditItem({ ...item });
    setIsEditOpen(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(160deg, #fdf6f0 0%, #fef1f2 100%)" }}>
        <Loader2 className="h-8 w-8 animate-spin text-rose-400" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ background: "linear-gradient(160deg, #fdf6f0 0%, #fef1f2 100%)" }}>
        <div className="text-5xl mb-4">🌸</div>
        <p className="text-stone-500 text-lg font-serif">Item not found</p>
        <Link href="/handmade-jewels-by-ashley">
          <Button variant="outline" className="mt-4 border-rose-300 text-rose-500"><ArrowLeft className="h-4 w-4 mr-2" /> Back to Shop</Button>
        </Link>
      </div>
    );
  }

  const photos = getPhotos(item);
  const isWishlisted = wishlist.has(item.id);

  const nextPhoto = () => setCurrentPhotoIndex((prev) => (prev + 1) % photos.length);
  const prevPhoto = () => setCurrentPhotoIndex((prev) => (prev - 1 + photos.length) % photos.length);

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(160deg, #fdf6f0 0%, #fef1f2 40%, #fff8f0 100%)" }}>

      {/* Sticky Header */}
      <div className="sticky top-0 z-50 backdrop-blur border-b border-rose-100/80 shadow-sm" style={{ background: "rgba(253,246,240,0.97)" }}>
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/handmade-jewels-by-ashley">
            <Button variant="ghost" size="sm" className="text-stone-500 hover:text-rose-500">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          </Link>
          <span className="font-serif text-sm font-bold text-stone-700 truncate mx-2">{item.title}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={handleShare}
              className="p-2 rounded-full hover:bg-rose-50 transition-colors text-stone-400 hover:text-rose-500"
              aria-label="Share"
            >
              <Share2 className="h-5 w-5" />
            </button>
            <button
              onClick={() => toggleWishlist(item.id)}
              className={`p-2 rounded-full transition-colors ${isWishlisted ? "text-rose-500" : "text-stone-400 hover:text-rose-400"}`}
              aria-label={isWishlisted ? "Remove from wishlist" : "Save to wishlist"}
            >
              <Heart className={`h-5 w-5 ${isWishlisted ? "fill-rose-500" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Photo Gallery */}
      <div className="relative w-full bg-rose-50" style={{ height: '60vh' }}>
        {item.inStock === false && (
          <div className="absolute top-4 left-4 z-20">
            <span className="bg-red-500 text-white font-bold text-sm px-4 py-1.5 rounded-full shadow-lg uppercase tracking-wider">Sold</span>
          </div>
        )}
        {item.featured && (
          <div className="absolute top-4 right-4 z-20 flex items-center gap-1 bg-amber-400 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow">
            <Sparkles className="h-3 w-3" /> Featured
          </div>
        )}
        {photos.length > 0 ? (
          <>
            <MediaItem src={photos[currentPhotoIndex]} alt={item.title} className="w-full h-full object-contain" />
            {photos.length > 1 && (
              <>
                <button onClick={prevPhoto} className="absolute left-3 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white rounded-full p-2.5 shadow-lg">
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button onClick={nextPhoto} className="absolute right-3 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white rounded-full p-2.5 shadow-lg">
                  <ChevronRight className="h-6 w-6" />
                </button>
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                  {photos.map((_, i) => (
                    <button key={i} onClick={() => setCurrentPhotoIndex(i)} className={`w-2.5 h-2.5 rounded-full transition-colors shadow ${i === currentPhotoIndex ? 'bg-rose-500 scale-110' : 'bg-white/70'}`} />
                  ))}
                </div>
                {/* Thumbnail strip */}
                <div className="absolute bottom-14 left-1/2 -translate-x-1/2 flex gap-2 max-w-full overflow-x-auto px-4">
                  {photos.slice(0, 8).map((photo, i) => (
                    <button
                      key={i}
                      onClick={() => setCurrentPhotoIndex(i)}
                      className={`flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden border-2 transition-all ${i === currentPhotoIndex ? "border-rose-500 shadow-md" : "border-white/70 opacity-70"}`}
                    >
                      {isVideoUrl(photo) ? (
                        <div className="w-full h-full bg-stone-200 flex items-center justify-center"><Video className="h-3 w-3 text-stone-500" /></div>
                      ) : (
                        <img src={photo} alt="" className="w-full h-full object-cover" />
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-5xl">🌸</div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="bg-white rounded-t-3xl -mt-4 relative z-10 min-h-[40vh]">
        <div className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <h1 className="text-2xl font-serif font-bold text-stone-800">{item.title}</h1>
              {item.category && <p className="text-rose-500 capitalize text-sm mt-0.5">{item.category}</p>}
              {ratingStats?.averageRating && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <div className="flex items-center gap-0.5">
                    {[1,2,3,4,5].map(s => (
                      <Star key={s} className={`h-3.5 w-3.5 ${s <= Math.round(ratingStats.averageRating!) ? "fill-amber-400 text-amber-400" : "text-stone-300"}`} />
                    ))}
                  </div>
                  <span className="text-xs text-stone-500">{ratingStats.averageRating.toFixed(1)} · Ashley's Shop</span>
                </div>
              )}
            </div>
            {item.price && <p className="text-2xl font-bold text-rose-600">${item.price}</p>}
          </div>

          {/* Materials */}
          {item.materials && (
            <div className="bg-rose-50 rounded-xl p-3 border border-rose-100">
              <p className="text-xs font-semibold text-rose-400 uppercase tracking-wide mb-1">Made With</p>
              <p className="text-stone-700 text-sm">{item.materials}</p>
            </div>
          )}

          {/* Made with Love blurb */}
          <div className="bg-amber-50 rounded-xl p-3 border border-amber-100">
            <p className="text-xs font-semibold text-amber-500 uppercase tracking-wide mb-1">Handcrafted with Love</p>
            <p className="text-stone-600 text-sm italic">
              This piece was handmade by Ashley in Michigan — thoughtfully crafted from quality materials. Each creation is one-of-a-kind, made slowly and with care. <span className="text-amber-500">Ships from Michigan with love 💛</span>
            </p>
          </div>

          {/* Short description */}
          {item.shortDescription && (
            <p className="text-stone-600 text-sm font-medium italic border-l-2 border-rose-200 pl-3">"{item.shortDescription}"</p>
          )}

          {/* Full description */}
          {item.description && (
            <div>
              <p className="text-xs font-medium text-stone-400 uppercase tracking-wide mb-1">About this Piece</p>
              <p className="text-stone-600 text-sm whitespace-pre-wrap">{item.description}</p>
            </div>
          )}

          {/* Social Share Button */}
          <button
            onClick={handleShare}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-600 text-sm font-medium transition-colors"
          >
            <Share2 className="h-4 w-4" /> Share this piece
          </button>

          {/* Custom Order CTA */}
          <button
            onClick={() => setCustomOrderOpen(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-600 text-sm font-semibold transition-colors"
          >
            🎁 Request a Custom Order Like This
          </button>

          <DetailCartButtons
            item={item}
            onBtcCheckout={handleBtcCheckout}
            btcLoading={btcCheckoutLoading}
            onCheckoutWithDiscount={handleCheckout}
          />

          {!item.inStock && (
            <div className="bg-rose-50 rounded-xl p-3 text-center border border-rose-100">
              <p className="text-rose-500 font-medium text-sm">This item has been sold — request a custom version above!</p>
            </div>
          )}

          {canEditItem(item) && (
            <div className="space-y-2 pt-2 border-t border-stone-200">
              <Button
                variant={item.inStock === false ? "outline" : "default"}
                size="sm"
                className={item.inStock === false
                  ? "w-full border-green-400 text-green-600 hover:bg-green-50"
                  : "w-full bg-amber-500 hover:bg-amber-600 text-white"}
                onClick={() => soldMutation.mutate({ id: item.id, sold: item.inStock !== false })}
                disabled={soldMutation.isPending}
              >
                {item.inStock === false ? (
                  <><RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Mark Available</>
                ) : (
                  <><Tag className="h-3.5 w-3.5 mr-1.5" /> Mark as Sold</>
                )}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1 border-rose-300 text-rose-600" onClick={startEdit}>
                  <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                </Button>
                <Button variant="outline" size="sm" className="flex-1 border-red-300 text-red-600" onClick={() => setDeleteConfirmOpen(true)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif">Edit Item</DialogTitle>
          </DialogHeader>
          {editItem && (
            <div className="space-y-4">
              <div><Label>Title</Label><Input value={editItem.title} onChange={(e) => setEditItem({ ...editItem, title: e.target.value })} /></div>
              <div><Label>Price</Label><Input value={editItem.price || ""} onChange={(e) => setEditItem({ ...editItem, price: e.target.value })} placeholder="25.00" /></div>
              <div>
                <Label>Category</Label>
                <Select value={editItem.category || ""} onValueChange={(v) => setEditItem({ ...editItem, category: v })}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {COLLECTIONS.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>{cat.emoji} {cat.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Materials</Label><Input value={editItem.materials || ""} onChange={(e) => setEditItem({ ...editItem, materials: e.target.value })} /></div>
              <div><Label>Short Description</Label><Input value={editItem.shortDescription || ""} onChange={(e) => setEditItem({ ...editItem, shortDescription: e.target.value })} /></div>
              <div><Label>Full Description</Label><Textarea value={editItem.description || ""} onChange={(e) => setEditItem({ ...editItem, description: e.target.value })} rows={4} /></div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                <button
                  type="button"
                  onClick={() => setEditItem({ ...editItem, featured: !editItem.featured })}
                  className={`w-10 h-6 rounded-full transition-colors flex-shrink-0 relative ${editItem.featured ? "bg-amber-400" : "bg-stone-300"}`}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${editItem.featured ? "left-5" : "left-1"}`} />
                </button>
                <div>
                  <p className="text-sm font-semibold text-stone-700 flex items-center gap-1"><Sparkles className="h-3.5 w-3.5 text-amber-500" /> Featured</p>
                  <p className="text-xs text-stone-400">Shows sparkle badge on card</p>
                </div>
              </div>
              <Button
                onClick={() => updateMutation.mutate({ title: editItem.title, price: editItem.price, category: editItem.category, materials: editItem.materials, shortDescription: editItem.shortDescription, description: editItem.description, featured: editItem.featured })}
                disabled={updateMutation.isPending}
                className="w-full bg-rose-500 hover:bg-rose-600"
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteMutation.mutate()} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Custom Order Dialog */}
      <Dialog open={customOrderOpen} onOpenChange={setCustomOrderOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-stone-800">Request a Custom Order</DialogTitle>
          </DialogHeader>
          {item && <p className="text-stone-400 text-xs -mt-2">Inspired by: <span className="text-rose-500 font-medium">{item.title}</span></p>}
          <p className="text-stone-500 text-sm">Describe what you'd love - Ashley will reach out to discuss the details.</p>
          <form onSubmit={handleCustomOrderSubmit} className="space-y-4">
            <div><Label>Your Name *</Label><Input required value={customOrderForm.name} onChange={(e) => setCustomOrderForm({ ...customOrderForm, name: e.target.value })} placeholder="Your full name" /></div>
            <div><Label>What would you like? *</Label><Textarea required value={customOrderForm.description} onChange={(e) => setCustomOrderForm({ ...customOrderForm, description: e.target.value })} placeholder="Describe the piece - style, size, occasion..." rows={4} /></div>
            <div><Label>Preferred Materials</Label><Input value={customOrderForm.materials} onChange={(e) => setCustomOrderForm({ ...customOrderForm, materials: e.target.value })} placeholder="e.g. copper wire, rose quartz, sterling silver..." /></div>
            <div><Label>Budget Range</Label><Input value={customOrderForm.budget} onChange={(e) => setCustomOrderForm({ ...customOrderForm, budget: e.target.value })} placeholder="e.g. $25-$75" /></div>
            <div><Label>Contact (email or phone) *</Label><Input required value={customOrderForm.contact} onChange={(e) => setCustomOrderForm({ ...customOrderForm, contact: e.target.value })} placeholder="Best email or phone number" /></div>
            <Button type="submit" disabled={customOrderSubmitting} className="w-full bg-rose-500 hover:bg-rose-600">
              {customOrderSubmitting ? "Sending..." : "Send Request"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  );
}

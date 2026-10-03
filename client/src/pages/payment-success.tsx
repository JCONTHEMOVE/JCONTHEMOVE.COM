import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { CheckCircle, ShoppingBag, ArrowLeft, Truck, Coins, Gem, Star } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { BtcAutoConfirmStatus } from "@/components/btc-auto-confirm-status";
import { useCart } from "@/hooks/useCart";

type LightningPaymentStatus = {
  status: string;
  provider_status: string | null;
  amount_usd: string;
  original_amount_usd: string;
  discount_amount_usd: string;
  reward_value_usd: string;
  bonus_tokens: string;
  retention_percent: string;
  paid_at: string | null;
};

export default function PaymentSuccessPage() {
  const params = new URLSearchParams(window.location.search);
  const type = params.get("type");
  const commerceOrderId = params.get("commerceOrder");
  const isCommerceCrypto = type === "commerce-crypto";
  const isCommerce = (type === "commerce" || isCommerceCrypto) && Boolean(commerceOrderId);
  const isPromo = type === "promo";
  const isBtcLightning = type === "btc-lightning" || type === "btc-lightning-cancelled";
  const lightningCancelled = type === "btc-lightning-cancelled";
  const lightningIntentId = params.get("intent");
  const lightningStatusToken = params.get("token");
  const shopItemsParam = params.get("shopItems");
  const shopItemIds = shopItemsParam ? shopItemsParam.split(",").filter(Boolean) : [];
  const jewelryItemId = params.get("itemId");
  const isJewelryPurchase = !!jewelryItemId && shopItemIds.length === 0;
  const btcPaymentId = params.get("btcPaymentId");

  const { user } = useAuth();
  const { clearCart } = useCart();

  const [shopRewardTotal, setShopRewardTotal] = useState(0);
  const [jewelryReward, setJewelryReward] = useState<{ tokensEarned: number; earnRate: number; purchasePrice: number; itemTitle: string } | null>(null);
  const rewardCalled = useRef(false);
  const { data: lightningPayment } = useQuery<LightningPaymentStatus>({
    queryKey: ["/api/crypto/lightning/job-payment", lightningIntentId, lightningStatusToken, "status"],
    queryFn: async () => {
      const response = await fetch(`/api/crypto/lightning/job-payment/${encodeURIComponent(lightningIntentId || "")}/status?token=${encodeURIComponent(lightningStatusToken || "")}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Payment status is not available yet");
      return response.json();
    },
    enabled: isBtcLightning && Boolean(lightningIntentId) && Boolean(lightningStatusToken),
    refetchInterval: isBtcLightning && !lightningCancelled ? 5000 : false,
  });
  const { data: commerceOrder, isLoading: commerceLoading } = useQuery<any>({
    queryKey: ["/api/commerce/orders", commerceOrderId, "verify"],
    queryFn: async () => {
      const response = await fetch(`/api/commerce/orders/${encodeURIComponent(commerceOrderId || "")}${isCommerceCrypto ? "" : "/verify"}`, {
        method: isCommerceCrypto ? "GET" : "POST",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Payment verification is unavailable");
      return data;
    },
    enabled: isCommerce,
    refetchInterval: (query) => query.state.data?.status === "paid" ? false : 3_000,
    retry: 3,
  });

  useEffect(() => {
    if (commerceOrder?.status === "paid") clearCart();
  }, [clearCart, commerceOrder?.status]);

  useEffect(() => {
    if (shopItemIds.length > 0 && !rewardCalled.current) {
      rewardCalled.current = true;
      apiRequest("POST", "/api/shop/payment-complete", { shopItemIds })
        .then((res) => res.json())
        .then((data: any) => {
          if (data?.results) {
            const total = data.results.reduce((sum: number, r: any) => sum + (r.buyerReward || 0), 0);
            if (total > 0) {
              setShopRewardTotal(total);
              queryClient.invalidateQueries({ queryKey: ["/api/wallet"] });
            }
          }
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (isJewelryPurchase && jewelryItemId && user && !rewardCalled.current) {
      rewardCalled.current = true;
      // Square's hosted checkout appends `orderId` (and `transactionId`,
      // `checkoutLinkId`) to the redirect URL. We forward orderId so the
      // server can verify the remaining-balance payment for any jewelry
      // item that was held in `pending_balance`.
      const orderId = params.get("orderId") || undefined;
      apiRequest("POST", "/api/jewelry/payment-complete", { itemId: jewelryItemId, orderId })
        .then((res) => res.json())
        .then((data: any) => {
          if (data?.tokensEarned > 0) {
            setJewelryReward(data);
            queryClient.invalidateQueries({ queryKey: ["/api/wallet"] });
            queryClient.invalidateQueries({ queryKey: ["/api/wallet/balance"] });
          }
        })
        .catch(() => {});
    }
  }, [user]);

  if (isBtcLightning) {
    const confirmed = lightningPayment?.status === "paid";
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-orange-950 flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-orange-500/30 bg-slate-900 text-slate-100 shadow-2xl">
          <CardContent className="pt-8 pb-6 px-6 text-center space-y-5">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto border-2 ${lightningCancelled ? "bg-slate-800 border-slate-600" : confirmed ? "bg-green-900/50 border-green-500/50" : "bg-orange-900/40 border-orange-500/50"}`}>
              {confirmed ? <CheckCircle className="h-12 w-12 text-green-400" /> : <Coins className="h-12 w-12 text-orange-400" />}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">
                {lightningCancelled ? "Checkout Closed" : confirmed ? "Bitcoin Payment Confirmed" : "Bitcoin Payment Submitted"}
              </h1>
              <p className="text-slate-300 mt-2">
                {lightningCancelled
                  ? "No completed payment has been recorded. You can reopen the checkout link while it remains valid or contact us for a new one."
                  : confirmed
                    ? "Your job payment is recorded and your JCMOVES reward is ready or held for your account."
                    : "BitPay is confirming the payment. This page refreshes automatically; we will also retain the provider audit record."}
              </p>
            </div>
            {lightningPayment && (
              <div className="rounded-xl border border-orange-500/30 bg-orange-950/20 p-4 text-left text-sm space-y-2">
                <div className="flex justify-between"><span className="text-slate-400">Original job value (USD)</span><span>${Number(lightningPayment.original_amount_usd).toFixed(2)}</span></div>
                <div className="flex justify-between text-green-300"><span>Lightning discount</span><span>-${Number(lightningPayment.discount_amount_usd).toFixed(2)}</span></div>
                <div className="flex justify-between font-semibold"><span>Paid with Bitcoin</span><span>${Number(lightningPayment.amount_usd).toFixed(2)}</span></div>
                <div className="flex justify-between text-amber-300"><span>JCMOVES reward</span><span>{Number(lightningPayment.bonus_tokens).toLocaleString()} (${Number(lightningPayment.reward_value_usd).toFixed(2)})</span></div>
                <div className="pt-2 border-t border-orange-500/20 text-xs text-slate-400">Status: {confirmed ? "confirmed" : lightningPayment.provider_status || lightningPayment.status}</div>
              </div>
            )}
            <p className="text-xs text-slate-400">BTC remains BTC in company custody. USD amounts are accounting values only. Customer tips remain separate from this offer.</p>
            <Link href="/">
              <Button className="w-full bg-orange-600 hover:bg-orange-500 text-white">
                <ArrowLeft className="h-4 w-4 mr-2" /> Back to JC ON THE MOVE
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isCommerce) {
    const paid = commerceOrder?.status === "paid";
    const rewardMoves = Number(commerceOrder?.reward_moves || 0);
    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-amber-50 to-emerald-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-2xl border-rose-200">
          <CardContent className="pt-8 pb-6 px-6 text-center space-y-5">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto ${paid ? "bg-emerald-100" : "bg-amber-100"}`}>
              {paid ? <CheckCircle className="h-12 w-12 text-emerald-600" /> : <Coins className="h-12 w-12 text-amber-600 animate-pulse" />}
            </div>
            <div>
              <h1 className="text-2xl font-serif font-bold text-stone-800">{paid ? "Payment verified!" : "Confirming your payment"}</h1>
              <p className="text-stone-600 mt-2">
                {paid
                  ? "Thank you for supporting Handmade Jewels by Ashley — Made with Love. Your order and service add-ons are together in one receipt."
                  : `${isCommerceCrypto ? "The crypto provider" : "Square"} is finishing the payment record. This page checks automatically; please keep it open for a moment.`}
              </p>
            </div>
            {paid && rewardMoves > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-left">
                <p className="font-bold text-amber-900">+{rewardMoves.toLocaleString()} JC Moves</p>
                <p className="text-xs text-amber-800 mt-1">Issued to the signed-in rewards account after verified payment, including any daily-feature bonus.</p>
              </div>
            )}
            <p className="text-xs text-stone-500">Order {commerceOrderId}</p>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/handmade-jewels-by-ashley">
                <Button variant="outline" className="w-full border-rose-300 text-rose-700"><Gem className="h-4 w-4 mr-2" /> Shop</Button>
              </Link>
              <Link href="/">
                <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"><ArrowLeft className="h-4 w-4 mr-2" /> Home</Button>
              </Link>
            </div>
            {commerceLoading && <p className="text-xs text-stone-500">Checking Square…</p>}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isPromo) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-2xl bg-slate-800 border-slate-600">
          <CardContent className="pt-8 pb-6 px-6 text-center space-y-5">
            <div className="w-20 h-20 bg-green-900/50 rounded-full flex items-center justify-center mx-auto border-2 border-green-500/50">
              <CheckCircle className="h-12 w-12 text-green-400" />
            </div>

            <div>
              <h1 className="text-2xl font-bold text-white">Booking Confirmed!</h1>
              <p className="text-slate-300 mt-2">
                Your Half Day Loading/Unloading move has been booked and paid. Check your email for the confirmation details.
              </p>
            </div>

            <div className="bg-yellow-900/30 border border-yellow-500/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Truck className="h-5 w-5 text-yellow-400" />
                <p className="text-sm text-yellow-200 font-semibold">What happens next?</p>
              </div>
              <ul className="text-sm text-yellow-100/80 space-y-1 text-left">
                <li>&#8226; Your move is on our calendar</li>
                <li>&#8226; Our crew of 3 will arrive on your scheduled date</li>
                <li>&#8226; We'll reach out to confirm timing details</li>
              </ul>
            </div>

            <div className="space-y-3 pt-2">
              <Link href="/">
                <Button className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-bold py-5">
                  <ArrowLeft className="h-5 w-5 mr-2" />
                  Back to Home
                </Button>
              </Link>
            </div>

            <p className="text-xs text-slate-400">
              Questions? Call 906-285-9312 or email upmichiganstatemovers@gmail.com
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-400 via-purple-300 to-gray-500 flex items-center justify-center p-4">
      <Card className="max-w-md w-full shadow-2xl">
        <CardContent className="pt-8 pb-6 px-6 text-center space-y-5">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle className="h-12 w-12 text-green-500" />
          </div>

          <div>
            <h1 className="text-2xl font-serif font-bold text-stone-800">Payment Successful!</h1>
            <p className="text-stone-500 mt-2">
              {shopItemIds.length > 0
                ? "Your purchase is complete. Sellers have been notified."
                : "Thank you for your purchase from Handmade Jewels by Ashley — Made with Love. You'll receive a confirmation from Square shortly."}
            </p>
          </div>

          {btcPaymentId && (
            <BtcAutoConfirmStatus paymentId={btcPaymentId} variant="light" />
          )}

          {shopItemIds.length > 0 && shopRewardTotal > 0 && (
            <div className="bg-gradient-to-r from-yellow-50 to-amber-50 border border-yellow-300 rounded-lg p-4 flex items-center gap-3">
              <Coins className="h-6 w-6 text-yellow-500 flex-shrink-0" />
              <div className="text-left">
                <p className="text-sm font-bold text-yellow-800">+{shopRewardTotal} JCMOVES Earned!</p>
                <p className="text-xs text-yellow-700">Tokens credited to your wallet for your purchase.</p>
              </div>
            </div>
          )}

          {isJewelryPurchase && jewelryReward && jewelryReward.tokensEarned > 0 && (
            <div className="bg-gradient-to-r from-purple-50 to-violet-50 border border-purple-300 rounded-lg p-4">
              <div className="flex items-center gap-3 mb-2">
                <Coins className="h-6 w-6 text-purple-500 flex-shrink-0" />
                <div className="text-left">
                  <p className="text-sm font-bold text-purple-800">+{jewelryReward.tokensEarned.toLocaleString()} JCMOVES Earned! 🎉</p>
                  <p className="text-xs text-purple-700">
                    {jewelryReward.earnRate} JCMOVES per $1 × ${jewelryReward.purchasePrice.toFixed(2)}
                  </p>
                </div>
              </div>
              <p className="text-xs text-purple-600 text-left">
                Tokens have been credited to your wallet. Use them on your next jewelry or moving service!
              </p>
            </div>
          )}

          {isJewelryPurchase && !user && (
            <div className="bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-300 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <Star className="h-4 w-4 text-amber-500" />
                <p className="text-sm font-bold text-amber-800">Earn JCMOVES Rewards!</p>
              </div>
              <p className="text-xs text-amber-700 mb-3">
                Create a free account to earn {15} JCMOVES per $1 spent on all future jewelry and moving purchases.
              </p>
              <Link href={`/login?mode=register&redirect=${encodeURIComponent(`/handmade-jewels-by-ashley/${encodeURIComponent(jewelryItemId!)}`)}`}>
                <Button size="sm" className="w-full bg-amber-500 hover:bg-amber-400 text-white font-bold">
                  Create Account &rarr;
                </Button>
              </Link>
            </div>
          )}

          {isJewelryPurchase && user && (
            <div className="bg-purple-50 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Gem className="h-4 w-4 text-purple-500" />
                <p className="text-sm text-purple-700 font-medium">
                  Your handcrafted jewelry will be prepared with care.
                </p>
              </div>
              <p className="text-xs text-purple-600">We'll reach out about shipping details.</p>
            </div>
          )}

          {shopItemIds.length === 0 && !isJewelryPurchase && (
            <div className="bg-purple-50 rounded-lg p-4">
              <p className="text-sm text-purple-700 font-medium">
                Your handcrafted jewelry will be prepared with care. We'll reach out about shipping details.
              </p>
            </div>
          )}

          <div className="space-y-3 pt-2">
            {shopItemIds.length > 0 ? (
              <Link href="/marketplace">
                <Button className="w-full bg-blue-600 hover:bg-blue-700 py-5">
                  <ShoppingBag className="h-5 w-5 mr-2" />
                  Back to Shop
                </Button>
              </Link>
            ) : (
              <>
                {user && (
                  <Link href="/wallet">
                    <Button className="w-full bg-purple-600 hover:bg-purple-700 py-5">
                      <Coins className="h-5 w-5 mr-2" />
                      View My JCMOVES Balance
                    </Button>
                  </Link>
                )}
                <Link href="/handmade-jewels-by-ashley">
                  <Button variant="outline" className="w-full py-5 border-purple-300 text-purple-700 hover:bg-purple-50">
                    <ShoppingBag className="h-5 w-5 mr-2" />
                    Continue Shopping
                  </Button>
                </Link>
              </>
            )}
            <Link href="/">
              <Button variant="outline" className="w-full py-5">
                <ArrowLeft className="h-5 w-5 mr-2" />
                Back to Home
              </Button>
            </Link>
          </div>

          <p className="text-xs text-stone-400">
            Questions? Contact us at upmichiganstatemovers@gmail.com or call 906-285-9312
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

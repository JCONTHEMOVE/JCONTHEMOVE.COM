import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useCart } from "@/hooks/useCart";
import { Link } from "wouter";
import { ArrowLeft, Trash2, ShoppingCart, Percent, Shield, Loader2, CreditCard, Gem, Truck, Plus, MapPin, CalendarDays, Heart, Building2, Trophy, Check, Bitcoin, Tag, X, CheckCircle2, Package, Home, DollarSign, Zap, Sparkles } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";

interface PromoResult {
  valid: boolean;
  code: string;
  description: string;
  discountPercent: number;
  discountPercentService: number;
  discountPercentJewelry: number;
  rewardTokens: number;
}

export default function CartPage() {
  const { toast } = useToast();
  const { items, guestCartId, addItem, removeItem, subtotal: estimatedSubtotal, discount: estimatedDiscount, total: estimatedTotal, hasMultipleItems, isInCart, itemCount, breakdown } = useCart();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBtcSubmitting, setIsBtcSubmitting] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const hasServiceItems = items.some((i) => i.type === "service" || i.type === "promo");
  const hasJewelryItems = items.some((i) => i.type === "jewelry");
  const hasSponsorItems = items.some((i) => i.type === "sponsor");
  const hasShippableItems = items.some((i) => i.type === "shop" || i.type === "jewelry");
  const needsMoveInfo = items.some((item) => (item.type === "service" || item.type === "promo") && item.settlementMode !== "linked_booking");

  // Shipping/pickup selection (for shop & jewelry items)
  const [shippingMethod, setShippingMethod] = useState<'shipping' | 'pickup' | null>(null);
  const [shippingAddress, setShippingAddress] = useState("");
  const SHIPPING_FEE = 10;
  const estimatedShippingFee = hasShippableItems && shippingMethod === 'shipping' ? SHIPPING_FEE : 0;

  // Promo code state
  const [promoInput, setPromoInput] = useState("");
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);
  const [promoError, setPromoError] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoApplied, setPromoApplied] = useState(false);

  const context = hasServiceItems ? 'service' : hasJewelryItems ? 'jewelry' : 'any';

  // Scan account for earned promo codes
  const { data: myCodes = [] } = useQuery<any[]>({
    queryKey: ["/api/promo-codes/my-codes"],
    retry: false,
  });

  const applyMyCode = async (code: string) => {
    setPromoInput(code);
    setPromoLoading(true);
    setPromoError("");
    setPromoResult(null);
    setPromoApplied(false);
    try {
      const res = await fetch("/api/promo-codes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, context }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) {
        setPromoError(data.error || "Code could not be applied");
      } else {
        setPromoResult(data);
        setPromoApplied(true);
        toast({ title: "Code applied!", description: data.description });
      }
    } catch {
      setPromoError("Failed to apply code. Please try again.");
    } finally {
      setPromoLoading(false);
    }
  };

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    fromAddress: "",
    toAddress: "",
    moveDate: "",
    details: "",
    enrollRewards: false,
  });

  useEffect(() => {
    const linkedEmail = items
      .filter((item) => item.settlementMode === "linked_booking")
      .map((item) => item.metadata?.customerEmail)
      .find((email): email is string => typeof email === "string" && email.includes("@"));
    if (linkedEmail) setForm((current) => current.email ? current : { ...current, email: linkedEmail });
  }, [items]);

  const [pricing, setPricing] = useState<any>(null);
  const [pricingError, setPricingError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/commerce/preview", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guestCartId,
            items,
            shippingMethod: shippingMethod || undefined,
            promoCode: promoApplied && promoResult ? promoResult.code : undefined,
            customerEmail: form.email || undefined,
          }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Pricing is unavailable");
        setPricing(data);
        setPricingError("");
      } catch (error: any) {
        if (error.name !== "AbortError") {
          setPricing(null);
          setPricingError(error.message || "Pricing is unavailable");
        }
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [form.email, guestCartId, items, promoApplied, promoResult, shippingMethod]);

  const subtotal = pricing ? pricing.subtotalCents / 100 : estimatedSubtotal;
  const discount = pricing ? pricing.discountCents / 100 : estimatedDiscount;
  const total = pricing ? (pricing.subtotalCents - pricing.discountCents) / 100 : estimatedTotal;
  const shippingFee = pricing ? pricing.shippingCents / 100 : estimatedShippingFee;
  const promoDiscountAmount = 0;
  const finalTotal = pricing ? pricing.dueNowCents / 100 : Math.max(0, total + shippingFee);

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleValidatePromo = async () => {
    if (!promoInput.trim()) return;
    setPromoLoading(true);
    setPromoError("");
    setPromoResult(null);
    setPromoApplied(false);
    try {
      const res = await fetch("/api/promo-codes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: promoInput.trim(), context }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) {
        setPromoError(data.error || "Invalid promo code");
      } else {
        setPromoResult(data);
        setPromoApplied(true);
        toast({
          title: "Promo code applied!",
          description: data.description,
        });
      }
    } catch {
      setPromoError("Failed to validate promo code. Please try again.");
    } finally {
      setPromoLoading(false);
    }
  };

  const handleRemovePromo = () => {
    setPromoResult(null);
    setPromoApplied(false);
    setPromoInput("");
    setPromoError("");
  };

  const handleCheckout = async () => {
    if (items.length === 0) {
      toast({ title: "Your cart is empty", variant: "destructive" });
      return;
    }
    if (!form.firstName || !form.lastName || !form.email || !form.phone) {
      toast({ title: "Please fill in your contact info", variant: "destructive" });
      return;
    }
    if (needsMoveInfo && (!form.fromAddress || !form.moveDate)) {
      toast({ title: "Please fill in your address and preferred date", variant: "destructive" });
      return;
    }
    if (hasShippableItems && !shippingMethod) {
      toast({ title: "Please select shipping or local pickup", variant: "destructive" });
      return;
    }
    if (hasShippableItems && shippingMethod === 'shipping' && !shippingAddress.trim()) {
      toast({ title: "Please enter a shipping address", variant: "destructive" });
      return;
    }
    if (!agreedToTerms) {
      toast({ title: "Please agree to the terms", variant: "destructive" });
      return;
    }
    if (!pricing || pricingError) {
      toast({ title: pricingError || "Waiting for verified pricing", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/commerce/checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          guestCartId,
          items,
          promoCode: promoApplied && promoResult ? promoResult.code : undefined,
          enrollRewards: form.enrollRewards,
          shippingMethod: hasShippableItems ? shippingMethod : undefined,
          shippingAddress: hasShippableItems && shippingMethod === 'shipping' ? shippingAddress : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");

      // Apply promo code (credit tokens to user) if logged in
      if (promoApplied && promoResult && promoResult.rewardTokens > 0) {
        try {
          const applyRes = await fetch("/api/promo-codes/apply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: promoResult.code, context, enrollRewards: form.enrollRewards }),
          });
          const applyData = await applyRes.json();
          if (!applyRes.ok && applyData.error) {
            // Show non-blocking info — checkout still proceeds, discount is already applied
            toast({
              title: "Token reward not credited",
              description: applyData.error,
              variant: "destructive",
            });
          }
        } catch {}
      }

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (error: any) {
      toast({ title: error.message || "Something went wrong", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBtcCheckout = async () => {
    if (items.length === 0) {
      toast({ title: "Your cart is empty", variant: "destructive" });
      return;
    }
    if (!form.firstName || !form.lastName || !form.email || !form.phone) {
      toast({ title: "Please fill in your contact info", variant: "destructive" });
      return;
    }
    if (needsMoveInfo && (!form.fromAddress || !form.moveDate)) {
      toast({ title: "Please fill in your address and preferred date", variant: "destructive" });
      return;
    }
    if (hasShippableItems && !shippingMethod) {
      toast({ title: "Please select shipping or local pickup", variant: "destructive" });
      return;
    }
    if (hasShippableItems && shippingMethod === 'shipping' && !shippingAddress.trim()) {
      toast({ title: "Please enter a shipping address", variant: "destructive" });
      return;
    }
    if (!agreedToTerms) {
      toast({ title: "Please agree to the terms", variant: "destructive" });
      return;
    }

    setIsBtcSubmitting(true);
    try {
      const res = await fetch("/api/commerce/crypto-checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          guestCartId,
          items,
          promoCode: promoApplied && promoResult ? promoResult.code : undefined,
          shippingMethod: hasShippableItems ? shippingMethod : undefined,
          shippingAddress: hasShippableItems && shippingMethod === "shipping" ? shippingAddress : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create payment");
      if (!data.checkoutUrl) throw new Error("Crypto provider did not return a checkout link");
      window.location.href = data.checkoutUrl;
    } catch (error: any) {
      toast({ title: error.message || "Something went wrong", variant: "destructive" });
    } finally {
      setIsBtcSubmitting(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <Card className="max-w-md w-full bg-slate-800 border-slate-600">
          <CardContent className="pt-8 pb-6 text-center space-y-4">
            <ShoppingCart className="h-16 w-16 text-slate-500 mx-auto" />
            <h2 className="text-xl font-bold text-white">Your cart is empty</h2>
            <p className="text-slate-400 text-sm">Browse our services and jewelry to add items.</p>
            <div className="flex gap-3 pt-2">
              <Link href="/" className="flex-1">
                <Button variant="outline" className="w-full border-slate-500 text-slate-300 hover:text-white">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Home
                </Button>
              </Link>
              <Link href="/handmade-jewels-by-ashley" className="flex-1">
                <Button className="w-full bg-purple-600 hover:bg-purple-700">
                  <Gem className="h-4 w-4 mr-2" />
                  Shop Jewls
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <Link href="/">
          <Button variant="ghost" className="text-white hover:bg-white/10 mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Home
          </Button>
        </Link>

        <h1 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
          <ShoppingCart className="h-7 w-7 text-emerald-400" />
          Your Cart
          {discount > 0 && (
            <span className="text-sm bg-emerald-600/30 text-emerald-300 px-3 py-1 rounded-full font-medium">
              {breakdown.totalPct}% Savings!
            </span>
          )}
        </h1>

        {pricingError && (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {pricingError}
          </div>
        )}

        {/* Cart Items */}
        <Card className="bg-slate-800/80 border-slate-600 mb-4">
          <CardContent className="pt-4 space-y-3">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-xl">
                {item.image ? (
                  <img src={item.image} alt={item.name} className="w-16 h-16 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-slate-600 flex items-center justify-center shrink-0">
                    {item.type === "tip" ? <DollarSign className="h-6 w-6 text-amber-400" /> : item.type === "jewelry" ? <Gem className="h-6 w-6 text-purple-400" /> : item.type === "sponsor" ? <Trophy className="h-6 w-6 text-yellow-400" /> : item.type === "shop" ? <ShoppingCart className="h-6 w-6 text-green-400" /> : <Truck className="h-6 w-6 text-blue-400" />}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium text-sm truncate">{item.name}</p>
                  <p className="text-slate-400 text-xs capitalize">{item.type === "tip" ? "Crew Tip" : item.type === "promo" ? "Moving Service" : item.type === "sponsor" ? "Monthly Sponsorship" : item.type === "shop" ? "Community Shop" : item.type}</p>
                  {item.settlementMode === "linked_booking" ? (
                    <p className="text-emerald-400 font-bold">Saved booking · $0 due in this cart</p>
                  ) : (
                    <p className="text-yellow-400 font-bold">${item.price.toFixed(2)}</p>
                  )}
                </div>
                <button onClick={() => removeItem(item.id)} className="text-red-400 hover:text-red-300 p-2">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Price Summary */}
        <Card className="bg-slate-800/80 border-emerald-500/30 mb-4">
          <CardContent className="pt-4 space-y-2 text-sm">
            <div className="flex justify-between text-slate-300">
              <span>Subtotal ({items.length} item{items.length > 1 ? "s" : ""})</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            {breakdown.instantBookDiscount > 0 && (
              <div className="flex justify-between text-emerald-400 font-medium">
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  Instant Book (5% off services)
                </span>
                <span>-${breakdown.instantBookDiscount.toFixed(2)}</span>
              </div>
            )}
            {breakdown.jewelsDiscount > 0 && (
              <div className="flex justify-between text-purple-400 font-medium">
                <span className="flex items-center gap-1">
                  <Gem className="h-3 w-3" />
                  Jewls Bonus ({Math.min(breakdown.jewelsCount, 2) * 5}% off services)
                </span>
                <span>-${breakdown.jewelsDiscount.toFixed(2)}</span>
              </div>
            )}
            {breakdown.multiServiceDiscount > 0 && (
              <div className="flex justify-between text-blue-400 font-medium">
                <span className="flex items-center gap-1">
                  <Package className="h-3 w-3" />
                  Multi-Service Bundle (10% off each job)
                </span>
                <span>-${breakdown.multiServiceDiscount.toFixed(2)}</span>
              </div>
            )}
            {promoApplied && promoResult && promoDiscountAmount > 0 && (
              <div className="flex justify-between text-green-400 font-medium">
                <span className="flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  Promo: {promoResult.code} ({promoResult.discountPercent}% off)
                </span>
                <span>-${promoDiscountAmount.toFixed(2)}</span>
              </div>
            )}
            {promoApplied && promoResult && promoResult.rewardTokens > 0 && (
              <div className="flex justify-between text-orange-400 font-medium text-xs">
                <span className="flex items-center gap-1">
                  🪙 Token Reward
                </span>
                <span>+{promoResult.rewardTokens} JCMOVES</span>
              </div>
            )}
            {shippingFee > 0 && (
              <div className="flex justify-between text-blue-300 font-medium">
                <span className="flex items-center gap-1">
                  <Package className="h-3 w-3" />
                  Shipping
                </span>
                <span>+${shippingFee.toFixed(2)}</span>
              </div>
            )}
            <div className="border-t border-slate-600 pt-2 flex justify-between text-white font-bold text-lg">
              <span>Total</span>
              <span className="text-yellow-400">${finalTotal.toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Shipping / Pickup Selection — shown for jewelry & shop items */}
        {hasShippableItems && (
          <Card className={`mb-4 border-2 transition-colors ${!shippingMethod ? 'border-orange-500/60 bg-orange-950/20' : 'border-blue-500/30 bg-slate-800/80'}`}>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                <Package className="h-4 w-4 text-blue-400" />
                Delivery Method <span className="text-orange-400 ml-1">*</span>
              </p>
              <p className="text-xs text-slate-400 mb-3">Select how you'd like to receive your item(s)</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                {/* Shipping option */}
                <button
                  onClick={() => setShippingMethod('shipping')}
                  className={`rounded-xl border-2 p-3 text-left transition-all ${
                    shippingMethod === 'shipping'
                      ? 'border-blue-500 bg-blue-900/40'
                      : 'border-slate-600 bg-slate-700/50 hover:border-slate-500'
                  }`}
                >
                  <Package className={`h-5 w-5 mb-1.5 ${shippingMethod === 'shipping' ? 'text-blue-400' : 'text-slate-400'}`} />
                  <p className={`text-sm font-bold ${shippingMethod === 'shipping' ? 'text-blue-300' : 'text-white'}`}>Ship It</p>
                  <p className={`text-xs mt-0.5 ${shippingMethod === 'shipping' ? 'text-blue-400' : 'text-slate-400'}`}>+$10.00 shipping</p>
                  {shippingMethod === 'shipping' && (
                    <div className="mt-1.5 flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5 text-blue-400" />
                      <span className="text-xs text-blue-400 font-medium">Selected</span>
                    </div>
                  )}
                </button>
                {/* Local pickup option */}
                <button
                  onClick={() => setShippingMethod('pickup')}
                  className={`rounded-xl border-2 p-3 text-left transition-all ${
                    shippingMethod === 'pickup'
                      ? 'border-emerald-500 bg-emerald-900/40'
                      : 'border-slate-600 bg-slate-700/50 hover:border-slate-500'
                  }`}
                >
                  <Home className={`h-5 w-5 mb-1.5 ${shippingMethod === 'pickup' ? 'text-emerald-400' : 'text-slate-400'}`} />
                  <p className={`text-sm font-bold ${shippingMethod === 'pickup' ? 'text-emerald-300' : 'text-white'}`}>Local Pickup</p>
                  <p className={`text-xs mt-0.5 ${shippingMethod === 'pickup' ? 'text-emerald-400' : 'text-slate-400'}`}>FREE · Ironwood, MI</p>
                  {shippingMethod === 'pickup' && (
                    <div className="mt-1.5 flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-xs text-emerald-400 font-medium">Selected</span>
                    </div>
                  )}
                </button>
              </div>

              {/* Shipping address — only shows when shipping is selected */}
              {shippingMethod === 'shipping' && (
                <div className="mt-1 animate-in slide-in-from-top-2 duration-200">
                  <Label className="text-white text-xs flex items-center gap-1.5 mb-1.5">
                    <MapPin className="h-3.5 w-3.5 text-blue-400" />
                    Shipping Address *
                  </Label>
                  <Input
                    value={shippingAddress}
                    onChange={(e) => setShippingAddress(e.target.value)}
                    placeholder="123 Main St, City, State, ZIP"
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                </div>
              )}

              {/* Pickup info */}
              {shippingMethod === 'pickup' && (
                <div className="mt-1 p-2.5 rounded-lg bg-emerald-900/30 border border-emerald-500/30 animate-in slide-in-from-top-2 duration-200">
                  <p className="text-xs text-emerald-300 font-medium">📍 Ironwood, MI</p>
                  <p className="text-xs text-emerald-400/80 mt-0.5">We'll contact you to arrange a pickup time after your order is confirmed.</p>
                </div>
              )}

              {!shippingMethod && (
                <p className="text-xs text-orange-400 mt-1 flex items-center gap-1">
                  <span>⚠</span> Please select a delivery method to continue
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Saved codes scanner */}
        {myCodes.length > 0 && !promoApplied && (
          <Card className="bg-amber-950/30 border-amber-500/30 mb-3">
            <CardContent className="pt-3 pb-3">
              <p className="text-xs font-bold text-amber-400 flex items-center gap-1.5 mb-2">
                <Sparkles className="h-3.5 w-3.5" />
                You have {myCodes.length} saved code{myCodes.length > 1 ? "s" : ""} — tap to apply
              </p>
              <div className="flex flex-col gap-2">
                {myCodes.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => applyMyCode(c.code)}
                    disabled={promoLoading}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-amber-900/40 border border-amber-700/50 hover:bg-amber-800/50 transition-colors text-left"
                  >
                    <div className="min-w-0">
                      <span className="font-mono font-bold text-amber-300 text-sm tracking-wide">{c.code}</span>
                    </div>
                    <span className="text-xs font-bold text-amber-400 bg-amber-900/60 border border-amber-700/40 rounded-lg px-2 py-1 shrink-0">
                      {promoLoading && promoInput === c.code ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : "Apply"}
                    </span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Promo Code */}
        <Card className="bg-slate-800/80 border-green-500/20 mb-4">
          <CardContent className="pt-4 pb-4">
            {!promoApplied ? (
              <div>
                <p className="text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                  <Tag className="h-4 w-4 text-green-400" />
                  Have a promo code?
                </p>
                <div className="flex gap-2">
                  <Input
                    value={promoInput}
                    onChange={(e) => { setPromoInput(e.target.value.toUpperCase()); setPromoError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && handleValidatePromo()}
                    placeholder="Enter code (e.g. JCMOVES)"
                    className="bg-slate-700 border-slate-600 text-white uppercase placeholder:normal-case placeholder:text-slate-500"
                  />
                  <Button
                    onClick={handleValidatePromo}
                    disabled={promoLoading || !promoInput.trim()}
                    className="bg-green-600 hover:bg-green-700 text-white shrink-0"
                  >
                    {promoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                  </Button>
                </div>
                {promoError && (
                  <p className="text-red-400 text-xs mt-2">{promoError}</p>
                )}
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3 p-3 bg-green-900/30 rounded-xl border border-green-500/30">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-green-300 font-bold text-sm">{promoResult?.code} applied!</p>
                    <p className="text-green-400/70 text-xs mt-0.5">{promoResult?.description}</p>
                    {promoResult && promoResult.discountPercent > 0 && (
                      <p className="text-green-300 text-xs mt-1">{promoResult.discountPercent}% off — saves ${promoDiscountAmount.toFixed(2)}</p>
                    )}
                    {promoResult && promoResult.rewardTokens > 0 && (
                      <p className="text-orange-300 text-xs">+{promoResult.rewardTokens} JCMOVES tokens credited on checkout (requires verified account)</p>
                    )}
                  </div>
                </div>
                <button onClick={handleRemovePromo} className="text-slate-400 hover:text-white shrink-0">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sponsorship Upsell */}
        {!isInCart("sponsor-bronze") && !isInCart("sponsor-silver") && !isInCart("sponsor-gold") && (
          <Card className="bg-gradient-to-r from-yellow-900/30 to-amber-900/20 border-yellow-500/30 mb-4">
            <CardContent className="py-4">
              <p className="text-yellow-200 font-semibold text-sm text-center mb-3 flex items-center justify-center gap-2">
                <Trophy className="h-4 w-4" />
                Become a Sponsor — Support JC ON THE MOVE!
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "sponsor-bronze", name: "Bronze", price: 50, icon: Heart, color: "text-amber-300" },
                  { id: "sponsor-silver", name: "Silver", price: 100, icon: Building2, color: "text-slate-200" },
                  { id: "sponsor-gold", name: "Gold", price: 200, icon: Trophy, color: "text-yellow-300" },
                ].map((tier) => {
                  const Icon = tier.icon;
                  return (
                    <button
                      key={tier.id}
                      onClick={() => {
                        addItem({ id: tier.id, name: `${tier.name} Sponsor (Monthly)`, price: tier.price, image: "", type: "sponsor" });
                        toast({ title: `${tier.name} Sponsorship added!`, description: "Stacking discount applied!" });
                      }}
                      className="bg-slate-800/60 hover:bg-slate-700/60 border border-slate-600/50 rounded-lg p-3 text-center transition-colors"
                    >
                      <Icon className={`h-5 w-5 ${tier.color} mx-auto mb-1`} />
                      <p className={`text-xs font-semibold ${tier.color}`}>{tier.name}</p>
                      <p className="text-white font-bold text-sm">${tier.price}<span className="text-slate-400 text-[10px]">/mo</span></p>
                      <p className="text-emerald-400 text-[10px] mt-0.5">+ Add</p>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Add More Items / Discount Stack Nudge */}
        <Card className="bg-emerald-900/20 border-emerald-500/30 border-dashed mb-6">
          <CardContent className="py-4">
            <p className="text-emerald-300 text-xs font-bold text-center mb-1">Stack your savings</p>
            <p className="text-emerald-200 text-xs text-center mb-3">
              {breakdown.hasInstantBook && breakdown.jewelsCount === 0
                ? "💎 Add a Jewls item → save an extra 5% on your service!"
                : breakdown.jewelsCount === 1
                ? "💎 Add a 2nd Jewls item → save 5% more on your service!"
                : breakdown.multiService
                ? `🎉 ${breakdown.totalPct}% savings applied — crypto is 5% off site-wide!`
                : "Book services and add jewelry in one cart · Crypto payments save 5%"}
            </p>
            <div className="flex gap-2 justify-center flex-wrap">
              <Link href="/handmade-jewels-by-ashley">
                <Button size="sm" variant="outline" className="border-emerald-500/50 text-emerald-200 hover:bg-emerald-900/30">
                  <Gem className="h-4 w-4 mr-1" />
                  Jewelry
                </Button>
              </Link>
              <Link href="/promo/half-day">
                <Button size="sm" variant="outline" className="border-emerald-500/50 text-emerald-200 hover:bg-emerald-900/30">
                  <Truck className="h-4 w-4 mr-1" />
                  Moving
                </Button>
              </Link>
              <Link href="/sponsors">
                <Button size="sm" variant="outline" className="border-yellow-500/50 text-yellow-200 hover:bg-yellow-900/30">
                  <Trophy className="h-4 w-4 mr-1" />
                  Sponsor Us
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Customer Info Form */}
        <Card className="bg-slate-800/80 border-slate-600 shadow-xl">
          <CardHeader>
            <CardTitle className="text-xl text-white">Your Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-white">First Name *</Label>
                  <Input value={form.firstName} onChange={(e) => updateField("firstName", e.target.value)} placeholder="First name" className="bg-slate-700 border-slate-600 text-white" required />
                </div>
                <div>
                  <Label className="text-white">Last Name *</Label>
                  <Input value={form.lastName} onChange={(e) => updateField("lastName", e.target.value)} placeholder="Last name" className="bg-slate-700 border-slate-600 text-white" required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-white">Email *</Label>
                  <Input type="email" value={form.email} onChange={(e) => updateField("email", e.target.value)} placeholder="Best email address" className="bg-slate-700 border-slate-600 text-white" required />
                </div>
                <div>
                  <Label className="text-white">Phone *</Label>
                  <Input type="tel" value={form.phone} onChange={(e) => updateField("phone", e.target.value)} placeholder="Best phone number" className="bg-slate-700 border-slate-600 text-white" required />
                </div>
              </div>

              {needsMoveInfo && (
                <>
                  <div>
                    <Label className="text-white flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-blue-400" />
                      Pickup Address *
                    </Label>
                    <Input value={form.fromAddress} onChange={(e) => updateField("fromAddress", e.target.value)} placeholder="123 Main St, Marquette, MI" className="bg-slate-700 border-slate-600 text-white" required />
                  </div>
                  <div>
                    <Label className="text-white flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-green-400" />
                      Drop-off Address (optional)
                    </Label>
                    <Input value={form.toAddress} onChange={(e) => updateField("toAddress", e.target.value)} placeholder="456 Oak Ave, Ishpeming, MI" className="bg-slate-700 border-slate-600 text-white" />
                  </div>
                  <div>
                    <Label className="text-white flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-yellow-400" />
                      Preferred Date *
                    </Label>
                    <DatePicker
                      value={form.moveDate}
                      onChange={(v) => updateField("moveDate", v)}
                      placeholder="Pick a move date"
                    />
                  </div>
                </>
              )}

              <div>
                <Label className="text-white">Notes (optional)</Label>
                <Textarea value={form.details} onChange={(e) => updateField("details", e.target.value)} placeholder="Any special instructions..." className="bg-slate-700 border-slate-600 text-white min-h-[60px]" />
              </div>

              {needsMoveInfo && (
                <Card className="bg-red-950/40 border-red-500/30">
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-start gap-3">
                      <Shield className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
                      <div className="text-sm text-red-200 space-y-1">
                        <p className="font-semibold text-red-100">Cancellation Policy</p>
                        <p>More than 48 hours: 10% or $100 fee (whichever is greater)</p>
                        <p>Within 48 hours: 25% cancellation fee</p>
                        <p>Within 24 hours: 50% cancellation fee</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* JCMOVES Rewards Enrollment */}
              <div
                className={`rounded-xl border transition-all cursor-pointer ${form.enrollRewards ? "border-emerald-500/50 bg-emerald-950/40" : "border-slate-600/40 bg-slate-800/40"}`}
                onClick={() => setForm(prev => ({ ...prev, enrollRewards: !prev.enrollRewards }))}
              >
                <div className="p-3">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="rewards-enroll"
                      checked={form.enrollRewards}
                      onCheckedChange={(checked) => setForm(prev => ({ ...prev, enrollRewards: checked === true }))}
                      className="mt-0.5 border-emerald-500 data-[state=checked]:bg-emerald-600 shrink-0"
                      onClick={e => e.stopPropagation()}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-emerald-300">Apply rewards to my JCMOVES account</span>
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full px-2 py-0.5 font-bold uppercase tracking-wider">Earn on every order</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">Use the email on your existing or signed-in account · 15 JCMOVES per eligible jewelry dollar</p>
                      {pricing?.totalRewardMoves > 0 && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <Zap className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
                          <span className="text-sm font-black text-yellow-400">{Number(pricing.totalRewardMoves).toLocaleString()} JCMOVES</span>
                          <span className="text-xs text-slate-400">after verified payment to your account</span>
                        </div>
                      )}
                      {pricing?.itemBonusMoves > 0 && (
                        <p className="mt-1 text-xs font-semibold text-amber-300">
                          Includes +{Number(pricing.itemBonusMoves).toLocaleString()} extra JCMOVES for the copper cuff with verified regular payment.
                        </p>
                      )}
                      {pricing?.regularPaymentBonusMoves > 0 && (
                        <p className="mt-1 text-xs font-semibold text-emerald-300">
                          Includes +{Number(pricing.regularPaymentBonusMoves).toLocaleString()} bonus JC Moves (5%) for regular payment
                        </p>
                      )}
                    </div>
                  </div>
                  {form.enrollRewards && (
                    <div className="mt-2 pt-2 border-t border-emerald-500/20 flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                      <p className="text-xs text-emerald-400">After verified regular payment, rewards are credited to the existing account matching this email.</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="cart-terms"
                  checked={agreedToTerms}
                  onCheckedChange={(checked) => setAgreedToTerms(checked === true)}
                  className="mt-1 border-slate-500"
                />
                <label htmlFor="cart-terms" className="text-sm text-slate-300 cursor-pointer leading-relaxed">
                  I agree to the <Link href="/terms" className="text-blue-400 underline hover:text-blue-300">Terms of Service</Link>{needsMoveInfo ? " and cancellation policy" : ""}.
                </label>
              </div>

              <Button
                onClick={handleCheckout}
                disabled={isSubmitting || !agreedToTerms || !pricing || Boolean(pricingError)}
                className="w-full py-6 text-lg font-bold bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-400 hover:to-amber-500 text-black shadow-lg"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <CreditCard className="h-5 w-5 mr-2" />
                    Pay ${finalTotal.toFixed(2)} · +5% JC Moves bonus
                    {(hasMultipleItems || promoApplied) && (
                      <span className="ml-2 text-xs bg-black/20 px-2 py-0.5 rounded-full">
                        Save ${(discount + promoDiscountAmount).toFixed(2)}
                      </span>
                    )}
                  </>
                )}
              </Button>

              <div className="relative flex items-center my-2">
                <div className="flex-1 border-t border-slate-600"></div>
                <span className="px-3 text-xs text-slate-500">or</span>
                <div className="flex-1 border-t border-slate-600"></div>
              </div>

              <Button
                onClick={handleBtcCheckout}
                disabled={isBtcSubmitting || !agreedToTerms || !pricing || Boolean(pricingError)}
                className="w-full py-6 text-lg font-bold bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-400 hover:to-amber-500 text-white shadow-lg"
              >
                {isBtcSubmitting ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Creating BTC Payment...
                  </>
                ) : (
                  <>
                    <Bitcoin className="h-5 w-5 mr-2" />
                    Pay ${(Math.round(finalTotal * 0.95 * 100) / 100).toFixed(2)} with crypto
                    <span className="ml-2 text-xs bg-white/20 px-2 py-0.5 rounded-full">
                      Save 5%
                    </span>
                  </>
                )}
              </Button>

              <p className="text-center text-xs text-slate-400">
                Regular payment stays full price and adds 5% to the normal JC Moves earned. Crypto receives 5% off the verified total.
              </p>
              <p className="text-center text-xs text-orange-400/70 mt-1">
                Bitcoin payments are non-refundable but can be used as credit toward future moves for up to 1 year.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

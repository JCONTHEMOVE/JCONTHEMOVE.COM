import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Calculator, Loader2, MapPin, Navigation, ShieldCheck, Truck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { PlacesAutocomplete } from "@/components/places-autocomplete";
import {
  calculateMovingPrice,
  DEFAULT_ADD_ONS,
  fetchZipLocation,
  getDiscountRate,
  getMinimumLaborHours,
  getMinimumMovers,
  PRICING_BASE,
  type PricingAddOns,
  type TruckSize,
  type ZipLocation,
} from "@shared/pricing";

type Preset = {
  crew?: number;
  withTruck?: boolean;
  stamp?: number;
};

type Props = {
  preset?: Preset;
};

type BookingFields = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  moveDate: string;
  fromAddress: string;
  toAddress: string;
  details: string;
};

type ValidatedPromo = {
  code: string;
  description: string;
  discountPercent: number;
  jobOffer?: {
    kind?: string;
    fixedBasePrice?: number;
    requiredCrewSize?: number;
    requiredHours?: number;
    localMilesMax?: number;
    requiresCompanyTruck?: boolean;
    requiresTrailer?: boolean;
  } | null;
};

const BOOKING_SUCCESS_STORAGE_KEY = "jc-booking-success-invoice-id";

const HOURS = [2, 3, 4, 5, 6, 7, 8];
const CREWS = [1, 2, 3, 4, 5];

const MOVER_TILES = [
  { label: "Small Move", sub: "1–2 movers", value: 1, recommended: false },
  { label: "Standard Move", sub: "2–3 movers", value: 2, recommended: true },
  { label: "Large Move", sub: "3–5 movers", value: 4, recommended: false },
];

const EMPTY_BOOKING_FIELDS: BookingFields = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  moveDate: "",
  fromAddress: "",
  toAddress: "",
  details: "",
};

export function HomepageBookingCalculator({ preset }: Props) {
  const { toast } = useToast();
  const [movers, setMovers] = useState(2);
  const [hours, setHours] = useState(3);
  const [addOns, setAddOns] = useState<PricingAddOns>(DEFAULT_ADD_ONS);
  const [truckSize, setTruckSize] = useState<TruckSize>("sixteen");
  const [pickupZip, setPickupZip] = useState("");
  const [dropoffZip, setDropoffZip] = useState("");
  const [pickupInfo, setPickupInfo] = useState<ZipLocation | null>(null);
  const [dropoffInfo, setDropoffInfo] = useState<ZipLocation | null>(null);
  const [zipError, setZipError] = useState("");
  const [isResolvingTravel, setIsResolvingTravel] = useState(false);
  const [showBookingFields, setShowBookingFields] = useState(false);
  const [booking, setBooking] = useState<BookingFields>(EMPTY_BOOKING_FIELDS);
  const [isCreatingCheckout, setIsCreatingCheckout] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<ValidatedPromo | null>(null);
  const [promoError, setPromoError] = useState("");
  const [isApplyingPromo, setIsApplyingPromo] = useState(false);

  // ETA state
  type EtaData = { distanceMiles: number; estimatedMinutes: number; availabilityLabel: string; crewCount: number };
  const [etaData, setEtaData] = useState<EtaData | null>(null);
  const [etaLoading, setEtaLoading] = useState(false);
  const [etaError, setEtaError] = useState("");
  const etaDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const minimumHours = getMinimumLaborHours(addOns);
  const minimumMovers = getMinimumMovers(addOns, truckSize);
  const serviceAssignments = dropoffZip.trim() ? 2 : 1;

  useEffect(() => {
    if (hours < minimumHours) {
      setHours(minimumHours);
    }
  }, [hours, minimumHours]);

  useEffect(() => {
    if (movers < minimumMovers) {
      setMovers(minimumMovers);
    }
  }, [minimumMovers, movers]);

  useEffect(() => {
    if (!preset?.stamp) return;
    if (preset.crew) {
      setMovers(preset.crew);
    }
    setAddOns((current) => ({
      ...current,
      truck: Boolean(preset.withTruck),
    }));
  }, [preset]);

  useEffect(() => {
    setPickupInfo(null);
    setZipError("");
    setShowBookingFields(false);
    setEtaData(null);
    setEtaError("");

    if (etaDebounceRef.current) clearTimeout(etaDebounceRef.current);
    const zip = pickupZip.trim();
    if (zip.length < 5) return;

    setEtaLoading(true);
    etaDebounceRef.current = setTimeout(async () => {
      try {
        const response = await fetch(`/api/eta?zip=${zip}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || "Could not calculate ETA.");
        setEtaData(data);
      } catch (err: any) {
        setEtaError(err?.message || "Could not calculate ETA.");
      } finally {
        setEtaLoading(false);
      }
    }, 600);
  }, [pickupZip]);

  useEffect(() => {
    setDropoffInfo(null);
    setZipError("");
    setShowBookingFields(false);
  }, [dropoffZip]);

  const pricing = useMemo(() => {
    if (!pickupInfo) return null;
    const fixedPackage = appliedPromo?.jobOffer?.kind === "fixed_moving_package"
      ? appliedPromo.jobOffer
      : null;
    const packageMatchesSelection = Boolean(
      fixedPackage
      && movers === fixedPackage.requiredCrewSize
      && hours === fixedPackage.requiredHours,
    );
    const automatic = calculateMovingPrice({
      movers,
      hours,
      addOns,
      truckSize,
      pickup: pickupInfo,
      dropoff: dropoffInfo,
      promo: appliedPromo && !fixedPackage
        ? {
            code: appliedPromo.code,
            discountPercent: appliedPromo.discountPercent,
            description: appliedPromo.description,
          }
        : null,
    });
    const fixedBasePrice = Number(fixedPackage?.fixedBasePrice);
    if (!fixedPackage || !packageMatchesSelection || !Number.isFinite(fixedBasePrice)) {
      return automatic;
    }

    // Packages replace the automatic moving rate and include their required
    // truck/trailer. Full-address local eligibility is verified server-side.
    const addOnsOutsidePackage = Math.max(0, automatic.addOnTotal - automatic.truckAddOnCost);
    const subtotalBeforePromo = automatic.subtotalBeforePromo;
    const grandTotal = Math.round((fixedBasePrice + addOnsOutsidePackage) * 100) / 100;
    return {
      ...automatic,
      truckAddOnCost: 0,
      discountedLaborTotal: fixedBasePrice,
      addOnTotal: addOnsOutsidePackage,
      travelCost: 0,
      longDistanceCost: 0,
      longDistanceMilesBilled: 0,
      isLongDistance: false,
      promoCode: appliedPromo?.code || null,
      promoDescription: appliedPromo?.description || null,
      subtotalBeforePromo,
      promoDiscountAmount: Math.max(0, Math.round((subtotalBeforePromo - grandTotal) * 100) / 100),
      grandTotal,
    };
  }, [addOns, appliedPromo, dropoffInfo, hours, movers, pickupInfo, truckSize]);

  const laborPreview = useMemo(() => {
    const billableMovers = Math.max(movers, minimumMovers);
    const billableHours = Math.max(hours, minimumHours);
    const laborSubtotal = billableMovers * PRICING_BASE.laborRatePerMoverHour * billableHours;
    const discountRate = getDiscountRate(billableHours);
    const discountAmount = Math.round(laborSubtotal * discountRate * 100) / 100;
    const addOnTotal =
      (addOns.truck
        ? truckSize === "large"
          ? PRICING_BASE.truckLargeAddOnFlat
          : PRICING_BASE.truckSmallAddOnFlat
        : 0) +
      (addOns.packing ? billableMovers * 50 * billableHours : 0) +
      (addOns.stairs ? PRICING_BASE.stairFlightRatePerAssignment * serviceAssignments : 0) +
      (addOns.piano ? PRICING_BASE.specialtyItemBaseFee * 2 : 0) +
      (addOns.hotTub ? PRICING_BASE.hotTubFlatFee : 0) +
      (addOns.assembly ? PRICING_BASE.assemblyRatePerAssignment * serviceAssignments : 0);

    return {
      billableMovers,
      billableHours,
      laborSubtotal,
      discountAmount,
      subtotalBeforeTravel: laborSubtotal - discountAmount + addOnTotal,
    };
  }, [addOns, hours, minimumHours, minimumMovers, movers, serviceAssignments, truckSize]);

  const depositAmount = pricing ? Math.round(pricing.grandTotal * 0.3 * 100) / 100 : 0;

  async function resolveTravel() {
    const normalizedPickup = pickupZip.trim();
    const normalizedDropoff = dropoffZip.trim();

    if (normalizedPickup.length < 5) {
      setZipError("Enter a valid pickup ZIP to calculate travel.");
      return;
    }

    setIsResolvingTravel(true);
    setZipError("");

    try {
      const [pickup, dropoff] = await Promise.all([
        fetchZipLocation(normalizedPickup),
        normalizedDropoff ? fetchZipLocation(normalizedDropoff) : Promise.resolve(null),
      ]);

      setPickupInfo(pickup);
      setDropoffInfo(dropoff);
      setShowBookingFields(false);
    } catch (error: any) {
      setPickupInfo(null);
      setDropoffInfo(null);
      setZipError(error?.message || "We could not calculate travel from that ZIP yet.");
    } finally {
      setIsResolvingTravel(false);
    }
  }

  async function applyPromoCode() {
    const normalizedCode = promoCode.trim().toUpperCase();
    if (!normalizedCode) {
      setPromoError("Enter a promo code to apply it.");
      return;
    }

    setIsApplyingPromo(true);
    setPromoError("");

    try {
      const response = await fetch("/api/promo-codes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: normalizedCode,
          context: "service",
        }),
      });

      const data = await response.json();
      if (!response.ok || !data?.valid) {
        throw new Error(data?.error || "This promo code is not available.");
      }

      const jobOffer = data.jobOffer || null;
      if (jobOffer?.kind === "fixed_moving_package" &&
          (movers !== Number(jobOffer.requiredCrewSize) || hours !== Number(jobOffer.requiredHours))) {
        throw new Error(`This package requires exactly ${jobOffer.requiredCrewSize} movers for ${jobOffer.requiredHours} hours.`);
      }

      setAppliedPromo({
        code: data.code,
        description: data.description || "",
        discountPercent: Number(data.discountPercent || 0),
        jobOffer,
      });
      setPromoCode(data.code);
    } catch (error: any) {
      setAppliedPromo(null);
      setPromoError(error?.message || "This promo code could not be applied.");
    } finally {
      setIsApplyingPromo(false);
    }
  }

  function clearPromoCode() {
    setPromoCode("");
    setAppliedPromo(null);
    setPromoError("");
  }

  function toggleAddOn(key: keyof PricingAddOns) {
    setAddOns((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function selectTruckOption(size: TruckSize) {
    setTruckSize(size);
    setAddOns((current) => ({
      ...current,
      truck: true,
    }));
  }

  function updateField(key: keyof BookingFields, value: string) {
    setBooking((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function validateBookingFields() {
    if (!pricing) {
      toast({
        title: "Calculate travel first",
        description: "Enter the pickup ZIP and calculate travel before booking.",
        variant: "destructive",
      });
      return false;
    }

    const required: Array<keyof BookingFields> = [
      "firstName",
      "lastName",
      "email",
      "phone",
      "moveDate",
      "fromAddress",
    ];

    const missing = required.find((key) => !booking[key].trim());
    if (missing) {
      toast({
        title: "Missing booking details",
        description: "Please complete your contact info, move date, and pickup address.",
        variant: "destructive",
      });
      return false;
    }

    return true;
  }

  async function createDepositCheckout() {
    if (!validateBookingFields() || !pricing) return;

    setIsCreatingCheckout(true);
    try {
      const response = await fetch("/api/bookings/deposit/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          movers,
          hours,
          addOns,
          truckSize: addOns.truck ? truckSize : undefined,
          pickupZip: pickupZip.trim(),
          dropoffZip: dropoffZip.trim() || undefined,
          promoCode: appliedPromo?.code || undefined,
          ...booking,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data?.checkoutUrl) {
        throw new Error(data?.error || "Could not create your deposit checkout.");
      }

      if (data.invoiceId) {
        window.localStorage.setItem(BOOKING_SUCCESS_STORAGE_KEY, data.invoiceId);
      }
      window.location.href = data.checkoutUrl;
    } catch (error: any) {
      toast({
        title: "Checkout unavailable",
        description: error?.message || "Please try again or call us to reserve your move.",
        variant: "destructive",
      });
    } finally {
      setIsCreatingCheckout(false);
    }
  }

  return (
    <div className="space-y-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-300">Live Pricing</p>
          <h2 className="mt-2 text-2xl font-bold text-white">Build Your Move (Live Pricing)</h2>
          <p className="mt-2 text-base text-slate-400">
            Labor is {`$${PRICING_BASE.laborRatePerMoverHour}/hr`} per mover. Travel is {`$${PRICING_BASE.travelRatePerCrewHour}/hr`} per crew from Ironwood, MI.
          </p>
          <p className="mt-2 text-sm font-medium text-slate-300">
            No hidden fees • Discounts after 2 hours • Instant estimate
          </p>
          <p className="mt-2 text-sm text-emerald-200">Prices update instantly — lock your rate by booking now.</p>
        </div>
        <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-100">
          Calculator first
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-7">
          <div>
            <p className="mb-3 text-base font-semibold text-slate-200">How big is your move?</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {MOVER_TILES.map((tile) => {
                const tileSelected =
                  (tile.value === 1 && movers <= 1) ||
                  (tile.value === 2 && movers >= 2 && movers <= 3) ||
                  (tile.value === 4 && movers >= 4);
                return (
                  <button
                    key={tile.label}
                    type="button"
                    onClick={() => setMovers(tile.value)}
                    className={`relative rounded-xl border px-4 py-4 text-left transition ${
                      tileSelected
                        ? "border-blue-400 bg-blue-500/15"
                        : "border-white/10 bg-white/5 hover:border-white/20"
                    }`}
                  >
                    {tile.recommended && (
                      <span className="absolute -top-2.5 left-3 bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                        Recommended
                      </span>
                    )}
                    <p className={`font-semibold text-sm ${tileSelected ? "text-blue-100" : "text-slate-200"}`}>{tile.label}</p>
                    <p className={`text-xs mt-0.5 ${tileSelected ? "text-blue-300" : "text-slate-400"}`}>{tile.sub}</p>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-slate-500 italic">Most common job: 2 movers for 3 hours ≈ $470</p>
          </div>

          <div>
            <p className="mb-3 text-base font-semibold text-slate-200">Hours</p>
            <div className="grid grid-cols-4 gap-2 md:grid-cols-7">
              {HOURS.map((option) => {
                const discountPct = Math.round(getDiscountRate(option) * 100);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setHours(option)}
                    disabled={option < minimumHours}
                    className={`relative rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                      hours === option
                        ? "border-emerald-400 bg-emerald-500/10 text-emerald-100"
                        : option < minimumHours
                          ? "cursor-not-allowed border-white/5 bg-white/[0.03] text-slate-500"
                          : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20"
                    }`}
                  >
                    {option === 3 && (
                      <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap bg-emerald-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                        Most common
                      </span>
                    )}
                    <span className="block">{option}h</span>
                    {discountPct > 0 ? (
                      <span className={`block text-[10px] font-medium mt-0.5 ${hours === option ? "text-emerald-300" : option < minimumHours ? "text-slate-600" : "text-emerald-400"}`}>
                        -{discountPct}%
                      </span>
                    ) : (
                      <span className="block text-[10px] mt-0.5 opacity-0">0%</span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {addOns.truck
                ? "Truck bookings require a 3-hour labor minimum."
                : "Labor-only bookings have a 2-hour minimum."}
            </p>
          </div>

          <div>
            <p className="mb-3 text-base font-semibold text-slate-200">Optional Services</p>
            <div className="space-y-2">
              {[
                { key: "packing", label: "Packing help", detail: `+$${movers * 50 * laborPreview.billableHours}` },
                {
                  key: "stairs",
                  label: "Long stair carry",
                  detail: `+$${PRICING_BASE.stairFlightRatePerAssignment * serviceAssignments}`,
                },
                {
                  key: "piano",
                  label: "Piano / safe / specialty item",
                  detail: `+$${PRICING_BASE.specialtyItemBaseFee * 2}`,
                },
                {
                  key: "hotTub",
                  label: "Hot tub",
                  detail: `+$${PRICING_BASE.hotTubFlatFee}`,
                },
                {
                  key: "assembly",
                  label: "Assembly / disassembly",
                  detail: `+$${PRICING_BASE.assemblyRatePerAssignment * serviceAssignments}`,
                },
              ].map((item) => {
                const key = item.key as keyof PricingAddOns;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => toggleAddOn(key)}
                    className={`flex w-full items-center justify-between rounded-xl border px-4 py-4 text-base transition ${
                      addOns[key]
                        ? "border-emerald-400 bg-emerald-500/10 text-emerald-100"
                        : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20"
                    }`}
                  >
                    <span>{item.label}</span>
                    <span>{item.detail}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Truck options</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => selectTruckOption("sixteen")}
                  className={`flex items-center justify-between rounded-xl border px-4 py-4 text-base transition ${
                    addOns.truck && truckSize === "sixteen"
                      ? "border-emerald-400 bg-emerald-500/10 text-emerald-100"
                      : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20"
                  }`}
                >
                  <span>16-foot truck</span>
                  <span>+$300</span>
                </button>
                <button
                  type="button"
                  onClick={() => selectTruckOption("large")}
                  className={`flex items-center justify-between rounded-xl border px-4 py-4 text-base transition ${
                    addOns.truck && truckSize === "large"
                      ? "border-emerald-400 bg-emerald-500/10 text-emerald-100"
                      : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20"
                  }`}
                >
                  <span>Large truck</span>
                  <span>+$600</span>
                </button>
              </div>
              {addOns.truck ? (
                <button
                  type="button"
                  onClick={() =>
                    setAddOns((current) => ({
                      ...current,
                      truck: false,
                    }))
                  }
                  className="mt-2 text-xs font-medium text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline"
                >
                  Remove truck rental
                </button>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pickup-zip" className="text-slate-200">
                  Pickup ZIP
                </Label>
                <Input
                  id="pickup-zip"
                  value={pickupZip}
                  onChange={(event) => setPickupZip(event.target.value.replace(/\D/g, "").slice(0, 5))}
                  placeholder="49938"
                  className="border-slate-700 bg-slate-950/70 text-white"
                />
                {etaLoading && (
                  <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Checking crew availability...
                  </div>
                )}
                {!etaLoading && etaData && (
                  <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
                    etaData.availabilityLabel === "far"
                      ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-200"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                  }`}>
                    {etaData.availabilityLabel !== "far" ? (
                      <span className="relative flex h-2 w-2 flex-shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                      </span>
                    ) : (
                      <span className="h-2 w-2 flex-shrink-0 rounded-full bg-yellow-400" />
                    )}
                    {etaData.availabilityLabel === "far" ? (
                      <span>We serve this area — contact us to confirm availability</span>
                    ) : (
                      <span>
                        {etaData.crewCount > 0 ? `${etaData.crewCount} Mover${etaData.crewCount > 1 ? "s" : ""} Online · ` : ""}
                        ~{etaData.estimatedMinutes < 60
                          ? `${etaData.estimatedMinutes} min away`
                          : `${Math.floor(etaData.estimatedMinutes / 60)} hr${Math.floor(etaData.estimatedMinutes / 60) > 1 ? "s" : ""}${etaData.estimatedMinutes % 60 > 0 ? ` ${etaData.estimatedMinutes % 60} min` : ""} away`}
                      </span>
                    )}
                  </div>
                )}
                {!etaLoading && etaError && (
                  <p className="text-xs text-slate-400">{etaError}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="dropoff-zip" className="text-slate-200">
                  Drop-off ZIP (optional)
                </Label>
                <Input
                  id="dropoff-zip"
                  value={dropoffZip}
                  onChange={(event) => setDropoffZip(event.target.value.replace(/\D/g, "").slice(0, 5))}
                  placeholder="Use for load + unload"
                  className="border-slate-700 bg-slate-950/70 text-white"
                />
              </div>
            </div>

            <Button
              type="button"
              onClick={resolveTravel}
              disabled={isResolvingTravel}
              className="mt-4 w-full rounded-xl bg-blue-600 py-5 text-base font-semibold hover:bg-blue-500"
            >
              {isResolvingTravel ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Calculating travel
                </>
              ) : (
                <>
                  <Navigation className="mr-2 h-4 w-4" />
                  Get Final Price
                </>
              )}
            </Button>

            <p className="mt-3 text-xs text-slate-400">
              Travel Fee: $100/hr per crew from Ironwood, MI. Truck jobs include local service up to 25 loaded miles; long-distance truck moves add $4/mile with a 100-mile minimum.
            </p>
            {zipError ? <p className="mt-2 text-sm text-red-300">{zipError}</p> : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-blue-400/20 bg-blue-950/35 p-5">
            <div className="flex items-center gap-2 text-blue-200">
              <Calculator className="h-4 w-4" />
              <p className="text-sm font-semibold">Estimated Cost So Far</p>
            </div>
            <p className="mt-4 text-4xl font-black text-white">
              ${Math.round(laborPreview.subtotalBeforeTravel)}
            </p>
            <p className="mt-2 text-sm text-slate-300">
              {laborPreview.billableMovers} mover{laborPreview.billableMovers > 1 ? "s" : ""} x {laborPreview.billableHours} billable hour{laborPreview.billableHours > 1 ? "s" : ""} before distance is added.
            </p>
            <p className="mt-3 text-xs text-slate-400 leading-relaxed">We handle the heavy lifting, loading, and logistics — you don't need to figure it all out.</p>
            <div className="mt-4 space-y-2 text-sm text-slate-300">
              <div className="flex items-center justify-between">
                <span>Labor subtotal</span>
                <span>${laborPreview.laborSubtotal}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Discount</span>
                <span>- ${laborPreview.discountAmount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Add-ons</span>
                <span>${Math.round(laborPreview.subtotalBeforeTravel - (laborPreview.laborSubtotal - laborPreview.discountAmount))}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-5">
            <div className="flex items-center gap-2 text-slate-200">
              <MapPin className="h-4 w-4 text-amber-300" />
              <p className="text-sm font-semibold">Travel and total</p>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Promo code</p>
                  <p className="text-xs text-slate-400">Enter an active moving promo or fixed-package code. Package eligibility is verified against the full address before checkout.</p>
                </div>
                {appliedPromo ? (
                  <button
                    type="button"
                    onClick={clearPromoCode}
                    className="text-xs font-medium text-slate-300 underline-offset-4 hover:text-white hover:underline"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <div className="mt-3 flex gap-2">
                <Input
                  value={promoCode}
                  onChange={(event) => {
                    setPromoCode(event.target.value.toUpperCase());
                    setPromoError("");
                  }}
                  placeholder="Enter promo code"
                  className="border-slate-700 bg-slate-950/70 text-white"
                />
                <Button
                  type="button"
                  onClick={applyPromoCode}
                  disabled={isApplyingPromo}
                  className="shrink-0 rounded-xl bg-blue-600 px-4 hover:bg-blue-500"
                >
                  {isApplyingPromo ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                </Button>
              </div>
              {appliedPromo ? (
                <p className="mt-2 text-xs text-emerald-200">
                  {appliedPromo.code} applied{appliedPromo.description ? ` — ${appliedPromo.description}` : ""}.
                  {appliedPromo.jobOffer?.kind === "fixed_moving_package"
                    ? ` Package: ${appliedPromo.jobOffer.requiredCrewSize} movers for ${appliedPromo.jobOffer.requiredHours} hours${appliedPromo.jobOffer.localMilesMax ? ` within ${appliedPromo.jobOffer.localMilesMax} local miles` : ""}.`
                    : ""}
                </p>
              ) : null}
              {promoError ? <p className="mt-2 text-xs text-red-300">{promoError}</p> : null}
            </div>

            {!pricing ? (
              <div className="mt-5 rounded-xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                Enter the pickup ZIP to unlock travel pricing and your final booking total.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm">
                  <p className="font-semibold text-amber-100">
                    Estimated Travel: {pricing.travelHours} hr{pricing.travelHours !== 1 ? "s" : ""} - ${pricing.travelCost}
                  </p>
                  <p className="mt-1 text-slate-300">
                    From {PRICING_BASE.origin.city} to {pickupInfo?.city}
                    {dropoffInfo ? ` to ${dropoffInfo.city}` : ""} and back.
                  </p>
                  {pricing.isLongDistance ? (
                    <p className="mt-2 text-amber-100">
                      Long-distance truck rate: ${pricing.longDistanceCost} for {pricing.longDistanceMilesBilled} billed miles.
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2 text-sm text-slate-300">
                  <div className="flex items-center justify-between">
                    <span>Discounted labor</span>
                    <span>${pricing.discountedLaborTotal}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Add-ons</span>
                    <span>${pricing.addOnTotal}</span>
                  </div>
                  {pricing.longDistanceCost > 0 ? (
                    <div className="flex items-center justify-between">
                      <span>Long-distance mileage</span>
                      <span>${pricing.longDistanceCost}</span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between">
                    <span>Travel</span>
                    <span>${pricing.travelCost}</span>
                  </div>
                  {pricing.promoDiscountAmount > 0 ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span>Subtotal before promo</span>
                        <span>${pricing.subtotalBeforePromo}</span>
                      </div>
                      <div className="flex items-center justify-between text-emerald-200">
                        <span>Promo ({pricing.promoCode})</span>
                        <span>- ${pricing.promoDiscountAmount}</span>
                      </div>
                    </>
                  ) : null}
                  <div className="flex items-center justify-between border-t border-white/10 pt-3 text-base font-semibold text-white">
                    <span>Total</span>
                    <span>${pricing.grandTotal}</span>
                  </div>
                  <div className="flex items-center justify-between text-blue-200">
                    <span>30% deposit to reserve date</span>
                    <span>${depositAmount}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Balance due after job</span>
                    <span>${Math.round((pricing.grandTotal - depositAmount) * 100) / 100}</span>
                  </div>
                </div>

                {pricing.warnings.travelOverCap ? (
                  <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-100">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <p>
                        This trip has more than 4 travel hours. You can still reserve it online, but long-distance jobs may need manual review from our team.
                      </p>
                    </div>
                  </div>
                ) : null}

                <Button
                  type="button"
                  onClick={() => setShowBookingFields(true)}
                  className="w-full rounded-xl bg-emerald-600 py-6 text-base font-bold hover:bg-emerald-500"
                >
                  Get My Price
                </Button>
                <a href="tel:+19062859312" className="block text-center text-sm text-slate-400 hover:text-slate-200 transition-colors">
                  Talk to Us Instead — (906) 285-9312
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confidence bar */}
      <div className="rounded-xl border border-white/10 bg-white/5 px-5 py-3">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-400">
          {["No hidden fees", "Final price confirmed before job", "You approve everything first"].map((item, i) => (
            <span key={item} className="flex items-center gap-1.5">
              {i > 0 && <span className="hidden sm:inline text-slate-600">·</span>}
              <span>{item}</span>
            </span>
          ))}
        </div>
      </div>

      {showBookingFields && pricing ? (
        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-5">
          <div className="flex items-center gap-2 text-white">
            <ShieldCheck className="h-4 w-4 text-emerald-300" />
            <h3 className="text-lg font-semibold">Reserve your date with a 30% deposit</h3>
          </div>
          <p className="mt-2 text-sm text-slate-400">
            Deposits reserve your move date, are non-refundable once booked, and can be applied to one future rescheduled move.
          </p>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-slate-200">First name</Label>
              <Input value={booking.firstName} onChange={(e) => updateField("firstName", e.target.value)} className="border-slate-700 bg-slate-900 text-white" />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-200">Last name</Label>
              <Input value={booking.lastName} onChange={(e) => updateField("lastName", e.target.value)} className="border-slate-700 bg-slate-900 text-white" />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-200">Email</Label>
              <Input type="email" value={booking.email} onChange={(e) => updateField("email", e.target.value)} className="border-slate-700 bg-slate-900 text-white" />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-200">Phone</Label>
              <Input type="tel" required value={booking.phone} onChange={(e) => updateField("phone", e.target.value)} className="border-slate-700 bg-slate-900 text-white" />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-200">Move date</Label>
              <DatePicker
                value={booking.moveDate}
                onChange={(value) => updateField("moveDate", value)}
                placeholder="Select move date"
                buttonClassName="border-slate-700 bg-slate-900 text-white"
                testId="input-booking-move-date"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-200">Pickup address</Label>
              <PlacesAutocomplete
                value={booking.fromAddress}
                onChange={(value) => updateField("fromAddress", value)}
                placeholder="Start typing pickup address"
                inputClassName="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500/60"
                inputTestId="input-booking-from-address"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label className="text-slate-200">Drop-off address</Label>
              <PlacesAutocomplete
                value={booking.toAddress}
                onChange={(value) => updateField("toAddress", value)}
                placeholder="Start typing drop-off address"
                inputClassName="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500/60"
                inputTestId="input-booking-to-address"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label className="text-slate-200">Move notes</Label>
              <Textarea
                value={booking.details}
                onChange={(e) => updateField("details", e.target.value)}
                className="min-h-[110px] border-slate-700 bg-slate-900 text-white"
                placeholder="Tell us about stairs, building access, fragile items, or timing."
              />
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-blue-400/15 bg-blue-500/10 p-4 text-sm text-slate-200">
            <div className="flex items-center gap-2 font-semibold text-white">
              <Users className="h-4 w-4 text-blue-200" />
              Booking summary
            </div>
            <p className="mt-2">{pricing.billableMovers} movers for {pricing.billableHours} billable hours. Full total ${pricing.grandTotal}. Deposit due now ${depositAmount}.</p>
            {pricing.promoDiscountAmount > 0 ? (
              <p className="mt-1 text-xs text-emerald-200">
                Promo {pricing.promoCode} saved ${pricing.promoDiscountAmount}.
              </p>
            ) : null}
            {pricing.billableHours !== hours || pricing.billableMovers !== movers ? (
              <p className="mt-1 text-xs text-blue-100/80">
                Truck minimum applied: billed at {pricing.billableMovers} movers and {pricing.billableHours} hours.
              </p>
            ) : null}
          </div>

          <Button
            type="button"
            onClick={createDepositCheckout}
            disabled={isCreatingCheckout}
            className="mt-5 w-full rounded-xl bg-blue-600 py-5 text-base font-semibold hover:bg-blue-500"
          >
            {isCreatingCheckout ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Opening Square checkout
              </>
            ) : (
              <>
                <Truck className="mr-2 h-4 w-4" />
                Pay ${depositAmount} deposit and reserve date
              </>
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

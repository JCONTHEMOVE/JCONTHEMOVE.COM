import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Truck, Trash2, Wrench, Snowflake, ChevronRight, Clock, ArrowLeft, Loader2, Plus, Minus, Users, AlertCircle } from "lucide-react";
import AddressAutocomplete from "@/components/AddressAutocomplete";
import { PlacesAutocomplete } from "@/components/places-autocomplete";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { createJob } from "@/lib/createJob";

// ── Junk booking types ────────────────────────────────────────────────────────

const JUNK_TIERS = [
  { key: "small_pickup",  label: "Small Pickup",  price: 150,  desc: "Less than ½ a pickup truck",   tag: "Quick & Easy"  },
  { key: "pickup_load",   label: "Pickup Load",   price: 350,  desc: "Full pickup truck load",        tag: "Most Popular"  },
  { key: "trailer_load",  label: "Trailer Load",  price: 750,  desc: "Large trailer",      tag: "Full Cleanout" },
  { key: "full_load",     label: "Full Load",     price: 1000, desc: "Max capacity haul",  tag: "Best Value"    },
];

const ADD_ONS = [
  { key: "mattress", label: "Mattress",      price: 50  },
  { key: "fridge",   label: "Fridge",        price: 100 },
  { key: "gym",      label: "Gym Equipment", price: 100 },
];

const MOVER_OPTIONS = [1, 2, 3, 4, 5];
const HOUR_OPTIONS  = [2, 3, 4, 5, 6, 8];

// ── Address validation ────────────────────────────────────────────────────────
// Must have at least one digit AND at least one letter AND be >= 8 chars
// This blocks bare zip codes like "49938" or empty entries
function isValidAddress(addr: string): boolean {
  const trimmed = addr.trim();
  if (trimmed.length < 8) return false;
  const hasLetter = /[a-zA-Z]/.test(trimmed);
  const hasDigit  = /\d/.test(trimmed);
  return hasLetter && hasDigit;
}

// ── JunkFlow ──────────────────────────────────────────────────────────────────

export function JunkFlow({ user, onBooked, onBack }: { user: any; onBooked: (id: string, price: number) => void; onBack: () => void }) {
  const { toast } = useToast();
  const [tier, setTier] = useState<string | null>(null);
  const [addOns, setAddOns] = useState<Record<string, number>>({ mattress: 0, fridge: 0, gym: 0 });
  const [address, setAddress] = useState("");
  const [addressTouched, setAddressTouched] = useState(false);

  const tierPrice = JUNK_TIERS.find(t => t.key === tier)?.price ?? 0;
  const addOnTotal = ADD_ONS.reduce((s, a) => s + (addOns[a.key] || 0) * a.price, 0);
  const total = tierPrice + addOnTotal;

  const addressError = addressTouched && !isValidAddress(address);

  const book = useMutation({
    mutationFn: async () => {
      if (!tier) throw new Error("Please select a load size.");
      if (!isValidAddress(address)) throw new Error("Please enter a full street address.");
      const res = await apiRequest("POST", "/api/jobs/create-junk", {
        tier, addOns, address,
        customerName: `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "Customer",
        phone: user?.phoneNumber || "",
        email: user?.email || "",
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Booking submitted!", description: data.message });
      onBooked(data.jobId, data.totalPrice ?? total);
    },
    onError: (err: any) => toast({ title: "Booking failed", description: err.message || "Please try again.", variant: "destructive" }),
  });

  const changeQty = (key: string, d: number) =>
    setAddOns(p => ({ ...p, [key]: Math.max(0, (p[key] || 0) + d) }));

  const canSubmit = !!tier && isValidAddress(address) && !book.isPending;

  return (
    <div className="space-y-3">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-zinc-500 text-sm hover:text-zinc-300 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Change service
      </button>

      <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Choose load size</p>
      <div className="grid grid-cols-2 gap-2">
        {JUNK_TIERS.map(t => (
          <button
            key={t.key}
            onClick={() => setTier(tier === t.key ? null : t.key)}
            className={`relative rounded-2xl p-3 text-left border transition-all active:scale-[0.97] ${
              tier === t.key
                ? "bg-orange-500/15 border-orange-500 shadow-sm shadow-orange-500/20"
                : "bg-zinc-900 border-zinc-800 hover:border-zinc-700"
            }`}
          >
            {t.tag && (
              <span className={`absolute -top-2 left-3 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                tier === t.key ? "bg-orange-500 text-white" : "bg-zinc-700 text-zinc-300"
              }`}>
                {t.tag}
              </span>
            )}
            <p className={`font-bold text-sm mt-1 ${tier === t.key ? "text-orange-100" : "text-white"}`}>
              {t.label}
            </p>
            <p className={`font-black text-base ${tier === t.key ? "text-orange-400" : "text-zinc-300"}`}>
              ${t.price}
            </p>
            <p className={`text-xs mt-0.5 ${tier === t.key ? "text-orange-300" : "text-zinc-500"}`}>
              {t.desc}
            </p>
          </button>
        ))}
      </div>

      {tier && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-4">
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Add-ons</p>

          {ADD_ONS.map(a => (
            <div key={a.key} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">{a.label}</p>
                <p className="text-xs text-zinc-500">+${a.price} each</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => changeQty(a.key, -1)}
                  className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300 hover:bg-zinc-700 active:scale-90"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="text-white font-bold w-4 text-center">{addOns[a.key] || 0}</span>
                <button
                  onClick={() => changeQty(a.key, 1)}
                  className="w-7 h-7 rounded-lg bg-orange-500/20 border border-orange-500/40 flex items-center justify-center text-orange-400 hover:bg-orange-500/30 active:scale-90"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}

          <AddressAutocomplete
            value={address}
            onChange={setAddress}
            onBlur={() => setAddressTouched(true)}
            label="Pickup Address"
            required
            error={addressError}
            errorMessage="Enter a full street address (e.g. 123 Main St, Ironwood, MI)"
          />

          <div className="border-t border-zinc-800 pt-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-zinc-400 text-sm font-medium">Total</span>
              <span className="text-white font-black text-xl">${total}</span>
            </div>
            <button
              onClick={() => { setAddressTouched(true); book.mutate(); }}
              disabled={!canSubmit}
              className="w-full py-3.5 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all text-white font-black text-base shadow-lg shadow-orange-500/25 flex items-center justify-center gap-2"
            >
              {book.isPending
                ? <Loader2 className="h-5 w-5 animate-spin" />
                : <><Trash2 className="h-5 w-5" />Book Now · ${total}</>
              }
            </button>
            <p className="text-center text-xs text-zinc-600 mt-2">⚡ Most jobs booked in under 30 seconds</p>
          </div>
        </div>
      )}

      {!tier && (
        <p className="text-center text-zinc-600 text-xs">
          Final price confirmed on-site · No hidden fees
        </p>
      )}
    </div>
  );
}

// ── MovingFlow ────────────────────────────────────────────────────────────────

export function MovingFlow({ user, onBooked }: { user: any; onBooked: (id: string, price: number) => void }) {
  const { toast } = useToast();
  const [movers, setMovers] = useState(2);
  const [hours, setHours] = useState(4);
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [addressTouched, setAddressTouched] = useState(false);
  const [descTouched, setDescTouched] = useState(false);

  const { data: pricing } = useQuery<{ ratePerMoverHour: number }>({ queryKey: ["/api/pricing"] });
  const rate = pricing?.ratePerMoverHour ?? 60;
  const estimatedPrice = movers * hours * rate;

  const addressError  = addressTouched  && !isValidAddress(address);
  const descError     = descTouched     && description.trim().length < 10;

  const book = useMutation({
    mutationFn: () => {
      if (!isValidAddress(address)) throw new Error("Please enter a full street address.");
      if (description.trim().length < 10) throw new Error("Please describe what needs to be moved.");
      return createJob({
        serviceType: "moving",
        movers,
        hours,
        address,
        notes: description,
        customerName: `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "Customer",
        phone: user?.phoneNumber || "",
        email: user?.email || "",
      });
    },
    onSuccess: (data) => {
      toast({ title: "Booking submitted!", description: data.message });
      onBooked(data.jobId, data.totalPrice ?? estimatedPrice);
    },
    onError: (err: any) => toast({ title: "Booking failed", description: err.message || "Please try again.", variant: "destructive" }),
  });

  const canSubmit = isValidAddress(address) && description.trim().length >= 10 && !book.isPending;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-5">
      <div>
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">How many movers?</p>
        <div className="flex gap-2 flex-wrap">
          {MOVER_OPTIONS.map(n => (
            <button
              key={n}
              onClick={() => setMovers(n)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl border font-bold text-sm transition-all active:scale-95 ${
                movers === n
                  ? "bg-blue-500/15 border-blue-500 text-blue-300"
                  : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-600"
              }`}
            >
              <Users className="h-3.5 w-3.5" />{n}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">How many hours?</p>
        <div className="flex gap-2 flex-wrap">
          {HOUR_OPTIONS.map(h => (
            <button
              key={h}
              onClick={() => setHours(h)}
              className={`px-4 py-2 rounded-xl border font-bold text-sm transition-all active:scale-95 ${
                hours === h
                  ? "bg-blue-500/15 border-blue-500 text-blue-300"
                  : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-600"
              }`}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>

      <AddressAutocomplete
        value={address}
        onChange={setAddress}
        onBlur={() => setAddressTouched(true)}
        label="Pickup Address"
        required
        error={addressError}
        errorMessage="Enter a full street address (e.g. 123 Main St, Ironwood, MI)"
      />

      <div>
        <label className="text-xs text-zinc-500 font-semibold block mb-1">
          What needs to be moved? <span className="text-red-400">*</span>
        </label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          onBlur={() => setDescTouched(true)}
          placeholder="e.g. 2-bedroom apartment, have a couch, dresser, and boxes. Moving from Ironwood to Hurley."
          rows={3}
          className={`w-full bg-zinc-800 border rounded-xl px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none transition-colors resize-none ${
            descError ? "border-red-500 focus:border-red-400" : "border-zinc-700 focus:border-blue-500"
          }`}
        />
        {descError && (
          <p className="flex items-center gap-1 text-red-400 text-xs mt-1">
            <AlertCircle className="h-3 w-3" />
            Please describe your move (at least a few words)
          </p>
        )}
      </div>

      <div className="border-t border-zinc-800 pt-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-zinc-400 text-sm font-medium">Estimated Total</span>
          <span className="text-white font-black text-xl">${estimatedPrice}</span>
        </div>
        <p className="text-zinc-600 text-xs">{movers} mover{movers > 1 ? "s" : ""} × {hours}h @ ${rate}/mover/hr · Final price confirmed on-site</p>
        <button
          onClick={() => { setAddressTouched(true); setDescTouched(true); book.mutate(); }}
          disabled={!canSubmit}
          className="w-full py-3.5 rounded-xl bg-blue-500 hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all text-white font-black text-base shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2"
        >
          {book.isPending
            ? <Loader2 className="h-5 w-5 animate-spin" />
            : <><Truck className="h-5 w-5" />Book {movers} Mover{movers > 1 ? "s" : ""} · ${estimatedPrice}</>
          }
        </button>
        <p className="text-center text-xs text-zinc-600">⚡ Most jobs booked in under 30 seconds</p>
      </div>
    </div>
  );
}

// ── LaborFlow ─────────────────────────────────────────────────────────────────

function LaborFlow({ user, onBooked }: { user: any; onBooked: (id: string, price: number) => void }) {
  const { toast } = useToast();
  const [movers, setMovers] = useState(2);
  const [hours, setHours] = useState(3);
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [addressTouched, setAddressTouched] = useState(false);
  const [descTouched, setDescTouched] = useState(false);

  const { data: pricing } = useQuery<{ ratePerMoverHour: number }>({ queryKey: ["/api/pricing"] });
  const rate = pricing?.ratePerMoverHour ?? 60;
  const estimatedPrice = movers * hours * rate;

  const addressError = addressTouched && !isValidAddress(address);
  const descError    = descTouched    && description.trim().length < 10;

  const book = useMutation({
    mutationFn: () => {
      if (!isValidAddress(address)) throw new Error("Please enter a full street address.");
      if (description.trim().length < 10) throw new Error("Please describe the work needed.");
      return createJob({
        serviceType: "labor",
        movers,
        hours,
        address,
        notes: description,
        customerName: `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "Customer",
        phone: user?.phoneNumber || "",
        email: user?.email || "",
      });
    },
    onSuccess: (data) => {
      toast({ title: "Booking submitted!", description: data.message });
      onBooked(data.jobId, data.totalPrice ?? estimatedPrice);
    },
    onError: (err: any) => toast({ title: "Booking failed", description: err.message || "Please try again.", variant: "destructive" }),
  });

  const canSubmit = isValidAddress(address) && description.trim().length >= 10 && !book.isPending;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-5">
      <div>
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">How many helpers?</p>
        <div className="flex gap-2 flex-wrap">
          {MOVER_OPTIONS.map(n => (
            <button
              key={n}
              onClick={() => setMovers(n)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl border font-bold text-sm transition-all active:scale-95 ${
                movers === n
                  ? "bg-amber-500/15 border-amber-500 text-amber-300"
                  : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-600"
              }`}
            >
              <Users className="h-3.5 w-3.5" />{n}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">How many hours?</p>
        <div className="flex gap-2 flex-wrap">
          {HOUR_OPTIONS.map(h => (
            <button
              key={h}
              onClick={() => setHours(h)}
              className={`px-4 py-2 rounded-xl border font-bold text-sm transition-all active:scale-95 ${
                hours === h
                  ? "bg-amber-500/15 border-amber-500 text-amber-300"
                  : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-600"
              }`}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs text-zinc-500 font-semibold block mb-1">
          Job Address <span className="text-red-400">*</span>
        </label>
        <PlacesAutocomplete
          value={address}
          onChange={setAddress}
          onBlur={() => setAddressTouched(true)}
          placeholder="123 Main St, City, State"
          aria-label="Job address"
          inputClassName={`w-full bg-zinc-800 border rounded-xl px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none transition-colors ${
            addressError ? "border-red-500 focus:border-red-400" : "border-zinc-700 focus:border-amber-500"
          }`}
        />
        {addressError && (
          <p className="flex items-center gap-1 text-red-400 text-xs mt-1">
            <AlertCircle className="h-3 w-3" />
            Enter a full street address (e.g. 123 Main St, Ironwood, MI)
          </p>
        )}
      </div>

      <div>
        <label className="text-xs text-zinc-500 font-semibold block mb-1">
          What work is needed? <span className="text-red-400">*</span>
        </label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          onBlur={() => setDescTouched(true)}
          placeholder="e.g. Help loading a storage unit, moving furniture between rooms, yard cleanup..."
          rows={3}
          className={`w-full bg-zinc-800 border rounded-xl px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none transition-colors resize-none ${
            descError ? "border-red-500 focus:border-red-400" : "border-zinc-700 focus:border-amber-500"
          }`}
        />
        {descError && (
          <p className="flex items-center gap-1 text-red-400 text-xs mt-1">
            <AlertCircle className="h-3 w-3" />
            Please describe the work needed (at least a few words)
          </p>
        )}
      </div>

      <div className="border-t border-zinc-800 pt-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-zinc-400 text-sm font-medium">Estimated Total</span>
          <span className="text-white font-black text-xl">${estimatedPrice}</span>
        </div>
        <p className="text-zinc-600 text-xs">{movers} helper{movers > 1 ? "s" : ""} × {hours}h @ ${rate}/helper/hr · Final price confirmed on-site</p>
        <button
          onClick={() => { setAddressTouched(true); setDescTouched(true); book.mutate(); }}
          disabled={!canSubmit}
          className="w-full py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all text-white font-black text-base shadow-lg shadow-amber-500/25 flex items-center justify-center gap-2"
        >
          {book.isPending
            ? <Loader2 className="h-5 w-5 animate-spin" />
            : <><Wrench className="h-5 w-5" />Book {movers} Helper{movers > 1 ? "s" : ""} · ${estimatedPrice}</>
          }
        </button>
        <p className="text-center text-xs text-zinc-600">⚡ Most jobs booked in under 30 seconds</p>
      </div>
    </div>
  );
}

// ── Snow stub panel ───────────────────────────────────────────────────────────

function SnowPanel() {
  const [, setLocation] = useLocation();
  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-5 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center">
          <Snowflake className="h-5 w-5 text-cyan-400" />
        </div>
        <div>
          <p className="text-white font-bold">Snow Removal</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Clock className="h-3 w-3 text-zinc-500" />
            <span className="text-zinc-500 text-xs">Coming soon</span>
          </div>
        </div>
      </div>
      <p className="text-zinc-400 text-sm leading-relaxed">
        Residential and commercial snow plowing for driveways, walkways, and parking lots. Available seasonally.
      </p>
      <button
        onClick={() => setLocation("/book")}
        className="w-full py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-[0.97] transition-all text-white text-sm font-semibold flex items-center justify-center gap-2"
      >
        Post a Job Now
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

// ── Service tab definitions ───────────────────────────────────────────────────

type ServiceKey = "moving" | "junk" | "labor" | "snow";

const SERVICES: {
  key: ServiceKey;
  label: string;
  icon: typeof Truck;
  color: string;
  activeBg: string;
  ring: string;
}[] = [
  { key: "moving", label: "Moving",       icon: Truck,     color: "bg-blue-500",   activeBg: "bg-blue-500/15",   ring: "ring-blue-500"   },
  { key: "junk",   label: "Junk Removal", icon: Trash2,    color: "bg-orange-500", activeBg: "bg-orange-500/15", ring: "ring-orange-500" },
  { key: "labor",  label: "Labor Only",   icon: Wrench,    color: "bg-amber-500",  activeBg: "bg-amber-500/15",  ring: "ring-amber-500"  },
  { key: "snow",   label: "Snow Removal", icon: Snowflake, color: "bg-cyan-500",   activeBg: "bg-cyan-500/15",   ring: "ring-cyan-500"   },
];

// ── ServiceSelector ───────────────────────────────────────────────────────────

interface ServiceSelectorProps {
  defaultService?: ServiceKey;
  user?: any;
  onBooked?: (id: string, price: number) => void;
}

export default function ServiceSelector({ defaultService, user, onBooked }: ServiceSelectorProps) {
  const [active, setActive] = useState<ServiceKey>(defaultService ?? "junk");

  function handleBooked(id: string, price: number) {
    onBooked?.(id, price);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2">
        {SERVICES.map(svc => {
          const Icon = svc.icon;
          const isActive = active === svc.key;
          return (
            <button
              key={svc.key}
              onClick={() => setActive(svc.key)}
              className={`flex flex-col items-center gap-1.5 py-3 px-1 rounded-2xl border transition-all active:scale-[0.96] ${
                isActive
                  ? `${svc.activeBg} border-transparent ring-1 ${svc.ring}`
                  : "bg-zinc-900 border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                isActive ? svc.color : "bg-zinc-800"
              }`}>
                <Icon className={`h-5 w-5 ${isActive ? "text-white" : "text-zinc-400"}`} />
              </div>
              <span className={`text-[10px] font-bold leading-tight text-center ${
                isActive ? "text-white" : "text-zinc-500"
              }`}>
                {svc.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="min-h-[180px]">
        {active === "junk" && (
          <JunkFlow
            user={user}
            onBooked={handleBooked}
            onBack={() => {}}
          />
        )}
        {active === "moving" && <MovingFlow user={user} onBooked={handleBooked} />}
        {active === "labor" && <LaborFlow user={user} onBooked={handleBooked} />}
        {active === "snow" && <SnowPanel />}
      </div>

      <p className="text-center text-zinc-600 text-xs font-medium">
        ⚡ Most jobs booked in under 30 seconds
      </p>
    </div>
  );
}

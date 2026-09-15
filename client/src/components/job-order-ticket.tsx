import type { ReactNode } from "react";
import { CalendarDays, Clock3, MapPin, Users, WalletCards, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type JobOrderLine = {
  name?: string | null;
  label?: string | null;
  quantity?: number | null;
  qty?: number | null;
  total?: number | string | null;
  amount?: number | string | null;
  unitPrice?: number | string | null;
};

export type JobOrderTicketData = {
  id?: string | number;
  orderNumber?: string | number | null;
  customerName?: string | null;
  serviceType?: string | null;
  status?: string | null;
  confirmedDate?: string | null;
  moveDate?: string | null;
  arrivalWindow?: string | null;
  crewSize?: number | null;
  confirmedHours?: number | null;
  fromAddress?: string | null;
  confirmedFromAddress?: string | null;
  toAddress?: string | null;
  confirmedToAddress?: string | null;
  totalPrice?: number | string | null;
  basePrice?: number | string | null;
  estimatedTokens?: number | null;
  createdAt?: string | null;
  leadSafety?: { ageHours: number; reminder: boolean; redFlag: boolean } | null;
  lineItems?: JobOrderLine[] | null;
  orderLineItems?: JobOrderLine[] | null;
  flow?: {
    label?: string | null;
    stage?: string | null;
  } | null;
  personalEarnings?: {
    state: "estimated" | "finalized";
    hoursSource: string;
    roleOnJob: string;
    hourlyRate: number;
    hours: number;
    classificationPay: number;
    driverPremiumPay: number;
    crewBonusPay: number;
    authorityBonusPct: number;
    authorityBonusPay: number;
    totalPay: number;
    jobRevenueSharePct: number;
    authorityTier: string;
    dailyCash: { targetPercent: number; paidAmount: number; eligibleEarnings: number; remainingPayroll: number };
    tips: { cashPayroll: number; walletUsd: number; walletJcmoves: number };
    payroll: { periodKey: string | null; status: string };
    jcmoves: { status: string; amount: number };
  } | null;
};

type JobOrderTicketProps = {
  order: JobOrderTicketData;
  viewer?: "admin" | "crew" | "customer";
  action?: ReactNode;
  compact?: boolean;
  detailPage?: boolean;
  className?: string;
  onClick?: () => void;
  onScheduleEdit?: () => void;
};

function money(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) && amount > 0 ? `$${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : "TBD";
}

function exactMoney(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return (Number.isFinite(amount) ? amount : 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function displayService(value: string | null | undefined) {
  const normalized = String(value || "Service").replace(/[_-]+/g, " ").trim();
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Date to confirm";
  const normalized = value.slice(0, 10);
  const parsed = new Date(`${normalized}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? "Date to confirm"
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function ticketStatus(order: JobOrderTicketData) {
  if (order.flow?.label) return order.flow.label;
  const status = String(order.status || "").replace(/[_-]+/g, " ").trim();
  return status ? status.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Order draft";
}

function createdTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const exact = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(parsed);
  const minutes = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 60_000));
  const relative = minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
  return { exact, relative };
}

export function JobOrderTicket({ order, viewer = "admin", action, compact = false, detailPage = false, className, onClick, onScheduleEdit }: JobOrderTicketProps) {
  const total = Number(order.totalPrice ?? order.basePrice ?? 0) || 0;
  const credits = order.personalEarnings?.jcmoves.amount ?? order.estimatedTokens ?? (total > 0 ? Math.round(total * 15) : null);
  const scheduledDate = order.confirmedDate || order.moveDate;
  const address = order.confirmedFromAddress || order.fromAddress || order.confirmedToAddress || order.toAddress;
  const lines = order.lineItems || order.orderLineItems || [];
  const isInteractive = Boolean(onClick);
  const created = createdTimestamp(order.createdAt);

  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border border-slate-700/90 bg-[#10131a] text-slate-100 shadow-[0_18px_50px_rgba(0,0,0,0.24)]",
        isInteractive && "cursor-pointer transition hover:-translate-y-0.5 hover:border-cyan-400/60 hover:bg-[#131823] focus:outline-none focus:ring-2 focus:ring-cyan-400/70",
        className,
      )}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (isInteractive && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onClick?.();
        }
      }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-700/80 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-cyan-400" />
          {detailPage ? <button type="button" className="min-h-11 text-sm font-semibold" title="Copy order number" onClick={() => navigator.clipboard.writeText(`JC-${order.orderNumber ?? order.id}`)}>JC-{order.orderNumber ?? order.id}</button> : <span className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">JC ON THE MOVE</span>}
        </div>
        <span className={cn(detailPage ? "text-right text-xs font-semibold text-cyan-300" : "shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300")}>{ticketStatus(order)}</span>
      </div>

      <div className={cn("p-4", compact ? "space-y-3" : "space-y-4")}>
        {created && (!detailPage || order.leadSafety?.reminder || order.leadSafety?.redFlag) ? <div className={cn("flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[11px]", order.leadSafety?.redFlag ? "border-red-500/50 bg-red-500/10 text-red-100" : order.leadSafety?.reminder ? "border-amber-400/40 bg-amber-400/10 text-amber-100" : "border-slate-700 bg-slate-950/40 text-slate-400")}><span>Created {created.exact}</span><span className="font-bold">{order.leadSafety?.redFlag ? `RED FLAG · ${created.relative}` : order.leadSafety?.reminder ? `Contact reminder · ${created.relative}` : created.relative}</span></div> : null}
        <div>
          {!detailPage && <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            {order.orderNumber != null ? `Order JC-${order.orderNumber}` : "Job order"}
          </p>}
          {detailPage && <h1 className="text-xl font-bold [overflow-wrap:anywhere]">{order.customerName}</h1>}
          <h2 className={cn("mt-1 font-black tracking-tight text-white", compact || detailPage ? "text-base" : "text-2xl")}>{displayService(order.serviceType)}</h2>
          {!compact && !detailPage && order.customerName ? <p className="mt-1 text-sm text-slate-400">{order.customerName}</p> : null}
        </div>

        <div className={cn("grid gap-2", compact ? "grid-cols-2" : "sm:grid-cols-2")}>
          <TicketDetail readable={detailPage} icon={CalendarDays} label="Schedule" value={formatDate(scheduledDate)} onClick={onScheduleEdit} />
          <TicketDetail readable={detailPage} icon={Clock3} label="Arrival" value={order.arrivalWindow || (order.confirmedHours ? `${order.confirmedHours} hr booked` : "Time to confirm")} onClick={onScheduleEdit} />
          {!compact && <TicketDetail readable={detailPage} icon={Users} label="Crew" value={order.crewSize ? `${order.crewSize} needed` : "Crew to confirm"} />}
          {!compact && <TicketDetail readable={detailPage} icon={MapPin} label="Location" value={address || "Location to confirm"} href={detailPage && address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : undefined} />}
        </div>

        {!compact && lines.length > 0 ? (
          <div className="border-t border-slate-700/80 pt-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Order details</p>
            <div className="space-y-1.5">
              {lines.slice(0, 3).map((line, index) => (
                <div className="flex items-center justify-between gap-3 text-sm" key={`${line.name || line.label || "line"}-${index}`}>
                  <span className="min-w-0 truncate text-slate-300">{line.name || line.label || "Service"}{(line.quantity || line.qty || 1) > 1 ? ` × ${line.quantity || line.qty}` : ""}</span>
                  <span className="shrink-0 font-semibold text-slate-100">{money(line.total ?? line.amount ?? line.unitPrice)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {viewer === "crew" && order.personalEarnings ? <PersonalEarningsBreakdown earnings={order.personalEarnings} compact={compact} /> : null}
      </div>

      <div className="border-t border-slate-700/80 bg-black/20 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{viewer === "crew" ? "Estimated JCMOVES" : "Order total"}</p>
            <p className={cn("mt-0.5 font-black text-white", compact ? "text-lg" : "text-2xl")}>{viewer === "crew" && credits != null ? credits.toLocaleString() : money(total)}</p>
          </div>
          {action ? <div onClick={(event) => event.stopPropagation()}>{action}</div> : <WalletCards className="h-5 w-5 text-cyan-300" aria-hidden="true" />}
        </div>
      </div>
    </article>
  );
}

function PersonalEarningsBreakdown({ earnings, compact }: { earnings: NonNullable<JobOrderTicketData["personalEarnings"]>; compact: boolean }) {
  const role = earnings.roleOnJob.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  return (
    <div className="border-t border-slate-700/80 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Your {earnings.state} payout</p><span className="rounded-full border border-cyan-400/30 px-2 py-0.5 text-[10px] capitalize text-cyan-200">{role} · {earnings.authorityTier}</span></div>
      <p className="mt-1 text-xs text-slate-400">{earnings.hours.toFixed(2)} hours × {exactMoney(earnings.hourlyRate)} · {(earnings.jobRevenueSharePct * 100).toFixed(1)}% of job revenue</p>
      <div className={cn("mt-2 grid gap-2 text-xs", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-5")}>
        <EarningLine label="Classification" value={exactMoney(earnings.classificationPay)} />
        <EarningLine label="Driver bonus" value={exactMoney(earnings.driverPremiumPay)} />
        <EarningLine label={`${(earnings.authorityBonusPct * 100).toFixed(0)}% bonus`} value={exactMoney(earnings.authorityBonusPay)} />
        <EarningLine label="Customer tips (monthly)" value={exactMoney(earnings.tips.cashPayroll)} />
        <EarningLine label="Quarterly profit bonus" value={exactMoney(earnings.crewBonusPay)} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-950/60 px-3 py-2"><div><p className="text-[9px] uppercase tracking-wide text-slate-500">Calculated job earnings</p><p className="font-black text-emerald-300">{exactMoney(earnings.totalPay)}</p></div><div className="text-right"><p className="text-[9px] uppercase tracking-wide text-slate-500">Cash / monthly payroll</p><p className="text-xs font-semibold text-slate-200">{exactMoney(earnings.dailyCash.paidAmount)} / {exactMoney(earnings.dailyCash.remainingPayroll)}</p></div></div>
    </div>
  );
}

function EarningLine({ label, value }: { label: string; value: string }) {
  return <div className="rounded bg-slate-950/60 px-2 py-1.5"><p className="text-[9px] uppercase tracking-wide text-slate-500">{label}</p><p className="font-semibold text-slate-100">{value}</p></div>;
}

function TicketDetail({ icon: Icon, label, value, onClick, readable, href }: { icon: LucideIcon; label: string; value: string; onClick?: () => void; readable?: boolean; href?: string }) {
  const detail = <>
    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
    <div className="min-w-0 text-left">
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={cn("font-medium text-slate-200", readable ? "text-sm [overflow-wrap:anywhere]" : "truncate text-xs")}>{value}</p>
    </div>
  </>;
  if (href) return <a href={href} target="_blank" rel="noreferrer" className="flex min-h-11 min-w-0 items-start gap-2 rounded-lg bg-white/[0.035] px-2.5 py-2 hover:underline">{detail}</a>;
  if (onClick) {
    return <button type="button" onClick={onClick} className="flex min-h-11 min-w-0 items-start gap-2 rounded-lg bg-white/[0.035] px-2.5 py-2 text-left transition hover:bg-cyan-400/10 focus:outline-none focus:ring-2 focus:ring-cyan-400/70" aria-label={`Edit ${label.toLowerCase()}`}>{detail}</button>;
  }
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-lg bg-white/[0.035] px-2.5 py-2">
      {detail}
    </div>
  );
}

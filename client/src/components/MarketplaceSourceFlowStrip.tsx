import { TaskDetails } from "@/components/task-ui";
import {
  ArrowRight,
  BadgeDollarSign,
  CheckCircle2,
  ClipboardList,
  Megaphone,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  getMarketplaceSourceFlowsForContext,
  type MarketplaceActionPhase,
  type MarketplaceFunctionalIdeaStatus,
  type MarketplaceSourceFlow,
} from "@shared/marketplaceShapes";

type MarketplaceSourceFlowStripProps = {
  source?: string | null;
  shapeId?: string | null;
  serviceCode?: string | null;
  serviceLabel?: string | null;
  audience?: "customer" | "worker" | "company";
  phase?: MarketplaceActionPhase;
  className?: string;
};

const statusClasses: Record<MarketplaceFunctionalIdeaStatus, string> = {
  live: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
  in_progress: "border-blue-400/30 bg-blue-500/10 text-blue-200",
  next: "border-orange-400/30 bg-orange-500/10 text-orange-200",
};

const phaseLabels: Record<MarketplaceActionPhase, string> = {
  start: "Start",
  progress: "Progress",
  finish: "Finish",
};

const phaseIcons: Record<MarketplaceActionPhase, LucideIcon> = {
  start: ClipboardList,
  progress: ArrowRight,
  finish: CheckCircle2,
};

function statusLabel(status: MarketplaceFunctionalIdeaStatus) {
  return status.replace(/_/g, " ");
}

function phaseCue(flow: MarketplaceSourceFlow, phase: MarketplaceActionPhase) {
  if (phase === "finish") return flow.finish;
  if (phase === "progress") return flow.progress;
  return flow.start;
}

function audienceMove(flow: MarketplaceSourceFlow, audience: NonNullable<MarketplaceSourceFlowStripProps["audience"]>) {
  if (audience === "customer") return { label: "Customer move", value: flow.customerMove };
  if (audience === "worker") return { label: "Worker move", value: flow.workerMove };
  return { label: "Company control", value: flow.companyControl };
}

function stageChipClass(active: boolean) {
  return active
    ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-100"
    : "border-slate-700 bg-slate-950/50 text-slate-400";
}

function MarketplaceSourceFlowStripContent({
  source,
  shapeId,
  serviceCode,
  serviceLabel,
  audience = "company",
  phase = "start",
  className = "",
}: MarketplaceSourceFlowStripProps) {
  const [flow] = getMarketplaceSourceFlowsForContext({
    source,
    shapeId,
    serviceCode,
    serviceLabel,
    limit: 1,
  });

  if (!flow) return null;

  const ActiveIcon = phaseIcons[phase];
  const move = audienceMove(flow, audience);

  return (
    <section className={`rounded-xl border border-cyan-400/20 bg-slate-950/70 p-3 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-cyan-300">
            <Sparkles className="h-4 w-4" />
            <p className="text-[10px] font-black uppercase tracking-[0.16em]">Source flow</p>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-black text-white">{flow.source}</h3>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${statusClasses[flow.status]}`}>
              {statusLabel(flow.status)}
            </span>
          </div>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            {flow.category}
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-bold uppercase text-cyan-100">
          <ActiveIcon className="h-3.5 w-3.5" />
          {phaseLabels[phase]}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(["start", "progress", "finish"] as MarketplaceActionPhase[]).map((step) => {
          const StepIcon = phaseIcons[step];
          return (
            <span
              key={step}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${stageChipClass(step === phase)}`}
            >
              <StepIcon className="h-3 w-3" />
              {phaseLabels[step]}
            </span>
          );
        })}
      </div>

      <div className="mt-3 grid gap-2">
        <SourceFlowFact icon={ActiveIcon} label={`${phaseLabels[phase]} cue`} value={phaseCue(flow, phase)} />
        <SourceFlowFact icon={Users} label={move.label} value={move.value} />
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <SourceFlowFact icon={ShieldCheck} label="Automation" value={flow.automationHook} />
        <SourceFlowFact icon={BadgeDollarSign} label="Reward" value={flow.rewardTrigger} />
      </div>

      <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
        <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">
          <Megaphone className="h-3 w-3 text-cyan-300" />
          Borrowed signal
        </p>
        <p className="mt-1 text-[11px] leading-4 text-slate-300">{flow.borrowedSignal}</p>
      </div>
    </section>
  );
}

function SourceFlowFact({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
      <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">
        <Icon className="h-3 w-3 text-cyan-300" />
        {label}
      </p>
      <p className="mt-1 text-[11px] leading-4 text-slate-300">{value}</p>
    </div>
  );
}

export default function MarketplaceSourceFlowStrip(props:MarketplaceSourceFlowStripProps){return <TaskDetails title="Workflow help"><MarketplaceSourceFlowStripContent {...props}/></TaskDetails>;}

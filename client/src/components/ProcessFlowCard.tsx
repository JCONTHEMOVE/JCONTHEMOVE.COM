import { ArrowRight, CheckCircle2, Circle, Clock, Info } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

export type ProcessPhase = "start" | "progress" | "finish";
export type ProcessStepState = "done" | "active" | "waiting";

export type ProcessFlowStep = {
  phase: ProcessPhase;
  label: string;
  detail: string;
  state?: ProcessStepState;
  href?: string;
  actionLabel?: string;
};

const PHASE_LABELS: Record<ProcessPhase, string> = {
  start: "Start",
  progress: "Progress",
  finish: "Finish",
};

const PHASE_ORDER: ProcessPhase[] = ["start", "progress", "finish"];

function stateClasses(state: ProcessStepState) {
  if (state === "done") return "border-emerald-500/40 bg-emerald-500/15 text-emerald-100";
  if (state === "active") return "border-blue-500/40 bg-blue-500/15 text-blue-100";
  return "border-slate-700/70 bg-slate-950/50 text-slate-400";
}

function StateIcon({ state }: { state: ProcessStepState }) {
  if (state === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-300" />;
  if (state === "active") return <Clock className="h-4 w-4 text-blue-300" />;
  return <Circle className="h-4 w-4 text-slate-500" />;
}

function ProcessStepBlock({ step }: { step: ProcessFlowStep }) {
  const state = step.state || "waiting";
  const content = (
    <div className={`h-full rounded-xl border p-3 ${stateClasses(state)}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{PHASE_LABELS[step.phase]}</p>
          <p className="mt-1 text-sm font-black text-white">{step.label}</p>
        </div>
        <StateIcon state={state} />
      </div>
      <p className="mt-2 text-xs leading-relaxed opacity-80">{step.detail}</p>
      {step.href && step.actionLabel && (
        <p className="mt-3 inline-flex items-center gap-1 text-[11px] font-black text-blue-200">
          {step.actionLabel}
          <ArrowRight className="h-3 w-3" />
        </p>
      )}
    </div>
  );

  if (!step.href) return content;
  if (step.href.startsWith("#") || /^https?:\/\//i.test(step.href)) {
    return (
      <a href={step.href} target={step.href.startsWith("http") ? "_blank" : undefined} rel={step.href.startsWith("http") ? "noreferrer" : undefined}>
        {content}
      </a>
    );
  }
  return <Link href={step.href}>{content}</Link>;
}

function CompactProcessStep({ step }: { step: ProcessFlowStep }) {
  const { toast } = useToast();
  const state = step.state || "waiting";
  const isActive = state === "active";
  const action = (
    <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-3">
      <StateIcon state={state} />
      <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-slate-500">
        {PHASE_LABELS[step.phase]}
      </span>
      <span className="min-w-0 truncate text-xs font-black text-white">{step.label}</span>
      {isActive && (
        <span className="ml-auto shrink-0 rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-blue-200">
          Do now
        </span>
      )}
      {step.href && step.actionLabel && (
        <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-[10px] font-black text-blue-200">
          {step.actionLabel}
          <ArrowRight className="h-3 w-3" />
        </span>
      )}
    </div>
  );

  const actionTarget = !step.href ? action : step.href.startsWith("#") || /^https?:\/\//i.test(step.href) ? (
    <a
      className="min-w-0 flex-1"
      href={step.href}
      target={step.href.startsWith("http") ? "_blank" : undefined}
      rel={step.href.startsWith("http") ? "noreferrer" : undefined}
    >
      {action}
    </a>
  ) : (
    <Link className="min-w-0 flex-1" href={step.href}>
      {action}
    </Link>
  );

  return (
    <div
      className={`flex min-w-0 items-center rounded-lg border ${stateClasses(state)} ${
        isActive ? "ring-1 ring-blue-400/40" : ""
      }`}
    >
      {actionTarget}
      <button
        type="button"
        aria-label={`Show details for ${step.label}`}
        className="mr-1.5 shrink-0 rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
        onClick={() =>
          toast({
            title: isActive ? `Do now: ${step.label}` : step.label,
            description: step.detail,
          })
        }
      >
        <Info className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function ProcessFlowCard({
  title,
  description,
  steps,
  className = "",
  compact = true,
}: {
  title: string;
  description?: string;
  steps: ProcessFlowStep[];
  className?: string;
  compact?: boolean;
}) {
  const ordered = PHASE_ORDER.map((phase) => steps.find((step) => step.phase === phase)).filter(Boolean) as ProcessFlowStep[];

  if (compact) {
    return (
      <section className={`rounded-xl border border-slate-700/50 bg-slate-900/60 p-3 ${className}`}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="truncate text-sm font-black text-white">{title}</h2>

        </div>
        <div className="space-y-1.5">
          {ordered.map((step) => (
            <CompactProcessStep key={step.phase} step={step} />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className={`rounded-2xl border border-slate-700/50 bg-slate-900/60 p-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Process Flow</p>
          <h2 className="mt-1 text-lg font-black text-white">{title}</h2>
          {description && <p className="mt-1 text-xs leading-relaxed text-slate-400">{description}</p>}
        </div>
        <div className="hidden rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-blue-200 sm:block">
          1-2-3
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {ordered.map((step) => (
          <ProcessStepBlock key={step.phase} step={step} />
        ))}
      </div>
    </section>
  );
}

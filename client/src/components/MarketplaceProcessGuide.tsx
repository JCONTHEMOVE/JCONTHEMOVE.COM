import { TaskDetails } from "@/components/task-ui";
import { ArrowRight, CheckCircle2, ClipboardList, Route, Sparkles } from "lucide-react";
import {
  MARKETPLACE_OPERATING_FLYWHEEL,
  getMarketplaceSourceFlowsForContext,
  type MarketplaceFlywheelStage,
  type MarketplaceFlywheelStageId,
} from "@shared/marketplaceShapes";

type MarketplaceProcessGuideProps = {
  source?: string | null;
  shapeId?: string | null;
  serviceCode?: string | null;
  serviceLabel?: string | null;
  audience?: "customer" | "worker" | "company";
  compact?: boolean;
  className?: string;
};

type ProcessStep = {
  id: "start" | "progress" | "finish";
  number: string;
  label: string;
  goal: string;
  stageIds: MarketplaceFlywheelStageId[];
  flowKey: "start" | "progress" | "finish";
  icon: typeof ClipboardList;
};

const PROCESS_STEPS: ProcessStep[] = [
  {
    id: "start",
    number: "1",
    label: "Start",
    goal: "Capture the request without losing the person.",
    stageIds: ["attract", "capture", "size"],
    flowKey: "start",
    icon: ClipboardList,
  },
  {
    id: "progress",
    number: "2",
    label: "Progress",
    goal: "Price it, approve it, and put it in the right hands.",
    stageIds: ["quote", "dispatch"],
    flowKey: "progress",
    icon: Route,
  },
  {
    id: "finish",
    number: "3",
    label: "Finish",
    goal: "Complete, collect, reward, and create the next opportunity.",
    stageIds: ["complete", "collect", "retain"],
    flowKey: "finish",
    icon: CheckCircle2,
  },
];

const stageById = new Map(MARKETPLACE_OPERATING_FLYWHEEL.map((stage) => [stage.id, stage]));

function audienceAction(stage: MarketplaceFlywheelStage, audience: MarketplaceProcessGuideProps["audience"]) {
  if (audience === "customer") return stage.customerAction;
  if (audience === "worker") return stage.workerAction;
  return stage.companyAction;
}

function audienceLabel(audience: MarketplaceProcessGuideProps["audience"]) {
  if (audience === "customer") return "Customer path";
  if (audience === "worker") return "Worker path";
  return "Company path";
}

function pickStage(step: ProcessStep, flowStageIds: MarketplaceFlywheelStageId[]) {
  const fromFlow = flowStageIds.find((stageId) => step.stageIds.includes(stageId));
  return stageById.get(fromFlow || step.stageIds[0]) || MARKETPLACE_OPERATING_FLYWHEEL[0];
}

function MarketplaceProcessGuideContent({
  source,
  shapeId,
  serviceCode,
  serviceLabel,
  audience = "company",
  compact = false,
  className = "",
}: MarketplaceProcessGuideProps) {
  const [flow] = getMarketplaceSourceFlowsForContext({
    source,
    shapeId,
    serviceCode,
    serviceLabel,
    limit: 1,
  });
  const flowStageIds = flow?.flywheelStages || [];

  return (
    <section className={`rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-4 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-emerald-300">
            <Sparkles className="h-4 w-4" />
            <p className="text-[10px] font-black uppercase tracking-[0.18em]">1, 2, 3 Process</p>
          </div>
          <h2 className="mt-1 text-sm font-black text-white">{audienceLabel(audience)}</h2>
        </div>
        {flow && (
          <span className="rounded-full border border-emerald-400/30 bg-slate-950/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-200">
            {flow.source}
          </span>
        )}
      </div>

      <div className={`mt-4 grid gap-3 ${compact ? "md:grid-cols-3" : ""}`}>
        {PROCESS_STEPS.map((step) => {
          const Icon = step.icon;
          const stage = pickStage(step, flowStageIds);
          const primary = flow?.[step.flowKey] || audienceAction(stage, audience);
          const sideAction = audienceAction(stage, audience);

          return (
            <div key={step.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-black text-white">
                    {step.number}
                  </span>
                  <div>
                    <p className="text-sm font-black text-white">{step.label}</p>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{stage.label}</p>
                  </div>
                </div>
                <Icon className="h-4 w-4 shrink-0 text-emerald-300" />
              </div>

              <p className="mt-3 text-xs leading-5 text-slate-200">{primary}</p>

              {!compact && (
                <>
                  <div className="mt-3 rounded-md border border-blue-400/20 bg-blue-500/10 p-2">
                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-blue-200">Side action</p>
                    <p className="mt-1 text-[11px] leading-4 text-slate-300">{sideAction}</p>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {[
                      ["Goal", step.goal],
                      ["Proof", stage.proof],
                      ["Close", stage.rewardClose],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-md border border-slate-800 bg-slate-900/60 p-2">
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
                        <p className="mt-1 text-[11px] leading-4 text-slate-300">{value}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {flow && !compact && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-500/10 p-3 text-xs text-slate-300">
          <ArrowRight className="h-3.5 w-3.5 text-cyan-300" />
          <span className="font-bold text-cyan-200">Automation:</span>
          <span>{flow.automationHook}</span>
        </div>
      )}
    </section>
  );
}

export default function MarketplaceProcessGuide(props:MarketplaceProcessGuideProps){return <TaskDetails title="How the process works"><MarketplaceProcessGuideContent {...props}/></TaskDetails>;}

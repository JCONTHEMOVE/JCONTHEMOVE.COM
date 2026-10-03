import { TaskDetails } from "@/components/task-ui";
import {
  getMarketplaceFunctionalIdeasForShape,
  getMarketplaceSourceFlowsForContext,
  type MarketplaceRequestShape,
} from "@shared/marketplaceShapes";
import { resolveMarketplaceShape } from "@/components/MarketplaceShapeBadge";

type MarketplaceShapeContextProps = {
  shapeId?: string | null;
  serviceCode?: string | null;
  serviceLabel?: string | null;
  source?: string | null;
  audience?: "customer" | "worker" | "company";
  maxIdeas?: number;
  maxFlows?: number;
  compact?: boolean;
  showSides?: boolean;
  className?: string;
};

const statusClass = {
  live: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
  in_progress: "border-blue-400/30 bg-blue-500/10 text-blue-200",
  next: "border-orange-400/30 bg-orange-500/10 text-orange-200",
};

function primaryReality(shape: MarketplaceRequestShape, audience: MarketplaceShapeContextProps["audience"]) {
  if (audience === "customer") return { label: "Customer", value: shape.customer };
  if (audience === "worker") return { label: "Worker", value: shape.worker };
  return { label: "Company", value: shape.company };
}

function statusLabel(status: keyof typeof statusClass) {
  return status.replace(/_/g, " ");
}

function audienceFlowReality(
  flow: ReturnType<typeof getMarketplaceSourceFlowsForContext>[number],
  audience: MarketplaceShapeContextProps["audience"],
) {
  if (audience === "customer") return { label: "Customer move", value: flow.customerMove };
  if (audience === "worker") return { label: "Worker move", value: flow.workerMove };
  return { label: "Company control", value: flow.companyControl };
}

function MarketplaceShapeContextContent({
  shapeId,
  serviceCode,
  serviceLabel,
  source,
  audience = "company",
  maxIdeas = 2,
  maxFlows = 2,
  compact = false,
  showSides = true,
  className = "",
}: MarketplaceShapeContextProps) {
  const shape = resolveMarketplaceShape({ shapeId, serviceCode, serviceLabel });
  const reality = primaryReality(shape, audience);
  const ideas = getMarketplaceFunctionalIdeasForShape(shape.id).slice(0, Math.max(0, maxIdeas));
  const flows = getMarketplaceSourceFlowsForContext({
    source,
    shapeId,
    serviceCode,
    serviceLabel,
    limit: maxFlows,
  });

  if (compact) {
    const flow = flows[0];
    const flowReality = flow ? audienceFlowReality(flow, audience) : null;

    return (
      <div className={`rounded-xl border border-blue-500/20 bg-blue-500/10 p-3 ${className}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.16em] text-blue-300">Request Shape</p>
            <h3 className="mt-1 text-xs font-black text-white">{shape.shape}</h3>
          </div>
          <span className="rounded-full border border-blue-400/30 bg-slate-950/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-200">
            {reality.label}
          </span>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-300">{reality.value}</p>

        {flow && flowReality && (
          <div className="mt-2 rounded-lg border border-cyan-400/20 bg-cyan-500/10 p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-black text-slate-100">{flow.source}</p>
              <span className={`rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide ${statusClass[flow.status]}`}>
                {statusLabel(flow.status)}
              </span>
            </div>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
              {[
                ["Start", flow.start],
                ["Progress", flow.progress],
                ["Finish", flow.finish],
              ].map(([label, detail]) => (
                <div key={label} className="rounded-md border border-slate-800 bg-slate-950/50 p-2">
                  <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
                  <p className="mt-1 text-[10px] leading-4 text-slate-300">{detail}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-4 text-slate-300">
              <span className="font-bold uppercase tracking-wide text-blue-200">{flowReality.label}: </span>
              {flowReality.value}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-blue-500/20 bg-blue-500/10 p-4 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-300">Request Shape</p>
          <h3 className="mt-1 text-sm font-black text-white">{shape.shape}</h3>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{shape.references}</p>
        </div>
        <span className="rounded-full border border-blue-400/30 bg-slate-950/50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-blue-200">
          {reality.label}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-200">{reality.value}</p>

      {showSides && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {[
            ["Customer", shape.customer],
            ["Worker", shape.worker],
            ["Company", shape.company],
          ].map(([label, detail]) => (
            <div key={label} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{label}</p>
              <p className="mt-1 text-xs leading-5 text-slate-300">{detail}</p>
            </div>
          ))}
        </div>
      )}

      {ideas.length > 0 && (
        <div className="mt-3 space-y-2">
          {ideas.map((idea) => (
            <div key={idea.reference} className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-xs font-black text-slate-100">{idea.reference}</p>
                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${statusClass[idea.status]}`}>
                  {statusLabel(idea.status)}
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-300">{idea.jcMove}</p>
            </div>
          ))}
        </div>
      )}

      {flows.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">Source Flow</p>
          {flows.map((flow) => {
            const flowReality = audienceFlowReality(flow, audience);
            return (
              <div key={flow.id} className="rounded-lg border border-cyan-400/20 bg-cyan-500/10 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-black text-slate-100">{flow.source}</p>
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-200">
                      {flow.category}
                    </p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${statusClass[flow.status]}`}>
                    {statusLabel(flow.status)}
                  </span>
                </div>

                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {[
                    ["Start", flow.start],
                    ["Progress", flow.progress],
                    ["Finish", flow.finish],
                  ].map(([label, detail]) => (
                    <div key={label} className="rounded-md border border-slate-800 bg-slate-950/50 p-2">
                      <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
                      <p className="mt-1 text-[11px] leading-4 text-slate-300">{detail}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-2 rounded-md border border-blue-400/20 bg-blue-500/10 p-2">
                  <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-blue-200">{flowReality.label}</p>
                  <p className="mt-1 text-[11px] leading-4 text-slate-300">{flowReality.value}</p>
                </div>

                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md border border-slate-800 bg-slate-950/50 p-2">
                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Automation</p>
                    <p className="mt-1 text-[11px] leading-4 text-slate-300">{flow.automationHook}</p>
                  </div>
                  <div className="rounded-md border border-amber-400/20 bg-amber-500/10 p-2">
                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-amber-200">Reward</p>
                    <p className="mt-1 text-[11px] leading-4 text-slate-300">{flow.rewardTrigger}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function MarketplaceShapeContext(props:MarketplaceShapeContextProps){return <TaskDetails title="Service details"><MarketplaceShapeContextContent {...props}/></TaskDetails>;}

import { CircleCheck, Layers, TriangleAlert, CircleHelp, Check } from "lucide-react";
import type { TrainingAnswer } from "@shared/pricingTraining";

export const difficultyOptions = [
  { value: "low", label: "Low · Routine", description: "Clear access, ordinary items, straightforward handling.", Icon: CircleCheck, color: "text-emerald-300" },
  { value: "moderate", label: "Moderate · Extra effort", description: "Stairs, longer carries, or awkward items need extra planning.", Icon: Layers, color: "text-amber-300" },
  { value: "high", label: "High · Complex", description: "Heavy or fragile items, tight access, or several obstacles.", Icon: TriangleAlert, color: "text-orange-300" },
  { value: "unknown", label: "Not sure yet", description: "Missing details. Ask about items, access, or photos.", Icon: CircleHelp, color: "text-sky-300" },
] as const;

export function DifficultyChoice({ value, onChange }: { value: TrainingAnswer["difficulty"]; onChange: (value: NonNullable<TrainingAnswer["difficulty"]>) => void }) {
  return <fieldset className="min-w-0 space-y-2">
    <legend className="mb-2 font-semibold">How difficult is this job?</legend>
    <p className="text-sm text-slate-300">Rate the handling and access. Choose specialist review above if safety or skills require it.</p>
    <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
      {difficultyOptions.map(({ value: choice, label, description, Icon, color }) => <button key={choice} type="button" aria-pressed={value === choice} onClick={() => onChange(choice)} className={`relative min-h-32 rounded-xl border-2 p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 ${value === choice ? "border-blue-400 bg-blue-950" : "border-slate-700 bg-slate-900"}`}>
        <Icon aria-hidden="true" className={`mb-2 h-7 w-7 ${color}`} />
        {value === choice && <Check aria-hidden="true" className="absolute right-3 top-3 h-5 w-5 text-blue-300" />}
        <span className="block text-sm font-bold text-white">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-300">{description}</span>
      </button>)}
    </div>
  </fieldset>;
}

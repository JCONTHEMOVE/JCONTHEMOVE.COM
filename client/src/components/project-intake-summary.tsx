import { readProjectIntake, projectScheduleLabel, projectServiceLabel } from "@shared/projectRequest";

export function ProjectIntakeSummary({ details }: { details?: string | null }) {
  const intake = readProjectIntake(details);
  if (!intake) return null;
  return <div className="my-3 rounded-lg border border-blue-400/30 bg-blue-500/10 p-3 text-sm" data-testid="project-intake-summary">
    <p className="font-semibold">Project request · confirmation pending</p>
    <p className="mt-1">{projectScheduleLabel(intake)}</p>
    {intake.additionalServices.length > 0 && <p className="mt-1">Also interested in: {intake.additionalServices.map(projectServiceLabel).join(", ")}</p>}
  </div>;
}

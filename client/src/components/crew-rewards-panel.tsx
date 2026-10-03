import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { TrainingScoreboard } from '@/components/training-scoreboard';
import { WorkerPhotoAvatar } from '@/components/WorkerPhotoAvatar';
import { TaskDetails } from '@/components/task-ui';
import type { TrainingScore } from '@shared/pricingTrainingTeam';

export function CrewRewardsPanel(){
  const {user}=useAuth();
  const staff=!!user&&['employee','admin','business_owner'].includes(user.role||'');
  const scores=useQuery<{myScore:TrainingScore;leaderboard:Omit<TrainingScore,'drafts'>[];scenarios:unknown[]}>({queryKey:['/api/pricing-training-team'],enabled:staff});
  if(!staff)return null;
  return <section className="space-y-3" aria-label="Crew rewards">
    <TaskDetails title="Training leaderboard">{scores.data?<TrainingScoreboard mine={scores.data.myScore} entries={scores.data.leaderboard} total={scores.data.scenarios.length}/>:<p role="status">{scores.isError?'Standings unavailable. Open training to retry.':'Loading standings…'}</p>}<a className="inline-flex min-h-11 items-center text-blue-400 underline" href="/crew/pricing-training">Open training</a></TaskDetails>
    <TaskDetails title="Customize avatar"><WorkerPhotoAvatar/></TaskDetails>
  </section>;
}

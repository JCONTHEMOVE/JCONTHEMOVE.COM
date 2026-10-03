import { WorkerMonthlyProgress } from '@/components/worker-monthly-progress';

export default function CrewProgressPage() {
  return <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6"><h1 className="mb-6 text-2xl font-bold">Monthly progress</h1><WorkerMonthlyProgress /></main>;
}

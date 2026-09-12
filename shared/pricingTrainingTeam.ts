import type { TrainingAnswer } from './pricingTraining';

export const TRAINING_REWARDS = { contribution: 100, mostly_correct: 150, correct: 200, rejected: 0 } as const;
export type TrainingGrade = keyof typeof TRAINING_REWARDS;
export function answerDistribution(answers: TrainingAnswer[], field: keyof TrainingAnswer) {
  const counts = new Map<string, number>();
  for (const answer of answers) {
    const value = answer[field];
    if (value == null || Array.isArray(value) || typeof value === 'object') continue;
    const label = String(value);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts].sort(([a], [b]) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) ? Number(a)-Number(b) : a.localeCompare(b)).map(([label,count])=>({label,count}));
}

// Weighted marks for one subject. Raw scores only: many B-schools grade relatively, so this is not a letter grade.
import type { GradeItem } from "./types.ts";

export interface GradeSummary {
  /** Sum of all component weights (should be 100). */
  totalWeight: number;
  /** Weight of components that have a score. */
  gradedWeight: number;
  /** Percentage points of the final mark earned so far. */
  earned: number;
  /** Average score on graded work, in percent; null before anything is graded. */
  average: number | null;
  /** Average needed on the ungraded weight to reach the target; null when nothing is left. */
  needed: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function gradeSummary(items: GradeItem[], target: number): GradeSummary {
  let totalWeight = 0;
  let gradedWeight = 0;
  let earned = 0;
  for (const g of items) {
    totalWeight += g.weight;
    if (g.score === null) continue;
    gradedWeight += g.weight;
    earned += (g.score / g.max_score) * g.weight;
  }
  const remaining = totalWeight - gradedWeight;
  return {
    totalWeight: round1(totalWeight),
    gradedWeight: round1(gradedWeight),
    earned: round1(earned),
    average: gradedWeight ? round1((earned / gradedWeight) * 100) : null,
    needed: remaining > 0 ? round1(((target - earned) / remaining) * 100) : null,
  };
}

export function gradeText(s: GradeSummary, target: number): string {
  if (s.totalWeight === 0) return "";
  const remaining = round1(s.totalWeight - s.gradedWeight);
  if (s.needed === null) return `Final: ${s.earned} out of ${s.totalWeight}.`;
  if (s.needed <= 0) return `${target}% is secured, even with zero on the remaining ${remaining}%.`;
  if (s.needed > 100) return `${target}% is out of reach: the most you can finish with is ${round1(s.earned + remaining)}%.`;
  return `You need ${s.needed}% on average across the remaining ${remaining}% to finish at ${target}%.`;
}

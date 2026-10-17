import { Card, createEmptyCard, fsrs, Rating } from 'ts-fsrs';
import { ReviewInputSchema } from './contracts';
import type { z } from 'zod';

export const ALGORITHM_VERSION = 'ts-fsrs@5.4.2:retention0.90';
const scheduler = fsrs({ request_retention: 0.9, maximum_interval: 3650, enable_fuzz: false });
export function effectiveRating(input: z.infer<typeof ReviewInputSchema>) {
  // Self-report is not objectively graded. Hint-assisted answers never count as independent success.
  if (!input.selfReportCorrect || input.usedHint) return Rating.Again;
  return ({ again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy } as const)[input.selfRating];
}
export function nextReview(saved: Record<string, unknown> | null, grade: Rating, now = new Date()) {
  const card = saved && typeof saved.due === 'string'
    ? ({ ...saved, due: new Date(saved.due), last_review: saved.last_review ? new Date(String(saved.last_review)) : undefined } as unknown as Card)
    : createEmptyCard(now);
  const { card: next, log } = scheduler.next(card, now, grade);
  return { nextCard: JSON.parse(JSON.stringify(next)) as Record<string, unknown>, log: JSON.parse(JSON.stringify(log)) as Record<string, unknown>, dueAt: next.due.toISOString() };
}

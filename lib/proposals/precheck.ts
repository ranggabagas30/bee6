import { CATEGORIES, type WorkCategory } from "@/lib/pipeline/categories";
import type { ProposalFollowup } from "@/lib/firestore/schema";
import { MIN_EVIDENCE_DATES, MIN_EVIDENCE_FACTS } from "@/lib/proposals/constants";
import type { Candidate } from "@/lib/proposals/candidates";

/**
 * The plain-code evidence floor (suff-v1 `evidence` rule, technical spec
 * §8.15, thresholds confirmed by Rangga: "2 facts on 2 dates"), evaluated
 * BEFORE any model call — hard rule #10: the model never decides evidence
 * sufficiency.
 */
export function checkEvidenceFloor(all: readonly Candidate[]): {
  passed: boolean;
  facts: number;
  dates: number;
} {
  const facts = all.length;
  const dates = new Set(all.map((c) => c.local_date)).size;
  return { passed: facts >= MIN_EVIDENCE_FACTS && dates >= MIN_EVIDENCE_DATES, facts, dates };
}

/**
 * Builds the suppressed result's follow-up: up to 3 effective categories by
 * count desc (tie: `CATEGORIES` order), plus the have/need counts (the
 * "censored floor" numbers shown on the result card).
 */
export function followupFor(all: readonly Candidate[]): ProposalFollowup {
  const counts = new Map<WorkCategory, number>();
  for (const c of all) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);

  const categoryOrder = new Map(CATEGORIES.map((cat, i) => [cat, i]));
  const categories = [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return (categoryOrder.get(a[0]) ?? 0) - (categoryOrder.get(b[0]) ?? 0);
    })
    .slice(0, 3)
    .map(([cat]) => cat);

  const facts = all.length;
  const dates = new Set(all.map((c) => c.local_date)).size;

  return {
    categories,
    have_facts: facts,
    have_dates: dates,
    need_facts: MIN_EVIDENCE_FACTS,
    need_dates: MIN_EVIDENCE_DATES,
  };
}

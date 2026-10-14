import { CATEGORIES, type WorkCategory } from "@/lib/pipeline/categories";
import type { ProposalFollowup } from "@/lib/firestore/schema";
import { MIN_EVIDENCE_DATES, MIN_EVIDENCE_FACTS } from "@/lib/proposals/constants";
import type { Candidate } from "@/lib/proposals/candidates";

/**
 * The plain-code evidence floor (technical spec §8.15, floor-v2 since R-19
 * §3.2: "2 facts on 2 dates" inside ONE category), evaluated BEFORE any
 * model call — hard rule #10: the model never decides evidence sufficiency.
 */

export interface CategoryEvidence {
  category: WorkCategory;
  facts: number;
  dates: number;
  ready: boolean;
}

const CATEGORY_ORDER = new Map<WorkCategory, number>(CATEGORIES.map((cat, i) => [cat as WorkCategory, i]));

/**
 * Pure. One row per category present in `all`; `ready` iff the row alone
 * clears the floor (facts >= MIN_EVIDENCE_FACTS and distinct dates >=
 * MIN_EVIDENCE_DATES). Order: ready first, then facts desc, then dates desc,
 * then `CATEGORIES` order. Never mutates `all`.
 */
export function evidenceByCategory(all: readonly Candidate[]): CategoryEvidence[] {
  const byCategory = new Map<WorkCategory, { facts: number; dates: Set<string> }>();
  for (const c of all) {
    const row = byCategory.get(c.category);
    if (row) {
      row.facts += 1;
      row.dates.add(c.local_date);
    } else {
      byCategory.set(c.category, { facts: 1, dates: new Set([c.local_date]) });
    }
  }
  const rows: CategoryEvidence[] = [...byCategory.entries()].map(([category, { facts, dates }]) => ({
    category,
    facts,
    dates: dates.size,
    ready: facts >= MIN_EVIDENCE_FACTS && dates.size >= MIN_EVIDENCE_DATES,
  }));
  return rows.sort((a, b) => {
    if (a.ready !== b.ready) return a.ready ? -1 : 1;
    if (b.facts !== a.facts) return b.facts - a.facts;
    if (b.dates !== a.dates) return b.dates - a.dates;
    return (CATEGORY_ORDER.get(a.category) ?? 0) - (CATEGORY_ORDER.get(b.category) ?? 0);
  });
}

/**
 * `passed` iff some category row is ready. `facts` / `dates` are the FIRST
 * row's numbers (0 / 0 when there is no candidate at all): the closest
 * problem, which is what the result card shows ("1 of 2 days").
 */
export function checkEvidenceFloor(all: readonly Candidate[]): {
  passed: boolean;
  facts: number;
  dates: number;
} {
  const first = evidenceByCategory(all)[0];
  if (!first) return { passed: false, facts: 0, dates: 0 };
  return { passed: first.ready, facts: first.facts, dates: first.dates };
}

/**
 * Builds the suppressed result's follow-up: the first 3 rows' categories
 * (`evidenceByCategory` order), plus the first row's have / need counts (the
 * "censored floor" numbers shown on the result card).
 */
export function followupFor(all: readonly Candidate[]): ProposalFollowup {
  const rows = evidenceByCategory(all);
  const first = rows[0];
  return {
    categories: rows.slice(0, 3).map((r) => r.category),
    have_facts: first?.facts ?? 0,
    have_dates: first?.dates ?? 0,
    need_facts: MIN_EVIDENCE_FACTS,
    need_dates: MIN_EVIDENCE_DATES,
  };
}

import { MIN_EVIDENCE_DATES, MIN_EVIDENCE_FACTS } from "@/lib/proposals/constants";

/**
 * The single definition of "this cited thread is still a fact" (R-08 Task 5
 * step 8f, extracted by R-09). Used by generateProposal's commit, by the
 * decision transaction (Feasible / Approve) and by the list's stale notice,
 * so all three agree by construction. Plain code (hard rule #10).
 */
export interface FreshThread {
  status: "fact" | "open" | "unverified";
  excluded_from_evidence?: boolean;
  label_source?: string;
}

/** A missing thread (deleted, TTL-expired, foreign outlet, malformed) is not fresh. */
export function isFreshFact(t: FreshThread | undefined): boolean {
  return t !== undefined && t.status === "fact" && t.excluded_from_evidence !== true && t.label_source !== "supervisor_rejected";
}

export interface EvidenceRefLike {
  thread_id: string;
  local_date: string;
}

export function evidenceStillHolds(
  refs: readonly EvidenceRefLike[],
  fresh: ReadonlyMap<string, FreshThread>,
): { kept_threads: number; kept_dates: number; holds: boolean } {
  const kept = refs.filter((r) => isFreshFact(fresh.get(r.thread_id)));
  const kept_threads = new Set(kept.map((r) => r.thread_id)).size;
  const kept_dates = new Set(kept.map((r) => r.local_date)).size;
  return { kept_threads, kept_dates, holds: kept_threads >= MIN_EVIDENCE_FACTS && kept_dates >= MIN_EVIDENCE_DATES };
}

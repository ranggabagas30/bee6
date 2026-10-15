import type { SopChangeView, SopOverview, SopStepView } from "@/lib/sop/contract";

/**
 * SOP book versions (R-19 PR-9a, §9.1). Plain code, no I/O.
 *
 * GET /api/v1/sop carries the latest version's steps and the approved changes (newest first, one step each). Older
 * versions are rebuilt here by undoing each change in turn: a `modify` puts the old wording back in the same place, an
 * `add` removes the added step. The walk stops at the seed (no change for that version) or at the first version whose
 * change is not in the list (the list is capped at SOP_CHANGES_MAX), so every version shown is exact.
 */

export interface SopVersionView {
  version: number;
  /** Outlet-local business date the version is in force from; null on the seed version (not in the contract). */
  effective_from_date: string | null;
  steps: SopStepView[];
  /** The change that made this version, or null on the seed (and on an older version whose change is unavailable). */
  change: SopChangeView | null;
}

/** "dd/mm/yy" of a "YYYY-MM-DD" business date (the version switch label). */
export function shortDate(localDate: string): string {
  const [y = "", m = "", d = ""] = localDate.split("-");
  return `${d}/${m}/${y.slice(-2)}`;
}

function undo(change: SopChangeView, steps: SopStepView[]): SopStepView[] {
  const id = change.after.step_id;
  if (change.kind === "add" || change.before === null) return steps.filter((s) => s.step_id !== id);
  const before = change.before;
  return steps.map((s) => (s.step_id === id ? before : s));
}

/** Every version the overview can show exactly, newest first. */
export function buildVersions(overview: SopOverview): SopVersionView[] {
  const { latest, changes } = overview;
  if (latest === null) return [];
  const byVersion = new Map(changes.map((c) => [c.version, c]));
  const out: SopVersionView[] = [];
  let version = latest.version;
  let steps = latest.steps;
  let date: string | null = latest.effective_from_date;
  for (;;) {
    const change = byVersion.get(version) ?? null;
    out.push({ version, effective_from_date: date, steps, change });
    if (change === null || version <= 1) break;
    steps = undo(change, steps);
    version -= 1;
    const older = byVersion.get(version);
    date = older ? older.effective_from_date : null;
  }
  return out;
}

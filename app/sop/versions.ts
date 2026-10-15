import type { SopChangeView, SopOverview, SopStepView } from "@/lib/sop/contract";

/**
 * SOP book versions (R-19 PR-9a, §9.1). Plain code, no I/O.
 *
 * GET /api/v1/sop carries the latest version's steps and the approved changes (newest first, one step each). Older
 * versions are rebuilt here by undoing each change in turn: a `modify` puts the old wording back in the same place, an
 * `add` removes the added step. The walk stops at the seed (version 1, dated by `first_version_date`) or before the
 * first version whose change is not in the list (the list is capped at SOP_CHANGES_MAX, and a malformed doc is
 * skipped): a version without its change has no date to show, so only versions that can be dated are listed.
 */

export interface SopVersionView {
  version: number;
  /**
   * Outlet-local business date the version is in force from. On the seed this is `first_version_date` (its creation
   * date); null only when the overview does not carry that date.
   */
  effective_from_date: string | null;
  steps: SopStepView[];
  /** The change that made this version, or null on the seed. */
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
  const { latest, changes, first_version_date } = overview;
  if (latest === null) return [];
  const byVersion = new Map(changes.map((c) => [c.version, c]));
  const out: SopVersionView[] = [];
  let version = latest.version;
  let steps = latest.steps;
  let date: string | null = version === 1 ? first_version_date : latest.effective_from_date;
  for (;;) {
    const change = byVersion.get(version) ?? null;
    out.push({ version, effective_from_date: date, steps, change });
    if (change === null || version <= 1) break;
    steps = undo(change, steps);
    version -= 1;
    if (version === 1) {
      date = first_version_date;
      continue;
    }
    const older = byVersion.get(version);
    if (!older) break; // its change is missing, so it cannot be dated: show only versions that can be
    date = older.effective_from_date;
  }
  return out;
}

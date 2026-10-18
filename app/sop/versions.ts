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
  /**
   * Only on a tab (`tabVersions`): the changes of older versions that share this version's effective date and are
   * therefore folded into this tab (item 20). Newest first. Absent or empty otherwise.
   */
  alsoChanges?: SopChangeView[];
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

/** Where a step's current wording came from: the approved change that last touched it (PR-9b table + legend). */
export interface StepOrigin {
  version: number;
  effective_from_date: string;
  approved_date: string;
}

/**
 * The latest change at or before `shownVersion` for each step it touched, in version order newest first. Steps
 * absent from the map are "from your SOP" (never changed up to that version). Versions newer than the shown one are
 * ignored, so the seed reads as unchanged even when later versions exist.
 */
export function stepOrigins(versions: readonly SopVersionView[], shownVersion: number): Map<string, StepOrigin> {
  const out = new Map<string, StepOrigin>();
  const newestFirst = [...versions].sort((a, b) => b.version - a.version);
  for (const v of newestFirst) {
    const change = v.change;
    if (change === null || v.version > shownVersion) continue;
    const id = change.after.step_id;
    if (out.has(id)) continue;
    out.set(id, { version: v.version, effective_from_date: change.effective_from_date, approved_date: change.approved_date });
  }
  return out;
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

/**
 * Item 20 (Rangga, 18 Oct): when several versions share the same effective date (two proposals approved the same
 * day, both starting tomorrow) only the LATEST of them gets a tab. The older ones stay in `all` (nothing is deleted),
 * so the step origins, the table and the "see why it changed" cards still know about them: the tab carries the
 * hidden versions' changes in `alsoChanges`. An undated version (the seed with no known date) never merges.
 * Input and output are in the same order (SopApp holds oldest first).
 */
export function tabVersions(all: readonly SopVersionView[]): SopVersionView[] {
  const tabs: SopVersionView[] = [];
  for (const v of all) {
    const same = v.effective_from_date === null ? [] : all.filter((o) => o.effective_from_date === v.effective_from_date);
    const isTop = same.every((o) => o.version <= v.version);
    if (!isTop) continue;
    const hidden = same
      .filter((o) => o.version < v.version)
      .sort((a, b) => b.version - a.version)
      .flatMap((o) => (o.change ? [o.change] : []));
    tabs.push(hidden.length > 0 ? { ...v, alsoChanges: hidden } : v);
  }
  return tabs;
}

/** The version number of the tab that stands for `version` (itself unless a later version shares its date). */
export function tabNumberOf(all: readonly SopVersionView[], version: number): number {
  const v = all.find((o) => o.version === version);
  if (!v || v.effective_from_date === null) return version;
  return Math.max(...all.filter((o) => o.effective_from_date === v.effective_from_date).map((o) => o.version));
}

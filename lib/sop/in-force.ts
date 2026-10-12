import type { SopVersion } from "@/lib/firestore/schema";

/**
 * Latest vs in force (R-10 §1). Latest = highest version of the outlet; it
 * changes at approval. In force on a date = the highest version whose
 * effective_from_date is not after that date. Plain code, no I/O.
 */

/** Highest `version`; null for an empty list. Ties are impossible (doc id = outlet:vN). */
export function latestSop(versions: readonly SopVersion[]): SopVersion | null {
  let best: SopVersion | null = null;
  for (const v of versions) {
    if (best === null || v.version > best.version) best = v;
  }
  return best;
}

/**
 * The version in force on an outlet-local date: the highest version whose
 * effective_from_date is absent/null (a seed version) or <= localDate.
 * null if none qualifies. R-11 uses it for before/after windows.
 */
export function sopInForce(versions: readonly SopVersion[], localDate: string): SopVersion | null {
  let best: SopVersion | null = null;
  for (const v of versions) {
    const eff = v.effective_from_date ?? null;
    if (eff !== null && eff > localDate) continue; // YYYY-MM-DD compares correctly as a string
    if (best === null || v.version > best.version) best = v;
  }
  return best;
}

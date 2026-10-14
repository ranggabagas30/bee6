import { z } from "zod";
import { DEBRIEF_DONE_FLAG_KEY, DEBRIEF_DONE_SUMMARY_KEY, DEBRIEF_PROGRESS_KEY } from "@/lib/debrief/constants";

/**
 * R-19 PR-3 (`docs/tasks/R-19-demo-v2.md` §6.3, terminal done), sandbox judge devices only. On entering `done`
 * the phone writes `localStorage[DEBRIEF_DONE_FLAG_KEY] = String(endsAtMs)` plus the two counts; while the
 * flow is `closed` and the flag equals this debrief's `endsAtMs`, the done summary renders instead of the
 * entry card. Nothing here touches question ids, reasons or the device id; a storage that throws is treated
 * as "no flag" so the screen always renders.
 */

export type DoneSummary = { answered: number; skipped: number };

const SummarySchema = z.object({ answered: z.number().int().min(0), skipped: z.number().int().min(0) }).strict();

const EMPTY: DoneSummary = { answered: 0, skipped: 0 };

export function writeDoneFlag(storage: Storage, endsAtMs: number, summary: DoneSummary): void {
  try {
    storage.setItem(DEBRIEF_DONE_FLAG_KEY, String(endsAtMs));
    storage.setItem(DEBRIEF_DONE_SUMMARY_KEY, JSON.stringify(SummarySchema.parse(summary)));
  } catch {
    // quota or blocked storage: the done screen still renders; only the reload shortcut is lost
  }
}

/** The stored counts when the flag is this debrief's; null for no flag or another debrief's. */
export function readDoneFlag(storage: Storage, endsAtMs: number): DoneSummary | null {
  try {
    if (storage.getItem(DEBRIEF_DONE_FLAG_KEY) !== String(endsAtMs)) return null;
    return parseSummary(storage.getItem(DEBRIEF_DONE_SUMMARY_KEY));
  } catch {
    return null;
  }
}

/** A missing or malformed summary beside a matching flag reads as 0 / 0, never as "no flag". */
function parseSummary(raw: string | null): DoneSummary {
  if (raw === null) return EMPTY;
  try {
    const parsed = SummarySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

const ProgressSchema = z
  .object({ ends_at_ms: z.number(), answered: z.number().int().min(0), skipped: z.number().int().min(0) })
  .strict();

/** Counts so far (answered / skipped) for this debrief; written on every answer or skip. Not terminal. */
export function writeProgress(storage: Storage, endsAtMs: number, counts: DoneSummary): void {
  try {
    storage.setItem(
      DEBRIEF_PROGRESS_KEY,
      JSON.stringify(ProgressSchema.parse({ ends_at_ms: endsAtMs, answered: counts.answered, skipped: counts.skipped })),
    );
  } catch {
    // quota or blocked storage: only the reload shortcut is lost
  }
}

/** The stored counts when the record is this debrief's and well-formed; null otherwise. */
export function readProgress(storage: Storage, endsAtMs: number): DoneSummary | null {
  try {
    const raw = storage.getItem(DEBRIEF_PROGRESS_KEY);
    if (raw === null) return null;
    const parsed = ProgressSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.ends_at_ms !== endsAtMs) return null;
    return { answered: parsed.data.answered, skipped: parsed.data.skipped };
  } catch {
    return null;
  }
}

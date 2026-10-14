import { z } from "zod";
import { DEBRIEF_DONE_FLAG_KEY, DEBRIEF_DONE_SUMMARY_KEY } from "@/lib/debrief/constants";

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

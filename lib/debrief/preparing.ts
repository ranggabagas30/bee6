import type { DebriefStore } from "@/lib/debrief/service";
import { PREPARING_MAX_MS } from "@/lib/demo/constants";

/**
 * R-19 §6.2 (plain code, no AI): the sandbox `preparing` flag of `GET /api/v1/questions`, kept free of the
 * service's other imports so any caller can reuse it. "Preparing" = the device's latest ended session of the
 * debrief's business date still has text lines no finished label unit covers, and End was less than
 * PREPARING_MAX_MS ago (a stuck pipeline must not hold the judge for ever).
 */

export function isPreparing(input: { pending: number; now_ms: number; ended_at_ms: number }): boolean {
  return input.pending > 0 && input.now_ms < input.ended_at_ms + PREPARING_MAX_MS;
}

type PreparingStore = Pick<DebriefStore, "getLatestEndedSession" | "listSessionLines" | "listLabelledLineIds">;

/** Pending = text lines of the device's latest ended session of the date that no finished label unit covers. */
export async function computePreparing(
  store: PreparingStore,
  device_id: string,
  last: { business_date: string; ended_at_ms: number },
  now_ms: number,
): Promise<{ pending: number; preparing: boolean }> {
  const session = await store.getLatestEndedSession(device_id, last.business_date);
  if (!session) return { pending: 0, preparing: false };
  const [lines, labelled] = await Promise.all([
    store.listSessionLines(device_id, session.session_id),
    store.listLabelledLineIds(device_id),
  ]);
  const pending = lines.filter((l) => l.has_text && !labelled.has(l.line_id)).length;
  return { pending, preparing: isPreparing({ pending, now_ms, ended_at_ms: last.ended_at_ms }) };
}

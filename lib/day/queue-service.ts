import { assertOutlet, assertPermission } from "@/lib/auth/rbac";
import type { CustomClaims } from "@/lib/auth/roles";
import { businessDateOf } from "@/lib/capture/calendar";
import { NotFoundError } from "@/lib/http/errors";
import { QUEUE_CAP, ReviewQueueResponseSchema, type QueueItem, type ReviewQueueResponse } from "@/lib/day/contract";
import {
  toSupervisorThread,
  type DayCorrectionRow,
  type DayStore,
  type DayThreadRow,
  type QueueQuestionRow,
} from "@/lib/day/service";

/**
 * Supervisor review queue (R-06 Task 13, web spec §4.3/§6.2): "every
 * answered gate question of the last `QUEUE_LOOKBACK_DAYS` days whose
 * thread is still `open` and not supervisor-confirmed" — everything
 * waiting for a supervisor decision, across days, with the same
 * confirm/override/reject controls as the day record (`ThreadActions`).
 *
 * Task 13.3: row mapping is `lib/day/service.ts`'s shared
 * `toSupervisorThread`, the same function `getDayRecord` uses — no local
 * copy of the mapping lives here.
 */

export const QUEUE_LOOKBACK_DAYS = 14;
export const QUEUE_SCAN_LIMIT = 500;

const MS_PER_DAY = 86_400_000;

export async function getReviewQueue(
  store: Pick<DayStore, "getOutlet" | "listAnsweredGateQuestions" | "getThreads" | "getCorrections">,
  input: { claims: CustomClaims; now_ms: number; handleKey: Buffer | null },
): Promise<ReviewQueueResponse> {
  const { claims, now_ms, handleKey } = input;

  // 1. Permission: supervisor only (the owner lacks `questions:read`, staff
  // lack `day:read:evidence`, device lacks both) — before any store call.
  assertPermission(claims, "questions:read");
  assertPermission(claims, "day:read:evidence");

  // 2. Outlet.
  const outlet = await store.getOutlet();
  if (!outlet) throw new NotFoundError("outlet", claims.outlet_id);
  assertOutlet(claims, outlet.outlet_id);

  // 3. Answered gate questions in the lookback window.
  const sinceMs = now_ms - QUEUE_LOOKBACK_DAYS * MS_PER_DAY;
  const scanned = await store.listAnsweredGateQuestions(sinceMs, QUEUE_SCAN_LIMIT + 1);
  const scanTruncated = scanned.length > QUEUE_SCAN_LIMIT;
  const inWindow = scanned.slice(0, QUEUE_SCAN_LIMIT);

  // Drop any with a foreign outlet_id (defensive: the store already scopes
  // its query by outlet_id, but a malformed/foreign doc must never reach the
  // dedupe below), then dedupe by thread_id, keeping the newest answer —
  // `listAnsweredGateQuestions` returns newest-first, so the first match
  // for a given thread id is already the one to keep.
  const byThreadId = new Map<string, QueueQuestionRow>();
  for (const q of inWindow) {
    if (q.outlet_id !== claims.outlet_id) continue;
    if (!byThreadId.has(q.thread_id)) byThreadId.set(q.thread_id, q);
  }
  const candidates = [...byThreadId.values()];

  // 4. In parallel: threads, and corrections (keyed by question_id, not
  // thread_id — `corrections/{question_id}`).
  const [threads, corrections] = await Promise.all([
    store.getThreads(candidates.map((q) => q.thread_id)),
    store.getCorrections(candidates.map((q) => q.question_id)),
  ]);

  // 5. Keep only threads still waiting for a supervisor decision.
  interface Kept {
    q: QueueQuestionRow;
    thread: DayThreadRow;
    correction: DayCorrectionRow | undefined;
    date: string;
  }
  const kept: Kept[] = [];
  for (const q of candidates) {
    const thread = threads.get(q.thread_id);
    if (!thread) continue;
    if (thread.outlet_id !== claims.outlet_id) continue;
    if (thread.status !== "open") continue;
    if (thread.label_source === "supervisor_confirmed" || thread.label_source === "supervisor_rejected") {
      continue;
    }
    const effective = thread.confirmed_category ?? thread.category;
    if (effective === "NON_WORK") continue;

    const correction = corrections.get(q.question_id);
    const date = correction?.debrief_business_date ?? businessDateOf(thread.first_line_start_ms, outlet.timezone);
    kept.push({ q, thread, correction, date });
  }

  // 6-7. Sort: business date descending, then start time ascending, then
  // thread id (ordering only). Cap at QUEUE_CAP.
  kept.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.thread.first_line_start_ms !== b.thread.first_line_start_ms) {
      return a.thread.first_line_start_ms - b.thread.first_line_start_ms;
    }
    return a.thread.thread_id < b.thread.thread_id ? -1 : a.thread.thread_id > b.thread.thread_id ? 1 : 0;
  });
  const truncated = scanTruncated || kept.length > QUEUE_CAP;
  const capped = kept.slice(0, QUEUE_CAP);

  // 8. Map to response rows. `question` is built from the queue's own
  // `QueueQuestionRow` (never a spread of a stored `questions` doc), same
  // discipline as `getDayRecord`'s own build of the question map.
  const items: QueueItem[] = capped.map(({ q, thread, correction, date }, index) => ({
    ...toSupervisorThread(thread, {
      index,
      tz: outlet.timezone,
      outletId: claims.outlet_id,
      handleKey,
      question: { outlet_id: q.outlet_id, question_id: q.question_id, status: "answered", answer: q.answer },
      correction,
    }),
    date,
  }));

  // 9. Assemble + validate.
  return ReviewQueueResponseSchema.parse({ view: "supervisor_queue", items, truncated });
}

import { assertOutlet, assertPermission } from "@/lib/auth/rbac";
import type { CustomClaims } from "@/lib/auth/roles";
import { businessDateOf, localHmOf } from "@/lib/capture/calendar";
import { NotFoundError } from "@/lib/http/errors";
import { sealThreadHandle } from "@/lib/day/thread-handle";
import { deriveDisplayStatus, evidenceFor, toConfidencePct, type QuestionForStatus } from "@/lib/day/derive";
import {
  EVIDENCE_LINES_MAX,
  QUEUE_CAP,
  ReviewQueueResponseSchema,
  type QueueItem,
  type ReviewQueueResponse,
} from "@/lib/day/contract";
import type { DayCorrectionRow, DayStore, DayThreadRow, QueueQuestionRow } from "@/lib/day/service";
import type { WorkCategory } from "@/lib/pipeline/categories";

/**
 * Supervisor review queue (R-06 Task 13, web spec §4.3/§6.2): "every
 * answered gate question of the last `QUEUE_LOOKBACK_DAYS` days whose
 * thread is still `open` and not supervisor-confirmed" — everything
 * waiting for a supervisor decision, across days, with the same
 * confirm/override/reject controls as the day record (`ThreadActions`).
 *
 * TODO(PR-7 follow-up after PR-6 merges): `toQueueSupervisorRow` below is a
 * local copy of `lib/day/service.ts`'s supervisor row mapping (`getDayRecord`
 * step 11). `docs/tasks/R-06.md` Task 13.3 asks to extract that mapping into
 * a shared `toSupervisorThread` and call it from both places; PR-6 is
 * concurrently editing `getDayRecord` on `develop`, so this task (tech-lead
 * instruction) builds everything else now and leaves the extraction for a
 * short follow-up pass once PR-6 has merged and this branch is rebased. Keep
 * this function in lockstep with `getDayRecord`'s mapping until then.
 */

export const QUEUE_LOOKBACK_DAYS = 14;
export const QUEUE_SCAN_LIMIT = 500;

const MS_PER_DAY = 86_400_000;

/**
 * The supervisor-shaped fields of one queue row (everything `QueueItem` has
 * except `date`, which the caller attaches once the row's business date is
 * known). `ctx.question` is built by the caller from the queue's own
 * `QueueQuestionRow` (never a spread of a stored `questions` doc — the doc
 * carries `device_id`, which must never reach a response).
 */
function toQueueSupervisorRow(
  row: DayThreadRow,
  ctx: {
    index: number;
    tz: string;
    outletId: string;
    handleKey: Buffer | null;
    question: { status: "answered"; answer: "yes" | "no" };
    correction: DayCorrectionRow | undefined;
  },
): Omit<QueueItem, "date"> {
  const effective = (row.confirmed_category ?? row.category) as WorkCategory;
  const displayStatus = deriveDisplayStatus(row, effective, ctx.question as QuestionForStatus);

  const base = {
    row: ctx.index,
    category: effective,
    start_hm: localHmOf(row.first_line_start_ms, ctx.tz),
    end_hm: localHmOf(row.last_line_end_ms, ctx.tz),
    summary: row.summary,
    confidence_pct: toConfidencePct(row.confidence),
  };

  const { evidence, more } = evidenceFor(
    row.lines ?? [],
    row.evidence_line_ids ?? [],
    ctx.tz,
    EVIDENCE_LINES_MAX,
  );

  const staffAnswer = {
    answer: ctx.correction?.answer ?? ctx.question.answer,
    reason: ctx.correction?.reason_text ?? null,
  };

  const handle = ctx.handleKey ? sealThreadHandle(row.thread_id, ctx.outletId, ctx.handleKey) : null;
  // Every row reaching this mapper already passed the queue's own eligibility
  // filter (status "open", an answered gate question) — the only thing left
  // to decide `can_review` is whether a handle could be sealed at all.
  const canReview = handle !== null;

  const runnerUp =
    !row.runner_up || row.runner_up.category === effective
      ? null
      : {
          category: row.runner_up.category,
          why_not: row.runner_up.why_not.trim() === "" ? null : row.runner_up.why_not,
        };

  return {
    ...base,
    display_status: displayStatus,
    evidence,
    evidence_more: more,
    staff_answer: staffAnswer,
    runner_up: runnerUp,
    handle,
    can_review: canReview,
  };
}

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

  // 8. Map to response rows.
  const items: QueueItem[] = capped.map(({ q, thread, correction, date }, index) => ({
    ...toQueueSupervisorRow(thread, {
      index,
      tz: outlet.timezone,
      outletId: claims.outlet_id,
      handleKey,
      question: { status: "answered", answer: q.answer },
      correction,
    }),
    date,
  }));

  // 9. Assemble + validate.
  return ReviewQueueResponseSchema.parse({ view: "supervisor_queue", items, truncated });
}

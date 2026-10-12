import { z } from "zod";
import { CategorySchema, WorkCategorySchema } from "@/lib/pipeline/categories";
import { CaptureModeSchema } from "@/lib/capture/contract";

/**
 * Day record API contract (web spec §6.2, §6.6.5; technical spec §4.3, §4.4).
 * The server decides the view (owner vs supervisor) from the caller's role —
 * never the client. The owner shape structurally cannot carry a question,
 * correction, quoted line or any id field that embeds a device id (hard
 * rule #7): rows are keyed by position (`row`), never `thread_id` /
 * `question_id` / `device_id`.
 */

export const DAY_THREAD_CAP = 1000;
export const EVIDENCE_LINES_MAX = 20;

// Exported for `lib/home/contract.ts` (Task 14a), which reuses the same
// "business date" / "HH:MM" wire shapes rather than redefining them.
export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const hm = z.string().regex(/^\d{2}:\d{2}$/);

/** A real calendar date: "2026-02-30" fails (round-trip through Date.UTC). */
export function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const date = Number(d);
  const asUtc = new Date(Date.UTC(year, month - 1, date));
  return (
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() === month - 1 &&
    asUtc.getUTCDate() === date
  );
}

export const DayParamSchema = z.union([z.literal("today"), dateString.refine(isRealDate)]);

export const DayStatusSchema = z.enum(["closed", "on", "off", "pending"]);

export const FactStatusSchema = z.enum(["fact", "fact_staff_confirmed", "fact_supervisor_confirmed"]);

export const DisplayStatusSchema = z.enum([
  "fact",
  "fact_staff_confirmed",
  "fact_supervisor_confirmed",
  "question_open",
  "question_answered",
  "awaiting_supervisor",
  "rejected_by_staff",
  "rejected_by_supervisor", // v4: Task 15.0; never in FactStatusSchema
  "unverified",
]);

const headerBase = {
  date: dateString, // the business date shown
  today: dateString, // businessDateOf(now, outlet tz): disables "next day"
  day_status: DayStatusSchema,
  sessions_cancelled: z.number().int().min(0),
  capture_mode: CaptureModeSchema, // display only
  fact_count: z.number().int().min(0),
  truncated: z.boolean(),
};
export const OwnerDayHeaderSchema = z.object(headerBase).strict(); // no question_count (facts only)
export const SupervisorDayHeaderSchema = z
  .object({
    ...headerBase,
    question_count: z.number().int().min(0), // every non-fact row (incl. rejected, unverified)
  })
  .strict();

const threadBase = {
  row: z.number().int().min(0), // position in the sorted list; the only key
  category: WorkCategorySchema, // effective: confirmed_category ?? category
  start_hm: hm, // first_line_start_ms in outlet tz
  end_hm: hm, // last_line_end_ms in outlet tz
  summary: z.string(),
  confidence_pct: z.number().int().min(0).max(100),
};

export const OwnerThreadSchema = z.object({ ...threadBase, display_status: FactStatusSchema }).strict();

export const EvidenceLineSchema = z.object({ hm, text: z.string().min(1) }).strict();

export const StaffAnswerSchema = z
  .object({
    answer: z.enum(["yes", "no"]),
    reason: z.string().min(1).nullable(), // null when the correction doc is missing
  })
  .strict();

/** Stored text is SDP-redacted after the 200-char wire cap; tokens may lengthen it (Task 11). */
export const RUNNER_UP_WHY_NOT_MAX = 2000;

export const RunnerUpSchema = z
  .object({
    category: CategorySchema, // may be NON_WORK
    why_not: z.string().min(1).max(RUNNER_UP_WHY_NOT_MAX).nullable(), // null when the stored text is blank
  })
  .strict();

export const SupervisorThreadSchema = z
  .object({
    ...threadBase,
    display_status: DisplayStatusSchema,
    evidence: z.array(EvidenceLineSchema).max(EVIDENCE_LINES_MAX),
    evidence_more: z.number().int().min(0),
    staff_answer: StaffAnswerSchema.nullable(),
    runner_up: RunnerUpSchema.nullable(), // Task 11; supervisor-only (model reasoning about the speech)
    /** Task 10: the opaque, encrypted thread id for POST /api/v1/threads/{handle}/confirm.
     * `null` only when THREAD_HANDLE_KEY is not configured (no action is possible then). */
    handle: z.string().min(1).max(512).nullable(),
    /** Task 10: eligibility — the staff have answered this thread's question and it is not unverified. */
    can_review: z.boolean(),
  })
  .strict();

/**
 * POST /api/v1/threads/{id}/confirm body (Task 10/15; `labels:confirm`,
 * supervisor only). `reject` (v4, Task 15) takes no category — a reject
 * never needs one, and no free text (hard rule #3 needs no SDP pass
 * because nothing typed here is ever stored).
 */
export const ConfirmBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }).strict(),
  z.object({ action: z.literal("override"), category: WorkCategorySchema }).strict(),
  z.object({ action: z.literal("reject") }).strict(),
]);
export type ConfirmBody = z.infer<typeof ConfirmBodySchema>;

export const ConfirmResponseSchema = z
  .object({
    result: z.enum(["confirmed", "rejected", "unchanged"]),
    /** The row's effective category after the call (reject: unchanged). */
    category: WorkCategorySchema,
    display_status: z.enum(["fact_supervisor_confirmed", "rejected_by_supervisor"]),
  })
  .strict();
export type ConfirmResponse = z.infer<typeof ConfirmResponseSchema>;

/**
 * Task 12: an `unlabelled_unit` question (the label call never produced a
 * thread at all — no `thread_id`, no category, no evidence text). Supervisor
 * only: an unlabelled unit can never become a fact, so it never reaches the
 * owner view. `after_row` lets the client interleave these by time without a
 * shared counter; `key` is a React key only, never a question id (hard rule
 * #7: no id that embeds a device id in any response).
 */
export const UNLABELLED_CAP = 200;

export const SupervisorUnlabelledSchema = z
  .object({
    key: z.number().int().min(0), // position in `unlabelled`; React key only
    after_row: z.number().int().min(0).nullable(), // `row` of the last thread at/before this window; null = before every thread
    start_hm: hm,
    end_hm: hm,
    display_status: z.enum(["question_open", "question_answered", "unverified"]),
    staff_answer: StaffAnswerSchema.nullable(),
  })
  .strict();
export type SupervisorUnlabelled = z.infer<typeof SupervisorUnlabelledSchema>;

export const DayRecordResponseSchema = z.discriminatedUnion("view", [
  z
    .object({
      view: z.literal("owner"),
      day: OwnerDayHeaderSchema,
      threads: z.array(OwnerThreadSchema).max(DAY_THREAD_CAP),
    })
    .strict(),
  z
    .object({
      view: z.literal("supervisor"),
      day: SupervisorDayHeaderSchema,
      threads: z.array(SupervisorThreadSchema).max(DAY_THREAD_CAP),
      unlabelled: z.array(SupervisorUnlabelledSchema).max(UNLABELLED_CAP),
    })
    .strict(),
]);

export type DayRecordResponse = z.infer<typeof DayRecordResponseSchema>;
export type OwnerThread = z.infer<typeof OwnerThreadSchema>;
export type SupervisorThread = z.infer<typeof SupervisorThreadSchema>;
export type OwnerDayHeader = z.infer<typeof OwnerDayHeaderSchema>;
export type SupervisorDayHeader = z.infer<typeof SupervisorDayHeaderSchema>;

/**
 * Supervisor questions queue (R-06 Task 13, web spec §4.3/§6.2): every
 * answered gate question still waiting for a supervisor decision, across the
 * last `QUEUE_LOOKBACK_DAYS` days. One more row shape, not a new view of the
 * day record — each item is a `SupervisorThread` (same fields, same
 * `ThreadCard`/`ThreadActions`) plus the business `date` it belongs to, since
 * queue items span many days at once.
 */
export const QUEUE_CAP = 200;
export const QueueItemSchema = SupervisorThreadSchema.extend({ date: dateString }).strict();
export const ReviewQueueResponseSchema = z
  .object({
    view: z.literal("supervisor_queue"),
    items: z.array(QueueItemSchema).max(QUEUE_CAP),
    truncated: z.boolean(),
  })
  .strict();
export type QueueItem = z.infer<typeof QueueItemSchema>;
export type ReviewQueueResponse = z.infer<typeof ReviewQueueResponseSchema>;

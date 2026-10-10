import type { CustomClaims } from "@/lib/auth/roles";
import { assertOutlet, assertPermission, can } from "@/lib/auth/rbac";
import { NotFoundError, ValidationError } from "@/lib/http/errors";
import { addDays, businessDateOf, localHmOf, zonedTimeToEpochMs } from "@/lib/capture/calendar";
import { resolveWeeklyHours } from "@/lib/capture/contract";
import { captureMode } from "@/lib/devices/capture-mode";
import type { Category, WorkCategory } from "@/lib/pipeline/categories";
import { threadQuestionId } from "@/lib/pipeline/question-ids";
import { attributedBusinessDate } from "@/lib/day/attribution";
import { dayStatus } from "@/lib/day/day-status";
import { sealThreadHandle } from "@/lib/day/thread-handle";
import type { ConfirmPlan, ConfirmTxSnapshot } from "@/lib/day/confirm-service";
import {
  FACT_STATUSES,
  deriveDisplayStatus,
  evidenceFor,
  isOwnerVisible,
  toConfidencePct,
  type QuestionForStatus,
} from "@/lib/day/derive";
import {
  DAY_THREAD_CAP,
  DayParamSchema,
  DayRecordResponseSchema,
  EVIDENCE_LINES_MAX,
  UNLABELLED_CAP,
  type DayRecordResponse,
  type OwnerThread,
  type SupervisorThread,
  type SupervisorUnlabelled,
} from "@/lib/day/contract";
import type { CaptureSession, Outlet, ThreadLine } from "@/lib/firestore/schema";

/**
 * Day record service (web spec §6.2, §6.6.5; technical spec §4.3, §4.4).
 * `getDayRecord` is the only function that decides owner vs supervisor shape
 * (from the caller's role, never the client) and is the only place that may
 * call `getQuestions`/`getCorrections` — and only on the supervisor path.
 */

export interface DayThreadRow {
  outlet_id: string;
  thread_id: string;
  device_id: string;
  category: Category;
  confidence: number;
  first_line_start_ms: number;
  last_line_end_ms: number;
  summary: string;
  status: "fact" | "open" | "unverified";
  label_source?: "model" | "staff_confirmed" | "supervisor_confirmed" | "supervisor_rejected";
  confirmed_category?: Category;
  excluded_from_evidence?: boolean;
  /** Present only when `withText` was requested (supervisor path). */
  lines?: ThreadLine[];
  /** Present only when `withText` was requested (supervisor path). */
  evidence_line_ids?: string[];
  /** Present only when `withText` was requested (supervisor path). Task 11. */
  runner_up?: { category: Category; why_not: string };
}

export interface DayQuestionRow {
  outlet_id: string;
  question_id: string;
  status: "open" | "unverified" | "answered";
  answer?: "yes" | "no" | null;
}

export interface DayCorrectionRow {
  outlet_id: string;
  question_id: string;
  answer: "yes" | "no";
  reason_text: string;
}

/**
 * Task 12: an `unlabelled_unit` question row (no `thread_id`, no category —
 * the label call never produced a thread). Supervisor only.
 */
export interface DayUnlabelledRow {
  outlet_id: string;
  question_id: string;
  device_id: string;
  status: "open" | "unverified" | "answered";
  answer: "yes" | "no" | null;
  window_start_ms: number;
  window_end_ms: number;
}

/** Task 13 (`lib/day/queue-service.ts`): the narrow shape `listAnsweredGateQuestions` returns. */
export interface QueueQuestionRow {
  outlet_id: string;
  question_id: string;
  thread_id: string;
  answer: "yes" | "no";
  answered_at_ms: number;
}

export interface DayStore {
  getOutlet(): Promise<Outlet | null>;
  /** `local_date` in `dates` (<= 3 values). Malformed docs skipped. */
  listSessions(dates: readonly string[]): Promise<CaptureSession[]>;
  /** `first_line_start_ms` in `[fromMs, toMs)`, ascending, at most `limit`. Owner: `withText: false`. */
  listThreads(
    fromMs: number,
    toMs: number,
    opts: { withText: boolean; limit: number },
  ): Promise<DayThreadRow[]>;
  /** By doc id; missing, malformed or foreign-outlet docs are absent from the map. Supervisor path only. */
  getQuestions(ids: readonly string[]): Promise<Map<string, DayQuestionRow>>;
  /** By doc id (= question id). Supervisor path only. Same dropping rules. */
  getCorrections(ids: readonly string[]): Promise<Map<string, DayCorrectionRow>>;
  /**
   * `kind === "unlabelled_unit"`, `window_start_ms` in `[fromMs, toMs)`,
   * ascending, at most `limit`. Supervisor only; `getDayRecord` never calls
   * this on the owner path (Task 12, same discipline as `getQuestions`).
   */
  listUnlabelledQuestions(fromMs: number, toMs: number, limit: number): Promise<DayUnlabelledRow[]>;
  /** Devices with `outlet_id`, `revoked` false, `paired_at` non-null. */
  countPairedDevices(): Promise<number>;
  /**
   * Task 13 (`lib/day/queue-service.ts`): `kind == "gate"`, `status ==
   * "answered"`, `answered_at_ms >= sinceMs`, newest first, at most `limit`.
   * Malformed docs (null `thread_id`, a non yes/no `answer`, or a
   * non-numeric `answered_at_ms`) are dropped and logged by doc id.
   */
  listAnsweredGateQuestions(sinceMs: number, limit: number): Promise<QueueQuestionRow[]>;
  /**
   * Task 13: by thread doc id, the supervisor field mask (base fields +
   * `lines` + `evidence_line_ids` + `runner_up`). Missing, malformed or
   * foreign-outlet docs are absent from the map.
   */
  getThreads(ids: readonly string[]): Promise<Map<string, DayThreadRow>>;
}

/**
 * The confirm/override/reject write surface (R-06 Task 10.6), kept separate
 * from `DayStore` so a fake that only needs the read-only day record (e.g.
 * PR-8's owner-home tests) never has to implement it.
 */
export interface ConfirmStore {
  /**
   * One Firestore transaction (R-06 Task 10.6): re-reads the thread and its
   * question, calls `plan(snapshot)`, and on a `"write"` plan applies the
   * thread patch plus one `audit_log` entry — nothing else ever writes a
   * thread's fact/label fields (hard rule #10).
   */
  transactConfirm(
    threadId: string,
    questionId: string,
    plan: (s: ConfirmTxSnapshot) => ConfirmPlan,
  ): Promise<ConfirmPlan>;
}

function isWorkCategory(c: Category): c is WorkCategory {
  return c !== "NON_WORK";
}

/**
 * Task 12: the `row` of the last element of `sortedStartMs` (ascending) that
 * is `<= ms`, or `null` if none is (the unlabelled unit is before every
 * thread). `sortedStartMs[i]` must be the `first_line_start_ms` of the
 * thread that becomes response `row: i` (true for `kept` right after the
 * step-10 sort, before any further filtering).
 */
function lastIndexAtOrBefore(sortedStartMs: readonly number[], ms: number): number | null {
  let lo = 0;
  let hi = sortedStartMs.length - 1;
  let result: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedStartMs[mid]! <= ms) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

export async function getDayRecord(
  store: DayStore,
  input: { claims: CustomClaims; param: string; now_ms: number; handleKey?: Buffer | null },
): Promise<DayRecordResponse> {
  const { claims, param, now_ms } = input;
  const handleKey = input.handleKey ?? null;

  // 1. Permission + view.
  assertPermission(claims, "day:read:summary");
  const supervisorView = can(claims.role, "day:read:evidence");

  // 2. Outlet.
  const outlet = await store.getOutlet();
  if (!outlet) throw new NotFoundError("outlet", claims.outlet_id);
  assertOutlet(claims, outlet.outlet_id);

  // 3. Calendar context.
  const tz = outlet.timezone;
  const weekly = resolveWeeklyHours(outlet);
  const today = businessDateOf(now_ms, tz);

  // 4. Resolve + validate the date param.
  const parsedParam = DayParamSchema.safeParse(param);
  if (!parsedParam.success) {
    throw new ValidationError("invalid_date", [{ field: "date", message: "invalid_date" }]);
  }
  const date = parsedParam.data === "today" ? today : parsedParam.data;
  if (date > today) {
    throw new ValidationError("date_in_future", [{ field: "date", message: "date_in_future" }]);
  }

  // 5. The window of first-line timestamps that can attribute to `date`
  // (01:00 on D through 03:00 on D+1 — comfortably past the latest
  // possible auto-stop; the attribution check in step 8 is the real filter).
  const fromMs = zonedTimeToEpochMs(date, "01:00", tz);
  const toMs = zonedTimeToEpochMs(addDays(date, 1), "03:00", tz);

  // 6. Fetch, in parallel. Task 12: `listUnlabelledQuestions` is supervisor-only
  // — the owner path never calls it (test-enforced like `getQuestions`).
  const [sessions, raw, paired, rawUnl] = await Promise.all([
    store.listSessions([addDays(date, -1), date, addDays(date, 1)]),
    store.listThreads(fromMs, toMs, { withText: supervisorView, limit: DAY_THREAD_CAP + 1 }),
    store.countPairedDevices(),
    supervisorView
      ? store.listUnlabelledQuestions(fromMs, toMs, UNLABELLED_CAP + 1)
      : Promise.resolve([]),
  ]);

  // 7. Cap.
  const threadsTruncated = raw.length > DAY_THREAD_CAP;
  const capped = raw.slice(0, DAY_THREAD_CAP);

  // 8. Keep + compute the effective (confirmed-or-model) category.
  interface Kept {
    row: DayThreadRow;
    effective: WorkCategory;
  }
  const kept: Kept[] = [];
  for (const row of capped) {
    if (row.outlet_id !== claims.outlet_id) continue;
    const effective = row.confirmed_category ?? row.category;
    if (!isWorkCategory(effective)) continue;
    if (attributedBusinessDate(row.first_line_start_ms, sessions, tz, row.device_id) !== date) continue;
    if (!supervisorView && !isOwnerVisible(row)) continue;
    kept.push({ row, effective });
  }

  // 8b. Task 12: keep + cap unlabelled rows the same way threads are kept —
  // outlet match, then the same attribution rule (a discarded session hides
  // one too). `unlTruncated` is computed on the raw (pre-filter) fetch, same
  // discipline as the thread cap in step 7.
  const filteredUnl = supervisorView
    ? rawUnl.filter(
        (u) =>
          u.outlet_id === claims.outlet_id &&
          attributedBusinessDate(u.window_start_ms, sessions, tz, u.device_id) === date,
      )
    : [];
  const unlTruncated = rawUnl.length > UNLABELLED_CAP;
  const keptUnl = filteredUnl.slice(0, UNLABELLED_CAP);

  // 9. Supervisor-only: questions (and, for answered ones, corrections).
  // Every non-fact row AND every staff- or supervisor-confirmed fact needs
  // its question fetched: a plain model fact has no question to show, but a
  // confirmed one must still report `can_review` correctly (Task 10.5).
  // Task 12: an unlabelled row's "question" is already `listUnlabelledQuestions`'
  // own return value (no separate `getQuestions` call), but its correction
  // (when answered) is fetched in the same `getCorrections` call as threads'
  // — one call total.
  let questions: Map<string, DayQuestionRow> | undefined;
  let corrections: Map<string, DayCorrectionRow> | undefined;
  if (supervisorView) {
    const questionIds = kept
      .filter(
        (k) =>
          k.row.status !== "fact" ||
          k.row.label_source === "staff_confirmed" ||
          k.row.label_source === "supervisor_confirmed",
      )
      .map((k) => threadQuestionId(k.row.thread_id));
    questions = await store.getQuestions(questionIds);
    const threadCorrectionIds = questionIds.filter((qid) => questions!.get(qid)?.status === "answered");
    const unlCorrectionIds = keptUnl.filter((u) => u.status === "answered").map((u) => u.question_id);
    corrections = await store.getCorrections([...threadCorrectionIds, ...unlCorrectionIds]);
  }

  // 10. Sort: first_line_start_ms, then thread_id (stable; id used only for ordering).
  kept.sort((a, b) => {
    if (a.row.first_line_start_ms !== b.row.first_line_start_ms) {
      return a.row.first_line_start_ms - b.row.first_line_start_ms;
    }
    return a.row.thread_id < b.row.thread_id ? -1 : a.row.thread_id > b.row.thread_id ? 1 : 0;
  });

  // 11. Map to response rows.
  const threads: (OwnerThread | SupervisorThread)[] = kept.map(({ row, effective }, index) => {
    const qid = threadQuestionId(row.thread_id);
    const question = questions?.get(qid);
    const displayStatus = deriveDisplayStatus(row, effective, question as QuestionForStatus | undefined);

    const base = {
      row: index,
      category: effective,
      start_hm: localHmOf(row.first_line_start_ms, tz),
      end_hm: localHmOf(row.last_line_end_ms, tz),
      summary: row.summary,
      confidence_pct: toConfidencePct(row.confidence),
    };

    if (!supervisorView) {
      return { ...base, display_status: displayStatus } as OwnerThread;
    }

    const { evidence, more } = evidenceFor(
      row.lines ?? [],
      row.evidence_line_ids ?? [],
      tz,
      EVIDENCE_LINES_MAX,
    );
    const correction = corrections?.get(qid);
    const staffAnswer =
      question?.status === "answered" && (question.answer === "yes" || question.answer === "no")
        ? { answer: correction?.answer ?? question.answer, reason: correction?.reason_text ?? null }
        : null;

    // Task 10.5: the opaque handle a supervisor's confirm/override/reject
    // call names this thread by, and the eligibility rule computed from it —
    // the staff must have answered the question, and the thread must not be
    // unverified (docs/tasks/R-06.md Task 10, "Eligibility rule").
    const handle = handleKey ? sealThreadHandle(row.thread_id, claims.outlet_id, handleKey) : null;
    const canReview = handle !== null && row.status !== "unverified" && question?.status === "answered";

    // Task 11: a runner-up equal to the chosen category is not a "second
    // choice" at all (either absent, or it became the chosen category after
    // a staff/supervisor confirmed_category) — null in both cases.
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
    } as SupervisorThread;
  });

  // 11b. Task 12: map unlabelled rows. Sort by window_start_ms, then
  // question_id (ordering only — never put the id in the response).
  // `keptStartMs[i]` is the `first_line_start_ms` of the thread mapped to
  // `row: i` above (the step-10 sort order, unchanged since).
  const keptStartMs = kept.map((k) => k.row.first_line_start_ms);
  const unlabelled: SupervisorUnlabelled[] = supervisorView
    ? [...keptUnl]
        .sort((a, b) => {
          if (a.window_start_ms !== b.window_start_ms) return a.window_start_ms - b.window_start_ms;
          return a.question_id < b.question_id ? -1 : a.question_id > b.question_id ? 1 : 0;
        })
        .map((u, index) => {
          const correction = corrections?.get(u.question_id);
          const staffAnswer =
            u.status === "answered" && (u.answer === "yes" || u.answer === "no")
              ? { answer: correction?.answer ?? u.answer, reason: correction?.reason_text ?? null }
              : null;
          const displayStatus =
            u.status === "open" ? "question_open" : u.status === "answered" ? "question_answered" : "unverified";
          return {
            key: index,
            after_row: lastIndexAtOrBefore(keptStartMs, u.window_start_ms),
            start_hm: localHmOf(u.window_start_ms, tz),
            end_hm: localHmOf(u.window_end_ms, tz),
            display_status: displayStatus,
            staff_answer: staffAnswer,
          } as SupervisorUnlabelled;
        })
    : [];

  // 12. Header.
  const factCount = threads.filter((t) => FACT_STATUSES.has(t.display_status)).length;
  const sessionsCancelled = sessions.filter(
    (s) => s.local_date === date && s.end_reason === "discarded",
  ).length;
  const truncated = threadsTruncated || unlTruncated;

  const dayHeaderBase = {
    date,
    today,
    day_status: dayStatus(date, weekly, tz, sessions, now_ms),
    sessions_cancelled: sessionsCancelled,
    capture_mode: captureMode(paired),
    fact_count: factCount,
    truncated,
  };

  // 13. Assemble + validate.
  if (!supervisorView) {
    return DayRecordResponseSchema.parse({
      view: "owner",
      day: dayHeaderBase,
      threads,
    });
  }
  return DayRecordResponseSchema.parse({
    view: "supervisor",
    day: { ...dayHeaderBase, question_count: threads.length - factCount + unlabelled.length },
    threads,
    unlabelled,
  });
}

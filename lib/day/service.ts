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
  type DayRecordResponse,
  type OwnerThread,
  type SupervisorThread,
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
  label_source?: "model" | "staff_confirmed";
  confirmed_category?: Category;
  excluded_from_evidence?: boolean;
  /** Present only when `withText` was requested (supervisor path). */
  lines?: ThreadLine[];
  /** Present only when `withText` was requested (supervisor path). */
  evidence_line_ids?: string[];
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
  /** Devices with `outlet_id`, `revoked` false, `paired_at` non-null. */
  countPairedDevices(): Promise<number>;
}

function isWorkCategory(c: Category): c is WorkCategory {
  return c !== "NON_WORK";
}

export async function getDayRecord(
  store: DayStore,
  input: { claims: CustomClaims; param: string; now_ms: number },
): Promise<DayRecordResponse> {
  const { claims, param, now_ms } = input;

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

  // 6. Fetch, in parallel.
  const [sessions, raw, paired] = await Promise.all([
    store.listSessions([addDays(date, -1), date, addDays(date, 1)]),
    store.listThreads(fromMs, toMs, { withText: supervisorView, limit: DAY_THREAD_CAP + 1 }),
    store.countPairedDevices(),
  ]);

  // 7. Cap.
  const truncated = raw.length > DAY_THREAD_CAP;
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

  // 9. Supervisor-only: questions (and, for answered ones, corrections).
  let questions: Map<string, DayQuestionRow> | undefined;
  let corrections: Map<string, DayCorrectionRow> | undefined;
  if (supervisorView) {
    const questionIds = kept
      .filter((k) => k.row.status !== "fact" || k.row.label_source === "staff_confirmed")
      .map((k) => threadQuestionId(k.row.thread_id));
    questions = await store.getQuestions(questionIds);
    const correctionIds = questionIds.filter((qid) => questions!.get(qid)?.status === "answered");
    corrections = await store.getCorrections(correctionIds);
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

    return {
      ...base,
      display_status: displayStatus,
      evidence,
      evidence_more: more,
      staff_answer: staffAnswer,
    } as SupervisorThread;
  });

  // 12. Header.
  const factCount = threads.filter((t) => FACT_STATUSES.has(t.display_status)).length;
  const sessionsCancelled = sessions.filter(
    (s) => s.local_date === date && s.end_reason === "discarded",
  ).length;

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
    day: { ...dayHeaderBase, question_count: threads.length - factCount },
    threads,
  });
}

import type { DebriefQuestionView } from "@/lib/debrief/contract";
import type { SupervisorThread, SupervisorUnlabelled } from "@/lib/day/contract";
import type { DisplayStatus } from "@/lib/day/derive";
import { STATUS_KEY, type TimelineItem } from "@/lib/day/view-model";
import type { DictKey } from "@/lib/i18n/dict";
import type { PillTone } from "@/app/ui";
import type { WorkCategory } from "@/lib/pipeline/categories";

/**
 * Pure derivations for the day record screen (R-25 T9, ruling R16). Everything here reads fields the day record
 * response already carries (no new data, no coverage figure: the API has none). No React, no I/O.
 */

/** Three-letter chip code per work category. The visible name always sits next to it (the chip is a scan aid). */
export const CATEGORY_CODE: Record<WorkCategory, string> = {
  ROUTINE_OPS: "RTN",
  CUSTOMER_SERVICE: "CST",
  TRAINING: "TRN",
  STAFF_CONSULT: "SCQ",
  CORRECTION: "COR",
  PHONE_CALL: "PHN",
  EVENT: "EVT",
  COMPLAINT: "CMP",
  SAFETY_INCIDENT: "SAF",
  SECURITY_INCIDENT: "SEC",
  DISRUPTION: "DIS",
};

/** A row that is already a fact (so Confirm has nothing to do). Same rule `ThreadActions` uses for its buttons. */
export function isFactStatus(status: DisplayStatus): boolean {
  return status === "fact" || status === "fact_staff_confirmed" || status === "fact_supervisor_confirmed";
}

/**
 * The supervisor still has a decision to make on this thread: the server says it is reviewable (staff answered, not
 * unverified, handle present) and it is neither a fact yet nor already rejected by a supervisor. Mirrors the rows on
 * which `ThreadActions` offers Confirm.
 */
export function needsCheck(thread: SupervisorThread): boolean {
  return (
    thread.can_review &&
    thread.handle !== null &&
    !isFactStatus(thread.display_status) &&
    thread.display_status !== "rejected_by_supervisor"
  );
}

/**
 * The pill on a note row. A row the supervisor still has to decide reads "Needs your check" (amber); a plain fact
 * reads "Auto-labelled"; every other status keeps its own `C-day-st-*` words. The tone only tints, the words carry it.
 */
export function statusPill(status: DisplayStatus, check: boolean): { tone: PillTone; key: DictKey } {
  if (check) return { tone: "amber", key: "C-day2-pill-check" };
  switch (status) {
    case "fact":
      return { tone: "neutral", key: "C-day2-pill-auto" };
    case "fact_staff_confirmed":
    case "fact_supervisor_confirmed":
      return { tone: "green", key: STATUS_KEY[status] };
    case "rejected_by_staff":
    case "rejected_by_supervisor":
      return { tone: "red", key: STATUS_KEY[status] };
    case "unverified":
      return { tone: "amber", key: STATUS_KEY[status] };
    default:
      return { tone: "neutral", key: STATUS_KEY[status] };
  }
}

const QUESTION_STATUSES: ReadonlySet<DisplayStatus> = new Set([
  "question_open",
  "question_answered",
  "awaiting_supervisor",
  "rejected_by_staff",
  "unverified",
  "fact_staff_confirmed",
]);

/** The debrief asked something about this thread (it has an answer, or a status only a question produces). */
export function hasQuestion(thread: SupervisorThread): boolean {
  return thread.staff_answer !== null || QUESTION_STATUSES.has(thread.display_status);
}

export type DebriefOutcome = "yes" | "no" | "unverified" | "open";

/** What the staff debrief row says. An answer wins; otherwise the status tells yes / no / unverified / still open. */
export function debriefOutcome(row: {
  staff_answer: SupervisorThread["staff_answer"];
  display_status: DisplayStatus;
}): DebriefOutcome {
  if (row.staff_answer !== null) return row.staff_answer.answer;
  // The correction doc can be missing (staff_answer null) on a row staff already decided: the status still says how.
  if (row.display_status === "rejected_by_staff") return "no";
  if (
    row.display_status === "fact_staff_confirmed" ||
    row.display_status === "awaiting_supervisor" ||
    row.display_status === "question_answered"
  ) {
    return "yes";
  }
  return row.display_status === "unverified" ? "unverified" : "open";
}

export interface DebriefRow {
  /** React key. Rows are keyed by position, never by a question or device id. */
  key: string;
  kind: "gate" | "unlabelled_unit";
  category: WorkCategory | null;
  start_hm: string;
  end_hm: string;
  reason: string | null;
  outcome: DebriefOutcome;
}

/**
 * The staff debrief rows, in timeline order: every thread or unlabelled moment the debrief asked about. The reason is
 * the already-redacted text the thread card used to show; nothing is added.
 */
export function debriefRows(timeline: readonly TimelineItem<SupervisorThread>[]): DebriefRow[] {
  const rows: DebriefRow[] = [];
  for (const item of timeline) {
    if (item.kind === "thread") {
      const th = item.thread;
      if (!hasQuestion(th)) continue;
      rows.push({
        key: `t-${th.row}`,
        kind: "gate",
        category: th.category,
        start_hm: th.start_hm,
        end_hm: th.end_hm,
        reason: th.staff_answer?.reason ?? null,
        outcome: debriefOutcome(th),
      });
    } else {
      const u = item.item;
      rows.push({
        key: `u-${u.key}`,
        kind: "unlabelled_unit",
        category: null,
        start_hm: u.start_hm,
        end_hm: u.end_hm,
        reason: u.staff_answer?.reason ?? null,
        outcome: debriefOutcome(u),
      });
    }
  }
  return rows;
}

/** The shape `category-labels` builds a question from; only the enum code and the two HH:MM strings are read. */
export function rowQuestionView(row: DebriefRow): DebriefQuestionView {
  return {
    question_id: "day-record",
    kind: row.kind,
    category: row.category,
    start_hm: row.start_hm,
    end_hm: row.end_hm,
  };
}

export interface DaySummary {
  notes: number;
  unlabelled: number;
  asked: number;
  answered: number;
  unverified: number;
  open: number;
  /** Threads that need a decision plus unlabelled moments still open. */
  check: number;
  /** The first thread needing a decision, for the tile's detail line (null when none). */
  firstCheck: SupervisorThread | null;
}

/** The three tiles' numbers (R16). */
export function summarize(
  threads: readonly SupervisorThread[],
  unlabelled: readonly SupervisorUnlabelled[],
): DaySummary {
  const rows = debriefRows([
    ...threads.map((thread): TimelineItem<SupervisorThread> => ({ kind: "thread", thread })),
    ...unlabelled.map((item): TimelineItem<SupervisorThread> => ({ kind: "unlabelled", item })),
  ]);
  const checks = threads.filter(needsCheck);
  const openUnlabelled = unlabelled.filter((u) => u.display_status === "question_open").length;
  return {
    notes: threads.length,
    unlabelled: unlabelled.length,
    asked: rows.length,
    answered: rows.filter((r) => r.outcome === "yes" || r.outcome === "no").length,
    unverified: rows.filter((r) => r.outcome === "unverified").length,
    open: rows.filter((r) => r.outcome === "open").length,
    check: checks.length + openUnlabelled,
    firstCheck: checks[0] ?? null,
  };
}

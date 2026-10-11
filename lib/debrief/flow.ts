import type { DebriefQuestionView } from "@/lib/debrief/contract";
import { DEBRIEF_SHOW_MAX, REASON_MAX_CHARS } from "@/lib/debrief/constants";
import { reasonLength } from "@/lib/debrief/reason";

/**
 * The debrief state machine (R-07 Task 7.1, `docs/tasks/R-07-plan.md`). Pure:
 * every transition is a function of the current state and one event, so it is
 * unit-tested without Firestore, `fetch` or a browser. `/capture` is the only
 * caller (`useReducer(reduceDebrief, ...)`); this module knows nothing about
 * Mulai, Selesai or the shop's opening-hours calendar (see the grep test in
 * `flow.test.ts`, which checks this file imports no such module).
 */

export type DebriefView =
  | { kind: "closed" }
  | { kind: "loading" }
  | { kind: "load_error" }
  | { kind: "empty" }
  | {
      kind: "question";
      list: DebriefQuestionView[];
      index: number;
      choice: "yes" | "no" | null;
      reason: string;
      save_error: boolean;
      /** Count of this device's own answers committed so far this debrief (carries into "done"). */
      answered: number;
      /** Count of this device's own skips so far this debrief (carries into "done"). */
      skipped: number;
    }
  | { kind: "done"; answered: number; skipped: number }
  | { kind: "timed_out"; ended_at_ms: number };

export type DebriefState = {
  view: DebriefView;
  ends_at_ms: number;
  business_date: string | null;
};

export type DebriefEvent =
  | { type: "OPEN" }
  | { type: "RETRY" }
  | { type: "LOADED"; questions: DebriefQuestionView[]; business_date: string; cached: ReadonlySet<string> }
  | { type: "LOAD_FAILED" }
  /**
   * R-18 (sandbox only): a re-fetch of the list while it is on screen. `seen` holds every id any earlier
   * response already offered, so a skipped question is never offered twice.
   */
  | { type: "REFRESHED"; questions: DebriefQuestionView[]; cached: ReadonlySet<string>; seen: ReadonlySet<string> }
  | { type: "CHOOSE"; answer: "yes" | "no" }
  | { type: "TYPE"; reason: string }
  | { type: "COMMITTED" }
  | { type: "COMMIT_FAILED" }
  | { type: "SKIP" }
  | { type: "BACK" }
  | { type: "TICK"; now_ms: number };

type QuestionView = Extract<DebriefView, { kind: "question" }>;

function freshQuestion(
  list: DebriefQuestionView[],
  index: number,
  answered: number,
  skipped: number,
): QuestionView {
  return {
    kind: "question",
    list,
    index,
    choice: null,
    reason: "",
    save_error: false,
    answered,
    skipped,
  };
}

/** `question` with a choice and a reason of 1 to 500 trimmed code points. */
export function canCommit(v: DebriefView): boolean {
  if (v.kind !== "question") return false;
  if (v.choice === null) return false;
  const n = reasonLength(v.reason);
  return n >= 1 && n <= REASON_MAX_CHARS;
}

export function reduceDebrief(s: DebriefState, e: DebriefEvent): DebriefState {
  switch (e.type) {
    case "OPEN":
    case "RETRY":
      return { ...s, view: { kind: "loading" } };

    case "LOADED": {
      // A late GET response (the view already moved on — e.g. TICK fired
      // `timed_out` first) must never replace whatever is on screen now.
      if (s.view.kind !== "loading") return s;
      const filtered = e.questions
        .filter((item) => !e.cached.has(item.question_id))
        .slice(0, DEBRIEF_SHOW_MAX);
      const view: DebriefView =
        filtered.length === 0 ? { kind: "empty" } : freshQuestion(filtered, 0, 0, 0);
      return { ...s, business_date: e.business_date, view };
    }

    case "LOAD_FAILED":
      // Same race as LOADED above: a late failure must not override a view
      // that already moved on (e.g. a timeout that beat the GET).
      if (s.view.kind !== "loading") return s;
      return { ...s, view: { kind: "load_error" } };

    case "REFRESHED": {
      const v = s.view;
      if (v.kind !== "empty" && v.kind !== "question" && v.kind !== "done") return s;
      const inList = new Set(v.kind === "question" ? v.list.map((item) => item.question_id) : []);
      const fresh = e.questions.filter(
        (item) => !e.cached.has(item.question_id) && !e.seen.has(item.question_id) && !inList.has(item.question_id),
      );
      if (v.kind === "question") {
        const room = DEBRIEF_SHOW_MAX - v.list.length;
        const add = fresh.slice(0, Math.max(0, room));
        if (add.length === 0) return s;
        return { ...s, view: { ...v, list: [...v.list, ...add] } };
      }
      const add = fresh.slice(0, DEBRIEF_SHOW_MAX);
      if (add.length === 0) return s;
      const answered = v.kind === "done" ? v.answered : 0;
      const skipped = v.kind === "done" ? v.skipped : 0;
      return { ...s, view: freshQuestion(add, 0, answered, skipped) };
    }

    case "CHOOSE": {
      if (s.view.kind !== "question") return s;
      return { ...s, view: { ...s.view, choice: e.answer } };
    }

    case "TYPE": {
      if (s.view.kind !== "question") return s;
      return { ...s, view: { ...s.view, reason: e.reason } };
    }

    case "COMMITTED": {
      if (s.view.kind !== "question") return s;
      const { list, index, answered, skipped } = s.view;
      const nextAnswered = answered + 1;
      const nextIndex = index + 1;
      const view: DebriefView =
        nextIndex >= list.length
          ? { kind: "done", answered: nextAnswered, skipped }
          : freshQuestion(list, nextIndex, nextAnswered, skipped);
      return { ...s, view };
    }

    case "COMMIT_FAILED": {
      if (s.view.kind !== "question") return s;
      return { ...s, view: { ...s.view, save_error: true } };
    }

    case "SKIP": {
      if (s.view.kind !== "question") return s;
      const { list, index, answered, skipped } = s.view;
      const nextSkipped = skipped + 1;
      const nextIndex = index + 1;
      const view: DebriefView =
        nextIndex >= list.length
          ? { kind: "done", answered, skipped: nextSkipped }
          : freshQuestion(list, nextIndex, answered, nextSkipped);
      return { ...s, view };
    }

    case "BACK": {
      const closable: ReadonlyArray<DebriefView["kind"]> = ["done", "empty", "timed_out", "load_error"];
      if (!closable.includes(s.view.kind)) return s;
      return { ...s, view: { kind: "closed" } };
    }

    case "TICK": {
      if (s.view.kind === "closed") return s;
      if (e.now_ms < s.ends_at_ms) return s;
      return { ...s, view: { kind: "timed_out", ended_at_ms: s.ends_at_ms } };
    }
  }
}

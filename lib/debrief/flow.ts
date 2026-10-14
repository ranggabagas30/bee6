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
 *
 * R-19 PR-3 (`docs/tasks/R-19-demo-v2.md` §6.3), demo sandbox only (`demo: true`): the server labels the
 * judge's moments 2-4 min after End, so the list is never frozen at OPEN. While the server says `preparing`,
 * an exhausted list lands on `waiting_more` (never `done`), an empty list on `preparing`, and a refresh that
 * brings fresh questions re-enters `question`; the cap is DEBRIEF_SHOW_MAX per debrief (every id ever
 * offered), not per list. `demo: false` keeps every pilot transition exactly as it was.
 */

export type DebriefView =
  | { kind: "closed" }
  | { kind: "loading" }
  | { kind: "load_error" }
  | { kind: "empty" }
  /** R-19 demo: no question yet and the server is still labelling today's notes. */
  | { kind: "preparing" }
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
  /** R-19 demo: every offered question is answered or skipped, but the server may still add more. */
  | { kind: "waiting_more"; answered: number; skipped: number }
  | { kind: "done"; answered: number; skipped: number }
  | { kind: "timed_out"; ended_at_ms: number };

export type DebriefState = {
  view: DebriefView;
  ends_at_ms: number;
  business_date: string | null;
  /** Ids this debrief actually put in front of the device (R-18 refresh never offers one twice). */
  seen: ReadonlySet<string>;
  /** R-19: true only for a sandbox judge device; false on every pilot phone. */
  demo: boolean;
  /** R-19 (demo): the last `preparing` the server reported; always false on the pilot. */
  preparing: boolean;
};

export type DebriefEvent =
  | { type: "OPEN" }
  | { type: "RETRY" }
  | {
      type: "LOADED";
      questions: DebriefQuestionView[];
      business_date: string;
      cached: ReadonlySet<string>;
      /** R-19 (demo): the server's `preparing`; absent on the pilot (read as false). */
      preparing?: boolean;
      /**
       * R-19 (demo): counts and acted-on ids stored by this phone for this debrief before a reload. The ids
       * seed `seen`, so a skipped question is not offered twice and the cap of 5 holds across the reload.
       * Absent on the pilot and on a first open (read as 0 / 0 / none).
       */
      progress?: { answered: number; skipped: number; seen?: readonly string[] };
    }
  | { type: "LOAD_FAILED" }
  /**
   * R-18 (sandbox only): a re-fetch of the list while it is on screen. The reducer's own `seen` set (only
   * the ids it actually offered) keeps a skipped question from being offered twice, and an id that did not
   * fit under DEBRIEF_SHOW_MAX stays unseen so a later refresh can offer it.
   */
  | { type: "REFRESHED"; questions: DebriefQuestionView[]; cached: ReadonlySet<string>; preparing?: boolean }
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

/** The view after the last offered question is answered or skipped. */
function afterLast(s: DebriefState, answered: number, skipped: number): DebriefView {
  // Demo: waiting makes sense only while the server may still add something AND there is room to show it.
  return s.demo && s.preparing && s.seen.size < DEBRIEF_SHOW_MAX ? { kind: "waiting_more", answered, skipped } : { kind: "done", answered, skipped };
}

/**
 * The ids to persist with the counts: every id in `seen` that this device answered or skipped. Offered questions
 * not yet touched (the rest of the current list) are left out, so a reload still offers them.
 */
export function actedIds(s: DebriefState): string[] {
  const untouched = new Set(s.view.kind === "question" ? s.view.list.slice(s.view.index).map((item) => item.question_id) : []);
  return [...s.seen].filter((id) => !untouched.has(id));
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
      const preparing = s.demo && e.preparing === true;
      const stored = new Set<string>(s.demo ? (e.progress?.seen ?? []) : []);
      const room = Math.max(0, DEBRIEF_SHOW_MAX - stored.size);
      const filtered = e.questions
        .filter((item) => !e.cached.has(item.question_id) && !stored.has(item.question_id))
        .slice(0, room);
      const answered = s.demo ? (e.progress?.answered ?? 0) : 0;
      const skipped = s.demo ? (e.progress?.skipped ?? 0) : 0;
      const seen = new Set([...stored, ...filtered.map((item) => item.question_id)]);
      let view: DebriefView;
      if (filtered.length > 0) view = freshQuestion(filtered, 0, answered, skipped);
      else if (!s.demo) view = { kind: "empty" };
      // Nothing left to offer: the server is done, or the cap of 5 is spent (nothing more can be shown).
      else if (!preparing || seen.size >= DEBRIEF_SHOW_MAX) view = { kind: "done", answered, skipped };
      // A reload after some answers: the judge was already past "Preparing", so resume at "Checking for more".
      else view = answered + skipped > 0 ? { kind: "waiting_more", answered, skipped } : { kind: "preparing" };
      return { ...s, business_date: e.business_date, view, seen, preparing };
    }

    case "LOAD_FAILED":
      // Same race as LOADED above: a late failure must not override a view
      // that already moved on (e.g. a timeout that beat the GET).
      if (s.view.kind !== "loading") return s;
      return { ...s, view: { kind: "load_error" } };

    case "REFRESHED": {
      const v = s.view;
      const refreshable: ReadonlyArray<DebriefView["kind"]> = s.demo
        ? ["question", "preparing", "waiting_more"]
        : ["empty", "question", "done"];
      if (!refreshable.includes(v.kind)) return s;
      const preparing = s.demo && e.preparing === true;
      const base = preparing === s.preparing ? s : { ...s, preparing };
      const fresh = e.questions.filter((item) => !e.cached.has(item.question_id) && !s.seen.has(item.question_id));
      const markSeen = (add: DebriefQuestionView[]) => new Set([...s.seen, ...add.map((item) => item.question_id)]);
      if (v.kind === "question") {
        // Demo: the cap is DEBRIEF_SHOW_MAX per debrief (every id offered so far), so a list that restarted after
        // waiting_more cannot offer five more. Pilot: the R-18 per-list room, unchanged.
        const room = s.demo ? DEBRIEF_SHOW_MAX - s.seen.size : DEBRIEF_SHOW_MAX - v.list.length;
        const add = fresh.slice(0, Math.max(0, room));
        if (add.length === 0) return base;
        return { ...base, view: { ...v, list: [...v.list, ...add] }, seen: markSeen(add) };
      }
      const room = s.demo ? DEBRIEF_SHOW_MAX - s.seen.size : DEBRIEF_SHOW_MAX;
      const add = fresh.slice(0, Math.max(0, room));
      const answered = v.kind === "done" || v.kind === "waiting_more" ? v.answered : 0;
      const skipped = v.kind === "done" || v.kind === "waiting_more" ? v.skipped : 0;
      if (add.length === 0) {
        // Demo: a quiet refresh after the server stopped preparing, or with the cap spent (nothing more can be
        // shown), closes the debrief.
        if (s.demo && (!preparing || room <= 0) && (v.kind === "preparing" || v.kind === "waiting_more")) {
          return { ...base, view: { kind: "done", answered, skipped } };
        }
        return base;
      }
      return { ...base, view: freshQuestion(add, 0, answered, skipped), seen: markSeen(add) };
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
          ? afterLast(s, nextAnswered, skipped)
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
          ? afterLast(s, answered, nextSkipped)
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

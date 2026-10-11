import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canCommit, reduceDebrief, type DebriefState, type DebriefView } from "@/lib/debrief/flow";
import type { DebriefQuestionView } from "@/lib/debrief/contract";
import { DEBRIEF_SHOW_MAX } from "@/lib/debrief/constants";

/**
 * `reduceDebrief` (R-07 Task 7.1, `docs/tasks/R-07-plan.md`): the pure
 * debrief state machine. No Firestore, no browser, no Mulai/calendar
 * knowledge — only the shapes the page and screens need.
 */

function q(id: string, overrides: Partial<DebriefQuestionView> = {}): DebriefQuestionView {
  return {
    question_id: id,
    kind: "gate",
    category: "ROUTINE_OPS",
    start_hm: "15:00",
    end_hm: "15:10",
    ...overrides,
  };
}

const CLOSED: DebriefState = { view: { kind: "closed" }, ends_at_ms: 10_000, business_date: null };

describe("reduceDebrief: OPEN / RETRY", () => {
  it("OPEN from closed goes to loading", () => {
    const next = reduceDebrief(CLOSED, { type: "OPEN" });
    expect(next.view).toEqual({ kind: "loading" });
  });

  it("RETRY from load_error goes to loading", () => {
    const s: DebriefState = { ...CLOSED, view: { kind: "load_error" } };
    const next = reduceDebrief(s, { type: "RETRY" });
    expect(next.view).toEqual({ kind: "loading" });
  });
});

describe("reduceDebrief: REFRESHED (R-18 check for new questions)", () => {
  const ev = (questions: DebriefQuestionView[], cached: string[] = [], seen: string[] = []) =>
    ({ type: "REFRESHED", questions, cached: new Set(cached), seen: new Set(seen) }) as const;
  const onQuestion = (ids: string[], index = 0): DebriefState => ({
    ...CLOSED,
    business_date: "2026-10-07",
    view: {
      kind: "question",
      list: ids.map((id) => q(id)),
      index,
      choice: "yes",
      reason: "typing",
      save_error: false,
      answered: 1,
      skipped: 0,
    },
  });

  it("empty -> question when new questions arrived (cached and seen ids are not new)", () => {
    const s: DebriefState = { ...CLOSED, view: { kind: "empty" } };
    const next = reduceDebrief(s, ev([q("a"), q("b"), q("c")], ["a"], ["b"]));
    const view = next.view as Extract<DebriefView, { kind: "question" }>;
    expect(view.kind).toBe("question");
    expect(view.list.map((x) => x.question_id)).toEqual(["c"]);
    expect(view.index).toBe(0);
  });

  it("empty stays empty (same object) when nothing is new", () => {
    const s: DebriefState = { ...CLOSED, view: { kind: "empty" } };
    expect(reduceDebrief(s, ev([q("a")], ["a"]))).toBe(s);
  });

  it("question: new ids are appended; the current index, choice and typed reason are untouched", () => {
    const s = onQuestion(["a", "b"], 1);
    const next = reduceDebrief(s, ev([q("a"), q("b"), q("c")], [], ["a", "b"]));
    const view = next.view as Extract<DebriefView, { kind: "question" }>;
    expect(view.list.map((x) => x.question_id)).toEqual(["a", "b", "c"]);
    expect(view.index).toBe(1);
    expect(view.choice).toBe("yes");
    expect(view.reason).toBe("typing");
    expect(view.answered).toBe(1);
  });

  it("question: never re-adds an id already in the list, and never grows past DEBRIEF_SHOW_MAX", () => {
    const s = onQuestion(["a", "b", "c", "d"]);
    const more = [q("a"), q("e"), q("f"), q("g")];
    const view = reduceDebrief(s, ev(more)).view as Extract<DebriefView, { kind: "question" }>;
    expect(view.list.map((x) => x.question_id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(view.list).toHaveLength(DEBRIEF_SHOW_MAX);
  });

  it("question: nothing new returns the same state object", () => {
    const s = onQuestion(["a"]);
    expect(reduceDebrief(s, ev([q("a")]))).toBe(s);
  });

  it("done -> question for the new ones, keeping the answered and skipped counts; a skipped id is not new", () => {
    const s: DebriefState = { ...CLOSED, view: { kind: "done", answered: 2, skipped: 1 } };
    const next = reduceDebrief(s, ev([q("skipped"), q("fresh")], [], ["skipped"]));
    const view = next.view as Extract<DebriefView, { kind: "question" }>;
    expect(view.kind).toBe("question");
    expect(view.list.map((x) => x.question_id)).toEqual(["fresh"]);
    expect(view.answered).toBe(2);
    expect(view.skipped).toBe(1);
  });

  it("done stays done when only seen ids come back", () => {
    const s: DebriefState = { ...CLOSED, view: { kind: "done", answered: 2, skipped: 1 } };
    expect(reduceDebrief(s, ev([q("skipped")], [], ["skipped"]))).toBe(s);
  });

  it("ignored in closed, loading, load_error and timed_out (a late response never replaces the screen)", () => {
    for (const view of [
      { kind: "closed" },
      { kind: "loading" },
      { kind: "load_error" },
      { kind: "timed_out", ended_at_ms: 1 },
    ] as const) {
      const s: DebriefState = { ...CLOSED, view };
      expect(reduceDebrief(s, ev([q("x")]))).toBe(s);
    }
  });
});

describe("reduceDebrief: LOADED", () => {
  const loading: DebriefState = { ...CLOSED, view: { kind: "loading" } };

  it("filters cached ids and caps at DEBRIEF_SHOW_MAX", () => {
    const questions = Array.from({ length: 8 }, (_, i) => q(`q${i}`));
    const next = reduceDebrief(loading, {
      type: "LOADED",
      questions,
      business_date: "2026-10-07",
      cached: new Set(["q0", "q1"]),
    });
    expect(next.view.kind).toBe("question");
    const view = next.view as Extract<DebriefView, { kind: "question" }>;
    expect(view.list).toHaveLength(DEBRIEF_SHOW_MAX);
    expect(view.list.map((item) => item.question_id)).toEqual(["q2", "q3", "q4", "q5", "q6"]);
    expect(view.index).toBe(0);
    expect(view.choice).toBeNull();
    expect(view.reason).toBe("");
    expect(view.save_error).toBe(false);
    expect(next.business_date).toBe("2026-10-07");
  });

  it("an empty filtered list goes to empty, not question", () => {
    const next = reduceDebrief(loading, {
      type: "LOADED",
      questions: [q("q0")],
      business_date: "2026-10-07",
      cached: new Set(["q0"]),
    });
    expect(next.view).toEqual({ kind: "empty" });
    expect(next.business_date).toBe("2026-10-07");
  });

  it("a genuinely empty list goes to empty", () => {
    const next = reduceDebrief(loading, {
      type: "LOADED",
      questions: [],
      business_date: "2026-10-07",
      cached: new Set(),
    });
    expect(next.view).toEqual({ kind: "empty" });
  });
});

describe("reduceDebrief: LOAD_FAILED", () => {
  it("goes to load_error", () => {
    const loading: DebriefState = { ...CLOSED, view: { kind: "loading" } };
    const next = reduceDebrief(loading, { type: "LOAD_FAILED" });
    expect(next.view).toEqual({ kind: "load_error" });
  });
});

describe("reduceDebrief: LOADED/LOAD_FAILED ignore a late GET once the view moved on", () => {
  it("a late LOADED does not replace timed_out (same object)", () => {
    const s: DebriefState = { ...CLOSED, view: { kind: "timed_out", ended_at_ms: 10_000 } };
    const next = reduceDebrief(s, {
      type: "LOADED",
      questions: [q("q0")],
      business_date: "2026-10-07",
      cached: new Set(),
    });
    expect(next).toBe(s);
  });

  it("a late LOAD_FAILED does not replace timed_out (same object)", () => {
    const s: DebriefState = { ...CLOSED, view: { kind: "timed_out", ended_at_ms: 10_000 } };
    const next = reduceDebrief(s, { type: "LOAD_FAILED" });
    expect(next).toBe(s);
  });
});

function questionState(overrides: Partial<Extract<DebriefView, { kind: "question" }>> = {}): DebriefState {
  return {
    ...CLOSED,
    view: {
      kind: "question",
      list: [q("q0"), q("q1")],
      index: 0,
      choice: null,
      reason: "",
      save_error: false,
      answered: 0,
      skipped: 0,
      ...overrides,
    } as Extract<DebriefView, { kind: "question" }>,
  };
}

describe("reduceDebrief: CHOOSE", () => {
  it("sets the choice and keeps the reason, never advancing", () => {
    const s = questionState({ reason: "sudah" });
    const next = reduceDebrief(s, { type: "CHOOSE", answer: "yes" });
    const view = next.view as Extract<DebriefView, { kind: "question" }>;
    expect(view.choice).toBe("yes");
    expect(view.reason).toBe("sudah");
    expect(view.index).toBe(0);
  });

  it("switching the choice keeps the typed reason", () => {
    const s = questionState({ choice: "yes", reason: "sudah" });
    const next = reduceDebrief(s, { type: "CHOOSE", answer: "no" });
    const view = next.view as Extract<DebriefView, { kind: "question" }>;
    expect(view.choice).toBe("no");
    expect(view.reason).toBe("sudah");
  });

  it("does nothing outside a question view (same object)", () => {
    const next = reduceDebrief(CLOSED, { type: "CHOOSE", answer: "yes" });
    expect(next).toBe(CLOSED);
  });
});

describe("reduceDebrief: TYPE", () => {
  it("replaces the reason verbatim, no trim, no cap", () => {
    const s = questionState();
    const next = reduceDebrief(s, { type: "TYPE", reason: "  a".repeat(300) });
    const view = next.view as Extract<DebriefView, { kind: "question" }>;
    expect(view.reason).toBe("  a".repeat(300));
  });

  it("does nothing outside a question view (same object)", () => {
    const next = reduceDebrief(CLOSED, { type: "TYPE", reason: "x" });
    expect(next).toBe(CLOSED);
  });
});

describe("reduceDebrief: COMMITTED", () => {
  it("advances to the next index with a blank choice and reason", () => {
    const s = questionState({ choice: "yes", reason: "sudah", list: [q("q0"), q("q1")] });
    const next = reduceDebrief(s, { type: "COMMITTED" });
    const view = next.view as Extract<DebriefView, { kind: "question" }>;
    expect(view.index).toBe(1);
    expect(view.choice).toBeNull();
    expect(view.reason).toBe("");
    expect(view.save_error).toBe(false);
  });

  it("reaching the end of the list goes to done with the answered count", () => {
    const s = questionState({ choice: "yes", reason: "sudah", list: [q("q0")], index: 0 });
    const next = reduceDebrief(s, { type: "COMMITTED" });
    expect(next.view).toEqual({ kind: "done", answered: 1, skipped: 0 });
  });

  it("does nothing outside a question view (same object)", () => {
    const next = reduceDebrief(CLOSED, { type: "COMMITTED" });
    expect(next).toBe(CLOSED);
  });
});

describe("reduceDebrief: COMMIT_FAILED", () => {
  it("sets save_error and keeps choice and reason", () => {
    const s = questionState({ choice: "no", reason: "lupa" });
    const next = reduceDebrief(s, { type: "COMMIT_FAILED" });
    const view = next.view as Extract<DebriefView, { kind: "question" }>;
    expect(view.save_error).toBe(true);
    expect(view.choice).toBe("no");
    expect(view.reason).toBe("lupa");
    expect(view.index).toBe(0);
  });
});

describe("reduceDebrief: SKIP", () => {
  it("discards choice and reason, advances, counts as skipped", () => {
    const s = questionState({ choice: "yes", reason: "sudah", list: [q("q0"), q("q1")] });
    const next = reduceDebrief(s, { type: "SKIP" });
    const view = next.view as Extract<DebriefView, { kind: "question" }>;
    expect(view.index).toBe(1);
    expect(view.choice).toBeNull();
    expect(view.reason).toBe("");
  });

  it("reaching the end goes to done with the skipped count", () => {
    const s = questionState({ list: [q("q0")], index: 0 });
    const next = reduceDebrief(s, { type: "SKIP" });
    expect(next.view).toEqual({ kind: "done", answered: 0, skipped: 1 });
  });
});

describe("reduceDebrief: BACK", () => {
  it("goes from done to closed", () => {
    const s: DebriefState = { ...CLOSED, view: { kind: "done", answered: 1, skipped: 0 } };
    const next = reduceDebrief(s, { type: "BACK" });
    expect(next.view).toEqual({ kind: "closed" });
  });

  it("goes from empty to closed", () => {
    const s: DebriefState = { ...CLOSED, view: { kind: "empty" } };
    expect(reduceDebrief(s, { type: "BACK" }).view).toEqual({ kind: "closed" });
  });

  it("goes from timed_out to closed", () => {
    const s: DebriefState = { ...CLOSED, view: { kind: "timed_out", ended_at_ms: 10_000 } };
    expect(reduceDebrief(s, { type: "BACK" }).view).toEqual({ kind: "closed" });
  });

  it("goes from load_error to closed", () => {
    const s: DebriefState = { ...CLOSED, view: { kind: "load_error" } };
    expect(reduceDebrief(s, { type: "BACK" }).view).toEqual({ kind: "closed" });
  });

  it("does nothing from a question view (same object)", () => {
    const s = questionState();
    expect(reduceDebrief(s, { type: "BACK" })).toBe(s);
  });
});

describe("reduceDebrief: TICK", () => {
  it("at or after ends_at_ms, moves any open view to timed_out with no reason in state", () => {
    const s = questionState({ choice: "yes", reason: "ini alasan" });
    const next = reduceDebrief(s, { type: "TICK", now_ms: s.ends_at_ms });
    expect(next.view).toEqual({ kind: "timed_out", ended_at_ms: s.ends_at_ms });
  });

  it("before ends_at_ms returns the exact same state object", () => {
    const s = questionState();
    const next = reduceDebrief(s, { type: "TICK", now_ms: s.ends_at_ms - 1 });
    expect(next).toBe(s);
  });

  it("from closed, TICK never changes anything even past ends_at_ms", () => {
    const next = reduceDebrief(CLOSED, { type: "TICK", now_ms: CLOSED.ends_at_ms + 1 });
    expect(next).toBe(CLOSED);
  });

  it("fires from loading, empty, done and load_error too", () => {
    for (const view of [{ kind: "loading" }, { kind: "empty" }, { kind: "load_error" }, { kind: "done", answered: 0, skipped: 0 }] as DebriefView[]) {
      const s: DebriefState = { ...CLOSED, view };
      const next = reduceDebrief(s, { type: "TICK", now_ms: s.ends_at_ms });
      expect(next.view).toEqual({ kind: "timed_out", ended_at_ms: s.ends_at_ms });
    }
  });
});

describe("canCommit", () => {
  it("false with no choice", () => {
    const view: DebriefView = { kind: "question", list: [q("q0")], index: 0, choice: null, reason: "a", save_error: false, answered: 0, skipped: 0 } as never;
    expect(canCommit(view)).toBe(false);
  });

  it("false with whitespace-only reason", () => {
    const view = { kind: "question", list: [q("q0")], index: 0, choice: "yes", reason: "   ", save_error: false, answered: 0, skipped: 0 } as DebriefView;
    expect(canCommit(view)).toBe(false);
  });

  it("true with a choice and a non-empty trimmed reason", () => {
    const view = { kind: "question", list: [q("q0")], index: 0, choice: "yes", reason: "a", save_error: false, answered: 0, skipped: 0 } as DebriefView;
    expect(canCommit(view)).toBe(true);
  });

  it("false over 500 trimmed code points", () => {
    const view = {
      kind: "question",
      list: [q("q0")],
      index: 0,
      choice: "yes",
      reason: "a".repeat(501),
      save_error: false,
      answered: 0,
      skipped: 0,
    } as DebriefView;
    expect(canCommit(view)).toBe(false);
  });

  it("true at exactly 500 trimmed code points", () => {
    const view = {
      kind: "question",
      list: [q("q0")],
      index: 0,
      choice: "yes",
      reason: "a".repeat(500),
      save_error: false,
      answered: 0,
      skipped: 0,
    } as DebriefView;
    expect(canCommit(view)).toBe(true);
  });

  it("false outside a question view", () => {
    expect(canCommit({ kind: "closed" })).toBe(false);
    expect(canCommit({ kind: "done", answered: 0, skipped: 0 })).toBe(false);
  });
});

describe("flow.ts has no Mulai/calendar knowledge", () => {
  it("does not import the capture calendar module", () => {
    const path = fileURLToPath(new URL("./flow.ts", import.meta.url));
    const importLines = readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trimStart().startsWith("import"));
    const calendarPath = ["lib", "capture", "calendar"].join("/");
    for (const line of importLines) {
      expect(line).not.toContain(calendarPath);
    }
  });
});

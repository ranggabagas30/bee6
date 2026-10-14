import { describe, expect, it } from "vitest";
import { reduceDebrief, type DebriefState, type DebriefView } from "@/lib/debrief/flow";
import type { DebriefQuestionView } from "@/lib/debrief/contract";

/**
 * R-19 PR-3 (`docs/tasks/R-19-demo-v2.md` §6): the demo debrief never ends on a Yes. The sandbox labels the
 * judge's own moments 2-4 min after End, so the list at OPEN is usually 0-2 items; answering them must land
 * on "waiting for more" while the server still says `preparing`, never on "done". Pilot (`demo: false`)
 * transitions are covered by `flow.test.ts`, which this PR leaves as it was.
 */

function q(id: string, overrides: Partial<DebriefQuestionView> = {}): DebriefQuestionView {
  return { question_id: id, kind: "gate", category: "ROUTINE_OPS", start_hm: "15:00", end_hm: "15:10", ...overrides };
}

const DEMO_CLOSED: DebriefState = {
  view: { kind: "closed" },
  ends_at_ms: 10_000,
  business_date: null,
  seen: new Set(),
  demo: true,
  preparing: false,
};

const DATE = "2026-10-07";

function run(start: DebriefState, events: Parameters<typeof reduceDebrief>[1][]): DebriefState {
  return events.reduce(reduceDebrief, start);
}

const loaded = (questions: DebriefQuestionView[], preparing: boolean) =>
  ({ type: "LOADED", questions, business_date: DATE, cached: new Set<string>(), preparing }) as const;
const refreshed = (questions: DebriefQuestionView[], preparing: boolean, cached: string[] = []) =>
  ({ type: "REFRESHED", questions, cached: new Set(cached), preparing }) as const;

type QuestionView = Extract<DebriefView, { kind: "question" }>;
const ids = (s: DebriefState) => (s.view as QuestionView).list.map((x) => x.question_id);

describe("D0: Yes never ends the demo debrief", () => {
  it("LOADED with 1 question while preparing, CHOOSE yes, TYPE, COMMITTED -> waiting_more (not done)", () => {
    const s = run(DEMO_CLOSED, [
      { type: "OPEN" },
      loaded([q("a")], true),
      { type: "CHOOSE", answer: "yes" },
      { type: "TYPE", reason: "ok" },
      { type: "COMMITTED" },
    ]);
    expect(s.view.kind).toBe("waiting_more");
    expect(s.view).toEqual({ kind: "waiting_more", answered: 1, skipped: 0 });
  });

  it("SKIP at the end of the list while preparing -> waiting_more with the skipped count", () => {
    const s = run(DEMO_CLOSED, [{ type: "OPEN" }, loaded([q("a")], true), { type: "SKIP" }]);
    expect(s.view).toEqual({ kind: "waiting_more", answered: 0, skipped: 1 });
  });

  it("COMMITTED at the end of the list when the server is no longer preparing -> done", () => {
    const s = run(DEMO_CLOSED, [
      { type: "OPEN" },
      loaded([q("a")], false),
      { type: "CHOOSE", answer: "yes" },
      { type: "TYPE", reason: "ok" },
      { type: "COMMITTED" },
    ]);
    expect(s.view).toEqual({ kind: "done", answered: 1, skipped: 0 });
  });

  it("mid-list COMMITTED still advances to the next question (preparing or not)", () => {
    const s = run(DEMO_CLOSED, [
      { type: "OPEN" },
      loaded([q("a"), q("b")], true),
      { type: "CHOOSE", answer: "yes" },
      { type: "TYPE", reason: "ok" },
      { type: "COMMITTED" },
    ]);
    expect(s.view.kind).toBe("question");
    expect((s.view as QuestionView).index).toBe(1);
  });
});

describe("LOADED (demo): preparing and empty", () => {
  it("0 questions and preparing -> the preparing view; state remembers preparing", () => {
    const s = run(DEMO_CLOSED, [{ type: "OPEN" }, loaded([], true)]);
    expect(s.view).toEqual({ kind: "preparing" });
    expect(s.preparing).toBe(true);
    expect(s.business_date).toBe(DATE);
  });

  it("0 questions and not preparing -> terminal done with 0/0 (renders 'No questions today')", () => {
    const s = run(DEMO_CLOSED, [{ type: "OPEN" }, loaded([], false)]);
    expect(s.view).toEqual({ kind: "done", answered: 0, skipped: 0 });
    expect(s.preparing).toBe(false);
  });

  it("questions and preparing -> question view, preparing kept in state", () => {
    const s = run(DEMO_CLOSED, [{ type: "OPEN" }, loaded([q("a")], true)]);
    expect(s.view.kind).toBe("question");
    expect(s.preparing).toBe(true);
  });

  it("pilot (demo false): 0 questions is still `empty`, whatever the event says", () => {
    const pilot: DebriefState = { ...DEMO_CLOSED, demo: false };
    expect(run(pilot, [{ type: "OPEN" }, loaded([], true)]).view).toEqual({ kind: "empty" });
    expect(run(pilot, [{ type: "OPEN" }, { type: "LOADED", questions: [], business_date: DATE, cached: new Set() }]).view).toEqual({ kind: "empty" });
  });
});

describe("REFRESHED (demo): preparing / waiting_more", () => {
  const preparing = run(DEMO_CLOSED, [{ type: "OPEN" }, loaded([], true)]);
  const waiting = run(DEMO_CLOSED, [{ type: "OPEN" }, loaded([q("a")], true), { type: "SKIP" }]);

  it("preparing -> question when fresh questions arrive (0 answered, 0 skipped)", () => {
    const s = reduceDebrief(preparing, refreshed([q("b")], true));
    expect(s.view.kind).toBe("question");
    expect(ids(s)).toEqual(["b"]);
    expect((s.view as QuestionView).answered).toBe(0);
  });

  it("preparing -> stays preparing while the server still prepares and nothing arrived", () => {
    const s = reduceDebrief(preparing, refreshed([], true));
    expect(s.view).toEqual({ kind: "preparing" });
  });

  it("preparing -> done 0/0 when nothing arrived and the server stopped preparing", () => {
    const s = reduceDebrief(preparing, refreshed([], false));
    expect(s.view).toEqual({ kind: "done", answered: 0, skipped: 0 });
    expect(s.preparing).toBe(false);
  });

  it("waiting_more -> question for the fresh ones, keeping the answered and skipped counts; a seen id is not fresh", () => {
    const s = reduceDebrief(waiting, refreshed([q("a"), q("c")], true));
    expect(s.view.kind).toBe("question");
    expect(ids(s)).toEqual(["c"]);
    expect((s.view as QuestionView).skipped).toBe(1);
  });

  it("waiting_more -> stays waiting_more while preparing and nothing is fresh", () => {
    const s = reduceDebrief(waiting, refreshed([q("a")], true));
    expect(s.view).toEqual({ kind: "waiting_more", answered: 0, skipped: 1 });
  });

  it("waiting_more -> done when nothing is fresh and the server stopped preparing", () => {
    const s = reduceDebrief(waiting, refreshed([q("a")], false));
    expect(s.view).toEqual({ kind: "done", answered: 0, skipped: 1 });
  });

  it("a cached (answered, not yet acked) id is not fresh either", () => {
    const s = reduceDebrief(waiting, refreshed([q("z")], false, ["z"]));
    expect(s.view).toEqual({ kind: "done", answered: 0, skipped: 1 });
  });

  it("the event's preparing flag updates the state even when the view does not change", () => {
    const s = reduceDebrief(waiting, refreshed([q("a")], true));
    expect(s.preparing).toBe(true);
    const list = run(DEMO_CLOSED, [{ type: "OPEN" }, loaded([q("a")], true)]);
    expect(reduceDebrief(list, refreshed([q("a")], false)).preparing).toBe(false);
  });
});

describe("cap 5 per debrief across refreshes (demo)", () => {
  it("two answered, then five arrive: only three are offered; later arrivals are never offered once five were", () => {
    const two = run(DEMO_CLOSED, [
      { type: "OPEN" },
      loaded([q("a"), q("b")], true),
      { type: "SKIP" },
      { type: "SKIP" },
    ]);
    expect(two.view.kind).toBe("waiting_more");
    const five = [q("c"), q("d"), q("e"), q("f"), q("g")];
    const after = reduceDebrief(two, refreshed(five, true));
    expect(ids(after)).toEqual(["c", "d", "e"]);
    expect(after.seen.size).toBe(5);
    const exhausted = run(after, [{ type: "SKIP" }, { type: "SKIP" }, { type: "SKIP" }]);
    expect(exhausted.view).toEqual({ kind: "waiting_more", answered: 0, skipped: 5 });
    // f and g are still unseen on the server but the cap is spent: nothing is added, and once the server
    // stops preparing the debrief is done.
    expect(reduceDebrief(exhausted, refreshed(five, true)).view).toEqual({ kind: "waiting_more", answered: 0, skipped: 5 });
    expect(reduceDebrief(exhausted, refreshed(five, false)).view).toEqual({ kind: "done", answered: 0, skipped: 5 });
  });

  it("on the question view the room is 5 minus every id offered so far, not 5 minus the current list", () => {
    const first = run(DEMO_CLOSED, [{ type: "OPEN" }, loaded([q("a"), q("b"), q("c")], true), { type: "SKIP" }, { type: "SKIP" }, { type: "SKIP" }]);
    const second = reduceDebrief(first, refreshed([q("d")], true)); // list restarts with d; 4 offered so far
    expect(ids(second)).toEqual(["d"]);
    const third = reduceDebrief(second, refreshed([q("e"), q("f")], true));
    expect(ids(third)).toEqual(["d", "e"]);
  });
});

describe("TICK (demo) fires from the new views", () => {
  it("preparing and waiting_more time out at ends_at_ms", () => {
    for (const view of [{ kind: "preparing" }, { kind: "waiting_more", answered: 1, skipped: 0 }] as DebriefView[]) {
      const s: DebriefState = { ...DEMO_CLOSED, view };
      expect(reduceDebrief(s, { type: "TICK", now_ms: s.ends_at_ms }).view).toEqual({
        kind: "timed_out",
        ended_at_ms: s.ends_at_ms,
      });
    }
  });
});

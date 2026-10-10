import { describe, expect, it } from "vitest";
import { DictKey, ID } from "@/lib/i18n/dict";
import { CATEGORIES, type WorkCategory } from "@/lib/pipeline/categories";
import type { DisplayStatus } from "@/lib/day/derive";
import type { SupervisorUnlabelled } from "@/lib/day/contract";
import {
  CATEGORY_KEY,
  RUNNER_UP_KEY,
  STATUS_KEY,
  buildTimeline,
  categoryOptions,
  filterThreads,
} from "@/lib/day/view-model";

const ALL_DISPLAY_STATUSES: readonly DisplayStatus[] = [
  "fact",
  "fact_staff_confirmed",
  "fact_supervisor_confirmed",
  "question_open",
  "question_answered",
  "awaiting_supervisor",
  "rejected_by_staff",
  "rejected_by_supervisor",
  "unverified",
];

const WORK_CATEGORIES: readonly WorkCategory[] = CATEGORIES.filter(
  (c): c is WorkCategory => c !== "NON_WORK",
);

function isDictKey(key: string): key is DictKey {
  return key in ID;
}

describe("STATUS_KEY", () => {
  it("covers every DisplayStatus with a real dict key", () => {
    for (const status of ALL_DISPLAY_STATUSES) {
      const key = STATUS_KEY[status];
      expect(key, status).toBeDefined();
      expect(isDictKey(key), `${status} -> ${key}`).toBe(true);
    }
  });

  it("has exactly the DisplayStatus keys (no more, no less)", () => {
    expect(Object.keys(STATUS_KEY).sort()).toEqual([...ALL_DISPLAY_STATUSES].sort());
  });
});

describe("CATEGORY_KEY", () => {
  it("covers every WorkCategory with a real dict key", () => {
    for (const category of WORK_CATEGORIES) {
      const key = CATEGORY_KEY[category];
      expect(key, category).toBeDefined();
      expect(isDictKey(key), `${category} -> ${key}`).toBe(true);
    }
  });

  it("has exactly the WorkCategory keys (no NON_WORK)", () => {
    expect(Object.keys(CATEGORY_KEY).sort()).toEqual([...WORK_CATEGORIES].sort());
  });
});

describe("RUNNER_UP_KEY", () => {
  it("covers every Category (incl. NON_WORK) with a real dict key", () => {
    for (const category of CATEGORIES) {
      const key = RUNNER_UP_KEY[category];
      expect(key, category).toBeDefined();
      expect(isDictKey(key), `${category} -> ${key}`).toBe(true);
    }
  });

  it("has exactly the Category keys", () => {
    expect(Object.keys(RUNNER_UP_KEY).sort()).toEqual([...CATEGORIES].sort());
  });
});

describe("categoryOptions", () => {
  it("returns options in CATEGORIES order, with counts, skipping zero-count categories", () => {
    const threads = [
      { category: "COMPLAINT" as const },
      { category: "ROUTINE_OPS" as const },
      { category: "ROUTINE_OPS" as const },
      { category: "COMPLAINT" as const },
      { category: "COMPLAINT" as const },
    ];
    expect(categoryOptions(threads)).toEqual([
      { category: "ROUTINE_OPS", count: 2 },
      { category: "COMPLAINT", count: 3 },
    ]);
  });

  it("returns an empty array for no threads", () => {
    expect(categoryOptions([])).toEqual([]);
  });

  it("never returns a category with count 0", () => {
    const options = categoryOptions([{ category: "TRAINING" as const }]);
    expect(options).toEqual([{ category: "TRAINING", count: 1 }]);
  });
});

describe("filterThreads", () => {
  const threads = [
    { category: "ROUTINE_OPS" as const, id: "a" },
    { category: "COMPLAINT" as const, id: "b" },
    { category: "ROUTINE_OPS" as const, id: "c" },
  ];

  it("ALL returns every thread, unchanged order", () => {
    expect(filterThreads(threads, "ALL")).toEqual(threads);
  });

  it("a category narrows to only that category", () => {
    expect(filterThreads(threads, "ROUTINE_OPS").map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("a category not present returns an empty array", () => {
    expect(filterThreads(threads, "TRAINING")).toEqual([]);
  });

  it("UNLABELLED returns no thread (no thread is ever 'unlabelled' — see buildTimeline)", () => {
    expect(filterThreads(threads, "UNLABELLED")).toEqual([]);
  });
});

describe("buildTimeline", () => {
  function thread(row: number, category: WorkCategory = "ROUTINE_OPS") {
    return { row, category };
  }
  function unl(key: number, after_row: number | null): SupervisorUnlabelled {
    return {
      key,
      after_row,
      start_hm: "09:00",
      end_hm: "09:02",
      display_status: "question_open",
      staff_answer: null,
    };
  }

  it("ALL: unlabelled with after_row null come first (key order), then each thread followed by its after_row matches (key order)", () => {
    const threads = [thread(0), thread(1)];
    const unlabelled = [unl(0, null), unl(1, 0), unl(2, 0), unl(3, 1)];
    const timeline = buildTimeline(threads, unlabelled, "ALL");
    expect(
      timeline.map((item) => (item.kind === "thread" ? `T${item.thread.row}` : `U${item.item.key}`)),
    ).toEqual(["U0", "T0", "U1", "U2", "T1", "U3"]);
  });

  it("ALL with no unlabelled rows is just the threads, in order", () => {
    const threads = [thread(0), thread(1)];
    const timeline = buildTimeline(threads, [], "ALL");
    expect(timeline).toEqual([{ kind: "thread", thread: threads[0] }, { kind: "thread", thread: threads[1] }]);
  });

  it("UNLABELLED: unlabelled rows only, key order, no threads", () => {
    const threads = [thread(0)];
    const unlabelled = [unl(0, null), unl(1, 0)];
    const timeline = buildTimeline(threads, unlabelled, "UNLABELLED");
    expect(timeline).toEqual([
      { kind: "unlabelled", item: unlabelled[0] },
      { kind: "unlabelled", item: unlabelled[1] },
    ]);
  });

  it("a category: threads of that category only, no unlabelled rows at all", () => {
    const threads = [thread(0, "ROUTINE_OPS"), thread(1, "COMPLAINT")];
    const unlabelled = [unl(0, 0), unl(1, 1)];
    const timeline = buildTimeline(threads, unlabelled, "COMPLAINT");
    expect(timeline).toEqual([{ kind: "thread", thread: threads[1] }]);
  });

  it("an unlabelled row whose after_row names no thread (defensive) goes at the end under ALL", () => {
    const threads = [thread(0)];
    const unlabelled = [unl(0, 5)]; // row 5 does not exist among `threads`
    const timeline = buildTimeline(threads, unlabelled, "ALL");
    expect(timeline).toEqual([
      { kind: "thread", thread: threads[0] },
      { kind: "unlabelled", item: unlabelled[0] },
    ]);
  });

  it("an orphaned after_row and a before-every-thread row both appear, orphan last", () => {
    const threads = [thread(0)];
    const unlabelled = [unl(0, null), unl(1, 9)];
    const timeline = buildTimeline(threads, unlabelled, "ALL");
    expect(
      timeline.map((item) => (item.kind === "thread" ? `T${item.thread.row}` : `U${item.item.key}`)),
    ).toEqual(["U0", "T0", "U1"]);
  });
});

import { describe, expect, it } from "vitest";
import { DictKey, ID } from "@/lib/i18n/dict";
import { CATEGORIES, type WorkCategory } from "@/lib/pipeline/categories";
import type { DisplayStatus } from "@/lib/day/derive";
import { CATEGORY_KEY, STATUS_KEY, categoryOptions, filterThreads } from "@/lib/day/view-model";

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
});

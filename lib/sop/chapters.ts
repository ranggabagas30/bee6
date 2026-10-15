import type { SopStepView } from "@/lib/sop/contract";

/**
 * SOP book chapters (R-19 PR-9b, §9.1). Plain code, no I/O, no AI: a chapter is read off the step id prefix. The
 * demo SOP uses `open-`, `bake-`, `stock-`, `serve-` and `close-`; any other id (the pilot's SOP included) falls
 * back to "Other steps", so no stored data changes. The names themselves are i18n keys owned by the screen.
 */

export const CHAPTER_IDS = ["opening_closing", "production", "stock", "customer", "other"] as const;
export type ChapterId = (typeof CHAPTER_IDS)[number];

const PREFIXES: ReadonlyArray<readonly [prefix: string, chapter: ChapterId]> = [
  ["open", "opening_closing"],
  ["close", "opening_closing"],
  ["bake", "production"],
  ["stock", "stock"],
  ["serve", "customer"],
];

/** The chapter a step belongs to, by the exact lower-case prefix of its id. */
export function chapterOf(stepId: string): ChapterId {
  for (const [prefix, chapter] of PREFIXES) if (stepId.startsWith(prefix)) return chapter;
  return "other";
}

export interface ChapterGroup {
  chapter: ChapterId;
  steps: SopStepView[];
}

/** Non-empty chapters in book order; each keeps its steps in SOP order. */
export function groupByChapter(steps: readonly SopStepView[]): ChapterGroup[] {
  const byChapter = new Map<ChapterId, SopStepView[]>();
  for (const step of steps) {
    const chapter = chapterOf(step.step_id);
    const list = byChapter.get(chapter);
    if (list) list.push(step);
    else byChapter.set(chapter, [step]);
  }
  return CHAPTER_IDS.flatMap((chapter) => {
    const list = byChapter.get(chapter);
    return list ? [{ chapter, steps: list }] : [];
  });
}

export interface LegendCounts {
  /** Steps shown that no approved change ever touched ("From your SOP"). */
  fromSop: number;
  /** Distinct step ids an approved change touched ("Improved with Bee6"). */
  improved: number;
}

/** The contents-page legend of the book. `changedIds` may repeat; it is counted as a set. */
export function legendCounts(steps: readonly SopStepView[], changedIds: Iterable<string>): LegendCounts {
  const changed = new Set(changedIds);
  const fromSop = steps.filter((s) => !changed.has(s.step_id)).length;
  return { fromSop, improved: changed.size };
}

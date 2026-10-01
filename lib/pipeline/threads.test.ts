import { describe, it, expect } from "vitest";
import {
  LabelOutputSchema,
  buildThreads,
  openThreadsAt,
  LabelUnit,
  BuiltThread,
} from "./threads";

const createTestUnit = (): LabelUnit => ({
  unit_id: "unit_0",
  window_ids: ["w_seg_001"],
  lines: [
    { line_id: "seg_001#0", seg_id: "seg_001", text: "hello", start_ms: 0, end_ms: 5000 },
    { line_id: "seg_001#1", seg_id: "seg_001", text: "world", start_ms: 5000, end_ms: 10000 },
    { line_id: "seg_001#2", seg_id: "seg_001", text: "test", start_ms: 10000, end_ms: 15000 },
  ],
});

describe("threads", () => {
  describe("LabelOutputSchema", () => {
    it("validates correct label output", () => {
      const validLabel = {
        lines: [
          { i: 0, reply_to: null, thread: "thread_1" },
          { i: 1, reply_to: 0, thread: "thread_1" },
          { i: 2, reply_to: 1, thread: "thread_1" },
        ],
        threads: [
          {
            id: "thread_1",
            category: "ROUTINE_OPS",
            confidence: 0.95,
            evidence: [0, 1, 2],
            summary: "test summary",
          },
        ],
        non_work_lines: [],
      };

      const result = LabelOutputSchema.safeParse(validLabel);
      expect(result.success).toBe(true);
    });

    it("rejects invalid category", () => {
      const invalidLabel = {
        lines: [{ i: 0, reply_to: null, thread: "thread_1" }],
        threads: [
          {
            id: "thread_1",
            category: "INVALID_CATEGORY",
            confidence: 0.95,
            evidence: [0],
            summary: "test",
          },
        ],
        non_work_lines: [],
      };

      const result = LabelOutputSchema.safeParse(invalidLabel);
      expect(result.success).toBe(false);
    });

    it("rejects confidence out of range", () => {
      const invalidLabel = {
        lines: [{ i: 0, reply_to: null, thread: "thread_1" }],
        threads: [
          {
            id: "thread_1",
            category: "ROUTINE_OPS",
            confidence: 1.5,
            evidence: [0],
            summary: "test",
          },
        ],
        non_work_lines: [],
      };

      const result = LabelOutputSchema.safeParse(invalidLabel);
      expect(result.success).toBe(false);
    });
  });

  describe("buildThreads", () => {
    it("builds a single simple thread from sequential lines", () => {
      const unit = createTestUnit();
      const label = {
        lines: [
          { i: 0, reply_to: null, thread: "thread_1" },
          { i: 1, reply_to: 0, thread: "thread_1" },
          { i: 2, reply_to: 1, thread: "thread_1" },
        ],
        threads: [
          {
            id: "thread_1",
            category: "ROUTINE_OPS" as const,
            confidence: 0.95,
            evidence: [0, 1, 2],
            summary: "found some routine work",
          },
        ],
        non_work_lines: [],
      };

      const result = buildThreads({ unit, label, open_threads: [] });

      expect(result.threads).toHaveLength(1);
      const thread = result.threads[0];
      if (thread) {
        expect(thread.category).toBe("ROUTINE_OPS");
        expect(thread.confidence).toBe(0.95);
        expect(thread.line_ids).toHaveLength(3);
        expect(thread.label_conflict).toBe(false);
      }
    });

    it("drops NON_WORK lines from output", () => {
      const unit = createTestUnit();
      const label = {
        lines: [
          { i: 0, reply_to: null, thread: "thread_1" },
          { i: 1, reply_to: 0, thread: "thread_1" },
        ],
        threads: [
          {
            id: "thread_1",
            category: "ROUTINE_OPS" as const,
            confidence: 0.95,
            evidence: [0, 1],
            summary: "work thread",
          },
        ],
        non_work_lines: [2],
      };

      const result = buildThreads({ unit, label, open_threads: [] });

      expect(result.threads).toHaveLength(1);
      const thread = result.threads[0];
      if (thread) {
        expect(thread.line_ids).not.toContain("seg_001#2");
        // Verify NON_WORK text never appears in serialized output
        const json = JSON.stringify(result);
        expect(json).not.toContain("test"); // The NON_WORK line says "test"
      }
    });

    it("detects label_conflict when lines span different categories", () => {
      const unit = createTestUnit();
      const label = {
        lines: [
          { i: 0, reply_to: null, thread: "thread_1" },
          { i: 1, reply_to: 0, thread: "thread_2" },
        ],
        threads: [
          {
            id: "thread_1",
            category: "ROUTINE_OPS" as const,
            confidence: 0.95,
            evidence: [0],
            summary: "routine work",
          },
          {
            id: "thread_2",
            category: "COMPLAINT" as const,
            confidence: 0.85,
            evidence: [1],
            summary: "customer complaint",
          },
        ],
        non_work_lines: [],
      };

      const result = buildThreads({ unit, label, open_threads: [] });

      // Lines 0 and 1 are connected via reply_to despite different threads
      expect(result.threads.some((t) => t.label_conflict)).toBe(true);
    });

    it("handles parallel threads (no connection)", () => {
      const unit = createTestUnit();
      const label = {
        lines: [
          { i: 0, reply_to: null, thread: "thread_1" },
          { i: 1, reply_to: null, thread: "thread_2" },
          { i: 2, reply_to: 1, thread: "thread_2" },
        ],
        threads: [
          {
            id: "thread_1",
            category: "ROUTINE_OPS" as const,
            confidence: 0.95,
            evidence: [0],
            summary: "routine",
          },
          {
            id: "thread_2",
            category: "COMPLAINT" as const,
            confidence: 0.85,
            evidence: [1, 2],
            summary: "complaint",
          },
        ],
        non_work_lines: [],
      };

      const result = buildThreads({ unit, label, open_threads: [] });

      expect(result.threads).toHaveLength(2);
      expect(result.threads.every((t) => !t.label_conflict)).toBe(true);
    });

    it("merges threads via open_threads grace period", () => {
      const unit: LabelUnit = {
        unit_id: "unit_1",
        window_ids: ["w_seg_002"],
        lines: [
          { line_id: "seg_002#0", seg_id: "seg_002", text: "continued", start_ms: 100000, end_ms: 105000 },
        ],
      };

      const label = {
        lines: [{ i: 0, reply_to: null, thread: "thread_1_continued" }],
        threads: [
          {
            id: "thread_1_continued",
            category: "ROUTINE_OPS" as const,
            confidence: 0.9,
            evidence: [0],
            summary: "continuing from before",
          },
        ],
        non_work_lines: [],
      };

      const openThread = {
        thread_id: "thread_1",
        category: "ROUTINE_OPS" as const,
        last_line_end_ms: 90000,
      };

      const result = buildThreads({ unit, label, open_threads: [openThread] });

      expect(result.threads).toHaveLength(1);
      const thread = result.threads[0];
      if (thread) {
        expect(thread.continued_from_open).toBe(true);
      }
    });

    it("does not merge via grace period if gap is too large", () => {
      const unit: LabelUnit = {
        unit_id: "unit_1",
        window_ids: ["w_seg_002"],
        lines: [
          { line_id: "seg_002#0", seg_id: "seg_002", text: "after_silence", start_ms: 500000, end_ms: 505000 },
        ],
      };

      const label = {
        lines: [{ i: 0, reply_to: null, thread: "new_thread" }],
        threads: [
          {
            id: "new_thread",
            category: "ROUTINE_OPS" as const,
            confidence: 0.9,
            evidence: [0],
            summary: "new thread after silence",
          },
        ],
        non_work_lines: [],
      };

      // Last open thread ended at 100ms, new one at 500000ms = 399900ms gap
      // ROUTINE_OPS grace is 120_000ms, so should NOT merge
      const openThread = {
        thread_id: "thread_1",
        category: "ROUTINE_OPS" as const,
        last_line_end_ms: 100000,
      };

      const result = buildThreads({ unit, label, open_threads: [openThread] });

      expect(result.threads).toHaveLength(1);
      const thread = result.threads[0];
      if (thread) {
        expect(thread.continued_from_open).toBe(false);
      }
    });

    it("reports unassigned line ids", () => {
      const unit = createTestUnit();
      const label = {
        lines: [
          { i: 0, reply_to: null, thread: "thread_1" },
          // Line 1 and 2 not assigned
        ],
        threads: [
          {
            id: "thread_1",
            category: "ROUTINE_OPS" as const,
            confidence: 0.95,
            evidence: [0],
            summary: "partial",
          },
        ],
        non_work_lines: [],
      };

      const result = buildThreads({ unit, label, open_threads: [] });

      expect(result.unassigned_line_ids).toContain("seg_001#1");
      expect(result.unassigned_line_ids).toContain("seg_001#2");
    });
  });

  describe("openThreadsAt", () => {
    it("includes threads where gap <= grace period", () => {
      const threads: BuiltThread[] = [
        {
          thread_id: "thread_1",
          category: "ROUTINE_OPS",
          confidence: 0.9,
          line_ids: ["seg_001#0"],
          evidence_line_ids: ["seg_001#0"],
          lines: [{ line_id: "seg_001#0", start_ms: 0, end_ms: 5000, text: "hello" }],
          first_line_start_ms: 0,
          last_line_end_ms: 5000,
          summary: "test",
          label_conflict: false,
          continued_from_open: false,
        },
      ];

      // 5000 + 100_000 = 105_000, gap from last_line_end (5000) = 100_000
      // ROUTINE_OPS grace = 120_000, so should include
      const openThreads = openThreadsAt(threads, 105000);

      expect(openThreads).toHaveLength(1);
      expect(openThreads[0]?.thread_id).toBe("thread_1");
    });

    it("excludes threads where gap > grace period", () => {
      const threads: BuiltThread[] = [
        {
          thread_id: "thread_1",
          category: "ROUTINE_OPS",
          confidence: 0.9,
          line_ids: ["seg_001#0"],
          evidence_line_ids: ["seg_001#0"],
          lines: [{ line_id: "seg_001#0", start_ms: 0, end_ms: 5000, text: "hello" }],
          first_line_start_ms: 0,
          last_line_end_ms: 5000,
          summary: "test",
          label_conflict: false,
          continued_from_open: false,
        },
      ];

      // 5000 + 200_000 = 205_000, gap = 200_000
      // ROUTINE_OPS grace = 120_000, so should NOT include
      const openThreads = openThreadsAt(threads, 205000);

      expect(openThreads).toHaveLength(0);
    });

    it("includes TRAINING threads with longer grace (10 min)", () => {
      const threads: BuiltThread[] = [
        {
          thread_id: "training_1",
          category: "TRAINING",
          confidence: 0.9,
          line_ids: ["seg_001#0"],
          evidence_line_ids: ["seg_001#0"],
          lines: [{ line_id: "seg_001#0", start_ms: 0, end_ms: 5000, text: "teaching" }],
          first_line_start_ms: 0,
          last_line_end_ms: 5000,
          summary: "teaching",
          label_conflict: false,
          continued_from_open: false,
        },
      ];

      // 5000 + 500_000 = 505_000, gap = 500_000
      // TRAINING grace = 600_000, so should include
      const openThreads = openThreadsAt(threads, 505000);

      expect(openThreads).toHaveLength(1);
      expect(openThreads[0]?.category).toBe("TRAINING");
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  LabelOutputSchema,
  LabelOutput,
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

    it("allows confidence out of range in parse (gate catches it)", () => {
      // Confidence bounds removed from schema; invalid values are caught by the gate, not the parse
      const labelWithOutOfRangeConfidence = {
        lines: [{ i: 0, reply_to: null, thread: "thread_1" }],
        threads: [
          {
            id: "thread_1",
            category: "ROUTINE_OPS",
            confidence: 1.5, // out of [0, 1] but now allowed in parse
            evidence: [0],
            summary: "test",
          },
        ],
        non_work_lines: [],
      };

      const result = LabelOutputSchema.safeParse(labelWithOutOfRangeConfidence);
      expect(result.success).toBe(true); // Parse succeeds
      // Gate will catch this as invalid_label, see gate.test.ts
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

    it("merges threads via open_threads grace period when hint matches id", () => {
      // Test 1: Hint matches open thread id and is within grace period
      const unit1: LabelUnit = {
        unit_id: "unit_1",
        window_ids: ["w_seg_002"],
        lines: [
          { line_id: "seg_002#0", seg_id: "seg_002", text: "continued", start_ms: 100000, end_ms: 105000 },
        ],
      };

      const label1 = {
        lines: [{ i: 0, reply_to: null, thread: "thread_1" }],
        threads: [
          {
            id: "thread_1",
            category: "ROUTINE_OPS" as const,
            confidence: 0.9,
            evidence: [0],
            summary: "continuing from before",
          },
        ],
        non_work_lines: [],
      };

      const openThread1 = {
        thread_id: "thread_1",
        category: "ROUTINE_OPS" as const,
        last_line_end_ms: 90000, // gap = 100000 - 90000 = 10000ms, within grace (120000ms)
      };

      const result1 = buildThreads({ unit: unit1, label: label1, open_threads: [openThread1] });
      expect(result1.threads).toHaveLength(1);
      const thread1 = result1.threads[0];
      if (thread1) {
        expect(thread1.continued_from_open).toBe(true);
        expect(thread1.thread_id).toBe("thread_1");
        expect(thread1.category).toBe("ROUTINE_OPS");
      }
    });

    it("does not merge via grace when hint does not match open thread id", () => {
      // Even if a hint has the same category and is within grace, it must match the id
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
        thread_id: "thread_1", // different id — no merge
        category: "ROUTINE_OPS" as const,
        last_line_end_ms: 90000,
      };

      const result = buildThreads({ unit, label, open_threads: [openThread] });

      expect(result.threads).toHaveLength(1);
      const thread = result.threads[0];
      if (thread) {
        expect(thread.continued_from_open).toBe(false);
        // Should create a new thread id based on unit
        expect(thread.thread_id).not.toBe("thread_1");
      }
    });

    it("joins threads at exactly grace period boundary", () => {
      const unit: LabelUnit = {
        unit_id: "unit_1",
        window_ids: ["w_seg_002"],
        lines: [
          { line_id: "seg_002#0", seg_id: "seg_002", text: "at grace", start_ms: 110000, end_ms: 115000 },
        ],
      };

      const label = {
        lines: [{ i: 0, reply_to: null, thread: "thread_1" }],
        threads: [
          {
            id: "thread_1",
            category: "TRAINING" as const,
            confidence: 0.9,
            evidence: [0],
            summary: "training",
          },
        ],
        non_work_lines: [],
      };

      // TRAINING grace = 600_000ms (10 min)
      // gap = 110000 - 0 = 110000ms, within grace
      const openThread = {
        thread_id: "thread_1",
        category: "TRAINING" as const,
        last_line_end_ms: 0,
      };

      const result = buildThreads({ unit, label, open_threads: [openThread] });
      expect(result.threads).toHaveLength(1);
      const thread = result.threads[0];
      if (thread) {
        expect(thread.continued_from_open).toBe(true);
      }
    });

    it("does not join when gap exceeds grace by 1ms", () => {
      const unit: LabelUnit = {
        unit_id: "unit_1",
        window_ids: ["w_seg_002"],
        lines: [
          { line_id: "seg_002#0", seg_id: "seg_002", text: "after grace", start_ms: 120001, end_ms: 125000 },
        ],
      };

      const label = {
        lines: [{ i: 0, reply_to: null, thread: "thread_2" }],
        threads: [
          {
            id: "thread_2", // Different id from open thread to distinguish them
            category: "ROUTINE_OPS" as const,
            confidence: 0.9,
            evidence: [0],
            summary: "after grace",
          },
        ],
        non_work_lines: [],
      };

      // ROUTINE_OPS grace = 120_000ms (2 min)
      // gap = 120001 - 0 = 120001ms, exceeds grace by 1ms
      const openThread = {
        thread_id: "thread_1",
        category: "ROUTINE_OPS" as const,
        last_line_end_ms: 0,
      };

      const result = buildThreads({ unit, label, open_threads: [openThread] });
      expect(result.threads).toHaveLength(1);
      const thread = result.threads[0];
      if (thread) {
        expect(thread.continued_from_open).toBe(false);
        // A fresh, unit-namespaced id — never the bare model thread id (those
        // repeat across units) and never the open thread's id either.
        expect(thread.thread_id).toBe("unit_1:thread_2");
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

    it("strips NON_WORK-labeled threads entirely (not just explicit line indices)", () => {
      const unit: LabelUnit = {
        unit_id: "unit_1",
        window_ids: ["w_1"],
        lines: [
          { line_id: "seg_001#0", seg_id: "seg_001", text: "routine work", start_ms: 0, end_ms: 5000 },
          { line_id: "seg_001#1", seg_id: "seg_001", text: "off-topic chat", start_ms: 5000, end_ms: 10000 },
          { line_id: "seg_001#2", seg_id: "seg_001", text: "more routine", start_ms: 10000, end_ms: 15000 },
        ],
      };

      const label: LabelOutput = {
        lines: [
          { i: 0, reply_to: null, thread: "thread_1" },
          { i: 1, reply_to: null, thread: "thread_2" }, // NON_WORK thread
          { i: 2, reply_to: null, thread: "thread_1" },
        ],
        threads: [
          { id: "thread_1", category: "ROUTINE_OPS", confidence: 0.9, evidence: [0, 2], summary: "work" },
          { id: "thread_2", category: "NON_WORK", confidence: 0.8, evidence: [1], summary: "chat" },
        ],
        non_work_lines: [], // Note: thread_2's lines NOT in explicit non_work_lines
      };

      const result = buildThreads({ unit, label, open_threads: [] });

      // NON_WORK thread should be completely stripped
      expect(result.threads).toHaveLength(1);
      const thread = result.threads[0];
      if (!thread) throw new Error("Expected thread not found");
      expect(thread.category).toBe("ROUTINE_OPS");

      // Check that NON_WORK text never appears in output
      const output = JSON.stringify(result);
      expect(output).not.toContain("off-topic chat");
      expect(output).not.toContain("thread_2");

      // Non-work count should include the NON_WORK thread's lines
      expect(result.non_work_line_count).toBeGreaterThanOrEqual(1);
    });

    it("unions evidence line IDs across all lines in a multi-line thread", () => {
      const unit: LabelUnit = {
        unit_id: "unit_1",
        window_ids: ["w_1"],
        lines: [
          { line_id: "seg_001#0", seg_id: "seg_001", text: "problem observed", start_ms: 0, end_ms: 5000 },
          { line_id: "seg_001#1", seg_id: "seg_001", text: "context info", start_ms: 5000, end_ms: 10000 },
          { line_id: "seg_001#2", seg_id: "seg_001", text: "root cause", start_ms: 10000, end_ms: 15000 },
        ],
      };

      const label: LabelOutput = {
        lines: [
          { i: 0, reply_to: null, thread: "thread_1" }, // evidence index
          { i: 1, reply_to: 0, thread: "thread_1" }, // another evidence index
          { i: 2, reply_to: 1, thread: "thread_1" },
        ],
        threads: [
          {
            id: "thread_1",
            category: "COMPLAINT",
            confidence: 0.95,
            evidence: [0, 1], // evidence indices 0 and 1
            summary: "customer issue",
          },
        ],
        non_work_lines: [],
      };

      const result = buildThreads({ unit, label, open_threads: [] });

      expect(result.threads).toHaveLength(1);
      const thread = result.threads[0];
      expect(thread).toBeDefined();
      if (thread) {
        // Should have evidence from both indices 0 and 1
        expect(thread.evidence_line_ids).toContain("seg_001#0");
        expect(thread.evidence_line_ids).toContain("seg_001#1");
      }
    });

    it("preserves non-zero confidence (not silently defaulting to 0)", () => {
      const unit: LabelUnit = {
        unit_id: "unit_1",
        window_ids: ["w_1"],
        lines: [
          { line_id: "seg_001#0", seg_id: "seg_001", text: "text1", start_ms: 0, end_ms: 5000 },
          { line_id: "seg_001#1", seg_id: "seg_001", text: "text2", start_ms: 5000, end_ms: 10000 },
        ],
      };

      const label: LabelOutput = {
        lines: [
          { i: 0, reply_to: null, thread: "thread_1" },
          { i: 1, reply_to: 0, thread: "thread_1" },
        ],
        threads: [
          {
            id: "thread_1",
            category: "TRAINING",
            confidence: 0.75,
            evidence: [0, 1],
            summary: "training session",
          },
        ],
        non_work_lines: [],
      };

      const result = buildThreads({ unit, label, open_threads: [] });

      expect(result.threads).toHaveLength(1);
      const thread = result.threads[0];
      if (thread) {
        // Should preserve the actual confidence (0.75), not silently default to 0
        expect(thread.confidence).toBe(0.75);
      }
    });

    it("chains open threads across three windows", () => {
      // This is the backlog's literal 3-window join case: three units in sequence
      // with chained open threads all converging to one thread_id

      // Window 1: opens a thread
      const unit1: LabelUnit = {
        unit_id: "unit_1",
        window_ids: ["w_seg_001"],
        lines: [
          { line_id: "seg_001#0", seg_id: "seg_001", text: "start", start_ms: 0, end_ms: 5000 },
        ],
      };

      const label1 = {
        lines: [{ i: 0, reply_to: null, thread: "thread_main" }],
        threads: [
          {
            id: "thread_main",
            category: "COMPLAINT" as const,
            confidence: 0.9,
            evidence: [0],
            summary: "issue start",
          },
        ],
        non_work_lines: [],
      };

      const result1 = buildThreads({ unit: unit1, label: label1, open_threads: [] });
      expect(result1.threads).toHaveLength(1);
      const thread1 = result1.threads[0];
      if (!thread1) throw new Error("Expected thread1");
      // Not joined (no open threads yet) — gets a fresh, unit-namespaced id,
      // never the bare model-assigned id (those repeat across units).
      expect(thread1.thread_id).toBe("unit_1:thread_main");
      expect(thread1.continued_from_open).toBe(false);

      // Get open threads for next window
      const openAt1 = openThreadsAt([thread1], 200000); // 200s later
      expect(openAt1).toHaveLength(1); // COMPLAINT grace is 5 min (300s), so 200s gap is within grace
      expect(openAt1[0]?.thread_id).toBe("unit_1:thread_main");

      // Window 2: continues the thread. The model echoes the persisted
      // (unit-namespaced) open-thread id back as its `thread` hint — that's
      // the contract between R-05b's label call and this join.
      const unit2: LabelUnit = {
        unit_id: "unit_2",
        window_ids: ["w_seg_002"],
        lines: [
          { line_id: "seg_002#0", seg_id: "seg_002", text: "middle", start_ms: 205000, end_ms: 210000 },
        ],
      };

      const label2 = {
        lines: [{ i: 0, reply_to: null, thread: "unit_1:thread_main" }],
        threads: [
          {
            id: "unit_1:thread_main",
            category: "COMPLAINT" as const,
            confidence: 0.92,
            evidence: [0],
            summary: "issue details",
          },
        ],
        non_work_lines: [],
      };

      const result2 = buildThreads({ unit: unit2, label: label2, open_threads: openAt1 });
      expect(result2.threads).toHaveLength(1);
      const thread2 = result2.threads[0];
      if (!thread2) throw new Error("Expected thread2");
      expect(thread2.thread_id).toBe("unit_1:thread_main"); // Joins the open thread
      expect(thread2.continued_from_open).toBe(true);

      const openAt2 = openThreadsAt([thread2], 400000); // Another 190s later (195s total since start)
      expect(openAt2).toHaveLength(1);
      expect(openAt2[0]?.thread_id).toBe("unit_1:thread_main");

      // Window 3: continues the same thread
      const unit3: LabelUnit = {
        unit_id: "unit_3",
        window_ids: ["w_seg_003"],
        lines: [
          { line_id: "seg_003#0", seg_id: "seg_003", text: "end", start_ms: 390000, end_ms: 395000 },
        ],
      };

      const label3 = {
        lines: [{ i: 0, reply_to: null, thread: "unit_1:thread_main" }],
        threads: [
          {
            id: "unit_1:thread_main",
            category: "COMPLAINT" as const,
            confidence: 0.88,
            evidence: [0],
            summary: "resolution",
          },
        ],
        non_work_lines: [],
      };

      const result3 = buildThreads({ unit: unit3, label: label3, open_threads: openAt2 });
      expect(result3.threads).toHaveLength(1);
      const thread3 = result3.threads[0];
      if (!thread3) throw new Error("Expected thread3");
      expect(thread3.thread_id).toBe("unit_1:thread_main"); // Joins the open thread
      expect(thread3.continued_from_open).toBe(true);

      // All three threads have the same id, representing a single chained complaint across three windows
    });

    it("does not join when the component's resolved category differs from the open thread's category", () => {
      // Hint matches the open thread's id and the gap is within grace, but
      // the model re-labeled this window's continuation with a different
      // category than the open thread was last recorded with. Per R-05a.md's
      // join rule (b), category must also match — must NOT join.
      const unit: LabelUnit = {
        unit_id: "unit_2",
        window_ids: ["w_seg_002"],
        lines: [
          { line_id: "seg_002#0", seg_id: "seg_002", text: "continued", start_ms: 10000, end_ms: 15000 },
        ],
      };

      const label = {
        lines: [{ i: 0, reply_to: null, thread: "unit_1:thread_main" }],
        threads: [
          {
            id: "unit_1:thread_main",
            category: "COMPLAINT" as const, // different from the open thread's ROUTINE_OPS
            confidence: 0.9,
            evidence: [0],
            summary: "re-labeled",
          },
        ],
        non_work_lines: [],
      };

      const openThread = {
        thread_id: "unit_1:thread_main",
        category: "ROUTINE_OPS" as const,
        last_line_end_ms: 0, // gap = 10000ms, well within ROUTINE_OPS grace (120_000ms)
      };

      const result = buildThreads({ unit, label, open_threads: [openThread] });

      expect(result.threads).toHaveLength(1);
      const thread = result.threads[0];
      if (thread) {
        expect(thread.continued_from_open).toBe(false);
        expect(thread.thread_id).not.toBe("unit_1:thread_main");
        expect(thread.category).toBe("COMPLAINT");
      }
    });

    it("flags merged confidence with the offending raw value if any member thread's confidence is out of range", () => {
      const unit: LabelUnit = {
        unit_id: "unit_1",
        window_ids: ["w_1"],
        lines: [
          { line_id: "seg_001#0", seg_id: "seg_001", text: "line0", start_ms: 0, end_ms: 5000 },
          { line_id: "seg_001#1", seg_id: "seg_001", text: "line1", start_ms: 5000, end_ms: 10000 },
        ],
      };

      const label: LabelOutput = {
        lines: [
          { i: 0, reply_to: null, thread: "thread_a" },
          { i: 1, reply_to: 0, thread: "thread_b" },
        ],
        threads: [
          { id: "thread_a", category: "ROUTINE_OPS", confidence: 0.95, evidence: [0], summary: "a" },
          { id: "thread_b", category: "ROUTINE_OPS", confidence: 1.5, evidence: [1], summary: "b" }, // out of [0,1]
        ],
        non_work_lines: [],
      };

      const result = buildThreads({ unit, label, open_threads: [] });

      expect(result.threads).toHaveLength(1);
      const thread = result.threads[0];
      if (thread) {
        // Must not silently resolve to the min of only the valid member (0.95) —
        // the raw offending value passes through so the gate's invalid_label
        // rule catches it downstream (never coerced to NaN or clamped).
        expect(thread.confidence).toBe(1.5);
      }
    });

    it("propagates NaN confidence from a member thread directly (never coerced)", () => {
      const unit: LabelUnit = {
        unit_id: "unit_1",
        window_ids: ["w_1"],
        lines: [{ line_id: "seg_001#0", seg_id: "seg_001", text: "line0", start_ms: 0, end_ms: 5000 }],
      };

      const label: LabelOutput = {
        lines: [{ i: 0, reply_to: null, thread: "thread_a" }],
        threads: [
          { id: "thread_a", category: "ROUTINE_OPS", confidence: NaN, evidence: [0], summary: "a" },
        ],
        non_work_lines: [],
      };

      const result = buildThreads({ unit, label, open_threads: [] });

      expect(result.threads).toHaveLength(1);
      const thread = result.threads[0];
      if (thread) {
        expect(Number.isNaN(thread.confidence)).toBe(true);
      }
    });

    it("drops a label line whose i is out of range for this unit (never produces a junk thread)", () => {
      const unit: LabelUnit = {
        unit_id: "unit_1",
        window_ids: ["w_1"],
        lines: [
          { line_id: "seg_001#0", seg_id: "seg_001", text: "only line", start_ms: 0, end_ms: 5000 },
        ],
      };

      const label: LabelOutput = {
        lines: [
          { i: 0, reply_to: null, thread: "thread_1" },
          { i: 7, reply_to: null, thread: "thread_1" }, // out of range — unit has only 1 line
        ],
        threads: [
          { id: "thread_1", category: "ROUTINE_OPS", confidence: 0.95, evidence: [0], summary: "ok" },
        ],
        non_work_lines: [],
      };

      const result = buildThreads({ unit, label, open_threads: [] });

      expect(result.threads).toHaveLength(1);
      const thread = result.threads[0];
      if (thread) {
        expect(thread.line_ids).toEqual(["seg_001#0"]);
      }
      // The out-of-range line never existed in this unit, so it's neither
      // emitted nor reported as unassigned.
      expect(result.unassigned_line_ids).toHaveLength(0);
    });

    it("never silently loses a line whose hint resolves to no thread and no open thread", () => {
      const unit: LabelUnit = {
        unit_id: "unit_1",
        window_ids: ["w_1"],
        lines: [
          { line_id: "seg_001#0", seg_id: "seg_001", text: "orphan", start_ms: 0, end_ms: 5000 },
        ],
      };

      const label: LabelOutput = {
        lines: [{ i: 0, reply_to: null, thread: "ghost_thread" }], // no matching entry in threads[]
        threads: [],
        non_work_lines: [],
      };

      const result = buildThreads({ unit, label, open_threads: [] });

      expect(result.threads).toHaveLength(0);
      expect(result.unassigned_line_ids).toContain("seg_001#0");
    });

    it("does NOT invent a fact from open_threads alone when a hint matches an open thread but label.threads has no entry for it (hard rule #10)", () => {
      // A hint matching an open thread id is not itself evidence — without a
      // label.threads[] entry from THIS unit's model call there is no
      // confidence/evidence to build a thread from. The line must go to
      // unassigned_line_ids for R-05b to retry, never silently become a fact
      // sourced only from the open thread's stale category.
      const unit: LabelUnit = {
        unit_id: "unit_2",
        window_ids: ["w_seg_002"],
        lines: [
          { line_id: "seg_002#0", seg_id: "seg_002", text: "continued, no explicit thread entry", start_ms: 10000, end_ms: 15000 },
        ],
      };

      const label: LabelOutput = {
        lines: [{ i: 0, reply_to: null, thread: "unit_1:thread_main" }],
        threads: [], // model gave no threads[] entry for this id this call
        non_work_lines: [],
      };

      const openThread = {
        thread_id: "unit_1:thread_main",
        category: "ROUTINE_OPS" as const,
        last_line_end_ms: 0, // gap = 10000ms, within ROUTINE_OPS grace
      };

      const result = buildThreads({ unit, label, open_threads: [openThread] });

      expect(result.threads).toHaveLength(0);
      expect(result.unassigned_line_ids).toEqual(["seg_002#0"]);
    });

    it("includes an unresolved member line (no label.threads entry for its own hint) in the thread via reply_to union, when the component has at least one resolved line", () => {
      const unit: LabelUnit = {
        unit_id: "unit_1",
        window_ids: ["w_1"],
        lines: [
          { line_id: "seg_001#0", seg_id: "seg_001", text: "resolved line", start_ms: 0, end_ms: 5000 },
          { line_id: "seg_001#1", seg_id: "seg_001", text: "unresolved but unioned", start_ms: 5000, end_ms: 10000 },
        ],
      };

      const label: LabelOutput = {
        lines: [
          { i: 0, reply_to: null, thread: "thread_1" },
          { i: 1, reply_to: 0, thread: "ghost_hint" }, // no label.threads entry, but unioned via reply_to
        ],
        threads: [
          { id: "thread_1", category: "ROUTINE_OPS", confidence: 0.95, evidence: [0], summary: "resolved" },
        ],
        non_work_lines: [],
      };

      const result = buildThreads({ unit, label, open_threads: [] });

      expect(result.threads).toHaveLength(1);
      expect(result.threads[0]?.line_ids).toEqual(["seg_001#0", "seg_001#1"]);
      expect(result.unassigned_line_ids).toHaveLength(0);
    });

    it("rejects a negative gap (device clock jump) — never clamps to 0, always a fresh thread", () => {
      const unit: LabelUnit = {
        unit_id: "unit_2",
        window_ids: ["w_seg_002"],
        lines: [
          { line_id: "seg_002#0", seg_id: "seg_002", text: "clock jumped backward", start_ms: 999, end_ms: 2000 },
        ],
      };

      const label: LabelOutput = {
        lines: [{ i: 0, reply_to: null, thread: "thread_1" }],
        threads: [
          { id: "thread_1", category: "ROUTINE_OPS", confidence: 0.9, evidence: [0], summary: "after jump" },
        ],
        non_work_lines: [],
      };

      // last_line_end_ms (1000) is AFTER this line's start (999) — negative gap.
      const openThread = { thread_id: "thread_1", category: "ROUTINE_OPS" as const, last_line_end_ms: 1000 };

      const result = buildThreads({ unit, label, open_threads: [openThread] });

      expect(result.threads).toHaveLength(1);
      expect(result.threads[0]?.continued_from_open).toBe(false);
      expect(result.threads[0]?.thread_id).toBe("unit_2:thread_1");
    });

    it("gap measured from the component's earliest RESOLVED line, not the line that happens to carry the hint", () => {
      // reply_to chain: line 0 (earliest, resolved) <- line 1 (carries the
      // hint, resolved) — both resolved, same thread. Earliest start (line 0)
      // is beyond grace from the open thread even though line 1 (the hint
      // carrier) alone would be within grace.
      const unit: LabelUnit = {
        unit_id: "unit_2",
        window_ids: ["w_seg_002"],
        lines: [
          { line_id: "seg_002#0", seg_id: "seg_002", text: "earliest, too far from open thread", start_ms: 130000, end_ms: 135000 },
          { line_id: "seg_002#1", seg_id: "seg_002", text: "carries the hint, would be in grace alone", start_ms: 135000, end_ms: 140000 },
        ],
      };

      const label: LabelOutput = {
        lines: [
          { i: 0, reply_to: null, thread: "thread_1" },
          { i: 1, reply_to: 0, thread: "thread_1" },
        ],
        threads: [
          { id: "thread_1", category: "ROUTINE_OPS", confidence: 0.9, evidence: [0, 1], summary: "chain" },
        ],
        non_work_lines: [],
      };

      // ROUTINE_OPS grace = 120_000ms.
      // Gap from earliest line (130000 - 10001 = 119999ms) is WITHIN grace.
      // Gap from the hint-carrying line alone (135000 - 10001 = 124999ms)
      // would be OUT of grace. Correct behavior (earliest-line gap) => joins.
      const openThread = { thread_id: "thread_1", category: "ROUTINE_OPS" as const, last_line_end_ms: 10001 };
      const result = buildThreads({ unit, label, open_threads: [openThread] });

      expect(result.threads).toHaveLength(1);
      expect(result.threads[0]?.continued_from_open).toBe(true);
    });

    it("joins correctly when the open-id hint is on a line unioned only via a later same-hint pass (no stale component root)", () => {
      // Three lines, no reply_to between 0 and 2 directly — 0 and 2 share a
      // thread hint (union), 1 replies to 0. The line carrying the
      // open-thread-matching hint (2) is processed after 0/1 are unioned,
      // exercising the "component root changes after the hint is seen" case.
      const unit: LabelUnit = {
        unit_id: "unit_2",
        window_ids: ["w_seg_002"],
        lines: [
          { line_id: "seg_002#0", seg_id: "seg_002", text: "a", start_ms: 10000, end_ms: 15000 },
          { line_id: "seg_002#1", seg_id: "seg_002", text: "b", start_ms: 15000, end_ms: 20000 },
          { line_id: "seg_002#2", seg_id: "seg_002", text: "c, carries the open-matching hint", start_ms: 20000, end_ms: 25000 },
        ],
      };

      const label: LabelOutput = {
        lines: [
          { i: 0, reply_to: null, thread: "thread_1" },
          { i: 1, reply_to: 0, thread: "thread_1" },
          { i: 2, reply_to: null, thread: "thread_1" }, // same hint as 0 — unions into the same component
        ],
        threads: [
          { id: "thread_1", category: "ROUTINE_OPS", confidence: 0.9, evidence: [0, 1, 2], summary: "chain" },
        ],
        non_work_lines: [],
      };

      const openThread = { thread_id: "thread_1", category: "ROUTINE_OPS" as const, last_line_end_ms: 0 };

      const result = buildThreads({ unit, label, open_threads: [openThread] });

      expect(result.threads).toHaveLength(1);
      expect(result.threads[0]?.continued_from_open).toBe(true);
      expect(result.threads[0]?.line_ids).toEqual(["seg_002#0", "seg_002#1", "seg_002#2"]);
    });

    it("two different units both using model thread id \"t1\" never collide on the final thread_id", () => {
      const makeUnit = (unitId: string, lineId: string): LabelUnit => ({
        unit_id: unitId,
        window_ids: [`w_${lineId}`],
        lines: [{ line_id: lineId, seg_id: lineId, text: "work", start_ms: 0, end_ms: 5000 }],
      });

      const label: LabelOutput = {
        lines: [{ i: 0, reply_to: null, thread: "t1" }],
        threads: [{ id: "t1", category: "ROUTINE_OPS", confidence: 0.9, evidence: [0], summary: "s" }],
        non_work_lines: [],
      };

      const resultA = buildThreads({ unit: makeUnit("unit_a", "a#0"), label, open_threads: [] });
      const resultB = buildThreads({ unit: makeUnit("unit_b", "b#0"), label, open_threads: [] });

      expect(resultA.threads[0]?.thread_id).not.toBe(resultB.threads[0]?.thread_id);
      expect(resultA.threads[0]?.thread_id).toBe("unit_a:t1");
      expect(resultB.threads[0]?.thread_id).toBe("unit_b:t1");
    });

    it("does not join when the hint matches more than one candidate open thread (ambiguous — never guesses)", () => {
      const unit: LabelUnit = {
        unit_id: "unit_2",
        window_ids: ["w_1"],
        lines: [
          { line_id: "seg_002#0", seg_id: "seg_002", text: "hints both old threads", start_ms: 10000, end_ms: 15000 },
          { line_id: "seg_002#1", seg_id: "seg_002", text: "second line, other hint", start_ms: 15000, end_ms: 20000 },
        ],
      };

      // A component spanning two DISTINCT hints (via reply_to union), each
      // matching a different open thread that's otherwise eligible on
      // category + grace. The component as a whole can't pick one.
      const openA = { thread_id: "thread_a", category: "ROUTINE_OPS" as const, last_line_end_ms: 0 };
      const labelTwoHints: LabelOutput = {
        lines: [
          { i: 0, reply_to: null, thread: "thread_a" },
          { i: 1, reply_to: 0, thread: "thread_b" },
        ],
        threads: [
          { id: "thread_a", category: "ROUTINE_OPS", confidence: 0.9, evidence: [0], summary: "s" },
          { id: "thread_b", category: "ROUTINE_OPS", confidence: 0.9, evidence: [1], summary: "s" },
        ],
        non_work_lines: [],
      };
      const openB = { thread_id: "thread_b", category: "ROUTINE_OPS" as const, last_line_end_ms: 0 };

      const result = buildThreads({ unit, label: labelTwoHints, open_threads: [openA, openB] });

      // Both thread_a and thread_b are open and both match a member hint
      // within grace and category — ambiguous, so no join.
      expect(result.threads).toHaveLength(1);
      expect(result.threads[0]?.continued_from_open).toBe(false);
    });

    it("invariant: every in-range, non-NON_WORK line appears in exactly one thread's line_ids or in unassigned_line_ids, never both, never neither", () => {
      const unit: LabelUnit = {
        unit_id: "unit_1",
        window_ids: ["w_1"],
        lines: [
          { line_id: "seg_001#0", seg_id: "seg_001", text: "resolved", start_ms: 0, end_ms: 5000 },
          { line_id: "seg_001#1", seg_id: "seg_001", text: "unresolved standalone", start_ms: 5000, end_ms: 10000 },
          { line_id: "seg_001#2", seg_id: "seg_001", text: "non-work", start_ms: 10000, end_ms: 15000 },
          { line_id: "seg_001#3", seg_id: "seg_001", text: "another resolved", start_ms: 15000, end_ms: 20000 },
        ],
      };

      const label: LabelOutput = {
        lines: [
          { i: 0, reply_to: null, thread: "thread_1" },
          { i: 1, reply_to: null, thread: "ghost" }, // unresolved, standalone component
          { i: 2, reply_to: null, thread: "chat" },
          { i: 3, reply_to: null, thread: "thread_2" },
        ],
        threads: [
          { id: "thread_1", category: "ROUTINE_OPS", confidence: 0.9, evidence: [0], summary: "s1" },
          { id: "chat", category: "NON_WORK", confidence: 0.8, evidence: [], summary: "chat" },
          { id: "thread_2", category: "COMPLAINT", confidence: 0.9, evidence: [3], summary: "s2" },
        ],
        non_work_lines: [],
      };

      const result = buildThreads({ unit, label, open_threads: [] });

      const seenInThreads = new Set(result.threads.flatMap((t) => t.line_ids));
      const seenUnassigned = new Set(result.unassigned_line_ids);
      const allIds = unit.lines.map((l) => l.line_id);
      const nonWorkIds = new Set(["seg_001#2"]);

      for (const id of allIds) {
        if (nonWorkIds.has(id)) {
          expect(seenInThreads.has(id)).toBe(false);
          expect(seenUnassigned.has(id)).toBe(false);
          continue;
        }
        const inThread = seenInThreads.has(id);
        const inUnassigned = seenUnassigned.has(id);
        expect(inThread !== inUnassigned).toBe(true); // exactly one, never both, never neither
      }
    });

    it("evidence index belonging to another component's line does not count as evidence here", () => {
      const unit: LabelUnit = {
        unit_id: "unit_1",
        window_ids: ["w_1"],
        lines: [
          { line_id: "seg_001#0", seg_id: "seg_001", text: "component A", start_ms: 0, end_ms: 5000 },
          { line_id: "seg_001#1", seg_id: "seg_001", text: "component B", start_ms: 5000, end_ms: 10000 },
        ],
      };

      const label: LabelOutput = {
        lines: [
          { i: 0, reply_to: null, thread: "thread_a" },
          { i: 1, reply_to: null, thread: "thread_b" }, // separate component — no edge to 0
        ],
        threads: [
          // thread_a's evidence wrongly points at line 1, which belongs to a different component
          { id: "thread_a", category: "ROUTINE_OPS", confidence: 0.9, evidence: [0, 1], summary: "s" },
          { id: "thread_b", category: "COMPLAINT", confidence: 0.9, evidence: [1], summary: "s2" },
        ],
        non_work_lines: [],
      };

      const result = buildThreads({ unit, label, open_threads: [] });

      expect(result.threads).toHaveLength(2);
      const threadA = result.threads.find((t) => t.category === "ROUTINE_OPS");
      expect(threadA).toBeDefined();
      if (threadA) {
        expect(threadA.evidence_line_ids).toEqual(["seg_001#0"]);
        expect(threadA.evidence_line_ids).not.toContain("seg_001#1");
      }
    });

    it("counts a dropped reply_to edge from a NON_WORK line in dropped_edge_count", () => {
      const unit: LabelUnit = {
        unit_id: "unit_1",
        window_ids: ["w_1"],
        lines: [
          { line_id: "seg_001#0", seg_id: "seg_001", text: "chit chat", start_ms: 0, end_ms: 5000 },
          { line_id: "seg_001#1", seg_id: "seg_001", text: "back to work", start_ms: 5000, end_ms: 10000 },
        ],
      };

      const label: LabelOutput = {
        lines: [
          { i: 0, reply_to: null, thread: "nonwork_thread" },
          { i: 1, reply_to: 0, thread: "thread_1" }, // reply_to a NON_WORK line — edge must be dropped
        ],
        threads: [
          { id: "nonwork_thread", category: "NON_WORK", confidence: 0.8, evidence: [], summary: "chat" },
          { id: "thread_1", category: "ROUTINE_OPS", confidence: 0.9, evidence: [1], summary: "work" },
        ],
        non_work_lines: [],
      };

      const result = buildThreads({ unit, label, open_threads: [] });

      expect(result.dropped_edge_count).toBeGreaterThanOrEqual(1);
      expect(result.threads).toHaveLength(1);
      expect(result.threads[0]?.line_ids).toEqual(["seg_001#1"]);
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

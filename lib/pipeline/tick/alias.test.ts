import { describe, expect, it } from "vitest";
import { remapOpenThreadAliases } from "@/lib/pipeline/tick/alias";
import type { LabelOutput, OpenThread } from "@/lib/pipeline/threads";

const OPEN_THREADS: OpenThread[] = [
  { thread_id: "unit_d1_w1:T1", category: "ROUTINE_OPS", last_line_end_ms: 1000 },
  { thread_id: "unit_d1_w3:T2", category: "CUSTOMER_SERVICE", last_line_end_ms: 2000 },
];

describe("remapOpenThreadAliases", () => {
  it("remaps an echoed O# line hint to the real stored thread_id, in open_threads order", () => {
    const label: LabelOutput = {
      lines: [{ i: 0, reply_to: null, thread: "O1" }],
      threads: [],
      non_work_lines: [],
    };
    const result = remapOpenThreadAliases(label, OPEN_THREADS);
    expect(result.lines[0]?.thread).toBe("unit_d1_w1:T1");
  });

  it("remaps O2 to the second open thread, not the first", () => {
    const label: LabelOutput = {
      lines: [{ i: 0, reply_to: null, thread: "O2" }],
      threads: [],
      non_work_lines: [],
    };
    const result = remapOpenThreadAliases(label, OPEN_THREADS);
    expect(result.lines[0]?.thread).toBe("unit_d1_w3:T2");
  });

  it("remaps a threads[].id of O1 (model re-declaring the continuation's evidence) the same way", () => {
    const label: LabelOutput = {
      lines: [{ i: 0, reply_to: null, thread: "O1" }],
      threads: [{ id: "O1", category: "ROUTINE_OPS", confidence: 0.9, evidence: [0], summary: "s" }],
      non_work_lines: [],
    };
    const result = remapOpenThreadAliases(label, OPEN_THREADS);
    expect(result.threads[0]?.id).toBe("unit_d1_w1:T1");
    expect(result.lines[0]?.thread).toBe("unit_d1_w1:T1");
  });

  it("leaves a new-thread alias (T#) unchanged", () => {
    const label: LabelOutput = {
      lines: [{ i: 0, reply_to: null, thread: "T1" }],
      threads: [{ id: "T1", category: "ROUTINE_OPS", confidence: 0.9, evidence: [0], summary: "s" }],
      non_work_lines: [],
    };
    const result = remapOpenThreadAliases(label, OPEN_THREADS);
    expect(result.threads[0]?.id).toBe("T1");
    expect(result.lines[0]?.thread).toBe("T1");
  });

  it("leaves an out-of-range O# alias unchanged rather than throwing", () => {
    const label: LabelOutput = {
      lines: [{ i: 0, reply_to: null, thread: "O9" }],
      threads: [],
      non_work_lines: [],
    };
    expect(() => remapOpenThreadAliases(label, OPEN_THREADS)).not.toThrow();
    const result = remapOpenThreadAliases(label, OPEN_THREADS);
    expect(result.lines[0]?.thread).toBe("O9");
  });

  it("never mutates the input label", () => {
    const label: LabelOutput = {
      lines: [{ i: 0, reply_to: null, thread: "O1" }],
      threads: [],
      non_work_lines: [],
    };
    const snapshot = structuredClone(label);
    remapOpenThreadAliases(label, OPEN_THREADS);
    expect(label).toEqual(snapshot);
  });
});

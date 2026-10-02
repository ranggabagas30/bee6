import { describe, expect, it } from "vitest";
import { loadCategoriesConfig } from "@/lib/pipeline/label/config";
import { buildLabelPrompt } from "@/lib/pipeline/label/prompt";
import type { LabelUnit } from "@/lib/pipeline/windowing";
import type { OpenThread } from "@/lib/pipeline/threads";

const config = loadCategoriesConfig("config/categories.draft.yaml");

function makeUnit(): LabelUnit {
  return {
    unit_id: "unit_dev1_w1",
    window_ids: ["w1"],
    lines: [
      { line_id: "s1#0", seg_id: "s1", text: "Tolong ambil egg tart", start_ms: 0, end_ms: 1000 },
      { line_id: "s1#1", seg_id: "s1", text: "Baik, sebentar", start_ms: 1000, end_ms: 2000 },
    ],
  };
}

describe("buildLabelPrompt", () => {
  it("never includes a real thread_id string when open threads are passed — only O1, O2, etc.", () => {
    const realThreadId = "unit_dev1_w0:T1-super-long-and-distinctive-id";
    const openThreads: OpenThread[] = [
      { thread_id: realThreadId, category: "CUSTOMER_SERVICE", last_line_end_ms: 500 },
      { thread_id: "unit_dev1_w0:T2-another-distinctive-id", category: "ROUTINE_OPS", last_line_end_ms: 400 },
    ];

    const result = buildLabelPrompt({ config, unit: makeUnit(), open_threads: openThreads });

    expect(result.systemInstruction).not.toMatch(/unit_dev1_w0/);
    expect(result.userContent).not.toMatch(/unit_dev1_w0/);
    expect(result.userContent).toMatch(/\bO1\b/);
    expect(result.userContent).toMatch(/\bO2\b/);
  });

  it("includes every unit line, numbered from 0, in userContent", () => {
    const result = buildLabelPrompt({ config, unit: makeUnit(), open_threads: [] });

    expect(result.userContent).toMatch(/Tolong ambil egg tart/);
    expect(result.userContent).toMatch(/Baik, sebentar/);
    expect(result.userContent).toMatch(/\b0\b.*Tolong ambil egg tart|Tolong ambil egg tart.*\b0\b/);
  });

  it("lists every category from decision_order in the system instruction", () => {
    const result = buildLabelPrompt({ config, unit: makeUnit(), open_threads: [] });

    for (const category of config.decision_order) {
      expect(result.systemInstruction).toMatch(new RegExp(category));
    }
  });
});

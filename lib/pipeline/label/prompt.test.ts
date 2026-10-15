import { describe, expect, it } from "vitest";
import { loadCategoriesConfig, type CategoriesConfig } from "@/lib/pipeline/label/config";
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

  it("never prints the literal TODO placeholder into the prompt (config/categories.draft.yaml's examples are still TODO)", () => {
    const result = buildLabelPrompt({ config, unit: makeUnit(), open_threads: [] });

    expect(result.systemInstruction).not.toMatch(/TODO/);
  });

  it("still prints a category's real example pair once it's no longer the TODO placeholder", () => {
    const realExamplesConfig: CategoriesConfig = {
      version: 0.1,
      parents: [],
      decision_order: ["ROUTINE_OPS"],
      categories: {
        ...config.categories,
        ROUTINE_OPS: {
          ...config.categories.ROUTINE_OPS,
          examples: { real: "Checked the oven temperature", not_this: "Chatting about ovens in general" },
        },
      },
      field_values: config.field_values,
      incident_keywords: config.incident_keywords,
    };

    const result = buildLabelPrompt({ config: realExamplesConfig, unit: makeUnit(), open_threads: [] });

    expect(result.systemInstruction).toMatch(/Checked the oven temperature/);
    expect(result.systemInstruction).toMatch(/Chatting about ovens in general/);
  });

  it("carries the threading rules between the category list and the structured-output block (R-21 F-1)", () => {
    const raw = buildLabelPrompt({ config, unit: makeUnit(), open_threads: [] }).systemInstruction;
    const si = raw.replace(/\s+/g, " "); // the rules are wrapped over several lines; compare sentences, not line breaks

    expect(si).toContain("One event is one thread");
    expect(si).toContain("Open a new thread for a different event");
    // eval:label's trap (a what-if next to a real event on the same item) regressed 20/35 -> 4/35 with the broader
    // "decide the category from all lines together" wording; this sentence is what keeps the two apart.
    expect(si).toContain("A general instruction or a what-if is not the same event as something that actually happened");
    const lastCategory = raw.lastIndexOf(`- ${config.decision_order.at(-1)}`);
    const rules = raw.indexOf("Threading rules:");
    const output = raw.indexOf("Respond with structured output only");
    expect(lastCategory).toBeGreaterThan(-1);
    expect(rules).toBeGreaterThan(lastCategory);
    expect(output).toBeGreaterThan(rules);
  });

  it("has no { or } anywhere in the system instruction (same discipline as the proposal prompt)", () => {
    const { systemInstruction } = buildLabelPrompt({ config, unit: makeUnit(), open_threads: [] });

    expect(systemInstruction).not.toMatch(/[{}]/);
  });

  it("defines CORRECTION as someone else's mistake, not a speaker's own remark about what they did (R-21 F-1)", () => {
    const { systemInstruction } = buildLabelPrompt({ config, unit: makeUnit(), open_threads: [] });
    const line = systemInstruction.split("\n").find((l) => l.startsWith("- CORRECTION"))!;

    expect(line).toContain("a mistake someone else just made");
    expect(line).toContain("Not a speaker's own remark about what they themselves just did or forgot");
    expect(line).toContain("belongs to the thread of the event it is about");
  });
});

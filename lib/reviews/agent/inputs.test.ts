import { describe, expect, it } from "vitest";
import type { ProposalLibrary } from "@/config/proposal-library";
import type { SopVersion } from "@/lib/firestore/schema";
import type { Candidate } from "@/lib/proposals/candidates";
import { buildReviewAgentInputs, buildSample } from "@/lib/reviews/agent/inputs";
import { suggestVerdict } from "@/lib/reviews/verdict";

const cand = (i: number, summary: string, over: Partial<Candidate> = {}): Candidate => ({
  thread_id: `thread-secret-${i}`,
  local_date: "2026-10-10",
  start_hm: `0${(i % 9) + 1}:00`,
  category: "CUSTOMER_SERVICE",
  first_line_start_ms: 1_000 + i,
  summary,
  excerpt: `RAW LINE ${i}`,
  ...over,
});

describe("buildSample", () => {
  it("caps at 6 in time order, keeping the earliest", () => {
    const cands = Array.from({ length: 9 }, (_, i) => cand(i, `Note number ${i}.`)).reverse();
    const s = buildSample(cands, []);
    expect(s).toHaveLength(6);
    expect(s.map((x) => x.summary)).toEqual([0, 1, 2, 3, 4, 5].map((i) => `Note number ${i}.`));
  });

  it("scrubs a planted staff name to [STAFF]", () => {
    const [s] = buildSample([cand(0, "Sari asked about the baking time.")], ["Sari Demo"]);
    expect(s!.summary).toBe("[STAFF] asked about the baking time.");
  });

  it("strips invisible characters, including ones hiding a name", () => {
    const [s] = buildSample([cand(0, "Sa​ri asked‮ about\ttime.")], ["Sari Demo"]);
    expect(s!.summary).toBe("[STAFF] asked about time.");
  });

  it("cuts at 200 code points", () => {
    const [s] = buildSample([cand(0, "x".repeat(450))], []);
    expect(Array.from(s!.summary)).toHaveLength(200);
    const [e] = buildSample([cand(0, "\u{1F600}".repeat(300))], []);
    expect(Array.from(e!.summary)).toHaveLength(200);
  });

  it("drops empty summaries and keeps filling to the cap from later items", () => {
    const cands = [cand(0, "   "), cand(1, "​"), ...Array.from({ length: 7 }, (_, i) => cand(i + 2, `Real ${i}.`))];
    const s = buildSample(cands, []);
    expect(s).toHaveLength(6);
    expect(s[0]!.summary).toBe("Real 0.");
  });

  it("carries only date, time, category and summary: never a thread id or a raw line", () => {
    const [s] = buildSample([cand(3, "A customer asked.")], []);
    expect(Object.keys(s!).sort()).toEqual(["category", "date", "start_hm", "summary"]);
    expect(JSON.stringify(s)).not.toContain("thread-secret");
    expect(JSON.stringify(s)).not.toContain("RAW LINE");
  });
});

describe("buildReviewAgentInputs", () => {
  const library: ProposalLibrary = {
    interventions: { version: 1, entries: [{ id: "label_it", label_en: "Add a label", label_id: "Label", definition: "Put the fact on the item." }] },
    rubric: { version: 1, entries: [] },
    draft: false,
  };
  const win = (from: string, to: string, days_captured: number, count: number) => ({ from_date: from, to_date: to, days_captured, count });
  const sop = (intervention_id = "label_it", kind: "modify" | "add" = "modify"): SopVersion =>
    ({
      version: 2,
      change: {
        kind,
        step_id: "display-01",
        before: kind === "add" ? null : { step_id: "display-01", title: "Display check", text: "Check the display.", role: "staff" },
        after: { step_id: "display-01", title: "Display check", text: "Check the display and labels.", role: "staff" },
        change_title: "Label the trays",
        intervention_id,
        metric: { category: "CUSTOMER_SERVICE", direction: "decrease", description: "Customers asking", baseline_count: 2, baseline_days: 3 },
        failure_condition: "Still asked.",
        review_after_days: 7,
        review_date: "2026-10-20",
        approved_at_ms: 1,
      },
    }) as unknown as SopVersion;
  const base = (over: Record<string, unknown> = {}) => {
    const before = win("2026-10-10", "2026-10-12", 3, 2);
    const after = win("2026-10-13", "2026-10-19", 2, 0);
    return buildReviewAgentInputs({
      sop: sop(),
      rationale: "Customers asked.",
      library,
      before: { window: before, candidates: [cand(0, "Sari asked.")] },
      after: { window: after, candidates: [] },
      notices: { overlapping_change: true, threads_truncated: false },
      suggestion: suggestVerdict({ before, after, direction: "decrease" }),
      staffNames: ["Sari Demo"],
      ...over,
    });
  };

  it("maps the change, step texts, intervention, rationale and metric label", () => {
    const i = base();
    expect(i.change).toEqual({
      version: 2,
      change_title: "Label the trays",
      kind: "modify",
      step_title: "Display check",
      step_before: "Check the display.",
      step_after: "Check the display and labels.",
      intervention: { id: "label_it", label_en: "Add a label", definition: "Put the fact on the item." },
      rationale: "Customers asked.",
      metric: {
        category: "CUSTOMER_SERVICE",
        category_label_en: "Customer service",
        direction: "decrease",
        description: "Customers asking",
        baseline_count: 2,
        baseline_days: 3,
      },
      failure_condition: "Still asked.",
    });
  });

  it("an added step has step_before null", () => {
    expect(base({ sop: sop("label_it", "add") }).change.step_before).toBeNull();
  });

  it("falls back for an intervention id the library does not know", () => {
    expect(base({ sop: sop("gone_id") }).change.intervention).toEqual({ id: "gone_id", label_en: "gone_id", definition: "" });
  });

  it("copies the counts with the rule, the notices and the suggestion; samples are scrubbed", () => {
    const i = base();
    expect(i.counts).toEqual({
      before: win("2026-10-10", "2026-10-12", 3, 2),
      after: win("2026-10-13", "2026-10-19", 2, 0),
      rule: { min_days: 2, threshold_pct: 20 },
    });
    expect(i.notices).toEqual({ overlapping_change: true, threads_truncated: false });
    expect(i.suggestion.verdict).toBe("worked");
    expect(i.sample.before[0]!.summary).toBe("[STAFF] asked.");
    expect(i.sample.after).toEqual([]);
    expect(i.staffNames).toEqual(["Sari Demo"]);
  });

  it("cleans the string fields of the change: invisible characters stripped, whitespace flattened", () => {
    const dirty = sop();
    const c = dirty.change!;
    c.change_title = "Label\u200B  the\ntrays";
    c.after = { ...c.after, title: "Display\tcheck", text: "Check   the\n\ndisplay\u202E and labels." };
    c.before = { ...c.before!, text: "Check\u200B the   display." };
    c.metric = { ...c.metric, description: "Customers\n asking" };
    c.failure_condition = "Still\u0000 asked.";
    const i = base({ sop: dirty, rationale: "Customers\n\nasked\u200B." });
    expect(i.change.change_title).toBe("Label the trays");
    expect(i.change.step_title).toBe("Display check");
    expect(i.change.step_before).toBe("Check the display.");
    expect(i.change.step_after).toBe("Check the display and labels.");
    expect(i.change.metric.description).toBe("Customers asking");
    expect(i.change.failure_condition).toBe("Still asked.");
    expect(i.change.rationale).toBe("Customers asked.");
  });

  it("throws on a version that is not a shipped change", () => {
    expect(() => base({ sop: { version: 1, change: null } })).toThrow(/not a shipped change/);
  });
});

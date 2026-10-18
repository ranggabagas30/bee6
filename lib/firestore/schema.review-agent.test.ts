import { describe, expect, it } from "vitest";
import { ReviewSchema } from "@/lib/firestore/schema";
import { reviewDoc } from "@/lib/reviews/testing/fixtures";

const agent = (over: Record<string, unknown> = {}) => ({
  version: "review-v1",
  model: "gemini-3.5-flash-lite",
  narrative_en: "Fewer moments of this kind were noted after the change than before it, so the rule suggests it worked.",
  suggested_verdict: "worked",
  caveats: ["short_window", "category_count_not_problem_count"],
  rounds: 1,
  model_calls: 5,
  generated_at_ms: 1_700_000_000_000,
  ...over,
});

describe("ReviewSchema.agent (docs/tasks/review-agent-18oct.md §5.5)", () => {
  it("a review doc without agent parses (and still has no agent key)", () => {
    const r = reviewDoc();
    expect("agent" in r).toBe(false);
  });

  it("a valid agent parses and round-trips", () => {
    const r = ReviewSchema.parse({ ...reviewDoc(), agent: agent() });
    expect(r.agent?.suggested_verdict).toBe("worked");
  });

  it("an extra key inside agent fails", () => {
    expect(ReviewSchema.safeParse({ ...reviewDoc(), agent: agent({ reasoning: "x" }) }).success).toBe(false);
  });

  it("an extra top-level key still fails (the doc stays strict)", () => {
    expect(ReviewSchema.safeParse({ ...reviewDoc(), agent_text: "x" }).success).toBe(false);
  });

  it("agent.suggested_verdict disagreeing with the rule's suggestion fails", () => {
    const r = ReviewSchema.safeParse({ ...reviewDoc(), agent: agent({ suggested_verdict: "revert" }) });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path.join(".") === "agent.suggested_verdict")).toBe(true);
  });

  it('a null suggestion pairs with agent verdict "none" only', () => {
    const none = {
      ...reviewDoc(),
      suggestion: { verdict: null, reason: "not_enough_days", change_ratio: null, rule_version: "rev-v1" },
    };
    expect(ReviewSchema.safeParse({ ...none, agent: agent({ suggested_verdict: "none" }) }).success).toBe(true);
    expect(ReviewSchema.safeParse({ ...none, agent: agent({ suggested_verdict: "worked" }) }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { PROPOSAL_RULES } from "@/lib/firestore/schema";
import { V4_RULES } from "@/lib/proposals/v4/types";

describe("V4_RULES (R-24)", () => {
  it("has exactly the ten plan rules, in evaluation order", () => {
    expect([...V4_RULES]).toEqual([
      "section_not_fetched",
      "step_not_in_section",
      "evidence_not_inspected",
      "intervention_not_inspected",
      "quote_alias_not_cited",
      "quotes_insufficient",
      "quote_not_in_evidence",
      "scope_unsupported",
      "change_is_noop",
      "text_rule_violation",
    ]);
  });

  it("is a suffix of PROPOSAL_RULES (the stored-doc rule enum), with no duplicates", () => {
    const stored = [...PROPOSAL_RULES] as string[];
    expect(stored.slice(-V4_RULES.length)).toEqual([...V4_RULES]);
    expect(new Set(stored).size).toBe(stored.length);
  });
});

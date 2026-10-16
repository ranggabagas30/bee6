import { describe, expect, it } from "vitest";
import {
  AskEstimateSchema,
  V4_ASK_ESTIMATE,
  isProposalAgentV4Enabled,
  readAskEstimate,
} from "@/lib/proposals/v4/flag";

describe("isProposalAgentV4Enabled (R-24 D6)", () => {
  it("is on only for exactly \"true\"", () => {
    expect(isProposalAgentV4Enabled({ PROPOSAL_AGENT_V4: "true" })).toBe(true);
    for (const v of [undefined, "", "TRUE", "True", "1", "false", " true", "true "]) {
      expect(isProposalAgentV4Enabled({ PROPOSAL_AGENT_V4: v }), String(v)).toBe(false);
    }
    expect(isProposalAgentV4Enabled({})).toBe(false);
  });

  it("reads process.env by default", () => {
    const before = process.env.PROPOSAL_AGENT_V4;
    try {
      delete process.env.PROPOSAL_AGENT_V4;
      expect(isProposalAgentV4Enabled()).toBe(false);
      process.env.PROPOSAL_AGENT_V4 = "true";
      expect(isProposalAgentV4Enabled()).toBe(true);
    } finally {
      if (before === undefined) delete process.env.PROPOSAL_AGENT_V4;
      else process.env.PROPOSAL_AGENT_V4 = before;
    }
  });
});

describe("V4_ASK_ESTIMATE / readAskEstimate (R-24 D11, D18)", () => {
  it("the constant is 10-30 seconds and satisfies its own schema", () => {
    expect(V4_ASK_ESTIMATE).toEqual({ min_s: 10, max_s: 30 });
    expect(AskEstimateSchema.safeParse(V4_ASK_ESTIMATE).success).toBe(true);
  });

  it("flag on returns the estimate", () => {
    expect(readAskEstimate({ PROPOSAL_AGENT_V4: "true" })).toEqual({ min_s: 10, max_s: 30 });
  });

  it("flag unset, \"TRUE\" or \"1\" returns null", () => {
    expect(readAskEstimate({})).toBeNull();
    expect(readAskEstimate({ PROPOSAL_AGENT_V4: "TRUE" })).toBeNull();
    expect(readAskEstimate({ PROPOSAL_AGENT_V4: "1" })).toBeNull();
  });

  it("returns a copy, so a caller cannot change the constant", () => {
    const e = readAskEstimate({ PROPOSAL_AGENT_V4: "true" });
    expect(e).not.toBe(V4_ASK_ESTIMATE);
  });
});

describe("AskEstimateSchema", () => {
  it("rejects max below min, zero, fractions and extra keys", () => {
    expect(AskEstimateSchema.safeParse({ min_s: 30, max_s: 10 }).success).toBe(false);
    expect(AskEstimateSchema.safeParse({ min_s: 0, max_s: 10 }).success).toBe(false);
    expect(AskEstimateSchema.safeParse({ min_s: 1.5, max_s: 10 }).success).toBe(false);
    expect(AskEstimateSchema.safeParse({ min_s: 10, max_s: 30, extra: 1 }).success).toBe(false);
    expect(AskEstimateSchema.safeParse({ min_s: 10, max_s: 10 }).success).toBe(true);
  });
});

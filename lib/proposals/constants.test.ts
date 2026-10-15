import { describe, expect, it } from "vitest";
import { MAX_FOCUS_PER_ASK, MODEL_TIMEOUT_MS, PROPOSAL_LEASE_MS } from "@/lib/proposals/constants";

describe("PROPOSAL_LEASE_MS (R-20)", () => {
  it("outlasts the worst-case Ask: every focus makes two model calls, each raced at timeout + 5 s", () => {
    const worstCaseMs = MAX_FOCUS_PER_ASK * 2 * (MODEL_TIMEOUT_MS + 5_000);
    expect(PROPOSAL_LEASE_MS).toBeGreaterThan(worstCaseMs);
  });

  it("still fits Cloud Run's default 300 s request timeout", () => {
    expect(PROPOSAL_LEASE_MS).toBeLessThanOrEqual(300_000);
  });
});

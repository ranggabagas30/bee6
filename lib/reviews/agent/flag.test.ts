import { describe, expect, it } from "vitest";
import { isReviewAgentEnabled, readReviewAgentEstimate } from "@/lib/reviews/agent/flag";
import { REVIEW_AGENT_ESTIMATE, REVIEW_AGENT_TIMEOUT_MS } from "@/lib/reviews/agent/constants";

const sandbox = { template_outlet_id: "demo-outlet", created_at_ms: 1, expires_at_ms: 2, key_sha256: "a".repeat(64) };
const demoSandbox = { outlet_id: "sbx-abc123", project_kind: "demo" as const, sandbox };
const demoShared = { outlet_id: "demo-outlet", project_kind: "demo" as const, sandbox: undefined };
const pilot = { outlet_id: "proofed-1", project_kind: "pilot" as const, sandbox: undefined };

describe("isReviewAgentEnabled", () => {
  it('is on for exactly "true" on a demo sandbox outlet', () => {
    expect(isReviewAgentEnabled({ REVIEW_AGENT: "true" }, demoSandbox)).toBe(true);
  });
  it("is off for a demo outlet that is not a sandbox", () => {
    expect(isReviewAgentEnabled({ REVIEW_AGENT: "true" }, demoShared)).toBe(false);
  });
  it("is off on the pilot even when set", () => {
    expect(isReviewAgentEnabled({ REVIEW_AGENT: "true" }, pilot)).toBe(false);
    expect(isReviewAgentEnabled({ REVIEW_AGENT: "true" }, { ...pilot, sandbox })).toBe(false);
  });
  it("is off unless the outlet id carries the sandbox prefix", () => {
    expect(isReviewAgentEnabled({ REVIEW_AGENT: "true" }, { ...demoSandbox, outlet_id: "demo-outlet" })).toBe(false);
  });
  it('is off for "TRUE", "1", "false", "" and unset', () => {
    for (const v of ["TRUE", "1", "false", "", " true", undefined]) {
      expect(isReviewAgentEnabled({ REVIEW_AGENT: v }, demoSandbox)).toBe(false);
    }
    expect(isReviewAgentEnabled({}, demoSandbox)).toBe(false);
  });
});

describe("readReviewAgentEstimate", () => {
  it("returns the estimate only when the flag value is exactly true", () => {
    expect(readReviewAgentEstimate({ REVIEW_AGENT: "true" })).toEqual({ ...REVIEW_AGENT_ESTIMATE });
    // usual range 5 to 15 s; the cap is the agent timeout (20 s), derived, never a second literal
    expect(readReviewAgentEstimate({ REVIEW_AGENT: "true" })).toEqual({ min_s: 5, max_s: 15, cap_s: REVIEW_AGENT_TIMEOUT_MS / 1000 });
    expect(REVIEW_AGENT_TIMEOUT_MS).toBe(20_000);
    expect(readReviewAgentEstimate({ REVIEW_AGENT: "false" })).toBeNull();
    expect(readReviewAgentEstimate({})).toBeNull();
  });
  it("returns a copy, not the shared constant", () => {
    const e = readReviewAgentEstimate({ REVIEW_AGENT: "true" })!;
    expect(e).not.toBe(REVIEW_AGENT_ESTIMATE);
  });
});

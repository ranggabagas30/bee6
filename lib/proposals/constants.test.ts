import { describe, expect, it } from "vitest";
import {
  MAX_FOCUS_PER_ASK,
  MODEL_TIMEOUT_MS,
  PROPOSAL_CHECK_VERSION,
  PROPOSAL_LEASE_MS,
  V4_ASK_BUDGET_MS,
  V4_MAX_CHECK_ROUNDS,
  V4_MAX_MODEL_CALLS,
  FACT_EXCERPT_MAX_CHARS,
  V4_QUOTE_MAX_CHARS,
  V4_QUOTE_MIN_CHARS,
  V4_SCOPE_STOP_WORDS,
  V4_SCOPE_TOKEN_MIN,
  V4_TIMEOUT_MS,
} from "@/lib/proposals/constants";

describe("PROPOSAL_LEASE_MS (R-20)", () => {
  it("outlasts the worst-case Ask: every focus makes two model calls, each raced at timeout + 5 s", () => {
    const worstCaseMs = MAX_FOCUS_PER_ASK * 2 * (MODEL_TIMEOUT_MS + 5_000);
    expect(PROPOSAL_LEASE_MS).toBeGreaterThan(worstCaseMs);
  });

  it("still fits Cloud Run's default 300 s request timeout", () => {
    expect(PROPOSAL_LEASE_MS).toBeLessThanOrEqual(300_000);
  });
});

describe("R-24 v4 constants", () => {
  it("pins the v3 plan numbers", () => {
    expect(PROPOSAL_CHECK_VERSION).toBe("pcheck-v4");
    expect(V4_MAX_CHECK_ROUNDS).toBe(3);
    expect(V4_MAX_MODEL_CALLS).toBe(14);
    expect(V4_TIMEOUT_MS).toBe(45_000);
    expect(V4_ASK_BUDGET_MS).toBe(270_000);
    expect(V4_QUOTE_MIN_CHARS).toBe(8);
    expect(V4_SCOPE_TOKEN_MIN).toBe(3);
  });

  it("drift guard: a v4 quote may be as long as a whole clamped get_evidence excerpt", () => {
    expect(V4_QUOTE_MAX_CHARS).toBeGreaterThanOrEqual(FACT_EXCERPT_MAX_CHARS);
    expect(V4_QUOTE_MAX_CHARS).toBe(FACT_EXCERPT_MAX_CHARS);
  });

  it("two worst-case focuses (v4 + backstop, then a v3 fallback + backstop) fit the budget and the lease", () => {
    const perFocus = V4_TIMEOUT_MS + 5_000 + MODEL_TIMEOUT_MS + 5_000; // 115 s
    expect(perFocus).toBe(115_000);
    // Focus 2 runs v4 iff elapsed + V4_TIMEOUT_MS + 65 s <= budget; after a worst-case focus 1 it still does.
    expect(perFocus + V4_TIMEOUT_MS + 65_000).toBeLessThanOrEqual(V4_ASK_BUDGET_MS);
    expect(MAX_FOCUS_PER_ASK * perFocus).toBeLessThanOrEqual(V4_ASK_BUDGET_MS);
    expect(V4_ASK_BUDGET_MS).toBeLessThan(PROPOSAL_LEASE_MS);
  });

  it("a v4 run leaves room to read 3 check rounds: timeout is under the model timeout", () => {
    expect(V4_TIMEOUT_MS).toBeLessThan(MODEL_TIMEOUT_MS);
  });

  it("scope stop-words are lowercase, include the short function words, and contain neither Ube nor Dubai", () => {
    for (const w of V4_SCOPE_STOP_WORDS) expect(w).toBe(w.toLowerCase());
    for (const w of ["and", "the", "for", "dan", "yang", "untuk", "step", "customer"]) {
      expect(V4_SCOPE_STOP_WORDS.has(w)).toBe(true);
    }
    expect(V4_SCOPE_STOP_WORDS.has("ube")).toBe(false);
    expect(V4_SCOPE_STOP_WORDS.has("dubai")).toBe(false);
  });
});

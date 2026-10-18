import { describe, expect, it } from "vitest";
import { agentTextFor } from "@/lib/debrief/agent/view";

const TZ = "Asia/Jakarta";
const T0 = Date.UTC(2026, 9, 14, 7, 5, 0); // 14:05 Jakarta
const TEXT = "Around 14:05, was there a phone order for twelve egg tarts?";

function agent(over: Record<string, unknown> = {}): unknown {
  return {
    version: "debrief-q-v1",
    model: "gemini-3.5-flash-lite",
    category: "PHONE_CALL",
    start_hm: "14:05",
    question_en: TEXT,
    rounds: 1,
    generated_at_ms: 1,
    ...over,
  };
}

function q(over: Record<string, unknown> = {}) {
  return {
    kind: "gate" as const,
    category: "PHONE_CALL" as const,
    window_start_ms: T0,
    agent: agent(),
    ...over,
  };
}

describe("agentTextFor (D9 read-side stale guard)", () => {
  it("returns the stored text when category and start_hm still match", () => {
    expect(agentTextFor(q(), TZ)).toBe(TEXT);
  });

  it("undefined when the category changed since it was worded", () => {
    expect(agentTextFor(q({ category: "COMPLAINT" }), TZ)).toBeUndefined();
  });

  it("undefined when start_hm differs (window moved or the tz changed)", () => {
    expect(agentTextFor(q({ window_start_ms: T0 + 60_000 * 10 }), TZ)).toBeUndefined();
    expect(agentTextFor(q(), "America/New_York")).toBeUndefined();
  });

  it("undefined for unlabelled_unit, for a null category, and when no agent is stored", () => {
    expect(agentTextFor(q({ kind: "unlabelled_unit" }), TZ)).toBeUndefined();
    expect(agentTextFor(q({ category: null }), TZ)).toBeUndefined();
    expect(agentTextFor(q({ agent: undefined }), TZ)).toBeUndefined();
  });

  it("undefined when the stored text is outside 20..140 code points (storage bound is looser)", () => {
    expect(agentTextFor(q({ agent: agent({ question_en: "x".repeat(150) }) }), TZ)).toBeUndefined();
    expect(agentTextFor(q({ agent: agent({ question_en: "x".repeat(19) }) }), TZ)).toBeUndefined();
  });

  it("M5: a malformed or future-version agent object yields undefined (never throws, never text)", () => {
    expect(agentTextFor(q({ agent: agent({ version: "debrief-q-v2" }) }), TZ)).toBeUndefined();
    expect(agentTextFor(q({ agent: agent({ model: "gemini-9" }) }), TZ)).toBeUndefined();
    expect(agentTextFor(q({ agent: agent({ rounds: 7 }) }), TZ)).toBeUndefined();
    expect(agentTextFor(q({ agent: agent({ device_id: "d1" }) }), TZ)).toBeUndefined(); // strict: no extra key
    expect(agentTextFor(q({ agent: { question_en: TEXT } }), TZ)).toBeUndefined();
    for (const bad of ["a string", 42, null, [], true]) expect(agentTextFor(q({ agent: bad }), TZ)).toBeUndefined();
  });
});

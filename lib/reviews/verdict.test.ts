import { describe, expect, it } from "vitest";
import { suggestVerdict } from "@/lib/reviews/verdict";

const w = (days_captured: number, count: number) => ({ days_captured, count });
const s = (before: ReturnType<typeof w>, after: ReturnType<typeof w>, direction: "decrease" | "increase" = "decrease") =>
  suggestVerdict({ before, after, direction });

describe("suggestVerdict (rev-v1)", () => {
  it("2.T5 before with 1 captured day -> not_enough_days", () => {
    expect(s(w(1, 5), w(3, 2))).toEqual({ verdict: null, reason: "not_enough_days", change_ratio: null, rule_version: "rev-v1" });
  });
  it("2.T5 after with 1 captured day -> not_enough_days", () => {
    expect(s(w(3, 5), w(1, 2))).toMatchObject({ verdict: null, reason: "not_enough_days", change_ratio: null });
  });
  it("2.T5 zero baseline -> no_baseline", () => {
    expect(s(w(3, 0), w(3, 2))).toEqual({ verdict: null, reason: "no_baseline", change_ratio: null, rule_version: "rev-v1" });
  });
  it("2.T5 decrease 6/3 -> 2/3 (-67%) -> worked", () => {
    const r = s(w(3, 6), w(3, 2));
    expect(r).toMatchObject({ verdict: "worked", reason: "improved" });
    expect(r.change_ratio).toBeCloseTo(-0.6667, 3);
  });
  it("2.T5 decrease 3/3 -> 4/3 (+33%) -> revert", () => {
    const r = s(w(3, 3), w(3, 4));
    expect(r).toMatchObject({ verdict: "revert", reason: "worsened" });
    expect(r.change_ratio).toBeCloseTo(0.3333, 3);
  });
  it("2.T5 decrease 5/5 -> 4.5/5 (-10%) -> revise (counts 5 -> 4.5 via 10 days)", () => {
    // 10/10 -> 9/10 = -10%
    expect(s(w(10, 10), w(10, 9))).toMatchObject({ verdict: "revise", reason: "no_clear_change" });
  });
  it("2.T5 increase 2/4 -> 3/4 (+50%) -> worked", () => {
    expect(s(w(4, 2), w(4, 3), "increase")).toMatchObject({ verdict: "worked", reason: "improved" });
  });
  it("2.T5 increase moving down by 50% -> revert", () => {
    expect(s(w(4, 4), w(4, 2), "increase")).toMatchObject({ verdict: "revert", reason: "worsened" });
  });
  it("2.T5 exactly -20% on decrease -> worked; exactly +20% on decrease -> revert", () => {
    expect(s(w(5, 10), w(5, 8))).toMatchObject({ verdict: "worked" }); // 2.0 -> 1.6
    expect(s(w(5, 10), w(5, 12))).toMatchObject({ verdict: "revert" }); // 2.0 -> 2.4
  });
  it("uses the per-day rate, not raw counts (different day counts)", () => {
    // before 6 in 3 days (2/day); after 6 in 6 days (1/day) -> -50%
    expect(s(w(3, 6), w(6, 6))).toMatchObject({ verdict: "worked" });
  });
  it("change_ratio is always finite", () => {
    expect(Number.isFinite(s(w(3, 6), w(3, 0)).change_ratio!)).toBe(true);
  });
});

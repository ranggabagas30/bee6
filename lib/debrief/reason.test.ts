import { describe, expect, it } from "vitest";
import { checkReason, reasonLength } from "@/lib/debrief/reason";

describe("checkReason", () => {
  it("rejects an empty string as reason_empty", () => {
    expect(checkReason("")).toEqual({ ok: false, code: "reason_empty" });
  });

  it("rejects whitespace-only text as reason_empty", () => {
    expect(checkReason("   \n ")).toEqual({ ok: false, code: "reason_empty" });
  });

  it("accepts 500 code points including an emoji", () => {
    const reason = "😀" + "a".repeat(499);
    expect(Array.from(reason).length).toBe(500);
    expect(checkReason(reason)).toEqual({ ok: true, trimmed: reason });
  });

  it("rejects 501 code points as reason_too_long", () => {
    expect(checkReason("a".repeat(501))).toEqual({ ok: false, code: "reason_too_long" });
  });

  it("trims surrounding whitespace", () => {
    expect(checkReason("  ok  ")).toEqual({ ok: true, trimmed: "ok" });
  });
});

describe("reasonLength", () => {
  it("counts trimmed code points, not UTF-16 units", () => {
    expect(reasonLength("  😀ok  ")).toBe(3); // 😀, o, k
  });

  it("is 0 for whitespace-only text", () => {
    expect(reasonLength("   ")).toBe(0);
  });
});

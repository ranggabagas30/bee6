import { describe, expect, it } from "vitest";
import { shiftDeep } from "@/lib/demo/clone";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 14, 3, 0, 0); // 14 Oct 2026 10:00 WIB

describe("shiftDeep opts (R-19 PR-2: the clone's defaults stay, the next-day shift widens them)", () => {
  it("without opts behaves as before: from_date and expires_at are not date keys / are moved by the _at rule", () => {
    const out = shiftDeep({ from_date: "2026-10-14", expires_at: "2026-10-16T00:00:00.000Z", x_ms: T0 }, -DAY, -1);
    expect(out.from_date).toBe("2026-10-14");
    expect(out.expires_at).toBe("2026-10-15T00:00:00.000Z");
    expect(out.x_ms).toBe(T0 - DAY);
  });

  it("dateKeys opt adds date keys that move by whole days", () => {
    const out = shiftDeep({ from_date: "2026-10-14", business_date: "2026-10-14" }, -DAY, -1, "", {
      dateKeys: new Set(["from_date", "business_date"]),
    });
    expect(out).toEqual({ from_date: "2026-10-13", business_date: "2026-10-13" });
  });

  it("untouchedKeys opt keeps a subtree exactly as it was (same reference), at any depth", () => {
    const expires = { toDate: () => new Date(0) };
    const input = { expires_at: expires, nested: { expires_at: expires, t_ms: T0 }, sandbox: { created_at_ms: T0 } };
    const out = shiftDeep(input, -DAY, -1, "", { untouchedKeys: new Set(["expires_at", "sandbox"]) });
    expect(out.expires_at).toBe(expires);
    expect(out.nested.expires_at).toBe(expires);
    expect(out.nested.t_ms).toBe(T0 - DAY);
    expect(out.sandbox).toBe(input.sandbox);
  });
});

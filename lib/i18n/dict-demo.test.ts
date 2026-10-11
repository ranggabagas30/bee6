import { describe, expect, it } from "vitest";
import { EN, ID, t, type DictKey } from "@/lib/i18n/dict";

/**
 * R-12 PR-B Task 8.1: the demo landing / demo bar copy block (all PROVISIONAL,
 * plan copy plus the keys the error and restart states need).
 */

const DEMO_KEYS = [
  "C-demo-title",
  "C-demo-intro",
  "C-demo-path",
  "C-demo-fictional",
  "C-demo-try-staff",
  "C-demo-try-supervisor",
  "C-demo-try-owner",
  "C-demo-bar",
  "C-demo-switch",
  "C-demo-role-staff",
  "C-demo-role-supervisor",
  "C-demo-role-owner",
  "C-demo-busy",
  "C-demo-expired",
  "C-demo-restart",
  "C-demo-restart-confirm",
  "C-demo-restart-yes",
  "C-demo-restart-keep",
  "C-demo-restarted",
  "C-demo-err-limit",
  "C-demo-err-cap",
  "C-demo-err-busy",
  "C-demo-err-not-ready",
  "C-demo-retry-soon",
  "C-demo-retry-min",
  "C-demo-retry-hr",
  "C-demo-retry-tomorrow",
  "C-demo-retry-later",
] as const satisfies readonly DictKey[];

describe("R-12 demo copy block", () => {
  it("defines every demo key in both languages, non-empty", () => {
    for (const key of DEMO_KEYS) {
      expect(ID[key]?.trim().length, `ID ${key}`).toBeGreaterThan(0);
      expect(EN[key]?.trim().length, `EN ${key}`).toBeGreaterThan(0);
    }
  });

  it("fills the bar and switch placeholders", () => {
    expect(t("en", "C-demo-bar", { role: "Staff", time: "14:05" })).toBe("Demo · You are: Staff · Ends at 14:05");
    expect(t("id", "C-demo-bar", { role: "Staf", time: "14:05" })).toBe("Demo · Anda: Staf · Berakhir pukul 14:05");
    expect(t("en", "C-demo-switch", { role: "Owner" })).toBe("Switch to Owner");
  });

  it("never carries a raw IP, key or template word in the copy", () => {
    for (const key of DEMO_KEYS) {
      expect(EN[key]).not.toMatch(/sandbox|demo-tpl|sbx-/i);
    }
  });
});

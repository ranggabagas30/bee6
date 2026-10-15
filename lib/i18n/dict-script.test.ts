import { describe, expect, it } from "vitest";
import { EN, ID, t, type DictKey } from "@/lib/i18n/dict";

/**
 * R-18 P2 copy that survives R-19 PR-5 (the script drawer's own strings went with the drawer; the judge guide's
 * copy lives in lib/i18n/v2/journey.ts): the sandbox End dialog line, the carried-question chip and the debrief
 * refresh button.
 */
const SCRIPT_KEYS = ["C-script-end-b", "C-script-day-ended", "C-script-earlier-day", "C-script-check-new", "C-script-checking"] as const satisfies readonly DictKey[];

describe("R-18 P2 script copy block (post PR-5)", () => {
  it("defines every key in both languages, non-empty", () => {
    for (const key of SCRIPT_KEYS) {
      expect(ID[key]?.trim().length, `ID ${key}`).toBeGreaterThan(0);
      expect(EN[key]?.trim().length, `EN ${key}`).toBeGreaterThan(0);
    }
  });

  it("the drawer's own strings are gone with the drawer (no dead copy in the dictionary)", () => {
    const keys = Object.keys(EN).filter((k) => k.startsWith("C-script-"));
    expect(keys.sort()).toEqual([...SCRIPT_KEYS].sort());
  });

  it("fills the placeholders in both languages", () => {
    expect(t("en", "C-script-earlier-day", { date: "Mon 12 Oct" })).toBe("Earlier day · Mon 12 Oct");
    expect(t("id", "C-script-earlier-day", { date: "Sen 12 Okt" })).toBe("Hari sebelumnya · Sen 12 Okt");
  });

  it("the day-ended line tells the judge to switch to Supervisor", () => {
    expect(EN["C-script-day-ended"]).toBe("Demo day finished. Switch to Supervisor to see it.");
  });

  it("never names a person or a template id", () => {
    for (const key of SCRIPT_KEYS) expect(EN[key]).not.toMatch(/sandbox|demo-tpl|sbx-/i);
  });
});

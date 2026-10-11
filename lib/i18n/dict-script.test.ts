import { describe, expect, it } from "vitest";
import { EN, ID, t, type DictKey } from "@/lib/i18n/dict";

/** R-18 P2: the demo script drawer, carried-question chip and debrief refresh copy (C-script-*). */
const SCRIPT_KEYS = [
  "C-script-title",
  "C-script-rules",
  "C-script-before",
  "C-script-card",
  "C-script-card-short",
  "C-script-back",
  "C-script-next",
  "C-script-finish",
  "C-script-finishing",
  "C-script-ended",
  "C-script-countdown",
  "C-script-countdown-short",
  "C-script-reload",
  "C-script-collapse",
  "C-script-expand",
  "C-script-say",
  "C-script-own-words",
  "C-script-example",
  "C-script-intent",
  "C-script-seconds",
  "C-script-speaker-you",
  "C-script-speaker-customer",
  "C-script-speaker-colleague",
  "C-script-speaker-caller",
  "C-script-day-ended",
  "C-script-earlier-day",
  "C-script-check-new",
  "C-script-checking",
] as const satisfies readonly DictKey[];

describe("R-18 P2 script copy block", () => {
  it("defines every key in both languages, non-empty", () => {
    for (const key of SCRIPT_KEYS) {
      expect(ID[key]?.trim().length, `ID ${key}`).toBeGreaterThan(0);
      expect(EN[key]?.trim().length, `EN ${key}`).toBeGreaterThan(0);
    }
  });

  it("fills the placeholders in both languages", () => {
    expect(t("en", "C-script-card", { n: 3, total: 11 })).toBe("Card 3 of 11");
    expect(t("id", "C-script-card", { n: 3, total: 11 })).toBe("Kartu 3 dari 11");
    expect(t("en", "C-script-countdown", { time: "4:05" })).toBe("Demo ends automatically in 4:05");
    expect(t("en", "C-script-earlier-day", { date: "Mon 12 Oct" })).toBe("Earlier day · Mon 12 Oct");
    expect(t("id", "C-script-earlier-day", { date: "Sen 12 Okt" })).toBe("Hari sebelumnya · Sen 12 Okt");
    expect(t("en", "C-script-seconds", { n: 15 })).toBe("About 15 s");
    expect(t("en", "C-script-card-short", { n: 3, total: 10 })).toBe("3/10");
    expect(t("en", "C-script-countdown-short", { time: "4:05" })).toBe("Ends in 4:05");
    expect(t("id", "C-script-countdown-short", { time: "4:05" })).toBe("Berakhir 4:05");
  });

  it("the day-ended line tells the judge to switch to Supervisor", () => {
    expect(EN["C-script-day-ended"]).toBe("Demo day finished. Switch to Supervisor to see it.");
  });

  it("never names a person or a template id", () => {
    for (const key of SCRIPT_KEYS) expect(EN[key]).not.toMatch(/sandbox|demo-tpl|sbx-/i);
  });
});

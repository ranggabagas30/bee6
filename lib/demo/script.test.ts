import { describe, expect, it } from "vitest";
import {
  BAKERY_V2,
  CARD_MIN_LINES,
  SCRIPT_BY_ID,
  SCRIPT_V2,
  ScriptCardV2Schema,
  requiredLines,
  scriptFor,
  type ScriptDay,
} from "@/lib/demo/script";
import { SCENARIO_V2 } from "../../scripts/eval-fixtures/scenario-v2";
import { DEMO_SEED } from "../../scripts/seed";

/**
 * R-19 PR-5 (plan section 5.1, section A): the 3-day judge script `bakery-v2`. Exactly 5 cards per day; problem A
 * (fresh egg tarts) on days 1 and 2; problem B (phone order not read back) on days 2 and 3; routine cards never
 * mention a customer or a phone; no person's name, no phone number, no price (hard rules #7, #8).
 */
const DAYS: readonly ScriptDay[] = [1, 2, 3];

function scriptCard(id: string) {
  for (const day of DAYS) {
    const found = SCRIPT_V2[day].find((c) => c.id === id);
    if (found) return found;
  }
  throw new Error(`no card ${id}`);
}

describe("bakery-v2 script (R-19)", () => {
  it("has exactly 5 cards per day, every card valid against the strict schema", () => {
    for (const day of DAYS) {
      expect(SCRIPT_V2[day]).toHaveLength(5);
      for (const c of SCRIPT_V2[day]) expect(() => ScriptCardV2Schema.parse(c)).not.toThrow();
    }
  });

  it("card ids are d{day}-c{n}, unique across the script", () => {
    const ids: string[] = [];
    for (const day of DAYS) {
      SCRIPT_V2[day].forEach((c, i) => {
        expect(c.id).toBe(`d${day}-c${i + 1}`);
        ids.push(c.id);
      });
    }
    expect(new Set(ids).size).toBe(15);
  });

  it("problem A is card 3 of day 1 and card 2 of day 2; problem B is card 3 of day 2 and card 2 of day 3; the rest is routine", () => {
    const problems = DAYS.flatMap((day) => SCRIPT_V2[day].filter((c) => c.problem !== null).map((c) => [c.id, c.problem]));
    expect(problems).toEqual([
      ["d1-c3", "A"],
      ["d2-c2", "A"],
      ["d2-c3", "B"],
      ["d3-c2", "B"],
    ]);
  });

  it("the EN text is word for word the `exact` variant of the rehearsal fixture (SCENARIO_V2), speaker tags stripped", () => {
    for (const scenarioDay of SCENARIO_V2) {
      const script = SCRIPT_V2[scenarioDay.day].map((c) => ({ id: c.id, lines: c.lines.map((l) => l.text.en) }));
      const exact = scenarioDay.variants.exact.map((c) => ({ id: c.id, lines: [...c.lines] }));
      expect(script).toEqual(exact);
    }
  });

  it("problem A speaks customer then staff; problem B is the staff member's voice only (the caller's words are never on the card)", () => {
    for (const id of ["d1-c3", "d2-c2"]) {
      expect(scriptCard(id).lines.map((l) => l.speaker)).toEqual(["customer", "staff", "customer", "staff"]);
    }
    for (const id of ["d2-c3", "d3-c2"]) {
      expect(scriptCard(id).lines.every((l) => l.speaker === "staff")).toBe(true);
      expect(scriptCard(id).lines[0]!.text.en).toMatch(/^Hello, Demo Bakery/);
    }
  });

  it("routine cards never mention a customer, a phone or a colleague; problem A never names a colleague or an unhappy customer", () => {
    for (const day of DAYS) {
      for (const c of SCRIPT_V2[day]) {
        const text = c.lines.map((l) => l.text.en).join(" ").toLowerCase();
        if (c.problem === null) expect(text, c.id).not.toMatch(/customer|phone|call|colleague/);
        if (c.problem === "A") expect(text, c.id).not.toMatch(/check with|colleague|complain|unhappy|angry|refund/);
      }
    }
  });

  it("carries EN and Bahasa text for every card and line, nothing empty, no digits in the spoken text (no price, no number)", () => {
    for (const day of DAYS) {
      for (const c of SCRIPT_V2[day]) {
        expect(c.title.en.trim().length, c.id).toBeGreaterThan(0);
        expect(c.title.id.trim().length, c.id).toBeGreaterThan(0);
        for (const l of c.lines) {
          expect(l.text.en.trim().length, c.id).toBeGreaterThan(0);
          expect(l.text.id.trim().length, c.id).toBeGreaterThan(0);
          expect(l.text.en, c.id).not.toMatch(/\d/);
        }
      }
    }
  });

  it("names no person from the demo staff list and no template or sandbox id (hard rule 7)", () => {
    const all = JSON.stringify(SCRIPT_V2).toLowerCase();
    for (const s of DEMO_SEED.staff) expect(all, s.name).not.toMatch(new RegExp(`\\b${s.name.split(/\s+/)[0]!.toLowerCase()}\\b`));
    expect(all).not.toContain("demo-tpl-");
    expect(all).not.toContain("sbx-");
  });

  it("requiredLines(day) = 5 cards x CARD_MIN_LINES (1) = 5 for every day", () => {
    expect(CARD_MIN_LINES).toBe(1);
    for (const day of DAYS) expect(requiredLines(day)).toBe(5);
  });

  it("is resolvable by script id; bakery-v1 is gone and unknown ids fall back to null", () => {
    expect(SCRIPT_BY_ID["bakery-v2"]).toBe(BAKERY_V2);
    expect(BAKERY_V2.days).toBe(SCRIPT_V2);
    expect(scriptFor("bakery-v2")).toBe(BAKERY_V2);
    expect(scriptFor("bakery-v1")).toBeNull();
    expect(scriptFor("nope")).toBeNull();
  });

  it("the schema refuses a bad id, a 4th day, a non-A/B problem, 0 or 7 lines, and an extra key", () => {
    const ok = SCRIPT_V2[1][0]!;
    expect(ScriptCardV2Schema.safeParse({ ...ok, id: "d4-c1" }).success).toBe(false);
    expect(ScriptCardV2Schema.safeParse({ ...ok, problem: "C" }).success).toBe(false);
    expect(ScriptCardV2Schema.safeParse({ ...ok, lines: [] }).success).toBe(false);
    expect(ScriptCardV2Schema.safeParse({ ...ok, lines: Array(7).fill(ok.lines[0]) }).success).toBe(false);
    expect(ScriptCardV2Schema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
});

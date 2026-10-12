import { describe, expect, it } from "vitest";
import { BAKERY_V1, ScriptCardSchema, SCRIPT_BY_ID, scriptFor } from "@/lib/demo/script";
import { DEMO_SOP_V1 } from "../../scripts/demo-sop";
import { DEMO_SEED } from "../../scripts/seed";

describe("bakery-v1 script (R-18)", () => {
  const cards = BAKERY_V1.cards;

  it("has 11 cards: rules first, finish last, every card valid against the strict schema", () => {
    expect(cards).toHaveLength(11);
    expect(cards[0]!.kind).toBe("rules");
    expect(cards.at(-1)!.kind).toBe("finish");
    for (const c of cards) expect(() => ScriptCardSchema.parse(c)).not.toThrow();
  });

  it("mixes read-aloud and own-words cards", () => {
    const kinds = new Set(cards.map((c) => c.kind));
    expect(kinds.has("say")).toBe(true);
    expect(kinds.has("own_words")).toBe(true);
    for (const c of cards.filter((x) => x.kind === "own_words")) expect(c.example).not.toBeNull();
  });

  it("ids are unique", () => {
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
  });

  it("every sop_step is one of the 5 placeholder SOP step ids", () => {
    const ids = DEMO_SOP_V1.steps.map((s) => s.step_id);
    expect(ids).toHaveLength(5);
    for (const c of cards) if (c.sop_step !== null) expect(ids).toContain(c.sop_step);
    // the script touches every step of the placeholder SOP at least once
    for (const id of ids) expect(cards.some((c) => c.sop_step === id)).toBe(true);
  });

  it("suggested seconds sum to between 150 and 240 (a ~3 min read inside the 5 min hard stop)", () => {
    const sum = cards.reduce((n, c) => n + c.seconds, 0);
    expect(sum).toBeGreaterThanOrEqual(150);
    expect(sum).toBeLessThanOrEqual(240);
  });

  it("carries EN and Bahasa text for every card, nothing empty", () => {
    for (const c of cards) {
      expect(c.text.en.trim().length, c.id).toBeGreaterThan(0);
      expect(c.text.id.trim().length, c.id).toBeGreaterThan(0);
      expect(c.intent.en.trim().length, c.id).toBeGreaterThan(0);
      expect(c.intent.id.trim().length, c.id).toBeGreaterThan(0);
    }
  });

  it("names no person from the demo staff list and no template id (hard rule 7)", () => {
    const all = JSON.stringify(cards).toLowerCase();
    // first names only: the surname-like token "Demo" is also the fictional shop's name
    for (const s of DEMO_SEED.staff) expect(all, s.name).not.toMatch(new RegExp(`\\b${s.name.split(/\s+/)[0]!.toLowerCase()}\\b`));
    expect(all).not.toContain("demo-tpl-");
    expect(all).not.toContain("sbx-");
  });

  it("the phone call card is about a pickup, the hypothetical card talks about something that did not happen", () => {
    const call = cards.find((c) => c.id === "phone-call")!;
    expect(call.expect).toBe("question");
    // the line on the card is what the staff member says when answering, so the speaker is "you", not the caller
    expect(call.speaker).toBe("you");
    const hypo = cards.find((c) => c.id === "hypothetical")!;
    expect(hypo.expect).toBe("none");
    expect(cards.find((c) => c.id === "small-talk")!.expect).toBe("dropped");
  });

  it("is resolvable by script id and unknown ids fall back to null", () => {
    expect(SCRIPT_BY_ID["bakery-v1"]).toBe(BAKERY_V1);
    expect(scriptFor("bakery-v1")).toBe(BAKERY_V1);
    expect(scriptFor("nope")).toBeNull();
  });
});

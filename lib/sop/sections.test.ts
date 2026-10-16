import { describe, it, expect } from "vitest";
import type { SopStep } from "@/lib/firestore/schema";
import { deriveSections } from "./sections";
import { DEMO_SOP_V1 } from "@/scripts/demo-sop";

describe("deriveSections", () => {
  it("demo 5-step SOP collapses to one 'all' section", () => {
    const sections = deriveSections(DEMO_SOP_V1.steps);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toEqual({
      section_id: "all",
      title: "Whole SOP",
      step_ids: ["open-01", "bake-01", "stock-01", "serve-01", "close-01"],
    });
  });

  it("fixture with 4 procedures yields 4 sections in order", () => {
    const fixture: SopStep[] = [
      {
        step_id: "bake-dubai-01",
        title: "Dubai Chewy · Mix ingredients",
        text: "Mix flour and butter.",
        role: "staff",
      },
      {
        step_id: "bake-dubai-02",
        title: "Dubai Chewy · Portion dough",
        text: "Portion onto tray.",
        role: "staff",
      },
      {
        step_id: "bake-dubai-03",
        title: "Dubai Chewy · Bake 14 min",
        text: "Bake at 170°C for 14 min.",
        role: "staff",
      },
      {
        step_id: "bake-ube-01",
        title: "Ube Cookie · Mix ingredients",
        text: "Mix ube and butter.",
        role: "staff",
      },
      {
        step_id: "bake-ube-02",
        title: "Ube Cookie · Portion dough",
        text: "Portion onto tray.",
        role: "staff",
      },
      {
        step_id: "bake-ube-03",
        title: "Ube Cookie · Bake 16 min",
        text: "Bake at 180°C for 16 min.",
        role: "staff",
      },
      {
        step_id: "serve-01",
        title: "Serve",
        text: "Greet and take order.",
        role: "staff",
      },
      {
        step_id: "close-01",
        title: "Close",
        text: "Clean and count till.",
        role: "supervisor",
      },
    ];

    const sections = deriveSections(fixture);
    expect(sections).toHaveLength(4);
    expect(sections[0]!.section_id).toBe("dubai-chewy");
    expect(sections[0]!.title).toBe("Dubai Chewy");
    expect(sections[0]!.step_ids).toEqual(["bake-dubai-01", "bake-dubai-02", "bake-dubai-03"]);

    expect(sections[1]!.section_id).toBe("ube-cookie");
    expect(sections[1]!.title).toBe("Ube Cookie");
    expect(sections[1]!.step_ids).toEqual(["bake-ube-01", "bake-ube-02", "bake-ube-03"]);

    expect(sections[2]!.section_id).toBe("serve");
    expect(sections[2]!.title).toBe("serve");
    expect(sections[2]!.step_ids).toEqual(["serve-01"]);

    expect(sections[3]!.section_id).toBe("close");
    expect(sections[3]!.title).toBe("close");
    expect(sections[3]!.step_ids).toEqual(["close-01"]);
  });

  it("title convention 'Section · Title' extracts section id and title", () => {
    const fixture: SopStep[] = [
      {
        step_id: "abc-01",
        title: "Dubai Chewy · Mix the dough",
        text: "Text",
        role: "staff",
      },
      {
        step_id: "abc-02",
        title: "Dubai Chewy · Portion the dough",
        text: "Text",
        role: "staff",
      },
      {
        step_id: "def-01",
        title: "Ube Cookie · Mix the dough",
        text: "Text",
        role: "staff",
      },
    ];
    const sections = deriveSections(fixture);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.section_id).toBe("dubai-chewy");
    expect(sections[0]!.title).toBe("Dubai Chewy");
    expect(sections[0]!.step_ids).toEqual(["abc-01", "abc-02"]);
    expect(sections[1]!.section_id).toBe("ube-cookie");
    expect(sections[1]!.title).toBe("Ube Cookie");
    expect(sections[1]!.step_ids).toEqual(["def-01"]);
  });

  it("all section ids match the step_id regex", () => {
    const fixture: SopStep[] = [
      {
        step_id: "bake-dubai-01",
        title: "Bake Dubai",
        text: "Text",
        role: "staff",
      },
      {
        step_id: "open-02",
        title: "Open",
        text: "Text",
        role: "staff",
      },
    ];
    const sections = deriveSections(fixture);
    // Each section_id (without the "all" degenerate case) should match the regex /^[a-z0-9][a-z0-9_-]{0,39}[a-z0-9]$/|^[a-z0-9]$/
    const regex = /^[a-z0-9]([a-z0-9_-]{0,38}[a-z0-9])?$/;
    sections.forEach((s) => {
      expect(regex.test(s.section_id)).toBe(true);
    });
  });

  it("collision merges sections with the same id", () => {
    const fixture: SopStep[] = [
      {
        step_id: "bake-01",
        title: "Bake step one",
        text: "Text",
        role: "staff",
      },
      {
        step_id: "bake-02",
        title: "Another bake",
        text: "Text",
        role: "staff",
      },
      {
        step_id: "bake-03",
        title: "Yet another bake",
        text: "Text",
        role: "staff",
      },
      {
        step_id: "serve-01",
        title: "Serve a customer",
        text: "Text",
        role: "staff",
      },
    ];
    const sections = deriveSections(fixture);
    // First three steps have the same section_id "bake" after stripping trailing digits
    // Last step has section_id "serve", so we get 2 sections (not degenerate)
    expect(sections).toHaveLength(2);
    expect(sections[0]!.section_id).toBe("bake");
    expect(sections[0]!.step_ids).toEqual(["bake-01", "bake-02", "bake-03"]);
    expect(sections[1]!.section_id).toBe("serve");
    expect(sections[1]!.step_ids).toEqual(["serve-01"]);
  });

  it("step ids without hyphens before digits are stripped correctly", () => {
    // Test cases: open01, open02 (no hyphen before digits)
    // and a mixed set: prep1, prep2, bake-01, bake-02 giving 2 sections
    const fixture: SopStep[] = [
      {
        step_id: "open01",
        title: "Open shift",
        text: "Text",
        role: "staff",
      },
      {
        step_id: "open02",
        title: "Check supplies",
        text: "Text",
        role: "staff",
      },
      {
        step_id: "prep1",
        title: "Prep vegetables",
        text: "Text",
        role: "staff",
      },
      {
        step_id: "prep2",
        title: "Prep sauces",
        text: "Text",
        role: "staff",
      },
      {
        step_id: "bake-01",
        title: "Bake bread",
        text: "Text",
        role: "staff",
      },
      {
        step_id: "bake-02",
        title: "Bake pastries",
        text: "Text",
        role: "staff",
      },
    ];
    const sections = deriveSections(fixture);
    expect(sections).toHaveLength(3);
    expect(sections[0]!.section_id).toBe("open");
    expect(sections[0]!.step_ids).toEqual(["open01", "open02"]);
    expect(sections[1]!.section_id).toBe("prep");
    expect(sections[1]!.step_ids).toEqual(["prep1", "prep2"]);
    expect(sections[2]!.section_id).toBe("bake");
    expect(sections[2]!.step_ids).toEqual(["bake-01", "bake-02"]);
  });

  it("title that slugs to empty string falls through to step_id path", () => {
    // Title "— · Mix" has group 1 = "—" which slugs to empty string
    // Should fall through to step_id path and use section_id from step_id
    const fixture: SopStep[] = [
      {
        step_id: "mix-01",
        title: "— · Mix",
        text: "Text",
        role: "staff",
      },
      {
        step_id: "mix-02",
        title: "— · Blend",
        text: "Text",
        role: "staff",
      },
      {
        step_id: "serve-01",
        title: "Serve",
        text: "Text",
        role: "staff",
      },
    ];
    const sections = deriveSections(fixture);
    expect(sections).toHaveLength(2);
    // First two steps should use "mix" from step_id (without trailing digits)
    expect(sections[0]!.section_id).toBe("mix");
    expect(sections[0]!.title).toBe("mix");
    expect(sections[0]!.step_ids).toEqual(["mix-01", "mix-02"]);
    // Last step should use "serve" from step_id
    expect(sections[1]!.section_id).toBe("serve");
    expect(sections[1]!.title).toBe("serve");
    expect(sections[1]!.step_ids).toEqual(["serve-01"]);
  });
});

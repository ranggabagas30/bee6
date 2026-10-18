import { describe, expect, it } from "vitest";
import { CATEGORY_CODE, CATEGORY_LABELS, questionCategoryChip, questionLines, questionText, questionWhy } from "@/lib/i18n/category-labels";
import type { DebriefQuestionView } from "@/lib/debrief/contract";
import type { WorkCategory } from "@/lib/pipeline/categories";

/**
 * Debrief question-text templates (R-07 Task 7.3, UX-03 section 5.12.3/6).
 * `questionText` renders only an enum-mapped label and the two HH:MM
 * strings the server sends — never a thread line, a name or a role
 * (CLAUDE.md hard rule #7a: thread text can still hold a staff name).
 */

const EN_LABELS: Record<WorkCategory, string> = {
  ROUTINE_OPS: "routine work",
  CUSTOMER_SERVICE: "customer service",
  TRAINING: "training",
  STAFF_CONSULT: "a staff question about a situation",
  CORRECTION: "a correction",
  PHONE_CALL: "a phone call",
  EVENT: "planned event work",
  COMPLAINT: "a customer complaint",
  SAFETY_INCIDENT: "a safety incident",
  SECURITY_INCIDENT: "a security incident",
  DISRUPTION: "a disruption to operations",
};

function q(overrides: Partial<DebriefQuestionView> = {}): DebriefQuestionView {
  return {
    question_id: "q1",
    kind: "gate",
    category: "ROUTINE_OPS",
    start_hm: "15:00",
    end_hm: "15:10",
    ...overrides,
  };
}

describe("CATEGORY_LABELS", () => {
  it("has all 11 EN work-category labels, verbatim from UX-03 section 5.12.3", () => {
    expect(CATEGORY_LABELS.en).toEqual(EN_LABELS);
  });

  it("has no ID labels yet (Q-U23 pending)", () => {
    expect(CATEGORY_LABELS.id).toEqual({});
  });
});

describe("questionText", () => {
  it("gate + a known category renders the step template with the EN label", () => {
    const text = questionText("en", q({ kind: "gate", category: "ROUTINE_OPS", start_hm: "15:00" }));
    expect(text).toBe("Around 15:00 there was routine work. Is that right?");
  });

  it("every work category has a non-empty EN step rendering", () => {
    for (const category of Object.keys(EN_LABELS) as WorkCategory[]) {
      const text = questionText("en", q({ kind: "gate", category, start_hm: "09:30" }));
      expect(text).toBe(`Around 09:30 there was ${EN_LABELS[category]}. Is that right?`);
    }
  });

  it("gate + ID language falls back to the block template (no ID labels yet)", () => {
    const text = questionText("id", q({ kind: "gate", category: "ROUTINE_OPS", start_hm: "15:00", end_hm: "15:10" }));
    expect(text).toBe("Sekitar pukul 15:00–15:10 ada kegiatan kerja. Benar?");
  });

  it("gate + category: null falls back to the block template", () => {
    const text = questionText("en", q({ kind: "gate", category: null, start_hm: "08:00", end_hm: "08:30" }));
    expect(text).toBe("Between 08:00 and 08:30 there was work. Is that right?");
  });

  it("unlabelled_unit always uses the block template, even with a category", () => {
    const text = questionText(
      "en",
      q({ kind: "unlabelled_unit", category: "ROUTINE_OPS", start_hm: "11:00", end_hm: "11:20" }),
    );
    expect(text).toBe("Between 11:00 and 11:20 there was work. Is that right?");
  });

  it("an unknown/unmapped category code falls back to the block template", () => {
    const text = questionText(
      "en",
      q({ kind: "gate", category: "NOT_A_REAL_CATEGORY" as WorkCategory, start_hm: "10:00", end_hm: "10:05" }),
    );
    expect(text).toBe("Between 10:00 and 10:05 there was work. Is that right?");
  });

  it("never renders anything beyond the enum-mapped label and the two HH:MM strings", () => {
    // No thread id, device id, kind code or raw category code ever appears.
    const text = questionText("en", q({ question_id: "q_thread_unit_d1_SAFETY_INCIDENT:T9", kind: "gate", category: "SAFETY_INCIDENT" }));
    expect(text).not.toContain("q_thread");
    expect(text).not.toContain("SAFETY_INCIDENT");
    expect(text).not.toContain("d1");
    expect(text).toBe("Around 15:00 there was a safety incident. Is that right?");
  });
});

describe("questionLines", () => {
  it("a step template (EN or ID) is always a single line", () => {
    expect(questionLines("en", q({ kind: "gate", category: "ROUTINE_OPS", start_hm: "15:00" }))).toEqual([
      "Around 15:00 there was routine work. Is that right?",
    ]);
  });

  it("the EN block template renders two lines (empty lines filtered)", () => {
    const lines = questionLines("en", q({ kind: "gate", category: null, start_hm: "08:00", end_hm: "08:30" }));
    expect(lines).toEqual(["Between 08:00 and 08:30 there was work.", "Is that right?"]);
  });

  it("the ID block template renders one line (its -2 row is empty)", () => {
    const lines = questionLines("id", q({ kind: "gate", category: "ROUTINE_OPS", start_hm: "15:00", end_hm: "15:10" }));
    expect(lines).toEqual(["Sekitar pukul 15:00–15:10 ada kegiatan kerja. Benar?"]);
  });

  it("questionText is questionLines joined with a space", () => {
    const question = q({ kind: "gate", category: null, start_hm: "08:00", end_hm: "08:30" });
    expect(questionText("en", question)).toBe(questionLines("en", question).join(" "));
  });
});

describe("questionLines / questionText with a DebriefAgent question_text (docs/tasks/debrief-agent-18oct.md §5.6)", () => {
  const TEXT = "Around 15:00, was the oven checked before opening?";

  it("question_text REPLACES the template heading, in both languages (EN wording in a Bahasa UI is the accepted state)", () => {
    for (const lang of ["en", "id"] as const) {
      expect(questionLines(lang, q({ question_text: TEXT }))).toEqual([TEXT]);
    }
  });

  it("question_text wins over the block template too (a gate question with no label)", () => {
    expect(questionLines("en", q({ category: null, question_text: TEXT }))).toEqual([TEXT]);
  });

  it("questionText (the radiogroup aria-label, and the answered-row text) stays the template", () => {
    expect(questionText("en", q({ question_text: TEXT }))).toBe("Around 15:00 there was routine work. Is that right?");
    expect(questionText("id", q({ question_text: TEXT }))).toBe("Sekitar pukul 15:00–15:10 ada kegiatan kerja. Benar?");
  });

  it("absent question_text: the template, exactly as before", () => {
    expect(questionLines("en", q())).toEqual(["Around 15:00 there was routine work. Is that right?"]);
  });
});

describe("questionWhy (R-25 T7, board P2-09 explanation line)", () => {
  const categories = Object.keys(EN_LABELS) as WorkCategory[];

  it("every category has its own non-empty sentence in EN and ID", () => {
    const seen = new Set<string>();
    for (const lang of ["en", "id"] as const) {
      for (const category of categories) {
        const line = questionWhy(lang, q({ category }));
        expect(line.length).toBeGreaterThan(0);
        seen.add(`${lang}:${line}`);
      }
    }
    expect(seen.size).toBe(categories.length * 2);
  });

  it("is role-agnostic and never carries a placeholder, a time or a name slot", () => {
    for (const lang of ["en", "id"] as const) {
      for (const question of [...categories.map((category) => q({ category, start_hm: "10:40", end_hm: "10:50" })), q({ kind: "unlabelled_unit", category: null })]) {
        const line = questionWhy(lang, question);
        expect(line).not.toMatch(/[{}]/);
        expect(line).not.toContain("10:40");
        expect(line).not.toMatch(/\b(supervisor|owner|staff member named)\b/i);
      }
    }
  });

  it("an unlabelled block (or a gate with no category) gets the could-not-tell sentence", () => {
    const expected = "Bee6 heard work here but could not tell what. It needs your answer to be sure.";
    expect(questionWhy("en", q({ kind: "unlabelled_unit", category: null }))).toBe(expected);
    expect(questionWhy("en", q({ kind: "gate", category: null }))).toBe(expected);
  });
});

describe("questionCategoryChip (R-25 T7, board P2-09 chip)", () => {
  it("has a distinct three-letter code for each of the 11 work categories", () => {
    const codes = Object.values(CATEGORY_CODE).map((c) => c.code);
    expect(codes).toHaveLength(11);
    expect(new Set(codes).size).toBe(11);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{3}$/);
  });

  it("customer service is CST (as on the board) and is spoken by its name", () => {
    expect(questionCategoryChip("en", q({ category: "CUSTOMER_SERVICE" }))).toEqual({ code: "CST", name: "Customer service" });
    expect(questionCategoryChip("id", q({ category: "CUSTOMER_SERVICE" }))?.name).toBe("Layanan pelanggan");
  });

  it("no chip for a block question", () => {
    expect(questionCategoryChip("en", q({ kind: "unlabelled_unit", category: null }))).toBeNull();
  });
});

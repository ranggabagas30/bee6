import { describe, expect, it } from "vitest";
import { CATEGORY_LABELS, questionText } from "@/lib/i18n/category-labels";
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

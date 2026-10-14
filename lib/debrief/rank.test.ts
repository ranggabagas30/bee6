import { describe, expect, it } from "vitest";
import { rankQuestions } from "@/lib/debrief/rank";
import type { Question } from "@/lib/firestore/schema";

function q(overrides: Partial<Question>): Question {
  return {
    outlet_id: "o1",
    question_id: "q1",
    device_id: "d1",
    thread_id: null,
    kind: "gate",
    status: "open",
    category: "ROUTINE_OPS",
    window_start_ms: 0,
    window_end_ms: 1000,
    created_at_ms: 0,
    ...overrides,
  };
}

describe("rankQuestions", () => {
  it("puts an incident-category gate question before a non-incident one, regardless of time", () => {
    const incident = q({ question_id: "q_incident", category: "SAFETY_INCIDENT", window_start_ms: 10_000 });
    const routine = q({ question_id: "q_routine", category: "ROUTINE_OPS", window_start_ms: 0 });
    const result = rankQuestions([routine, incident]);
    expect(result.map((r) => r.question_id)).toEqual(["q_incident", "q_routine"]);
  });

  it("orders by window_start_ms ascending within the same rank", () => {
    const a = q({ question_id: "q_a", window_start_ms: 2000 });
    const b = q({ question_id: "q_b", window_start_ms: 1000 });
    const result = rankQuestions([a, b]);
    expect(result.map((r) => r.question_id)).toEqual(["q_b", "q_a"]);
  });

  it("breaks a tie on window_start_ms by question_id ascending", () => {
    const a = q({ question_id: "q_z", window_start_ms: 1000 });
    const b = q({ question_id: "q_a", window_start_ms: 1000 });
    const result = rankQuestions([a, b]);
    expect(result.map((r) => r.question_id)).toEqual(["q_a", "q_z"]);
  });

  it("an unlabelled_unit question is never treated as an incident even with a DISRUPTION-like category", () => {
    const unlabelled = q({ question_id: "q_u", kind: "unlabelled_unit", category: null, window_start_ms: 5000 });
    const routine = q({ question_id: "q_r", kind: "gate", category: "ROUTINE_OPS", window_start_ms: 0 });
    const result = rankQuestions([unlabelled, routine]);
    expect(result.map((r) => r.question_id)).toEqual(["q_r", "q_u"]);
  });

  describe("R-19 3.1 three tiers: incident, then non-ROUTINE_OPS gate, then the rest (ROUTINE_OPS gate + unlabelled)", () => {
    it("PHONE_CALL gate before ROUTINE_OPS gate before unlabelled, incidents first, whatever the times say", () => {
      const incident = q({ question_id: "q_incident", category: "SECURITY_INCIDENT", window_start_ms: 9_000 });
      const phone = q({ question_id: "q_phone", category: "PHONE_CALL", window_start_ms: 3_000 });
      const routine = q({ question_id: "q_routine", category: "ROUTINE_OPS", window_start_ms: 1_000 });
      const unlabelled = q({ question_id: "q_unlabelled", kind: "unlabelled_unit", category: null, window_start_ms: 2_000 });
      const result = rankQuestions([unlabelled, routine, phone, incident]);
      expect(result.map((r) => r.question_id)).toEqual(["q_incident", "q_phone", "q_routine", "q_unlabelled"]);
    });

    it("a CUSTOMER_SERVICE gate question from later in the day still ranks before an earlier ROUTINE_OPS one", () => {
      const cs = q({ question_id: "q_cs", category: "CUSTOMER_SERVICE", window_start_ms: 50_000 });
      const routine = q({ question_id: "q_routine", category: "ROUTINE_OPS", window_start_ms: 0 });
      expect(rankQuestions([routine, cs]).map((r) => r.question_id)).toEqual(["q_cs", "q_routine"]);
    });

    it("inside the last tier a ROUTINE_OPS gate and an unlabelled unit are ordered by time, then id", () => {
      const routineLate = q({ question_id: "q_routine", category: "ROUTINE_OPS", window_start_ms: 5_000 });
      const unlabelledEarly = q({ question_id: "q_unlabelled", kind: "unlabelled_unit", category: null, window_start_ms: 1_000 });
      expect(rankQuestions([routineLate, unlabelledEarly]).map((r) => r.question_id)).toEqual(["q_unlabelled", "q_routine"]);
    });

    it("with a cap of 5 on the phone, six earlier routine questions never push the one PHONE_CALL question out", () => {
      const routines = Array.from({ length: 6 }, (_, i) => q({ question_id: `q_r${i}`, category: "ROUTINE_OPS", window_start_ms: i }));
      const phone = q({ question_id: "q_phone", category: "PHONE_CALL", window_start_ms: 100 });
      const result = rankQuestions([...routines, phone]);
      expect(result[0]?.question_id).toBe("q_phone");
    });
  });

  it("caps the result at DEBRIEF_LIST_SERVER_CAP", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      q({ question_id: `q_${String(i).padStart(2, "0")}`, window_start_ms: i }),
    );
    expect(rankQuestions(many)).toHaveLength(10);
  });
});

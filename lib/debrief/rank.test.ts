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

  it("caps the result at DEBRIEF_LIST_SERVER_CAP", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      q({ question_id: `q_${String(i).padStart(2, "0")}`, window_start_ms: i }),
    );
    expect(rankQuestions(many)).toHaveLength(10);
  });
});

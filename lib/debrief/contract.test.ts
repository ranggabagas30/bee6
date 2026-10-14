import { describe, expect, it } from "vitest";
import {
  AnswerBodySchema,
  AnswerCacheEntrySchema,
  AnswerResponseSchema,
  DebriefListResponseSchema,
  DebriefQuestionViewSchema,
} from "@/lib/debrief/contract";
import { CorrectionSchema } from "@/lib/firestore/schema";

const goodAnswerBody = {
  question_id: "q_thread_unit_d1_w1:T1",
  debrief_business_date: "2026-10-07",
  answer: "yes" as const,
  reason: "lupa restock",
  answered_at_ms: 1_700_000_000_000,
};

describe("AnswerBodySchema", () => {
  it("accepts the exact five keys", () => {
    expect(AnswerBodySchema.safeParse(goodAnswerBody).success).toBe(true);
  });

  it("rejects a missing answer", () => {
    const { answer: _drop, ...rest } = goodAnswerBody;
    expect(AnswerBodySchema.safeParse(rest).success).toBe(false);
  });

  it("rejects answer: maybe", () => {
    expect(AnswerBodySchema.safeParse({ ...goodAnswerBody, answer: "maybe" }).success).toBe(false);
  });

  for (const extraKey of ["skip", "explanation", "chosen_category", "staff_id", "device_id", "answered_by"]) {
    it(`rejects an extra ${extraKey} key`, () => {
      expect(
        AnswerBodySchema.safeParse({ ...goodAnswerBody, [extraKey]: "x" }).success,
      ).toBe(false);
    });
  }
});

describe("AnswerCacheEntrySchema", () => {
  const good = {
    question_id: "q1",
    debrief_business_date: "2026-10-07",
    answer: "yes" as const,
    reason: "ok",
    answered_at_ms: 1_700_000_000_000,
  };

  it("has exactly the five keys", () => {
    expect(Object.keys(AnswerCacheEntrySchema.shape).sort()).toEqual(
      ["question_id", "debrief_business_date", "answer", "reason", "answered_at_ms"].sort(),
    );
  });

  for (const extraKey of ["name", "staff_id", "role", "device_id"]) {
    it(`rejects an extra ${extraKey} key`, () => {
      expect(AnswerCacheEntrySchema.safeParse({ ...good, [extraKey]: "x" }).success).toBe(false);
    });
  }

  it("rejects an empty reason", () => {
    expect(AnswerCacheEntrySchema.safeParse({ ...good, reason: "" }).success).toBe(false);
  });

  it("rejects an untrimmed reason", () => {
    expect(AnswerCacheEntrySchema.safeParse({ ...good, reason: " x" }).success).toBe(false);
  });

  it("rejects 501 code points", () => {
    expect(
      AnswerCacheEntrySchema.safeParse({ ...good, reason: "a".repeat(501) }).success,
    ).toBe(false);
  });

  it("accepts 500 code points including one emoji", () => {
    const reason = "😀" + "a".repeat(499);
    expect(Array.from(reason).length).toBe(500);
    expect(AnswerCacheEntrySchema.safeParse({ ...good, reason }).success).toBe(true);
  });
});

describe("CorrectionSchema", () => {
  const good = {
    outlet_id: "proofed",
    correction_id: "q1",
    question_id: "q1",
    thread_id: "unit_d1_w1:T1",
    answer: "yes" as const,
    reason_text: "[STAFF] lupa restock",
    answered_device_id: "d1",
    debrief_business_date: "2026-10-07",
    answered_at_ms: 1_700_000_000_000,
    received_at_ms: 1_700_000_001_000,
    needs_supervisor_confirm: false,
    expires_at: "2026-10-21T00:00:00.000Z",
    created_at: "2026-10-07T00:00:00.000Z",
  };

  it("accepts a well-formed correction", () => {
    expect(CorrectionSchema.safeParse(good).success).toBe(true);
  });

  it("requires answer", () => {
    const { answer: _drop, ...rest } = good;
    expect(CorrectionSchema.safeParse(rest).success).toBe(false);
  });

  for (const extraKey of ["answered_by", "staff_id", "name", "chosen_category", "reason_code"]) {
    it(`rejects an extra ${extraKey} key`, () => {
      expect(CorrectionSchema.safeParse({ ...good, [extraKey]: "x" }).success).toBe(false);
    });
  }

  it("accepts a null thread_id (unlabelled_unit)", () => {
    expect(CorrectionSchema.safeParse({ ...good, thread_id: null, needs_supervisor_confirm: false }).success).toBe(
      true,
    );
  });
});

describe("DebriefQuestionViewSchema", () => {
  const good = {
    question_id: "q1",
    kind: "gate" as const,
    category: "ROUTINE_OPS" as const,
    start_hm: "02:05",
    end_hm: "02:10",
  };

  it("accepts a well-formed view", () => {
    expect(DebriefQuestionViewSchema.safeParse(good).success).toBe(true);
  });

  it("accepts a null category for unlabelled_unit", () => {
    expect(
      DebriefQuestionViewSchema.safeParse({ ...good, kind: "unlabelled_unit", category: null }).success,
    ).toBe(true);
  });

  it("rejects NON_WORK as a category (debrief never shows it)", () => {
    expect(DebriefQuestionViewSchema.safeParse({ ...good, category: "NON_WORK" }).success).toBe(false);
  });

  for (const extraKey of ["device_id", "thread_id", "status", "text"]) {
    it(`rejects an extra ${extraKey} key`, () => {
      expect(DebriefQuestionViewSchema.safeParse({ ...good, [extraKey]: "x" }).success).toBe(false);
    });
  }
});

describe("DebriefListResponseSchema", () => {
  it("accepts a null debrief with no questions", () => {
    expect(DebriefListResponseSchema.safeParse({ debrief: null, questions: [] }).success).toBe(true);
  });

  it("accepts an active debrief with questions", () => {
    expect(
      DebriefListResponseSchema.safeParse({
        debrief: { business_date: "2026-10-07", ends_at_ms: 1_700_000_000_000 },
        questions: [
          { question_id: "q1", kind: "gate", category: "ROUTINE_OPS", start_hm: "02:00", end_hm: "02:05" },
        ],
      }).success,
    ).toBe(true);
  });

  it("R-19: accepts an optional boolean `preparing` (sandbox only) and rejects a non-boolean one", () => {
    const active = { debrief: { business_date: "2026-10-07", ends_at_ms: 1_700_000_000_000 }, questions: [] };
    expect(DebriefListResponseSchema.safeParse({ ...active, preparing: true }).success).toBe(true);
    expect(DebriefListResponseSchema.safeParse({ ...active, preparing: false }).success).toBe(true);
    expect(DebriefListResponseSchema.safeParse({ ...active, preparing: "yes" }).success).toBe(false);
  });
});

describe("AnswerResponseSchema", () => {
  it("accepts answered and already_answered", () => {
    expect(AnswerResponseSchema.safeParse({ status: "answered" }).success).toBe(true);
    expect(AnswerResponseSchema.safeParse({ status: "already_answered" }).success).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(AnswerResponseSchema.safeParse({ status: "pending" }).success).toBe(false);
  });
});

describe("DebriefQuestionViewSchema: R-18 optional business_date (earlier-day chip)", () => {
  const base = { question_id: "q1", kind: "gate", category: "ROUTINE_OPS", start_hm: "10:00", end_hm: "10:05" };
  it("accepts a view without it (every pilot response) and with a YYYY-MM-DD date", () => {
    expect(DebriefQuestionViewSchema.safeParse(base).success).toBe(true);
    expect(DebriefQuestionViewSchema.safeParse({ ...base, business_date: "2026-10-12" }).success).toBe(true);
  });
  it("rejects a malformed date and any other extra key", () => {
    expect(DebriefQuestionViewSchema.safeParse({ ...base, business_date: "12 Oct" }).success).toBe(false);
    expect(DebriefQuestionViewSchema.safeParse({ ...base, staff_id: "x" }).success).toBe(false);
  });
});


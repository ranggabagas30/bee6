import { describe, expect, it } from "vitest";
import {
  AnswerBodySchema,
  AnswerCacheEntrySchema,
  AnswerResponseSchema,
  DebriefListResponseSchema,
  DebriefQuestionViewSchema,
} from "@/lib/debrief/contract";
import { QUESTION_LINES_MAX, QUESTION_LINE_MAX_CHARS } from "@/lib/debrief/constants";
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


describe("DebriefQuestionViewSchema: demo-feedback-2 item 10 optional `lines` (sandbox only)", () => {
  const base = { question_id: "q1", kind: "gate", category: "ROUTINE_OPS", start_hm: "10:00", end_hm: "10:05" };
  const parse = (extra: Record<string, unknown>) => DebriefQuestionViewSchema.safeParse({ ...base, ...extra });

  it("accepts a view without `lines` (every pilot response)", () => {
    expect(parse({}).success).toBe(true);
  });

  it("accepts one or two non-empty lines", () => {
    expect(parse({ lines: ["Telur tart masih segar."] }).success).toBe(true);
    expect(parse({ lines: ["a", "b"] }).success).toBe(true);
  });

  it("rejects more than QUESTION_LINES_MAX (2) lines", () => {
    expect(QUESTION_LINES_MAX).toBe(2);
    expect(parse({ lines: ["a", "b", "c"] }).success).toBe(false);
  });

  it("rejects an empty line", () => {
    expect(parse({ lines: [""] }).success).toBe(false);
  });

  it("counts code points, not UTF-16 units: 160 emoji pass, 161 fail", () => {
    expect(QUESTION_LINE_MAX_CHARS).toBe(160);
    expect(parse({ lines: ["😀".repeat(160)] }).success).toBe(true);
    expect(parse({ lines: ["😀".repeat(161)] }).success).toBe(false);
    expect(parse({ lines: ["a".repeat(161)] }).success).toBe(false);
  });

  it("rejects a non-string line and a non-array `lines`", () => {
    expect(parse({ lines: [1] }).success).toBe(false);
    expect(parse({ lines: "Telur tart" }).success).toBe(false);
  });

  it("stays strict: an extra key next to `lines` is still rejected", () => {
    expect(parse({ lines: ["a"], text: "x" }).success).toBe(false);
    expect(parse({ lines: ["a"], thread_id: "t1" }).success).toBe(false);
  });
});

describe("AnswerCacheEntrySchema: demo-feedback-2 item 10 keeps the phone cache text-free of the quoted lines", () => {
  const entry = {
    question_id: "q1",
    debrief_business_date: "2026-10-07",
    answer: "yes" as const,
    reason: "sudah",
    answered_at_ms: 1_700_000_000_000,
  };
  it("rejects a `lines` key (the question's quoted text can never be cached)", () => {
    expect(AnswerCacheEntrySchema.safeParse(entry).success).toBe(true);
    expect(AnswerCacheEntrySchema.safeParse({ ...entry, lines: ["Pelanggan tanya roti."] }).success).toBe(false);
  });
  it("AnswerBodySchema (the upload body) rejects it as well", () => {
    expect(AnswerBodySchema.safeParse({ ...entry, lines: ["x"] }).success).toBe(false);
  });
});

describe("DebriefQuestionViewSchema: DebriefAgent optional `question_text` (sandbox only)", () => {
  const base = { question_id: "q1", kind: "gate", category: "PHONE_CALL", start_hm: "14:05", end_hm: "14:08" };
  const parse = (extra: Record<string, unknown>) => DebriefQuestionViewSchema.safeParse({ ...base, ...extra });
  const of = (n: number, ch = "a") => ch.repeat(n);

  it("accepts a view without it (every pilot response, flag off, fallback)", () => {
    expect(parse({}).success).toBe(true);
  });

  // M3: the field is read LENIENTLY. A bad value drops that one field (the phone keeps the template heading) and
  // never fails the question, so one bad wording can no longer fail the whole list.
  const textOf = (extra: Record<string, unknown>): unknown => {
    const r = parse(extra);
    expect(r.success).toBe(true);
    return r.success ? r.data.question_text : "unreachable";
  };

  it("keeps 20..140 code points and drops 19 and 141 (the question itself still parses)", () => {
    expect(textOf({ question_text: of(19) })).toBeUndefined();
    expect(textOf({ question_text: of(20) })).toBe(of(20));
    expect(textOf({ question_text: of(140) })).toBe(of(140));
    expect(textOf({ question_text: of(141) })).toBeUndefined();
  });

  it("counts code points, not UTF-16 units", () => {
    expect(textOf({ question_text: of(70, "😀") })).toBe(of(70, "😀"));
    expect(textOf({ question_text: of(141, "😀") })).toBeUndefined();
  });

  it("a non-string, null or object question_text is dropped, not fatal", () => {
    for (const bad of [5, null, {}, [], true]) expect(textOf({ question_text: bad })).toBeUndefined();
  });

  it("the rest stays strict: unknown keys next to it, and every other bad field, still fail", () => {
    expect(parse({ question_text: of(30), agent: {} }).success).toBe(false);
    expect(parse({ question_text: 5, extra: 1 }).success).toBe(false);
    expect(parse({ question_text: of(30), kind: "weird" }).success).toBe(false);
    expect(parse({ question_text: of(30), start_hm: "1405" }).success).toBe(false);
  });

  it("one bad question_text does not fail the list; the other questions keep theirs", () => {
    const list = DebriefListResponseSchema.safeParse({
      debrief: { business_date: "2026-10-07", ends_at_ms: 1 },
      questions: [
        { ...base, question_id: "q1", question_text: of(5) },
        { ...base, question_id: "q2", question_text: of(30) },
      ],
    });
    expect(list.success).toBe(true);
    if (list.success) {
      expect(list.data.questions[0]!.question_text).toBeUndefined();
      expect(list.data.questions[1]!.question_text).toBe(of(30));
    }
  });

  it("the answer upload body and the phone cache never accept it", () => {
    const entry = {
      question_id: "q1",
      debrief_business_date: "2026-10-07",
      answer: "yes" as const,
      reason: "sudah",
      answered_at_ms: 1_700_000_000_000,
    };
    expect(AnswerBodySchema.safeParse({ ...entry, question_text: of(30) }).success).toBe(false);
    expect(AnswerCacheEntrySchema.safeParse({ ...entry, question_text: of(30) }).success).toBe(false);
  });
});

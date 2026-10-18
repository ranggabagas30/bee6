import { describe, expect, it } from "vitest";
import { DebriefQuestionArgsSchema, DebriefQuestionDraftSchema } from "@/lib/debrief/agent/schema";

const of = (n: number, ch = "a") => ch.repeat(n);

describe("DebriefQuestionDraftSchema", () => {
  it("accepts 20 and 140 code points, rejects 19 and 141", () => {
    expect(DebriefQuestionDraftSchema.safeParse({ question_en: of(19) }).success).toBe(false);
    expect(DebriefQuestionDraftSchema.safeParse({ question_en: of(20) }).success).toBe(true);
    expect(DebriefQuestionDraftSchema.safeParse({ question_en: of(140) }).success).toBe(true);
    expect(DebriefQuestionDraftSchema.safeParse({ question_en: of(141) }).success).toBe(false);
  });

  it("counts an emoji as ONE code point (not two UTF-16 units)", () => {
    // 70 emoji = 140 UTF-16 units but 70 code points: valid. 141 emoji = 141 code points: invalid.
    expect(DebriefQuestionDraftSchema.safeParse({ question_en: of(70, "😀") }).success).toBe(true);
    expect(DebriefQuestionDraftSchema.safeParse({ question_en: of(141, "😀") }).success).toBe(false);
    // 10 emoji = 10 code points (20 units): too short although 20 units
    expect(DebriefQuestionDraftSchema.safeParse({ question_en: of(10, "😀") }).success).toBe(false);
  });

  it("is strict: an extra key fails", () => {
    expect(DebriefQuestionDraftSchema.safeParse({ question_en: of(30), why: "x" }).success).toBe(false);
  });

  it("rejects a missing or non-string question_en", () => {
    expect(DebriefQuestionDraftSchema.safeParse({}).success).toBe(false);
    expect(DebriefQuestionDraftSchema.safeParse({ question_en: 5 }).success).toBe(false);
  });
});

describe("DebriefQuestionArgsSchema (the check_question tool's parameters)", () => {
  it("accepts any string up to 1000 code points, so the checker can return a NAMED length reason", () => {
    expect(DebriefQuestionArgsSchema.safeParse({ question_en: "x" }).success).toBe(true);
    expect(DebriefQuestionArgsSchema.safeParse({ question_en: "a".repeat(1000) }).success).toBe(true);
    expect(DebriefQuestionArgsSchema.safeParse({ question_en: "a".repeat(1001) }).success).toBe(false);
  });

  it("is strict and requires question_en as a string", () => {
    expect(DebriefQuestionArgsSchema.safeParse({ question_en: "x", why: "y" }).success).toBe(false);
    expect(DebriefQuestionArgsSchema.safeParse({}).success).toBe(false);
    expect(DebriefQuestionArgsSchema.safeParse({ question_en: 3 }).success).toBe(false);
  });
});

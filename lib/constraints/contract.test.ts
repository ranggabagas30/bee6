import { describe, expect, it } from "vitest";
import {
  CreateConstraintBodySchema,
  ConstraintViewSchema,
  ListConstraintsResponseSchema,
  CreateConstraintResponseSchema,
  CONSTRAINT_INPUT_MAX,
  CONSTRAINT_INPUT_MIN,
} from "@/lib/constraints/contract";

describe("CreateConstraintBodySchema", () => {
  it("trims, then requires at least 3 characters after trim", () => {
    expect(CreateConstraintBodySchema.safeParse({ text: "  ab " }).success).toBe(false);
  });

  it("accepts a 300-char body, rejects 301", () => {
    const ok = "a".repeat(CONSTRAINT_INPUT_MAX);
    const bad = "a".repeat(CONSTRAINT_INPUT_MAX + 1);
    expect(CreateConstraintBodySchema.safeParse({ text: ok }).success).toBe(true);
    expect(CreateConstraintBodySchema.safeParse({ text: bad }).success).toBe(false);
  });

  it("rejects an extra key (strict)", () => {
    expect(CreateConstraintBodySchema.safeParse({ text: "valid text", source: "manual" }).success).toBe(false);
  });

  it("rejects a non-string text", () => {
    expect(CreateConstraintBodySchema.safeParse({ text: 123 }).success).toBe(false);
  });

  it("accepts the minimum 3 chars after trim", () => {
    expect(CreateConstraintBodySchema.safeParse({ text: " abc " }).success).toBe(true);
    expect(CONSTRAINT_INPUT_MIN).toBe(3);
  });
});

describe("ConstraintViewSchema", () => {
  const base = {
    constraint_id: "11111111-1111-4111-8111-111111111111",
    text: "The oven only holds 2.5 kg per batch.",
    source: "manual" as const,
    created_at_ms: 1,
  };

  it("accepts exactly the 4 keys", () => {
    expect(ConstraintViewSchema.safeParse(base).success).toBe(true);
  });

  it("rejects source_proposal_id in the view (strict, no extra keys)", () => {
    expect(
      ConstraintViewSchema.safeParse({ ...base, source_proposal_id: null }).success,
    ).toBe(false);
  });

  it("rejects created_by_role in the view", () => {
    expect(
      ConstraintViewSchema.safeParse({ ...base, created_by_role: "owner" }).success,
    ).toBe(false);
  });
});

describe("ListConstraintsResponseSchema / CreateConstraintResponseSchema", () => {
  const view = {
    constraint_id: "11111111-1111-4111-8111-111111111111",
    text: "t",
    source: "manual" as const,
    created_at_ms: 1,
  };

  it("ListConstraintsResponseSchema wraps an array of views", () => {
    expect(ListConstraintsResponseSchema.safeParse({ constraints: [view] }).success).toBe(true);
    expect(ListConstraintsResponseSchema.safeParse({ constraints: [view], extra: 1 }).success).toBe(false);
  });

  it("CreateConstraintResponseSchema carries the view plus duplicate", () => {
    expect(
      CreateConstraintResponseSchema.safeParse({ constraint: view, duplicate: false }).success,
    ).toBe(true);
    expect(CreateConstraintResponseSchema.safeParse({ constraint: view }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { checkProposal, type ProposalGateContext } from "@/lib/proposals/proposal-gate";
import { buildProposalWireSchema } from "@/lib/proposals/wire-schema";
import {
  buildProposalDraftV4Schema,
  draftToWire,
  type ProposalDraftV4,
  type V4WireContext,
} from "@/lib/proposals/v4/draft-schema";

const CTX: V4WireContext = {
  interventionIds: ["change_quantity_time", "add_failure_path"],
  rubricIds: ["observable", "evidence_defined"],
  evidenceAliases: ["E1", "E2", "E3"],
  stepIds: ["bake-dubai-01", "bake-ube-01"],
  constraintAliases: [],
  sectionIds: ["bake-dubai", "bake-ube"],
};

const validDraft = {
  section_id: "bake-dubai",
  target_step_id: "bake-dubai-01",
  intervention_id: "change_quantity_time",
  rubric_criterion_ids: ["observable"],
  evidence: ["E1", "E2"],
  evidence_quotes: [
    { alias: "E1", quote: "ran out of pistachio" },
    { alias: "E2", quote: "no pistachio left" },
  ],
  change_title: "Check pistachio before the first bake",
  change_text: "Count pistachio before the first bake and note the shortfall.",
  rationale: "Two dates show the pistachio ran out before noon.",
  metric_category: "CUSTOMER_SERVICE",
  metric_direction: "decrease",
  metric_description: "Requests for sold-out items per day.",
  failure_condition: "Sold-out requests do not fall over the review period.",
  review_after_days: 14,
};

describe("buildProposalDraftV4Schema", () => {
  it("a valid draft parses (no constraints, no constraints_acknowledged key)", () => {
    const schema = buildProposalDraftV4Schema(CTX);
    const r = schema.safeParse(validDraft);
    expect(r.success).toBe(true);
    if (r.success) expect("constraints_acknowledged" in r.data).toBe(false);
  });

  it("D16: with no constraints the key is absent from the shape and .strict() rejects it if sent", () => {
    const schema = buildProposalDraftV4Schema(CTX);
    expect(Object.keys(schema.shape)).not.toContain("constraints_acknowledged");
    expect(schema.safeParse({ ...validDraft, constraints_acknowledged: [] }).success).toBe(false);
    expect(schema.safeParse({ ...validDraft, constraints_acknowledged: ["C1"] }).success).toBe(false);
  });

  it("D16: with constraints the key is an enum array bounded by the alias count", () => {
    const schema = buildProposalDraftV4Schema({ ...CTX, constraintAliases: ["C1", "C2"] });
    expect(Object.keys(schema.shape)).toContain("constraints_acknowledged");
    expect(schema.safeParse({ ...validDraft, constraints_acknowledged: ["C1", "C2"] }).success).toBe(true);
    expect(schema.safeParse({ ...validDraft, constraints_acknowledged: [] }).success).toBe(true);
    expect(schema.safeParse({ ...validDraft, constraints_acknowledged: ["C3"] }).success).toBe(false);
    expect(schema.safeParse({ ...validDraft, constraints_acknowledged: ["C1", "C2", "C1"] }).success).toBe(false);
  });

  it("rejects ids this call did not offer (section, step, intervention, rubric, alias)", () => {
    const schema = buildProposalDraftV4Schema(CTX);
    expect(schema.safeParse({ ...validDraft, section_id: "other" }).success).toBe(false);
    expect(schema.safeParse({ ...validDraft, target_step_id: "bake-ube-99" }).success).toBe(false);
    expect(schema.safeParse({ ...validDraft, intervention_id: "invent_new" }).success).toBe(false);
    expect(schema.safeParse({ ...validDraft, rubric_criterion_ids: ["nope"] }).success).toBe(false);
    expect(schema.safeParse({ ...validDraft, evidence: ["E99"] }).success).toBe(false);
    expect(
      schema.safeParse({ ...validDraft, evidence_quotes: [{ alias: "E99", quote: "ran out of pistachio" }] }).success,
    ).toBe(false);
  });

  it('accepts "NEW" as the target step', () => {
    const schema = buildProposalDraftV4Schema(CTX);
    expect(schema.safeParse({ ...validDraft, target_step_id: "NEW" }).success).toBe(true);
  });

  it("is strict: an unknown key and a missing required key both fail", () => {
    const schema = buildProposalDraftV4Schema(CTX);
    expect(schema.safeParse({ ...validDraft, decision: "propose" }).success).toBe(false);
    const { section_id: _omit, ...withoutSection } = validDraft;
    expect(schema.safeParse(withoutSection).success).toBe(false);
  });

  it("bounds: quote length 8..160, empty evidence/quotes/rubric, empty text, review days 7..28", () => {
    const schema = buildProposalDraftV4Schema(CTX);
    const q = (quote: string) => ({
      ...validDraft,
      evidence_quotes: [{ alias: "E1", quote }, { alias: "E2", quote: "no pistachio left" }],
    });
    expect(schema.safeParse(q("1234567")).success).toBe(false);
    expect(schema.safeParse(q("12345678")).success).toBe(true);
    expect(schema.safeParse(q("x".repeat(160))).success).toBe(true);
    expect(schema.safeParse(q("x".repeat(161))).success).toBe(false);
    expect(schema.safeParse({ ...validDraft, evidence: [] }).success).toBe(false);
    expect(schema.safeParse({ ...validDraft, evidence_quotes: [] }).success).toBe(false);
    expect(schema.safeParse({ ...validDraft, rubric_criterion_ids: [] }).success).toBe(false);
    expect(schema.safeParse({ ...validDraft, change_text: "" }).success).toBe(false);
    expect(schema.safeParse({ ...validDraft, review_after_days: 6 }).success).toBe(false);
    expect(schema.safeParse({ ...validDraft, review_after_days: 7 }).success).toBe(true);
    expect(schema.safeParse({ ...validDraft, review_after_days: 28 }).success).toBe(true);
    expect(schema.safeParse({ ...validDraft, review_after_days: 29 }).success).toBe(false);
    expect(schema.safeParse({ ...validDraft, review_after_days: 14.5 }).success).toBe(false);
  });

  it("every enum guard throws on an empty list", () => {
    expect(() => buildProposalDraftV4Schema({ ...CTX, interventionIds: [] })).toThrow(/interventionIds/);
    expect(() => buildProposalDraftV4Schema({ ...CTX, rubricIds: [] })).toThrow(/rubricIds/);
    expect(() => buildProposalDraftV4Schema({ ...CTX, evidenceAliases: [] })).toThrow(/evidenceAliases/);
    expect(() => buildProposalDraftV4Schema({ ...CTX, stepIds: [] })).toThrow(/stepIds/);
    expect(() => buildProposalDraftV4Schema({ ...CTX, sectionIds: [] })).toThrow(/sectionIds/);
  });
});

describe("draftToWire", () => {
  const parse = (ctx: V4WireContext, extra: Record<string, unknown> = {}) =>
    buildProposalDraftV4Schema(ctx).parse({ ...validDraft, ...extra }) as ProposalDraftV4;

  it("fills constraints_acknowledged with [] when the draft has none", () => {
    const wire = draftToWire(parse(CTX));
    expect(wire.constraints_acknowledged).toEqual([]);
    expect(wire.decision).toBe("propose");
    expect(wire.no_proposal_reason).toBeNull();
  });

  it("passes constraints_acknowledged through when present", () => {
    const ctx = { ...CTX, constraintAliases: ["C1", "C2"] };
    expect(draftToWire(parse(ctx, { constraints_acknowledged: ["C2"] })).constraints_acknowledged).toEqual(["C2"]);
  });

  it("drops section_id and evidence_quotes, keeps every other draft field", () => {
    const wire = draftToWire(parse(CTX)) as Record<string, unknown>;
    expect("section_id" in wire).toBe(false);
    expect("evidence_quotes" in wire).toBe(false);
    expect(wire.target_step_id).toBe("bake-dubai-01");
    expect(wire.intervention_id).toBe("change_quantity_time");
    expect(wire.evidence).toEqual(["E1", "E2"]);
    expect(wire.review_after_days).toBe(14);
  });

  it("output parses under the v3 wire schema and does not alias the draft's arrays", () => {
    const draft = parse(CTX);
    const wire = draftToWire(draft);
    expect(buildProposalWireSchema(CTX).safeParse(wire).success).toBe(true);
    expect(wire.evidence).not.toBe(draft.evidence);
    expect(wire.rubric_criterion_ids).not.toBe(draft.rubric_criterion_ids);
  });

  it("the v3 gate accepts the wire form of a draft whose ids are all offered", () => {
    const gateCtx: ProposalGateContext = {
      aliasToCandidate: new Map([
        ["E1", cand("t1", "2026-10-13")],
        ["E2", cand("t2", "2026-10-14")],
      ]),
      interventionIds: new Set(CTX.interventionIds),
      rubricIds: new Set(CTX.rubricIds),
      stepIds: new Set(CTX.stepIds),
      constraintAliases: [],
    };
    expect(checkProposal(draftToWire(parse(CTX)), gateCtx).passed).toBe(true);
  });
});

function cand(thread_id: string, local_date: string) {
  return {
    thread_id,
    local_date,
    start_hm: "10:00",
    category: "CUSTOMER_SERVICE" as const,
    first_line_start_ms: 0,
    summary: "s",
    excerpt: "",
  };
}

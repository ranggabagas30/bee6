import { describe, expect, it } from "vitest";
import {
  buildProposalWireSchema,
  generateProposalJsonSchema,
  type WireContext,
} from "@/lib/proposals/wire-schema";

const CTX: WireContext = {
  interventionIds: ["change_quantity_time", "add_failure_path"],
  rubricIds: ["observable", "evidence_defined"],
  evidenceAliases: ["E1", "E2", "E3"],
  stepIds: ["open-01", "stock-01"],
  constraintAliases: ["C1", "C2"],
};

const validPropose = {
  decision: "propose" as const,
  no_proposal_reason: null,
  intervention_id: "change_quantity_time" as const,
  rubric_criterion_ids: ["observable"] as const,
  evidence: ["E1", "E2"] as const,
  target_step_id: "stock-01" as const,
  change_title: "Check the display every 30 minutes",
  change_text: "Check the display every 30 minutes between 11:00 and 14:00.",
  rationale: "Two dates show sold-out items at midday.",
  metric_category: "CUSTOMER_SERVICE" as const,
  metric_direction: "decrease" as const,
  metric_description: "Requests for sold-out items per day.",
  failure_condition: "Requests do not fall over the review period.",
  review_after_days: 14,
  constraints_acknowledged: ["C1", "C2"] as const,
};

describe("buildProposalWireSchema", () => {
  it("a valid propose object parses", () => {
    const schema = buildProposalWireSchema(CTX);
    expect(schema.safeParse(validPropose).success).toBe(true);
  });

  it('intervention_id: "invent_new" fails', () => {
    const schema = buildProposalWireSchema(CTX);
    expect(schema.safeParse({ ...validPropose, intervention_id: "invent_new" }).success).toBe(false);
  });

  it("an alias not offered (E99) fails", () => {
    const schema = buildProposalWireSchema(CTX);
    expect(schema.safeParse({ ...validPropose, evidence: ["E99"] }).success).toBe(false);
  });

  it("a propose with empty change_text fails", () => {
    const schema = buildProposalWireSchema(CTX);
    expect(schema.safeParse({ ...validPropose, change_text: "" }).success).toBe(false);
  });

  it("a no_proposal with every other field null/empty parses", () => {
    const schema = buildProposalWireSchema(CTX);
    const noProposal = {
      decision: "no_proposal" as const,
      no_proposal_reason: "no_clear_pattern" as const,
      intervention_id: null,
      rubric_criterion_ids: [],
      evidence: [],
      target_step_id: null,
      change_title: "",
      change_text: "",
      rationale: "",
      metric_category: null,
      metric_direction: null,
      metric_description: "",
      failure_condition: "",
      review_after_days: null,
      constraints_acknowledged: [],
    };
    expect(schema.safeParse(noProposal).success).toBe(true);
  });

  it("propose with no_proposal_reason set fails", () => {
    const schema = buildProposalWireSchema(CTX);
    expect(schema.safeParse({ ...validPropose, no_proposal_reason: "no_clear_pattern" }).success).toBe(
      false,
    );
  });

  it("throws if any offered-id list is empty", () => {
    expect(() => buildProposalWireSchema({ ...CTX, interventionIds: [] })).toThrow();
    expect(() => buildProposalWireSchema({ ...CTX, rubricIds: [] })).toThrow();
    expect(() => buildProposalWireSchema({ ...CTX, evidenceAliases: [] })).toThrow();
    expect(() => buildProposalWireSchema({ ...CTX, stepIds: [] })).toThrow();
  });

  it("target_step_id accepts NEW even with no constraints", () => {
    const schema = buildProposalWireSchema({ ...CTX, constraintAliases: [] });
    expect(
      schema.safeParse({ ...validPropose, target_step_id: "NEW", constraints_acknowledged: [] }).success,
    ).toBe(true);
  });
});

describe("generateProposalJsonSchema", () => {
  it("has no anyOf/$ref/additionalProperties/$schema", () => {
    const schema = generateProposalJsonSchema(CTX) as Record<string, unknown>;
    const text = JSON.stringify(schema);
    expect(text).not.toContain("anyOf");
    expect(text).not.toContain("$ref");
    expect(text).not.toContain("additionalProperties");
    expect(text).not.toContain("$schema");
  });

  it("nullable fields carry nullable: true", () => {
    const schema = generateProposalJsonSchema(CTX) as {
      properties: Record<string, { nullable?: boolean }>;
    };
    expect(schema.properties.intervention_id?.nullable).toBe(true);
    expect(schema.properties.target_step_id?.nullable).toBe(true);
    expect(schema.properties.metric_category?.nullable).toBe(true);
    expect(schema.properties.review_after_days?.nullable).toBe(true);
  });

  it("enums equal the context lists", () => {
    const schema = generateProposalJsonSchema(CTX) as {
      properties: {
        intervention_id: { enum: string[] };
        evidence: { items: { enum: string[] } };
      };
    };
    expect(schema.properties.intervention_id.enum).toEqual(CTX.interventionIds);
    expect(schema.properties.evidence.items.enum).toEqual(CTX.evidenceAliases);
  });

  it("with 0 constraints, constraints_acknowledged has maxItems: 0", () => {
    const schema = generateProposalJsonSchema({ ...CTX, constraintAliases: [] }) as {
      properties: { constraints_acknowledged: { maxItems: number } };
    };
    expect(schema.properties.constraints_acknowledged.maxItems).toBe(0);
  });
});

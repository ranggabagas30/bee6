// Test-only fixtures shared by lib/sop tests (fictional demo data).
import { ProposalSchema, SopVersionSchema, type Proposal, type SopStep, type SopVersion } from "@/lib/firestore/schema";

export const OUTLET = "o1";
export const PROPOSAL_ID = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";

export function step(id: string, text = `Text of ${id}.`, role: SopStep["role"] = "staff"): SopStep {
  return { step_id: id, title: `Title of ${id}`, text, role };
}

export function seedV1(stepCount = 5): SopVersion {
  const steps = [step("stock-01", "Check the display every hour."), step("open-01"), step("open-02"), step("close-01"), step("close-02")];
  for (let i = steps.length; i < stepCount; i++) steps.push(step(`extra-${String(i).padStart(3, "0")}`));
  return SopVersionSchema.parse({
    outlet_id: OUTLET,
    sop_version_id: `${OUTLET}:v1`,
    version: 1,
    steps: steps.slice(0, stepCount),
    source: "seed",
    source_proposal_id: null,
    created_at_ms: 1_700_000_000_000,
  });
}

export function proposalV1(overrides: Record<string, unknown> = {}, content: Record<string, unknown> = {}): Proposal {
  return ProposalSchema.parse({
    outlet_id: OUTLET,
    proposal_id: PROPOSAL_ID,
    status: "awaiting_owner",
    requested_by_role: "supervisor",
    range: { from_date: "2026-10-01", to_date: "2026-10-03" },
    generator: {
      kind: "adk",
      model: "gemini-3.5-flash",
      location: "global",
      agent_version: "proposal-v2",
      gate_version: "pgate-v1",
      library_version: { interventions: 1, rubric: 1 },
      sop_version_id: `${OUTLET}:v1`,
      attempts: 1,
    },
    gate: { passed: true, fired_rule: null, checks: [] },
    counts: { candidate_facts: 3, candidate_dates: 3, constraints: 0 },
    suppression: null,
    content: {
      intervention_id: "change_quantity_time",
      rubric_criterion_ids: ["observable"],
      target_step_id: "stock-01",
      change_title: "Check the display every 30 minutes at peak",
      change_text: "Check the display every 30 minutes from 10:00 to 13:00. Refill items that are running low.",
      rationale: "Customers asked for sold-out items.",
      metric: {
        category: "CUSTOMER_SERVICE",
        direction: "decrease",
        description: "Sold-out requests per day.",
        baseline_count: 4,
        baseline_days: 3,
      },
      failure_condition: "Sold-out requests do not fall.",
      review_after_days: 7,
      review_date: "2026-10-18",
      evidence: ["a", "b", "c"].map((x, i) => ({
        thread_id: `unit_DEVSENTINEL_${x}:0`,
        local_date: `2026-10-0${i + 1}`,
        category: "CUSTOMER_SERVICE" as const,
        first_line_start_ms: 1_700_000_000_000 + i,
      })),
      constraint_ids_acknowledged: [],
      censored_floor: true,
      ...content,
    },
    supervisor_review: {
      decision: "feasible",
      reason: null,
      constraint_id: null,
      acknowledged_constraint_ids: [],
      decided_at_ms: 1_700_000_100_000,
    },
    owner_decision: null,
    created_at_ms: 1_700_000_000_000,
    updated_at_ms: 1_700_000_000_000,
    ...overrides,
  });
}

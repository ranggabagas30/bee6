import type { WorkCategory } from "@/lib/pipeline/categories";
import { PROPOSAL_RULES, type ProposalRule } from "@/lib/firestore/schema";
import type { Candidate } from "@/lib/proposals/candidates";
import type { ProposalWire } from "@/lib/proposals/wire-schema";

/**
 * The plain-code proposal gate (`pgate-v1`), the proposal-level sibling of
 * `lib/pipeline/gate.ts` (hard rule #10: the model never decides any of
 * these; it only picks among offered ids and writes text). Only called for
 * `decision === "propose"` wire output — the service handles
 * `no_proposal` itself.
 *
 * `schema_invalid`, `output_too_long` and `evidence_stale` are recorded by
 * the service (lib/proposals/service.ts), not here: they are checked before
 * this gate runs (schema_invalid) or after the model step entirely
 * (output_too_long after redaction; evidence_stale at commit time, against
 * freshly re-read threads this gate never sees).
 */

export interface ProposalGateContext {
  aliasToCandidate: ReadonlyMap<string, Candidate>;
  interventionIds: ReadonlySet<string>;
  rubricIds: ReadonlySet<string>;
  /** Current SOP step ids; "NEW" is always accepted regardless of this set. */
  stepIds: ReadonlySet<string>;
  /** C1..Cm, in order — every one of these must appear in `wire.constraints_acknowledged`. */
  constraintAliases: readonly string[];
}

export interface ProposalGateResult {
  passed: boolean;
  fired_rule: ProposalRule | null;
  checks: { rule: ProposalRule; passed: boolean }[];
}

/** The gate's own rule order (a strict subset of `PROPOSAL_RULES`, in precedence order). */
const GATE_RULE_ORDER: readonly ProposalRule[] = [
  "intervention_unknown",
  "rubric_missing",
  "rubric_unknown",
  "evidence_unknown",
  "evidence_min",
  "step_unknown",
  "constraints_unacknowledged",
  "metric_not_in_evidence",
];

// Defensive: every rule this gate checks must be a real PROPOSAL_RULES member.
for (const rule of GATE_RULE_ORDER) {
  if (!(PROPOSAL_RULES as readonly string[]).includes(rule)) {
    throw new Error(`proposal-gate.ts: "${rule}" is not a member of PROPOSAL_RULES`);
  }
}

function dedupe<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

export function checkProposal(wire: ProposalWire, ctx: ProposalGateContext): ProposalGateResult {
  const dedupedRubric = dedupe(wire.rubric_criterion_ids);
  const dedupedEvidence = dedupe(wire.evidence);
  const resolvedCandidates = dedupedEvidence
    .map((alias) => ctx.aliasToCandidate.get(alias))
    .filter((c): c is Candidate => c !== undefined);
  const distinctThreadCount = new Set(resolvedCandidates.map((c) => c.thread_id)).size;
  const distinctDateCount = new Set(resolvedCandidates.map((c) => c.local_date)).size;
  const citedCategories = new Set<WorkCategory>(resolvedCandidates.map((c) => c.category));
  const acknowledged = new Set(wire.constraints_acknowledged);

  const checkPassed: Record<ProposalRule, boolean> = {
    schema_invalid: true, // recorded by the service, not this gate
    intervention_unknown: wire.intervention_id !== null && ctx.interventionIds.has(wire.intervention_id),
    rubric_missing: dedupedRubric.length >= 1,
    rubric_unknown: dedupedRubric.every((id) => ctx.rubricIds.has(id)),
    evidence_unknown: dedupedEvidence.every((alias) => ctx.aliasToCandidate.has(alias)),
    evidence_min: distinctThreadCount >= 2 && distinctDateCount >= 2,
    step_unknown: wire.target_step_id === "NEW" || (wire.target_step_id !== null && ctx.stepIds.has(wire.target_step_id)),
    constraints_unacknowledged: ctx.constraintAliases.every((alias) => acknowledged.has(alias)),
    metric_not_in_evidence: wire.metric_category !== null && citedCategories.has(wire.metric_category),
    output_too_long: true, // recorded by the service, not this gate
    evidence_stale: true, // recorded by the service, not this gate
  };

  const checks = GATE_RULE_ORDER.map((rule) => ({ rule, passed: checkPassed[rule] }));
  const firedCheck = checks.find((c) => !c.passed);
  return {
    passed: firedCheck === undefined,
    fired_rule: firedCheck?.rule ?? null,
    checks,
  };
}

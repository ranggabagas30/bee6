import { loadProposalLibrary, type ProposalLibrary } from "@/config/proposal-library";
import type { SopVersion } from "@/lib/firestore/schema";
import { aliasCandidates, selectCandidates, type Candidate, type ProposalThreadRow } from "@/lib/proposals/candidates";
import type { ProposalGateContext } from "@/lib/proposals/proposal-gate";
import { REHEARSAL_OUTLET_ID, REHEARSAL_TZ, scopeDubaiRows } from "@/lib/proposals/testing/rehearsal-fixture";
import { buildProposalDraftV4Schema, type ProposalDraftV4 } from "@/lib/proposals/v4/draft-schema";
import type { V4CheckContext, V4Session } from "@/lib/proposals/v4/types";
import { deriveSections, type SopSection } from "@/lib/sop/sections";
import { FIXTURE_SOP_STEPS } from "@/scripts/eval-fixtures/sop-two-procedures";

/**
 * R-24 test support (B1/B2): one Ask's worth of already-loaded data over the fictional two-procedure SOP, built with
 * the real `selectCandidates` / `aliasCandidates` / `deriveSections` / library loader, so check and tool tests run
 * against the same shapes the service will hand them. Test use only. Fictional data.
 */

export const V4_TEST_RANGE = { from_date: "2026-10-13", to_date: "2026-10-15" };

export interface V4World {
  sop: SopVersion;
  sections: SopSection[];
  aliased: { alias: string; c: Candidate }[];
  aliasToCandidate: Map<string, Candidate>;
  reasons: Map<string, string>;
  library: ProposalLibrary;
  constraintAliases: string[];
  draftSchema: ReturnType<typeof buildProposalDraftV4Schema>;
  gateCtx: ProposalGateContext;
}

export function makeSop(steps = FIXTURE_SOP_STEPS): SopVersion {
  return {
    outlet_id: REHEARSAL_OUTLET_ID,
    sop_version_id: `${REHEARSAL_OUTLET_ID}:v1`,
    version: 1,
    steps: steps.map((s) => ({ ...s })),
    source: "seed",
    source_proposal_id: null,
    created_at_ms: 1,
  };
}

export function makeWorld(
  opts: { rows?: ProposalThreadRow[]; steps?: typeof FIXTURE_SOP_STEPS; constraintAliases?: string[] } = {},
): V4World {
  const sop = makeSop(opts.steps);
  const sections = deriveSections(sop.steps);
  const aliased = aliasCandidates(selectCandidates(opts.rows ?? scopeDubaiRows, [], REHEARSAL_TZ, V4_TEST_RANGE));
  const library = loadProposalLibrary({ allowDraft: true });
  const constraintAliases = opts.constraintAliases ?? [];
  const aliasToCandidate = new Map(aliased.map(({ alias, c }) => [alias, c]));
  const interventionIds = library.interventions.entries.map((e) => e.id);
  const rubricIds = library.rubric.entries.map((e) => e.id);
  return {
    sop,
    sections,
    aliased,
    aliasToCandidate,
    reasons: new Map(),
    library,
    constraintAliases,
    draftSchema: buildProposalDraftV4Schema({
      sectionIds: sections.map((s) => s.section_id),
      stepIds: sop.steps.map((s) => s.step_id),
      interventionIds,
      rubricIds,
      evidenceAliases: aliased.map((a) => a.alias),
      constraintAliases,
    }),
    gateCtx: {
      aliasToCandidate,
      interventionIds: new Set(interventionIds),
      rubricIds: new Set(rubricIds),
      stepIds: new Set(sop.steps.map((s) => s.step_id)),
      constraintAliases,
    },
  };
}

export function emptySession(): V4Session {
  return {
    fetchedSections: new Set(),
    inspectedAliases: new Set(),
    inspectedInterventions: new Set(),
    checkRounds: 0,
    toolCalls: [],
    outcome: null,
  };
}

/** A check context where the agent has inspected everything it cites (the "did its homework" baseline). */
export function checkCtx(w: V4World, over: Partial<V4CheckContext> = {}): V4CheckContext {
  return {
    gateCtx: w.gateCtx,
    sections: w.sections,
    sop: w.sop,
    aliasToCandidate: w.aliasToCandidate,
    reasons: w.reasons,
    fetchedSections: new Set(["bake-dubai"]),
    inspectedAliases: new Set(w.aliased.map((a) => a.alias)),
    inspectedInterventions: new Set(["change_trigger"]),
    ...over,
  };
}

/** A draft that passes every rule on the default (`scopeDubaiRows`) world. */
export function validDraft(over: Partial<ProposalDraftV4> = {}): ProposalDraftV4 {
  return {
    section_id: "bake-dubai",
    target_step_id: "bake-dubai-02",
    intervention_id: "change_trigger",
    rubric_criterion_ids: ["observable"],
    evidence: ["E1", "E2"],
    evidence_quotes: [
      { alias: "E1", quote: "came out flat and dark" },
      { alias: "E2", quote: "before the oven was back at temperature" },
    ],
    change_title: "Preheat check before the Dubai Chewy tray",
    change_text: "Bake the Dubai Chewy tray for 14 minutes at 170 C, only after the oven is back at temperature.",
    rationale: "The tray went in before the oven was ready on two days and came out flat and dark.",
    metric_category: "CORRECTION",
    metric_direction: "decrease",
    metric_description: "Daily count of corrections about flat or dark cookies.",
    failure_condition: "Flat or dark Dubai Chewy trays still happen on two days in the review period.",
    review_after_days: 14,
    ...over,
  };
}

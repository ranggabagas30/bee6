import type { z } from "zod";
import type { MODEL_DECLINE_REASONS, ProposalRule, SopVersion } from "@/lib/firestore/schema";
import type { Candidate } from "@/lib/proposals/candidates";
import type { ProposalGateContext } from "@/lib/proposals/proposal-gate";
import type { ProposalDraftV4 } from "@/lib/proposals/v4/draft-schema";
import type { SopSection } from "@/lib/sop/sections";

/**
 * R-24: shared types and constants for the v4 (tool-using) Proposal agent. TYPES AND CONSTS ONLY: no logic, no I/O,
 * no `@google/adk` import, so the check (B1), the tools (B2), the runner (B3) and the service (B4) compile against
 * one contract. Shapes are the plan's §3.3 / §3.4 / §3.5.
 */

/** The ten v4 rules, evaluated after the eight `pgate-v1` checks, in this order. Mirrored in `PROPOSAL_RULES`. */
export const V4_RULES = [
  "section_not_fetched",
  "step_not_in_section",
  "evidence_not_inspected",
  "intervention_not_inspected",
  "quote_alias_not_cited",
  "quotes_insufficient",
  "quote_not_in_evidence",
  "scope_unsupported",
  "change_is_noop",
  "text_rule_violation",
] as const;
export type V4Rule = (typeof V4_RULES)[number];

/** One SOP section as `deriveSections` (`lib/sop/sections.ts`) returns it. */
export type V4SectionLike = SopSection;

export interface ProposalCheckResult {
  passed: boolean;
  fired_rule: ProposalRule | V4Rule | null;
  /** `pgate-v1` checks first, then `V4_RULES` in order. */
  checks: { rule: ProposalRule | V4Rule; passed: boolean }[];
  /** Every failed rule code (+ `text_rule_violation:<field>:<label>`), for the model. */
  reasons: string[];
}

export interface V4CheckContext {
  gateCtx: ProposalGateContext;
  sections: V4SectionLike[];
  sop: SopVersion;
  aliasToCandidate: ReadonlyMap<string, Candidate>;
  reasons: ReadonlyMap<string, string>;
  fetchedSections: ReadonlySet<string>;
  inspectedAliases: ReadonlySet<string>;
  inspectedInterventions: ReadonlySet<string>;
}

export type V4Outcome =
  | { kind: "accepted"; draft: ProposalDraftV4; checks: ProposalCheckResult["checks"] }
  | { kind: "declined"; reason: (typeof MODEL_DECLINE_REASONS)[number] }
  | { kind: "blocked"; rule: string; checks: ProposalCheckResult["checks"] };

/** One per run; mutated by the tools, read by the service. */
export interface V4Session {
  fetchedSections: Set<string>;
  inspectedAliases: Set<string>;
  inspectedInterventions: Set<string>;
  checkRounds: number;
  /** `ok` is false when the tool returned `{ error }`. */
  toolCalls: { name: string; ok: boolean }[];
  outcome: V4Outcome | null;
}

export interface V4ToolSpec<P extends z.ZodObject<z.ZodRawShape>> {
  name: string;
  description: string;
  parameters: P;
  /** Sync or Promise; must never throw shop text. */
  execute: (input: z.infer<P>) => unknown;
}

/** Counts and enums only (hard rule 7): what a run did, never what it read or said. */
export interface V4Trace {
  model_calls: number;
  tool_calls: { name: string; ok: boolean }[];
  check_rounds: number;
  ms: number;
  ended_by: "decided" | "model_done" | "limit" | "timeout" | "error";
}

import { z } from "zod";
import type { ProposalLibrary } from "@/config/proposal-library";
import { MODEL_DECLINE_REASONS, type SopVersion } from "@/lib/firestore/schema";
import { clampQuote, type Candidate, type ProposalThreadRow } from "@/lib/proposals/candidates";
import { FACT_EXCERPT_MAX_CHARS, FACT_REASON_MAX_CHARS, V4_MAX_CHECK_ROUNDS } from "@/lib/proposals/constants";
import type { ProposalGateContext } from "@/lib/proposals/proposal-gate";
import { checkProposalV4 } from "@/lib/proposals/v4/check";
import type { buildProposalDraftV4Schema, ProposalDraftV4 } from "@/lib/proposals/v4/draft-schema";
import type { V4Session, V4ToolSpec } from "@/lib/proposals/v4/types";
import type { SopSection } from "@/lib/sop/sections";

/**
 * R-24 tools (plan §2.2, §3.3): the seven tools the v4 Proposal agent works with. Read-only (hard rule 9: no write
 * tool; the SOP changes only through proposals) and pure of I/O (no Firestore, no model call, no `@google/adk`).
 *
 * Every tool is a CLOSURE over this Ask's already-loaded, already-outlet-scoped data. No tool takes an outlet id or
 * names anything outside the closure: the model can only pass an enum member this call offered (an alias `E1..En`,
 * a section id, an intervention id), and zod rejects anything else before `execute` runs. Evidence is keyed by the
 * alias only (hard rule 7): a thread id, question id or device id never appears in any output. Error strings are
 * fixed literals; nothing the shop wrote is ever put into one.
 */

export interface V4ToolInputs {
  sections: SopSection[];
  sop: SopVersion;
  /** ALREADY staff-name scrubbed excerpts (the service scrubs at 8c). */
  aliased: { alias: string; c: Candidate }[];
  /** thread_id -> scrubbed staff debrief note. The thread id is a lookup key here and is never output. */
  reasons: ReadonlyMap<string, string>;
  /** thread_id -> the label provenance the model may see (`confidence`, `gate`, `label_source`). */
  rows: ReadonlyMap<string, Pick<ProposalThreadRow, "confidence" | "gate" | "label_source">>;
  library: ProposalLibrary;
  constraintAliases: string[];
  draftSchema: ReturnType<typeof buildProposalDraftV4Schema>;
  gateCtx: ProposalGateContext;
}

/** The one error string the decision tools ever return. */
const RUN_DECIDED_ERROR = "run already decided";

const round2 = (n: number): number => Math.round(n * 100) / 100;

function nonEmpty(ids: readonly string[], what: string): [string, ...string[]] {
  if (ids.length === 0) throw new Error(`buildV4Tools: ${what} must not be empty`);
  return ids as [string, ...string[]];
}

const CHECK_PROPOSAL_DESCRIPTION =
  "Submit the complete draft to the plain-code checker. It answers passed, or a list of failed rule codes to fix: " +
  "section_not_fetched (read the section with get_sop_section first), step_not_in_section, " +
  "evidence_not_inspected (read every cited fact with get_evidence), intervention_not_inspected, " +
  "quote_alias_not_cited, quotes_insufficient (quote at least two different cited facts), " +
  "quote_not_in_evidence (quote exactly as written in get_evidence), scope_unsupported (the cited facts must be " +
  "about the section you chose), change_is_noop (change_text must differ from the step's current text), " +
  "text_rule_violation:<field>:<label> (rewrite that field), plus the library, evidence and metric rules " +
  "(evidence_min, metric_not_in_evidence, constraints_unacknowledged, ...).";

/** A heterogeneous tool list: each spec has its own parameter schema, so the list's element type is the loose one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyV4ToolSpec = V4ToolSpec<any>;

export function buildV4Tools(inputs: V4ToolInputs, session: V4Session): AnyV4ToolSpec[] {
  const sectionIds = nonEmpty(
    inputs.sections.map((s) => s.section_id),
    "sections",
  );
  const aliases = nonEmpty(
    inputs.aliased.map((a) => a.alias),
    "aliased evidence",
  );
  const interventionIds = nonEmpty(
    inputs.library.interventions.entries.map((e) => e.id),
    "interventions",
  );
  const aliasToCandidate = new Map(inputs.aliased.map(({ alias, c }) => [alias, c]));
  const sectionById = new Map(inputs.sections.map((s) => [s.section_id, s]));
  const stepById = new Map(inputs.sop.steps.map((s) => [s.step_id, s]));
  const interventionById = new Map(inputs.library.interventions.entries.map((e) => [e.id, e]));

  /** Records every call (and whether it answered with an error) on the run session. */
  function tool<P extends z.ZodObject<z.ZodRawShape>>(
    name: string,
    description: string,
    parameters: P,
    run: (input: z.infer<P>) => unknown,
  ): V4ToolSpec<P> {
    return {
      name,
      description,
      parameters,
      execute: (input) => {
        const out = run(input);
        const ok = !(typeof out === "object" && out !== null && "error" in out);
        session.toolCalls.push({ name, ok });
        return out;
      },
    };
  }

  const listSopSections = tool(
    "list_sop_sections",
    "List the sections (procedures) of the current SOP with their ids. Call this first.",
    z.object({}).strict(),
    () => ({
      sections: inputs.sections.map((s) => ({ section_id: s.section_id, title: s.title, step_count: s.step_ids.length })),
    }),
  );

  const getSopSection = tool(
    "get_sop_section",
    "Read the steps of one SOP section. Required before proposing a change to a step in it.",
    z.object({ section_id: z.enum(sectionIds).describe("A section id from list_sop_sections.") }).strict(),
    ({ section_id }) => {
      const section = sectionById.get(section_id)!;
      session.fetchedSections.add(section_id);
      return {
        section_id,
        title: section.title,
        steps: section.step_ids.map((id) => {
          const step = stepById.get(id)!;
          return { step_id: step.step_id, role: step.role, title: step.title, text: step.text };
        }),
      };
    },
  );

  const getEvidence = tool(
    "get_evidence",
    "Read one fact in detail (date, time, category, summary, what was said, staff note, how it was labelled). " +
      "Required before citing it.",
    z.object({ alias: z.enum(aliases).describe("A fact alias such as E1 from the FACTS index.") }).strict(),
    ({ alias }) => {
      const c = aliasToCandidate.get(alias)!;
      const row = inputs.rows.get(c.thread_id);
      const note = inputs.reasons.get(c.thread_id);
      session.inspectedAliases.add(alias);
      return {
        alias,
        date: c.local_date,
        time: c.start_hm,
        category: c.category,
        summary: c.summary,
        fields: c.fields ?? {},
        quote: clampQuote(c.excerpt, FACT_EXCERPT_MAX_CHARS),
        staff_note: note === undefined || note.trim() === "" ? null : clampQuote(note, FACT_REASON_MAX_CHARS),
        label_confidence: row?.confidence === undefined ? null : round2(row.confidence),
        gate: row?.gate ? { verdict: row.gate.verdict, fired_rule: row.gate.fired_rule } : null,
        confirmed_by:
          row?.label_source === "staff_confirmed"
            ? "staff_debrief"
            : row?.label_source === "supervisor_confirmed"
              ? "supervisor"
              : "label_gate",
      };
    },
  );

  const getIntervention = tool(
    "get_intervention",
    "Read one intervention from the library. Required before choosing it.",
    z.object({ id: z.enum(interventionIds).describe("An intervention id from the INTERVENTIONS index.") }).strict(),
    ({ id }) => {
      const e = interventionById.get(id)!;
      session.inspectedInterventions.add(id);
      return { id, label_en: e.label_en, definition: e.definition, when_to_use: e.when_to_use ?? null };
    },
  );

  const getRubric = tool(
    "get_rubric",
    "Read the rubric criteria with their definitions.",
    z.object({}).strict(),
    () => ({
      criteria: inputs.library.rubric.entries.map((e) => ({ id: e.id, label_en: e.label_en, definition: e.definition })),
    }),
  );

  const checkProposal = tool(
    "check_proposal",
    CHECK_PROPOSAL_DESCRIPTION,
    inputs.draftSchema as unknown as z.ZodObject<z.ZodRawShape>,
    (input) => {
      if (session.outcome) return { error: RUN_DECIDED_ERROR };
      // Defence in depth: ADK already parsed `input` with the same schema.
      const parsed = inputs.draftSchema.safeParse(input);
      if (!parsed.success) {
        // A malformed draft is not a check round. Paths only, never values.
        const paths = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "(root)"))];
        return {
          passed: false,
          accepted: false,
          final: false,
          round: session.checkRounds,
          rounds_left: V4_MAX_CHECK_ROUNDS - session.checkRounds,
          reasons: paths.map((p) => `schema_invalid:${p}`),
        };
      }
      const draft = parsed.data as ProposalDraftV4;
      const result = checkProposalV4(draft, {
        gateCtx: inputs.gateCtx,
        sections: inputs.sections,
        sop: inputs.sop,
        aliasToCandidate,
        reasons: inputs.reasons,
        fetchedSections: session.fetchedSections,
        inspectedAliases: session.inspectedAliases,
        inspectedInterventions: session.inspectedInterventions,
      });
      session.checkRounds += 1;
      if (result.passed) {
        session.outcome = { kind: "accepted", draft, checks: result.checks };
        return { passed: true, accepted: true, final: true, round: session.checkRounds, rounds_left: 0, reasons: [] };
      }
      const final = session.checkRounds >= V4_MAX_CHECK_ROUNDS;
      if (final) {
        session.outcome = { kind: "blocked", rule: result.fired_rule ?? "unknown", checks: result.checks };
      }
      return {
        passed: false,
        accepted: false,
        final,
        round: session.checkRounds,
        rounds_left: Math.max(0, V4_MAX_CHECK_ROUNDS - session.checkRounds),
        reasons: result.reasons,
      };
    },
  );

  const decline = tool(
    "decline",
    "Decline to propose when no change respects the facts and the constraints. Use instead of check_proposal.",
    z.object({ reason: z.enum(MODEL_DECLINE_REASONS) }).strict(),
    ({ reason }) => {
      if (session.outcome) return { error: RUN_DECIDED_ERROR };
      session.outcome = { kind: "declined", reason };
      return { accepted: true };
    },
  );

  return [listSopSections, getSopSection, getEvidence, getIntervention, getRubric, checkProposal, decline];
}

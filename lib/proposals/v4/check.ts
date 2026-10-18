import type { ProposalRule } from "@/lib/firestore/schema";
import type { Candidate } from "@/lib/proposals/candidates";
import { V4_SCOPE_STOP_WORDS, V4_SCOPE_TOKEN_MIN } from "@/lib/proposals/constants";
import { checkProposal } from "@/lib/proposals/proposal-gate";
import { TEXT_RULES, findTextViolations } from "@/lib/proposals/text";
import { draftToWire, type ProposalDraftV4 } from "@/lib/proposals/v4/draft-schema";
import { V4_RULES, type ProposalCheckResult, type V4CheckContext, type V4Rule } from "@/lib/proposals/v4/types";

/**
 * R-24 `pcheck-v4` (plan §3.4): the plain-code check behind the v4 agent's `check_proposal` tool. Pure: no I/O, no
 * model call, no `@google/adk` (hard rule 10 — the model only passes or fails against it, never overrides it).
 *
 * It runs the eight `pgate-v1` checks first (one source of truth for the old rules, `checkProposal`), then the ten
 * `V4_RULES` in order. Every rule is evaluated; `fired_rule` is the first failure in that order and `reasons` lists
 * every failed rule code (codes and enum-ish labels only — never shop text, never a value from the draft).
 */

/** NFKC, lowercase, `"` -> `'`, anything but letters, digits, `'` and space -> space, collapsed, trimmed. */
export function normalizeForCheck(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/"/g, "'")
    .replace(/[^\p{L}\p{N}' ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words of `s` that can carry scope: normalised, at least `V4_SCOPE_TOKEN_MIN` chars, not a stop word. */
function scopeTokens(s: string): string[] {
  return normalizeForCheck(s)
    .split(" ")
    .filter((t) => t.length >= V4_SCOPE_TOKEN_MIN && !V4_SCOPE_STOP_WORDS.has(t));
}

/** What a fact says, for quote and scope matching: summary + excerpt + staff note (all already scrubbed). */
function evidenceText(c: Candidate, note: string | undefined): string {
  return `${c.summary} / ${c.excerpt} / ${note ?? ""}`;
}

const ISO_DATE_RULE = TEXT_RULES.find((r) => r.label === "ISO date");

/** Rule 11: wording a judge must never see, in the three proposal texts plus an ISO date in the two metric texts. */
function textViolationReasons(draft: ProposalDraftV4): string[] {
  const reasons: string[] = [];
  for (const hit of findTextViolations({
    change_title: draft.change_title,
    change_text: draft.change_text,
    rationale: draft.rationale,
  })) {
    // `findTextViolations` yields "<field>: <label>"; the field never contains ": ".
    const at = hit.indexOf(": ");
    reasons.push(`text_rule_violation:${hit.slice(0, at)}:${hit.slice(at + 2)}`);
  }
  if (ISO_DATE_RULE) {
    for (const field of ["metric_description", "failure_condition"] as const) {
      if (ISO_DATE_RULE.re.test(draft[field])) reasons.push(`text_rule_violation:${field}:${ISO_DATE_RULE.label}`);
    }
  }
  return reasons;
}

/** Rule 9: does the evidence the draft cites mention what is distinctive about the section it targets? */
function scopeSupported(draft: ProposalDraftV4, ctx: V4CheckContext): boolean {
  if (ctx.sections.length < 2) return true;
  const section = ctx.sections.find((s) => s.section_id === draft.section_id);
  if (!section) return true; // an unknown section is `section_not_fetched` / `step_not_in_section`, not a scope question

  const titleOfStep = new Map(ctx.sop.steps.map((s) => [s.step_id, s.title]));
  const sectionText = (ids: readonly string[], title: string) =>
    `${title} ${ids.map((id) => titleOfStep.get(id) ?? "").join(" ")}`;

  const mine = new Set(scopeTokens(sectionText(section.step_ids, section.title)));
  const others = new Set(
    ctx.sections
      .filter((s) => s !== section)
      .flatMap((s) => scopeTokens(sectionText(s.step_ids, s.title))),
  );
  const distinctive = [...mine].filter((t) => !others.has(t));
  if (distinctive.length === 0) return true;

  const words = draft.evidence.flatMap((alias) => {
    const c = ctx.aliasToCandidate.get(alias);
    return c ? scopeTokens(evidenceText(c, ctx.reasons.get(c.thread_id))) : [];
  });
  return distinctive.some((t) => words.some((w) => w.startsWith(t) || t.startsWith(w)));
}

export function checkProposalV4(draft: ProposalDraftV4, ctx: V4CheckContext): ProposalCheckResult {
  const gate = checkProposal(draftToWire(draft), ctx.gateCtx);
  const checks: ProposalCheckResult["checks"] = gate.checks.map((c) => ({ rule: c.rule as ProposalRule, passed: c.passed }));
  const reasons: string[] = gate.checks.filter((c) => !c.passed).map((c) => c.rule);

  const section = ctx.sections.find((s) => s.section_id === draft.section_id);
  const quoteAliases = draft.evidence_quotes.map((q) => q.alias);
  const step = ctx.sop.steps.find((s) => s.step_id === draft.target_step_id);

  const results: Record<Exclude<V4Rule, "text_rule_violation">, boolean> = {
    section_not_fetched: ctx.fetchedSections.has(draft.section_id),
    step_not_in_section: draft.target_step_id === "NEW" || (section?.step_ids.includes(draft.target_step_id) ?? false),
    evidence_not_inspected: draft.evidence.every((a) => ctx.inspectedAliases.has(a)),
    intervention_not_inspected: ctx.inspectedInterventions.has(draft.intervention_id),
    quote_alias_not_cited: quoteAliases.every((a) => draft.evidence.includes(a)),
    quotes_insufficient: new Set(quoteAliases).size >= 2,
    quote_not_in_evidence: draft.evidence_quotes.every((q) => {
      const c = ctx.aliasToCandidate.get(q.alias);
      if (!c) return false;
      const quote = normalizeForCheck(q.quote);
      // An empty normalised quote (punctuation only) would be a substring of everything: it quotes nothing.
      return quote !== "" && normalizeForCheck(evidenceText(c, ctx.reasons.get(c.thread_id))).includes(quote);
    }),
    scope_unsupported: scopeSupported(draft, ctx),
    change_is_noop:
      draft.target_step_id === "NEW"
        ? !ctx.sop.steps.some((s) => normalizeForCheck(s.text) === normalizeForCheck(draft.change_text))
        : step === undefined || normalizeForCheck(step.text) !== normalizeForCheck(draft.change_text),
  };

  const textReasons = textViolationReasons(draft);
  for (const rule of V4_RULES) {
    const passed = rule === "text_rule_violation" ? textReasons.length === 0 : results[rule];
    checks.push({ rule, passed });
    if (!passed) reasons.push(...(rule === "text_rule_violation" ? textReasons : [rule]));
  }

  const fired = checks.find((c) => !c.passed);
  return { passed: fired === undefined, fired_rule: fired?.rule ?? null, checks, reasons };
}

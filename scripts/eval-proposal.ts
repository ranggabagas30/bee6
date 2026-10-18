/**
 * R-20 real-model check for the Proposal agent (docs/tasks/R-20-rehearsal-fixes.md section 1.4).
 *
 * The 15 Oct live rehearsal showed the Proposal agent declining every Ask because it only saw the label model's
 * event summaries. R-20 PR-A feeds it each fact's quote and the staff's debrief note. This script replays the
 * rehearsal's own (fictional) facts through the REAL prompt builder, wire schema and plain-code gate (`pgate-v1`)
 * and calls the real agent (`adkProposalModel`, gemini-3.5-flash, location from `config/regions.yaml`):
 *   A     two egg-tart freshness facts on two dates (no staff note)      -> expect `propose`, gate passes >= 2/3
 *   B     two phone-order facts on two dates, with the staff's notes     -> expect `propose`, gate passes >= 2/3
 *   weak  two unrelated customer-service facts on two dates (control)    -> expect `no_proposal` >= 2/3
 *   (d)   a single-date variant is never sent: `checkEvidenceFloor` is asserted false offline.
 * One call per run (no retry-with-rejection, which production adds), so a gate failure counts here as a failure.
 * A model error is retried up to 3 times; if it persists the run is an error, and a cell that errors enough to
 * hide a pass is INCONCLUSIVE (quota / infrastructure), not a FAIL.
 *
 * Hard rules: Google only (the existing Vertex ADK agent, ADC), demo project only (`bee6-playground`, refused
 * elsewhere; never the pilot project), fictional fixture only (#8), no audio, nothing stored, Firestore never
 * touched. The report prints counts, fired rules and evidence aliases only: never fixture text or model text,
 * EXCEPT with `--texts` (R-21): then it also prints each proposed change_title/change_text/rationale (fictional fixture
 * and the demo project only) and greps them for `[staff]`, `(role:`, ISO dates, "phone number" and "name"; any hit fails (exit 2).
 *
 * R-24 (slice C1): `--agent v3|v4|both` opts into the EXTENDED harness (omit it and the run is exactly the R-20/R-21
 * run above: three cases, v3 only, same report). The extended harness runs seven cases (A, B, weak_cs plus the R-24
 * scope and PII cases over the fictional two-procedure SOP) through the v3 agent (`adkProposalModel`), the v4
 * tool-using agent (`adkProposalAgentV4` with the REAL tools, check and prompt of `lib/proposals/v4/*`), or both side
 * by side, and prints per case x agent: propose rate, scope precision, grounding, model calls, ms, tokens, tool-call
 * failure rate and `ended_by`, then p50/p95 latency per agent and a pass/fail summary against the switch-on bar
 * (plan D14). It never writes anywhere (no Firestore, no files). Counts, enums and ms only, never model text.
 *
 * Usage:   GOOGLE_CLOUD_PROJECT=bee6-playground npm run eval:proposal [-- --runs 3] [--texts]
 *          GOOGLE_CLOUD_PROJECT=bee6-playground npm run eval:proposal -- --agent both --runs 3 [--cases A,scope_ube]
 * Exit codes: 0 every case passes; 2 any genuine FAIL (or the offline floor check fails; in the extended harness also
 * any PII / wording hit or a failed switch-on bar item); 3 inconclusive cells and no FAIL (rerun later);
 * 1 setup/usage error.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadProposalLibrary, type ProposalLibrary } from "@/config/proposal-library";
import { getModelLocation } from "@/config/regions";
import { adkProposalModel, PROPOSAL_MODEL, type ProposalModel } from "@/lib/agents/proposal-agent";
import { adkProposalAgentV4, type ProposalAgentV4 } from "@/lib/agents/proposal-agent-v4";
import type { SopVersion } from "@/lib/firestore/schema";
import { aliasCandidates, selectCandidates, type ProposalThreadRow } from "@/lib/proposals/candidates";
import { MODEL_TIMEOUT_MS, V4_TIMEOUT_MS } from "@/lib/proposals/constants";
import { checkEvidenceFloor } from "@/lib/proposals/precheck";
import { checkProposal, type ProposalGateContext } from "@/lib/proposals/proposal-gate";
import { buildProposalPrompt } from "@/lib/proposals/prompt";
import {
  csDay1,
  csDay1Sari,
  csDay2,
  mixedUbeFine,
  phoneDay2,
  phoneDay3,
  phoneReasons,
  scopeDubaiRows,
  scopeMixedRows,
  scopeUbeRows,
  weakCs1,
  weakCs2,
  REHEARSAL_TZ,
} from "@/lib/proposals/testing/rehearsal-fixture";
import { buildProposalWireSchema, generateProposalJsonSchema, type WireContext } from "@/lib/proposals/wire-schema";
import { findTextViolations, type ProposedTexts } from "@/lib/proposals/text";
import { scrubStaffNames } from "@/lib/pipeline/label/scrub";
import { buildProposalDraftV4Schema } from "@/lib/proposals/v4/draft-schema";
import { buildProposalPromptV4 } from "@/lib/proposals/v4/prompt";
import { buildV4Tools, type AnyV4ToolSpec } from "@/lib/proposals/v4/tools";
import type { V4Session } from "@/lib/proposals/v4/types";
import { deriveSections, type SopSection } from "@/lib/sop/sections";
import { DEMO_SOP_V1 } from "@/scripts/demo-sop";
import { FIXTURE_SOP_STEPS } from "@/scripts/eval-fixtures/sop-two-procedures";

/** The only project this harness runs against (the demo project; pilot data must never reach it). */
export const DEMO_PROJECT_ID = "bee6-playground";
export const DEFAULT_RUNS = 3;

/** Refuses any project but the demo one (never the pilot: hard rules 4 and 8). Returns the project id. */
export function assertDemoProject(project: string | undefined): string {
  if (project !== DEMO_PROJECT_ID) {
    throw new Error(
      `eval:proposal runs on the demo project only. Run \`GOOGLE_CLOUD_PROJECT=${DEMO_PROJECT_ID} npm run eval:proposal\`.`,
    );
  }
  return project;
}
const ERROR_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 2_000;
const RANGE = { from_date: "2026-10-13", to_date: "2026-10-15" };

export type LegacyCaseId = "A" | "B" | "weak_cs";
export type ScopeCaseId = "scope_dubai" | "scope_ube" | "mixed_one_wrong" | "pii_probe";
export type CaseId = LegacyCaseId | ScopeCaseId;
export interface CaseSpec {
  id: CaseId;
  label: string;
  rows: ProposalThreadRow[];
  reasons: ReadonlyMap<string, string>;
  expected: "propose" | "decline";
  /** Which SOP the case runs over: the 5-step demo SOP (default) or the fictional two-procedure fixture (R-24 scope cases). */
  sop?: "demo" | "fixture";
  /** R-24: the section a correct proposal is scoped to (scope precision is measured against it). */
  expectedSection?: string;
  /** R-24 mixed case: thread ids of the facts about the OTHER procedure; citing one only counts as in-scope with a "only the Dubai" quote. */
  decoyThreadIds?: readonly string[];
  /** R-24 PII probe: fictional staff names planted in the facts; run through the real `scrubStaffNames` and grepped in every output text. */
  staffNames?: readonly string[];
}

export const CASES: readonly CaseSpec[] = [
  { id: "A", label: "problem A: no bake time on the tray", rows: [csDay1, csDay2], reasons: new Map(), expected: "propose" },
  { id: "B", label: "problem B: phone order not read back", rows: [phoneDay2, phoneDay3], reasons: phoneReasons, expected: "propose" },
  { id: "weak_cs", label: "control: two unrelated customer-service facts", rows: [weakCs1, weakCs2], reasons: new Map(), expected: "decline" },
];

/**
 * R-24 §8 scope and PII cases (fictional two-procedure SOP). They live in their own list so `CASES` (what the default,
 * v3-only run executes) stays exactly the three R-20 cases.
 */
export const SCOPE_CASES: readonly CaseSpec[] = [
  { id: "scope_dubai", label: "scope: Dubai Chewy facts only", rows: scopeDubaiRows, reasons: new Map(), expected: "propose", sop: "fixture", expectedSection: "bake-dubai" },
  { id: "scope_ube", label: "scope: Ube facts only", rows: scopeUbeRows, reasons: new Map(), expected: "propose", sop: "fixture", expectedSection: "bake-ube" },
  {
    id: "mixed_one_wrong",
    label: "scope: two Dubai facts plus an Ube fact that says only Dubai was wrong",
    rows: scopeMixedRows,
    reasons: new Map(),
    expected: "propose",
    sop: "fixture",
    expectedSection: "bake-dubai",
    decoyThreadIds: [mixedUbeFine.thread_id],
  },
  {
    id: "pii_probe",
    label: "PII: a fictional staff name planted in a fact, scrubbed before the model",
    rows: [csDay1Sari, csDay2],
    reasons: new Map(),
    expected: "propose",
    staffNames: ["Sari"],
  },
];

/** Every case of the extended harness (`--agent`), in report order. */
export const EXTENDED_CASES: readonly CaseSpec[] = [...CASES, ...SCOPE_CASES];

const EVAL_SOP: SopVersion = {
  outlet_id: "eval",
  sop_version_id: "eval:v1",
  version: 1,
  steps: DEMO_SOP_V1.steps,
  source: "seed",
  source_proposal_id: null,
  created_at_ms: 1,
};

const FIXTURE_SOP: SopVersion = { ...EVAL_SOP, steps: [...FIXTURE_SOP_STEPS] };

export interface CaseInput {
  aliased: ReturnType<typeof aliasCandidates>;
  prompt: ReturnType<typeof buildProposalPrompt>;
  jsonSchema: object;
  wireSchema: ReturnType<typeof buildProposalWireSchema>;
  gateCtx: ProposalGateContext;
  /** R-24 (v4 runs and scope metrics): the SOP this case runs over, its derived sections and the scrubbed staff notes. */
  sop: SopVersion;
  sections: SopSection[];
  reasons: ReadonlyMap<string, string>;
  wireCtx: WireContext;
  library: ProposalLibrary;
}

/**
 * Pure. Builds exactly what `generateProposal` builds for one focus category. Fact excerpts and staff notes go
 * through the real staff-name scrub first (a no-op unless the case plants `staffNames`, as the service does at 8c).
 */
export function buildCaseInput(spec: CaseSpec, library: ProposalLibrary): CaseInput {
  const sop = spec.sop === "fixture" ? FIXTURE_SOP : EVAL_SOP;
  const staffNames = spec.staffNames ?? [];
  const candidates = selectCandidates(spec.rows, [], REHEARSAL_TZ, RANGE);
  const aliased = aliasCandidates(candidates).map(({ alias, c }) => ({
    alias,
    c: { ...c, excerpt: scrubStaffNames(c.excerpt, staffNames) },
  }));
  const reasons = new Map([...spec.reasons].map(([id, text]) => [id, scrubStaffNames(text, staffNames)]));
  const wireCtx: WireContext = {
    interventionIds: library.interventions.entries.map((e) => e.id),
    rubricIds: library.rubric.entries.map((e) => e.id),
    evidenceAliases: aliased.map((a) => a.alias),
    stepIds: sop.steps.map((s) => s.step_id),
    constraintAliases: [],
  };
  return {
    aliased,
    prompt: buildProposalPrompt({ library, sop, aliased, reasons, constraints: [], range: RANGE }),
    jsonSchema: generateProposalJsonSchema(wireCtx),
    wireSchema: buildProposalWireSchema(wireCtx),
    gateCtx: {
      aliasToCandidate: new Map(aliased.map(({ alias, c }) => [alias, c])),
      interventionIds: new Set(wireCtx.interventionIds),
      rubricIds: new Set(wireCtx.rubricIds),
      stepIds: new Set(wireCtx.stepIds),
      constraintAliases: wireCtx.constraintAliases,
    },
    sop,
    sections: deriveSections(sop.steps),
    reasons,
    wireCtx,
    library,
  };
}

/** (d) Two facts of one category on ONE date never reach the model: the plain-code floor blocks them. */
export function singleDateIsBlockedByFloor(): boolean {
  const sameDay: ProposalThreadRow = { ...csDay1, thread_id: "unit_dev-SENTINEL-77_cs1b:0", first_line_start_ms: csDay1.first_line_start_ms + 60_000 };
  const candidates = selectCandidates([csDay1, sameDay], [], REHEARSAL_TZ, RANGE);
  return candidates.length === 2 && !checkEvidenceFloor(candidates).passed;
}

/** Re-export for backward compatibility (moved to lib/proposals/text.ts in R-24). */
export type { ProposedTexts };
export { findTextViolations };

export type RunResult =
  | { kind: "propose_pass"; cited?: string[]; intervention?: string; texts?: ProposedTexts }
  | { kind: "propose_blocked"; rule: string }
  | { kind: "declined"; reason: string | null }
  | { kind: "invalid_output" }
  | { kind: "model_error"; error_class: string }
  /** R-24 (v4 only): the run ended with no decision (timeout, call limit, or the model just stopped); production would fall back to v3. */
  | { kind: "agent_failed"; error_class: string };

export interface EvalDeps {
  model: ProposalModel;
  library: ProposalLibrary;
  ctx?: { project: string; location: string };
  sleep?: (ms: number) => Promise<void>;
  /** R-24: the v4 runner; required only when the extended harness runs the v4 agent. */
  agentV4?: ProposalAgentV4;
  /** R-24: injectable clock for the latency metrics (tests). */
  now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Per-run measurements (R-24 C1). Counts, enums and ms only: nothing here ever holds model text.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type AgentId = "v3" | "v4";

export interface RunMeasure {
  agent: AgentId;
  /** Wall ms spent inside the model call(s), summed over error retries (backoff sleeps excluded). */
  ms: number;
  /** v3: model calls made (1 per attempt). v4: summed `trace.model_calls`. */
  model_calls: number;
  input_tokens: number;
  output_tokens: number;
  thoughts_tokens: number;
  /** The section a proposing run targets (v4: the draft's `section_id`; v3: derived from `target_step_id`, NEW -> "unknown"). */
  section_id: string | null;
  /** true/false for a proposing run of a case that names an expected section; null otherwise. */
  scope_ok: boolean | null;
  /** v4 accepted drafts only: every quote passed `quote_not_in_evidence` on the first real check round. null otherwise. */
  grounded: boolean | null;
  /** Occurrences of a planted staff name in any output text of a proposing run. */
  pii_hits: number;
  /** `findTextViolations` hits over the proposed title/text/rationale of a proposing run. */
  text_violations: number;
  /** v4: tool calls in the trace, and how many answered with an error. */
  tool_calls: number;
  tool_calls_failed: number;
  /** v4: how the run ended (`trace.ended_by`). */
  ended_by: string | null;
  /** v4: counted `check_proposal` rounds. */
  check_rounds: number;
  /** v4: check rounds where `scope_unsupported` fired. */
  scope_fired: number;
  /** v4: of those, rounds whose draft named the case's expected section (a likely false negative, e.g. an `-ing` form). */
  scope_false_neg: number;
}

export interface MeasuredRun {
  result: RunResult;
  m: RunMeasure;
}

const emptyMeasure = (agent: AgentId): RunMeasure => ({
  agent,
  ms: 0,
  model_calls: 0,
  input_tokens: 0,
  output_tokens: 0,
  thoughts_tokens: 0,
  section_id: null,
  scope_ok: null,
  grounded: null,
  pii_hits: 0,
  text_violations: 0,
  tool_calls: 0,
  tool_calls_failed: 0,
  ended_by: null,
  check_rounds: 0,
  scope_fired: 0,
  scope_false_neg: 0,
});

/** Pure. Occurrences of any planted staff name (case-insensitive substring) in the output texts. */
export function countNameHits(texts: readonly string[], names: readonly string[]): number {
  let n = 0;
  for (const name of names) {
    const needle = name.trim().toLowerCase();
    if (!needle) continue;
    for (const t of texts) {
      const hay = t.toLowerCase();
      for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) n++;
    }
  }
  return n;
}

/** Pure. The section a v3 `target_step_id` belongs to (`NEW` or an unknown step -> "unknown", counted as a miss). */
export function sectionOfStep(sections: readonly SopSection[], targetStepId: string | null): string {
  if (!targetStepId || targetStepId === "NEW") return "unknown";
  return sections.find((s) => s.step_ids.includes(targetStepId))?.section_id ?? "unknown";
}

/**
 * Pure. Is a proposing run scoped to the right procedure? The draft's section must be the expected one; on a case with
 * decoy facts (the other procedure), citing a decoy is allowed only for v4, and only when every quote of it says
 * "only the Dubai ..." (the fact is cited as the counter-example). v3 has no quotes, so citing a decoy is a miss.
 */
export function judgeScope(
  spec: Pick<CaseSpec, "expectedSection" | "decoyThreadIds">,
  run: { section_id: string | null; cited: readonly string[]; aliasThread: ReadonlyMap<string, string>; quotes?: readonly { alias: string; quote: string }[] },
): boolean | null {
  if (!spec.expectedSection) return null;
  if (run.section_id !== spec.expectedSection) return false;
  const decoys = new Set(spec.decoyThreadIds ?? []);
  for (const alias of run.cited) {
    const thread = run.aliasThread.get(alias);
    if (!thread || !decoys.has(thread)) continue;
    const quotes = (run.quotes ?? []).filter((q) => q.alias === alias);
    if (quotes.length === 0 || !quotes.every((q) => /only the dubai/i.test(q.quote))) return false;
  }
  return true;
}

function sumUsage(
  m: RunMeasure,
  usage: { input_tokens: number | null; output_tokens: number | null; thoughts_tokens: number | null } | undefined,
): void {
  if (!usage) return;
  m.input_tokens += usage.input_tokens ?? 0;
  m.output_tokens += usage.output_tokens ?? 0;
  m.thoughts_tokens += usage.thoughts_tokens ?? 0;
}

async function runV3Measured(spec: CaseSpec, input: CaseInput, deps: EvalDeps): Promise<MeasuredRun> {
  const ctx = { ...(deps.ctx ?? { project: "test", location: "test" }), timeoutMs: MODEL_TIMEOUT_MS };
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  const m = emptyMeasure("v3");
  const aliasThread = new Map(input.aliased.map(({ alias, c }) => [alias, c.thread_id]));
  let errorClass = "unknown";
  for (let attempt = 1; attempt <= ERROR_ATTEMPTS; attempt++) {
    const t0 = now();
    const res = await deps.model(
      { systemInstruction: input.prompt.systemInstruction, userContent: input.prompt.userContent, responseJsonSchema: input.jsonSchema },
      ctx,
    );
    m.ms += now() - t0;
    m.model_calls += 1;
    if (res.kind === "error") {
      errorClass = res.error_class;
      if (attempt < ERROR_ATTEMPTS) await sleep(BACKOFF_BASE_MS * attempt);
      continue;
    }
    sumUsage(m, res.usage);
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      return { result: { kind: "invalid_output" }, m };
    }
    const parsed = input.wireSchema.safeParse(json);
    if (!parsed.success) return { result: { kind: "invalid_output" }, m };
    if (parsed.data.decision === "no_proposal") return { result: { kind: "declined", reason: parsed.data.no_proposal_reason }, m };
    const gate = checkProposal(parsed.data, input.gateCtx);
    if (!gate.passed) return { result: { kind: "propose_blocked", rule: gate.fired_rule ?? "unknown" }, m };
    const texts: ProposedTexts = {
      change_title: parsed.data.change_title,
      change_text: parsed.data.change_text,
      rationale: parsed.data.rationale,
    };
    const cited = [...new Set(parsed.data.evidence)];
    m.section_id = sectionOfStep(input.sections, parsed.data.target_step_id);
    m.scope_ok = judgeScope(spec, { section_id: m.section_id, cited, aliasThread });
    m.text_violations = findTextViolations(texts).length;
    m.pii_hits = countNameHits(
      [parsed.data.change_title, parsed.data.change_text, parsed.data.rationale, parsed.data.metric_description, parsed.data.failure_condition],
      spec.staffNames ?? [],
    );
    return { result: { kind: "propose_pass", cited, intervention: parsed.data.intervention_id ?? undefined, texts }, m };
  }
  return { result: { kind: "model_error", error_class: errorClass }, m };
}

async function runOne(input: CaseInput, deps: EvalDeps): Promise<RunResult> {
  // The legacy path: the R-20 cases name no expected section and plant no staff names, so the extra measuring is a no-op.
  return (await runV3Measured(CASES[0]!, input, deps)).result;
}

// ── v4 ──────────────────────────────────────────────────────────────────────────────────────

/** One `check_proposal` result as the eval saw it: rule codes only (the part before any `:`), never values. */
export interface CheckRound {
  section_id: string | null;
  reasons: string[];
}

/** Pure. Rule codes from a `check_proposal` tool result (`undefined` when the result carries no reasons, e.g. an error). */
export function ruleCodesOf(out: unknown): string[] | undefined {
  if (typeof out !== "object" || out === null || !Array.isArray((out as { reasons?: unknown }).reasons)) return undefined;
  return [...new Set(((out as { reasons: unknown[] }).reasons).filter((r): r is string => typeof r === "string").map((r) => r.split(":")[0]!))];
}

/**
 * Wraps ONLY `check_proposal` so the eval can see each round's failed rule codes and the section the draft named. The
 * real tool still runs and its result goes back to the model unchanged; nothing else is altered.
 */
export function instrumentTools(tools: readonly AnyV4ToolSpec[], rounds: CheckRound[]): AnyV4ToolSpec[] {
  return tools.map((t) =>
    t.name !== "check_proposal"
      ? t
      : {
          ...t,
          execute: async (input: unknown) => {
            const out = await t.execute(input as never);
            const reasons = ruleCodesOf(out);
            if (reasons) {
              const section = (input as { section_id?: unknown } | null)?.section_id;
              rounds.push({ section_id: typeof section === "string" ? section : null, reasons });
            }
            return out;
          },
        },
  );
}

/** Pure. Round-level facts for the metrics: grounded on the first real round, and `scope_unsupported` firings. */
export function analyseRounds(
  rounds: readonly CheckRound[],
  expectedSection: string | undefined,
): { grounded: boolean; scope_fired: number; scope_false_neg: number } {
  const real = rounds.filter((r) => !r.reasons.includes("schema_invalid"));
  const first = real[0];
  const fired = rounds.filter((r) => r.reasons.includes("scope_unsupported"));
  return {
    grounded: first !== undefined && !first.reasons.includes("quote_not_in_evidence"),
    scope_fired: fired.length,
    scope_false_neg: expectedSection === undefined ? 0 : fired.filter((r) => r.section_id === expectedSection).length,
  };
}

const freshSession = (): V4Session => ({
  fetchedSections: new Set(),
  inspectedAliases: new Set(),
  inspectedInterventions: new Set(),
  checkRounds: 0,
  toolCalls: [],
  outcome: null,
});

async function runV4Measured(spec: CaseSpec, input: CaseInput, deps: EvalDeps): Promise<MeasuredRun> {
  if (!deps.agentV4) throw new Error("the v4 agent was not provided");
  const ctx = { ...(deps.ctx ?? { project: "test", location: "test" }), timeoutMs: V4_TIMEOUT_MS };
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  const m = emptyMeasure("v4");
  const aliasThread = new Map(input.aliased.map(({ alias, c }) => [alias, c.thread_id]));
  const rows = new Map(
    spec.rows.map((r) => [r.thread_id, { confidence: r.confidence, gate: r.gate, label_source: r.label_source }] as const),
  );
  const draftSchema = buildProposalDraftV4Schema({ ...input.wireCtx, sectionIds: input.sections.map((s) => s.section_id) });
  const prompt = buildProposalPromptV4({ library: input.library, sections: input.sections, aliased: input.aliased, constraints: [], range: RANGE });
  let errorClass = "unknown";
  for (let attempt = 1; attempt <= ERROR_ATTEMPTS; attempt++) {
    const session = freshSession();
    const rounds: CheckRound[] = [];
    const tools = instrumentTools(
      buildV4Tools(
        {
          sections: input.sections,
          sop: input.sop,
          aliased: input.aliased,
          reasons: input.reasons,
          rows,
          library: input.library,
          constraintAliases: [],
          draftSchema,
          gateCtx: input.gateCtx,
        },
        session,
      ),
      rounds,
    );
    const t0 = now();
    const res = await deps.agentV4({ systemInstruction: prompt.systemInstruction, userContent: prompt.userContent, tools, session }, ctx);
    m.ms += now() - t0;
    m.model_calls += res.trace.model_calls;
    sumUsage(m, res.usage);
    m.tool_calls = res.trace.tool_calls.length;
    m.tool_calls_failed = res.trace.tool_calls.filter((t) => !t.ok).length;
    m.ended_by = res.trace.ended_by;
    m.check_rounds = res.trace.check_rounds;
    const a = analyseRounds(rounds, spec.expectedSection);
    m.scope_fired = a.scope_fired;
    m.scope_false_neg = a.scope_false_neg;

    if (res.kind === "error") {
      errorClass = res.error_class;
      // Transport / HTTP errors are infrastructure: retry like v3. Timeout, call limit and "no decision" are the agent
      // failing to finish, which production would answer with a v3 fallback: a genuine non-pass here.
      if (res.trace.ended_by === "error") {
        if (attempt < ERROR_ATTEMPTS) await sleep(BACKOFF_BASE_MS * attempt);
        continue;
      }
      return { result: { kind: "agent_failed", error_class: res.error_class }, m };
    }
    const o = res.outcome;
    if (o.kind === "declined") return { result: { kind: "declined", reason: o.reason }, m };
    if (o.kind === "blocked") return { result: { kind: "propose_blocked", rule: o.rule }, m };
    const d = o.draft;
    const texts: ProposedTexts = { change_title: d.change_title, change_text: d.change_text, rationale: d.rationale };
    const cited = [...new Set(d.evidence)];
    m.section_id = d.section_id;
    m.scope_ok = judgeScope(spec, { section_id: d.section_id, cited, aliasThread, quotes: d.evidence_quotes });
    m.grounded = a.grounded;
    m.text_violations = findTextViolations(texts).length;
    m.pii_hits = countNameHits(
      [d.change_title, d.change_text, d.rationale, d.metric_description, d.failure_condition, ...d.evidence_quotes.map((q) => q.quote)],
      spec.staffNames ?? [],
    );
    return { result: { kind: "propose_pass", cited, intervention: d.intervention_id, texts }, m };
  }
  return { result: { kind: "model_error", error_class: errorClass }, m };
}

export type CaseStatus = "PASS" | "FAIL" | "INCONCLUSIVE";
export interface CaseSummary {
  id: CaseId;
  label: string;
  expected: "propose" | "decline";
  status: CaseStatus;
  counts: Record<string, number>;
  runs: RunResult[];
}

export function judgeCase(spec: CaseSpec, results: readonly RunResult[]): CaseSummary {
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  const need = Math.ceil((results.length * 2) / 3);
  const good = counts[spec.expected === "propose" ? "propose_pass" : "declined"] ?? 0;
  const errors = counts.model_error ?? 0;
  const status: CaseStatus = good >= need ? "PASS" : good + errors >= need ? "INCONCLUSIVE" : "FAIL";
  return { id: spec.id, label: spec.label, expected: spec.expected, status, counts, runs: [...results] };
}

export interface EvalReport {
  cases: CaseSummary[];
  floor_blocks_single_date: boolean;
  /** R-21: set when run with `--texts`; the report then prints the proposed texts and counts grep violations. */
  texts?: boolean;
  text_violations?: number;
}

export async function runEval(opts: { runs: number; texts?: boolean }, deps: EvalDeps): Promise<EvalReport> {
  const cases: CaseSummary[] = [];
  for (const spec of CASES) {
    const input = buildCaseInput(spec, deps.library);
    const results: RunResult[] = [];
    for (let i = 0; i < opts.runs; i++) results.push(await runOne(input, deps));
    cases.push(judgeCase(spec, results));
  }
  const report: EvalReport = { cases, floor_blocks_single_date: singleDateIsBlockedByFloor() };
  if (opts.texts) {
    report.texts = true;
    report.text_violations = cases
      .flatMap((c) => c.runs)
      .reduce((n, r) => n + (r.kind === "propose_pass" && r.texts ? findTextViolations(r.texts).length : 0), 0);
  }
  return report;
}

/** 0 all pass; 2 any genuine FAIL or the offline floor check failing; 3 inconclusive cells and no FAIL. */
export function exitCodeFor(report: EvalReport): 0 | 2 | 3 {
  if (!report.floor_blocks_single_date || report.cases.some((c) => c.status === "FAIL")) return 2;
  if ((report.text_violations ?? 0) > 0) return 2;
  if (report.cases.some((c) => c.status === "INCONCLUSIVE")) return 3;
  return 0;
}

/** Counts, fired rules, error classes, library ids and aliases only: never fixture or model text. */
export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  for (const c of report.cases) {
    const counts = Object.entries(c.counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    lines.push(`${c.status.padEnd(12)} ${c.id.padEnd(8)} expect ${c.expected.padEnd(8)} ${counts}   (${c.label})`);
    const notes = c.runs.flatMap((r, i) => {
      if (r.kind === "propose_blocked") return [`run ${i + 1}: gate rule ${r.rule}`];
      if (r.kind === "declined") return [`run ${i + 1}: declined ${r.reason ?? "-"}`];
      if (r.kind === "model_error") return [`run ${i + 1}: error ${r.error_class}`];
      if (r.kind === "agent_failed") return [`run ${i + 1}: agent failed ${r.error_class}`];
      if (r.kind === "propose_pass") {
        const head = `run ${i + 1}: cited ${(r.cited ?? []).join(",")} via ${r.intervention ?? "-"}`;
        if (!report.texts || !r.texts) return [head];
        const violations = findTextViolations(r.texts);
        return [
          head,
          `  change_title: ${r.texts.change_title}`,
          `  change_text: ${r.texts.change_text}`,
          `  rationale: ${r.texts.rationale}`,
          ...violations.map((v) => `  violation ${v}`),
        ];
      }
      return [`run ${i + 1}: invalid output`];
    });
    lines.push(...notes.map((n) => `             ${n}`));
  }
  lines.push(`${report.floor_blocks_single_date ? "PASS" : "FAIL"}         (d) single-date variant blocked by the floor offline`);
  if (report.texts) {
    const n = report.text_violations ?? 0;
    lines.push(`${n === 0 ? "PASS" : "FAIL"}         (R-21) wording grep over the proposed texts: ${n} violation(s)`);
  }
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// R-24 C1: the extended harness (`--agent v3|v4|both`)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The D14 switch-on bar (plan section 8): v4 >= v3 on A/B/weak_cs, scope precision, no PII, p95. */
export const BAR = { scope_precision_min: 0.8, p95_ms_max: 40_000 } as const;
const BAR_SCOPE_CASES: readonly CaseId[] = ["scope_dubai", "scope_ube", "mixed_one_wrong"];
const BAR_RATE_CASES: readonly CaseId[] = ["A", "B", "weak_cs"];

/** One case x agent cell: the legacy judgement plus the R-24 metrics. */
export interface CellSummary {
  agent: AgentId;
  summary: CaseSummary;
  measures: RunMeasure[];
  propose_pass: number;
  scope_right: number;
  /** Proposing runs of a case with an expected section (the scope-precision denominator). */
  scope_runs: number;
  grounded_ok: number;
  grounded_runs: number;
  mean_calls: number | null;
  mean_ms: number | null;
  mean_input: number | null;
  mean_output: number | null;
  mean_thoughts: number | null;
  tool_calls: number;
  tool_calls_failed: number;
  ended_by: Record<string, number>;
  pii_hits: number;
  text_violations: number;
  scope_fired: number;
  scope_false_neg: number;
}

export function mean(xs: readonly number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Nearest-rank percentile (p in 0..100); null for an empty list. */
export function percentile(xs: readonly number[], p: number): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1]!;
}

export function summariseCell(spec: CaseSpec, agent: AgentId, runs: readonly MeasuredRun[]): CellSummary {
  const summary = judgeCase(spec, runs.map((r) => r.result));
  const ms = runs.map((r) => r.m);
  const proposing = runs.filter((r) => r.result.kind === "propose_pass");
  const scoped = proposing.filter((r) => r.m.scope_ok !== null);
  const grounded = proposing.filter((r) => r.m.grounded !== null);
  const called = ms.filter((m) => m.model_calls > 0);
  const endedBy: Record<string, number> = {};
  for (const m of ms) if (m.ended_by) endedBy[m.ended_by] = (endedBy[m.ended_by] ?? 0) + 1;
  const sum = (f: (m: RunMeasure) => number) => ms.reduce((n, m) => n + f(m), 0);
  return {
    agent,
    summary,
    measures: ms,
    propose_pass: proposing.length,
    scope_right: scoped.filter((r) => r.m.scope_ok === true).length,
    scope_runs: scoped.length,
    grounded_ok: grounded.filter((r) => r.m.grounded === true).length,
    grounded_runs: grounded.length,
    mean_calls: mean(called.map((m) => m.model_calls)),
    mean_ms: mean(called.map((m) => m.ms)),
    mean_input: mean(called.map((m) => m.input_tokens)),
    mean_output: mean(called.map((m) => m.output_tokens)),
    mean_thoughts: mean(called.map((m) => m.thoughts_tokens)),
    tool_calls: sum((m) => m.tool_calls),
    tool_calls_failed: sum((m) => m.tool_calls_failed),
    ended_by: endedBy,
    pii_hits: sum((m) => m.pii_hits),
    text_violations: sum((m) => m.text_violations),
    scope_fired: sum((m) => m.scope_fired),
    scope_false_neg: sum((m) => m.scope_false_neg),
  };
}

export type BarStatus = "PASS" | "FAIL" | "SKIP" | "INCONCLUSIVE";
export interface BarItem {
  id: string;
  label: string;
  status: BarStatus;
  detail: string;
}
export interface BarResult {
  items: BarItem[];
  /** SWITCH_ON_OK only when every item PASSes; NOT_OK on any FAIL; otherwise INCOMPLETE (skipped / inconclusive items). */
  verdict: "SWITCH_ON_OK" | "NOT_OK" | "INCOMPLETE";
}

const cellOf = (cells: readonly CellSummary[], id: CaseId, agent: AgentId) =>
  cells.find((c) => c.summary.id === id && c.agent === agent);

/** Share of runs that did what the case expects, among runs that were not infrastructure errors. null when there are none. */
function goodRate(c: CellSummary): number | null {
  const valid = c.summary.runs.length - (c.summary.counts.model_error ?? 0);
  if (valid <= 0) return null;
  const good = c.summary.counts[c.summary.expected === "propose" ? "propose_pass" : "declined"] ?? 0;
  return good / valid;
}

export function evaluateBar(cells: readonly CellSummary[]): BarResult {
  const items: BarItem[] = [];

  // 1. v4 >= v3 on the propose/decline rate of A, B, weak_cs.
  for (const id of BAR_RATE_CASES) {
    const v3 = cellOf(cells, id, "v3");
    const v4 = cellOf(cells, id, "v4");
    const label = `v4 >= v3 on ${id}`;
    if (!v3 || !v4) {
      items.push({ id: `rate_${id}`, label, status: "SKIP", detail: "needs --agent both and the case selected" });
      continue;
    }
    const r3 = goodRate(v3);
    const r4 = goodRate(v4);
    if (r3 === null || r4 === null) {
      items.push({ id: `rate_${id}`, label, status: "INCONCLUSIVE", detail: "every run of one side errored" });
      continue;
    }
    items.push({ id: `rate_${id}`, label, status: r4 >= r3 ? "PASS" : "FAIL", detail: `v3 ${r3.toFixed(2)} v4 ${r4.toFixed(2)}` });
  }

  // 2. v4 scope precision >= 0.8 on the three scope cases.
  for (const id of BAR_SCOPE_CASES) {
    const v4 = cellOf(cells, id, "v4");
    const label = `v4 scope precision >= ${BAR.scope_precision_min} on ${id}`;
    if (!v4) {
      items.push({ id: `scope_${id}`, label, status: "SKIP", detail: "needs the v4 agent and the case selected" });
      continue;
    }
    if (v4.scope_runs === 0) {
      const onlyErrors = (v4.summary.counts.model_error ?? 0) === v4.summary.runs.length;
      items.push({ id: `scope_${id}`, label, status: onlyErrors ? "INCONCLUSIVE" : "FAIL", detail: "no proposing run to measure" });
      continue;
    }
    const p = v4.scope_right / v4.scope_runs;
    items.push({ id: `scope_${id}`, label, status: p >= BAR.scope_precision_min ? "PASS" : "FAIL", detail: `${v4.scope_right}/${v4.scope_runs} = ${p.toFixed(2)}` });
  }

  // 3. No PII / wording hits in any v4 output (the planted-name probe must have run).
  const v4Cells = cells.filter((c) => c.agent === "v4");
  if (v4Cells.length === 0) {
    items.push({ id: "pii", label: "0 PII", status: "SKIP", detail: "needs the v4 agent" });
  } else {
    const hits = v4Cells.reduce((n, c) => n + c.pii_hits + c.text_violations, 0);
    const probed = cellOf(cells, "pii_probe", "v4") !== undefined;
    items.push({ id: "pii", label: "0 PII", status: hits > 0 ? "FAIL" : probed ? "PASS" : "SKIP", detail: `${hits} hit(s)${probed ? "" : "; pii_probe not selected"}` });
  }

  // 4. v4 p95 latency <= 40 s.
  const lat = v4Cells.flatMap((c) => c.measures.filter((m) => m.model_calls > 0).map((m) => m.ms));
  const p95 = percentile(lat, 95);
  items.push(
    p95 === null
      ? { id: "p95", label: `v4 p95 <= ${BAR.p95_ms_max / 1000} s`, status: "SKIP", detail: "no v4 runs" }
      : { id: "p95", label: `v4 p95 <= ${BAR.p95_ms_max / 1000} s`, status: p95 <= BAR.p95_ms_max ? "PASS" : "FAIL", detail: `${p95} ms over ${lat.length} runs` },
  );

  const verdict = items.some((i) => i.status === "FAIL")
    ? "NOT_OK"
    : items.every((i) => i.status === "PASS")
      ? "SWITCH_ON_OK"
      : "INCOMPLETE";
  return { items, verdict };
}

export interface AgentStats {
  agent: AgentId;
  runs: number;
  p50_ms: number | null;
  p95_ms: number | null;
  mean_input: number | null;
  mean_output: number | null;
  mean_thoughts: number | null;
}

export interface ExtendedReport {
  agents: AgentId[];
  runs: number;
  cells: CellSummary[];
  floor_blocks_single_date: boolean;
  stats: AgentStats[];
  bar: BarResult;
  texts?: boolean;
  /** Per-run proposed texts, only kept when `--texts` is set (fictional fixture, demo project). */
  run_results?: { case_id: CaseId; agent: AgentId; result: RunResult }[];
}

export function agentStats(cells: readonly CellSummary[], agent: AgentId): AgentStats {
  const ms = cells.filter((c) => c.agent === agent).flatMap((c) => c.measures.filter((m) => m.model_calls > 0));
  return {
    agent,
    runs: ms.length,
    p50_ms: percentile(ms.map((m) => m.ms), 50),
    p95_ms: percentile(ms.map((m) => m.ms), 95),
    mean_input: mean(ms.map((m) => m.input_tokens)),
    mean_output: mean(ms.map((m) => m.output_tokens)),
    mean_thoughts: mean(ms.map((m) => m.thoughts_tokens)),
  };
}

export async function runEvalExtended(
  opts: { runs: number; texts?: boolean; agent: AgentMode; cases?: readonly CaseId[] },
  deps: EvalDeps,
): Promise<ExtendedReport> {
  const agents: AgentId[] = opts.agent === "both" ? ["v3", "v4"] : [opts.agent];
  if (agents.includes("v4") && !deps.agentV4) throw new Error("the v4 agent was not provided");
  const specs = EXTENDED_CASES.filter((c) => !opts.cases || opts.cases.includes(c.id));
  const cells: CellSummary[] = [];
  const runResults: NonNullable<ExtendedReport["run_results"]> = [];
  for (const spec of specs) {
    const input = buildCaseInput(spec, deps.library);
    for (const agent of agents) {
      const runs: MeasuredRun[] = [];
      for (let i = 0; i < opts.runs; i++) {
        runs.push(agent === "v3" ? await runV3Measured(spec, input, deps) : await runV4Measured(spec, input, deps));
      }
      cells.push(summariseCell(spec, agent, runs));
      if (opts.texts) for (const r of runs) runResults.push({ case_id: spec.id, agent, result: r.result });
    }
  }
  const report: ExtendedReport = {
    agents,
    runs: opts.runs,
    cells,
    floor_blocks_single_date: singleDateIsBlockedByFloor(),
    stats: agents.map((a) => agentStats(cells, a)),
    bar: evaluateBar(cells),
  };
  if (opts.texts) {
    report.texts = true;
    report.run_results = runResults;
  }
  return report;
}

/** 0 all good; 2 any FAIL cell, floor failure, PII / wording hit or failed bar item; 3 inconclusive cells and no FAIL. */
export function exitCodeForExtended(report: ExtendedReport): 0 | 2 | 3 {
  if (!report.floor_blocks_single_date) return 2;
  if (report.cells.some((c) => c.summary.status === "FAIL" || c.pii_hits > 0 || c.text_violations > 0)) return 2;
  if (report.bar.items.some((i) => i.status === "FAIL")) return 2;
  if (report.cells.some((c) => c.summary.status === "INCONCLUSIVE")) return 3;
  return 0;
}

const f1 = (n: number | null) => (n === null ? "-" : n.toFixed(1));
const f0 = (n: number | null) => (n === null ? "-" : String(Math.round(n)));
const frac = (n: number, d: number) => (d === 0 ? "-" : `${n}/${d}`);

function formatCell(c: CellSummary): string {
  const counts = Object.entries(c.summary.counts).map(([k, v]) => `${k}=${v}`).join(" ");
  const scope = c.scope_runs === 0 ? "-" : `${frac(c.scope_right, c.scope_runs)} (${(c.scope_right / c.scope_runs).toFixed(2)})`;
  const v4Only = c.agent === "v4"
    ? `  grounded ${frac(c.grounded_ok, c.grounded_runs)}  tool_fail ${frac(c.tool_calls_failed, c.tool_calls)}  ended ${Object.entries(c.ended_by).map(([k, v]) => `${k}=${v}`).join(",") || "-"}  scope_fired ${c.scope_fired} (false-neg ${c.scope_false_neg})`
    : "";
  return (
    `  ${c.agent}  ${c.summary.status.padEnd(12)} ${counts}` +
    `  propose ${frac(c.propose_pass, c.summary.runs.length)}  scope ${scope}  calls ${f1(c.mean_calls)}  ms ${f0(c.mean_ms)}` +
    `  tok in ${f0(c.mean_input)} out ${f0(c.mean_output)} think ${f0(c.mean_thoughts)}  pii ${c.pii_hits} wording ${c.text_violations}${v4Only}`
  );
}

/** Counts, enums, section ids, aliases and ms only: never fixture or model text (except proposed texts under `--texts`). */
export function formatExtendedReport(report: ExtendedReport): string {
  const lines: string[] = [];
  const caseIds = [...new Set(report.cells.map((c) => c.summary.id))];
  for (const id of caseIds) {
    const cells = report.cells.filter((c) => c.summary.id === id);
    const first = cells[0]!.summary;
    lines.push(`${id.padEnd(16)} expect ${first.expected}  (${first.label})`);
    for (const c of cells) {
      lines.push(formatCell(c));
      c.summary.runs.forEach((r, i) => {
        const note =
          r.kind === "propose_blocked" ? `gate rule ${r.rule}`
          : r.kind === "declined" ? `declined ${r.reason ?? "-"}`
          : r.kind === "model_error" ? `error ${r.error_class}`
          : r.kind === "agent_failed" ? `agent failed ${r.error_class}`
          : r.kind === "invalid_output" ? "invalid output"
          : `cited ${(r.cited ?? []).join(",")} via ${r.intervention ?? "-"} section ${c.measures[i]?.section_id ?? "-"}${c.measures[i]?.scope_ok === false ? " OUT-OF-SCOPE" : ""}`;
        lines.push(`        run ${i + 1}: ${note}`);
        if (report.texts && r.kind === "propose_pass" && r.texts) {
          lines.push(`          change_title: ${r.texts.change_title}`, `          change_text: ${r.texts.change_text}`, `          rationale: ${r.texts.rationale}`);
        }
      });
    }
  }
  lines.push("", `latency and tokens per run (all cases, ${report.runs} run(s) per cell)`);
  for (const s of report.stats) {
    lines.push(`  ${s.agent}  runs ${s.runs}  p50 ${f0(s.p50_ms)} ms  p95 ${f0(s.p95_ms)} ms  mean tok in ${f0(s.mean_input)} out ${f0(s.mean_output)} think ${f0(s.mean_thoughts)}`);
  }
  lines.push("", `${report.floor_blocks_single_date ? "PASS" : "FAIL"}  (d) single-date variant blocked by the floor offline`, "", "switch-on bar (plan D14)");
  for (const i of report.bar.items) lines.push(`  ${i.status.padEnd(12)} ${i.label}  [${i.detail}]`);
  lines.push(`  VERDICT ${report.bar.verdict}`);
  return lines.join("\n");
}

export interface EvalArgs {
  runs: number;
  texts: boolean;
  /** R-24: set only when `--agent` is passed; absent = the legacy v3-only, three-case run. */
  agent?: AgentMode;
  /** R-24: `--cases A,scope_ube`; extended harness only. */
  cases?: CaseId[];
}
export type AgentMode = AgentId | "both";

const AGENT_MODES: readonly AgentMode[] = ["v3", "v4", "both"];

export function parseArgs(argv: string[]): EvalArgs {
  const args: EvalArgs = { runs: DEFAULT_RUNS, texts: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--texts") {
      args.texts = true;
      continue;
    }
    if (flag === "--agent") {
      const v = argv[++i];
      if (!AGENT_MODES.includes(v as AgentMode)) throw new Error("--agent must be v3, v4 or both");
      args.agent = v as AgentMode;
      continue;
    }
    if (flag === "--cases") {
      const v = argv[++i];
      if (!v) throw new Error("--cases needs a comma-separated list of case ids");
      const ids = v.split(",").map((x) => x.trim());
      const known = EXTENDED_CASES.map((c) => c.id as string);
      const bad = ids.filter((x) => !known.includes(x));
      if (bad.length > 0) throw new Error(`unknown case ${bad.join(",")}; known: ${known.join(",")}`);
      args.cases = [...new Set(ids)] as CaseId[];
      continue;
    }
    if (flag !== "--runs") throw new Error(`unknown argument ${flag}`);
    const n = Number(argv[++i]);
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error("--runs must be an integer 1-10");
    args.runs = n;
  }
  if (args.cases && !args.agent) throw new Error("--cases needs --agent (the default run is the three R-20 cases)");
  return args;
}

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const project = assertDemoProject(process.env.GOOGLE_CLOUD_PROJECT);
  const args = parseArgs(process.argv.slice(2));
  const location = getModelLocation(PROPOSAL_MODEL).location; // config/regions.yaml, never hard-coded (rule 5)
  console.log(`[eval:proposal] project=${project} model=${PROPOSAL_MODEL} location=${location} runs=${args.runs}${args.agent ? ` agent=${args.agent}` : ""}`);
  console.log(
    `[eval:proposal] fictional fixture only (hard rule #8); the report prints ${args.texts ? "the proposed texts (--texts)" : "counts, never text"}`,
  );
  const deps = { model: adkProposalModel, agentV4: adkProposalAgentV4, library: loadProposalLibrary({ allowDraft: true }), ctx: { project, location } };
  if (args.agent) {
    // R-24 C1 extended harness (opt-in with --agent). Not written anywhere; the report is the only output.
    const report = await runEvalExtended({ runs: args.runs, texts: args.texts, agent: args.agent, cases: args.cases }, deps);
    console.log(formatExtendedReport(report));
    process.exitCode = exitCodeForExtended(report);
    return;
  }
  const report = await runEval(args, deps);
  console.log(formatReport(report));
  process.exitCode = exitCodeFor(report);
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}

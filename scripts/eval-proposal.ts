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
 * Usage:   GOOGLE_CLOUD_PROJECT=bee6-playground npm run eval:proposal [-- --runs 3] [--texts]
 * Exit codes: 0 every case passes; 2 any genuine FAIL (or the offline floor check fails); 3 inconclusive cells and
 * no FAIL (rerun later); 1 setup/usage error.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadProposalLibrary, type ProposalLibrary } from "@/config/proposal-library";
import { getModelLocation } from "@/config/regions";
import { adkProposalModel, PROPOSAL_MODEL, type ProposalModel } from "@/lib/agents/proposal-agent";
import type { SopVersion } from "@/lib/firestore/schema";
import { aliasCandidates, selectCandidates, type ProposalThreadRow } from "@/lib/proposals/candidates";
import { MODEL_TIMEOUT_MS } from "@/lib/proposals/constants";
import { checkEvidenceFloor } from "@/lib/proposals/precheck";
import { checkProposal, type ProposalGateContext } from "@/lib/proposals/proposal-gate";
import { buildProposalPrompt } from "@/lib/proposals/prompt";
import {
  csDay1,
  csDay2,
  phoneDay2,
  phoneDay3,
  phoneReasons,
  weakCs1,
  weakCs2,
  REHEARSAL_TZ,
} from "@/lib/proposals/testing/rehearsal-fixture";
import { buildProposalWireSchema, generateProposalJsonSchema, type WireContext } from "@/lib/proposals/wire-schema";
import { findTextViolations, type ProposedTexts } from "@/lib/proposals/text";
import { DEMO_SOP_V1 } from "@/scripts/demo-sop";

/** The only project this harness runs against (the demo project; pilot data must never reach it). */
export const DEMO_PROJECT_ID = "bee6-playground";
export const DEFAULT_RUNS = 3;
const ERROR_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 2_000;
const RANGE = { from_date: "2026-10-13", to_date: "2026-10-15" };

export type CaseId = "A" | "B" | "weak_cs";
export interface CaseSpec {
  id: CaseId;
  label: string;
  rows: ProposalThreadRow[];
  reasons: ReadonlyMap<string, string>;
  expected: "propose" | "decline";
}

export const CASES: readonly CaseSpec[] = [
  { id: "A", label: "problem A: no bake time on the tray", rows: [csDay1, csDay2], reasons: new Map(), expected: "propose" },
  { id: "B", label: "problem B: phone order not read back", rows: [phoneDay2, phoneDay3], reasons: phoneReasons, expected: "propose" },
  { id: "weak_cs", label: "control: two unrelated customer-service facts", rows: [weakCs1, weakCs2], reasons: new Map(), expected: "decline" },
];

const EVAL_SOP: SopVersion = {
  outlet_id: "eval",
  sop_version_id: "eval:v1",
  version: 1,
  steps: DEMO_SOP_V1.steps,
  source: "seed",
  source_proposal_id: null,
  created_at_ms: 1,
};

export interface CaseInput {
  aliased: ReturnType<typeof aliasCandidates>;
  prompt: ReturnType<typeof buildProposalPrompt>;
  jsonSchema: object;
  wireSchema: ReturnType<typeof buildProposalWireSchema>;
  gateCtx: ProposalGateContext;
}

/** Pure. Builds exactly what `generateProposal` builds for one focus category (no staff names to scrub in the fixture). */
export function buildCaseInput(spec: CaseSpec, library: ProposalLibrary): CaseInput {
  const candidates = selectCandidates(spec.rows, [], REHEARSAL_TZ, RANGE);
  const aliased = aliasCandidates(candidates);
  const wireCtx: WireContext = {
    interventionIds: library.interventions.entries.map((e) => e.id),
    rubricIds: library.rubric.entries.map((e) => e.id),
    evidenceAliases: aliased.map((a) => a.alias),
    stepIds: EVAL_SOP.steps.map((s) => s.step_id),
    constraintAliases: [],
  };
  return {
    aliased,
    prompt: buildProposalPrompt({ library, sop: EVAL_SOP, aliased, reasons: spec.reasons, constraints: [], range: RANGE }),
    jsonSchema: generateProposalJsonSchema(wireCtx),
    wireSchema: buildProposalWireSchema(wireCtx),
    gateCtx: {
      aliasToCandidate: new Map(aliased.map(({ alias, c }) => [alias, c])),
      interventionIds: new Set(wireCtx.interventionIds),
      rubricIds: new Set(wireCtx.rubricIds),
      stepIds: new Set(wireCtx.stepIds),
      constraintAliases: wireCtx.constraintAliases,
    },
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
  | { kind: "model_error"; error_class: string };

export interface EvalDeps {
  model: ProposalModel;
  library: ProposalLibrary;
  ctx?: { project: string; location: string };
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function runOne(input: CaseInput, deps: EvalDeps): Promise<RunResult> {
  const ctx = { ...(deps.ctx ?? { project: "test", location: "test" }), timeoutMs: MODEL_TIMEOUT_MS };
  const sleep = deps.sleep ?? realSleep;
  let errorClass = "unknown";
  for (let attempt = 1; attempt <= ERROR_ATTEMPTS; attempt++) {
    const res = await deps.model(
      { systemInstruction: input.prompt.systemInstruction, userContent: input.prompt.userContent, responseJsonSchema: input.jsonSchema },
      ctx,
    );
    if (res.kind === "error") {
      errorClass = res.error_class;
      if (attempt < ERROR_ATTEMPTS) await sleep(BACKOFF_BASE_MS * attempt);
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      return { kind: "invalid_output" };
    }
    const parsed = input.wireSchema.safeParse(json);
    if (!parsed.success) return { kind: "invalid_output" };
    if (parsed.data.decision === "no_proposal") return { kind: "declined", reason: parsed.data.no_proposal_reason };
    const gate = checkProposal(parsed.data, input.gateCtx);
    if (!gate.passed) return { kind: "propose_blocked", rule: gate.fired_rule ?? "unknown" };
    return {
      kind: "propose_pass",
      cited: [...new Set(parsed.data.evidence)],
      intervention: parsed.data.intervention_id ?? undefined,
      texts: {
        change_title: parsed.data.change_title,
        change_text: parsed.data.change_text,
        rationale: parsed.data.rationale,
      },
    };
  }
  return { kind: "model_error", error_class: errorClass };
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

export function parseArgs(argv: string[]): { runs: number; texts: boolean } {
  const args = { runs: DEFAULT_RUNS, texts: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--texts") {
      args.texts = true;
      continue;
    }
    if (flag !== "--runs") throw new Error(`unknown argument ${flag}`);
    const n = Number(argv[++i]);
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error("--runs must be an integer 1-10");
    args.runs = n;
  }
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
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (project !== DEMO_PROJECT_ID) {
    throw new Error(
      `eval:proposal runs on the demo project only. Run \`GOOGLE_CLOUD_PROJECT=${DEMO_PROJECT_ID} npm run eval:proposal\`.`,
    );
  }
  const args = parseArgs(process.argv.slice(2));
  const location = getModelLocation(PROPOSAL_MODEL).location; // config/regions.yaml, never hard-coded (rule 5)
  console.log(`[eval:proposal] project=${project} model=${PROPOSAL_MODEL} location=${location} runs=${args.runs}`);
  console.log(
    `[eval:proposal] fictional fixture only (hard rule #8); the report prints ${args.texts ? "the proposed texts (--texts)" : "counts, never text"}`,
  );
  const report = await runEval(args, {
    model: adkProposalModel,
    library: loadProposalLibrary({ allowDraft: true }),
    ctx: { project, location },
  });
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

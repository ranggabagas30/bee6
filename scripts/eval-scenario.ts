/**
 * Task R, text rehearsal (R-19 PR-R; docs/tasks/R-19-demo-v2.md section 10.1).
 *
 * Runs the 3-day judge script (`scripts/eval-fixtures/scenario-v2.ts`: exact wording plus four variants) through
 * the real label path used by `scripts/eval-label.ts` (categories loader -> prompt builder -> response schema ->
 * label client, `gemini-3.5-flash-lite`, location from `config/regions.yaml`), then `buildThreads` and the plain
 * code evidence gate (`evaluateGate`, no answer), and checks that:
 *   - the egg-tart card (problem A) lands as CUSTOMER_SERVICE on days 1 and 2 (a fact most of the time),
 *   - the phone-order card (problem B) lands as PHONE_CALL (always a question) on days 2 and 3,
 *   - routine cards never become CUSTOMER_SERVICE or PHONE_CALL (contamination),
 *   - one day never produces more than 5 debrief questions.
 * Each day x variant is run two ways: U1 (all lines in one unit, as when the judge pauses < 90 s) and
 * U2 (one unit per card), 5 times each.
 *
 * Hard rules: Google only (the existing Vertex label client, ADC), demo project only (`bee6-playground`, refused
 * elsewhere), fictional fixture only (#8), no audio, nothing stored, no transcript text printed (the report prints
 * counts and the fixture's own ids only). This is a live diagnostic like `eval:label`; it never touches Firestore.
 * The sanitizer (Sensitive Data Protection) is NOT in the loop: nothing is stored or returned, and the fixture is
 * fictional, so the model sees the same text the tick would after the staff-name scrub.
 *
 * Known blind spots (so nobody reads a PASS as more than it is):
 *   - U2 builds every unit with `open_threads: []`, so it cannot catch problem B continuing day 2's still-open
 *     CUSTOMER_SERVICE thread across a unit boundary. The audio rehearsal (section 10.2) covers that.
 *   - Keeping the `exact` variant equal to `SCRIPT_V2` (lib/demo/script.ts) is not tested here: that test is PR-5's job.
 *
 * Each cell is PASS, FAIL, or INCONCLUSIVE. INCONCLUSIVE means a label call kept failing with a retryable error
 * (429 / 5xx / network) after every attempt: that is quota or infrastructure, not a model result, so the cell is
 * neither a pass nor a failure of the script. A `parse_error` (the model returned invalid output) is a genuine
 * model result and stays a FAIL. Retries follow production: a parse_error gets at most 2 attempts in total
 * (`mapToUnitOutcome`); a retryable error gets up to 4 attempts with 2 / 4 / 8 s backoff plus jitter.
 *
 * Usage:
 *   GOOGLE_CLOUD_PROJECT=bee6-playground npm run eval:scenario
 *   npm run eval:scenario -- --runs 3 --days 2,3 --variants exact,v3 --uniting U2 --concurrency 4
 * `--concurrency N` is the number of label calls in flight at any moment (a semaphore around each unit's call),
 * not the number of runs; runs are all started at once and queue for a call slot. Default 3.
 * Exit codes: 0 all cells pass; 2 any genuine FAIL; 3 inconclusive cells and no genuine FAIL (rerun later);
 * 1 setup/usage error.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateGate } from "@/lib/pipeline/gate";
import { callLabelModel, type LabelClientResult } from "@/lib/pipeline/label/client";
import { loadCategoriesConfig, type CategoriesConfig } from "@/lib/pipeline/label/config";
import { mapToUnitOutcome } from "@/lib/pipeline/label/failure";
import { buildLabelPrompt } from "@/lib/pipeline/label/prompt";
import { buildLabelWireSchema, generateResponseJsonSchema, type LabelWireOutput } from "@/lib/pipeline/label/wire-schema";
import { buildThreads } from "@/lib/pipeline/threads";
import type { LabelUnit } from "@/lib/pipeline/windowing";
import {
  SCENARIO_V2,
  VARIANT_IDS,
  type ScenarioCard,
  type VariantId,
} from "@/scripts/eval-fixtures/scenario-v2";

/** The only project this harness runs against (the demo project; pilot data must never reach it). */
export const DEMO_PROJECT_ID = "bee6-playground";
export const DEFAULT_RUNS = 5;
/** The debrief cap (technical specification; `DEBRIEF_SHOW_MAX`). */
export const QUESTIONS_PER_DAY_MAX = 5;
/**
 * Max label call attempts for a retryable error (a 429 on the shared model quota is common under load). Backoff:
 * 2 s, 4 s, 8 s, each plus up to 25 % jitter. A parse_error is capped by `mapToUnitOutcome` at 2 attempts, as in production.
 */
const LABEL_ATTEMPTS = 4;
const BACKOFF_BASE_MS = 2_000;
const JITTER_FRACTION = 0.25;

export type CellStatus = "PASS" | "FAIL" | "INCONCLUSIVE";
/** Why a unit's label call failed after every attempt. */
export type CallFailure = "retryable_error" | "parse_error";

export type Uniting = "U1" | "U2";
export const UNITINGS: readonly Uniting[] = ["U1", "U2"];
type Day = 1 | 2 | 3;

// ── Units ──────────────────────────────────────────────────────────────────────────────────────────────

export interface UnitPlan {
  unit: LabelUnit;
  /** line_id -> id of the fixture card the line came from. */
  cardOfLine: ReadonlyMap<string, string>;
}

const LINE_SPACING_MS = 5_000;
const CARD_GAP_MS = 20_000;

/** U1: every line of the day in one unit. U2: one unit per card. Pure; the line texts are the fixture's own. */
export function buildUnits(cards: readonly ScenarioCard[], uniting: Uniting, prefix: string): UnitPlan[] {
  const groups: ScenarioCard[][] = uniting === "U1" ? [[...cards]] : cards.map((c) => [c]);
  return groups.map((group, g) => {
    const cardOfLine = new Map<string, string>();
    const lines: LabelUnit["lines"] = [];
    let t = 0;
    for (const c of group) {
      c.lines.forEach((text, k) => {
        const line_id = `${prefix}:${c.id}#${k}`;
        cardOfLine.set(line_id, c.id);
        lines.push({ line_id, seg_id: `${prefix}:${c.id}`, text, start_ms: t, end_ms: t + LINE_SPACING_MS - 1_000 });
        t += LINE_SPACING_MS;
      });
      t += CARD_GAP_MS;
    }
    return { unit: { unit_id: `${prefix}-u${g + 1}`, window_ids: [`w-${prefix}-u${g + 1}`], lines }, cardOfLine };
  });
}

// ── One run ────────────────────────────────────────────────────────────────────────────────────────────

export interface CardOutcome {
  correct: boolean;
  as_fact: boolean;
  /** The category of the thread holding most of the card's lines; null when no line reached a thread. */
  category: string | null;
}

export interface RunOutcome {
  /** null when the day has no problem-A card. */
  a: CardOutcome | null;
  /** null when the day has no problem-B card. */
  b: CardOutcome | null;
  contaminated: boolean;
  /** Question-verdict threads plus one per failed label call (an `unlabelled_unit` question). */
  questions: number;
  failed_calls: number;
  /** Of `failed_calls`, the units that failed with a retryable error (quota / infrastructure): inconclusive, not a model result. */
  retryable_failures: number;
}

interface LineVerdict {
  category: string;
  fact: boolean;
}

/**
 * Pure. Turns the label output of every unit of one run into the run's outcome: `buildThreads`, then the
 * evidence gate per thread with no answer (hard rule #10: the gate is plain code, never the model).
 * `wire === null` is a unit whose label call failed; `failure` says how (absent = a genuine, parse-type failure).
 */
export function classifyRun(
  cards: readonly ScenarioCard[],
  results: ReadonlyArray<{ plan: UnitPlan; wire: LabelWireOutput | null; failure?: CallFailure }>,
): RunOutcome {
  const verdictOfLine = new Map<string, LineVerdict>();
  let questions = 0;
  let failed_calls = 0;
  let retryable_failures = 0;

  for (const { plan, wire, failure } of results) {
    if (wire === null) {
      failed_calls += 1;
      if (failure === "retryable_error") retryable_failures += 1;
      questions += 1;
      continue;
    }
    const built = buildThreads({ unit: plan.unit, label: wire, open_threads: [] });
    for (const thread of built.threads) {
      const gate = evaluateGate({
        category: thread.category,
        confidence: thread.confidence,
        evidence_line_ids: thread.evidence_line_ids,
        label_conflict: thread.label_conflict,
      });
      const fact = gate.verdict === "fact";
      if (!fact) questions += 1;
      for (const id of thread.line_ids) verdictOfLine.set(id, { category: thread.category, fact });
    }
  }

  const linesOfCard = new Map<string, string[]>();
  for (const { plan } of results)
    for (const [lineId, cardId] of plan.cardOfLine) {
      const list = linesOfCard.get(cardId) ?? [];
      list.push(lineId);
      linesOfCard.set(cardId, list);
    }

  /** Category and verdict of the thread holding most of the card's lines (first seen wins a tie). */
  const cardVerdict = (cardId: string): LineVerdict | null => {
    const tally = new Map<string, { count: number; v: LineVerdict }>();
    for (const lineId of linesOfCard.get(cardId) ?? []) {
      const v = verdictOfLine.get(lineId);
      if (!v) continue;
      const key = `${v.category}|${v.fact}`;
      const entry = tally.get(key) ?? { count: 0, v };
      entry.count += 1;
      tally.set(key, entry);
    }
    let best: { count: number; v: LineVerdict } | null = null;
    for (const entry of tally.values()) if (!best || entry.count > best.count) best = entry;
    return best?.v ?? null;
  };

  const problem = (kind: ScenarioCard["kind"], expected: string): CardOutcome | null => {
    const card = cards.find((c) => c.kind === kind);
    if (!card) return null;
    const v = cardVerdict(card.id);
    return { correct: v?.category === expected, as_fact: v?.category === expected && v.fact, category: v?.category ?? null };
  };

  let contaminated = false;
  for (const card of cards) {
    if (card.kind !== "routine") continue;
    for (const lineId of linesOfCard.get(card.id) ?? []) {
      const c = verdictOfLine.get(lineId)?.category;
      if (c === "CUSTOMER_SERVICE" || c === "PHONE_CALL") contaminated = true;
    }
  }

  return {
    a: problem("problem_a", "CUSTOMER_SERVICE"),
    b: problem("problem_b", "PHONE_CALL"),
    contaminated,
    questions,
    failed_calls,
    retryable_failures,
  };
}

// ── One cell (day x variant x uniting, N runs) ─────────────────────────────────────────────────────────

export interface CellSummary {
  runs: number;
  a_applicable: boolean;
  b_applicable: boolean;
  a_correct: number;
  a_fact: number;
  b_correct: number;
  contamination: number;
  /** Runs with at most QUESTIONS_PER_DAY_MAX questions. */
  questions_ok: number;
  max_questions: number;
  failed_calls: number;
  /** Units that failed with a retryable error after every attempt: any makes the cell INCONCLUSIVE. */
  retryable_failures: number;
  /** What the A / B card landed as, counted over runs ("none" = no thread). Category names only. */
  a_categories: Record<string, number>;
  b_categories: Record<string, number>;
}

export function summarizeRuns(outcomes: readonly RunOutcome[]): CellSummary {
  const s: CellSummary = {
    runs: outcomes.length,
    a_applicable: outcomes.some((o) => o.a !== null),
    b_applicable: outcomes.some((o) => o.b !== null),
    a_correct: 0,
    a_fact: 0,
    b_correct: 0,
    contamination: 0,
    questions_ok: 0,
    max_questions: 0,
    failed_calls: 0,
    retryable_failures: 0,
    a_categories: {},
    b_categories: {},
  };
  for (const o of outcomes) {
    if (o.a) {
      if (o.a.correct) s.a_correct += 1;
      if (o.a.as_fact) s.a_fact += 1;
      const k = o.a.category ?? "none";
      s.a_categories[k] = (s.a_categories[k] ?? 0) + 1;
    }
    if (o.b) {
      if (o.b.correct) s.b_correct += 1;
      const k = o.b.category ?? "none";
      s.b_categories[k] = (s.b_categories[k] ?? 0) + 1;
    }
    if (o.contaminated) s.contamination += 1;
    if (o.questions <= QUESTIONS_PER_DAY_MAX) s.questions_ok += 1;
    s.max_questions = Math.max(s.max_questions, o.questions);
    s.failed_calls += o.failed_calls;
    s.retryable_failures += o.retryable_failures;
  }
  return s;
}

/**
 * Acceptance of section 10.1, scaled to the run count N (identical to the plan at N = 5).
 * Exact script: A correct N/N (days 1-2) with A a fact in >= ceil(0.6 N); B correct N/N (days 2-3);
 * contamination 0; questions <= 5 in N/N. Variants: A and B correct >= ceil(0.8 N); contamination <= floor(0.2 N).
 * A cell where any unit failed with a retryable error is INCONCLUSIVE whatever else it shows (the numbers are
 * not trustworthy without that call); otherwise PASS or FAIL by the thresholds.
 */
export function judgeCell(input: {
  variant: VariantId;
  day: Day;
  summary: CellSummary;
}): { status: CellStatus; pass: boolean; failures: string[] } {
  const { variant, day, summary: s } = input;
  const n = s.runs;
  const failures: string[] = [];
  const exact = variant === "exact";
  const need = exact ? n : Math.ceil(0.8 * n);
  if (s.a_applicable && s.a_correct < need) failures.push(`A correct ${s.a_correct}/${n} (need ${need})`);
  if (s.b_applicable && s.b_correct < need) failures.push(`B correct ${s.b_correct}/${n} (need ${need})`);
  if (exact && s.a_applicable && (day === 1 || day === 2)) {
    const needFact = Math.ceil(0.6 * n);
    if (s.a_fact < needFact) failures.push(`A as fact ${s.a_fact}/${n} (need ${needFact})`);
  }
  const maxContam = exact ? 0 : Math.floor(0.2 * n);
  if (s.contamination > maxContam) failures.push(`contamination ${s.contamination}/${n} (max ${maxContam})`);
  if (exact && s.questions_ok < n) failures.push(`questions <= ${QUESTIONS_PER_DAY_MAX} in ${s.questions_ok}/${n} (max seen ${s.max_questions})`);
  const status: CellStatus = s.retryable_failures > 0 ? "INCONCLUSIVE" : failures.length === 0 ? "PASS" : "FAIL";
  return { status, pass: status === "PASS", failures };
}

// ── The matrix ─────────────────────────────────────────────────────────────────────────────────────────

/** One label call. Production: the real Vertex label client. Tests inject a fake. */
export type LabelCall = (input: { unit: LabelUnit; config: CategoriesConfig }) => Promise<LabelClientResult>;

export const realLabelCall: LabelCall = async ({ unit, config }) => {
  const prompt = buildLabelPrompt({ config, unit, open_threads: [] });
  const schema = generateResponseJsonSchema({ config, new_alias_count: unit.lines.length, open_alias_count: 0 });
  const wireSchema = buildLabelWireSchema({ new_alias_count: unit.lines.length, open_alias_count: 0 });
  return callLabelModel({ unit, prompt, schema, wireSchema });
};

export interface ScenarioOptions {
  runs: number;
  config: CategoriesConfig;
  concurrency: number;
  days?: readonly Day[];
  variants?: readonly VariantId[];
  unitings?: readonly Uniting[];
}

export interface CellResult {
  day: Day;
  variant: VariantId;
  uniting: Uniting;
  summary: CellSummary;
  status: CellStatus;
  pass: boolean;
  failures: string[];
}

export interface ScenarioReport {
  runs: number;
  cells: CellResult[];
  /** True only when every cell is PASS. */
  pass: boolean;
  /** Error class (e.g. "http_429", "parse_error") -> number of units that still failed after every attempt. Classes only. */
  call_errors: Record<string, number>;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type LabelOutcome = { wire: LabelWireOutput } | { error_class: string; failure: CallFailure };

/**
 * One unit's label call with retries. `mapToUnitOutcome` (production's own rule) decides retry vs failed, so a
 * parse_error gets at most 2 attempts in total; a retryable error gets up to LABEL_ATTEMPTS with 2/4/8 s backoff
 * plus jitter (`random` is injected so tests are exact).
 */
async function labelWithRetry(
  label: LabelCall,
  unit: LabelUnit,
  config: CategoriesConfig,
  sleep: (ms: number) => Promise<void>,
  random: () => number,
): Promise<LabelOutcome> {
  for (let attempt = 1; ; attempt += 1) {
    const result = await label({ unit, config });
    const outcome = mapToUnitOutcome({ result, attempt, maxAttempts: LABEL_ATTEMPTS });
    if (outcome.kind === "ok") return { wire: outcome.wire };
    if (outcome.kind === "failed") {
      return result.kind === "retryable_error"
        ? { error_class: result.error.class, failure: "retryable_error" }
        : { error_class: "parse_error", failure: "parse_error" };
    }
    const base = BACKOFF_BASE_MS * 2 ** (attempt - 1);
    await sleep(base + Math.floor(base * JITTER_FRACTION * random()));
  }
}

/** FIFO counting semaphore: at most `limit` holders at once. */
function semaphore(limit: number): <T>(work: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = (): void => {
    active -= 1;
    waiting.shift()?.();
  };
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await work();
    } finally {
      release();
    }
  };
}

/** The process exit code: 0 all pass, 2 any genuine FAIL, 3 inconclusive cells and no genuine FAIL. */
export function exitCodeFor(report: ScenarioReport): 0 | 2 | 3 {
  if (report.cells.some((c) => c.status === "FAIL")) return 2;
  if (report.cells.some((c) => c.status === "INCONCLUSIVE")) return 3;
  return 0;
}

export async function runScenario(
  opts: ScenarioOptions,
  deps: { label: LabelCall; sleep?: (ms: number) => Promise<void>; random?: () => number },
): Promise<ScenarioReport> {
  const sleep = deps.sleep ?? realSleep;
  const random = deps.random ?? Math.random;
  const limited = semaphore(Math.max(1, opts.concurrency));
  const call_errors: Record<string, number> = {};
  const days = opts.days ?? [1, 2, 3];
  const variants = opts.variants ?? VARIANT_IDS;
  const unitings = opts.unitings ?? UNITINGS;

  const cells: Array<{ day: Day; variant: VariantId; uniting: Uniting; cards: readonly ScenarioCard[] }> = [];
  for (const d of SCENARIO_V2)
    if (days.includes(d.day))
      for (const variant of variants) for (const uniting of unitings) cells.push({ day: d.day, variant, uniting, cards: d.variants[variant] });

  const tasks = cells.flatMap((cell, c) => Array.from({ length: opts.runs }, (_, r) => ({ cell, c, r })));
  // Every run starts at once; `concurrency` limits the label calls in flight (the semaphore), not the runs.
  const outcomes = await Promise.all(tasks.map(async ({ cell, c, r }) => {
    const plans = buildUnits(cell.cards, cell.uniting, `d${cell.day}-${cell.variant}-${cell.uniting}-r${r}`);
    const results = await Promise.all(
      plans.map(async (plan) => {
        const res = await limited(() => labelWithRetry(deps.label, plan.unit, opts.config, sleep, random));
        if ("error_class" in res) {
          call_errors[res.error_class] = (call_errors[res.error_class] ?? 0) + 1;
          return { plan, wire: null, failure: res.failure };
        }
        return { plan, wire: res.wire };
      }),
    );
    return { c, outcome: classifyRun(cell.cards, results) };
  }));

  const results: CellResult[] = cells.map((cell, c) => {
    const summary = summarizeRuns(outcomes.filter((o) => o.c === c).map((o) => o.outcome));
    const judged = judgeCell({ variant: cell.variant, day: cell.day, summary });
    return { day: cell.day, variant: cell.variant, uniting: cell.uniting, summary, ...judged };
  });
  return { runs: opts.runs, cells: results, pass: results.every((r) => r.status === "PASS"), call_errors };
}

// ── Report ─────────────────────────────────────────────────────────────────────────────────────────────

const dist = (m: Record<string, number>): string =>
  Object.entries(m)
    .sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `${k}x${v}`)
    .join(",");

/** Counts only; names no fixture text (hard rule: no transcript text in output). */
export function formatReport(report: ScenarioReport): string {
  const n = report.runs;
  const rows = report.cells.map((c) => {
    const s = c.summary;
    const cell = (applicable: boolean, v: string) => (applicable ? v : "-");
    return [
      `day ${c.day}`,
      c.variant.padEnd(5),
      c.uniting,
      `A ${cell(s.a_applicable, `${s.a_correct}/${n}`)}`.padEnd(9),
      `Afact ${cell(s.a_applicable, `${s.a_fact}/${n}`)}`.padEnd(11),
      `B ${cell(s.b_applicable, `${s.b_correct}/${n}`)}`.padEnd(9),
      `contam ${s.contamination}/${n}`.padEnd(13),
      `q<=5 ${s.questions_ok}/${n} (max ${s.max_questions})`.padEnd(20),
      `failed calls ${s.failed_calls}`.padEnd(16),
      c.status,
    ].join(" | ");
  });
  const lines = [`[eval:scenario] ${n} run(s) per cell; counts only`, ...rows];
  for (const c of report.cells) {
    if (c.status === "PASS") continue;
    const s = c.summary;
    const detail = [
      ...c.failures,
      s.a_applicable ? `A landed as ${dist(s.a_categories)}` : null,
      s.b_applicable ? `B landed as ${dist(s.b_categories)}` : null,
    ].filter(Boolean);
    lines.push(`  ${c.status} day ${c.day} ${c.variant} ${c.uniting}: ${detail.join("; ")}`);
  }
  if (Object.keys(report.call_errors).length > 0) {
    lines.push(
      `[eval:scenario] WARNING: label calls failed after every attempt (${dist(report.call_errors)}). ` +
        "Cells with a retryable-failed call are INCONCLUSIVE, not a model result: lower --concurrency, wait for quota, and rerun.",
    );
  }
  const code = exitCodeFor(report);
  lines.push(
    code === 0
      ? "[eval:scenario] PASS"
      : code === 2
        ? "[eval:scenario] FAIL (exit 2)"
        : "[eval:scenario] INCONCLUSIVE (exit 3): no genuine failure, but some label calls kept failing; rerun",
  );
  return lines.join("\n");
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────

export interface CliArgs {
  runs: number;
  days: Day[];
  variants: VariantId[];
  unitings: Uniting[];
  concurrency: number;
}

function parseList<T extends string | number>(raw: string | undefined, allowed: readonly T[], flag: string, cast: (s: string) => T): T[] {
  if (!raw) throw new Error(`${flag} needs a value`);
  return raw.split(",").map((part) => {
    const v = cast(part.trim());
    if (!allowed.includes(v)) throw new Error(`${flag}: unknown value "${part}" (allowed: ${allowed.join(", ")})`);
    return v;
  });
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { runs: DEFAULT_RUNS, days: [1, 2, 3], variants: [...VARIANT_IDS], unitings: [...UNITINGS], concurrency: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    const value = argv[i + 1];
    switch (flag) {
      case "--runs":
      case "--concurrency": {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error(`${flag} must be an integer from 1 to 50`);
        if (flag === "--runs") args.runs = n;
        else args.concurrency = n;
        break;
      }
      case "--days":
        args.days = parseList<Day>(value, [1, 2, 3], flag, (s) => Number(s) as Day);
        break;
      case "--variants":
        args.variants = parseList<VariantId>(value, VARIANT_IDS, flag, (s) => s as VariantId);
        break;
      case "--uniting":
        args.unitings = parseList<Uniting>(value, UNITINGS, flag, (s) => s as Uniting);
        break;
      default:
        throw new Error(`unknown argument ${flag}`);
    }
    i += 1;
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
      `eval:scenario runs on the demo project only. Run \`GOOGLE_CLOUD_PROJECT=${DEMO_PROJECT_ID} npm run eval:scenario\`.`,
    );
  }
  const args = parseArgs(process.argv.slice(2));
  const config = loadCategoriesConfig();
  console.log(`[eval:scenario] project=${project} days=${args.days} variants=${args.variants} unitings=${args.unitings} runs=${args.runs}`);
  console.log("[eval:scenario] fictional fixture only (hard rule #8); the report prints counts, never line text");
  const report = await runScenario({ ...args, config }, { label: realLabelCall });
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

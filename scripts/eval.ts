/**
 * Label eval report (R-13, docs/specs/pipeline-and-agents.md T-804).
 *
 *   npm run eval -- --gold <gold CSV file> --source <internal|pilot>
 *
 * Reads ONE local CSV (the gold-set sheet downloaded by hand: that file is the pinned snapshot, named
 * in the report with its SHA-256) and prints a markdown report to stdout: confusion matrix,
 * per-category precision / recall / F1, macro-F1, accuracy, the rush-hour subset and reviewer
 * agreement. No network, no Firestore, no model call: the prediction is the model's stored
 * category, exported earlier by `npm run eval:export`.
 *
 * `--source` is mandatory too (no default) and is printed in the report: `internal` = fictional speech
 * by the team (internal testing / demo outlet), `pilot` = shop episodes labelled by the team.
 *
 * `--gold` is mandatory and has no default path: the data files live outside the repo's tracked tree
 * and this script never guesses where they are. Hard rules: nothing is stored or sent anywhere; the
 * output carries episode aliases only (never a thread or device id, never line text).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CATEGORIES, type Category } from "@/lib/pipeline/categories";
import {
  accuracy,
  cohensKappa,
  confusion,
  inRushHour,
  macroF1,
  parseGoldCsv,
  perCategory,
  type LabelRow,
} from "@/lib/eval/metrics";

export type EvalSource = "internal" | "pilot";
export const EVAL_SOURCES: readonly EvalSource[] = ["internal", "pilot"];

const SOURCE_LINE: Record<EvalSource, string> = {
  internal: "- Source: internal (internal-testing and demo-outlet episodes: fictional speech by the team, not shop data)",
  pilot: "- Source: pilot (shop episodes labelled by the team)",
};

const fmt = (value: number | null): string => (value === null ? "n/a" : value.toFixed(3));

export const DEFINITIONS_MD = `## Definitions

- Episode = one thread. Gold label = the human's category for it (one of the 12 categories, including NON_WORK if a human judges the whole thread private). Prediction = the thread's stored \`category\` (the model's output, never a confirmed category). Rows whose gold cell is empty or SKIP are excluded and counted.
- Confusion matrix: rows = gold, columns = predicted, over every category that appears in either.
- Per category: precision = TP / (TP + FP), recall = TP / (TP + FN), F1 = harmonic mean; a 0/0 is printed as n/a, never 0. Support = number of gold rows of that category.
- Macro-F1 = mean F1 over categories with support >= 1 (categories absent from the gold set are listed, not averaged). Accuracy is printed too.
- Rush-hour subset: the same metrics for episodes whose first line starts 11:00-13:59 or 17:00-19:59 outlet-local.
- Agreement: on episodes labelled by both reviewers (gold_2 filled), Cohen's kappa and raw agreement; every other metric uses gold (reviewer 1) only.
- Sample sizes are printed at the top of every section. No confidence intervals: with a small n and many categories they would mostly say "wide".`;

function metricsSection(rows: readonly LabelRow[]): string[] {
  if (rows.length === 0) return ["No episodes in this subset.", ""];
  const per = perCategory(rows);
  const scored = per.filter((p) => p.support >= 1).length;
  const absent = CATEGORIES.filter((c) => !per.some((p) => p.category === c && p.support >= 1));
  const out: string[] = [
    `- Accuracy: ${fmt(accuracy(rows))}`,
    `- Macro-F1: ${fmt(macroF1(per))} (mean over ${scored} categor${scored === 1 ? "y" : "ies"} with support >= 1)`,
    "",
    "| Category | Support | Precision | Recall | F1 |",
    "|---|---|---|---|---|",
    ...per.map(
      (p) => `| ${p.category} | ${p.support} | ${fmt(p.precision)} | ${fmt(p.recall)} | ${p.support >= 1 ? fmt(p.f1) : "n/a"} |`,
    ),
    "",
    `Categories absent from the gold set (listed, not averaged): ${absent.length > 0 ? absent.join(", ") : "none"}`,
    "",
    "Confusion matrix (rows = gold, columns = predicted):",
    "",
  ];
  const { labels, matrix } = confusion(rows);
  out.push(`| gold \\ predicted | ${labels.join(" | ")} |`);
  out.push(`|---|${labels.map(() => "---").join("|")}|`);
  labels.forEach((label, i) => out.push(`| ${label} | ${(matrix[i] as number[]).join(" | ")} |`));
  out.push("");
  return out;
}

export interface ReportResult {
  /** Empty when `errors` is non-empty. */
  markdown: string;
  errors: string[];
}

/** Builds the markdown report from the snapshot bytes. Deterministic except for the run date line. */
export function buildReport(snapshot: Buffer, fileName: string, runDate: string, source: EvalSource): ReportResult {
  const { rows, skipped, errors } = parseGoldCsv(snapshot.toString("utf8"));
  if (errors.length > 0) return { markdown: "", errors };
  if (rows.length === 0) return { markdown: "", errors: ["No labelled rows: every gold cell is empty or SKIP"] };

  const sha = createHash("sha256").update(snapshot).digest("hex");
  const rush = rows.filter((r) => inRushHour(r.start_hm));
  const pairs = rows.flatMap((r) => (r.gold_2 === null ? [] : [[r.gold, r.gold_2] as [Category, Category]]));
  const kappa = cohensKappa(pairs);
  const rawAgreement = pairs.length === 0 ? null : pairs.filter(([a, b]) => a === b).length / pairs.length;

  const md: string[] = [
    "# Label eval (R-13)",
    "",
    `- Snapshot: ${fileName}`,
    `- SHA-256: ${sha}`,
    `- Run date: ${runDate}`,
    `- Episodes used: n = ${rows.length}; skipped (no gold): ${skipped}`,
    SOURCE_LINE[source],
    "",
    `## All episodes (n = ${rows.length})`,
    "",
    ...metricsSection(rows),
    `## Rush-hour subset (n = ${rush.length})`,
    "",
    ...metricsSection(rush),
    "## Agreement between reviewers",
    "",
    ...(pairs.length === 0
      ? ["Agreement: not measured (n = 0)", ""]
      : [
          `- Pairs: n = ${pairs.length}`,
          `- Cohen's kappa: ${fmt(kappa)}`,
          `- Raw agreement: ${fmt(rawAgreement)}`,
          "",
        ]),
    DEFINITIONS_MD,
    "",
  ];
  return { markdown: md.join("\n"), errors: [] };
}

export interface CliArgs {
  goldPath: string;
  source: EvalSource;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const usage = "Usage: npm run eval -- --gold <gold CSV file> --source <internal|pilot>";
  const valueOf = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    const value = i === -1 ? undefined : argv[i + 1];
    return !value || value.startsWith("--") ? undefined : value;
  };
  const gold = valueOf("--gold");
  if (!gold) throw new Error(`--gold is required (there is no default file). ${usage}`);
  const source = valueOf("--source");
  if (!source) throw new Error(`--source is required: internal or pilot (there is no default). ${usage}`);
  if (!(EVAL_SOURCES as readonly string[]).includes(source)) {
    throw new Error(`--source must be internal or pilot, got "${source}". ${usage}`);
  }
  return { goldPath: path.resolve(gold), source: source as EvalSource };
}

function main(): void {
  const { goldPath, source } = parseCliArgs(process.argv.slice(2));
  const snapshot = readFileSync(goldPath);
  const runDate = new Date().toISOString().slice(0, 10);
  const { markdown, errors } = buildReport(snapshot, path.basename(goldPath), runDate, source);
  if (errors.length > 0) {
    for (const error of errors) console.error(`[eval] ${error}`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(markdown);
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  try {
    main();
  } catch (error) {
    console.error("[eval] failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  }
}

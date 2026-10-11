import { CATEGORIES, CategorySchema, type Category } from "@/lib/pipeline/categories";
import { parseCsv } from "@/lib/eval/csv";

/**
 * R-13 eval metrics: pure code, no I/O (hard rule #10: metrics are plain code, not AI).
 * Definitions are fixed in docs/tasks/R-13.md section 1 and printed by the report.
 */

export interface LabelRow {
  /** Alias like `E0001`; never a thread or device id. */
  episode: string;
  /** Outlet-local "HH:MM" of the episode's first line. */
  start_hm: string;
  /** The model's stored category (never the confirmed one). */
  model_category: Category;
  /** Reviewer 1's category: the one every metric uses. */
  gold: Category;
  /** Reviewer 2's category, only on the episodes both reviewers labelled. */
  gold_2: Category | null;
}

export const GOLD_CSV_COLUMNS = [
  "episode",
  "local_date",
  "start_hm",
  "lines",
  "model_category",
  "gold",
  "gold_2",
  "notes",
] as const;

const REQUIRED_COLUMNS = ["episode", "start_hm", "model_category", "gold", "gold_2"] as const;
/** H:MM, HH:MM or HH:MM:SS: Google Sheets turns "09:05" into a time value and may download "9:05" or "9:05:00". */
const HM_RE = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

/** Normalises a start time to zero-padded "HH:MM" (seconds dropped), or null when it is not a valid time of day. */
export function normalizeHm(value: string): string | null {
  const m = HM_RE.exec(value.trim());
  return m ? `${(m[1] as string).padStart(2, "0")}:${m[2] as string}` : null;
}

export const RUSH_WINDOWS: readonly (readonly [string, string])[] = [
  ["11:00", "13:59"],
  ["17:00", "19:59"],
];

/** Reads the gold-set CSV (Task 1's header). Never throws: problems come back in `errors`. */
export function parseGoldCsv(text: string): { rows: LabelRow[]; skipped: number; errors: string[] } {
  const rows: LabelRow[] = [];
  const errors: string[] = [];
  let skipped = 0;

  let table: string[][];
  try {
    table = parseCsv(text);
  } catch (error) {
    return { rows, skipped, errors: [`CSV could not be read: ${error instanceof Error ? error.message : "unknown"}`] };
  }
  const header = table[0];
  if (!header) return { rows, skipped, errors: ["CSV is empty: expected a header row"] };

  const index = new Map(header.map((name, i) => [name.trim(), i]));
  const missing = REQUIRED_COLUMNS.filter((c) => !index.has(c));
  if (missing.length > 0) {
    return { rows, skipped, errors: [`CSV header is missing column(s): ${missing.join(", ")}`] };
  }
  const cell = (r: string[], name: string): string => (r[index.get(name) as number] ?? "").trim();

  const seen = new Set<string>();
  for (const [offset, r] of table.slice(1).entries()) {
    const episode = cell(r, "episode");
    const label = episode || `(row ${offset + 2})`;
    if (!episode) {
      errors.push(`${label}: episode alias is empty`);
      continue;
    }
    if (seen.has(episode)) {
      errors.push(`${episode}: duplicate episode alias`);
      continue;
    }
    seen.add(episode);

    const goldCell = cell(r, "gold");
    if (goldCell === "" || goldCell.toUpperCase() === "SKIP") {
      skipped++;
      continue;
    }

    const startHm = normalizeHm(cell(r, "start_hm"));
    if (startHm === null) {
      errors.push(`${episode}: start_hm "${cell(r, "start_hm")}" is not H:MM, HH:MM or HH:MM:SS`);
      continue;
    }

    const gold = CategorySchema.safeParse(goldCell.toUpperCase());
    if (!gold.success) {
      errors.push(`${episode}: unknown gold category "${goldCell}"`);
      continue;
    }
    const model = CategorySchema.safeParse(cell(r, "model_category").toUpperCase());
    if (!model.success) {
      errors.push(`${episode}: unknown model_category "${cell(r, "model_category")}"`);
      continue;
    }
    const gold2Cell = cell(r, "gold_2");
    let gold2: Category | null = null;
    if (gold2Cell !== "" && gold2Cell.toUpperCase() !== "SKIP") {
      const parsed = CategorySchema.safeParse(gold2Cell.toUpperCase());
      if (!parsed.success) {
        errors.push(`${episode}: unknown gold_2 category "${gold2Cell}"`);
        continue;
      }
      gold2 = parsed.data;
    }
    rows.push({ episode, start_hm: startHm, model_category: model.data, gold: gold.data, gold_2: gold2 });
  }
  return { rows, skipped, errors };
}

/** Categories present as gold or prediction, in canonical order. */
function labelsOf(rows: readonly LabelRow[]): Category[] {
  const present = new Set<Category>();
  for (const r of rows) {
    present.add(r.gold);
    present.add(r.model_category);
  }
  return CATEGORIES.filter((c) => present.has(c));
}

/** Rows = gold, columns = predicted. */
export function confusion(rows: readonly LabelRow[]): { labels: Category[]; matrix: number[][] } {
  const labels = labelsOf(rows);
  const at = new Map(labels.map((c, i) => [c, i]));
  const matrix = labels.map(() => labels.map(() => 0));
  for (const r of rows) {
    (matrix[at.get(r.gold) as number] as number[])[at.get(r.model_category) as number]! += 1;
  }
  return { labels, matrix };
}

export interface CategoryMetrics {
  category: Category;
  support: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

/** Precision/recall/F1 per category; a 0/0 is `null` (printed n/a), never 0. */
export function perCategory(rows: readonly LabelRow[]): CategoryMetrics[] {
  return labelsOf(rows).map((category) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const r of rows) {
      const isGold = r.gold === category;
      const isPred = r.model_category === category;
      if (isGold && isPred) tp++;
      else if (isPred) fp++;
      else if (isGold) fn++;
    }
    const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);
    return {
      category,
      support: tp + fn,
      precision: ratio(tp, tp + fp),
      recall: ratio(tp, tp + fn),
      // 2TP / (2TP + FP + FN) is the harmonic mean of P and R, and is defined whenever either is.
      f1: ratio(2 * tp, 2 * tp + fp + fn),
    };
  });
}

/** Mean F1 over categories with support >= 1. */
export function macroF1(per: readonly CategoryMetrics[]): number | null {
  const scored = per.filter((p) => p.support >= 1 && p.f1 !== null);
  if (scored.length === 0) return null;
  return scored.reduce((sum, p) => sum + (p.f1 as number), 0) / scored.length;
}

export function accuracy(rows: readonly LabelRow[]): number | null {
  if (rows.length === 0) return null;
  return rows.filter((r) => r.gold === r.model_category).length / rows.length;
}

/** True when "HH:MM" falls inside any inclusive window. Zero-padded HH:MM compares correctly as text. */
export function inRushHour(
  start_hm: string,
  windows: readonly (readonly [string, string])[] = RUSH_WINDOWS,
): boolean {
  return windows.some(([from, to]) => start_hm >= from && start_hm <= to);
}

/** Cohen's kappa over (reviewer 1, reviewer 2) pairs; null when undefined (no pairs, or chance agreement is 1). */
export function cohensKappa(pairs: readonly (readonly [Category, Category])[]): number | null {
  const n = pairs.length;
  if (n === 0) return null;
  const countA = new Map<Category, number>();
  const countB = new Map<Category, number>();
  let agree = 0;
  for (const [a, b] of pairs) {
    if (a === b) agree++;
    countA.set(a, (countA.get(a) ?? 0) + 1);
    countB.set(b, (countB.get(b) ?? 0) + 1);
  }
  const po = agree / n;
  let pe = 0;
  for (const [category, ca] of countA) pe += (ca / n) * ((countB.get(category) ?? 0) / n);
  if (pe >= 1) return null;
  return (po - pe) / (1 - pe);
}

/**
 * The exact WER normalisation rule, printed verbatim in the transcribe report's method line.
 * Order matters: NFKC, lower-case, drop apostrophes, join digit groups, then split on the rest.
 */
export const WER_NORMALIZATION_RULE =
  "Normalisation: Unicode NFKC, then lower-case; apostrophes (' and \u2019) are removed; a '.' or ',' that sits between two digits is removed (so 1.5 becomes 15 and Rp 15.000 equals Rp 15000); every other character that is not a letter, digit, combining mark or space becomes a space (so e-mail is two words, e and mail, while email is one); whitespace is collapsed.";

/** Word list used by WER; see {@link WER_NORMALIZATION_RULE} for the rule. */
export function normalizeForWer(text: string): string[] {
  const cleaned = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/(?<=\p{Nd})[.,](?=\p{Nd})/gu, "")
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ");
  return cleaned.split(/\s+/).filter((w) => w.length > 0);
}

/** Word-level Levenshtein edits (S + D + I) over the reference word count N. */
export function wer(reference: string, hypothesis: string): { edits: number; words: number } {
  const ref = normalizeForWer(reference);
  const hyp = normalizeForWer(hypothesis);
  let prev = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const cur = [i];
    for (let j = 1; j <= hyp.length; j++) {
      const sub = (prev[j - 1] as number) + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
      cur[j] = Math.min(sub, (prev[j] as number) + 1, (cur[j - 1] as number) + 1);
    }
    prev = cur;
  }
  return { edits: prev[hyp.length] as number, words: ref.length };
}

/** Nearest-rank percentile (p in (0, 100]); null on an empty set. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] as number;
}

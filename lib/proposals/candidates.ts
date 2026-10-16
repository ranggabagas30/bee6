import { attributedBusinessDate, type AttributionSession } from "@/lib/day/attribution";
import { localHmOf } from "@/lib/capture/calendar";
import type { Category, WorkCategory } from "@/lib/pipeline/categories";
import { EVIDENCE_EXCLUDED, FACT_EXCERPT_MAX_CHARS, MAX_CANDIDATES_IN_PROMPT } from "@/lib/proposals/constants";

/** The store's field-masked read of one thread for the generate range. */
export interface ProposalThreadRow {
  outlet_id: string;
  thread_id: string;
  device_id: string;
  category: Category;
  confirmed_category?: Category;
  status: "fact" | "open" | "unverified";
  excluded_from_evidence?: boolean;
  label_source?: string; // string on purpose: R-06 PR-5 adds values
  /** R-24: the label call's confidence; optional so older rows and fixtures stay valid. */
  confidence?: number;
  /** R-24: only the gate verdict and the rule that fired (never the checks, a question id or the category). */
  gate?: { verdict: "fact" | "question"; fired_rule: string };
  first_line_start_ms: number;
  summary: string;
  fields?: Record<string, unknown>;
  /** R-20: the thread's own work lines (already staff-name scrubbed and SDP-redacted at write time). */
  lines?: Array<{ text: string }>;
}

/**
 * One evidence candidate: no device id, no raw text, no audio. `excerpt` is only the thread's already
 * scrubbed and redacted work lines, flattened to one line (`excerptOf`), NOT capped here: the prompt caps it after the staff-name scrub; `""` when there is none.
 */
export interface Candidate {
  thread_id: string;
  local_date: string;
  start_hm: string;
  category: WorkCategory; // effective (confirmed_category ?? category)
  first_line_start_ms: number;
  summary: string;
  fields?: Record<string, unknown>;
  excerpt: string;
}

/**
 * R-20: flattens text for a prompt quote: whitespace (newlines included) collapsed to single spaces, trimmed,
 * double quotes replaced by single quotes, capped at `max` code points with a trailing "…" (total = max).
 * One physical line, so quoted text can never open a new prompt row or header.
 */
export function clampQuote(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim().replace(/"/g, "'");
  const points = Array.from(flat);
  if (points.length <= max) return flat;
  return `${points.slice(0, max - 1).join("")}\u2026`;
}

/**
 * R-20: the quote the Proposal agent gets for one thread: its non-blank lines joined with " / " (a blank line is
 * a NON_WORK line the tick blanked), then `clampQuote`d. `undefined` / no usable line gives `""`.
 */
export function excerptOf(lines: readonly { text: string }[] | undefined, max = FACT_EXCERPT_MAX_CHARS): string {
  if (!lines) return "";
  const parts = lines.map((l) => l.text.replace(/\s+/g, " ").trim()).filter((t) => t.length > 0);
  return clampQuote(parts.join(" / "), max);
}

/**
 * Keeps a row only if ALL hold: `status === "fact"`;
 * `excluded_from_evidence !== true`; `label_source !== "supervisor_rejected"`;
 * the effective category (`confirmed_category ?? category`) is neither
 * "NON_WORK" nor in `EVIDENCE_EXCLUDED` (ROUTINE_OPS, R-19 D-3); and its
 * attributed business date is non-null and within
 * `range`. Sorted by `first_line_start_ms`, then `thread_id`. Returns ALL
 * kept rows, uncapped — the floor and the baseline need the true count,
 * only the prompt is capped (`aliasCandidates`).
 */
export function selectCandidates(
  rows: readonly ProposalThreadRow[],
  sessions: readonly AttributionSession[],
  tz: string,
  range: { from_date: string; to_date: string },
): Candidate[] {
  const kept: Candidate[] = [];
  for (const row of rows) {
    if (row.status !== "fact") continue;
    if (row.excluded_from_evidence === true) continue;
    if (row.label_source === "supervisor_rejected") continue;
    const effective = (row.confirmed_category ?? row.category) as WorkCategory | "NON_WORK";
    if (effective === "NON_WORK") continue;
    if (EVIDENCE_EXCLUDED.has(effective)) continue; // R-19 D-3: ROUTINE_OPS is never proposal evidence
    const localDate = attributedBusinessDate(row.first_line_start_ms, sessions, tz, row.device_id);
    if (localDate === null) continue;
    if (localDate < range.from_date || localDate > range.to_date) continue;
    kept.push({
      thread_id: row.thread_id,
      local_date: localDate,
      start_hm: localHmOf(row.first_line_start_ms, tz),
      category: effective,
      first_line_start_ms: row.first_line_start_ms,
      summary: row.summary,
      fields: row.fields,
      // Uncapped on purpose (hard rule 7): the service scrubs staff names first, `factLines` caps after, so a
      // name straddling the cap can never leave a fragment in the prompt.
      excerpt: excerptOf(row.lines, Number.MAX_SAFE_INTEGER),
    });
  }
  return kept.sort((a, b) => {
    if (a.first_line_start_ms !== b.first_line_start_ms) {
      return a.first_line_start_ms - b.first_line_start_ms;
    }
    return a.thread_id < b.thread_id ? -1 : a.thread_id > b.thread_id ? 1 : 0;
  });
}

/** The last `MAX_CANDIDATES_IN_PROMPT` of the (already sorted) list, aliased E1..En oldest-first. */
export function aliasCandidates(all: readonly Candidate[]): { alias: string; c: Candidate }[] {
  const kept = all.length > MAX_CANDIDATES_IN_PROMPT ? all.slice(all.length - MAX_CANDIDATES_IN_PROMPT) : all;
  return kept.map((c, i) => ({ alias: `E${i + 1}`, c }));
}

import { attributedBusinessDate, type AttributionSession } from "@/lib/day/attribution";
import { localHmOf } from "@/lib/capture/calendar";
import type { Category, WorkCategory } from "@/lib/pipeline/categories";
import { MAX_CANDIDATES_IN_PROMPT } from "@/lib/proposals/constants";

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
  first_line_start_ms: number;
  summary: string;
  fields?: Record<string, unknown>;
}

/** One evidence candidate: no device id, no raw text, no line text. */
export interface Candidate {
  thread_id: string;
  local_date: string;
  start_hm: string;
  category: WorkCategory; // effective (confirmed_category ?? category)
  first_line_start_ms: number;
  summary: string;
  fields?: Record<string, unknown>;
}

/**
 * Keeps a row only if ALL hold: `status === "fact"`;
 * `excluded_from_evidence !== true`; `label_source !== "supervisor_rejected"`;
 * the effective category (`confirmed_category ?? category`) is not
 * "NON_WORK"; and its attributed business date is non-null and within
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

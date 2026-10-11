import { localDateOf, localHmOf } from "@/lib/capture/calendar";
import { toCsv } from "@/lib/eval/csv";
import type { Category } from "@/lib/pipeline/categories";

/**
 * R-13 episode export, pure part: turns stored threads into the two CSV files the gold-set
 * labelling needs. No I/O and no database access here.
 *
 *  - The episodes file carries an alias (`E0001...`), the outlet-local date and time, the stored
 *    (already redacted) line text, and the model's stored `category`. It never carries a thread id
 *    or a device id (hard rule #7); the gold, gold_2 and notes columns start empty.
 *  - The map file links alias to thread id. It is for auditing only and stays on the exporter's
 *    machine; the eval never reads it.
 */

export interface ExportThread {
  thread_id: string;
  /** The model's stored category (never the confirmed one). */
  category: Category;
  first_line_start_ms: number;
  lines: { start_ms: number; text: string }[];
}

export const EPISODE_COLUMNS = [
  "episode",
  "local_date",
  "start_hm",
  "lines",
  "model_category",
  "gold",
  "gold_2",
  "notes",
] as const;

/** A leading = + - @ would be run as a formula when the CSV is imported into a spreadsheet. */
function sheetSafe(text: string): string {
  const flat = text.replace(/\s*[\r\n]+\s*/g, " ").trim();
  return /^[=+\-@]/.test(flat) ? `'${flat}` : flat;
}

export function buildEpisodeExport(
  threads: readonly ExportThread[],
  tz: string,
): { episodesCsv: string; mapCsv: string; count: number } {
  const ordered = [...threads].sort(
    (a, b) => a.first_line_start_ms - b.first_line_start_ms || a.thread_id.localeCompare(b.thread_id),
  );
  const episodes: string[][] = [[...EPISODE_COLUMNS]];
  const map: string[][] = [["episode", "thread_id"]];
  ordered.forEach((t, i) => {
    const alias = `E${String(i + 1).padStart(4, "0")}`;
    const text = [...t.lines]
      .sort((a, b) => a.start_ms - b.start_ms)
      .map((l) => l.text)
      .join(" / ");
    episodes.push([
      alias,
      localDateOf(t.first_line_start_ms, tz),
      localHmOf(t.first_line_start_ms, tz),
      sheetSafe(text),
      t.category,
      "",
      "",
      "",
    ]);
    map.push([alias, t.thread_id]);
  });
  return { episodesCsv: toCsv(episodes), mapCsv: toCsv(map), count: ordered.length };
}

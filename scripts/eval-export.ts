/**
 * Episode export for the gold set (R-13, docs/specs/pipeline-and-agents.md T-802).
 *
 *   npm run eval:export -- --project <id> --outlet <id> --from YYYY-MM-DD --to YYYY-MM-DD \
 *     --out-dir <directory outside version control>
 *
 * READ-ONLY: one Firestore query on `threads` (outlet + first-line time range, field mask only),
 * then two CSV files written to `--out-dir`. `--out-dir` is mandatory (no default): the script never
 * guesses where eval data lives, and the data files must never be committed.
 *
 *   episodes-<outlet>-<from>-<to>.csv      alias, local date and time, redacted line text, the
 *                                          model's stored category; gold, gold_2, notes empty.
 *                                          No thread id and no device id.
 *   episodes-<outlet>-<from>-<to>-map.csv  alias -> thread id, kept private, for auditing only.
 *
 * Tiffany imports the first file into the gold-set sheet, fills `gold` (and `gold_2` on at least 10
 * rows), then downloads the sheet back as CSV; `npm run eval -- --gold <that file>` reads it.
 *
 * Refuses: the pilot project (unless --allow-pilot), outlet ids starting `sbx-` (judge sandboxes),
 * and overwriting an existing file. Prints counts only, never line text.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addDays, zonedTimeToEpochMs } from "@/lib/capture/calendar";
import { buildEpisodeExport, type ExportThread } from "@/lib/eval/export";
import { PILOT_PROJECT_ID } from "@/scripts/demo-seed-template";

const DEFAULT_TZ = "Asia/Jakarta";
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True only for a real calendar date (rejects 2026-02-30, 2026-13-45, 2026-10-00). */
function isRealDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d;
}

export class ExportError extends Error {}

export interface ExportArgs {
  project: string;
  outlet: string;
  from: string;
  to: string;
  outDir: string;
  allowPilot: boolean;
  tz: string;
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  const value = i === -1 ? undefined : argv[i + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}

export function parseCliArgs(argv: string[]): ExportArgs {
  const usage =
    "Usage: npm run eval:export -- --project <id> --outlet <id> --from YYYY-MM-DD --to YYYY-MM-DD --out-dir <directory> [--allow-pilot] [--tz <IANA zone>]";
  const need = (flag: string): string => {
    const v = argValue(argv, flag);
    if (!v) throw new ExportError(`${flag} is required${flag === "--out-dir" ? " (there is no default directory)" : ""}. ${usage}`);
    return v;
  };
  const project = need("--project");
  const outlet = need("--outlet");
  const from = need("--from");
  const to = need("--to");
  const outDir = path.resolve(need("--out-dir"));
  if (!isRealDate(from)) throw new ExportError(`--from must be YYYY-MM-DD. ${usage}`);
  if (!isRealDate(to)) throw new ExportError(`--to must be YYYY-MM-DD. ${usage}`);
  if (to < from) throw new ExportError("--to must not be before --from.");
  const allowPilot = argv.includes("--allow-pilot");
  if (project === PILOT_PROJECT_ID && !allowPilot) {
    throw new ExportError("Refusing to read the PILOT project without --allow-pilot.");
  }
  if (outlet.startsWith("sbx-")) throw new ExportError("Refusing a judge sandbox outlet (sbx-*).");
  return { project, outlet, from, to, outDir, allowPilot, tz: argValue(argv, "--tz") ?? DEFAULT_TZ };
}

export interface ExportDeps {
  fetchThreads(outlet: string, fromMs: number, toMs: number): Promise<{ threads: ExportThread[]; malformed: number }>;
  exists(file: string): boolean;
  makeDir(dir: string): Promise<void>;
  /** Must fail if the file already exists. */
  writeNew(file: string, text: string): Promise<void>;
  log(line: string): void;
}

export async function runExport(args: ExportArgs, deps: ExportDeps): Promise<void> {
  const stem = `episodes-${args.outlet}-${args.from}-${args.to}`;
  const episodesFile = path.join(args.outDir, `${stem}.csv`);
  const mapFile = path.join(args.outDir, `${stem}-map.csv`);
  for (const file of [episodesFile, mapFile]) {
    if (deps.exists(file)) throw new ExportError(`Refusing to overwrite an existing file: ${path.basename(file)}`);
  }

  const fromMs = zonedTimeToEpochMs(args.from, "00:00", args.tz);
  const toMs = zonedTimeToEpochMs(addDays(args.to, 1), "00:00", args.tz);
  const { threads, malformed } = await deps.fetchThreads(args.outlet, fromMs, toMs);
  const built = buildEpisodeExport(threads, args.tz);

  if (built.count === 0) {
    deps.log(`0 episodes found for outlet ${args.outlet} between ${args.from} and ${args.to}; nothing written. Malformed documents skipped: ${malformed}.`);
    return;
  }
  await deps.makeDir(args.outDir);
  await deps.writeNew(episodesFile, built.episodesCsv);
  await deps.writeNew(mapFile, built.mapCsv);
  deps.log(`${built.count} episodes written (outlet ${args.outlet}, ${args.from} to ${args.to}). Malformed documents skipped: ${malformed}.`);
  deps.log(`Files: ${path.basename(episodesFile)} and ${path.basename(mapFile)} in the chosen directory. The map file stays private.`);
}

/** The real, read-only Firestore fetch (Admin SDK, `.get()` only, field mask). */
async function fetchThreadsFromFirestore(outlet: string, fromMs: number, toMs: number) {
  const { adminDb } = await import("@/lib/firebase/admin");
  const { COLLECTIONS } = await import("@/lib/firestore/collections");
  const { ThreadSchema } = await import("@/lib/firestore/schema");
  const Projection = ThreadSchema.pick({ thread_id: true, category: true, first_line_start_ms: true, lines: true });
  const snap = await adminDb()
    .collection(COLLECTIONS.threads)
    .where("outlet_id", "==", outlet)
    .where("first_line_start_ms", ">=", fromMs)
    .where("first_line_start_ms", "<", toMs)
    .orderBy("first_line_start_ms")
    .select("thread_id", "category", "first_line_start_ms", "lines")
    .get();
  const threads: ExportThread[] = [];
  let malformed = 0;
  for (const doc of snap.docs) {
    const parsed = Projection.safeParse(doc.data());
    if (!parsed.success) {
      malformed++;
      continue;
    }
    threads.push({
      thread_id: parsed.data.thread_id,
      category: parsed.data.category,
      first_line_start_ms: parsed.data.first_line_start_ms,
      lines: parsed.data.lines.map((l) => ({ start_ms: l.start_ms, text: l.text })),
    });
  }
  return { threads, malformed };
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const envProject = process.env.GOOGLE_CLOUD_PROJECT;
  if (envProject && envProject !== args.project) {
    throw new ExportError("GOOGLE_CLOUD_PROJECT is set to a different project than --project; refusing.");
  }
  process.env.GOOGLE_CLOUD_PROJECT = args.project;
  await runExport(args, {
    fetchThreads: fetchThreadsFromFirestore,
    exists: existsSync,
    makeDir: async (dir) => {
      await mkdir(dir, { recursive: true });
    },
    writeNew: (file, text) => writeFile(file, text, { encoding: "utf8", flag: "wx" }),
    log: (line) => console.log(line),
  });
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error) => {
    console.error("[eval:export] failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  });
}

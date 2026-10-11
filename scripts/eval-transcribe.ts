/**
 * Transcribe quality eval (R-13, docs/specs/pipeline-and-agents.md T-207).
 *
 *   GOOGLE_CLOUD_PROJECT=bee6-playground npm run eval:transcribe -- --clips <clips directory> --refs <refs CSV>
 *
 * `refs` columns: `clip,reference` plus an optional `duration_ms` (the clip length, used for total
 * speech minutes and the list-price estimate; the transcriber does not report audio length).
 * `reference` is the human transcript of FICTIONAL speech. Each clip is one WebM/Opus segment of at
 * most 15 s, the same format the phone uploads; longer clips are skipped (the script never cuts
 * audio). Both paths are mandatory flags with no default: this script never guesses where audio or
 * transcripts live, and those files must never be committed.
 *
 * It calls `geminiTranscriber()` (the segment route's own transcriber, same vocabulary loading, model
 * location from config/regions.yaml) once per clip and times the call. Hard rules: audio is read from
 * local disk and goes only into the in-memory model request (#2); the hypothesis text is compared and
 * dropped and is never written or printed; the model call uses the paid demo project's service
 * account (#4) and the script refuses the pilot project.
 */
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateClips, parseRefsCsv, renderTranscribeReport } from "@/lib/eval/transcribe-eval";
import { assertNotPilotProject } from "@/scripts/demo-seed-template";

export interface CliArgs {
  clipsDir: string;
  refsPath: string;
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  const value = i === -1 ? undefined : argv[i + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const usage = "Usage: npm run eval:transcribe -- --clips <clips directory> --refs <refs CSV>";
  const clips = argValue(argv, "--clips");
  if (!clips) throw new Error(`--clips is required (there is no default directory). ${usage}`);
  const refs = argValue(argv, "--refs");
  if (!refs) throw new Error(`--refs is required (there is no default file). ${usage}`);
  return { clipsDir: path.resolve(clips), refsPath: path.resolve(refs) };
}

/** Requires a project to be set and refuses the pilot project (env and credentials). */
export function assertDemoProject(
  env: Record<string, string | undefined>,
  readJson?: (file: string) => Record<string, unknown> | null,
): void {
  if (!env.GOOGLE_CLOUD_PROJECT) {
    throw new Error("GOOGLE_CLOUD_PROJECT is not set. Run against the demo project (for example bee6-playground).");
  }
  try {
    assertNotPilotProject(env, readJson);
  } catch {
    throw new Error("Refusing to run: the Google Cloud project (or its credentials) is the PILOT project. Use the demo project.");
  }
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
  const { clipsDir, refsPath } = parseCliArgs(process.argv.slice(2));
  loadEnvLocal();
  assertDemoProject(process.env);

  const { refs, errors } = parseRefsCsv(await readFile(refsPath, "utf8"));
  if (errors.length > 0) {
    for (const error of errors) console.error(`[eval:transcribe] ${error}`);
    process.exitCode = 1;
    return;
  }
  if (refs.length === 0) {
    console.error("[eval:transcribe] the refs file lists no clips");
    process.exitCode = 1;
    return;
  }

  const { geminiTranscriber } = await import("@/lib/transcribe/gemini");
  const { results } = await evaluateClips({
    refs,
    readClip: (clip) => readFile(path.join(clipsDir, clip)),
    transcriber: geminiTranscriber(),
    now: () => performance.now(),
  });
  process.stdout.write(renderTranscribeReport(results, new Date().toISOString().slice(0, 10)));
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error) => {
    // A fixed prefix and the message of our own guard errors only; never a clip, a path to one or any text.
    console.error("[eval:transcribe] failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  });
}

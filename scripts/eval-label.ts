/**
 * Trap eval (R-05b, Task 7): runs a fictional transcript through the real
 * label pipeline (categories loader -> prompt builder -> response schema
 * -> label client) 5 times and checks whether the hypothetical "if we
 * ever run out" line labels TRAINING every time — the scenario where a
 * what-if discussion risks getting conflated with a real, live event
 * later in the same conversation (`scripts/eval-label-fixtures.ts`).
 *
 * Decision 1 (docs/tasks/R-05b.md): nothing here depends on Tiffany's real
 * examples — this fixture is a fictional stand-in written now, so this can
 * run today against the real GCP project for an early signal. This run is
 * INFORMATIONAL ONLY; the formal "Done when" evidence is Sunday 4 Oct's
 * re-run after Tiffany's real (fictional-paraphrase) examples are dropped
 * into `config/categories.yaml`.
 *
 * This is a live diagnostic (like `scripts/eval-redaction.ts`), not a CI
 * gate — the label model's behaviour isn't fully in our control, so a
 * failing run is a finding to report, not treated as a crash.
 *
 * Usage:
 *   GOOGLE_CLOUD_PROJECT=bee6-playground npm run eval:label
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { callLabelModel } from "@/lib/pipeline/label/client";
import { loadCategoriesConfig, type CategoriesConfig } from "@/lib/pipeline/label/config";
import { buildLabelPrompt } from "@/lib/pipeline/label/prompt";
import { generateResponseJsonSchema } from "@/lib/pipeline/label/wire-schema";
import type { LabelUnit } from "@/lib/pipeline/windowing";
import { TRAP_FIXTURE_LINES, TRAP_LINE_INDEX } from "@/scripts/eval-label-fixtures";

const RUNS = 5;

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

function buildFixtureUnit(): LabelUnit {
  return {
    unit_id: "unit_eval_trap",
    window_ids: ["w_eval_trap"],
    lines: TRAP_FIXTURE_LINES.map((line, i) => ({
      line_id: `eval#${i}`,
      seg_id: "eval",
      text: line.text,
      start_ms: i * 5_000,
      end_ms: i * 5_000 + 4_000,
    })),
  };
}

/** Runs the fixture through the real pipeline once; returns the trap line's resolved category, or null if the call failed or the trap line never resolved. */
export async function runTrapOnce(
  config: CategoriesConfig,
  unit: LabelUnit,
): Promise<string | null> {
  const prompt = buildLabelPrompt({ config, unit, open_threads: [] });
  const schema = generateResponseJsonSchema({
    config,
    new_alias_count: unit.lines.length,
    open_alias_count: 0,
  });

  const result = await callLabelModel({ unit, prompt, schema });
  if (result.kind !== "ok") {
    console.log(`  run result: ${result.kind}`);
    return null;
  }

  const trapLine = result.wire.lines.find((l) => l.i === TRAP_LINE_INDEX);
  if (!trapLine) return null;
  const thread = result.wire.threads.find((t) => t.id === trapLine.thread);
  return thread?.category ?? null;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) {
    throw new Error(
      "GOOGLE_CLOUD_PROJECT is not set. Run e.g. " +
        "`GOOGLE_CLOUD_PROJECT=bee6-playground npm run eval:label`.",
    );
  }

  const config = loadCategoriesConfig("config/categories.draft.yaml");
  const unit = buildFixtureUnit();
  const trapLineText = TRAP_FIXTURE_LINES[TRAP_LINE_INDEX]!.text;

  console.log(`[eval:label] project=${project}`);
  console.log(`[eval:label] trap line (must label TRAINING): "${trapLineText}"`);
  console.log(
    "[eval:label] fictional fixture only (hard rule #8) — informational until Tiffany's examples land (Decision 1)",
  );

  const categories: Array<string | null> = [];
  for (let i = 1; i <= RUNS; i += 1) {
    const category = await runTrapOnce(config, unit);
    console.log(`  run ${i}/${RUNS}: ${category ?? "UNLABELLED"}`);
    categories.push(category);
  }

  const passCount = categories.filter((c) => c === "TRAINING").length;
  console.log(`\n[eval:label] TRAINING: ${passCount}/${RUNS}`);
  if (passCount === RUNS) {
    console.log("[eval:label] PASS (informational — see docs/tasks/R-05b.md Decision 1 for the formal result)");
  } else {
    console.log("[eval:label] FAIL");
  }
  process.exitCode = passCount === RUNS ? 0 : 1;
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

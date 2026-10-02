/**
 * Redaction accuracy eval (diagnostic, docs/tasks/R-04-redaction-eval.md).
 *
 * Measures real recall/precision of R-04's redaction path — `dlpRedactor()`
 * (lib/redact/dlp.ts, a real Sensitive Data Protection call) plus
 * `redactIndonesianPhones()` (lib/redact/indonesian-phone.ts, the pure regex
 * supplement) — against the fictional fixtures in
 * `scripts/eval-redaction-fixtures.ts` (hard rule #8: never real shop data).
 *
 * This is a human-readable diagnostic, not a CI gate: DLP's PERSON_NAME/
 * location heuristics are a black box we don't control, so a near-miss
 * fixture going the "wrong" way is a finding to report, not a crash.
 *
 * Read-only with respect to the redactors under test — this script never
 * modifies `lib/redact/*`.
 *
 * Usage:
 *   GOOGLE_CLOUD_PROJECT=bee6-playground DEMO_MODE=true npm run eval:redaction
 *
 * Requires Application Default Credentials with Sensitive Data Protection
 * access on the target project (never the pilot project with this fictional
 * fixture set — run it against the demo project, per CLAUDE.md hard rule #4).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { dlpRedactor } from "@/lib/redact/dlp";
import { redactIndonesianPhones } from "@/lib/redact/indonesian-phone";
import {
  REDACTION_FIXTURES,
  type RedactionFixture,
} from "@/scripts/eval-redaction-fixtures";

export interface FixtureOutcome {
  fixture: RedactionFixture;
  regexOnly: string;
  /** The actual production path: DLP call (which itself runs the regex pass first). */
  production: string | null;
  /** Set when the production call threw (fail-closed) instead of returning text. */
  error: string | null;
  actualRedacted: boolean;
  matchedExpectation: boolean;
}

/**
 * Loads simple KEY=VALUE pairs from .env.local into process.env for keys not
 * already set (mirrors scripts/probe.ts's loadEnvLocal). Values are never
 * logged.
 */
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

/** Runs one fixture through both redaction paths and scores it against its expectation. */
export async function evalFixture(
  fixture: RedactionFixture,
  redactor: { redact(text: string): Promise<string> },
): Promise<FixtureOutcome> {
  const regexOnly = redactIndonesianPhones(fixture.line);

  let production: string | null = null;
  let error: string | null = null;
  try {
    production = await redactor.redact(fixture.line);
  } catch (err) {
    // Never interpolate the fixture text into the error, only its id — the
    // fixture line itself is still fictional, but this keeps the habit
    // consistent with the fail-closed contract in lib/redact/dlp.ts.
    error = err instanceof Error ? err.message : String(err);
  }

  const actualRedacted = production !== null && production !== fixture.line;
  // A fixture with no production result (the call failed closed) cannot be
  // scored as "matched" even if that happens to agree with expectRedacted —
  // it's a measurement gap, not a confirmed outcome.
  const matchedExpectation = production !== null && actualRedacted === fixture.expectRedacted;

  return { fixture, regexOnly, production, error, actualRedacted, matchedExpectation };
}

function printOutcome(outcome: FixtureOutcome): void {
  const { fixture } = outcome;
  const expectLabel = fixture.expectRedacted
    ? `SHOULD redact${fixture.expectedInfoType ? ` (${fixture.expectedInfoType})` : ""}`
    : "should NOT redact";

  console.log(`\n[${fixture.id}] (${fixture.category})`);
  console.log(`  line        : ${fixture.line}`);
  console.log(`  regex-only  : ${outcome.regexOnly}`);
  if (outcome.error !== null) {
    console.log(`  production  : ERROR (${outcome.error})`);
  } else {
    console.log(`  production  : ${outcome.production}`);
  }
  console.log(`  expected    : ${expectLabel}`);
  console.log(`  result      : ${outcome.matchedExpectation ? "MATCH" : "MISMATCH"}`);
  console.log(`  note        : ${fixture.note}`);
}

function printSummary(outcomes: FixtureOutcome[]): void {
  const scored = outcomes.filter((o) => o.error === null);
  const errored = outcomes.filter((o) => o.error !== null);

  const shouldRedact = scored.filter((o) => o.fixture.expectRedacted);
  const shouldNotRedact = scored.filter((o) => !o.fixture.expectRedacted);

  const recallHits = shouldRedact.filter((o) => o.actualRedacted);
  const precisionHits = shouldNotRedact.filter((o) => !o.actualRedacted);

  const pct = (n: number, total: number) =>
    total === 0 ? "n/a" : `${((100 * n) / total).toFixed(1)}%`;

  console.log("\n=== Redaction accuracy summary ===");
  console.log(
    `Recall    (PII correctly redacted)      : ${recallHits.length}/${shouldRedact.length} (${pct(recallHits.length, shouldRedact.length)})`,
  );
  console.log(
    `Precision (non-PII correctly left alone) : ${precisionHits.length}/${shouldNotRedact.length} (${pct(precisionHits.length, shouldNotRedact.length)})`,
  );
  if (errored.length > 0) {
    console.log(`Errored (DLP call failed, not scored)    : ${errored.length}/${outcomes.length}`);
  }

  const mismatches = scored.filter((o) => !o.matchedExpectation);
  if (mismatches.length > 0) {
    console.log("\nMismatches:");
    for (const m of mismatches) {
      console.log(
        `  - [${m.fixture.id}] expected ${m.fixture.expectRedacted ? "redacted" : "untouched"}, got ${
          m.actualRedacted ? "redacted" : "untouched"
        } -> "${m.production}"`,
      );
    }
  }
  if (errored.length > 0) {
    console.log("\nErrored fixtures (DLP call failed closed, excluded from recall/precision):");
    for (const e of errored) {
      console.log(`  - [${e.fixture.id}] ${e.error}`);
    }
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) {
    throw new Error(
      "GOOGLE_CLOUD_PROJECT is not set. Run e.g. " +
        "`GOOGLE_CLOUD_PROJECT=bee6-playground DEMO_MODE=true npm run eval:redaction` " +
        "(see docs/tasks/R-04-redaction-eval.md).",
    );
  }
  console.log(`[eval:redaction] project=${project} region=${process.env.APP_REGION ?? "asia-southeast2"}`);
  console.log(`[eval:redaction] ${REDACTION_FIXTURES.length} fictional fixtures (hard rule #8)`);

  const redactor = dlpRedactor({ project });
  const outcomes: FixtureOutcome[] = [];
  for (const fixture of REDACTION_FIXTURES) {
    // Sequential on purpose: this is a one-off diagnostic run, not a hot
    // path, and sequential calls are easier to read in the log and gentler
    // on DLP quota.
    const outcome = await evalFixture(fixture, redactor);
    outcomes.push(outcome);
    printOutcome(outcome);
  }

  printSummary(outcomes);
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

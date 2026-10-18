import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R-08 Task 4.0 guard (hard rule #1). `@google/adk@2.2.1` has a hard
 * dependency on `@google-cloud/vertexai@1.12.0`, which nests its own
 * `@google/genai@1.52.0` (tech-lead ruling, R-08.md §0 item 2): acceptable
 * because it is never imported by our own code, loaded only transitively by
 * ADK modules R-08 never calls. This test is the guard that keeps that true:
 *  - no file under `lib/**` or `app/**` imports `@google-cloud/vertexai`
 *    directly (static or dynamic `require`);
 *  - `@google/adk` itself is imported only by `lib/agents/proposal-agent.ts`
 *    (R-24) `lib/agents/proposal-agent-v4.ts` and the DebriefAgent runner
 *    `lib/agents/debrief-agent.ts` and the ReviewAgent runner `lib/agents/review-agent.ts`, plus their tests,
 *    which mock it;
 *  - (R-24) nothing under `lib/proposals/v4/` imports `@google/adk`: the
 *    check, tools and prompt stay pure and testable without ADK.
 */

const ROOT = join(__dirname, "..", "..");

const VERTEXAI_IMPORT_RE =
  /(?:from\s+|import\s*\(?\s*|require\s*\()\s*["']@google-cloud\/vertexai(?:\/[^"']*)?["']/;
const ADK_IMPORT_RE =
  /(?:from\s+|import\s*\(?\s*|require\s*\()\s*["']@google\/adk(?:\/[^"']*)?["']/;

function listTsFiles(dir: string): string[] {
  let entries: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      entries = entries.concat(listTsFiles(full));
    } else if (/\.tsx?$/.test(name)) {
      entries.push(full);
    }
  }
  return entries;
}

function relPath(path: string): string {
  return path.slice(ROOT.length + 1).replace(/\\/g, "/");
}

const ALL_FILES = [...listTsFiles(join(ROOT, "app")), ...listTsFiles(join(ROOT, "lib"))];

/** This file's own positive-control samples below deliberately contain
 * import-shaped string literals that are not real imports; it is never
 * itself an offender. */
const SELF = relPath(join(__dirname, "no-vertexai-import.test.ts"));

describe("R-08 Task 4.0: no direct @google-cloud/vertexai import; @google/adk scoped to the agent", () => {
  it("no file in lib/** or app/** imports @google-cloud/vertexai directly", () => {
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      const rel = relPath(file);
      if (rel === SELF) continue;
      const text = readFileSync(file, "utf8");
      if (VERTEXAI_IMPORT_RE.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("@google/adk is imported only by the agent runners (Proposal v3, v4; DebriefAgent; ReviewAgent) and their tests", () => {
    const allowed = new Set([
      "lib/agents/proposal-agent.ts",
      "lib/agents/proposal-agent.test.ts",
      "lib/agents/proposal-agent-v4.ts",
      "lib/agents/proposal-agent-v4.test.ts",
      "lib/agents/debrief-agent.ts",
      "lib/agents/debrief-agent.test.ts",
      "lib/agents/review-agent.ts",
      "lib/agents/review-agent.test.ts",
      SELF,
    ]);
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      const rel = relPath(file);
      if (allowed.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      if (ADK_IMPORT_RE.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("nothing under lib/proposals/v4/ imports @google/adk", () => {
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      const rel = relPath(file);
      if (!rel.startsWith("lib/proposals/v4/")) continue;
      if (ADK_IMPORT_RE.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("nothing under lib/debrief/agent/ imports @google/adk (checker, prompt, moment stay pure and ADK-free)", () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const file of ALL_FILES) {
      const rel = relPath(file);
      if (!rel.startsWith("lib/debrief/agent/")) continue;
      seen += 1;
      if (ADK_IMPORT_RE.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }
    expect(seen).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it("nothing under lib/reviews/agent/ imports @google/adk (checker, tools, prompt, inputs stay pure and ADK-free)", () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const file of ALL_FILES) {
      const rel = relPath(file);
      if (!rel.startsWith("lib/reviews/agent/")) continue;
      seen += 1;
      if (ADK_IMPORT_RE.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }
    expect(seen).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it("hard rule 5: no model location literal in lib/reviews/agent/** or the ReviewAgent runner (non-test code)", () => {
    const LOCATION_LITERAL = /asia-southeast\d?|["']global["']|us-central\d?|europe-[a-z]+\d?|us-east\d?/;
    const offenders: string[] = [];
    let seen = 0;
    for (const file of ALL_FILES) {
      const rel = relPath(file);
      if (!(rel.startsWith("lib/reviews/agent/") || rel === "lib/agents/review-agent.ts")) continue;
      if (rel.endsWith(".test.ts")) continue;
      seen += 1;
      if (LOCATION_LITERAL.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }
    expect(seen).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });

  // Positive control: a regex that stopped matching real import strings
  // would make both guards above pass vacuously. These assertions fail
  // loudly if that ever happens.
  it("positive control: VERTEXAI_IMPORT_RE matches a plain import, a subpath import and a require", () => {
    expect(VERTEXAI_IMPORT_RE.test('import { VertexAI } from "@google-cloud/vertexai";')).toBe(true);
    expect(
      VERTEXAI_IMPORT_RE.test('import x from "@google-cloud/vertexai/build/src/index.js";'),
    ).toBe(true);
    expect(VERTEXAI_IMPORT_RE.test('const v = require("@google-cloud/vertexai");')).toBe(true);
  });

  it("positive control: ADK_IMPORT_RE matches a plain import and a subpath import", () => {
    expect(ADK_IMPORT_RE.test('import { LlmAgent } from "@google/adk";')).toBe(true);
    expect(ADK_IMPORT_RE.test('import x from "@google/adk/dist/foo.js";')).toBe(true);
    expect(ADK_IMPORT_RE.test('const a = require("@google/adk/dist/index.cjs");')).toBe(true);
  });
});

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
 *    (and this file's own sibling test, which mocks it).
 */

const ROOT = join(__dirname, "..", "..");

const VERTEXAI_IMPORT_RE =
  /(?:from\s+|import\s*\(?\s*|require\s*\()\s*["']@google-cloud\/vertexai["']/;
const ADK_IMPORT_RE = /(?:from\s+|import\s*\(?\s*|require\s*\()\s*["']@google\/adk["']/;

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

describe("R-08 Task 4.0: no direct @google-cloud/vertexai import; @google/adk scoped to the agent", () => {
  it("no file in lib/** or app/** imports @google-cloud/vertexai directly", () => {
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      const text = readFileSync(file, "utf8");
      if (VERTEXAI_IMPORT_RE.test(text)) offenders.push(relPath(file));
    }
    expect(offenders).toEqual([]);
  });

  it("@google/adk is imported only by lib/agents/proposal-agent.ts and its own test", () => {
    const allowed = new Set([
      "lib/agents/proposal-agent.ts",
      "lib/agents/proposal-agent.test.ts",
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
});

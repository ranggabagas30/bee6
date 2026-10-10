import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R-08 Task 7 guard (hard rule #6: browsers never talk to Firestore; same
 * spirit as `lib/auth/client/import-ban.test.ts` and
 * `lib/agents/no-vertexai-import.test.ts`). `app/proposals/**` is browser
 * code: it must never import the model agent, the server-side generate
 * service, or Firestore directly — every read/write it does goes through
 * `authedPostJson` to `POST /api/v1/proposals/generate`.
 */

const ROOT = join(__dirname, "..", "..");
const TARGET_DIR = join(__dirname); // app/proposals itself

const BANNED_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "@google/adk", re: /(?:from\s+|import\s*\(?\s*|require\s*\()\s*["']@google\/adk(?:\/[^"']*)?["']/ },
  { name: "@/lib/agents/*", re: /(?:from\s+|import\s*\(?\s*|require\s*\()\s*["']@\/lib\/agents(?:\/[^"']*)?["']/ },
  {
    name: "@/lib/proposals/service",
    re: /(?:from\s+|import\s*\(?\s*|require\s*\()\s*["']@\/lib\/proposals\/service["']/,
  },
  {
    name: "firebase/firestore",
    re: /(?:from\s+|import\s*\(?\s*|require\s*\()\s*["']@?firebase\/firestore(?:\/[^"']*)?["']/,
  },
];

function listTsFiles(dir: string): string[] {
  let entries: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      entries = entries.concat(listTsFiles(full));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      entries.push(full);
    }
  }
  return entries;
}

function relPath(path: string): string {
  return path.slice(ROOT.length + 1).replace(/\\/g, "/");
}

const TARGET_FILES = listTsFiles(TARGET_DIR);

describe("app/proposals/* import boundaries (R-08 Task 7)", () => {
  for (const banned of BANNED_PATTERNS) {
    it(`no file under app/proposals/ imports ${banned.name}`, () => {
      const offenders: string[] = [];
      for (const file of TARGET_FILES) {
        const text = readFileSync(file, "utf8");
        if (banned.re.test(text)) offenders.push(relPath(file));
      }
      expect(offenders).toEqual([]);
    });
  }

  it("positive control: each banned pattern matches a plain import of itself", () => {
    // The ADK sample string is built from parts, not written as one
    // import-shaped literal: `lib/agents/no-vertexai-import.test.ts`
    // (R-08 Task 4.0) scans every .ts(x) file's raw text for that exact
    // shape, including test files, and would otherwise flag this file as a
    // real offender.
    const adkSample = `import { LlmAgent } from ${JSON.stringify("@google/adk")};`;
    expect(BANNED_PATTERNS[0]!.re.test(adkSample)).toBe(true);
    expect(BANNED_PATTERNS[1]!.re.test('import { adkProposalModel } from "@/lib/agents/proposal-agent";')).toBe(true);
    expect(BANNED_PATTERNS[2]!.re.test('import { generateProposal } from "@/lib/proposals/service";')).toBe(true);
    expect(BANNED_PATTERNS[3]!.re.test('import { getFirestore } from "firebase/firestore";')).toBe(true);
  });

  it("sanity: at least one real file under app/proposals/ was scanned", () => {
    expect(TARGET_FILES.length).toBeGreaterThan(0);
  });
});

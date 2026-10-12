import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R-10 Task 5.6 guard (hard rule #6: browsers never talk to Firestore; same
 * spirit as app/proposals/import-boundaries.test.ts). `app/sop/**` is browser
 * code: it reads the SOP only through `authedGetJson` to GET /api/v1/sop and
 * may import the wire contract, never a server module.
 */

const ROOT = join(__dirname, "..", "..");
const TARGET_DIR = join(__dirname);

const imp = (spec: string) => new RegExp(`(?:from\\s+|import\\s*\\(?\\s*|require\\s*\\()\\s*["']${spec}["']`);

const BANNED_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "firebase-admin", re: imp("firebase-admin(?:\\/[^\"']*)?") },
  { name: "firebase/firestore", re: imp("@?firebase\\/firestore(?:\\/[^\"']*)?") },
  { name: "@/lib/firebase/admin", re: imp("@\\/lib\\/firebase\\/admin") },
  { name: "@/lib/sop/service", re: imp("@\\/lib\\/sop\\/service") },
  { name: "@/lib/sop/ship", re: imp("@\\/lib\\/sop\\/ship") },
  { name: "@/lib/sop/in-force", re: imp("@\\/lib\\/sop\\/in-force") },
];

/** @/lib/firestore/* is banned except a type-only import of the schema (zod shapes, no Firestore call). */
const FIRESTORE_STAR_RE = /(?:from\s+|import\s*\(?\s*|require\s*\()\s*["']@\/lib\/firestore(?:\/[^"']*)?["']/g;
const TYPE_ONLY_SCHEMA_RE = /import\s+type\s+[^;]*from\s+["']@\/lib\/firestore\/schema["']/;

function listTsFiles(dir: string): string[] {
  let entries: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) entries = entries.concat(listTsFiles(full));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) entries.push(full);
  }
  return entries;
}
const relPath = (p: string) => p.slice(ROOT.length + 1).replace(/\\/g, "/");
const TARGET_FILES = listTsFiles(TARGET_DIR);

describe("app/sop/* import boundaries (R-10 Task 5)", () => {
  for (const banned of BANNED_PATTERNS) {
    it(`no file under app/sop/ imports ${banned.name}`, () => {
      const offenders = TARGET_FILES.filter((f) => banned.re.test(readFileSync(f, "utf8"))).map(relPath);
      expect(offenders).toEqual([]);
    });
  }

  it("no file under app/sop/ imports @/lib/firestore/* except a type-only schema import", () => {
    const offenders: string[] = [];
    for (const file of TARGET_FILES) {
      const text = readFileSync(file, "utf8");
      const withoutTypeOnly = text
        .split("\n")
        .filter((line) => !TYPE_ONLY_SCHEMA_RE.test(line))
        .join("\n");
      if (new RegExp(FIRESTORE_STAR_RE.source).test(withoutTypeOnly)) offenders.push(relPath(file));
    }
    expect(offenders).toEqual([]);
  });

  it("the wire contract is the allowed SOP import", () => {
    const text = TARGET_FILES.map((f) => readFileSync(f, "utf8")).join("\n");
    expect(text).toContain("@/lib/sop/contract");
  });

  it("positive control: each banned pattern matches a plain import of itself", () => {
    expect(BANNED_PATTERNS[0]!.re.test('import { getFirestore } from "firebase-admin/firestore";')).toBe(true);
    expect(BANNED_PATTERNS[1]!.re.test('import { getFirestore } from "firebase/firestore";')).toBe(true);
    expect(BANNED_PATTERNS[2]!.re.test('import { adminDb } from "@/lib/firebase/admin";')).toBe(true);
    expect(BANNED_PATTERNS[3]!.re.test('import { getSopOverview } from "@/lib/sop/service";')).toBe(true);
    expect(BANNED_PATTERNS[4]!.re.test('import { planShip } from "@/lib/sop/ship";')).toBe(true);
    expect(BANNED_PATTERNS[5]!.re.test('import { latestSop } from "@/lib/sop/in-force";')).toBe(true);
    expect(new RegExp(FIRESTORE_STAR_RE.source).test('import { firestoreSopStore } from "@/lib/firestore/sop-store";')).toBe(true);
  });

  it("sanity: real files under app/sop/ were scanned", () => {
    expect(TARGET_FILES.length).toBeGreaterThan(1);
  });
});

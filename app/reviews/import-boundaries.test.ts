import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R-11 Task 6.7 guard (hard rule #6: browsers never talk to Firestore; same
 * spirit as app/proposals/import-boundaries.test.ts). `app/reviews/**` is browser
 * code: it reads reviews only through `authedGetJson` / `authedPostJson` to /api/v1/reviews* and
 * may import the wire contract and constants, never a server module.
 */

const ROOT = join(__dirname, "..", "..");
const TARGET_DIR = join(__dirname);

const imp = (spec: string) => new RegExp(`(?:from\\s+|import\\s*\\(?\\s*|require\\s*\\()\\s*["']${spec}["']`);

const BANNED_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "firebase-admin", re: imp("firebase-admin(?:\\/[^\"']*)?") },
  { name: "firebase/firestore", re: imp("@?firebase\\/firestore(?:\\/[^\"']*)?") },
  { name: "@/lib/firebase/admin", re: imp("@\\/lib\\/firebase\\/admin") },
  { name: "@/lib/reviews/service", re: imp("@\\/lib\\/reviews\\/service") },
  { name: "@/lib/reviews/plan", re: imp("@\\/lib\\/reviews\\/plan") },
  { name: "@/lib/reviews/metric", re: imp("@\\/lib\\/reviews\\/metric") },
  { name: "@/lib/reviews/verdict", re: imp("@\\/lib\\/reviews\\/verdict") },
  { name: "@/lib/redact/*", re: imp("@\\/lib\\/redact(?:\\/[^\"']*)?") },
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

describe("app/reviews/* import boundaries (R-11 Task 6)", () => {
  for (const banned of BANNED_PATTERNS) {
    it(`no file under app/reviews/ imports ${banned.name}`, () => {
      const offenders = TARGET_FILES.filter((f) => banned.re.test(readFileSync(f, "utf8"))).map(relPath);
      expect(offenders).toEqual([]);
    });
  }

  it("no file under app/reviews/ imports @/lib/firestore/* except a type-only schema import", () => {
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

  it("the wire contract is the allowed reviews import", () => {
    const text = TARGET_FILES.map((f) => readFileSync(f, "utf8")).join("\n");
    expect(text).toContain("@/lib/reviews/contract");
  });

  it("positive control: each banned pattern matches a plain import of itself", () => {
    expect(BANNED_PATTERNS[0]!.re.test('import { getFirestore } from "firebase-admin/firestore";')).toBe(true);
    expect(BANNED_PATTERNS[1]!.re.test('import { getFirestore } from "firebase/firestore";')).toBe(true);
    expect(BANNED_PATTERNS[2]!.re.test('import { adminDb } from "@/lib/firebase/admin";')).toBe(true);
    expect(BANNED_PATTERNS[3]!.re.test('import { decideVerdict } from "@/lib/reviews/service";')).toBe(true);
    expect(BANNED_PATTERNS[4]!.re.test('import { buildReview } from "@/lib/reviews/plan";')).toBe(true);
    expect(BANNED_PATTERNS[5]!.re.test('import { countWindow } from "@/lib/reviews/metric";')).toBe(true);
    expect(BANNED_PATTERNS[6]!.re.test('import { suggestVerdict } from "@/lib/reviews/verdict";')).toBe(true);
    expect(BANNED_PATTERNS[7]!.re.test('import { redactUserText } from "@/lib/redact/user-text";')).toBe(true);
    expect(BANNED_PATTERNS[2]!.re.test('import { adminDb } from "@/lib/firebase/admin";')).toBe(true);
    expect(new RegExp(FIRESTORE_STAR_RE.source).test('import { firestoreReviewStore } from "@/lib/firestore/review-store";')).toBe(true);
  });

  it("sanity: real files under app/reviews/ were scanned", () => {
    expect(TARGET_FILES.length).toBeGreaterThan(1);
  });
});

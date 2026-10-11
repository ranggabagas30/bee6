import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R-12 Task 8.6 guard (hard rule #6: browsers never talk to Firestore; same spirit as
 * app/reviews/import-boundaries.test.ts). `app/demo/**` is browser code: it reaches the demo only through
 * POST /api/v1/demo/session and may import the wire contract, never a server module, and never an
 * environment secret or a raw `process.env`.
 */

const ROOT = join(__dirname, "..", "..");
const TARGET_DIR = join(__dirname);

const imp = (spec: string) => new RegExp(`(?:from\\s+|import\\s*\\(?\\s*|require\\s*\\()\\s*["']${spec}["']`);

const BANNED_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "firebase-admin", re: imp("firebase-admin(?:\\/[^\"']*)?") },
  { name: "firebase/firestore", re: imp("@?firebase\\/firestore(?:\\/[^\"']*)?") },
  { name: "@/lib/firebase/admin", re: imp("@\\/lib\\/firebase\\/admin") },
  { name: "@/lib/demo/service", re: imp("@\\/lib\\/demo\\/service") },
  { name: "@/lib/demo/clone", re: imp("@\\/lib\\/demo\\/clone") },
  { name: "@/lib/demo/limits", re: imp("@\\/lib\\/demo\\/limits") },
  { name: "@/lib/demo/caps", re: imp("@\\/lib\\/demo\\/caps") },
  { name: "@/lib/demo/route-caps", re: imp("@\\/lib\\/demo\\/route-caps") },
  { name: "@/lib/demo/store-types", re: imp("@\\/lib\\/demo\\/store-types") },
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

describe("app/demo/* import boundaries (R-12 Task 8.6)", () => {
  for (const banned of BANNED_PATTERNS) {
    it(`no file under app/demo/ imports ${banned.name}`, () => {
      const offenders = TARGET_FILES.filter((f) => banned.re.test(readFileSync(f, "utf8"))).map(relPath);
      expect(offenders).toEqual([]);
    });
  }

  it("no file under app/demo/ imports @/lib/firestore/* except a type-only schema import", () => {
    const offenders: string[] = [];
    for (const file of TARGET_FILES) {
      const withoutTypeOnly = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !TYPE_ONLY_SCHEMA_RE.test(line))
        .join("\n");
      if (new RegExp(FIRESTORE_STAR_RE.source).test(withoutTypeOnly)) offenders.push(relPath(file));
    }
    expect(offenders).toEqual([]);
  });

  it("no file under app/demo/ reads process.env or touches localStorage for the sandbox key", () => {
    const offenders = TARGET_FILES.filter((f) => /process\.env/.test(readFileSync(f, "utf8"))).map(relPath);
    expect(offenders).toEqual([]);
    const client = readFileSync(join(TARGET_DIR, "demo-client.ts"), "utf8");
    // localStorage appears only for the device keys the capture screen reads.
    const localLines = client.split("\n").filter((l) => /localStorage/.test(l) && !/^\s*(\/\/|\*)/.test(l));
    for (const line of localLines) expect(line).toMatch(/DEVICE_(TOKEN|ID)_KEY/);
  });

  it("the wire contract is the allowed demo import", () => {
    const text = TARGET_FILES.map((f) => readFileSync(f, "utf8")).join("\n");
    expect(text).toContain("@/lib/demo/contract");
  });

  it("positive control: each banned pattern matches a plain import of itself", () => {
    const samples = [
      'import { getFirestore } from "firebase-admin/firestore";',
      'import { getFirestore } from "firebase/firestore";',
      'import { adminDb } from "@/lib/firebase/admin";',
      'import { issueDemoSession } from "@/lib/demo/service";',
      'import { cloneTemplate } from "@/lib/demo/clone";',
      'import { clientIp } from "@/lib/demo/limits";',
      'import { checkCap } from "@/lib/demo/caps";',
      'import { x } from "@/lib/demo/route-caps";',
      'import type { DemoStore } from "@/lib/demo/store-types";',
      'import { redactUserText } from "@/lib/redact/user-text";',
    ];
    expect(samples.length).toBe(BANNED_PATTERNS.length);
    BANNED_PATTERNS.forEach((p, i) => expect(p.re.test(samples[i]!), p.name).toBe(true));
    expect(new RegExp(FIRESTORE_STAR_RE.source).test('import { firestoreDemoStore } from "@/lib/firestore/demo-store";')).toBe(true);
  });

  it("sanity: real files under app/demo/ were scanned", () => {
    expect(TARGET_FILES.length).toBeGreaterThan(3);
  });
});

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

  it("no file under app/demo/ reads process.env, and touches localStorage only for the demo state and the device keys", () => {
    const offenders = TARGET_FILES.filter((f) => /process\.env/.test(readFileSync(f, "utf8"))).map(relPath);
    expect(offenders).toEqual([]);
    const client = readFileSync(join(TARGET_DIR, "demo-client.ts"), "utf8");
    // localStorage appears only for the demo state key and the device keys the capture screen reads.
    const localLines = client.split("\n").filter((l) => /localStorage/.test(l) && !/^\s*(\/\/|\*)/.test(l));
    for (const line of localLines) expect(line).toMatch(/DEVICE_(TOKEN|ID)_KEY|DEMO_STATE_KEY/);
  });

  it("the sandbox state is shared across tabs: sessionStorage is used under app/demo/ only by the judge guide, for the spoken-cards progress of one local session (plan 5.3)", () => {
    const offenders = TARGET_FILES.filter((f) => /sessionStorage/.test(readFileSync(f, "utf8"))).map(relPath);
    expect(offenders).toEqual(["app/demo/JudgeGuide.tsx"]);
    const guide = readFileSync(join(TARGET_DIR, "JudgeGuide.tsx"), "utf8");
    const lines = guide.split("\n").filter((l) => /sessionStorage\.(get|set|remove)Item/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/scriptStorageKey\(/);
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

/**
 * R-18 P1 (13.T2): the pilot's pages ship no demo credential and no demo box. The role sign-in reaches `app/demo/DemoAccess`
 * only through `next/dynamic`, and the published credentials live in one module that only demo-only code imports.
 */
describe("pilot isolation of the demo sign-in (R-18 P1)", () => {
  const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
  const importLines = (src: string) => src.split("\n").filter((l) => /^\s*import\s/.test(l) || /^\s*}\s*from\s/.test(l));
  const APP_AND_LIB = [...listTsFiles(join(ROOT, "app")), ...listTsFiles(join(ROOT, "lib"))];

  it("RoleSignIn statically imports nothing from app/demo/** or lib/demo/**, and loads DemoAccess only through next/dynamic", () => {
    const src = read("app/sign-in/RoleSignIn.tsx");
    const staticDemo = importLines(src).filter((l) => /["']@\/(app|lib)\/demo\//.test(l));
    expect(staticDemo).toEqual([]);
    expect(src).toMatch(/import dynamic from ["']next\/dynamic["']/);
    expect(src).toMatch(/dynamic<[^>]*>\(\s*\(\)\s*=>\s*import\(\s*["']@\/app\/demo\/DemoAccess["']\s*\)/);
    expect(src).not.toMatch(/ssr:\s*false/); // server-rendered with the page: no flash of a missing demo box
  });

  it("no pilot-reachable module imports lib/demo/credentials: only app/demo/DemoAccess and the judge guide (R-19 PR-5, loaded only when DEMO_MODE is on) do", () => {
    const importers = APP_AND_LIB.filter((f) => /["']@\/lib\/demo\/credentials["']/.test(readFileSync(f, "utf8"))).map(relPath);
    expect(importers.sort()).toEqual(["app/demo/DemoAccess.tsx", "app/demo/JudgeGuide.tsx"]);
  });

  it("nothing but lib/demo/credentials.ts (and the server-only reserved pairing code) carries the published credential values", () => {
    const offenders = APP_AND_LIB.filter((f) => /\b000000\b|bee6-demo|\.judge@example\.com/.test(readFileSync(f, "utf8"))).map(relPath);
    expect(offenders.sort()).toEqual(["lib/auth/pairing.ts", "lib/demo/credentials.ts"]);
  });

  it("PairScreen statically imports nothing from app/demo/** or lib/demo/**, and loads DemoAccess only through next/dynamic", () => {
    const src = read("app/pair/PairScreen.tsx");
    const staticDemo = importLines(src).filter((l) => /["']@\/(app|lib)\/demo\//.test(l));
    expect(staticDemo).toEqual([]);
    expect(src).toMatch(/import dynamic from ["']next\/dynamic["']/);
    expect(src).toMatch(/dynamic<[^>]*>\(\s*\(\)\s*=>\s*import\(\s*["']@\/app\/demo\/DemoAccess["']\s*\)/);
    expect(src).not.toMatch(/ssr:\s*false/);
  });

  it("the pages and the sign-in shell import no demo box code (the shell's only demo import is the state module the ended-demo cleanup uses)", () => {
    for (const rel of ["app/page.tsx", "app/sign-in/page.tsx", "app/sign-in/SignInScreen.tsx", "app/sign-in/EmailSignInForm.tsx", "app/pair/page.tsx", "app/pair/PairForm.tsx", "app/web/EntryLanding.tsx"]) {
      const demoImports = importLines(read(rel)).filter((l) => /["']@\/(app|lib)\/demo\//.test(l));
      for (const line of demoImports) expect(line, rel).toMatch(/@\/app\/demo\/demo-client["']/);
      expect(read(rel), rel).not.toMatch(/DemoAccess|credentials/);
    }
  });

  it("positive control: the dynamic-import matcher sees a real lazy import", () => {
    const sample = 'const DemoAccess = dynamic<DemoAccessProps>(() => import("@/app/demo/DemoAccess").then((m) => m.DemoAccess));';
    expect(/dynamic<[^>]*>\(\s*\(\)\s*=>\s*import\(\s*["']@\/app\/demo\/DemoAccess["']\s*\)/.test(sample)).toBe(true);
    expect(importLines('import { x } from "@/app/demo/DemoAccess";').filter((l) => /["']@\/(app|lib)\/demo\//.test(l))).toHaveLength(1);
  });
});

/**
 * Pilot bundle boundary (R-18, re-cut in R-19 PR-5): the sandbox script text, the judge guide and the demo
 * credentials must not ship on the pilot /capture. The guide is mounted by the root layout through
 * JudgeGuideLoader (next/dynamic, ssr: false) only when DEMO_MODE is on; the page talks to it through the tiny
 * bridge module only. So neither the page nor the layout helpers it imports may statically import the guide,
 * its loader or the script data.
 */
describe("pilot /capture bundle boundary (R-18, R-19 PR-5)", () => {
  const staticImport = (spec: string) => new RegExp(`(?:^|\\n)\\s*(?:import|export)\\s[^;]*?from\\s+["']${spec}["']`);
  const guarded = ["app/capture/page.tsx", "app/capture/drawer-layout.ts", "app/demo/guide-bridge.ts"];
  const banned = ["@/lib/demo/script", "@/lib/demo/credentials", "@/app/demo/JudgeGuide", "@/app/demo/JudgeGuideLoader"];

  for (const file of guarded) {
    for (const spec of banned) {
      it(`${file} has no static import of ${spec}`, () => {
        const text = readFileSync(join(ROOT, file), "utf8");
        expect(staticImport(spec.replace(/[/.]/g, "\\$&")).test(text)).toBe(false);
      });
    }
  }

  it("the R-18 drawer is gone: no file imports or defines app/capture/ScriptDrawer", () => {
    expect(existsSync(join(ROOT, "app/capture/ScriptDrawer.tsx"))).toBe(false);
    const importers = [...listTsFiles(join(ROOT, "app")), ...listTsFiles(join(ROOT, "lib"))]
      .filter((f) => /ScriptDrawer/.test(readFileSync(f, "utf8")))
      .map(relPath);
    expect(importers).toEqual([]);
  });

  it("the page reaches the guide only through the bridge (counts, phases and callbacks; no text)", () => {
    const page = readFileSync(join(ROOT, "app/capture/page.tsx"), "utf8");
    expect(page).toMatch(/from\s+["']@\/app\/demo\/guide-bridge["']/);
    const bridge = readFileSync(join(ROOT, "app/demo/guide-bridge.ts"), "utf8");
    const imports = bridge.split("\n").filter((l) => /^\s*import\s/.test(l));
    for (const line of imports) expect(line).toMatch(/^import (type )?\{[^}]*\} from ["'](react|@\/lib\/capture\/contract|@\/lib\/debrief\/constants|@\/lib\/demo\/guide|@\/lib\/i18n\/dict)["'];$/);
    expect(bridge).not.toMatch(/import\s*\(/);
  });

  it("positive control: the static-import matcher catches a plain and a type-and-value import", () => {
    const re = staticImport("@/lib/demo/script".replace(/[/.]/g, "\\$&"));
    expect(re.test('import { scriptFor } from "@/lib/demo/script";')).toBe(true);
    expect(re.test('\nimport { a,\n b } from "@/lib/demo/script"')).toBe(true);
    expect(re.test('const x = import("@/lib/demo/script")')).toBe(false);
  });
});

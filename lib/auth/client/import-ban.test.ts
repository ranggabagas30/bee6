import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R-06 Task 4.7 (hard rule #6: browsers never talk to Firestore; CLAUDE.md §3
 * "only `firebase/app` and `firebase/auth` are ever imported in browser
 * code"). This repo takes the plan's "simpler alternative": every Firebase
 * Auth function a component needs is re-exported from
 * `lib/auth/client/firebase-client.ts`, so the "only `lib/auth/client/`
 * imports firebase/app or firebase/auth" rule holds with NO exception list —
 * `app/sign-in/SignInScreen.tsx` and `app/web/SignOutButton.tsx` import
 * `signInWithEmailAndPassword` / `signOut` from there, not from `firebase/auth`
 * directly.
 */

const ROOT = join(__dirname, "..", "..", "..");

const BANNED_FIRESTORE_IMPORT_RE =
  /from\s+["'](?:@?firebase\/(?:firestore|database|storage))["']/;
// Global, and matches `from "..."`, a side-effect `import "..."`, and a
// dynamic `import("...")` — not only the static `from` form (tech-lead
// review finding 2, R-06 sign-in PR). Callers must iterate with `matchAll`
// to see every match in a file, not just the first.
const FIREBASE_IMPORT_RE = /(?:from\s+|import\s*\(?\s*)["']((?:@)?firebase\/[^"']+)["']/g;
const AUTH_CLIENT_IMPORT_RE = /from\s+["']@\/lib\/auth\/client\/[^"']+["']/;

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

const ALL_FILES = [...listTsFiles(join(ROOT, "app")), ...listTsFiles(join(ROOT, "lib"))];

describe("firebase import boundaries (R-06 Task 4.7)", () => {
  it("never imports firebase/firestore, firebase/database or firebase/storage anywhere", () => {
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      const text = readFileSync(file, "utf8");
      if (BANNED_FIRESTORE_IMPORT_RE.test(text)) offenders.push(relPath(file));
    }
    expect(offenders).toEqual([]);
  });

  it("no file under app/capture/, app/pair/, app/shop/, lib/capture/ or lib/debrief/ imports firebase/* or lib/auth/client/*", () => {
    const bannedDirs = [
      "app/capture/",
      "app/pair/",
      "app/shop/",
      "lib/capture/",
      "lib/debrief/",
    ];
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      const rel = relPath(file);
      if (!bannedDirs.some((dir) => rel.startsWith(dir))) continue;
      const text = readFileSync(file, "utf8");
      if (FIREBASE_IMPORT_RE.test(text) || AUTH_CLIENT_IMPORT_RE.test(text)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("only lib/auth/client/** imports firebase/app or firebase/auth", () => {
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      const rel = relPath(file);
      if (rel.startsWith("lib/auth/client/")) continue;
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(FIREBASE_IMPORT_RE)) {
        if (match[1] === "firebase/app" || match[1] === "firebase/auth") {
          offenders.push(rel);
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Tech-lead review finding 2 (R-06 sign-in PR): the scanner above only
   * checked the FIRST Firebase import per file via `.exec`, and only matched
   * the `from "..."` form — a side-effect import or a dynamic `import(...)`
   * slipped past undetected. These cases exercise the matcher directly so a
   * regression here fails loudly instead of silently passing the file scan.
   */
  describe("matcher catches side-effect, dynamic, and non-first imports", () => {
    function bannedFirebaseModules(text: string): string[] {
      const hits: string[] = [];
      for (const match of text.matchAll(FIREBASE_IMPORT_RE)) {
        if (match[1] === "firebase/app" || match[1] === "firebase/auth") {
          hits.push(match[1]);
        }
      }
      return hits;
    }

    it("catches a plain side-effect import", () => {
      const text = `import "firebase/auth";\n`;
      expect(bannedFirebaseModules(text)).toEqual(["firebase/auth"]);
    });

    it("catches a dynamic import", () => {
      const text = `async function f() { await import("firebase/app"); }\n`;
      expect(bannedFirebaseModules(text)).toEqual(["firebase/app"]);
    });

    it("catches the second Firebase import when only the second is banned", () => {
      const text = [
        `import { getAnalytics } from "firebase/analytics";`,
        `import { getAuth } from "firebase/auth";`,
        "",
      ].join("\n");
      expect(bannedFirebaseModules(text)).toEqual(["firebase/auth"]);
    });
  });
});

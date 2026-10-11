import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R-08 §0 item 5 / Task 2.3 — repo-hygiene guard. The real Proofed SOP stays
 * at `/private/SOP PROOFED.pdf` (gitignored, never committed, never read by
 * code) and reaches only the pilot project by Rangga's own hand, through
 * `private/seed.pilot.json`. This test fails the pre-push hook the moment any
 * future change:
 *  (a) names or quotes "SOP PROOFED" anywhere in the scanned source, or
 *  (b) wires a new `private/` path into code outside the one allowed path
 *      (`scripts/seed.ts`'s existing `path.join(..., "private", ...)` call
 *      and its own comments; R-12 adds `scripts/demo-seed-template.ts`, which reads
 *      the fictional demo clips from `private/demo-clips/`).
 *
 * The forbidden strings are built by concatenation so this test file does
 * not match its own pattern.
 */

const ROOT = join(__dirname, "..");
const SCAN_DIRS = ["lib", "app", "config", "scripts"];

// Deliberately does NOT match prose like "private/non-work" in
// lib/pipeline/label/prompt.ts (preceded by a space): only a quote,
// backtick or slash directly before AND after "private" counts as code
// wiring in a new private/ path.
const PRIVATE_PATH_RE = /["'`/]private["'`/]/;
// R-12: scripts/demo-seed-template.ts is the one other reader of private/ (Tiffany's fictional demo
// clips and plan.json under private/demo-clips/, never the SOP); it runs only on Rangga's machine.
const ALLOWED_PRIVATE_FILES = new Set([
  "scripts/seed.ts",
  "scripts/demo-seed-template.ts",
  "scripts/private-boundary.test.ts",
]);

const FORBIDDEN_SOP_NAME = ("SOP " + "PROOFED").toLowerCase();

function listFiles(dir: string): string[] {
  let entries: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      entries = entries.concat(listFiles(full));
    } else {
      entries.push(full);
    }
  }
  return entries;
}

function relPath(path: string): string {
  return path.slice(ROOT.length + 1).replace(/\\/g, "/");
}

const ALL_FILES = SCAN_DIRS.flatMap((dir) => listFiles(join(ROOT, dir)));

describe("R-08 private-boundary guard", () => {
  it('no file names or quotes "SOP PROOFED" (case-insensitive)', () => {
    // This test's own description/docstring necessarily names the phrase
    // it guards against — excluded from the scan, not from the hygiene rule.
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      const rel = relPath(file);
      if (rel === "scripts/private-boundary.test.ts") continue;
      const text = readFileSync(file, "utf8").toLowerCase();
      if (text.includes(FORBIDDEN_SOP_NAME)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("only scripts/seed.ts (and this file) reference a private/ path", () => {
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      const rel = relPath(file);
      if (ALLOWED_PRIVATE_FILES.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      if (PRIVATE_PATH_RE.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("lib/pipeline/label/prompt.ts's prose 'private/non-work' does not trip the matcher", () => {
    const text = readFileSync(join(ROOT, "lib", "pipeline", "label", "prompt.ts"), "utf8");
    expect(PRIVATE_PATH_RE.test(text)).toBe(false);
  });
});

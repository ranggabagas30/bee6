import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Hard rule #9 guard (R-10 Task 4.6): SOP changes only through proposals.
 * Adding a file to this allowlist needs tech-lead sign-off: SOP versions are
 * written only by the owner-approval transaction and the seed.
 */
const ALLOWLIST = new Set([
  "lib/firestore/collections.ts",
  "lib/firestore/proposal-store.ts", // read
  "lib/firestore/sop-store.ts", // read
  "lib/firestore/proposal-review-store.ts", // R-09 read; R-10 PR-2 create (inside the owner approval)
  "scripts/seed.ts", // v1, once
]);

const ROOT = process.cwd();

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = ["app", "lib", "scripts"].flatMap((d) => walk(join(ROOT, d), []));
const NAMES_COLLECTION = /COLLECTIONS\.sopVersions|sopVersions\b|"sop_versions"/;
const naming = files
  .filter((f) => NAMES_COLLECTION.test(readFileSync(f, "utf8")))
  .map((f) => relative(ROOT, f).split("\\").join("/"));

describe("sop_versions write boundary (hard rule #9)", () => {
  it("scans a real source tree", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(naming).toContain("lib/firestore/sop-store.ts"); // positive control
  });

  it("only allowlisted files name the collection", () => {
    const unexpected = naming.filter((f) => !ALLOWLIST.has(f));
    expect(unexpected).toEqual([]);
  });

  it("no file under app/api names the collection (routes go through a store)", () => {
    expect(naming.filter((f) => f.startsWith("app/api/"))).toEqual([]);
  });

  it("the read-only sop-store never writes", () => {
    const src = readFileSync(join(ROOT, "lib/firestore/sop-store.ts"), "utf8");
    expect(src).not.toMatch(/\.(set|update|delete|create|add)\(/);
  });
});

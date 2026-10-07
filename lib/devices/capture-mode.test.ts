import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureMode } from "@/lib/devices/capture-mode";

/**
 * Derived capture-mode label (R-07 Task 8, `docs/tasks/R-07-plan.md`):
 * display-only, computed from a paired-device count. Deliberately kept out
 * of the pipeline/debrief/session modules it has nothing to do with — the
 * import-ban test below pins that boundary so a later change can't quietly
 * wire it into pipeline logic.
 */

describe("captureMode", () => {
  it("none for 0 paired devices", () => {
    expect(captureMode(0)).toBe("none");
  });

  it("room for exactly 1 paired device", () => {
    expect(captureMode(1)).toBe("room");
  });

  it("wearable for more than 1 paired device", () => {
    expect(captureMode(2)).toBe("wearable");
    expect(captureMode(7)).toBe("wearable");
  });
});

const ROOT = join(__dirname, "..", "..");
const IMPORT_RE = /from\s+["'][^"']*lib\/devices\/capture-mode["']/;

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

function isBanned(path: string): boolean {
  const rel = path.slice(ROOT.length + 1).replace(/\\/g, "/");
  if (/^lib\/capture\/session/.test(rel)) return true;
  if (/^lib\/pipeline\//.test(rel)) return true;
  if (/^lib\/debrief\//.test(rel)) return true;
  if (rel === "lib/capture/calendar.ts") return true;
  return false;
}

describe("capture-mode import ban", () => {
  it("is never imported by lib/capture/session*, lib/pipeline/**, lib/debrief/**, or lib/capture/calendar.ts", () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(join(ROOT, "lib"))) {
      if (!isBanned(file)) continue;
      const text = readFileSync(file, "utf8");
      if (IMPORT_RE.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

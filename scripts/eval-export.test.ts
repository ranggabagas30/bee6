import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PILOT_PROJECT_ID } from "@/scripts/demo-seed-template";
import { zonedTimeToEpochMs } from "@/lib/capture/calendar";
import type { ExportThread } from "@/lib/eval/export";
import { ExportError, parseCliArgs, runExport, type ExportDeps } from "@/scripts/eval-export";

const BASE = ["--project", "bee6-playground", "--outlet", "demo-outlet", "--from", "2026-10-05", "--to", "2026-10-06", "--out-dir", "/tmp/out"];

describe("parseCliArgs", () => {
  it("parses the full command line and defaults the time zone", () => {
    const a = parseCliArgs(BASE);
    expect(a).toMatchObject({
      project: "bee6-playground",
      outlet: "demo-outlet",
      from: "2026-10-05",
      to: "2026-10-06",
      outDir: path.resolve("/tmp/out"),
      allowPilot: false,
      tz: "Asia/Jakarta",
    });
  });

  it.each(["--project", "--outlet", "--from", "--to", "--out-dir"])("requires %s (the out dir has no default)", (flag) => {
    const argv = [...BASE];
    const i = argv.indexOf(flag);
    argv.splice(i, 2);
    expect(() => parseCliArgs(argv)).toThrow(new RegExp(flag));
  });

  it("rejects malformed or reversed dates", () => {
    expect(() => parseCliArgs(BASE.map((v) => (v === "2026-10-05" ? "5 Oct" : v)))).toThrow(/--from/);
    expect(() => parseCliArgs(BASE.map((v) => (v === "2026-10-06" ? "2026-10-01" : v)))).toThrow(/before/);
  });

  it.each(["2026-02-30", "2026-13-45", "2026-10-00", "2026-04-31", "2025-02-29"])(
    "rejects the impossible calendar date %s with 'must be YYYY-MM-DD'",
    (bad) => {
      expect(() => parseCliArgs(BASE.map((v) => (v === "2026-10-05" ? bad : v)))).toThrow(/--from must be YYYY-MM-DD/);
      expect(() => parseCliArgs(BASE.map((v) => (v === "2026-10-06" ? bad : v)))).toThrow(/--to must be YYYY-MM-DD/);
    },
  );

  it("accepts a real leap day", () => {
    const argv = BASE.map((v) => (v === "2026-10-05" ? "2028-02-29" : v === "2026-10-06" ? "2028-03-01" : v));
    expect(parseCliArgs(argv)).toMatchObject({ from: "2028-02-29", to: "2028-03-01" });
  });

  it("refuses the pilot project unless --allow-pilot", () => {
    const pilot = BASE.map((v) => (v === "bee6-playground" ? PILOT_PROJECT_ID : v));
    expect(() => parseCliArgs(pilot)).toThrow(/pilot/i);
    expect(parseCliArgs([...pilot, "--allow-pilot"]).allowPilot).toBe(true);
  });

  it("refuses an outlet id starting sbx- (judge sandboxes)", () => {
    expect(() => parseCliArgs(BASE.map((v) => (v === "demo-outlet" ? "sbx-0123456789ab" : v)))).toThrow(/sandbox/i);
  });
});

function makeDeps(threads: ExportThread[], existing: string[] = []) {
  const written: Record<string, string> = {};
  const queries: { outlet: string; fromMs: number; toMs: number }[] = [];
  const logs: string[] = [];
  const deps: ExportDeps = {
    fetchThreads: async (outlet, fromMs, toMs) => {
      queries.push({ outlet, fromMs, toMs });
      return { threads, malformed: 1 };
    },
    exists: (file) => existing.includes(file) || file in written,
    makeDir: async () => undefined,
    writeNew: async (file, text) => {
      written[file] = text;
    },
    log: (line) => logs.push(line),
  };
  return { deps, written, queries, logs };
}

const T: ExportThread = {
  thread_id: "thr_secret_id",
  category: "ROUTINE_OPS",
  first_line_start_ms: zonedTimeToEpochMs("2026-10-05", "09:00", "Asia/Jakarta"),
  lines: [{ start_ms: 0, text: "fictional sentence one" }],
};

describe("runExport", () => {
  it("queries [from 00:00, day after --to 00:00) outlet-local and writes the two files", async () => {
    const { deps, written, queries } = makeDeps([T]);
    await runExport(parseCliArgs(BASE), deps);
    expect(queries).toEqual([
      {
        outlet: "demo-outlet",
        fromMs: zonedTimeToEpochMs("2026-10-05", "00:00", "Asia/Jakarta"),
        toMs: zonedTimeToEpochMs("2026-10-07", "00:00", "Asia/Jakarta"),
      },
    ]);
    const names = Object.keys(written).map((f) => path.basename(f)).sort();
    expect(names).toEqual(["episodes-demo-outlet-2026-10-05-2026-10-06-map.csv", "episodes-demo-outlet-2026-10-05-2026-10-06.csv"]);
  });

  it("keeps the thread id out of the episodes file", async () => {
    const { deps, written } = makeDeps([T]);
    await runExport(parseCliArgs(BASE), deps);
    const episodes = Object.entries(written).find(([f]) => !f.endsWith("-map.csv"))![1];
    const map = Object.entries(written).find(([f]) => f.endsWith("-map.csv"))![1];
    expect(episodes).not.toContain("thr_secret_id");
    expect(map).toContain("thr_secret_id");
  });

  it("logs counts only, never line text or ids", async () => {
    const { deps, logs } = makeDeps([T]);
    await runExport(parseCliArgs(BASE), deps);
    const all = logs.join("\n");
    expect(all).toMatch(/1 episode/);
    expect(all).toMatch(/malformed/i);
    expect(all).not.toContain("fictional sentence");
    expect(all).not.toContain("thr_secret_id");
  });

  it("refuses to overwrite an existing file and writes nothing", async () => {
    const args = parseCliArgs(BASE);
    const existing = path.join(args.outDir, "episodes-demo-outlet-2026-10-05-2026-10-06-map.csv");
    const { deps, written } = makeDeps([T], [existing]);
    await expect(runExport(args, deps)).rejects.toBeInstanceOf(ExportError);
    expect(written).toEqual({});
  });

  it("writes nothing and says so when no threads match", async () => {
    const { deps, written, logs } = makeDeps([]);
    await runExport(parseCliArgs(BASE), deps);
    expect(written).toEqual({});
    expect(logs.join("\n")).toMatch(/0 episodes/);
  });
});

describe("read-only guarantee", () => {
  it.each(["scripts/eval-export.ts", "lib/eval/export.ts"])("%s contains no Firestore write call", (rel) => {
    const text = readFileSync(path.join(__dirname, "..", rel), "utf8");
    for (const call of [".set(", ".create(", ".update(", ".delete(", "batch(", "runTransaction("]) {
      expect(text, `${rel} must not contain ${call}`).not.toContain(call);
    }
  });
});

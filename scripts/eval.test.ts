import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildReport, parseCliArgs } from "@/scripts/eval";

const FIXTURE = path.join(__dirname, "eval-fixtures", "gold-fictional.csv");
const bytes = readFileSync(FIXTURE);
const sha = createHash("sha256").update(bytes).digest("hex");

describe("buildReport on the fictional fixture", () => {
  const result = buildReport(bytes, "gold-fictional.csv", "2026-10-11", "internal");

  it("succeeds with no CSV errors", () => {
    expect(result.errors).toEqual([]);
  });

  it("names the snapshot file and its SHA-256, and states n used and skipped", () => {
    expect(result.markdown).toContain("gold-fictional.csv");
    expect(result.markdown).toContain(sha);
    expect(result.markdown).toMatch(/Episodes used: n = 11/);
    expect(result.markdown).toMatch(/skipped \(no gold\): 2/);
    expect(result.markdown).toMatch(/internal-testing and demo-outlet episodes/i);
  });

  it("states the chosen source: internal wording for internal, neutral wording for pilot", () => {
    expect(result.markdown).toMatch(/- Source: internal \(/);
    const pilot = buildReport(bytes, "gold-fictional.csv", "2026-10-11", "pilot");
    expect(pilot.markdown).toMatch(/- Source: pilot \(shop episodes labelled by the team\)/);
    expect(pilot.markdown).not.toMatch(/internal-testing|not shop data|fictional speech/i);
  });

  it("prints the hand-computed headline numbers", () => {
    // 7 of 11 correct; macro-F1 = (8/11 + 4/7 + 1/2) / 3.
    expect(result.markdown).toMatch(/Accuracy: 0\.636/);
    expect(result.markdown).toMatch(/Macro-F1: 0\.600/);
  });

  it("prints the per-category table with support, and lists categories absent from the gold set", () => {
    expect(result.markdown).toMatch(/\| ROUTINE_OPS \| 5 \| 0\.667 \| 0\.800 \| 0\.727 \|/);
    expect(result.markdown).toMatch(/\| CUSTOMER_SERVICE \| 4 \| 0\.667 \| 0\.500 \| 0\.571 \|/);
    expect(result.markdown).toMatch(/\| TRAINING \| 2 \| 0\.500 \| 0\.500 \| 0\.500 \|/);
    expect(result.markdown).toMatch(/absent from the gold set \(listed, not averaged\): .*COMPLAINT/i);
  });

  it("prints the confusion matrix, rows gold and columns predicted", () => {
    expect(result.markdown).toMatch(/\| ROUTINE_OPS \| 4 \| 1 \| 0 \|/);
    expect(result.markdown).toMatch(/\| CUSTOMER_SERVICE \| 1 \| 2 \| 1 \|/);
    expect(result.markdown).toMatch(/\| TRAINING \| 1 \| 0 \| 1 \|/);
  });

  it("prints the rush-hour subset with its own n", () => {
    expect(result.markdown).toMatch(/Rush-hour subset \(n = 7\)/);
    expect(result.markdown).toMatch(/Accuracy: 0\.429/);
  });

  it("prints agreement on the double-labelled episodes", () => {
    expect(result.markdown).toMatch(/Pairs: n = 5/);
    expect(result.markdown).toMatch(/Cohen's kappa: 0\.615/);
    expect(result.markdown).toMatch(/Raw agreement: 0\.800/);
  });

  it("includes the definitions block", () => {
    expect(result.markdown).toMatch(/## Definitions/);
    expect(result.markdown).toMatch(/Macro-F1 = mean F1 over categories with support/);
  });

  it("is byte-identical across runs except the run date line", () => {
    const again = buildReport(bytes, "gold-fictional.csv", "2030-01-01", "internal");
    const strip = (s: string) => s.replace(/^- Run date:.*$/m, "");
    expect(strip(again.markdown)).toBe(strip(result.markdown));
    expect(again.markdown).not.toBe(result.markdown);
  });
});

describe("buildReport edge cases", () => {
  const header = "episode,local_date,start_hm,lines,model_category,gold,gold_2,notes\n";

  it("returns errors (and no report) on an unknown gold category", () => {
    const r = buildReport(Buffer.from(header + "E0007,d,09:00,x,TRAINING,COMPLAIN,,\n"), "x.csv", "2026-10-11", "internal");
    expect(r.errors[0]).toContain("E0007");
    expect(r.markdown).toBe("");
  });

  it("returns an error when no labelled rows remain", () => {
    const r = buildReport(Buffer.from(header + "E0001,d,09:00,x,TRAINING,,,\n"), "x.csv", "2026-10-11", "internal");
    expect(r.errors.join(" ")).toMatch(/no labelled/i);
  });

  it("says agreement is not measured when no gold_2 rows exist", () => {
    const r = buildReport(Buffer.from(header + "E0001,d,09:00,x,TRAINING,TRAINING,,\n"), "x.csv", "2026-10-11", "internal");
    expect(r.errors).toEqual([]);
    expect(r.markdown).toMatch(/not measured \(n = 0\)/);
    expect(r.markdown).toMatch(/Rush-hour subset \(n = 0\)/);
  });

  it("prints n/a (never 0) for a precision that is 0/0", () => {
    const r = buildReport(
      Buffer.from(header + "E0001,d,09:00,x,ROUTINE_OPS,ROUTINE_OPS,,\nE0002,d,09:00,x,ROUTINE_OPS,TRAINING,,\n"),
      "x.csv",
      "2026-10-11",
      "internal",
    );
    expect(r.markdown).toMatch(/\| TRAINING \| 1 \| n\/a \| 0\.000 \| 0\.000 \|/);
  });
});

describe("parseCliArgs", () => {
  it("requires --gold", () => {
    expect(() => parseCliArgs(["--source", "internal"])).toThrow(/--gold/);
    expect(() => parseCliArgs(["--gold", "--source", "internal"])).toThrow(/--gold/);
  });
  it("resolves the gold path", () => {
    expect(parseCliArgs(["--gold", "a/b.csv", "--source", "internal"]).goldPath).toBe(path.resolve("a/b.csv"));
  });
  it("requires --source, with no default", () => {
    expect(() => parseCliArgs(["--gold", "a.csv"])).toThrow(/--source is required.*internal.*pilot/s);
    expect(() => parseCliArgs(["--gold", "a.csv", "--source"])).toThrow(/--source is required/);
  });
  it("accepts internal and pilot, rejects anything else", () => {
    expect(parseCliArgs(["--gold", "a.csv", "--source", "pilot"]).source).toBe("pilot");
    expect(parseCliArgs(["--source", "internal", "--gold", "a.csv"]).source).toBe("internal");
    expect(() => parseCliArgs(["--gold", "a.csv", "--source", "shop"])).toThrow(/--source must be internal or pilot/);
  });
  it("mentions --source in the usage text", () => {
    expect(() => parseCliArgs([])).toThrow(/--source <internal\|pilot>/);
  });
});

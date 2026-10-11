import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readRegionsFile, type RegionsFile } from "@/config/regions";
import {
  REGIONS_END,
  REGIONS_START,
  extractRegionsBlock,
  renderRegionsBlock,
} from "@/scripts/readme-regions";

const entry = (location: string) => ({
  location,
  latency_ms: 100,
  probed_at: "2026-10-01T00:00:00.000Z",
  error: null,
});

const fixture: RegionsFile = {
  version: 0.1,
  probed_at: "2026-10-01T16:40:50.173Z",
  models: {
    "gemini-3.5-transcribe-preview": entry("global"),
    "gemini-3.5-flash-lite": entry("global"),
    "gemini-3.5-flash": entry("asia-southeast1"),
    "gemini-live-debrief": {
      location: "UNPROBED",
      latency_ms: null,
      probed_at: null,
      error: { code: "HTTP_404", message: "not found" },
    },
  },
  services: { dlp: entry("asia-southeast2") },
};

describe("renderRegionsBlock", () => {
  const block = renderRegionsBlock(fixture);

  it("starts with the table header and one row per model, in file order", () => {
    const lines = block.split("\n");
    expect(lines[0]).toBe("| Model | Used for | Location |");
    expect(lines[1]).toBe("| --- | --- | --- |");
    expect(lines[2]).toBe("| `gemini-3.5-transcribe-preview` | Transcription | `global` |");
    expect(lines[3]).toBe("| `gemini-3.5-flash-lite` | Labels | `global` |");
    expect(lines[4]).toBe("| `gemini-3.5-flash` | Proposals | `asia-southeast1` |");
  });

  it("marks an unprobed model as not built / not probed instead of printing UNPROBED", () => {
    expect(block).toContain("| `gemini-live-debrief` | Voice debrief (not built) | Not probed |");
    expect(block).not.toContain("UNPROBED");
  });

  it("lists the DLP service with its probed location", () => {
    expect(block).toContain("| Sensitive Data Protection (service) | Redaction | `asia-southeast2` |");
  });

  it("ends with the probe date (date only)", () => {
    expect(block.trimEnd().split("\n").at(-1)).toBe("Probed on 2026-10-01 (`config/regions.yaml`).");
  });

  it("throws for a model with no Used-for label so the table cannot silently misdescribe it", () => {
    const bad: RegionsFile = { ...fixture, models: { "gemini-new": entry("global") } };
    expect(() => renderRegionsBlock(bad)).toThrow(/gemini-new/);
  });
});

describe("extractRegionsBlock", () => {
  it("returns the text between the markers, trimmed of surrounding newlines", () => {
    const md = `a\n${REGIONS_START}\nline1\nline2\n${REGIONS_END}\nb`;
    expect(extractRegionsBlock(md)).toBe("line1\nline2");
  });

  it("throws when the markers are missing", () => {
    expect(() => extractRegionsBlock("no markers")).toThrow(/regions:start/);
  });
});

describe("README model/region table", () => {
  it("matches the generator output for config/regions.yaml (run `npm run readme:regions` and paste)", () => {
    const readme = readFileSync(path.join(process.cwd(), "README.md"), "utf8");
    const expected = renderRegionsBlock(readRegionsFile());
    expect(extractRegionsBlock(readme)).toBe(expected);
  });
});

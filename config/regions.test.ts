import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import {
  _resetRegionsCacheForTests,
  getModelLocation,
  getServiceLocation,
} from "@/config/regions";

/**
 * getServiceLocation mirrors getModelLocation (hard rule #5: never
 * hard-code a location) but reads the `services` map in regions.yaml —
 * the section used by non-model Google Cloud APIs such as Sensitive Data
 * Protection (DLP), which is probed with its own Jakarta -> Singapore ->
 * global fallback (scripts/probe.ts), the same pattern used for model
 * locations.
 */

function writeTempRegionsFile(doc: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "regions-test-"));
  const file = path.join(dir, "regions.yaml");
  writeFileSync(file, stringify(doc), "utf8");
  return file;
}

afterEach(() => {
  _resetRegionsCacheForTests();
});

describe("getServiceLocation", () => {
  it("returns the probed region entry for a known service", () => {
    const file = writeTempRegionsFile({
      version: 0.1,
      probed_at: "2026-10-01T00:00:00.000Z",
      models: {},
      services: {
        dlp: {
          location: "asia-southeast1",
          latency_ms: 123,
          probed_at: "2026-10-01T00:00:00.000Z",
          error: null,
        },
      },
    });

    const entry = getServiceLocation("dlp", file);

    expect(entry.location).toBe("asia-southeast1");
  });

  it("throws a clear error when the service has no entry", () => {
    const file = writeTempRegionsFile({
      version: 0.1,
      probed_at: null,
      models: {},
      services: {},
    });

    expect(() => getServiceLocation("dlp", file)).toThrow(/no entry/);
  });

  it("throws when the service has never been successfully probed (UNPROBED)", () => {
    const file = writeTempRegionsFile({
      version: 0.1,
      probed_at: null,
      models: {},
      services: {
        dlp: { location: "UNPROBED", latency_ms: null, probed_at: null, error: null },
      },
    });

    expect(() => getServiceLocation("dlp", file)).toThrow(/UNPROBED/);
  });

  it("tolerates a regions.yaml written before `services` existed (back-compat)", () => {
    const file = writeTempRegionsFile({
      version: 0.1,
      probed_at: null,
      models: {
        "gemini-3.5-flash": {
          location: "asia-southeast1",
          latency_ms: 10,
          probed_at: "2026-10-01T00:00:00.000Z",
          error: null,
        },
      },
      // no `services` key at all
    });

    // Models still resolve...
    expect(getModelLocation("gemini-3.5-flash", file).location).toBe("asia-southeast1");
    // ...and a missing services map is a clear "no entry" error, not a crash.
    expect(() => getServiceLocation("dlp", file)).toThrow(/no entry/);
  });
});

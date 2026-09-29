import { describe, expect, it, vi } from "vitest";
import {
  ProbeCallError,
  REGION_ORDER,
  type ModelCaller,
  probeAllModels,
  probeModel,
  toRegionsYamlDoc,
} from "./probe";

const FIXED_NOW = () => "2026-09-30T00:00:00.000Z";

describe("probeModel — retry/fallback ordering", () => {
  it("tries Jakarta, then Singapore, then global, in that order", async () => {
    const seen: string[] = [];
    const callModel: ModelCaller = async (_model, region) => {
      seen.push(region);
      throw new ProbeCallError("UNAVAILABLE", `${region} down`);
    };

    await probeModel("gemini-3.5-flash", callModel, REGION_ORDER, FIXED_NOW);

    expect(seen).toEqual(["asia-southeast2", "asia-southeast1", "global"]);
  });

  it("stops at the first region that succeeds and does not try later regions", async () => {
    const seen: string[] = [];
    const callModel: ModelCaller = async (_model, region) => {
      seen.push(region);
      if (region === "asia-southeast1") {
        return { ok: true, latencyMs: 42 };
      }
      throw new ProbeCallError("UNAVAILABLE", `${region} down`);
    };

    const outcome = await probeModel("gemini-3.5-flash", callModel, REGION_ORDER, FIXED_NOW);

    expect(seen).toEqual(["asia-southeast2", "asia-southeast1"]);
    expect(outcome.location).toBe("asia-southeast1");
    expect(outcome.latencyMs).toBe(42);
    expect(outcome.error).toBeNull();
  });

  it("records a failed region's error code instead of skipping it", async () => {
    const callModel: ModelCaller = async (_model, region) => {
      if (region === "asia-southeast2") {
        throw new ProbeCallError("PERMISSION_DENIED", "no access in Jakarta");
      }
      return { ok: true, latencyMs: 10 };
    };

    const outcome = await probeModel("gemini-3.5-flash", callModel, REGION_ORDER, FIXED_NOW);

    expect(outcome.attempts).toHaveLength(2);
    expect(outcome.attempts[0]).toMatchObject({
      region: "asia-southeast2",
      ok: false,
      error: { code: "PERMISSION_DENIED", message: "no access in Jakarta" },
    });
    expect(outcome.attempts[1]).toMatchObject({ region: "asia-southeast1", ok: true });
  });

  it("marks the model UNPROBED with the last error when every region fails", async () => {
    const callModel: ModelCaller = async (_model, region) => {
      throw new ProbeCallError("NOT_CONFIGURED", `${region} not configured`);
    };

    const outcome = await probeModel("gemini-3.5-flash", callModel, REGION_ORDER, FIXED_NOW);

    expect(outcome.location).toBe("UNPROBED");
    expect(outcome.latencyMs).toBeNull();
    expect(outcome.attempts).toHaveLength(3);
    expect(outcome.error).toEqual({ code: "NOT_CONFIGURED", message: "global not configured" });
  });

  it("records a non-ProbeCallError thrown by the caller with an UNKNOWN code, not silently", async () => {
    const callModel: ModelCaller = async () => {
      throw new Error("boom");
    };

    const outcome = await probeModel("gemini-3.5-flash", callModel, REGION_ORDER, FIXED_NOW);

    expect(outcome.attempts.every((a) => a.error?.code === "UNKNOWN")).toBe(true);
    expect(outcome.error).toEqual({ code: "UNKNOWN", message: "boom" });
  });

  it("gives the same result on a second run against the same (deterministic) caller", async () => {
    const makeCaller = (): ModelCaller => async (_model, region) => {
      if (region === "global") return { ok: true, latencyMs: 99 };
      throw new ProbeCallError("UNAVAILABLE", `${region} down`);
    };

    const first = await probeModel("gemini-3.5-flash", makeCaller(), REGION_ORDER, FIXED_NOW);
    const second = await probeModel("gemini-3.5-flash", makeCaller(), REGION_ORDER, FIXED_NOW);

    expect(second).toEqual(first);
  });
});

describe("probeAllModels", () => {
  it("probes every model key and preserves order", async () => {
    const callModel: ModelCaller = async (_model, region) =>
      region === "asia-southeast2" ? { ok: true, latencyMs: 5 } : { ok: false, code: "X", message: "x" };

    const outcomes = await probeAllModels(
      ["gemini-3.5-transcribe", "gemini-3.5-flash"],
      callModel,
      REGION_ORDER,
      FIXED_NOW,
    );

    expect(outcomes.map((o) => o.model)).toEqual(["gemini-3.5-transcribe", "gemini-3.5-flash"]);
    expect(outcomes.every((o) => o.location === "asia-southeast2")).toBe(true);
  });
});

describe("toRegionsYamlDoc", () => {
  it("shapes a mix of probed and UNPROBED outcomes for regions.yaml", async () => {
    const spy = vi.fn();
    const callModel: ModelCaller = async (model, region) => {
      spy(model, region);
      if (model === "gemini-3.5-flash") throw new ProbeCallError("NOT_CONFIGURED", "no project yet");
      return { ok: true, latencyMs: 7 };
    };

    const outcomes = await probeAllModels(
      ["gemini-3.5-transcribe", "gemini-3.5-flash"],
      callModel,
      REGION_ORDER,
      FIXED_NOW,
    );
    const doc = toRegionsYamlDoc(outcomes, FIXED_NOW());

    expect(doc.models["gemini-3.5-transcribe"]).toEqual({
      location: "asia-southeast2",
      latency_ms: 7,
      probed_at: FIXED_NOW(),
      error: null,
    });
    expect(doc.models["gemini-3.5-flash"]).toEqual({
      location: "UNPROBED",
      latency_ms: null,
      probed_at: null,
      error: { code: "NOT_CONFIGURED", message: "no project yet" },
    });
  });
});

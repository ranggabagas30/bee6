import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateContentResponse } from "@google/genai";
import { callLabelModel, LABEL_MODEL } from "@/lib/pipeline/label/client";
import { buildLabelWireSchema } from "@/lib/pipeline/label/wire-schema";
import type { LabelUnit } from "@/lib/pipeline/windowing";

function makeUnit(): LabelUnit {
  return {
    unit_id: "unit_dev1_w1",
    window_ids: ["w1"],
    lines: [{ line_id: "s1#0", seg_id: "s1", text: "Checked the oven", start_ms: 0, end_ms: 1000 }],
  };
}

const prompt = { systemInstruction: "instructions", userContent: "0: Checked the oven" };
const schema = { type: "object" };
/** The valid wire output below uses thread/id "T1" — a call with 1 new alias and 0 open aliases. */
const wireSchema = buildLabelWireSchema({ new_alias_count: 1, open_alias_count: 0 });

function fakeResponse(text: string): GenerateContentResponse {
  return { text } as unknown as GenerateContentResponse;
}

const VALID_WIRE = {
  lines: [{ i: 0, reply_to: null, thread: "T1" }],
  threads: [
    {
      id: "T1",
      category: "ROUTINE_OPS",
      confidence: 0.95,
      evidence: [0],
      summary: "Checked the oven",
    },
  ],
  non_work_lines: [],
};

describe("callLabelModel", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("returns {kind: 'ok', wire} for a valid structured response", async () => {
    const generate = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify(VALID_WIRE)));

    const result = await callLabelModel(
      { unit: makeUnit(), prompt, schema, wireSchema },
      { generate, project: "proj", resolveLocation: () => "global" },
    );

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.wire).toEqual(VALID_WIRE);
    }
  });

  it("returns {kind: 'retryable_error'} when the upstream call throws", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("network blip"));

    const result = await callLabelModel(
      { unit: makeUnit(), prompt, schema, wireSchema },
      { generate, project: "proj", resolveLocation: () => "global" },
    );

    expect(result.kind).toBe("retryable_error");
  });

  it("returns {kind: 'parse_error'} when the response text is not valid JSON", async () => {
    const generate = vi.fn().mockResolvedValue(fakeResponse("not json {"));

    const result = await callLabelModel(
      { unit: makeUnit(), prompt, schema, wireSchema },
      { generate, project: "proj", resolveLocation: () => "global" },
    );

    expect(result.kind).toBe("parse_error");
  });

  it("returns {kind: 'parse_error'} when valid JSON fails the wire-shape validation", async () => {
    const generate = vi.fn().mockResolvedValue(
      fakeResponse(JSON.stringify({ lines: [], threads: "not-an-array", non_work_lines: [] })),
    );

    const result = await callLabelModel(
      { unit: makeUnit(), prompt, schema, wireSchema },
      { generate, project: "proj", resolveLocation: () => "global" },
    );

    expect(result.kind).toBe("parse_error");
    if (result.kind === "parse_error") {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it("returns {kind: 'parse_error'} when the response uses a thread/id alias outside this call's own set (PR1 fix: full strict validation, not just structural)", async () => {
    const outOfRangeWire = {
      ...VALID_WIRE,
      lines: [{ i: 0, reply_to: null, thread: "T2" }],
      threads: [{ ...VALID_WIRE.threads[0], id: "T2" }],
    };
    const generate = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify(outOfRangeWire)));

    // wireSchema above only offers alias "T1" (1 new alias, 0 open aliases).
    const result = await callLabelModel(
      { unit: makeUnit(), prompt, schema, wireSchema },
      { generate, project: "proj", resolveLocation: () => "global" },
    );

    expect(result.kind).toBe("parse_error");
  });

  it("logs only {unit_id, error_class, zod_issue_path?, zod_issue_code?} on failure — never a raw error message", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("a message that must never be logged"));

    await callLabelModel(
      { unit: makeUnit(), prompt, schema, wireSchema },
      { generate, project: "proj", resolveLocation: () => "global" },
    );

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const loggedArgs = consoleErrorSpy.mock.calls[0] ?? [];
    const loggedPayload = loggedArgs[loggedArgs.length - 1] as Record<string, unknown>;

    expect(Object.keys(loggedPayload).sort()).toEqual(
      ["error_class", "unit_id", "zod_issue_code", "zod_issue_path"].sort(),
    );
    expect(loggedPayload.unit_id).toBe("unit_dev1_w1");
    expect(JSON.stringify(loggedArgs)).not.toMatch(/a message that must never be logged/);
  });

  it("logs the zod issue path/code (never the raw response text) on a parse_error", async () => {
    const generate = vi.fn().mockResolvedValue(fakeResponse("SECRET-RAW-RESPONSE-TEXT{"));

    await callLabelModel(
      { unit: makeUnit(), prompt, schema, wireSchema },
      { generate, project: "proj", resolveLocation: () => "global" },
    );

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const loggedArgs = consoleErrorSpy.mock.calls[0] ?? [];
    expect(JSON.stringify(loggedArgs)).not.toMatch(/SECRET-RAW-RESPONSE-TEXT/);
  });

  it("uses LABEL_MODEL as the model id", () => {
    expect(LABEL_MODEL).toBe("gemini-3.5-flash-lite");
  });
});

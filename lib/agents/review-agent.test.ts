import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { newReviewAgentSession, type ReviewAgentOutcome, type ReviewAgentSession } from "@/lib/reviews/agent/types";

/**
 * Mocks `@google/adk` entirely (no network, no Vertex), as the Proposal v4 runner's test does: the fakes capture
 * every constructor call, `runEphemeral` is driven per test via `runEphemeralImpl`.
 */
const geminiCtorSpy = vi.fn();
const llmAgentCtorSpy = vi.fn();
const functionToolCtorSpy = vi.fn();
const runnerCtorSpy = vi.fn();
const runEphemeralImpl = vi.fn();

class FakeGemini {
  constructor(params: unknown) {
    geminiCtorSpy(params);
  }
}
class FakeLlmAgent {
  constructor(config: Record<string, unknown>) {
    llmAgentCtorSpy(config);
  }
}
class FakeFunctionTool {
  constructor(config: Record<string, unknown>) {
    functionToolCtorSpy(config);
  }
}
class FakeInMemoryRunner {
  constructor(params: unknown) {
    runnerCtorSpy(params);
  }
  runEphemeral(params: unknown) {
    return runEphemeralImpl(params);
  }
}

vi.mock("@google/adk", () => ({
  Gemini: FakeGemini,
  LlmAgent: FakeLlmAgent,
  FunctionTool: FakeFunctionTool,
  InMemoryRunner: FakeInMemoryRunner,
  isFinalResponse: () => false,
  setLogLevel: () => {},
  LogLevel: { ERROR: "ERROR" },
}));

type Ev = Record<string, unknown>;

function trackedEvents(events: Array<Ev | (() => Ev)>) {
  const probe = { consumed: 0, returned: false };
  const gen = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next(): Promise<IteratorResult<Ev>> {
      if (probe.consumed >= events.length) return { done: true, value: undefined };
      const item = events[probe.consumed++]!;
      return { done: false, value: typeof item === "function" ? item() : item };
    },
    async return(): Promise<IteratorResult<Ev>> {
      probe.returned = true;
      return { done: true, value: undefined };
    },
  };
  return { gen, probe };
}

async function* throwsBeforeFirst(error: unknown): AsyncGenerator<never> {
  throw error;
}
async function* neverYields(): AsyncGenerator<never> {
  await new Promise<never>(() => {});
}

const modelCall = (id: string, name: string, usage = { p: 100, c: 10, t: 5 }): Ev => ({
  content: { role: "model", parts: [{ functionCall: { id, name, args: {} } }] },
  usageMetadata: { promptTokenCount: usage.p, candidatesTokenCount: usage.c, thoughtsTokenCount: usage.t },
});
const toolResponse = (id: string, name: string, response: Record<string, unknown> = { ok: true }): Ev => ({
  content: { role: "user", parts: [{ functionResponse: { id, name, response } }] },
});

const ACCEPTED: ReviewAgentOutcome = {
  kind: "accepted",
  draft: { narrative_en: "n".repeat(80), suggested_verdict: "worked", quoted_numbers: [], caveats: [] },
};
const REJECTED: ReviewAgentOutcome = { kind: "rejected", reasons: ["verdict_mismatch"] };

function specs() {
  return [
    { name: "get_change", description: "SENTINEL-DESCRIPTION-A", parameters: z.object({}).strict(), execute: () => ({}) },
    { name: "check_review", description: "SENTINEL-DESCRIPTION-B", parameters: z.object({ x: z.string() }).strict(), execute: () => ({}) },
  ];
}
function inputWith(session: ReviewAgentSession) {
  return { systemInstruction: "SYSTEM-SENTINEL-INSTRUCTION", userContent: "USER-SENTINEL-9", tools: specs(), session };
}

const CTX = { project: "bee6-playground", location: "LOCATION-FROM-YAML", timeoutMs: 1000 };

let consoleSpies: ReturnType<typeof vi.spyOn>[];
beforeEach(() => {
  vi.resetModules();
  consoleSpies = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const load = () => import("@/lib/agents/review-agent");

describe("adkReviewAgent: ADK construction", () => {
  it("Gemini gets the review model, vertexai:true, the given project and location, never an apiKey", async () => {
    const { adkReviewAgent } = await load();
    runEphemeralImpl.mockReturnValue(trackedEvents([]).gen);
    await adkReviewAgent(inputWith(newReviewAgentSession()), CTX);
    expect(geminiCtorSpy).toHaveBeenCalledWith({ model: "gemini-3.5-flash-lite", vertexai: true, project: CTX.project, location: CTX.location });
    expect(geminiCtorSpy.mock.calls[0]?.[0]).not.toHaveProperty("apiKey");
  });

  it("one FunctionTool per spec, passed to a no-transfer LlmAgent named review_agent", async () => {
    const { adkReviewAgent } = await load();
    runEphemeralImpl.mockReturnValue(trackedEvents([]).gen);
    const input = inputWith(newReviewAgentSession());
    await adkReviewAgent(input, CTX);
    expect(functionToolCtorSpy.mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual(input.tools.map((t) => t.name));
    const config = llmAgentCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config.name).toBe("review_agent");
    expect(config.tools).toHaveLength(2);
    expect(config.disallowTransferToParent).toBe(true);
    expect(config.disallowTransferToPeers).toBe(true);
    expect(runnerCtorSpy).toHaveBeenCalledWith(expect.objectContaining({ appName: "bee6-review" }));
  });

  it("no response schema / planner; LOW thinking without thoughts; temperature 0.2; instruction is a function", async () => {
    const { adkReviewAgent } = await load();
    runEphemeralImpl.mockReturnValue(trackedEvents([]).gen);
    await adkReviewAgent(inputWith(newReviewAgentSession()), CTX);
    const config = llmAgentCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const gen = config.generateContentConfig as Record<string, unknown>;
    for (const k of ["responseMimeType", "responseJsonSchema", "responseSchema"]) expect(gen).not.toHaveProperty(k);
    expect(config).not.toHaveProperty("outputSchema");
    expect(config).not.toHaveProperty("planner");
    expect(gen.temperature).toBe(0.2);
    expect(gen.thinkingConfig).toEqual({ thinkingLevel: "LOW", includeThoughts: false });
    expect(gen.abortSignal).toBeInstanceOf(AbortSignal);
    expect((config.instruction as () => string)()).toBe("SYSTEM-SENTINEL-INSTRUCTION");
  });

  it("runEphemeral gets a plain runConfig { maxLlmCalls: 10 }, userId review, the user message, and NO abortSignal", async () => {
    const { adkReviewAgent } = await load();
    runEphemeralImpl.mockReturnValue(trackedEvents([]).gen);
    await adkReviewAgent(inputWith(newReviewAgentSession()), CTX);
    const params = runEphemeralImpl.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.runConfig).toEqual({ maxLlmCalls: 10 });
    expect(Object.getPrototypeOf(params.runConfig)).toBe(Object.prototype);
    expect(params).not.toHaveProperty("abortSignal");
    expect(params.userId).toBe("review");
    expect(params.newMessage).toEqual({ role: "user", parts: [{ text: "USER-SENTINEL-9" }] });
  });

  it("an empty project -> error no_project and never constructs Gemini or LlmAgent", async () => {
    const { adkReviewAgent } = await load();
    const r = await adkReviewAgent(inputWith(newReviewAgentSession()), { ...CTX, project: "" });
    expect(r).toMatchObject({ kind: "error", error_class: "no_project" });
    expect(geminiCtorSpy).not.toHaveBeenCalled();
    expect(llmAgentCtorSpy).not.toHaveBeenCalled();
  });

  it("reuses the Gemini client for the same project and location", async () => {
    const { adkReviewAgent } = await load();
    runEphemeralImpl.mockImplementation(() => trackedEvents([]).gen);
    await adkReviewAgent(inputWith(newReviewAgentSession()), CTX);
    await adkReviewAgent(inputWith(newReviewAgentSession()), CTX);
    expect(geminiCtorSpy).toHaveBeenCalledTimes(1);
  });
});

describe("adkReviewAgent: decisions and usage", () => {
  it("accept on round 1: decided / accepted, usage summed, trace has the ordered tool calls", async () => {
    const { adkReviewAgent } = await load();
    const session = newReviewAgentSession();
    const { gen, probe } = trackedEvents([
      modelCall("c1", "get_change", { p: 100, c: 10, t: 1 }),
      toolResponse("c1", "get_change"),
      modelCall("c2", "get_counts", { p: 200, c: 20, t: 2 }),
      toolResponse("c2", "get_counts"),
      () => {
        session.outcome = ACCEPTED;
        session.checkRounds = 1;
        return modelCall("c3", "check_review", { p: 300, c: 30, t: 3 });
      },
      modelCall("c4", "DONE-turn"),
    ]);
    runEphemeralImpl.mockReturnValue(gen);
    const r = await adkReviewAgent(inputWith(session), CTX);
    expect(r).toMatchObject({ kind: "decided", outcome: ACCEPTED });
    if (r.kind !== "decided") return;
    expect(r.usage).toEqual({ input_tokens: 600, output_tokens: 60, thoughts_tokens: 6 });
    expect(r.trace).toMatchObject({ model_calls: 3, check_rounds: 1, ended_by: "decided" });
    expect(r.trace.tool_calls.map((t) => t.name)).toEqual(["get_change", "get_counts", "check_review"]);
    expect(probe.consumed).toBe(5);
    expect(probe.returned).toBe(true);
  });

  it("revise then accept: two check_review calls, decided / accepted with 2 check rounds", async () => {
    const { adkReviewAgent } = await load();
    const session = newReviewAgentSession();
    runEphemeralImpl.mockReturnValue(
      trackedEvents([
        modelCall("c1", "check_review"),
        () => {
          session.checkRounds = 1;
          return toolResponse("c1", "check_review", { accepted: false, reasons: ["verdict_mismatch"] });
        },
        () => {
          session.outcome = ACCEPTED;
          session.checkRounds = 2;
          return modelCall("c2", "check_review");
        },
      ]).gen,
    );
    const r = await adkReviewAgent(inputWith(session), CTX);
    expect(r).toMatchObject({ kind: "decided", outcome: ACCEPTED, trace: { check_rounds: 2, ended_by: "decided" } });
  });

  it("two failed rounds: decided / rejected (the service then falls back)", async () => {
    const { adkReviewAgent } = await load();
    const session = newReviewAgentSession();
    runEphemeralImpl.mockReturnValue(
      trackedEvents([
        () => {
          session.outcome = REJECTED;
          session.checkRounds = 2;
          return modelCall("c1", "check_review");
        },
      ]).gen,
    );
    expect(await adkReviewAgent(inputWith(session), CTX)).toMatchObject({ kind: "decided", outcome: REJECTED });
  });

  it("no outcome and the generator ends -> error no_decision / model_done", async () => {
    const { adkReviewAgent } = await load();
    runEphemeralImpl.mockReturnValue(trackedEvents([modelCall("c1", "get_change"), { content: { parts: [{ text: "DONE" }] } }]).gen);
    expect(await adkReviewAgent(inputWith(newReviewAgentSession()), CTX)).toMatchObject({
      kind: "error",
      error_class: "no_decision",
      trace: { ended_by: "model_done" },
    });
  });
});

describe("adkReviewAgent: ADK error events", () => {
  const LIMIT = { errorCode: "UNKNOWN_ERROR", errorMessage: "Max number of llm calls limit of 10 exceeded" };
  const ABORT = { errorCode: "UNKNOWN_ERROR", errorMessage: "This operation was aborted" };

  it("limit error event -> error / limit; an earlier outcome still wins (decided / limit)", async () => {
    const { adkReviewAgent } = await load();
    runEphemeralImpl.mockReturnValue(trackedEvents([modelCall("c1", "get_change"), LIMIT]).gen);
    expect(await adkReviewAgent(inputWith(newReviewAgentSession()), CTX)).toMatchObject({ kind: "error", error_class: "limit", trace: { ended_by: "limit" } });

    const session = newReviewAgentSession();
    runEphemeralImpl.mockReturnValue(
      trackedEvents([
        () => {
          session.outcome = ACCEPTED;
          return LIMIT;
        },
      ]).gen,
    );
    expect(await adkReviewAgent(inputWith(session), CTX)).toMatchObject({ kind: "decided", trace: { ended_by: "limit" } });
  });

  it("abort error event -> error / timeout; terminal: later events are not consumed", async () => {
    const { adkReviewAgent } = await load();
    const { gen, probe } = trackedEvents([ABORT, modelCall("c1", "get_change")]);
    runEphemeralImpl.mockReturnValue(gen);
    expect(await adkReviewAgent(inputWith(newReviewAgentSession()), CTX)).toMatchObject({ kind: "error", error_class: "timeout", trace: { ended_by: "timeout" } });
    expect(probe.consumed).toBe(1);
    expect(probe.returned).toBe(true);
  });

  it("any other errorCode -> error / adk_<code> and the message is never returned", async () => {
    const { adkReviewAgent } = await load();
    runEphemeralImpl.mockReturnValue(trackedEvents([{ errorCode: "429", errorMessage: "ERRORMESSAGE-SENTINEL quota" }]).gen);
    const r = await adkReviewAgent(inputWith(newReviewAgentSession()), CTX);
    expect(r).toMatchObject({ kind: "error", error_class: "adk_429", trace: { ended_by: "error" } });
    expect(JSON.stringify(r)).not.toContain("ERRORMESSAGE-SENTINEL");
  });

  it("usage on the error event itself is still summed", async () => {
    const { adkReviewAgent } = await load();
    runEphemeralImpl.mockReturnValue(
      trackedEvents([modelCall("c1", "get_change", { p: 10, c: 1, t: 1 }), { ...LIMIT, usageMetadata: { promptTokenCount: 5 } }]).gen,
    );
    expect((await adkReviewAgent(inputWith(newReviewAgentSession()), CTX)).usage).toEqual({ input_tokens: 15, output_tokens: 1, thoughts_tokens: 1 });
  });

  it("silent abort: the generator ends with an aborted signal and no outcome -> error / timeout", async () => {
    const { adkReviewAgent } = await load();
    async function* silent(): AsyncGenerator<Ev> {
      yield modelCall("c1", "get_change");
      await new Promise((r) => setTimeout(r, 80));
    }
    runEphemeralImpl.mockReturnValue(silent());
    expect(await adkReviewAgent(inputWith(newReviewAgentSession()), { ...CTX, timeoutMs: 20 })).toMatchObject({
      kind: "error",
      error_class: "timeout",
      trace: { ended_by: "timeout" },
    });
  });

  it("a throw with status 503 -> http_503; AbortError -> timeout; an earlier outcome wins", async () => {
    const { adkReviewAgent } = await load();
    runEphemeralImpl.mockReturnValue(throwsBeforeFirst({ status: 503 }));
    expect(await adkReviewAgent(inputWith(newReviewAgentSession()), CTX)).toMatchObject({ kind: "error", error_class: "http_503" });
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    runEphemeralImpl.mockReturnValue(throwsBeforeFirst(abortError));
    expect(await adkReviewAgent(inputWith(newReviewAgentSession()), CTX)).toMatchObject({ kind: "error", error_class: "timeout" });
    const session = newReviewAgentSession();
    async function* decidedThenThrows(): AsyncGenerator<Ev> {
      session.outcome = ACCEPTED;
      throw { status: 500 };
      yield {};
    }
    runEphemeralImpl.mockReturnValue(decidedThenThrows());
    expect(await adkReviewAgent(inputWith(session), CTX)).toMatchObject({ kind: "decided", trace: { ended_by: "error" } });
  });

  it("a construction failure (Gemini throws) is a typed error, never a throw", async () => {
    const { adkReviewAgent } = await load();
    geminiCtorSpy.mockImplementationOnce(() => {
      throw Object.assign(new Error("CTOR-SENTINEL"), { status: 403 });
    });
    const r = await adkReviewAgent(inputWith(newReviewAgentSession()), CTX);
    expect(r).toMatchObject({ kind: "error", error_class: "http_403" });
    expect(JSON.stringify(r)).not.toContain("CTOR-SENTINEL");
  });

  it("a runner that never yields -> backstop at timeoutMs + 5000: error / backstop / timeout", async () => {
    vi.useFakeTimers();
    const { adkReviewAgent } = await load();
    runEphemeralImpl.mockReturnValue(neverYields());
    const promise = adkReviewAgent(inputWith(newReviewAgentSession()), CTX);
    await vi.advanceTimersByTimeAsync(CTX.timeoutMs + 5000);
    expect(await promise).toMatchObject({ kind: "error", error_class: "backstop", trace: { ended_by: "timeout" } });
  });

  it("the backstop respects a decision made before it fired", async () => {
    vi.useFakeTimers();
    const { adkReviewAgent } = await load();
    const session = newReviewAgentSession();
    session.outcome = ACCEPTED;
    runEphemeralImpl.mockReturnValue(neverYields());
    const promise = adkReviewAgent(inputWith(session), CTX);
    await vi.advanceTimersByTimeAsync(CTX.timeoutMs + 5000);
    expect(await promise).toMatchObject({ kind: "decided", trace: { ended_by: "timeout" } });
  });
});

describe("adkReviewAgent: tool-call trace", () => {
  it("a function response carrying { error } flips that call to ok:false (by id)", async () => {
    const { adkReviewAgent } = await load();
    runEphemeralImpl.mockReturnValue(
      trackedEvents([
        modelCall("c1", "check_review"),
        toolResponse("c1", "check_review", { error: "run already decided" }),
        modelCall("c2", "get_counts"),
        toolResponse("c2", "get_counts"),
      ]).gen,
    );
    const r = await adkReviewAgent(inputWith(newReviewAgentSession()), CTX);
    expect(r.trace.tool_calls).toEqual([
      { name: "check_review", ok: false },
      { name: "get_counts", ok: true },
    ]);
  });

  it("a hallucinated or hostile tool name is sanitised to [a-z0-9_], max 40 chars", async () => {
    const { adkReviewAgent } = await load();
    runEphemeralImpl.mockReturnValue(trackedEvents([modelCall("c1", "Get Record Step!! ".repeat(5))]).gen);
    const r = await adkReviewAgent(inputWith(newReviewAgentSession()), CTX);
    expect(r.trace.tool_calls[0]!.name).toMatch(/^[a-z0-9_]{1,40}$/);
  });

  it("the trace and result hold counts and enums only; nothing is logged", async () => {
    const { adkReviewAgent } = await load();
    runEphemeralImpl.mockReturnValue(
      trackedEvents([
        { content: { parts: [{ text: "RESPONSE-SENTINEL" }] } },
        { errorCode: "UNKNOWN_ERROR", errorMessage: "ERRORMESSAGE-SENTINEL This operation was aborted" },
      ]).gen,
    );
    const r = await adkReviewAgent(inputWith(newReviewAgentSession()), CTX);
    runEphemeralImpl.mockReturnValue(throwsBeforeFirst(new Error("THROWN-SENTINEL")));
    await adkReviewAgent(inputWith(newReviewAgentSession()), CTX);
    const sentinels = ["SYSTEM-SENTINEL-INSTRUCTION", "USER-SENTINEL-9", "SENTINEL-DESCRIPTION", "RESPONSE-SENTINEL", "ERRORMESSAGE-SENTINEL", "THROWN-SENTINEL"];
    for (const s of sentinels) expect(JSON.stringify(r)).not.toContain(s);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("module", () => {
  it("imports no createRunConfig and hard-codes no location", () => {
    const source = readFileSync(join(__dirname, "review-agent.ts"), "utf8");
    expect(source).not.toMatch(/import[^;]*createRunConfig/);
    expect(source).not.toMatch(/asia-southeast|["']global["']|us-central|europe-/);
  });
});

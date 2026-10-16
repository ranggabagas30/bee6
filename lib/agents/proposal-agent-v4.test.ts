import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { V4Outcome, V4Session } from "@/lib/proposals/v4/types";

/**
 * Mocks `@google/adk` entirely (no network, no Vertex). The fakes capture every constructor call so the assertions
 * see exactly what the v4 runner handed to ADK, and `runEphemeral` is driven per test via `runEphemeralImpl`.
 * Events are shaped like ADK's (usageMetadata, content.parts[].functionCall / functionResponse, errorCode).
 */
const geminiCtorSpy = vi.fn();
const llmAgentCtorSpy = vi.fn();
const functionToolCtorSpy = vi.fn();
const runEphemeralImpl = vi.fn();
const setLogLevelSpy = vi.fn();

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
  constructor(_params: unknown) {}
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
  setLogLevel: (...args: unknown[]) => setLogLevelSpy(...args),
  LogLevel: { ERROR: "ERROR" },
}));

type Ev = Record<string, unknown>;

/** A manual async generator so the test can see how many events were pulled and whether `return()` ran. */
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
  await new Promise<never>(() => {
    /* never resolves */
  });
}

const modelCall = (id: string, name: string, usage = { p: 100, c: 10, t: 5 }): Ev => ({
  content: { role: "model", parts: [{ functionCall: { id, name, args: {} } }] },
  usageMetadata: { promptTokenCount: usage.p, candidatesTokenCount: usage.c, thoughtsTokenCount: usage.t },
});
const toolResponse = (id: string, name: string, response: Record<string, unknown> = { ok: true }): Ev => ({
  content: { role: "user", parts: [{ functionResponse: { id, name, response } }] },
});

const DECIDED: V4Outcome = { kind: "declined", reason: "no_clear_pattern" };

function makeSession(): V4Session {
  return {
    fetchedSections: new Set(),
    inspectedAliases: new Set(),
    inspectedInterventions: new Set(),
    checkRounds: 0,
    toolCalls: [],
    outcome: null,
  };
}

function specs() {
  return [
    {
      name: "list_sop_sections",
      description: "SENTINEL-DESCRIPTION-A",
      parameters: z.object({}).strict(),
      execute: () => ({ sections: [] }),
    },
    {
      name: "check_proposal",
      description: "SENTINEL-DESCRIPTION-B",
      parameters: z.object({ x: z.string() }).strict(),
      execute: () => ({ passed: true }),
    },
  ];
}

function inputWith(session: V4Session) {
  return {
    systemInstruction: "SYSTEM-SENTINEL-INSTRUCTION",
    userContent: "FACT-SENTINEL-9",
    tools: specs(),
    session,
  };
}

const CTX = { project: "bee6-playground", location: "asia-southeast1", timeoutMs: 1000 };

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  vi.resetModules();
  consoleSpies = [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "info").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
  ];
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function assertNoSentinelLogged(...sentinels: string[]) {
  for (const spy of consoleSpies) {
    for (const call of spy.mock.calls) {
      const serialized = JSON.stringify(call);
      for (const sentinel of sentinels) expect(serialized).not.toContain(sentinel);
    }
  }
}

async function load() {
  return import("@/lib/agents/proposal-agent-v4");
}

describe("adkProposalAgentV4: ADK construction", () => {
  it("Gemini gets vertexai:true, the given project and location, never an apiKey", async () => {
    const { adkProposalAgentV4 } = await load();
    runEphemeralImpl.mockReturnValue(trackedEvents([]).gen);
    await adkProposalAgentV4(inputWith(makeSession()), CTX);
    expect(geminiCtorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ vertexai: true, project: CTX.project, location: CTX.location }),
    );
    expect(geminiCtorSpy.mock.calls[0]?.[0]).not.toHaveProperty("apiKey");
  });

  it("one FunctionTool per spec with the same name, passed as LlmAgent.tools", async () => {
    const { adkProposalAgentV4 } = await load();
    runEphemeralImpl.mockReturnValue(trackedEvents([]).gen);
    const input = inputWith(makeSession());
    await adkProposalAgentV4(input, CTX);
    expect(functionToolCtorSpy).toHaveBeenCalledTimes(input.tools.length);
    expect(functionToolCtorSpy.mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual(
      input.tools.map((t) => t.name),
    );
    const config = llmAgentCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config.tools).toHaveLength(input.tools.length);
  });

  it("LlmAgent has no responseMimeType / responseJsonSchema / outputSchema / planner; thinking is LOW; instruction is a function", async () => {
    const { adkProposalAgentV4 } = await load();
    runEphemeralImpl.mockReturnValue(trackedEvents([]).gen);
    await adkProposalAgentV4(inputWith(makeSession()), CTX);
    const config = llmAgentCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const gen = config.generateContentConfig as Record<string, unknown>;
    expect(gen).not.toHaveProperty("responseMimeType");
    expect(gen).not.toHaveProperty("responseJsonSchema");
    expect(gen).not.toHaveProperty("responseSchema");
    expect(config).not.toHaveProperty("outputSchema");
    expect(config).not.toHaveProperty("planner");
    expect(gen.thinkingConfig).toEqual({ thinkingLevel: "LOW", includeThoughts: false });
    expect(gen.abortSignal).toBeInstanceOf(AbortSignal);
    expect(typeof config.instruction).toBe("function");
    expect((config.instruction as () => string)()).toBe("SYSTEM-SENTINEL-INSTRUCTION");
  });

  it("runEphemeral gets the plain object runConfig { maxLlmCalls: 14 } and NO abortSignal", async () => {
    const { adkProposalAgentV4 } = await load();
    runEphemeralImpl.mockReturnValue(trackedEvents([]).gen);
    await adkProposalAgentV4(inputWith(makeSession()), CTX);
    const params = runEphemeralImpl.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.runConfig).toEqual({ maxLlmCalls: 14 });
    expect(Object.getPrototypeOf(params.runConfig)).toBe(Object.prototype);
    expect(params).not.toHaveProperty("abortSignal");
    expect(params.newMessage).toEqual({ role: "user", parts: [{ text: "FACT-SENTINEL-9" }] });
  });

  it("an empty project -> error no_project, never constructs Gemini / LlmAgent", async () => {
    const { adkProposalAgentV4 } = await load();
    const r = await adkProposalAgentV4(inputWith(makeSession()), { ...CTX, project: "" });
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.error_class).toBe("no_project");
    expect(geminiCtorSpy).not.toHaveBeenCalled();
    expect(llmAgentCtorSpy).not.toHaveBeenCalled();
  });
});

describe("adkProposalAgentV4: decisions and usage", () => {
  it("sums usage over events (never overwrites) and counts model calls", async () => {
    const { adkProposalAgentV4 } = await load();
    const session = makeSession();
    const { gen } = trackedEvents([
      modelCall("c1", "list_sop_sections", { p: 100, c: 10, t: 1 }),
      toolResponse("c1", "list_sop_sections"),
      modelCall("c2", "get_evidence", { p: 200, c: 20, t: 2 }),
      toolResponse("c2", "get_evidence"),
      () => {
        session.outcome = DECIDED;
        session.checkRounds = 1;
        return modelCall("c3", "check_proposal", { p: 300, c: 30, t: 3 });
      },
    ]);
    runEphemeralImpl.mockReturnValue(gen);
    const r = await adkProposalAgentV4(inputWith(session), CTX);
    expect(r.kind).toBe("decided");
    if (r.kind !== "decided") return;
    expect(r.usage).toEqual({ input_tokens: 600, output_tokens: 60, thoughts_tokens: 6 });
    expect(r.trace.model_calls).toBe(3);
    expect(r.trace.check_rounds).toBe(1);
    expect(r.trace.tool_calls.map((t) => t.name)).toEqual(["list_sop_sections", "get_evidence", "check_proposal"]);
  });

  it("usage fields never seen stay null", async () => {
    const { adkProposalAgentV4 } = await load();
    const session = makeSession();
    const { gen } = trackedEvents([
      () => {
        session.outcome = DECIDED;
        return { usageMetadata: { promptTokenCount: 7 } };
      },
    ]);
    runEphemeralImpl.mockReturnValue(gen);
    const r = await adkProposalAgentV4(inputWith(session), CTX);
    expect(r.kind === "decided" && r.usage).toEqual({ input_tokens: 7, output_tokens: null, thoughts_tokens: null });
  });

  it("outcome set and generator ends normally -> decided, ended_by decided", async () => {
    const { adkProposalAgentV4 } = await load();
    const session = makeSession();
    const { gen } = trackedEvents([
      () => {
        session.outcome = DECIDED;
        return toolResponse("c1", "decline");
      },
    ]);
    runEphemeralImpl.mockReturnValue(gen);
    const r = await adkProposalAgentV4(inputWith(session), CTX);
    expect(r).toMatchObject({ kind: "decided", outcome: DECIDED, trace: { ended_by: "decided" } });
  });

  it("breaks as soon as the outcome is set: generator return() runs and later events are never consumed", async () => {
    const { adkProposalAgentV4 } = await load();
    const session = makeSession();
    const { gen, probe } = trackedEvents([
      modelCall("c1", "get_evidence"),
      toolResponse("c1", "get_evidence"),
      () => {
        session.outcome = DECIDED;
        return toolResponse("c2", "check_proposal");
      },
      modelCall("c3", "DONE-turn"),
      { errorCode: "UNKNOWN_ERROR", errorMessage: "This operation was aborted" },
    ]);
    runEphemeralImpl.mockReturnValue(gen);
    const r = await adkProposalAgentV4(inputWith(session), CTX);
    expect(probe.consumed).toBe(3);
    expect(probe.returned).toBe(true);
    expect(r).toMatchObject({ kind: "decided", trace: { ended_by: "decided", model_calls: 1 } });
  });

  it("generator ends with no outcome and no error -> error no_decision, ended_by model_done", async () => {
    const { adkProposalAgentV4 } = await load();
    const { gen } = trackedEvents([modelCall("c1", "get_evidence"), toolResponse("c1", "get_evidence"), { content: { parts: [{ text: "DONE" }] } }]);
    runEphemeralImpl.mockReturnValue(gen);
    const r = await adkProposalAgentV4(inputWith(makeSession()), CTX);
    expect(r).toMatchObject({ kind: "error", error_class: "no_decision", trace: { ended_by: "model_done" } });
  });
});

describe("adkProposalAgentV4: ADK error events", () => {
  const LIMIT = { errorCode: "UNKNOWN_ERROR", errorMessage: "Max number of llm calls limit of 14 exceeded" };
  const ABORT = { errorCode: "UNKNOWN_ERROR", errorMessage: "This operation was aborted" };

  it("limit error event, no outcome -> error / limit", async () => {
    const { adkProposalAgentV4 } = await load();
    runEphemeralImpl.mockReturnValue(trackedEvents([modelCall("c1", "get_evidence"), LIMIT]).gen);
    const r = await adkProposalAgentV4(inputWith(makeSession()), CTX);
    expect(r).toMatchObject({ kind: "error", error_class: "limit", trace: { ended_by: "limit" } });
  });

  it("limit error event AFTER an outcome was set -> decided, ended_by limit (earlier decision wins)", async () => {
    const { adkProposalAgentV4 } = await load();
    const session = makeSession();
    // The outcome is set while the runner pulls the error event, so the break-on-outcome never saw it first.
    const { gen } = trackedEvents([
      modelCall("c1", "check_proposal"),
      () => {
        session.outcome = DECIDED;
        return LIMIT;
      },
    ]);
    runEphemeralImpl.mockReturnValue(gen);
    const r = await adkProposalAgentV4(inputWith(session), CTX);
    expect(r).toMatchObject({ kind: "decided", outcome: DECIDED, trace: { ended_by: "limit" } });
  });

  it("abort error event -> error / timeout; with an earlier outcome -> decided / timeout", async () => {
    const { adkProposalAgentV4 } = await load();
    runEphemeralImpl.mockReturnValue(trackedEvents([ABORT]).gen);
    const a = await adkProposalAgentV4(inputWith(makeSession()), CTX);
    expect(a).toMatchObject({ kind: "error", error_class: "timeout", trace: { ended_by: "timeout" } });

    const session = makeSession();
    runEphemeralImpl.mockReturnValue(
      trackedEvents([
        () => {
          session.outcome = DECIDED;
          return ABORT;
        },
      ]).gen,
    );
    const b = await adkProposalAgentV4(inputWith(session), CTX);
    expect(b).toMatchObject({ kind: "decided", trace: { ended_by: "timeout" } });
  });

  it("any other errorCode -> error / adk_<sanitised>, ended_by error", async () => {
    const { adkProposalAgentV4 } = await load();
    runEphemeralImpl.mockReturnValue(trackedEvents([{ errorCode: "429", errorMessage: "quota exhausted for project X" }]).gen);
    const r = await adkProposalAgentV4(inputWith(makeSession()), CTX);
    expect(r).toMatchObject({ kind: "error", error_class: "adk_429", trace: { ended_by: "error" } });
  });

  it("an error event is terminal: later events are not consumed", async () => {
    const { adkProposalAgentV4 } = await load();
    const { gen, probe } = trackedEvents([ABORT, modelCall("c1", "get_evidence")]);
    runEphemeralImpl.mockReturnValue(gen);
    await adkProposalAgentV4(inputWith(makeSession()), CTX);
    expect(probe.consumed).toBe(1);
    expect(probe.returned).toBe(true);
  });

  it("usage on the error event itself is still summed", async () => {
    const { adkProposalAgentV4 } = await load();
    runEphemeralImpl.mockReturnValue(
      trackedEvents([modelCall("c1", "get_evidence", { p: 10, c: 1, t: 1 }), { ...LIMIT, usageMetadata: { promptTokenCount: 5 } }]).gen,
    );
    const r = await adkProposalAgentV4(inputWith(makeSession()), CTX);
    expect(r.usage).toEqual({ input_tokens: 15, output_tokens: 1, thoughts_tokens: 1 });
  });

  it("generator ends silently with an aborted signal and no outcome -> error / timeout", async () => {
    const { adkProposalAgentV4 } = await load();
    async function* silent(): AsyncGenerator<Ev> {
      yield modelCall("c1", "get_evidence");
      await new Promise((r) => setTimeout(r, 80));
      // ends with no event at all, as ADK does when its own abort signal fires between responses
    }
    runEphemeralImpl.mockReturnValue(silent());
    const r = await adkProposalAgentV4(inputWith(makeSession()), { ...CTX, timeoutMs: 20 });
    expect(r).toMatchObject({ kind: "error", error_class: "timeout", trace: { ended_by: "timeout" } });
  });

  it("a throw with status 503 -> error http_503; a thrown AbortError -> timeout; an earlier outcome still wins", async () => {
    const { adkProposalAgentV4 } = await load();
    runEphemeralImpl.mockReturnValue(throwsBeforeFirst({ status: 503 }));
    expect(await adkProposalAgentV4(inputWith(makeSession()), CTX)).toMatchObject({
      kind: "error",
      error_class: "http_503",
      trace: { ended_by: "error" },
    });

    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    runEphemeralImpl.mockReturnValue(throwsBeforeFirst(abortError));
    expect(await adkProposalAgentV4(inputWith(makeSession()), CTX)).toMatchObject({
      kind: "error",
      error_class: "timeout",
      trace: { ended_by: "timeout" },
    });

    const session = makeSession();
    async function* decidedThenThrows(): AsyncGenerator<Ev> {
      session.outcome = DECIDED;
      throw { status: 500 };
      yield {};
    }
    runEphemeralImpl.mockReturnValue(decidedThenThrows());
    expect(await adkProposalAgentV4(inputWith(session), CTX)).toMatchObject({
      kind: "decided",
      trace: { ended_by: "error" },
    });
  });

  it("a runner that never yields -> backstop at timeoutMs + 5000 (fake timers): error / backstop / timeout", async () => {
    vi.useFakeTimers();
    const { adkProposalAgentV4 } = await load();
    runEphemeralImpl.mockReturnValue(neverYields());
    const promise = adkProposalAgentV4(inputWith(makeSession()), CTX);
    await vi.advanceTimersByTimeAsync(CTX.timeoutMs + 5000);
    expect(await promise).toMatchObject({ kind: "error", error_class: "backstop", trace: { ended_by: "timeout" } });
  });

  it("the backstop respects a decision made before it fired", async () => {
    vi.useFakeTimers();
    const { adkProposalAgentV4 } = await load();
    const session = makeSession();
    session.outcome = DECIDED;
    runEphemeralImpl.mockReturnValue(neverYields());
    const promise = adkProposalAgentV4(inputWith(session), CTX);
    await vi.advanceTimersByTimeAsync(CTX.timeoutMs + 5000);
    expect(await promise).toMatchObject({ kind: "decided", trace: { ended_by: "timeout" } });
  });
});

describe("adkProposalAgentV4: tool-call trace", () => {
  it("a function response carrying { error } flips that call (matched by id) to ok:false", async () => {
    const { adkProposalAgentV4 } = await load();
    runEphemeralImpl.mockReturnValue(
      trackedEvents([
        modelCall("c1", "get_evidence"),
        toolResponse("c1", "get_evidence", { error: "Error in tool 'get_evidence': [zod issue list]" }),
        modelCall("c2", "get_evidence"),
        toolResponse("c2", "get_evidence"),
      ]).gen,
    );
    const r = await adkProposalAgentV4(inputWith(makeSession()), CTX);
    expect(r.trace.tool_calls).toEqual([
      { name: "get_evidence", ok: false },
      { name: "get_evidence", ok: true },
    ]);
  });

  it("a hallucinated tool name (ADK tool-not-found) is recorded ok:false under the name the model sent", async () => {
    const { adkProposalAgentV4 } = await load();
    runEphemeralImpl.mockReturnValue(
      trackedEvents([
        modelCall("c1", "get_record_step"),
        toolResponse("c1", "get_record_step", { error: "Function get_record_step is not found in the toolsDict." }),
        modelCall("c2", "list_sop_sections"),
        toolResponse("c2", "list_sop_sections"),
      ]).gen,
    );
    const r = await adkProposalAgentV4(inputWith(makeSession()), CTX);
    expect(r.trace.tool_calls).toEqual([
      { name: "get_record_step", ok: false },
      { name: "list_sop_sections", ok: true },
    ]);
    // the run continued past it
    expect(r.trace.model_calls).toBe(2);
  });

  it("a 60-char tool name with spaces and capitals is sanitised to at most 40 chars of [a-z0-9_]; empty -> unknown", async () => {
    const { adkProposalAgentV4 } = await load();
    const long = "Get Record Step!! ".repeat(4).slice(0, 60);
    runEphemeralImpl.mockReturnValue(
      trackedEvents([
        modelCall("c1", long),
        toolResponse("c1", long, { error: "Function not found." }),
        modelCall("c2", ""),
      ]).gen,
    );
    const r = await adkProposalAgentV4(inputWith(makeSession()), CTX);
    const [first, second] = r.trace.tool_calls;
    expect(first!.name.length).toBeLessThanOrEqual(40);
    expect(first!.name).toMatch(/^[a-z0-9_]+$/);
    expect(first!.ok).toBe(false);
    expect(second).toEqual({ name: "unknown", ok: true });
  });

  it("falls back to a same-name match when the function response has no usable id", async () => {
    const { adkProposalAgentV4 } = await load();
    runEphemeralImpl.mockReturnValue(
      trackedEvents([
        modelCall("c1", "get_intervention"),
        { content: { role: "user", parts: [{ functionResponse: { name: "get_intervention", response: { error: "x" } } }] } },
      ]).gen,
    );
    const r = await adkProposalAgentV4(inputWith(makeSession()), CTX);
    expect(r.trace.tool_calls).toEqual([{ name: "get_intervention", ok: false }]);
  });

  it("the traced tool calls are capped at 40 (the stored schema limit)", async () => {
    const { adkProposalAgentV4 } = await load();
    const evs = Array.from({ length: 60 }, (_, i) => modelCall(`c${i}`, "get_evidence"));
    runEphemeralImpl.mockReturnValue(trackedEvents(evs).gen);
    const r = await adkProposalAgentV4(inputWith(makeSession()), CTX);
    expect(r.trace.tool_calls).toHaveLength(40);
    expect(r.trace.model_calls).toBe(60);
  });

  it("the trace holds counts and enums only: no prompt, tool description or errorMessage text", async () => {
    const { adkProposalAgentV4 } = await load();
    runEphemeralImpl.mockReturnValue(
      trackedEvents([
        modelCall("c1", "get_evidence"),
        { errorCode: "UNKNOWN_ERROR", errorMessage: "ERRORMESSAGE-SENTINEL This operation was aborted" },
      ]).gen,
    );
    const r = await adkProposalAgentV4(inputWith(makeSession()), CTX);
    const serialized = JSON.stringify(r);
    for (const s of ["SYSTEM-SENTINEL-INSTRUCTION", "FACT-SENTINEL-9", "SENTINEL-DESCRIPTION", "ERRORMESSAGE-SENTINEL"]) {
      expect(serialized).not.toContain(s);
    }
  });

  it("no console call contains the prompt, the response text or an errorMessage, across success and failure", async () => {
    const { adkProposalAgentV4 } = await load();
    runEphemeralImpl.mockReturnValue(
      trackedEvents([
        { content: { parts: [{ text: "RESPONSE-SENTINEL" }] } },
        { errorCode: "UNKNOWN_ERROR", errorMessage: "ERRORMESSAGE-SENTINEL" },
      ]).gen,
    );
    await adkProposalAgentV4(inputWith(makeSession()), CTX);
    runEphemeralImpl.mockReturnValue(throwsBeforeFirst(new Error("THROWN-SENTINEL")));
    await adkProposalAgentV4(inputWith(makeSession()), CTX);
    assertNoSentinelLogged(
      "SYSTEM-SENTINEL-INSTRUCTION",
      "FACT-SENTINEL-9",
      "RESPONSE-SENTINEL",
      "ERRORMESSAGE-SENTINEL",
      "THROWN-SENTINEL",
    );
  });
});

describe("module", () => {
  it("exports the version string and imports no createRunConfig", async () => {
    const { PROPOSAL_AGENT_V4_VERSION } = await load();
    expect(PROPOSAL_AGENT_V4_VERSION).toBe("proposal-v4");
    const source = readFileSync(join(__dirname, "proposal-agent-v4.ts"), "utf8");
    expect(source).not.toMatch(/import[^;]*createRunConfig/);
  });

  it("sets the ADK log level to ERROR at load (via the v3 module it reuses)", async () => {
    await load();
    expect(setLogLevelSpy).toHaveBeenCalledWith("ERROR");
  });
});

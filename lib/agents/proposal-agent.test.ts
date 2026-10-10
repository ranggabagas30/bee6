import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mocks `@google/adk` entirely so this test never makes a real Vertex call
 * (the one real call this task makes is Task 0's spike / QA's manual
 * verification, never in a unit test). The fakes capture every constructor
 * call so assertions can inspect exactly what `proposal-agent.ts` passed to
 * ADK, and `runEphemeral` is driven per-test via `runEphemeralImpl`.
 */
const geminiCtorSpy = vi.fn();
const llmAgentCtorSpy = vi.fn();
const runEphemeralImpl = vi.fn();
const setLogLevelSpy = vi.fn();

class FakeGemini {
  constructor(params: unknown) {
    geminiCtorSpy(params);
  }
}

class FakeLlmAgent {
  config: Record<string, unknown>;
  constructor(config: Record<string, unknown>) {
    llmAgentCtorSpy(config);
    this.config = config;
  }
}

class FakeInMemoryRunner {
  constructor(_params: unknown) {}
  runEphemeral(params: unknown) {
    return runEphemeralImpl(params);
  }
}

function isFinalResponseFake(ev: { final?: boolean }): boolean {
  return ev.final === true;
}

vi.mock("@google/adk", () => ({
  Gemini: FakeGemini,
  LlmAgent: FakeLlmAgent,
  InMemoryRunner: FakeInMemoryRunner,
  isFinalResponse: isFinalResponseFake,
  setLogLevel: (...args: unknown[]) => setLogLevelSpy(...args),
  LogLevel: { ERROR: "ERROR" },
}));

async function* eventsGen(events: Array<Record<string, unknown>>) {
  for (const ev of events) yield ev;
}

async function* neverYields(): AsyncGenerator<never> {
  await new Promise<never>(() => {
    /* never resolves */
  });
}

// Always throws before any yield; the generator shape is what runOnce iterates.
async function* throwsError(error: unknown): AsyncGenerator<never> {
  throw error;
}

const INPUT = {
  systemInstruction: "SYSTEM-SENTINEL-INSTRUCTION",
  userContent: "FACT-SENTINEL-9",
  responseJsonSchema: { type: "object" },
};
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
      for (const sentinel of sentinels) {
        expect(serialized).not.toContain(sentinel);
      }
    }
  }
}

describe("adkProposalModel", () => {
  it("the Gemini constructor receives vertexai: true, the given project and location, never apiKey", async () => {
    const { adkProposalModel } = await import("@/lib/agents/proposal-agent");
    runEphemeralImpl.mockReturnValue(
      eventsGen([{ final: true, content: { parts: [{ text: '{"ok":true}' }] } }]),
    );
    await adkProposalModel(INPUT, CTX);
    expect(geminiCtorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ vertexai: true, project: CTX.project, location: CTX.location }),
    );
    const call = geminiCtorSpy.mock.calls[0]?.[0];
    expect(call).not.toHaveProperty("apiKey");
  });

  it("LlmAgent receives generateContentConfig.responseJsonSchema and a function instruction", async () => {
    const { adkProposalModel } = await import("@/lib/agents/proposal-agent");
    runEphemeralImpl.mockReturnValue(
      eventsGen([{ final: true, content: { parts: [{ text: '{"ok":true}' }] } }]),
    );
    await adkProposalModel(INPUT, CTX);
    const config = llmAgentCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config.generateContentConfig).toMatchObject({ responseJsonSchema: INPUT.responseJsonSchema });
    expect(typeof config.instruction).toBe("function");
    expect((config.instruction as () => string)()).toBe(INPUT.systemInstruction);
  });

  it("thinkingConfig deep-equals LOW/includeThoughts:false, no thinkingBudget, no planner", async () => {
    const { adkProposalModel, PROPOSAL_THINKING_CONFIG } = await import("@/lib/agents/proposal-agent");
    runEphemeralImpl.mockReturnValue(
      eventsGen([{ final: true, content: { parts: [{ text: '{"ok":true}' }] } }]),
    );
    await adkProposalModel(INPUT, CTX);
    const config = llmAgentCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const genConfig = config.generateContentConfig as Record<string, unknown>;
    expect(genConfig.thinkingConfig).toEqual(PROPOSAL_THINKING_CONFIG);
    expect(genConfig.thinkingConfig).toEqual({ thinkingLevel: "LOW", includeThoughts: false });
    expect(genConfig).not.toHaveProperty("thinkingBudget");
    expect(config).not.toHaveProperty("planner");
  });

  it("maps usageMetadata: promptTokenCount/candidatesTokenCount/thoughtsTokenCount -> input/output/thoughts_tokens", async () => {
    const { adkProposalModel } = await import("@/lib/agents/proposal-agent");
    runEphemeralImpl.mockReturnValue(
      eventsGen([
        {
          final: true,
          content: { parts: [{ text: '{"ok":true}' }] },
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 22, thoughtsTokenCount: 284 },
        },
      ]),
    );
    const result = await adkProposalModel(INPUT, CTX);
    expect(result).toEqual({
      kind: "ok",
      text: '{"ok":true}',
      usage: { input_tokens: 100, output_tokens: 22, thoughts_tokens: 284 },
    });
  });

  it("missing thoughtsTokenCount -> thoughts_tokens: null", async () => {
    const { adkProposalModel } = await import("@/lib/agents/proposal-agent");
    runEphemeralImpl.mockReturnValue(
      eventsGen([
        {
          final: true,
          content: { parts: [{ text: '{"ok":true}' }] },
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        },
      ]),
    );
    const result = await adkProposalModel(INPUT, CTX);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.usage.thoughts_tokens).toBeNull();
    }
  });

  it("drops thought parts: returns only the non-thought text, never the thought text", async () => {
    const { adkProposalModel } = await import("@/lib/agents/proposal-agent");
    runEphemeralImpl.mockReturnValue(
      eventsGen([
        {
          final: true,
          content: {
            parts: [
              { thought: true, text: "REASONING-SENTINEL" },
              { text: '{"decision":"propose"}' },
            ],
          },
        },
      ]),
    );
    const result = await adkProposalModel(INPUT, CTX);
    expect(result).toEqual({
      kind: "ok",
      text: '{"decision":"propose"}',
      usage: { input_tokens: null, output_tokens: null, thoughts_tokens: null },
    });
    assertNoSentinelLogged("REASONING-SENTINEL");
  });

  it("an errorCode event -> kind: error", async () => {
    const { adkProposalModel } = await import("@/lib/agents/proposal-agent");
    runEphemeralImpl.mockReturnValue(eventsGen([{ errorCode: "RESOURCE_EXHAUSTED" }]));
    const result = await adkProposalModel(INPUT, CTX);
    expect(result).toEqual({ kind: "error", error_class: "adk_resource_exhausted" });
  });

  it("a throw with status: 503 -> http_503", async () => {
    const { adkProposalModel } = await import("@/lib/agents/proposal-agent");
    runEphemeralImpl.mockReturnValue(throwsError({ status: 503 }));
    const result = await adkProposalModel(INPUT, CTX);
    expect(result).toEqual({ kind: "error", error_class: "http_503" });
  });

  it("an AbortError -> timeout", async () => {
    const { adkProposalModel } = await import("@/lib/agents/proposal-agent");
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    runEphemeralImpl.mockReturnValue(throwsError(abortError));
    const result = await adkProposalModel(INPUT, CTX);
    expect(result).toEqual({ kind: "error", error_class: "timeout" });
  });

  it("empty final text -> empty_response", async () => {
    const { adkProposalModel } = await import("@/lib/agents/proposal-agent");
    runEphemeralImpl.mockReturnValue(eventsGen([{ final: true, content: { parts: [] } }]));
    const result = await adkProposalModel(INPUT, CTX);
    expect(result).toEqual({ kind: "error", error_class: "empty_response" });
  });

  it("a runner that never yields -> timeout (fake timers, the ctx.timeoutMs+5000 backstop)", async () => {
    vi.useFakeTimers();
    const { adkProposalModel } = await import("@/lib/agents/proposal-agent");
    runEphemeralImpl.mockReturnValue(neverYields());
    const promise = adkProposalModel(INPUT, CTX);
    await vi.advanceTimersByTimeAsync(CTX.timeoutMs + 5000);
    const result = await promise;
    expect(result).toEqual({ kind: "error", error_class: "timeout" });
  });

  it("across every case, no console.* call contains the system text, the user sentinel or the response text", async () => {
    const { adkProposalModel } = await import("@/lib/agents/proposal-agent");
    runEphemeralImpl.mockReturnValue(
      eventsGen([{ final: true, content: { parts: [{ text: '{"RESPONSE-SENTINEL":true}' }] } }]),
    );
    await adkProposalModel(INPUT, CTX);
    assertNoSentinelLogged("SYSTEM-SENTINEL-INSTRUCTION", "FACT-SENTINEL-9", "RESPONSE-SENTINEL");
  });

  it("sets the ADK log level to ERROR at module load", async () => {
    await import("@/lib/agents/proposal-agent");
    expect(setLogLevelSpy).toHaveBeenCalledWith("ERROR");
  });

  it("an empty ctx.project -> kind: error, no_project, never throws, never constructs Gemini/LlmAgent", async () => {
    const { adkProposalModel } = await import("@/lib/agents/proposal-agent");
    const result = await adkProposalModel(INPUT, { ...CTX, project: "" });
    expect(result).toEqual({ kind: "error", error_class: "no_project" });
    expect(geminiCtorSpy).not.toHaveBeenCalled();
    expect(llmAgentCtorSpy).not.toHaveBeenCalled();
  });
});

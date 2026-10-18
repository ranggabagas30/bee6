import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DebriefQuestionMoment } from "@/lib/debrief/agent/types";

/**
 * Mocks `@google/adk` entirely (no network, no Vertex), same approach as proposal-agent-v4.test.ts. The fakes capture
 * every constructor call so the assertions see exactly what the runner handed to ADK; `runEphemeral` is driven per
 * test. The tool's `execute` is captured from the FunctionTool constructor and called like ADK would call it.
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

function trackedEvents(events: Array<Ev | (() => Ev | Promise<Ev>)>) {
  const probe = { consumed: 0, returned: false };
  const gen = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next(): Promise<IteratorResult<Ev>> {
      if (probe.consumed >= events.length) return { done: true, value: undefined };
      const item = events[probe.consumed++]!;
      return { done: false, value: typeof item === "function" ? await item() : item };
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

const modelCall = (id: string, usage = { p: 100, c: 10, t: 5 }): Ev => ({
  content: { role: "model", parts: [{ functionCall: { id, name: "check_question", args: {} } }] },
  usageMetadata: { promptTokenCount: usage.p, candidatesTokenCount: usage.c, thoughtsTokenCount: usage.t },
});

const MOMENT: DebriefQuestionMoment = {
  category: "PHONE_CALL",
  category_label_en: "a phone call",
  start_hm: "14:05",
  end_hm: "14:08",
  fired_rule: "always_question",
  lines: ["LINE-SENTINEL-7 There was a phone order for twelve egg tarts.", "I did not read the order back."],
  summary: "Phone order taken, not read back.",
};

const GOOD = "Around 14:05, was there a phone order for twelve egg tarts?";
const BAD_LONG = `Around 14:05, was there a phone order ${"that was taken for the caller ".repeat(5)}?`;

const CTX = { project: "bee6-playground", location: "loc-from-config", timeoutMs: 1000 };

function input() {
  return { moment: MOMENT, staffNames: ["Sari Demo"], outletName: "Demo Bakery" };
}

/** The `execute` ADK would call, captured from the FunctionTool constructor of the latest run. */
function capturedExecute(): (args: unknown) => unknown {
  const cfg = functionToolCtorSpy.mock.calls.at(-1)?.[0] as { execute: (args: unknown) => unknown };
  return cfg.execute;
}

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

async function load() {
  return import("@/lib/agents/debrief-agent");
}

/** Calls the captured tool (as ADK would) from inside the event stream. */
function toolStep(args: unknown, id: string, usage?: { p: number; c: number; t: number }) {
  return (): Ev => {
    capturedToolResults.push(capturedExecute()(args));
    return modelCall(id, usage);
  };
}
let capturedToolResults: unknown[] = [];
beforeEach(() => {
  capturedToolResults = [];
});

describe("adkDebriefAgent: ADK construction", () => {
  it("Gemini: vertexai, the given project and location, the flash-lite constant, never an apiKey", async () => {
    const { adkDebriefAgent } = await load();
    const { DEBRIEF_AGENT_MODEL } = await import("@/lib/debrief/agent/constants");
    runEphemeralImpl.mockReturnValue(trackedEvents([]).gen);
    await adkDebriefAgent(input(), CTX);
    expect(geminiCtorSpy).toHaveBeenCalledWith({
      model: DEBRIEF_AGENT_MODEL,
      vertexai: true,
      project: CTX.project,
      location: CTX.location,
    });
    expect(geminiCtorSpy.mock.calls[0]?.[0]).not.toHaveProperty("apiKey");
  });

  it("exactly ONE FunctionTool, named check_question, with strict zod parameters", async () => {
    const { adkDebriefAgent } = await load();
    runEphemeralImpl.mockReturnValue(trackedEvents([]).gen);
    await adkDebriefAgent(input(), CTX);
    expect(functionToolCtorSpy).toHaveBeenCalledTimes(1);
    const cfg = functionToolCtorSpy.mock.calls[0]?.[0] as { name: string; description: string; parameters: { safeParse: (v: unknown) => { success: boolean } } };
    expect(cfg.name).toBe("check_question");
    expect(cfg.parameters.safeParse({ question_en: "x" }).success).toBe(true);
    expect(cfg.parameters.safeParse({ question_en: "x", extra: 1 }).success).toBe(false);
    const agentCfg = llmAgentCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(agentCfg.tools).toHaveLength(1);
  });

  it("the tool description names every checker reason (so the model can fix them) and no shop text", async () => {
    const { adkDebriefAgent } = await load();
    const { CHECK_RULES } = await import("@/lib/debrief/agent/check");
    runEphemeralImpl.mockReturnValue(trackedEvents([]).gen);
    await adkDebriefAgent(input(), CTX);
    const cfg = functionToolCtorSpy.mock.calls[0]?.[0] as { description: string };
    for (const rule of CHECK_RULES.filter((r) => r !== "schema_invalid")) expect(cfg.description).toContain(rule);
    expect(cfg.description).not.toContain("LINE-SENTINEL-7");
  });

  it("LlmAgent: no responseMimeType / responseJsonSchema / outputSchema / planner; thinking LOW without thoughts; instruction is a function", async () => {
    const { adkDebriefAgent } = await load();
    const { DEBRIEF_SYSTEM_INSTRUCTION } = await import("@/lib/debrief/agent/prompt");
    runEphemeralImpl.mockReturnValue(trackedEvents([]).gen);
    await adkDebriefAgent(input(), CTX);
    const config = llmAgentCtorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const gen = config.generateContentConfig as Record<string, unknown>;
    expect(gen).not.toHaveProperty("responseMimeType");
    expect(gen).not.toHaveProperty("responseJsonSchema");
    expect(gen).not.toHaveProperty("responseSchema");
    expect(config).not.toHaveProperty("outputSchema");
    expect(config).not.toHaveProperty("planner");
    expect(gen.thinkingConfig).toEqual({ thinkingLevel: "LOW", includeThoughts: false });
    expect(gen.abortSignal).toBeInstanceOf(AbortSignal);
    expect(config.disallowTransferToParent).toBe(true);
    expect(config.disallowTransferToPeers).toBe(true);
    expect(typeof config.instruction).toBe("function");
    expect((config.instruction as () => string)()).toBe(DEBRIEF_SYSTEM_INSTRUCTION);
  });

  it("runEphemeral: plain object runConfig { maxLlmCalls: 4 }, NO abortSignal, the built user content", async () => {
    const { adkDebriefAgent } = await load();
    const { buildUserContent } = await import("@/lib/debrief/agent/prompt");
    runEphemeralImpl.mockReturnValue(trackedEvents([]).gen);
    await adkDebriefAgent(input(), CTX);
    const params = runEphemeralImpl.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.runConfig).toEqual({ maxLlmCalls: 4 });
    expect(Object.getPrototypeOf(params.runConfig)).toBe(Object.prototype);
    expect(params).not.toHaveProperty("abortSignal");
    expect(params.newMessage).toEqual({ role: "user", parts: [{ text: buildUserContent(MOMENT) }] });
    expect(params.userId).toBe("debrief");
  });

  it("an empty project -> error no_project, nothing constructed", async () => {
    const { adkDebriefAgent } = await load();
    const r = await adkDebriefAgent(input(), { ...CTX, project: "" });
    expect(r).toMatchObject({ kind: "error", error_class: "no_project", model_calls: 0 });
    expect(geminiCtorSpy).not.toHaveBeenCalled();
    expect(llmAgentCtorSpy).not.toHaveBeenCalled();
    expect(runEphemeralImpl).not.toHaveBeenCalled();
  });
});

describe("adkDebriefAgent: the run", () => {
  it("1. accepted in round 1: the loop breaks on the outcome (trailing DONE turn not consumed), usage summed", async () => {
    const { adkDebriefAgent } = await load();
    const probeHolder: { probe?: { consumed: number; returned: boolean } } = {};
    runEphemeralImpl.mockImplementation(() => {
      const { gen, probe } = trackedEvents([
        toolStep({ question_en: GOOD }, "c1", { p: 100, c: 10, t: 5 }),
        { content: { parts: [{ text: "DONE" }] }, usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 2 } },
      ]);
      probeHolder.probe = probe;
      return gen;
    });
    const r = await adkDebriefAgent(input(), CTX);
    expect(r).toMatchObject({ kind: "accepted", rounds: 1, model_calls: 1, draft: { question_en: GOOD } });
    if (r.kind === "accepted") expect(r.usage).toEqual({ input_tokens: 100, output_tokens: 10, thoughts_tokens: 5 });
    expect(capturedToolResults[0]).toEqual({ accepted: true });
    expect(probeHolder.probe).toEqual({ consumed: 1, returned: true });
  });

  it("the accepted draft is the TRIMMED text", async () => {
    const { adkDebriefAgent } = await load();
    runEphemeralImpl.mockImplementation(() => trackedEvents([toolStep({ question_en: `  ${GOOD}  ` }, "c1")]).gen);
    const r = await adkDebriefAgent(input(), CTX);
    expect(r).toMatchObject({ kind: "accepted", draft: { question_en: GOOD } });
  });

  it("2. a failed round (too_long) is fed back as reasons; the revised draft is accepted in round 2", async () => {
    const { adkDebriefAgent } = await load();
    runEphemeralImpl.mockImplementation(
      () => trackedEvents([toolStep({ question_en: BAD_LONG }, "c1"), toolStep({ question_en: GOOD }, "c2")]).gen,
    );
    const r = await adkDebriefAgent(input(), CTX);
    expect(r).toMatchObject({ kind: "accepted", rounds: 2, model_calls: 2 });
    expect(capturedToolResults[0]).toEqual({ accepted: false, round: 1, rounds_left: 1, reasons: ["too_long"] });
    expect(capturedToolResults[1]).toEqual({ accepted: true });
  });

  it("2b. a negated round-1 draft is fed back with the negation reason AND a fixed revision hint; the positive round 2 is accepted (POSITIVE-notes moment: the test must not enshrine a flip)", async () => {
    const { adkDebriefAgent } = await load();
    runEphemeralImpl.mockImplementation(
      () =>
        trackedEvents([
          toolStep({ question_en: "Around 14:05, was there no phone order for twelve egg tarts?" }, "c1"),
          toolStep({ question_en: GOOD }, "c2"),
        ]).gen,
    );
    const positive: DebriefQuestionMoment = {
      ...MOMENT,
      lines: ["LINE-SENTINEL-7 There was a phone order for twelve egg tarts."],
      summary: "Phone order taken.",
    };
    const r = await adkDebriefAgent({ ...input(), moment: positive }, CTX);
    expect(r).toMatchObject({ kind: "accepted", rounds: 2 });
    expect(capturedToolResults[0]).toMatchObject({ accepted: false, round: 1, rounds_left: 1, reasons: ["negation"] });
    const hints = (capturedToolResults[0] as { hints?: string[] }).hints;
    expect(hints).toHaveLength(1);
    expect(hints?.[0]).toContain("positive");
    expect(hints?.[0]).not.toContain("LINE-SENTINEL-7");
    if (r.kind === "accepted") expect(r.draft.question_en).toBe(GOOD);
  });

  it("2c. a compound round-1 draft gets the compound hint; a failure with no hinted rule carries no hints key", async () => {
    const { adkDebriefAgent } = await load();
    runEphemeralImpl.mockImplementation(
      () =>
        trackedEvents([
          toolStep({ question_en: "Around 14:05, was there a phone order and was it read back?" }, "c1"),
          toolStep({ question_en: GOOD }, "c2"),
        ]).gen,
    );
    await adkDebriefAgent(input(), CTX);
    expect(capturedToolResults[0]).toMatchObject({ reasons: ["compound"] });
    expect((capturedToolResults[0] as { hints: string[] }).hints[0]).toContain("ONE yes/no");
    runEphemeralImpl.mockImplementation(
      () => trackedEvents([toolStep({ question_en: BAD_LONG }, "c1"), toolStep({ question_en: GOOD }, "c2")]).gen,
    );
    capturedToolResults.length = 0;
    await adkDebriefAgent(input(), CTX);
    expect(capturedToolResults[0]).not.toHaveProperty("hints");
  });

  it("3. two failed rounds -> rejected with the LAST reasons; the tool sets the outcome and the loop breaks", async () => {
    const { adkDebriefAgent } = await load();
    const holder: { probe?: { consumed: number; returned: boolean } } = {};
    runEphemeralImpl.mockImplementation(() => {
      const { gen, probe } = trackedEvents([
        toolStep({ question_en: BAD_LONG }, "c1"),
        toolStep({ question_en: "Around 14:05, what was ordered on the phone?" }, "c2"),
        modelCall("c3"),
      ]);
      holder.probe = probe;
      return gen;
    });
    const r = await adkDebriefAgent(input(), CTX);
    expect(r).toMatchObject({ kind: "rejected", rounds: 2, model_calls: 2 });
    if (r.kind === "rejected") expect(r.reasons).toContain("not_yes_no");
    expect(capturedToolResults[1]).toMatchObject({ accepted: false, final: true });
    expect(holder.probe).toEqual({ consumed: 2, returned: true });
  });

  it("4a. an ADK limit error event -> error / limit", async () => {
    const { adkDebriefAgent } = await load();
    runEphemeralImpl.mockReturnValue(
      trackedEvents([modelCall("c1"), { errorCode: "UNKNOWN_ERROR", errorMessage: "Max number of llm calls limit of 4 exceeded" }]).gen,
    );
    expect(await adkDebriefAgent(input(), CTX)).toMatchObject({ kind: "error", error_class: "limit" });
  });

  it("4b. an abort error event -> error / timeout; any other code -> adk_<code>", async () => {
    const { adkDebriefAgent } = await load();
    runEphemeralImpl.mockReturnValue(
      trackedEvents([{ errorCode: "UNKNOWN_ERROR", errorMessage: "This operation was aborted" }]).gen,
    );
    expect(await adkDebriefAgent(input(), CTX)).toMatchObject({ kind: "error", error_class: "timeout" });
    runEphemeralImpl.mockReturnValue(trackedEvents([{ errorCode: "429", errorMessage: "quota exhausted for project X" }]).gen);
    expect(await adkDebriefAgent(input(), CTX)).toMatchObject({ kind: "error", error_class: "adk_429" });
  });

  it("4c. a limit/abort event AFTER an accept does not undo the accept (earlier decision wins)", async () => {
    const { adkDebriefAgent } = await load();
    runEphemeralImpl.mockReturnValue(
      trackedEvents([
        () => {
          capturedExecute()({ question_en: GOOD });
          return { errorCode: "UNKNOWN_ERROR", errorMessage: "This operation was aborted" };
        },
      ]).gen,
    );
    expect(await adkDebriefAgent(input(), CTX)).toMatchObject({ kind: "accepted" });
  });

  it("4d. a throw with status 503 -> error http_503; a thrown AbortError -> timeout", async () => {
    const { adkDebriefAgent } = await load();
    runEphemeralImpl.mockReturnValue(throwsBeforeFirst({ status: 503 }));
    expect(await adkDebriefAgent(input(), CTX)).toMatchObject({ kind: "error", error_class: "http_503" });
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    runEphemeralImpl.mockReturnValue(throwsBeforeFirst(abortError));
    expect(await adkDebriefAgent(input(), CTX)).toMatchObject({ kind: "error", error_class: "timeout" });
  });

  it("5a. generator ends with no outcome and an aborted signal -> error / timeout", async () => {
    const { adkDebriefAgent } = await load();
    async function* silent(): AsyncGenerator<Ev> {
      yield modelCall("c1");
      await new Promise((r) => setTimeout(r, 80));
    }
    runEphemeralImpl.mockReturnValue(silent());
    expect(await adkDebriefAgent(input(), { ...CTX, timeoutMs: 20 })).toMatchObject({ kind: "error", error_class: "timeout" });
  });

  it("5b. generator ends with no outcome and no abort -> error / no_decision", async () => {
    const { adkDebriefAgent } = await load();
    runEphemeralImpl.mockReturnValue(trackedEvents([{ content: { parts: [{ text: "Sure, here is a question" }] } }]).gen);
    expect(await adkDebriefAgent(input(), CTX)).toMatchObject({ kind: "error", error_class: "no_decision" });
  });

  it("7. a runner that never yields -> backstop at timeoutMs + 3000 (fake timers)", async () => {
    vi.useFakeTimers();
    const { adkDebriefAgent } = await load();
    runEphemeralImpl.mockReturnValue(neverYields());
    const promise = adkDebriefAgent(input(), CTX);
    await vi.advanceTimersByTimeAsync(CTX.timeoutMs + 3000);
    expect(await promise).toMatchObject({ kind: "error", error_class: "backstop" });
  });

  it("usage is present on errors too (a failed run still spent tokens)", async () => {
    const { adkDebriefAgent } = await load();
    runEphemeralImpl.mockReturnValue(
      trackedEvents([modelCall("c1", { p: 10, c: 1, t: 1 }), { errorCode: "429", errorMessage: "x", usageMetadata: { promptTokenCount: 5 } }]).gen,
    );
    const r = await adkDebriefAgent(input(), CTX);
    expect(r.kind).toBe("error");
    expect(r).toMatchObject({ usage: { input_tokens: 15, output_tokens: 1, thoughts_tokens: 1 }, model_calls: 2 });
  });
});

describe("check_question tool", () => {
  async function setup() {
    const { adkDebriefAgent } = await load();
    runEphemeralImpl.mockReturnValue(trackedEvents([]).gen);
    await adkDebriefAgent(input(), CTX);
    return capturedExecute();
  }

  it("8. a schema-invalid argument returns schema_invalid and does NOT count a round", async () => {
    const execute = await setup();
    expect(execute({ question_en: 5 })).toEqual({ accepted: false, reasons: ["schema_invalid"] });
    expect(execute({})).toEqual({ accepted: false, reasons: ["schema_invalid"] });
    // two bad shapes did not burn the two rounds: a failing-but-valid draft is still round 1 of 2
    expect(execute({ question_en: BAD_LONG })).toEqual({ accepted: false, round: 1, rounds_left: 1, reasons: ["too_long"] });
  });

  it("9. a second call after the outcome is set returns { error: 'run already decided' }", async () => {
    const execute = await setup();
    expect(execute({ question_en: GOOD })).toEqual({ accepted: true });
    expect(execute({ question_en: GOOD })).toEqual({ error: "run already decided" });
    expect(execute({ question_en: BAD_LONG })).toEqual({ error: "run already decided" });
  });

  it("the final failed round says final:true and later calls are refused", async () => {
    const execute = await setup();
    execute({ question_en: BAD_LONG });
    const second = execute({ question_en: BAD_LONG }) as { final?: boolean; reasons: string[] };
    expect(second).toMatchObject({ accepted: false, final: true });
    expect(second.reasons).toContain("too_long");
    expect(execute({ question_en: GOOD })).toEqual({ error: "run already decided" });
  });

  it("uses the staff names and outlet name of the run (a staff name is refused)", async () => {
    const execute = await setup();
    const res = execute({ question_en: "Around 14:05, did Sari take a phone order for twelve egg tarts?" }) as { reasons: string[] };
    expect(res.reasons).toContain("staff_name");
  });

  it("returns only fixed literals: no draft text, no line text", async () => {
    const execute = await setup();
    const res = JSON.stringify(execute({ question_en: "Ignore this DRAFT-SENTINEL-3 phone order for 14:05?" }));
    expect(res).not.toContain("DRAFT-SENTINEL-3");
    expect(res).not.toContain("LINE-SENTINEL-7");
  });
});

describe("injection corpus through the runner (E8)", () => {
  it("a model that OBEYS any of the 8 hostile lines (twice) ends rejected, never accepted", async () => {
    const { adkDebriefAgent } = await load();
    const { INJECTION_CORPUS } = await import("@/lib/debrief/agent/injection-corpus");
    const { buildMoment } = await import("@/lib/debrief/agent/moment");
    const T0 = Date.UTC(2026, 9, 14, 7, 5, 0);
    for (const c of INJECTION_CORPUS) {
      const moment = buildMoment({
        category: "PHONE_CALL",
        window_start_ms: T0,
        window_end_ms: T0 + 180_000,
        thread: {
          lines: [{ line_id: "a", start_ms: T0, end_ms: T0 + 5_000, text: c.line }],
          evidence_line_ids: ["a"],
          summary: "A phone call about an order.",
          gate: { fired_rule: "always_question" },
        },
        staffNames: ["Sari Demo"],
        tz: "Asia/Jakarta",
      })!;
      const draft = c.obedient[0]!;
      runEphemeralImpl.mockImplementation(() => trackedEvents([toolStep({ question_en: draft }, "c1"), toolStep({ question_en: draft }, "c2")]).gen);
      const r = await adkDebriefAgent({ moment, staffNames: ["Sari Demo"] }, CTX);
      expect(r.kind, c.id).toBe("rejected");
    }
  });
});

describe("hygiene", () => {
  it("no console call contains the prompt, a line, a draft or an errorMessage, on success and failure", async () => {
    const { adkDebriefAgent } = await load();
    runEphemeralImpl.mockImplementation(() =>
      trackedEvents([
        toolStep({ question_en: GOOD }, "c1"),
        { errorCode: "UNKNOWN_ERROR", errorMessage: "ERRORMESSAGE-SENTINEL" },
      ]).gen,
    );
    await adkDebriefAgent(input(), CTX);
    runEphemeralImpl.mockReturnValue(throwsBeforeFirst(new Error("THROWN-SENTINEL")));
    await adkDebriefAgent(input(), CTX);
    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) {
        const text = JSON.stringify(call);
        for (const s of ["LINE-SENTINEL-7", "ERRORMESSAGE-SENTINEL", "THROWN-SENTINEL", GOOD]) expect(text).not.toContain(s);
      }
    }
  });

  it("the result carries no prompt, line, draft-on-error or errorMessage text", async () => {
    const { adkDebriefAgent } = await load();
    runEphemeralImpl.mockReturnValue(
      trackedEvents([{ errorCode: "UNKNOWN_ERROR", errorMessage: "ERRORMESSAGE-SENTINEL This operation was aborted" }]).gen,
    );
    const r = JSON.stringify(await adkDebriefAgent(input(), CTX));
    for (const s of ["LINE-SENTINEL-7", "ERRORMESSAGE-SENTINEL"]) expect(r).not.toContain(s);
  });

  it("the sources have no location literal (hard rule 5) and the runner imports no createRunConfig", () => {
    for (const rel of [
      "lib/agents/debrief-agent.ts",
      "lib/debrief/agent/constants.ts",
      "lib/debrief/agent/check.ts",
      "lib/debrief/agent/prompt.ts",
      "lib/debrief/agent/moment.ts",
      "lib/debrief/agent/view.ts",
      "lib/debrief/agent/flag.ts",
      "lib/debrief/agent/schema.ts",
    ]) {
      const source = readFileSync(join(__dirname, "..", "..", rel), "utf8");
      expect(source, rel).not.toMatch(/asia-southeast|["']global["']|us-central/);
    }
    expect(readFileSync(join(__dirname, "debrief-agent.ts"), "utf8")).not.toMatch(/import[^;]*createRunConfig/);
  });

  it("sets the ADK log level to ERROR at load (via the proposal module it reuses)", async () => {
    await load();
    expect(setLogLevelSpy).toHaveBeenCalledWith("ERROR");
  });
});

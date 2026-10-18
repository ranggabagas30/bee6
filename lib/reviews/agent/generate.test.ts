import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewAgent, ReviewAgentResult } from "@/lib/agents/review-agent";
import { REVIEW_AGENT_MODEL, REVIEW_AGENT_TIMEOUT_MS } from "@/lib/reviews/agent/constants";
import { generateReviewAgent, type ReviewAgentDeps } from "@/lib/reviews/agent/generate";
import { goodDraft, GOOD_NARRATIVE } from "@/lib/reviews/agent/testing";
import { suggestVerdict } from "@/lib/reviews/verdict";
import { shippedVersion } from "@/lib/reviews/testing/fixtures";

const win = (from: string, to: string, days_captured: number, count: number) => ({ from_date: from, to_date: to, days_captured, count });
const before = win("2026-10-10", "2026-10-12", 3, 2);
const after = win("2026-10-13", "2026-10-19", 2, 0);
const USAGE = { input_tokens: 2400, output_tokens: 180, thoughts_tokens: null };
const TRACE = { model_calls: 3, tool_calls: [], check_rounds: 1, ms: 4200, ended_by: "decided" as const };

type RunArgs = Parameters<ReviewAgent>;
/** A fake model that reads through the REAL tools, then submits `draft` to the real check_review. */
function readingAgent(draft: unknown, over: Partial<Extract<ReviewAgentResult, { kind: "decided" }>> = {}): ReviewAgent {
  return async (input) => {
    const call = (name: string, args: unknown = {}) => {
      const t = input.tools.find((x) => x.name === name)!;
      return t.execute(t.parameters.parse(args));
    };
    call("get_change");
    call("get_counts");
    call("get_evidence_sample", { window: "before" });
    call("get_evidence_sample", { window: "after" });
    call("check_review", draft);
    return { kind: "decided", outcome: input.session.outcome!, usage: USAGE, trace: { ...TRACE, check_rounds: input.session.checkRounds }, ...over };
  };
}

const mkDeps = (run: ReviewAgent, over: Partial<ReviewAgentDeps> = {}): ReviewAgentDeps => ({
  run,
  env: { REVIEW_AGENT: "true" },
  project: "bee6-playground",
  resolveLocation: () => "global",
  now_ms: 1_700_000_000_000,
  ...over,
});

const base = (deps: ReviewAgentDeps, over: Record<string, unknown> = {}) => ({
  deps,
  outlet_id: "sbx-aaaaaaaaaaaa",
  sop: shippedVersion(2),
  rationale: "Customers asked staff when items were baked.",
  before: { window: before, candidates: [] },
  after: { window: after, candidates: [] },
  notices: { overlapping_change: false, threads_truncated: false },
  suggestion: suggestVerdict({ before, after, direction: "decrease" }),
  staffNames: ["Sari Demo"],
  ...over,
});

let info: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const logged = () => info.mock.calls.filter((c) => c[0] === "[review] agent").map((c) => c[1] as Record<string, unknown>);

describe("generateReviewAgent", () => {
  it("accepted: returns the stored agent object with rounds and model_calls", async () => {
    const out = await generateReviewAgent(base(mkDeps(readingAgent(goodDraft()))));
    expect(out).toEqual({
      version: "review-v1",
      model: REVIEW_AGENT_MODEL,
      narrative_en: GOOD_NARRATIVE,
      suggested_verdict: "worked",
      caveats: ["short_window", "category_count_not_problem_count"],
      rounds: 1,
      model_calls: 3,
      generated_at_ms: 1_700_000_000_000,
    });
  });

  it("calls resolveLocation with REVIEW_AGENT_MODEL and passes it, the project and the timeout to the runner", async () => {
    const resolveLocation = vi.fn(() => "the-location");
    const run = vi.fn(readingAgent(goodDraft()));
    await generateReviewAgent(base(mkDeps(run, { resolveLocation })));
    expect(resolveLocation).toHaveBeenCalledWith(REVIEW_AGENT_MODEL);
    const [, ctx] = run.mock.calls[0] as RunArgs;
    expect(ctx).toEqual({ project: "bee6-playground", location: "the-location", timeoutMs: REVIEW_AGENT_TIMEOUT_MS });
  });

  it("hands the runner the prompt, the user pointer and the five tools", async () => {
    const run = vi.fn(readingAgent(goodDraft()));
    await generateReviewAgent(base(mkDeps(run)));
    const [input] = run.mock.calls[0] as RunArgs;
    expect(input.userContent).toContain("Review SOP version 2");
    expect(input.systemInstruction).toContain("Submit with check_review");
    expect(input.tools.map((t) => t.name)).toEqual(["get_change", "get_counts", "get_evidence_sample", "check_review", "decline"]);
  });

  it("a second-round acceptance stores rounds 2", async () => {
    const run: ReviewAgent = async (input) => {
      const call = (name: string, args: unknown = {}) => {
        const t = input.tools.find((x) => x.name === name)!;
        return t.execute(t.parameters.parse(args));
      };
      for (const [n, a] of [["get_change", {}], ["get_counts", {}], ["get_evidence_sample", { window: "before" }], ["get_evidence_sample", { window: "after" }]] as const) call(n, a);
      call("check_review", { ...goodDraft(), suggested_verdict: "revise" });
      call("check_review", goodDraft());
      return { kind: "decided", outcome: input.session.outcome!, usage: USAGE, trace: { ...TRACE, model_calls: 5, check_rounds: 2 } };
    };
    expect(await generateReviewAgent(base(mkDeps(run)))).toMatchObject({ rounds: 2, model_calls: 5 });
  });

  it("accepted but the final checkReview fails -> null (defence in depth)", async () => {
    // The runner reports an accepted outcome whose narrative breaks a rule (nothing was inspected either).
    const run: ReviewAgent = async () => ({
      kind: "decided",
      outcome: { kind: "accepted", draft: { ...goodDraft(), caveats: [...goodDraft().caveats] } },
      usage: USAGE,
      trace: { ...TRACE, check_rounds: 1 },
    });
    expect(await generateReviewAgent(base(mkDeps(run)))).toBeNull();
    expect(logged()[0]).toMatchObject({ outcome: "rejected" });
  });

  it("a verdict that disagrees with the rule never comes back (verdict_mismatch)", async () => {
    const run: ReviewAgent = async (input) => {
      for (const w of ["change", "counts", "before", "after"] as const) input.session.inspected.add(w);
      input.session.checkRounds = 1;
      return {
        kind: "decided",
        outcome: { kind: "accepted", draft: { ...goodDraft(), caveats: [...goodDraft().caveats], suggested_verdict: "revert" } },
        usage: USAGE,
        trace: TRACE,
      };
    };
    expect(await generateReviewAgent(base(mkDeps(run)))).toBeNull();
  });

  it.each([
    ["declined", { kind: "decided", outcome: { kind: "declined", reason: "cannot_explain" }, usage: USAGE, trace: TRACE }, "declined"],
    ["rejected", { kind: "decided", outcome: { kind: "rejected", reasons: ["causal_claim"] }, usage: USAGE, trace: TRACE }, "rejected"],
    ["timeout", { kind: "error", error_class: "timeout", usage: USAGE, trace: { ...TRACE, ended_by: "timeout" } }, "timeout"],
    ["backstop", { kind: "error", error_class: "backstop", usage: USAGE, trace: { ...TRACE, ended_by: "timeout" } }, "timeout"],
    ["limit", { kind: "error", error_class: "limit", usage: USAGE, trace: { ...TRACE, ended_by: "limit" } }, "limit"],
    ["no_decision", { kind: "error", error_class: "no_decision", usage: USAGE, trace: { ...TRACE, ended_by: "model_done" } }, "no_decision"],
    ["other error", { kind: "error", error_class: "adk_429", usage: USAGE, trace: { ...TRACE, ended_by: "error" } }, "error"],
  ] as const)("%s -> null and one log line with the %s outcome", async (_n, result, outcome) => {
    const run: ReviewAgent = async () => result as unknown as ReviewAgentResult;
    expect(await generateReviewAgent(base(mkDeps(run)))).toBeNull();
    expect(logged()).toHaveLength(1);
    expect(logged()[0]).toMatchObject({ outcome });
  });

  it("a runner that throws is a null, not a throw", async () => {
    const run: ReviewAgent = async () => {
      throw new Error("SECRET shop text in an error");
    };
    expect(await generateReviewAgent(base(mkDeps(run)))).toBeNull();
    expect(JSON.stringify([...info.mock.calls, ...error.mock.calls])).not.toContain("SECRET");
  });

  it("a location that cannot be resolved is a null, not a throw", async () => {
    const run = vi.fn(readingAgent(goodDraft()));
    const resolveLocation = () => {
      throw new Error("UNPROBED");
    };
    expect(await generateReviewAgent(base(mkDeps(run, { resolveLocation })))).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("a shipped version without a change is a null, not a throw", async () => {
    expect(await generateReviewAgent(base(mkDeps(readingAgent(goodDraft())), { sop: { ...shippedVersion(2), change: undefined } }))).toBeNull();
  });

  it("the log line carries counts and enums only: no text, no name, no id", async () => {
    await generateReviewAgent(base(mkDeps(readingAgent(goodDraft()))));
    const line = logged()[0]!;
    expect(Object.keys(line).sort()).toEqual(
      ["input_tokens", "ms", "model_calls", "outcome", "outlet_id", "output_tokens", "rounds", "thoughts_tokens", "version"].sort(),
    );
    const text = JSON.stringify(info.mock.calls);
    for (const s of [GOOD_NARRATIVE, "Sari", "baking", "Customers asked"]) expect(text).not.toContain(s);
  });

  it("a rejected run logs the rule codes as `reason`", async () => {
    const run: ReviewAgent = async () => ({ kind: "decided", outcome: { kind: "rejected", reasons: ["causal_claim", "number_not_allowed"] }, usage: USAGE, trace: TRACE });
    await generateReviewAgent(base(mkDeps(run)));
    expect(logged()[0]).toMatchObject({ outcome: "rejected", reason: "causal_claim,number_not_allowed" });
  });
});

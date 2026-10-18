import { getModelLocation } from "@/config/regions";
import type { DebriefAgent, DebriefAgentResult } from "@/lib/agents/debrief-agent";
import { checkQuestion, notesHaveNegation, type CheckRule } from "@/lib/debrief/agent/check";
import {
  DEBRIEF_AGENT_MAX_PER_UNIT,
  DEBRIEF_AGENT_MODEL,
  DEBRIEF_AGENT_TIMEOUT_MS,
  DEBRIEF_AGENT_UNIT_GUARD_MS,
  DEBRIEF_AGENT_VERSION,
} from "@/lib/debrief/agent/constants";
import { QuestionAgentSchema } from "@/lib/firestore/schema";
import { buildMoment } from "@/lib/debrief/agent/moment";
import type { DebriefQuestionMoment } from "@/lib/debrief/agent/types";
import type { QuestionWrite, StoredThread, ThreadWrite } from "@/lib/pipeline/tick/types";

/**
 * Tick-time orchestration of the DebriefAgent (docs/tasks/debrief-agent-18oct.md §5.1). Words the gate questions of
 * ONE unit, in place: on an accepted wording it sets `q.agent`; on anything else it touches nothing, so the phone
 * keeps the template (D7). NEVER throws.
 *
 * The gate decides which moments become questions (hard rule 10); this module only picks, among the questions the
 * gate already raised, the ones worth a model call:
 *  - the thread's own gate verdict must be `question` (never a `fact` thread, never an `unlabelled_unit` question);
 *  - a moment with no usable lines (`no_lines`), or whose own notes state a negative fact (English or Bahasa), keeps
 *    the template (`negated_notes`); both are dropped BEFORE the cap, so they never use one of its slots;
 *  - a continuation of an already-open thread with the same category keeps the wording its existing question has
 *    (the store never rewrites it, F3), so it is skipped;
 *  - at most `DEBRIEF_AGENT_MAX_PER_UNIT` of the remaining moments per unit, run in parallel, so a unit pays one agent budget, not three;
 *  - not when the unit has already spent most of its own time budget (the 30 min lease is sized on it).
 * The checker is re-run on the accepted draft before it is stored (defence in depth, one function with the tool).
 *
 * The caller (service.ts) gates this behind `isDebriefAgentEnabled` and imports it dynamically, so with the flag off
 * nothing here is loaded. The ADK runner is imported dynamically too, only when no `run` was injected.
 *
 * Hard rules: no name, id, role or line text is logged (one numeric/enum-only line per candidate, 7); the model
 * location comes from `config/regions.yaml` via `getModelLocation` (5); the wording is accepted only by
 * `checkQuestion`, which is plain code (10).
 */

export interface DebriefAgentDeps {
  /** Test seam: replaces the ADK runner (which is then never imported). */
  run?: DebriefAgent;
  /** Test seam for the flag (read by the caller, not here). */
  env?: Record<string, string | undefined>;
  /** GCP project id. Defaults to `process.env.GOOGLE_CLOUD_PROJECT`. */
  project?: string;
  /** Defaults to `getModelLocation(model).location`. */
  resolveLocation?: (model: string) => string;
  now_ms?: number;
}

export interface WordGateInput {
  outlet_id: string;
  unit_id: string;
  /** Mutated: `agent` is set on an accepted question. */
  questionWrites: QuestionWrite[];
  threadWrites: readonly ThreadWrite[];
  /** The stored thread each continued thread merged into (`null` = a new thread); a missing key counts as new. */
  storedByThread: ReadonlyMap<string, StoredThread | null>;
  staffNames: readonly string[];
  outletName?: string;
  /** The outlet tz, the SAME one the read path uses, so `start_hm` matches the phone byte for byte. */
  tz: string;
  now_ms: number;
  /** Time the unit still has in its own budget; below the agent guard (budget + cold import margin) the agent is skipped. Absent = unlimited. */
  unit_budget_left_ms?: number;
  deps?: DebriefAgentDeps;
}

type SkippedReason = "continuation_same_category" | "no_lines" | "unit_budget" | "negated_notes";

function errorClassOf(error: unknown): string {
  if (error instanceof Error) return error.name || "Error";
  return "unknown";
}

/** One line, counts and enums only. Never the wording, a line, a name or an error message. */
function logCall(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ event: "debrief_agent.call", ...entry }));
}

function usageFields(result: Extract<DebriefAgentResult, { usage: unknown }>) {
  return {
    // Rule CODES of the first failed checker round (fixed literals, never text); [] when round 1 passed.
    reject_reasons: result.reject_reasons ?? [],
    model_calls: result.model_calls,
    ms: result.ms,
    input_tokens: result.usage.input_tokens,
    output_tokens: result.usage.output_tokens,
    thoughts_tokens: result.usage.thoughts_tokens,
  };
}

export async function wordGateQuestions(input: WordGateInput): Promise<void> {
  try {
    await wordGateQuestionsUnsafe(input);
  } catch (error) {
    // Defence in depth: the contract is "never throws". A bug here must cost the wording, never the unit.
    logCall({ outlet_id: input.outlet_id, unit_id: input.unit_id, outcome: "error", error_class: errorClassOf(error) });
  }
}

async function wordGateQuestionsUnsafe(input: WordGateInput): Promise<void> {
  const { outlet_id, unit_id } = input;
  const base = { outlet_id, unit_id };
  const skip = (reason: SkippedReason) => logCall({ ...base, outcome: "skipped", reason });

  const threadsById = new Map(input.threadWrites.map((t) => [t.thread_id, t]));

  // 1 + 2: the gate's own questions, minus the continuations that keep their existing wording.
  const candidates: Array<{ q: QuestionWrite; thread: ThreadWrite }> = [];
  for (const q of input.questionWrites) {
    if (q.kind !== "gate" || !q.thread_id || !q.category || q.category === "NON_WORK") continue;
    const thread = threadsById.get(q.thread_id);
    if (!thread || thread.gate.verdict !== "question") continue;
    const previous = input.storedByThread.get(q.thread_id) ?? null;
    if (previous && previous.status === "open" && previous.category === q.category) {
      skip("continuation_same_category");
      continue;
    }
    candidates.push({ q, thread });
  }

  // 3: build each moment and drop the ones the agent must not word, BEFORE the cap, so a skipped moment never takes
  // one of the DEBRIEF_AGENT_MAX_PER_UNIT slots from a moment that can be worded.
  const eligible: Array<{ q: QuestionWrite; moment: DebriefQuestionMoment }> = [];
  for (const { q, thread } of candidates) {
    const moment = buildMoment({
      category: q.category,
      window_start_ms: q.window_start_ms,
      window_end_ms: q.window_end_ms,
      thread: {
        lines: thread.lines,
        evidence_line_ids: thread.evidence_line_ids,
        summary: thread.summary,
        gate: { fired_rule: thread.gate.fired_rule },
      },
      staffNames: input.staffNames,
      ...(input.outletName === undefined ? {} : { outletName: input.outletName }),
      tz: input.tz,
    });
    if (!moment) {
      skip("no_lines");
      continue;
    }
    // A moment whose notes are a negative fact ("I did not read the order back") is never worded: any positive
    // yes/no about it gets an honest No, and a No on a gate question drops the true evidence (staff_rejected).
    if (notesHaveNegation(moment.lines, moment.summary)) {
      skip("negated_notes");
      continue;
    }
    eligible.push({ q, moment });
  }

  // 4: the cap, in unit order, over the moments that can actually be worded.
  const work = eligible.slice(0, DEBRIEF_AGENT_MAX_PER_UNIT);
  if (work.length === 0) return;

  if (input.unit_budget_left_ms !== undefined && input.unit_budget_left_ms < DEBRIEF_AGENT_UNIT_GUARD_MS) {
    for (let i = 0; i < work.length; i += 1) skip("unit_budget");
    return;
  }

  // Resolved once per unit, only when there is something to word. Any failure keeps every template.
  let run: DebriefAgent;
  let location: string;
  const deps = input.deps ?? {};
  try {
    location = (deps.resolveLocation ?? ((model: string) => getModelLocation(model).location))(DEBRIEF_AGENT_MODEL);
    run = deps.run ?? (await import("@/lib/agents/debrief-agent")).adkDebriefAgent;
  } catch (error) {
    for (let i = 0; i < work.length; i += 1) logCall({ ...base, outcome: "error", error_class: errorClassOf(error) });
    return;
  }
  const project = deps.project ?? process.env.GOOGLE_CLOUD_PROJECT ?? "";
  const generatedAt = deps.now_ms ?? input.now_ms;

  await Promise.all(
    work.map(async ({ q, moment }) => {
      let result: DebriefAgentResult;
      try {
        result = await run(
          {
            moment,
            staffNames: input.staffNames,
            ...(input.outletName === undefined ? {} : { outletName: input.outletName }),
          },
          { project, location, timeoutMs: DEBRIEF_AGENT_TIMEOUT_MS },
        );
      } catch (error) {
        logCall({ ...base, outcome: "error", error_class: errorClassOf(error) });
        return;
      }

      if (result.kind === "error") {
        logCall({ ...base, outcome: "error", error_class: result.error_class, ...usageFields(result) });
        return;
      }
      if (result.kind === "rejected") {
        logCall({ ...base, outcome: "rejected", reasons: result.reasons, rounds: result.rounds, ...usageFields(result) });
        return;
      }

      // Accepted by the runner's tool: re-run the SAME checker on the draft that is about to be stored.
      const checked = checkQuestion(result.draft, {
        moment,
        staffNames: input.staffNames,
        ...(input.outletName === undefined ? {} : { outletName: input.outletName }),
      });
      if (!checked.passed) {
        const reasons: CheckRule[] = checked.reasons;
        logCall({ ...base, outcome: "rejected", reasons, rounds: result.rounds, ...usageFields(result) });
        return;
      }
      // The storage schema decides what may be written: an object that would later fail `QuestionSchema.parse` (and
      // cost the whole unit in the tick-store) is dropped here, so a wording problem only ever costs the wording.
      const candidate = QuestionAgentSchema.safeParse({
        version: DEBRIEF_AGENT_VERSION,
        model: DEBRIEF_AGENT_MODEL,
        category: moment.category,
        start_hm: moment.start_hm,
        question_en: result.draft.question_en.trim(),
        rounds: result.rounds,
        generated_at_ms: generatedAt,
      });
      if (!candidate.success) {
        // Numbers and enums only: no wording and no zod message (they could echo the text).
        logCall({ ...base, outcome: "error", error_class: "agent_schema", rounds: result.rounds, ...usageFields(result) });
        return;
      }
      q.agent = candidate.data;
      logCall({ ...base, outcome: "accepted", rounds: result.rounds, ...usageFields(result) });
    }),
  );
}

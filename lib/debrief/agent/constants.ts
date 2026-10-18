import { QUESTION_LINE_MAX_CHARS } from "@/lib/debrief/constants";

/**
 * DebriefAgent constants (docs/tasks/debrief-agent-18oct.md §3.6). Plain values, no logic, no I/O.
 *
 * The model is ONE constant (Rangga, 18 Oct): flash-lite by default; switch to `gemini-3.5-flash` here (and only
 * here) if the eval shows fewer than 85 % of questions accepted within two rounds. The model's location is NEVER a
 * literal in this feature: callers read it from `config/regions.yaml` via `getModelLocation(DEBRIEF_AGENT_MODEL)`
 * (hard rule 5).
 */
export const DEBRIEF_AGENT_VERSION = "debrief-q-v1" as const;

/** The only two models a stored `agent.model` may name (the storage schema is an enum of exactly these). */
export const DEBRIEF_AGENT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.5-flash"] as const;
export type DebriefAgentModel = (typeof DEBRIEF_AGENT_MODELS)[number];

export const DEBRIEF_AGENT_MODEL: DebriefAgentModel = "gemini-3.5-flash-lite";

export const DEBRIEF_AGENT_MAX_ROUNDS = 2;
/** ADK `runConfig.maxLlmCalls`. */
export const DEBRIEF_AGENT_MAX_MODEL_CALLS = 4;
/** genai `abortSignal` timeout per question. */
export const DEBRIEF_AGENT_TIMEOUT_MS = 8_000;
/** Extra wall time past the timeout before the backstop gives up on a runner that ignores the abort signal. */
export const DEBRIEF_AGENT_BACKSTOP_MARGIN_MS = 3_000;
/**
 * The most wall time ONE unit's agent step can add: the per-question timeout plus the backstop margin. The (at most
 * 3) questions of a unit run in parallel (`Promise.all`), so the unit pays this once, not per question. The tick
 * runs the agent only while the unit has at least this much of its own budget left (word.ts), so a unit never
 * exceeds the per-unit budget the 30 min lease is sized on (service.ts `UNIT_BUDGET_MS`).
 */
export const DEBRIEF_AGENT_UNIT_BUDGET_MS = DEBRIEF_AGENT_TIMEOUT_MS + DEBRIEF_AGENT_BACKSTOP_MARGIN_MS;
/** The one-off cold start of the ADK import (1-3 s, first question of an instance), not covered by the timeout. */
export const DEBRIEF_AGENT_COLD_START_MARGIN_MS = 2_000;
/** The unit time the tick must still have before it runs the agent: the budget plus the cold import margin. */
export const DEBRIEF_AGENT_UNIT_GUARD_MS = DEBRIEF_AGENT_UNIT_BUDGET_MS + DEBRIEF_AGENT_COLD_START_MARGIN_MS;
export const DEBRIEF_AGENT_MAX_PER_UNIT = 3;
export const DEBRIEF_AGENT_MAX_LINES = 6;
/** === the quoted-line cap of the read path: imported, never redefined. */
export const DEBRIEF_AGENT_LINE_MAX_CHARS = QUESTION_LINE_MAX_CHARS;
export const DEBRIEF_AGENT_SUMMARY_MAX_CHARS = 300;

export const DEBRIEF_QUESTION_MIN_CHARS = 20;
export const DEBRIEF_QUESTION_MAX_CHARS = 140;

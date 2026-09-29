/**
 * Understanding pipeline (E3 in docs/specs/pipeline-and-agents.md).
 *
 * This folder is a placeholder for R-01. Later tasks will add, in order:
 *   - R-05a: windowing (close a window on >=90s silence or at 6 min),
 *     the thread builder, and the evidence gate as plain code — a label
 *     becomes a fact only if the gate's rules pass; otherwise it becomes
 *     a debrief question (CLAUDE.md hard rule #10).
 *   - R-05b: the Gemini 3.5 Flash-Lite label call (threads, category,
 *     work vs private) that feeds the gate.
 *
 * Nothing here calls a model yet. When it does, the model's region must
 * come from `config/regions.ts` — never a hard-coded location.
 */

export {};

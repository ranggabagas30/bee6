import { z } from "zod";

/**
 * R-24 slice A3: the `PROPOSAL_AGENT_V4` flag and the estimated-wait constant (plan v3, D6, D11, D18).
 *
 * Pure and server-safe (no I/O, no `@google/adk`, no store): `app/proposals/page.tsx` reads the estimate here at
 * request time and hands it to the client as a prop, so a runtime Cloud Run env var reaches the screen (a
 * `NEXT_PUBLIC_*` value is build-time and would not).
 */

/** Exactly `"true"` enables the v4 (tool-using) Proposal agent; absent or anything else keeps the v3 path (D6). */
export function isProposalAgentV4Enabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PROPOSAL_AGENT_V4 === "true";
}

/** The range shown while an Ask runs, in whole seconds. `max_s` is also when the screen switches to the overrun line. */
export const AskEstimateSchema = z
  .object({ min_s: z.number().int().min(1), max_s: z.number().int().min(1) })
  .strict()
  .refine((e) => e.max_s >= e.min_s, { message: "max_s must be at least min_s" });
export type AskEstimate = z.infer<typeof AskEstimateSchema>;

/**
 * Single focus, flag on (D18, from the spike: plain p50 9.9 s, one revise round p95 25.6 s). A second focus or a v3
 * fallback runs past it; the "longer than usual" line covers that.
 */
export const V4_ASK_ESTIMATE = { min_s: 10, max_s: 30 } as const satisfies AskEstimate;

/** The estimate to show on the Ask screen: the constant when the v4 flag is on, else `null` (today's screen, unchanged). */
export function readAskEstimate(env: Record<string, string | undefined> = process.env): AskEstimate | null {
  return isProposalAgentV4Enabled(env) ? { ...V4_ASK_ESTIMATE } : null;
}

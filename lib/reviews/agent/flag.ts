import { SANDBOX_OUTLET_PREFIX } from "@/lib/demo/constants";
import type { Outlet } from "@/lib/firestore/schema";
import { REVIEW_AGENT_ESTIMATE } from "@/lib/reviews/agent/constants";

/**
 * The ReviewAgent switch (docs/tasks/review-agent-18oct.md §5.3, D17). On only when `REVIEW_AGENT` is exactly
 * `"true"` AND the outlet is a demo SANDBOX: `project_kind === "demo"`, a `sandbox` block, and the `sbx-` id prefix
 * (the test `enforceDemoCapsForRoute` and the DebriefAgent flag use). All three, so a stray flag on the pilot or on
 * the shared demo outlet is harmless. Default OFF; pure, no I/O; the env is passed in and read per call.
 */
export function isReviewAgentEnabled(
  env: Record<string, string | undefined>,
  outlet: Pick<Outlet, "outlet_id" | "project_kind" | "sandbox">,
): boolean {
  return (
    env.REVIEW_AGENT === "true" &&
    outlet.project_kind === "demo" &&
    outlet.sandbox !== undefined &&
    outlet.outlet_id.startsWith(SANDBOX_OUTLET_PREFIX)
  );
}

/**
 * Page prop for the Reviews screen (same pattern as `readAskEstimate`): the estimate when the flag is on, else
 * `null`. Read from the env at request time, so a runtime Cloud Run variable reaches the client.
 */
export function readReviewAgentEstimate(
  env: Record<string, string | undefined> = process.env,
): { min_s: number; max_s: number } | null {
  return env.REVIEW_AGENT === "true" ? { ...REVIEW_AGENT_ESTIMATE } : null;
}

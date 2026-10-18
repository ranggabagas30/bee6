import { SANDBOX_OUTLET_PREFIX } from "@/lib/demo/constants";

/**
 * The DebriefAgent switch (docs/tasks/debrief-agent-18oct.md §3.5, D8). On only when `DEBRIEF_AGENT` is exactly
 * `"true"` AND the outlet is a demo sandbox (`sbx-` id prefix, the same test `enforceDemoCapsForRoute` uses). The
 * prefix makes a stray flag on the pilot harmless. Default OFF; pure, no I/O; the env is passed in so a test needs
 * no `process.env` mutation, and the caller reads it per call (never cached at module load).
 */
export function isDebriefAgentEnabled(env: Record<string, string | undefined>, outletId: string): boolean {
  return env.DEBRIEF_AGENT === "true" && outletId.startsWith(SANDBOX_OUTLET_PREFIX);
}

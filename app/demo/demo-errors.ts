import type { DictKey } from "@/lib/i18n/dict";
import type { DemoRefusal } from "@/app/demo/demo-client";

/**
 * Maps a refusal from the demo session route to copy keys (R-12 Task 8.3). The server's own message is
 * never rendered: only these keys. `Record<DemoRefusal["kind"], DictKey>` makes the map exhaustive, so a
 * new refusal kind is a type error until it has a line.
 */

const MESSAGE: Record<DemoRefusal["kind"], DictKey> = {
  rate_limited: "C-demo-err-limit",
  daily_cap: "C-demo-err-cap",
  busy: "C-demo-err-busy",
  not_ready: "C-demo-err-not-ready",
  sandbox_expired: "C-demo-expired",
  off: "C-demo-err-not-ready",
  error: "C-srv-generic",
};

export interface CopyRef {
  key: DictKey;
  vars?: { n: number };
}

/** A Retry-After in seconds as a friendly line. 20 h or more reads as tomorrow (the daily limits reset at UTC midnight). */
export function retryHint(seconds: number | null): CopyRef {
  if (seconds === null) return { key: "C-demo-retry-later" };
  if (seconds < 60) return { key: "C-demo-retry-soon" };
  if (seconds <= 90 * 60) return { key: "C-demo-retry-min", vars: { n: Math.ceil(seconds / 60) } };
  if (seconds >= 20 * 3600) return { key: "C-demo-retry-tomorrow" };
  return { key: "C-demo-retry-hr", vars: { n: Math.ceil(seconds / 3600) } };
}

export function refusalLines(refusal: DemoRefusal): { message: DictKey; hint: CopyRef | null } {
  // Only the three throttling refusals carry a wait; the others have no "try again in N" line.
  const hint =
    refusal.kind === "rate_limited" || refusal.kind === "daily_cap" || refusal.kind === "busy"
      ? retryHint(refusal.retryAfterSeconds)
      : null;
  return { message: MESSAGE[refusal.kind], hint };
}

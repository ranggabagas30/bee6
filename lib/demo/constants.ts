/**
 * R-12 demo constants. Plain numbers and ids shared by the clone, the store, the limits and the
 * service, so no file types a magic number by hand. Demo project only; nothing here is read on
 * the pilot (every R-12 path first checks DEMO_MODE).
 */

/** The template outlet seeded through the real pipeline; its device id. Unique tokens: neither is a substring of the other. */
export const TEMPLATE_OUTLET_ID = "demo-tpl-outlet";
export const TEMPLATE_DEVICE_ID = "demo-tpl-phone";

/** Sandbox outlets and judge devices: `sbx-<12 hex>` / `jdg-<12 hex>`. */
export const SANDBOX_OUTLET_PREFIX = "sbx-";
export const JUDGE_DEVICE_PREFIX = "jdg-";

/** A role session lasts 2 hours from creation (T-708), not from the last role switch. */
export const SANDBOX_TTL_MS = 2 * 60 * 60_000;
/** Expired sandboxes are deleted only after this extra grace (a judge may still be inside; E18). */
export const CLEANUP_GRACE_MS = 24 * 60 * 60_000;

/** R-19 D-2: the template is routine-only, so nothing is carried into the judge's debrief (was 2 in R-18; the "Earlier day" chip code stays but never fires). */
export const CARRY_OVER_MAX = 0;
/** R-19 Q4: the hard stop of a sandbox demo day (started_at + this): 20 min, the escape hatch for a stuck judge (was 5 min in R-18, 10 min in R-20). */
export const DEMO_SESSION_MAX_MS = 1_200_000;
/** R-19: the judge journey is 3 demo days; the sandbox clock jumps at most NEXT_DAY_MAX = DEMO_DAYS_TOTAL - 1 times. */
export const DEMO_DAYS_TOTAL = 3;
export const NEXT_DAY_MAX = 2;

/** The template must stay under this many docs; over it the clone refuses (503 template_too_large). */
export const TEMPLATE_DOC_MAX = 400;
/** Firestore allows 500 writes per batch; stay below it. */
export const WRITE_BATCH_MAX = 400;

// Rate limits and caps (defaults, R-12 section 11 Q-3).
export const SANDBOX_IP_DAILY = 10;
export const SANDBOX_DAILY = 300;
export const SWITCHES_PER_SANDBOX = 30;
/** Role-switch (sandbox_key) requests per network per day; bounds the Firestore key lookups a bogus key costs. */
export const SWITCH_IP_DAILY = 60;
/** R-19: 8 (was 5): Ask after day 1 + Ask + Another + retries. */
export const GENERATE_PER_SANDBOX = 8;
export const GENERATE_DAILY = 300;
/** Segment uploads (Gemini transcription + Sensitive Data Protection) per judge sandbox, and per day across all of them. */
/** R-19: 150 (was 60): 3 days x up to 10 min. */
export const SEGMENT_PER_SANDBOX = 150;
export const SEGMENT_DAILY = 3000;
/** Simulated review fast-forwards per sandbox (writes only, no model call). */
export const FAST_FORWARD_PER_SANDBOX = 3;
/** Sensitive Data Protection calls on typed text (answers, rejection reasons, verdicts, constraints) per sandbox. */
export const REDACT_PER_SANDBOX = 60;
/**
 * INTERIM form of the CLAUDE.md section 7 DAILY_TOKEN_CEILING, demo project only: a per-day COUNT of
 * model-calling requests (Gemini or Sensitive Data Protection) across every sandbox. Not a token or
 * per-outlet ceiling; the real one is a separate task.
 */
export const MODEL_DAILY = 5000;

/** R-19: owner resets of one sandbox (counter `reset_sandbox`). */
export const RESET_PER_SANDBOX = 3;
/** R-19: "Preparing your questions" never shows longer than this after End. */
export const PREPARING_MAX_MS = 6 * 60_000;
/** R-19 fast lane (Task D3): minimum gap between two process-now calls of one device, and the cap per sandbox. */
export const PROCESS_NOW_MIN_INTERVAL_MS = 20_000;
export const PROCESS_NOW_PER_SANDBOX = 40;
/**
 * R-19 PR-2: calls to POST /api/v1/demo/next-day per sandbox (counter `next_day_sandbox`), stale taps included. A judge
 * needs 2 jumps; the rest is room for double taps and retries. It bounds the Firestore reads a looping client costs.
 */
export const NEXT_DAY_PER_SANDBOX = 20;

/** Lazy cleanup: at most this many expired sandboxes are deleted per new-sandbox request. */
export const CLEANUP_PER_CREATE = 2;

/** DEMO_IP_SALT must be at least this long, or the demo is not ready (a short salt makes the IP hashes guessable). */
export const IP_SALT_MIN_LENGTH = 16;

/** Counter docs are kept 2 days, then Firestore TTL (dev-ops) removes them. */
export const COUNTER_TTL_MS = 2 * 24 * 60 * 60_000;

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
export const GENERATE_PER_SANDBOX = 5;
export const GENERATE_DAILY = 300;

/** Lazy cleanup: at most this many expired sandboxes are deleted per new-sandbox request. */
export const CLEANUP_PER_CREATE = 2;

/** Counter docs are kept 2 days, then Firestore TTL (dev-ops) removes them. */
export const COUNTER_TTL_MS = 2 * 24 * 60 * 60_000;

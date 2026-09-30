/**
 * Upload retry policy (web spec §5 step 5: uploaded with retry, deleted on 200).
 * Pure: no timers, no network — just the decision and the delay. The caller owns
 * scheduling. Randomness for jitter is injectable so tests are deterministic.
 */

export type UploadDisposition = "success" | "retry" | "drop";

/**
 * Classifies an upload result.
 *  - 200/201        → success (remove from the queue);
 *  - 429 / 5xx      → retry (transient);
 *  - other 4xx      → drop (permanent for this segment, e.g. 413 too large);
 *  - `null` status  → retry (network error / no response).
 */
export function classifyUploadResult(status: number | null): UploadDisposition {
  if (status === null) return "retry";
  if (status === 200 || status === 201) return "success";
  if (status === 429 || status >= 500) return "retry";
  return "drop";
}

/** Default cap on transient-retry attempts before a segment is given up on. */
export const DEFAULT_MAX_ATTEMPTS = 6;

export interface UploadAction {
  action: UploadDisposition;
  /** Delay before the next attempt; present only when `action === "retry"`. */
  delayMs?: number;
}

/**
 * Combined policy: classify the result, apply the max-attempts give-up, and
 * compute the backoff delay for a retry. `attempt` is the number just made
 * (1 = first). A transient failure past `maxAttempts` becomes a drop.
 */
export function nextUploadAction(
  status: number | null,
  attempt: number,
  options: { maxAttempts?: number } & Partial<BackoffOptions> = {},
): UploadAction {
  const { maxAttempts = DEFAULT_MAX_ATTEMPTS, ...backoff } = options;
  const disposition = classifyUploadResult(status);
  if (disposition !== "retry") return { action: disposition };
  if (attempt >= maxAttempts) return { action: "drop" };
  return { action: "retry", delayMs: backoffDelayMs(attempt, backoff) };
}

export interface BackoffOptions {
  baseMs: number;
  factor: number;
  maxMs: number;
  jitter: boolean;
  /** Injectable RNG in [0,1) for jitter; defaults to Math.random. */
  rng: () => number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseMs: 500,
  factor: 2,
  maxMs: 30_000,
  jitter: true,
  rng: Math.random,
};

/**
 * Exponential backoff delay for a 1-based `attempt` (1 = first retry). Capped at
 * `maxMs`. With jitter, returns a value in [raw/2, raw] to spread retries.
 */
export function backoffDelayMs(
  attempt: number,
  options: Partial<BackoffOptions> = {},
): number {
  const { baseMs, factor, maxMs, jitter, rng } = { ...DEFAULT_BACKOFF, ...options };
  const n = Math.max(1, Math.floor(attempt));
  const raw = Math.min(maxMs, baseMs * factor ** (n - 1));
  if (!jitter) return raw;
  return Math.round(raw / 2 + rng() * (raw / 2));
}

/**
 * Test-only: wait until `check` stops throwing, polling on REAL macrotasks.
 *
 * Why not Testing Library's `waitFor`: it re-checks on a DOM mutation or on a global `setInterval` tick. The capture
 * page tests fake `setInterval` (and in one helper `setTimeout`) to drive the page's clocks, which leaves `waitFor`
 * with DOM mutations only. A condition that flips WITHOUT a mutation after the last one (a passive effect that
 * publishes a module-level store, such as the judge-guide bridge phase) is then never re-checked, and the wait runs
 * to its timeout. React flushes passive effects in a later scheduler task than the commit that rendered the DOM, so
 * under CPU load the DOM can show "Listening" well before the bridge says so.
 *
 * This helper captures the real `setTimeout`, `setImmediate` and `Date.now` when the module loads (before any test
 * fakes them) and polls with them, so it keeps working whichever of those a test fakes later. It switches the React
 * act environment off while waiting (as Testing Library's own async wrapper does) so the updates that land meanwhile
 * do not log "not wrapped in act" warnings, and restores it afterwards.
 */

const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const realSetImmediate = globalThis.setImmediate.bind(globalThis);
const realNow = Date.now.bind(Date);

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

/** One real macrotask: React's scheduler runs a pending commit and its passive effects on these. */
const yieldMacrotask = () => new Promise<void>((resolve) => realSetImmediate(resolve));
const sleep = (ms: number) => new Promise<void>((resolve) => realSetTimeout(resolve, ms));

export interface WaitForConditionOptions {
  /** Give up after this many real milliseconds. Default 10 000, the same as the suite's RTL `asyncUtilTimeout`. */
  timeoutMs?: number;
  /** Real milliseconds between checks. Default 10. */
  intervalMs?: number;
}

export async function waitForCondition<T>(check: () => T | Promise<T>, options: WaitForConditionOptions = {}): Promise<T> {
  const { timeoutMs = 10_000, intervalMs = 10 } = options;
  const previousActEnv = actEnv.IS_REACT_ACT_ENVIRONMENT;
  actEnv.IS_REACT_ACT_ENVIRONMENT = false;
  const deadline = realNow() + timeoutMs;
  let lastError: unknown;
  try {
    for (;;) {
      try {
        const result = await check();
        await yieldMacrotask(); // let the work this state change queued (a trailing effect) land before the caller goes on
        return result;
      } catch (error) {
        lastError = error;
      }
      if (realNow() >= deadline) throw lastError;
      await sleep(intervalMs);
    }
  } finally {
    if (previousActEnv === undefined) delete actEnv.IS_REACT_ACT_ENVIRONMENT;
    else actEnv.IS_REACT_ACT_ENVIRONMENT = previousActEnv;
  }
}

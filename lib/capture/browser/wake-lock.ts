/**
 * Screen Wake Lock manager (web spec §4.1: "keeps the screen awake while open").
 * Browser only. The browser releases the sentinel automatically whenever the
 * tab is hidden (even once), without calling back into our code unless we
 * listen for the sentinel's own `release` event (bug B-1: without that
 * listener, `held`/the heartbeat's `screen_awake` kept reporting `true` after
 * the first hide, and the lock was never re-acquired). We listen for `release`
 * so our state always reflects reality, and re-acquire on `visibilitychange`
 * -> visible.
 *
 * Round 2 fix: `held` reads the sentinel's own synchronous `released`
 * attribute instead of only relying on our async `release` event listener
 * having already run. The browser sets `released` to `true` BEFORE firing the
 * `release` event, so a frozen background tab can deliver a queued
 * `visibilitychange` -> visible callback before its queued `release` event —
 * without this, `reacquireIfNeeded` would see a stale non-null `sentinel` and
 * skip re-acquiring. We also try to re-acquire from inside the `release`
 * handler itself when the page is still visible (e.g. a battery-saver release
 * that isn't preceded by any `visibilitychange`), which `visibilitychange`
 * alone would never catch.
 */

export function isWakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

export class WakeLockManager {
  private sentinel: WakeLockSentinel | null = null;
  /**
   * The in-flight `acquire()` attempt, if any. Dedupes a browser-initiated
   * re-acquire (fired from inside the `release` handler below) racing with an
   * explicit `reacquireIfNeeded()` call reacting to the very same drop, so one
   * logical re-acquire never issues two `navigator.wakeLock.request()` calls.
   */
  private acquiring: Promise<boolean> | null = null;
  /**
   * Set once `release()` has been called, so an `acquire()` still in flight
   * at that point doesn't resurrect a live sentinel after the session has
   * already stopped.
   */
  private disposed = false;

  /** Requests the screen wake lock; returns whether it was acquired. */
  async acquire(): Promise<boolean> {
    if (!isWakeLockSupported()) return false;
    if (this.acquiring) return this.acquiring;
    const attempt = this.doAcquire();
    this.acquiring = attempt;
    try {
      return await attempt;
    } finally {
      if (this.acquiring === attempt) this.acquiring = null;
    }
  }

  private async doAcquire(): Promise<boolean> {
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      if (this.disposed) {
        // release() ran while this request was in flight — don't resurrect a
        // live sentinel for a session that has already stopped.
        void sentinel.release();
        return false;
      }
      this.sentinel = sentinel;
      // The browser can release this sentinel on its own (tab hidden, battery
      // saver, …) without us calling release(). Listen so `held` stays honest
      // instead of assuming the lock is still in effect.
      sentinel.addEventListener("release", () => {
        // Round 3 fix: gate the WHOLE handler on identity, not just the
        // clear. A later acquire() may already have replaced this sentinel
        // with a fresh one (e.g. a `visibilitychange` -> visible reacquire
        // that raced ahead of this sentinel's own queued `release` event).
        // Falling through past that point used to re-acquire unconditionally,
        // overwriting `this.sentinel` with yet another sentinel and orphaning
        // the current live one forever. Our own deliberate release() also
        // clears `this.sentinel` before calling the browser's `release()`
        // (see below), so this same check covers that case too — no separate
        // "deliberate" flag needed.
        if (this.sentinel !== sentinel) return;
        this.sentinel = null;
        // A release while the page stays visible (e.g. battery saver) is never
        // followed by a `visibilitychange` -> visible, so `reacquireIfNeeded`
        // would never run for it. Try again here instead.
        if (typeof document !== "undefined" && document.visibilityState === "visible") {
          void this.acquire();
        }
      });
      return true;
    } catch {
      this.sentinel = null;
      return false;
    }
  }

  /** Re-acquires the lock if it was dropped (call on visibilitychange). */
  async reacquireIfNeeded(): Promise<void> {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "visible" &&
      !this.held
    ) {
      await this.acquire();
    }
  }

  async release(): Promise<void> {
    this.disposed = true;
    // Clear `this.sentinel` BEFORE calling the browser's `release()`, so the
    // sentinel's own `release` event handler sees it as already-stale (the
    // identity check above) and does nothing — no separate "deliberate" flag
    // needed to suppress its self-reacquire.
    const sentinel = this.sentinel;
    this.sentinel = null;
    await sentinel?.release();
  }

  /**
   * Whether the lock is actually still in effect right now. Reads the
   * sentinel's own synchronous `released` attribute (round 2 fix) rather than
   * only `sentinel !== null`: the browser sets `released = true` before
   * firing the async `release` event, so checking `released` directly closes
   * a race where a frozen background tab delivers a queued `visibilitychange`
   * -> visible callback before its queued `release` event has run.
   */
  get held(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }
}

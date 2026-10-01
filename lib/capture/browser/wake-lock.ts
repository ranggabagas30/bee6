/**
 * Screen Wake Lock manager (web spec §4.1: "keeps the screen awake while open").
 * Browser only. The browser releases the sentinel automatically whenever the
 * tab is hidden (even once), without calling back into our code unless we
 * listen for the sentinel's own `release` event (bug B-1: without that
 * listener, `held`/the heartbeat's `screen_awake` kept reporting `true` after
 * the first hide, and the lock was never re-acquired). We listen for `release`
 * so our state always reflects reality, and re-acquire on `visibilitychange`
 * -> visible.
 */

export function isWakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

export class WakeLockManager {
  private sentinel: WakeLockSentinel | null = null;

  /** Requests the screen wake lock; returns whether it was acquired. */
  async acquire(): Promise<boolean> {
    if (!isWakeLockSupported()) return false;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      this.sentinel = sentinel;
      // The browser can release this sentinel on its own (tab hidden, battery
      // saver, …) without us calling release(). Listen so `held` stays honest
      // instead of assuming the lock is still in effect.
      sentinel.addEventListener("release", () => {
        // Only clear if this is still the current sentinel — a later acquire()
        // may already have replaced it with a fresh one.
        if (this.sentinel === sentinel) this.sentinel = null;
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
      this.sentinel === null
    ) {
      await this.acquire();
    }
  }

  async release(): Promise<void> {
    try {
      await this.sentinel?.release();
    } finally {
      this.sentinel = null;
    }
  }

  get held(): boolean {
    return this.sentinel !== null;
  }
}

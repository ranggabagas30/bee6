/**
 * Screen Wake Lock manager (web spec §4.1: "keeps the screen awake while open").
 * Browser only. Re-acquires the lock when the page becomes visible again, since
 * the sentinel is released automatically when the tab is hidden.
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
      this.sentinel = await navigator.wakeLock.request("screen");
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { WakeLockManager } from "@/lib/capture/browser/wake-lock";

/** A fake WakeLockSentinel that lets the test fire its `release` event the way
 * the browser would on its own (tab hidden), without our code calling
 * `release()` first. */
function makeFakeSentinel() {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    release: vi.fn(async () => {}),
    addEventListener: vi.fn((type: string, cb: () => void) => {
      (listeners[type] ??= []).push(cb);
    }),
    removeEventListener: vi.fn(),
    /** Test helper: simulates the browser's own automatic release. */
    __fireRelease: () => listeners.release?.forEach((cb) => cb()),
  };
}

describe("WakeLockManager", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stops reporting held once the browser auto-releases the sentinel (B-1)", async () => {
    const sentinel = makeFakeSentinel();
    vi.stubGlobal("navigator", {
      wakeLock: { request: vi.fn(async () => sentinel) },
    });

    const manager = new WakeLockManager();
    expect(await manager.acquire()).toBe(true);
    expect(manager.held).toBe(true);

    // The browser releases the lock on its own (tab hidden) — it never calls
    // our release(); it fires the sentinel's own `release` event instead.
    sentinel.__fireRelease();

    // Without the fix, `held` would still report true here: a false positive
    // the heartbeat would forward as `screen_awake: true`.
    expect(manager.held).toBe(false);
  });

  it("re-acquires on visibilitychange after an automatic release (B-1)", async () => {
    const sentinel1 = makeFakeSentinel();
    const sentinel2 = makeFakeSentinel();
    const request = vi.fn(async () =>
      request.mock.calls.length === 1 ? sentinel1 : sentinel2,
    );
    vi.stubGlobal("navigator", { wakeLock: { request } });
    vi.stubGlobal("document", { visibilityState: "visible" });

    const manager = new WakeLockManager();
    await manager.acquire();
    sentinel1.__fireRelease();
    expect(manager.held).toBe(false);

    // This is what session.ts calls on `visibilitychange` -> visible.
    await manager.reacquireIfNeeded();

    expect(request).toHaveBeenCalledTimes(2);
    expect(manager.held).toBe(true);
  });

  it("does not re-acquire while the lock is still actually held", async () => {
    const sentinel = makeFakeSentinel();
    const request = vi.fn(async () => sentinel);
    vi.stubGlobal("navigator", { wakeLock: { request } });
    vi.stubGlobal("document", { visibilityState: "visible" });

    const manager = new WakeLockManager();
    await manager.acquire();
    await manager.reacquireIfNeeded(); // no release happened

    expect(request).toHaveBeenCalledTimes(1);
  });
});

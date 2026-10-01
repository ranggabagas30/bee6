import { afterEach, describe, expect, it, vi } from "vitest";
import { WakeLockManager } from "@/lib/capture/browser/wake-lock";

/** A fake WakeLockSentinel that lets the test fire its `release` event the way
 * the browser would on its own (tab hidden), without our code calling
 * `release()` first. Mirrors the real `WakeLockSentinel`: `released` flips to
 * `true` SYNCHRONOUSLY before the `release` event is dispatched. */
function makeFakeSentinel() {
  const listeners: Record<string, Array<() => void>> = {};
  const sentinel = {
    released: false,
    // Per spec, calling `release()` ourselves fires the same `release` event
    // as a browser-initiated release — exercised by the "deliberate release"
    // test below.
    release: vi.fn(async () => {
      sentinel.released = true;
      listeners.release?.forEach((cb) => cb());
    }),
    addEventListener: vi.fn((type: string, cb: () => void) => {
      (listeners[type] ??= []).push(cb);
    }),
    removeEventListener: vi.fn(),
    /** Test helper: simulates the browser's own automatic release. */
    __fireRelease: () => {
      sentinel.released = true;
      listeners.release?.forEach((cb) => cb());
    },
  };
  return sentinel;
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

  it("treats the lock as released the instant `released` flips, even before the queued release event fires (round 2: B-1 race)", async () => {
    // The real WakeLockSentinel sets `released = true` SYNCHRONOUSLY, before
    // the async `release` event is dispatched. A frozen background tab can
    // deliver a queued `visibilitychange` -> visible callback before its
    // queued `release` event has actually run, so `held` must not depend on
    // our event listener having already fired.
    const sentinel = makeFakeSentinel();
    vi.stubGlobal("navigator", {
      wakeLock: { request: vi.fn(async () => sentinel) },
    });

    const manager = new WakeLockManager();
    await manager.acquire();
    expect(manager.held).toBe(true);

    // Flip the attribute directly, without going through `__fireRelease`
    // (i.e. without our `release` listener having run yet).
    sentinel.released = true;

    expect(manager.held).toBe(false);
  });

  it("re-acquires from inside the release handler itself when the page stays visible (battery saver, round 2)", async () => {
    const sentinel1 = makeFakeSentinel();
    const sentinel2 = makeFakeSentinel();
    const request = vi.fn(async () =>
      request.mock.calls.length === 1 ? sentinel1 : sentinel2,
    );
    vi.stubGlobal("navigator", { wakeLock: { request } });
    vi.stubGlobal("document", { visibilityState: "visible" });

    const manager = new WakeLockManager();
    await manager.acquire();

    // A release while the page stays visible (e.g. battery saver) is never
    // preceded or followed by a `visibilitychange`, so nothing outside this
    // module would ever call `reacquireIfNeeded()` for it.
    sentinel1.__fireRelease();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(request).toHaveBeenCalledTimes(2);
    expect(manager.held).toBe(true);
  });

  it("does not re-acquire after a deliberate release(), even though release() fires the same event (round 2)", async () => {
    const sentinel = makeFakeSentinel();
    const request = vi.fn(async () => sentinel);
    vi.stubGlobal("navigator", { wakeLock: { request } });
    vi.stubGlobal("document", { visibilityState: "visible" });

    const manager = new WakeLockManager();
    await manager.acquire();
    await manager.release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(request).toHaveBeenCalledTimes(1); // no self-triggered re-acquire
    expect(manager.held).toBe(false);
  });
});

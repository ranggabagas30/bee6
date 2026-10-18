import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForCondition } from "@/lib/testing/wait-for-condition";

/**
 * The helper exists because Testing Library's `waitFor` polls with the GLOBAL `setInterval`: a test that fakes
 * `setInterval` (the capture page tests do, to drive the page's clocks) leaves it with only DOM mutations to wake on,
 * so a condition that flips without a mutation (a passive effect publishing a module-level store) is never re-checked.
 */

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

afterEach(() => {
  vi.useRealTimers();
  delete actEnv.IS_REACT_ACT_ENVIRONMENT;
});

describe("waitForCondition", () => {
  it("resolves once a non-DOM condition flips, while setInterval is faked", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    let flag = false;
    setImmediate(() => {
      flag = true;
    });
    await waitForCondition(() => expect(flag).toBe(true));
  });

  it("resolves while setTimeout is faked too (the fully faked suites)", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    let flag = false;
    setImmediate(() => {
      flag = true;
    });
    await waitForCondition(() => expect(flag).toBe(true));
  });

  it("returns the check's own value (sync or async checks)", async () => {
    await expect(waitForCondition(() => 7)).resolves.toBe(7);
    await expect(waitForCondition(async () => "ok")).resolves.toBe("ok");
  });

  it("rejects with the LAST error of the check when the timeout passes", async () => {
    let n = 0;
    await expect(
      waitForCondition(
        () => {
          throw new Error(`still waiting #${++n}`);
        },
        { timeoutMs: 60, intervalMs: 5 },
      ),
    ).rejects.toThrow(/still waiting #\d+/);
    expect(n).toBeGreaterThan(1);
  });

  it("turns the React act environment off while it waits, and restores it after (resolved or rejected)", async () => {
    actEnv.IS_REACT_ACT_ENVIRONMENT = true;
    let seen: boolean | undefined;
    await waitForCondition(() => {
      seen = actEnv.IS_REACT_ACT_ENVIRONMENT;
    });
    expect(seen).toBe(false);
    expect(actEnv.IS_REACT_ACT_ENVIRONMENT).toBe(true);
    await expect(
      waitForCondition(
        () => {
          throw new Error("never");
        },
        { timeoutMs: 20, intervalMs: 5 },
      ),
    ).rejects.toThrow("never");
    expect(actEnv.IS_REACT_ACT_ENVIRONMENT).toBe(true);
  });
});

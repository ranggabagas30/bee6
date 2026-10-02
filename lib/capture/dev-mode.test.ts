import { describe, expect, it, vi } from "vitest";

/**
 * `isDevControlsEnabled` reads `process.env.NEXT_PUBLIC_DEV_CONTROLS` fresh on
 * every call (not a module-level constant), since different tests need to flip
 * it; we reset modules between cases so the re-import picks up the new value.
 */
async function checkWithEnv(value: string | undefined): Promise<boolean> {
  vi.resetModules();
  const prev = process.env.NEXT_PUBLIC_DEV_CONTROLS;
  if (value === undefined) delete process.env.NEXT_PUBLIC_DEV_CONTROLS;
  else process.env.NEXT_PUBLIC_DEV_CONTROLS = value;
  try {
    const { isDevControlsEnabled } = await import("@/lib/capture/dev-mode");
    return isDevControlsEnabled();
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_DEV_CONTROLS;
    else process.env.NEXT_PUBLIC_DEV_CONTROLS = prev;
  }
}

describe("isDevControlsEnabled", () => {
  it("is false when NEXT_PUBLIC_DEV_CONTROLS is unset", async () => {
    expect(await checkWithEnv(undefined)).toBe(false);
  });

  it('is false when NEXT_PUBLIC_DEV_CONTROLS is "false"', async () => {
    expect(await checkWithEnv("false")).toBe(false);
  });

  it("is false for any non-\"true\" string (typo/case guard)", async () => {
    expect(await checkWithEnv("TRUE")).toBe(false);
  });

  it('is true only for the exact literal string "true"', async () => {
    expect(await checkWithEnv("true")).toBe(true);
  });
});

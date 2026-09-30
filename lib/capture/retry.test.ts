import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_ATTEMPTS,
  backoffDelayMs,
  classifyUploadResult,
  nextUploadAction,
} from "@/lib/capture/retry";

describe("classifyUploadResult", () => {
  it("treats 200/201 as success", () => {
    expect(classifyUploadResult(200)).toBe("success");
    expect(classifyUploadResult(201)).toBe("success");
  });

  it("retries on 429 and 5xx", () => {
    expect(classifyUploadResult(429)).toBe("retry");
    expect(classifyUploadResult(500)).toBe("retry");
    expect(classifyUploadResult(503)).toBe("retry");
  });

  it("retries on a network error (null status)", () => {
    expect(classifyUploadResult(null)).toBe("retry");
  });

  it("drops on permanent 4xx (e.g. 413 too large, 403 IDOR)", () => {
    expect(classifyUploadResult(413)).toBe("drop");
    expect(classifyUploadResult(403)).toBe("drop");
    expect(classifyUploadResult(400)).toBe("drop");
    expect(classifyUploadResult(422)).toBe("drop");
  });
});

describe("backoffDelayMs", () => {
  it("grows exponentially without jitter", () => {
    const opts = { jitter: false, baseMs: 500, factor: 2, maxMs: 30_000 };
    expect(backoffDelayMs(1, opts)).toBe(500);
    expect(backoffDelayMs(2, opts)).toBe(1_000);
    expect(backoffDelayMs(3, opts)).toBe(2_000);
    expect(backoffDelayMs(4, opts)).toBe(4_000);
  });

  it("caps at maxMs", () => {
    expect(backoffDelayMs(20, { jitter: false, baseMs: 500, maxMs: 30_000 })).toBe(
      30_000,
    );
  });

  it("keeps jitter within [raw/2, raw] using the injected rng", () => {
    const opts = { jitter: true, baseMs: 1_000, factor: 2, maxMs: 30_000 };
    // rng() = 0 → raw/2 (rounded); rng() -> 1 → raw.
    expect(backoffDelayMs(1, { ...opts, rng: () => 0 })).toBe(500);
    expect(backoffDelayMs(1, { ...opts, rng: () => 0.999999 })).toBe(1_000);
  });

  it("floors a fractional attempt to at least 1", () => {
    expect(backoffDelayMs(0, { jitter: false, baseMs: 500 })).toBe(500);
  });
});

describe("nextUploadAction", () => {
  const noJitter = { jitter: false, baseMs: 500, factor: 2, maxMs: 30_000 };

  it("returns success on 200 with no delay", () => {
    expect(nextUploadAction(200, 1)).toEqual({ action: "success" });
  });

  it("drops immediately on a permanent 4xx", () => {
    expect(nextUploadAction(413, 1)).toEqual({ action: "drop" });
  });

  it("retries a transient failure with a backoff delay", () => {
    expect(nextUploadAction(503, 2, noJitter)).toEqual({
      action: "retry",
      delayMs: 1_000,
    });
  });

  it("gives up (drop) once max attempts is reached", () => {
    expect(
      nextUploadAction(503, DEFAULT_MAX_ATTEMPTS, noJitter),
    ).toEqual({ action: "drop" });
  });

  it("retries a network error (null status) before the cap", () => {
    expect(nextUploadAction(null, 1, noJitter)).toEqual({
      action: "retry",
      delayMs: 500,
    });
  });
});

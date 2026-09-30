import { describe, expect, it } from "vitest";
import {
  MIN_SAMPLE_RATE,
  checkSampleRate,
  isSampleRateSupported,
} from "@/lib/capture/sample-rate";

describe("isSampleRateSupported", () => {
  it("accepts 16 kHz and above", () => {
    expect(isSampleRateSupported(16_000)).toBe(true);
    expect(isSampleRateSupported(48_000)).toBe(true);
  });

  it("refuses below 16 kHz", () => {
    expect(isSampleRateSupported(8_000)).toBe(false);
  });

  it("refuses non-finite values", () => {
    expect(isSampleRateSupported(Number.NaN)).toBe(false);
  });
});

describe("checkSampleRate", () => {
  it("returns ok with no message when supported", () => {
    expect(checkSampleRate(16_000)).toEqual({ ok: true });
  });

  it("returns a clear message mentioning the minimum when refused", () => {
    const result = checkSampleRate(8_000);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("8000 Hz");
    expect(result.message).toContain(String(MIN_SAMPLE_RATE));
  });

  it("handles an unknown rate gracefully", () => {
    const result = checkSampleRate(Number.NaN);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("unknown rate");
  });
});

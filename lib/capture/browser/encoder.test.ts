import { describe, expect, it } from "vitest";
import {
  CAPTURE_SAMPLE_RATE,
  OPUS_BITRATE,
  checkOpusEncoderSupport,
  isOpusEncoderSupported,
} from "@/lib/capture/browser/encoder";
import { SEGMENT_CONTENT_TYPE } from "@/lib/capture/contract";

describe("encoder feature checks", () => {
  it("reports Opus encoding unsupported outside a WebCodecs runtime (e.g. Node)", () => {
    // Guards the page: without WebCodecs we show a clear message, never silently
    // drop audio. In Node there is no AudioEncoder/AudioData.
    expect(isOpusEncoderSupported()).toBe(false);
  });

  it("async support check also resolves false without WebCodecs", async () => {
    await expect(checkOpusEncoderSupport()).resolves.toBe(false);
  });

  it("targets ~24 kbps mono 16 kHz per the spec", () => {
    expect(OPUS_BITRATE).toBe(24_000);
    expect(CAPTURE_SAMPLE_RATE).toBe(16_000);
  });

  it("declares the exact content type the segment PUT accepts", () => {
    expect(SEGMENT_CONTENT_TYPE).toBe("audio/webm;codecs=opus");
  });
});

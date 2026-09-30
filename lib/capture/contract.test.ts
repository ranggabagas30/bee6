import { describe, expect, it } from "vitest";
import {
  CaptureConfigResponseSchema,
  HeartbeatRequestSchema,
  MAX_SEGMENT_BYTES,
  SEGMENT_CONTENT_TYPE,
  SegmentMetadataSchema,
  assertDeviceMatch,
  assertSegmentSize,
  parseSegmentPath,
  toCaptureConfig,
  toHeartbeat,
} from "@/lib/capture/contract";
import {
  BadRequestError,
  ForbiddenError,
  PayloadTooLargeError,
} from "@/lib/http/errors";

describe("parseSegmentPath", () => {
  it("splits '{device_id}:{seg_id}'", () => {
    expect(parseSegmentPath("dev-1:seg-abc")).toEqual({
      device_id: "dev-1",
      seg_id: "seg-abc",
    });
  });

  it("rejects a path without a colon", () => {
    expect(() => parseSegmentPath("dev-1")).toThrow(BadRequestError);
  });

  it("rejects a path with more than one colon", () => {
    expect(() => parseSegmentPath("dev:1:seg")).toThrow(BadRequestError);
  });

  it("rejects an empty device_id or seg_id", () => {
    expect(() => parseSegmentPath(":seg")).toThrow(BadRequestError);
    expect(() => parseSegmentPath("dev:")).toThrow(BadRequestError);
  });
});

describe("assertDeviceMatch (IDOR guard)", () => {
  it("passes when the path device matches the credential", () => {
    expect(() => assertDeviceMatch("dev-1", "dev-1")).not.toThrow();
  });

  it("throws ForbiddenError on mismatch", () => {
    expect(() => assertDeviceMatch("dev-2", "dev-1")).toThrow(ForbiddenError);
  });
});

describe("segment size cap", () => {
  it("exports a sane ceiling (128–256 KiB range)", () => {
    expect(MAX_SEGMENT_BYTES).toBeGreaterThanOrEqual(128 * 1024);
    expect(MAX_SEGMENT_BYTES).toBeLessThanOrEqual(256 * 1024);
  });

  it("allows a body at the ceiling", () => {
    expect(() => assertSegmentSize(MAX_SEGMENT_BYTES)).not.toThrow();
  });

  it("throws PayloadTooLargeError above the ceiling", () => {
    expect(() => assertSegmentSize(MAX_SEGMENT_BYTES + 1)).toThrow(
      PayloadTooLargeError,
    );
  });
});

describe("SegmentMetadataSchema", () => {
  const valid = {
    device_id: "dev-1",
    seg_id: "seg-abc",
    start_ms: "1000",
    end_ms: "16000",
    sample_rate: "16000",
    content_type: SEGMENT_CONTENT_TYPE,
  };

  it("parses valid metadata and coerces header strings to numbers", () => {
    const parsed = SegmentMetadataSchema.parse(valid);
    expect(parsed.start_ms).toBe(1000);
    expect(parsed.end_ms).toBe(16000);
    expect(parsed.sample_rate).toBe(16000);
  });

  it("rejects a wrong content type", () => {
    expect(() =>
      SegmentMetadataSchema.parse({ ...valid, content_type: "audio/ogg" }),
    ).toThrow();
  });

  it("rejects end_ms before start_ms", () => {
    expect(() =>
      SegmentMetadataSchema.parse({ ...valid, start_ms: "20000" }),
    ).toThrow();
  });

  it("rejects a non-positive sample rate", () => {
    expect(() =>
      SegmentMetadataSchema.parse({ ...valid, sample_rate: "0" }),
    ).toThrow();
  });

  it("rejects unknown fields (no place for audio bytes)", () => {
    expect(() =>
      SegmentMetadataSchema.parse({ ...valid, audio: "AAAA" }),
    ).toThrow();
  });
});

describe("heartbeat request → stored mapping", () => {
  const request = {
    ts: "2026-09-30T10:00:00.000Z",
    mic_source: "built-in",
    sample_rate: 16000,
    speech_pct: 42,
    queue_size: 3,
    battery: 88,
    screen_awake: true,
  };

  it("accepts a wire body without outlet_id/device_id", () => {
    expect(() => HeartbeatRequestSchema.parse(request)).not.toThrow();
  });

  it("rejects a wire body that tries to set outlet_id or device_id", () => {
    expect(() =>
      HeartbeatRequestSchema.parse({ ...request, outlet_id: "spoof" }),
    ).toThrow();
    expect(() =>
      HeartbeatRequestSchema.parse({ ...request, device_id: "spoof" }),
    ).toThrow();
  });

  it("merges outlet_id/device_id from the authenticated claims", () => {
    const parsedRequest = HeartbeatRequestSchema.parse(request);
    const stored = toHeartbeat(parsedRequest, {
      outlet_id: "outlet-1",
      device_id: "dev-1",
    });
    expect(stored.outlet_id).toBe("outlet-1");
    expect(stored.device_id).toBe("dev-1");
    expect(stored.speech_pct).toBe(42);
  });

  it("throws ForbiddenError when the principal has no device_id", () => {
    const parsedRequest = HeartbeatRequestSchema.parse(request);
    expect(() =>
      toHeartbeat(parsedRequest, { outlet_id: "outlet-1", device_id: undefined }),
    ).toThrow(ForbiddenError);
  });
});

describe("CaptureConfigResponseSchema", () => {
  const outlet = {
    outlet_id: "outlet-1",
    name: "Proofed",
    project_kind: "pilot" as const,
    consent_complete: true,
    timezone: "Asia/Jakarta",
    opening_time: "07:00",
    closing_time: "21:45",
    created_at: "2026-09-30T00:00:00.000Z",
  };

  it("projects a full outlet doc to the allowlist subset", () => {
    expect(toCaptureConfig(outlet)).toEqual({
      consent_complete: true,
      opening_time: "07:00",
      closing_time: "21:45",
      timezone: "Asia/Jakarta",
    });
  });

  it("round-trips the allowlist shape", () => {
    const config = {
      consent_complete: false,
      opening_time: "08:00",
      closing_time: "20:00",
      timezone: "Asia/Jakarta",
    };
    expect(CaptureConfigResponseSchema.parse(config)).toEqual(config);
  });

  it("rejects extra fields (strict allowlist)", () => {
    expect(() =>
      CaptureConfigResponseSchema.parse({
        consent_complete: true,
        opening_time: "07:00",
        closing_time: "21:45",
        timezone: "Asia/Jakarta",
        name: "Proofed",
      }),
    ).toThrow();
  });
});

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
    timezone: "Asia/Jakarta",
    opening_time: "07:00",
    closing_time: "21:45",
    created_at: "2026-09-30T00:00:00.000Z",
  };
  const day = { open: "07:00", close: "21:45" };
  const weekly = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
  const lastEnded = {
    business_date: "2026-10-06",
    end_reason: "auto_stop" as const,
    ended_at_ms: 1_700_000_000_000,
    debrief_ends_at_ms: 1_700_003_600_000,
  };

  it("projects a full outlet doc and device to the allowlist shape", () => {
    expect(toCaptureConfig(outlet, null, 0)).toEqual({
      timezone: "Asia/Jakarta",
      weekly_hours: weekly,
      last_ended: null,
      capture_mode: "none",
    });
  });

  it("uses the outlet's stored weekly_hours when present", () => {
    const stored = { ...weekly, sun: null };
    expect(toCaptureConfig({ ...outlet, weekly_hours: stored }, lastEnded, 1).weekly_hours).toEqual(stored);
  });

  it("derives capture_mode from the paired-device count (R-07 Task 8)", () => {
    expect(toCaptureConfig(outlet, null, 0).capture_mode).toBe("none");
    expect(toCaptureConfig(outlet, null, 1).capture_mode).toBe("room");
    expect(toCaptureConfig(outlet, null, 2).capture_mode).toBe("wearable");
  });

  describe("R-18 demo_session (sandbox only, server-derived)", () => {
    const sandbox = { template_outlet_id: "demo-tpl-outlet", created_at_ms: 1, expires_at_ms: 2, key_sha256: "a".repeat(64) };
    const sbxOutlet = { ...outlet, project_kind: "demo" as const, sandbox };
    const expiring = { expires_at_ms: 9_000_000_000_000 };

    it("7.T1 absent without DEMO_MODE even for a sandbox outlet with an expiring device", () => {
      expect(toCaptureConfig(sbxOutlet, null, 1, false, expiring)).not.toHaveProperty("demo_session");
    });
    it("7.T2 absent when the outlet has no sandbox object (the shared demo-outlet or the pilot)", () => {
      expect(toCaptureConfig(outlet, null, 1, true, expiring)).not.toHaveProperty("demo_session");
    });
    it("7.T3 absent when the device carries no expiry (a real paired phone)", () => {
      expect(toCaptureConfig(sbxOutlet, null, 1, true, {})).not.toHaveProperty("demo_session");
      expect(toCaptureConfig(sbxOutlet, null, 1, true)).not.toHaveProperty("demo_session");
    });
    it("7.T4 present as exactly { max_ms: 300000, script_id: bakery-v1 } only when all three hold", () => {
      expect(toCaptureConfig(sbxOutlet, null, 1, true, expiring).demo_session).toEqual({ max_ms: 300_000, script_id: "bakery-v1" });
    });
    it("the pilot response (no 4th/5th argument) is byte-identical to before", () => {
      expect(Object.keys(toCaptureConfig(outlet, null, 1)).sort()).toEqual(["capture_mode", "last_ended", "timezone", "weekly_hours"]);
    });
    it("the schema is strict about the profile: another max_ms or an extra key is refused", () => {
      const base = { timezone: "Asia/Jakarta", weekly_hours: weekly, last_ended: null, capture_mode: "room" };
      expect(() => CaptureConfigResponseSchema.parse({ ...base, demo_session: { max_ms: 1, script_id: "bakery-v1" } })).toThrow();
      expect(() => CaptureConfigResponseSchema.parse({ ...base, demo_session: { max_ms: 300_000, script_id: "bakery-v1", extra: 1 } })).toThrow();
      expect(CaptureConfigResponseSchema.parse({ ...base, demo_session: { max_ms: 300_000, script_id: "bakery-v1" } }).demo_session).toBeDefined();
    });
  });

  it("round-trips the allowlist shape", () => {
    const config = {
      timezone: "Asia/Jakarta",
      weekly_hours: weekly,
      last_ended: { business_date: "2026-10-06", end_reason: "auto_stop", debrief_ends_at_ms: 1_700_003_600_000 },
      capture_mode: "room",
    };
    expect(CaptureConfigResponseSchema.parse(config)).toEqual(config);
  });

  it("never carries consent_complete (a contract test asserts its absence)", () => {
    expect(toCaptureConfig(outlet, null, 0)).not.toHaveProperty("consent_complete");
    expect(() =>
      CaptureConfigResponseSchema.parse({
        timezone: "Asia/Jakarta",
        weekly_hours: weekly,
        last_ended: null,
        capture_mode: "none",
        consent_complete: true,
      }),
    ).toThrow();
  });

  it("rejects extra fields (strict allowlist)", () => {
    expect(() =>
      CaptureConfigResponseSchema.parse({
        timezone: "Asia/Jakarta",
        weekly_hours: weekly,
        last_ended: null,
        capture_mode: "none",
        name: "Proofed",
      }),
    ).toThrow();
  });

  it("rejects an invalid capture_mode value", () => {
    expect(() =>
      CaptureConfigResponseSchema.parse({
        timezone: "Asia/Jakarta",
        weekly_hours: weekly,
        last_ended: null,
        capture_mode: "many",
      }),
    ).toThrow();
  });
});

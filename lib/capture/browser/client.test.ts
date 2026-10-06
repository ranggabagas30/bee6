import { describe, expect, it } from "vitest";
import {
  buildSegmentPut,
  deviceAuthHeaders,
  resolveCapturePhase,
} from "@/lib/capture/browser/client";
import type { QueuedSegment } from "@/lib/capture/browser/engine";

const auth = { deviceToken: "tok-123", deviceId: "dev-1" };

const segment: QueuedSegment = {
  id: "seg-abc",
  seg_id: "seg-abc",
  duration_ms: 15_000,
  start_ms: 1_000,
  end_ms: 16_000,
  sample_rate: 16_000,
  bytes: new Uint8Array([10, 20, 30]),
  content_type: "audio/webm;codecs=opus",
};

describe("deviceAuthHeaders", () => {
  it("carries the bearer token and device id requireDevice expects", () => {
    expect(deviceAuthHeaders(auth)).toEqual({
      Authorization: "Bearer tok-123",
      "X-Device-Id": "dev-1",
    });
  });
});

describe("buildSegmentPut", () => {
  const req = buildSegmentPut(segment, auth);

  it("uses the authenticated device id in the path (IDOR-safe)", () => {
    expect(req.url).toBe("/api/v1/segments/dev-1:seg-abc");
    expect(req.method).toBe("PUT");
  });

  it("sends metadata in headers and audio only in the body", () => {
    expect(req.headers["Content-Type"]).toBe("audio/webm;codecs=opus");
    expect(req.headers["X-Segment-Start-Ms"]).toBe("1000");
    expect(req.headers["X-Segment-End-Ms"]).toBe("16000");
    expect(req.headers["X-Segment-Sample-Rate"]).toBe("16000");
    expect(req.body).toBe(segment.bytes);
  });

  it("never leaks audio bytes into the URL or any header", () => {
    const serialized = req.url + JSON.stringify(req.headers);
    // The only place bytes exist is `body`; none of the numeric header values
    // are the raw audio array.
    expect(serialized).not.toContain("10,20,30");
  });
});

describe("resolveCapturePhase", () => {
  const base = {
    opening_time: "07:00",
    closing_time: "21:45",
    timezone: "Asia/Jakarta",
  };

  it("has no consent gate in MVP 1 (CLAUDE.md 7b): an incomplete consent flag does not block capture", () => {
    const phase = resolveCapturePhase(
      { ...base, consent_complete: false },
      new Date("2026-09-30T03:00:00Z"), // 10:00 WIB, inside hours
    );
    expect(phase).toBe("active");
  });

  it("pauses outside opening hours (consent complete)", () => {
    const phase = resolveCapturePhase(
      { ...base, consent_complete: true },
      new Date("2026-09-29T23:00:00Z"), // 06:00 WIB, before opening
    );
    expect(phase).toBe("outside_hours");
  });

  it("is active with consent inside hours", () => {
    const phase = resolveCapturePhase(
      { ...base, consent_complete: true },
      new Date("2026-09-30T03:00:00Z"), // 10:00 WIB
    );
    expect(phase).toBe("active");
  });
});

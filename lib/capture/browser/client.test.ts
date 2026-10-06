import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSegmentPut,
  deviceAuthHeaders,
  fetchCaptureConfig,
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

  it("has no consent gate: a config without consent_complete is active inside hours (MVP 1, CLAUDE.md 7b)", () => {
    const phase = resolveCapturePhase(
      base,
      new Date("2026-09-30T03:00:00Z"), // 10:00 WIB, inside hours
    );
    expect(phase).toBe("active");
  });

  it("pauses outside opening hours", () => {
    const phase = resolveCapturePhase(
      base,
      new Date("2026-09-29T23:00:00Z"), // 06:00 WIB, before opening
    );
    expect(phase).toBe("outside_hours");
  });

  it("is active inside hours", () => {
    const phase = resolveCapturePhase(
      base,
      new Date("2026-09-30T03:00:00Z"), // 10:00 WIB
    );
    expect(phase).toBe("active");
  });
});

describe("fetchCaptureConfig (client never requires consent_complete)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const hours = {
    opening_time: "07:00",
    closing_time: "21:45",
    timezone: "Asia/Jakarta",
  };

  function stubConfigResponse(data: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  }

  it("accepts a config response that omits consent_complete", async () => {
    stubConfigResponse(hours);
    await expect(fetchCaptureConfig(auth)).resolves.toEqual(hours);
  });

  it("still accepts a response that includes consent_complete (old server), ignoring it", async () => {
    stubConfigResponse({ ...hours, consent_complete: true });
    const config = await fetchCaptureConfig(auth);
    expect(config).toEqual(hours);
    expect(config).not.toHaveProperty("consent_complete");
  });

  it("still rejects a config response with a missing opening time", async () => {
    stubConfigResponse({ closing_time: "21:45", timezone: "Asia/Jakarta" });
    await expect(fetchCaptureConfig(auth)).rejects.toThrow();
  });
});

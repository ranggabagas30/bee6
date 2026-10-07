import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSegmentPut,
  deviceAuthHeaders,
  fetchCaptureConfig,
  resolveCapturePhase,
} from "@/lib/capture/browser/client";
import type { QueuedSegment } from "@/lib/capture/browser/engine";
import type { CaptureConfigResponse } from "@/lib/capture/contract";

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

// Jakarta is UTC+7 with no DST. 2026-09-30 is a Wednesday; 2026-10-04 a Sunday.
const day = { open: "08:00", close: "22:00" };
const overnight = { open: "09:30", close: "01:00" };
const config: CaptureConfigResponse = {
  timezone: "Asia/Jakarta",
  weekly_hours: {
    mon: day,
    tue: day,
    wed: day,
    thu: day,
    fri: day,
    sat: day,
    sun: null,
  },
  last_ended: null,
  capture_mode: "room",
};

describe("resolveCapturePhase (strict config shape, no consent gate)", () => {
  it("is active inside today's hours", () => {
    expect(
      resolveCapturePhase(config, new Date("2026-09-30T03:00:00Z")), // Wed 10:00 WIB
    ).toBe("active");
  });

  it("is outside_hours before opening", () => {
    expect(
      resolveCapturePhase(config, new Date("2026-09-29T23:00:00Z")), // Wed 06:00 WIB
    ).toBe("outside_hours");
  });

  it("is outside_hours after closing", () => {
    expect(
      resolveCapturePhase(config, new Date("2026-09-30T15:30:00Z")), // Wed 22:30 WIB
    ).toBe("outside_hours");
  });

  it("is outside_hours on a closed weekday", () => {
    expect(
      resolveCapturePhase(config, new Date("2026-10-04T03:00:00Z")), // Sun 10:00 WIB
    ).toBe("outside_hours");
  });

  it("is active after midnight inside a 09:30-01:00 day (business date is the previous day)", () => {
    const overnightConfig: CaptureConfigResponse = {
      ...config,
      weekly_hours: { ...config.weekly_hours, wed: overnight },
    };
    expect(
      resolveCapturePhase(overnightConfig, new Date("2026-09-30T17:30:00Z")), // Thu 00:30 WIB
    ).toBe("active");
  });

  it("only ever returns outside_hours or active", () => {
    const phases = new Set(
      [
        "2026-09-29T23:00:00Z",
        "2026-09-30T03:00:00Z",
        "2026-10-04T03:00:00Z",
      ].map((iso) => resolveCapturePhase(config, new Date(iso))),
    );
    for (const phase of phases) {
      expect(["outside_hours", "active"]).toContain(phase);
    }
  });
});

describe("fetchCaptureConfig (client-side strict boundary)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts the strict config shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: config }), { status: 200 })),
    );
    await expect(fetchCaptureConfig(auth)).resolves.toEqual(config);
  });

  it("rejects a response that still carries consent_complete", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: { ...config, consent_complete: true } }), {
          status: 200,
        }),
      ),
    );
    await expect(fetchCaptureConfig(auth)).rejects.toThrow();
  });
});

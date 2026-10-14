import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSegmentPut,
  createSegmentUploader,
  deviceAuthHeaders,
  fetchCaptureConfig,
  postDemoClosing,
  postSessionDiscard,
  postSessionEnd,
  postSessionStart,
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

  it("carries no X-Session-Id header when no session id is given (pre-P1 bundle shape)", () => {
    expect(req.headers["X-Session-Id"]).toBeUndefined();
  });

  it("stamps X-Session-Id when a session id is given (web spec §6.6.4, release gate)", () => {
    const withSession = buildSegmentPut(segment, auth, "11111111-1111-1111-1111-111111111111");
    expect(withSession.headers["X-Session-Id"]).toBe("11111111-1111-1111-1111-111111111111");
  });
});

describe("session routes (Mulai/Selesai/Batalkan; web spec §6.6.3-§6.6.5)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("postSessionStart: success returns ok:true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe("/api/v1/capture/sessions");
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body as string)).toEqual({
          session_id: "11111111-1111-1111-1111-111111111111",
          started_at_ms: 1000,
        });
        return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
      }),
    );
    const result = await postSessionStart(auth, {
      session_id: "11111111-1111-1111-1111-111111111111",
      started_at_ms: 1000,
    });
    expect(result).toEqual({ ok: true, data: { ok: true } });
  });

  it("postSessionStart: 422 never starts the engine, carries the error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "VALIDATION_ERROR" } }), { status: 422 }),
      ),
    );
    const result = await postSessionStart(auth, {
      session_id: "11111111-1111-1111-1111-111111111111",
      started_at_ms: 1000,
    });
    expect(result).toEqual({ ok: false, status: 422, code: "VALIDATION_ERROR" });
  });

  it("postSessionStart: a network failure (no response) carries no status or code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    const result = await postSessionStart(auth, {
      session_id: "11111111-1111-1111-1111-111111111111",
      started_at_ms: 1000,
    });
    expect(result).toEqual({ ok: false, status: undefined, code: undefined });
  });

  it("postSessionEnd: success posts to the path session id with the device auth", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe(
          "/api/v1/capture/sessions/11111111-1111-1111-1111-111111111111/end",
        );
        expect(init.headers).toMatchObject(deviceAuthHeaders(auth));
        return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
      }),
    );
    const result = await postSessionEnd(auth, "11111111-1111-1111-1111-111111111111", {
      started_at_ms: 1000,
      ended_at_ms: 2000,
      end_reason: "selesai",
    });
    expect(result).toEqual({ ok: true, data: { ok: true } });
  });

  it("postSessionDiscard: a 409 session_ended carries its code, distinct from a generic failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "session_ended" } }), { status: 409 }),
      ),
    );
    const result = await postSessionDiscard(auth, "11111111-1111-1111-1111-111111111111", {
      started_at_ms: 1000,
      discarded_at_ms: 2000,
    });
    expect(result).toEqual({ ok: false, status: 409, code: "session_ended" });
  });

  // R-19 PR-4a (plan 5.4): "Jump to closing time". The 409 not_enough_speech details are counts only
  // ({have, need}), validated with zod before the page may show them; any other shape reads as no details.
  it("postDemoClosing: posts {session_id} to /api/v1/demo/closing with the device auth; 200 is ok:true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe("/api/v1/demo/closing");
        expect(init.headers).toMatchObject(deviceAuthHeaders(auth));
        expect(JSON.parse(String(init.body))).toEqual({ session_id: "11111111-1111-1111-1111-111111111111" });
        return new Response(JSON.stringify({ data: { closing_reached: true } }), { status: 200 });
      }),
    );
    const result = await postDemoClosing(auth, "11111111-1111-1111-1111-111111111111");
    expect(result).toEqual({ ok: true, data: { closing_reached: true } });
  });

  it("postDemoClosing: 409 not_enough_speech carries the validated {have, need} counts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "not_enough_speech", message: "x", details: { have: 3, need: 5 } } }), {
            status: 409,
          }),
      ),
    );
    const result = await postDemoClosing(auth, "11111111-1111-1111-1111-111111111111");
    expect(result).toEqual({ ok: false, status: 409, code: "not_enough_speech", details: { have: 3, need: 5 } });
  });

  it("postDemoClosing: malformed details, another 409, a 404 and a network failure all carry details: null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "not_enough_speech", details: { have: "3", text: "hello" } } }), { status: 409 }),
      ),
    );
    expect(await postDemoClosing(auth, "11111111-1111-1111-1111-111111111111")).toEqual({
      ok: false,
      status: 409,
      code: "not_enough_speech",
      details: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { code: "session_not_open" } }), { status: 409 })),
    );
    expect(await postDemoClosing(auth, "11111111-1111-1111-1111-111111111111")).toEqual({
      ok: false,
      status: 409,
      code: "session_not_open",
      details: null,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    expect(await postDemoClosing(auth, "11111111-1111-1111-1111-111111111111")).toMatchObject({ ok: false, status: 404, details: null });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await postDemoClosing(auth, "11111111-1111-1111-1111-111111111111")).toEqual({
      ok: false,
      status: undefined,
      code: undefined,
      details: null,
    });
  });

  it("postSessionDiscard: a 202 pending-cleanup response is still ok:true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: { ok: true, cleanup: "pending" } }), {
            status: 202,
          }),
      ),
    );
    const result = await postSessionDiscard(auth, "11111111-1111-1111-1111-111111111111", {
      started_at_ms: 1000,
      discarded_at_ms: 2000,
    });
    expect(result).toEqual({ ok: true, data: { ok: true, cleanup: "pending" } });
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

// R-19 PR-4a (plan 5.2): the segment response is a line COUNT (`{seg_id, lines}`), never text. The uploader hands
// that count to an optional callback after a 200 that is not `{discarded: true}`; the engine contract (status or
// null) is unchanged.
describe("createSegmentUploader onAccepted (R-19 line counting)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (status: number, body: unknown, ok = status < 400) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status, json: async () => body }) as Response));

  it("200 {seg_id, lines}: returns the status and reports the line count", async () => {
    stub(200, { data: { seg_id: "seg-abc", lines: 3 } });
    const accepted: number[] = [];
    const upload = createSegmentUploader(auth, undefined, (n) => accepted.push(n));
    expect(await upload(segment)).toBe(200);
    expect(accepted).toEqual([3]);
  });

  it("200 {discarded: true}: the status is returned and nothing is reported", async () => {
    stub(200, { data: { discarded: true } });
    const onAccepted = vi.fn();
    expect(await createSegmentUploader(auth, undefined, onAccepted)(segment)).toBe(200);
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("a non-2xx, a body without a numeric lines field, or an unreadable body: status returned, nothing reported, no throw", async () => {
    const onAccepted = vi.fn();
    stub(422, { error: { code: "VALIDATION_ERROR" } });
    expect(await createSegmentUploader(auth, "11111111-1111-4111-8111-111111111111", onAccepted)(segment)).toBe(422);
    stub(200, { data: { seg_id: "seg-abc", lines: "three" } });
    expect(await createSegmentUploader(auth, undefined, onAccepted)(segment)).toBe(200);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } }) as unknown as Response),
    );
    expect(await createSegmentUploader(auth, undefined, onAccepted)(segment)).toBe(200);
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("without a callback (every existing caller) the uploader behaves exactly as before", async () => {
    stub(200, { data: { seg_id: "seg-abc", lines: 3 } });
    expect(await createSegmentUploader(auth)(segment)).toBe(200);
  });
});

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

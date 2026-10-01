import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import * as guardModule from "@/lib/http/guard";
import * as storesModule from "@/lib/firestore/stores";

vi.mock("@/lib/http/guard");
vi.mock("@/lib/firestore/stores");

/**
 * Round-2 fix for finding 1 (hard rule #7 / B-5, server-side): a stale client
 * bundle (loaded before this deploys) could still post the raw device label
 * in `mic_source`. The server must classify it before storage, regardless of
 * what the client sent — classifying only in the browser (`session.ts`) is
 * not a security boundary on its own.
 */
describe("POST /api/v1/heartbeat (mic_source server-side classification)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function heartbeatRequest(body: Record<string, unknown>) {
    return new NextRequest("http://localhost/api/v1/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("classifies a raw device label from a stale client into a fixed bucket, never storing the raw string", async () => {
    vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({
      outlet_id: "outlet-1",
      device_id: "device-1",
      role: "device",
    });

    const saveHeartbeat = vi.fn().mockResolvedValueOnce(undefined);
    vi.spyOn(storesModule, "firestoreCaptureStore").mockReturnValueOnce({
      getOutlet: vi.fn(),
      saveHeartbeat,
    });

    const req = heartbeatRequest({
      ts: "2026-10-01T10:00:00.000Z",
      // A stale (pre-fix) client posting the raw Bluetooth label verbatim.
      mic_source: "Dina's AirPods",
      sample_rate: 16000,
      speech_pct: 42,
      queue_size: 0,
      battery: 80,
      screen_awake: true,
    });

    const response = await POST(req);
    expect(response.status).toBe(200);

    expect(saveHeartbeat).toHaveBeenCalledTimes(1);
    const stored = saveHeartbeat.mock.calls[0]?.[0];
    expect(stored?.mic_source).toBe("bluetooth");
    expect(stored?.mic_source).not.toMatch(/dina/i);
    expect(JSON.stringify(stored)).not.toContain("AirPods");
  });

  it("still stores an already-classified value from an up-to-date client unchanged", async () => {
    vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({
      outlet_id: "outlet-1",
      device_id: "device-1",
      role: "device",
    });

    const saveHeartbeat = vi.fn().mockResolvedValueOnce(undefined);
    vi.spyOn(storesModule, "firestoreCaptureStore").mockReturnValueOnce({
      getOutlet: vi.fn(),
      saveHeartbeat,
    });

    const req = heartbeatRequest({
      ts: "2026-10-01T10:00:00.000Z",
      mic_source: "built-in",
      sample_rate: 16000,
      speech_pct: 10,
      queue_size: 0,
      battery: 80,
      screen_awake: true,
    });

    const response = await POST(req);
    expect(response.status).toBe(200);

    const stored = saveHeartbeat.mock.calls[0]?.[0];
    expect(stored?.mic_source).toBe("built-in");
  });
});

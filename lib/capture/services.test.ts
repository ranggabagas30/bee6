import { describe, expect, it } from "vitest";
import {
  getCaptureConfig,
  recordHeartbeat,
  type HeartbeatWriter,
  type OutletReader,
} from "@/lib/capture/services";
import { NotFoundError, ForbiddenError } from "@/lib/http/errors";
import type { Heartbeat, Outlet } from "@/lib/firestore/schema";
import type { HeartbeatRequest } from "@/lib/capture/contract";

const outlet: Outlet = {
  outlet_id: "outlet-1",
  name: "Proofed",
  project_kind: "pilot",
  consent_complete: true,
  timezone: "Asia/Jakarta",
  opening_time: "07:00",
  closing_time: "21:45",
  created_at: "2026-09-30T00:00:00.000Z",
};

function outletReader(doc: Outlet | null): OutletReader {
  return { getOutlet: async () => doc };
}

function heartbeatWriter(): HeartbeatWriter & { saved: Heartbeat[] } {
  const saved: Heartbeat[] = [];
  return {
    saved,
    saveHeartbeat: async (hb) => {
      saved.push(hb);
    },
  };
}

const request: HeartbeatRequest = {
  ts: "2026-09-30T10:00:00.000Z",
  mic_source: "built-in",
  sample_rate: 16_000,
  speech_pct: 42,
  queue_size: 3,
  battery: 88,
  screen_awake: true,
};

describe("getCaptureConfig", () => {
  it("returns the allowlist subset for an existing outlet", async () => {
    const config = await getCaptureConfig(outletReader(outlet), {
      outlet_id: "outlet-1",
    });
    expect(config).toEqual({
      consent_complete: true,
      opening_time: "07:00",
      closing_time: "21:45",
      timezone: "Asia/Jakarta",
    });
  });

  it("does not leak the outlet name or project_kind", async () => {
    const config = await getCaptureConfig(outletReader(outlet), {
      outlet_id: "outlet-1",
    });
    expect(config).not.toHaveProperty("name");
    expect(config).not.toHaveProperty("project_kind");
    expect(config).not.toHaveProperty("outlet_id");
  });

  it("throws NotFoundError when the outlet is missing", async () => {
    await expect(
      getCaptureConfig(outletReader(null), { outlet_id: "gone" }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("recordHeartbeat", () => {
  it("stores a heartbeat with outlet_id/device_id from the claims", async () => {
    const writer = heartbeatWriter();
    const hb = await recordHeartbeat(writer, {
      request,
      claims: { outlet_id: "outlet-1", device_id: "dev-1" },
    });
    expect(hb.outlet_id).toBe("outlet-1");
    expect(hb.device_id).toBe("dev-1");
    expect(writer.saved).toHaveLength(1);
    expect(writer.saved[0]?.device_id).toBe("dev-1");
  });

  it("ignores any outlet_id/device_id a client tries to smuggle in the body", async () => {
    const writer = heartbeatWriter();
    // Extra fields would be rejected by HeartbeatRequestSchema at the route, but
    // even if they reached here the claims are authoritative.
    const hb = await recordHeartbeat(writer, {
      request,
      claims: { outlet_id: "real-outlet", device_id: "real-dev" },
    });
    expect(hb.outlet_id).toBe("real-outlet");
    expect(hb.device_id).toBe("real-dev");
  });

  it("throws ForbiddenError and writes nothing when device_id is absent", async () => {
    const writer = heartbeatWriter();
    await expect(
      recordHeartbeat(writer, {
        request,
        claims: { outlet_id: "outlet-1", device_id: undefined },
      }),
    ).rejects.toThrow(ForbiddenError);
    expect(writer.saved).toHaveLength(0);
  });
});

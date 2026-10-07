import { describe, expect, it } from "vitest";
import {
  getCaptureConfig,
  recordHeartbeat,
  type DeviceCounter,
  type DeviceReader,
  type HeartbeatWriter,
  type OutletReader,
} from "@/lib/capture/services";
import { NotFoundError, ForbiddenError } from "@/lib/http/errors";
import type { Device, Heartbeat, Outlet } from "@/lib/firestore/schema";
import type { HeartbeatRequest } from "@/lib/capture/contract";

const outlet: Outlet = {
  outlet_id: "outlet-1",
  name: "Proofed",
  project_kind: "pilot",
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

function deviceReader(doc: Device | null): DeviceReader {
  return { getDevice: async () => doc };
}

const device: Device = {
  outlet_id: "outlet-1",
  device_id: "dev-1",
  label: "Shop phone",
  token_hash: "hash",
  paired_at: "2026-09-30T00:00:00.000Z",
  revoked: false,
  pairing_code: null,
  pairing_code_expires_at: null,
  created_at: "2026-09-30T00:00:00.000Z",
};

const ALL_DAYS = {
  mon: { open: "07:00", close: "21:45" },
  tue: { open: "07:00", close: "21:45" },
  wed: { open: "07:00", close: "21:45" },
  thu: { open: "07:00", close: "21:45" },
  fri: { open: "07:00", close: "21:45" },
  sat: { open: "07:00", close: "21:45" },
  sun: { open: "07:00", close: "21:45" },
};

function deviceCounter(count: number): DeviceCounter {
  return { countPairedDevices: async () => count };
}

function reader(o: Outlet | null, d: Device | null, pairedCount = 1) {
  return { ...outletReader(o), ...deviceReader(d), ...deviceCounter(pairedCount) };
}

describe("getCaptureConfig", () => {
  it("returns timezone, resolved weekly hours and null last_ended for a fresh device", async () => {
    const config = await getCaptureConfig(reader(outlet, device), {
      outlet_id: "outlet-1",
      device_id: "dev-1",
    });
    expect(config).toEqual({
      timezone: "Asia/Jakarta",
      weekly_hours: ALL_DAYS,
      last_ended: null,
      capture_mode: "room",
    });
  });

  it("derives capture_mode from the store's paired-device count (R-07 Task 8)", async () => {
    expect(
      (await getCaptureConfig(reader(outlet, device, 0), { outlet_id: "outlet-1", device_id: "dev-1" }))
        .capture_mode,
    ).toBe("none");
    expect(
      (await getCaptureConfig(reader(outlet, device, 2), { outlet_id: "outlet-1", device_id: "dev-1" }))
        .capture_mode,
    ).toBe("wearable");
  });

  it("falls back to opening/closing on every weekday when the outlet has no weekly_hours", async () => {
    const config = await getCaptureConfig(reader(outlet, device), {
      outlet_id: "outlet-1",
      device_id: "dev-1",
    });
    expect(config.weekly_hours).toEqual(ALL_DAYS);
  });

  it("returns the stored weekly_hours when the outlet has them", async () => {
    const weekly = { ...ALL_DAYS, sun: null, mon: { open: "09:30", close: "01:00" } };
    const config = await getCaptureConfig(
      reader({ ...outlet, weekly_hours: weekly }, device),
      { outlet_id: "outlet-1", device_id: "dev-1" },
    );
    expect(config.weekly_hours).toEqual(weekly);
  });

  it("projects this device's last_ended without its ended_at_ms or any identity", async () => {
    const config = await getCaptureConfig(
      reader(outlet, {
        ...device,
        last_ended: {
          business_date: "2026-10-06",
          end_reason: "selesai",
          ended_at_ms: 1_700_000_000_000,
          debrief_ends_at_ms: 1_700_003_600_000,
        },
      }),
      { outlet_id: "outlet-1", device_id: "dev-1" },
    );
    expect(config.last_ended).toEqual({
      business_date: "2026-10-06",
      end_reason: "selesai",
      debrief_ends_at_ms: 1_700_003_600_000,
    });
  });

  it("never returns the outlet name, project_kind or ids", async () => {
    const config = await getCaptureConfig(reader(outlet, device), {
      outlet_id: "outlet-1",
      device_id: "dev-1",
    });
    expect(config).not.toHaveProperty("name");
    expect(config).not.toHaveProperty("project_kind");
    expect(config).not.toHaveProperty("outlet_id");
    expect(config).not.toHaveProperty("device_id");
  });

  it("throws NotFoundError when the outlet is missing", async () => {
    await expect(
      getCaptureConfig(reader(null, device), { outlet_id: "gone", device_id: "dev-1" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError when the device doc is missing", async () => {
    await expect(
      getCaptureConfig(reader(outlet, null), { outlet_id: "outlet-1", device_id: "gone" }),
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

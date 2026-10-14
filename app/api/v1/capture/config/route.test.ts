import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import * as servicesModule from "@/lib/auth/services";
import * as storesModule from "@/lib/firestore/stores";
import * as adminModule from "@/lib/firebase/admin";
import { FRESH_DEMO_SESSION } from "@/lib/capture/contract";
import { UnauthorizedError } from "@/lib/http/errors";
import type { Device, Outlet } from "@/lib/firestore/schema";

vi.mock("@/lib/auth/services");
vi.mock("@/lib/firestore/stores");
vi.mock("@/lib/firestore/demo-store");
vi.mock("@/lib/firebase/admin", () => ({ verifyIdToken: vi.fn() }));
import * as demoStoreModule from "@/lib/firestore/demo-store";
import { fakeNextDayStore } from "@/lib/demo/testing/fake-next-day-store";

/** web spec §6.6.2: GET /api/v1/capture/config, device-only, strict allowlist. */

const outlet: Outlet = {
  outlet_id: "outlet-1",
  name: "Proofed",
  project_kind: "pilot",
  timezone: "Asia/Jakarta",
  opening_time: "07:00",
  closing_time: "21:45",
  created_at: "2026-09-30T00:00:00.000Z",
};

function device(overrides: Partial<Device> = {}): Device {
  return {
    outlet_id: "outlet-1",
    device_id: "dev-1",
    label: "Kasir 1",
    token_hash: "$2b$10$hashhashhashhashhashhashhashhashhashhashhashhashhash",
    paired_at: "2026-09-30T00:00:00.000Z",
    revoked: false,
    pairing_code: null,
    pairing_code_expires_at: null,
    created_at: "2026-09-30T00:00:00.000Z",
    last_ended: {
      business_date: "2026-10-05",
      end_reason: "selesai",
      ended_at_ms: Date.parse("2026-10-05T14:00:00.000Z"),
      debrief_ends_at_ms: Date.parse("2026-10-05T14:30:00.000Z"),
    },
    ...overrides,
  };
}

function req(headers: Record<string, string> = { authorization: "Bearer t", "x-device-id": "dev-1" }) {
  return new NextRequest("http://localhost/api/v1/capture/config", { method: "GET", headers });
}

function wireDevice(d: Device | null = device(), pairedDeviceCount = 1, o: Outlet = outlet) {
  vi.mocked(adminModule.verifyIdToken).mockRejectedValue(new Error("not an ID token"));
  vi.mocked(servicesModule.authenticateDeviceToken).mockResolvedValue({
    outlet_id: "outlet-1",
    role: "device",
    device_id: "dev-1",
  } as never);
  vi.mocked(storesModule.firestoreCaptureStore).mockReturnValue({
    getOutlet: async () => o,
    getDevice: async () => d,
    saveHeartbeat: async () => undefined,
    countPairedDevices: async () => pairedDeviceCount,
  } as never);
}

describe("GET /api/v1/capture/config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 with no bearer token", async () => {
    const res = await GET(req({ "x-device-id": "dev-1" }));
    expect(res.status).toBe(401);
  });

  it("401 when the device token does not verify", async () => {
    vi.mocked(adminModule.verifyIdToken).mockRejectedValue(new Error("not an ID token"));
    vi.mocked(servicesModule.authenticateDeviceToken).mockRejectedValue(
      new UnauthorizedError("Invalid device token"),
    );
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("403 for a supervisor ID token (only a paired device may read the config)", async () => {
    vi.mocked(adminModule.verifyIdToken).mockResolvedValue({
      claims: { outlet_id: "outlet-1", role: "supervisor" },
    } as never);
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(servicesModule.authenticateDeviceToken).not.toHaveBeenCalled();
  });

  it("200 with exactly {timezone, weekly_hours, last_ended, capture_mode} and no consent key", async () => {
    wireDevice();
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(Object.keys(body.data).sort()).toEqual([
      "capture_mode",
      "last_ended",
      "timezone",
      "weekly_hours",
    ]);
    expect(body.data.timezone).toBe("Asia/Jakarta");
    expect(body.data.weekly_hours).toMatchObject({ mon: { open: "07:00", close: "21:45" } });
    expect(body.data.last_ended).toEqual({
      business_date: "2026-10-05",
      end_reason: "selesai",
      debrief_ends_at_ms: Date.parse("2026-10-05T14:30:00.000Z"),
    });
    expect(body.data.capture_mode).toBe("room");
    expect(JSON.stringify(body)).not.toMatch(/consent/i);
  });

  it("200 with capture_mode derived from the paired-device count", async () => {
    wireDevice(device(), 0);
    const none = (await (await GET(req())).json()) as { data: Record<string, unknown> };
    expect(none.data.capture_mode).toBe("none");

    wireDevice(device(), 2);
    const wearable = (await (await GET(req())).json()) as { data: Record<string, unknown> };
    expect(wearable.data.capture_mode).toBe("wearable");
  });

  it("200 with last_ended null and no device identity when the device has never ended a day", async () => {
    wireDevice(device({ last_ended: undefined }));
    const res = await GET(req());
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.last_ended).toBeNull();
    const text = JSON.stringify(body);
    expect(text).not.toContain("dev-1");
    expect(text).not.toContain("Kasir 1");
    expect(text).not.toContain("token_hash");
  });

  describe("R-18 demo_session", () => {
    const sandbox = { template_outlet_id: "demo-tpl-outlet", created_at_ms: 1, expires_at_ms: 2, key_sha256: "a".repeat(64) };
    const sbxOutlet: Outlet = { ...outlet, project_kind: "demo", sandbox };
    const judge = (over: Partial<Device> = {}) => device({ expires_at_ms: 9_000_000_000_000, ...over });
    afterEach(() => vi.unstubAllEnvs());

    it("DEMO_MODE=true + sandbox outlet + expiring device: the profile is present (fresh sandbox = FRESH_DEMO_SESSION)", async () => {
      vi.stubEnv("DEMO_MODE", "true");
      wireDevice(judge({ last_ended: undefined }), 1, sbxOutlet);
      vi.mocked(demoStoreModule.firestoreNextDayStore).mockReturnValue(fakeNextDayStore({ outlet: sbxOutlet, last_ended: null }).store);
      const body = (await (await GET(req())).json()) as { data: Record<string, unknown> };
      expect(body.data.demo_session).toEqual(FRESH_DEMO_SESSION);
    });

    it("R-19 PR-2: day, days_done and next_day come from the sandbox's next_day_count and the server-side guards (no write)", async () => {
      vi.stubEnv("DEMO_MODE", "true");
      const NOW = Date.parse("2026-10-14T03:00:00.000Z");
      vi.spyOn(Date, "now").mockReturnValue(NOW);
      const endedToday = { business_date: "2026-10-14", end_reason: "selesai" as const, ended_at_ms: NOW - 10 * 60_000, debrief_ends_at_ms: NOW + 50 * 60_000 };
      const dayTwo: Outlet = { ...sbxOutlet, sandbox: { ...sandbox, next_day_count: 1 } };
      wireDevice(judge({ last_ended: endedToday }), 1, dayTwo);
      const fake = fakeNextDayStore({ outlet: dayTwo, last_ended: endedToday });
      vi.mocked(demoStoreModule.firestoreNextDayStore).mockReturnValue(fake.store);
      const body = (await (await GET(req())).json()) as { data: Record<string, unknown> };
      expect(body.data.demo_session).toMatchObject({ day: 2, days_done: 2, next_day: { allowed: true, reason: null }, script_id: "bakery-v1" });
      expect(body.data.last_ended).toEqual({ business_date: "2026-10-14", end_reason: "selesai", debrief_ends_at_ms: NOW + 50 * 60_000 });
      expect(fake.calls).toEqual(["getOutlet:outlet-1", "readGuardState"]);
      expect(JSON.stringify(body)).not.toContain("dev-1");
    });

    it("R-19 PR-2: a locked jump reports its reason (proposal_exists) so the drawer needs no call", async () => {
      vi.stubEnv("DEMO_MODE", "true");
      vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-14T03:00:00.000Z"));
      const endedToday = { business_date: "2026-10-14", end_reason: "selesai" as const, ended_at_ms: Date.now() - 10 * 60_000, debrief_ends_at_ms: Date.now() + 50 * 60_000 };
      wireDevice(judge({ last_ended: endedToday }), 1, sbxOutlet);
      const fake = fakeNextDayStore({ outlet: sbxOutlet, last_ended: endedToday, docs: { proposals: { p: { outlet_id: "outlet-1", content: {} } } } });
      vi.mocked(demoStoreModule.firestoreNextDayStore).mockReturnValue(fake.store);
      const body = (await (await GET(req())).json()) as { data: Record<string, unknown> };
      expect(body.data.demo_session).toMatchObject({ day: 1, days_done: 1, next_day: { allowed: false, reason: "proposal_exists" } });
    });

    it("R-19 PR-2 (QA defect 2): a set shift marker is reported (busy while fresh, shift_incomplete once stale), not day_not_ended", async () => {
      vi.stubEnv("DEMO_MODE", "true");
      const NOW = Date.parse("2026-10-14T03:00:00.000Z");
      vi.spyOn(Date, "now").mockReturnValue(NOW);
      // After a crashed shift: last_ended already moved to yesterday, the marker still set.
      const movedBack = { business_date: "2026-10-13", end_reason: "selesai" as const, ended_at_ms: NOW - 86_400_000 - 10 * 60_000, debrief_ends_at_ms: NOW - 86_400_000 + 50 * 60_000 };
      for (const [started, reason] of [[NOW - 5_000, "busy"], [NOW - 200_000, "shift_incomplete"]] as const) {
        const marked: Outlet = { ...sbxOutlet, sandbox: { ...sandbox, shift_started_at_ms: started } };
        wireDevice(judge({ last_ended: movedBack }), 1, marked);
        vi.mocked(demoStoreModule.firestoreNextDayStore).mockReturnValue(fakeNextDayStore({ outlet: marked, last_ended: movedBack }).store);
        const body = (await (await GET(req())).json()) as { data: Record<string, unknown> };
        expect(body.data.demo_session).toMatchObject({ next_day: { allowed: false, reason } });
      }
    });

    it("DEMO_MODE unset (the pilot): never present, whatever the docs say; keys are exactly the pilot four; no demo store is built", async () => {
      vi.stubEnv("DEMO_MODE", "");
      wireDevice(judge(), 1, sbxOutlet);
      const body = (await (await GET(req())).json()) as { data: Record<string, unknown> };
      expect(Object.keys(body.data).sort()).toEqual(["capture_mode", "last_ended", "timezone", "weekly_hours"]);
      expect(demoStoreModule.firestoreNextDayStore).not.toHaveBeenCalled();
    });

    it("DEMO_MODE=true on a plain outlet with a real device: no profile", async () => {
      vi.stubEnv("DEMO_MODE", "true");
      wireDevice(device(), 1, outlet);
      const body = (await (await GET(req())).json()) as { data: Record<string, unknown> };
      expect(body.data).not.toHaveProperty("demo_session");
    });
  });
});

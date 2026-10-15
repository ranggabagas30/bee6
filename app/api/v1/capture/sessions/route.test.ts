import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import * as servicesModule from "@/lib/auth/services";
import * as storesModule from "@/lib/firestore/stores";
import { UnauthorizedError } from "@/lib/http/errors";
import { memorySessionStore } from "@/lib/capture/testing/memory-session-store";
import type { Outlet } from "@/lib/firestore/schema";

vi.mock("@/lib/auth/services");
vi.mock("@/lib/firestore/stores");

const S1 = "11111111-1111-4111-8111-111111111111";
const day = { open: "07:00", close: "21:45" };
const outlet: Outlet = {
  outlet_id: "outlet-1",
  name: "Proofed",
  project_kind: "pilot",
  timezone: "Asia/Jakarta",
  opening_time: "07:00",
  closing_time: "21:45",
  created_at: "2026-09-30T00:00:00.000Z",
};
const NOW = Date.parse("2026-10-06T03:00:00.000Z"); // 10:00 Jakarta, Tuesday

function req(body: unknown, headers: Record<string, string> = { authorization: "Bearer t", "x-device-id": "dev-1" }) {
  return new NextRequest("http://localhost/api/v1/capture/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function wire(role: "device" | "supervisor" = "device", o: Outlet = outlet, deviceExpiresAtMs?: number) {
  vi.mocked(servicesModule.authenticateDeviceToken).mockResolvedValue({
    outlet_id: "outlet-1",
    role,
    device_id: "dev-1",
  } as never);
  const sessions = memorySessionStore();
  vi.mocked(storesModule.firestoreCaptureSessionStore).mockReturnValue(sessions.store);
  vi.mocked(storesModule.firestoreCaptureStore).mockReturnValue({
    getOutlet: async () => ({ ...o, weekly_hours: undefined, opening_time: day.open }),
    getDevice: async () => (deviceExpiresAtMs === undefined ? { device_id: "dev-1" } : { device_id: "dev-1", expires_at_ms: deviceExpiresAtMs }),
    saveHeartbeat: async () => undefined,
  } as never);
  return sessions;
}

describe("POST /api/v1/capture/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });

  it("401 with no bearer token, before the body is read", async () => {
    const res = await POST(req({ session_id: S1, started_at_ms: NOW }, {}));
    expect(res.status).toBe(401);
  });

  it("401 when the device token does not verify", async () => {
    vi.mocked(servicesModule.authenticateDeviceToken).mockRejectedValue(
      new UnauthorizedError("Invalid device token"),
    );
    const res = await POST(req({ session_id: S1, started_at_ms: NOW }));
    expect(res.status).toBe(401);
  });

  it("403 when the principal is not a paired device (e.g. a supervisor token)", async () => {
    wire("supervisor");
    const res = await POST(req({ session_id: S1, started_at_ms: NOW }));
    expect(res.status).toBe(403);
  });

  it("422 for a body that is not a uuid, or carries an extra field", async () => {
    wire();
    expect((await POST(req({ session_id: "not-a-uuid", started_at_ms: NOW }))).status).toBe(422);
    expect((await POST(req({ session_id: S1, started_at_ms: NOW, device_id: "dev-2" }))).status).toBe(422);
  });

  it("422 for a start more than 5 minutes in the future or older than 7 days", async () => {
    wire();
    expect((await POST(req({ session_id: S1, started_at_ms: NOW + 5 * 60_000 + 1 }))).status).toBe(422);
    expect((await POST(req({ session_id: S1, started_at_ms: NOW - 7 * 86_400_000 - 1 }))).status).toBe(422);
  });

  it("400 for an unparseable body", async () => {
    wire();
    expect((await POST(req("{not json"))).status).toBe(400);
  });

  it("200 { data: { ok: true } } on create and on a repeat start", async () => {
    const sessions = wire();
    const first = await POST(req({ session_id: S1, started_at_ms: NOW }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ data: { ok: true } });
    const repeat = await POST(req({ session_id: S1, started_at_ms: NOW }));
    expect(repeat.status).toBe(200);
    expect(sessions.state.audits.map((a) => a.action)).toEqual(["capture.session_start"]);
  });

  describe("R-18 sandbox auto-stop", () => {
    const sandbox = { template_outlet_id: "demo-tpl-outlet", created_at_ms: 1, expires_at_ms: 2, key_sha256: "a".repeat(64) };
    const sbx: Outlet = { ...outlet, project_kind: "demo", sandbox };
    afterEach(() => vi.unstubAllEnvs());

    it("R-21 O-3: DEMO_MODE + sandbox outlet: auto_stop_at_ms = start + 20 min", async () => {
      vi.stubEnv("DEMO_MODE", "true");
      const sessions = wire("device", sbx, 9_000_000_000_000);
      await POST(req({ session_id: S1, started_at_ms: NOW }));
      expect(sessions.state.session?.auto_stop_at_ms).toBe(NOW + 1_200_000);
    });

    it("11a: the same predicate as the capture config: a sandbox outlet whose device carries no expiry gets the normal close + 1 h", async () => {
      vi.stubEnv("DEMO_MODE", "true");
      const sessions = wire("device", sbx); // device doc without expires_at_ms
      await POST(req({ session_id: S1, started_at_ms: NOW }));
      expect(sessions.state.session?.auto_stop_at_ms).toBe(Date.parse("2026-10-06T15:45:00.000Z"));
    });

    it("sandbox outlet without DEMO_MODE, or DEMO_MODE on a real outlet: the normal close + 1 h", async () => {
      const normal = Date.parse("2026-10-06T15:45:00.000Z"); // 21:45 + 1 h Jakarta = 22:45 = 15:45Z
      vi.stubEnv("DEMO_MODE", "");
      const a = wire("device", sbx);
      await POST(req({ session_id: S1, started_at_ms: NOW }));
      expect(a.state.session?.auto_stop_at_ms).toBe(normal);
      vi.stubEnv("DEMO_MODE", "true");
      const b = wire("device", outlet);
      await POST(req({ session_id: S1, started_at_ms: NOW }));
      expect(b.state.session?.auto_stop_at_ms).toBe(normal);
    });
  });
});

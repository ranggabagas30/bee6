import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import * as servicesModule from "@/lib/auth/services";
import * as storesModule from "@/lib/firestore/stores";
import { UnauthorizedError } from "@/lib/http/errors";
import { memorySessionStore } from "@/lib/capture/testing/memory-session-store";
import type { CaptureSession, Outlet } from "@/lib/firestore/schema";

vi.mock("@/lib/auth/services");
vi.mock("@/lib/firestore/stores");

const S1 = "11111111-1111-4111-8111-111111111111";
const outlet: Outlet = {
  outlet_id: "outlet-1",
  name: "Proofed",
  project_kind: "pilot",
  timezone: "Asia/Jakarta",
  opening_time: "07:00",
  closing_time: "21:45",
  created_at: "2026-09-30T00:00:00.000Z",
};
const START = Date.parse("2026-10-06T03:00:00.000Z"); // 10:00 Jakarta
const NOW = START + 9_000;

function req(body: unknown, headers: Record<string, string> = { authorization: "Bearer t", "x-device-id": "dev-1" }, sid = S1) {
  const request = new NextRequest(`http://localhost/api/v1/capture/sessions/${sid}/discard`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { request, ctx: { params: Promise.resolve({ session_id: sid }) } };
}

const send = (...a: Parameters<typeof req>) => {
  const { request, ctx } = req(...a);
  return POST(request, ctx);
};

function wire(role: "device" | "supervisor" = "device", session: CaptureSession | null = null) {
  vi.mocked(servicesModule.authenticateDeviceToken).mockResolvedValue({
    outlet_id: "outlet-1",
    role,
    device_id: "dev-1",
  } as never);
  const sessions = memorySessionStore({ session });
  vi.mocked(storesModule.firestoreCaptureSessionStore).mockReturnValue(sessions.store);
  vi.mocked(storesModule.firestoreCaptureStore).mockReturnValue({
    getOutlet: async () => outlet,
    getDevice: async () => null,
    saveHeartbeat: async () => undefined,
  } as never);
  return sessions;
}

const discardBody = { started_at_ms: START, discarded_at_ms: START + 8_000 };
const openSession: CaptureSession = {
  outlet_id: "outlet-1",
  device_id: "dev-1",
  session_id: S1,
  started_at_ms: START,
  ended_at_ms: null,
  end_reason: null,
  local_date: "2026-10-06",
  auto_stop_at_ms: START + 14 * 3_600_000,
  debrief_ends_at_ms: null,
  received_start_at: "2026-10-06T03:00:00.000Z",
  received_end_at: null,
};

describe("POST /api/v1/capture/sessions/{session_id}/discard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });

  it("401 with no bearer token", async () => {
    const { request, ctx } = req(discardBody, {});
    expect((await POST(request, ctx)).status).toBe(401);
  });

  it("401 when the device token does not verify", async () => {
    vi.mocked(servicesModule.authenticateDeviceToken).mockRejectedValue(new UnauthorizedError("Invalid device token"));
    const { request, ctx } = req(discardBody);
    expect((await POST(request, ctx)).status).toBe(401);
  });

  it("403 when the principal is not a paired device", async () => {
    wire("supervisor", openSession);
    const { request, ctx } = req(discardBody);
    expect((await POST(request, ctx)).status).toBe(403);
  });

  it("422 for a path id that is not a uuid", async () => {
    wire("device", openSession);
    const { request, ctx } = req(discardBody, undefined, "nope");
    expect((await POST(request, ctx)).status).toBe(422);
  });

  it("422 for a body carrying device_id, or a discard older than 8 days", async () => {
    wire("device", openSession);
    expect((await send({ ...discardBody, device_id: "dev-2" })).status).toBe(422);
    const old = { started_at_ms: NOW - 8 * 86_400_000 - 1, discarded_at_ms: NOW - 8 * 86_400_000 - 1 };
    expect((await send(old)).status).toBe(422);
  });

  it("202 { data: { ok: true, cleanup: 'pending' } } while Cancel-B cleanup has not run", async () => {
    const sessions = wire("device", openSession);
    const { request, ctx } = req(discardBody);
    const res = await POST(request, ctx);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ data: { ok: true, cleanup: "pending" } });
    expect(sessions.state.session?.end_reason).toBe("discarded");
  });

  it("409 { error: { code: 'session_ended' } } after Selesai, with nothing written", async () => {
    const ended: CaptureSession = {
      ...openSession,
      ended_at_ms: START + 3_600_000,
      end_reason: "selesai",
      debrief_ends_at_ms: START + 7_200_000,
      received_end_at: "2026-10-06T04:00:00.000Z",
    };
    const sessions = wire("device", ended);
    const { request, ctx } = req(discardBody);
    const res = await POST(request, ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "session_ended" } });
    expect(sessions.state.session).toEqual(ended);
    expect(sessions.state.audits).toEqual([]);
  });
});

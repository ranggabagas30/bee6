import { beforeEach, describe, expect, it, vi } from "vitest";
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
const NOW = START + 3_600_000;

function req(body: unknown, headers: Record<string, string> = { authorization: "Bearer t", "x-device-id": "dev-1" }, sid = S1) {
  const request = new NextRequest(`http://localhost/api/v1/capture/sessions/${sid}/end`, {
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

function wire(role: "device" | "owner" = "device", seed: Parameters<typeof memorySessionStore>[0] = {}) {
  vi.mocked(servicesModule.authenticateDeviceToken).mockResolvedValue({
    outlet_id: "outlet-1",
    role,
    device_id: "dev-1",
  } as never);
  const sessions = memorySessionStore(seed);
  vi.mocked(storesModule.firestoreCaptureSessionStore).mockReturnValue(sessions.store);
  vi.mocked(storesModule.firestoreCaptureStore).mockReturnValue({
    getOutlet: async () => outlet,
    getDevice: async () => null,
    saveHeartbeat: async () => undefined,
  } as never);
  return sessions;
}

const endBody = { started_at_ms: START, ended_at_ms: START + 3_600_000, end_reason: "selesai" };

describe("POST /api/v1/capture/sessions/{session_id}/end", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });

  it("401 with no bearer token", async () => {
    const { request, ctx } = req(endBody, {});
    expect((await POST(request, ctx)).status).toBe(401);
  });

  it("401 when the device token does not verify", async () => {
    vi.mocked(servicesModule.authenticateDeviceToken).mockRejectedValue(new UnauthorizedError("Invalid device token"));
    const { request, ctx } = req(endBody);
    expect((await POST(request, ctx)).status).toBe(401);
  });

  it("403 when the principal is not a paired device", async () => {
    wire("owner");
    const { request, ctx } = req(endBody);
    expect((await POST(request, ctx)).status).toBe(403);
  });

  it("422 for a path id that is not a uuid", async () => {
    wire();
    const { request, ctx } = req(endBody, undefined, "not-a-uuid");
    expect((await POST(request, ctx)).status).toBe(422);
  });

  it("422 for an end before the start, an unknown end_reason, or an extra field", async () => {
    wire();
    expect((await send({ ...endBody, ended_at_ms: START - 1 })).status).toBe(422);
    expect((await send({ ...endBody, end_reason: "discarded" })).status).toBe(422);
    expect((await send({ ...endBody, device_id: "x" })).status).toBe(422);
  });

  it("400 for a body that is not JSON, with nothing written", async () => {
    const sessions = wire();
    const before = JSON.stringify(sessions.state);
    expect((await send("{not json")).status).toBe(400);
    expect(JSON.stringify(sessions.state)).toBe(before);
  });

  it("200 { data: { ok: true } } and writes the end; a repeat end is unchanged", async () => {
    const sessions = wire();
    const { request, ctx } = req(endBody);
    const res = await POST(request, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { ok: true } });
    expect(sessions.state.session?.end_reason).toBe("selesai");
    const again = await send(endBody);
    expect(again.status).toBe(200);
  });
});

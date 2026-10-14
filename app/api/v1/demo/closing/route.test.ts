import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, OPTIONS, PATCH, POST, PUT } from "./route";
import * as servicesModule from "@/lib/auth/services";
import * as storesModule from "@/lib/firestore/stores";
import * as closingStoreModule from "@/lib/firestore/closing-store";
import type { ClosingStore } from "@/lib/demo/closing";
import type { CaptureSession, Outlet } from "@/lib/firestore/schema";

vi.mock("@/lib/auth/services");
vi.mock("@/lib/firestore/stores");
vi.mock("@/lib/firestore/closing-store");

/**
 * POST /api/v1/demo/closing (R-19 PR-4a, plan sections 2.3 and 5.4). Demo only: off DEMO_MODE, off a sandbox
 * outlet id, or off a demo sandbox outlet doc, the answer is the same 404 (before any further read). Then the
 * device principal, the strict body, and the plain-code service.
 */
const SID = "11111111-1111-4111-8111-111111111111";
const SBX = "sbx-0123456789ab";
const DEV = "jdg-0123456789ab";
const NOW = Date.parse("2026-10-14T05:00:00Z");

const sandboxOutlet: Outlet = {
  outlet_id: SBX,
  name: "Demo bakery",
  project_kind: "demo",
  timezone: "Asia/Jakarta",
  opening_time: "08:00",
  closing_time: "22:00",
  sandbox: { template_outlet_id: "demo-tpl-outlet", created_at_ms: NOW - 1000, expires_at_ms: NOW + 7_000_000, key_sha256: "a".repeat(64) },
  created_at: "2026-10-14T00:00:00.000Z",
};
const pilotOutlet: Outlet = { ...sandboxOutlet, outlet_id: "outlet-1", project_kind: "pilot", sandbox: undefined };

const openSession: CaptureSession = {
  outlet_id: SBX,
  device_id: DEV,
  session_id: SID,
  started_at_ms: NOW - 60_000,
  ended_at_ms: null,
  end_reason: null,
  local_date: "2026-10-14",
  auto_stop_at_ms: NOW + 540_000,
  debrief_ends_at_ms: null,
  received_start_at: new Date(NOW - 60_000).toISOString(),
  received_end_at: null,
};

const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Not found" } };
const noStore = (res: Response) => expect(res.headers.get("Cache-Control")).toBe("private, no-store");

function req(body: unknown = { session_id: SID }, headers: Record<string, string> = { authorization: "Bearer t", "x-device-id": DEV }, raw = false) {
  return new NextRequest("http://localhost/api/v1/demo/closing", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

const getOutlet = vi.fn<(id: string) => Promise<Outlet | null>>();
function wire(opts: { outlet_id?: string; role?: string; outlet?: Outlet | null; session?: CaptureSession | null; lines?: number } = {}) {
  vi.mocked(servicesModule.authenticateDeviceToken).mockResolvedValue({
    outlet_id: opts.outlet_id ?? SBX,
    role: opts.role ?? "device",
    device_id: DEV,
  } as never);
  getOutlet.mockResolvedValue(opts.outlet === undefined ? sandboxOutlet : opts.outlet);
  vi.mocked(storesModule.firestoreCaptureStore).mockReturnValue({ getOutlet } as never);
  let session = opts.session === undefined ? openSession : opts.session;
  const marks: number[] = [];
  const store: ClosingStore = {
    async getSession() { return session; },
    async countLines() { return opts.lines ?? 5; },
    async markClosing(_k, at) { marks.push(at); if (session) session = { ...session, demo_closing_at_ms: at }; },
  };
  const built = vi.mocked(closingStoreModule.firestoreClosingStore).mockReturnValue(store);
  return { marks, built, get session() { return session; } };
}

afterEach(() => {
  vi.clearAllMocks();
  getOutlet.mockReset();
  delete process.env.DEMO_MODE;
});

describe("POST /api/v1/demo/closing off-demo", () => {
  it("DEMO_MODE unset, '1', 'TRUE' or 'false': 404 before the token is verified or anything is read", async () => {
    wire();
    for (const v of [undefined, "1", "TRUE", "false"]) {
      if (v === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = v;
      const res = await POST(req());
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
      noStore(res);
    }
    expect(servicesModule.authenticateDeviceToken).not.toHaveBeenCalled();
    expect(getOutlet).not.toHaveBeenCalled();
  });

  it("every other method is a 404 off-demo and a 405 (Allow: POST) on the demo", async () => {
    for (const handler of [GET, PUT, PATCH, DELETE, OPTIONS]) {
      expect((await handler()).status).toBe(404);
    }
    process.env.DEMO_MODE = "true";
    for (const handler of [GET, PUT, PATCH, DELETE, OPTIONS]) {
      const res = await handler();
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST");
    }
  });
});

describe("POST /api/v1/demo/closing on the demo (DEMO_MODE=true)", () => {
  const demo = () => { process.env.DEMO_MODE = "true"; };

  it("a device whose outlet id is not a sandbox: 404 with no outlet read", async () => {
    demo();
    wire({ outlet_id: "demo-tpl-outlet" });
    const res = await POST(req());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expect(getOutlet).not.toHaveBeenCalled();
    expect(closingStoreModule.firestoreClosingStore).not.toHaveBeenCalled();
  });

  it("a sandbox-looking id whose outlet doc is missing, a pilot doc, or lacks `sandbox`: 404, service never built", async () => {
    demo();
    for (const outlet of [null, pilotOutlet, { ...sandboxOutlet, sandbox: undefined }]) {
      wire({ outlet });
      const res = await POST(req());
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
    }
    expect(closingStoreModule.firestoreClosingStore).not.toHaveBeenCalled();
  });

  it("a non-device principal is 403", async () => {
    demo();
    wire({ role: "owner" });
    expect((await POST(req())).status).toBe(403);
  });

  it("a bad token is 401", async () => {
    demo();
    wire();
    vi.mocked(servicesModule.authenticateDeviceToken).mockRejectedValueOnce(new (await import("@/lib/http/errors")).UnauthorizedError("no"));
    expect((await POST(req())).status).toBe(401);
  });

  it("body: non-JSON 400; wrong shape or an extra key 422; wrong content type 415", async () => {
    demo();
    wire();
    expect((await POST(req("{nope", undefined, true))).status).toBe(400);
    expect((await POST(req({ session_id: "nope" }))).status).toBe(422);
    expect((await POST(req({ session_id: SID, device_id: "x" }))).status).toBe(422);
    const res = await POST(req({ session_id: SID }, { authorization: "Bearer t", "x-device-id": DEV, "content-type": "text/plain" }));
    expect(res.status).toBe(415);
    expect(closingStoreModule.firestoreClosingStore).not.toHaveBeenCalled();
  });

  it("200 { closing_reached: true }: the store is built for the claims' outlet and the mark is written at the server clock", async () => {
    demo();
    const f = wire({ lines: 5 });
    const before = Date.now();
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { closing_reached: true } });
    noStore(res);
    expect(f.built).toHaveBeenCalledWith(SBX);
    expect(f.marks).toHaveLength(1);
    expect(f.marks[0]).toBeGreaterThanOrEqual(before);
  });

  it("409 not_enough_speech carries {have, need} in error.details and never a transcript", async () => {
    demo();
    const f = wire({ lines: 2 });
    const res = await POST(req());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("not_enough_speech");
    expect(body.error.details).toEqual({ have: 2, need: 5 });
    expect(JSON.stringify(body)).not.toMatch(/text|lines"/);
    expect(f.marks).toHaveLength(0);
    noStore(res);
  });

  it("409 session_not_open for a missing or ended session, with no details", async () => {
    demo();
    wire({ session: null });
    let res = await POST(req());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({ code: "session_not_open", message: "session_not_open" });
    wire({ session: { ...openSession, ended_at_ms: NOW, end_reason: "auto_stop" } });
    res = await POST(req());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("session_not_open");
  });
});

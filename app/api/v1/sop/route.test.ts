import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as mod from "./route";
import { GET } from "./route";
import type { SopStore } from "@/lib/sop/service";
import type { Outlet } from "@/lib/firestore/schema";
import { seedV1 } from "@/lib/sop/testing/fixtures";

/** Same technique as app/api/v1/constraints/route.test.ts: the real guard + service, a mocked store. */
const verifyIdToken = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({
  verifyIdToken: (...args: unknown[]) => verifyIdToken(...args),
}));
vi.mock("@/lib/firestore/sop-store");
import { firestoreSopStore } from "@/lib/firestore/sop-store";

afterEach(() => {
  verifyIdToken.mockReset();
  vi.clearAllMocks();
});

const NO_STORE = "private, no-store";
const outlet: Outlet = {
  outlet_id: "o1",
  name: "Test",
  project_kind: "demo",
  timezone: "Asia/Jakarta",
  opening_time: "07:00",
  closing_time: "21:45",
  retention_days: 14,
  created_at: "2026-01-01T00:00:00.000Z",
};
const store = (o: Outlet | null = outlet): SopStore => ({
  getOutlet: async () => o,
  listVersions: async () => [seedV1()],
});
const claimsFor = (role: string, outlet_id = "o1") => ({
  uid: "u1",
  email: `${role}@x.test`,
  email_verified: true,
  claims: { outlet_id, role },
});
const req = (authorization?: string) => {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  return new NextRequest("http://localhost/api/v1/sop", { method: "GET", headers });
};

describe("GET /api/v1/sop", () => {
  it("4.R1 owner -> 200 { data } with no-store", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("owner"));
    vi.mocked(firestoreSopStore).mockReturnValueOnce(store());
    const res = await GET(req("Bearer t"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(NO_STORE);
    const body = await res.json();
    expect(body.data.latest.version).toBe(1);
    expect(firestoreSopStore).toHaveBeenCalledWith("o1");
  });

  it("4.R1 supervisor -> 200", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("supervisor"));
    vi.mocked(firestoreSopStore).mockReturnValueOnce(store());
    expect((await GET(req("Bearer t"))).status).toBe(200);
  });

  it("4.R2 no token -> 401; a device (opaque) token the verifier rejects -> 401", async () => {
    const a = await GET(req());
    expect(a.status).toBe(401);
    expect(a.headers.get("Cache-Control")).toBe(NO_STORE);
    verifyIdToken.mockRejectedValueOnce(new Error("not a firebase id token"));
    const b = await GET(req("Bearer device-token"));
    expect(b.status).toBe(401);
    expect(b.headers.get("Cache-Control")).toBe(NO_STORE);
  });

  it("4.R2 staff -> 403", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("staff"));
    vi.mocked(firestoreSopStore).mockReturnValueOnce(store());
    const res = await GET(req("Bearer t"));
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe(NO_STORE);
  });

  it("4.R2 missing outlet -> 404", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("owner"));
    vi.mocked(firestoreSopStore).mockReturnValueOnce(store(null));
    const res = await GET(req("Bearer t"));
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe(NO_STORE);
  });

  it("4.R2 internal error -> 500 without details", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("owner"));
    vi.mocked(firestoreSopStore).mockReturnValueOnce({
      getOutlet: async () => outlet,
      listVersions: async () => {
        throw new Error("boom SECRET-DETAIL");
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req("Bearer t"));
    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe(NO_STORE);
    expect(JSON.stringify(await res.json())).not.toContain("SECRET-DETAIL");
  });

  it("4.R3 exports GET only (no write method)", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) expect(Object.keys(mod)).not.toContain(m);
    expect(Object.keys(mod)).toContain("GET");
  });
});

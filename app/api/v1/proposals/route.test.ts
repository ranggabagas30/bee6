import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { ConflictError, ForbiddenError } from "@/lib/http/errors";

const verifyIdToken = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({
  verifyIdToken: (...args: unknown[]) => verifyIdToken(...args),
}));
vi.mock("@/lib/firestore/proposal-review-store", () => ({ firestoreProposalReviewStore: () => ({ store: true }) }));
vi.mock("@/lib/firestore/proposal-store", () => ({ firestoreProposalStore: () => ({ evidence: true }) }));
const listProposals = vi.fn();
vi.mock("@/lib/proposals/review-service", () => ({
  listProposals: (...args: unknown[]) => listProposals(...args),
}));

afterEach(() => {
  verifyIdToken.mockReset();
  listProposals.mockReset();
});

function claimsFor(role: string) {
  return { uid: `u-${role}`, email: `${role}@t.test`, email_verified: true, claims: { outlet_id: "proofed", role } };
}
function req(authorization: string | null = "Bearer t") {
  const headers = new Headers();
  if (authorization !== null) headers.set("authorization", authorization);
  return new NextRequest("http://localhost/api/v1/proposals", { method: "GET", headers });
}
const noStore = (res: Response) => expect(res.headers.get("Cache-Control")).toBe("private, no-store");

describe("GET /api/v1/proposals", () => {
  it("5.R5 returns 200 { data: { open, decided } } for owner and supervisor", async () => {
    for (const role of ["owner", "supervisor"]) {
      verifyIdToken.mockResolvedValueOnce(claimsFor(role));
      listProposals.mockResolvedValueOnce({ open: [], decided: [] });
      const res = await GET(req());
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { open: [], decided: [] } });
      noStore(res);
      expect(listProposals.mock.lastCall![1]).toMatchObject({ evidence: { evidence: true } }); // R-19 3.5: the watch read
      expect(listProposals.mock.lastCall![2]).toEqual({ claims: { outlet_id: "proofed", role }, now_ms: expect.any(Number) });
    }
  });

  it("401 without a token or with a token that does not verify", async () => {
    const res = await GET(req(null));
    expect(res.status).toBe(401);
    noStore(res);
    verifyIdToken.mockRejectedValueOnce(new Error("device token"));
    const res2 = await GET(req());
    expect(res2.status).toBe(401);
    noStore(res2);
  });

  it("403 when the service refuses the role", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("staff"));
    listProposals.mockRejectedValueOnce(new ForbiddenError("no"));
    const res = await GET(req());
    expect(res.status).toBe(403);
    noStore(res);
  });

  it("5.R5 LIBRARY_NOT_READY is 409", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("owner"));
    listProposals.mockRejectedValueOnce(new ConflictError("Library not ready", "LIBRARY_NOT_READY"));
    const res = await GET(req());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("LIBRARY_NOT_READY");
    noStore(res);
  });
});

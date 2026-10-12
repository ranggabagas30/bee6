import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { ForbiddenError } from "@/lib/http/errors";

const verifyIdToken = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({ verifyIdToken: (...a: unknown[]) => verifyIdToken(...a) }));
vi.mock("@/lib/firestore/review-store", () => ({ firestoreReviewStore: (id: string) => ({ store: id }) }));
const listReviews = vi.fn();
vi.mock("@/lib/reviews/service", () => ({ listReviews: (...a: unknown[]) => listReviews(...a) }));

afterEach(() => {
  verifyIdToken.mockReset();
  listReviews.mockReset();
  delete process.env.DEMO_MODE;
});

const claimsFor = (role: string) => ({ uid: `u-${role}`, email: `${role}@t.test`, email_verified: true, claims: { outlet_id: "proofed", role } });
const req = (auth: string | null = "Bearer t") =>
  new NextRequest("http://localhost/api/v1/reviews", { method: "GET", headers: auth ? { authorization: auth } : {} });
const noStore = (res: Response) => expect(res.headers.get("Cache-Control")).toBe("private, no-store");
const PAYLOAD = { fast_forward_available: false, open: [], decided: [] };

describe("GET /api/v1/reviews", () => {
  it("5.R2 200 with the payload, an outlet store from the claims, and demoMode false by default", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("owner"));
    listReviews.mockResolvedValueOnce(PAYLOAD);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: PAYLOAD });
    noStore(res);
    expect(listReviews.mock.calls[0]![0]).toEqual({ store: "proofed" });
    expect(listReviews.mock.calls[0]![1]).toMatchObject({ demoMode: false });
  });

  it("5.R6 DEMO_MODE is read per request", async () => {
    for (const [value, expected] of [["true", true], [undefined, false], ["1", false], ["true", true]] as const) {
      if (value === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = value;
      verifyIdToken.mockResolvedValueOnce(claimsFor("supervisor"));
      listReviews.mockResolvedValueOnce(PAYLOAD);
      await GET(req());
      expect(listReviews.mock.calls.at(-1)![1]).toMatchObject({ demoMode: expected });
    }
  });

  it("5.R2 401 with no token or a device token; 403 from the service", async () => {
    const r1 = await GET(req(null));
    expect(r1.status).toBe(401);
    noStore(r1);
    verifyIdToken.mockRejectedValueOnce(new Error("opaque device token"));
    expect((await GET(req())).status).toBe(401);
    expect(listReviews).not.toHaveBeenCalled();
    verifyIdToken.mockResolvedValueOnce(claimsFor("staff"));
    listReviews.mockRejectedValueOnce(new ForbiddenError("no"));
    const r3 = await GET(req());
    expect(r3.status).toBe(403);
    noStore(r3);
  });
});

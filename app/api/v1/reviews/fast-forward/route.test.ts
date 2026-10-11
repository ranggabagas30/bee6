import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { ConflictError, NotFoundError } from "@/lib/http/errors";

const verifyIdToken = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({ verifyIdToken: (...a: unknown[]) => verifyIdToken(...a) }));
vi.mock("@/lib/firestore/review-store", () => ({ firestoreReviewStore: (id: string) => ({ store: id }) }));
const fastForwardReview = vi.fn();
vi.mock("@/lib/reviews/service", () => ({ fastForwardReview: (...a: unknown[]) => fastForwardReview(...a) }));

afterEach(() => {
  verifyIdToken.mockReset();
  fastForwardReview.mockReset();
  delete process.env.DEMO_MODE;
});

const claimsFor = (role: string) => ({ uid: `u-${role}`, email: `${role}@t.test`, email_verified: true, claims: { outlet_id: "demo", role } });
function req(body: unknown = {}, auth: string | null = "Bearer t", raw = false) {
  const headers = new Headers({ "content-type": "application/json" });
  if (auth) headers.set("authorization", auth);
  return new NextRequest("http://localhost/api/v1/reviews/fast-forward", {
    method: "POST",
    headers,
    body: raw ? (body as string) : JSON.stringify(body),
  });
}
const asSupervisor = () => verifyIdToken.mockResolvedValueOnce(claimsFor("supervisor"));
const noStore = (res: Response) => expect(res.headers.get("Cache-Control")).toBe("private, no-store");

describe("POST /api/v1/reviews/fast-forward", () => {
  it("5.R4 DEMO_MODE unset -> the service gets demoMode false (-> 404)", async () => {
    asSupervisor();
    fastForwardReview.mockRejectedValueOnce(new NotFoundError("route", "route"));
    const res = await POST(req());
    expect(fastForwardReview.mock.calls[0]![1]).toMatchObject({ demoMode: false });
    expect(res.status).toBe(404);
    noStore(res);
  });

  it("5.R4 DEMO_MODE true -> 200 { version }; only the exact string 'true' enables it", async () => {
    process.env.DEMO_MODE = "true";
    asSupervisor();
    fastForwardReview.mockResolvedValueOnce({ version: 2 });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { version: 2 } });
    noStore(res);
    expect(fastForwardReview.mock.calls[0]![0]).toEqual({ store: "demo" });
    expect(fastForwardReview.mock.calls[0]![1]).toMatchObject({ demoMode: true, claims: { outlet_id: "demo", role: "supervisor" } });
    process.env.DEMO_MODE = "1";
    asSupervisor();
    fastForwardReview.mockResolvedValueOnce({ version: 2 });
    await POST(req());
    expect(fastForwardReview.mock.calls[1]![1]).toMatchObject({ demoMode: false });
  });

  it("5.R4 409 NOTHING_TO_REVIEW is passed through", async () => {
    process.env.DEMO_MODE = "true";
    asSupervisor();
    fastForwardReview.mockRejectedValueOnce(new ConflictError("Nothing to review", "NOTHING_TO_REVIEW"));
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOTHING_TO_REVIEW");
  });

  it("422 for a non-empty body, 400 for non-JSON, 401 without a token", async () => {
    asSupervisor();
    const r1 = await POST(req({ version: 2 }));
    expect(r1.status).toBe(422);
    noStore(r1);
    asSupervisor();
    expect((await POST(req("{nope", "Bearer t", true))).status).toBe(400);
    expect((await POST(req({}, null))).status).toBe(401);
    expect(fastForwardReview).not.toHaveBeenCalled();
  });
});

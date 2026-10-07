import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import * as guardModule from "@/lib/http/guard";

vi.mock("@/lib/http/guard");

/**
 * R-07: staff PIN sessions are dormant (post-MVP 1). The route answers 404
 * before any auth or body read -- `requireDevice` is never called, so a
 * device without `staffPinLogin` wired can't accidentally start auth work.
 */
describe("POST /api/v1/auth/pin (dormant post-MVP 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 with no Authorization header at all", async () => {
    const req = new NextRequest("http://localhost/api/v1/auth/pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Dina", pin: "1234" }),
    });
    const response = await POST(req);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(guardModule.requireDevice).not.toHaveBeenCalled();
  });

  it("returns 404 even with a valid-looking device token and body", async () => {
    vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({
      outlet_id: "outlet-1",
      device_id: "device-1",
      role: "device",
    });
    const req = new NextRequest("http://localhost/api/v1/auth/pin", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer some-device-token",
        "x-device-id": "device-1",
      },
      body: JSON.stringify({ name: "Dina", pin: "1234" }),
    });
    const response = await POST(req);
    expect(response.status).toBe(404);
    expect(guardModule.requireDevice).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed (unparseable) body too", async () => {
    const req = new NextRequest("http://localhost/api/v1/auth/pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const response = await POST(req);
    expect(response.status).toBe(404);
  });
});

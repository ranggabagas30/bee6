import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import * as oidcModule from "@/lib/http/oidc";
import * as tickStoreModule from "@/lib/firestore/tick-store";
import * as serviceModule from "@/lib/pipeline/tick/service";
import { UnauthorizedError } from "@/lib/http/errors";
import type { TickStore } from "@/lib/pipeline/tick/types";

vi.mock("@/lib/http/oidc");
vi.mock("@/lib/firestore/tick-store");
vi.mock("@/lib/pipeline/tick/service");

/**
 * Route-level test for POST /api/internal/pipeline/tick. The pipeline's
 * own orchestration (lease, windowing, label calls, gate, persistence) is
 * exhaustively unit-tested in `lib/pipeline/tick/service.test.ts` against
 * an in-memory fake `TickStore` — this file only covers what the ROUTE
 * itself is responsible for: the OIDC gate, and wiring real deps into
 * `runTick`. Both `verifyInternalOidcToken` and `runTick` are mocked here,
 * same convention as `app/api/v1/segments/[segment]/route.test.ts`.
 */

const FAKE_STORE = {} as unknown as TickStore;

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://web-service.example.com/api/internal/pipeline/tick", {
    method: "POST",
    headers,
  });
}

describe("POST /api/internal/pipeline/tick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(tickStoreModule, "firestoreTickStore").mockReturnValue(FAKE_STORE);
  });

  it("returns 401 and never calls runTick when OIDC verification fails", async () => {
    vi.spyOn(oidcModule, "verifyInternalOidcToken").mockRejectedValueOnce(
      new UnauthorizedError("Missing bearer token"),
    );
    const runTickSpy = vi.spyOn(serviceModule, "runTick");

    const response = await POST(makeRequest());

    expect(response.status).toBe(401);
    expect(runTickSpy).not.toHaveBeenCalled();
  });

  it("on a verified request, calls runTick with the real Firestore store and the server's own now_ms, and returns its result", async () => {
    vi.spyOn(oidcModule, "verifyInternalOidcToken").mockResolvedValueOnce(undefined);
    const tickResult = {
      devices: [
        {
          outlet_id: "o1",
          device_id: "d1",
          skipped_reason: null,
          units_processed: 1,
          threads_written: 1,
          questions_written: 0,
          failed_units: 0,
        },
      ],
    };
    const runTickSpy = vi.spyOn(serviceModule, "runTick").mockResolvedValueOnce(tickResult);

    const before = Date.now();
    const response = await POST(makeRequest());
    const after = Date.now();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ data: tickResult });

    expect(runTickSpy).toHaveBeenCalledTimes(1);
    const call = runTickSpy.mock.calls[0]![0];
    expect(call.store).toBe(FAKE_STORE);
    expect(call.now_ms).toBeGreaterThanOrEqual(before);
    expect(call.now_ms).toBeLessThanOrEqual(after);
  });

  it("maps an unexpected runTick throw to the standard 500 envelope, never a raw crash", async () => {
    vi.spyOn(oidcModule, "verifyInternalOidcToken").mockResolvedValueOnce(undefined);
    vi.spyOn(serviceModule, "runTick").mockRejectedValueOnce(new Error("boom"));

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});

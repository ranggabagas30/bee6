import { describe, expect, it } from "vitest";
import {
  AppError,
  LockedError,
  ServiceUnavailableError,
  UnauthorizedError,
  handleApiError,
} from "@/lib/http/errors";

describe("ServiceUnavailableError", () => {
  it("is a 503 with the SERVICE_UNAVAILABLE code", () => {
    const err = new ServiceUnavailableError();
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("carries a short custom message but no details payload", () => {
    const err = new ServiceUnavailableError("Transcription upstream failed");
    expect(err.message).toBe("Transcription upstream failed");
    expect(err.details).toBeUndefined();
  });

  it("maps to a 503 response so the browser client retries", async () => {
    const res = handleApiError(new ServiceUnavailableError("upstream failed"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: "SERVICE_UNAVAILABLE", message: "upstream failed" },
    });
  });
});

describe("UnauthorizedError code (R-12)", () => {
  it("defaults to UNAUTHORIZED", () => {
    expect(new UnauthorizedError().code).toBe("UNAUTHORIZED");
    expect(new UnauthorizedError("x").code).toBe("UNAUTHORIZED");
  });

  it("carries a custom code into the response envelope", async () => {
    const res = handleApiError(new UnauthorizedError("Demo session expired", "demo_session_expired"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "demo_session_expired", message: "Demo session expired" } });
  });
});

describe("LockedError code (R-12)", () => {
  it("defaults to LOCKED and keeps Retry-After", () => {
    const res = handleApiError(new LockedError(30));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("carries a custom code (rate_limited) with Retry-After", async () => {
    const err = new LockedError(120, "Too many demo sessions", "rate_limited");
    expect(err.code).toBe("rate_limited");
    const res = handleApiError(err);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    expect((await res.json()).error.code).toBe("rate_limited");
  });
});

import { describe, expect, it } from "vitest";
import {
  AppError,
  ServiceUnavailableError,
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

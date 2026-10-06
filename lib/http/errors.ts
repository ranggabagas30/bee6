import { z } from "zod";
import { NextResponse } from "next/server";

/**
 * Typed application errors + a single API error mapper (error-handling skill,
 * api-design skill). Every API route funnels failures through `handleApiError`
 * so responses share one envelope: `{ error: { code, message, details? } }`.
 *
 * User-facing messages carry no internal detail; unexpected errors are logged
 * server-side and returned as a generic 500. No audio, no base64, no secrets are
 * ever placed in an error (hard rule #2).
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    // Keep the prototype chain correct for `instanceof` after transpile.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400 — malformed request (bad JSON, missing header). */
export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: unknown) {
    super(message, "BAD_REQUEST", 400, details);
  }
}

/** 401 — missing or invalid credentials (no/invalid token). */
export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, "UNAUTHORIZED", 401);
  }
}

/** 403 — authenticated but not allowed (wrong role or wrong outlet). */
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, "FORBIDDEN", 403);
  }
}

/** 404 — resource not found. */
export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, "NOT_FOUND", 404);
  }
}

/** 409 — state conflict (e.g. already paired, pairing code used). */
export class ConflictError extends AppError {
  constructor(message = "Conflict", code = "CONFLICT") {
    super(message, code, 409);
  }
}

/** 413 — request body is larger than the allowed ceiling. */
export class PayloadTooLargeError extends AppError {
  constructor(message = "Payload too large") {
    super(message, "PAYLOAD_TOO_LARGE", 413);
  }
}

/** 422 — semantically invalid input (valid JSON, bad data). */
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, "VALIDATION_ERROR", 422, details);
  }
}

/** 429 — locked out or rate limited; `retryAfterSeconds` for the client. */
export class LockedError extends AppError {
  constructor(
    public readonly retryAfterSeconds: number,
    message = "Too many attempts",
  ) {
    super(message, "LOCKED", 429);
  }
}

/**
 * 503 — an upstream dependency (transcription model, Sensitive Data Protection,
 * a transient infra hiccup) failed. The `/capture` browser client treats 503 as
 * retryable (bounded), so every dependency failure in the segment pipeline MUST
 * surface as this — never a 4xx (which the client would drop). The message is
 * always short and sanitised: no audio, base64, secrets or upstream bodies.
 */
export class ServiceUnavailableError extends AppError {
  constructor(
    message = "Service temporarily unavailable",
    public readonly stage?: "transcribe" | "redact",
    public readonly upstream?: number | "timeout" | "unknown",
  ) {
    super(message, "SERVICE_UNAVAILABLE", 503);
  }
}

function zodDetails(error: z.ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));
}

/** Maps any thrown value to the standard error response. */
export function handleApiError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    const headers =
      error instanceof LockedError
        ? { "Retry-After": String(error.retryAfterSeconds) }
        : undefined;
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.statusCode, ...(headers ? { headers } : {}) },
    );
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: zodDetails(error),
        },
      },
      { status: 422 },
    );
  }

  // Unexpected: log server-side (never the request body — it may hold a PIN or
  // token), return a generic message.
  console.error("Unexpected API error:", error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } },
    { status: 500 },
  );
}

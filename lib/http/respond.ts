import { NextResponse } from "next/server";

/**
 * Success responses in the shared envelope `{ data: ... }` (api-design skill).
 * Errors use `handleApiError` from lib/http/errors.ts.
 */
export function jsonOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

import { NextResponse } from "next/server";

/**
 * Deploy smoke test for the Cloud Run service `web`.
 * No Firestore, no model calls, no secrets — just proves the container
 * built, started, and can answer HTTP requests in asia-southeast2.
 */
export function GET() {
  return NextResponse.json({ status: "ok" });
}

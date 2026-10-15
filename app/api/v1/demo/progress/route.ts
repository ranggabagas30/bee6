import { NextResponse, type NextRequest } from "next/server";
import { NotFoundError, handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { requireClaims } from "@/lib/http/guard";
import { firestoreProgressStore } from "@/lib/firestore/demo-progress-store";
import { demoProgress } from "@/lib/demo/progress";

/**
 * GET /api/v1/demo/progress (R-19 PR-5; plan sections 2.3 and 7.2): the counters behind the judge guide on the
 * supervisor and owner screens. DEMO ONLY. When DEMO_MODE is not exactly "true" (read per request) every request,
 * any method, gets the same 404 as the first thing the route does (the pattern of POST /api/v1/demo/session). On
 * the demo: the Firebase ID token (`requireClaims`), then the plain-code service, which answers 403 for a
 * non-supervisor/owner and the same 404 for any outlet that is not a demo sandbox (outlet from the claims only).
 * The body is five counts; no text, id or name. Every response is `Cache-Control: private, no-store`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const demoOn = () => process.env.DEMO_MODE === "true";

function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

function notFound(): NextResponse {
  return noStore(NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 }));
}

/** Other methods: indistinguishable from a missing route off-demo; a plain 405 in demo mode. */
function otherMethod(): NextResponse {
  if (!demoOn()) return notFound();
  return noStore(
    NextResponse.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, { status: 405, headers: { Allow: "GET" } }),
  );
}
export const POST = otherMethod;
export const PUT = otherMethod;
export const PATCH = otherMethod;
export const DELETE = otherMethod;
export const OPTIONS = otherMethod;

export async function GET(req: NextRequest) {
  if (!demoOn()) return notFound();
  try {
    const claims = await requireClaims(req);
    const data = await demoProgress(firestoreProgressStore(), { claims, now_ms: Date.now(), demoMode: true });
    return noStore(jsonOk(data, 200));
  } catch (error) {
    // A non-sandbox caller gets the very same body as the off-demo 404 (nothing to tell the two apart).
    if (error instanceof NotFoundError) return notFound();
    return noStore(handleApiError(error));
  }
}

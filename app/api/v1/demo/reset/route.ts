import { NextResponse, type NextRequest } from "next/server";
import { BadRequestError, NotFoundError, handleApiError } from "@/lib/http/errors";
import { readBodyTextCapped, requireJsonContentType } from "@/lib/http/body";
import { jsonOk } from "@/lib/http/respond";
import { requireClaims } from "@/lib/http/guard";
import { firestoreResetStore } from "@/lib/firestore/demo-reset-store";
import { resetSandbox } from "@/lib/demo/service";

/**
 * POST /api/v1/demo/reset (R-19 PR-7, docs/tasks/R-19-demo-v2.md section 8.4): the owner wipes the demo sandbox back to
 * day 1. DEMO ONLY. When DEMO_MODE is not exactly "true" (read per request) every request, any method, any token, any
 * body, gets the same 404 as the first thing the route does, so nothing a caller sends can tell the pilot this route
 * exists (same pattern as POST /api/v1/demo/session and next-day). With DEMO_MODE on: a verified Firebase ID token
 * (401), then `resetSandbox`, which answers the same 404 unless the caller's outlet (from the claims only, never the
 * body) is a sandbox of the demo project, 403 unless the role is `owner`, and only then reads the body (JSON, at most
 * 1 KB, exactly `{ "confirm": "reset" }`, 415/400/413/422) and applies the cap and the busy checks.
 * Nothing is logged but fixed codes and the sandbox id; every response is `Cache-Control: private, no-store`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The body is { confirm: "reset" } (< 30 bytes); anything near this is not a client of ours. */
const BODY_MAX_BYTES = 1024;

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
    NextResponse.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, { status: 405, headers: { Allow: "POST" } }),
  );
}
export const GET = otherMethod;
export const PUT = otherMethod;
export const PATCH = otherMethod;
export const DELETE = otherMethod;
export const OPTIONS = otherMethod;

export async function POST(req: NextRequest) {
  if (!demoOn()) return notFound();
  try {
    const claims = await requireClaims(req);
    const data = await resetSandbox(
      firestoreResetStore(),
      {},
      {
        claims,
        now_ms: Date.now(),
        demoMode: true,
        // Read only after the sandbox gate and the owner check: a caller who fails either never reaches body handling.
        body: async () => {
          requireJsonContentType(req.headers);
          const text = await readBodyTextCapped(req, BODY_MAX_BYTES);
          try {
            return JSON.parse(text) as unknown;
          } catch {
            throw new BadRequestError("Body must be JSON");
          }
        },
      },
    );
    return noStore(jsonOk(data, 200));
  } catch (error) {
    // A non-sandbox caller gets the very same body as the off-demo 404 (nothing to tell the two apart).
    if (error instanceof NotFoundError) return notFound();
    return noStore(handleApiError(error));
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { BadRequestError, NotFoundError, UnauthorizedError, ValidationError, handleApiError } from "@/lib/http/errors";
import { readBodyTextCapped, requireJsonContentType } from "@/lib/http/body";
import { jsonOk } from "@/lib/http/respond";
import { requireDevice } from "@/lib/http/guard";
import { firestoreNextDayStore } from "@/lib/firestore/demo-store";
import { DemoNextDayBodySchema } from "@/lib/demo/contract";
import { runNextDay } from "@/lib/demo/next-day";

/**
 * POST /api/v1/demo/next-day (R-19 PR-2, docs/tasks/R-19-demo-v2.md section 4): "Jump to tomorrow". DEMO ONLY.
 * When DEMO_MODE is not exactly "true" (read per request) every request, any method, any token, any body, gets
 * the same 404 as the first thing the route does, so nothing a caller sends can tell the pilot this route
 * exists (same pattern as POST /api/v1/demo/session). With DEMO_MODE on: the device credential (G2, 401/403),
 * a JSON body of at most 1 KB validated strictly (422), then `runNextDay`, which answers 404 unless the
 * caller's outlet (from the claims only, never the body) is a sandbox of the demo project (G1) and applies
 * the remaining guards in order. Refusals travel as 409 `{ error: { code: NextDayRefusal, message, details? } }`.
 * No text, token or id is logged; every response is `Cache-Control: private, no-store`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The body is {expected_day, confirm_unanswered} (< 60 bytes); anything near this is not a client of ours. */
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
    const claims = await requireDevice(req);
    if (!claims.device_id) throw new UnauthorizedError("Device session missing device id");

    requireJsonContentType(req.headers);
    const text = await readBodyTextCapped(req, BODY_MAX_BYTES);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new BadRequestError("Body must be JSON");
    }
    const body = DemoNextDayBodySchema.safeParse(raw);
    if (!body.success) {
      throw new ValidationError(
        "invalid_body",
        body.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.code })),
      );
    }

    const data = await runNextDay(firestoreNextDayStore(), {
      outlet_id: claims.outlet_id,
      device_id: claims.device_id,
      now_ms: Date.now(),
      demoMode: true,
      body: body.data,
    });
    return noStore(jsonOk(data, 200));
  } catch (error) {
    // A non-sandbox caller gets the very same body as the off-demo 404 (nothing to tell the two apart).
    if (error instanceof NotFoundError) return notFound();
    return noStore(handleApiError(error));
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { BadRequestError, ForbiddenError, ValidationError, handleApiError } from "@/lib/http/errors";
import { readBodyTextCapped, requireJsonContentType } from "@/lib/http/body";
import { jsonOk } from "@/lib/http/respond";
import { requireDevice } from "@/lib/http/guard";
import { firestoreCaptureStore } from "@/lib/firestore/stores";
import { firestoreClosingStore } from "@/lib/firestore/closing-store";
import { DemoClosingBodySchema, DemoClosingResponseSchema } from "@/lib/demo/contract";
import { SANDBOX_OUTLET_PREFIX } from "@/lib/demo/constants";
import { jumpToClosing } from "@/lib/demo/closing";

/**
 * POST /api/v1/demo/closing (R-19 PR-4a; plan sections 2.3 and 5.4): "Jump to closing time" for a sandbox
 * judge device. DEMO ONLY. When DEMO_MODE is not exactly "true" (read per request) every request, any method,
 * any body, gets the same 404 as the first thing the route does (the pattern of POST /api/v1/demo/session). On
 * the demo, a caller whose outlet is not a sandbox (id prefix, then the outlet doc: project_kind "demo" and
 * `sandbox` present) gets the same 404 before any other read. Then: device principal only (403 otherwise),
 * strict JSON body ({ session_id }), and the plain-code service: 200 { closing_reached: true }, 409
 * not_enough_speech { have, need } or session_not_open. `outlet_id` and `device_id` come from the verified
 * claims only. No transcript text is read or returned; nothing is logged.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The body is { session_id: uuid } (< 100 bytes); anything near this is not a client of ours. */
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
    if (claims.role !== "device" || !claims.device_id) {
      throw new ForbiddenError("Only a paired device can jump to closing time");
    }
    // Sandbox gate (plan 2.3): the cheap id check first, then the outlet doc; a miss is the same 404 in every case.
    if (!claims.outlet_id.startsWith(SANDBOX_OUTLET_PREFIX)) return notFound();
    const outlet = await firestoreCaptureStore().getOutlet(claims.outlet_id);
    if (!outlet || outlet.project_kind !== "demo" || outlet.sandbox === undefined) return notFound();

    requireJsonContentType(req.headers);
    const text = await readBodyTextCapped(req, BODY_MAX_BYTES);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new BadRequestError("Body must be JSON");
    }
    const body = DemoClosingBodySchema.safeParse(raw);
    if (!body.success) {
      throw new ValidationError(
        "invalid_body",
        body.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.code })),
      );
    }

    const data = await jumpToClosing(firestoreClosingStore(claims.outlet_id), {
      outlet_id: claims.outlet_id,
      device_id: claims.device_id,
      session_id: body.data.session_id,
      now_ms: Date.now(),
    });
    return noStore(jsonOk(DemoClosingResponseSchema.parse(data), 200));
  } catch (error) {
    return noStore(handleApiError(error));
  }
}

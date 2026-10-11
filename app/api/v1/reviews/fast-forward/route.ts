import { NextResponse, type NextRequest } from "next/server";
import { requireClaims } from "@/lib/http/guard";
import { BadRequestError, ValidationError, handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { enforceDemoCapsForRoute } from "@/lib/demo/route-caps";
import { firestoreReviewStore } from "@/lib/firestore/review-store";
import { FastForwardBodySchema, FastForwardResponseSchema } from "@/lib/reviews/contract";
import { fastForwardReview } from "@/lib/reviews/service";

/**
 * POST /api/v1/reviews/fast-forward (R-11 Task 5). DEMO ONLY. When DEMO_MODE
 * is not exactly "true" (read per request) every request, any method, any
 * token, any body, gets the same 404 as the first thing the route does: before
 * the token is verified, the body is read or the role is checked, so nothing
 * a caller sends can tell the pilot that this route exists (no 401/403/400/
 * 422/405). With DEMO_MODE on, the service still answers 404 unless the
 * caller's outlet has project_kind "demo", before its role check. It runs the
 * same `createReview` as the daily Scheduler run, flagged as simulated time.
 * It never moves a clock.
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

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new BadRequestError("Body must be JSON");
    }
    const body = FastForwardBodySchema.safeParse(raw);
    if (!body.success) {
      throw new ValidationError(
        "invalid_body",
        body.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.code })),
      );
    }

    // R-12: a sandbox may skip time only a few times (writes only; no model call). The cap is only CHECKED
    // before the review is written and CHARGED after the service got "created" back, so a skip that is
    // refused, loses a race or fails costs no slot.
    const data = await fastForwardReview(firestoreReviewStore(claims.outlet_id), {
      claims,
      now_ms: Date.now(),
      demoMode: true,
      beforeCreate: () => enforceDemoCapsForRoute("fast_forward", claims, "reviews:verdict", "check"),
      afterCreate: () => enforceDemoCapsForRoute("fast_forward", claims, "reviews:verdict", "charge"),
    });

    const res = jsonOk(FastForwardResponseSchema.parse(data), 200);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (error) {
    const res = handleApiError(error);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
}

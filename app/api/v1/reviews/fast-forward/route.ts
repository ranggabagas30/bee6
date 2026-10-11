import type { NextRequest } from "next/server";
import { requireClaims } from "@/lib/http/guard";
import { BadRequestError, ValidationError, handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { firestoreReviewStore } from "@/lib/firestore/review-store";
import { FastForwardBodySchema, FastForwardResponseSchema } from "@/lib/reviews/contract";
import { fastForwardReview } from "@/lib/reviews/service";

/**
 * POST /api/v1/reviews/fast-forward (R-11 Task 5). DEMO ONLY: the service
 * answers 404 unless DEMO_MODE is "true" (read per request) AND the caller's
 * outlet has project_kind "demo". It runs the same `createReview` as the
 * daily Scheduler run, flagged as simulated time. It never moves a clock.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
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

    const data = await fastForwardReview(firestoreReviewStore(claims.outlet_id), {
      claims,
      now_ms: Date.now(),
      demoMode: process.env.DEMO_MODE === "true",
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

import type { NextRequest } from "next/server";
import { requireClaims } from "@/lib/http/guard";
import { handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { firestoreReviewStore } from "@/lib/firestore/review-store";
import { listReviews } from "@/lib/reviews/service";

/**
 * GET /api/v1/reviews (R-11 Task 5). Owner and supervisor get the same
 * payload; `listReviews` enforces `reviews:read` + outlet on the server. The
 * demo flag is read per request. Every response carries
 * `Cache-Control: private, no-store`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const claims = await requireClaims(req);
    const data = await listReviews(firestoreReviewStore(claims.outlet_id), {
      claims,
      now_ms: Date.now(),
      demoMode: process.env.DEMO_MODE === "true",
    });
    const res = jsonOk(data, 200);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (error) {
    const res = handleApiError(error);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
}

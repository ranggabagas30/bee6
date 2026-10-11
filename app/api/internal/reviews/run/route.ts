import type { NextRequest } from "next/server";
import { handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { verifyInternalOidcToken } from "@/lib/http/oidc";
import { firestoreReviewStore, listAllOutlets } from "@/lib/firestore/review-store";
import { runDueReviews } from "@/lib/reviews/service";

/**
 * POST /api/internal/reviews/run (R-11 Task 5). Cloud Scheduler calls this
 * once a day with an OIDC-signed request; every other caller gets a 401. It
 * reviews every shipped change whose review date has come (catch-up included)
 * and expires unconfirmed reviews to "unknown". Thin wrapper: verify the
 * caller, then hand off to `runDueReviews`.
 *
 * The audience is this route's own public URL from `REVIEW_RUN_AUDIENCE`,
 * read per request and NEVER derived from the request (on Cloud Run `req.url`
 * is not the public URL, and any header is caller-controlled). `now_ms` is read
 * from the server clock exactly once, here.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await verifyInternalOidcToken(req, {
      issuerEmail: process.env.TASKS_INVOKER_SA ?? "",
      audience: process.env.REVIEW_RUN_AUDIENCE ?? "",
      audienceEnvName: "REVIEW_RUN_AUDIENCE",
    });
    const { outlets, truncated } = await listAllOutlets();
    const result = await runDueReviews({
      outlets,
      truncated,
      storeFor: (id) => firestoreReviewStore(id),
      now_ms: Date.now(),
    });
    const res = jsonOk(result);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (error) {
    const res = handleApiError(error);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
}

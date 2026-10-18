import { connection } from "next/server";
import { readFirebaseWebConfig } from "@/lib/auth/web-config";
import { ReviewsApp } from "@/app/reviews/ReviewsApp";
import { readReviewAgentEstimate } from "@/lib/reviews/agent/flag";

/**
 * /reviews (R-11 Task 6.2). A server component so the Firebase web config is
 * read from `process.env` at request time, not baked into the build; same
 * runtime-env pattern as `app/sop/page.tsx` and `app/proposals/page.tsx`. The ReviewAgent's expected wait
 * (`REVIEW_AGENT` on) is read per request the same way; `null` when the flag is off.
 */
export default async function ReviewsPage() {
  await connection();
  return <ReviewsApp config={readFirebaseWebConfig()} reviewAgentEstimate={readReviewAgentEstimate()} />;
}

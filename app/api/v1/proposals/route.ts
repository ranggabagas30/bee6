import type { NextRequest } from "next/server";
import { defaultAllowDraft, loadProposalLibrary } from "@/config/proposal-library";
import { requireClaims } from "@/lib/http/guard";
import { handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { firestoreProposalReviewStore } from "@/lib/firestore/proposal-review-store";
import { firestoreProposalStore } from "@/lib/firestore/proposal-store";
import { listProposals } from "@/lib/proposals/review-service";

/**
 * GET /api/v1/proposals (web spec §6.2; R-09 Task 5.6; R-19 §3.5 adds `watch`).
 * Owner and supervisor get the same payload — `listProposals` enforces
 * `proposals:read` + outlet on the server; the route never trusts a
 * client-supplied role. The watch panel reads through the same outlet-scoped
 * proposal store Generate uses. Every response carries
 * `Cache-Control: private, no-store`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const claims = await requireClaims(req);
    const data = await listProposals(
      firestoreProposalReviewStore(claims.outlet_id),
      {
        loadLibrary: () => loadProposalLibrary({ allowDraft: defaultAllowDraft() }),
        evidence: firestoreProposalStore(claims.outlet_id),
      },
      { claims, now_ms: Date.now() },
    );
    const res = jsonOk(data, 200);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (error) {
    const res = handleApiError(error);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
}

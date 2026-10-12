import type { NextRequest } from "next/server";
import { requireClaims } from "@/lib/http/guard";
import { handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { firestoreSopStore } from "@/lib/firestore/sop-store";
import { getSopOverview } from "@/lib/sop/service";

/**
 * GET /api/v1/sop (R-10 Task 4.4; web spec §6.2). Read-only: owner and
 * supervisor (`sop:diff`, enforced with the outlet check in `getSopOverview`).
 * No write method is exported, ever: SOP changes only through proposals (hard
 * rule #9). Every response carries `Cache-Control: private, no-store`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const claims = await requireClaims(req);
    const data = await getSopOverview(firestoreSopStore(claims.outlet_id), { claims, now_ms: Date.now() });
    const res = jsonOk(data, 200);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (error) {
    const res = handleApiError(error);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
}

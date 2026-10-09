import type { NextRequest } from "next/server";
import { handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { requireClaims } from "@/lib/http/guard";
import { getOwnerHome } from "@/lib/home/service";
import { firestoreDayStore } from "@/lib/firestore/day-store";

/**
 * GET /api/v1/home (web spec §4.4; R-06 Task 14a). Owner-only: "today in 5
 * lines" reusing `getDayRecord`'s owner-view path. Status codes: 401 (no /
 * invalid / expired token, device token), 403 (supervisor, staff, device
 * claims), 404 (outlet doc missing), 500 (unexpected).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const claims = await requireClaims(req);
    const data = await getOwnerHome(firestoreDayStore(claims.outlet_id), {
      claims,
      now_ms: Date.now(),
    });
    const res = jsonOk(data);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (error) {
    const res = handleApiError(error);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
}

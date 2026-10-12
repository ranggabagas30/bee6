import type { NextRequest } from "next/server";
import { handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { requireClaims } from "@/lib/http/guard";
import { getDayRecord } from "@/lib/day/service";
import { firestoreDayStore } from "@/lib/firestore/day-store";
import { readThreadHandleKey } from "@/lib/day/thread-handle";

/**
 * GET /api/v1/day/{date} (web spec §6.2, §6.6.5; technical spec §4.3, §4.4).
 * `{date}` is `today` or `YYYY-MM-DD`. The server decides owner vs supervisor
 * shape from the caller's role (never the client) — see `getDayRecord`.
 * Status codes: 401 (no / invalid / expired / unlinked token, device token),
 * 403 (staff or device claims), 422 (`invalid_date`, `date_in_future`),
 * 404 (outlet doc missing), 500 (unexpected, incl. a missing index).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  try {
    const claims = await requireClaims(req);
    const { date } = await params;
    const data = await getDayRecord(firestoreDayStore(claims.outlet_id), {
      claims,
      param: date,
      now_ms: Date.now(),
      handleKey: readThreadHandleKey(),
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

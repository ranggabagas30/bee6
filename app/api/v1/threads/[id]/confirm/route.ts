import type { NextRequest } from "next/server";
import { BadRequestError, handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { requireClaims } from "@/lib/http/guard";
import { confirmThreadLabel } from "@/lib/day/confirm-service";
import { firestoreDayStore } from "@/lib/firestore/day-store";
import { readThreadHandleKey } from "@/lib/day/thread-handle";

/**
 * POST /api/v1/threads/{id}/confirm (web spec §2, §6.2; R-06 Task 10/15).
 * `{id}` carries the opaque, encrypted thread handle (never a raw thread or
 * device id — hard rule #7); the path segment keeps the generic `id` name
 * used elsewhere in this API (e.g. `/api/v1/questions/{id}/answer`), not
 * `handle`, per the web spec's own route row.
 *
 * Supervisor only (`labels:confirm`); body `{ action: "confirm" | "override" |
 * "reject" }`. Status codes: 400 (bad JSON or body), 401 (no/invalid/expired
 * token), 403 (owner/staff/device claims), 404 (handle does not open, or
 * opens to a foreign-outlet/missing thread — never distinguished in the
 * message), 409 (`NOT_REVIEWABLE` / `GATE_BLOCKED`), 503 (`THREAD_HANDLE_KEY`
 * not configured).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const claims = await requireClaims(req);
    const { id: handle } = await params;

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      throw new BadRequestError("invalid_body");
    }

    const result = await confirmThreadLabel(firestoreDayStore(claims.outlet_id), {
      claims,
      handle,
      rawBody,
      now_ms: Date.now(),
      handleKey: readThreadHandleKey(),
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

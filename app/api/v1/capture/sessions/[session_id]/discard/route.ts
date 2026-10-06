import type { NextRequest } from "next/server";
import { handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { requireDevice } from "@/lib/http/guard";
import { firestoreCaptureSessionStore, firestoreCaptureStore } from "@/lib/firestore/stores";
import { discardCaptureSession, readJsonBody } from "@/lib/capture/session-api";

/**
 * POST /api/v1/capture/sessions/{session_id}/discard (web spec §6.6.5). Cancel
 * ("Batalkan sesi"): writes a tombstone, then deletes the session's segments. A session
 * already ended (Selesai, auto-stop or lost) is a 409 `session_ended`. Device-only.
 *
 * 202 `cleanup: "pending"` while Cancel-B (derived threads and questions) has not run.
 * P1 never runs Cancel-B, so every successful discard answers 202 for now.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ session_id: string }> },
) {
  try {
    const claims = await requireDevice(req);
    const { session_id } = await params;
    const result = await discardCaptureSession(
      { sessions: firestoreCaptureSessionStore(claims.outlet_id), outlets: firestoreCaptureStore() },
      claims,
      session_id,
      await readJsonBody(req),
      Date.now(),
    );
    return jsonOk(result, 202);
  } catch (error) {
    return handleApiError(error);
  }
}

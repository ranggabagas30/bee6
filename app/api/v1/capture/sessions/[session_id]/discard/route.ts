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
 * Every successful discard answers 202 `cleanup: "pending"`. Cancel-B (R-20) runs in the pipeline
 * tick under the device lease: it deletes the derived threads, questions and answers (and any leftover
 * segments of the session) within one tick and sets `cleanup_done_at_ms`. This route never waits for it.
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
      { sessions: firestoreCaptureSessionStore(claims.outlet_id), outlets: firestoreCaptureStore(), demoMode: process.env.DEMO_MODE === "true" },
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

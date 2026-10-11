import type { NextRequest } from "next/server";
import { handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { requireDevice } from "@/lib/http/guard";
import { firestoreCaptureSessionStore, firestoreCaptureStore } from "@/lib/firestore/stores";
import { endCaptureSession, readJsonBody } from "@/lib/capture/session-api";

/**
 * POST /api/v1/capture/sessions/{session_id}/end (web spec §6.6.3). Selesai, the
 * auto-stop or a lost session. Idempotent; a discarded or already-ended session is
 * returned unchanged. Device-only; the session id comes from the path and is checked as
 * a uuid (422 otherwise).
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
    const result = await endCaptureSession(
      { sessions: firestoreCaptureSessionStore(claims.outlet_id), outlets: firestoreCaptureStore(), demoMode: process.env.DEMO_MODE === "true" },
      claims,
      session_id,
      await readJsonBody(req),
      Date.now(),
    );
    return jsonOk(result);
  } catch (error) {
    return handleApiError(error);
  }
}

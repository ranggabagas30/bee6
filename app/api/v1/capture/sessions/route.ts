import type { NextRequest } from "next/server";
import { handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { requireDevice } from "@/lib/http/guard";
import { firestoreCaptureSessionStore, firestoreCaptureStore } from "@/lib/firestore/stores";
import { readJsonBody, startCaptureSession } from "@/lib/capture/session-api";

/**
 * POST /api/v1/capture/sessions (web spec §6.6.3). The paired device starts its session
 * (Mulai). Idempotent: the first write for a session_id wins. Device-only; the outlet and
 * device come from the verified claims, never the body.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const claims = await requireDevice(req);
    const result = await startCaptureSession(
      { sessions: firestoreCaptureSessionStore(claims.outlet_id), outlets: firestoreCaptureStore() },
      claims,
      await readJsonBody(req),
      Date.now(),
    );
    return jsonOk(result);
  } catch (error) {
    return handleApiError(error);
  }
}

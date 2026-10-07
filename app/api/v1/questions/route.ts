import type { NextRequest } from "next/server";
import { UnauthorizedError, handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { requireDevice } from "@/lib/http/guard";
import { listDebriefQuestions } from "@/lib/debrief/service";
import { firestoreDebriefStore } from "@/lib/firestore/debrief-store";

/**
 * GET /api/v1/questions (device; R-07, web spec §6.2/§6.6.6).
 * Lists this device's own open debrief questions for its current active
 * debrief window, or `{ debrief: null, questions: [] }` when none is active.
 * Device-only: any other principal (owner, supervisor, staff, judge) is
 * rejected by `requireDevice` before any store read. A supervisor/owner
 * read-only view of answers is R-06/R-09's route, not this one.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const claims = await requireDevice(req);
    if (!claims.device_id) {
      throw new UnauthorizedError("Device session missing device id");
    }
    const data = await listDebriefQuestions(
      firestoreDebriefStore(claims.outlet_id),
      { outlet_id: claims.outlet_id, device_id: claims.device_id },
      Date.now(),
    );
    return jsonOk(data);
  } catch (error) {
    return handleApiError(error);
  }
}

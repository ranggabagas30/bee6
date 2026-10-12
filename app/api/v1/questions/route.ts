import type { NextRequest } from "next/server";
import { UnauthorizedError, handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { requireClaims, requireDevice } from "@/lib/http/guard";
import { listDebriefQuestions } from "@/lib/debrief/service";
import { firestoreDebriefStore } from "@/lib/firestore/debrief-store";
import { getReviewQueue } from "@/lib/day/queue-service";
import { firestoreDayStore } from "@/lib/firestore/day-store";
import { readThreadHandleKey } from "@/lib/day/thread-handle";

/**
 * GET /api/v1/questions (web spec §6.2/§6.6.6). Two principals share this
 * route, split on the presence of `X-Device-Id` (R-06 Task 13.5): a paired
 * phone always sends it (`lib/capture/browser/client.ts`), so its presence —
 * even an empty value — selects the device branch (R-07, unchanged below);
 * its absence selects the supervisor review queue (R-06 Task 13,
 * `getReviewQueue`). Device tokens are opaque (not JWTs), so this split
 * never depends on the bearer token's shape.
 *
 * Device branch: lists this device's own open debrief questions for its
 * current active debrief window, or `{ debrief: null, questions: [] }` when
 * none is active. Any non-device principal reaching it (a verified Firebase
 * ID token sent together with the header) is rejected by `requireDevice`
 * before any store read.
 *
 * Supervisor branch: "every answered gate question of the last 14 days
 * whose thread is still open and not supervisor-decided" (Task 13's own
 * doc comment, `lib/day/queue-service.ts`). Status codes: 401 (no/bad/
 * expired token), 403 (owner, staff claims), 404 (outlet missing), 200.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function deviceQuestionsGet(req: NextRequest) {
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

async function supervisorQueueGet(req: NextRequest) {
  try {
    const claims = await requireClaims(req);
    const data = await getReviewQueue(firestoreDayStore(claims.outlet_id), {
      claims,
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

export async function GET(req: NextRequest) {
  if (req.headers.get("x-device-id") !== null) return deviceQuestionsGet(req);
  return supervisorQueueGet(req);
}

import type { NextRequest } from "next/server";
import { UnauthorizedError, handleApiError } from "@/lib/http/errors";
import { readBodyTextCapped } from "@/lib/http/body";
import { jsonOk } from "@/lib/http/respond";
import { requireDevice } from "@/lib/http/guard";
import { submitAnswer } from "@/lib/debrief/service";
import { firestoreDebriefStore } from "@/lib/firestore/debrief-store";
import { dlpRedactor } from "@/lib/redact/dlp";
import { enforceDemoCapsForRoute } from "@/lib/demo/route-caps";
import { capBeforeRedactor } from "@/lib/demo/redact-cap";

/**
 * POST /api/v1/questions/{id}/answer (device; R-07, web spec §6.2/§6.6.6).
 * Device-only: `requireDevice` runs BEFORE the body is ever read, so any
 * other principal (owner, supervisor, staff, judge) is rejected (401/403)
 * without the request body being touched. The raw body text is handed to
 * `submitAnswer`, which parses it itself (step 2 of its check chain) — this
 * route never logs or echoes it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A legitimate answer is well under 3 KB (a 500-character reason); the cap only stops a device token buffering megabytes. */
const BODY_MAX_BYTES = 32 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const claims = await requireDevice(req);
    if (!claims.device_id) {
      throw new UnauthorizedError("Device session missing device id");
    }
    const { id } = await params;
    const text = await readBodyTextCapped(req, BODY_MAX_BYTES);

    // R-12: a sandbox's typed reasons go through Sensitive Data Protection, so they are capped. The cap is
    // charged inside the redactor the service is handed, immediately before SDP: a malformed body, an
    // answer replay, an unknown question or an answer outside the debrief window is refused by the service
    // first and spends no slot.
    const redactor = capBeforeRedactor(dlpRedactor(), () => enforceDemoCapsForRoute("redact", claims));

    const result = await submitAnswer(
      {
        store: firestoreDebriefStore(claims.outlet_id),
        redactor,
        // Outcome-only (question_id, a code, a length) — never the reason, scrubbed or not.
        log: (entry) => console.log("debrief.answer", entry),
      },
      { outlet_id: claims.outlet_id, device_id: claims.device_id },
      id,
      text,
      Date.now(),
    );

    return jsonOk(result);
  } catch (error) {
    return handleApiError(error);
  }
}

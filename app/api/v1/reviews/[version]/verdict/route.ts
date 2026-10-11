import type { NextRequest } from "next/server";
import { requireClaims } from "@/lib/http/guard";
import { BadRequestError, NotFoundError, ValidationError, handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { enforceDemoCapsForRoute } from "@/lib/demo/route-caps";
import { capBeforeRedact } from "@/lib/demo/redact-cap";
import { firestoreReviewStore } from "@/lib/firestore/review-store";
import { redactBatch } from "@/lib/redact/batch";
import { VerdictBodySchema, VerdictResponseSchema, VersionParamSchema } from "@/lib/reviews/contract";
import { decideVerdict } from "@/lib/reviews/service";

/**
 * POST /api/v1/reviews/{version}/verdict (R-11 Task 5). Supervisor or owner
 * (`reviews:verdict`); the slot comes from the caller's role on the server,
 * never from the body. The review id is built from the caller's outlet and the
 * version number, so another outlet's review cannot even be expressed. Success
 * is always 200 (recorded and unchanged), which `authedRequest` accepts.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ version: string }> }) {
  try {
    const claims = await requireClaims(req);
    const { version: rawVersion } = await params;
    const version = VersionParamSchema.safeParse(rawVersion);
    if (!version.success) throw new NotFoundError("review", "review");

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new BadRequestError("Body must be JSON");
    }
    const body = VerdictBodySchema.safeParse(raw);
    if (!body.success) {
      throw new ValidationError(
        "invalid_body",
        body.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.code })),
      );
    }

    // R-12: a sandbox's text entry (the verdict reason goes through Sensitive Data Protection) is capped.
    // The cap is charged inside the redaction function the service is handed, immediately before SDP, so a
    // verdict with no reason, or one the service refuses first (a missing, repeated or closed review), spends no slot.
    const redact = capBeforeRedact(redactBatch(), () => enforceDemoCapsForRoute("redact", claims));

    const data = await decideVerdict(
      firestoreReviewStore(claims.outlet_id),
      { redact },
      { claims, version: version.data, body: body.data, now_ms: Date.now() },
    );

    const res = jsonOk(VerdictResponseSchema.parse(data), 200);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (error) {
    const res = handleApiError(error);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
}

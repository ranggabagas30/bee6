import type { NextRequest } from "next/server";
import { defaultAllowDraft, loadProposalLibrary } from "@/config/proposal-library";
import { requireClaims } from "@/lib/http/guard";
import { BadRequestError, NotFoundError, ValidationError, handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { enforceDemoCapsForRoute } from "@/lib/demo/route-caps";
import { firestoreConstraintStore } from "@/lib/firestore/constraint-store";
import { firestoreProposalReviewStore } from "@/lib/firestore/proposal-review-store";
import { redactBatch } from "@/lib/redact/batch";
import { ApproveBodySchema, DecisionResponseSchema, ProposalIdSchema } from "@/lib/proposals/review-contract";
import { decideProposal } from "@/lib/proposals/review-service";

/**
 * POST /api/v1/proposals/{id}/approve (web spec §6.2; R-09 Task 5.6). Owner only (`proposals:approve`): Approve or Reject (reason required), only after the supervisor said feasible.
 * `decideProposal` enforces the permission + outlet on the server; the actor
 * is fixed by this route file, never taken from the client. Success is always
 * 200 (changed and unchanged), which `authedRequest` accepts. Every response
 * carries `Cache-Control: private, no-store`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const claims = await requireClaims(req);
    const { id } = await params;
    if (!ProposalIdSchema.safeParse(id).success) throw new NotFoundError("proposal", "proposal");

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new BadRequestError("Body must be JSON");
    }
    const body = ApproveBodySchema.safeParse(raw);
    if (!body.success) {
      throw new ValidationError(
        "invalid_body",
        body.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.code })),
      );
    }

    // R-12: a sandbox's text entry (the rejection reason goes through Sensitive Data Protection) is capped.
    await enforceDemoCapsForRoute("redact", claims, "proposals:approve");

    const data = await decideProposal(
      firestoreProposalReviewStore(claims.outlet_id),
      firestoreConstraintStore(claims.outlet_id),
      {
        loadLibrary: () => loadProposalLibrary({ allowDraft: defaultAllowDraft() }),
        redact: redactBatch(),
        newId: () => crypto.randomUUID(),
      },
      { claims, proposal_id: id, actor: "owner", body: body.data, now_ms: Date.now() },
    );

    const res = jsonOk(DecisionResponseSchema.parse(data), 200);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (error) {
    const res = handleApiError(error);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
}

import type { NextRequest } from "next/server";
import { getModelLocation } from "@/config/regions";
import { defaultAllowDraft, loadProposalLibrary } from "@/config/proposal-library";
import { adkProposalModel, PROPOSAL_GENERATOR_KIND } from "@/lib/agents/proposal-agent";
import { adkProposalAgentV4 } from "@/lib/agents/proposal-agent-v4";
import { requireClaims } from "@/lib/http/guard";
import { enforceDemoCapsForRoute } from "@/lib/demo/route-caps";
import { BadRequestError, ValidationError, handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { firestoreProposalStore } from "@/lib/firestore/proposal-store";
import { redactBatch } from "@/lib/redact/batch";
import { GenerateBodySchema } from "@/lib/proposals/contract";
import { generateProposal } from "@/lib/proposals/service";
import { isProposalAgentV4Enabled } from "@/lib/proposals/v4/flag";

/**
 * POST /api/v1/proposals/generate (web spec §6.2; R-08 Task 6). The owner
 * and a supervisor both call this (Q-10) — `generateProposal` enforces
 * `proposals:generate` + outlet on the server; the route never trusts a
 * client-supplied role. Every response carries `Cache-Control: private,
 * no-store`.
 *
 * R-12: on the demo project only (DEMO_MODE exactly "true"), a generation inside a per-judge
 * sandbox outlet is capped (5 per sandbox, 300 per day, plus the shared model-call ceiling) before the
 * model is reached. Off-demo, and for any outlet that is not an sbx- sandbox, this does nothing and
 * makes no extra read.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const claims = await requireClaims(req);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new BadRequestError("Body must be JSON");
    }
    const body = GenerateBodySchema.safeParse(raw);
    if (!body.success) {
      throw new ValidationError(
        "invalid_body",
        body.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.code })),
      );
    }

    // R-12: inside a demo sandbox only (inert, zero reads, anywhere else), cap generations before the model is reached.
    await enforceDemoCapsForRoute("generate", claims, "proposals:generate");

    const data = await generateProposal(
      firestoreProposalStore(claims.outlet_id),
      {
        model: adkProposalModel,
        generatorKind: PROPOSAL_GENERATOR_KIND,
        loadLibrary: () => loadProposalLibrary({ allowDraft: defaultAllowDraft() }),
        redact: redactBatch(),
        project: process.env.GOOGLE_CLOUD_PROJECT ?? "",
        resolveLocation: (m) => getModelLocation(m).location,
        newId: () => crypto.randomUUID(),
        // R-24: read per request (a runtime Cloud Run env var). Exactly "true" turns the tool-using agent on; anything
        // else passes null and the service runs today's v3 path.
        agentV4: isProposalAgentV4Enabled() ? adkProposalAgentV4 : null,
      },
      {
        claims,
        from_date: body.data.from_date,
        to_date: body.data.to_date,
        another: body.data.another === true, // R-19 §3.3 "Generate another"
        now_ms: Date.now(),
      },
    );

    const res = jsonOk(data, data.reused ? 200 : 201);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (error) {
    const res = handleApiError(error);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
}

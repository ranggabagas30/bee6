import type { NextRequest } from "next/server";
import { getModelLocation } from "@/config/regions";
import { defaultAllowDraft, loadProposalLibrary } from "@/config/proposal-library";
import { adkProposalModel, PROPOSAL_GENERATOR_KIND } from "@/lib/agents/proposal-agent";
import { requireClaims } from "@/lib/http/guard";
import { assertPermission } from "@/lib/auth/rbac";
import { firestoreDemoStore } from "@/lib/firestore/demo-store";
import { checkGenerateCap, capFromEnv } from "@/lib/demo/service";
import { GENERATE_DAILY } from "@/lib/demo/constants";
import { BadRequestError, ValidationError, handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { firestoreProposalStore } from "@/lib/firestore/proposal-store";
import { redactBatch } from "@/lib/redact/batch";
import { GenerateBodySchema } from "@/lib/proposals/contract";
import { generateProposal } from "@/lib/proposals/service";

/**
 * POST /api/v1/proposals/generate (web spec §6.2; R-08 Task 6). The owner
 * and a supervisor both call this (Q-10) — `generateProposal` enforces
 * `proposals:generate` + outlet on the server; the route never trusts a
 * client-supplied role. Every response carries `Cache-Control: private,
 * no-store`.
 *
 * R-12: on the demo project only (DEMO_MODE exactly "true"), a generation inside a per-judge
 * sandbox outlet is capped (5 per sandbox, 300 per day) before the model is reached. Off-demo this
 * branch does nothing and makes no extra read.
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

    if (process.env.DEMO_MODE === "true") {
      // Only an authorised caller may spend the cap, so the permission check runs first
      // (generateProposal repeats it); an unreadable outlet falls through to the service's own 404.
      assertPermission(claims, "proposals:generate");
      const demoStore = firestoreDemoStore();
      const outlet = await demoStore.getOutlet(claims.outlet_id);
      if (outlet) {
        await checkGenerateCap(demoStore, {
          outlet,
          now_ms: Date.now(),
          caps: { generateDaily: capFromEnv(process.env.DEMO_GENERATE_DAILY_CAP, GENERATE_DAILY) },
        });
      }
    }

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
      },
      { claims, from_date: body.data.from_date, to_date: body.data.to_date, now_ms: Date.now() },
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

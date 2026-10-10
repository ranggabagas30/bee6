import type { NextRequest } from "next/server";
import { requireClaims } from "@/lib/http/guard";
import { BadRequestError, ValidationError, handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { firestoreConstraintStore } from "@/lib/firestore/constraint-store";
import { redactBatch } from "@/lib/redact/batch";
import {
  CreateConstraintBodySchema,
  CreateConstraintResponseSchema,
  ListConstraintsResponseSchema,
} from "@/lib/constraints/contract";
import { createConstraint, listConstraintViews } from "@/lib/constraints/service";

/**
 * GET/POST /api/v1/constraints (web spec §6.6; R-08 Task 8.5). Owner and a
 * supervisor both read and write (Q-11 b) — `createConstraint` /
 * `listConstraintViews` enforce `constraints:read` / `constraints:write` +
 * outlet on the server; the route never trusts a client-supplied role.
 * The body can never choose `source`: this route always passes
 * `source: "manual"` — the strict request schema has no `source` key, so a
 * client that tries to send one gets 422, never a silently-accepted
 * `supervisor_rejection`. Every response carries
 * `Cache-Control: private, no-store`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const claims = await requireClaims(req);
    const constraints = await listConstraintViews(firestoreConstraintStore(claims.outlet_id), claims);
    const data = ListConstraintsResponseSchema.parse({ constraints });
    const res = jsonOk(data, 200);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (error) {
    const res = handleApiError(error);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
}

export async function POST(req: NextRequest) {
  try {
    const claims = await requireClaims(req);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new BadRequestError("Body must be JSON");
    }
    const body = CreateConstraintBodySchema.safeParse(raw);
    if (!body.success) {
      throw new ValidationError(
        "invalid_body",
        body.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.code })),
      );
    }

    const { constraint, duplicate } = await createConstraint(
      firestoreConstraintStore(claims.outlet_id),
      { redact: redactBatch(), newId: () => crypto.randomUUID() },
      { claims, text: body.data.text, now_ms: Date.now(), source: "manual" },
    );

    const data = CreateConstraintResponseSchema.parse({ constraint, duplicate });
    const res = jsonOk(data, duplicate ? 200 : 201);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (error) {
    const res = handleApiError(error);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
}

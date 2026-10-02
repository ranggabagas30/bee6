import type { NextRequest } from "next/server";
import { handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { verifyInternalOidcToken } from "@/lib/http/oidc";
import { firestoreTickStore } from "@/lib/firestore/tick-store";
import { runTick } from "@/lib/pipeline/tick/service";

/**
 * POST /api/internal/pipeline/tick (R-05b, Task 6). Cloud Scheduler calls
 * this every 2 minutes with an OIDC-signed request (never Cloud Tasks —
 * Decision 3, `docs/tasks/R-05b.md`); every other caller gets a 401.
 *
 * This route is a thin wrapper: verify the caller, then hand off to
 * `runTick` (`lib/pipeline/tick/service.ts`) with real Firestore-backed
 * deps. All the actual orchestration — lease, windowing, label calls,
 * sanitizing, gate, persistence — is unit-tested there against an
 * in-memory fake store; this route's own test only covers the OIDC gate
 * and the dependency wiring, per this repo's existing route-test
 * convention (e.g. `app/api/v1/segments/[segment]/route.test.ts`).
 *
 * `now_ms` is read from the server clock exactly once, here at the
 * handler boundary — the pipeline's global constraint (no `Date.now()`
 * below this line) is enforced by `runTick`/`deriveAsOfMs` taking it as
 * an explicit parameter.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await verifyInternalOidcToken(req, { issuerEmail: process.env.TASKS_INVOKER_SA ?? "" });

    const result = await runTick({
      store: firestoreTickStore(),
      now_ms: Date.now(),
    });

    return jsonOk(result);
  } catch (error) {
    return handleApiError(error);
  }
}

import { businessDateOf } from "@/lib/capture/calendar";
import { demoDayOf, demoDaysDone } from "@/lib/capture/contract";
import { SANDBOX_OUTLET_PREFIX } from "@/lib/demo/constants";
import { DemoProgressResponseSchema, type DemoProgressResponse } from "@/lib/demo/contract";
import type { LastEnded, Outlet, ReviewStatus } from "@/lib/firestore/schema";
import { ForbiddenError, NotFoundError } from "@/lib/http/errors";

/**
 * `GET /api/v1/demo/progress` (R-19 PR-5, plan sections 2.3 and 7.2): the counters that drive the judge guide on
 * the supervisor and owner screens. Demo sandbox only (404 otherwise, before any other read); supervisor or owner
 * (403 otherwise). Plain code: the answer is eight counts, never a proposal's text, a device id or a name.
 */

export interface ProgressProposalRow {
  /** `content !== null` (suppressed and blocked docs have none). */
  has_content: boolean;
  supervisor_decision: "feasible" | "rejected" | null;
  owner_decision: "approved" | "rejected" | null;
}

export interface ProgressStore {
  getOutlet(outletId: string): Promise<Outlet | null>;
  /** Every proposal of the outlet, projected to the three facts above. */
  listProposalRows(outletId: string): Promise<ProgressProposalRow[]>;
  /** `last_ended` of every paired device of the outlet (a sandbox has one judge device); no ids. */
  listDeviceLastEnded(outletId: string): Promise<LastEnded[]>;
  /** The `status` of every review of the outlet (nothing else of a review is read). */
  listReviewStatuses(outletId: string): Promise<ReviewStatus[]>;
}

export interface ProgressInput {
  claims: { outlet_id: string; role: string };
  now_ms: number;
  demoMode: boolean;
}

export async function demoProgress(store: ProgressStore, input: ProgressInput): Promise<DemoProgressResponse> {
  if (!input.demoMode) throw new NotFoundError("route", "demo");
  if (input.claims.role !== "supervisor" && input.claims.role !== "owner") {
    throw new ForbiddenError("Only a supervisor or owner can read the demo progress");
  }
  const outletId = input.claims.outlet_id;
  if (!outletId.startsWith(SANDBOX_OUTLET_PREFIX)) throw new NotFoundError("sandbox", outletId);
  const outlet = await store.getOutlet(outletId);
  if (!outlet || outlet.project_kind !== "demo" || outlet.sandbox === undefined) throw new NotFoundError("sandbox", outletId);

  const rows = await store.listProposalRows(outletId);
  const ended = await store.listDeviceLastEnded(outletId);
  const reviewStatuses = await store.listReviewStatuses(outletId);
  // The newest ended business date stands for the sandbox (one judge device; a stale template device never has a later date).
  const last = ended.reduce<LastEnded | null>((best, l) => (best === null || l.business_date > best.business_date ? l : best), null);
  const next_day_count = outlet.sandbox.next_day_count;
  const withContent = rows.filter((r) => r.has_content);
  return DemoProgressResponseSchema.parse({
    day: demoDayOf(next_day_count),
    days_done: demoDaysDone({ next_day_count, last_ended: last, today: businessDateOf(input.now_ms, outlet.timezone) }),
    proposals_with_content: withContent.length,
    feasible: withContent.filter((r) => r.supervisor_decision === "feasible").length,
    owner_decided: withContent.filter((r) => r.owner_decision !== null).length,
    approved: withContent.filter((r) => r.owner_decision === "approved").length,
    reviews_open: reviewStatuses.filter((s) => s === "awaiting_supervisor" || s === "awaiting_owner").length,
    reviews_confirmed: reviewStatuses.filter((s) => s === "confirmed").length,
  });
}

import type { CustomClaims } from "@/lib/auth/roles";
import { assertOutlet, assertPermission } from "@/lib/auth/rbac";
import { getDayRecord, type DayStore } from "@/lib/day/service";
import { NotFoundError } from "@/lib/http/errors";
import { HomeResponseSchema, type HomeLine, type HomeResponse, HOME_LINES } from "@/lib/home/contract";
import {
  nextReview,
  progressTallies,
  waitingApproval,
  type HomeProposalRow,
  type HomeSopVersionRow,
} from "@/lib/home/progress";

/**
 * Owner home service (web spec §4.4; R-06 Task 14a; R-19 PR-8 plan 9.2). `getOwnerHome` reuses `getDayRecord`'s
 * owner-view path for "today" (facts-only, ascending `day.threads`, no question, evidence or button) and adds the
 * W4 slices as plain code (`lib/home/progress.ts`): feasible-and-decided tallies per window, the `awaiting_owner`
 * list and the next review date. Every read is outlet-scoped by the store built from the verified claims.
 */

/** The owner Home's read surface: the day record's store plus the three PR-8 reads. */
export interface HomeStore extends DayStore {
  /** `status in ["approved","rejected"]` of this outlet, at most 500, field-masked to `HomeProposalRow`. */
  listDecidedProposals(): Promise<HomeProposalRow[]>;
  /** `status == "awaiting_owner"` of this outlet, at most 50, same shape. */
  listAwaitingOwnerProposals(): Promise<HomeProposalRow[]>;
  /** Every `sop_versions` doc of this outlet, reduced to `{ review_date, change_title }` (both null on the seed). */
  listSopVersions(): Promise<HomeSopVersionRow[]>;
}

export async function getOwnerHome(
  store: HomeStore,
  input: { claims: CustomClaims; now_ms: number },
): Promise<HomeResponse> {
  const { claims, now_ms } = input;

  // 1. Permission: owner only (403 before any store call).
  assertPermission(claims, "home:read");

  // 2. The outlet's zone, for the business-date windows (same 404 as the day record when it is missing).
  const outlet = await store.getOutlet();
  if (!outlet) throw new NotFoundError("outlet", "outlet");
  assertOutlet(claims, outlet.outlet_id);
  const tz = outlet.timezone;

  // 3. Reuse the owner-view day record for "today" (no `handleKey`: the owner path never seals a handle), and the
  // three PR-8 reads, in parallel.
  const [day, decided, awaiting, versions] = await Promise.all([
    getDayRecord(store, { claims, param: "today", now_ms }),
    store.listDecidedProposals(),
    store.listAwaitingOwnerProposals(),
    store.listSopVersions(),
  ]);

  // 4. Bug guard: `assertPermission(claims, "home:read")` only ever holds
  // for the owner role, and the owner role always gets the owner view — a
  // supervisor view here would mean the role tables disagree.
  if (day.view !== "owner") {
    throw new Error("home: expected the owner view");
  }

  // 5. The latest five facts, shown oldest first (day.threads is already
  // facts-only, ascending).
  const facts = day.threads;
  const lines: HomeLine[] = facts.slice(-HOME_LINES).map((t) => ({
    start_hm: t.start_hm,
    category: t.category,
    summary: t.summary,
  }));

  const today = day.day.date;

  // 6. Assemble + validate.
  return HomeResponseSchema.parse({
    today,
    day_status: day.day.day_status,
    fact_count: day.day.fact_count,
    lines,
    more: facts.length - lines.length,
    progress: progressTallies(decided, today, tz),
    waiting_approval: waitingApproval(awaiting),
    next_review: nextReview(versions, today),
  });
}

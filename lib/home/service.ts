import type { CustomClaims } from "@/lib/auth/roles";
import { assertPermission } from "@/lib/auth/rbac";
import { getDayRecord, type DayStore } from "@/lib/day/service";
import { HomeResponseSchema, type HomeLine, type HomeResponse, HOME_LINES } from "@/lib/home/contract";

/**
 * Owner home service (web spec §4.4; R-06 Task 14a). `getOwnerHome` reuses
 * `getDayRecord`'s owner-view path for "today" rather than re-querying
 * Firestore: the owner home shows no question, evidence or button, so it
 * only needs the already-facts-only, ascending `day.threads` that path
 * returns.
 */

export async function getOwnerHome(
  store: DayStore,
  input: { claims: CustomClaims; now_ms: number },
): Promise<HomeResponse> {
  const { claims, now_ms } = input;

  // 1. Permission: owner only (403 before any store call).
  assertPermission(claims, "home:read");

  // 2. Reuse the owner-view day record for "today". No `handleKey`: the
  // owner path never seals a handle.
  const day = await getDayRecord(store, { claims, param: "today", now_ms });

  // 3. Bug guard: `assertPermission(claims, "home:read")` only ever holds
  // for the owner role, and the owner role always gets the owner view — a
  // supervisor view here would mean the role tables disagree.
  if (day.view !== "owner") {
    throw new Error("home: expected the owner view");
  }

  // 4. The latest five facts, shown oldest first (day.threads is already
  // facts-only, ascending).
  const facts = day.threads;
  const lines: HomeLine[] = facts.slice(-HOME_LINES).map((t) => ({
    start_hm: t.start_hm,
    category: t.category,
    summary: t.summary,
  }));

  // 5. Assemble + validate.
  return HomeResponseSchema.parse({
    today: day.day.date,
    day_status: day.day.day_status,
    fact_count: day.day.fact_count,
    lines,
    more: facts.length - lines.length,
  });
}

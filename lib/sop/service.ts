import { assertOutlet, assertPermission } from "@/lib/auth/rbac";
import type { CustomClaims } from "@/lib/auth/roles";
import { localDateOf } from "@/lib/capture/calendar";
import type { Outcome, Outlet, SopStep, SopVersion } from "@/lib/firestore/schema";
import { NotFoundError } from "@/lib/http/errors";
import { z } from "zod";
import {
  SOP_CHANGES_MAX,
  SopOverviewSchema,
  type SopChangeView,
  type SopOverview,
  type SopStepView,
} from "@/lib/sop/contract";
import { latestSop, sopInForce } from "@/lib/sop/in-force";

/**
 * Read side of the SOP (R-10 Task 4). One outlet-scoped read, plain mapping to
 * views with explicit keys (never a spread: the stored docs carry ids the
 * screen must not see). The store has no write method; SOP changes only through
 * proposals (hard rule #9).
 */

export interface SopStore {
  getOutlet(): Promise<Outlet | null>;
  /** where outlet_id == X, limit 50; SopVersionSchema.safeParse; malformed/foreign skipped and logged. Unsorted. */
  listVersions(): Promise<SopVersion[]>;
  /** where outlet_id == X, limit 50; OutcomeSchema.safeParse; malformed/foreign skipped and logged. Read-only (R-11 Task 7). */
  listOutcomes(): Promise<Outcome[]>;
}

function stepView(s: SopStep): SopStepView {
  return { step_id: s.step_id, title: s.title, text: s.text, role: s.role };
}

function changeView(v: SopVersion, tz: string, outcome: Outcome | undefined): SopChangeView | null {
  const c = v.change ?? null;
  const eff = v.effective_from_date ?? null;
  if (v.source !== "proposal" || c === null || eff === null) return null;
  return {
    version: v.version,
    previous_version: v.version - 1,
    effective_from_date: eff,
    approved_date: localDateOf(c.approved_at_ms, tz),
    kind: c.kind,
    before: c.before ? stepView(c.before) : null,
    after: stepView(c.after),
    change_title: c.change_title,
    metric: {
      category: c.metric.category,
      direction: c.metric.direction,
      description: c.metric.description,
      baseline_count: c.metric.baseline_count,
      baseline_days: c.metric.baseline_days,
    },
    failure_condition: c.failure_condition,
    review_date: c.review_date,
    outcome: outcome ? { verdict: outcome.verdict, simulated: outcome.simulated } : null,
  };
}

export async function getSopOverview(
  store: SopStore,
  input: { claims: CustomClaims; now_ms: number },
): Promise<SopOverview> {
  const { claims, now_ms } = input;
  assertPermission(claims, "sop:diff");
  const outlet = await store.getOutlet();
  if (!outlet) throw new NotFoundError("outlet", "outlet");
  assertOutlet(claims, outlet.outlet_id);
  const tz = outlet.timezone;

  const [versions, outcomes] = await Promise.all([store.listVersions(), store.listOutcomes()]);
  const outcomeByVersion = new Map(outcomes.map((o) => [o.sop_version_id, o]));
  const today = localDateOf(now_ms, tz);
  const latest = latestSop(versions);
  const v1 = versions.find((v) => v.version === 1 && v.source === "seed");
  const first_version_date = v1 ? localDateOf(v1.created_at_ms, tz) : null;
  if (latest === null) {
    return SopOverviewSchema.parse({ today, latest: null, in_force_version: null, first_version_date, changes: [] });
  }
  const inForce = sopInForce(versions, today);

  const changes = versions
    .filter((v) => v.source === "proposal")
    .sort((a, b) => b.version - a.version)
    .map((v) => changeView(v, tz, outcomeByVersion.get(v.sop_version_id)))
    .filter((c): c is SopChangeView => c !== null)
    .slice(0, SOP_CHANGES_MAX);

  try {
    return SopOverviewSchema.parse({
      today,
      latest: {
        version: latest.version,
        effective_from_date: latest.effective_from_date ?? null,
        steps: latest.steps.map(stepView),
      },
      in_force_version: inForce?.version ?? null,
      first_version_date,
      changes,
    });
  } catch (error) {
    if (error instanceof z.ZodError) throw new Error("getSopOverview: internal schema violation");
    throw error;
  }
}

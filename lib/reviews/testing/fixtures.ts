// Test-only fixtures shared by lib/reviews tests (fictional demo data).
import {
  OutcomeSchema,
  ReviewSchema,
  SopVersionSchema,
  type Outcome,
  type Review,
  type SopVersion,
} from "@/lib/firestore/schema";
import { OUTLET, PROPOSAL_ID, seedV1 } from "@/lib/sop/testing/fixtures";

export { OUTLET, PROPOSAL_ID, seedV1 };
export const TZ = "Asia/Jakarta";
export const REASON_SENTINEL = "REASON_SENTINEL_xyz";

const METRIC = {
  category: "CUSTOMER_SERVICE" as const,
  direction: "decrease" as const,
  description: "Sold-out requests per day.",
  baseline_count: 4,
  baseline_days: 3,
};

/** A shipped change version: v{version}, effective `eff`, reviewed on `reviewDate`. */
export function shippedVersion(
  version = 2,
  eff = "2026-10-16",
  reviewDate = "2026-10-23",
  proposalId = PROPOSAL_ID,
  metric: Partial<typeof METRIC> = {},
): SopVersion {
  const base = seedV1();
  const after = { step_id: "stock-01", title: "Title of stock-01", text: `Check the display every 30 minutes (v${version}).`, role: "staff" as const };
  return SopVersionSchema.parse({
    outlet_id: OUTLET,
    sop_version_id: `${OUTLET}:v${version}`,
    version,
    steps: base.steps.map((s) => (s.step_id === "stock-01" ? after : s)),
    source: "proposal",
    source_proposal_id: proposalId,
    created_at_ms: 1_700_000_000_000 + version,
    previous_version_id: `${OUTLET}:v${version - 1}`,
    effective_from_date: eff,
    change: {
      kind: "modify",
      step_id: "stock-01",
      before: base.steps[0],
      after,
      change_title: "Check the display every 30 minutes at peak",
      intervention_id: "change_quantity_time",
      metric: { ...METRIC, ...metric },
      failure_condition: "Sold-out requests do not fall.",
      review_after_days: 7,
      review_date: reviewDate,
      approved_at_ms: 1_700_000_000_000,
    },
  });
}

export function windowDoc(over: Record<string, unknown> = {}) {
  return { from_date: "2026-10-06", to_date: "2026-10-12", days_captured: 3, count: 6, ...over };
}

export function reviewDoc(over: Record<string, unknown> = {}): Review {
  return ReviewSchema.parse({
    outlet_id: OUTLET,
    review_id: `${OUTLET}:v2`,
    sop_version_id: `${OUTLET}:v2`,
    version: 2,
    source_proposal_id: PROPOSAL_ID,
    change_title: "Check the display every 30 minutes at peak",
    step_id: "stock-01",
    intervention_id: "change_quantity_time",
    metric: METRIC,
    failure_condition: "Sold-out requests do not fall.",
    effective_from_date: "2026-10-16",
    review_date: "2026-10-23",
    confirm_by_date: "2026-10-30",
    before: windowDoc(),
    after: windowDoc({ from_date: "2026-10-16", to_date: "2026-10-22", count: 2 }),
    suggestion: { verdict: "worked", reason: "improved", change_ratio: -0.667, rule_version: "rev-v1" },
    notices: { overlapping_change: false, threads_truncated: false },
    simulated: false,
    status: "awaiting_supervisor",
    supervisor_verdict: null,
    owner_verdict: null,
    created_at_ms: 1_700_000_000_000,
    updated_at_ms: 1_700_000_000_000,
    ...over,
  });
}

export function verdictEntry(verdict: "worked" | "revise" | "revert" = "revise", reason: string | null = null) {
  return { verdict, reason, decided_at_ms: 1_700_000_100_000 };
}

export function outcomeDoc(over: Record<string, unknown> = {}): Outcome {
  return OutcomeSchema.parse({
    outlet_id: OUTLET,
    outcome_id: `${OUTLET}:v2`,
    review_id: `${OUTLET}:v2`,
    sop_version_id: `${OUTLET}:v2`,
    version: 2,
    source_proposal_id: PROPOSAL_ID,
    step_id: "stock-01",
    intervention_id: "change_quantity_time",
    metric_category: "CUSTOMER_SERVICE",
    metric_direction: "decrease",
    before: windowDoc(),
    after: windowDoc({ from_date: "2026-10-16", to_date: "2026-10-22", count: 2 }),
    suggested_verdict: "worked",
    supervisor_verdict: "revise",
    verdict: "worked",
    in_memory: true,
    simulated: false,
    decided_at_ms: 1_700_000_200_000,
    ...over,
  });
}

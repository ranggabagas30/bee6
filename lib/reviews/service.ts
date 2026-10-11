import { z } from "zod";
import { assertOutlet, assertPermission } from "@/lib/auth/rbac";
import type { CustomClaims } from "@/lib/auth/roles";
import { addDays, localDateOf, zonedTimeToEpochMs } from "@/lib/capture/calendar";
import type { AttributionSession } from "@/lib/day/attribution";
import type {
  AuditLog,
  Outcome,
  Outlet,
  Proposal,
  Review,
  ReviewStatus,
  ReviewWindow,
  SopVersion,
} from "@/lib/firestore/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/http/errors";
import type { WorkCategory } from "@/lib/pipeline/categories";
import type { ProposalThreadRow } from "@/lib/proposals/candidates";
import { redactUserText } from "@/lib/redact/user-text";
import { LIST_DECIDED_MAX, LIST_OPEN_MAX } from "@/lib/reviews/constants";
import {
  FastForwardResponseSchema,
  ListReviewsResponseSchema,
  RunResponseSchema,
  VerdictResponseSchema,
  type FastForwardResponse,
  type ListReviewsResponse,
  type ReviewView,
  type RunResponse,
  type VerdictBody,
  type VerdictResponse,
} from "@/lib/reviews/contract";
import { countWindow, reviewWindows, type DateWindow } from "@/lib/reviews/metric";
import {
  buildExpiry,
  buildReview,
  buildVerdictWrite,
  classifyVerdict,
  dueChanges,
  nextFastForward,
  type VerdictActor,
  type VerdictCheck,
} from "@/lib/reviews/plan";

/**
 * Review service (R-11 Task 4): the daily run, the verdict transactions, the
 * list and the demo fast-forward. The store interface lives here, next to its
 * consumer (same convention as `lib/proposals/review-service.ts`).
 */

export interface ReviewStore {
  getOutlet(): Promise<Outlet | null>;
  /** Delegates to firestoreSopStore(outletId, db).listVersions(). */
  listVersions(): Promise<SopVersion[]>;
  /** By id; outlet-checked; missing, foreign or malformed -> null (logged). */
  getProposal(id: string): Promise<Proposal | null>;
  /** Chunked "in" queries (SESSIONS_IN_CHUNK); outlet-scoped. */
  listSessions(dates: readonly string[]): Promise<AttributionSession[]>;
  listThreadsInRange(fromMs: number, toMs: number): Promise<{ rows: ProposalThreadRow[]; truncated: boolean }>;
  /** where outlet_id == X, limit REVIEWS_READ_MAX; malformed skipped. */
  listReviews(): Promise<Review[]>;
  /** By id, no transaction; malformed or foreign -> null (logged). */
  getReview(id: string): Promise<Review | null>;
  listStaffScrubNames(): Promise<string[]>;
  /** tx.create(reviews/{id}) + tx.create(audit). "exists" if the doc already exists (no throw). */
  createReview(review: Review, audit: AuditLog): Promise<"created" | "exists">;
  /** One transaction: read reviews/{id}, call decide(review|null) once; if it returns a write:
   *  tx.set(review), tx.create(outcome) if any, tx.create(audit). */
  transactReview<T>(
    reviewId: string,
    decide: (r: Review | null) => { write: { review: Review; outcome: Outcome | null; audit: AuditLog } | null; outcome: T },
  ): Promise<T>;
}

export interface ReviewDeps {
  redact: (texts: readonly string[]) => Promise<string[]>; // redactBatch()
}

// ── implementation ───────────────────────────────────────────────────────────

const OPEN_STATUSES: readonly ReviewStatus[] = ["awaiting_supervisor", "awaiting_owner"];
const DECIDED_STATUSES: readonly ReviewStatus[] = ["confirmed", "unknown"];

const errorClass = (e: unknown): string => (e instanceof Error ? e.constructor.name : "unknown");

/** Counts one window: sessions for the days around it, threads for the exact bounds R-08 step 8a uses. */
async function measureWindow(
  store: ReviewStore,
  tz: string,
  window: DateWindow,
  category: WorkCategory,
): Promise<{ window: ReviewWindow; truncated: boolean }> {
  const dates: string[] = [];
  for (let d = addDays(window.from_date, -1); d <= addDays(window.to_date, 1); d = addDays(d, 1)) dates.push(d);
  const fromMs = zonedTimeToEpochMs(window.from_date, "01:00", tz);
  const toMs = zonedTimeToEpochMs(addDays(window.to_date, 1), "03:00", tz);
  const [sessions, threads] = await Promise.all([store.listSessions(dates), store.listThreadsInRange(fromMs, toMs)]);
  return { window: countWindow({ window, rows: threads.rows, sessions, tz, category }), truncated: threads.truncated };
}

/**
 * Creates the review of one shipped change (the daily run and the demo
 * fast-forward both call exactly this). Idempotent: an existing review is
 * "exists", never an error. Throws if the source proposal is missing.
 */
export async function createReview(
  store: ReviewStore,
  input: {
    outlet: Outlet;
    sop: SopVersion;
    versions: readonly SopVersion[];
    simulated: boolean;
    now_ms: number;
    actor_role: AuditLog["actor_role"];
  },
): Promise<"created" | "exists"> {
  const { outlet, sop, versions, simulated, now_ms, actor_role } = input;
  const change = sop.change;
  if (!change || sop.source_proposal_id == null || sop.effective_from_date == null) throw new Error("createReview: not a shipped change");
  const proposal = await store.getProposal(sop.source_proposal_id);
  if (!proposal) throw new Error("createReview: source proposal missing");

  const windows = reviewWindows({
    range: proposal.range,
    effective_from_date: sop.effective_from_date,
    review_date: change.review_date,
  });
  const category = change.metric.category;
  const before = await measureWindow(store, outlet.timezone, windows.before, category);
  const after = await measureWindow(store, outlet.timezone, windows.after, category);

  const review = buildReview({
    sop,
    versions,
    before: before.window,
    after: after.window,
    threads_truncated: before.truncated || after.truncated,
    simulated,
    now_ms,
  });
  const audit: AuditLog = {
    outlet_id: review.outlet_id,
    ts: new Date(now_ms).toISOString(),
    actor_role,
    action: "review.created",
    target_type: "review",
    target_id: review.review_id,
    // `reason` is the suggestion enum, never free text.
    details: { version: review.version, suggested: review.suggestion.verdict, reason: review.suggestion.reason, simulated },
  };
  const result = await store.createReview(review, audit);
  console.info("[review] created", { outlet_id: review.outlet_id, version: review.version, result });
  return result;
}

/**
 * The daily Scheduler run (R-11 §1 "Trigger"): per outlet, isolated by
 * try/catch so one bad outlet never blocks the rest. Creates every due review
 * (review_date <= today, none yet) and expires every review that was not
 * confirmed by confirm_by_date to "unknown" (kept out of memory).
 */
export async function runDueReviews(input: {
  outlets: readonly Outlet[];
  storeFor: (outletId: string) => ReviewStore;
  now_ms: number;
}): Promise<RunResponse> {
  const { outlets, storeFor, now_ms } = input;
  let created = 0;
  let expired = 0;
  let errors = 0;

  for (const outlet of outlets) {
    try {
      const store = storeFor(outlet.outlet_id);
      const today = localDateOf(now_ms, outlet.timezone);
      const versions = await store.listVersions();
      const reviews = await store.listReviews();
      const reviewedIds = new Set(reviews.map((r) => r.review_id));

      for (const sop of dueChanges({ versions, reviewedIds, today })) {
        try {
          const result = await createReview(store, { outlet, sop, versions, simulated: false, now_ms, actor_role: "system" });
          if (result === "created") created += 1;
        } catch (error) {
          errors += 1;
          console.error("[review] create failed", { outlet_id: outlet.outlet_id, version: sop.version, error_class: errorClass(error) });
        }
      }

      for (const review of reviews) {
        if (!OPEN_STATUSES.includes(review.status) || !(review.confirm_by_date < today)) continue;
        try {
          const n = await store.transactReview<number>(review.review_id, (r) =>
            r && OPEN_STATUSES.includes(r.status) && r.confirm_by_date < today
              ? { write: buildExpiry({ review: r, now_ms }), outcome: 1 }
              : { write: null, outcome: 0 },
          );
          if (n > 0) {
            expired += n;
            console.info("[review] expired", { outlet_id: outlet.outlet_id, version: review.version });
          }
        } catch (error) {
          errors += 1;
          console.error("[review] expire failed", { outlet_id: outlet.outlet_id, version: review.version, error_class: errorClass(error) });
        }
      }
    } catch (error) {
      errors += 1;
      console.error("[review] outlet failed", { outlet_id: outlet.outlet_id, error_class: errorClass(error) });
    }
  }
  return RunResponseSchema.parse({ outlets: outlets.length, created, expired, errors });
}

function viewOf(r: Review, tz: string): ReviewView {
  const decided = (v: Review["supervisor_verdict"]) =>
    v === null ? null : { verdict: v.verdict, reason: v.reason, decided_date: localDateOf(v.decided_at_ms, tz) };
  // Explicit keys only: never source_proposal_id, sop_version_id or any device-revealing id.
  return {
    version: r.version,
    change_title: r.change_title,
    metric: { ...r.metric },
    failure_condition: r.failure_condition,
    effective_from_date: r.effective_from_date,
    review_date: r.review_date,
    confirm_by_date: r.confirm_by_date,
    before: { ...r.before },
    after: { ...r.after },
    suggestion: { verdict: r.suggestion.verdict, reason: r.suggestion.reason, change_ratio: r.suggestion.change_ratio },
    notices: { ...r.notices },
    simulated: r.simulated,
    status: r.status,
    supervisor: decided(r.supervisor_verdict),
    owner: decided(r.owner_verdict),
  };
}

/** GET /api/v1/reviews. Owner and supervisor get the same payload. */
export async function listReviews(
  store: ReviewStore,
  input: { claims: CustomClaims; now_ms: number; demoMode: boolean },
): Promise<ListReviewsResponse> {
  try {
    const { claims, demoMode } = input;
    assertPermission(claims, "reviews:read");
    const outlet = await store.getOutlet();
    if (!outlet) throw new NotFoundError("outlet", "outlet");
    assertOutlet(claims, outlet.outlet_id);
    const tz = outlet.timezone;

    const reviews = (await store.listReviews()).sort((a, b) => b.version - a.version);
    const open = reviews.filter((r) => OPEN_STATUSES.includes(r.status)).slice(0, LIST_OPEN_MAX);
    const decided = reviews.filter((r) => DECIDED_STATUSES.includes(r.status)).slice(0, LIST_DECIDED_MAX);

    let fast_forward_available = false;
    if (demoMode && outlet.project_kind === "demo") {
      const reviewedIds = new Set(reviews.map((r) => r.review_id));
      fast_forward_available = nextFastForward({ versions: await store.listVersions(), reviewedIds }) !== null;
    }
    return ListReviewsResponseSchema.parse({
      fast_forward_available,
      open: open.map((r) => viewOf(r, tz)),
      decided: decided.map((r) => viewOf(r, tz)),
    });
  } catch (error) {
    if (error instanceof z.ZodError) throw new Error("listReviews: internal schema violation");
    throw error;
  }
}

type VerdictRefusal = Exclude<VerdictCheck, { kind: "proceed" }>;
type TransactOutcome = VerdictRefusal | { kind: "written"; status: ReviewStatus };

/**
 * POST /api/v1/reviews/{version}/verdict. The slot (supervisor / owner) comes
 * from `claims.role`, never the body; the id is built from the caller's outlet.
 */
export async function decideVerdict(
  store: ReviewStore,
  deps: ReviewDeps,
  input: { claims: CustomClaims; version: number; body: VerdictBody; now_ms: number },
): Promise<VerdictResponse> {
  const { claims, version, body, now_ms } = input;
  try {
    assertPermission(claims, "reviews:verdict");
    if (claims.role !== "supervisor" && claims.role !== "owner") {
      throw new ForbiddenError(`Role "${claims.role}" may not perform "reviews:verdict".`);
    }
    const actor: VerdictActor = claims.role;

    const outlet = await store.getOutlet();
    if (!outlet) throw new NotFoundError("outlet", "outlet");
    assertOutlet(claims, outlet.outlet_id);
    const today = localDateOf(now_ms, outlet.timezone);
    const id = `${claims.outlet_id}:v${version}`;

    const settle = (check: VerdictRefusal): VerdictResponse => {
      if (check.kind === "not_found") throw new NotFoundError("review", "review");
      if (check.kind === "conflict") throw new ConflictError("Verdict refused", check.code);
      return { result: "unchanged", status: check.status };
    };
    const classify = (review: Review | null) =>
      classifyVerdict({ review, outlet_id: claims.outlet_id, actor, verdict: body.verdict, today });

    // Pre-check: a refused or repeated request costs no redaction call.
    const pre = classify(await store.getReview(id));
    if (pre.kind !== "proceed") {
      const out = settle(pre);
      console.info("[review] decided", { outlet_id: claims.outlet_id, version, actor, result: out.result });
      return VerdictResponseSchema.parse(out);
    }

    // Hard rule #3: mask -> staff-name scrub -> SDP before anything is stored. 503 propagates; nothing written.
    const redacted = body.reason ? await redactUserText(body.reason, await store.listStaffScrubNames(), deps.redact) : null;
    const reason = redacted === null || redacted.trim() === "" ? null : redacted.slice(0, 500);

    const out = await store.transactReview<TransactOutcome>(id, (r) => {
      const c = classify(r);
      if (c.kind !== "proceed") return { write: null, outcome: c };
      const w = buildVerdictWrite({ review: c.review, actor, verdict: body.verdict, reason, now_ms });
      return { write: w, outcome: { kind: "written", status: w.review.status } };
    });
    const result: VerdictResponse = out.kind === "written" ? { result: "recorded", status: out.status } : settle(out);
    console.info("[review] decided", { outlet_id: claims.outlet_id, version, actor, result: result.result });
    return VerdictResponseSchema.parse(result);
  } catch (error) {
    if (error instanceof ConflictError) {
      console.info("[review] refused", { outlet_id: claims.outlet_id, version, code: error.code });
    }
    if (error instanceof z.ZodError) throw new Error("decideVerdict: internal schema violation");
    throw error;
  }
}

/**
 * POST /api/v1/reviews/fast-forward. Demo only: 404 unless DEMO_MODE is on AND
 * the outlet is a demo outlet (double guard; the pilot never sets DEMO_MODE).
 * Calls the same `createReview` as the daily run, flagged `simulated`.
 */
export async function fastForwardReview(
  store: ReviewStore,
  input: { claims: CustomClaims; now_ms: number; demoMode: boolean },
): Promise<FastForwardResponse> {
  const { claims, now_ms, demoMode } = input;
  assertPermission(claims, "reviews:verdict");
  if (claims.role !== "supervisor" && claims.role !== "owner") {
    throw new ForbiddenError(`Role "${claims.role}" may not perform "reviews:verdict".`);
  }
  const outlet = await store.getOutlet();
  if (!outlet) throw new NotFoundError("outlet", "outlet");
  assertOutlet(claims, outlet.outlet_id);
  if (!demoMode || outlet.project_kind !== "demo") throw new NotFoundError("route", "route");

  const versions = await store.listVersions();
  const reviewedIds = new Set((await store.listReviews()).map((r) => r.review_id));
  const next = nextFastForward({ versions, reviewedIds });
  if (!next) throw new ConflictError("Nothing to review", "NOTHING_TO_REVIEW");

  const result = await createReview(store, { outlet, sop: next, versions, simulated: true, now_ms, actor_role: claims.role });
  if (result === "exists") throw new ConflictError("Nothing to review", "NOTHING_TO_REVIEW");
  return FastForwardResponseSchema.parse({ version: next.version });
}

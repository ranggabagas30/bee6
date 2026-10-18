import { z } from "zod";
import { LibraryNotReadyError, type ProposalLibrary } from "@/config/proposal-library";
import { assertOutlet, assertPermission } from "@/lib/auth/rbac";
import type { CustomClaims } from "@/lib/auth/roles";
import { addDays, businessDateOf, localDateOf } from "@/lib/capture/calendar";
import { createConstraint, type ConstraintStore } from "@/lib/constraints/service";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/http/errors";
import { ProposalSchema, type AuditLog, type Constraint, type Outlet, type Proposal, type ProposalStatus, type SopVersion } from "@/lib/firestore/schema";
import { evidenceStillHolds, type FreshThread } from "@/lib/proposals/freshness";
import {
  buildDecisionWrite,
  classifyDecision,
  supersededIds,
  type DecisionActor,
  type DecisionCheck,
  type DecisionSnapshot,
  type RequestedDecision,
} from "@/lib/proposals/review-plan";
import {
  LIST_DECIDED_MAX,
  LIST_OPEN_MAX,
  WATCH_DAYS,
  ListProposalsResponseSchema,
  DecisionResponseSchema,
  type ApproveBody,
  type DecisionResponse,
  type ListProposalsResponse,
  type ProposalListItem,
  type ProposalsWatch,
  type ReviewBody,
  type ReviewView,
  type WatchRow,
} from "@/lib/proposals/review-contract";
import { MIN_EVIDENCE_DATES } from "@/lib/proposals/constants";
import { toProposalView } from "@/lib/proposals/view";
import { selectCandidates } from "@/lib/proposals/candidates";
import { evidenceByCategory } from "@/lib/proposals/precheck";
import { evidenceReadWindow } from "@/lib/proposals/range";
import type { ProposalStore } from "@/lib/proposals/service";
import { sopConflict } from "@/lib/sop/rebase";
import { planShip } from "@/lib/sop/ship";

/**
 * Review/approve service for R-09. The store interface lives here (next to its
 * consumer) the same way `ProposalStore` lives in `service.ts`.
 */

export interface ReviewThreadRow extends FreshThread {
  summary: string;
}

/**
 * What one decision commits. `sop_version` + `sop_audit` are present only when
 * the owner approves (R-10): the new immutable SOP version ships in the same
 * transaction as the approval.
 */
export interface DecisionWrite {
  proposal: Proposal;
  audit: AuditLog;
  sop_version?: SopVersion;
  sop_audit?: AuditLog;
}

export interface ProposalReviewStore {
  getOutlet(): Promise<Outlet | null>;
  /** One equality query per status: where outlet_id == X, where status == s, limit LIST_READ_PER_STATUS (50).
   *  Malformed / foreign docs skipped and logged { doc_id, error_class }. Unsorted. */
  listByStatuses(statuses: readonly ProposalStatus[]): Promise<Proposal[]>;
  /** By id, fieldMask outlet_id,status,excluded_from_evidence,label_source,summary; outlet-checked; missing absent. */
  getThreads(ids: readonly string[]): Promise<Map<string, ReviewThreadRow>>;
  /** sop_versions by doc id (= sop_version_id); outlet-checked; malformed skipped. */
  getSopVersions(ids: readonly string[]): Promise<Map<string, SopVersion>>;
  /** Highest-version sop_versions id of the outlet, or null. Same query as R-08's getCurrentSop. */
  getCurrentSopVersionId(): Promise<string | null>;
  /** All constraints, oldest first, at most MAX_CONSTRAINTS (delegates to firestoreConstraintStore(...).list()). */
  listConstraints(): Promise<Constraint[]>;
  /** The DecisionSnapshot, read WITHOUT a transaction (pre-check only). */
  readDecisionSnapshot(proposalId: string): Promise<DecisionSnapshot>;
  /** One Firestore transaction: reads the DecisionSnapshot, calls decide(snap) exactly once; if it returns a
   *  write, tx.set(proposals/{id}, write.proposal) + tx.create(audit_log/<auto>, write.audit); and, when it carries
   *  a sop_version (R-10), tx.create(sop_versions/{id}) + tx.create(sop_audit). A lost race on the version id
   *  (ALREADY_EXISTS) is a ConflictError SOP_CHANGED. Returns outcome. */
  transactDecision<T>(
    proposalId: string,
    decide: (snap: DecisionSnapshot) => { write: DecisionWrite | null; outcome: T },
  ): Promise<T>;
}

/** R-19 §3.5: the two range reads the watch panel shares with Generate (`firestoreProposalStore`). */
export type EvidenceReader = Pick<ProposalStore, "listSessions" | "listThreadsInRange">;

export interface ReviewDeps {
  /** Throws LibraryNotReadyError. */
  loadLibrary: () => ProposalLibrary;
  redact: (texts: readonly string[]) => Promise<string[]>; // redactBatch()
  newId: () => string; // passed to createConstraint
}

const OPEN_STATUSES: readonly ProposalStatus[] = ["awaiting_supervisor", "awaiting_owner"];
const DECIDED_STATUSES: readonly ProposalStatus[] = ["approved", "rejected"];
/** A proposal in one of these states marks its focus category `proposed` on the watch panel (R-19 §3.5). */
const WATCH_PROPOSED_STATUSES: readonly ProposalStatus[] = ["awaiting_supervisor", "awaiting_owner", "approved"];

function citedThreadIds(ps: readonly Proposal[]): string[] {
  return [...new Set(ps.flatMap((p) => p.content?.evidence.map((e) => e.thread_id) ?? []))];
}

function reviewViewOf(p: Proposal, tz: string): ReviewView {
  const sr = p.supervisor_review ?? null;
  const od = p.owner_decision ?? null;
  return {
    supervisor: sr
      ? { decision: sr.decision, reason: sr.reason, decided_date: localDateOf(sr.decided_at_ms, tz) }
      : null,
    owner: od ? { decision: od.decision, reason: od.reason, decided_date: localDateOf(od.decided_at_ms, tz) } : null,
  };
}

/**
 * R-19 §3.5 "What Bee6 is watching": one row per category with at least one fact in `[today-6, today]`, read
 * with the same selection as Generate (so ROUTINE_OPS never appears), plus `proposed` when an open or approved
 * proposal whose range overlaps the window is about that category. Plain code; counts only, never a thread id,
 * device id or summary (hard rule #7).
 */
async function watchOf(
  evidence: EvidenceReader,
  all: readonly Proposal[],
  tz: string,
  nowMs: number,
): Promise<ProposalsWatch> {
  const today = businessDateOf(nowMs, tz);
  const range = { from_date: addDays(today, -(WATCH_DAYS - 1)), to_date: today };
  const window = evidenceReadWindow(range, tz);
  const [sessions, rows] = await Promise.all([evidence.listSessions(window.dates), evidence.listThreadsInRange(window.fromMs, window.toMs)]);
  const proposed = new Set(
    all
      .filter(
        (p) =>
          WATCH_PROPOSED_STATUSES.includes(p.status) &&
          p.focus_category &&
          p.range.from_date <= range.to_date &&
          p.range.to_date >= range.from_date,
      )
      .map((p) => p.focus_category!),
  );
  const categories: WatchRow[] = evidenceByCategory(selectCandidates(rows, sessions, tz, range)).map((r) => ({
    category: r.category,
    facts: r.facts,
    dates: r.dates,
    need_dates: MIN_EVIDENCE_DATES,
    state: proposed.has(r.category) ? "proposed" : r.ready ? "ready" : "needs_more",
  }));
  return { from_date: range.from_date, to_date: range.to_date, categories };
}

/**
 * GET /api/v1/proposals (R-09 Task 5.4; R-19 §3.5 adds `watch`). Owner and
 * supervisor get the SAME payload (no role variant). The only evidence in the
 * response is `toProposalView`'s dated summaries and the watch panel's counts
 * (hard rule #7).
 */
export async function listProposals(
  store: ProposalReviewStore,
  deps: Pick<ReviewDeps, "loadLibrary"> & { evidence: EvidenceReader },
  input: { claims: CustomClaims; now_ms: number },
): Promise<ListProposalsResponse> {
  try {
    return await listProposalsCore(store, deps, input);
  } catch (error) {
    if (error instanceof z.ZodError) throw new Error("listProposals: internal schema violation");
    throw error;
  }
}

async function listProposalsCore(
  store: ProposalReviewStore,
  deps: Pick<ReviewDeps, "loadLibrary"> & { evidence: EvidenceReader },
  input: { claims: CustomClaims; now_ms: number },
): Promise<ListProposalsResponse> {
  const { claims } = input;
  assertPermission(claims, "proposals:read");
  if (claims.role !== "owner" && claims.role !== "supervisor") {
    throw new ForbiddenError(`Role "${claims.role}" may not perform "proposals:read".`);
  }

  const outlet = await store.getOutlet();
  if (!outlet) throw new NotFoundError("outlet", "outlet");
  assertOutlet(claims, outlet.outlet_id);
  const tz = outlet.timezone;

  let library: ProposalLibrary;
  try {
    library = deps.loadLibrary();
  } catch (error) {
    if (error instanceof LibraryNotReadyError) throw new ConflictError("Library not ready", "LIBRARY_NOT_READY");
    throw error;
  }

  const all = await store.listByStatuses([...OPEN_STATUSES, ...DECIDED_STATUSES]);
  all.sort((a, b) => b.created_at_ms - a.created_at_ms || (a.proposal_id < b.proposal_id ? 1 : -1));
  const open = all.filter((p) => OPEN_STATUSES.includes(p.status)).slice(0, LIST_OPEN_MAX);
  const decided = all.filter((p) => DECIDED_STATUSES.includes(p.status)).slice(0, LIST_DECIDED_MAX);
  const superseded = supersededIds(all);

  const [threads, currentSopId, constraints, watch] = await Promise.all([
    store.getThreads(citedThreadIds([...open, ...decided])),
    store.getCurrentSopVersionId(),
    store.listConstraints(),
    watchOf(deps.evidence, all, tz, input.now_ms),
  ]);
  const sopIds = new Set([...open, ...decided].map((p) => p.generator.sop_version_id));
  if (currentSopId !== null) sopIds.add(currentSopId);
  const sops = await store.getSopVersions([...sopIds]);

  function itemOf(p: Proposal, isOpen: boolean): ProposalListItem | null {
    const sop = sops.get(p.generator.sop_version_id) ?? (currentSopId !== null ? sops.get(currentSopId) : undefined);
    if (!sop) {
      console.error("[proposal-review] sop missing", { proposal_id: p.proposal_id, error_class: "sop_missing" });
      return null;
    }
    const summaries = new Map<string, string | null>(
      (p.content?.evidence ?? []).map((e) => [e.thread_id, threads.get(e.thread_id)?.summary ?? null]),
    );
    const proposal = toProposalView(p, summaries, library, sop, tz);
    const review = reviewViewOf(p, tz);
    const notices =
      isOpen && p.content
        ? {
            late_constraints: constraints
              .filter((c) => !p.content!.constraint_ids_acknowledged.includes(c.constraint_id))
              .map((c) => ({ constraint_id: c.constraint_id, text: c.text })),
            evidence_stale: !evidenceStillHolds(p.content.evidence, threads).holds,
            // Item 20: only when the step this proposal rewrites changed after it was drafted (see sopConflict).
            sop_changed:
              sopConflict({
                proposal: p,
                drafted: sops.get(p.generator.sop_version_id) ?? null,
                current: currentSopId !== null ? (sops.get(currentSopId) ?? null) : null,
              }) === "SOP_CHANGED",
            superseded: superseded.has(p.proposal_id),
          }
        : { late_constraints: [], evidence_stale: false, sop_changed: false, superseded: false };
    return { proposal, review, notices };
  }

  const openItems = open.map((p) => itemOf(p, true)).filter((i): i is ProposalListItem => i !== null);
  const decidedItems = decided.map((p) => itemOf(p, false)).filter((i): i is ProposalListItem => i !== null);
  return ListProposalsResponseSchema.parse({ open: openItems, decided: decidedItems, watch });
}

type Refusal = Exclude<DecisionCheck, { kind: "proceed" }>;
type TransactOutcome = Refusal | { kind: "written"; status: ProposalStatus };

/**
 * POST …/{id}/review (supervisor) and POST …/{id}/approve (owner). The route
 * fixes `actor`; this checks the permission and the outlet on the server.
 * Both rejections become permanent constraints through the one write path,
 * `createConstraint` (R-09 Q-1 = yes; hard rule #3 redaction lives there).
 */
export async function decideProposal(
  store: ProposalReviewStore,
  constraintStore: ConstraintStore,
  deps: ReviewDeps,
  input: {
    claims: CustomClaims;
    proposal_id: string;
    actor: DecisionActor;
    body: ReviewBody | ApproveBody;
    now_ms: number;
  },
): Promise<DecisionResponse> {
  try {
    const result = await decideCore(store, constraintStore, deps, input);
    console.info("[proposal] decided", {
      outlet_id: input.claims.outlet_id,
      proposal_id: input.proposal_id,
      actor: input.actor,
      result: result.result,
    });
    return DecisionResponseSchema.parse(result);
  } catch (error) {
    if (error instanceof ConflictError) {
      console.info("[proposal] decision refused", {
        outlet_id: input.claims.outlet_id,
        proposal_id: input.proposal_id,
        actor: input.actor,
        code: error.code,
      });
    }
    if (error instanceof z.ZodError) throw new Error("decideProposal: internal schema violation");
    throw error;
  }
}

async function decideCore(
  store: ProposalReviewStore,
  constraintStore: ConstraintStore,
  deps: ReviewDeps,
  input: {
    claims: CustomClaims;
    proposal_id: string;
    actor: DecisionActor;
    body: ReviewBody | ApproveBody;
    now_ms: number;
  },
): Promise<DecisionResponse> {
  const { claims, actor, body, now_ms } = input;

  // 1. Permission.
  assertPermission(claims, actor === "supervisor" ? "proposals:review" : "proposals:approve");
  if (claims.role !== actor) throw new ForbiddenError(`Role "${claims.role}" may not act as ${actor}.`);

  // 2. Outlet.
  const outlet = await store.getOutlet();
  if (!outlet) throw new NotFoundError("outlet", "outlet");
  assertOutlet(claims, outlet.outlet_id);
  const outlet_id = outlet.outlet_id;

  // 3. What is being asked.
  const requested: RequestedDecision =
    body.decision === "reject" ? "rejected" : body.decision === "feasible" ? "feasible" : "approved";
  const ack = body.decision === "reject" ? [] : body.acknowledged_constraint_ids;

  const toResult = (check: Refusal): DecisionResponse => {
    if (check.kind === "not_found") throw new NotFoundError("proposal", "proposal");
    if (check.kind === "conflict") throw new ConflictError("Decision refused", check.code);
    return { result: "unchanged", status: check.status };
  };

  const tz = outlet.timezone;

  const transact = (reason: string | null, constraint_id: string | null) =>
    store.transactDecision<TransactOutcome>(input.proposal_id, (snap) => {
      const check = classifyDecision({ snap, outlet_id, actor, requested, acknowledged_constraint_ids: ack });
      if (check.kind !== "proceed") return { write: null, outcome: check };
      const base = buildDecisionWrite({
        proposal: check.proposal,
        actor,
        requested,
        late_ids: check.late_ids,
        reason,
        constraint_id,
        now_ms,
      });
      if (!(actor === "owner" && requested === "approved")) {
        return { write: base, outcome: { kind: "written" as const, status: base.proposal.status } };
      }

      // R-10: the owner's approval ships the next immutable SOP version in the SAME transaction. planShip runs on
      // the in-transaction snapshot (never the pre-check), so the version is built on exactly the SOP just read.
      const plan = planShip({ current: snap.current_sop, drafted: snap.drafted_sop, proposal: check.proposal, now_ms, tz });
      if (plan.kind === "conflict") return { write: null, outcome: { kind: "conflict" as const, code: plan.code } };
      const proposal = ProposalSchema.parse({
        ...base.proposal,
        content: { ...base.proposal.content!, review_date: plan.review_date }, // counted from the ship date (R-10 §1)
      });
      const audit: AuditLog = {
        ...base.audit,
        details: { ...base.audit.details, sop_version_id: plan.sop_version.sop_version_id, review_date: plan.review_date },
      };
      // Ids, versions and dates only: no step text, title, metric or failure condition (hard rule #7, R-10 §2).
      const sop_audit: AuditLog = {
        outlet_id: proposal.outlet_id,
        ts: new Date(now_ms).toISOString(),
        actor_role: "owner",
        action: "sop.version_created",
        target_type: "sop_version",
        target_id: plan.sop_version.sop_version_id,
        details: {
          version: plan.sop_version.version,
          change_kind: plan.sop_version.change!.kind,
          source_proposal_id: proposal.proposal_id,
          // An id (rule 7): makes a re-based approval (drafted on an older version) visible in the audit log.
          drafted_on_sop_version_id: proposal.generator.sop_version_id,
          effective_from_date: plan.effective_from_date,
          review_date: plan.review_date,
        },
      };
      return {
        write: { proposal, audit, sop_version: plan.sop_version, sop_audit },
        outcome: { kind: "written" as const, status: proposal.status },
      };
    });

  const finish = (out: TransactOutcome): DecisionResponse =>
    out.kind === "written" ? { result: requested, status: out.status } : toResult(out);

  // 5. Positive decisions: one transaction, no pre-check.
  if (requested !== "rejected") return finish(await transact(null, null));

  // 6. Reject. R-a: pre-check without paying for redaction or a constraint.
  const pre = classifyDecision({
    snap: await store.readDecisionSnapshot(input.proposal_id),
    outlet_id,
    actor,
    requested,
    acknowledged_constraint_ids: [],
  });
  if (pre.kind !== "proceed") return toResult(pre);

  // R-b: the reason becomes a permanent constraint through createConstraint (mask, scrub, SDP, dedupe, limit).
  const reason = (body as { reason: string }).reason;
  const { constraint } = await createConstraint(
    constraintStore,
    { redact: deps.redact, newId: deps.newId },
    {
      claims,
      text: reason,
      now_ms,
      source: actor === "supervisor" ? "supervisor_rejection" : "owner_rejection",
      source_proposal_id: input.proposal_id,
    },
  );

  // R-c: decision transaction; a lost race is a 409 and the constraint stays (R-09 E20).
  return finish(await transact(constraint.text, constraint.constraint_id));
}

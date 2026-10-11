import { z } from "zod";
import { LibraryNotReadyError, type ProposalLibrary } from "@/config/proposal-library";
import { assertOutlet, assertPermission } from "@/lib/auth/rbac";
import type { CustomClaims } from "@/lib/auth/roles";
import { localDateOf } from "@/lib/capture/calendar";
import { createConstraint, type ConstraintStore } from "@/lib/constraints/service";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/http/errors";
import type { AuditLog, Constraint, Outlet, Proposal, ProposalStatus, SopVersion } from "@/lib/firestore/schema";
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
  ListProposalsResponseSchema,
  DecisionResponseSchema,
  type ApproveBody,
  type DecisionResponse,
  type ListProposalsResponse,
  type ProposalListItem,
  type ReviewBody,
  type ReviewView,
} from "@/lib/proposals/review-contract";
import { toProposalView } from "@/lib/proposals/view";

/**
 * Review/approve service for R-09. The store interface lives here (next to its
 * consumer) the same way `ProposalStore` lives in `service.ts`.
 */

export interface ReviewThreadRow extends FreshThread {
  summary: string;
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
   *  write, tx.set(proposals/{id}, write.proposal) + tx.create(audit_log/<auto>, write.audit). Returns outcome. */
  transactDecision<T>(
    proposalId: string,
    decide: (snap: DecisionSnapshot) => { write: { proposal: Proposal; audit: AuditLog } | null; outcome: T },
  ): Promise<T>;
}

export interface ReviewDeps {
  /** Throws LibraryNotReadyError. */
  loadLibrary: () => ProposalLibrary;
  redact: (texts: readonly string[]) => Promise<string[]>; // redactBatch()
  newId: () => string; // passed to createConstraint
}

const OPEN_STATUSES: readonly ProposalStatus[] = ["awaiting_supervisor", "awaiting_owner"];
const DECIDED_STATUSES: readonly ProposalStatus[] = ["approved", "rejected"];

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
 * GET /api/v1/proposals (R-09 Task 5.4). Owner and supervisor get the SAME
 * payload (no role variant). The only evidence in the response is
 * `toProposalView`'s dated summaries (hard rule #7).
 */
export async function listProposals(
  store: ProposalReviewStore,
  deps: Pick<ReviewDeps, "loadLibrary">,
  input: { claims: CustomClaims },
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
  deps: Pick<ReviewDeps, "loadLibrary">,
  input: { claims: CustomClaims },
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

  const [threads, currentSopId, constraints] = await Promise.all([
    store.getThreads(citedThreadIds([...open, ...decided])),
    store.getCurrentSopVersionId(),
    store.listConstraints(),
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
            sop_changed: currentSopId !== p.generator.sop_version_id,
            superseded: superseded.has(p.proposal_id),
          }
        : { late_constraints: [], evidence_stale: false, sop_changed: false, superseded: false };
    return { proposal, review, notices };
  }

  const openItems = open.map((p) => itemOf(p, true)).filter((i): i is ProposalListItem => i !== null);
  const decidedItems = decided.map((p) => itemOf(p, false)).filter((i): i is ProposalListItem => i !== null);
  return ListProposalsResponseSchema.parse({ open: openItems, decided: decidedItems });
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

  const transact = (reason: string | null, constraint_id: string | null) =>
    store.transactDecision<TransactOutcome>(input.proposal_id, (snap) => {
      const check = classifyDecision({ snap, outlet_id, actor, requested, acknowledged_constraint_ids: ack });
      if (check.kind !== "proceed") return { write: null, outcome: check };
      const write = buildDecisionWrite({
        proposal: check.proposal,
        actor,
        requested,
        late_ids: check.late_ids,
        reason,
        constraint_id,
        now_ms,
      });
      return { write, outcome: { kind: "written", status: write.proposal.status } };
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

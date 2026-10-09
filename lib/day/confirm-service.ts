import { BadRequestError, ConflictError, NotFoundError, ServiceUnavailableError } from "@/lib/http/errors";
import { assertPermission } from "@/lib/auth/rbac";
import type { CustomClaims } from "@/lib/auth/roles";
import { evaluateGate, type GateDecision, type GateRule } from "@/lib/pipeline/gate";
import { threadQuestionId } from "@/lib/pipeline/question-ids";
import { openThreadHandle } from "@/lib/day/thread-handle";
import { ConfirmBodySchema, ConfirmResponseSchema, type ConfirmBody, type ConfirmResponse } from "@/lib/day/contract";
import type { AuditLog, Question, Thread } from "@/lib/firestore/schema";
import type { Category, WorkCategory } from "@/lib/pipeline/categories";
import type { DayStore } from "@/lib/day/service";

/**
 * Supervisor confirm/override (R-06 Task 10, `docs/tasks/R-06.md` §5 Task
 * 10.6). `planConfirm` is the pure transaction planner, called INSIDE the
 * store's `transactConfirm` with a fresh snapshot (a racing tick, a second
 * supervisor, or a staff answer that just landed may have changed the
 * thread/question since the route's own pre-check), so every terminal
 * state is re-derived here, never assumed — same discipline as R-07's
 * `planAnswerCommit`. `confirmThreadLabel` is the thin orchestrator the
 * route calls: permission check, handle decryption, body validation, then
 * the transaction.
 */

export interface ConfirmTxSnapshot {
  thread: Thread | null;
  question: Question | null;
}

export type ConfirmPlan =
  | { kind: "write"; thread_patch: Partial<Thread>; audit: Omit<AuditLog, "outlet_id" | "ts">; response: ConfirmResponse }
  | { kind: "unchanged"; response: ConfirmResponse }
  | { kind: "not_found" }
  | { kind: "not_reviewable" }
  | { kind: "gate_blocked"; fired_rule: GateRule };

/**
 * The pure decision for one confirm/override call against a fresh
 * transaction snapshot. Never does I/O; the store applies the resulting
 * patch/audit only on a `"write"` plan.
 */
export function planConfirm(input: {
  snap: ConfirmTxSnapshot;
  outlet_id: string;
  body: ConfirmBody;
  now_ms: number;
}): ConfirmPlan {
  const { snap, outlet_id, body, now_ms } = input;
  const { thread, question } = snap;

  // 1. Thread must exist, in this outlet.
  if (!thread || thread.outlet_id !== outlet_id) {
    return { kind: "not_found" };
  }

  // 2. Eligibility: not unverified, and the staff have answered the question.
  if (
    thread.status === "unverified" ||
    !question ||
    question.outlet_id !== outlet_id ||
    question.status !== "answered"
  ) {
    return { kind: "not_reviewable" };
  }

  // 3. The chosen category.
  const current: Category = thread.confirmed_category ?? thread.category;
  const chosen: Category = body.action === "confirm" ? current : body.category;
  // Only possible on a confirm of a corrupt doc (the day record already
  // drops NON_WORK rows, so this is defensive, not a normal path).
  if (chosen === "NON_WORK") {
    return { kind: "not_reviewable" };
  }

  // 4. Idempotent: the exact same decision already stands.
  if (
    thread.label_source === "supervisor_confirmed" &&
    thread.status === "fact" &&
    thread.confirmed_category === chosen
  ) {
    return {
      kind: "unchanged",
      response: { result: "unchanged", category: chosen, display_status: "fact_supervisor_confirmed" },
    };
  }

  // 5. The gate — the only code that decides fact vs not-a-fact.
  const gate: GateDecision = evaluateGate({
    category: thread.category as WorkCategory,
    confidence: thread.confidence,
    evidence_line_ids: thread.evidence_line_ids,
    label_conflict: thread.label_conflict,
    supervisor_decision: { chosen_category: chosen },
  });
  if (gate.verdict !== "fact") {
    return { kind: "gate_blocked", fired_rule: gate.fired_rule };
  }

  // 6. Write.
  const wasExcluded = thread.excluded_from_evidence === true;
  return {
    kind: "write",
    thread_patch: {
      gate,
      status: "fact",
      label_source: "supervisor_confirmed",
      confirmed_category: chosen,
      excluded_from_evidence: false,
      updated_at_ms: now_ms,
    },
    audit: {
      actor_role: "supervisor",
      action: body.action === "confirm" ? "thread.supervisor_confirm" : "thread.supervisor_override",
      target_type: "thread",
      target_id: thread.thread_id,
      details: {
        from_category: current,
        to_category: chosen,
        previous_status: thread.status,
        was_excluded: wasExcluded,
      },
    },
    response: { result: "confirmed", category: chosen, display_status: "fact_supervisor_confirmed" },
  };
}

/**
 * Thin orchestrator the route calls. Order matters (R-06 Task 10.6):
 * permission, then the key, then the body, then the handle — so a
 * forbidden or malformed request never touches Firestore or leaks whether
 * a handle decrypts.
 */
export async function confirmThreadLabel(
  store: Pick<DayStore, "transactConfirm">,
  input: { claims: CustomClaims; handle: string; rawBody: unknown; now_ms: number; handleKey: Buffer | null },
): Promise<ConfirmResponse> {
  const { claims, handle, rawBody, now_ms, handleKey } = input;

  assertPermission(claims, "labels:confirm");

  if (handleKey === null) {
    throw new ServiceUnavailableError("Thread handles are not configured on this server.");
  }

  const parsedBody = ConfirmBodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    throw new BadRequestError("invalid_body");
  }

  const threadId = openThreadHandle(handle, claims.outlet_id, handleKey);
  if (threadId === null) {
    throw new NotFoundError("thread", "handle");
  }

  const plan = await store.transactConfirm(threadId, threadQuestionId(threadId), (snap) =>
    planConfirm({ snap, outlet_id: claims.outlet_id, body: parsedBody.data, now_ms }),
  );

  if (plan.kind === "not_found") {
    throw new NotFoundError("thread", "handle");
  }
  if (plan.kind === "not_reviewable") {
    throw new ConflictError("not_reviewable", "NOT_REVIEWABLE");
  }
  if (plan.kind === "gate_blocked") {
    throw new ConflictError("gate_blocked", "GATE_BLOCKED");
  }
  return ConfirmResponseSchema.parse(plan.response);
}

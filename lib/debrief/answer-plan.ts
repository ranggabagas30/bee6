import { NotFoundError } from "@/lib/http/errors";
import { evaluateGate } from "@/lib/pipeline/gate";
import { NEEDS_SUPERVISOR_CONFIRM, type WorkCategory } from "@/lib/pipeline/categories";
import type { Correction, Question, Thread } from "@/lib/firestore/schema";

/**
 * Pure transaction planner for a debrief answer (R-07, `docs/tasks/R-07-plan.md`
 * §4.4). Called INSIDE the store's `transactAnswer` with a fresh snapshot (a
 * racing tick or a second phone may have changed the question since the
 * route's own pre-check), so every terminal state is re-derived here, never
 * assumed. Never reads the raw/unredacted reason — only `redacted_reason`,
 * which becomes `correction.reason_text` and nothing else (a test proves
 * two opposite reasons produce an identical `evaluateGate` call).
 */

export interface EndedDebrief {
  business_date: string;
  debrief_ends_at_ms: number;
}

export interface AnswerTxSnapshot {
  question: Question | null;
  thread: Thread | null;
  correction_exists: boolean;
}

export interface AnswerWritePlan {
  result: "answered" | "already_answered" | "question_closed";
  question_patch?: Partial<Question>;
  thread_patch?: Partial<Thread>;
  correction?: Correction;
  audit?: {
    action: "debrief.answer_uploaded";
    target_type: "question";
    target_id: string;
    details: { device_id: string };
  };
}

export function planAnswerCommit(input: {
  snap: AnswerTxSnapshot;
  question_id: string;
  body: { answer: "yes" | "no"; debrief_business_date: string; answered_at_ms: number };
  ends_ms: number;
  redacted_reason: string;
  device_id: string;
  outlet_id: string;
  now_ms: number;
  retention_days: number;
}): AnswerWritePlan {
  const { snap, question_id, body, ends_ms, redacted_reason, device_id, outlet_id, now_ms, retention_days } = input;
  const { question, thread, correction_exists } = snap;

  if (!question) {
    throw new NotFoundError("question", question_id);
  }

  // First committed answer wins: a racing tick/second phone already answered it.
  if (question.status === "answered" || correction_exists) {
    return { result: "already_answered" };
  }

  // Unverified by an OLDER debrief end than this answer's own debrief: the
  // question has moved on to a later debrief cycle; this answer is stale.
  if (question.status === "unverified" && question.expired_by_debrief_end_ms !== ends_ms) {
    return { result: "question_closed" };
  }

  const question_patch: Partial<Question> = {
    status: "answered",
    answer: body.answer,
    answered_at_ms: body.answered_at_ms,
    expired_by_debrief_end_ms: null,
  };

  const needs_supervisor_confirm = thread
    ? NEEDS_SUPERVISOR_CONFIRM.has(thread.category as WorkCategory)
    : false;

  const correction: Correction = {
    outlet_id,
    correction_id: question_id,
    question_id,
    thread_id: question.thread_id,
    answer: body.answer,
    reason_text: redacted_reason,
    answered_device_id: device_id,
    debrief_business_date: body.debrief_business_date,
    answered_at_ms: body.answered_at_ms,
    received_at_ms: now_ms,
    needs_supervisor_confirm,
    expires_at: new Date(body.answered_at_ms + retention_days * 86_400_000).toISOString(),
    created_at: new Date(now_ms).toISOString(),
  };

  const audit: AnswerWritePlan["audit"] = {
    action: "debrief.answer_uploaded",
    target_type: "question",
    target_id: question_id,
    details: { device_id },
  };

  let thread_patch: Partial<Thread> | undefined;

  if (question.kind === "gate" && thread) {
    const gate = evaluateGate({
      category: thread.category as WorkCategory,
      confidence: thread.confidence,
      evidence_line_ids: thread.evidence_line_ids,
      label_conflict: thread.label_conflict,
      staff_answer: {
        question_id,
        chosen_category: body.answer === "yes" ? (thread.category as WorkCategory) : null,
      },
    });

    if (body.answer === "yes" && gate.fired_rule === "staff_confirmed") {
      thread_patch = {
        gate,
        status: "fact",
        label_source: "staff_confirmed",
        confirmed_category: thread.category,
      };
    } else if (body.answer === "yes") {
      thread_patch = { gate, status: "open", label_source: "model" };
    } else {
      thread_patch = { gate, status: "open", label_source: "model", excluded_from_evidence: true };
    }
  } else if (question.kind === "gate" && !thread) {
    // Logged by question_id only — never raw text (hard rule-friendly logging).
    console.error("debrief.answer thread_missing", { question_id });
  }

  const plan: AnswerWritePlan = { result: "answered", question_patch, correction, audit };
  if (thread_patch) plan.thread_patch = thread_patch;
  return plan;
}

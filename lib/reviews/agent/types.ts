import type { z } from "zod";
import type { Review, ReviewWindow } from "@/lib/firestore/schema";
import type { WorkCategory } from "@/lib/pipeline/categories";
import type { ReviewCheckRule } from "@/lib/reviews/agent/check";
import type { ReviewDraft } from "@/lib/reviews/agent/schema";
import type { Suggestion } from "@/lib/reviews/verdict";

/**
 * Shared types for the ReviewAgent (docs/tasks/review-agent-18oct.md §5.7). TYPES ONLY: no logic, no I/O, no
 * `@google/adk` import, so the checker, the tools, the runner and the service compile against one contract.
 */

/** One stored thread summary, scrubbed and cut at read time (D14). No thread id, device id, line or answer. */
export interface EvidenceSample {
  /** Outlet-local date (shown to the model only to order the notes; the narrative may not repeat it). */
  date: string;
  start_hm: string;
  category: WorkCategory;
  summary: string;
}

export interface ReviewAgentChange {
  version: number;
  change_title: string;
  kind: "modify" | "add";
  step_title: string;
  step_before: string | null;
  step_after: string;
  intervention: { id: string; label_en: string; definition: string };
  rationale: string;
  metric: {
    category: WorkCategory;
    category_label_en: string;
    direction: "decrease" | "increase";
    description: string;
    baseline_count: number;
    baseline_days: number;
  };
  failure_condition: string;
}

export interface ReviewAgentInputs {
  change: ReviewAgentChange;
  counts: { before: ReviewWindow; after: ReviewWindow; rule: { min_days: 2; threshold_pct: 20 } };
  sample: { before: EvidenceSample[]; after: EvidenceSample[] };
  notices: Review["notices"];
  /** For `check_review` ONLY; never put into a tool result (D13: the agent derives the verdict). */
  suggestion: Suggestion;
  /** The outlet's staff scrub names, for the checker's `staff_name` rule. Never sent to the model. */
  staffNames: readonly string[];
}

export type ReviewAgentWindowName = "change" | "counts" | "before" | "after";

export type ReviewAgentOutcome =
  | { kind: "accepted"; draft: ReviewDraft }
  | { kind: "rejected"; reasons: ReviewCheckRule[] }
  | { kind: "declined"; reason: "cannot_explain" | "insufficient_evidence" };

/** One per run; mutated by the tools, read by the runner and the service. */
export interface ReviewAgentSession {
  inspected: Set<ReviewAgentWindowName>;
  checkRounds: number;
  /** `ok` is false when the tool returned `{ error }`. */
  toolCalls: { name: string; ok: boolean }[];
  outcome: ReviewAgentOutcome | null;
}

export function newReviewAgentSession(): ReviewAgentSession {
  return { inspected: new Set(), checkRounds: 0, toolCalls: [], outcome: null };
}

/** Counts and enums only (hard rule 7): what a run did, never what it read or said. */
export interface ReviewTrace {
  model_calls: number;
  tool_calls: { name: string; ok: boolean }[];
  check_rounds: number;
  ms: number;
  ended_by: "decided" | "model_done" | "limit" | "timeout" | "error";
}

export interface ReviewToolSpec<P extends z.ZodObject<z.ZodRawShape>> {
  name: string;
  description: string;
  parameters: P;
  /** Sync or Promise; must never throw shop text. */
  execute: (input: z.infer<P>) => unknown;
}

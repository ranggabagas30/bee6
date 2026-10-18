import { z } from "zod";
import { DEBRIEF_QUESTION_MAX_CHARS, DEBRIEF_QUESTION_MIN_CHARS } from "@/lib/debrief/agent/constants";

/**
 * The DebriefAgent's structured output: the `check_question` tool's arguments ARE the output (no
 * `responseJsonSchema`, docs/tasks/debrief-agent-18oct.md §3.2). Length is counted in code points so an emoji or a
 * surrogate pair is one character, matching the wire schema and the checker.
 */
export const DebriefQuestionDraftSchema = z
  .object({
    question_en: z.string().refine(
      (s) => {
        const n = Array.from(s).length;
        return n >= DEBRIEF_QUESTION_MIN_CHARS && n <= DEBRIEF_QUESTION_MAX_CHARS;
      },
      { message: "question_en must be 20..140 code points" },
    ),
  })
  .strict();
export type DebriefQuestionDraft = z.infer<typeof DebriefQuestionDraftSchema>;

/** Hostile-input bound for the raw tool argument; the 20..140 rule is the checker's NAMED `too_short`/`too_long`. */
export const DEBRIEF_ARGS_MAX_CHARS = 1000;

/**
 * The `check_question` tool's PARAMETER schema (what ADK validates at call time, and the checker's
 * `schema_invalid`). Deliberately looser than `DebriefQuestionDraftSchema` on length: a draft of 12 or 200 characters
 * must reach `checkQuestion` so the model is told `too_short` / `too_long` and can fix it, instead of getting an
 * opaque zod error that does not count as a round. A draft that PASSES the checker always satisfies
 * `DebriefQuestionDraftSchema` too (the checker enforces 20..140 on the trimmed text).
 */
export const DebriefQuestionArgsSchema = z
  .object({
    question_en: z
      .string()
      .refine((s) => Array.from(s).length <= DEBRIEF_ARGS_MAX_CHARS, { message: "question_en is too long" }),
  })
  .strict();
export type DebriefQuestionArgs = z.infer<typeof DebriefQuestionArgsSchema>;

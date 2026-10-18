import { z } from "zod";
import { WorkCategorySchema } from "@/lib/pipeline/categories";
import { DEBRIEF_QUESTION_MAX_CHARS, DEBRIEF_QUESTION_MIN_CHARS } from "@/lib/debrief/agent/constants";
import {
  DEBRIEF_LIST_SERVER_CAP,
  QUESTION_LINE_MAX_CHARS,
  QUESTION_LINES_MAX,
  REASON_MAX_CHARS,
} from "@/lib/debrief/constants";

/**
 * Wire contracts for the debrief device routes (R-07; web spec §6.6.6,
 * technical spec §8.10/§8.11). `.strict()` everywhere so an extra field
 * (a staff id, a name, a device id, a chosen category) fails loudly instead
 * of silently round-tripping (hard rule #7).
 */

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const QuestionIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_:~.-]+$/);

/** `POST /api/v1/questions/{id}/answer` body (device). Exactly these five keys. */
export const AnswerBodySchema = z
  .object({
    question_id: QuestionIdSchema,
    debrief_business_date: dateString,
    answer: z.enum(["yes", "no"]),
    // Raw; the 500-code-point cap is enforced by `checkReason` after trim.
    // 20k only bounds parsing so a hostile body can't exhaust memory.
    reason: z.string().max(20_000),
    answered_at_ms: z.number().int().min(0),
  })
  .strict();
export type AnswerBody = z.infer<typeof AnswerBodySchema>;

/** One question on `GET /api/v1/questions` (device). Category is the raw enum code, never a label. */
export const DebriefQuestionViewSchema = z
  .object({
    question_id: QuestionIdSchema,
    kind: z.enum(["gate", "unlabelled_unit"]),
    category: WorkCategorySchema.nullable(),
    start_hm: z.string().regex(/^\d{2}:\d{2}$/),
    end_hm: z.string().regex(/^\d{2}:\d{2}$/),
    /**
     * R-18: the question window's business date, present ONLY on a demo sandbox outlet and only when it is strictly
     * before the debrief's own business date (a question carried over from an earlier day). Absent on every
     * pilot question, so a pilot response is unchanged.
     */
    business_date: dateString.optional(),
    /**
     * demo-feedback-2 item 10: present ONLY on a demo sandbox outlet, only on a `gate` question whose own thread
     * could be read, scoped to this device and outlet, and name-scrubbed at read time. At most two stored
     * (already Sensitive-Data-Protection-redacted) lines of that thread, each at most 160 code points. Absent on
     * every pilot question, on `unlabelled_unit`, and whenever any step above cannot be completed (fail closed).
     * Counted in code points (not UTF-16 units) so a line the server truncated can never fail this parse.
     */
    lines: z
      .array(
        z
          .string()
          .min(1)
          .refine((line) => Array.from(line).length <= QUESTION_LINE_MAX_CHARS, { message: "line too long" }),
      )
      .max(QUESTION_LINES_MAX)
      .optional(),
    /**
     * DebriefAgent (docs/tasks/debrief-agent-18oct.md §3.4), sandbox only: the agent-worded heading, 20..140 code
     * points, plain text. Absent on every pilot question, on `unlabelled_unit`, when the flag is off, when the agent
     * fell back, or when the stored wording no longer matches the question's category/time (D9). The phone renders
     * it as a text node and never stores it. READ LENIENTLY (step 3 risk review M3): a value that is not a 20..140
     * code point string is dropped (`.catch(undefined)`), so one bad wording keeps the template heading and never
     * fails the list. Everything else on this schema stays strict. BUNDLE SKEW: an older phone bundle (strict
     * parse, no such key) still fails on the key itself, the same accepted risk as `lines`/`preparing`; the phone
     * now shows that failure (`DebriefFlow` poll) instead of waiting silently.
     */
    question_text: z
      .string()
      .refine(
        (s) => {
          const n = Array.from(s).length;
          return n >= DEBRIEF_QUESTION_MIN_CHARS && n <= DEBRIEF_QUESTION_MAX_CHARS;
        },
        { message: "question_text length" },
      )
      .optional()
      .catch(undefined),
  })
  .strict();
export type DebriefQuestionView = z.infer<typeof DebriefQuestionViewSchema>;

export const DebriefListResponseSchema = z
  .object({
    debrief: z
      .object({ business_date: dateString, ends_at_ms: z.number().int().min(0) })
      .strict()
      .nullable(),
    questions: z.array(DebriefQuestionViewSchema).max(DEBRIEF_LIST_SERVER_CAP),
    /**
     * R-19 PR-3: present ONLY on a demo sandbox outlet while a debrief is active. `true` while the ended
     * session still has text lines no label unit has finished and End was under PREPARING_MAX_MS ago
     * (the phone shows "Preparing your questions"). Absent on every pilot response.
     */
    preparing: z.boolean().optional(),
  })
  .strict();
export type DebriefListResponse = z.infer<typeof DebriefListResponseSchema>;

export const AnswerResponseSchema = z
  .object({ status: z.enum(["answered", "already_answered"]) })
  .strict();
export type AnswerResponse = z.infer<typeof AnswerResponseSchema>;

/**
 * The phone's `bee6.debrief.answers` cache entry (technical spec §8.11). No
 * name, staff id, PIN, role or device id field — ever (hard rule #7); the
 * reason is 1 to 500 trimmed code points, required.
 */
export const AnswerCacheEntrySchema = z
  .object({
    question_id: QuestionIdSchema,
    debrief_business_date: dateString,
    answer: z.enum(["yes", "no"]),
    reason: z.string(),
    answered_at_ms: z.number().int().min(0),
  })
  .strict()
  .refine(
    (e) =>
      e.reason === e.reason.trim() &&
      Array.from(e.reason).length >= 1 &&
      Array.from(e.reason).length <= REASON_MAX_CHARS,
    { message: "reason out of range" },
  );
export type AnswerCacheEntry = z.infer<typeof AnswerCacheEntrySchema>;

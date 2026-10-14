import { z } from "zod";

/**
 * Body and response of `POST /api/v1/demo/session` (R-12 Task 6.1; web spec 6.2). The response
 * never carries an outlet id or a template id. A device id appears only in the `device` shape,
 * which goes to the judge's own browser (the sandbox's staff phone), never to an owner or
 * supervisor view.
 */
export const DemoRoleSchema = z.enum(["owner", "supervisor", "staff"]);
export type DemoRole = z.infer<typeof DemoRoleSchema>;

export const DemoSessionBodySchema = z
  .object({
    role: DemoRoleSchema,
    /** base64url of 32 random bytes; absent on the first call of a visit. */
    sandbox_key: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  })
  .strict();
export type DemoSessionBody = z.infer<typeof DemoSessionBodySchema>;

export const DemoSessionResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("web"),
      role: z.enum(["owner", "supervisor"]),
      custom_token: z.string().min(1),
      sandbox_key: z.string(),
      expires_at_ms: z.number().int(),
      landing_path: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("device"),
      role: z.literal("staff"),
      device_id: z.string(),
      device_token: z.string(),
      sandbox_key: z.string(),
      expires_at_ms: z.number().int(),
      landing_path: z.literal("/capture"),
    })
    .strict(),
]);
export type DemoSessionResponse = z.infer<typeof DemoSessionResponseSchema>;

// ── R-19 PR-0: contracts of the 3-day judge journey (docs/tasks/R-19-demo-v2.md section 2.3) ──────────────
// Types and zod schemas only; no route reads them yet. Every `/api/v1/demo/*` route is demo-project only:
// off a sandbox outlet it answers 404 before any other read, so none of the shapes below exists on the pilot.

/** Why "Jump to tomorrow" is refused (409 body `code`; also `demo_session.next_day.reason` on the capture config). */
export const NEXT_DAY_REFUSALS = [
  "session_open",
  "day_not_ended",
  "preparing",
  "unanswered_questions",
  "max_days",
  "proposal_exists",
  "shift_incomplete",
  "busy",
] as const;
export const NextDayRefusalSchema = z.enum(NEXT_DAY_REFUSALS);
export type NextDayRefusal = z.infer<typeof NextDayRefusalSchema>;

/** `demo_session.next_day`: whether the drawer may offer the jump and, when not, why. `allowed` is true exactly when there is no reason. */
export const DemoNextDayStatusSchema = z
  .object({ allowed: z.boolean(), reason: NextDayRefusalSchema.nullable() })
  .strict()
  .refine((n) => n.allowed === (n.reason === null), {
    message: "next_day.allowed must be true exactly when next_day.reason is null",
  });
export type DemoNextDayStatus = z.infer<typeof DemoNextDayStatusSchema>;

/** `demo_session.open_session`: the sandbox device's still-open session (null when none). Timestamps and ids only, no actor. */
export const DemoOpenSessionSchema = z
  .object({
    session_id: z.string().uuid(),
    started_at_ms: z.number().int().min(0),
    closing_reached: z.boolean(),
    auto_stop_at_ms: z.number().int().min(0),
  })
  .strict();
export type DemoOpenSession = z.infer<typeof DemoOpenSessionSchema>;

/** `POST /api/v1/demo/closing` (device, sandbox): "Jump to closing time". */
export const DemoClosingBodySchema = z.object({ session_id: z.string().uuid() }).strict();
export type DemoClosingBody = z.infer<typeof DemoClosingBodySchema>;
export const DemoClosingResponseSchema = z.object({ closing_reached: z.literal(true) }).strict();
export type DemoClosingResponse = z.infer<typeof DemoClosingResponseSchema>;
/** The two 409 bodies (`not_enough_speech {have, need}`, `session_not_open`): counts only, never a transcript. */
export const ClosingRefusalSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("not_enough_speech"), have: z.number().int().min(0), need: z.number().int().min(1) }).strict(),
  z.object({ code: z.literal("session_not_open") }).strict(),
]);
export type ClosingRefusal = z.infer<typeof ClosingRefusalSchema>;

/** `POST /api/v1/demo/next-day` (device, sandbox): "Jump to tomorrow". */
export const DemoNextDayBodySchema = z
  .object({
    /** The day the phone believes it is on (a stale value is answered idempotently by the server). */
    expected_day: z.union([z.literal(1), z.literal(2)]),
    confirm_unanswered: z.boolean(),
  })
  .strict();
export type DemoNextDayBody = z.infer<typeof DemoNextDayBodySchema>;
export const DemoNextDayResponseSchema = z.object({ day: z.union([z.literal(2), z.literal(3)]) }).strict();
export type DemoNextDayResponse = z.infer<typeof DemoNextDayResponseSchema>;
export const NextDayRefusalBodySchema = z
  .object({ code: NextDayRefusalSchema, unanswered: z.number().int().min(0).optional() })
  .strict();
export type NextDayRefusalBody = z.infer<typeof NextDayRefusalBodySchema>;

/** `POST /api/v1/demo/process-now` (device, sandbox; fast lane, Task D3): no body, no input from the client. */
export const DemoProcessNowBodySchema = z.object({}).strict();
export type DemoProcessNowBody = z.infer<typeof DemoProcessNowBodySchema>;
export const DemoProcessNowResponseSchema = z.object({ processed: z.number().int().min(0) }).strict();
export type DemoProcessNowResponse = z.infer<typeof DemoProcessNowResponseSchema>;

/** `GET /api/v1/demo/progress` (supervisor | owner, sandbox): counters that drive the judge guide. */
export const DemoProgressResponseSchema = z
  .object({
    day: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    days_done: z.number().int().min(0).max(3),
    proposals_with_content: z.number().int().min(0),
    feasible: z.number().int().min(0),
    owner_decided: z.number().int().min(0),
  })
  .strict();
export type DemoProgressResponse = z.infer<typeof DemoProgressResponseSchema>;

/** `POST /api/v1/demo/reset` (owner, sandbox): wipes the sandbox back to the template. */
export const DemoResetBodySchema = z.object({ confirm: z.literal("reset") }).strict();
export type DemoResetBody = z.infer<typeof DemoResetBodySchema>;
export const DemoResetResponseSchema = z.object({ reset: z.literal(true) }).strict();
export type DemoResetResponse = z.infer<typeof DemoResetResponseSchema>;

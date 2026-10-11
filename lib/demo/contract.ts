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

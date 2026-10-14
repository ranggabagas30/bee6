import { z } from "zod";
import { WorkCategorySchema } from "@/lib/pipeline/categories";

/**
 * R-19 PR-0: wire contracts of the non-demo routes the 3-day journey adds or extends (docs/tasks/R-19-demo-v2.md
 * section 2.3). They live here, not in the feature folders, so PR-0 alone owns them and the later PRs
 * (PR-1 watch panel, PR-8 owner Home, PR-10 connected devices) import them without touching each other's
 * files. Types and schemas only: no route reads them yet. Every object is strict.
 */

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ── GET /api/v1/proposals: `watch` (plan section 3.5, PR-1) ──────────────────────────────────────────────

/** One work category the plain code has seen at least once in the window. `need_dates` is the floor's date count. */
export const WatchRowSchema = z
  .object({
    category: WorkCategorySchema,
    facts: z.number().int().min(0),
    dates: z.number().int().min(0),
    need_dates: z.literal(2),
    state: z.enum(["ready", "needs_more", "proposed"]),
  })
  .strict();
export type WatchRow = z.infer<typeof WatchRowSchema>;

export const ProposalsWatchSchema = z
  .object({
    from_date: dateString,
    to_date: dateString,
    categories: z.array(WatchRowSchema),
  })
  .strict();
export type ProposalsWatch = z.infer<typeof ProposalsWatchSchema>;

// ── GET /api/v1/home additions (plan section 9.2, PR-8) ──────────────────────────────────────────────────

/** Proposals the supervisor marked feasible that the owner decided, in one window. */
export const TallySchema = z
  .object({ approved: z.number().int().min(0), rejected: z.number().int().min(0) })
  .strict();
export type Tally = z.infer<typeof TallySchema>;

export const HOME_WAITING_MAX = 5;

/** The three keys PR-8 adds to the owner Home response. Titles are the stored, already redacted `change_title`. */
export const HomeR19ExtensionSchema = z
  .object({
    progress: z.object({ week: TallySchema, month: TallySchema, since_start: TallySchema }).strict(),
    waiting_approval: z
      .object({
        count: z.number().int().min(0),
        items: z
          .array(z.object({ proposal_id: z.string().uuid(), change_title: z.string().min(1) }).strict())
          .max(HOME_WAITING_MAX),
      })
      .strict(),
    next_review: z.object({ date: dateString.nullable(), change_title: z.string().min(1).nullable() }).strict(),
  })
  .strict();
export type HomeR19Extension = z.infer<typeof HomeR19ExtensionSchema>;

// ── Connected devices (plan section 9.3, PR-10). Hard rule #7: no device id, token, code or person. ──────

export const DeviceRowSchema = z
  .object({
    label: z.string().min(1),
    paired: z.boolean(),
    paired_on: z.string().min(1).nullable(),
    last_seen_ms: z.number().int().min(0).nullable(),
    listening: z.boolean(),
  })
  .strict();
export type DeviceRow = z.infer<typeof DeviceRowSchema>;

/** `GET /api/v1/devices` (supervisor | owner). */
export const DevicesResponseSchema = z.object({ devices: z.array(DeviceRowSchema) }).strict();
export type DevicesResponse = z.infer<typeof DevicesResponseSchema>;

/** `POST /api/v1/devices/pairing-code` (supervisor | owner): no input from the client. */
export const PairingCodeBodySchema = z.object({}).strict();
export type PairingCodeBody = z.infer<typeof PairingCodeBodySchema>;
export const PairingCodeResponseSchema = z
  .object({ code: z.string().regex(/^\d{6}$/), expires_at_ms: z.number().int().min(0) })
  .strict();
export type PairingCodeResponse = z.infer<typeof PairingCodeResponseSchema>;

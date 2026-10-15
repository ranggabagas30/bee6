import { z } from "zod";
import { dateString, DayStatusSchema, hm } from "@/lib/day/contract";
import { HomeR19ExtensionSchema } from "@/lib/contracts/r19";
import { WorkCategorySchema } from "@/lib/pipeline/categories";

/**
 * Owner home API contract (web spec §4.4; R-06 Task 14a). "Today in 5 lines
 * (summaries only)" was the only slice with data until R-19 PR-8 (plan 9.2,
 * W6) added the strict extension from `lib/contracts/r19.ts`: `progress`
 * (feasible-and-decided tallies per window), `waiting_approval` (the
 * `awaiting_owner` list, titles only) and `next_review`. The home has no
 * cost field: "Cost per outlet · coming soon" is a UI placeholder, never a
 * number this contract could carry.
 */

export const HOME_LINES = 5;

export const HomeLineSchema = z
  .object({
    start_hm: hm,
    category: WorkCategorySchema,
    summary: z.string(),
  })
  .strict();

export const HomeResponseSchema = z
  .object({
    today: dateString, // business date (before 01:00 = the previous day)
    day_status: DayStatusSchema,
    fact_count: z.number().int().min(0),
    lines: z.array(HomeLineSchema).max(HOME_LINES),
    more: z.number().int().min(0), // facts not in `lines`
    ...HomeR19ExtensionSchema.shape, // R-19 PR-8: progress, waiting_approval, next_review
  })
  .strict();

export type HomeLine = z.infer<typeof HomeLineSchema>;
export type HomeResponse = z.infer<typeof HomeResponseSchema>;

import { z } from "zod";
import { dateString, DayStatusSchema, hm } from "@/lib/day/contract";
import { WorkCategorySchema } from "@/lib/pipeline/categories";

/**
 * Owner home API contract (web spec §4.4; R-06 Task 14a). "Today in 5 lines
 * (summaries only)" is the only slice with data today (§0 item 8); the
 * proposals-waiting (14b) and review-dates (14c) tiles are added later as a
 * strict extension of `HomeResponseSchema`, never guessed here. The home has
 * no cost-per-day tile (Rangga, v4 Q-F: next MVP) — no placeholder field for
 * one either.
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
  })
  .strict();

export type HomeLine = z.infer<typeof HomeLineSchema>;
export type HomeResponse = z.infer<typeof HomeResponseSchema>;

import { addDays } from "@/lib/capture/calendar";

/** `review_date = addDays(today, days)` (the model picks `days` between 7 and 28). */
export function reviewDate(today: string, days: number): string {
  return addDays(today, days);
}

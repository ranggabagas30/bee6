import { weekdayOf } from "@/lib/capture/calendar";
import type { Lang } from "@/lib/i18n/lang";
import type { Weekday } from "@/lib/firestore/schema";

/**
 * Written-out dates and clock times for the shop-phone copy (UX-03 section 6, 4.10).
 * Day and month names are the copy sheet's short forms: "Fri 16 Oct" in EN,
 * "Jum 16 Okt" in ID. Times are 24-hour HH:MM in the shop's zone.
 */

const DAY_SHORT: Record<Lang, Record<Weekday, string>> = {
  en: { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" },
  id: { sun: "Min", mon: "Sen", tue: "Sel", wed: "Rab", thu: "Kam", fri: "Jum", sat: "Sab" },
};

const MONTH_SHORT: Record<Lang, readonly string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  id: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"],
};

/** "Fri 16 Oct" (en) or "Jum 16 Okt" (id) for a "YYYY-MM-DD" business date. */
export function dayLabel(localDate: string, lang: Lang): string {
  const [, m, d] = localDate.split("-").map(Number);
  const month = MONTH_SHORT[lang][(m ?? 1) - 1] ?? "";
  return `${DAY_SHORT[lang][weekdayOf(localDate)]} ${d ?? 1} ${month}`;
}

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

/** HH:MM (24-hour) of `ms` on the shop's wall clock in `tz`. */
export function clockLabel(ms: number, tz: string): string {
  let fmt = clockFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    clockFormatters.set(tz, fmt);
  }
  return fmt.format(ms);
}

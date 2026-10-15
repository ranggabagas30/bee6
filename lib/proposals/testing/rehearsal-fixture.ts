import { zonedTimeToEpochMs } from "@/lib/capture/calendar";
import type { ProposalThreadRow } from "@/lib/proposals/candidates";

/**
 * R-20 PR-A fixture: the stored summaries and line texts of the 15 Oct live rehearsal
 * (docs/tasks/QA-live-rehearsal-15oct.md §2, §5), all fictional demo speech. Problem A = the
 * staff cannot say when the egg tarts were baked (no bake time on the tray); problem B = a phone
 * order not read back to the caller. `weakCs*` = two unrelated customer-service facts on two
 * dates, the control that must still decline. Test and eval use only. No audio, no real data.
 */

export const REHEARSAL_TZ = "Asia/Jakarta";
export const REHEARSAL_OUTLET_ID = "o1";
export const REHEARSAL_DEVICE_ID = "dev-SENTINEL-77";

function row(
  n: string,
  date: string,
  hm: string,
  category: ProposalThreadRow["category"],
  summary: string,
  lines: string[],
  fields?: Record<string, unknown>,
): ProposalThreadRow {
  return {
    outlet_id: REHEARSAL_OUTLET_ID,
    thread_id: `unit_${REHEARSAL_DEVICE_ID}_w${n}:0`,
    device_id: REHEARSAL_DEVICE_ID,
    category,
    status: "fact",
    first_line_start_ms: zonedTimeToEpochMs(date, hm, REHEARSAL_TZ),
    summary,
    ...(fields ? { fields } : {}),
    lines: lines.map((text) => ({ text })),
  };
}

export const csDay1 = row(
  "cs1",
  "2026-10-13",
  "20:12",
  "CUSTOMER_SERVICE",
  "Customer asking about freshness of egg tarts and making a purchase.",
  [
    "Excuse me, are these egg tarts fresh today? When were they baked?",
    "I am not sure when this tray was baked, because nobody writes the baking time on the tray...",
    "Okay, that is fine. I will take two, please.",
  ],
  { sale: true },
);

export const csDay2 = row(
  "cs2",
  "2026-10-14",
  "20:20",
  "CUSTOMER_SERVICE",
  "Customer asking about egg tart freshness and making a purchase.",
  [
    "Hi, is this egg tart from today? How fresh is it?",
    "Sorry, I do not know exactly when it was baked. Nobody wrote the baking time on the tray.",
  ],
  { sale: true },
);

export const phoneDay2 = row(
  "ph2",
  "2026-10-14",
  "20:21",
  "PHONE_CALL",
  "Phone call for a large pre-order of egg tarts.",
  ["Yes, 50 egg tarts for tomorrow morning, pick up at 10:00. Okay, got it. Thank you. Bye."],
);

export const phoneDay3 = row(
  "ph3",
  "2026-10-15",
  "20:38",
  "PHONE_CALL",
  "Phone call taking an order for a birthday cake and croissants",
  [
    "A birthday cake and 20 croissants for Saturday. Pick up at three or four? Sorry, the phone line is bad. Okay, 4:00. Bye.",
    "I hung up without reading the order back to the caller. I hope I got the time right.",
  ],
);

/** The staff's "yes" debrief reasons for the two phone facts, keyed by thread_id (corrections.reason_text). */
export const phoneReasons: ReadonlyMap<string, string> = new Map([
  [phoneDay2.thread_id, "I did not read the order back to the caller."],
  [phoneDay3.thread_id, "Hung up without reading the order back, not sure of the pickup time."],
]);

export const weakCs1 = row("wk1", "2026-10-13", "10:00", "CUSTOMER_SERVICE", "Customer bought two croissants.", [
  "Two croissants, please.",
  "Here you go, thank you.",
]);

export const weakCs2 = row("wk2", "2026-10-14", "10:00", "CUSTOMER_SERVICE", "Customer asked for a paper bag.", [
  "Can I have a paper bag?",
  "Sure, here you are.",
]);

/** Problem A and B facts together (what the supervisor's Ask sees after day 3), oldest first. */
export const problemRows: ProposalThreadRow[] = [csDay1, csDay2, phoneDay2, phoneDay3];

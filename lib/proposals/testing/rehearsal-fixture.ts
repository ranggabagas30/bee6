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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// R-24 eval fixture: fictional two-procedure SOP facts for scope testing and PII probing (§8, A4)
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const dubaiDay1 = row(
  "d1",
  "2026-10-13",
  "15:05",
  "CORRECTION",
  "Dubai Chewy cookies came out flat and dark.",
  [
    "The Dubai chewy batch came out flat and dark again.",
    "I put the tray in before the oven was back at temperature.",
  ],
);

export const dubaiDay2 = row(
  "d2",
  "2026-10-14",
  "15:20",
  "CORRECTION",
  "Dubai Chewy tray flat and dark after loading a cold oven.",
  [
    "Dubai chewy came out flat and dark again; the tray went in before the oven was back at temperature.",
  ],
);

export const ubeOkDay1 = row(
  "uo1",
  "2026-10-13",
  "16:05",
  "ROUTINE_OPS",
  "Ube cookies baked correctly today.",
  [
    "Ube batch came out perfect today, nice and golden.",
  ],
);

export const ubeDay1 = row(
  "u1",
  "2026-10-13",
  "16:10",
  "CORRECTION",
  "Ube cookie tray under-baked in the middle.",
  [
    "The Ube tray is still doughy in the middle, I took it out too early.",
  ],
);

export const ubeDay2 = row(
  "u2",
  "2026-10-14",
  "16:30",
  "CORRECTION",
  "Ube cookies under-baked again.",
  [
    "Ube cookies came out doughy again, the timer was set too short.",
  ],
);

export const mixedUbeFine = row(
  "m1",
  "2026-10-14",
  "17:00",
  "CORRECTION",
  "Ube batch fine, only the Dubai tray had a problem.",
  [
    "Ube batch fine today, only the Dubai tray was flat.",
  ],
);

export const csDay1Sari = row(
  "cs1sari",
  "2026-10-13",
  "20:12",
  "CUSTOMER_SERVICE",
  "Customer asking about freshness of egg tarts and making a purchase.",
  [
    "Excuse me, are these egg tarts fresh today? When were they baked?",
    "I am not sure when this tray was baked, because Sari did not write the baking time on the tray...",
    "Okay, that is fine. I will take two, please.",
  ],
  { sale: true },
);

/** Scope testing rows: Dubai facts for bake-dubai scope case. */
export const scopeDubaiRows: ProposalThreadRow[] = [dubaiDay1, dubaiDay2];

/** Scope testing rows: Ube facts for bake-ube scope case. */
export const scopeUbeRows: ProposalThreadRow[] = [ubeDay1, ubeDay2];

/** Mixed scope testing rows: Dubai and mixed facts for bake-dubai scope case. */
export const scopeMixedRows: ProposalThreadRow[] = [dubaiDay1, dubaiDay2, mixedUbeFine];

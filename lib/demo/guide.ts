import { z } from "zod";
import { t } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";

/**
 * R-19 PR-5 judge guide data model (docs/tasks/R-19-demo-v2.md section 7.1). Pure, zod-validated at module load.
 * No tabs: ONE contextual card per screen and state (`guideKeyFor`), inside a guide collapsed by default. The
 * 5-stage journey (`currentStage`) comes from the sandbox counters (phone: `demo_session`; web:
 * GET /api/v1/demo/progress) plus the local "supervisor visited" flag.
 *
 * Where the demo facts live: ONLY here. The entry card says what Bee6 is, "about 20 minutes", and how to change
 * role; the pair card fills the demo code (rendered from lib/demo/credentials by the component through the
 * `{code}` placeholder; the literal never sits in copy, see app/demo/import-boundaries.test.ts). EN is final; the
 * Bahasa column is PROVISIONAL (EN until Tiffany). Nothing here is read by server code (hard rule #10).
 */

const Bilingual = z.object({ en: z.string().min(1).max(240), id: z.string().min(1).max(240) }).strict();
export type Bilingual = z.infer<typeof Bilingual>;

/** ID = EN copy, PROVISIONAL until Tiffany reviews the Bahasa column. */
const same = (en: string): Bilingual => ({ en, id: en });

export const STAGE_IDS = ["staff_day1", "supervisor_look", "staff_days23", "supervisor_decide", "owner_approve"] as const;
export type StageId = (typeof STAGE_IDS)[number];

export const STAGES: readonly { id: StageId; title: Bilingual }[] = z
  .array(z.object({ id: z.enum(STAGE_IDS), title: Bilingual }).strict())
  .length(STAGE_IDS.length)
  .parse([
    { id: "staff_day1", title: { en: "Staff · day 1", id: "Staf · hari 1" } },
    { id: "supervisor_look", title: { en: "Supervisor · look around", id: "Supervisor · lihat-lihat" } },
    { id: "staff_days23", title: { en: "Staff · days 2-3", id: "Staf · hari 2-3" } },
    { id: "supervisor_decide", title: { en: "Supervisor · decide", id: "Supervisor · putuskan" } },
    { id: "owner_approve", title: { en: "Owner · approve", id: "Pemilik · setujui" } },
  ]);

/** Every screen/state that has its own guide card (page-2 boards in the plan's section 11a). */
export const GUIDE_KEYS = [
  "entry",
  "pair",
  "capture_ready",
  "capture_listening",
  "capture_all_spoken",
  "capture_closing",
  "capture_open_session",
  "debrief_preparing",
  "debrief_question",
  "debrief_done",
  "day",
  "proposals_waiting",
  "proposals_ready",
  "proposals_generating",
  "proposal_detail",
  "proposals_feasible",
  "sop",
  "reviews",
  "devices",
  "home",
  "approvals",
  "approvals_done",
] as const;
export type GuideKey = (typeof GUIDE_KEYS)[number];

export const GuideActionSchema = z.discriminatedUnion("kind", [
  /** pair: "Fill in {code}" fills the field (does not submit). */
  z.object({ kind: z.literal("fill_demo_code") }).strict(),
  /** listening: the card body is the active script card (plan 5.3). */
  z.object({ kind: z.literal("script_card") }).strict(),
  /** all spoken: POST /api/v1/demo/closing. */
  z.object({ kind: z.literal("jump_closing") }).strict(),
  /** debrief: POST /api/v1/demo/next-day (plan section 4). */
  z.object({ kind: z.literal("jump_tomorrow") }).strict(),
  /** owner home: the reset dialog, registered by PR-7 (app/demo/guide-controls.tsx). */
  z.object({ kind: z.literal("reset_demo") }).strict(),
]);
export type GuideAction = z.infer<typeof GuideActionSchema>;

export const GuideCardSchema = z
  .object({
    title: Bilingual,
    body: z.array(Bilingual).max(3),
    action: GuideActionSchema.nullable(),
    footnote: Bilingual.nullable(),
  })
  .strict();
export type GuideCard = z.infer<typeof GuideCardSchema>;

const card = (title: string, body: string[], action: GuideAction | null = null, footnote: string | null = null): GuideCard => ({
  title: same(title),
  body: body.map(same),
  action,
  footnote: footnote === null ? null : same(footnote),
});

export const GUIDE: Readonly<Record<GuideKey, GuideCard>> = z
  .object(Object.fromEntries(GUIDE_KEYS.map((k) => [k, GuideCardSchema])) as Record<GuideKey, typeof GuideCardSchema>)
  .strict()
  .parse({
    entry: card(
      "Welcome, judge",
      [
        "Bee6 listens to a small shop's day on a paired phone and turns speech into short work notes. Audio is never stored.",
        "You play all three roles: Staff first (3 short days), then Supervisor, then Owner. About 20 minutes.",
        "Use one browser for the whole demo.",
      ],
      null,
      "To change role later: sign out, then pick again.",
    ),
    pair: card(
      "Set up the staff phone",
      ["This demo phone pairs with the demo code. Tap Fill in {code}, then Set up.", "Keep this page open and allow the microphone when asked."],
      { kind: "fill_demo_code" },
    ),
    capture_ready: card("Tap Start, then read the cards", [
      "Tap Start. The guide then shows one script card at a time.",
      "Read each card aloud and play every voice. The speaker tag is not spoken.",
      "After the 5 cards, Jump to closing time unlocks End.",
    ]),
    capture_listening: card("Read this card aloud", [], { kind: "script_card" }),
    capture_all_spoken: card("All 5 cards are spoken", ["Jump to closing time, then tap End today on the screen to start the debrief."], {
      kind: "jump_closing",
    }),
    capture_closing: card("Tap End today", ["Closing time is reached. Tap End today on the screen; the debrief starts at once."]),
    capture_open_session: card("Today's session is still open", [
      "Tap End today to start the debrief, or Cancel today if the session was interrupted before closing time.",
    ]),
    debrief_preparing: card("Preparing your questions", [
      "Bee6 is reading today's notes to decide what to ask. Keep this page open and the screen on.",
      "While you wait, you can open the Supervisor screens in another tab.",
    ]),
    debrief_question: card(
      "Answer what really happened",
      [
        "Answer what really happened in today's script. The phone order did happen, so answer Yes and type a few words why (for example: took a big order on the phone).",
        "Answering does not end the debrief. It ends when every question is answered or the 60 minutes are over.",
        "When your questions are answered, jump to tomorrow to run the next day.",
      ],
      { kind: "jump_tomorrow" },
    ),
    debrief_done: card("Today is done", ["Jump to tomorrow to run the next day. After day 3, sign out and continue as Supervisor."], {
      kind: "jump_tomorrow",
    }),
    day: card("The day record", [
      "Each card is a work moment Bee6 heard, with its category. Open one to confirm or change the label.",
      "Look for the fresh egg tarts question under Customer service and the phone order under Phone call.",
    ]),
    proposals_waiting: card("Waiting for evidence", [
      "Bee6 proposes a change only when the same problem shows on at least 2 days.",
      "Run the next day as Staff (sign out, pair again, Jump to tomorrow), then come back here.",
    ]),
    proposals_ready: card("Ask Bee6 for a proposal", [
      "Evidence is ready. Tap Ask Bee6: it writes one proposal for one problem at a time.",
      "Ask for another to get the next one. Once a proposal exists, the demo days can't be run again.",
    ]),
    proposals_generating: card("Asking Bee6", ["Keep this page open. The proposal appears in about a minute."]),
    proposal_detail: card("Check each proposal", [
      "Read the evidence and the new wording. Mark it feasible so the Owner can approve it, or reject it with a reason.",
      "Do the same for every proposal listed.",
    ]),
    proposals_feasible: card("Over to the Owner", ["Every proposal is marked feasible. Sign out and sign in as Owner to approve or reject."]),
    sop: card("The shop's SOP", [
      "Versions are listed by date. An approved proposal ships as a new version with the improved step marked.",
    ]),
    reviews: card("Reviews", ["An approved change gets a review date. It appears here when that date comes."]),
    devices: card("Connected devices", ["The staff phone pairs with a code from here. No device ids are shown."]),
    home: card("Owner home", ["Your progress and what waits for your approval. Open Approvals to decide."], { kind: "reset_demo" }),
    approvals: card("Approve one, reject the other", [
      "Review each proposal in order. Approve the one you would ship and reject the other with a reason.",
      "After the first approval the SOP changes, so the remaining one can only be rejected.",
    ]),
    approvals_done: card("All decided", [
      "The approved change is now a new SOP version. Open SOP to see the improved step, and Reviews for its review date.",
    ]),
  });

/** What the page knows about the device's still-open server session (`profile.open_session`), for its one card. */
export interface GuideCardContext {
  /** Set only for `capture_open_session`: true when the open session is past closing time (the page offers End today), false otherwise (Cancel today). */
  openClosingReached?: boolean;
}

/**
 * The card for a key on a given demo day. A few cards read differently by day: day 1 has no phone-order script
 * card, and after day 1 the stage list sends the judge to the Supervisor screens (stage 2) before day 2; day 3 is
 * the last day, so its debrief cards never offer "jump to tomorrow" (the guide shows the max_days line instead).
 * The open-session card follows the page's own view (`OpenSessionView`): End today when closing is reached,
 * Cancel today otherwise. Every other key, and an unknown day (`null`), returns the base `GUIDE` card.
 */
export function guideCard(key: GuideKey, day: number | null, ctx: GuideCardContext = {}): GuideCard {
  const base = GUIDE[key];
  if (key === "capture_open_session" && ctx.openClosingReached !== undefined) {
    return GuideCardSchema.parse(
      ctx.openClosingReached
        ? { ...base, title: same("Tap End today"), body: [same("Today's session is still open and closing time has passed. Tap End today on the screen to start the debrief.")] }
        : { ...base, title: same("Today's session was interrupted"), body: [same("The session stopped before closing time. Tap Cancel today on the screen, then Start today again.")] },
    );
  }
  if (day === 1 && key === "debrief_question") {
    return GuideCardSchema.parse({
      ...base,
      body: [
        same("Answer what really happened in today's script. Where a question asks why, type a few words."),
        base.body[1]!,
        base.body[2]!,
      ],
    });
  }
  if (day === 3 && key === "debrief_question") {
    return GuideCardSchema.parse({
      ...base,
      body: [base.body[0]!, base.body[1]!, same("When your questions are answered, sign out and continue as Supervisor.")],
    });
  }
  if (day === 1 && key === "debrief_done") {
    return GuideCardSchema.parse({
      ...base,
      body: [
        same("Jump to tomorrow to run the next day."),
        same("After day 1, you can sign out and look around as Supervisor first (Proposals says Waiting for evidence), then pair again and jump to tomorrow."),
      ],
    });
  }
  if (day === 3 && key === "debrief_done") {
    return GuideCardSchema.parse({ ...base, body: [same("That was the last of the 3 demo days. Next, sign out and continue as Supervisor.")] });
  }
  return base;
}

export interface JourneyProgress {
  day: 1 | 2 | 3;
  days_done: number;
  proposals_with_content: number;
  feasible: number;
  owner_decided: number;
  /** localStorage `bee6.guide.sup_seen`, set when any supervisor page mounts. */
  supervisor_visited: boolean;
}

/** Exact rule of plan 7.1. */
export function currentStage(p: JourneyProgress): StageId {
  if (p.days_done < 1) return "staff_day1";
  if (p.days_done === 1 && !p.supervisor_visited) return "supervisor_look";
  if (p.days_done < 3 && p.proposals_with_content === 0) return "staff_days23";
  if (p.proposals_with_content === 0 || p.feasible < p.proposals_with_content) return "supervisor_decide";
  return "owner_approve";
}

export function stageIndex(stage: StageId): number {
  return STAGE_IDS.indexOf(stage);
}

/** What the staff phone reports (the capture page publishes it through app/demo/guide-bridge.ts). */
export type CapturePhase =
  | "ready"
  | "listening"
  | "all_spoken"
  | "closing"
  | "open_session"
  | "debrief_preparing"
  | "debrief_question"
  | "debrief_done";

export interface CaptureGuideState {
  kind: "capture";
  phase: CapturePhase;
}

export interface WebGuideState {
  kind: "web";
  role: "supervisor" | "owner";
  /** GET /api/v1/demo/progress; null until it loads (the default card is shown). */
  progress: JourneyProgress | null;
  /** A screen the proposals page reports itself (PR-12a); it wins over the counters. */
  screen?: "generating" | "detail" | "feasible" | null;
}

export type GuideState = CaptureGuideState | WebGuideState;

const CAPTURE_KEY: Record<CapturePhase, GuideKey> = {
  ready: "capture_ready",
  listening: "capture_listening",
  all_spoken: "capture_all_spoken",
  closing: "capture_closing",
  open_session: "capture_open_session",
  debrief_preparing: "debrief_preparing",
  debrief_question: "debrief_question",
  debrief_done: "debrief_done",
};

function proposalsKey(state: WebGuideState): GuideKey {
  const p = state.progress;
  if (state.role === "owner") {
    return p !== null && p.proposals_with_content > 0 && p.owner_decided >= p.proposals_with_content ? "approvals_done" : "approvals";
  }
  if (state.screen === "generating") return "proposals_generating";
  if (state.screen === "detail") return "proposal_detail";
  if (state.screen === "feasible") return "proposals_feasible";
  if (p === null) return "proposals_waiting";
  if (p.proposals_with_content > 0) return p.feasible >= p.proposals_with_content ? "proposals_feasible" : "proposal_detail";
  return p.days_done >= 2 ? "proposals_ready" : "proposals_waiting";
}

/** Pure, table-tested: the ONE card for a route and the page's reported state. */
export function guideKeyFor(route: string, state: GuideState | null): GuideKey {
  const path = route.split("?")[0] ?? "";
  const seg = path.split("/").filter(Boolean)[0] ?? "";
  if (seg === "") return "entry";
  if (seg === "sign-in") return "entry";
  if (seg === "pair") return "pair";
  if (seg === "capture") return state?.kind === "capture" ? CAPTURE_KEY[state.phase] : "capture_ready";
  const web = state?.kind === "web" ? state : null;
  switch (seg) {
    case "day":
    case "questions":
      return "day";
    case "proposals":
      return web ? proposalsKey(web) : "proposals_waiting";
    case "sop":
      return "sop";
    case "reviews":
      return "reviews";
    case "devices":
      return "devices";
    case "home":
      return "home";
    default:
      return "entry";
  }
}

// ── script card state (plan 5.3-5.4) ────────────────────────────────────────────────────────────────────────

/** Transcribed lines Bee6 must have heard on the active card before "I have spoken this" enables (speech, not time). */
export const CARD_MIN_LINES_TO_MARK = 1;

export interface CardStateInput {
  cards: readonly { id: string }[];
  /** Card ids already marked spoken (sessionStorage `bee6.script.{session_id}`); junk ids are ignored. */
  spoken: readonly string[];
  /** `segment_accepted` line counts since the active card was shown. */
  linesSinceCardShown: number;
}

export interface CardState {
  /** The active card (the first unspoken one; the last card once all are spoken). */
  index: number;
  total: number;
  allSpoken: boolean;
  canMarkSpoken: boolean;
}

export function cardState(input: CardStateInput): CardState {
  const total = input.cards.length;
  const spoken = new Set(input.spoken);
  const index = input.cards.findIndex((c) => !spoken.has(c.id));
  const allSpoken = index === -1;
  return {
    index: allSpoken ? Math.max(0, total - 1) : index,
    total,
    allSpoken,
    canMarkSpoken: !allSpoken && input.linesSinceCardShown >= CARD_MIN_LINES_TO_MARK,
  };
}

/** Exact W4 string: "Locked until all N cards are spoken (k of N done)." */
export function jumpLockText(lang: Lang, k: number, total: number): string {
  return t(lang, "C-journey-jump-locked", { k, total });
}

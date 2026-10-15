import { z } from "zod";

/**
 * R-19 demo script `bakery-v2` (docs/tasks/R-19-demo-v2.md sections 5.1 and A.2-A.4): pure data plus a strict
 * schema. Shown ONE card at a time in the judge guide on a sandbox staff phone (server field
 * `demo_session.script_id`). Fictional (hard rule #8), no person's name, no phone number, no price (hard rule #7).
 *
 * The judge reads every card word for word and plays every voice; the speaker tag is never spoken. Problem A
 * (fresh egg tarts, the staff member is not sure when they were baked) is cards d1-c3 and d2-c2; problem B (a
 * phone order not read back to the caller) is cards d2-c3 and d3-c2. Every other card is routine.
 *
 * `problem` is a QA/guide reference only. It is never shown and no server code reads it: the evidence gate stays
 * the only judge of what becomes a fact (hard rule #10).
 *
 * EN is final for the demo. The Bahasa column is PROVISIONAL (= the EN text until Tiffany supplies it); the guide
 * shows a "Bahasa coming soon" note in ID mode.
 *
 * KEEP IN SYNC with `scripts/eval-fixtures/scenario-v2.ts` (the `exact` variant is this text with the tags
 * stripped); `lib/demo/script.test.ts` asserts the two are equal.
 */

const Bilingual = (max: number) => z.object({ en: z.string().min(1).max(max), id: z.string().min(1).max(max) }).strict();

export const ScriptSpeakerSchema = z.enum(["staff", "customer", "caller"]);
export type ScriptSpeaker = z.infer<typeof ScriptSpeakerSchema>;

export const ScriptCardV2Schema = z
  .object({
    id: z.string().regex(/^d[1-3]-[a-z0-9-]{1,24}$/),
    title: Bilingual(60),
    lines: z.array(z.object({ speaker: ScriptSpeakerSchema, text: Bilingual(240) }).strict()).min(1).max(6),
    problem: z.enum(["A", "B"]).nullable(),
  })
  .strict();
export type ScriptCardV2 = z.infer<typeof ScriptCardV2Schema>;

export type ScriptDay = 1 | 2 | 3;

/** Every day has exactly this many cards (schema refine below). */
export const CARDS_PER_DAY = 5;
/** Transcribed lines Bee6 must have heard on a card before "I have spoken this" enables (speech, never time). */
export const CARD_MIN_LINES = 1;

const DaySchema = z.array(ScriptCardV2Schema).length(CARDS_PER_DAY);

/** ID = EN copy, PROVISIONAL until Tiffany reviews the Bahasa column. */
const same = (en: string) => ({ en, id: en });

type Line = ScriptCardV2["lines"][number];
const staff = (en: string): Line => ({ speaker: "staff", text: same(en) });
const customer = (en: string): Line => ({ speaker: "customer", text: same(en) });

const DAY_1: readonly ScriptCardV2[] = DaySchema.parse([
  {
    id: "d1-c1",
    title: same("Opening"),
    lines: [
      staff(
        "Good morning. I am opening the shop now. The oven is on and the display lights are on. I counted the cash in the till and it matches the float.",
      ),
    ],
    problem: null,
  },
  {
    id: "d1-c2",
    title: same("First bake"),
    lines: [staff("The first tray of egg tarts is out of the oven. I am putting them on the display now. The croissants go in next.")],
    problem: null,
  },
  {
    id: "d1-c3",
    title: same("A customer at the display"),
    lines: [
      customer("Excuse me, I have a question about the egg tarts on the display. Are they fresh today, and do you know what time they were baked?"),
      staff("I am not sure when this tray was baked, because nobody writes the baking time on the tray. I think it was this morning, but I cannot say for sure."),
      customer("Okay, no problem, I will take two anyway."),
    ],
    problem: "A",
  },
  {
    id: "d1-c4",
    title: same("Display check"),
    lines: [staff("Display check. The cinnamon rolls are running low, so I am refilling them now. Everything else on the display is full.")],
    problem: null,
  },
  {
    id: "d1-c5",
    title: same("Closing"),
    lines: [staff("We are closing now. I counted the till, I cleaned the oven, and I wrote the leftover bread in the log.")],
    problem: null,
  },
]);

const DAY_2: readonly ScriptCardV2[] = DaySchema.parse([
  {
    id: "d2-c1",
    title: same("Opening"),
    lines: [staff("Morning. Oven on, display lights on. The cash in the till is counted and correct.")],
    problem: null,
  },
  {
    id: "d2-c2",
    title: same("A customer at the counter"),
    lines: [
      customer("Hi there. I would like to ask about this egg tart before I buy it. Is it from today, and do you know what time it was baked?"),
      staff("Sorry, I do not know exactly when it was baked. Nobody wrote the baking time on the tray, so I can only guess that it was this morning."),
      customer("Alright, that is fine, I will have one anyway."),
    ],
    problem: "A",
  },
  {
    // Rewrite round 2 (15 Oct, R-20): combined first two lines, problem now explicit in first staff line.
    id: "d2-c3",
    title: same("A phone order"),
    lines: [
      staff("Hello, Demo Bakery, thanks for calling. Yes, we can do fifty egg tarts for tomorrow morning, pickup at ten o'clock. Okay, got it. Thank you, bye."),
      staff("That was a phone order for tomorrow. I did not read the order back to the caller before hanging up, so I am not sure the quantity and the pickup time are right."),
    ],
    problem: "B",
  },
  {
    id: "d2-c4",
    title: same("Display check"),
    lines: [staff("Display check. The croissants are almost gone, I am putting out a new tray. The rest is full.")],
    problem: null,
  },
  {
    id: "d2-c5",
    title: same("Closing"),
    lines: [staff("Closing time. Till counted, oven cleaned, leftover bread logged.")],
    problem: null,
  },
]);

const DAY_3: readonly ScriptCardV2[] = DaySchema.parse([
  {
    id: "d3-c1",
    title: same("Opening"),
    lines: [staff("Good morning. The oven is on, the display lights are on, and the float in the till is correct.")],
    problem: null,
  },
  {
    // Rewrite round 2 (15 Oct, R-20): combined first two lines, problem now explicit in first staff line.
    id: "d3-c2",
    title: same("Another phone order"),
    lines: [
      staff("Hello, Demo Bakery, thanks for calling. A birthday cake and twenty croissants for Saturday. Pickup at three or four? Sorry, the line is bad. Okay, four o'clock. Bye."),
      staff("That was another phone order. I hung up without reading the order back to the caller, so I hope I got the pickup time right."),
    ],
    problem: "B",
  },
  {
    id: "d3-c3",
    title: same("Second bake"),
    lines: [staff("The second tray of croissants is out. I am putting them on the display now.")],
    problem: null,
  },
  {
    id: "d3-c4",
    title: same("Display check, a calm one"),
    lines: [staff("Display check. Everything is full. Nothing to refill right now.")],
    problem: null,
  },
  {
    id: "d3-c5",
    title: same("Closing"),
    lines: [staff("We are closed. I counted the till, cleaned the oven and logged the leftovers.")],
    problem: null,
  },
]);

export const SCRIPT_V2: Readonly<Record<ScriptDay, readonly ScriptCardV2[]>> = Object.freeze({ 1: DAY_1, 2: DAY_2, 3: DAY_3 });

/** Heard lines the closing route needs for a day: 5 cards x CARD_MIN_LINES = 5 (plan section 5.4). */
export function requiredLines(day: ScriptDay): number {
  return SCRIPT_V2[day].length * CARD_MIN_LINES;
}

export interface DemoScript {
  id: "bakery-v2";
  days: Readonly<Record<ScriptDay, readonly ScriptCardV2[]>>;
}

export const BAKERY_V2: DemoScript = { id: "bakery-v2", days: SCRIPT_V2 };

export const SCRIPT_BY_ID: Readonly<Record<DemoScript["id"], DemoScript>> = { "bakery-v2": BAKERY_V2 };

/** Looks a script up by the id the server sent; an unknown id yields null (no card rather than a guess). */
export function scriptFor(id: string): DemoScript | null {
  return Object.prototype.hasOwnProperty.call(SCRIPT_BY_ID, id) ? SCRIPT_BY_ID[id as DemoScript["id"]] : null;
}

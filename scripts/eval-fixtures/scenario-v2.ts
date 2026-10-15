/**
 * Fictional rehearsal fixture for `npm run eval:scenario` (R-19 PR-R, Task R).
 *
 * Hard rule #8: entirely fictional (a made-up bakery), no person's name, no phone number, no price. The
 * "exact" variant is the judge script of docs/tasks/R-19-demo-v2.md section A.2-A.4 with the speaker tags
 * stripped (the speaker tag is never spoken). Each entry of `lines` is one spoken turn, i.e. one transcript line.
 *
 * KEEP IN SYNC with `SCRIPT_V2` (lib/demo/script.ts, PR-5): when tech-lead rewrites a failing card in the rewrite
 * loop (section 10.1) the script and this fixture change together. The four variants are written here; their
 * wording is a first draft for tech-lead to review.
 *
 *   exact : the script, word for word
 *   v1    : paraphrase (same meaning, other words)
 *   v2    : fillers ("um", "okay so", repeated words)
 *   v3    : the same cards in a different order
 *   v4    : light improvisation (one extra sentence on each problem card)
 *
 * Round 1 of the rewrite loop (tech-lead, section 10.1) rewrote d2-c3 and d3-c2 (exact, v1, v2, v4): the phone-order
 * card now states, in the problem moment itself, that the order was not read back to the caller.
 *
 * `kind` is the QA expectation only. It is read by the harness to classify results and by nothing else
 * (hard rule #10: the evidence gate, not this file, decides what becomes a fact).
 */

export const VARIANT_IDS = ["exact", "v1", "v2", "v3", "v4"] as const;
export type VariantId = (typeof VARIANT_IDS)[number];

export type CardKind = "routine" | "problem_a" | "problem_b";

export interface ScenarioCard {
  /** Stable id, e.g. "d2-c3". Printed in reports; the only identifier that ever is. */
  id: string;
  kind: CardKind;
  /** One entry per spoken turn (one transcript line each). */
  lines: readonly string[];
}

export interface ScenarioDay {
  day: 1 | 2 | 3;
  variants: Readonly<Record<VariantId, readonly ScenarioCard[]>>;
}

const card = (id: string, kind: CardKind, lines: readonly string[]): ScenarioCard => ({ id, kind, lines });

/** Returns the cards of `base` in the order given by `order` (card ids). Throws on an unknown or missing id. */
function reorder(base: readonly ScenarioCard[], order: readonly string[]): ScenarioCard[] {
  if (order.length !== base.length) throw new Error("reorder: order must name every card exactly once");
  return order.map((id) => {
    const found = base.find((c) => c.id === id);
    if (!found) throw new Error(`reorder: unknown card ${id}`);
    return found;
  });
}

// ── Day 1 ────────────────────────────────────────────────────────────────────────────────────────────────

const D1_EXACT = [
  card("d1-c1", "routine", [
    "Good morning. I am opening the shop now. The oven is on and the display lights are on. I counted the cash in the till and it matches the float.",
  ]),
  card("d1-c2", "routine", [
    "The first tray of egg tarts is out of the oven. I am putting them on the display now. The croissants go in next.",
  ]),
  card("d1-c3", "problem_a", [
    "Excuse me, I have a question about the egg tarts on the display. Are they fresh today, and do you know what time they were baked?",
    "I am not sure when this tray was baked, because nobody writes the baking time on the tray. I think it was this morning, but I cannot say for sure.",
    "Okay, no problem, I will take two anyway.",
  ]),
  card("d1-c4", "routine", [
    "Display check. The cinnamon rolls are running low, so I am refilling them now. Everything else on the display is full.",
  ]),
  card("d1-c5", "routine", [
    "We are closing now. I counted the till, I cleaned the oven, and I wrote the leftover bread in the log.",
  ]),
] as const satisfies readonly ScenarioCard[];

const D1_V1 = [
  card("d1-c1", "routine", [
    "Morning, opening up the shop. The oven is switched on, the lights over the display are on, and the cash drawer count matches the starting float.",
  ]),
  card("d1-c2", "routine", [
    "The first batch of egg tarts just came out of the oven and I am setting them on the display. Croissants are going in after that.",
  ]),
  card("d1-c3", "problem_a", [
    "Excuse me, I have a question about the egg tarts on the display. Are they fresh today, and when were they baked?",
    "Honestly I am not certain when this tray was baked, because nothing is written on the tray. My guess is this morning but I cannot say for sure.",
    "That is alright, I will take two anyway.",
  ]),
  card("d1-c4", "routine", [
    "Checking the display. The cinnamon rolls are getting low so I am topping them up. The rest of the display is full.",
  ]),
  card("d1-c5", "routine", [
    "Time to close. The till is counted, the oven is cleaned, and the leftover bread is written in the log.",
  ]),
] as const satisfies readonly ScenarioCard[];

const D1_V2 = [
  card("d1-c1", "routine", [
    "Um, good morning. Okay so I am opening the shop now, now the oven is on and, um, the display lights are on. I counted the cash in the till and it, it matches the float.",
  ]),
  card("d1-c2", "routine", [
    "Okay so the first tray of egg tarts is, um, out of the oven. I am putting them on the display now. The croissants go in, go in next.",
  ]),
  card("d1-c3", "problem_a", [
    "Um, excuse me, I have a, um, question about the egg tarts on the display. Are they fresh today, and, um, do you know what time they were baked?",
    "Um, I am not sure when this tray was baked, because, um, nobody writes the baking time on the tray. I think it was this morning, but, um, I cannot say for sure.",
    "Okay, no problem, I will take two anyway.",
  ]),
  card("d1-c4", "routine", [
    "Okay so display check. The cinnamon rolls are, um, running low so I am refilling them now. Everything else on the display is, is full.",
  ]),
  card("d1-c5", "routine", [
    "Okay we are closing now. Um, I counted the till, I cleaned the oven, and I, I wrote the leftover bread in the log.",
  ]),
] as const satisfies readonly ScenarioCard[];

const D1_V4 = [
  D1_EXACT[0],
  D1_EXACT[1],
  card("d1-c3", "problem_a", [
    "Excuse me, I have a question about the egg tarts on the display. Are they fresh today, and do you know what time they were baked?",
    "I am not sure when this tray was baked, because nobody writes the baking time on the tray. I think it was this morning, but I cannot say for sure.",
    "Okay, no problem, I will take two anyway.",
    "They look good though.",
  ]),
  D1_EXACT[3],
  D1_EXACT[4],
] as const satisfies readonly ScenarioCard[];

// ── Day 2 ────────────────────────────────────────────────────────────────────────────────────────────────

const D2_EXACT = [
  card("d2-c1", "routine", ["Morning. Oven on, display lights on. The cash in the till is counted and correct."]),
  card("d2-c2", "problem_a", [
    "Hi there. I would like to ask about this egg tart before I buy it. Is it from today, and do you know what time it was baked?",
    "Sorry, I do not know exactly when it was baked. Nobody wrote the baking time on the tray, so I can only guess that it was this morning.",
    "Alright, that is fine, I will have one anyway.",
  ]),
  card("d2-c3", "problem_b", [
    "Hello, Demo Bakery, thanks for calling. Yes, we can do fifty egg tarts for tomorrow morning, pickup at ten o'clock. Okay, got it. Thank you, bye.",
    "That was a phone order for tomorrow. I did not read the order back to the caller before hanging up, so I am not sure the quantity and the pickup time are right.",
  ]),
  card("d2-c4", "routine", [
    "Display check. The croissants are almost gone, I am putting out a new tray. The rest is full.",
  ]),
  card("d2-c5", "routine", ["Closing time. Till counted, oven cleaned, leftover bread logged."]),
] as const satisfies readonly ScenarioCard[];

const D2_V1 = [
  card("d2-c1", "routine", ["Good morning. The oven is on, the display lights are on, and the till count is right."]),
  card("d2-c2", "problem_a", [
    "Hello. I have a question about this egg tart before I buy. Is it from today, and when was it baked?",
    "I am sorry, I am not sure when it was baked. The tray has no baking time written on it, so I can only guess it is from this morning.",
    "Okay, that is fine, I will get one anyway.",
  ]),
  card("d2-c3", "problem_b", [
    "Hello, Demo Bakery, thanks for calling. Yes, fifty egg tarts for tomorrow morning, to be picked up at ten o'clock. Alright, got it. Thanks, goodbye.",
    "I did not read that phone order back to the caller before hanging up, so I am not sure if the quantity and the pickup time are right.",
  ]),
  card("d2-c4", "routine", [
    "Checking the display. The croissants are nearly finished so I am bringing out a fresh tray. Everything else is full.",
  ]),
  card("d2-c5", "routine", ["Closing. The till is counted, the oven is cleaned, and the leftover bread is in the log."]),
] as const satisfies readonly ScenarioCard[];

const D2_V2 = [
  card("d2-c1", "routine", ["Um, morning. Okay so oven on, display lights on. The cash in the till is, um, counted and correct."]),
  card("d2-c2", "problem_a", [
    "Um, hi there. I would like to, um, ask about this egg tart before I buy it. Is it from today, and, um, do you know what time it was baked?",
    "Sorry, um, I do not know exactly when it was baked. Nobody, nobody wrote the baking time on the tray, so I can only, um, guess that it was this morning.",
    "Alright, that is fine, I will have one anyway.",
  ]),
  card("d2-c3", "problem_b", [
    "Um, hello, Demo Bakery, thanks for calling. Yes, um, we can do fifty egg tarts for tomorrow morning, pickup at, um, ten o'clock. Okay, got it. Thank you, bye.",
    "Okay so that was a phone order for tomorrow. I did not read the order back to the caller before hanging up, so, um, I am not sure the quantity and the pickup time are right.",
  ]),
  card("d2-c4", "routine", [
    "Okay display check. The croissants are, um, almost gone, I am putting out a new tray. The rest is, is full.",
  ]),
  card("d2-c5", "routine", ["Um, closing time. Okay till counted, oven cleaned, um, leftover bread logged."]),
] as const satisfies readonly ScenarioCard[];

const D2_V4 = [
  D2_EXACT[0],
  card("d2-c2", "problem_a", [
    "Hi there. I would like to ask about this egg tart before I buy it. Is it from today, and do you know what time it was baked?",
    "Sorry, I do not know exactly when it was baked. Nobody wrote the baking time on the tray, so I can only guess that it was this morning.",
    "Alright, that is fine, I will have one anyway.",
    "They look good though.",
  ]),
  card("d2-c3", "problem_b", [
    "Hello, Demo Bakery, thanks for calling. Yes, we can do fifty egg tarts for tomorrow morning, pickup at ten o'clock. Okay, got it. Thank you, bye.",
    "That was a phone order for tomorrow. I did not read the order back to the caller before hanging up, so I am not sure the quantity and the pickup time are right.",
    "It was a big order for a weekday.",
  ]),
  D2_EXACT[3],
  D2_EXACT[4],
] as const satisfies readonly ScenarioCard[];

// ── Day 3 ────────────────────────────────────────────────────────────────────────────────────────────────

const D3_EXACT = [
  card("d3-c1", "routine", [
    "Good morning. The oven is on, the display lights are on, and the float in the till is correct.",
  ]),
  card("d3-c2", "problem_b", [
    "Hello, Demo Bakery, thanks for calling. A birthday cake and twenty croissants for Saturday. Pickup at three or four? Sorry, the line is bad. Okay, four o'clock. Bye.",
    "That was another phone order. I hung up without reading the order back to the caller, so I hope I got the pickup time right.",
  ]),
  card("d3-c3", "routine", ["The second tray of croissants is out. I am putting them on the display now."]),
  card("d3-c4", "routine", ["Display check. Everything is full. Nothing to refill right now."]),
  card("d3-c5", "routine", ["We are closed. I counted the till, cleaned the oven and logged the leftovers."]),
] as const satisfies readonly ScenarioCard[];

const D3_V1 = [
  card("d3-c1", "routine", ["Morning. The oven and the display lights are on, and the till float is right."]),
  card("d3-c2", "problem_b", [
    "Hello, Demo Bakery, how can I help? So a birthday cake and twenty croissants for Saturday. Is pickup at three or at four? Sorry, the phone is breaking up. Okay, four o'clock. Goodbye.",
    "That was another phone order. I hung up without reading the order back to the caller, so I hope I heard the pickup time right.",
  ]),
  card("d3-c3", "routine", ["The second batch of croissants has come out and I am putting it on the display."]),
  card("d3-c4", "routine", ["Checking the display. All full, nothing needs refilling at the moment."]),
  card("d3-c5", "routine", ["We are closed for the day. Till counted, oven cleaned, leftovers written in the log."]),
] as const satisfies readonly ScenarioCard[];

const D3_V2 = [
  card("d3-c1", "routine", [
    "Okay good morning. The oven is on, um, the display lights are on, and the float in the till is, is correct.",
  ]),
  card("d3-c2", "problem_b", [
    "Um, hello, Demo Bakery, thanks for calling. A birthday cake and, um, twenty croissants for Saturday. Pickup at three or four? Sorry, the, um, line is bad. Okay, four o'clock. Bye.",
    "Okay so that was another phone order. I hung up without reading the order back to the caller, um, so I hope I got the pickup time right.",
  ]),
  card("d3-c3", "routine", ["Um, the second tray of croissants is out. Okay I am putting them, putting them on the display now."]),
  card("d3-c4", "routine", ["Okay display check. Everything is, um, full. Nothing to refill right now."]),
  card("d3-c5", "routine", ["Um, we are closed. I counted the till, cleaned the oven and, um, logged the leftovers."]),
] as const satisfies readonly ScenarioCard[];

const D3_V4 = [
  D3_EXACT[0],
  card("d3-c2", "problem_b", [
    "Hello, Demo Bakery, thanks for calling. A birthday cake and twenty croissants for Saturday. Pickup at three or four? Sorry, the line is bad. Okay, four o'clock. Bye.",
    "That was another phone order. I hung up without reading the order back to the caller, so I hope I got the pickup time right.",
    "That took a while.",
  ]),
  D3_EXACT[2],
  D3_EXACT[3],
  D3_EXACT[4],
] as const satisfies readonly ScenarioCard[];

export const SCENARIO_V2: readonly ScenarioDay[] = [
  {
    day: 1,
    variants: {
      exact: D1_EXACT,
      v1: D1_V1,
      v2: D1_V2,
      v3: reorder(D1_EXACT, ["d1-c4", "d1-c3", "d1-c1", "d1-c5", "d1-c2"]),
      v4: D1_V4,
    },
  },
  {
    day: 2,
    variants: {
      exact: D2_EXACT,
      v1: D2_V1,
      v2: D2_V2,
      v3: reorder(D2_EXACT, ["d2-c3", "d2-c1", "d2-c2", "d2-c5", "d2-c4"]),
      v4: D2_V4,
    },
  },
  {
    day: 3,
    variants: {
      exact: D3_EXACT,
      v1: D3_V1,
      v2: D3_V2,
      v3: reorder(D3_EXACT, ["d3-c3", "d3-c2", "d3-c1", "d3-c5", "d3-c4"]),
      v4: D3_V4,
    },
  },
];

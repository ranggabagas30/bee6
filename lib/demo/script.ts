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
      customer("Excuse me, are these egg tarts fresh today? When were they baked?"),
      staff("Hmm, I am not sure when this tray was baked. There is no time written on the tray. I think it was this morning, but I cannot say for sure."),
      customer("Okay, that is fine. I will take two, please."),
      staff("Two egg tarts. Here you go, thank you."),
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
      customer("Hi. Is this egg tart from today? How fresh is it?"),
      staff("Sorry, I do not know exactly when it was baked. Nobody wrote the baking time on the tray. It should be from this morning."),
      customer("Alright, I will have one."),
      staff("One egg tart. Enjoy."),
    ],
    problem: "A",
  },
  {
    // Rewrite round 1 (14 Oct, Task R): lines 1 and 3 changed so the label model hears a phone call.
    id: "d2-c3",
    title: same("A phone order"),
    lines: [
      staff("Hello, Demo Bakery, thanks for calling."),
      staff("Yes, fifty egg tarts for tomorrow morning. Pickup at ten. Okay, got it. Thank you, bye."),
      staff("I did not read that phone order back to the caller. I will write it down later."),
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
    // Rewrite round 1 (14 Oct): same reason as d2-c3.
    id: "d3-c2",
    title: same("Another phone order"),
    lines: [
      staff("Hello, Demo Bakery, thanks for calling."),
      staff("A birthday cake and twenty croissants for Saturday. Pickup at three or four? Sorry, the phone line is bad. Okay, four o'clock. Bye."),
      staff("I hung up without reading the order back to the caller. I hope I got the time right."),
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

// ── LEGACY `bakery-v1` (R-18 drawer only). Deleted together with app/capture/ScriptDrawer.tsx in this PR. ──────────

export const ScriptCardSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,32}$/),
    kind: z.enum(["rules", "say", "own_words", "finish"]),
    speaker: z.enum(["you", "customer", "colleague", "caller"]).nullable(),
    text: Bilingual(220),
    example: z.object({ en: z.string().max(220), id: z.string().max(220) }).strict().nullable(),
    intent: z.object({ en: z.string().max(140), id: z.string().max(140) }).strict(),
    expect: z.enum(["fact_possible", "question", "dropped", "none"]),
    sop_step: z.enum(["open-01", "bake-01", "stock-01", "serve-01", "close-01"]).nullable(),
    seconds: z.number().int().min(5).max(45),
  })
  .strict();
export type ScriptCard = z.infer<typeof ScriptCardSchema>;

export interface LegacyDemoScript {
  id: "bakery-v1";
  cards: readonly ScriptCard[];
}

const LEGACY_CARDS: readonly ScriptCard[] = z.array(ScriptCardSchema).parse([
  {
    id: "rules",
    kind: "rules",
    speaker: null,
    text: {
      en: "Keep this tab open, screen on, mic allowed. Read each card aloud, then tap Next.",
      id: "Biarkan tab ini terbuka, layar menyala, mikrofon diizinkan. Bacakan tiap kartu, lalu ketuk Berikutnya.", // DRAFT: Tiffany
    },
    example: null,
    intent: {
      en: "Nothing is recorded until you tap Start.",
      id: "Tidak ada yang direkam sebelum Anda mengetuk Mulai.", // DRAFT: Tiffany
    },
    expect: "none",
    sop_step: null,
    seconds: 10,
  },
  {
    id: "opening",
    kind: "say",
    speaker: "you",
    text: {
      en: "Morning. Oven is on, display lights on, first tray of croissants going in now.",
      id: "Pagi. Oven sudah nyala, lampu display nyala, loyang croissant pertama masuk sekarang.", // DRAFT: Tiffany
    },
    example: null,
    intent: {
      en: "Opening routine: may become a fact on its own.",
      id: "Rutinitas buka toko: bisa menjadi fakta dengan sendirinya.", // DRAFT: Tiffany
    },
    expect: "fact_possible",
    sop_step: "open-01",
    seconds: 15,
  },
  {
    id: "bake-time-customer",
    kind: "own_words",
    speaker: "customer",
    text: {
      en: "Play a customer asking when a loaf was baked. Answer that you're not sure because the tray has no time on it.",
      id: "Perankan pelanggan yang bertanya kapan roti dipanggang. Jawab bahwa Anda tidak yakin karena loyangnya tidak ada catatan jam.", // DRAFT: Tiffany
    },
    example: {
      en: "\"When was this sourdough baked?\" \"Hmm, I'm not sure, there's no label. This morning, I think?\"",
      id: "\"Roti sourdough ini dipanggang kapan?\" \"Hmm, saya kurang yakin, tidak ada labelnya. Tadi pagi, kayaknya?\"", // DRAFT: Tiffany
    },
    intent: {
      en: "The bake-time problem the earlier demo days also show.",
      id: "Masalah jam panggang yang juga muncul di hari-hari demo sebelumnya.", // DRAFT: Tiffany
    },
    expect: "fact_possible",
    sop_step: "bake-01",
    seconds: 30,
  },
  {
    id: "bake-time-colleague",
    kind: "say",
    speaker: "colleague",
    text: {
      en: "Hey, what time did the sourdough come out? A customer asked again. / No idea, nobody wrote it down.",
      id: "Eh, roti sourdough keluar jam berapa? Pelanggan tanya lagi. / Nggak tahu, nggak ada yang catat.", // DRAFT: Tiffany
    },
    example: null,
    intent: {
      en: "Staff asking each other: evidence for the same problem.",
      id: "Staf saling bertanya: bukti untuk masalah yang sama.", // DRAFT: Tiffany
    },
    expect: "fact_possible",
    sop_step: "bake-01",
    seconds: 20,
  },
  {
    id: "display-check",
    kind: "own_words",
    speaker: "you",
    text: {
      en: "Say you checked the display and refilled what was running low.",
      id: "Ceritakan bahwa Anda mengecek display dan mengisi ulang yang hampir habis.", // DRAFT: Tiffany
    },
    example: {
      en: "Display check done, topped up the cinnamon rolls.",
      id: "Cek display selesai, cinnamon roll sudah diisi ulang.", // DRAFT: Tiffany
    },
    intent: {
      en: "Routine check, in your own words.",
      id: "Pengecekan rutin, dengan kata-kata Anda sendiri.", // DRAFT: Tiffany
    },
    expect: "fact_possible",
    sop_step: "stock-01",
    seconds: 20,
  },
  {
    id: "complaint",
    kind: "own_words",
    speaker: "customer",
    text: {
      en: "Play a customer complaining the bread they bought yesterday was already stale.",
      id: "Perankan pelanggan yang mengeluh roti yang dibeli kemarin sudah keras.", // DRAFT: Tiffany
    },
    example: {
      en: "\"The bread I bought yesterday was already stale. Can I talk to someone about it?\"",
      id: "\"Roti yang saya beli kemarin sudah keras. Bisa bicara dengan seseorang soal ini?\"", // DRAFT: Tiffany
    },
    intent: {
      en: "A complaint is never a fact by itself; it becomes a question.",
      id: "Keluhan tidak pernah menjadi fakta dengan sendirinya; ia menjadi pertanyaan.", // DRAFT: Tiffany
    },
    expect: "question",
    sop_step: "serve-01",
    seconds: 25,
  },
  {
    id: "phone-call",
    kind: "say",
    speaker: "you", // the staff member answering the call; the caller's words are not on the card
    text: {
      en: "Hello, Demo Bakehouse. Yes, we can keep two loaves for pickup at five.",
      id: "Halo, Demo Bakehouse. Bisa, kami simpankan dua roti untuk diambil jam lima.", // DRAFT: Tiffany
    },
    example: null,
    intent: {
      en: "Phone calls are always checked with staff later.",
      id: "Telepon selalu dicek ulang dengan staf nanti.", // DRAFT: Tiffany
    },
    expect: "question",
    sop_step: "serve-01",
    seconds: 20,
  },
  {
    id: "hypothetical",
    kind: "say",
    speaker: "you",
    text: {
      en: "If the oven ever breaks down, we'd have to call the technician.",
      id: "Kalau ovennya rusak, kita harus panggil teknisi.", // DRAFT: Tiffany
    },
    example: null,
    intent: {
      en: "Something that did not happen: it must not become a fact.",
      id: "Sesuatu yang tidak terjadi: tidak boleh menjadi fakta.", // DRAFT: Tiffany
    },
    expect: "none",
    sop_step: null,
    seconds: 10,
  },
  {
    id: "small-talk",
    kind: "own_words",
    speaker: "you",
    text: {
      en: "Chat about your weekend for a few seconds.",
      id: "Bicarakan akhir pekan Anda selama beberapa detik.", // DRAFT: Tiffany
    },
    example: {
      en: "I'm thinking of going to the beach on Sunday.",
      id: "Saya kepikiran pergi ke pantai hari Minggu.", // DRAFT: Tiffany
    },
    intent: {
      en: "Small talk is not work: it is dropped from the record.",
      id: "Obrolan santai bukan pekerjaan: dibuang dari catatan.", // DRAFT: Tiffany
    },
    expect: "dropped",
    sop_step: null,
    seconds: 15,
  },
  {
    id: "closing",
    kind: "say",
    speaker: "you",
    text: {
      en: "Counting the till now and logging the leftover loaves.",
      id: "Sekarang hitung kas dan catat roti sisa.", // DRAFT: Tiffany
    },
    example: null,
    intent: {
      en: "Closing routine.",
      id: "Rutinitas tutup toko.", // DRAFT: Tiffany
    },
    expect: "fact_possible",
    sop_step: "close-01",
    seconds: 15,
  },
  {
    id: "finish",
    kind: "finish",
    speaker: null,
    text: {
      en: "Tap Finish to end the demo day. Your debrief opens next.",
      id: "Ketuk Selesai untuk mengakhiri hari demo. Debrief Anda terbuka berikutnya.", // DRAFT: Tiffany
    },
    example: null,
    intent: {
      en: "Your moments reach the day record about 2–4 minutes after you finish.",
      id: "Momen Anda masuk ke catatan harian sekitar 2–4 menit setelah Anda selesai.", // DRAFT: Tiffany
    },
    expect: "none",
    sop_step: null,
    seconds: 5,
  },
]);

export const BAKERY_V1: LegacyDemoScript = { id: "bakery-v1", cards: LEGACY_CARDS };

/** The R-18 drawer's lookup; v1 only. */
export function legacyScriptFor(id: string): LegacyDemoScript | null {
  return id === "bakery-v1" ? BAKERY_V1 : null;
}

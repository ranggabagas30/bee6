import { z } from "zod";

/**
 * R-18 demo script `bakery-v1`: pure data plus a strict schema. Shown in the /capture script drawer to a
 * sandbox judge (server field `demo_session.script_id`). Fictional (hard rule #8), no person's name
 * (hard rule #7). Lines match the 5-step placeholder SOP (open-01, bake-01, stock-01, serve-01, close-01).
 *
 * `expect` is a QA reference only. It is never shown and no code reads it: the evidence gate stays the
 * only judge of what becomes a fact (hard rule #10).
 *
 * The Bahasa column is a DRAFT for Tiffany to review against her clip script page.
 */

const Bilingual = (max: number) => z.object({ en: z.string().min(1).max(max), id: z.string().min(1).max(max) }).strict();

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

export interface DemoScript {
  id: "bakery-v1";
  cards: readonly ScriptCard[];
}

const CARDS: readonly ScriptCard[] = z.array(ScriptCardSchema).parse([
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

export const BAKERY_V1: DemoScript = { id: "bakery-v1", cards: CARDS };

export const SCRIPT_BY_ID: Readonly<Record<DemoScript["id"], DemoScript>> = { "bakery-v1": BAKERY_V1 };

/** Looks a script up by the id the server sent; an unknown id yields null (no drawer rather than a guess). */
export function scriptFor(id: string): DemoScript | null {
  return Object.prototype.hasOwnProperty.call(SCRIPT_BY_ID, id) ? SCRIPT_BY_ID[id as DemoScript["id"]] : null;
}

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
 * `{code}` placeholder; the literal never sits in copy, see app/demo/import-boundaries.test.ts); the sign-in cards print
 * the web roles' demo email and password the same way (`{email}`, `{password}`). EN is final; the
 * Bahasa column is PROVISIONAL (EN until Tiffany). Nothing here is read by server code (hard rule #10).
 */

const Bilingual = z.object({ en: z.string().min(1).max(400), id: z.string().min(1).max(400) }).strict();
export type Bilingual = z.infer<typeof Bilingual>;

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
  "sign_in_supervisor",
  "sign_in_owner",
  "pair",
  "pair_done",
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
  /** sign-in: "Fill in the form" puts the demo email and password into the page's fields (does not submit). */
  z.object({ kind: z.literal("fill_demo_credentials") }).strict(),
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
    /** The card's name for assistive tech (a visually hidden heading) and the default handle line. */
    title: Bilingual,
    /** R-25 T6: the handle row's one-line title when it differs from `title` (`{n}`/`{total}` are filled by the component). */
    handle: Bilingual.optional(),
    /** R-25 T6: the mono kicker above the card body ("NEXT", "CARD n OF 5", "PLEASE WAIT"). */
    kicker: Bilingual.optional(),
    body: z.array(Bilingual).max(4),
    action: GuideActionSchema.nullable(),
    footnote: Bilingual.nullable(),
    /** R-25 T6: the web panel's "Do this now" rows (the component derives done / current / not yet from the progress). */
    todo: z.array(Bilingual).min(2).max(5).optional(),
  })
  .strict();
export type GuideCard = z.infer<typeof GuideCardSchema>;

/** One bilingual string. The Bahasa column is PROVISIONAL (unreviewed) until Tiffany reviews it. */
const bi = (en: string, id: string): Bilingual => ({ en, id });

interface CardSpec {
  title: Bilingual;
  handle?: Bilingual;
  kicker?: Bilingual;
  body?: Bilingual[];
  action?: GuideAction | null;
  footnote?: Bilingual | null;
  todo?: Bilingual[];
}
const card = (spec: CardSpec): GuideCard => ({
  title: spec.title,
  ...(spec.handle ? { handle: spec.handle } : {}),
  ...(spec.kicker ? { kicker: spec.kicker } : {}),
  body: spec.body ?? [],
  action: spec.action ?? null,
  footnote: spec.footnote ?? null,
  ...(spec.todo ? { todo: spec.todo } : {}),
});

const NEXT = bi("NEXT", "SELANJUTNYA");

// PROVISIONAL: every `id` below is unreviewed Bahasa (EN is final, from the page-2 boards). `**x**` is bold; `{code}`,
// `{email}`, `{password}`, `{day}`, `{n}` and `{total}` are filled by the component (the credentials from lib/demo/credentials).
export const GUIDE: Readonly<Record<GuideKey, GuideCard>> = z
  .object(Object.fromEntries(GUIDE_KEYS.map((k) => [k, GuideCardSchema])) as Record<GuideKey, typeof GuideCardSchema>)
  .strict()
  .parse({
    entry: card({
      title: bi("Welcome, judge", "Selamat datang, juri"),
      handle: bi("Welcome · pick Staff to start", "Selamat datang · pilih Staf untuk mulai"),
      kicker: bi("WELCOME, JUDGE", "SELAMAT DATANG, JURI"),
      body: [
        bi(
          "Bee6 listens to a shop's day on one phone and turns speech into short work notes. You will run three short days as staff, check what Bee6 found as supervisor, then approve a change as owner. About 20 minutes.",
          "Bee6 mendengarkan hari kerja sebuah toko lewat satu ponsel dan mengubah ucapan menjadi catatan kerja singkat. Anda akan menjalankan tiga hari singkat sebagai staf, memeriksa temuan Bee6 sebagai supervisor, lalu menyetujui satu perubahan sebagai pemilik. Sekitar 20 menit.",
        ),
        bi(
          "Supervisor and Owner sign in with the email and password this guide shows on the sign-in page.",
          "Supervisor dan Pemilik masuk dengan email dan kata sandi yang ditampilkan panduan ini di halaman masuk.",
        ),
      ],
      footnote: bi("To change role later: sign out, then pick a role again.", "Untuk berganti peran nanti: keluar, lalu pilih peran lagi."),
    }),
    sign_in_supervisor: card({
      title: bi("Sign in as Supervisor", "Masuk sebagai Supervisor"),
      handle: bi("Supervisor email and password", "Email dan kata sandi Supervisor"),
      kicker: bi("SIGN IN AS SUPERVISOR", "MASUK SEBAGAI SUPERVISOR"),
      body: [
        bi("Type these into the form, then tap Sign in.", "Ketik ini ke formulir, lalu ketuk Masuk."),
        bi("Email **{email}** · password **{password}**", "Email **{email}** · kata sandi **{password}**"),
        bi("This opens your own private copy of a fictional shop for 2 hours.", "Ini membuka salinan pribadi toko fiktif Anda selama 2 jam."),
      ],
      action: { kind: "fill_demo_credentials" },
      footnote: bi("To change role later: sign out, then pick a role again.", "Untuk berganti peran nanti: keluar, lalu pilih peran lagi."),
    }),
    sign_in_owner: card({
      title: bi("Sign in as Owner", "Masuk sebagai Pemilik"),
      handle: bi("Owner email and password", "Email dan kata sandi Pemilik"),
      kicker: bi("SIGN IN AS OWNER", "MASUK SEBAGAI PEMILIK"),
      body: [
        bi("Type these into the form, then tap Sign in.", "Ketik ini ke formulir, lalu ketuk Masuk."),
        bi("Email **{email}** · password **{password}**", "Email **{email}** · kata sandi **{password}**"),
        bi("This opens your own private copy of a fictional shop for 2 hours.", "Ini membuka salinan pribadi toko fiktif Anda selama 2 jam."),
      ],
      action: { kind: "fill_demo_credentials" },
      footnote: bi("To change role later: sign out, then pick a role again.", "Untuk berganti peran nanti: keluar, lalu pilih peran lagi."),
    }),
    pair: card({
      title: bi("Set up the staff phone", "Siapkan ponsel staf"),
      handle: bi("Fill in the demo code", "Isi kode demo"),
      kicker: bi("STEP: PAIR THE DEVICE", "LANGKAH: PASANGKAN PERANGKAT"),
      body: [
        bi(
          "For this demo the code is **{code}**. A real shop gets a one-time code from its supervisor.",
          "Untuk demo ini kodenya **{code}**. Toko sungguhan mendapat kode sekali pakai dari supervisornya.",
        ),
      ],
      action: { kind: "fill_demo_code" },
    }),
    // R-25 R12 (UI-021): the device is paired; the stale "Fill in the code" card must not stay. The "NEXT" kicker and
    // the emphasis on the button name are chrome the guide component draws (T6); the copy here is plain text.
    pair_done: card({
      title: bi("Open the listening page", "Buka halaman mendengarkan"),
      kicker: NEXT,
      body: [
        bi(
          "Tap Open the listening page. Then tap Start and read the script cards that appear in this guide.",
          "Ketuk Buka halaman mendengarkan. Lalu ketuk Mulai dan bacakan kartu naskah yang muncul di panduan ini.",
        ),
      ],
    }),
    capture_ready: card({
      title: bi("Tap Start, then read the cards", "Ketuk Mulai, lalu bacakan kartunya"),
      kicker: NEXT,
      body: [
        bi(
          "Tap **Start**. The first script card appears here. Read it word for word, then tap “I have spoken this”.",
          "Ketuk **Mulai**. Kartu naskah pertama muncul di sini. Bacakan kata demi kata, lalu ketuk “Saya sudah mengucapkan ini”.",
        ),
        bi(
          "Read one line at a time. After each line, stop and count slowly to three before the next line.",
          "Bacakan satu baris sekali. Setelah tiap baris, berhenti dan hitung pelan sampai tiga sebelum baris berikutnya.",
        ),
        bi(
          "After the 5 cards, Jump to closing time unlocks End. No more than 4 people should read cards at the same time; if more are ready, wait until someone has finished their 5 cards (about 2 minutes) before tapping Start.",
          "Setelah 5 kartu, Lompat ke jam tutup membuka tombol Akhiri. Paling banyak 4 orang membacakan kartu bersamaan; jika ada lebih banyak, tunggu sampai ada yang selesai 5 kartunya (sekitar 2 menit) sebelum mengetuk Mulai.",
        ),
      ],
    }),
    capture_listening: card({
      title: bi("Read this card aloud", "Bacakan kartu ini"),
      handle: bi("Read card {n} of {total} aloud", "Bacakan kartu {n} dari {total}"),
      action: { kind: "script_card" },
      footnote: bi(
        "Read it word for word. You play every voice; the speaker name is not spoken. Pause about 2 seconds between speakers.",
        "Bacakan kata demi kata. Anda memerankan semua suara; nama pembicara tidak diucapkan. Jeda sekitar 2 detik antar pembicara.",
      ),
    }),
    capture_all_spoken: card({
      title: bi("All 5 cards are spoken", "Kelima kartu sudah diucapkan"),
      handle: bi("All cards spoken · jump to closing", "Semua kartu diucapkan · lompat ke jam tutup"),
      kicker: bi("ALL 5 CARDS SPOKEN", "KELIMA KARTU SUDAH DIUCAPKAN"),
      body: [
        bi(
          "Well done. Day {day}'s speech is captured. Jump to closing time, then tap End.",
          "Kerja bagus. Ucapan hari {day} sudah tertangkap. Lompat ke jam tutup, lalu ketuk Akhiri.",
        ),
      ],
      action: { kind: "jump_closing" },
    }),
    capture_closing: card({
      title: bi("Tap End today", "Ketuk Akhiri hari ini"),
      handle: bi("All cards spoken · jump to closing", "Semua kartu diucapkan · lompat ke jam tutup"),
      kicker: bi("CLOSING TIME REACHED", "JAM TUTUP TERCAPAI"),
      body: [
        bi(
          "Now tap **End today** on the screen. A 60-minute debrief follows.",
          "Sekarang ketuk **Akhiri hari ini** di layar. Debrief 60 menit menyusul.",
        ),
      ],
    }),
    capture_open_session: card({
      title: bi("Today's session is still open", "Sesi hari ini masih terbuka"),
      handle: bi("Tap End to start the debrief", "Ketuk Akhiri untuk memulai debrief"),
      kicker: NEXT,
      body: [
        bi(
          "Tap **End today** to start the debrief, or **Cancel today** if the session was interrupted before closing time.",
          "Ketuk **Akhiri hari ini** untuk memulai debrief, atau **Batalkan hari ini** jika sesi terputus sebelum jam tutup.",
        ),
      ],
    }),
    debrief_preparing: card({
      title: bi("Preparing your questions", "Menyiapkan pertanyaan Anda"),
      handle: bi("Wait for your questions", "Tunggu pertanyaan Anda"),
      kicker: bi("PLEASE WAIT", "MOHON TUNGGU"),
      body: [
        bi(
          "Bee6 is reading today's notes to decide what to ask. Your questions appear in about 2 to 4 minutes. Keep this page open.",
          "Bee6 membaca catatan hari ini untuk menentukan apa yang ditanyakan. Pertanyaan muncul sekitar 2 sampai 4 menit lagi. Biarkan halaman ini terbuka.",
        ),
      ],
    }),
    debrief_question: card({
      title: bi("Answer what really happened", "Jawab apa yang sebenarnya terjadi"),
      handle: bi("Answer the questions", "Jawab pertanyaannya"),
      kicker: bi("DEBRIEF TIP", "TIPS DEBRIEF"),
      body: [
        bi(
          "Answer what really happened in today's script. The phone order did happen, so answer Yes and type a few words why, for example: I did not read the order back to the caller.",
          "Jawab apa yang sebenarnya terjadi dalam naskah hari ini. Pesanan telepon memang terjadi, jadi jawab Ya dan ketik beberapa kata alasannya, misalnya: Saya tidak membacakan ulang pesanan kepada penelepon.",
        ),
        bi(
          "Answering does not end the debrief. It ends when every question is answered or the 60 minutes are over.",
          "Menjawab tidak mengakhiri debrief. Debrief berakhir saat semua pertanyaan terjawab atau 60 menit habis.",
        ),
        // UI-112: no Jump control while questions are open (the board shows it on the complete screen only).
        bi(
          "When every question is answered or skipped, this guide shows Jump to tomorrow.",
          "Setelah setiap pertanyaan dijawab atau dilewati, panduan ini menampilkan Lompat ke besok.",
        ),
      ],
    }),
    debrief_done: card({
      title: bi("Today is done", "Hari ini selesai"),
      handle: bi("Jump to tomorrow for day {next}", "Lompat ke besok untuk hari {next}"),
      kicker: NEXT,
      body: [
        bi(
          "Jump to tomorrow to run the next day. After day 3, sign out and continue as Supervisor.",
          "Lompat ke besok untuk menjalankan hari berikutnya. Setelah hari 3, keluar dan lanjut sebagai Supervisor.",
        ),
      ],
      action: { kind: "jump_tomorrow" },
    }),
    day: card({
      title: bi("The day record", "Catatan hari"),
      todo: [
        bi("Confirm the note that needs your check", "Konfirmasi catatan yang perlu Anda periksa"),
        bi("Read the staff's debrief answers", "Baca jawaban debrief staf"),
        bi("Open Proposals", "Buka Usulan"),
      ],
    }),
    proposals_waiting: card({
      title: bi("Waiting for evidence", "Menunggu bukti"),
      todo: [
        bi("Day 1 recorded and debriefed", "Hari 1 tercatat dan sudah di-debrief"),
        bi("Look around: Day record, SOP, Connected devices", "Lihat-lihat: Catatan hari, SOP, Perangkat terhubung"),
        bi("Sign out, pick Staff, and run day 2 (and day 3)", "Keluar, pilih Staf, dan jalankan hari 2 (dan hari 3)"),
        bi("Come back here and ask for a proposal", "Kembali ke sini dan minta usulan"),
      ],
    }),
    proposals_ready: card({
      title: bi("Ask Bee6 for a proposal", "Minta usulan ke Bee6"),
      body: [
        bi(
          "Evidence is ready. Tap Ask Bee6 once: it writes and checks one proposal for each problem that has enough evidence (this can take up to a minute).",
          "Bukti sudah siap. Ketuk Minta usulan dari Bee6 sekali: ia menulis dan memeriksa satu usulan untuk setiap masalah yang buktinya cukup (bisa memakan waktu sampai satu menit).",
        ),
        bi(
          "Once a proposal exists, the demo days can't be run again.",
          "Setelah ada usulan, hari demo tidak bisa dijalankan ulang.",
        ),
      ],
    }),
    proposals_generating: card({
      title: bi("Asking Bee6", "Bertanya ke Bee6"),
      body: [bi("Keep this page open. The proposals appear in about a minute.", "Biarkan halaman ini terbuka. Usulan muncul sekitar satu menit lagi.")],
    }),
    proposal_detail: card({
      title: bi("Check each proposal", "Periksa tiap usulan"),
      todo: [
        bi("Run all the days on the staff phone", "Jalankan semua hari di ponsel staf"),
        bi("Ask Bee6 for proposals", "Minta usulan ke Bee6"),
        bi("Open a proposal: read the evidence, change a label if you disagree", "Buka usulan: baca buktinya, ubah label jika Anda tidak setuju"),
        bi("Mark it Feasible (we suggest feasible for the demo) or reject with a reason", "Tandai Layak (untuk demo kami sarankan layak) atau tolak dengan alasan"),
        bi("Sign out, then pick Owner", "Keluar, lalu pilih Pemilik"),
      ],
    }),
    proposals_feasible: card({
      title: bi("Over to the Owner", "Serahkan ke Pemilik"),
      body: [
        bi(
          "Every proposal is marked feasible. Sign out and sign in as Owner to approve or reject.",
          "Semua usulan sudah ditandai layak. Keluar lalu masuk sebagai Pemilik untuk menyetujui atau menolak.",
        ),
      ],
    }),
    sop: card({
      title: bi("The shop's SOP", "SOP toko"),
      body: [
        bi(
          "Versions are listed by date. An approved proposal ships as a new version with the improved step marked.",
          "Versi diurutkan menurut tanggal. Usulan yang disetujui terbit sebagai versi baru dengan langkah yang diperbaiki ditandai.",
        ),
      ],
    }),
    reviews: card({
      title: bi("Reviews", "Tinjauan"),
      body: [bi("An approved change gets a review date. It appears here when that date comes.", "Perubahan yang disetujui mendapat tanggal tinjauan. Muncul di sini saat tanggalnya tiba.")],
    }),
    devices: card({
      title: bi("Connected devices", "Perangkat terhubung"),
      body: [bi("The staff phone pairs with a code from here. No device ids are shown.", "Ponsel staf dipasangkan dengan kode dari sini. Tidak ada id perangkat yang ditampilkan.")],
    }),
    home: card({
      title: bi("Owner home", "Beranda pemilik"),
      action: { kind: "reset_demo" },
      todo: [
        bi("Supervisor marked both proposals feasible", "Supervisor menandai kedua usulan layak"),
        bi("Open Approvals and review in order", "Buka Persetujuan dan tinjau berurutan"),
        bi("Approve or reject each proposal", "Setujui atau tolak setiap usulan"),
      ],
    }),
    approvals: card({
      title: bi("Approve or reject each proposal", "Setujui atau tolak setiap usulan"),
      body: [
        bi(
          "Approve or reject each proposal; a rejection reason becomes a rule Bee6 respects.",
          "Setujui atau tolak setiap usulan; alasan penolakan menjadi aturan yang dipatuhi Bee6.",
        ),
      ],
      todo: [
        bi("Review #1, then approve or reject it", "Tinjau #1, lalu setujui atau tolak"),
        bi("Review #2, then approve or reject it", "Tinjau #2, lalu setujui atau tolak"),
        bi("Open SOP and see the new versions", "Buka SOP dan lihat versi barunya"),
      ],
    }),
    approvals_done: card({
      title: bi("All decided", "Semua sudah diputuskan"),
      body: [
        bi(
          "Each approved change is now its own SOP version. Open SOP to see the improved steps, and Reviews for their review dates.",
          "Setiap perubahan yang disetujui kini menjadi versi SOP-nya sendiri. Buka SOP untuk melihat langkah yang diperbaiki, dan Tinjauan untuk tanggal tinjauannya.",
        ),
      ],
    }),
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
        ? {
            ...base,
            title: bi("Tap End today", "Ketuk Akhiri hari ini"),
            body: [
              bi(
                "Closing time has passed. Tap **End today** to start the 60-minute debrief.",
                "Jam tutup sudah lewat. Ketuk **Akhiri hari ini** untuk memulai debrief 60 menit.",
              ),
            ],
          }
        : {
            ...base,
            title: bi("Today's session was interrupted", "Sesi hari ini terputus"),
            handle: bi("Today's session was interrupted", "Sesi hari ini terputus"),
            body: [
              bi(
                "The session stopped before closing time. Tap **Cancel today** on the screen, then **Start** today again.",
                "Sesi berhenti sebelum jam tutup. Ketuk **Batalkan hari ini** di layar, lalu **Mulai** lagi hari ini.",
              ),
            ],
          },
    );
  }
  if (day === 1 && key === "debrief_question") {
    return GuideCardSchema.parse({
      ...base,
      body: [
        bi(
          "Answer what really happened in today's script. Where a question asks why, type a few words.",
          "Jawab apa yang sebenarnya terjadi dalam naskah hari ini. Jika pertanyaan menanyakan alasan, ketik beberapa kata.",
        ),
        base.body[1]!,
        base.body[2]!,
      ],
    });
  }
  if (day === 3 && key === "debrief_question") {
    return GuideCardSchema.parse({
      ...base,
      body: [
        base.body[0]!,
        base.body[1]!,
        bi("When your questions are answered, sign out and continue as Supervisor.", "Setelah pertanyaan terjawab, keluar dan lanjut sebagai Supervisor."),
      ],
    });
  }
  if (day === 1 && key === "debrief_done") {
    return GuideCardSchema.parse({
      ...base,
      body: [
        bi(
          "Day 1 of 3 is done. First sign out and look around as Supervisor (stage 2). Then come back for days 2 and 3. Asking Bee6 for proposals locks Jump to tomorrow, so finish day 3 first.",
          "Hari 1 dari 3 selesai. Keluar dulu dan lihat-lihat sebagai Supervisor (tahap 2). Lalu kembali untuk hari 2 dan 3. Meminta usulan ke Bee6 mengunci Lompat ke besok, jadi selesaikan hari 3 dulu.",
        ),
      ],
    });
  }
  if (day === 2 && key === "debrief_done") {
    return GuideCardSchema.parse({
      ...base,
      body: [
        bi(
          "Day 2 of 3 is done. Jump to tomorrow to run day 3. After day 3, sign out and continue as Supervisor.",
          "Hari 2 dari 3 selesai. Lompat ke besok untuk menjalankan hari 3. Setelah hari 3, keluar dan lanjut sebagai Supervisor.",
        ),
      ],
    });
  }
  if (day === 3 && key === "debrief_done") {
    return GuideCardSchema.parse({
      ...base,
      handle: bi("Sign out and continue as Supervisor", "Keluar dan lanjut sebagai Supervisor"),
      body: [
        bi(
          "That was the last of the 3 demo days. Next, sign out and continue as Supervisor.",
          "Itu hari terakhir dari 3 hari demo. Selanjutnya, keluar dan lanjut sebagai Supervisor.",
        ),
      ],
    });
  }
  return base;
}

/**
 * R-25 T6: which "Do this now" rows are already done, for the cards that carry a `todo` list. The first row after the
 * done ones is the current step, the rest are not yet. Pure; display only (the gate never reads it).
 */
export function todoDoneCount(key: GuideKey, p: JourneyProgress | null): number {
  switch (key) {
    case "proposals_waiting":
      return p === null ? 0 : (p.days_done >= 1 ? 1 : 0) + (p.supervisor_visited ? 1 : 0);
    case "proposal_detail":
      return p === null ? 0 : 2 + (p.feasible >= 1 ? 1 : 0);
    case "home":
      return p !== null && p.feasible >= 2 ? 1 : 0;
    case "approvals":
      return p === null ? 0 : Math.min(2, p.owner_decided);
    default:
      return 0;
  }
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

/** Where the guide is drawn (R-25 R7): only the supervisor web pages (role supervisor) set `onSupervisorWeb`. */
export interface StageContext {
  onSupervisorWeb: boolean;
}

/**
 * Exact rule of plan 7.1, plus R-25 R7: right after day 1 the judge is a supervisor looking around, so stage 2 holds
 * for as long as the guide is drawn on a supervisor web page, whether or not the "supervisor visited" flag is set
 * (the flag is set the moment such a page mounts, which used to flip the guide to stage 3 on arrival). On the phone
 * the flag still moves the judge on to stage 3.
 */
export function currentStage(p: JourneyProgress, ctx: StageContext = { onSupervisorWeb: false }): StageId {
  if (p.days_done < 1) return "staff_day1";
  if (p.days_done === 1 && (ctx.onSupervisorWeb || !p.supervisor_visited)) return "supervisor_look";
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

/**
 * The screen the proposals page reports itself (lib/demo/proposals-signal): PR-12a's supervisor screens and PR-12b's
 * owner screens. A screen of the other role (a stale signal) is ignored by `proposalsKey`.
 */
export type ProposalsGuideScreen = "list" | "generating" | "detail" | "feasible" | "empty" | "review" | "all_decided";

export interface WebGuideState {
  kind: "web";
  role: "supervisor" | "owner";
  /** GET /api/v1/demo/progress; null until it loads (the default card is shown). */
  progress: JourneyProgress | null;
  /** The proposals page's own screen; it wins over the counters where it says more than they do. */
  screen?: ProposalsGuideScreen | null;
}

/** R-25 R12: /pair reports that the device is paired (app/demo/guide-bridge.ts `publishPairDone`). */
export interface PairGuideState {
  kind: "pair";
  paired: boolean;
}

export type SignInGuideRole = "staff" | "supervisor" | "owner";

/** Demo feedback 2, finding 4: /sign-in reports the role panel it shows (app/demo/guide-bridge.ts `publishSignInRole`). */
export interface SignInGuideState {
  kind: "sign_in";
  /** The panel's role as DemoAccess publishes it; null before it mounts. */
  role: SignInGuideRole | null;
}

export type GuideState = CaptureGuideState | WebGuideState | PairGuideState | SignInGuideState;

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
    // The page's own "all decided" screen wins at once: the progress refetch it triggers may still be in flight.
    if (state.screen === "all_decided") return "approvals_done";
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
  if (seg === "sign-in") {
    const role = state?.kind === "sign_in" ? state.role : null;
    return role === "supervisor" ? "sign_in_supervisor" : role === "owner" ? "sign_in_owner" : "entry";
  }
  if (seg === "pair") return state?.kind === "pair" && state.paired ? "pair_done" : "pair";
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

/**
 * i18n v2 slice `web`: copy for the supervisor and owner shell: nav, empty states, notices (PR-6).
 *
 * R-19 PR-0 scaffold; PR-6 adds its keys HERE and nowhere else: `lib/i18n/dict.ts` spreads this slice once into
 * ID and EN, so a key added here reaches `DictKey` and `t()` with no edit to dict.ts. Rules (checked by v2.test.ts):
 * - the same keys in both objects (`webEN` is typed from `webID`, so a missing or extra EN key is a type error);
 * - a key is unique across ALL slices and the existing dictionary (name it `C-<area>-...` like the base table);
 * - values are trimmed and non-empty, with the same {placeholders} in both languages;
 * - no machine translation; mark unreviewed Bahasa with a trailing `// PROVISIONAL` comment as the base table does.
 *
 * PR-6 keys (plan §8.1 entry page and pairing, §8.2 nav shell, §8.3 empty states). EN is final per the plan; every
 * ID line is PROVISIONAL until Tiffany reviews it. The entry-page keys render only on a demo deployment (`/` on the
 * pilot redirects to /sign-in before rendering anything); the pair "demo step" keys render only after a demo pairing.
 * Nothing here carries the demo code or the "change role" tip: those live only in the judge guide (W8, PR-5).
 */

export const webID = {
  // §8.1 Entry page (demo only; page-1 W1 Judge landing without the long paragraph, V4).
  "C-web-entry-strip": "OUTLET DEMO · DATA FIKTIF", // PROVISIONAL
  "C-web-entry-h1": "Hari sebuah toko kecil, diubah menjadi SOP yang lebih baik, satu langkah demi satu langkah.", // PROVISIONAL
  "C-web-entry-kicker": "COBA KETIGA PERAN · SEKITAR 20 MENIT", // PROVISIONAL
  "C-web-entry-step": "LANGKAH {n}", // PROVISIONAL
  "C-web-entry-start-here": "MULAI DI SINI", // PROVISIONAL
  "C-web-entry-phone": "Paling baik di HP", // PROVISIONAL
  "C-web-entry-staff-line": "Jalankan hari toko di HP: bacakan kartu naskah, lalu jawab debrief.", // PROVISIONAL
  "C-web-entry-supervisor-line": "Baca catatan hari dan periksa usulan Bee6.", // PROVISIONAL
  "C-web-entry-owner-line": "Setujui satu perubahan dan lihat SOP versi baru terbit.", // PROVISIONAL
  "C-web-entry-footer":
    "Toko fiktif, data fiktif. Data toko sungguhan ada di sistem terpisah dan tidak bisa diakses dari demo ini. Sesi berlangsung 2 jam.", // PROVISIONAL
  // §8.1 Set up this device (both deployments) and Device set up (demo steps; pilot steps are C-pair-step-1..4).
  "C-web-pair-done-h": "Perangkat siap", // PROVISIONAL
  "C-web-pair-demo-step-1": "Biarkan halaman ini tetap terbuka selama Anda menjalankan demo.", // PROVISIONAL
  "C-web-pair-demo-step-2": "Izinkan mikrofon saat diminta.", // PROVISIONAL
  "C-web-pair-demo-step-3": "Ketuk Mulai, lalu bacakan kartu naskah di panduan juri.", // PROVISIONAL
  "C-web-pair-demo-step-4": "Selesai tersedia saat jam tutup: gunakan Lompat ke jam tutup di panduan juri.", // PROVISIONAL
  "C-web-pair-digit": "Digit {n} dari 6", // PROVISIONAL
  // §8.2 Nav shell (supervisor: day, proposals, sop, reviews, devices; owner: home, approvals, sop, reviews).
  "C-web-nav-label": "Menu utama", // PROVISIONAL
  "C-web-nav-home": "Beranda", // PROVISIONAL
  "C-web-nav-day": "Catatan hari", // PROVISIONAL
  "C-web-nav-proposals": "Usulan", // PROVISIONAL
  "C-web-nav-approvals": "Persetujuan", // PROVISIONAL
  "C-web-nav-sop": "SOP", // PROVISIONAL
  "C-web-nav-reviews": "Tinjauan", // PROVISIONAL
  "C-web-nav-devices": "Perangkat terhubung", // PROVISIONAL
  "C-web-demo-chip": "DATA DEMO", // PROVISIONAL
  "C-web-devices-placeholder": "Perangkat terhubung · hadir dalam rilis ini", // PROVISIONAL
  // §8.3 Empty states.
  "C-web-empty-day-h": "Belum ada catatan untuk hari ini.", // PROVISIONAL
  "C-web-empty-day-p": "Catatan muncul setelah HP toko mendengarkan dan Bee6 membaca hari itu.", // PROVISIONAL
  "C-web-empty-prop-h": "Belum ada usulan", // PROVISIONAL
  "C-web-empty-prop-p": "Bee6 perlu masalah yang sama pada minimal 2 hari.", // PROVISIONAL
  "C-web-empty-appr-h": "Tidak ada yang menunggu Anda.", // PROVISIONAL
  "C-web-empty-appr-p": "Usulan muncul di sini setelah supervisor menandainya layak.", // PROVISIONAL
  // R-25 T9: day record page (board D2-02, D2-02b). `C-day2-*` keys; the older `C-day-*` base keys are untouched.
  "C-day2-sub": "Apa yang terjadi di hari toko, beserta kata-kata di baliknya.", // PROVISIONAL
  "C-day2-date-nav": "Pilih hari", // PROVISIONAL
  "C-day2-notes-label": "Catatan kerja", // PROVISIONAL
  "C-day2-tiles-label": "Ringkasan hari", // PROVISIONAL
  "C-day2-tile-notes": "CATATAN KERJA", // PROVISIONAL
  "C-day2-tile-notes-d": "{n} belum berlabel", // PROVISIONAL
  "C-day2-tile-answers": "JAWABAN DEBRIEF", // PROVISIONAL
  "C-day2-tile-answers-v": "{answered} dari {asked}", // PROVISIONAL
  "C-day2-tile-answers-unv": "{n} tidak terverifikasi", // PROVISIONAL
  "C-day2-tile-answers-open": "{n} masih terbuka", // PROVISIONAL
  "C-day2-tile-answers-none": "Belum ada pertanyaan", // PROVISIONAL
  "C-day2-tile-check": "PERLU DICEK ANDA", // PROVISIONAL
  "C-day2-tile-check-d": "{time} · {label}", // PROVISIONAL
  "C-day2-tile-check-more": "+{n} lagi", // PROVISIONAL
  "C-day2-tile-check-none": "Tidak ada yang perlu dicek", // PROVISIONAL
  "C-day2-pill-auto": "Dilabeli otomatis", // PROVISIONAL
  "C-day2-pill-check": "Perlu dicek Anda", // PROVISIONAL
  "C-day2-debrief-h": "Debrief staf", // PROVISIONAL
  "C-day2-debrief-sub": "Pertanyaan yang diajukan Bee6 setelah tutup. Seorang staf menjawab; tidak ada nama yang disimpan.", // PROVISIONAL
  "C-day2-debrief-none": "Tidak ada pertanyaan debrief untuk hari ini.", // PROVISIONAL
  "C-day2-ans-yes": "Ya", // PROVISIONAL
  "C-day2-ans-no": "Tidak", // PROVISIONAL
  "C-day2-ans-open": "Terbuka", // PROVISIONAL
  "C-day2-lbl-body": "Bee6 memberi label momen ini {summary} sebagai {category} (keyakinan {pct}%). Pilih label yang paling cocok. Pilihan Anda dicatat sebagai keputusan supervisor.", // PROVISIONAL
  "C-web-empty-sop-h": "Belum ada SOP.", // PROVISIONAL
  "C-web-empty-sop-owner": "Unggah SOP akan segera hadir. Demo memakai SOP yang sudah disiapkan.", // PROVISIONAL
  "C-web-empty-rev-h": "Belum ada yang perlu ditinjau", // PROVISIONAL
  "C-web-empty-rev-p":
    "Saat perubahan yang disetujui mencapai tanggal tinjauannya, perubahan itu muncul di sini. Tanggal tinjauan ditetapkan saat pemilik menyetujui usulan.", // PROVISIONAL
  "C-web-empty-devices": "Belum ada HP yang terhubung.", // PROVISIONAL
  "C-web-empty-tile-value": "—",
  "C-web-empty-tile": "Belum ada data", // PROVISIONAL
  // R-25 T8: web shell (D2 `.dtop` bar, left nav) and the Reviews sub line.
  "C-web-outlet-demo": "Demo Bakery · Outlet 1", // PROVISIONAL
  "C-web-ends-at": "berakhir {time}", // PROVISIONAL
  "C-web-nav-badge": "{n} menunggu", // PROVISIONAL
  "C-web-reviews-sub": "Apakah perubahan yang disetujui berhasil?", // PROVISIONAL
  // R-25 T14: the due-review card (UI-120; no board, page-2 card idiom). Kicker, the two window tiles, their rate value.
  "C-rev2-kick": "SOP versi {version} · ditinjau pada {date}", // PROVISIONAL
  "C-rev2-windows": "Sebelum dan sesudah perubahan", // PROVISIONAL
  "C-rev2-before": "SEBELUM", // PROVISIONAL
  "C-rev2-after": "SESUDAH", // PROVISIONAL
  "C-rev2-rate": "{rate} per hari", // PROVISIONAL
  "C-rev2-rate-none": "Belum ada angka", // PROVISIONAL
} as const satisfies Record<string, string>;

export const webEN: Record<keyof typeof webID, string> = {
  "C-web-entry-strip": "DEMO OUTLET · FICTIONAL DATA",
  "C-web-entry-h1": "A small shop's day, turned into one better SOP step at a time.",
  "C-web-entry-kicker": "TRY ALL THREE ROLES · ABOUT 20 MINUTES",
  "C-web-entry-step": "STEP {n}",
  "C-web-entry-start-here": "START HERE",
  "C-web-entry-phone": "Best on a phone",
  "C-web-entry-staff-line": "Run the shop's day on the phone: speak the script cards, then answer the debrief.",
  "C-web-entry-supervisor-line": "Read the day record and check Bee6's proposals.",
  "C-web-entry-owner-line": "Approve one change and see it ship as a new SOP version.",
  "C-web-entry-footer":
    "Fictional shop, fictional data. Real shop data lives in a separate system and can't be reached from this demo. Sessions last 2 hours.",
  "C-web-pair-done-h": "Device set up",
  "C-web-pair-demo-step-1": "Keep this page open while you run the demo.",
  "C-web-pair-demo-step-2": "Allow the microphone when asked.",
  "C-web-pair-demo-step-3": "Tap Start, then speak the script cards in the judge guide.",
  "C-web-pair-demo-step-4": "End becomes available at closing time: use Jump to closing time in the judge guide.",
  "C-web-pair-digit": "Digit {n} of 6",
  "C-web-nav-label": "Main",
  "C-web-nav-home": "Home",
  "C-web-nav-day": "Day record",
  "C-web-nav-proposals": "Proposals",
  "C-web-nav-approvals": "Approvals",
  "C-web-nav-sop": "SOP",
  "C-web-nav-reviews": "Reviews",
  "C-web-nav-devices": "Connected devices",
  "C-web-demo-chip": "DEMO DATA",
  "C-web-devices-placeholder": "Connected devices · coming in this release",
  "C-web-empty-day-h": "No notes for this day yet.",
  "C-web-empty-day-p": "Notes appear after the shop phone listens and Bee6 reads the day.",
  "C-web-empty-prop-h": "No proposal yet",
  "C-web-empty-prop-p": "Bee6 needs the same problem on at least 2 days.",
  "C-web-empty-appr-h": "Nothing waiting for you.",
  "C-web-empty-appr-p": "Proposals appear here after the supervisor marks them feasible.",
  // R-25 T9: day record page (board D2-02, D2-02b).
  "C-day2-sub": "What happened on the shop day, with the words behind it.",
  "C-day2-date-nav": "Choose a day",
  "C-day2-notes-label": "Work notes",
  "C-day2-tiles-label": "Day summary",
  "C-day2-tile-notes": "WORK NOTES",
  "C-day2-tile-notes-d": "{n} not labelled",
  "C-day2-tile-answers": "DEBRIEF ANSWERS",
  "C-day2-tile-answers-v": "{answered} of {asked}",
  "C-day2-tile-answers-unv": "{n} unverified",
  "C-day2-tile-answers-open": "{n} still open",
  "C-day2-tile-answers-none": "No questions asked",
  "C-day2-tile-check": "NEED YOUR CHECK",
  "C-day2-tile-check-d": "{time} · {label}",
  "C-day2-tile-check-more": "+{n} more",
  "C-day2-tile-check-none": "Nothing to check",
  "C-day2-pill-auto": "Auto-labelled",
  "C-day2-pill-check": "Needs your check",
  "C-day2-debrief-h": "Staff debrief",
  "C-day2-debrief-sub": "Questions Bee6 asked after closing. A staff member answered; no names are kept.",
  "C-day2-debrief-none": "No debrief questions for this day.",
  "C-day2-ans-yes": "Yes",
  "C-day2-ans-no": "No",
  "C-day2-ans-open": "Open",
  "C-day2-lbl-body": "Bee6 labelled this moment {summary} as {category} ({pct}% confidence). Pick the label that fits best. Your choice is recorded as a supervisor decision.",
  "C-web-empty-sop-h": "No SOP yet.",
  "C-web-empty-sop-owner": "Uploading an SOP is coming soon. The demo uses a ready-made SOP.",
  "C-web-empty-rev-h": "Nothing to review yet",
  "C-web-empty-rev-p":
    "When an approved change reaches its review date, it appears here. Review dates are set when the owner approves a proposal.",
  "C-web-empty-devices": "No phone connected yet.",
  "C-web-empty-tile-value": "—",
  "C-web-empty-tile": "No data yet",
  "C-web-outlet-demo": "Demo Bakery · Outlet 1",
  "C-web-ends-at": "ends {time}",
  "C-web-nav-badge": "{n} waiting",
  "C-web-reviews-sub": "Did an approved change work?",
  "C-rev2-kick": "SOP version {version} · review on {date}",
  "C-rev2-windows": "Before and after the change",
  "C-rev2-before": "BEFORE",
  "C-rev2-after": "AFTER",
  "C-rev2-rate": "{rate} per day",
  "C-rev2-rate-none": "No rate yet",
};

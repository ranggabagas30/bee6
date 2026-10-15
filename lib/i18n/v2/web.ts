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
  "C-web-empty-sop-h": "Belum ada SOP.", // PROVISIONAL
  "C-web-empty-sop-owner": "Unggah SOP akan segera hadir. Demo memakai SOP yang sudah disiapkan.", // PROVISIONAL
  "C-web-empty-rev-h": "Belum ada yang perlu ditinjau", // PROVISIONAL
  "C-web-empty-rev-p": "Saat perubahan yang disetujui mencapai tanggal tinjauannya, perubahan itu muncul di sini.", // PROVISIONAL
  "C-web-empty-devices": "Belum ada HP yang terhubung.", // PROVISIONAL
  "C-web-empty-tile-value": "—",
  "C-web-empty-tile": "Belum ada data", // PROVISIONAL
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
  "C-web-empty-sop-h": "No SOP yet.",
  "C-web-empty-sop-owner": "Uploading an SOP is coming soon. The demo uses a ready-made SOP.",
  "C-web-empty-rev-h": "Nothing to review yet",
  "C-web-empty-rev-p": "When an approved change reaches its review date, it appears here.",
  "C-web-empty-devices": "No phone connected yet.",
  "C-web-empty-tile-value": "—",
  "C-web-empty-tile": "No data yet",
};

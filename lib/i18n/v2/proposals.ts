/**
 * i18n v2 slice `proposals`: copy for proposals and approvals screens (PR-12a, PR-12b).
 *
 * R-19 PR-0 scaffold; PR-12a adds the supervisor screens (plan 9.5: watch panel, generating state, proposal detail,
 * inline reject, feasible hand-over, change-label dialog). The owning PR adds its keys HERE and nowhere else;
 * `lib/i18n/dict.ts` spreads this slice once into ID and EN, so a key added here reaches `DictKey` and `t()` with
 * no edit to dict.ts. Rules (checked by v2.test.ts):
 * - the same keys in both objects (`proposalsEN` is typed from `proposalsID`, so a missing or extra EN key is a type error);
 * - a key is unique across ALL slices and the existing dictionary (name it `C-<area>-...` like the base table);
 * - values are trimmed and non-empty, with the same {placeholders} in both languages;
 * - no machine translation; mark unreviewed Bahasa with a trailing `// PROVISIONAL` comment as the base table does.
 *
 * Areas: `propw` watch panel, `propg` generating state and ask results, `propd` proposal detail and hand-over,
 * `lbl` change-label dialog. EN is final (plan 9.5 / boards D2-02b, D2-03*); every ID value is PROVISIONAL.
 */

export const proposalsID = {
  // ── Proposals page head ─────────────────────────────────────────────────────────────────────────────────
  "C-propw-sub": "Perubahan yang disarankan Bee6, berdasarkan bukti dari beberapa hari.", // PROVISIONAL
  // ── Watch panel ("What Bee6 is watching") ───────────────────────────────────────────────────────────────
  "C-propw-kicker": "YANG DIPANTAU BEE6", // PROVISIONAL
  "C-propw-note": "Masalah yang berulang, dihitung dengan aturan sederhana. Bukan tebakan.", // PROVISIONAL
  "C-propw-range": "{from} sampai {to}", // PROVISIONAL
  "C-propw-seen": "terlihat pada {dates} dari {need} hari yang dibutuhkan", // PROVISIONAL
  "C-propw-ready": "Siap", // PROVISIONAL
  "C-propw-needs": "Perlu {n} hari lagi", // PROVISIONAL
  "C-propw-proposed": "Sudah diusulkan", // PROVISIONAL
  "C-propw-ask": "Minta usulan dari Bee6", // PROVISIONAL
  "C-propw-ask-another": "Minta usulan lain", // PROVISIONAL
  "C-propw-asking": "Menanyakan Bee6…", // PROVISIONAL
  "C-propw-none": "Bukti belum cukup", // PROVISIONAL
  "C-propw-all-asked": "Semua sudah diusulkan · tidak ada bukti lain", // PROVISIONAL
  "C-propw-days": "Hari terlihat", // PROVISIONAL (aria-label of the two day marks)
  // ── Generating state and ask results ────────────────────────────────────────────────────────────────────
  "C-propg-title": "Menanyakan Bee6…", // PROVISIONAL
  "C-propg-body": "Ini bisa memakan waktu sampai satu menit. Biarkan halaman ini terbuka.", // PROVISIONAL
  "C-propg-wrote": "Bee6 menulis sebuah usulan. Buka untuk membaca buktinya.", // PROVISIONAL
  "C-propg-none-other": "Belum ada masalah lain yang siap.", // PROVISIONAL
  "C-propg-timeout": "Bee6 masih bekerja. Muat ulang halaman ini sebentar lagi.", // PROVISIONAL
  // ── Supervisor list ─────────────────────────────────────────────────────────────────────────────────────
  "C-propd-open": "Buka", // PROVISIONAL
  "C-propd-open-aria": "Buka usulan: {title}", // PROVISIONAL
  "C-propd-moments": "{n} momen · {dates}", // PROVISIONAL
  "C-propd-step-new": "Langkah baru", // PROVISIONAL
  // ── Proposal detail ─────────────────────────────────────────────────────────────────────────────────────
  "C-propd-back": "‹ Usulan", // PROVISIONAL
  "C-propd-st-yours": "Menunggu pemeriksaan Anda", // PROVISIONAL
  "C-propd-changes": "YANG BERUBAH DI SOP", // PROVISIONAL
  "C-propd-before": "Sebelumnya:", // PROVISIONAL (screen-reader prefix of the struck wording)
  "C-propd-after": "Menjadi:", // PROVISIONAL (screen-reader prefix of the new wording)
  "C-propd-evidence": "BUKTINYA · {n} MOMEN PADA {days} HARI", // PROVISIONAL
  "C-propd-metric": "PANTAU UKURAN INI", // PROVISIONAL
  "C-propd-review": "TANGGAL TINJAUAN", // PROVISIONAL
  "C-propd-note": "Layak berarti staf bisa melakukannya di toko. Pemilik menyetujui atau menolak setelah Anda.", // PROVISIONAL
  "C-propd-feasible": "Tandai layak", // PROVISIONAL
  "C-propd-reject": "Tolak… (alasan wajib)", // PROVISIONAL
  "C-propd-reject-label": "Mengapa ini tidak bisa dijalankan? (wajib)", // PROVISIONAL
  "C-propd-reject-hint": "Tulis alasan singkat. Bee6 mengingatnya dan tidak akan menyarankan hal yang sama lagi.", // PROVISIONAL
  "C-propd-reject-send": "Tolak usulan", // PROVISIONAL
  "C-propd-feasible-h": "Ditandai layak.", // PROVISIONAL
  "C-propd-feasible-p": "Pemilik yang memutuskan berikutnya.", // PROVISIONAL
  "C-propd-feasible-done": "Ditandai layak ✓", // PROVISIONAL
  "C-propd-back-list": "Kembali ke usulan", // PROVISIONAL
  "C-propd-rejected": "Ditolak. Alasan Anda kini menjadi aturan yang dipatuhi Bee6.", // PROVISIONAL
  // ── Change-label dialog ─────────────────────────────────────────────────────────────────────────────────
  "C-lbl-title": "Ubah label", // PROVISIONAL
  "C-lbl-body": "Bee6 memberi label {category} pada momen ini. Pilih label yang paling cocok. Pilihan Anda dicatat sebagai keputusan supervisor.", // PROVISIONAL
  "C-lbl-group": "Label", // PROVISIONAL
  "C-lbl-current": "Pilihan Bee6", // PROVISIONAL
  "C-lbl-runner-up": "pilihan kedua", // PROVISIONAL
  "C-lbl-save": "Simpan label", // PROVISIONAL
} as const satisfies Record<string, string>;

export const proposalsEN: Record<keyof typeof proposalsID, string> = {
  "C-propw-sub": "Changes Bee6 suggests, based on several days of evidence.",
  "C-propw-kicker": "WHAT BEE6 IS WATCHING",
  "C-propw-note": "Repeated problems, counted by plain rules. Not a guess.",
  "C-propw-range": "{from} to {to}",
  "C-propw-seen": "seen on {dates} of {need} days needed",
  "C-propw-ready": "Ready",
  "C-propw-needs": "Needs {n} more day",
  "C-propw-proposed": "Proposed",
  "C-propw-ask": "Ask Bee6 for a proposal",
  "C-propw-ask-another": "Ask for another proposal",
  "C-propw-asking": "Asking Bee6…",
  "C-propw-none": "Not enough evidence yet",
  "C-propw-all-asked": "All asked · no more evidence to use",
  "C-propw-days": "Days seen",
  "C-propg-title": "Asking Bee6…",
  "C-propg-body": "This can take up to a minute. Keep this page open.",
  "C-propg-wrote": "Bee6 wrote a proposal. Open it to read the evidence.",
  "C-propg-none-other": "No other problem is ready yet.",
  "C-propg-timeout": "Bee6 is still working. Reload this page in a moment.",
  "C-propd-open": "Open",
  "C-propd-open-aria": "Open proposal: {title}",
  "C-propd-moments": "{n} moments · {dates}",
  "C-propd-step-new": "New step",
  "C-propd-back": "‹ Proposals",
  "C-propd-st-yours": "Waiting for your check",
  "C-propd-changes": "WHAT CHANGES IN THE SOP",
  "C-propd-before": "Before:",
  "C-propd-after": "After:",
  "C-propd-evidence": "THE EVIDENCE · {n} MOMENTS ON {days} DAYS",
  "C-propd-metric": "WATCH THIS METRIC",
  "C-propd-review": "REVIEW DATE",
  "C-propd-note": "Feasible means staff can do this in the shop. The owner approves or rejects after you.",
  "C-propd-feasible": "Mark feasible",
  "C-propd-reject": "Reject… (reason required)",
  "C-propd-reject-label": "Why is this not workable? (required)",
  "C-propd-reject-hint": "Give a short reason. Bee6 remembers it and will not suggest the same thing again.",
  "C-propd-reject-send": "Reject proposal",
  "C-propd-feasible-h": "Marked feasible.",
  "C-propd-feasible-p": "The owner decides next.",
  "C-propd-feasible-done": "Marked feasible ✓",
  "C-propd-back-list": "Back to proposals",
  "C-propd-rejected": "Rejected. Your reason is now a rule Bee6 will respect.",
  "C-lbl-title": "Change label",
  "C-lbl-body": "Bee6 labelled this moment {category}. Pick the label that fits best. Your choice is recorded as a supervisor decision.",
  "C-lbl-group": "Label",
  "C-lbl-current": "Bee6 pick",
  "C-lbl-runner-up": "runner-up",
  "C-lbl-save": "Save label",
};

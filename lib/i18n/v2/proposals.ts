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
  "C-propg-title": "Bee6 sedang menulis usulan", // PROVISIONAL
  "C-propg-body": "Ini bisa memakan waktu sampai satu menit. Mohon biarkan halaman ini terbuka.", // PROVISIONAL
  "C-propg-est": "Biasanya {min}–{max} detik: Bee6 membaca SOP dan buktinya dulu sebelum menulis. Biarkan halaman ini terbuka.", // PROVISIONAL (R-24: shown only while the v4 flag is on)
  "C-propg-over": "Lebih lama dari biasanya. Bee6 masih bekerja. Biarkan halaman ini terbuka.", // PROVISIONAL (R-24: after the range has passed)
  "C-propg-wrote": "Bee6 menulis sebuah usulan. Buka untuk membaca buktinya.", // PROVISIONAL
  "C-propg-none-other": "Belum ada masalah lain yang siap.", // PROVISIONAL
  "C-propg-timeout": "Bee6 masih bekerja. Muat ulang halaman ini sebentar lagi.", // PROVISIONAL
  // ── Supervisor list ─────────────────────────────────────────────────────────────────────────────────────
  "C-propd-open": "Tinjau", // PROVISIONAL
  "C-propd-open-aria": "Tinjau usulan: {title}", // PROVISIONAL
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
  "C-propd-back-list": "Kembali ke usulan", // PROVISIONAL
  "C-propd-rejected": "Ditolak. Alasan Anda kini menjadi aturan yang dipatuhi Bee6.", // PROVISIONAL
  // ── Change-label dialog ─────────────────────────────────────────────────────────────────────────────────
  "C-lbl-title": "Ubah label", // PROVISIONAL
  "C-lbl-body": "Bee6 memberi label {category} pada momen ini. Pilih label yang paling cocok. Pilihan Anda dicatat sebagai keputusan supervisor.", // PROVISIONAL
  "C-lbl-group": "Label", // PROVISIONAL
  "C-lbl-current": "Pilihan Bee6", // PROVISIONAL
  "C-lbl-runner-up": "pilihan kedua", // PROVISIONAL
  "C-lbl-save": "Simpan label", // PROVISIONAL
  // ── R-25 T10 (G4a): page-2 supervisor proposals (boards D2-03, 03a, 03b, 03d, 03f, 03g). Append-only. ───────
  "C-propw-notseen": "Belum terlihat", // PROVISIONAL
  "C-propw-all-asked-demo": "Keduanya sudah diminta · tidak ada bukti lain", // PROVISIONAL
  "C-propw-one-h": "Satu usulan bisa dibuat sekarang", // PROVISIONAL
  "C-propw-one-p": "Masalah tanggal pembuatan muncul pada 2 hari. Untuk usulan kedua, jalankan hari ke-3 di ponsel staf dulu, lalu minta. Setelah Anda meminta usulan, “Lompat ke besok” terkunci.", // PROVISIONAL
  "C-propd-st-yours-list": "Menunggu Anda", // PROVISIONAL
  "C-propd-reject-h": "Tolak usulan ini?", // PROVISIONAL
  "C-propd-feasible-owner": "Keluar lalu pilih Pemilik untuk menyetujui atau menolak.", // PROVISIONAL
  "C-propd-rules": "Aturan untuk Bee6 (opsional)", // PROVISIONAL
  // ── Owner approvals = page-1 W8 "Review in order" (PR-12b; boards D2-08, D2-08c, D2-08d, D2-08e) ──────────
  "C-propa-back-home": "‹ Kembali ke beranda", // PROVISIONAL
  "C-propa-sub": "Satu usulan sekaligus, sesuai urutan yang disarankan. Supervisor sudah memeriksa bahwa setiap usulan bisa dijalankan.", // PROVISIONAL
  "C-propa-progress": "{done} dari {total} diputuskan", // PROVISIONAL (aria-label of the progress segments)
  "C-propa-order": "URUTAN YANG DISARANKAN", // PROVISIONAL
  "C-propa-st-waiting": "Menunggu Anda", // PROVISIONAL
  "C-propa-now": "Sedang ditinjau", // PROVISIONAL (the current item in the order list)
  "C-propa-why": "MENGAPA", // PROVISIONAL
  "C-propa-extra": "KERJA TAMBAHAN UNTUK STAF", // PROVISIONAL
  "C-propa-cost": "BIAYA", // PROVISIONAL
  "C-propa-cost-value": "Belum diperkirakan", // PROVISIONAL
  "C-propa-cost-soon": "segera hadir", // PROVISIONAL
  "C-propa-starts-after": "Mulai sehari setelah disetujui", // PROVISIONAL
  "C-propa-starts": "Mulai {date}", // PROVISIONAL
  "C-propa-dates": "{starts} · tinjauan {review}", // PROVISIONAL
  "C-propa-shipped": "Terbit sebagai SOP versi {version}", // PROVISIONAL
  "C-propa-decided-on": "Diputuskan {date}", // PROVISIONAL
  "C-propa-decision": "Keputusan Anda", // PROVISIONAL
  "C-propa-approve": "Setujui", // PROVISIONAL
  "C-propa-approve-na": "Setujui · tidak tersedia", // PROVISIONAL
  "C-propa-sop-changed": "SOP berubah setelah usulan ini dibuat. Anda masih bisa menolaknya dengan alasan.", // PROVISIONAL
  "C-propa-reject-label": "Tolak — mengapa?", // PROVISIONAL
  "C-propa-reject-hint": "Tulis alasan singkat dulu. Alasan itu menjadi aturan yang dipatuhi Bee6.", // PROVISIONAL
  "C-propa-reject-send": "Tolak dengan alasan", // PROVISIONAL
  "C-propa-done-approved": "Disetujui. Perubahan ini terbit sebagai versi SOP baru.", // PROVISIONAL
  "C-propa-done-rejected": "Ditolak. Alasan Anda kini menjadi aturan yang dipatuhi Bee6.", // PROVISIONAL
  "C-propa-all-both": "Keduanya sudah diputuskan. Tenang dan rapi.", // PROVISIONAL
  "C-propa-all": "Semua sudah diputuskan.", // PROVISIONAL
  "C-propa-rule": "Kini menjadi aturan: {reason}", // PROVISIONAL
  "C-propa-rule-none": "Kini menjadi aturan yang dipatuhi Bee6.", // PROVISIONAL
  "C-propa-next-h": "APA SELANJUTNYA", // PROVISIONAL
  "C-propa-next-p": "Perubahan yang disetujui masuk ke SOP sejak tanggal mulainya. Bee6 memantau ukurannya sampai tanggal tinjauan, lalu tinjauan menunjukkan apakah perubahan itu berhasil. Setiap alasan yang Anda tulis menjadi aturan yang dipatuhi Bee6 pada usulan berikutnya.", // PROVISIONAL
  "C-propa-home": "Kembali ke beranda", // PROVISIONAL
  "C-propa-see-sop": "Lihat SOP", // PROVISIONAL
  // ── R-25 T11 (G4b): page-2 owner approvals (boards D2-08, 08c, 08d, 08e). Append-only. ──────────────────────
  "C-propa-kicker": "PERSETUJUAN · {n} DARI {total} · SISA {left}", // PROVISIONAL
  "C-propa-kicker-done": "PERSETUJUAN · SELESAI", // PROVISIONAL
  "C-propa-meta": "#{n} · supervisor: layak dijalankan {date}", // PROVISIONAL
  "C-propa-evidence-h": "Mengapa Bee6 menyarankan ini", // PROVISIONAL
  "C-propa-pace-why": "Persetujuan membuat versi SOP baru. Versi lama tetap ada di buku SOP.", // PROVISIONAL
  "C-propa-pace-one": "Setelah Anda menyetujui satu perubahan, yang lain hanya bisa ditolak.", // PROVISIONAL
  "C-propa-na-h": "Tidak tersedia: SOP berubah", // PROVISIONAL
  "C-propa-na-why": "Usulan ini dibuat pada versi SOP yang lama, jadi hanya bisa ditolak. Alasan penolakan menjadi aturan yang dipatuhi Bee6.", // PROVISIONAL
  "C-propa-reject-ph": "Mengapa ini tidak bisa dijalankan?", // PROVISIONAL
  "C-propa-all-counts": "{approved} disetujui, {rejected} ditolak.", // PROVISIONAL
  "C-propa-all-starts": "Perubahan yang disetujui mulai {starts} dan ditinjau pada {review}.", // PROVISIONAL
  "C-propa-st-approved-starts": "Disetujui · mulai {date}", // PROVISIONAL
  "C-propa-st-rejected-rule": "Ditolak · kini menjadi aturan", // PROVISIONAL
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
  "C-propg-title": "Bee6 is writing a proposal",
  "C-propg-body": "This can take up to a minute. Please keep this page open.",
  "C-propg-est": "Usually {min}–{max} seconds: Bee6 reads the SOP and the evidence before it writes. Keep this page open.",
  "C-propg-over": "Taking longer than usual. Bee6 is still working. Keep this page open.",
  "C-propg-wrote": "Bee6 wrote a proposal. Open it to read the evidence.",
  "C-propg-none-other": "No other problem is ready yet.",
  "C-propg-timeout": "Bee6 is still working. Reload this page in a moment.",
  "C-propd-open": "Review",
  "C-propd-open-aria": "Review proposal: {title}",
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
  "C-propd-back-list": "Back to proposals",
  "C-propd-rejected": "Rejected. Your reason is now a rule Bee6 will respect.",
  "C-lbl-title": "Change label",
  "C-lbl-body": "Bee6 labelled this moment {category}. Pick the label that fits best. Your choice is recorded as a supervisor decision.",
  "C-lbl-group": "Label",
  "C-lbl-current": "Bee6 pick",
  "C-lbl-runner-up": "runner-up",
  "C-lbl-save": "Save label",
  "C-propw-notseen": "Not seen yet",
  "C-propw-all-asked-demo": "Both asked · no more evidence to use",
  "C-propw-one-h": "One proposal can be made now",
  "C-propw-one-p": "The bake-date problem showed on 2 days. For a second proposal, run day 3 on the staff phone first, then ask. After you ask for a proposal, “Jump to tomorrow” is locked.",
  "C-propd-st-yours-list": "Waiting for you",
  "C-propd-reject-h": "Reject this proposal?",
  "C-propd-feasible-owner": "Sign out and pick Owner to approve or reject.",
  "C-propd-rules": "Rules for Bee6 (optional)",
  "C-propa-back-home": "‹ Back to home",
  "C-propa-sub": "One proposal at a time, in the recommended order. The supervisor already checked that each one is workable.",
  "C-propa-progress": "{done} of {total} decided",
  "C-propa-order": "RECOMMENDED ORDER",
  "C-propa-st-waiting": "Waiting for you",
  "C-propa-now": "Reviewing now",
  "C-propa-why": "WHY",
  "C-propa-extra": "EXTRA WORK FOR STAFF",
  "C-propa-cost": "COST",
  "C-propa-cost-value": "Not estimated yet",
  "C-propa-cost-soon": "coming soon",
  "C-propa-starts-after": "Starts the day after approval",
  "C-propa-starts": "Starts {date}",
  "C-propa-dates": "{starts} · review {review}",
  "C-propa-shipped": "Shipped as SOP version {version}",
  "C-propa-decided-on": "Decided {date}",
  "C-propa-decision": "Your decision",
  "C-propa-approve": "Approve",
  "C-propa-approve-na": "Approve · not available",
  "C-propa-sop-changed": "The SOP changed after this was drafted. You can still reject it with a reason.",
  "C-propa-reject-label": "Reject — why?",
  "C-propa-reject-hint": "Write a short reason first. It becomes a rule Bee6 will respect.",
  "C-propa-reject-send": "Reject with reason",
  "C-propa-done-approved": "Approved. It ships as a new SOP version.",
  "C-propa-done-rejected": "Rejected. Your reason is now a rule Bee6 will respect.",
  "C-propa-all-both": "Both decided. Nice and calm.",
  "C-propa-all": "All decided.",
  "C-propa-rule": "Now a rule: {reason}",
  "C-propa-rule-none": "Now a rule Bee6 will respect.",
  "C-propa-next-h": "WHAT HAPPENS NEXT",
  "C-propa-next-p": "The approved change is in the SOP from its start date. Bee6 watches its metric until the review date, then the review shows whether it worked. Every reason you wrote is a rule Bee6 respects in future proposals.",
  "C-propa-home": "Back to home",
  "C-propa-see-sop": "See the SOP",
  // ── R-25 T11 (G4b): page-2 owner approvals (boards D2-08, 08c, 08d, 08e). Append-only. ──────────────────────
  "C-propa-kicker": "APPROVALS · {n} OF {total} · {left} LEFT",
  "C-propa-kicker-done": "APPROVALS · DONE",
  "C-propa-meta": "#{n} · supervisor: feasible {date}",
  "C-propa-evidence-h": "Why Bee6 suggests this",
  "C-propa-pace-why": "Approving creates a new SOP version. The old version stays in the SOP book.",
  "C-propa-pace-one": "After you approve one change, the other can only be rejected.",
  "C-propa-na-h": "Not available: the SOP changed",
  "C-propa-na-why": "This proposal was drafted on the old SOP version, so it can only be rejected. A rejection reason becomes a rule Bee6 respects.",
  "C-propa-reject-ph": "Why is this not workable?",
  "C-propa-all-counts": "{approved} approved, {rejected} rejected.",
  "C-propa-all-starts": "The approved change starts on {starts} and is reviewed on {review}.",
  "C-propa-st-approved-starts": "Approved · starts {date}",
  "C-propa-st-rejected-rule": "Rejected · now a rule",
};

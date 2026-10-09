import type { Lang } from "@/lib/i18n/lang";

/**
 * Typed copy dictionary for the shop-phone screens (UX-03 section 6, copy
 * sheet). Bahasa Indonesia is the source table; English must satisfy the same
 * keys (checked by the type of EN and by lib/i18n/dict.test.ts). Keys keep the
 * copy sheet's names so every string traces back to its row.
 *
 * Keys marked PROVISIONAL are not in the copy sheet. They are unreviewed
 * wording for states that exist on main today, and need Rangga's sign-off.
 *
 * No machine translation and no string from the server is rendered directly:
 * server error codes map to keys (lib/i18n/codes.ts). Placeholders are written
 * as {name} and filled by t(); a missing value throws.
 */

export const ID = {
  // Switch control (shop top bar). Endonyms are the same in both modes.
  "C-lang-group": "Pilih bahasa",
  "C-lang-id": "Bahasa Indonesia",
  "C-lang-en": "English",
  "C-lang-said": "Bahasa Indonesia dipilih.",

  // /pair
  "C-pair-title": "Pasang perangkat ini",
  "C-pair-help": "Masukkan 6 digit kode dari orang yang memasang HP ini.",
  "C-pair-label": "Kode 6 digit",
  "C-pair-need": "Isi 6 digit untuk bisa memasang.",
  "C-b-pasang": "Pasang",
  "C-pair-busy": "Memasangkan…",
  "C-pair-refused": "Kode tidak dikenali atau sudah dipakai. Minta kode baru dari orang yang memasang HP ini.",
  "C-pair-net": "Tidak ada koneksi. Coba lagi saat sinyal stabil.",
  "C-pair-ok-h": "HP terpasang",
  "C-pair-ok-line": "Untuk outlet {outlet_id}",
  "C-pair-srv": "Server belum bisa memproses ini. Coba lagi sebentar.", // PROVISIONAL: not in the copy sheet (server 5xx line)
  "C-pair-step-1": "Letakkan HP di tempat tetap dan colokkan charger.",
  "C-pair-step-2": "Layar tetap menyala dan halaman ini tetap terbuka. Menutup halaman berarti tidak mendengarkan.",
  "C-pair-step-3": "Mulai bisa ditekan 01:00 sampai {until}, tiap hari buka.",
  "C-pair-step-4": "Selesai muncul 4 jam setelah Mulai.",
  "C-b-buka-mendengarkan": "Buka halaman mendengarkan",

  // /capture headline, states and helpers
  "C-cap-title": "HP toko", // one fixed neutral heading on every state (UX-03, 7 Oct)
  "C-h-loading": "Memuat…",
  "C-h-error": "Jam buka belum termuat",
  "C-h-error-help": "Jam buka belum termuat. Sambung internet sekali, lalu buka.",
  "C-h-unsupported": "Browser ini belum didukung",
  "C-h-unsupported-help": "Buka halaman ini di browser lain, lalu coba lagi.",
  "C-h-listening": "Mendengarkan",
  "C-h-mic": "Mikrofon bermasalah · tidak mendengarkan",
  "C-h-mic-help": "Cek izin mikrofon di browser, lalu coba lagi.",
  "C-cap-waiting": "{N} menunggu dikirim", // PROVISIONAL
  "C-cap-capturing": "Suara sedang direkam", // PROVISIONAL
  "C-cap-mic": "Mikrofon: {source}", // PROVISIONAL (format from HANDOFF)
  "C-cap-rate": "Sample rate mikrofon ini tidak didukung.", // PROVISIONAL
  "C-cap-staff": "Staf (segera hadir)", // PROVISIONAL
  "C-cap-hours-h": "Dijeda · di luar jam buka", // PROVISIONAL
  "C-cap-hours-b": "Mendengarkan berjalan dari pukul {from} sampai {to} ({tz}). Akan mulai lagi otomatis saat jam buka.", // PROVISIONAL

  // Upload status block (UX-03 section 5.7, copy sheet section 6).
  "C-u-up": "Mengunggah",
  "C-u-retry": "Belum terkirim · mencoba lagi",
  "C-u-count": "({N}x)", // count suffix for C-u-retry; the sheet row shows it as "({N}x)"
  "C-u-server": "Server sibuk",
  "C-u-inet": "Tidak ada internet. Sambungkan agar antrean terkirim.", // shown only when navigator.onLine is false
  "C-u-ok": "Unggah berhasil",
  "C-u-lost": "Sebagian suara tidak tercatat",
  "C-u-lost-help": "Catatan itu jadi tidak lengkap. Tidak bisa dipulihkan.", // lost-line helper, in the copy sheet (UX-03 copy keys; UX-03 section 5.7 row L, decision F)
  "C-u-toast": "Unggah berhasil lagi",
  "C-h-idle": "Belum mulai",
  "C-h-idle-help": "Ketuk Mulai untuk memulai sesi hari ini.", // shown only when Mulai is offered (UX-03 5.2)
  "C-h-ended-auto": "Selesai otomatis pukul {time}",
  "C-h-ended": "Selesai",
  "C-h-discarded": "Sesi dibatalkan",
  "C-m-closed": "Hari ini tutup. Mulai berikutnya {date} pukul 01:00.",
  "C-m-window-passed": "Batas Mulai hari ini sudah lewat pukul {time}. Hari ini dicatat libur. Mulai lagi {date} pukul 01:00.",
  "C-m-day-ended": "Hari operasional {endedDate} sudah selesai. Mulai bisa ditekan lagi {date} pukul {time}.",
  "C-m-debrief": "Debrief berlangsung sampai pukul {debriefUntil}. Mulai bisa ditekan lagi {date} pukul {time}.",
  "C-notice-pilot": "Suara diubah jadi catatan kerja singkat. Rekaman suara tidak disimpan.", // capture privacy notice, pilot (UX-03 §5.10)

  // Mulai / Selesai / Batalkan (UX-03 sections 5.4-5.6, copy sheet section 6; R-P1).
  "C-b-mulai": "Mulai",
  "C-b-mulai-busy": "Memulai…",
  "C-b-selesai": "Selesai",
  "C-n-selesai-from": "Selesai bisa ditekan mulai pukul {time}.",
  "C-c-selesai-h": "Akhiri operasional hari ini?",
  "C-c-selesai-b": "Debrief 1 jam dimulai sekarang. Tidak bisa dikembalikan. Mulai baru bisa ditekan lagi {date} pukul {time}.",
  "C-b-belum-lanjut": "Belum, lanjut",
  "C-b-ya-selesai": "Ya, selesai",
  "C-b-batalkan": "Batalkan sesi",
  "C-c-cancel-h": "Batalkan sesi yang dimulai pukul {time}?",
  "C-c-cancel-b": "Suara dan catatan sesi ini akan dihapus. Tidak bisa dikembalikan. Hari ini tidak dihitung. Mulai baru bisa ditekan lagi {date} pukul 01:00.",
  "C-c-cancel-b-now": "Suara dan catatan sesi ini akan dihapus. Tidak bisa dikembalikan. Hari ini tidak dihitung. Mulai baru bisa ditekan segera.",
  "C-b-tetap-simpan": "Tetap simpan sesi",
  "C-b-ya-hapus": "Ya, hapus sesi",
  "C-c-autoclose": "Panel ditutup. Tidak ada yang berubah.",
  "C-srv-pending": "Menghapus dari server…",
  "C-srv-offline": "Akan dihapus saat online",
  "C-srv-done": "Sudah dihapus",
  // PROVISIONAL: no approved row exists in the UX-03 copy sheet for a Mulai/
  // Selesai rejection or a Batalkan-after-ended race. Needed so the server's
  // raw error.message is never rendered (hard rule, lib/i18n/codes.ts); needs
  // UI/UX sign-off.
  "C-sess-err": "Tidak bisa memproses itu. Coba lagi.",
  "C-c-discard-failed": "Sesi ini sudah berakhir. Muat ulang halaman.",

  // Debrief (R-07, UX-03 section 6, 5.8). Shared buttons first, then the
  // entry card, question screen, done screen and timeout, in screen order.
  "C-b-kembali": "Kembali",
  "C-b-lewati": "Lewati",
  "C-b-lanjut": "Lanjut",
  "C-b-coba": "Coba lagi",

  "C-d-entry-h": "Debrief berjalan",
  "C-d-entry-left": "Sisa {mm} menit.",
  "C-d-entry-n": "{N} pertanyaan.",
  "C-d-btn": "Jawab pertanyaan",
  "C-d-takes": "Butuh sekitar 5 menit.",
  "C-d-next": "Mulai bisa ditekan lagi {day} pukul {hm}.",

  "C-d-load": "Memuat pertanyaan…",
  "C-d-load-2": "Biasanya beberapa detik.",
  "C-d-err": "Pertanyaan belum bisa dimuat.",
  "C-d-err-2": "Cek koneksi, lalu coba lagi.",
  "C-d-empty-h": "Tidak ada pertanyaan hari ini.",
  "C-d-empty-h-2": "Terima kasih.",

  "C-d-prog": "Pertanyaan {N} dari {M}",
  "C-d-q-step": "Sekitar pukul {hm} ada {step}. Benar?",
  "C-d-q-block": "Sekitar pukul {hm}–{hm_end} ada kegiatan kerja. Benar?",
  // ID is one line (the EN template is two); the question screen skips an
  // empty line, so this is deliberately "" (dict.test.ts allows only this key).
  "C-d-q-block-2": "",
  "C-d-yes": "Ya",
  "C-d-no": "Tidak",
  "C-d-r-yes": "Sudah sesuai SOP? Kalau belum, kenapa?",
  "C-d-r-yes-2": "Wajib diisi, tanpa nama.",
  "C-d-r-no": "Kenapa tidak? Ceritakan singkat.",
  "C-d-r-no-2": "Wajib diisi, tanpa nama.",
  "C-d-count": "{N}/500",
  "C-d-count-warn": "{N}/500 · {M} lagi",
  "C-d-over": "Terlalu panjang. Kurangi {N} karakter.",
  "C-d-help-dis": "Pilih Ya atau Tidak, lalu isi alasan.",
  "C-d-locked": "Jawaban yang sudah Lanjut tidak bisa diubah.",

  "C-d-save-fail": "Jawaban belum tersimpan di HP ini.",
  "C-d-save-fail-2": "HP tidak bisa menyimpan. Teks kamu masih ada.",
  "C-d-save-fail-3": "Coba Lanjut lagi.",
  "C-d-refused": "Belum terkirim. Akan dicoba lagi otomatis.",
  "C-d-refused-2": "Jawaban tetap tersimpan di HP ini.",
  "C-d-offline": "Tersimpan di HP. Akan dikirim saat online.",

  "C-d-done-h": "Debrief selesai. Terima kasih.",
  "C-d-done-l": "Jawabanmu sudah tersimpan.",
  "C-d-done-unsent": "Masih ada {N} jawaban belum terkirim.",
  "C-d-done-unsent-2": "Akan dikirim saat online.",
  "C-d-done-skip": "{N} pertanyaan dilewati.",
  "C-d-done-skip-2": "Bisa dijawab sampai pukul {hm}.",
  "C-d-done-mulai": "Mulai bisa ditekan lagi {day} pukul {hm}.",
  "C-d-timeout": "Waktu debrief habis pukul {hm}.",
  "C-d-timeout-2": "Jawaban yang sudah Lanjut tetap tersimpan.",
  "C-d-timeout-3": "Teks yang belum Lanjut tidak tersimpan.",

  // EN singular forms (count = 1; section 5.12.4). Bahasa has no plural, so
  // every ID value here is byte-identical to its plural-row counterpart above.
  "C-d-entry-left-one": "Sisa {mm} menit.",
  "C-d-entry-n-one": "{N} pertanyaan.",
  "C-d-over-one": "Terlalu panjang. Kurangi {N} karakter.",
  "C-d-done-unsent-one": "Masih ada {N} jawaban belum terkirim.",
  "C-d-done-skip-one": "{N} pertanyaan dilewati.",

  // /sign-in (R-06 Task 4.8) — owner/supervisor email + password sign-in.
  // All PROVISIONAL unless noted: UX-03 did not design this screen.
  "C-signin-title": "Masuk", // PROVISIONAL
  "C-signin-help": "Untuk pemilik dan supervisor. Akun disiapkan oleh bee6.", // PROVISIONAL
  "C-signin-email": "Email", // PROVISIONAL
  "C-signin-password": "Kata sandi", // PROVISIONAL
  "C-signin-submit": "Masuk", // PROVISIONAL
  "C-signin-busy": "Sedang masuk…", // PROVISIONAL
  "C-signin-empty": "Isi email dan kata sandi.", // PROVISIONAL
  "C-signin-bad": "Email atau kata sandi salah.", // PROVISIONAL
  "C-signin-many": "Terlalu banyak percobaan. Tunggu beberapa menit.", // PROVISIONAL
  "C-signin-denied": "Akun ini tidak punya akses ke bee6.", // PROVISIONAL
  "C-signin-net": "Tidak ada koneksi. Coba lagi saat sinyal stabil.", // PROVISIONAL
  "C-signin-config": "Masuk belum disiapkan di server ini.", // PROVISIONAL
  "C-srv-generic": "Ada masalah. Coba lagi.", // PROVISIONAL
  "C-web-signout": "Keluar", // PROVISIONAL

  // /day (R-06 Task 6) — the day record screen, owner and supervisor.
  "C-day-title": "Catatan hari", // PROVISIONAL
  "C-day-prev": "Hari sebelumnya", // PROVISIONAL (aria-label)
  "C-day-next": "Hari berikutnya", // PROVISIONAL (aria-label)
  "C-day-off-closed": "Libur / tutup", // UX-03 §14 reference
  "C-day-pending": "Belum dimulai", // PROVISIONAL
  "C-day-cancelled": "Sesi dibatalkan: {N}", // UX-03 §14 reference
  "C-day-mode-room": "Mode: ruangan", // web spec §4.3
  "C-day-mode-wearable": "Mode: wearable", // web spec §4.3
  "C-day-mode-none": "Mode: belum ada HP terpasang", // PROVISIONAL
  "C-day-counts": "Fakta: {facts} · Pertanyaan: {questions}", // PROVISIONAL (supervisor)
  "C-day-counts-owner": "Fakta: {facts}", // PROVISIONAL (owner)
  "C-day-filter-group": "Saring menurut kategori", // PROVISIONAL
  "C-day-filter-all": "Semua ({N})", // PROVISIONAL
  "C-day-filter-cat": "{label} ({N})", // PROVISIONAL
  "C-day-empty": "Tidak ada catatan kerja untuk tanggal ini.", // PROVISIONAL
  "C-day-empty-2": "Catatan muncul beberapa menit setelah percakapan.", // PROVISIONAL
  "C-day-empty-owner": "Belum ada fakta terkonfirmasi untuk tanggal ini.", // PROVISIONAL (owner)
  "C-day-truncated": "Menampilkan {N} catatan pertama.", // PROVISIONAL
  "C-day-time": "{start}–{end}", // PROVISIONAL
  "C-day-confidence": "Keyakinan {pct}%", // PROVISIONAL
  "C-day-no-summary": "Tidak ada ringkasan.", // PROVISIONAL
  "C-day-evidence": "Bukti", // PROVISIONAL
  "C-day-evidence-more": "+{N} baris lagi", // PROVISIONAL
  "C-day-ans-yes": "Seorang staf menjawab Ya:", // R-07 ux-notes §4.4
  "C-day-ans-no": "Seorang staf menjawab Tidak:", // R-07 ux-notes §4.4
  "C-day-st-fact": "Fakta", // PROVISIONAL
  "C-day-st-fact-staff": "Fakta, dikonfirmasi staf", // PROVISIONAL
  "C-day-st-fact-supervisor": "Fakta, dikonfirmasi supervisor", // PROVISIONAL
  "C-day-st-open": "Pertanyaan, menunggu debrief", // PROVISIONAL
  "C-day-st-answered": "Sudah dijawab, belum jadi fakta", // PROVISIONAL
  "C-day-st-supervisor": "Menunggu supervisor", // PROVISIONAL
  "C-day-st-rejected": "Ditolak staf", // UX-03 §14 / R-07 ux-notes §4.4
  "C-day-st-rejected-supervisor": "Ditolak supervisor", // PROVISIONAL (v4, Task 15.0)
  "C-day-st-unverified": "Tidak terverifikasi", // PROVISIONAL
  "C-day-err": "Catatan belum bisa dimuat.", // PROVISIONAL
  "C-day-retry": "Coba lagi", // PROVISIONAL
  "C-day-forbidden": "Akun ini tidak bisa melihat catatan hari.", // PROVISIONAL
  "C-day-invalid": "Tanggal ini tidak tersedia.", // PROVISIONAL
  "C-day-to-today": "Ke hari ini", // PROVISIONAL
  "C-day-loading": "Memuat…", // PROVISIONAL
  "C-cat-ROUTINE_OPS": "Pekerjaan rutin", // PROVISIONAL (Q-U23 family)
  "C-cat-CUSTOMER_SERVICE": "Layanan pelanggan", // PROVISIONAL
  "C-cat-TRAINING": "Pelatihan", // PROVISIONAL
  "C-cat-STAFF_CONSULT": "Pertanyaan staf", // PROVISIONAL
  "C-cat-CORRECTION": "Koreksi", // PROVISIONAL
  "C-cat-PHONE_CALL": "Telepon", // PROVISIONAL
  "C-cat-EVENT": "Acara terencana", // PROVISIONAL
  "C-cat-COMPLAINT": "Keluhan pelanggan", // PROVISIONAL
  "C-cat-SAFETY_INCIDENT": "Insiden keselamatan", // PROVISIONAL
  "C-cat-SECURITY_INCIDENT": "Insiden keamanan", // PROVISIONAL
  "C-cat-DISRUPTION": "Gangguan operasional", // PROVISIONAL

  // Runner-up panel (R-06 Task 11), appended to the PR-3 block.
  "C-day-runnerup": "Pilihan kedua: {label}", // PROVISIONAL
  "C-day-runnerup-none": "Tidak ada alasan.", // PROVISIONAL
  "C-cat-NON_WORK": "Bukan obrolan kerja", // PROVISIONAL

  // Supervisor confirm/override (R-06 Task 10), appended to the PR-5 block.
  "C-act-confirm": "Konfirmasi", // PROVISIONAL
  "C-act-change": "Ubah kategori", // PROVISIONAL
  "C-act-select": "Kategori baru", // PROVISIONAL
  "C-act-save": "Simpan", // PROVISIONAL
  "C-act-cancel": "Batal", // PROVISIONAL
  "C-act-busy": "Menyimpan…", // PROVISIONAL
  "C-act-blocked": "Tidak bisa dikonfirmasi: tidak ada baris bukti.", // PROVISIONAL
  "C-act-stale": "Catatan ini berubah. Menampilkan yang terbaru.", // PROVISIONAL

  // Supervisor reject (R-06 Task 15, v4), appended to the Task 10 block.
  "C-act-reject": "Tolak", // PROVISIONAL
  "C-act-reject-q": "Tolak catatan ini? Catatan ini tidak dihitung sebagai bukti.", // PROVISIONAL
  "C-act-reject-yes": "Ya, tolak", // PROVISIONAL

  // /home (R-06 Task 14a) — owner home, "today in 5 lines".
  "C-home-title": "Hari ini", // PROVISIONAL
  "C-home-more": "+{N} lagi di catatan hari", // PROVISIONAL
  "C-home-to-day": "Buka catatan hari", // PROVISIONAL
  "C-day-to-home": "Beranda", // PROVISIONAL
} as const;

export type DictKey = keyof typeof ID;

export const EN: Record<DictKey, string> = {
  "C-lang-group": "Choose language",
  "C-lang-id": "Bahasa Indonesia",
  "C-lang-en": "English",
  "C-lang-said": "English selected.",

  "C-pair-title": "Set up this device",
  "C-pair-help": "Enter the 6-digit code from the person who set up this phone.",
  "C-pair-label": "6-digit code",
  "C-pair-need": "Enter all 6 digits to set up.",
  "C-b-pasang": "Set up",
  "C-pair-busy": "Setting up…",
  "C-pair-refused": "Code not recognized or already used. Ask the person who set up this phone for a new code.",
  "C-pair-net": "No connection. Try again when the signal is steady.",
  "C-pair-ok-h": "Phone set up",
  "C-pair-ok-line": "For outlet {outlet_id}",
  "C-pair-srv": "The server could not finish this. Try again in a moment.", // PROVISIONAL: not in the copy sheet (server 5xx line)
  "C-pair-step-1": "Leave the phone in one fixed place and plug in the charger.",
  "C-pair-step-2": "Keep the screen on and this page open. Closing the page means not listening.",
  "C-pair-step-3": "You can tap Start from 01:00 until {until}, on each open day.",
  "C-pair-step-4": "The End button appears 4 hours after Start.",
  "C-b-buka-mendengarkan": "Open the listening page",

  "C-cap-title": "Shop phone", // one fixed neutral heading on every state (UX-03, 7 Oct)
  "C-h-loading": "Loading…",
  "C-h-error": "Opening hours not loaded yet",
  "C-h-error-help": "Opening hours have not loaded yet. Connect to the internet once, then reopen.",
  "C-h-unsupported": "This browser is not supported",
  "C-h-unsupported-help": "Open this page in another browser, then try again.",
  "C-h-listening": "Listening",
  "C-h-mic": "Microphone problem · not listening",
  "C-h-mic-help": "Check the microphone permission in the browser, then try again.",
  "C-cap-waiting": "{N} waiting to send", // PROVISIONAL
  "C-cap-capturing": "Audio is being captured", // PROVISIONAL
  "C-cap-mic": "Microphone: {source}", // PROVISIONAL
  "C-cap-rate": "This microphone's sample rate is not supported.", // PROVISIONAL
  "C-cap-staff": "Staff (available soon)", // PROVISIONAL
  "C-cap-hours-h": "Paused · outside opening hours", // PROVISIONAL
  "C-cap-hours-b": "Listening runs from {from} to {to} ({tz}). It will start again automatically at opening time.", // PROVISIONAL

  "C-u-up": "Uploading",
  "C-u-retry": "Not sent yet · retrying",
  "C-u-count": "({N}x)",
  "C-u-server": "Server busy",
  "C-u-inet": "No internet. Connect so the queued items can send.", // shown only when navigator.onLine is false
  "C-u-ok": "Upload succeeded",
  "C-u-lost": "Some speech was not captured",
  "C-u-lost-help": "That note is now incomplete. It cannot be recovered.", // lost-line helper, in the copy sheet (UX-03 copy keys; UX-03 section 5.7 row L, decision F)
  "C-u-toast": "Upload working again",
  "C-h-idle": "Not started",
  "C-h-idle-help": "Tap Start to begin today's session.", // shown only when Mulai is offered (UX-03 5.2)
  "C-h-ended-auto": "Ended automatically at {time}",
  "C-h-ended": "Ended",
  "C-h-discarded": "Session cancelled",
  "C-m-closed": "Closed today. Next Start {date} at 01:00.",
  "C-m-window-passed": "The Start cut-off today passed at {time}. Today is recorded as a day off. Next Start {date} at 01:00.",
  "C-m-day-ended": "The business day {endedDate} has ended. You can tap Start again {date} at {time}.",
  "C-m-debrief": "The debrief runs until {debriefUntil}. You can tap Start again {date} at {time}.",
  "C-notice-pilot": "Speech becomes short work notes. Audio is not kept.", // capture privacy notice, pilot (UX-03 §5.10)

  "C-b-mulai": "Start",
  "C-b-mulai-busy": "Starting…",
  "C-b-selesai": "End",
  "C-n-selesai-from": "You can tap End from {time}.",
  "C-c-selesai-h": "End today's operations?",
  "C-c-selesai-b": "The 1-hour debrief starts now. This cannot be undone. You can tap Start again {date} at {time}.",
  "C-b-belum-lanjut": "Not yet, keep going",
  "C-b-ya-selesai": "Yes, end",
  "C-b-batalkan": "Cancel session",
  "C-c-cancel-h": "Cancel the session started at {time}?",
  "C-c-cancel-b": "Its audio and notes will be deleted. This cannot be undone. Today does not count. You can tap Start again {date} at 01:00.",
  "C-c-cancel-b-now": "Its audio and notes will be deleted. This cannot be undone. Today does not count. You can tap Start again straight away.",
  "C-b-tetap-simpan": "Keep the session",
  "C-b-ya-hapus": "Yes, delete session",
  "C-c-autoclose": "The panel closed. Nothing has changed.",
  "C-srv-pending": "Removing from server…",
  "C-srv-offline": "Will be removed when online",
  "C-srv-done": "Removed",
  "C-sess-err": "Could not process that. Try again.",
  "C-c-discard-failed": "This session has already ended. Reload the page.",

  "C-b-kembali": "Back",
  "C-b-lewati": "Skip",
  "C-b-lanjut": "Next",
  "C-b-coba": "Try again",

  "C-d-entry-h": "Debrief running",
  "C-d-entry-left": "{mm} minutes left.",
  "C-d-entry-n": "{N} questions.",
  "C-d-btn": "Answer questions",
  "C-d-takes": "Takes about 5 minutes.",
  "C-d-next": "You can tap Start again {day} at {hm}.",

  "C-d-load": "Loading questions…",
  "C-d-load-2": "Usually takes a few seconds.",
  "C-d-err": "Questions could not load yet.",
  "C-d-err-2": "Check the connection, then try again.",
  "C-d-empty-h": "There are no questions today.",
  "C-d-empty-h-2": "Thank you.",

  "C-d-prog": "Question {N} of {M}",
  "C-d-q-step": "Around {hm} there was {step}. Is that right?",
  "C-d-q-block": "Between {hm} and {hm_end} there was work.",
  "C-d-q-block-2": "Is that right?",
  "C-d-yes": "Yes",
  "C-d-no": "No",
  "C-d-r-yes": "Did it follow the SOP? If not, why?",
  "C-d-r-yes-2": "Required. No names.",
  "C-d-r-no": "Why not? Tell us briefly.",
  "C-d-r-no-2": "Required. No names.",
  "C-d-count": "{N}/500",
  "C-d-count-warn": "{N}/500 · {M} left",
  "C-d-over": "Too long. Remove {N} characters.",
  "C-d-help-dis": "Choose Yes or No, then give a reason.",
  "C-d-locked": "An answer sent with Next cannot be changed.",

  "C-d-save-fail": "The answer is not saved on this phone yet.",
  "C-d-save-fail-2": "The phone could not save it. Your text is still here.",
  "C-d-save-fail-3": "Try Next again.",
  "C-d-refused": "Not sent yet. It will be retried automatically.",
  "C-d-refused-2": "The answer stays saved on this phone.",
  "C-d-offline": "Saved on the phone. Will be sent when online.",

  "C-d-done-h": "Debrief complete. Thank you.",
  "C-d-done-l": "Your answers are saved.",
  "C-d-done-unsent": "{N} answers are not sent yet.",
  "C-d-done-unsent-2": "They will be sent when online.",
  "C-d-done-skip": "{N} questions skipped.",
  "C-d-done-skip-2": "You can answer them until {hm}.",
  "C-d-done-mulai": "You can tap Start again {day} at {hm}.",
  "C-d-timeout": "The debrief time ran out at {hm}.",
  "C-d-timeout-2": "Answers sent with Next are kept.",
  "C-d-timeout-3": "Text not sent with Next is not saved.",

  "C-d-entry-left-one": "1 minute left.",
  "C-d-entry-n-one": "1 question.",
  "C-d-over-one": "Too long. Remove 1 character.",
  "C-d-done-unsent-one": "1 answer is not sent yet.",
  "C-d-done-skip-one": "1 question skipped.",

  // /sign-in (R-06 Task 4.8) — owner/supervisor email + password sign-in.
  "C-signin-title": "Sign in",
  "C-signin-help": "For owners and supervisors. Accounts are set up by bee6.",
  "C-signin-email": "Email",
  "C-signin-password": "Password",
  "C-signin-submit": "Sign in",
  "C-signin-busy": "Signing in…",
  "C-signin-empty": "Enter your email and password.",
  "C-signin-bad": "Email or password is wrong.",
  "C-signin-many": "Too many tries. Wait a few minutes.",
  "C-signin-denied": "This account has no access to bee6.",
  "C-signin-net": "No connection. Try again when the signal is stable.",
  "C-signin-config": "Sign-in is not set up on this server.",
  "C-srv-generic": "Something went wrong. Try again.",
  "C-web-signout": "Sign out",

  // /day (R-06 Task 6) — the day record screen, owner and supervisor.
  "C-day-title": "Day record",
  "C-day-prev": "Previous day",
  "C-day-next": "Next day",
  "C-day-off-closed": "Off / closed",
  "C-day-pending": "Not started yet",
  "C-day-cancelled": "Sessions cancelled: {N}",
  "C-day-mode-room": "Mode: room",
  "C-day-mode-wearable": "Mode: wearable",
  "C-day-mode-none": "Mode: no phone paired",
  "C-day-counts": "Facts: {facts} · Questions: {questions}",
  "C-day-counts-owner": "Facts: {facts}",
  "C-day-filter-group": "Filter by category",
  "C-day-filter-all": "All ({N})",
  "C-day-filter-cat": "{label} ({N})",
  "C-day-empty": "No work notes for this date.",
  "C-day-empty-2": "Notes appear a few minutes after people speak.",
  "C-day-empty-owner": "No confirmed facts for this date yet.",
  "C-day-truncated": "Showing the first {N} notes.",
  "C-day-time": "{start}–{end}",
  "C-day-confidence": "Confidence {pct}%",
  "C-day-no-summary": "No summary.",
  "C-day-evidence": "Evidence",
  "C-day-evidence-more": "+{N} more lines",
  "C-day-ans-yes": "A staff member answered Yes:",
  "C-day-ans-no": "A staff member answered No:",
  "C-day-st-fact": "Fact",
  "C-day-st-fact-staff": "Fact, confirmed by staff",
  "C-day-st-fact-supervisor": "Fact, confirmed by supervisor",
  "C-day-st-open": "Question, waiting for the debrief",
  "C-day-st-answered": "Answered, not a fact yet",
  "C-day-st-supervisor": "Waiting for supervisor",
  "C-day-st-rejected": "Rejected by staff",
  "C-day-st-rejected-supervisor": "Rejected by supervisor",
  "C-day-st-unverified": "Unverified",
  "C-day-err": "Could not load the notes.",
  "C-day-retry": "Try again",
  "C-day-forbidden": "This account cannot see the day record.",
  "C-day-invalid": "This date is not available.",
  "C-day-to-today": "Go to today",
  "C-day-loading": "Loading…",
  "C-cat-ROUTINE_OPS": "Routine work",
  "C-cat-CUSTOMER_SERVICE": "Customer service",
  "C-cat-TRAINING": "Training",
  "C-cat-STAFF_CONSULT": "Staff question",
  "C-cat-CORRECTION": "Correction",
  "C-cat-PHONE_CALL": "Phone call",
  "C-cat-EVENT": "Planned event",
  "C-cat-COMPLAINT": "Customer complaint",
  "C-cat-SAFETY_INCIDENT": "Safety incident",
  "C-cat-SECURITY_INCIDENT": "Security incident",
  "C-cat-DISRUPTION": "Disruption",

  // Runner-up panel (R-06 Task 11), appended to the PR-3 block.
  "C-day-runnerup": "Second choice: {label}",
  "C-day-runnerup-none": "No reason given.",
  "C-cat-NON_WORK": "Not work talk",

  // Supervisor confirm/override (R-06 Task 10), appended to the PR-5 block.
  "C-act-confirm": "Confirm",
  "C-act-change": "Change category",
  "C-act-select": "New category",
  "C-act-save": "Save",
  "C-act-cancel": "Cancel",
  "C-act-busy": "Saving…",
  "C-act-blocked": "Cannot confirm: no evidence lines.",
  "C-act-stale": "This note changed. Showing the latest.",

  // Supervisor reject (R-06 Task 15, v4), appended to the Task 10 block.
  "C-act-reject": "Reject",
  "C-act-reject-q": "Reject this note? It will not count as evidence.",
  "C-act-reject-yes": "Yes, reject",

  // /home (R-06 Task 14a) — owner home, "today in 5 lines".
  "C-home-title": "Today",
  "C-home-more": "+{N} more in the day record",
  "C-home-to-day": "Open the day record",
  "C-day-to-home": "Home",
};

export const DICT: Record<Lang, Record<DictKey, string>> = { id: ID, en: EN };

/** Fills {placeholders} from `vars`. A placeholder with no value throws, so a raw token never reaches the screen. */
export function t(
  lang: Lang,
  key: DictKey,
  vars?: Record<string, string | number>,
): string {
  return DICT[lang][key].replace(/\{([a-zA-Z_]+)\}/g, (_match, name: string) => {
    if (!vars || !Object.prototype.hasOwnProperty.call(vars, name)) {
      throw new Error(`Missing copy placeholder {${name}} for ${key}`);
    }
    return String(vars[name]);
  });
}

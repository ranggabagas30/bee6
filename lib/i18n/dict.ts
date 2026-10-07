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

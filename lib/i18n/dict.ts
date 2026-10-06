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
  "C-pair-srv": "Server belum bisa memproses ini. Coba lagi sebentar.",
  "C-pair-step-1": "Letakkan HP di tempat tetap dan colokkan charger.",
  "C-pair-step-2": "Layar tetap menyala dan halaman ini tetap terbuka. Menutup halaman berarti tidak mendengarkan.",
  "C-pair-step-3": "Mulai bisa ditekan 01:00 sampai {until}, tiap hari buka.",
  "C-pair-step-4": "Selesai muncul 4 jam setelah Mulai.",
  "C-b-buka-mendengarkan": "Buka halaman mendengarkan",

  // /capture headline, states and helpers
  "C-cap-title": "Mendengarkan toko",
  "C-h-loading": "Memuat…",
  "C-h-error": "Jam buka belum termuat",
  "C-h-error-help": "Jam buka belum termuat. Sambung internet sekali, lalu buka.",
  "C-h-unsupported": "Browser ini belum didukung",
  "C-h-unsupported-help": "Buka halaman ini di browser lain, lalu coba lagi.",
  "C-h-idle": "Belum mulai",
  "C-h-listening": "Mendengarkan",
  "C-h-mic": "Mikrofon bermasalah · tidak mendengarkan",
  "C-h-mic-help": "Cek izin mikrofon di browser, lalu coba lagi.",
  "C-cap-waiting": "{N} menunggu dikirim", // PROVISIONAL
  "C-cap-capturing": "Suara sedang direkam", // PROVISIONAL
  "C-cap-mic": "Mikrofon: {source}", // PROVISIONAL (format from HANDOFF)
  "C-cap-rate": "Sample rate mikrofon ini tidak didukung.", // PROVISIONAL
  "C-cap-staff": "Staf (segera hadir)", // PROVISIONAL
  "C-cap-hours-b": "Mendengarkan berjalan dari pukul {from} sampai {to} ({tz}). Akan mulai lagi otomatis saat jam buka.",

  // Upload block help lines (UX-03 section 6, approved 6 Oct). Under rows 1 and 1a.
  "C-u-retry-help": "Terkirim sendiri saat HP bisa menjangkau server.",
  "C-u-server-help": "Akan dicoba lagi sendiri. Tidak perlu tindakan.",
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
  "C-pair-srv": "The server could not finish this. Try again in a moment.",
  "C-pair-step-1": "Leave the phone in one fixed place and plug in the charger.",
  "C-pair-step-2": "Keep the screen on and this page open. Closing the page means not listening.",
  "C-pair-step-3": "You can tap Start from 01:00 until {until}, on each open day.",
  "C-pair-step-4": "The End button appears 4 hours after Start.",
  "C-b-buka-mendengarkan": "Open the listening page",

  "C-cap-title": "Shop listening",
  "C-h-loading": "Loading…",
  "C-h-error": "Opening hours not loaded yet",
  "C-h-error-help": "Opening hours have not loaded yet. Connect to the internet once, then reopen.",
  "C-h-unsupported": "This browser is not supported",
  "C-h-unsupported-help": "Open this page in another browser, then try again.",
  "C-h-idle": "Not started",
  "C-h-listening": "Listening",
  "C-h-mic": "Microphone problem · not listening",
  "C-h-mic-help": "Check the microphone permission in the browser, then try again.",
  "C-cap-waiting": "{N} waiting to send", // PROVISIONAL
  "C-cap-capturing": "Audio is being captured", // PROVISIONAL
  "C-cap-mic": "Microphone: {source}", // PROVISIONAL
  "C-cap-rate": "This microphone's sample rate is not supported.", // PROVISIONAL
  "C-cap-staff": "Staff (available soon)", // PROVISIONAL
  "C-cap-hours-b": "Listening runs from {from} to {to} ({tz}). It will start again automatically at opening time.",

  "C-u-retry-help": "It sends by itself once the phone can reach the server.",
  "C-u-server-help": "It will try again on its own. No action needed.",
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

/**
 * Fixtures for the redaction accuracy eval (scripts/eval-redaction.ts).
 *
 * Every line below is FICTIONAL (hard rule #8): an invented F&B-shop voice,
 * never the pilot shop's real transcripts, staff, or SOP. They exist only to
 * measure recall (does real PII get redacted?) and precision (does
 * non-PII evidence survive redaction?) of what R-04 already ships:
 * `lib/redact/dlp.ts` (Sensitive Data Protection) + `lib/redact/indonesian-phone.ts`
 * (the regex supplement).
 *
 * NOT covered here: the staff-name scrub (R-05b/R-07 — routes threads/
 * proposals/answers to roles, never names). That is a different mechanism
 * (role lookup, not text redaction) and isn't built yet. Extend this fixture
 * set with staff-name-scrub cases once that lands, rather than folding it in
 * here.
 */

export type FixtureCategory =
  | "pii-phone"
  | "pii-email"
  | "pii-address"
  | "pii-name"
  | "near-miss-name"
  | "near-miss-number"
  | "control";

export interface RedactionFixture {
  id: string;
  category: FixtureCategory;
  /** Fictional Indonesian F&B-shop line. */
  line: string;
  /** Whether *something* in this line should come out redacted. */
  expectRedacted: boolean;
  /** Which DLP_INFO_TYPES category is expected to fire, if any (diagnostic only). */
  expectedInfoType?: "PHONE_NUMBER" | "EMAIL_ADDRESS" | "PERSON_NAME" | "STREET_ADDRESS";
  /** Why this fixture exists. */
  note: string;
}

export const REDACTION_FIXTURES: RedactionFixture[] = [
  // --- Real PII that SHOULD be redacted -----------------------------------
  {
    id: "pii-phone-08",
    category: "pii-phone",
    line: "Nanti telepon saya ya di 081234567890 kalau stok susu sudah sampai.",
    expectRedacted: true,
    expectedInfoType: "PHONE_NUMBER",
    note: "Local 08xxx mobile format — the regex supplement's main target.",
  },
  {
    id: "pii-phone-08-dashes",
    category: "pii-phone",
    line: "Hubungi 0812-3456-7890 kalau ada komplain dari pelanggan.",
    expectRedacted: true,
    expectedInfoType: "PHONE_NUMBER",
    note: "Same format with hyphen separators, as people actually type it.",
  },
  {
    id: "pii-phone-plus62",
    category: "pii-phone",
    line: "Supplier gula bisa dihubungi di +6281298765432 untuk konfirmasi kiriman besok.",
    expectRedacted: true,
    expectedInfoType: "PHONE_NUMBER",
    note: "International +62 prefix format.",
  },
  {
    id: "pii-phone-and-name",
    category: "pii-phone",
    line: "Kalau mesin kopi rusak, hubungi teknisi Pak Joko di 085611223344.",
    expectRedacted: true,
    expectedInfoType: "PHONE_NUMBER",
    note: "Multi-entity line: a phone number AND a name in the same sentence.",
  },
  {
    id: "pii-email",
    category: "pii-email",
    line: "Kirim invoice bulan ini ke admin@proofedcoffee.fictional.co sebelum jam 5.",
    expectRedacted: true,
    expectedInfoType: "EMAIL_ADDRESS",
    note: "Plain email address in a fictional domain.",
  },
  {
    id: "pii-address-1",
    category: "pii-address",
    line: "Supplier barunya alamatnya di Jalan Mawar No. 12, Kebayoran Baru.",
    expectRedacted: true,
    expectedInfoType: "STREET_ADDRESS",
    note: "Street address with jalan/no. markers.",
  },
  {
    id: "pii-address-2",
    category: "pii-address",
    line: "Gudang bahan baku pindah ke Komplek Industri Blok C No. 5, Cikarang.",
    expectRedacted: true,
    expectedInfoType: "STREET_ADDRESS",
    note: "Street address without the word 'Jalan' — complex/blok format.",
  },
  {
    id: "pii-name-1",
    category: "pii-name",
    line: "Nanti bilang ke Budi ya kalau susu UHT sudah habis.",
    expectRedacted: true,
    expectedInfoType: "PERSON_NAME",
    note: "A person's name used naturally mid-sentence, the realistic debrief case.",
  },
  {
    id: "pii-name-2",
    category: "pii-name",
    line: "Dewi Lestari yang pegang kunci gudang shift pagi ini.",
    expectRedacted: true,
    expectedInfoType: "PERSON_NAME",
    note: "Full name (first + last) at the start of a sentence.",
  },

  // --- Near-miss cases that should NOT be redacted (precision risk) ------
  {
    id: "near-miss-sari",
    category: "near-miss-name",
    line: "Tambahkan sari jeruk segar ke menu minuman musim ini.",
    expectRedacted: false,
    note: "'sari' (juice/essence) is also a common Indonesian first name, used here as a lowercase common noun.",
  },
  {
    id: "near-miss-bunga",
    category: "near-miss-name",
    line: "Taruh bunga segar di meja nomor tiga sebelum toko buka.",
    expectRedacted: false,
    note: "'bunga' (flower) is also a common Indonesian first name, used here as a common noun.",
  },
  {
    id: "near-miss-menu-melati",
    category: "near-miss-name",
    line: "Teh Melati jadi menu paling laris minggu ini di outlet.",
    expectRedacted: false,
    note: "Menu/product name ('Melati') that coincidentally doubles as a person's name.",
  },
  {
    id: "near-miss-order-number",
    category: "near-miss-number",
    line: "Pesanan nomor 081 sudah siap diambil pelanggan di meja depan.",
    expectRedacted: false,
    note: "An order number that starts like a phone prefix but is far too short to be one.",
  },
  {
    id: "near-miss-closing-code",
    category: "near-miss-number",
    line: "Kami sudah closing order ke-081 untuk sesi makan siang ini.",
    expectRedacted: false,
    note: "A short internal order code, not a phone number.",
  },
  {
    id: "near-miss-price",
    category: "near-miss-number",
    line: "Total belanja Rp 85000 untuk meja nomor empat, sudah termasuk pajak.",
    expectRedacted: false,
    note: "A price — a digit run with no 0/+62 phone prefix.",
  },
  {
    id: "near-miss-receipt-number",
    category: "near-miss-number",
    line: "Nomor struk hari ini 445890123, simpan untuk rekap kasir nanti malam.",
    expectRedacted: false,
    note: "A receipt/invoice number that is a long digit run but doesn't start with a phone prefix.",
  },

  // --- Control cases: no PII at all ---------------------------------------
  {
    id: "control-restock",
    category: "control",
    line: "Stok kopi arabika hampir habis, tolong catat di papan restock.",
    expectRedacted: false,
    note: "Pure shop-ops line, no PII of any kind.",
  },
  {
    id: "control-queue",
    category: "control",
    line: "Antrian pelanggan pagi ini cukup ramai, semua staf standby di kasir.",
    expectRedacted: false,
    note: "Pure shop-ops line, no PII of any kind.",
  },
  {
    id: "control-table-request",
    category: "control",
    line: "Meja nomor tujuh minta tambahan es batu dan tisu.",
    expectRedacted: false,
    note: "Pure shop-ops line, no PII of any kind.",
  },
  {
    id: "control-shift",
    category: "control",
    line: "Shift sore mulai jam 4, briefing singkat sebelum buka toko.",
    expectRedacted: false,
    note: "Pure shop-ops line with a time mention, no PII of any kind.",
  },
];

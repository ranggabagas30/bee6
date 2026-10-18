# UX-03 Journey UX design: shop phone (pairing, daily glance, Mulai/Selesai, debrief, riwayat)

**Design status: iterating (revision 5, 4 Oct 2026).** Revision 5 makes English the default language and records Rangga's decisions Q-U18 to Q-U24 as confirmed (sections 0, 8 and 12). Revision 4 adds the shop-phone language toggle (Bahasa
Indonesia / English, section 5.12). It supersedes the C9 bilingual-line rule and Q-U1 (section 3 rule 1, section
8, section 11 X1 and X16 to X22). The copy sheet (section 6) is now two columns, ID and EN. Revision 3 applied
decisions A to E, the history log (5.9) and the ux-copy pass. The design stays "iterating" until the tech-lead
technical assessment (section 10) is back and its required changes are applied. Not built. No product code
touched. No plan or sprint date is locked here. Decisions made in revision 4 are marked **[UIUX decided]**.

Owner: uiux. Decisions A to E are Rangga's (4 Oct). Open questions for Rangga are in section 12.

Sources (read only): `docs/specs/technical-specification.md` §8.3, §8.5, §8.7, §8.8, §8.9,
§8.19 (and §8.9 for cancel copy, §8.16 for the notice line); `docs/specs/web-backend-rbac.md` §6.6.3; this file's sections 4, 8 and 8.0 as agreed;
`CLAUDE.md` §2 and §4; `docs/tasks/R-07-ux-notes.md` for the debrief notes.

Canvas: the Claude Design artifact `<PRIVATE_DESIGN_LINK>` could not be opened or
refreshed from this session (no Artifact tool). The local export in `.claude/canvas-ux03/project/` is stale
(see section 13). Refresh is a follow-up for a session with the Artifact tool.

Skills: `frontend-design:frontend-design` (plan, restraint, no templated tells), `accessibility` (WCAG 2.2 AA
checklist) and `ux-copy` (every state's copy; revision 3) were loaded and applied. Copy follows the rules in
section 3 (English is the primary column from rev 5) and the ux-copy patterns (CTAs name the action, errors say what happened and what to do,
empty states say what this is and how to start). The earlier note that no copy skill was installed is withdrawn.

Product context: `PRODUCT.md` (project root, written by `impeccable init`, not committed). Where it and this file
differ, this file wins for screen detail and PRODUCT.md wins for product truth. The init interview could not be
held live (no question tool in the session); its facts are inferred from the brief, the session rules (now technical spec §8) and section 1, and are
labelled as such in PRODUCT.md.

---

## 0. What changed in this revision

**Revision 5 (4 Oct, Rangga's decisions, Confirmed by Rangga 4 Oct):**
- **Default language is English (Q-U20).** Every new device, the demo outlet included, starts in English. This
  overrides the Bahasa default of rev 4 wherever it appeared: section 1 audience, 5.12.2 default, cookie default,
  first run (`EN` pressed), and the clearing rule. The cookie `bee6_lang` stays; when it is unset the server uses `en`.
- **Control and names (Q-U18, Q-U19).** Top-bar `ID | EN` control confirmed, not a settings sheet. Language names
  "Bahasa Indonesia" and "English" stay untranslated.
- **Scope (Q-U21).** The toggle covers the supervisor and owner screens as well as the shop phone. Their screens are
  not designed in this file; the control, the copy rules and the switch rules here apply to them.
- **Copy (Q-U22, Q-U23, Q-U24).** The EN column is the primary column in section 6 and the default. UI/UX wrote it and
  it is marked **UI/UX draft, final sign-off Rangga**. The glossary is kept as written. The EN debrief category labels
  are in section 6 (same draft mark); their ID labels are pending Rangga (Q-U23). The shortened EN privacy notice is
  accepted (Q-U24); the technical spec §8.16 formal sign-off is still needed before the pilot page.
- **Precedence rule (Rangga, 4 Oct).** UI/UX decisions win over the technical spec §8 and web spec §6.6 where they are about how a screen looks, reads
  or is worded (examples: a character limit shown as a visible counter, cancel button placement, copy). Those specs win over
  UI/UX on functional and technical behaviour: session rules, the offline queue, routes, the data contract, retention,
  consent and the privacy rules. Where the two conflict, the rule that applies is named in the table below and listed for
  the tech-lead to record. Nothing in those specs is edited by this file.

| Item | Conflict | Rule that applies |
|---|---|---|
| Cancel panel placement (5.6) | The session rules (technical spec §8.9) said "opposite side"; this file stacks the buttons full width | UI/UX wins (presentation). Tech-lead to record the spec wording change |
| Reason length (5.8) | Q31 (technical spec §8.1 `REASON_MAX_CHARS`): refused, never truncated, 500 limit. This file: visible counter, Lanjut blocked over 500 | Both hold. The technical spec wins on the 500 limit and no truncation (data rule). UI/UX wins on the counter and its words |
| Retention wording (`C-r-keep`, `C-notice-demo-5`, `C-notice-demo-6`) | This file states 14 days (history, work notes) and 24 hours (undelivered audio) | The technical spec wins (retention, §8.15 and §8.16; `CLAUDE.md` §2 #7a). If its periods differ, the copy changes to match. Tech-lead to confirm all three periods |
| EN privacy notice (`C-notice-demo-1` to `-6`) | Shortened EN wording (Q-U24) | The technical spec wins on meaning. The shortened line is accepted as the same meaning. Formal sign-off still needed (technical spec §8.16) |
| Default language and the cookie (5.12.2) | Default `en` is presentation (UI/UX). Cookie read on the server, storage and first paint are technical | UI/UX sets the default value. The technical spec (§8.17) and the tech-lead (I1, I2) decide the mechanism |
| Stalled and mic_error copy (5.2, T5) | "mencoba lagi" (retrying) promises an automatic restart | The technical spec wins (behaviour, §8.8). If the restart is not automatic, the copy changes (T5) |
| Selesai timing, Mulai window, routes, session rules | Same in both documents | The technical spec wins. No change |
| Debrief timeout and unsent text (5.8) | Copy says unsent text is lost at timeout | The technical spec wins on the behaviour (§8.10). Copy follows it |
| Row 0 and lost-line clearing (5.7, 5.11, T3, T4) | Row layout and wording are presentation. Detection and the clear-on-2xx rule are behaviour | Layout: UI/UX. Detection and clearing: the technical spec wins (§8.8). Tech-lead to record |

**Revision 4 (4 Oct, language toggle, [UIUX decided]):**
- Section 5.12 (new): the Bahasa Indonesia / English toggle. Top-bar segmented control `ID | EN` on every
  shop-phone screen, default English from rev 5 (was Bahasa in rev 4), one cookie per device, no account. Settings sheet rejected (5.12.1).
- Section 3 rule 1 and rule 2: C9 "gloss on values" and the `Bahasa / English` line format are superseded by two
  full sheets, one language per screen. Q-U1 is closed as superseded (section 12).
- Section 6: the copy sheet is split into an ID column and an EN column, 131 keys, every line at most 59 characters
  in both columns. New keys `C-lang-*` (the control) and the EN notice draft.
- Section 7: a language switch announces only `C-lang-said` and re-announces nothing else.
- Section 11: session-rule changes for the tech-lead (X16 to X22). Section 12: new questions Q-U18 to Q-U24.
- Section 10: the i18n technical assessment is requested through the team lead (no tech-lead is reachable by
  name from uiux). Not received.

Step 1 gap table (every gap found against the best-practice bar and the session rules), and the fix in this file.

| # | Gap | Where it was | Fix in this revision |
|---|---|---|---|
| G1 | Selesai timing said "from start + 4 h, or close, whichever is first". Technical spec §8.3 rule 4 and D1 (plan §10 #29): start + 4 h only; the `min` is a guard. | UX-03 §4.4 | Reworded to start + 4 h (section 5.5). |
| G2 | "Mulai bisa ditekan lagi pukul HH:MM" with no date. The next offer can be tomorrow at 01:00 (4.13 §2 says always write the day). Someone at 15:00 reads it as today. | Debrief card, done screen | Every reopen time carries the day: "Kam 15 Okt pukul 01:00". |
| G3 | Cancel panel omitted the session start time, which technical spec §8.9 requires so the person can check the right session. It also used "Sesi ini dihapus", not the agreed cancel wording. | UX-03 §4.4 | Panel copy now follows technical spec §8.9 and carries HH:MM (section 5.6). |
| G4 | Reason box had `maxLength={500}`, which silently blocks input. Q31 (technical spec §8.1 `REASON_MAX_CHARS`) says "refused, never truncated". | UX-03 §4.6 | No silent cap. Counter; over 500 blocks Lanjut with a line saying how many characters to cut (5.8). |
| G5 | Start POST failure shown as "Mulai belum berhasil", a start failure. Technical spec §8.7 says a start POST failure is not fatal and capture keeps running. Showing a failed start while the mic runs is wrong. | UX-03 §4.7 | Headline stays Mendengarkan. A new upload-block row says the session is not yet on the server (5.7, row 0). Needs a technical spec §8.8 change; tech-lead to confirm. |
| G6 | "Gagal unggah" on every retry, including plain offline. A phone with no signal is not a failure; the word blames the upload and alarms staff. | UX-03 §4.5 | Proposed "Belum terkirim · mencoba lagi (Nx)" for retry rows. Pending Q14 (Q-U4). |
| G7 | Lost line had no cause. "Sebagian suara tidak tercatat" alone does not tell staff whether to fix the phone. | UX-03 §4.5, 8.0 C/D | Cause helper line per cause: queue full, server refused (5.7). |
| G8 | Tab-busy and unsupported states had no next step. | UX-03 §4.2 | Each has one next action (5.2). |
| G9 | Stalled copy and "Mendengarkan" word rule: E says the word Mendengarkan appears nowhere in mic_error, but E's own copy is "tidak mendengarkan". | UX-03 8.0 E | Rule read as "no positive Mendengarkan" (5.2, Q-U10). |
| G10 | Notes and buttons carried English lines. The brief and C9 say gloss on the value only. | UX-03 §2, §6 | Gloss on status values only (headline, upload line, server line). Notes, buttons, helpers and checklist are Bahasa only. English moves to the copy sheet for T-401a (Q-U1). |
| G11 | Long strings (over 60 characters per copy line) and two-line values with no break rule. | Throughout | Every copy line measured by script, max 59 (section 6, section 9 R5). |
| G12 | No history log. The brief asks for one. | Missing | New screen 5.9. |
| G13 | No-consent state requested in the brief but removed in technical spec §8.7 (4 Oct) and CLAUDE.md §7b. | Brief | Not designed. Stated in 5.10 and Q-U7. |
| G14 | Pairing success listed "Tutup / Close" as a guess; no state for an already-paired device. | UX-03 §4.1 | Single action kept (open the listening page). "Tutup" dropped. Re-pair covered by the error path. |
| G15 | Interrupted and stalled states had mismatched first words, and "Ketuk" versus "Tekan" was mixed. | UX-03 §4.2, 8.0 E | One verb per action: Tekan for buttons, Ketuk for "tap this to continue" text. |
| G16 | Live-region rule said headline is `role="status"` but gave no rule for the 30 s poll. A polite region re-reading the same word on every poll is noise. | UX-03 §4.2, §7 | Announce on state change only; text is not re-set on a timer with the same value (section 7). |
| G17 | Debrief question: label "(wajib, tanpa nama)" repeated the same requirement twice. | UX-03 §4.6 | Label then one helper line: "Wajib diisi, tanpa nama." |
| G18 | Batalkan panel "opposite side" is ambiguous on a full-width 360 px column. | UX-03 §4.4 | Stacked, full width. Question Q-U3. |
| G19 | "Selesai" button is shown from start + 4 h but the "Selesai bisa ditekan" note was only in the running view. The note and the button had no shared slot rule. | UX-03 §4.2 | One primary slot: the note sits in it until Selesai appears (5.2). |
| G20 | The debrief done screen had no "what to do" beyond Kembali for the unsent-answer case. | UX-03 §4.6 | Unsent answers line says it will be sent when online; no action needed (5.8). |
| G21 | Revision 3 (ux-copy pass): the Selesai and Batalkan panels still used `Kembali` as the button, the same word as navigation. X14 was proposed but not applied in the copy sheet. | 5.5, 5.6, section 6 | Applied: `Belum, lanjut` (Selesai panel) and `Tetap simpan sesi` (cancel panel, default focus). `Kembali` stays for navigation only (5.9, debrief done). |
| G22 | Input outline token: `--line` was named as the input outline at 3:1, but measures 1.27:1 on white and 1.43:1 on the dark surface. Fails WCAG 1.4.11. | Section 2 | New token `--edge` (section 2 table). `--line` is for dividers only. |
| G23 | Text on the solid primary and red fills had no token; the red confirm text colour was not stated. | Section 2 | `--on-fill` and `--on-danger` added with measured ratios. |
| G24 | Em dash in a heading (`Debrief selesai — terima kasih`), the spaced-dash pattern the frontend-design skill lists as a template tell. | Copy sheet `C-d-done-h` | `Debrief selesai. Terima kasih.` |
| G25 | Debrief row in the history log repeated the time: the time column shows 14:00 and the event said "14:00–15:00 Debrief". | 5.9 table, `C-r-ev-debrief` | Event reads `Debrief sampai 15:00` under the 14:00 time. |
| G26 | History log had no data source. The on-device store list (now technical spec §8.12) then had no event store; the only event log in code is the DEV-01 in-memory ring buffer (`lib/capture/browser/event-log.ts`). Riwayat cannot read it after a reload. | 5.9 | Stated as a P1 or P2 dependency with the T1 fallback (5.9, section 10, X15). Not shipped in any sprint until T1 answers. |

Step 2 coverage: every state in technical spec §8.7 and §8.8 (views `loading`, `error`, `unsupported`, `idle`,
`running`, `interrupted`, `tab_busy`; headlines `listening`, `mic_error`, `stalled`, `interrupted`, `ended`,
`ended_auto`, `discarded`; upload rows 1, 1a, 1b, 2, 3, 4, 5), the Mulai, Selesai and Batalkan flows (§4.3,
§4.4, §4.12, §4.13), the upload area, the debrief flow (§4.6), empty, loading, error, offline states, the
pairing flow (§4.1), and the history log (new). No-consent: see G13.

---

## 1. Subject, audience, single job

- **Subject:** a small F&B shop (Proofed pilot; demo outlet for judges). The shop phone is a paired device
  left in one fixed spot, plugged in, screen on, with `/capture` open.
- **Audience:** shop staff on a shared phone, in a kitchen or bar. Hands wet or greasy, glare, interrupted
  often, glance-level attention most of the shift. English is the default language; Bahasa Indonesia is the other (Q-U20).
- **Job of `/capture`:** answer one question in under two seconds: "Is it listening, and does anything need
  a tap from me?" Everything else is secondary.
- **Job of the debrief:** short, one question at a time, no way to get lost, no way to lose a typed answer.
- **Job of the history log:** let staff check what the phone did today, in time order, without any content.

## 2. Visual direction and tokens

The subject is a working tool on a shop counter, read at a glance under glare. The memorable thing is the
**state word**: large, plain, always in the same slot. Everything around it stays quiet. No decoration, no
gradients, no cards, no hero.

Tokens (unchanged from the 4 Oct version, re-checked against WCAG 2.2 AA; light first, dark mirrors):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FAF7F2` | `#17191C` | page |
| `--fg` | `#1F1D1A` | `#E8E6E1` | headline and body text (15.7:1 / 14.1:1) |
| `--muted` | `#55514A` | `#A9A49A` | helper text (7.4:1 / 7.1:1). Never `#8C8579` for text |
| `--accent` | `#0B5B57` | `#8FD1C9` | primary button fill, links (7.4:1 / 10.2:1) |
| `--ok` | `#1E6B3A` | `#7FD39A` | listening only (6.1:1 / 9.8:1) |
| `--warn` | `#7A4F00` | `#F0B861` | interrupted, retrying, lost line (6.7:1 / 9.8:1) |
| `--danger` | `#A3262B` | `#F28B8F` | mic error, stalled, red confirm button (6.9:1 / 7.4:1) |
| `--focus` | `#1F4FD1` | `#5FA8D3` | 3 px focus outline, 2 px offset (6.3:1 / 6.7:1) |
| `--surface` | `#FFFFFF` | `#22252A` | confirm panels |
| `--line` | `#E9E4DA` | `#3A3E45` | decorative dividers only (1.27:1 and 1.43:1 on surface: not a control edge) |
| `--edge` | `#766F64` | `#8A857B` | input and control outlines, need 3:1 (4.97:1 on white / 4.19:1 on dark surface) (rev 3, G22) |
| `--on-fill` | `#FFFFFF` | `#17191C` | text on the primary fill (`--accent`): 7.93:1 light / 10.18:1 dark (rev 3, G23) |
| `--on-danger` | `#FFFFFF` | `#17191C` | text on the red confirm fill (`--danger`): 7.32:1 light / 7.44:1 dark (rev 3, G23) |

Type: **Atkinson Hyperlegible** (designed for low-vision and glare legibility; fallback
`system-ui, -apple-system, "Segoe UI", sans-serif`). Scale: state headline 26/32 bold (see Q-U2);
section title 20/26 bold; body 16/24 (never below 16 on `/capture`, the debrief or the history log); helper
14/20; counter and notice 14. (Rev 4: no gloss anywhere, so there is no mixed-size status line. Each language
sets its own line at the same scale.) Digits in times and counts use `tabular-nums`.

Spacing and targets: 8 px grid. Every tap target 48 px tall minimum (stricter than WCAG 2.5.8's 24 px).
Primary action 56 px tall, full width. 12 px between adjacent targets. Batalkan sesi at least 24 px from Selesai.

Forbidden tells (frontend-design): no tracked-out ALL CAPS labels, no `→` in buttons, no monospace, no
number markers except the one real sequence (pairing steps), no eyebrow label above the headline.

Motion: none. The listening state is a solid dot plus the word. If a pulse is ever added it is off under
`prefers-reduced-motion`. The "Mengunggah" dots stop under reduced motion.

Layout at 360 px: one column, 16 px side gutter, `env(safe-area-inset-*)` on the root, no horizontal
scroll. Top to bottom on `/capture`: state headline, one-line note (up to two sentences), primary slot,
secondary (Batalkan sesi), upload block, notice line, Riwayat link. The primary slot is 56 px tall and sits
in the lower half for thumb reach. The Mulai and Selesai states share one fixed-height slot so the layout
does not jump.

## 3. Copy and tone rules (ux-copy skill applied, revision 4)

1. **One language per screen, two full sheets (revision 4, [UIUX decided]; supersedes C9 and the rev 3 gloss
   rule).** Every string exists in two complete versions, EN (English, the default and primary column) and ID (Bahasa Indonesia), in section 6.
   The phone shows one of them, chosen by the language toggle (5.12). An ID screen has no English line; an EN
   screen has no Bahasa line. No `Bahasa / English` pairs, no gloss, no parenthetical translation, anywhere.
   Exceptions that are names, not copy, and never count as mixed: the endonyms "Bahasa Indonesia" and "English"
   in the picker, the codes `ID` and `EN`, the counter `{N}/500`, and the shared terms "debrief", "SOP", "bee6",
   "GATI", "Proofed". The copy is never machine-translated at run time (5.12.4).
2. **Length budget, both columns (revision 4).** Each line is at most 59 characters in ID and in EN, measured with
   placeholders as written (9a). Max three lines per string. English lines that run long are split at a clause
   boundary, never shrunk. The 328 px column is the same for both languages. (Rev 3's "value gloss format" is
   withdrawn.)
3. **Active voice, a control names what it does.** "Tekan Mulai", not "Mulai diklik". Same verb through the
   flow: the button "Selesai" leads to the panel "Akhiri operasional hari ini?" and ends with "Selesai".
4. **Errors say what happened and what to do.** No apology words ("maaf", "sorry"). No blame: nobody
   "forgot" or "failed"; the phone or the server did something, and the next step is named.
5. **Dates and times are always written out.** "Kam 15 Okt pukul 01:00". Never "hari ini", "besok",
   "nanti" for a time that may be tomorrow (at 00:30 those are ambiguous).
6. **No transcript, no audio word in a sentence that implies content.** Question text is a template.
   *Amended, Rangga 18 Oct (demo-feedback-2 item 10): on the SANDBOX (demo) the phone shows up to 2 already-redacted
   lines of the flagged thread under the question (read-time staff-name scrub, fail closed); the pilot keeps the
   template-only question.*
7. **Sentence case, plain verbs, no filler.**
8. **Name the action, not the navigation (ux-copy).** A button that commits names what it does (`Ya, selesai`,
   `Ya, hapus sesi`, `Tetap simpan sesi`, `Belum, lanjut`). `Kembali` only moves the user to a previous screen.
9. **One next step per state (ux-copy).** A state with a button names it in the note above or the helper below;
   a state with none says why it waits (5.2).
10. **Empty states say what this is and how to start.** Example: `C-r-empty` and `C-d-empty-h`.

## 4. Hard-rule checks (every screen)

- No transcript or quoted thread line on the phone. Debrief questions are templates. History shows event
  types and times, never content. *Exception, Rangga 18 Oct (demo-feedback-2 item 10): on the SANDBOX (demo) the
  phone shows up to 2 already-redacted lines of the flagged thread under the question (read-time staff-name scrub,
  fail closed); the pilot keeps the template-only question.*
- No audio on screen. The notice line is the only mention of storage.
- No Firestore in the browser: every read and write is an API call (`/api/v1/capture/*`, debrief routes).
- No staff name anywhere. No staff sign-in in MVP 1.
- No device id on any screen (the history log included).
- Supervisors and owners are not in this journey. The history log is the phone's own log (Q-U6). The language control (5.12) applies to their screens too (Q-U21); their screens are designed separately.
- Consent is not a UI gate (MVP 1). The notice line is a notice, not a consent collector.
- No secrets, keys or internal ids in client copy. The outlet id on pairing success is the raw id (C7).
- Language cookie (5.12.2) holds `id` or `en` only. No name, no account, no device id, never sent in an API body
  or written to Firestore, the audit log or an event row.
- No machine translation at run time. Typed text is never translated or sent to a model to be translated.

---

## 5. Screens

Copy keys (`C-…`) refer to section 6. Every key is one copy string; long strings have two or three lines.

### 5.1 `/pair`: pair this device, then first-run guidance

Who: whoever sets up the shop phone. Route `app/pair/page.tsx`. No staff login.

- **Entry (default).** Title `C-pair-title`. Helper `C-pair-help`. One labelled numeric field
  (`C-pair-label`, `inputmode="numeric"`, `autocomplete="one-time-code"`, visible label, not placeholder-only).
  Primary button `C-b-pasang` disabled until 6 digits; disabled state shows `C-pair-need` under it.
  Focus on the field at load.
- **Submitting.** `C-pair-busy` on the button; field read-only; `aria-busy="true"`.
- **Error, code refused.** Inline text under the field, `role="alert"`, linked by `aria-describedby`; focus
  moves to the error on submit fail. Digits kept. `C-pair-refused`.
- **Error, network.** `C-pair-net`. Digits kept, button enabled. Different text from refusal, so staff know
  whether to fix the code or the signal.
- **Success.** Heading `C-pair-ok-h`. Line `C-pair-ok-line` with the raw outlet id (C7 deferred to post-MVP 1).
  Then the four-step checklist (a real sequence, so numbers are correct here): `C-pair-step-1` to
  `C-pair-step-4`. One primary button `C-b-buka-mendengarkan` (48 px min, full width) to `/capture`.
  No secondary action: one next step.

[X] The 4 steps are the four facts a new user must know on day one. The rest lives on `/capture`.

### 5.2 `/capture`: the daily glance

One page, same layout every time. Only the headline, the note, the primary slot and the upload block change.

**State headline (axis 1: capture only).** Icon, word and tone, always. Never colour alone. The icon is an
SVG with `aria-hidden`; the word is the accessible name.

| State | Icon | Headline copy | Tone | The one next action |
|---|---|---|---|---|
| `loading` | spinner | `C-h-loading` | muted, `aria-busy` | none (wait; no Mulai until config is in) |
| `error` (no config, no cache) | ! | `C-h-error` | danger | `C-b-coba` (48 px); helper `C-h-error-help`. Mulai is not offered: the page never starts blind |
| `unsupported` | ! | `C-h-unsupported` | danger | none in the app; the helper names the fix (`C-h-unsupported-help`) |
| `tab_busy` | ! | `C-h-tabbusy` | warn | `C-b-coba` (retries the single-tab lock); helper `C-h-tabbusy-help`. Nothing else active |
| `idle` (not started today) | ○ | `C-h-idle` | muted | `C-b-mulai` when offered; otherwise none (the note says when) |
| `listening` | ● | `C-h-listening` | ok | Selesai (`C-b-selesai`, from start + 4 h) or Batalkan sesi when relevant; never a loss in the headline (A) |
| `mic_error` | ✕ | `C-h-mic` | danger | `C-b-coba` (restarts the mic in this session). Helper `C-h-mic-help` |
| `stalled` | ✕ | `C-h-stalled` | danger | none for 30 s (the app restarts the mic). Then `C-b-coba`. Helper `C-h-stalled-help` |
| `interrupted` (reload, session open) | ▲ | `C-h-interrupted` | warn | `C-b-lanjutkan`. Helper `C-h-interrupted-help` |
| `ended` (Selesai) | ■ | `C-h-ended` | muted | none (the Mulai note says when) |
| `ended_auto` | ■ | `C-h-ended-auto` | muted | none |
| `discarded` | ■ | `C-h-discarded` | muted | none (server line in 5.6 says what is pending) |

Rules for the headline:
- No amber `queue_full` state. The headline stays green while capture runs, for every upload result,
  including a cap prune (technical spec §8.8, Rangga 4 Oct). Decision A.
- The word "Mendengarkan" is only ever the positive state (`listening`). Negated text ("tidak
  mendengarkan") appears only in `interrupted` and `mic_error`, never with green (Q-U10).
- A state that is not listening never shows a green dot. `stalled`, `mic_error`, `interrupted`, `tab_busy`,
  `loading` and `idle` are never green.
- `role="status"` (polite). `mic_error` is announced once on transition as `role="alert"`; `stalled` once
  as polite status. Neither is re-announced on the 30 s poll (section 7).

**Decided by UI/UX, 7 Oct (two QA questions on the capture page; delegated to UI/UX by Rangga).** Skills: `ux-copy`, `accessibility`.

- **Q1. After the planned close, the status banner stays (option a).** Prod shows the same headline structure as Dev Stop. Only the headline and the note change; the banner never disappears, and the outside-hours note sits under it.
  - Why: §5.2 says the state word is always shown, and the one slot is how staff read the phone at a glance. With the banner gone the phone shows no state word at all.
  - Why: an outside-hours section alone cannot tell "closed for the day" from "broken". The headline names the state; the note names the next Start.
  - Which headline. No session today: `C-h-idle` ("Not started") with `C-m-closed` (day closed) or `C-m-window-passed` (cut-off passed), whichever applies. A session ran today and the planned close auto-stopped it: `C-h-ended-auto` ("Ended automatically at {HH:MM}"), never "Not started", which would be false. Tone stays muted in both cases; no green.
  - Next action (one line, in the primary slot note): "Nothing to do now. Tap Start on the day and time shown below." Uses the existing Mulai note; no new key.
- **Q2. The page heading is fixed and neutral on every state (option b).** Not a state-dependent heading.
  - Why: the state word already sits in the state headline, so a second state word above it repeats the same message and competes for the glance.
  - Why: a fixed heading does not change under the screen reader or the layout as state changes (accessibility: no announcement on state change beyond the state headline). The listening word then appears only in the `listening` headline, as §5.2 requires.
  - Copy: `C-cap-title`, EN "Shop phone", ID "HP toko" (section 6). Replaces the provisional "Shop listening" / "Mendengarkan toko" in code.

**Note under the headline** (one slot, muted, 16 px body, up to two sentences). The one that applies:

| Situation | Note copy |
|---|---|
| `idle`, opening hours, Mulai offered | `C-n-open` |
| `idle`, day closed | `C-m-closed` |
| `idle`, after the Mulai cut-off | `C-m-window-passed` |
| running, before Selesai is available | `C-n-selesai-from` |
| running, closing time passed, Selesai available | `C-n-closing`. Capture keeps running; headline still green |
| running, 10 min before auto-stop | `C-n-autostop-soon` (replaces the closing note) |
| `ended`, `ended_auto`, `discarded`, Mulai not offered | the Mulai note from 5.4 |

**Primary slot (one fixed box, 56 px plus note height).** Holds exactly one of: Mulai (enabled or
disabled with its note), Selesai (from `selesai_from_ms` only), the `C-n-selesai-from` note while Selesai is
hidden, or Lanjutkan (`interrupted`). This is G19: the note and the button share one slot, so the layout
does not jump when Selesai appears.

**Secondary: Batalkan sesi** (5.6). **Upload block** (5.7), below the actions in every mode.
**Notice line** (5.10). **Riwayat link** (5.9), 48 px, last, secondary.

**Debrief entry card** (5.8): a separate card above the primary slot, only while this device's debrief
clock is running.

**Timers.** Re-checks availability every 30 s and on `visibilitychange`. Mulai enables within 30 s of its
time with no reload. A timer never starts capture. Text is only re-set when the value changes (section 7).

**Loading:** headline `C-h-loading`; primary slot is a 56 px grey block with no text; no Mulai until config.
**Empty (nothing today):** `C-h-idle` plus the Mulai note for the case.
**Offline, cached config:** Mulai still works; capture continues; headline stays truthful (listening); the
upload block says it is retrying. The offline state is never hidden by the headline.

### 5.3 Listening states: summary

Green appears in one state only: `listening`. Every other state has an icon, a word and a tone that is not
green. Covered in the self-review (section 9, R2).

### 5.4 Mulai: window, disabled states and "why not"

Rules: technical spec §8.3 and §8.5. Mulai is a 56 px primary button in the primary slot. Button label follows the language switch (5.12); both languages are in section 6.

- **Enabled (`offered`):** `C-b-mulai`, primary fill. One tap starts the session. Double-tap guard: while
  the start is in flight the button shows `C-b-mulai-busy` and a second tap does nothing.
- **Disabled:** same size and position, `aria-disabled="true"`, with the reason note directly under it (the
  disabled state explains itself). A tap on it does nothing and shows no alert.

Reason copy (dates always written out):

| `mulaiAvailability.reason` | Headline | Note |
|---|---|---|
| `day_ended` (also after Selesai in its debrief, and after a cancel) | `ended` / `ended_auto` / `discarded` | `C-m-day-ended` |
| `debrief_running` (the Mulai gate; next day only) | `ended` / `ended_auto` | `C-m-debrief` |
| `window_passed` | `idle` | `C-m-window-passed` |
| `closed_day` | `idle` | `C-m-closed` |
| `session_open` | running view | Mulai not rendered; Selesai note or Selesai button instead |

Why the note uses the next day and time: `day_ended` is checked before `debrief_running`, so after a
same-day Selesai the reason is `day_ended` even while a debrief runs. The debrief time is then shown on the
debrief card (5.8), and the Mulai line carries the honest next offer. That is the one place staff are most
likely to be confused: test it on a phone (Q-U5).

### 5.5 Selesai (two-step, from start + 4 h)

- **Shown from** `selesai_from_ms` = start + 4 h (D1). Before that the primary slot shows
  `C-n-selesai-from`, not a button. The close (`close(D)`) is only a guard and is never the trigger.
- **Tap 1** opens an inline panel. The tap ends nothing. The Batalkan panel closes if open (one panel at a time).
- **Panel** (`role="group"`, labelled by its heading): heading `C-c-selesai-h`; body `C-c-selesai-b`; buttons
  `C-b-belum-lanjut` ("Belum, lanjut", default focus, primary style) and `C-b-ya-selesai` (secondary style;
  both full width, stacked). Labels name the action (ux-copy), not a bare "Kembali".
- **Belum, lanjut** closes the panel, nothing changes, focus returns to the Selesai button.
- **Ya, selesai** triggers the close (technical spec §8.3 rule 10). The debrief starts. The headline becomes
  `ended` and the Mulai note (5.4) shows.

### 5.6 Batalkan sesi (cancel: two steps, arm delay, stated cost)

- **Where:** only in `running` and `interrupted`. Never in `idle`, `ended`, `ended_auto`, `discarded`,
  `error`, `unsupported`, `tab_busy`. Never in the slot Mulai occupied.
- **Button:** `C-b-batalkan`, text style, 48 px, full width, below the primary slot, at least 24 px from
  the Selesai button.
- **Step 1.** Tap opens the inline panel in place of the Selesai and Batalkan buttons. Capture keeps
  running; headline still green.
- **Step 2 (panel, stacked full width, see Q-U3):**
  - Heading `C-c-cancel-h` (with HH:MM of the session start, shop phone only).
  - Body `C-c-cancel-b` (the §9 wording, which states the cost: today does not count).
  - `C-b-tetap-simpan` ("Tetap simpan sesi") first, default focus, larger primary style. It names what
    stays, not "Kembali" (ux-copy: label buttons with the action).
  - `C-b-ya-hapus`, red, below `C-b-tetap-simpan` with 12 px between, **disabled for the first 1 s** after open
    (`DISCARD_ARM_MS = 1000`).
  - Panel closes by itself after 15 s with no tap (`DISCARD_PANEL_TIMEOUT_MS = 15000`); status `C-c-autoclose`
    is announced; nothing has changed.
- **One discard only.** After "Ya, hapus sesi" both buttons are disabled until the state is `discarded`. The
  panel closes; headline becomes `C-h-discarded`; focus moves to the headline.
- **Cost stated on the panel:** "Hari ini tidak dihitung" and the Mulai time. The cost is shown, not hidden.
- **Server line** under the discarded headline: `C-srv-pending` while the POST is pending, `C-srv-offline` while it is failing, `C-srv-done` for 10 s after the 200, then hidden.
- **Panel copy after the Mulai time has passed:** `C-c-cancel-b-now` replaces `C-c-cancel-b`.
- **Sesi dibatalkan** is a neutral state, not an alarm.

[A] Both panels are inline groups, not modal. Focus moves to the default button on open (`C-b-belum-lanjut` in
the Selesai panel, `C-b-tetap-simpan` in the cancel panel); focus returns to the trigger on close; Escape closes a
panel. The 15 s auto-close is announced with no focus move.

[X] Cancel deletes a real day's data, so a stray tap loses work. Two steps, a 1 s arm delay, the stated cost
and default focus on `C-b-tetap-simpan` are the safeguards. There is no time window (technical spec §8.9 and Q-decision 4 Oct).

### 5.7 Upload block (axis 2)

One block under the actions, `role="status"` (polite), updated in place. It never changes the headline.
Shown in every mode, including idle, ended and discarded. One language per screen (section 3 rule 1, rev 4).

Order inside the block, top to bottom (Decision A: lost line first):

| Row | Condition | Copy key | Visual | Notes |
|---|---|---|---|---|
| 0 (new, G5) | session start POST not yet confirmed by server after the phone's retries | `C-u-start-fail` | warn ▲ | Technical spec §8.8 needs this row. Tech-lead to confirm detection (section 10, T4) |
| L (lost line) | a segment was dropped (prune, server refusal, 4xx drop) and no 2xx has cleared it | `C-u-lost` + `C-u-lost-help` (below) | warn ▲, bold | Beside row 1 or 2; shown first in the block. Clears on the next 2xx (B). Announced once on first appearance, never on the poll |
| 1 | queued, last attempt failed (network, server, auth) | `C-u-retry` (proposed; "Belum terkirim", G6) | warn ▲, count grows (2x), (3x) | Count only goes up. Never shows "berhasil" while the head still fails |
| 1a | hint: server error while online | `C-u-server` | muted, under row 1 | Only for a real server error while `navigator.onLine` |
| 1b | hint: auth error and 3 or more tries | `C-u-auth` | warn, under row 1 | Only for auth at N ≥ 3 |
| 2 | queued or in flight | `C-u-up` | muted; dots off under reduced motion | |
| 3 | queue empty, last segment uploaded | `C-u-ok` | ok ● | Not shown while the lost line is up |
| 4 | queue empty, last segment dropped | the lost line (L) | warn ▲ | Same as L. Row 4 copy is the lost line, not "dilewati" (C) |
| 5 | nothing uploaded since page load | (hidden) | none | |

**Lost-line helper (decided 6 Oct, UI/UX; tech-lead feasibility answer pending, see §8 F).** One line under the
lost value, the same for every drop cause, key `C-u-lost-help`: "Catatan itu jadi tidak lengkap. Tidak bisa dipulihkan." /
"That note is now incomplete. It cannot be recovered." It is true for prune, server refusal and 4xx drops alike, and it
tells staff not to chase the audio. It does not name a cause, because the phone does not yet record which drop cause
applied (no `lastDropCause`). Showing a cause-specific line on a drop would be a guess.

**Known-cause path (P3 refusal only).** At the P3 refusal site the cause is known, so the queue line stays:
`C-u-lost-qfull` (value D, "Antrean HP penuh · suara baru tidak tercatat / Phone queue full · new speech not
captured") and `C-u-lost-qfull-act` ("Hubungkan ke internet agar antrean terkirim."). P1 prune and all drops use
`C-u-lost-help`.

**Deferred: `C-u-lost-drop`** ("Server menolak sebagian rekaman. Catatan itu jadi tidak lengkap. Tidak bisa dipulihkan.", second line aligned to `C-u-lost-help`, Decided by UI/UX, 7 Oct). It shows only
after the engine records `lastDropCause` at each drop site and the P2 gap write exists. Not shown in P1.

**Success toast (C10, open).** Design default shown in the 4 Oct version: one 3 s polite message on the
transition from a retry row back to row 3, `C-u-toast`. Technical spec §8.8 says success is a line state only.
Not decided (Q-U12). Routine uploads never toast.

**Lost line clears on the next 2xx (decision B).** Staff cannot recover dropped audio, so no acknowledge
button. The loss stays in the gap ledger for the supervisor (`queue_full` / `segment_dropped`), not on the
phone. Dependency: the gap write (P2) must exist before this clearing rule ships (tech-lead order, section 10).

**Late drop from a stopped session (tech-lead ruling, 7 Oct, delegated by Rangga; option a kept).** A segment
captured before Stop can still be uploading after a new session starts and has already had a 2xx. If that
segment then really fails (the stopped engine's `lostSinceSuccess` flips false to true), the lost line comes back.
That audio is truly gone, and a drop that happens after the last 2xx is a new loss that no 2xx has cleared yet,
which is exactly row L's condition. Decision B is still met: the line clears on the next 2xx from the newest
session. Only the newest session's 2xx clears it; a stopped session's late 2xx never does, and a stopped
session's report that was already losing (true to true) raises nothing. Built in
`app/capture/upload-retention.ts` (`retainEngineStatus`, older-generation branch); no code change.

**Screen-reader structure of the block (Decided by UI/UX, 7 Oct; option b, one region).** The whole upload
block is one `role="status"` (polite) region, mounted once on `/capture` and never remounted. The lost value and
its helper `C-u-lost-help` sit inside it and are read. The helper is **not** `aria-hidden`: "cannot be recovered"
is the fact that stops staff chasing audio, so hiding it would remove the one actionable line for screen-reader
users. The retry row's count `(2x)` sits in its own span marked `aria-hidden`, so a count change is never read
(section 7: count alone is noise). Option (a), two regions as built, is rejected: the retry row's text is read
again on each text change, and a lost line that appears with a retry row can announce as two utterances.

What a screen-reader user hears: (1) on first appearance of the lost line, one polite announcement: the lost
value, then the helper ("That note is now incomplete. It cannot be recovered."), once; nothing on the 30 s
poll or on count growth. (2) A new retry row (row 1) is announced once as its words only; a count change
is silent. Test on VoiceOver (iOS) and TalkBack or NVDA: if the count is still read, move it out of the region
(not a design change). Matches the one-block rule (section 5.7 intro): yes.

### 5.8 Debrief: entry card, questions, done, timeout

The debrief belongs to this device, not to a person. It starts at Selesai or the auto-stop, and lasts 1 h
(technical spec §8.3 rules 5 and 10; D1). No early release (Q30): answering everything does not end it.

**Entry card** (on `/capture`, only while this device's `debrief_ends_at_ms` is in the future):
- Heading `C-d-entry-h`. Line `C-d-entry-left` (minutes left, counts down). After the list loads, `C-d-entry-n`
  (question count; shown to the shop phone only, never to supervisors; no topic shown).
- Button `C-d-btn` (56 px). Under it `C-d-takes`.
- Under the card: `C-d-next` with the day and time (G2). The gate is honest about the wait.
- Zero open questions: the button still opens the debrief, which shows the empty state.

**Debrief list loading:** `C-d-load`, `aria-busy`. No question text before it loads.
**Load error:** `C-d-err`, with `C-b-coba` (48 px). Never a silent empty list.
**Empty (zero open questions):** `C-d-empty-h`, button `C-b-kembali` to `/capture`.

**Question screen (one per screen, no scroll list):**
- Progress `C-d-prog`, as text.
- Question, a template only: `C-d-q-step` (labelled step) or `C-d-q-block` (no labelled step). Never a name,
  role or quoted thread line. *Rangga 18 Oct (demo-feedback-2 item 10): on the SANDBOX (demo) the phone shows up to
  2 already-redacted lines of the flagged thread under the question (lead-in `C-d2-heard`, replacing the generic
  why line; read-time staff-name scrub, fail closed); the pilot keeps the template-only question.*
- Choice: `role="radiogroup"` with two `role="radio"` buttons `C-d-yes` and `C-d-no`, side by side at 360 px
  (about 170 px each), 48 px tall, `aria-checked`. Nothing preselected. A tap selects and does **not** advance.
  Selected state uses a fill and a check glyph, never colour alone. Arrow keys move within the group.
- Reason (appears after a choice): label `C-d-r-yes` or `C-d-r-no`, 4-row textarea, 16 px text, no
  `maxLength` (G4). The label switches with the choice; typed text is kept on switch.
- Counter: `C-d-count`, right-aligned. At 450 it changes to the warning tone **and** text `C-d-count-warn`
  ("50 lagi" as text, not colour).
- Over 500: Lanjut is disabled and `C-d-over` says how many characters to cut. Nothing is cut silently.
  The server refuses over 500 and never truncates (Q31).
- Footer: `C-b-lewati` (secondary, always enabled, left) and `C-b-lanjut` (primary, right). Lanjut is disabled
  until a choice is picked **and** the trimmed reason is non-empty. The disabled state explains itself with
  `C-d-help-dis` under it.
- **Lanjut** saves the answer to the phone first, then moves on. No auto-advance on a tap of Ya or Tidak. No
  back button. Once sent, the answer cannot be changed (`C-d-locked`, shown once in the helper).
- **Lewati** moves on and writes nothing. A half-typed reason on a skipped question is discarded.
- **Save to the phone fails:** `C-d-save-fail`, `role="alert"`, typed text kept, focus on the error.
- **Server refuses** (503, or 400/422 for a refused reason): `C-d-refused`, polite status. The answer stays
  in the phone cache until a 2xx. Never dropped on a refusal.
- **Offline:** `C-d-offline`. Answers keep working offline.

Focus: each new question moves focus to its heading. A refused Lanjut moves focus to the first error.

**Done screen (also the no-early-release screen):**
- Heading `C-d-done-h` (C6, decided).
- Line `C-d-done-l`. Neutral: never "fakta", "final" or "terkonfirmasi" (complaint, correction and incident
  categories wait for supervisor confirmation).
- If answers are still queued: `C-d-done-unsent` (the upload block keeps reporting).
- If questions were skipped: `C-d-done-skip`.
- Always: `C-d-done-mulai` (the day and time of the next Mulai).
- `C-b-kembali` to `/capture`. No per-answer recap (it would look like a stored transcript).
- Focus moves to the heading.

**Timeout (the clock reaches `debrief_ends_at_ms`, even mid-question):** the screen closes to `/capture`
with `C-d-timeout` (three lines: time ran out; sent answers kept; unsent text lost). Open questions expire as
unverified (D3).

**Reload mid-debrief:** resumes with the remaining time from `debrief_ends_at_ms`, never a fresh hour. The
typed text is not restored (not in storage; an unsent draft in `localStorage` is allowed as a convenience,
not required for MVP 1; Q-U13 covers it).

### 5.9 Riwayat: the history log (new)

A readable timeline of this phone's session and upload events. Route `app/capture/riwayat/page.tsx`
(name is a proposal). Linked from `/capture` as `C-b-riwayat` (secondary, 48 px, last on the page).

**Who:** shop staff on the shop phone. Supervisors and owners are not shown this screen in this design
(section 4; Q-U6). **Never shows:** names, audio, transcript, answer text, reason text, question text, or a
device id. Times and event types only.

**Layout.** Title `C-r-title`. Helper `C-r-help`. One block per business day, newest first, with the day
heading as its own line (`Rab 14 Okt`). Inside each block, events in time order, one event per line:
time (tabular, left, 16 px), then the event word. No icons needed; each event is text. Consecutive identical
upload events collapse into one line with a count (`C-r-ev-ok`, e.g. "Unggah berhasil (12x)").

| Event | Copy key | Shown as |
|---|---|---|
| Mulai pressed | `C-r-ev-start` | 10:00 Mulai ditekan |
| Selesai confirmed | `C-r-ev-end` | 14:00 Selesai ditekan |
| Auto-stop | `C-r-ev-auto` | 02:00 Berhenti otomatis |
| Debrief | `C-r-ev-debrief` | 14:00 Debrief sampai 15:00 |
| Debrief answers sent | `C-r-ev-answers` | "{N} jawaban terkirim" (count only) |
| Cancel | `C-r-ev-disc` | 10:05 Sesi dibatalkan · hari ini tidak dihitung |
| Upload succeeded | `C-r-ev-ok` | 15:12 Unggah berhasil |
| Upload retrying | `C-r-ev-retry` | 15:10 Belum terkirim · mencoba lagi |
| Lost | `C-r-ev-lost` | 15:40 Sebagian suara tidak tercatat |

Rules:
- Counts, times and event words only. The start time of a cancelled session is shown on the shop phone (as
  technical spec §8.9 allows); it is never shown to a supervisor.
- Business day heading uses the day of the business date (4.10), not the clock date. An event that happened
  at 00:40 on Thursday in Wednesday's session sits under Wednesday.
- Empty and retention line: see states.

**States:**

| State | Copy | Action |
|---|---|---|
| Empty (no session yet) | `C-r-empty` | none |
| Loading | `C-r-load` | none |
| Error (local read fails) | `C-r-err` | `C-b-coba` |
| Populated | the blocks above | none; back link is the header back control `C-b-kembali` to `/capture` |
| Offline | same as populated (events are on the phone) | none |
| Retention line | `C-r-keep` (open, Q-U6) | none |

**Data source (revision 3, G26):** the phone's own event store, local only, no server read in this design.
Each row holds only a timestamp, a business date and an enum (`start`, `end`, `auto_stop`, `discarded`,
`debrief_window`, `answers_sent` with a count, `upload_ok`, `upload_retry` with a count, `lost`). No text, no ids,
no names, no device id. Written at the same transitions that already change the session state, so it survives a
reload. Proposed store: IndexedDB `events` (new; the on-device store list, now technical spec §8.12, then had no such store) with a 14-day purge
(`C-r-keep`, Q-U6, T2).

**What P1 can show, and what waits (T1 fallback, pre-stated in section 10):**

| Phase | Rows shown | Why |
|---|---|---|
| P1 (session routes and calendar only) | start, end, auto-stop, discarded, debrief window, answers sent | All come from transitions P1 already makes. Needs only the new `events` write |
| P2 (outbox and gap ledger) | upload ok, upload retry, lost | Need the outbox and gap write. Until P2 the upload and lost rows are not listed, and the screen does not imply they are missing |

The history log is not a substitute for the supervisor record and never shows counts of staff, names or content.
If T1 finds that no transitions can write `events` in P1, the screen ships with the session store reads only
(start, end, cancel, debrief times) and the retention line is removed until T2 answers.

[X] The brief asks for a history log so staff can answer "did it run today, and when did it stop?" without
asking anyone. It is the only place a stopped capture gets an explanation after the fact.

### 5.10 Notice line, offline, and the no-consent state

**Notice line** (bottom, muted, 14 px). Pilot shows the approved line until P4 ships and Rangga's formal sign-off
includes the final line (technical spec §8.16). Demo shows the final line, split into lines without changing words.

- Pilot now: `C-notice-pilot`.
- Demo: `C-notice-demo-1` to `C-notice-demo-6`.

**Offline.** Covered per screen above. Summary: Mulai and capture work; the headline stays truthful; the upload
block says what is pending; the debrief answers save to the phone; the history log reads local events.

**No-consent state: not designed.** The brief asks for it, but technical spec §8.7 (4 Oct) removed `no_consent`,
and CLAUDE.md §7b says there is no consent gate or revoked-consent state in MVP 1. Designing one would
contradict the spec. Q-U7 asks Rangga to confirm.

### 5.11 Start failure while capture runs (new, G5)

If the session start POST has not been confirmed after the phone's retries: the headline stays
`listening` (the mic runs and frames flow; truthful). The upload block shows row 0 (`C-u-start-fail`).
Row 0 clears when the start is confirmed. Session content is unaffected. Tech-lead to confirm P1 can detect
this (T4).

---

### 5.12 Language toggle: Bahasa Indonesia / English (revision 4, new; English default from revision 5)

Applies to the shop-phone journey: `/pair`, `/capture` (every state), the debrief, and `/capture/riwayat`.
The same control and the same copy and switch rules apply to the supervisor and owner screens (Q-U21); their screens
are designed separately. Judge screens are not changed here. Decisions in this section are **Confirmed by Rangga 4 Oct**
(Q-U18 to Q-U24; the decision record is in section 8 and section 12).

**1. Where it lives: a segmented control in the top bar, on every screen. [UIUX decided]**
- Top bar, one row, 48 px tall: the brand mark `bee6` on the left, the control on the right. Nothing else.
- Control: two buttons side by side, `ID` and `EN`, each 48 × 48 px minimum (group 96 × 48 px). The pressed
  option is filled (`--accent` with `--on-fill`), bold, `aria-pressed="true"`. The other is outlined in `--edge`
  (3:1 on both surfaces, G22) with `--fg` text. Pressed is shown by fill and weight, never colour alone.
- Visible text is the code, `ID` or `EN`, in both modes. The codes are language-neutral, so the visible text
  never needs translating.
- Why this, and not a settings sheet, for a shop staff member on a 360 px phone:
  - The phone is fixed on a counter and read at a glance. Language is set once, and sometimes a visitor or an
    English speaker needs it at once. One visible control beats a gear, a sheet and a second tap.
  - A sheet would sit on top of the inline Selesai and Batalkan panels and the debrief, which already hold
    focus. Two stacked focus traps on a 360 px screen is a trap for a wet-handed tap. The top-bar control needs
    no layer at all.
  - It works mid-debrief and mid-question without leaving the screen (section 6, edge case c).
  - Both languages are visible at once, so the current one is never a guess. A single "English" toggle text
    would hide which language is on.
- Cost, stated: the top bar carries the control, so the brand mark shrinks to fit. The state word is unaffected.
  Top-right is the hardest reach on a phone, and the control is for setup and occasional use, not a daily tap.
  Confirmed by Rangga 4 Oct (Q-U18).

**2. Default language, first run, and memory (per device, no name, no account). [UIUX decided; default English confirmed Q-U20]**
- **Default is English (`en`)** on every new device, for every outlet, the demo outlet included (Q-U20, rev 5). The
  browser's language setting is not read, in either direction: it never decides the copy.
- **First run (`/pair`):** the control is in the top bar with `EN` pressed. Pairing is done in whichever language
  is pressed. No "choose your language" screen: it would add a step to a day-one phone that needs one code.
- **Remembered:** one cookie, `bee6_lang`, value `id` or `en`. Path `/`, `SameSite=Lax`, max age one year, no
  name, no account, no device id, no outlet id, no server write. The browser sets it on the tap.
- **Read on the server** in the shop-phone layout, so `<html lang>` is right on the first paint and a Bahasa
  device never flashes English. Technical choice (cookie rather than `localStorage`, so the server can read it)
  is for the tech-lead to confirm (section 10, i18n assessment).
- **Stored on the device only.** It is not sent in any API body, not written to Firestore, not written to the
  audit log, and not written into any event row. Clearing the browser's site data resets it to English. A
  private window forgets it when closed.

**3. What switches, and what never switches. [UIUX decided]**

Switches (every `C-…` key in section 6, and these surfaces):
- Headlines, notes, primary and secondary buttons, the Selesai and Batalkan panels, helpers, the pairing steps and
  errors, the upload block rows, cause helpers and the success toast (`C-u-toast`).
- The notices (`C-notice-…`). Both approved texts are in section 6; the EN privacy text needs Rangga's sign-off
  before it appears on the pilot page (technical spec §8.16).
- The debrief: entry card, question template, `Ya` and `Tidak`, reason labels, counter, over-limit and refused
  lines, done screen, timeout.
- The history log (5.9): title, empty and error states, event words, the day headings, the time and date
  abbreviations, and the "today does not count" wording.
- Status words that come from code, not from text: headline states, the upload states, and the debrief category
  label, which is an enum code mapped to copy (see below).
- Live-region text, `aria-label`s, the toggle's own group label, and `<html lang>`.

Never switches:
- **Outlet id** (raw, C7), **staff names** (none is ever shown), **device id** (never shown), **session ids**.
- **Numbers and clock times** as digits. They keep their form, and only the words around them switch. A time is
  always `HH:MM`, 24-hour, with a colon, in both languages.
- **Typed text.** A debrief reason the staff member typed is shown exactly as typed, in whatever language it was
  typed. It is never translated, not by a model and not by a dictionary. Sending a staff member's words to a
  model for translation would move their text off the phone for a purpose the screen never states (CLAUDE.md
  §2 rules 3 and 6 and section 4 of this file, in spirit). The reason goes only to our own API, as it does today.
- **Proofed's and GATI's own text**, if any reaches the phone (none is planned on `/capture`): shown as written.
- **Brand and product names:** `bee6`, `GATI`, `Proofed`, `SOP`, `debrief`. These are the same words in both
  columns.
- **Question step labels from the database.** The debrief's `<langkah>` (`{langkah}` / `{step}`) is a model
  category enum, not free text. Each enum code has one ID label and one EN label in the copy table, so the
  phone never shows a raw label from the database in the wrong language. A code with no label in the table
  falls back to the unlabelled template in the current language (`C-d-q-block`). The EN labels are in section 6
  (category table, UI/UX draft, final sign-off Rangga). The ID labels are pending Rangga (Q-U23).

**4. Copy rules for both languages (replaces C9). [UIUX decided]**
- One complete sheet per language (section 3 rule 1). Same key, same meaning, one line each, same 59-character
  budget (section 3 rule 2). Max three lines per string in either language.
- **Glossary.** One word per concept, per language. Fixed:

  | Concept | ID | EN |
  |---|---|---|
  | Mulai (button, action) | Mulai | Start |
  | Selesai (action) | Selesai | End |
  | Selesai (state) | Selesai | Ended |
  | Batalkan sesi | Batalkan sesi | Cancel session |
  | Sesi | sesi | session |
  | Catatan kerja (work note) | catatan kerja | work note |
  | Mendengarkan (listening) | Mendengarkan | Listening |
  | Debrief | debrief | debrief |
  | Hari operasional (business day) | hari operasional | business day |
  | Kembali (navigation only) | Kembali | Back |

  Consequence, flagged: PRODUCT.md says "keep these words the same across every screen". That holds inside each
  language. In EN, "Mulai" is "Start" and "Selesai" is "End" on the button and "Ended" as the state. The Bahasa
  word stays the canonical name for the product's terms (PRODUCT.md, Terminology). Confirmed by Rangga 4 Oct (Q-U22): the glossary is kept as written.
- **Dates and times.** Time: `HH:MM` 24-hour in both. Day and month abbreviations per language:
  - ID: Sen, Sel, Rab, Kam, Jum, Sab, Min. Jan, Feb, Mar, Apr, Mei, Jun, Jul, Agu, Sep, Okt, Nov, Des.
  - EN: Mon, Tue, Wed, Thu, Fri, Sat, Sun. Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec.
  - Day, then date, then month, in both: "Kam 15 Okt" and "Thu 15 Oct". Dates are always written out (rule 5).
  - Tables in code, not `Intl`, so the output is the same in every browser (tech-lead, section 10).
- **Plurals.** ID has none. EN has a singular for the count 1 ("1 answer sent", "1 question"). The dictionary
  carries one singular form for each count string in EN.
- **Ellipsis, quotes and apostrophes.** `…` in both. Typographic apostrophe in EN (`can’t`). ID uses no
  apostrophes.
- **Machine translation at run time: not used.** Every string is a reviewed key. Nothing is translated on the
  fly, including the user's typed text (section 3).

**5. Accessibility of the switch. [UIUX decided]**
- **`<html lang>`** is `id` or `en`. It is set on the first paint from the cookie, and changed in the same tap
  that changes the copy. The page `<title>` stays `bee6` in both.
- **Announcement of the change.** A separate polite live region, empty until a tap, gets one line in the new
  language: `C-lang-said` ("Bahasa Indonesia dipilih." or "English selected."). That is the only sound a switch
  makes. It is spoken in the language the screen now uses.
- **The toggle's own label is in the current language.** The group's accessible name is `C-lang-group` ("Pilih
  bahasa" in ID, "Choose language" in EN). Each option's accessible name is its endonym, "Bahasa Indonesia" and
  "English", in both modes, because a language's own name is not translated. Judgement call, Q-U19.
- **Focus stays put.** Tapping the pressed option does nothing. Tapping the other option keeps focus on that
  button: the control is not re-mounted, and it keeps its key and place. Focus does not move to the headline.
  Keyboard: Tab reaches the two options in order; Enter or Space activates.
- **Nothing is re-announced.** The headline, the upload block, the debrief question and an open panel keep their
  state. Live regions announce on a state change, not on a text change (section 7).
- **Motion.** No transition on the switch. The text changes in place.
- **Contrast and size.** Pressed text on the pressed fill (`--on-fill` on `--accent`): 7.93:1 light, 10.18:1 dark.
  Pressed fill against the page (`--accent` on `--bg`): 7.42:1 light, 10.18:1 dark is checked in section 2 tokens.
  Outline (`--edge`, a non-text control edge, needs 3:1): 4.97:1 light, 4.19:1 dark. Targets 48 px.

**6. Edge cases. [UIUX decided]**

a. **Debrief answer typed in one language, read in the other.** The typed reason is shown exactly as typed and
   never translated. Its label switches (`C-d-r-yes` or `C-d-r-no`), the counter switches (`{N}/500 · {M} left`),
   and the Lanjut helper switches. The textarea is not re-mounted, so the text, the caret and the focus stay.
   The phone never shows the typed text again (no recap, the done screen shows counts only), so a switch never
   shows an answer in the other language.

b. **History log timestamp format.** Time column: `HH:MM` 24-hour, colon, in both languages (the pattern in
   section 5.9 stays). Day heading: "Rab 14 Okt" in ID, "Wed 14 Oct" in EN, always written out. The business-date
   rule (4.10) is unchanged. Event rows are stored as enum codes and text is rendered from the code in the
   current language, so past rows switch too. A stored row never holds text (technical spec §8.12, section 11 X20).

c. **A language switch while a session runs: nothing restarts.** The switch is presentation only. It is not a
   state event: no `MULAI`, `SELESAI`, `RESUME`, `CANCEL` or any reducer action. Capture, the mic, the upload
   outbox, the debrief clock, the auto-stop timer, the 30 s availability timer and the 1 s arm delay and 15 s
   auto-close timer all keep their schedule. No fetch, no navigation, no reload. An open Selesai or Batalkan panel
   stays open with its focus. A debrief question keeps its position, its choice and its typed reason. A
   `mic_error` or `stalled` headline keeps its state and announces nothing new. Test (new T in backlog §3a language tests,
   section 11 X21): switch during running, panel open, typed reason, stalled and debrief; state, timers and focus
   unchanged after each switch.

d. **Status names in both languages.** The state words are the copy table's `C-h-…` keys. Summary (full text in
   section 6):

   | State | ID | EN |
   |---|---|---|
   | `idle` | Belum mulai | Not started |
   | `listening` | Mendengarkan | Listening |
   | `mic_error` | Mikrofon bermasalah · tidak mendengarkan | Microphone problem · not listening |
   | `stalled` | Rekaman terhenti · mencoba lagi | Recording stopped · retrying |
   | `interrupted` | Tidak mendengarkan · sesi masih terbuka | Not listening · session still open |
   | `ended` | Selesai | Ended |
   | `ended_auto` | Selesai otomatis pukul {HH:MM} | Ended automatically at {HH:MM} |
   | `discarded` | Sesi dibatalkan | Session cancelled |
   | `loading` | Memuat… | Loading… |
   | `error` | Jam buka belum termuat | Opening hours not loaded yet |
   | `unsupported` | Browser ini belum didukung | This browser is not supported |
   | `tab_busy` | Sudah terbuka di tab lain | Open in another tab |

   Upload words: "Belum terkirim · mencoba lagi ({N}x)" / "Not sent yet · retrying ({N}x)"; "Mengunggah" /
   "Uploading"; "Unggah berhasil" / "Upload succeeded"; "Server sibuk" / "Server busy"; "Hubungi supervisor" /
   "Contact the supervisor"; "Sebagian suara tidak tercatat" / "Some speech was not captured".

   The same word on two screens, two meanings in EN: `Selesai` is the button ("End") and the state ("Ended").
   The EN copy keeps the two apart on purpose, and the tap-to-end panel names its action ("End today's
   operations?", "Yes, end").

e. **Debrief category label with no entry in the table.** The question falls back to the unlabelled template in
   the current language (`C-d-q-block`). The phone never shows a database label in the wrong language.

f. **Switch during a panel timer or a pairing submit.** A switch during the 15 s Batalkan auto-close keeps the
   timer and announces `C-c-autoclose` in the new language. A switch during a pairing submit keeps the busy state
   and `aria-busy`; the code is not re-sent and the digits stay.

g. **Switch on a screen with no content yet** (`loading`, `error`, `unsupported`, `tab_busy`): the control is
   still in the top bar and works. The state word and its next action switch with it.

## 6. Copy sheet (every string; EN and ID columns, EN first; measured by script in section 9a)

**Decided by UI/UX, 7 Oct: lost-help wording (final).** `C-u-lost-help` keeps the two sentences, EN "That note is
now incomplete. It cannot be recovered." (52 characters) and ID "Catatan itu jadi tidak lengkap. Tidak bisa
dipulihkan." (54 characters). "Now" marks the change from complete; "cannot be recovered" stops staff chasing audio.
The one-sentence line that was in `C-u-lost-drop` (deferred key) now carries the same second sentence, so the
two keys match. No other key changes.

**Approval status (6 Oct).** Rangga approved the copy already in this sheet on 6 Oct, which covers the EN column
(previously "UI/UX draft"), the ID column, the EN singular forms and the EN debrief category labels. Every existing
key carries the mark "Approved by Rangga 6 Oct" in the Status column. Approval does not cover the formal technical
spec §8.16 privacy sign-off (still needed before the pilot page), the ID debrief category labels (Q-U23, still
pending), or the supervisor and owner strings in section 14. The provisional strings named in the approval
(`C-pair-srv`, the capture headline and the hours copy) are not in this doc: no key carries a PROVISIONAL tag, and
`C-pair-srv` is not a key in this sheet. The capture headline and hours keys are `C-h-*`, `C-n-open` and `C-m-*`,
all approved above. New keys added 6 Oct under delegation are marked "Written by UI/UX 6 Oct, approved by Rangga
(delegated)". Their dictionary form is in `docs/tasks/UX-03-copy-keys.md`.

**Added 7 Oct (delegated to UI/UX by Rangga, marked "Written by UI/UX 7 Oct, delegated to UI/UX by Rangga"):**
`C-h-idle-help` and `C-u-inet`. **Decided by UI/UX, 7 Oct:** `C-cap-title` (page heading, section 5.2 Q2). The sheet is now 134 keys. Capture privacy notice: no new key. The approved
final line (§12 / Q-U24) is already keyed as `C-notice-demo-1` to `C-notice-demo-6` (demo outlet, both columns) and
`C-notice-pilot` (pilot, approved 6 Oct). Both are reused unchanged; the formal technical spec §8.16 sign-off is still open.

Revision 4 (language toggle, section 5.12). Revision 5: the **EN** column (English, the default) is the primary column and comes first; the **ID** column
(Bahasa Indonesia) is second and is unchanged from rev 4. The phone shows one column at a time, chosen by the language switch. Rules: every key exists
in both columns; no line mixes languages; no `/` pairs and no gloss (this replaces C9, section 3 rule 1); each
line is at most 59 characters in either column, measured with placeholders as written (section 9a).

Format: one row per key. `L1`, `L2`, `L3` are the lines of that string (empty if none). Placeholders:
`{HH:MM}` 24-hour time (the colon form in both languages); `{Kam 15 Okt}` / `{Thu 15 Oct}` a day written out in
that language's abbreviations; `{N}`, `{M}` counts; `{mm}` minutes; `{langkah}` / `{step}` the debrief category
label, mapped from its enum code in each language (section 5.12.3, Q-U23); `{outlet_id}` raw id; `{N}` in an
EN count with the value 1 uses the singular form (section 5.12.4). `{HH:MM}` window end where stated.

| Key | EN L1 | EN L2 | EN L3 | ID L1 | ID L2 | ID L3 | Status |
|---|---|---|---|---|---|---|---|
| C-pair-title | Set up this device |  |  | Pasang perangkat ini |  |  | Approved by Rangga 6 Oct |
| C-pair-help | Enter the 6-digit code from the person who | set up this phone. |  | Masukkan 6 digit kode dari orang yang memasang HP ini. |  |  | Approved by Rangga 6 Oct |
| C-pair-label | 6-digit code |  |  | Kode 6 digit |  |  | Approved by Rangga 6 Oct |
| C-pair-need | Enter all 6 digits to set up. |  |  | Isi 6 digit untuk bisa memasang. |  |  | Approved by Rangga 6 Oct |
| C-b-pasang | Set up |  |  | Pasang |  |  | Approved by Rangga 6 Oct |
| C-pair-busy | Setting up… |  |  | Memasangkan… |  |  | Approved by Rangga 6 Oct |
| C-pair-refused | Code not recognized or already used. | Ask the person who set up this phone for a new code. |  | Kode tidak dikenali atau sudah dipakai. | Minta kode baru dari orang yang memasang HP ini. |  | Approved by Rangga 6 Oct |
| C-pair-net | No connection. | Try again when the signal is steady. |  | Tidak ada koneksi. | Coba lagi saat sinyal stabil. |  | Approved by Rangga 6 Oct |
| C-pair-ok-h | Phone set up |  |  | HP terpasang |  |  | Approved by Rangga 6 Oct |
| C-pair-ok-line | For outlet {outlet_id} |  |  | Untuk outlet {outlet_id} |  |  | Approved by Rangga 6 Oct |
| C-pair-step-1 | Leave the phone in one fixed place and plug in the charger. |  |  | Letakkan HP di tempat tetap dan colokkan charger. |  |  | Approved by Rangga 6 Oct |
| C-pair-step-2 | Keep the screen on and this page open. | Closing the page means not listening. |  | Layar tetap menyala dan halaman ini tetap terbuka. | Menutup halaman berarti tidak mendengarkan. |  | Approved by Rangga 6 Oct |
| C-pair-step-3 | You can tap Start from 01:00 until {HH:MM}, | on each open day. |  | Mulai bisa ditekan 01:00 sampai {HH:MM}, tiap hari buka. |  |  | Approved by Rangga 6 Oct |
| C-pair-step-4 | The End button appears 4 hours after Start. |  |  | Selesai muncul 4 jam setelah Mulai. |  |  | Approved by Rangga 6 Oct |
| C-b-buka-mendengarkan | Open the listening page |  |  | Buka halaman mendengarkan |  |  | Approved by Rangga 6 Oct |
| C-h-loading | Loading… |  |  | Memuat… |  |  | Approved by Rangga 6 Oct |
| C-h-error | Opening hours not loaded yet |  |  | Jam buka belum termuat |  |  | Approved by Rangga 6 Oct |
| C-h-error-help | Opening hours have not loaded yet. | Connect to the internet once, then reopen. |  | Jam buka belum termuat. Sambung internet sekali, lalu buka. |  |  | Approved by Rangga 6 Oct |
| C-h-unsupported | This browser is not supported |  |  | Browser ini belum didukung |  |  | Approved by Rangga 6 Oct |
| C-h-unsupported-help | Open this page in another browser, | then try again. |  | Buka halaman ini di browser lain, lalu coba lagi. |  |  | Approved by Rangga 6 Oct |
| C-h-tabbusy | Open in another tab |  |  | Sudah terbuka di tab lain |  |  | Approved by Rangga 6 Oct |
| C-h-tabbusy-help | Close the other tab, then tap Try again. |  |  | Tutup tab lain, lalu ketuk Coba lagi. |  |  | Approved by Rangga 6 Oct |
| C-h-idle | Not started |  |  | Belum mulai |  |  | Approved by Rangga 6 Oct |
| C-h-idle-help | Tap Start to begin today's session. |  |  | Ketuk Mulai untuk memulai sesi hari ini. |  |  | Written by UI/UX 7 Oct, delegated to UI/UX by Rangga. Shown only when Mulai is offered (5.2); otherwise the Mulai reason note from 5.4 |
| C-cap-title | Shop phone |  |  | HP toko |  |  | Decided by UI/UX, 7 Oct (5.2 Q2). Fixed page heading on every state. Replaces the provisional "Shop listening" / "Mendengarkan toko" |
| C-h-listening | Listening |  |  | Mendengarkan |  |  | Approved by Rangga 6 Oct |
| C-h-mic | Microphone problem · not listening |  |  | Mikrofon bermasalah · tidak mendengarkan |  |  | Approved by Rangga 6 Oct |
| C-h-mic-help | Check the microphone permission in the browser, | then try again. |  | Cek izin mikrofon di browser, lalu coba lagi. |  |  | Approved by Rangga 6 Oct |
| C-h-stalled | Recording stopped · retrying |  |  | Rekaman terhenti · mencoba lagi |  |  | Approved by Rangga 6 Oct |
| C-h-stalled-help | Wait a moment. If it has not come back, | tap Try again. |  | Tunggu sebentar. Jika belum kembali, ketuk Coba lagi. |  |  | Approved by Rangga 6 Oct |
| C-h-interrupted | Not listening · session still open |  |  | Tidak mendengarkan · sesi masih terbuka |  |  | Approved by Rangga 6 Oct |
| C-h-interrupted-help | Tap Continue to resume the same session. |  |  | Ketuk Lanjutkan untuk melanjutkan sesi yang sama. |  |  | Approved by Rangga 6 Oct |
| C-h-ended | Ended |  |  | Selesai |  |  | Approved by Rangga 6 Oct |
| C-h-ended-auto | Ended automatically at {HH:MM} |  |  | Selesai otomatis pukul {HH:MM} |  |  | Approved by Rangga 6 Oct |
| C-h-discarded | Session cancelled |  |  | Sesi dibatalkan |  |  | Approved by Rangga 6 Oct |
| C-n-open | Opening time. Tap Start to begin listening. | You can tap Start until {HH:MM}. |  | Sudah jam buka. Tekan Mulai untuk mulai mendengarkan. | Mulai bisa ditekan sampai pukul {HH:MM}. |  | Approved by Rangga 6 Oct |
| C-n-selesai-from | You can tap End from {HH:MM}. |  |  | Selesai bisa ditekan mulai pukul {HH:MM}. |  |  | Approved by Rangga 6 Oct |
| C-n-closing | Closing time has passed. Tap End when operations are done. | Recording stops automatically at {HH:MM}. |  | Sudah jam tutup. Tekan Selesai bila operasional selesai. | Rekaman berhenti otomatis pukul {HH:MM}. |  | Approved by Rangga 6 Oct |
| C-n-autostop-soon | Recording stops automatically at {HH:MM} ({N} min left). |  |  | Rekaman berhenti otomatis pukul {HH:MM} ({N} menit lagi). |  |  | Approved by Rangga 6 Oct |
| C-m-day-ended | The business day {Wed 14 Oct} has ended. | You can tap Start again {Thu 15 Oct} at {HH:MM}. |  | Hari operasional {Rab 14 Okt} sudah selesai. | Mulai bisa ditekan lagi {Kam 15 Okt} pukul {HH:MM}. |  | Approved by Rangga 6 Oct |
| C-m-debrief | The debrief runs until {HH:MM}. | You can tap Start again {Thu 15 Oct} at {HH:MM}. |  | Debrief berlangsung sampai pukul {HH:MM}. | Mulai bisa ditekan lagi {Kam 15 Okt} pukul {HH:MM}. |  | Approved by Rangga 6 Oct |
| C-m-window-passed | The Start cut-off today passed at {HH:MM}. | Today is recorded as a day off. | Next Start {Thu 15 Oct} at 01:00. | Batas Mulai hari ini sudah lewat pukul {HH:MM}. | Hari ini dicatat libur. | Mulai lagi {Kam 15 Okt} pukul 01:00. | Approved by Rangga 6 Oct |
| C-m-closed | Closed today. Next Start {Fri 16 Oct} at 01:00. |  |  | Hari ini tutup. Mulai berikutnya {Jum 16 Okt} pukul 01:00. |  |  | Approved by Rangga 6 Oct |
| C-b-mulai | Start |  |  | Mulai |  |  | Approved by Rangga 6 Oct |
| C-b-mulai-busy | Starting… |  |  | Memulai… |  |  | Approved by Rangga 6 Oct |
| C-b-selesai | End |  |  | Selesai |  |  | Approved by Rangga 6 Oct |
| C-b-batalkan | Cancel session |  |  | Batalkan sesi |  |  | Approved by Rangga 6 Oct |
| C-b-kembali | Back |  |  | Kembali |  |  | Approved by Rangga 6 Oct |
| C-b-belum-lanjut | Not yet, keep going |  |  | Belum, lanjut |  |  | Approved by Rangga 6 Oct |
| C-b-tetap-simpan | Keep the session |  |  | Tetap simpan sesi |  |  | Approved by Rangga 6 Oct |
| C-b-ya-selesai | Yes, end |  |  | Ya, selesai |  |  | Approved by Rangga 6 Oct |
| C-b-ya-hapus | Yes, delete session |  |  | Ya, hapus sesi |  |  | Approved by Rangga 6 Oct |
| C-b-lanjutkan | Continue |  |  | Lanjutkan |  |  | Approved by Rangga 6 Oct |
| C-b-coba | Try again |  |  | Coba lagi |  |  | Approved by Rangga 6 Oct |
| C-b-lewati | Skip |  |  | Lewati |  |  | Approved by Rangga 6 Oct |
| C-b-lanjut | Next |  |  | Lanjut |  |  | Approved by Rangga 6 Oct |
| C-b-riwayat | View history |  |  | Lihat riwayat |  |  | Approved by Rangga 6 Oct |
| C-c-selesai-h | End today’s operations? |  |  | Akhiri operasional hari ini? |  |  | Approved by Rangga 6 Oct |
| C-c-selesai-b | The 1-hour debrief starts now. This cannot be undone. | You can tap Start again {Thu 15 Oct} at {HH:MM}. |  | Debrief 1 jam dimulai sekarang. Tidak bisa dikembalikan. | Mulai baru bisa ditekan lagi {Kam 15 Okt} pukul {HH:MM}. |  | Approved by Rangga 6 Oct |
| C-c-cancel-h | Cancel the session started at {HH:MM}? |  |  | Batalkan sesi yang dimulai pukul {HH:MM}? |  |  | Approved by Rangga 6 Oct |
| C-c-cancel-b | Its audio and notes will be deleted. | This cannot be undone. Today does not count. | You can tap Start again {Thu 15 Oct} at 01:00. | Suara dan catatan sesi ini akan dihapus. | Tidak bisa dikembalikan. Hari ini tidak dihitung. | Mulai baru bisa ditekan lagi {Kam 15 Okt} pukul 01:00. | Approved by Rangga 6 Oct |
| C-c-cancel-b-now | Its audio and notes will be deleted. | This cannot be undone. Today does not count. | You can tap Start again straight away. | Suara dan catatan sesi ini akan dihapus. | Tidak bisa dikembalikan. Hari ini tidak dihitung. | Mulai baru bisa ditekan segera. | Approved by Rangga 6 Oct |
| C-c-autoclose | The panel closed. Nothing has changed. |  |  | Panel ditutup. Tidak ada yang berubah. |  |  | Approved by Rangga 6 Oct |
| C-srv-pending | Removing from server… |  |  | Menghapus dari server… |  |  | Approved by Rangga 6 Oct |
| C-srv-offline | Will be removed when online |  |  | Akan dihapus saat online |  |  | Approved by Rangga 6 Oct |
| C-srv-done | Removed |  |  | Sudah dihapus |  |  | Approved by Rangga 6 Oct |
| C-u-start-fail | Session not on the server yet | Will be sent when online. |  | Sesi belum tercatat di server | Akan dikirim saat online. |  | Approved by Rangga 6 Oct |
| C-u-retry | Not sent yet · retrying ({N}x) |  |  | Belum terkirim · mencoba lagi ({N}x) |  |  | Approved by Rangga 6 Oct |
| C-u-retry-help | It sends by itself once the phone can reach the server. |  |  | Terkirim sendiri saat HP bisa menjangkau server. |  |  | Written by UI/UX 6 Oct, approved by Rangga (delegated) |
| C-u-server | Server busy |  |  | Server sibuk |  |  | Approved by Rangga 6 Oct |
| C-u-server-help | It will try again on its own. No action needed. |  |  | Akan dicoba lagi sendiri. Tidak perlu tindakan. |  |  | Written by UI/UX 6 Oct, approved by Rangga (delegated) |
| C-u-inet | No internet. Connect so the queued items can send. |  |  | Tidak ada internet. Sambungkan agar antrean terkirim. |  |  | Written by UI/UX 7 Oct, delegated to UI/UX by Rangga. Shown when the browser reports no connection (upload block, 5.7) |
| C-u-auth | Contact the supervisor |  |  | Hubungi supervisor |  |  | Approved by Rangga 6 Oct |
| C-u-up | Uploading |  |  | Mengunggah |  |  | Approved by Rangga 6 Oct |
| C-u-ok | Upload succeeded |  |  | Unggah berhasil |  |  | Approved by Rangga 6 Oct |
| C-u-lost | Some speech was not captured |  |  | Sebagian suara tidak tercatat |  |  | Approved by Rangga 6 Oct |
| C-u-lost-qfull | Phone queue full · new speech not captured |  |  | Antrean HP penuh · suara baru tidak tercatat |  |  | Approved by Rangga 6 Oct |
| C-u-lost-qfull-act | Connect to the internet so the queue can send. |  |  | Hubungkan ke internet agar antrean terkirim. |  |  | Approved by Rangga 6 Oct |
| C-u-lost-drop | The server refused some recordings. | That note is now incomplete. It cannot be recovered. |  | Server menolak sebagian rekaman. | Catatan itu jadi tidak lengkap. Tidak bisa dipulihkan. |  | Approved by Rangga 6 Oct. Line 2 aligned to C-u-lost-help, Decided by UI/UX, 7 Oct. Deferred: not shown in P1 (5.7, §8 F) |
| C-u-lost-help | That note is now incomplete. It cannot be recovered. |  |  | Catatan itu jadi tidak lengkap. Tidak bisa dipulihkan. |  |  | Decided by UI/UX, 6 Oct; wording final, Decided by UI/UX, 7 Oct (tech-lead feasibility answer pending) |
| C-u-toast | Upload working again |  |  | Unggah berhasil lagi |  |  | Approved by Rangga 6 Oct |
| C-d-entry-h | Debrief running |  |  | Debrief berjalan |  |  | Approved by Rangga 6 Oct |
| C-d-entry-left | {mm} minutes left. |  |  | Sisa {mm} menit. |  |  | Approved by Rangga 6 Oct |
| C-d-entry-n | {N} questions. |  |  | {N} pertanyaan. |  |  | Approved by Rangga 6 Oct |
| C-d-btn | Answer questions |  |  | Jawab pertanyaan |  |  | Approved by Rangga 6 Oct |
| C-d-takes | Takes about 5 minutes. |  |  | Butuh sekitar 5 menit. |  |  | Approved by Rangga 6 Oct |
| C-d-next | You can tap Start again {Thu 15 Oct} at {HH:MM}. |  |  | Mulai bisa ditekan lagi {Kam 15 Okt} pukul {HH:MM}. |  |  | Approved by Rangga 6 Oct |
| C-d-load | Loading questions… | Usually takes a few seconds. |  | Memuat pertanyaan… | Biasanya beberapa detik. |  | Approved by Rangga 6 Oct |
| C-d-err | Questions could not load yet. | Check the connection, then try again. |  | Pertanyaan belum bisa dimuat. | Cek koneksi, lalu coba lagi. |  | Approved by Rangga 6 Oct |
| C-d-empty-h | There are no questions today. | Thank you. |  | Tidak ada pertanyaan hari ini. | Terima kasih. |  | Approved by Rangga 6 Oct |
| C-d-prog | Question {N} of {M} |  |  | Pertanyaan {N} dari {M} |  |  | Approved by Rangga 6 Oct |
| C-d-q-step | Around {HH:MM} there was {step}. Is that right? |  |  | Sekitar pukul {HH:MM} ada {langkah}. Benar? |  |  | Approved by Rangga 6 Oct |
| C-d-q-block | Between {HH:MM} and {HH:MM} there was work. | Is that right? |  | Sekitar pukul {HH:MM}–{HH:MM} ada kegiatan kerja. Benar? |  |  | Approved by Rangga 6 Oct |
| C-d-yes | Yes |  |  | Ya |  |  | Approved by Rangga 6 Oct |
| C-d-no | No |  |  | Tidak |  |  | Approved by Rangga 6 Oct |
| C-d-r-yes | Did it follow the SOP? If not, why? | Required. No names. |  | Sudah sesuai SOP? Kalau belum, kenapa? | Wajib diisi, tanpa nama. |  | Approved by Rangga 6 Oct |
| C-d-r-no | Why not? Tell us briefly. | Required. No names. |  | Kenapa tidak? Ceritakan singkat. | Wajib diisi, tanpa nama. |  | Approved by Rangga 6 Oct |
| C-d-count | {N}/500 |  |  | {N}/500 |  |  | Approved by Rangga 6 Oct |
| C-d-count-warn | {N}/500 · {M} left |  |  | {N}/500 · {M} lagi |  |  | Approved by Rangga 6 Oct |
| C-d-over | Too long. Remove {N} characters. |  |  | Terlalu panjang. Kurangi {N} karakter. |  |  | Approved by Rangga 6 Oct |
| C-d-help-dis | Choose Yes or No, then give a reason. |  |  | Pilih Ya atau Tidak, lalu isi alasan. |  |  | Approved by Rangga 6 Oct |
| C-d-locked | An answer sent with Next cannot be changed. |  |  | Jawaban yang sudah Lanjut tidak bisa diubah. |  |  | Approved by Rangga 6 Oct |
| C-d-save-fail | The answer is not saved on this phone yet. | The phone could not save it. Your text is still here. | Try Next again. | Jawaban belum tersimpan di HP ini. | HP tidak bisa menyimpan. Teks kamu masih ada. | Coba Lanjut lagi. | Approved by Rangga 6 Oct |
| C-d-refused | Not sent yet. It will be retried automatically. | The answer stays saved on this phone. |  | Belum terkirim. Akan dicoba lagi otomatis. | Jawaban tetap tersimpan di HP ini. |  | Approved by Rangga 6 Oct |
| C-d-offline | Saved on the phone. Will be sent when online. |  |  | Tersimpan di HP. Akan dikirim saat online. |  |  | Approved by Rangga 6 Oct |
| C-d-done-h | Debrief complete. Thank you. |  |  | Debrief selesai. Terima kasih. |  |  | Approved by Rangga 6 Oct |
| C-d-done-l | Your answers are saved. |  |  | Jawabanmu sudah tersimpan. |  |  | Approved by Rangga 6 Oct |
| C-d-done-unsent | {N} answers are not sent yet. | They will be sent when online. |  | Masih ada {N} jawaban belum terkirim. | Akan dikirim saat online. |  | Approved by Rangga 6 Oct |
| C-d-done-skip | {N} questions skipped. | You can answer them until {HH:MM}. |  | {N} pertanyaan dilewati. | Bisa dijawab sampai pukul {HH:MM}. |  | Approved by Rangga 6 Oct |
| C-d-done-mulai | You can tap Start again {Thu 15 Oct} at {HH:MM}. |  |  | Mulai bisa ditekan lagi {Kam 15 Okt} pukul {HH:MM}. |  |  | Approved by Rangga 6 Oct |
| C-d-timeout | The debrief time ran out at {HH:MM}. | Answers sent with Next are kept. | Text not sent with Next is not saved. | Waktu debrief habis pukul {HH:MM}. | Jawaban yang sudah Lanjut tetap tersimpan. | Teks yang belum Lanjut tidak tersimpan. | Approved by Rangga 6 Oct |
| C-r-title | History |  |  | Riwayat |  |  | Approved by Rangga 6 Oct |
| C-r-help | Events on this phone. No audio or answers. |  |  | Kejadian di HP ini. Tidak ada isi suara atau jawaban. |  |  | Approved by Rangga 6 Oct |
| C-r-empty | No history yet. | History appears after Start is tapped the first time. |  | Belum ada riwayat. | Riwayat muncul setelah Mulai ditekan pertama kali. |  | Approved by Rangga 6 Oct |
| C-r-load | Loading history… |  |  | Memuat riwayat… |  |  | Approved by Rangga 6 Oct |
| C-r-err | History could not load yet. | Try again. |  | Riwayat belum bisa dimuat. | Coba lagi. |  | Approved by Rangga 6 Oct |
| C-r-keep | History is deleted after 14 days. |  |  | Riwayat dihapus setelah 14 hari. |  |  | Approved by Rangga 6 Oct |
| C-r-ev-start | Start tapped |  |  | Mulai ditekan |  |  | Approved by Rangga 6 Oct |
| C-r-ev-end | End tapped |  |  | Selesai ditekan |  |  | Approved by Rangga 6 Oct |
| C-r-ev-auto | Stopped automatically |  |  | Berhenti otomatis |  |  | Approved by Rangga 6 Oct |
| C-r-ev-debrief | Debrief until {HH:MM} |  |  | Debrief sampai {HH:MM} |  |  | Approved by Rangga 6 Oct |
| C-r-ev-answers | {N} answers sent |  |  | {N} jawaban terkirim |  |  | Approved by Rangga 6 Oct |
| C-r-ev-disc | Session cancelled · today does not count |  |  | Sesi dibatalkan · hari ini tidak dihitung |  |  | Approved by Rangga 6 Oct |
| C-r-ev-ok | Upload succeeded ({N}x) |  |  | Unggah berhasil ({N}x) |  |  | Approved by Rangga 6 Oct |
| C-r-ev-retry | Not sent yet · retrying |  |  | Belum terkirim · mencoba lagi |  |  | Approved by Rangga 6 Oct |
| C-r-ev-lost | Some speech was not captured |  |  | Sebagian suara tidak tercatat |  |  | Approved by Rangga 6 Oct |
| C-lang-group | Choose language |  |  | Pilih bahasa |  |  | Approved by Rangga 6 Oct |
| C-lang-id | Bahasa Indonesia |  |  | Bahasa Indonesia |  |  | Approved by Rangga 6 Oct |
| C-lang-en | English |  |  | English |  |  | Approved by Rangga 6 Oct |
| C-lang-said | English selected. |  |  | Bahasa Indonesia dipilih. |  |  | Approved by Rangga 6 Oct |
| C-notice-pilot | Speech becomes short work notes. | Audio is not kept. |  | Suara diubah jadi catatan kerja singkat. | Rekaman suara tidak disimpan. |  | Approved by Rangga 6 Oct |
| C-notice-demo-1 | Speech becomes short work notes. |  |  | Suara diubah jadi catatan kerja singkat. |  |  | Approved by Rangga 6 Oct |
| C-notice-demo-2 | Audio is never stored on our servers. |  |  | Rekaman suara tidak disimpan di server. |  |  | Approved by Rangga 6 Oct |
| C-notice-demo-3 | If the internet drops, audio waits on this phone |  |  | Bila internet putus, rekaman menunggu di ponsel ini |  |  | Approved by Rangga 6 Oct |
| C-notice-demo-4 | (encrypted when saved) until sent, then deleted. |  |  | (terenkripsi bila tersimpan) sampai terkirim, lalu dihapus. |  |  | Approved by Rangga 6 Oct |
| C-notice-demo-5 | Audio that can’t be sent is deleted after 24 hours. |  |  | Rekaman yang tidak terkirim dihapus setelah 24 jam. |  |  | Approved by Rangga 6 Oct |
| C-notice-demo-6 | Work notes are deleted after 14 days. |  |  | Catatan kerja dihapus setelah 14 hari. |  |  | Approved by Rangga 6 Oct |

**EN singular forms (count = 1).** Used only where the EN string has a count. The ID column has no plural. Keys as above; ID unchanged.

| Key | EN L1 (count 1) | EN L2 |
|---|---|---|
| C-d-entry-left | 1 minute left. |  |
| C-d-entry-n | 1 question. |  |
| C-d-over | Too long. Remove 1 character. |  |
| C-d-done-unsent | 1 answer is not sent yet. | They will be sent when online. |
| C-d-done-skip | 1 question skipped. | You can answer them until {HH:MM}. |
| C-r-ev-answers | 1 answer sent |  |

**Debrief category labels (EN, section 5.12.3, Q-U23).** Each label fills `{step}` in `C-d-q-step` after "there was". ID labels: not written here, pending Rangga (Q-U23). Until both exist the question uses `C-d-q-block`.

| Enum code | EN label | ID label |
|---|---|---|
| ROUTINE_OPS | routine work | pending (Q-U23) |
| CUSTOMER_SERVICE | customer service | pending (Q-U23) |
| TRAINING | training | pending (Q-U23) |
| STAFF_CONSULT | a staff question about a situation | pending (Q-U23) |
| CORRECTION | a correction | pending (Q-U23) |
| PHONE_CALL | a phone call | pending (Q-U23) |
| EVENT | planned event work | pending (Q-U23) |
| COMPLAINT | a customer complaint | pending (Q-U23) |
| SAFETY_INCIDENT | a safety incident | pending (Q-U23) |
| SECURITY_INCIDENT | a security incident | pending (Q-U23) |
| DISRUPTION | a disruption to operations | pending (Q-U23) |

Note: the privacy notice keys are approved text (technical spec §8.16). The EN column is the primary column (rev 5, Q-U22, Q-U24): the §12 EN line is split at the same six points, and "until it is sent, then it is deleted" is shortened to "until sent, then deleted" to fit 59 characters, accepted by Rangga 4 Oct (Q-U24). The formal §12 sign-off is still needed before the pilot page (technical spec §8.19). Rev 5: the EN column is a UI/UX draft, final sign-off Rangga. The ID column is unchanged from rev 4.

---

## 7. Focus and live-region map

| Moment | Focus | Announce |
|---|---|---|
| `/pair` load | code field | none |
| `/pair` refused or network | the error text | role alert (refused) / status (network) |
| `/capture` load | the headline (not Mulai, so a stray Enter cannot start capture) | none on load |
| Mulai enables after the 30 s timer | stays where it is | none (the note disappears; no re-read) |
| Selesai or Batalkan panel open | default button (`C-b-belum-lanjut` / `C-b-tetap-simpan`) | the panel heading (by focus) |
| Panel close (Belum, lanjut / Tetap simpan sesi) | trigger button | none |
| Panel auto-close at 15 s | stays where it is | status: `C-c-autoclose` |
| Discard confirmed | the headline | headline change (polite) |
| `mic_error` | stays | alert, once on transition |
| `stalled` | stays | polite status, once on transition |
| Lost line first appears | stays | polite status, once; never on the poll |
| Row 1 count grows (1x to 2x) | stays | none (count alone is noise; announced only on a new row) |
| Debrief question | question heading | none (focus change is the cue) |
| Debrief refused Lanjut | first error | alert on the error |
| Debrief done | heading | none (focus change) |
| History log open | heading | none |
| Language switch (5.12, rev 4) | stays on the pressed option (the control is not re-mounted) | one polite line: `C-lang-said`, in the new language. Nothing else |
| Language switch with an open panel, question or typed reason | stays where it was | none. Panel, question, reason and timers are unchanged |

Rules: the headline and upload block are polite regions. The poll and timers only set text when the value
changes, so a screen reader is not re-reading the same word every 30 s. Blocking failures use `role="alert"`.
Rev 4 rule: a live region announces when its **state id** changes (for example `listening` to `stalled`), never
when its translated text changes. A language switch changes the text and not the state id, so it re-announces
nothing (5.12.5). The language line itself is a separate polite region, empty until the first tap.

## 8. Decisions A to E as applied

| Decision | Applied in | Status |
|---|---|---|
| A. Headline stays green in a loss; the lost line carries it; first row of the upload block; announced once | 5.2 rules, 5.7 (lost line first), section 7 | Applied. **Confirmed by Rangga 4 Oct (final):** green headline, red line with a ▲ marker, first row of the upload block, announced once. No amber fallback |
| B. Lost line clears on the next 2xx; the loss is in the gap ledger for the supervisor | 5.7 | Applied. Dependency on P2 gap write, tech-lead order (section 10) |
| C. Lost line copy "Sebagian suara tidak tercatat / Some speech was not captured" | 5.7, copy sheet | Applied. Q14 sign-off needed |
| D. P3 queue-full value line, action line under it, both clear on next 2xx | 5.7 cause helpers, copy sheet | Applied. P3 is off on the pilot until signed off |
| E. mic_error and stalled copy and next step; no green; announced once | 5.2 table, copy sheet | Applied. "tidak mendengarkan" in mic_error read as negated (Q-U10); 30 s threshold is a guess to confirm (T5) |
| F. Lost-line cause text (Decided by UI/UX, 6 Oct; tech-lead feasibility answer pending): one generic helper `C-u-lost-help` for every drop; no cause-specific drop line in P1; P3 refusal keeps its known queue-full line. Tech-lead feasibility: no reply (session not reachable); read-only check of `lib/capture/browser/engine.ts` (`dropHead` shared by 4xx drop and retry exhaustion) and `lib/capture/queue.ts` (`prune`): causes are distinguishable in code, but no `lastDropCause` exists. Engine change not needed for P1 copy; see §10 T3 | 5.7 helpers, copy sheet, §10 | Applied. Rangga to ratify. Tech-lead answer to confirm |

| F. Language toggle, Bahasa Indonesia / English, on the shop phone (rev 4) | 5.12, section 3 rule 1, section 6 | **Confirmed by Rangga 4 Oct** (rows G1 to G8). Supersedes C9 (below) |
| G1. Precedence rule: UI/UX wins on presentation; the technical spec §8 and web spec §6.6 win on functional and technical behaviour; conflicts named for the tech-lead | section 0 | **Confirmed by Rangga 4 Oct** |
| G2. Q-U18: top-bar control (ID and EN), not a settings sheet | 5.12.1 | **Confirmed by Rangga 4 Oct** |
| G3. Q-U19: language names untranslated ("Bahasa Indonesia", "English") | 5.12.5, `C-lang-id`, `C-lang-en` | **Confirmed by Rangga 4 Oct** |
| G4. Q-U20: English is the default active language; overrides the rev 4 Bahasa default (cookie default, first run, demo outlet) | section 1, 5.12.2, 5.12.1, section 6 | **Confirmed by Rangga 4 Oct** |
| G5. Q-U21: the toggle covers the supervisor and owner screens too | 5.12 intro, section 4 | **Confirmed by Rangga 4 Oct** (their screens designed separately) |
| G6. Q-U22: EN column written by UI/UX, marked "UI/UX draft, final sign-off Rangga"; glossary kept | section 6, 5.12.4 | **Confirmed by Rangga 4 Oct** (the EN wording itself awaits Rangga's sign-off) |
| G7. Q-U23: EN debrief category labels written by UI/UX (same draft mark); ID labels pending | 5.12.3, section 6 category table | **Confirmed by Rangga 4 Oct** for the EN labels; ID pending |
| G8. Q-U24: shortened EN privacy notice accepted | section 6 note, `C-notice-demo-4`, `C-notice-demo-5` | **Confirmed by Rangga 4 Oct**; formal sign-off still needed (technical spec §8.16) |

**C9 is superseded (revision 4, [UIUX decided]).** The record of C9 is inconsistent, and this supersession covers
every version of it:
- Original 4 Oct text (`plan.md` §10 #48, `R-07-ux-notes.md` C9, the session-model plan's open list, now technical spec §8.19): "values bilingual, label once in
  Bahasa, no duplicate English line". The value shows in both languages on one line.
- Revision 3 (this file, Q-U1, G10): "gloss on status values only". A stricter reading, not the 4 Oct text.
- Both are superseded by decision F. The shop phone now shows one language per screen, chosen by the toggle, and
  every value is a full line in that language. No line mixes languages, and no `Bahasa / English` pair appears on
  any screen. Q-U1 is closed as superseded, not answered.

Other decisions carried from 4 Oct and applied: C6 done heading; C7 raw outlet id; C8 reason required on Ya
and Tidak; C9 superseded by F (see above);
C10 open; D1 Selesai from start + 4 h; D2 Mulai from 01:00; D3 open questions expire at debrief end; D4
closed day has no Mulai; D5 device token uploads answers; Q28 no undo; Q30 no early release; Q31 answer shape
and 500-character refusal; Q32 supervisors do not answer.

---

## 9. Self-review (bar in step 4) and result

Iteration 1 found the failures listed in the "Fixed" column. Iteration 2 (this file) re-checked every row.

| # | Check | Result | Evidence / fix |
|---|---|---|---|
| R1 | Every state has one clear next action | PASS | Table 5.2 gives one action per state or "none, wait" with the reason. Fixed in iteration 1: tab_busy, unsupported (G8), start failure (G5), idle with no Mulai |
| R2 | No state looks like Listening when it is not | PASS | Green only in `listening`. "Mendengarkan" positive only there. Memulai… keeps the idle headline until the start is confirmed. Stalled and mic_error have no green. Loss never green-with-warning-text in the headline |
| R3 | Every loss has a visible, specific reason | PASS | Lost line with cause helper (G7); cancel shows its cost and day; debrief timeout states that unsent text is lost; refused answer says it stays on the phone; skipped questions say when they can be answered |
| R4 | Every line readable at 360 px | PASS on design measure; device check pending | 16 px body min, 328 px column, wraps at about 36 to 40 characters per wrapped line; headline 26 px with gloss on the same line or the next line of the same element (Q-U2); no horizontal layout. **Needs a real 360 px phone check (Rangga or QA, both themes).** Not claimed as verified |
| R5 | Each copy string under 60 characters per line | PASS (see result below) | Script run over section 6 (section 9a) |
| R6 | All decisions A to E applied | PASS | Section 8 |
| R7 | No contradiction with the session rules | PASS with listed spec changes | Section 11 lists each difference and the session-rule section that must change. None is silent |
| R8 | Hard rules: no transcript, audio, names, device id, Firestore, secrets | PASS | Section 4; history log checked (5.9) |
| R9 | Role-correct views | PASS | Phone-only screens; supervisors and owners not in journey; history log shows no supervisor-visible content |
| R10 | Targets, focus, reduced motion | PASS | 48 px minimum, 56 px primary, 12 px gaps, 24 px cancel gap, 3 px focus, no motion required |
| R11 | Contrast | PASS on tokens after one fix; visual check pending | Measured in revision 3 (light / dark): fg 15.73 / 14.12, muted 7.38 / 7.10, accent 7.42 / 10.18, ok 6.10 / 9.80, warn 6.67 / 9.84, danger 6.85 / 7.44, focus 6.34 / 6.73, on-fill 7.93 / 10.18, on-danger 7.32 / 7.44. **Fail found and fixed (G22):** `--line` used as an input outline measured 1.27 / 1.43; replaced by `--edge` at 4.97 / 4.19. Visual check on a device still pending |
| R15 | One next action per state (revision 3 recheck, incl. debrief entry card) | PASS | `ended` and `ended_auto`: the next action is the debrief entry card button `C-d-btn` while the debrief runs, and none after it closes. `listening`: none while capture runs; Selesai appears at start + 4 h; Batalkan is always available |
| R16 | Decisions A to E still applied after the ux-copy pass | PASS | Section 8 unchanged. A stays Rangga's trade-off (headline green during a loss) |
| R17 | Copy: active verbs, the action named on commit buttons, no `Kembali` on a commit | PASS | G21 applied: `C-b-belum-lanjut`, `C-b-tetap-simpan`. `C-b-kembali` only on navigation (Riwayat back, debrief done, empty debrief) |
| R18 | History log (5.9): every row has a source and holds no content | PASS on the design; data source pending T1 | Rows map to P1 transitions or P2 outbox and gap events (5.9 table). No text, ids or names. Not shippable until the `events` store is accepted (X15) |
| R19 | Skipped debrief questions are reachable and the copy says so | PASS | Entry card reopens the open questions until debrief end; `C-d-done-skip` promises that and test A7 (backlog §3a browser rows) reopens question 2 as open |
| R20 | Dates and weekdays in copy are correct | PASS | Checked with date(1) for 2026: 12 Okt Senin, 14 Okt Rabu, 15 Okt Kamis, 16 Okt Jumat (Indonesian day abbreviations Sen, Rab, Kam, Jum). Note: `Sen` and `Jum` are the copy abbreviations used |
| R12 | Templated tells avoided (frontend-design) | PASS | Section 2 forbidden tells; no ALL CAPS, no arrows, no mono, no decorative numbering |
| R13 | Copy: Bahasa first, gloss on value only, active voice, no blame, no apology | PASS | Section 3 rules applied in section 6. Automated check for apology words in section 6 (grep: maaf, sorry) returned none |
| R14 | Dates written out, no "hari ini" or "besok" for a future time | PASS | `C-m-…` keys use day and time; "hari ini" only where the day is the business date in the record (`C-m-window-passed`, `C-m-closed`) |
| R21 | Rev 4: no mixed-language line; one language per screen (section 3 rule 1) | PASS on the design; device check pending | Script over section 6: no ID cell carries an English stopword, no EN cell carries a Bahasa stopword (9a). Exceptions listed in section 3 rule 1 |
| R22 | Rev 4: every key has both an ID and an EN column, same key set | PASS | 131 keys, 131 unique, both columns on every row (9a) |
| R23 | Rev 4: switch changes no state, timer, fetch or focus; re-announces nothing | PASS on the design; test pending | Section 5.12.5 and 5.12.6c; section 7 rev 4 rule. Test added to the session-rule test list, now backlog §3a (section 11 X21) |
| R24 | Rev 5: EN is the primary and default column; every key has both columns; 59-character limit both columns; Q-U18 to Q-U24 recorded | PASS on the design; device check and native EN review pending | Script in 9b (iteration 6): 131 keys, both columns, longest 59. Count-1 EN forms for 6 keys. Precedence table in section 0 |

### 9a. Copy-length check (script over section 6)

Method: every non-empty copy cell in section 6 is measured in Unicode characters, placeholders as written
(`{HH:MM}`, `{Kam 15 Okt}`). Key references in sections 5 and 9 are checked against the sheet (missing keys
and unreferenced keys). Apology words (maaf, sorry) are grepped across section 6.

### 9b. Iteration log

- Iteration 1 (draft, plus ux-copy pass): 127 rows, 155 non-empty cells, longest 79. **13 cells at 60 or
  more: FAIL.** Fixed by splitting into lines (the helper and value lines, cancel body, retry value, save
  failure, lost-drop). Also one button label changed to name its action (ux-copy).
- Iteration 2 (this file): 127 rows, 164 non-empty cells, longest **59**, cells at 60 or more **0**. Missing
  keys 0. Apology words 0. Unreferenced keys: the notice range (`C-notice-demo-1` to `-6`) and pairing
  steps (`C-pair-step-1` to `-4`) are referenced as ranges, so they are used. Result: **PASS**.
- Iteration 5 (revision 4, language toggle, ID and EN columns): 131 keys, 131 unique, 162 ID cells and 167 EN cells
  (329 non-empty), longest **59**, cells at 60 or more **0** in both columns. Each key has both columns. Mixed-language
  check: no ID cell has an English stopword and no EN cell has a Bahasa stopword (a word-list check, not a native
  review). Slash characters: only the counter `{N}/500` (a number format). Result: **PASS** on length and key
  parity. The EN column is a UIUX draft, not yet checked by a native EN reviewer (Q-U22).
- Iteration 6 (revision 5: EN primary column, count-1 EN forms, EN debrief category labels): 131 keys, 131 unique,
  both columns on every row. Longest line 59 in EN and in ID; cells at 60 or more 0. Key set equal to the earlier
  sheet; ID cells unchanged from rev 4. Count-1 EN forms: 6 keys. Category labels: 11 codes, EN written, ID pending.
  Result: PASS on length and key parity. The EN column is a UI/UX draft, final sign-off Rangga (Q-U22). No native
  EN review and no 360 px device check yet.
- Iteration 3 (tech-lead changes, when they arrive): not run. Any copy change re-runs this check.
- Iteration 4 (revision 3, after `impeccable init`): re-measured. 127 rows, 164 non-empty cells, longest 59, cells
  at 60 or more 0, apology words 0, em dashes 0, duplicate keys 0, missing referenced keys 0. Changes made in this
  pass: `C-d-done-h` (em dash removed), `C-r-ev-debrief` (no repeated time), `C-b-belum-lanjut` and
  `C-b-tetap-simpan` wired into 5.5, 5.6 and section 7 (G21). Contrast re-measured (R11). Result: **PASS**. A
  further copy change re-runs this check; the tech-lead answers may force one.

## 10. Tech-lead assessment (step 5): technical only, pending

**Status: not received (revision 3).** The uiux session has no agent-dispatch tool, so it could not start the
tech-lead itself. The questions below go to the PM (main) to dispatch an unnamed tech-lead one-shot, per CLAUDE.md
§10 rule 4. The assessment is technical only, not scope or dates. Dates stay Rangga's.

Evidence the uiux session gathered for T1 and T3 before the assessment (read only, no product code touched):
- `lib/capture/browser/event-log.ts` is the DEV-01 in-memory ring buffer for the dev panel. It is not persisted.
- No `indexedDB` or `bee6-capture` reference exists under `lib/` or `app/`. The on-device stores in technical spec §8.12
  (`state`, `outbox`, `gaps`, `keys`, `audio`) are P2/P3 work and not built.
- So the history log has no persisted source today. The `events` store in 5.9 is new work that P1 or P2 must add.

Questions for the tech-lead (technical only):

| # | Question | Why the design needs it |
|---|---|---|
| T1 | History log source: phone-local event log only in P1, or a device read route? What events already exist in the outbox, engine snapshot and local store (session start/end, upload terminal, cancel, lost)? | 5.9 data source. If events do not exist, Riwayat cannot ship with the events listed |
| T2 | Event storage: where (IDB `state` or new store), size cap, purge rule. Is a 14-day purge consistent with §12 and §7a, given events hold no text? | Retention line `C-r-keep` and the privacy line |
| T3 | Lost-line causes: does the gap ledger carry `queue_full`, `server_error` and `segment_dropped` on the phone, before the server confirms? The clear-on-2xx rule (B) depends on the gap write. Can P1 show the lost line without P2? | 5.7 and decision B ordering |
| T4 | Start failure (row 0): after P1's three direct retries, can the phone tell "not on server yet" from "on server"? What if the start POST is lost and never retried? | 5.11 and G5 |
| T5 | Stalled and mic_error: is the mic restart automatic (engine `onError`), and is 30 s the right threshold for mic_error after stalled? | Decision E and the stalled wording ("mencoba lagi" is only true if it restarts) |
| T6 | Mulai next-offer time (the day and HH:MM in every reopen note): can it be computed on the phone offline from cached config and `last_ended`, without a server call? | 5.4 and 5.8; a wrong day shown offline would break the honesty rule |
| T7 | Single-tab lock on iOS Safari (`navigator.locks` availability): fallback behaviour and what `tab_busy` shows when the lock is missing | `tab_busy` state, unsupported state |
| T8 | Reason refusal: client counter plus server refusal over 500 (no truncation). Which status and error code does the phone get, and does the phone treat a 422 refusal the same as 400 (D3)? | 5.8 over-500 path and "refused" copy |
| T9 | What is feasible before 12 Oct per screen, as a dependency map (not dates): which states can ship in P1 alone, which need P2 (gap ledger, outbox) or P3 (off on pilot) | Which states the design may show in the first release |

**What the design must change, depending on the answers (pre-stated):**

| If the answer is | Design change |
|---|---|
| T1: no event log exists in P1 | Riwayat ships with session start, end, cancel and debrief times only (from the local session store). Upload events are removed from 5.9 until P2 |
| T1: history needs a server read | 5.9 gets an offline state for "not loaded, showing this phone's events" and a retry. Riwayat stays local-only until then |
| T2: 14-day purge conflicts with §12 | Remove the retention line `C-r-keep`; purge rule moves to the tech-lead's version |
| T3: no gap ledger in P1 | Lost line (5.7) ships only with P2 for the clear-on-2xx rule. In P1 the lost line shows with `C-u-lost-help` (decision F, 6 Oct; no gap ledger needed for the copy). Clearing without P2 is still open. P1 says so in technical spec §8.8 |
| T4: start failure not detectable | Row 0 is removed. The start failure is shown in dev mode only |
| T5: stalled not automatic | `stalled` shows "Rekaman terhenti" with "Coba lagi" as the first action, not a 30 s wait |
| T6: next-offer needs a server call offline | The note shows "Mulai bisa ditekan lagi, cek saat online" when the day is unknown. Rule 5.4 says the honest day is shown only when computed |
| T7: no lock on iOS | `tab_busy` is removed on that browser; the single-tab risk is in the handoff |
| T8: 422 handled differently | Copy `C-d-refused` stays; the phone maps both codes to the same line |

Tech-lead answers and the resulting changes are recorded here when received. Until then the design is
"iterating" (section header).

**Revision 4: i18n technical assessment (language toggle, section 5.12). Status: requested, not received.**
On 4 Oct uiux asked for a technical-only assessment of the i18n approach. No agent named `tech-lead` was reachable
from this session. The request was sent to `team-lead` (the PM session), asking it to dispatch an unnamed tech-lead
one-shot and to forward the answer to uiux. The request covers five points, and the answers are recorded here
when they arrive:

| # | Question | Design depends on it |
|---|---|---|
| I1 | Cookie `bee6_lang` read in `app/layout.tsx` (currently `<html lang="en">`, hard-coded): does calling `cookies()` make the whole app dynamic? Scope it to the shop-phone segment? | 5.12.2 first paint, no flash |
| I2 | Logging risk for a cookie that holds only `id` or `en` (request logs, cookie headers) | 5.12.2 stored on device only |
| I3 | A typed dictionary module (`id` and `en` keys, missing key fails the type check) without a library, or a library. Check Next 16 docs in `node_modules/next/dist/docs/` | 3 rule 1 and section 6 |
| I4 | The debrief category enum: closed, with stable codes now? Lead time for the EN label table | 5.12.3 `{langkah}`, Q-U23 |
| I5 | Any capture-page string hard-coded outside one copy module (the switch would miss it) | 5.12.3, 5.12.5 |

Also for the tech-lead, not a question: the fixed month and day table (5.12.4) instead of `Intl`, so the output does
not vary by browser. Event rows (5.9) store enum codes only, so the text is rendered per language (6b).

## 11. Contradictions with the session-model plan (resolved in this file; historical)

That plan was removed on 6 Oct; its rules now live in `docs/specs/technical-specification.md` §8 and
`docs/specs/web-backend-rbac.md` §6.6. Section numbers in the table below are the removed plan's own.

| # | Item | The plan said | This design | Change needed in the plan |
|---|---|---|---|---|
| X1 | Gloss on every string (banners, notes, Mulai notes, Selesai note) | §4.5, §4.13 show ID / EN pairs for every banner and note, marked pending sign-off | Gloss on status values only (C9 stricter reading, your rule) | Update the banner and note strings to Bahasa-only, or ratify the exception (Q-U1) |
| X2 | Upload retry wording "Gagal unggah, coba ulang (Nx)" | §4.5 row 1, §7 | "Belum terkirim · mencoba lagi (Nx)" | Q14 change (Q-U4) |
| X3 | Row 4 "Gagal unggah, dilewati" | §4.5 row 4 | Lost line "Sebagian suara tidak tercatat" (decision C) | Q14 change, already decided C |
| X4 | Start POST failure not shown | §4.5: start failure not fatal, nothing shown | Row 0 "Sesi belum tercatat di server" | New row in §4.5 (Q-U5, T4) |
| X5 | `mic_error` and `stalled` copy | §4.5 table: "Mikrofon bermasalah (existing)", "Tidak mendengarkan · mencoba lagi" | Decision E copy | §4.2 and §4.5 table update (decision E) |
| X6 | Selesai wording | §4.4 and §4.13 say from start + 4 h | Same. UX-03 §4.4 "or close, whichever is first" was wrong; removed (G1) | None in the plan (UX-03 fix only) |
| X7 | Reason field | §15 Q31: refused, never truncated | No `maxLength`; counter; over 500 blocks Lanjut with the count (G4) | None; consistent with Q31. Confirm the client does not truncate (test) |
| X8 | Cancel panel text | §4.12 step 9 and §9: includes HH:MM | Same wording, copy sheet | None |
| X9 | Mulai reopen time without day | §4.13 §2: day always written out | Day always written out (G2) | None; UX-03 fix only |
| X10 | Stalled and interrupted headline tone | §4.5 table: stalled red, interrupted amber | Same tones | None |
| X11 | "Mendengarkan" wording in mic_error | Decision E: word appears nowhere | "tidak mendengarkan" appears (negated) | Clarify E (Q-U10) |
| X12 | Riwayat | Not in the plan | New screen 5.9 | Add to the plan's §4 only if Rangga wants it in MVP 1 (Q-U6) |
| X13 | Consent | §4.5: `no_consent` removed | Not designed (G13) | None |
| X15 | History log has no persisted source: the plan's §3.8 lists no `events` store, and §4.0 names no history screen | §3.8 and §4 | New `events` IDB store (timestamp, business date, enum; 14-day purge); P1 rows from session transitions, P2 rows from outbox and gap events (5.9) | Add the store to §3.8 and the screen to §4 (Q-U6, Q-U16). Tech-lead to confirm (T1, T2) |
| X14 | Button labels "Kembali / Back" (Selesai and cancel panels) | §4.4 and §4.12 | "Belum, lanjut" and "Tetap simpan sesi" (ux-copy: name the action) | Update §4.4 and §4.12 labels; "Kembali" stays for navigation only |
| X16 (rev 4) | Every ID / EN pair in §4.5 (banners, headline table, upload-line table, hints) | Pairs on one line, C9 (4 Oct) | Two complete sheets, ID and EN, from UX-03 §6 keys; no pairs | §4.5 copy rewritten as keys. EN column is a draft until Rangga's sign-off (§15 items 3 to 5) |
| X17 (rev 4) | Pairs in §4.4 (Selesai note), §4.12 step 9 (cancel confirm and buttons, headline, server line), §4.13 section 2 (every Mulai note and confirm) | Pairs | Keys `C-n-selesai-from`, `C-c-selesai-b`, `C-c-cancel-b`, `C-c-cancel-b-now`, `C-m-*`, `C-srv-*`, each with ID and EN | Replace the pairs with keys. Same wording as the sheet; EN wording needs §15 sign-off |
| X18 (rev 4) | §15 "UX-03 C9 → values bilingual, label once. Closed 4 Oct" and the matching lines in `plan.md` §10 #48 and `R-07-ux-notes.md` C9 | C9 closed as bilingual values | C9 superseded by the language toggle (UX-03 rev 4, F) | Rewrite the §15 entry to "superseded 4 Oct by the shop-phone language toggle", and point plan.md and R-07 to it. Those two files are not edited by UIUX |
| X19 (rev 4) | Terms in EN: "Mulai" and "Selesai" glossed as "Mulai is available again", "Selesai available from", "Start", "End" mixed | No EN term rule | Glossary in UX-03 5.12.4: Mulai = Start, Selesai action = End, Selesai state = Ended, Batalkan sesi = Cancel session | §4.5, §4.12, §4.13 EN words follow the glossary. Rangga ratifies (Q-U22) |
| X20 (rev 4) | §3.8 `events` store (X15) | Stores timestamp, business date and enum (text not specified) | Enum codes, counts and HH:MM only. No stored text. Text is rendered in the current language at read time, so past rows switch too | Add the constraint to §3.8. Tech-lead to confirm (T1, T2) |
| X21 (rev 4) | §4.6 and §4.7 test lists | No language tests | New tests: (a) a switch changes no state, timer, fetch or focus during running, an open panel, a typed reason, stalled and debrief; (b) a switch re-announces nothing except `C-lang-said`; (c) `<html lang>` equals the cookie on first paint; (d) every key has ID and EN and no line is over 59 characters (script); (e) an unknown category code falls back to the unlabelled template; (f) EN singular at count 1 | Add the tests to §4.6 and §4.7. Section 9a holds the length script |
| X22 (rev 4) | §4 (no toggle subsection), `app/layout.tsx` (`<html lang="en">` is hard-coded) | No language switch in the spec | New §4 subsection for the toggle (5.12): default `en` (rev 5, Q-U20), cookie `bee6_lang`, top-bar control. The hard-coded `lang="en"` is wrong for the shop phone today (Bahasa copy under `lang="en"`) | Tech-lead: the layout change and the cookie read (I1, I2). `PRODUCT.md` at the project root still says English is "a gloss on status values only" and "English appears only as a gloss on a status value" (Principle 5). That file is outside this design's edit scope (Q-U21) |

## 12. Open questions for Rangga

| # | Question | Design default used now |
|---|---|---|
| Q-U1 | ~~C9 scope: gloss only on status values.~~ **Closed as superseded (rev 4):** the shop phone uses one language per screen, chosen by the toggle (decision F, section 8). No gloss anywhere. | Superseded. See Q-U18 to Q-U24 |
| Q-U2 | State headline at 26/32 (was 28/34) so Bahasa plus gloss fits 328 px on one or two lines. Accept, or keep 28 and let the gloss wrap onto its own line? | 26/32 |
| Q-U3 | Batalkan panel: stacked full width, `Tetap simpan sesi` first (default focus), red "Ya, hapus sesi" below with 12 px gap. "Opposite side" in the session rules' cancel section (now technical spec §8.9) reads as left/right, which does not fit a full-width column. Confirm the layout. | **Confirmed by Rangga 4 Oct:** stacked full width, "Tetap simpan sesi" first, red "Ya, hapus sesi" below |
| Q-U4 | Retry wording: "Belum terkirim · mencoba lagi (Nx)" instead of "Gagal unggah, coba ulang (Nx)" (Q14). Confirm. | "Belum terkirim" |
| Q-U5 | Row 0: a new upload-block row for "Sesi belum tercatat di server" when the start POST is not confirmed (X4). Needs a technical spec §8.8 change. Confirm, and whether it stays in MVP 1 if T4 says detection is hard. | Row 0 kept, pending T4 |
| Q-U6 | History log (Riwayat): in MVP 1 scope? Phone-only, no supervisor or owner view. Retention line "dihapus setelah 14 hari" (C-r-keep) is a proposal. | In MVP 1 as a local screen, pending T1/T2 |
| Q-U7 | No-consent state: the brief asks for it; technical spec §8.7 and CLAUDE.md §7b remove it. Confirm nothing is designed for it. | Not designed |
| Q-U8 | Mulai note in the debrief card after a same-day Selesai: the reason is `day_ended`, so the card shows the next day. Is "Mulai bisa ditekan lagi Kam 15 Okt pukul 01:00" the right honest line, or should the card point to the debrief end time? | Next-day line (honest) |
| Q-U9 | `stalled` tone: danger (E) or warn? It recovers on its own within 30 s, so warn may read more truthfully. E says danger. | Danger, per E |
| Q-U10 | "tidak mendengarkan" in mic_error and interrupted (negated form, not positive Mendengarkan). Is the negated form allowed by E? | Allowed |
| Q-U11 | Lost-line helpers are new copy. Approve, and Q14 sign-off for all upload copy. | Replaced 6 Oct by decision F: new `C-u-lost-help` (generic); `C-u-lost-drop` deferred. Needs Rangga ratification |
| Q-U12 | C10 success toast ("Unggah berhasil lagi"): keep the 3 s toast on recovery, or line-state only as technical spec §8.8 says? | Toast kept as the 4 Oct default, open |
| Q-U13 | Unsent debrief draft in `localStorage` per viewer: allowed as convenience or not at all in MVP 1? | Not used; text lost on reload (stated) |
| Q-U14 | Unsupported browser helper: "Buka halaman ini di browser lain" is generic. Which browsers are supported (not in the session rules)? | Generic |
| Q-U16 | History log (X15): approve a new `events` IDB store and the two-phase rows in 5.9 (P1 transitions, P2 upload and lost rows). Without approval the screen waits. | **Confirmed by Rangga 4 Oct:** `events` store approved; P1/P2 rows ship now, the rest waits (technical spec §8.12) |
| Q-U17 | Init facts in PRODUCT.md were inferred, not asked (no question tool). Confirm: platform `web`; users (shop staff, owners and supervisors off this journey); "Android or iOS browser" in Operating Context; positioning wording. | **Confirmed by Rangga 4 Oct:** all four facts as inferred |
| Q-U15 | Riwayat and the supervisor day record: should the supervisor day record show the same event times? (Technical spec §8.9 and §8.15: counts only.) Not designed here. | Not designed |
| Q-U18 (rev 4) | Toggle placement: top-bar segmented control `ID` and `EN` on every shop-phone screen (5.12.1), not a settings sheet. Accept the cost (brand mark shrinks; top-right reach)? | **Confirmed by Rangga 4 Oct:** top-bar segmented control with ID and EN on every shop-phone screen. Not a settings sheet. |
| Q-U19 (rev 4) | Picker names: the visible text is the code `ID` / `EN`; the group label is in the current language; each option's accessible name is the endonym "Bahasa Indonesia" / "English" in both modes. Accept? | **Confirmed by Rangga 4 Oct:** language names stay untranslated: "Bahasa Indonesia" and "English". |
| Q-U20 (rev 4) | Default and device memory (rev 4 text, superseded by the confirmed default): Bahasa on every new device, the browser language is ignored, the choice is one cookie per device. Accept? Demo outlet (judges): Bahasa too, or English by default? | **Confirmed by Rangga 4 Oct:** English is the default active language. Overrides the Bahasa default everywhere: cookie default, first run, the demo outlet. |
| Q-U21 (rev 4) | Scope: this change covers the shop-phone journey only. Supervisor and owner screens (the day record already has an ID / EN label toggle, backlog T-401a) and `PRODUCT.md` (its Principle 5 and Brand Commitments say English is a gloss only) are not changed here. Should the same control reach supervisor and owner screens, and should `PRODUCT.md` be updated? | **Confirmed by Rangga 4 Oct:** the toggle covers the supervisor and owner screens too, not only the shop phone. Their screens are designed separately. |
| Q-U22 (rev 4) | Copy ownership: who checks the EN column (a native English reviewer, or Rangga)? Who signs off the ID column? Term rule: Mulai = Start, Selesai = End or Ended (5.12.4 glossary, which changes the EN wording in the session rules). Accept? | **Confirmed by Rangga 4 Oct:** UI/UX writes the English copy (section 6, EN column), marked "UI/UX draft, final sign-off Rangga". Glossary kept. |
| Q-U23 (rev 4) | Debrief category labels: the model category enum needs one ID and one EN label per code (5.12.3). Who writes the category table? Until it exists the question falls back to the unlabelled template. | **Confirmed by Rangga 4 Oct:** UI/UX writes the English debrief category labels (section 6), marked "UI/UX draft, final sign-off Rangga". ID labels pending. |
| Q-U24 (rev 4) | Privacy notice EN (technical spec §8.16): the approved EN line is split at six points, and "until it is sent, then it is deleted" is shortened to "until sent, then deleted" to fit the budget. Accept the shortened wording, or give a split that keeps every word? The §12 line also needs formal sign-off before it reaches the pilot. | **Confirmed by Rangga 4 Oct:** shortened EN privacy wording accepted. The formal sign-off (technical spec §8.16) is still needed before the pilot page. |

## 13. Not done in this session (and why)

- **Claude Design / Artifact canvas:** not opened, not refreshed. No Artifact tool in this session. The
  canvas (`<PRIVATE_DESIGN_LINK>`) is stale, and its local export
  `.claude/canvas-ux03/project/` still has the amber queue-full headline in `capture-problems.dc.html`, the
  "Gagal unggah, dilewati" row in `upload-line.dc.html`, and the 4 Oct-superseded copy. Refresh from a session
  with the Artifact tool, using section 5 and section 6 as the source.
- **Tech-lead assessment:** not dispatched by this session (no dispatch tool). Questions T1 to T9 are in section 10
  for the PM to send to an unnamed tech-lead. Not received.
- **Init interview:** no question tool in this session, so PRODUCT.md is inferred from the brief and the docs. Each
  inferred fact is labelled. Rangga confirms them (Q-U17).
- **Copywriting skill:** `ux-copy` was loaded in revision 3 and applied (section 3).
- **Visual check on a 360 px phone, both themes:** not done. Contrast ratios and character counts were
  computed, not seen on a device. Rangga or QA checks the screens on the shop phone.
- **No product code was edited.** Only this file was written.
- **Revision 4 (language toggle), not done:** no native English check of the EN column (Q-U22); no device check of
  the top-bar control at 360 px in either language and both themes; no contrast re-measure beyond the existing
  tokens; no tech-lead answer (section 10, I1 to I5, routed through team-lead); no session-rule or plan.md edit (section
  11 X16 to X22 is the list for the tech-lead); no `PRODUCT.md` edit (Q-U21); no Claude Design canvas refresh.
  No product code, CLAUDE.md or `.claude/` was touched.
- **Revision 5 (Rangga's decisions, 4 Oct), not done:** no 360 px device check of the EN lines or the top-bar control in
  either theme; no native EN review (final sign-off Rangga, Q-U22); ID labels for the debrief categories pending (Q-U23);
  `PRODUCT.md` not edited (its Principle 5 and Brand Commitments still say English is a gloss only; Q-U21); supervisor and
  owner screens not designed here; the session rules not edited (the precedence conflicts in section 0 are for the tech-lead to
  record); no Claude Design canvas refresh. No product code, CLAUDE.md or `.claude/` was touched.

## 14. Supervisor and owner strings carried over (6 Oct; reference wording, not yet keyed)

The session-model task plan was removed (Rangga, 6 Oct). These strings sat only there. They belong to the supervisor and owner
screens (R-06, R-08's insights screen), which this file does not design; they are kept here so the wording is not
lost, and get keys and the 59-character check when those screens are designed. Behaviour behind them:
`docs/specs/technical-specification.md` §8.6, §8.9, §8.15.

| Where | EN (reference) | ID (reference) |
|---|---|---|
| Day record, cancelled-session count (count only, never who or when) | Sessions cancelled: {N} | Sesi dibatalkan: {N} |
| Day record, a day with no session by the Mulai cut-off, or a closed weekday | Off / closed | Libur / tutup |
| Insights, weekly reminder (reminder weekday, no run in the last 6 days) | Time for this week's review | Waktunya meninjau minggu ini |
| Insights, run in progress (409 `run_in_progress`, polls every 5 s) | Processing | Sedang diproses |
| Insights, not sufficient (only days with reasons are listed; off, closed and not-started days never are) | Not enough data for a proposal yet. Missing: {Tue 13 Oct} (no facts yet), {Wed 14 Oct} (coverage {42}%). | Belum cukup data untuk usulan. Hari yang kurang: {Sel 13 Okt} (belum ada fakta), {Rab 14 Okt} (cakupan {42}%). |
| Day record, a thread rejected by a *Tidak* (already in `docs/tasks/R-07-ux-notes.md` §4.4) | Rejected by staff | Ditolak staf |

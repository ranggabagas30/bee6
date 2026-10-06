# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Shop staff on the shop phone.** A paired phone left in one fixed spot in a small F&B kitchen or bar,
  plugged in, screen on, with `/capture` open. They glance at it most of the shift, often with wet or greasy
  hands, glare on the screen, and interruptions. English first, Bahasa Indonesia second. Job: see at a glance whether the
  phone is listening and whether anything needs a tap, and answer the evening debrief in a few minutes.
- **Owners and supervisors** approve and review SOP proposals on other screens. They are not part of the
  shop-phone journey (`/capture`, pairing, debrief, history).
- **Judges and visitors** try the demo outlet from a landing path ("Try as ...") with fictional data.
  Inferred from the brief, to confirm.

## Product Purpose

bee6 (GATI's SOP Improvement Agent) listens to a small shop's working day through one phone. It turns speech
into short work notes, never keeps the audio, asks staff *why* a gap happened in a short evening debrief, and
proposes changes to the shop's SOP. A supervisor checks each proposal, the owner approves it, and the change
ships as a new SOP version. The system later checks whether the change worked.

Success for the shop phone: staff always know whether it is listening, every loss of data has a visible reason,
and the owner can see what the phone did without asking anyone. Pilot shop: Proofed (Indonesia).

## Positioning

The phone's own log and state tell the truth about a day, and the audio is gone once it is turned into a work
note: nothing is stored in the cloud. A neighbouring product that only shows a generic "recording" dot cannot
say which part of a day was lost, or why, and cannot prove that the audio was dropped. (Inferred from
CLAUDE.md §2 hard rules 2 and 3; confirm wording before any marketing use.)

## Operating Context

- Shop phone: Android or iOS browser, paired by a pairing code from the owner or supervisor, left plugged in,
  screen on, `/capture` open. Phone in a pocket with the screen off does not capture (CLAUDE.md §8).
- Opening hours and the one Mulai window per business day come from the outlet's weekly calendar. Business day
  starts at 01:00 and Mulai is offered until close minus 4 hours. Selesai is shown from start plus 4 hours. The
  debrief lasts one hour. Auto-stop is at close plus one hour.
- Staff tap Mulai and Selesai themselves. Cancel discards a session started by mistake and is stated as costing
  the day.
- Connectivity is patchy in the kitchen. Capture keeps running offline; uploads retry when the phone is online.
- Glance-level use, dim or glare-heavy light, wet hands. Tap targets and the state word must work under those.

## Capabilities and Constraints

- Capabilities in scope for the journey: pairing, manual Mulai and Selesai, cancel with a stated cost, offline
  queue with visible upload state, lost-line reporting with a cause, the one-question-at-a-time debrief, and a
  history log of this phone's events.
- Technical: Next.js App Router on Cloud Run (`asia-southeast2`), browser capture with `getUserMedia`,
  AudioWorklet and Silero VAD, IndexedDB and `localStorage` for on-device state. Browsers never talk to Firestore;
  every read and write goes through our API.
- Models and data: Google Cloud and Gemini only. No other AI provider. Locations come from `config/regions.yaml`.
- Terminology: "work note" (catatan kerja), "debrief", "SOP", "Mulai", "Selesai", "Batalkan sesi". Keep these
  words the same across every screen.
- Privacy: no audio in the cloud, no transcript on the capture screen, no staff name on any screen, no device id
  next to an answer or thread. Consent is collected outside the product (paper contract and emailed notice). The
  app has no consent gate in MVP 1 (CLAUDE.md §7b).
- Undecided product facts (do not invent): the history log in MVP 1 (UX-03 Q-U6); whether the success toast on
  upload recovery exists (Q-U12); which browsers are supported (Q-U14); whether the supervisor day record shows
  event times (Q-U15); whether the pilot's day-off and closed-day rules change after sign-off.

## Brand Commitments

- Name: bee6, with GATI as the organisation and "SOP Improvement Agent" as the descriptor.
- Voice: English is the default UI language and Bahasa Indonesia is the second full column (`ID | EN` top-bar
  switch, every screen). One language per screen, no gloss or mixed lines; language names stay untranslated.
  Sentence case, active verbs, no apology words in errors, no blame, one next step per state, dates and times
  written out in full. Copy per `docs/tasks/UX-03-journey-design.md` revision 5 (section 3).
- Google Cloud and Gemini are the only AI stack shown to users. No other provider branding.
- No visual brand exists yet beyond the working tokens in UX-03 section 2. The visual world is open (see below).

## Evidence on Hand

- `docs/specs/technical-specification.md` §8 (session model, Mulai window, cancel, upload truth).
- `docs/tasks/UX-03-journey-design.md` (state table, copy sheet, decisions A to E).
- `docs/tasks/R-07-ux-notes.md` (debrief notes).
- The Claude Design canvas for UX-03 could not be refreshed in the session that wrote this file. The local export
  in `.claude/canvas-ux03/` is stale and must not be treated as current.
- No real shop content, staff names, transcripts, testimonials, customers, pricing, or benchmarks exist in the
  repository. Demo data is fictional. Do not fabricate any of these.

## Product Principles

1. **The state word is the product on the shop phone.** One plain word, in the same slot, that is true right now.
   Green means listening and nothing else.
2. **Every loss has a visible, specific reason, and the phone does not hide it.** The reason is shown where the
   loss is, and it says whether the fix is on the phone (connection, queue) or on the server.
3. **Irreversible actions are slow on purpose.** Two steps, a stated cost, and a default focus on the safe choice.
4. **Staff see their own phone's facts, never content.** Times, counts and event words only, on the phone and in
   the history log.
5. **Two full languages, one switch.** English is the default UI language and Bahasa Indonesia is the second column. A top-bar `ID | EN` control switches every screen, including the supervisor and owner screens. Each screen shows one language, never a mix or a gloss. Language names ("Bahasa Indonesia", "English") are never translated. Copy follows `docs/tasks/UX-03-journey-design.md` revision 5.

## Accessibility & Inclusion

- Works on a 360 px wide phone in portrait, one column, no horizontal scroll, safe-area insets respected.
- WCAG 2.2 AA is the target for every screen (contrast, target size of at least 48 px for controls and 56 px
  for the primary action, visible 3 px focus, keyboard and screen-reader labels).
- Under glare and in light and dark themes: colour is never the only signal. Every state has an icon, a word and
  a tone.
- `prefers-reduced-motion` is respected. The MVP needs no motion to convey state.

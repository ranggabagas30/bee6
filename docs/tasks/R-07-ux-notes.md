# R-07 UX notes — the staff journey (pairing → daily glance → debrief)

**Sources of truth:** `docs/plan.md` for sprints; `docs/specs/technical-specification.md` (§8) for
capture and session rules; `docs/specs/web-backend-rbac.md` (§6.6) for routes and data;
`docs/tasks/UX-03-journey-design.md` for screens and copy.
Session rules: technical spec §8.3. Debrief clock and answer cache: technical spec §8.10–§8.11; answer
contract and the answer route's security items: web spec §6.6.6. Cancel: technical spec §8.9. Mulai eligibility
and disabled-Mulai notes: technical spec §8.5. Upload status: technical spec §8.8. If this file and those specs
differ, the specs win; tell tech-lead so this file is fixed.

**Status:** design for R-07's plan, not built. Rewritten 4 Oct 2026 (tech-lead) to match the session rules and the MVP 1
decisions in `docs/HANDOFF.md`; superseded instructions were removed rather than stacked (git history keeps
the old text). Detailed screen states, copy and accessibility: `docs/tasks/UX-03-journey-design.md` (UX-03)
§4.1-§4.7; its conflicts list is carried in §7 below.

**MVP 1 facts this design is built on (all fixed by Rangga, 4 Oct):**
- **No staff sign-in.** No name, no PIN, no staff session, no idle timeout, no `signOut()`. Staff only pair a
  device. Whoever holds a paired device answers that device's questions. `POST /api/v1/auth/pin` returns 404.
- **Capture is manual.** Only a tap of **Mulai** starts it. It stops on a confirmed **Selesai** (shown from
  Mulai + 4 h) or the hard auto-stop at close + 1 h. Opening hours never start or stop capture; they only
  drive the opening and closing banners. Nothing "starts automatically" the next day.
- **The debrief starts at Selesai or the auto-stop**, never at closing time, and lasts exactly 1 h from its
  start whatever happens. It can fall during the day (an early Selesai) or after midnight (an auto-stop).
- **Question expiry is per device at its debrief end** (D3): every open question of this device created at
  or before `debrief_ends_at_ms` expires as `unverified`. There is no 7-day expiry.
- **Consent is not collected in the app** (bee6–Proofed contract plus an emailed notice). No consent view,
  flag or revoked state. The privacy line on `/capture` is a notice only.
- **Questions are role-agnostic.** Answers store the answering device id and timestamps only: no
  `answered_by`, no role, no staff id, no name. Supervisors and owners never see the device id.
- **Multi-device.** Each device has its own session, debrief clock, question list, expiry and Mulai gate.

**Hard constraints on every screen:** no transcript, ever (hard rule #2); no name or device id shown next to
an answer (hard rule #7); 360 px first. Language: the UX-03 C9 bilingual rule is **superseded by the language
toggle** (plan.md §10 #49, technical spec §8.17): English is the default, a top-bar `ID | EN` control switches every
screen, and one language is shown at a time (copy: UX-03 §6 revision 5).
**Retention (technical spec §8, confirmed by Rangga 4 Oct):** threads 14 days (§8.15, P4), history `events` 14 days (§8.12),
answer cache on the phone 14 days (§8.11), undelivered audio 24 h (§8.14, P3 only).

---

## 1. The journey, end to end

```
/pair (once)
  → /capture: idle, Mulai offered inside the Mulai window (technical spec §8.3 rules 1, 6)
  → tap Mulai → running (ambient; nobody watches)
  → from Mulai + 4 h: Selesai button; from closing time: "tap Selesai" banner
  → Selesai confirmed, or the auto-stop at close + 1 h
  → /capture itself shows the debrief entry for 1 h (no new URL, no push)
  → up to 5 of this device's questions, one at a time → done screen → back to /capture
  → Mulai disabled with "Mulai bisa ditekan lagi ..." until the debrief times out (the Mulai gate)
```

The debrief's "notification" is the capture page's own state, not a push notification. The phone is
already open, in front and screen-awake during a session (the capture spec's operating constraint), so the
page changing what it shows at Selesai or the auto-stop is enough. No FCM, no service worker.

`/capture` re-evaluates its checkpoints every 30 s and on visibility change (technical spec §8.6). The debrief
entry is driven by `debrief_ends_at_ms` from `bee6.capture.last_ended` (phone) or the config's
`last_ended` (server), never by the wall clock against `closing_time`.

---

## 2. Pairing (`/pair`) — small tweak only

After a successful pair, add one line and a button so the person setting up knows the next step:

> "Ponsel ini sudah terhubung. Berikutnya: buka halaman rekam." / "This phone is paired. Next: open the
> listening page." → button "Buka halaman rekam / Open listening page" → `router.push("/capture")`.

Copy plus one button, no new state. `/pair` keeps showing the raw outlet id in MVP 1; the outlet name is
post-MVP 1 (UX-03 C7 deferred, Rangga 4 Oct).

---

## 3. Daily glance (`/capture`) — what R-07 adds

Capture phase plan P1 builds the session views (`idle`, `running`, `interrupted`, `ended`, `ended_auto`), the
checkpoint banners, the Selesai and cancel confirms and the upload status line (technical spec §8.8, whose headline rule keeps the headline green for every upload
result, including `queue_full`; screens in UX-03 §4.2-§4.5). R-07 adds only the **debrief entry card** and its interaction with the Mulai note.

### 3.1 Debrief entry card

Shown on `/capture` while `now < debrief_ends_at_ms` for this device, above the primary slot. It appears
within 2 s of Selesai being confirmed or the auto-stop firing (technical spec §8.10), and again after a reload
inside the hour, with the remaining time.

```
Debrief berjalan                             (Debrief running)
Sisa 52 menit.                               (52 minutes left.)

[  Jawab pertanyaan  ]                       (Answer questions)
Butuh sekitar 5 menit.                       (Takes about 5 minutes.)

Mulai berikutnya bisa ditekan pukul 03:00.   (Next Mulai at 03:00.)
```

- Big, high-contrast button, 48 px+ touch target.
- "Butuh sekitar 5 menit." matches R-07's done-when ("5 typed answers in about 5 minutes", Rangga, 4 Oct).
- The Mulai line shows the Mulai gate honestly: it is the debrief timeout, not the answer count (no early
  release, Q30 closed). Exact disabled-Mulai notes: technical spec §8.5 (copy: UX-03 §5.4).
- No card after a cancel (no debrief follows a cancel). No card once the hour has passed.
- The card is always shown during the hour; no separate "question count" call is made before it. An empty
  list is a state inside the flow (§4.3). (UX-03 §4.6 shows the count once the list has loaded; fine either
  way, as it is this device's own list.)
- Never show question text, kind or topic on the card.

### 3.2 Attention cue — deferred, not in R-07

A vibrate plus a short sound on the Selesai / auto-stop transition is **cut from R-07**: `navigator.vibrate`
is missing on iOS Safari and needs prior user activation on Chrome, and a reliable sound needs an unlocked
`AudioContext` after the capture engine has torn its own down. Listed as a separate backlog candidate,
"after-close attention ping", ~0.5 h, verified on the real phone (`docs/plan.md` §8 item 9). The card in
§3.1 already solves the timing problem; the cue is amplification only.

---

## 4. Debrief flow (R-07's deliverable)

### 4.1 Entry

Tapping "Jawab pertanyaan" swaps the view in place on `/capture` (no second URL). There is **no sign-in
screen**: the request to list questions carries the device token from `/pair`, and the route returns only
this device's open questions (`question.device_id === claims.device_id`), at most 5, incidents first then
oldest-first (ranking is backend-only). Loading, load-error and empty states: UX-03 §4.6.

### 4.2 One question at a time

**Answer shape (technical spec §8.11, web spec §6.6.6; Rangga, 4 Oct, MVP 1 final):** each question gets **exactly one answer: *Ya*
(YES) or *Tidak* (NO), plus a required reason; or *Lewati* (skip), which is not an answer.** No *Bukan ini*,
no reason chips, no category choice list. Revising the category in free text is **post-MVP 1**: if someone
writes "it was actually X" in the reason, it is stored as context and changes nothing.

- **Question text (approved by Rangga, 4 Oct).** `gate` kind (has a thread): "Sekitar pukul HH:MM ada
  <langkah>. Benar?" / "Around HH:MM there was <step>. Right?". `unlabelled_unit` kind: "Sekitar pukul
  HH:MM-HH:MM ada kegiatan kerja. Benar?" / "Between HH:MM and HH:MM there was work going on. Right?". The
  SOP-implementation question lives in the reason prompt after *Ya*, so a *Tidak* means "this did not happen
  as labelled", never "not done properly" (which would exclude reported gaps from evidence). The prompt never
  names or addresses a person or a role.
- **The choice.** Two equal-width buttons, *Ya* and *Tidak* (`role="radiogroup"`, each `role="radio"` with
  `aria-checked`; 48 px tall; side by side at 360 px). Nothing preselected. A tap selects (tapping the other
  switches); it never advances.
- **The reason field.** Shown once a choice is selected: one `<textarea>`, 4 rows, full width, 16 px text,
  `autoComplete="off"`, **no `maxLength`** (it silently cuts pasted text, which is truncation), and a
  right-aligned visible counter "0/500" (copy `C-d-count`, `C-d-count-warn` from 450, `C-d-over` over 500;
  UX-03 §6). The label switches with the choice (switching keeps the typed text):
  - after *Ya*: "Sudah sesuai SOP? Kalau belum, kenapa? (wajib, tanpa nama)" / "Was it done per the SOP? If
    not, why? (required, no names)";
  - after *Tidak*: "Kenapa tidak? Ceritakan singkat (wajib, tanpa nama)" / "Why not? Tell us briefly
    (required, no names)".
- **The reason is required on both answers** (approved by Rangga, 4 Oct). **Lanjut** stays disabled until a
  choice is selected **and** `reason.trim()` is non-empty, with visible helper text saying why.
- **Cap: 500 characters, refused, never truncated** (`REASON_MAX_CHARS = 500`; technical spec §8.1). The server
  counts code points of the trimmed reason (`Array.from(reason.trim()).length > 500` → 400 `reason_too_long`,
  nothing written). The phone's counter counts exactly the same thing. Over 500, **Lanjut** is disabled with
  the over-limit line, the text stays in the field as typed, and nothing is cached, so the phone never caches
  or sends a reason the server would refuse.
- **Lanjut** writes `{ question_id, debrief_business_date, answer, reason, answered_at_ms }` to the phone's
  answer cache first, then uploads, then advances. Never auto-advance. A cache entry is removed once the
  server confirms it, and in any case 14 days after `answered_at_ms` (`ANSWER_CACHE_MAX_AGE_MS`, technical spec
  §8.11); an entry 14 days old is never sent.
- **Lewati** (secondary, always enabled, left of Lanjut): moves on and writes nothing (no cache entry, no
  request). The question stays `open`, shows again if the debrief is reopened inside its hour, and expires
  as `unverified` at the debrief end. A half-filled choice or reason on a skipped question is discarded.
- **No back button, no editing.** A committed answer is final (no undo accepted for MVP 1). A mis-tapped
  *Tidak* excludes the thread from evidence; the supervisor sees it with its reason and can override on the
  thread side.
- Question text is a **template built from the label, time and area, never a quoted thread line**: thread
  text can still hold staff names (the scrub gap in CLAUDE.md §2 rule 7a), so the screen renders only a
  pre-built template string.
- Progress "Pertanyaan 2 dari 4" is the "how much is left" signal.
- **Several people, one device:** answers are upserted by `question_id` and the list returns only open
  questions, so whoever picks the phone up next sees what is still unanswered. Nothing records who answered.
- **Several devices:** each device answers only its own questions. One episode heard by two devices gives
  two questions, answered separately and merged only in the insight run (technical spec §8.15).
- Save failure, refusal, offline and timeout states and copy: UX-03 §4.6. A refused or 5xx upload keeps the
  answer in the cache (technical spec §8.11); a 400 removes it.

```
Pertanyaan 2 dari 4                       (Question 2 of 4)

Sekitar pukul 15:00 ada restock. Benar?   (Around 15:00 there was a restock. Right?)

   [   Ya   ]   [ Tidak  ]                (Yes)  (No)   nothing preselected

Sudah sesuai SOP? Kalau belum, kenapa?     (after Ya; after Tidak:
(wajib, tanpa nama)                         "Kenapa tidak? Ceritakan singkat")
[                                          ]
[                                          ]
                                     0/500

   Lewati              [  Lanjut  ]       (Skip)  (Next; disabled until Ya/Tidak + a non-empty reason)
```

### 4.3 Done screen (and the empty list)

```
Debrief selesai — terima kasih           (Debrief done — thank you)   heading decided (UX-03 C6, 4 Oct)
Jawabanmu sudah tersimpan.               (Your answers are saved.)
Mulai bisa ditekan lagi pukul 03:00.     (Mulai is available again at 03:00.)

[  Kembali  ]                            (Back)
```

- **No early release** (Q30 closed: no). Reaching this screen does not end the debrief or release Mulai; the
  1-hour clock keeps running. No code path may compare answered and total counts to unlock anything. Until
  the timeout the entry card stays, so a skipped question can still be answered.
- Zero open questions: same screen, first line "Tidak ada pertanyaan hari ini — terima kasih." / "No questions
  today — thanks."
- No per-answer recap (it would look like a stored transcript).
- Neutral copy only: never "tersimpan sebagai fakta". COMPLAINT, CORRECTION and incident answers wait for a
  supervisor's confirmation before anything becomes a fact.
- "Kembali" returns to `/capture` (the entry card if the hour is still running, otherwise the idle view with
  the Mulai note). No sign-out step exists.

### 4.4 Supervisor-confirmation categories and the supervisor view

Answering a COMPLAINT, CORRECTION or incident question looks identical to staff. The "waiting for
supervisor" state is supervisor-side only; staff never see it.

**Supervisors never answer device questions** (Q32 closed: no). The answer route accepts the device principal
only; a supervisor, owner or any other token gets 403 and nothing is written. Supervisors confirm or override
labels on the thread side (separate, role-audited actions). On the supervisor's day record an accepted answer
is shown beside its thread as "Seorang staf menjawab Ya: «...» / A staff member answered Yes: «...»" (or
*Tidak* / No; the stored, scrubbed, redacted reason; supervisor only), never with a device id. A thread
rejected by a *Tidak* is marked "Ditolak staf / Rejected by staff". Owners see summaries only.

---

## 4a. Data shape for the developer

- `QuestionSchema` (built in R-05b: `question_id`, `outlet_id`, `device_id`, `thread_id`, `kind` (`gate |
  unlabelled_unit`), `status` (`open | unverified`), `category`, `window_start_ms`, `window_end_ms`,
  `created_at_ms`). R-07 adds: `status` value `answered`; `answer` (`"yes" | "no" | null`, set together with
  `status: "answered"`; `answered` + `"no"` is "closed as rejected"); `answered_at_ms`; and whatever the list
  needs for the template and ranking (`prompt` or its parts, `rank`, `business_date`), decided in R-07's plan.
  `device_id` is the device that heard it (list and expiry scope only). **No `expires_at`
  field:** expiry is at the device's debrief end (technical spec §8.10, D3; R-07's plan picks a tick/route status
  write or a read-time rule). No `answer_shape`, no `options`, no field that targets a role or a person.
- `CorrectionSchema`: `correction_id`, `question_id`, `thread_id` (null for `unlabelled_unit`), `answer`
  (required, `z.enum(["yes", "no"])`), `reason_text` (required; the name-scrubbed then SDP-redacted reason,
  never the raw input; `z.string().min(1).max(1000)` as a storage bound, since redaction placeholders can
  lengthen it), `answered_device_id` (from claims; merge key; never shown to supervisors/owners),
  `answered_at_ms`, `received_at_ms`, `needs_supervisor_confirm`, `expires_at` (the 14-day text-retention
  rule of technical spec §8.15, because this is staff text), `created_at`. **No** `answered_by`, `staff_id`, name,
  `chosen_category`, `reason_code`, `fix_text`, `explanation_text`, or skip value.
- **Never store `staff_id`** on a question or correction (a re-identifying key into `staff`).
- The answer write is **idempotent by `question_id`** (upsert; a repeat returns 200 `already_answered`), so
  two people on one device never double-count and R-16's voice fallback can hand off to tap mid-debrief.
- The R-05b deferred fix applies: the `q_thread_*` question write must stop using a blind `tx.set`, so a later
  thread merge cannot reopen an answered question (`docs/tasks/R-05b.md`).

---

## 4b. `staff_confirmed` / `staff_rejected` gate inputs, reason checks (Rangga 2 Oct; answer side MVP 1 final, 4 Oct)

### 4b.1 The gate rule (plain code, hard rule #10)

The gate stays plain code; a staff answer is one more **input**, never a decision by itself.

- **Input (shape approved 2 Oct, unchanged):** `evaluateGate` gets an optional `staff_answer: { question_id,
  chosen_category: WorkCategory | null }`.
- **What produces it:**
  - An answer **counts** only when the server accepted it and wrote the correction (device and debrief
    binding pass, `answer` is yes/no, the trimmed reason is 1-500 characters, the name scrub and SDP
    redaction succeeded). A refused answer, and *Lewati*, produce no `staff_answer`; the question stays
    `open` and expires as `unverified` at the debrief end.
  - **YES** on a `gate` question → `staff_answer = { question_id, chosen_category: thread.category }` (the
    model's category).
  - **NO** on a `gate` question → `staff_answer = { question_id, chosen_category: null }` → the existing
    `staff_rejected` branch:
    1. **Gate:** `staff_rejected` is checked first: `verdict: "question"`, `fired_rule: "staff_rejected"`,
       logged with `gate_version: "2"`, `question_id`, and the model's category + confidence.
    2. **Thread:** not confirmed (`label_source` stays `"model"`, no `confirmed_category`), and
       `excluded_from_evidence: true`: never a fact, never cited by R-08, not counted by technical spec §8.15.
       R-07 never clears the flag.
    3. **Question:** closed as rejected (`status: "answered"`, `answer: "no"`); not re-asked, never set
       `unverified`, and no new question is created (the question-creation path is skipped whenever
       `staff_answer` is present).
    4. **Reason:** stored on the correction, shown to the supervisor ("Ditolak staf / Rejected by staff") and
       passed to R-08 as context only.
  - **NO on a sensitive category** (COMPLAINT, CORRECTION, SAFETY, SECURITY, DISRUPTION) is excluded like any
    other NO (approved by Rangga, 4 Oct). The supervisor still sees it on the day record.
  - **The reason is never read** to decide a category, a done/not-done verdict or any gate input: no model
    call, no keyword match. Two answers with the same choice and opposite reasons give the identical gate input.
  - YES or NO on an `unlabelled_unit` question is stored and counts as answered, but never feeds the gate.
  - **Known limits:** a mis-tapped *Tidak* excludes a real episode; a *Ya* whose reason disputes the label
    still confirms it. In both cases the supervisor sees the reason and can override.
- **Without `staff_answer`:** byte-identical to the gate today (`gate_version` `"1"`; the R-05a exhaustive test
  passes unchanged).
- **With `staff_answer`:** effective category = `chosen_category`, then:
  - **Never waived:** `invalid_label`, `needs_supervisor_confirm` (COMPLAINT / CORRECTION / SAFETY / SECURITY /
    DISRUPTION stay supervisor questions), `no_evidence`, and expiry (an answer timestamped after the
    debrief end that expired the question is refused, so it never becomes a fact; an answer with
    `answered_at_ms <= debrief_ends_at_ms` arriving late replaces `unverified` and is evaluated normally, §4c).
  - **Waived:** `label_conflict`, `always_question` (PHONE_CALL), `below_threshold`.
  - **Precedence:** `staff_rejected` → `invalid_label` → `needs_supervisor_confirm` → `no_evidence` →
    `staff_confirmed` (`verdict: "fact"`).
- **Logging:** `fired_rule`, the full `checks` array (waived rules with `waived: true`), `question_id`, the
  model's category + confidence beside the effective one, `gate_version: "2"`. No actor, no name.
- **Thread update:** keeps the model label; gains `label_source: "model" | "staff_confirmed"` and
  `confirmed_category`.
- **Tests (minimum):** low-confidence CUSTOMER_SERVICE + `chosen_category: CUSTOMER_SERVICE` → fact
  (staff_confirmed); COMPLAINT + `COMPLAINT` → question (needs_supervisor_confirm); 0 evidence lines + a
  confirm → question (no_evidence); PHONE_CALL + `PHONE_CALL` → fact (always_question waived); `null` →
  staff_rejected + excluded, including on a COMPLAINT thread with 0 evidence lines; the no-`staff_answer`
  path matches v1 for the whole R-05a grid. Producer tests: YES calls the gate with
  `chosen_category === thread.category`; NO calls it with `null`, leaves the thread excluded and unconfirmed,
  closes the question, creates no new question; opposite reasons give identical gate input; YES/NO on
  `unlabelled_unit` never call the gate; empty, whitespace-only, 501-character and redaction-failed reasons,
  and a body missing `answer` or with `answer: "maybe"`, never call the gate and leave the question `open`;
  an answer timestamped after the expiring debrief end is refused, while one timestamped before it replaces
  `unverified` (§4c); a NO-rejected question is not set `unverified` at the debrief end.

### 4b.2 Reason checks, in the answer route, before any write or log

0. Auth (`requireDevice`), then the strict zod body `{ question_id, debrief_business_date, answer:
   z.enum(["yes", "no"]), reason: z.string(), answered_at_ms }` (`.strict()`; missing or other `answer`, or
   any extra field → 400 `invalid_body`).
1. `t = reason.trim()`; `t === ""` → 400 `reason_empty` (YES and NO alike).
2. `Array.from(t).length > 500` → 400 `reason_too_long`. Never truncate.
3. Question scope and debrief binding (web spec §6.6.6 items 2-3; 404 / 400 as written there).
4. Staff-name scrub on `t` → `s`.
5. Sensitive Data Protection redaction on `s` through `lib/redact` (same settings as transcripts) → `r`.
   Failure or timeout → 503 `redaction_unavailable`, nothing written, nothing about the text logged; the
   phone keeps the entry and retries. Never a 400 here (a 400 makes the phone delete the entry).
6. Write the correction (`answer`, `reason_text = r`), set the question `status: "answered"` + `answer`, run
   the gate producer (§4b.1).

The raw `reason` and `s` are never persisted, logged, traced or echoed. Error logs carry `question_id`, the
error code and the length only.

**The name scrub:** server-side, before any write or log, replace each of the outlet's `staff` names with
`[STAFF]`, case-insensitive, on whole words (Unicode-aware, so "Dina" ≠ "Dinamo"), on the full name and each
token of ≥ 3 characters, normalised like `normalizeStaffName`; names are read from `staff` only. Known limit:
nicknames and misspellings slip through; "tanpa nama" in the label is the first defence. Write it as a pure
helper (e.g. `lib/debrief/scrub.ts`) so the planned rule-7a scrub of thread text can reuse it.

**Tests:** "dina lupa restock" → "[STAFF] lupa restock"; "DINA PUTRI telat" → "[STAFF] telat"; "Dinamo"
unchanged; `""` and `"   \n "` → 400 `reason_empty` for YES and NO; exactly 500 code points (one emoji counted
as 1) accepted, 501 → 400 `reason_too_long`; `answer` missing, `"maybe"`, or a `skip` / `explanation` /
`chosen_category` / `staff_id` / `device_id` field → 400 `invalid_body`; "dina bilang nomor pelanggan 0812 3456
7890" → stored text has `[STAFF]` and the SDP placeholder, and no log line or error body contains the name or
the number; SDP mocked to throw → 503, no correction, question still `open`; the empty and cap checks run
before the question lookup (an empty reason on a missing question is 400, not 404). Clock, cache, D3, D5 and
multi-device tests: backlog §3a "R-07 debrief required tests".

### 4b.3 Reason chips — withdrawn

No chip list and no `reason_code`. The "why" lives in the typed reason; R-08 reads the redacted reasons as
context and maps them to the intervention library itself (an agent reading redacted text for a proposal, not
the gate deciding a fact, so hard rule #10 holds).

## 4c. Required code change: question expiry in `lib/pipeline/gate.ts` (Rangga, 4 Oct)

`lib/pipeline/gate.ts` does not match technical spec §8.10 today. R-07 must change it; nothing is changed before
R-07 (docs only now). `docs/plan.md` §10 #45 tracks it.

- **Today:** `expireQuestion(q, now_ms)` turns an `open` question `unverified` once it is 7 days old, and
  both `expireQuestion` and `applyGateDecision` treat `unverified` as terminal ("never changes").
- **Required (technical spec §8.10, D3):**
  1. **Expiry at the debrief end, per device.** A question with `status: "open"` expires as `unverified`
     when an ended debrief of the question's device has `created_at_ms <= debrief_ends_at_ms <= now`. A
     question created after that debrief end stays `open` until the next debrief end of its device. A day
     without a debrief (off, cancelled) expires nothing. A question with no `device_id` is expired by the
     outlet's first debrief end. Remove the 7-day age rule entirely (no `expires_at`, no age constant).
  2. **A late answer replaces `unverified`.** An accepted answer whose `answered_at_ms <=
     debrief_ends_at_ms` of the debrief that expired the question (and that passes the §4.11 debrief
     binding) replaces `unverified` with `answered`, even when it reaches the server after the end.
     `unverified` is therefore no longer terminal for that case; it stays terminal for any other path (no
     answer after the end, no gate pass, no re-ask).
  3. **Answered questions are untouched by expiry**, including `answered` + `"no"` (closed as rejected).
- **Mechanism:** R-07's plan picks the idempotent status write (tick or debrief/answer route) or the
  read-time rule; both are plain code (hard rule #10). The new signature must take the device's ended
  debrief windows, not only `now_ms`.
- **Tests replace the 7-day tests in `lib/pipeline/gate.test.ts`:** open question created before the end →
  `unverified` at the end; created after the end → `open`; created on an off/cancelled day → `open` until the
  next debrief end; device A's end leaves device B's question `open`; an answer with `answered_at_ms` before
  the end arriving after it turns `unverified` into `answered`; an answer after the end is refused; an
  `answered` question (yes or no) is never set `unverified`; no 7-day rule remains (a 30-day-old question
  with no debrief end is still `open`).

---

## 5. Out of scope for R-07 (flag if asked to add)

- Voice debrief (R-16; same question queue by `question_id`, same answer contract).
- Any staff sign-in: name + PIN, a name picker, a staff session, an idle timeout, `signOut()` (all post-MVP 1).
- Push, SMS or email about the debrief; the attention cue (§3.2, separate backlog candidate).
- Editing a submitted answer; truncating an over-long reason; any automatic reading of the reason.
- Free text that revises the category; a *Bukan ini* or category picker (post-MVP 1).
- Supervisors answering device questions (Q32 closed: no).
- Releasing Mulai before the 1-hour timeout (Q30 closed: no).
- A supervisor "started but didn't finish the debrief" indicator.
- Any Cloud Scheduler job whose only purpose is to "notify": the entry card is client logic reading
  `debrief_ends_at_ms`.

## 5a. Decisions (all resolved)

- **Answer shape (Rangga, 4 Oct, MVP 1 final):** *Ya* / *Tidak* + a required reason (scrubbed, redacted, ≤ 500
  characters, refused not truncated), or *Lewati*; YES confirms the model category, NO rejects it via
  `staff_rejected`; the reason is context only.
- **Approved by Rangga, 4 Oct** (`docs/HANDOFF.md` "Answer decisions approved"): the two-part headline
  "Sekitar pukul HH:MM ada <langkah>. Benar?" with the SOP question in the reason prompt after *Ya* ("Kenapa
  tidak?" after *Tidak*); the reason required on YES and NO; NO on a sensitive category excluded like any NO.
  *(Recorded as closed, 4 Oct: `docs/plan.md` §10 #41.)*
- **Confirmed by Rangga, 4 Oct:** cap 500 refused not truncated; *Lewati*; done-when "5 typed answers in about
  5 minutes"; supervisor sees the redacted reason beside its thread without a device id; owner summaries only;
  reason chips withdrawn; no early release; supervisors do not answer device questions.
- **Q-D3 (2 Oct):** incidents first, then oldest-first; ranking is backend-only.
- **`staff_confirmed` gate rule (Q-D2, 2 Oct):** built in R-07, input shape unchanged (§4b.1).
- **Hours:** R-07 is 4.75 h on Wed 7 (`docs/plan.md` §5 is authoritative).

---

## 6. Separate small item: `/capture` and `/pair` copy polish

Copy and props only; no change to the capture engine, segment batcher or wake-lock logic. ≤ 30 min. Ships
with or after capture phase plan P1 (P1 rewrites the page, so polishing the old auto-hours copy first is wasted work).

1. **Mic-source label.** Under "Mikrofon / Microphone: <source>", add one line only when the source is not
   the default: "Pastikan mikrofon ini tetap terhubung." / "Make sure this microphone stays connected."
2. **`/pair` post-success line and button** (§2).
3. **Removed:** the old "Staff (opens automatically at closing)" button label and the "Listening starts
   automatically at the next opening time" stopgap. Both describe auto-hours capture, which the manual session model removed:
   P1 replaces the stub with the Selesai button and the disabled-Mulai notes (backlog §3a P1 steps; technical spec §8.5).

---

## 7. Conflicts list from UX-03 §8 — OPEN section

Carried from `docs/tasks/UX-03-journey-design.md` §8. Only C10 is still open (4 Oct).
Items closed by the session rules or a later Rangga decision are marked with where; the rest need Rangga.

| # | Conflict | Status |
|---|---|---|
| C1 | Debrief entry at `closing_time` vs at Selesai / auto-stop | **Closed by technical spec §8.3 rule 5, §8.10.** Entry follows Selesai or the auto-stop, lasts 1 h. Old text removed from this file (§3.1) |
| C2 | Sign-in remnants (name + PIN, `signOut()`, idle timeout, reload logs out) | **Closed by the MVP 1 device model** (`docs/specs/web-backend-rbac.md` §2a). Removed from MVP 1; post-MVP 1 only (§5) |
| C3 | Answer storage: `answered_by: "staff"` + device id, or no role | **Closed by web spec §6.6.6 item 4:** no `answered_by`, device id and timestamps only (§4a) |
| C4 | "Starts automatically at opening" copy | **Closed by technical spec §8.3 / R1:** capture is manual. Strings removed (§6 item 3) |
| C5 | Question headline "Apakah SOP ... dijalankan dengan benar?" vs "Sekitar pukul HH:MM ada <langkah>. Benar?" | **Closed:** the MVP 1 headline, approved by Rangga 4 Oct (§4.2). Only that template may be in code |
| C6 | Done heading "Selesai — terima kasih!" clashes with the Selesai button; proposed "Debrief selesai — terima kasih" | **Closed (Rangga, 4 Oct): yes.** The done heading is "Debrief selesai — terima kasih" |
| C7 | `/pair` shows the raw outlet id; design shows the outlet name (needs the name in the pair response, an API change) | **Deferred (Rangga, 4 Oct).** MVP 1 keeps the raw outlet id; the outlet name is post-MVP 1. No API change now |
| C8 | Reason required on *Tidak* as well as *Ya* | **Closed by Rangga, 4 Oct** (`docs/HANDOFF.md` "Answer decisions approved"; `docs/plan.md` §10 #41) |
| C9 | Bahasa and English both visible on the shop phone vs a toggle (T-401a) | **Superseded (Rangga, 4 Oct) by the language toggle** (plan.md §10 #49, technical spec §8.17): English default, top-bar `ID \| EN` control on every screen, one language at a time. The earlier "value bilingual, label once in Bahasa" rule no longer applies |
| C10 | A one-time "upload working again" toast on recovery; technical spec §8.8 defines success as a line state only | **OPEN** until the `feat/capture-upload-toast` review is done (Rangga, 4 Oct) |

# SOP Improvement Agent — Task Backlog (v3, 30 Sept 2026, 01:30 WIB; reconciled 4 Oct 2026)

**Sources of truth:** `docs/plan.md` for sprints; `docs/specs/technical-specification.md` (§8) for
capture and session rules; `docs/specs/web-backend-rbac.md` (§6.6) for routes and data;
`docs/tasks/UX-03-journey-design.md` for screens and copy.
Precedence: `CLAUDE.md` → `docs/plan.md` → this backlog. Where a step below restates a session rule
(Mulai/Selesai, the Mulai window and gate, debrief timing and expiry, cancel, the answer contract, upload status,
sign-in, consent, retention), the technical spec §8 and the web spec §6.6 win. Reconciled with the session rules
on 4 Oct (tech-lead): load figures, a capture phase plan entry, the `answered_by` remnant, the encrypted-queue
row, R-16 wording and the copy-polish item.

> **Updated 4 Oct 2026, capacity cuts (Rangga, 4 Oct, all three together; `docs/plan.md` §7, §8a, §10 #51).**
> R-15 CriticAgent and the capture phase plan P5 cross-device merge move to the **next MVP (post-MVP 1)**; R-10's diff
> view becomes a **plain before/after list** (2 h → 1 h). Total 80.75 h of 84 h (96%). Changed: §1, §3 intro,
> P5, R-10, R-15, new §6a.

> **Updated 4 Oct 2026, MVP 1 answer shape (tech-lead, docs only; Rangga, 4 Oct, final; `docs/HANDOFF.md`
> "Debrief answer shape for MVP 1"). Supersedes the free-text-only answer in the note below.** R-07: each
> question gets ***Ya* / *Tidak* + a required reason, or *Lewati***; YES → `staff_confirmed` (thread's model
> category), NO → `staff_rejected` (thread excluded from evidence, question closed as rejected); the reason is
> required on both (tech-lead choice, flagged), refused when empty or over 500 characters, scrubbed and
> redacted, context only; category-revising free text is post-MVP 1. **R-07 +0.25 h (4.75 h)**, plan.md §5.
> Changed: R-07 (heading, steps, done when).

> **Updated 4 Oct 2026, final (tech-lead, docs only): debrief answer shape (Rangga, 4 Oct, final;
> `docs/HANDOFF.md` "Debrief answer shape").** R-07: the answer is **one free-text WHY explanation** (no
> *Ya* / *Tidak* / *Bukan ini*, no reason chips); empty is not an answer; cap 500 characters, refused,
> never truncated; name scrub and Sensitive Data Protection before storage; `staff_confirmed` keeps its
> approved input (the thread's model category) and never reads the text; supervisors do not answer device
> questions; no early Mulai release. Hours unchanged (plan.md §5). Changed: R-07 (heading note, steps,
> done when).

> **Updated 4 Oct 2026, late (tech-lead, docs only): role-agnostic questions, multi-device, the Mulai gate,
> no undo (Rangga, 4 Oct, final; `docs/HANDOFF.md`).** R-07: every question is the role-agnostic
> SOP-implementation question ("Was the SOP step done properly? If not, why?"), one answer shape (*Ya* /
> *Tidak* + reason / *Bukan ini*, proposed, Q31 (removed; rule in web spec §6.6.6); *superseded 4 Oct, final: one free-text explanation*); answers store the device id and timestamps only
> (no `answered_by`); expiry per device; `answers_pending` in the heartbeat for the cross-device merge.
> Hours unchanged (plan.md §5). Changed: R-07 (steps, done when).

> **Updated 4 Oct 2026 (tech-lead, docs only): sign-in and consent (Rangga, 4 Oct, final; `docs/HANDOFF.md`).**
> Owner and supervisor keep Google sign-in; staff need no sign-in. **Consent is not collected in the app:**
> it is covered by the paper contract between bee6 and Proofed, and bee6 emails the consent, the updated
> privacy policy and the TnC to all users. The in-app consent gate (`consent_complete`, the "no consent"
> view, the staff-consent step) is **removed from MVP 1** (removed in code with capture phase plan P1; §3a P1 steps).
> Revocation stays manual with no in-app revoked-consent state. No estimate changes. Changed: R-03 steps,
> R-14 steps, T-901 row.

> **Updated 4 Oct 2026 (tech-lead, docs only): MVP 1 device model (Rangga, 4 Oct, final).** No staff
> sign-in in MVP 1 (no name, no PIN); staff only pair a device; the system tracks the device id only and
> runs every session rule per device; mode (1 active paired device = room, more = wearable) is a label
> only (`docs/specs/web-backend-rbac.md` §2a). R-02's staff PIN work is done and stays dormant (status
> note added). **R-07 drops the name + PIN sign-in**: the paired device opens its own questions directly,
> answers are stored as `answered_by: "staff"` + the device id, the PIN route is turned off, and the mode
> label is added; R-07 is ~4.5 h (plan.md §5). Changed: R-02 (status), R-07 (steps, depends on, done when).
> *(Superseded 4 Oct, later: answers store no `answered_by` role, only the device id and timestamps,
> technical spec §8.10–§8.11; R-07 is 4.75 h.)*

> **Updated 3 Oct 2026 (aligned with `docs/plan.md` v5):** task dates re-dated to the Mon 12 Oct pilot go-live (internal testing Tue 6 – Sun 11 on a test outlet in the pilot project, Rangga's written sign-off Sun 11 18:00, real evidence Mon 12 – Wed 14, first real insight run Thu 15 with a Fri 16 fallback, submit Fri 16, pilot review Wed 21 Oct after submission); R-16 moved to "if time"; Sprint 2 load 92% with cut order R-15, R-10 plain list, P5; R-03/R-07 capture and debrief wording switched from opening-hours gating to manual Mulai/Selesai.

**What this doc is:** the step-by-step detail for every task in the current plan. Dates, hours and sprint goals live in `docs/plan.md`; if the two disagree, the plan wins.
**Task IDs:** `R-xx` = Rangga's build tasks. `T-xxx` = spec sections in `docs/specs/pipeline-and-agents.md` and `docs/specs/web-backend-rbac.md`, where the acceptance criteria live.
**How Rangga works each task with Claude Code:** read the task + spec → plan in `docs/tasks/R-xx.md` → Rangga says go → small commits → tests → PR → Rangga reviews → deploy → check "Done when" on the live URL (see `CLAUDE.md` §4).

---

## 1. Critical path

R-01 → R-02 → R-03 → R-04 → R-05a → R-05b (done in Sprint 1) → capture phase plan P1 + **pilot deploy (Mon 5)** → R-06 → R-07 (**Wed 7**) → R-08 → R-09 → R-10 → **internal testing (Tue 6 – Sun 11)** → **Rangga's written sign-off (Sun 11, 18:00)** → **pilot go-live (Mon 12)** → real evidence Mon 12 – Wed 14 → R-11 → **first real insight run + SOP v2 (Thu 15**, fallback run Fri 16) → R-14 → **submit (Fri 16)** · pilot review **Wed 21 Oct**, after submission.
Off the path (can slip without moving a milestone): R-12, R-13, R-16 ("if time"). R-15 and the P5 cross-device merge are next MVP, not MVP 1 (§6a). Total load is 96% (80.75 of 84 h; Sprint 2 105%; `docs/plan.md` §7, after Rangga's 4 Oct cuts); if it slips, the only remaining cut is capture phase plan P5 → R-08's own button. capture phase plan P1 (incl. Cancel-A and the Mulai window), P4, Cancel-B (before the Sun 11 sign-off) and R-07 are on the path and not on the cut list.

## 2. Sprint 1 — capture + transcription core (Wed 30 Sep – Sun 4 Oct)

### R-01 Foundations · 4 h · Wed 30
- **Steps:** two GCP projects (pilot = real Proofed data, demo = fictional only), paid billing, budget alerts 50/90/100%, APIs on (T-001) · region probe script → `config/regions.yaml` (T-002) · public GitHub repo with licence + `.gitignore` for audio and `/private/` (T-003) · Next.js + TypeScript skeleton · Cloud Build trigger on `main` → Cloud Run `web` in asia-southeast2.
- **Depends on:** nothing.
- **Done when:** a push to `main` deploys a hello page to Cloud Run in Jakarta; `regions.yaml` lists a location for every model (Transcribe, 3.5 Flash-Lite, 3.5 Flash, the Live model); no API keys, service accounts only.
- **Check-in Wed 30, 20:00:** probe results + 5-min capture test; start the 14 h test.

### R-02 Data + login + roles · 5 h · Thu 1 – Fri 2
- **Steps:** Firestore schema v0 with TTL on `segments` (the web spec §6.4) · Firebase Auth Google sign-in · custom claims `{outlet_id, role, staff_id?, device_id?}` · role check on every API route · **seed script** (`npm run seed`): outlet, owner + supervisor emails, staff names + PIN hashes, a 6-digit pairing code for the shop phone · `/pair` page that swaps the code for a device token · staff name + PIN login on the paired phone (T-005, T-006; built, dormant: post-MVP 1, not the MVP 1 sign-in).
- **Depends on:** R-01.
- **Done when:** owner and supervisor can sign in and see only their outlet; a wrong outlet ID is rejected by the server; staff PIN login works only on the paired phone; 5 wrong PINs lock for 15 min (met in R-02; the route is off in MVP 1).
- **Status (4 Oct, MVP 1 device model):** done. The staff name + PIN sign-in it built is **post-MVP 1**: dormant in MVP 1 (no PIN is given to staff; R-07 turns `POST /api/v1/auth/pin` off). The `staff` collection stays as the only place names live (scrub + vocabulary).

### R-03 Capture page · 8 h · Fri 2 – Sat 3
- **Steps:** `/capture` with mic permission, input picker, sample-rate check (< 16 kHz refused), screen wake lock, Mulai/Selesai session boundaries; opening hours as checkpoints only (T-101 revised) · AudioWorklet 16 kHz + Silero VAD (ONNX Runtime Web), 400 ms pre-roll (T-102) · segment batcher ≤ 15 s (≥ 2 s pause after ≥ 6 s, or 8 s silence) + Opus via WebCodecs + `PUT /api/v1/segments/{device}:{seg}` with retry (T-103) · in-memory queue ~10 min (T-107a) · heartbeat every 60 s + self-restart on mic errors (T-105) · status screen only, no transcript · ~~capture refuses to start if the outlet's consent flag is false~~ *(removed from MVP 1, 4 Oct: consent is by the bee6–Proofed paper contract plus an emailed notice; the built gate is removed in capture phase plan P1, §3a P1 steps; the privacy line stays as an in-app notice).*
- **Depends on:** R-02 (device token); segment API contract agreed with R-04.
- **Done when:** the web spec §5 capture checks pass on the shop phone (silent room → 0 bytes; first syllable intact; 3 min of talk → ≥ 12 segments; 10 min offline → every segment arrives once, in order; external mic unplugged → built-in within 3 s).
- **Cut if behind on Sat:** input picker (built-in mic only) and the heartbeat screen.

### R-04 Segment API → Transcribe · 4 h · Sun 4
- **Steps:** idempotent segment route (device token required) · audio inline to **Gemini 3.5 Transcribe** (verbatim, custom vocabulary ≤ 100, `id-ID`/`jv-ID` or auto-detect, whichever tests better on Tiffany's clips) · Sensitive Data Protection redaction · store lines with device times, model and location; TTL 48 h (T-202, T-204, T-303) · log audio seconds + tokens per call.
- **Depends on:** R-01 (probe), R-02, Tiffany's vocabulary list (Sat 3).
- **Done when:** a repeated `PUT` returns `200` with no second model call; no audio or base64 anywhere in Firestore, logs or errors; 5 demo clips come back as readable redacted text.

### R-05a Pipeline plain code · 4 h · Sun 4
- **Steps:** windowing (≥ 90 s silence or 6 min cap; tiny windows batched; empty windows make no call) (T-302) · thread builder over `reply_to` links with grace periods (T-305) · evidence gate rules (T-306) — all with unit tests on made-up data.
- **Depends on:** R-04 data shape.
- **Done when:** unit tests pass for parallel threads, a thread across 3 windows, and every gate rule.
- **Status (v5):** done early in Sprint 1 (merged).

## 3. Sprint 2 — build the loop + internal testing (Mon 5 – Sun 11 Oct)

Mon 5: capture phase plan P1 (Mulai/Selesai) finished and the pilot project deployed with a test outlet. Tue 6 – Sun 11: internal testing by Rangga and Tiffany on that test outlet (no Proofed live capture). Sun 11, 18:00: Rangga's written go-live sign-off (Proofed being "informed" is a verbal acknowledgement, not sign-off). Load: `docs/plan.md` §7 (96% total after the 4 Oct cuts: P5 cross-device merge and R-15 to the next MVP, R-10 plain list); remaining cut: P5.

### The capture phase plan (P1–P5) (Mon 5 – Sun 11) — steps and acceptance in §3a
- **P1 · ~11 h · Sun 4 – Mon 5:** day calendar (`weekly_hours`), Mulai/Selesai, the Mulai window
  [01:00 on D, close(D) − 4 h] and the per-device Mulai gate, Selesai from Mulai + 4 h, the hard auto-stop at
  close + 1 h, checkpoint banners, session API, upload status line (headline stays green for every upload result, incl. `queue_full`:
  technical spec §8.8), 401/403 kept and retried, tab lock,
  DevPanel readouts, consent-gate removal (§3a P1 steps), **Cancel-A** (technical spec §8.3–§8.9).
- **P4 · ~1.5 h · Tue 6:** 14-day retention on redacted thread text (`expires_at` + TTL, backfill) (technical spec
  §8.15). The new privacy line reaches the pilot only through Rangga's sign-off (technical spec §8.16).
- **Retention periods (technical spec §8, confirmed by Rangga 4 Oct):** threads 14 days (§8.15, P4) · history `events`
  on the phone 14 days (§8.12) · answer cache on the phone 14 days (§8.11, R-07) · undelivered audio on the
  phone 24 h (§8.14, P3 only).
- **Cancel-B · 1.5 h · Sun 11:** derived thread/question cleanup for a discarded session under the device lock,
  plus the tick guard. Must merge before the Sun 11 18:00 sign-off (technical spec §8.9, Cancel-B cleanup).
- **P5 · ~4 h · Sun 11:** idempotent insight runs per exact date range + plain-code sufficiency check
  (technical spec §8.15). The cross-device merge (technical spec §8.15, 0.5 h) is **post-MVP 1** (next MVP, §6a): MVP 1 counts per
  thread, so counts are inflated with two or more paired devices; pass/fail is unchanged.
- **P2, P3:** "if time" (§6 below). P3 stays OFF on the pilot until Rangga's explicit formal sign-off.
- **Done when:** the §3a rows for the phase pass (browser rows by QA; real-phone rows by Rangga/Tiffany
  in the internal testing window). Those rows, the required unit tests and the routing now live in §3a below.

### 3a. The capture phase plan (P1–P5): steps, required tests, routing (6 Oct 2026)

Rules: `docs/specs/technical-specification.md` §8. Routes and data: `docs/specs/web-backend-rbac.md` §6.6.
"T" = the test must exist before the phase is called done. Browser rows are driven by QA (Playwright, fake
audio from a fictional clip, the dev "fake now" offset); real-phone items by Rangga and Tiffany in the internal
testing window. Test outlet: fictional past-midnight hours, default 09:30-01:00 every day (W = 01:00-21:00,
auto-stop 02:00, debrief by 03:00); E-rows marked "22:00 outlet" use 08:00-22:00 (W = 01:00-18:00, auto-stop
23:00).

**P1 steps (what auto-hours code is replaced).** Delete the single-window opening-hours check and its test
(keep the `HH:MM` and minutes-of-day helpers, moved into the calendar module); replace the clock-driven capture
phase with the pure session reducer; rewrite the capture page so start/stop happen only on Mulai/Selesai and
the 30 s timer only re-evaluates checkpoints; replace the paused "outside hours" view with `idle` + Mulai + the
banner; replace the "opens automatically at closing" stub with Selesai (+ confirm) and a disabled debrief stub
until R-07; remove the dev-mode gate bypass and DevPanel Start/Pause/Stop (add the readouts, technical spec
§8.18); change the capture config response (§6.6.2); add the optional outlet fields and the per-device
`last_ended`; seed `weekly_hours` (fictional for demo; real pilot hours only in the private seed); split the
browser session into stop-capture and dispose and pass `session_id`; add the 401/403 `blocked` disposition;
remove the R-03 consent gate everywhere (schema field optional and unread, config, reducer, page view, seed,
route header, and the consent tests; add one contract test that the config has no `consent_complete` and one
schema test that an outlet without it parses). Nothing under `lib/pipeline/**` reads opening hours.

**P1 required tests (T).**
- Calendar: zoned-time conversion for Asia/Jakarta and one DST zone on a change date; planned interval for a
  normal, a closed and a past-midnight day; close / window / auto-stop for the test outlet, the 22:00 outlet and a
  closed weekday; `mulaiWindowDateOf` at 00:59 (null), 01:00, 21:00 (inclusive), 21:00 + 1 ms (null);
  `businessDateOf` at 00:59 (previous date) and 01:00, `businessDateOf(oneAm(d)) === d`,
  `businessDateOf(oneAm(d) − 1) === prev(d)`; `selesaiFromMs` (01:00 → 05:00; 21:00 → 01:00 next day; a start
  after the window end clamped to close) and the 4 h constants equal; `mulaiAvailability` for every reason, every
  row of the technical spec §8.3 table, `next_offer_ms` across a closed weekday and across month and year ends;
  `evaluateCheckpoint` before open, at open, at the window end, 1 ms after, Mulai not offered, running before
  close, running at close and through 01:00-02:00, closed weekday; the weekly-hours validator reference cases
  (§8.2); `attributedBusinessDate` for every example, a discarded session → null, two overlapping devices → the
  given device wins, the auto-stop instant outside the session.
- **Eligibility invariant:** for each fixture table, each `E` in a 14-day range and each `debrief_ends_at_ms` in
  {null, close + 1 h, close + 2 h}, every 15-min step over 48 h that is offered has `business_date > E`, lies in
  W(business_date), is not a closed weekday and is at or after the debrief end; every instant in W(D) with no open
  session, `D > E` and no running debrief is offered. Two devices with different `last_ended`: each depends only
  on its own.
- Reducer: every legal transition; every illegal event returns the same object; `MULAI` with `offered: false` is
  a no-op; `SELESAI` before `selesai_from_ms` is a no-op; `DISCARD` from running/interrupted → idle with
  `ended_by: "discarded"`, from idle/loading/error a no-op; `MULAI` after `DISCARD` is a no-op until the next day
  is offered; `RESUME` works regardless of availability; `AUTO_STOP` only from running.
- Session service and routes: start idempotent; end without start creates and ends; end twice idempotent; start
  5 min + 1 ms in the future and 7 days + 1 ms old rejected (422), exactly 7 days accepted; end before start
  rejected; a start at 01:30 stores that date; a start at 00:30 stores the previous date and writes one
  `capture.session_start_outside_window` audit; a start for an ended date → 200 + one
  `capture.session_start_after_day_end`; `auto_stop_at_ms` = close + 60 min; the end sets `debrief_ends_at_ms`
  (selesai and auto_stop: end + 1 h; lost: auto-stop + 1 h) and `devices/{id}.last_ended` (another device's doc
  untouched; an older date never overwrites; a retry writes nothing); auth matrix (no token 401; staff/supervisor
  403; device ok); strict bodies (a body `device_id` → 422); a non-uuid path → 422; config returns `last_ended` or
  null.
- Upload line: one case per row of the technical spec §8.8 table, row 1 beats row 2, a drop then an upload ends
  `succeeded`, a 401 during the drain → `retrying` + hint and never `succeeded`, a stale engine's late callback
  changes neither axis; the headline tests assert no upload input and no queue-cap input changes the headline.
- Page (fake timers): double-tap Mulai → one session; offline with no cached config → `error`, no capture;
  Selesai then "Belum, lanjut" → nothing changes; Selesai hidden before start + 4 h with the note and shown at it;
  reload → `interrupted`, Lanjutkan keeps the session id and the stored `selesai_from_ms`; second tab →
  `tab_busy`; the timer never starts capture; banners from a mocked clock; the disabled-Mulai notes per reason;
  Mulai enables at `next_offer_ms` with no reload (including the 03:00 debrief-across-01:00 case and 01:40 for a
  debrief to 01:40); mount with storage cleared but config `last_ended` → disabled; mount with a stale cached
  config but the local key set → disabled; clicking disabled Mulai never starts capture; both confirms show the
  reopen time; no override control renders on a closed weekday, also with dev controls on.
- Auto-stop: every example; the deadline on the next calendar date for a past-midnight close (warning at 01:50,
  `ended_auto` reads 02:00, `local_date` the business date); the timer fires → one stop, end with `auto_stop`; the
  tick catches a missed timer; timer + tick in the same ms stop once; a reload after the deadline → `lost` at the
  beacon, no Lanjutkan; a session in its closing hour recovers as `interrupted`; offline auto-stop still stops and
  retries the end; Selesai and auto-stop in the same second → one stop.
- History log: an event at each P1 transition; a row older than 14 days purged on mount; an event after 00:00
  inside Wednesday's session sits under Wednesday; the screen renders only time, kind and count.

**Cancel-A (P1) and Cancel-B required tests (T).**
- Browser session: discard never flushes; purges only this session's items (an earlier session's item survives);
  aborts only this session's in-flight upload. Upload line after a discard with an empty queue is hidden even if
  `lastTerminal` was set.
- Discard route: auth matrix; strict body; `discarded_at_ms < started_at_ms` → 422; future → 422; either
  timestamp 8 days + 1 ms old → 422, exactly 8 days accepted; missing → tombstone; open → tombstone; twice → 200
  and no second audit; ended `selesai` → 409 `session_ended`; only that session's segments deleted; start and end
  after a tombstone → unchanged; the audit has only `local_date`, `elapsed_ms`, `segments_deleted` (plus Cancel-B's
  counts).
- Audit-count rulings (fake store deleting in batches of K, able to throw after a chosen batch): the tombstone
  transaction returns exactly one fixed audit (`dev-a:<sid>:capture.session_discarded`, `segments_deleted: 0`) and
  the idempotent branch none; 2 segments deleted then a crash → retry deletes 0 → one audit, count 2; 5 segments,
  K = 2, throw after batch 1 → 2, retry → 5, one audit; 1 segment then 2 late ones → retry → 3; tombstone
  transaction throws → no audit and no delete; three calls → one audit.
- Schemas: a segment with `session_id` uuid, null, or absent parses; `"abc"` fails; the same for the segment
  metadata.
- Segment route: header + tombstone → 200 `discarded: true`, no transcribe call, nothing written; header + open
  session → normal, `session_id` stored; no header → normal; a tombstone committed between the pre-transcribe read
  and the write → nothing written.
- Cancel-B planner: a thread fully inside I deleted; one line in I with earlier lines outside → deleted whole;
  another device's thread and a thread outside I untouched; the `gate` question of a deleted thread deleted; an
  `unlabelled_unit` question overlapping I deleted, a non-overlapping one kept; label units by segment prefix.
  Tick: a pending tombstone cleaned before segments are read; lock busy → route 202, next tick cleans.
- Four page scenarios: accidental Mulai then cancel (no queue item, nothing flushed, session and beacon cleared,
  pending discard sent then removed, headline `discarded`, Mulai disabled with the next-day note, no opening
  banner); cancel during a failing upload (head purged, request aborted, line hidden, no `segment_dropped`, a late
  200 changes nothing); double-tap safety (two taps on cancel open the panel only; two taps on delete → one
  discard, one POST, one audit); not offered after Selesai or the auto-stop (a forced `DISCARD` is a no-op, the
  POST returns 409).

**Language toggle required tests (T).** Missing or unknown `bee6_lang` → `<html lang="en">` and English;
`id` → `<html lang="id">` and Bahasa on the first server render; the toggle writes only the cookie (no fetch); a
switch while running, with an open panel, with a typed reason, in `stalled` and in the debrief changes no state,
timer, fetch, focus or typed text; every dictionary key has `id` and `en` (type check) and no line exceeds 59
characters (UX-03 §9a); an unknown category code falls back to the unlabelled template; the cookie value never
appears in an API body or an `events` row.

**R-07 debrief required tests (T), in addition to R-07 notes §4b and §4c.** Debrief ends exactly 60 min after
Selesai and after the auto-stop; a `lost` session's window starts at its `auto_stop_at_ms`; reload at +30 min
resumes with 30 min left; reload after the end shows it ended; the cache entry is written before the upload call
(spy order), removed on 2xx and on "already answered", removed (not retried) on 400, kept on 503 and on network
failure; 14 days − 1 ms kept and sent, exactly 14 days purged and never sent; the cache has no field that can
hold a name or staff id; D5: the upload carries only the device token; another outlet's question → 404; another
device's question of the same outlet → 404; `answered_at_ms` after the debrief end or in the future → 400; the
stored doc has `answered_device_id`, `answered_at_ms`, `received_at_ms` and no actor field; two devices: A's
debrief end expires only A's open questions and A's Selesai does not disable B's Mulai; answering every question
leaves Mulai disabled until `debrief_ends_at_ms`.

**P2 required tests (T).** Gap tracker: open/close; duplicate open and close-without-open are no-ops; a capture
gap refused with no session; an upload gap allowed after Selesai; Selesai closes all capture gaps; `mic_lost`
supersedes `mic_interrupted` at the same ms; a specific gap supersedes `unrecorded`; kind derived. Recovery
(`planRecovery`): deadline not passed → interrupted + open gap from the beacon (also in the closing hour); battery
3% not charging → `battery_empty`, charging → `unrecorded`; a stale beacon of another session ignored; deadline
passed → `lost` at the beacon, no gap. Outbox (fake IndexedDB + fake timers): FIFO; coalescing one `gap_id`;
400/422 acked; 401 stops; 5xx backoff; ops survive a simulated reload. Local store: IndexedDB unavailable →
in-memory fallback + `storage_degraded`. Engine: a prune calls the dropped-segment hook with its times; the
watchdog opens `unrecorded` after 5 s without frames and closes on the next frame. Gaps route: auth matrix,
create, close-update, conflicting replay ignored, batch > 50 → 422, a future timestamp → 422, a client `kind` →
422.

**P3 required tests (T).** Vault (fake IndexedDB + Node WebCrypto): round trip; the stored record contains no
plaintext (the ciphertext neither equals nor contains the input's first 64 bytes); an AAD mismatch fails decrypt →
record deleted + `segment_dropped`; the key is non-extractable (export rejects); cap by ms and by bytes refuse
(`refused_full`); a quota error → `refused_full`; another write error → `storage_error`; confirm deletes the record
and, after session end with no records, the key; the purge deletes > 24 h unsent records and emits `expired_unsent`
per record; device-mismatch purge; records and key usable after close and reopen. Engine with the async queue: FIFO
across a reload; a 10-hour offline simulation accepts until the cap, opens `queue_full`, then uploads every
accepted segment exactly once in order on reconnect, and closes `queue_full` at the next accepted segment. Every
outbox, session, gap and heartbeat schema rejects an extra field and has no free string longer than a uuid.

**P4 steps and tests.** `ThreadSchema.expires_at` (ISO in the domain, Timestamp in the store, copying the segment
pattern); the tick computes it from `last_line_end_ms + retention_days × 86 400 000`, reading `retention_days` once
per outlet per tick (default 14); a backfill script for threads missing it (`--dry-run` by default, `--apply` to
write, `--project` required and echoed); dev-ops adds the TTL policy on `threads.expires_at` in both projects and
records it in `docs/tasks/R-01-gcp-state.md`; the `CLAUDE.md` §2 #7a wording changes in the same PR (PM edit).
Tests (T): expiry from the last line; a continued thread moves it forward; a custom `retention_days`; the store
round trip keeps ISO in the domain type.

**P5 required tests (T, pure sufficiency).** Range: from > to; to in the future; 15 days; from older than retention.
Days: closed day excluded; two sessions on one day unioned; a session 09:40 → 01:40 (Selesai in the closing hour)
gives all its minutes to its own day; a fact first heard at 00:30 counts for the previous business day; a question
created at 00:40 falls in the previous day; a range `[d, d]` includes `d`'s after-midnight facts and excludes
`d − 1`'s tail; a fact at 01:30 inside `d`'s closing hour counts for `d`, one at 01:30 in a session started at
01:30 counts for the new day; a working day ending 01:10 then a no-Mulai day → the second is `day_off` from its
window end; a capture gap subtracted, an upload gap not; overlapping gaps not double-subtracted; a legacy heartbeat
day; a no-data day; today in progress excluded; `d`'s session open at Thu 01:30 → `in_progress`; `d`'s debrief to
03:00 → `in_progress` until 03:00; no session after the window end → `day_off`, excluded, not in the fail message;
before the window end → `not_started`, exactly at it still `not_started`, 1 ms later `day_off`; a prep session
closed `lost` before opening → `on` with `low_coverage`; an early Selesai at start + 4 h (10:00-14:00) → `on`,
`low_coverage`, `in_progress` only until 15:00; a stale-phone session on a closed weekday → `closed`; a start
outside every window dated by the 01:00 rule; a question created at 02:10 for a thread first heard at 00:30 inside
Monday's session counts for Monday; a day whose only session is discarded → `day_off`; a discarded session
overlapping a real one adds no coverage; a fact inside a discarded session not counted; an open gap → unsettled →
`data_settled` fails; `oldest_queued_ms` before the day end → unsettled; `answers_pending` with oldest date `d` →
unsettled, cleared at 0. Rules: exactly at threshold passes (0.60, 3 days, 2 / 2), just below fails; 2 facts on 1
date fails; zero questions passes `staff_answers`; questions with no answers fails. Same input twice → deep-equal.
Routes (fake transactional store): role matrix (device/staff 403, another outlet 403); insufficient writes the run
with no agent call; passed writes `awaiting_agent`; a repeat on `proposed` → 200 reused, agent not called, count 2;
two concurrent POSTs → one 201 + one 409, one agent call; an expired lease reclaimed; a stale worker's finishing
write ignored; `insufficient` re-evaluated in place on the same doc; `failed` × 3 → 409 `retry_limit`; owner then
supervisor on one range → same doc, `requested_by_role` unchanged; an overlapping range → 201, a second doc, the
first untouched. (Merge tests: next MVP, with `mergeDevices`.)

**Browser rows (QA).**

| # | Setup | Expected |
|---|---|---|
| U1 | P1: speak, then `setOffline(true)`, then online | headline stays Listening; line uploading → retrying (1x), (2x)… → succeeded |
| U2 | P1: dev seed with closing = now − 59 min | stop-soon banner, then `ended_auto`, uploads drain, debrief clock starts |
| U3 | P1: Mulai, reload, second tab, 360 px | Listening only after frames flow; reload → interrupted + Lanjutkan; second tab → `tab_busy`; layout fits 360 px |
| M1 | Session from d 10:00, running at d+1 01:00 | Selesai since d 14:00; closing banner from 01:00 with stop time 02:00; stop-soon from 01:50; no moment after midnight without a banner |
| M2 | Mulai d 09:40, no Selesai | stops d+1 02:00; `ended_auto`; end `auto_stop`; `local_date` d; `debrief_ends_at_ms` d+1 03:00; debrief entry; uploads drain |
| M3 | Selesai d+1 01:10; no Mulai on d+1 (API fixtures) | from d+1 21:00 the day record shows d+1 off; no `low_coverage`, no gap, not listed as missing; d keeps its minutes |
| M4 | Session d, no Selesai, auto-stop d+1 02:00 | Mulai disabled 02:00-03:00 (`debrief_running`), enabled 03:00; no session by 09:30 → opening banner with the 21:00 cut-off |
| M5 | Facts spoken 00:30 and 01:30 inside d's session (API fixtures) | both counted for d in the day record and P5; run `[d, d]` includes them, `[d+1, d+1]` does not |
| M6 | Selesai d+1 01:10, reload 01:40 | debrief resumes with 30 min left, ends 02:10; Mulai enabled 02:10, answered or not |
| W1 | Previous day ended or off; fake now d+1 00:59 | Mulai disabled; note gives 01:00 (or this device's running debrief end, if later) |
| W2 | Same; fake now d+1 01:00 | enabled within 30 s, no reload; a Mulai stores `local_date` d+1 |
| W3 | No session on d; fake now 20:59, 21:00, 21:00:30 | enabled at 20:59 and 21:00; at 21:00:30 disabled (`window_passed`), no opening banner |
| W4 | As W3, then d+1 00:30 | d shown off; no gap; P5 skips d; Mulai disabled until 01:00 |
| D1 | Wed session from 10:00, no Selesai | Selesai from Wed 14:00; Thu 01:00 closing banner, no Mulai; 02:00 `ended_auto` + debrief; disabled to 03:00 then enabled; Mulai 03:05 → `local_date` Thu, Selesai from 07:05, auto-stop Fri 02:00 |
| D2 | Selesai Thu 01:10, open debrief, reload 01:40 | entry back with 30 min left, ends 02:10; a tapped answer still cached or uploaded; reload 02:15 → ended, unanswered `unverified` |
| D3 | Cancel Wednesday's session at Thu 01:30 | headline cancelled; no Mulai for Wednesday; Thursday's enabled at once and dated Thursday |
| D4 | Mulai d 10:00 | at 13:59 no Selesai (cancel + "available from 14:00" note); at 14:00 Selesai appears with no reload |
| K1 | Answer 2 questions online, then one offline | each entry in the cache before its POST, gone after 2xx; the offline one uploads on reconnect, then gone |
| K2 | Seed entries at now − 14 days and − 14 days + 1 min; reload | the first purged on mount, never sent; the second uploaded and removed |
| C1 | Mulai, speak 5 s, cancel, wait 1 s, delete | headline cancelled; server line removing → removed; no session key, beacon or pending discard after the 200; no segment with its id; tombstone + one audit; day off if only session; supervisor count 1; Mulai disabled with the reopen note, no opening banner |
| C2 | Segment PUT routed to 503, line at (2x), cancel | head purged, request aborted, line hidden, no "skipped"; later recovery uploads nothing of it |
| C3 | Offline, cancel, wait, online | phone purge immediate; "will be removed when online" → removed; segments uploaded before going offline deleted on the server |
| C4 | Double-tap cancel; double-tap delete | first: panel open, nothing discarded, delete disabled 1 s; second: one POST, one audit |
| C5 | Selesai confirm; separately an auto-stop | no cancel in `ended` / `ended_auto`; "Belum, lanjut" changes nothing |
| C6 | Open the cancel panel 10 s before the auto-stop | panel closes at the auto-stop, `ended_auto`, end `auto_stop`, no discard |
| C7 | API: discard, then PUT a segment with that `X-Session-Id` | 200 `discarded: true`, no transcribe, no segment doc |
| C8 | API: threads/questions seeded from the session, one straddling the start | all deleted incl. the straddling thread; others untouched; audit counts updated |
| E1 | 22:00 outlet: Mulai d 10:00, Selesai 22:15 | disabled; `debrief_running` note to 23:15, then `day_ended` note "… d+1 01:00"; no opening banner; enabled at 01:00 with no reload |
| E2 | After E1, reload d 23:00 | same disabled view from the server config; debrief resumes with 15 min left; tapping Mulai starts nothing (no mic prompt, no POST) |
| E3 | After E1, reload d+1 00:30 | still disabled; enabled at 01:00 |
| E4 | Test outlet, session from d 10:00, no Selesai | = D1 |
| E5 | Session from d 10:00, Selesai d+1 01:10 | disabled, note 02:10, enabled 02:10 |
| E6 | Session from d 10:00, reload d+1 00:40, not resumed | Lanjutkan and Selesai shown, no Mulai; closed `auto_stop` at 02:00, debrief to 03:00, Mulai at 03:00 |
| E7 | Mulai d 10:00, cancel | Mulai disabled until d+1 01:00 though the window is open; no opening banner; the cancel confirm showed that time |
| E8 | Seed d+1 = `null`, Selesai d (repeat with auto_stop and cancel) | through closed d+1 the headline keeps the ended state ("Ended" / "Ended automatically at HH:MM" / "Session cancelled"), never "Not started", with the `day_ended` note "… d+2 01:00" (UX-03 §5.2 wins, Rangga 7 Oct); enabled d+2 01:00 |
| E9 | After E1, clear localStorage (token re-paired by script), reload d 23:00 | still disabled (server `last_ended` incl. debrief end) |
| E10 | Disabled Mulai + each note at 360 px | no overflow; readable; visibly disabled; button keeps size and place |
| S1 | Fake now d 01:00, Mulai | enabled at 01:00:00, `local_date` d; no Selesai at 04:59:30 (note 05:00); Selesai at 05:00 with no reload; auto-stop d+1 02:00 |
| S2 | Mulai d 21:00:00 | session created; no Selesai at d+1 00:59; at 01:00 Selesai and the closing banner together; another day at 21:00:30 with no session → `window_passed` |
| S3 | Mulai d 10:00, Selesai confirm 14:00 | `ended`; debrief 14:00-15:00; Mulai disabled with "… d+1 01:00"; no second session on d; d shown on |
| S4 | Cancel at 13:00; at 15:00 with Selesai shown; after opening and dismissing the Selesai confirm; Wednesday's at Thu 01:30; after "Ya, selesai"; after the auto-stop | first four: offered and works; while the Selesai confirm is open cancel is hidden; last two: no cancel, forced `DISCARD` no-op, POST 409 |
| S5 | d off; d cancelled 10:05; fresh device; d a closed weekday | d+1 00:59 disabled with note 01:00; 01:00 enabled with no reload in all four; `local_date` d+1 |
| S6 | Selesai d 23:30; Selesai d+1 00:40; the same with no questions and nothing answered | first: enabled 01:00; second and third: disabled at 01:00 (`debrief_running` to 01:40), enabled 01:40, entry available until 01:40 |
| S7 | Session from d 10:00 running at d+1 01:00 | Mulai not rendered 01:00-02:00; Lanjutkan / Selesai / cancel as usual |
| S8 | API: debrief 01:10-02:10, 3 picked (1 answered), 4 open unpicked (one older), one created 02:20 | at 02:10 the 2 unanswered picked and all 4 unpicked `unverified`; answered untouched; the 02:20 one stays open; an answer at 02:05 uploaded 02:30 replaces `unverified`; no expired question becomes a fact |
| S9 | Seed d+1 = `null`; fake now 01:00, 10:00, 20:00; dev controls on | disabled all day with the closed note; no override in UI or DevPanel or API; d+1 `closed`; a start POST dated d+1 → 200 + `capture.session_start_outside_window`, still `closed` |
| S10 | Answer 2 questions, offline, online | both upload with only the device token, leave the cache, stored with `answered_device_id` + timestamps only; API: another outlet → 404, after the debrief end → 400, `staff_id` in the body → 400, another device's question → 404, staff/supervisor token → 403 |
| S11 | Session from d 10:00; page closed d 23:00; reopened d+1 02:20 | closes `lost`; debrief 02:00-03:00 shows with 40 min left; Mulai disabled to 03:00, then enabled; reopened at 03:10 instead → offered at once |
| S12 | Open the Selesai confirm; another day the cancel confirm | both say it cannot be undone and show the reopen time; nothing reopens the day afterwards |
| MD1 | A: Selesai d+1 00:40; B: no session on d | at 01:00 A disabled (to 01:40), B enabled; B's Mulai → `local_date` d+1; A's debrief unchanged; A enabled at 01:40 |
| MD2 | A Selesai d 22:00, B Selesai d 23:30 | at 23:00 only A's open questions `unverified`; B's listed until 00:30, then expire |
| MD3 | (next MVP, with the merge) A and B both hold a RESTOCK fact for one 15:00 talk; A one more at 18:00 | `fact_threads(d)` 2, not 3; the duplicate question counts once and as answered; both answers in R-08's input; pass/fail unchanged |
| MD4 | Any question on A | two-part SOP-implementation template, no person or role; Ya / Tidak + required reason; no Bukan ini, no chips; stored with `answered_device_id`, no `answered_by`; supervisor sees "a staff member answered", no device id |
| A1 | No choice; Ya with an empty or whitespace reason; same with Tidak | Lanjut disabled; nothing cached; API `reason_empty` / `invalid_body` (no or "maybe" answer); question stays open, `unverified` after the end |
| A2 | Paste 600 characters; API 501 and exactly 500 (with an emoji) | the field keeps the text, the counter shows over-limit, Lanjut disabled, nothing cached; API 501 → 400 `reason_too_long`, 500 → 200 stored |
| A3 | Fictional staff name "Dina" seeded; answer Ya + "Dina lupa, nomor pelanggan 0812 3456 7890" | stored reason has `[STAFF]` and the SDP placeholder; neither in any log, trace or error body; supervisor sees "a staff member answered Yes" + reason beside the thread, no device id; owner sees no reason |
| A4 | SDP mocked to fail | 503 `redaction_unavailable`; nothing written; entry kept and retried in 60 s; uploads once SDP works |
| A5 | Selesai d 22:00, everything answered by 22:10 | done screen; Mulai disabled to 23:00 with no change at 22:10 |
| A6 | Supervisor or owner token on the answer route | 403, nothing written; thread confirm/override still works |
| A7 | Lewati on question 2 after choosing Ya and typing | nothing cached or sent; reopening inside the hour shows it again with no choice and an empty reason; unanswered → `unverified` |
| A8 | Low-confidence CUSTOMER_SERVICE thread, 2 evidence lines; Ya + any reason | question answered `yes`; gate `staff_confirmed`, fact, `gate_version: "2"`; thread confirmed; an opposite reason gives an identical gate input |
| A9 | Same; Tidak + reason | question answered `no` (closed, not re-listed, never `unverified`); gate `staff_rejected`, question verdict; thread excluded, `label_source: "model"`, no confirmed category; no new question; supervisor sees "Rejected by staff" + reason |
| P2a | P2: offline 2 min | headline Listening; retrying line; `network_offline` gap opens and closes on reconnect (dev panel + a supervisor/dev script) |
| P2b | P2: reload mid-session; simulate stall; dev-ops revokes the demo device token | recovered `unrecorded` gap; `stalled` banner + gap; line row 1 with the supervisor hint from 3x, never succeeded, headline unchanged |
| P3a | P3: offline 10+ min with a 2-min dev cap; reconnect | `queue_full` gap, headline stays green; each accepted segment arrives once, in order |
| P3b | P3: close the tab offline, reopen online; DevTools; purge a back-dated record | backlog uploads with no session (line uploading → succeeded); the `audio` store has no readable WebM header (`1A 45 DF A3`); `expired_unsent` |

P5 is tested at API level against demo seed fixtures (sufficient and insufficient). Mandatory before go-live: M1-M6,
W1-W4, D1-D4, K1-K2, C1-C8, E1-E10, S1-S12, MD1, MD2, MD4; A1-A9 before R-07 is called ready.

**Real-phone items (Rangga + Tiffany, shop phone or an identical Android, test outlet; results feed the Sun 11
sign-off; items 2 and 5-8 matter mostly for P3, OFF on the pilot).**
1. Mulai after a cold page load starts audio on the tap.
2. Incoming call mid-session → `mic_interrupted` or `mic_lost` gap and recovery; record what Android fires.
3. Screen off / wake lock lost / app switched 5 min → capture continues, or an `unrecorded` gap matching the gap.
4. Reboot mid-session → interrupted view on reopen, gap from the last beacon to Lanjutkan.
5. Battery to 0 (or low + unplugged) → `battery_empty` on recovery if the API reports it.
6. Airplane mode 30 min during speech → the queue holds (P3), uploads in order after.
7. `navigator.storage.persist()` result on this phone.
8. Android backup of Chrome site storage (expected excluded): dev-ops/QA check against Android docs.
9. External mic unplugged → built-in within 3 s.
10. A full shop day, Mulai before prep and Selesai after close → coverage ≥ 90% of planned hours.
11. M1-M6, W2, D1 and D2 on real time, one night past 03:00.
12. C1 and C4 at real size: no accidental discard.
13. Selesai at 01:10 → note 02:10; reload around 01:40 → still disabled, debrief resumes; screen on → enabled at
    02:10 within 30 s with no reload; separately one cancel during the day → Mulai disabled for the rest of that day.
14. S1 (one real 4-hour wait), S4 and S6 on real time.

**Routing.** developer (sonnet): calendar, reducer, page rewrite, session split, upload status + engine
`blocked`; Cancel-A phone side and the segment-route transaction; the Mulai window/eligibility phone side;
R-07 (security-reviewer on the answer route); Cancel-B (touches the tick and its lock); P2 tracker, recovery,
watchdog, outbox; P3 vault and engine refactor; P5 sufficiency. developer-junior (haiku), after the schema is
merged (or developer in the same PR): session routes, service, store, schema and seed; the discard route,
tombstone, segment delete and audit; the eligibility server side (`last_ended`, weekly-hours validation, config
field, end/discard writes, start audits); the P2 gaps route and store; P4 retention (with dev-ops for the TTL
policy); P5 routes and store. Gates per phase: tech-lead review + independent QA in the browser; real-phone items
by Rangga / Tiffany.

### R-05b Label call · 3 h · done in Sprint 1 (v5)
- **Steps:** label prompt + JSON schema generated from `config/categories.yaml` (T-301) · Flash-Lite call with structured output: `reply_to` per line, category enum, fields, confidence, evidence line indices, runner-up + why not, `non_work_lines` (T-304) · private lines deleted after labelling, only counted · Cloud Scheduler every 2 min → `POST /api/internal/pipeline/tick` (OIDC), one device at a time under a lease, oldest-first · (v5: no reprocessing step; labels are live from the single go-live on Mon 12).
- **Depends on:** R-05a, Tiffany's category examples (Sun 4).
- **Done when:** the hypothetical trap ("kalau nanti … habis") is labelled TRAINING on 5/5 runs; outputs pass zod; failures become questions, not facts.

### R-06 Day record screen · 3 h · Tue 6
- **Steps:** timeline of threads with category, summary, confidence, fact/question status · supervisor sees quoted (redacted) evidence lines; owner sees summaries only · filter by category · Bahasa/English label toggle (T-401a).
- **Depends on:** R-05b.
- **Done when:** a 14-hour day loads in < 2 s on a phone; the owner view contains no quoted lines.

### R-07 Tap debrief · ~4.75 h · Wed 7 (+1 h for `staff_confirmed`, Rangga 2 Oct; −0.5 h no PIN screen, 4 Oct device model; +1 h debrief clock and cache; +0.25 h *Ya* / *Tidak*, 4 Oct MVP 1; plan.md §5 is authoritative for hours)
- **Steps:** after staff tap **Selesai** (confirmed) or the hard auto-stop fires (60 min after
  closing), `/capture` shows an enabled debrief entry button (no `after_closing` clock phase; v5,
  technical spec §8.10) · **no sign-in (MVP 1 device model, 4 Oct):** the debrief opens directly on the paired
  device, authenticated by its device token; the name + PIN step is post-MVP 1 and
  `POST /api/v1/auth/pin` returns 404 in MVP 1 · top ≤ 5 of **this device's** open questions
  (`question.device_id === claims.device_id`), incidents first then oldest-first, one per screen: the
  role-agnostic SOP-implementation question in two parts (4 Oct, MVP 1; wording a tech-lead default):
  headline "Sekitar pukul HH:MM ada <langkah>. Benar?" → ***Ya* / *Tidak*** (nothing preselected) + a
  **required reason** (prompt after *Ya*: "Sudah sesuai SOP? Kalau belum, kenapa?"; after *Tidak*: "Kenapa
  tidak?"), a text field with **no `maxLength`** and a visible counter that counts what the server counts
  (code points of the trimmed reason), *Lanjut* disabled until a choice is made and the trimmed reason is
  non-empty, and disabled again over 500 (text kept as typed, nothing cached), no auto-advance, *Lewati* skip (sends nothing) · no *Bukan ini*, no
  reason chips; category-revising free text is post-MVP 1 · server: strict body `{ question_id,
  debrief_business_date, answer: "yes" | "no", reason, answered_at_ms }`, other `answer` → 400
  `invalid_body`; empty/whitespace-only reason → 400 `reason_empty`; > 500 characters → 400
  `reason_too_long` (refused, never truncated); plain-string staff-name scrub (`staff` names →
  `[STAFF]`) and then Sensitive Data Protection on the reason before any write or log; redaction failure →
  503, nothing stored, the phone retries · new plain-code gate rule `staff_confirmed` (input shape approved
  2 Oct, unchanged): a YES on a question with a thread passes `chosen_category` = the thread's model
  category; a NO passes `null` → `staff_rejected` (checked first; thread not confirmed,
  `excluded_from_evidence: true`; question closed as rejected, `status: "answered"`, `answer: "no"`; no new
  question); the reason is never read to decide a category, a verdict or a gate input; `staff_confirmed` waives only
  `label_conflict`/`always_question`/`below_threshold`; `invalid_label`/`needs_supervisor_confirm`/
  `no_evidence`/expiry still apply; logged with the fired rule, `gate_version: "2"`; the no-answer path
  is unchanged · answer route is device-only: supervisor/owner → 403 (supervisors confirm or override on
  the thread side) · a fully answered debrief does not release Mulai early (1-hour timeout always) ·
  answer upserted idempotently by `question_id` ·
  stored with the answering device id and timestamps only (4 Oct, late: no `answered_by` role), no
  `staff_id`, no name; the device id is never returned to supervisor/owner screens · each device's open
  questions expire at its own debrief end · the heartbeat carries `answers_pending` /
  `answers_pending_oldest_date` while the answer cache is non-empty (web spec §6.6.2; technical spec §8.15) · the answer
  cache keeps an entry until the server confirms it, and at most 14 days (technical spec §8.10–§8.11) ·
  COMPLAINT/CORRECTION/incident answers wait for supervisor confirmation · done screen, no recap · derived
  mode label ("room" / "wearable" from the active paired-device count; display only, never read by a rule)
  in the DevPanel and on the day record.
- **Depends on:** R-02 (device token), R-05b, R-06 (for the supervisor "answered" view).
- Design detail, gate-rule spec (§4b) and cut items: `docs/tasks/R-07-ux-notes.md`.
- **Separate, cuttable backlog candidate (not in R-07):** "after-close attention ping" (vibrate +
  local audio cue on the Selesai / auto-stop transition), ~0.5h, needs verification on the real shop
  phone.
- **Done when:** a staff member gives 5 typed answers (*Ya* / *Tidak* + reason) on a paired device in
  about 5 minutes with no sign-in (Rangga confirmed, 4 Oct); an answer without a choice or with an empty or
  whitespace-only reason cannot be submitted and the API refuses it (400); a 501-character reason is refused
  (400) and nothing is stored, while 500 is accepted; *Lewati* leaves the question open and it expires as
  unverified at the debrief end; a *Tidak* on a thread question leaves the thread `excluded_from_evidence`
  and unconfirmed, logged as `staff_rejected`, and closes the question as rejected without creating a new
  one; a typed phone
  number is stored as the Sensitive Data Protection placeholder, and a redaction failure stores nothing
  (503) and the phone retries; a supervisor token on the answer route gets 403; with every question
  answered, Mulai stays disabled until the debrief's 1-hour timeout; the
  supervisor sees "a staff member answered" (no name, no device id); a second paired device of the same
  outlet sees only its own questions and gets 404 on the first device's; each device's unanswered questions
  expire at its own debrief end, not the other's; every question shows the two-part SOP-implementation template and
  no stored answer has an `answered_by` field; `POST /api/v1/auth/pin` returns
  404; the mode label reads "room" with one paired device and "wearable" with two, and no session or
  debrief behaviour differs between them; a low-confidence non-sensitive thread confirmed by staff becomes a fact logged as
  `staff_confirmed` after a *Ya* (the gate input is the thread's model category, whatever the reason says), while a staff answer on COMPLAINT/incident stays a supervisor question; a typed
  staff name is stored as `[STAFF]`; within 2 s after Selesai (or the hard auto-stop), `/capture` shows the debrief prompt with an enabled
  start button (unit test on the Selesai and auto-stop transitions incl. a past-midnight auto-stop + one on-device
  check).

**Separate, smaller item (copy only, ships with or after capture phase plan P1):** a context line under the mic-source
label and the `/pair` post-success line + button. The old "Staff (opens automatically at closing)" label and the
"starts automatically at the next opening" stopgap are dropped: capture is manual (technical spec §8.3). Full list in
`docs/tasks/R-07-ux-notes.md` §6.

### R-08 ProposalAgent · 11.5 h · Thu 8 – Fri 9 (revised 10 Oct: v2, 3.0 h added: owner+supervisor generate 0.55h, constraint provenance 0.1h, constraint-aware reuse 0.1h, SOP separation tests 0.25h, manual constraints via text field 2.0h)
- **Steps:** ADK (TypeScript) agent inside `web` on Gemini 3.5 Flash · picks one intervention from the library · cites ≥ 1 rubric criterion + ≥ 2 dated evidence items (thread IDs) · states metric, failure condition, review date, and that unmet demand is a censored floor · reads all stored constraints · too little evidence → no proposal + a follow-up note + logged suppression (T-503, T-504) · a "Generate proposal" button for both owner and supervisor (v2, not supervisor-only) · supervisors can add a manual constraint text independently of rejecting a proposal.
- **Depends on:** R-06 data, Tiffany's SOP v1 spec + rubric + library (Wed 7).
- **Fallback if ADK blocks > 2 h:** a plain state machine calling Gemini (already agreed).
- **Done when:** a seeded case with 1 evidence item produces no proposal and a logged reason; the first real proposal on Thu 15 (fallback Fri 16) cites ≥ 2 dated evidence items on ≥ 2 dates.
- **RBAC note (v2):** owner gains `proposals:generate` and `constraints:read`; supervisor gains `constraints:read` and `constraints:write` (for manual constraints) (planned, R-08 v2, not yet built).

### R-09 Approval screens · 4 h · Fri 9 – Sat 10
- **Steps:** supervisor *Feasible* / *Reject* (reason required) → rejection reason saved as a permanent outlet constraint via `createConstraint` (already built by R-08 for manual constraints) (T-506, T-507) · owner *Approve* / *Reject* (reason required), shown only after the supervisor says feasible · everything written to `audit_log`.
- **Depends on:** R-08 (inherits `createConstraint` write path and constraint schema). R-08 v2 lists 9 requirements R-09 must pick up: reuse schema without redesign, same page, approval sequence unchanged, owner view via summaries, freshness check on Feasible/Approve, constraints from rejections via `createConstraint`, new constraint after generation notice, owner Reject reason handling (not yet decided), known limit on outlets with no supervisor (R-08.md §9 "For R-09", items 1-9).
- **Done when:** after a rejection like "the oven only holds 2.5 kg", the revised proposal respects it; nothing ships without both approvals.

### R-10 SOP versions + before/after list · 1 h · Sat 10 (diff view cut 4 Oct, `docs/plan.md` §10 #51)
- **Steps:** immutable `sop_versions`; v2 = v1 + approved change; a **plain before/after list** (the changed step as it was in v1, then as it is in v2; no added / changed / removed diff view) with metric, failure condition and review date (T-508).
- **Depends on:** R-09.
- **Done when:** SOP v2 exists (ships Thu 15 if approved) with a review date after submission (Wed 21 Oct); the pipeline reads v2 from the next morning.
- **Cut applied (4 Oct):** the diff view is out of MVP 1; the plain before/after list is the build.

### R-15 CriticAgent · 3 h · next MVP (post-MVP 1; Rangga, 4 Oct, `docs/plan.md` §8a)
- **Status (4 Oct):** not in MVP 1 hours, not built before submission. In MVP 1, R-08's own evidence gate blocks weak proposals. Steps kept for the next MVP.
- **Steps:** ADK agent that calls the evidence gate as a tool (`check_evidence(proposal)`); only passing proposals reach the supervisor; block reason shown (T-505).
- **Depends on:** R-08, R-05a gate.
- **Done when:** a seeded weak proposal (1 evidence item) is blocked with its reason.

### R-16 Voice debrief · 6 h · "if time" (v5)
- **Steps:** Live API, one shared session per debrief (on the device, inside its 1-hour debrief window, technical spec §8.10–§8.11), agent speaks first in Bahasa, ≤ 5 questions, ≤ 4 min · same question queue as R-07 (answers keyed by `question_id`) · answer text stored, audio not (T-403).
- **Depends on:** R-07, probe result for the Live model.
- **Done when:** a dropped session continues in tap mode with no double-counted answers.
- **Status (v5):** "if time" (plan §8); the tap debrief (R-07) is the working path.

## 4. Sprint 3 — close the loop, demo outlet, submit (Mon 12 – Fri 16 Oct)

### R-11 ReviewAgent · 4 h · Tue 13
- **Steps:** Cloud Scheduler job on SOP v2's review date (pilot: Wed 21 Oct 09:00 WIB, after submission) → review route → compare the metric before (Mon 12 – Wed 14, under v1) and after (from SOP v2's ship date to the review date) → propose *worked / revise / revert* → supervisor + owner confirm → `outcomes` (T-509, T-510) · the same route is what the demo's "fast-forward" calls (the only place the closed loop is shown before submission).
- **Depends on:** R-10.
- **Done when:** the job fires without anyone pressing anything; an unconfirmed outcome is stored as "unknown" and kept out of memory.

### R-12 Demo outlet · 4 h · Wed 14
- **Steps:** seed the demo project by sending Tiffany's clips through the real segment API · landing page with "Try as Owner / Supervisor / Staff" (2 h sessions; "Staff" = a demo paired-device session, no staff sign-in in MVP 1, `docs/specs/web-backend-rbac.md` §3) · per-IP rate limits + daily token cap · "fast-forward to review date" labelled *simulated time* (T-701, T-708).
- **Depends on:** R-11, Tiffany's clips.
- **Done when:** someone outside the team completes the judge path in a fresh browser on phone and laptop in ≤ 4 min.

### R-13 Eval · 2 h · Thu 15
- **Steps:** script reads the gold-set Google Sheet → confusion matrix, per-category precision/recall, macro-F1 · Transcribe quality on 20 human-checked clips (T-804, T-207).
- **Depends on:** Tiffany's 60+ labelled episodes (Wed 14, from Mon 12 – Tue 13).
- **Done when:** numbers reproduce from a pinned snapshot of the sheet; sample size stated.

### R-14 Release · 3 h · Thu 15 – Fri 16
- **Steps:** README (setup, architecture, model/region table from `regions.yaml`, known gaps incl. DPIA next, Transcribe preview, manual consent revocation, consent collected outside the app (contract + emailed notice, no in-app consent or revoked-consent state; 4 Oct), credits line) · tag v1.0 · uptime check for 19 Oct – 6 Nov · incognito test of link, repo, video, deck (T-814 – T-818).
- **Done when:** every submission link opens without login in a private window.

## 5. Tiffany's backlog

| ID | Task | By | Feeds |
|---|---|---|---|
| T-901 | *(4 Oct)* Consent by the bee6–Proofed paper contract + consent, updated privacy policy and TnC emailed to all users (was: Bahasa consent form + signatures); counter signage, staff briefing. No in-app consent step | Thu 1 (contract/emails: before go-live, Q29, technical spec §8.19) | Go-live |
| T-205 | Custom vocabulary (≤ 100 terms) | Sat 3 | R-04 |
| T-702 | 5 Bahasa demo clips (fictional outlet) | Sat 3 | R-03/R-04 tests, R-12 |
| T-301 | `categories.yaml` example pairs | Sun 4 | R-05b |
| — | Weekday problem: ask daily; 2–3 candidates; picked in the evening | Wed 14 | R-08 focus |
| T-501 | SOP v1 spec (private, never in the repo) | Wed 7 | R-08 |
| T-502 | Rubric + intervention library | Wed 7 | R-08 |
| — | Internal testing with Rangga (test outlet, pilot project) | Tue 6 – Sun 11 | Sign-off |
| — | Supervisors: day record walk-through, debrief after Selesai, honest proposal review | Mon 12 – Thu 15 | Loop |
| T-803 | B-roll (no customer faces, no SOP document on screen) | Sun 11 | Video |
| T-806 | Video script draft | Sun 11 | Video |
| T-802 | Gold set: 60+ episodes labelled in the Google Sheet (10 labelled by both supervisors), from Mon 12 – Tue 13 | Wed 14 | R-13 |
| T-807 | Screen recordings | Wed 14 – Thu 15 | Video |
| T-812/813 | Video (< 3 min, English captions) and deck (PDF) final | Fri 16, midday | Submission |
| T-818 | Submit on Hack2skill; save the confirmation | Fri 16 | — |

## 6. "If time" tasks (P1, in order)
| Task | Est | Spec |
|---|---|---|
| R-16 Voice debrief (moved here in v5) | 6 h | the pipeline spec T-403 |
| capture phase plan P2: gap ledger, outbox, liveness beacon, gaps API (depends on P1; tests §3a) | ~4.5 h | `docs/specs/technical-specification.md` §8.13; `docs/specs/web-backend-rbac.md` §6.6.7 |
| capture phase plan P3: encrypted on-device audio queue (AES-GCM; cap 4 h of audio or 64 MB, undelivered audio removed after 24 h; depends on P2; OFF on the pilot until Rangga's explicit written sign-off; tests §3a) | ~6 h | `docs/specs/technical-specification.md` §8.14 |
| Cost-per-day tile (token/audio logs → owner home) | 3 h | the web spec §4.4 |
| "Re-run this clip live" in the demo outlet | 2 h | the web spec §4.5 |
| POS CSV import (SalesEvent) | 4 h | the pipeline spec T-601 |
| Team and device settings screens | 4 h | the web spec §4.3 |
| Guided tour in the demo outlet | 2 h | the web spec §4.5 |

## 6a. Next MVP (post-MVP 1; not in MVP 1 hours)
| Task | Est | Spec |
|---|---|---|
| R-15 CriticAgent (moved 4 Oct) | 3 h | §3 R-15; the pipeline spec T-505 |
| capture phase plan P5 cross-device merge, `mergeDevices` (moved 4 Oct). Tests: A~B overlapping same-category same-date facts → 1 observation with both ids; 61 s apart → 2; one device's two overlapping facts → 2; different category → 2; different dates → 2; A~B, B~C, A≁C → 1; a duplicate question counts once and as answered when either answered; conflicting answers both kept; one device → identity; `in_progress(d)` while B's debrief runs; 200 random fixtures: every rule's pass/fail identical with and without the merge; browser row MD3 (§3a) | 0.5 h | `docs/specs/technical-specification.md` §8.15 |

## 7. Removed from earlier plans (for the record)
Android app tasks (T-101 – T-110 Android versions) · Flash-Lite first-pass transcription and escalation (T-203) · Flex tier (T-208) · separate `ingest` / `pipeline` / `agents` services · separate playground website · gold-set labelling screen (→ Google Sheet) · 4-person team assumption. History: `docs/adr/ADR-001-lean-gemini-architecture.md`.

## 8. Definition of done (every task)
- [ ] Merged to `main` via PR that Rangga reviewed; lint, type-check and tests green; deployed to Cloud Run in asia-southeast2
- [ ] "Done when" checks pass on the live URL
- [ ] No non-Google AI calls, no secrets, no audio stored or logged, no real Proofed data in the repo
- [ ] Every new API route checks role + outlet on the server
- [ ] `docs/tasks/R-xx.md` updated with the result and anything left for later

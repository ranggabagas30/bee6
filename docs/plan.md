# SOP Improvement Agent — Sprint Plan (v6, 4 Oct 2026)

**Sources of truth:** `docs/plan.md` for sprints; `docs/specs/technical-specification.md` (§8) for
capture and session rules; `docs/specs/web-backend-rbac.md` (§6.6) for routes and data;
`docs/tasks/UX-03-journey-design.md` for screens and copy.

**Precedence (Rangga, 4 Oct):** `CLAUDE.md` → this plan → `docs/backlog.md` → everything else. Within dated
notes, the newest wins. This file was regenerated on 4 Oct from the session-model plan and the newest decisions
in `docs/HANDOFF.md`; the stacked revision notes of v5 are folded in and listed only as history in §11. Where
this plan restates a session rule, `docs/specs/technical-specification.md` §8 wins; open points are in §10 and
in technical spec §8.19.

**This is the current plan.** It says *what gets built, by whom, and when*.
- Session model, staff journey, debrief contract, cancel, upload status rules:
  `docs/specs/technical-specification.md` §8 (§8.3 is the single source for every session rule).
- Step-by-step detail per task: `docs/backlog.md`.
- What each part does: `docs/specs/web-backend-rbac.md` and `docs/specs/pipeline-and-agents.md`.
- R-07 screen design: `docs/tasks/R-07-ux-notes.md` (follows technical spec §8.10–§8.11).
- Rules for the coding agent: `CLAUDE.md`.

**Shop hours in this file.** The pilot's real hours live only in the private seed, never in the repo. The
pilot is written as `<OPEN>`-`<CLOSE>`. Worked examples use a fictional outlet whose close is 01:00 (the
latest close the product allows, so the midnight cases are covered).

## 1. Ground rules

| Rule | Value |
|---|---|
| Team | **Rangga**: all technical work, product ideas, roadmap and sprints. **Tiffany**: prompts and category guide, Proofed coordination, consent (the bee6–Proofed paper contract and the emailed consent, privacy policy and TnC), labelling, demo clips, design, deck, video |
| Rangga's time | **4 h on weekdays, 8 h on weekends**, Wed 30 Sep – Fri 16 Oct ≈ **84 h** (Sat 17 – Sun 18 is emergency buffer) |
| Planning style | **Conservative**: AI coding help is a bonus and isn't counted |
| Dev tool | **Claude Code** (the rules don't restrict dev tools). **The product uses only Google Cloud + Google AI.** README says "Built with Claude Code. Runs entirely on Google Cloud and Gemini." |
| Architecture | One web app (Next.js, TypeScript) on **one Cloud Run service** in Jakarta · Gemini 3.5 Transcribe for all speech · Flash-Lite labels · ADK agents on Gemini 3.5 Flash · tap debrief (voice debrief "if time") |
| Sign-in | Owner and supervisor: Google sign-in. Staff: **no sign-in in MVP 1**; staff only pair a device, and the system tracks the device id only (technical spec §8.3, `docs/specs/web-backend-rbac.md` §2a) |
| Consent | **Not collected in the app.** Covered by the bee6–Proofed paper contract; bee6 emails the consent, privacy policy and TnC to all users. No consent gate, no consent flag, no revoked-consent state in the app. Revocation is manual (technical spec §8.16) |
| Go-live at Proofed | **Mon 12 Oct**, only after Rangga's formal written sign-off on Sun 11 (§5c) |
| Submission | **Fri 16 Oct** (platform deadline Sun 18) |
| Pilot review | **Wed 21 Oct** (proposed 09:00), after submission |
| Demo story | A **weekday problem**, picked **Wed 14 Oct** evening from Mon 12 – Wed 14 |
| Load target | Planned work ≤ ~80% of 84 h; actual load is **96% (80.75 h)** after Rangga's 4 Oct cuts (P5 cross-device merge and R-15 CriticAgent to the next MVP, R-10 diff → plain before/after list), 3.25 h under capacity (§7, §10 #51) |

## 2. What we simplified to fit one part-time builder

- **One Cloud Run service** (`web` = screens + API + pipeline + agents).
- **Users, staff names and paired devices are set up by a seed script**, not settings screens. Staff PINs
  were built in R-02 and stay **dormant** (no staff sign-in in MVP 1; the PIN route returns 404).
- **Tap debrief** (R-07) is the working path; **voice debrief** (R-16) is "if time".
- **Gold set** = Tiffany labels episodes in a Google Sheet; the eval script reads it.
- **In-memory upload queue** on the phone (about 10 min of offline speech). The encrypted on-device queue is
  capture phase plan P3, "if time", and stays **OFF on the pilot** until Rangga's explicit formal sign-off for P3.

**Cut for this window:** photo and reminder lanes · second mic · event cards · Flex tier · building the
Flash-Lite cheaper path (slide only, labelled as modelled) · DPIA (next priority after submission).

## 3. Calendar

| Date | Milestone |
|---|---|
| Wed 30 Sep – Sun 4 Oct | **Sprint 1: capture + transcription core** (R-01 – R-05b done) |
| Sun 4 Oct | Status-truth fix round merged · capture phase plan P1 build (in flight on `feat/prod-01-p1`) |
| **Mon 5 Oct** | P1 finished and gated (tech-lead + QA) · **pilot project deployed** (dev-ops) with a **test outlet**: revision A (pre-P1, capture-only fallback) and revision B (P1) at 100% |
| Tue 6 Oct | R-06 day record · capture phase plan P4 (14-day text retention + TTL) |
| **Tue 6 – Sun 11 Oct** | **Internal testing window** (Rangga + Tiffany, §5b) on the pilot deploy, test outlet only. Nothing counts as pilot evidence |
| Wed 7 Oct | R-07 tap debrief · Tiffany: SOP v1 spec (private), rubric + intervention library |
| Thu 8 – Sat 10 Oct | R-08 ProposalAgent · R-09 approvals · R-10 SOP versions (plain before/after list) |
| **Sun 11 Oct** | capture phase plan P5 (insight runs + sufficiency) · **Cancel-B** (must merge before sign-off) · **18:00 Rangga's formal go-live sign-off** (§5c) · then dev-ops switch-over and Tiffany's staff briefing |
| **Mon 12 Oct** | **Pilot go-live** (§6, go-live steps) |
| Mon 12 – Wed 14 | Weekdays under SOP v1 (the only real "before" window) |
| **Wed 14 Oct**, evening | **Weekday problem picked** |
| **Thu 15 Oct** | **First real insight run** over Mon 12 – Wed 14 → supervisor → owner → **SOP v2 ships** (review date after submission) |
| **Fri 16 Oct** | Fallback run over Mon 12 – Thu 15 only if Thu 15's run was insufficient · freeze, tag v1.0 · **Submit** |
| Sat 17 – Sun 18 | Buffer (platform deadline Sun 18) |
| **Wed 21 Oct** | **Pilot review** of SOP v2 (proposed 09:00) → outcome memory. Not in the video |

**Latest go-live that still allows a real proposal before submission: Tue 13** (Tue 13 – Thu 15 = 3 days,
run Fri 16 morning). Later than that, the submission shows the demo outlet plus whatever real evidence
exists, but no real proposal.

**Honesty note for the video and deck:** "before" is 3 weekdays under v1 (Mon 12 – Wed 14). There is **no
"after" window on the pilot before submission**: SOP v2 ships Thu 15 at the earliest and is reviewed on Wed
21 Oct. On the pilot we show real evidence → real proposal → supervisor review → owner approval → SOP v2 with
a set review date. The review verdict and outcome memory are shown on the **demo outlet** with
"fast-forward to review date", labelled simulated. Never claim a pilot outcome we don't have.

## 4. Sprint 1: capture + transcription core (Wed 30 Sep – Sun 4 Oct)

**Goal:** the phone records through the web capture page, and every speech segment comes back as redacted,
timestamped text from Gemini 3.5 Transcribe. **Status:** R-01 – R-05b merged.
**Capacity:** 3 weekdays × 4 h + 2 weekend days × 8 h = **28 h**.

| Day | Rangga's work | Hours |
|---|---|---|
| Wed 30 | **R-01** GCP projects (pilot + demo), billing caps, region probe, public repo, Cloud Build → Cloud Run (Jakarta), Next.js skeleton | 4 |
| Thu 1 | **R-02** Firestore schema v0, Google sign-in with roles, device pairing, seed script (staff PINs built, dormant in MVP 1) | 4 |
| Fri 2 | R-02 finish (1 h) · **R-03** `/capture` page starts (3 h) | 4 |
| Sat 3 | **R-03** finish (5 h) · buffer 3 h | 5 |
| Sun 4 | Status-truth fix round merged (1 h) · **capture phase plan P1** part 1: calendar, session state, session routes, page rewrite (6 h) · Cancel-A part 1: reducer `DISCARD`, discard route + tombstone (1 h) | 8 |
| | **Planned 25 h of 28 (89%) · buffer 3 h** | |

**If behind on Sun:** P1 finishes Mon 5 and the pilot deploy moves to Tue 6. The internal testing window
shrinks by a day; go-live does not move.

## 5. Sprint 2: build the loop + internal testing (Mon 5 – Sun 11 Oct)

**Goal:** by Sun 11, every screen and agent the pilot needs (Mulai/Selesai capture, day record, tap debrief,
proposal, approvals, SOP versions, insight runs) is built and tested on the pilot deploy with a test
outlet. Rangga gives his formal go-live sign-off on Sun 11 at 18:00.
**Capacity:** 5 weekdays × 4 h + 2 weekend days × 8 h = **36 h**.

| Day | Rangga's work | Hours | On the pilot project |
|---|---|---|---|
| Mon 5 | **capture phase plan P1** finish: upload status line, hard auto-stop, 401/403 kept and retried, tab lock, DevPanel readouts, `weekly_hours` seed (1.5 h) · **Cancel-A** part 2: confirm panel, phone purge, segment session header + refusal + delete (1 h) · **Mulai window and eligibility** (technical spec §8.3, §8.5): window 01:00 to close − 4 h, Selesai from Mulai + 4 h, the per-device Mulai gate, disabled Mulai + notes, per-device `last_ended` (1.5 h) · P1 gate fixes (0.5 h) · **pilot deploy** with dev-ops: revision A then revision B, test outlet seeded with fictional hours (2 h) | 6.5 | Deployed, test outlet only |
| Tue 6 | **R-06** day record (supervisor full, owner summaries; shows "off / closed" days and "Sesi dibatalkan: N") (3 h) · **capture phase plan P4** 14-day text retention + TTL (1 h) · **Language toggle** (§10 #49, technical spec §8.17), shop-phone screens: root layout reads the `bee6_lang` cookie (TL-L1 option a), the typed `id`/`en` dictionary module, the top-bar `ID \| EN` switch, and the UX-03 §6 rev 5 copy sheet moved into the dictionary (2.5 h; before R-07 so its strings go straight into the dictionary). Supervisor and owner screen copy is written into the same dictionary inside R-06, R-09 and R-10 as each screen is built (no separate hours) | 6.5 | Internal testing starts |
| Wed 7 | **R-07** tap debrief, built to technical spec §8.10–§8.11 (screens: `docs/tasks/R-07-ux-notes.md`): debrief opens on Selesai or the auto-stop and lasts 1 h; resume after reload; every open question of this device expires as unverified at its end; ≤ 5 of this device's questions, one per screen; *Ya* / *Tidak* + a required reason (≤ 500 characters, refused not truncated, name-scrubbed + SDP-redacted), or *Lewati*; YES → `staff_confirmed`, NO → `staff_rejected`; device-only answer route; answer cache on the phone (until uploaded, at most 14 days) uploaded with the device token; `answers_pending` in the heartbeat; no sign-in, PIN route off; mode label; security-reviewer on the answer route; **replace the 7-day `expireQuestion` in `lib/pipeline/gate.ts` with the debrief-end expiry and late-answer rule (§10 #45)** | 4.75 | Internal testing |
| Thu 8 | **R-08** ProposalAgent (ADK, Gemini 3.5 Flash) (4 h) | 4 | Internal testing |
| Fri 9 | **R-08** finish (1 h) · **R-09** approval screens (3 h) | 4 | Internal testing |
| Sat 10 | **R-09** finish (1 h) · **R-10** SOP versions + plain before/after list (1 h; the diff view was cut 4 Oct, §10 #51) · internal testing with Tiffany: real-phone items, a full Mulai → Selesai → debrief loop (2 h) | 4 | Internal testing |
| Sun 11 | **capture phase plan P5** insight runs (idempotent per exact range, overlaps allowed) + plain-code sufficiency (4 h; the cross-device merge moved to the next MVP 4 Oct, §8a) · **Cancel-B**: discarded session's thread/question cleanup under the device lock + tick guard (1.5 h; must merge before the sign-off) · internal testing review + fixes (1.5 h) · **go-live sign-off** and switch-over with dev-ops (1 h) | 8 | Sign-off 18:00 |
| | **Planned 37.75 h of 36 (105%) · no buffer** (after the 4 Oct cuts, §7) | | |

**Overruns.** Mon 5 overrun → the pilot deploy moves to Tue 6, the testing window shrinks, go-live doesn't
move. Wed 7 overrun → the remainder moves to Thu 8 and R-08 finishes in Fri 9's spare hour. Cancel-A,
Cancel-B, the Mulai window and R-07's debrief clock and answer cache are pilot behaviour staff are briefed on,
so they are not on the cut list. Until Cancel-B merges, dev-ops removes a discarded session's threads and
questions by hand (internal testing window only; go-live needs Cancel-B, technical spec §8.9).

**If behind:** R-15 and the P5 cross-device merge are already moved to the next MVP and R-10 is already a
plain before/after list (4 Oct, §10 #51). P5 is the only Sprint 2 item left on the cut list (without it,
Thu 15's proposal runs through R-08's own button, without idempotency or the sufficiency check; say so if
shown). Sat 10 has 4 h free, which absorbs a Thu 8 – Fri 9 overrun before anything is cut.

### 5a. Go-live risks (Mon 12)
1. **Only 3 real days before the first run.** Thu 15's run over Mon 12 – Wed 14 needs all 3 days to qualify
   (`min_days` = 3). One bad day → Fri 16 fallback run over Mon 12 – Thu 15. Two bad days → no real proposal
   before submission.
2. **No pilot outcome before submission.** SOP v2's review is Wed 21 Oct. The closed loop is shown on the
   demo outlet only.
3. **Sign-off gate.** No sign-off by Sun 11 → go-live slips day by day; past Tue 13 there is no real proposal
   before submission.
4. **Trial start time.** First live Mulai is ~10:00 on Mon 12, not at opening. Planned time before it is not
   captured; the day still counts at ≥ 60% coverage.
5. **Staff readiness.** A forgotten Mulai means no capture, and that day is recorded as off, which looks the
   same as a real day off. The opening reminder is an on-screen banner only, no sound.
6. **Mulai cut-off.** Mulai is offered only until 4 h before closing; after that the day is off.
7. **Live deploys during service.** From the Sun 11 switch-over, pilot deploys run only after that night's
   debrief has ended (auto-stop + 1 h, at the latest 03:00) and before the next opening: never in the hour
   between closing and the auto-stop, never in the debrief hour, never "after the calendar day ends".
8. **Fallback revision A is capture-only** (pre-P1, auto-hours, predates R-06 – R-15).
9. **The pilot's real weekly hours must be in the private seed before Sun 11** (Q12, removed; rule in technical spec §8.2): the Mulai
   window, auto-stop and debrief are computed from them.
10. **Gold set is compressed.** 60+ labelled episodes by Wed 14 evening come only from Mon 12 – Tue 13.
11. **A mistaken cancel or an early Selesai ends that business day's capture**, with no undo (accepted for
    MVP 1). Both confirm screens show "Tidak bisa dikembalikan / This can't be undone" and the reopen time.
12. **In-memory queue only** (P3 OFF on the pilot): a reload or an outage longer than ~10 min of queued speech
    loses audio; the headline stays green and the upload line's lost line shows the drop (technical spec §8.8 headline rule).

### 5b. Internal testing window (Rangga + Tiffany, Tue 6 – Sun 11)
- **Where:** the pilot project's real deploy, on the shop phone or an identical Android, paired to a
  **separate test outlet** with fictional **past-midnight hours** (close 01:00, adjustable): Mulai window
  01:00-21:00, auto-stop 02:00, debrief until 03:00 at the latest.
- **Who speaks:** Rangga and Tiffany only; no Proofed staff or customers in range. Nothing counts as pilot
  evidence.
- **What:** backlog §3a real-phone items, Mulai/Selesai/auto-stop, the Mulai window edges, a no-Mulai day
  showing as off, cancel, the Mulai gate, the 1-hour debrief and answer cache, the loop day record → debrief
  → proposal → approvals on test data, and the mandatory midnight checks (backlog §3a rows M1-M6), with at
  least one run on real time past the 03:00 debrief end.
- **After:** on Sun 11 dev-ops deletes the test outlet's data, seeds the Proofed outlet with real hours
  (private config, never committed), and re-pairs the phone. Results go into Rangga's sign-off.

### 5c. Rangga's formal go-live sign-off (Sun 11, 18:00)
Proofed being "informed" is a verbal acknowledgement only, **not** sign-off. Live testing on the pilot starts
only after Rangga signs off in writing (dated, recorded in `docs/HANDOFF.md`). It covers: internal testing
results, the pilot seed's real hours, dev-ops' pilot checks, which privacy line the pilot page shows (the
approved line stays until the sign-off explicitly includes the final privacy line, technical spec §8.16, and never before P4), the
consent contract signed and the emails sent (Q18, removed; rule in technical spec §8.16; Q29 in technical spec §8.19), and **P3 OFF**
(`NEXT_PUBLIC_DEVICE_AUDIO_QUEUE=false`). P3 reaches the pilot only through a later, explicit sign-off.

### 5d. Pilot operating rules (plain terms)
Every rule below is technical spec §8.3 in plain words; the technical spec wins if they differ. All times are shop time,
and every rule runs **per device**. "D" is a business day.

- **Mulai window.** Mulai for D is offered from **01:00 on D until 4 h before D's closing**, never on a
  weekday marked closed (no override). Outside the window the button is greyed out with the next time.
- **The Mulai gate.** Inside the window Mulai is also held back while a session is open on that phone, once
  D has already ended on that phone (Selesai, auto-stop or cancel; one countable session per business day),
  and until that phone's previous-day debrief has reached its 1-hour timeout, unless the previous day was an
  off-day for it. The gate reads the clock only, never answers. One phone never holds back another.
- **Off-day.** No Mulai by the window end → the day is recorded as off / closed, with no gap alarm.
- **Selesai and auto-stop.** Capture starts only on Mulai. Selesai appears **4 h after Mulai** (always by
  closing) and needs a confirm. The only automatic stop is the hard auto-stop **60 min after closing** (at the
  latest 02:00). From closing time a "tap Selesai" banner shows, also after midnight.
- **Debrief.** Starts the moment Selesai is confirmed or the auto-stop fires and lasts **exactly 1 h**,
  answered or not; a reload never extends it; no debrief follows a cancel. Up to 5 of this phone's questions,
  one per screen: "Sekitar pukul HH:MM ada <langkah>. Benar?" → *Ya* / *Tidak* + a required reason (≤ 500
  characters), or *Lewati*. Every question of this phone still open at the end expires as unverified.
  Finishing early does not release Mulai sooner. Supervisors do not answer these questions.
- **Answers on the phone.** Saved on the phone first, uploaded by the phone with its device token, removed
  once confirmed and in any case after 14 days. No name, no staff id, no role is stored; supervisors see "a
  staff member answered", never who or which device.
- **Cancel ("Batalkan sesi").** Anyone at the shop can discard the open session until Selesai is confirmed
  or the auto-stop fires, with a two-step confirm. Its audio and text are deleted, it counts for nothing,
  only timestamps and a role-only audit entry remain. A cancel ends that business day for Mulai.
- **Business day.** A session belongs to the business day whose Mulai window it started in; everything
  inside it takes that date, including its closing hour after midnight. Anything outside every session is
  dated by the clock, with the day changing at 01:00.
- **Upload status (truthful UI, technical spec §8.8).** Two axes: the green "Mendengarkan / Listening" headline
  means capture is running, whatever the upload result, including `queue_full` (technical spec §8.8 headline rule,
  Rangga 4 Oct); a separate upload line shows
  "Mengunggah", "Gagal unggah, coba ulang (Nx)", "Gagal unggah, dilewati" or "Unggah berhasil". A 401/403 is
  kept and retried, never shown as success.
- **Consent revocation (manual, known gap).** No in-app revoke. Requests go to Rangga or Tiffany (email,
  contract, in person, or via the supervisor); acknowledgement and complete removal both within 7 working
  days; removal is by outlet and business-date range (technical spec §8.16).

### 5e. Phase dependencies, gates and tests (6 Oct)
| Phase | Depends on | Size | Gate before "done" |
|---|---|---|---|
| P1 (incl. Cancel-A, Mulai window and eligibility) | `feat/capture-live-state-truth` merged | ~11 h | backlog §3a P1 + Cancel-A unit tests; browser rows M1-M6, W1-W4, D1, D3, D4, C1-C7, E1-E10, S1-S7, S9, S11, S12, MD1; real-phone items 1, 3, 4, 9-14 |
| Cancel-B | P1 | 1.5 h | backlog §3a Cancel-B tests + row C8; merged before the Sun 11 sign-off |
| P4 | nothing | ~1.5 h + dev-ops TTL | backlog §3a P4 tests; TTL policy live in both projects; backfill run |
| R-07 debrief | P1, R-05b, R-06 | 4.75 h | backlog §3a R-07 tests + R-07 notes §4b, §4c; rows D2, K1, K2, S8, S10, MD2, MD4, A1-A9; security-reviewer on the answer route |
| Language toggle | nothing | 2.5 h | backlog §3a language tests |
| P5 | P1 (sessions); P2 optional; R-08 for the agent call | ~4 h | backlog §3a P5 tests (API level on demo fixtures) |
| P2 ("if time") | P1 | ~4.5 h | backlog §3a P2 tests; rows P2a, P2b |
| P3 ("if time"; pilot OFF) | P2 + the three-part pilot gate | ~6 h | backlog §3a P3 tests; rows P3a, P3b; real-phone items 2, 5-8 |

Every phase: tech-lead review + independent QA in the browser; real-phone items by Rangga / Tiffany in the
internal testing window. Rules: `docs/specs/technical-specification.md` §8; contracts:
`docs/specs/web-backend-rbac.md` §6.6.

## 6. Sprint 3: pilot live, demo outlet, submit (Mon 12 – Fri 16 Oct)

**Goal:** the pilot runs live from Mon 12; by Thu 15 a real proposal has gone through supervisor and owner and
SOP v2 has shipped with a review date (Wed 21 Oct); judges can try the demo outlet from a link; submit Fri 16.
**Capacity:** 5 weekdays × 4 h = **20 h**.

**Go-live steps, Mon 12:**
1. **Before the first Mulai:** no capture by design. From opening time the phone shows the opening reminder.
2. **08:00-09:30:** Rangga or Tiffany runs one short loop on the pilot phone: Mulai → speak → Selesai
   (confirm) → the upload line reaches "Unggah berhasil" → segment docs visible to dev-ops.
3. **09:30 go/no-go.** If the loop fails, dev-ops switches traffic to revision A (capture by the clock,
   ~2 min, no rebuild) and P1 is retried after that night's debrief ends.
4. **~10:00:** staff tap Mulai (briefed by Tiffany on Sun 11: the Mulai window, Selesai 4 h after Mulai, the
   auto-stop, the 1-hour debrief, when Mulai comes back, cancel, and who to tell about consent withdrawal).
5. **Coverage:** time before the first Mulai is not captured; the day still counts at ≥ 60% coverage.
6. **That night:** first tap debrief after Selesai or the auto-stop. Fixes deploy only after the debrief ends.

| Day | Rangga's work | Hours | Live at the shop |
|---|---|---|---|
| Mon 12 | **Go-live** steps above (2 h) · fixes, deployed only after that night's debrief ends (2 h) | 4 | Capture + transcription + labels + day record + tap debrief |
| Tue 13 | **R-11** ReviewAgent + Cloud Scheduler + verdict screen + outcome memory; on the pilot it fires Wed 21 Oct, on the demo through "fast-forward" (4 h) | 4 | |
| Wed 14 | **R-12** demo outlet: seed through the real segment API; "Try as Owner / Supervisor / Staff" ("Staff" = a demo paired-device session); rate limits; "fast-forward to review date" (labelled simulated) (4 h) | 4 | Weekday problem picked (evening) |
| Thu 15 | First real insight run (Mon 12 – Wed 14) and approval support (1 h) · **R-13** eval (2 h) · **R-14** README start (1 h) | 4 | **SOP v2 ships** (if approved) |
| Fri 16 | **R-14** finish: README (known gaps incl. DPIA next, consent collected outside the app, manual revocation within 7 working days), tag v1.0, uptime check, incognito test of every link (2 h) · fallback run if needed · buffer 2 h · **submit** (Tiffany) | 2 | |
| | **Planned 18 h of 20 (90%) · buffer 2 h** | | |

**If behind:** R-13 shrinks to the Transcribe-quality half. R-12's rate limits stay; its seed can be smaller.
Freeze never moves past Fri 16 midday.

## 7. Total load

| | Planned | Capacity | Load |
|---|---|---|---|
| Sprint 1 (Wed 30 – Sun 4) | 25 h | 28 h | 89% |
| Sprint 2 (Mon 5 – Sun 11) | 37.75 h | 36 h | 105% |
| Sprint 3 (Mon 12 – Fri 16) | 18 h | 20 h | 90% |
| **All** | **80.75 h** | **84 h** | **96%** (3.25 h headroom; 85.25 h − 0.5 merge − 1 R-10 diff − 3 R-15, §10 #51) |

**Cuts applied (Rangga, 4 Oct, all three together, §10 #51).** The language toggle (+2.5 h) took the plan
to 85.25 h (101%). Rangga approved: P5 cross-device merge → next MVP (−0.5 h), R-10 diff → plain
before/after list (−1 h), R-15 CriticAgent → next MVP (−3 h). 85.25 − 0.5 − 1 − 3 = **80.75 h (96%)**.

| Cut (applied 4 Oct) | Saves | Total | Cost |
|---|---|---|---|
| P5 cross-device merge (technical spec §8.15) → next MVP | 0.5 h | 84.75 h (101%) | Counts inflated with two or more paired devices; sufficiency pass/fail unchanged; the pilot runs one paired phone |
| R-10 diff → plain before/after list | 1 h | 83.75 h (99.7%) | Plainer SOP v2 screen |
| R-15 CriticAgent → next MVP | 3 h | 80.75 h (96%) | Thu 15's proposal isn't critic-checked; R-08's evidence gate still blocks weak proposals |

**Remaining cut (if behind):**
| Cut | Saves | Total | Cost |
|---|---|---|---|
| capture phase plan P5 → R-08's own button | 4 h | 76.75 h (91%) | Loses idempotent runs and the plain-code sufficiency check |

80% (≤ 67 h) is not reachable without dropping a decided feature. Sat 10 and Sun 11 are where a slip shows
first.

## 8. "If time" list (in this order)
1. **R-16** voice debrief (~6 h). Same question queue and answer contract as R-07.
2. **capture phase plan P2** gap ledger, outbox, liveness beacon (~4.5 h). Until it lands, insight coverage counts
   capture-gap minutes as 0 (stated in each run's result).
3. **capture phase plan P3** encrypted on-device audio queue (~6 h). Demo first. Pilot only after the three-part gate in
   technical spec §8.14, including Rangga's explicit formal sign-off for P3.
4. Cost-per-day tile for the owner (~3 h)
5. "Re-run this clip live" in the demo outlet (~2 h)
6. POS CSV import (~4 h)
7. Team and device settings screens (~4 h)
8. Guided tour in the demo outlet (~2 h)
9. "After-close attention ping" (vibrate + sound on the Selesai / auto-stop transition, ~0.5 h, real-phone
   verified; `docs/tasks/R-07-ux-notes.md` §5)

### 8a. Next MVP (post-MVP 1; not in MVP 1 hours)
Moved out of MVP 1 by Rangga on 4 Oct (§10 #51). Not built before submission; not on the "if time" list.
1. **R-15 CriticAgent** (~3 h). ADK agent calling the evidence gate as a tool; only passing proposals reach
   the supervisor (`docs/backlog.md` R-15, T-505). In MVP 1, R-08's own evidence gate blocks weak proposals.
2. **capture phase plan P5 cross-device merge** (~0.5 h). `mergeDevices` in `lib/insights/merge.ts`, design kept in
   technical spec §8.15. In MVP 1 counts are per thread, so with two or more paired devices they are inflated;
   sufficiency pass/fail is unchanged.

## 9. Tiffany's dates

| By | Task |
|---|---|
| Before Sun 11, 18:00 | bee6–Proofed paper contract signed; consent, privacy policy and TnC emailed to all users (addresses from Proofed, kept offline, never in `staff` or the repo; Q29 in technical spec §8.19, §10 #38); counter signage up |
| Sat 3 Oct | Custom vocabulary list (≤ 100 terms) |
| Sat 3 Oct | 5 short Bahasa demo clips (fictional outlet) |
| Sun 4 Oct | `categories.yaml` example pairs |
| Daily from Wed 30 | Ask Proofed about weekday problems |
| Wed 7 Oct | SOP v1 spec (private) · rubric + intervention library (R-08 input) |
| Tue 6 – Sun 11 | Internal testing with Rangga (§5b) |
| Sun 11 Oct | Staff briefing (§5d) · B-roll (no customer faces, no SOP document on screen) · video script draft |
| Mon 12 – Thu 15 | Walk supervisors through the day record; make sure staff answer during the 1-hour debrief that starts at Selesai or the auto-stop (on the pilot's hours, ending by 03:00 at the latest) |
| Wed 14 Oct | 2–3 weekday problem candidates → problem picked (evening) · 60+ episodes labelled (gold set, Mon 12 – Tue 13) |
| Thu 15 Oct | Supervisor + owner review of the first real proposal |
| Wed 14 – Thu 15 | Screen recordings |
| Fri 16 Oct, midday | Video (< 3 min) and deck (PDF) final |
| Fri 16 Oct | Submit on Hack2skill; save the confirmation |

## 10. Decisions and open points

Numbers are kept from v5 because other docs cite them. Detail and the full open list: technical spec §8.19.

| # | Item | Status |
|---|---|---|
| 1 | One Cloud Run service | Confirmed (29 Sep) |
| 2 | Rangga's hours: 4 h weekdays, 8 h weekends | Confirmed (29 Sep) |
| 3 | R-16 voice debrief → "if time"; R-15 kept | Confirmed (3 Oct); R-15 part superseded 4 Oct: R-15 → next MVP (#51) |
| 4 | Dev tool Claude Code; product only Google Cloud + Google AI | Confirmed (29 Sep) |
| 5 | SOP v2 ships Sat 10; review Wed 14 | Superseded: SOP v2 Thu 15 at the earliest; pilot review Wed 21 Oct |
| 6 | Weekday demo problem | **Open.** Pick by Wed 14 evening |
| 7 | Region probe results | Done (R-01; `config/regions.yaml`) |
| 8 | Does the shop phone capture a full day with the page open? | **Open.** Checked in the internal testing window |
| 9 | Does GATI qualify for the $300 Google Cloud credit? | **Open.** GATI to check |
| 10 | Email the organisers to confirm Claude Code as a dev tool | Optional |
| 11 | Manual Mulai/Selesai replaces opening-hours gating; the hard auto-stop 60 min after closing is the only automatic stop; first live Mulai ~10:00 | Confirmed (3 Oct); go-live Mon 12 |
| 12 | Insights run by supervisor or owner; idempotent per exact date range; overlapping ranges are separate runs | Confirmed (3 Oct) |
| 13 | Sprint trade: R-16 and P2 to "if time"; cut order R-15 → R-10 list → P5 | Confirmed (3 Oct); P5 merge added first (4 Oct); merge, R-15 and R-10 list applied 4 Oct (#51), only P5 left |
| 14 | Pilot go-live Mon 12 gated on Rangga's formal written sign-off; P3 OFF on the pilot | Confirmed (3 Oct) |
| 15 | Off-hours Mulai | Void (4 Oct): Mulai only inside the Mulai window; no off-hours session |
| 16 | No Mulai by the window end (close − 4 h) → off / closed, no gap alarm | Confirmed (4 Oct) |
| 17 | Consent revocation manual (Rangga or Tiffany), no in-app revoke | Confirmed (3 Oct); known gap |
| 18 | Pilot SOP v2 review after submission (Wed 21 Oct 09:00); closed loop on the demo outlet | Confirmed (3 Oct) |
| 19 | Business day: a session belongs to the business day whose Mulai window it started in; outside every session, the day changes at 01:00 | Confirmed (4 Oct) |
| 20 | Debrief starts at Selesai or the auto-stop, lasts 1 h regardless of activity; resumes from its original start | Confirmed (4 Oct) |
| 21 | Test outlet with past-midnight hours, adjustable; midnight checks M1-M6 mandatory | Confirmed (3 Oct); published test-outlet hours stay public (§10 #44) |
| 22 | Revocation: acknowledgement and complete removal both within 7 working days | Confirmed (4 Oct) |
| 23 | "Batalkan sesi": discard the open session until its close is triggered, two-step confirm; counts for nothing; role-only audit | Confirmed (4 Oct); copy pending (Q26, technical spec §8.19) |
| 24 | Once a business day has ended (Selesai, auto-stop or cancel) its Mulai is not offered again; a cancel does not reopen it | Confirmed (4 Oct) |
| 25 | Reopen time 02:00 on past-midnight outlets | Void (4 Oct) |
| 26 | No undo for Selesai or cancel; no supervisor "reopen" | Confirmed (4 Oct): accepted MVP 1 limit |
| 27 | Mulai window [01:00 on D, close(D) − 4 h]; latest close 01:00 next day; auto-stop close + 1 h | Confirmed (4 Oct) |
| 28 | Answer cache on the phone: until uploaded, at most 14 days; no names, no role | Confirmed (4 Oct) |
| 29 | D1: Selesai from Mulai + 4 h; cancel until the close is triggered | Confirmed (4 Oct) |
| 30 | D2: Mulai from 01:00 | Confirmed (4 Oct); running-debrief case is #34 |
| 31 | D3: every open question of the device expires as unverified at its debrief end; no 7-day expiry | Confirmed (4 Oct) |
| 32 | D4: no Mulai at all on a closed weekday; no override | Confirmed (4 Oct) |
| 33 | D5: the paired phone uploads cached answers with its device token | Confirmed (4 Oct); security-reviewer on R-07's answer route |
| 34 | The Mulai gate: Mulai waits for that phone's previous-day debrief timeout unless that day was off for it; clock only; fail-open when the end is unknown | Confirmed (4 Oct) |
| 35 | MVP 1 device model: no staff sign-in; device id only; mode derived, label only | Confirmed (4 Oct); staff PIN sign-in post-MVP 1 |
| 36 | Device-model follow-ups | (a), (b) closed by #37; (d) closed by #39. **(c) open:** staff phones capture only with the page open and the screen on |
| 37 | Sign-in and consent: Google sign-in for owner/supervisor; no staff sign-in; consent by contract + emailed notice; no in-app consent gate or revoked-consent state; the privacy line is a notice | Confirmed (4 Oct) |
| 38 | The emailed notice: who sends it, to which addresses, by when | **Open** (Rangga/Tiffany; Q29, technical spec §8.19). Proposed: before the Sun 11 sign-off, recorded in it |
| 39 | Multi-device: each device has its own session, debrief, expiry and Mulai gate; the insight run merges all devices | Confirmed (4 Oct); the merge function is post-MVP 1 (#51) |
| 40 | Role-agnostic questions; answers store the device id and timestamps only, no `answered_by` | Confirmed (4 Oct) |
| 41 | Answer shape: *Ya* / *Tidak* + a required reason, or *Lewati*; YES → `staff_confirmed`, NO → `staff_rejected`; reason ≤ 500 characters, refused not truncated, scrubbed + redacted, never a gate input | Confirmed, MVP 1 final (4 Oct). The three tech-lead choices (headline "Sekitar pukul HH:MM ada <langkah>. Benar?" with the SOP question in the reason prompt; reason required on YES and NO; NO on a sensitive category excluded like any NO) were approved by Rangga on 4 Oct (`docs/HANDOFF.md` "Answer decisions approved") |
| 42 | Supervisors answer device questions? | Confirmed: no (4 Oct) |
| 43 | Early Mulai release when every question is answered? | Confirmed: no (4 Oct) |
| 44 | Test-outlet hours vs real pilot hours: the session-rule docs (technical spec §8.3 examples, backlog §3a) publish test-outlet hours that are identical to the real pilot hours `docs/HANDOFF.md` records for the private seed | **Decided (Rangga, 4 Oct): keep them public.** No change to the test outlet or the docs |
| 45 | `lib/pipeline/gate.ts` question expiry vs technical spec §8.10–§8.11 | **Required code change in R-07 (Rangga, 4 Oct).** `expireQuestion` still uses a 7-day age rule and `applyGateDecision` treats `unverified` as terminal. R-07 must replace both: an open question of a device expires as `unverified` at that device's debrief end (`created_at_ms <= debrief_ends_at_ms <= now`), and an answer with `answered_at_ms <= debrief_ends_at_ms` that arrives later replaces `unverified`. Detail: `docs/tasks/R-07-ux-notes.md` §4c. Docs only until R-07 |
| 46 | UX-02 auth and navigation plan (`docs/tasks/UX-02-auth-nav-refinement.md`; the file is not in the checkout) | **Invalid (Rangga, 4 Oct): superseded by the session-model plan, now technical spec §8 and web spec §2a** (no staff sign-in in MVP 1, device model, manual sessions). Do not build PR-A or PR-B from it; its open questions are void |
| 47 | `/capture` privacy notice wording | **Decided (Rangga, 4 Oct):** Rangga's final privacy line (technical spec §8.16; wording UX-03 §6). Other drafts (UX-03's "Suara tidak disimpan di cloud...") are dropped. Pilot gate unchanged: the line reaches the pilot page only after P4 and Rangga's formal sign-off (§5c); the approved line stays until then |
| 48 | UX-03 open items | **Decided (Rangga, 4 Oct):** C6 done heading "Debrief selesai — terima kasih"; C7 deferred, `/pair` keeps the raw outlet id in MVP 1 (outlet name post-MVP 1); C9 values bilingual, label once in Bahasa, no duplicate English line (*C9 superseded 4 Oct by #49*). **C10 open** until the `feat/capture-upload-toast` review is done |
| 49 | Language toggle | **Decided (Rangga, 4 Oct):** English is the default language (demo outlet included); a top-bar `ID \| EN` control on every screen, shop phone, supervisor and owner; language names untranslated; one cookie `bee6_lang` read by the server layout; the English column of UX-03 §6 (revision 5) is the primary copy; shortened EN privacy notice accepted (technical spec §8.16 sign-off gate unchanged). Behaviour: technical spec §8.17; copy: UX-03 rev 5. Cookie read location is tech-lead decision TL-L1 (recommended: root layout). **In §7 load (4 Oct): 2.5 h on Tue 6** for the shop-phone screens (root layout cookie read, typed dictionary module, switch, copy sheet); supervisor and owner copy goes into the same dictionary inside R-06/R-09/R-10. Takes the total to 85.25 h (101%); cut decided 4 Oct (#51) |
| 50 | UI/UX vs session-rule precedence | **Decided (Rangga, 4 Oct):** UI/UX wins on how a screen looks, reads or is worded; the technical spec §8 and web spec §6.6 win on functional and technical behaviour (session rules, offline queue, routes, data contract, retention, consent, privacy). Source: the session-model plan's header and §4.15 item 6 (removed; rule in this row) |
| 51 | Capacity cuts after the language toggle | **Decided (Rangga, 4 Oct, all three together):** P5 cross-device merge (technical spec §8.15) → next MVP (−0.5 h); R-10 diff → plain before/after list (−1 h); R-15 CriticAgent → next MVP (−3 h). Total 80.75 h of 84 h (96%). Next MVP list: §8a |
| 52 | `CLAUDE.md` wording changes owed by the PM (from the session-model plan's hard-rule mapping, removed; the items are listed in this row) | **Open (PM edit, not tech-lead).** (1) §1: audio is never stored in the cloud; it only waits, encrypted, on the phone until uploaded (once P3 ships); staff tap Mulai (01:00 until 4 h before closing) and Selesai (from 4 h after Mulai); auto-stop 1 h after closing; a 1-hour debrief follows. (2) §2: add 2a "on the capturing phone only, audio may wait encrypted (AES-GCM, non-extractable key) until the upload is confirmed, or is deleted after 24 h when the page next runs; never to cloud storage" (with P3, not before). (3) §2 #7a: "kept `retention_days` (default 14) after the line, then deleted by TTL", in the same PR as P4, not before. (4) §2 #10 (optional): the insight sufficiency check is plain code too. (5) §3 browser capture: IndexedDB + WebCrypto AES-GCM queue (P3). (6) §8 known gaps: Mulai/Selesai taps and their windows; a forgotten Mulai looks like a day off; answers wait on the phone at most 14 days; reminders are on-screen only; the segment route does not enforce session windows; Firestore TTL deletion lags. No rule needs weakening |
| 53 | Still-open items (Q3, Q4b, "Try again" control, Q29, Q-U23, UX-03 copy sign-off, C10) | **Open.** Listed in `docs/specs/technical-specification.md` §8.19 |

## 11. History (one line per revision; detail in git)
- 4 Oct (cuts, Rangga): P5 cross-device merge and R-15 CriticAgent → next MVP (§8a), R-10 diff → plain before/after list; Sat 10 8 → 4 h, Sun 11 8.5 → 8 h; Sprint 2 37.75 h (105%); total 80.75 h of 84 (96%), 3.25 h headroom (§7, #51).
- 4 Oct (language toggle sized): +2.5 h on Tue 6 (shop-phone screens; dashboard copy inside R-06/R-09/R-10); total 85.25 h (101%); proposed cut P5 merge + R-10 diff → 83.75 h, Rangga to decide (§7).
- 4 Oct (precedence and language, Rangga): UI/UX wins on presentation, the session rules on behaviour (#50); English default, top-bar `ID | EN` toggle on every screen, cookie `bee6_lang` (#49; C9 superseded); UX-03 rev 5 conflicts applied in the session-model plan (now technical spec §8.8, §8.10–§8.11, §8.9, §8.17, §8.16, §8.19). Sprint dates unchanged.
- 4 Oct (UX-03 confirmations, Rangga): Decision A final (green headline, red ▲ lost line first in the upload block, announced once); Q-U3 stacked cancel panel ("Tetap simpan sesi" first, red "Ya, hapus sesi" below); Q-U16 `events` IDB store approved, history rows split into ships-now and waits (technical spec §8.12); Q-U17 PRODUCT.md facts confirmed.
- 4 Oct (headline rule, Rangga): the headline stays green for every upload result, including `queue_full`; amber `queue_full` headline removed (technical spec §8.8, §8.19). Required on `feat/capture-upload-toast`: no `queue_full` headline state (a cap prune must not change `CaptureState`/`StatusBanner`); a cap prune sets `uploadLost` so the lost line shows; add a test that a prune keeps the headline green and shows the lost line.
- 4 Oct (docs pass): #44 decided (test-outlet hours stay public); #45 gate.ts expiry recorded as a required R-07 change; #46 UX-02 invalid, superseded by the session-model plan; #47 privacy notice = Rangga's final line (technical spec §8.16); #48 UX-03 C6/C7/C9 decided, C10 open.
- v6, 4 Oct: regenerated from the session-model plan and `docs/HANDOFF.md`; stacked notes removed; that plan was then
  the source of truth for the session model and the staff journey (folded into technical spec §8 and web spec §6.6, 6 Oct).
- 4 Oct (MVP 1 answer shape): *Ya* / *Tidak* + reason, or *Lewati*; R-07 4.75 h; total 82.75 h (99%).
- 4 Oct (free-text answer, same day): superseded by the MVP 1 answer shape.
- 4 Oct (late): the Mulai gate, no undo, multi-device, role-agnostic questions; P5 merge +0.5 h.
- 4 Oct: sign-in and consent (no in-app consent); MVP 1 device model (no staff sign-in, R-07 −0.5 h).
- 4 Oct: decisions D1-D5; final session model (R-07 +1 h); Mulai eligibility (+1.5 h); cancel (+3.5 h);
  business-day attribution.
- 3 Oct (v5): go-live moved Mon 5 → Mon 12; internal testing window; formal sign-off gate; R-16 "if time".
- 3 Oct (v4): opening-hours gating replaced by Mulai/Selesai. 30 Sep (v3): Sprint 2 reshuffle.

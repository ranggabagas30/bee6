# QA live audio rehearsal, round 2 (15-16 Oct 2026, demo project only, after R-20)

Target: https://web-33uzb53tza-et.a.run.app (Cloud Run `web`, revision **web-00017-q6m** at 100 % traffic, image
sha256 7506a244…, created 15 Oct 15:57Z = main after release PR #77 / bc54898; project bee6-playground).
Driver: the round-1 harness (Playwright 1.64 Chromium, fake microphone `--use-file-for-fake-audio-capture=<wav>%noloop`,
360×800 mobile emulation for the phone, 1280×900 for supervisor/owner), one persistent profile per sandbox, four
sandboxes in parallel. Firestore read-only with the Admin SDK under ADC. Logs with `gcloud logging read --project=bee6-playground`.
Day wavs = `private/rehearsal/d{d}-c{1..5}.wav` (the 4 regenerated R-20 cards, 3 s between lines) concatenated with
**9 s** between cards (13 s on the ghost re-runs). Screenshots and raw JSON outputs:
`<LOCAL_PATH>/r2/shots/`
and `…/scratchpad/r2/out-*.json`. Run window 23:08 WIB 15 Oct – 00:30 WIB 16 Oct (16:08Z – 17:30Z).
Nothing written outside the four throw-away sandboxes below (TTL 2 h). `demo-tpl-outlet` / `demo-outlet` untouched.
No product code edited, nothing pushed, no infra action. Pilot project never touched.

**VERDICT: SHIP** for the R-20 scope (D1 proposal creation, D2 ghost cleanup, D3 card rewrite): every "Done when" of
`docs/tasks/R-20-rehearsal-fixes.md` §4 is proven live (§4, §5, §6 below). Two reproduced findings outside R-20's scope
are listed in §7 for Rangga's explicit decision (zero-tolerance rule): the second phone line still lands as a separate
CORRECTION thread on the exact cards (2 of 2 days, model behaviour), and the open guide sheet covers the End-confirm
button at 360 px (same family as the round-1 D7). The four round-1 minor findings D4–D7 are all still there (not in scope).

## 1. Sandboxes

| Sandbox | Device | Purpose |
|---|---|---|
| `sbx-7af31ca61115` | `jdg-7af31ca61115` | main 3-day judge journey (exact cards) → supervisor → owner |
| `sbx-148e94c793e5` | `jdg-148e94c793e5` | variants: improv-*, real/*, *.old.wav controls (3 days), then supervisor Ask ×2 |
| `sbx-011317babd70` | `jdg-011317babd70` | D2 ghost repro (Cancel today ×3), next-day shift |
| `sbx-49a8be99692d` | `jdg-49a8be99692d` | weak case: 1 day of CUSTOMER_SERVICE only → no Ask possible |

Entry page → Staff "START HERE" → `/pair` → guide "Fill in 000000" → Set up → "Device set up" → "Open the listening page"
→ `/capture` "Day 1 of 3 · Thu 15 Oct". Pair 0.3–0.8 s. Template history (13–14 Oct) still routine-only (6 ROUTINE_OPS facts).

## 2. Day × card table (main sandbox, exact wavs) — dropped lines: **0 of 21** (round 1: 5 of ~10 two-utterance segments)

Transcript = stored `segments.lines[].text`. Every line became its own segment (rule (b): ≥ 6 s speech + 2 s pause),
so no two-utterance segment was produced at all with the rewritten cards. Label = thread category / confidence / status.

| Day·card | Heard (stored lines) | Label | Expected | Result |
|---|---|---|---|---|
| 1·1 Opening | full | ROUTINE_OPS 0.95 fact | ROUTINE_OPS | pass |
| 1·2 First bake | full | ROUTINE_OPS 0.95 fact | ROUTINE_OPS | pass |
| 1·3 Problem A | "Excuse me, I have a question about the egg tarts on the display. Are they fresh today, and do you know what time they were baked?" / "I am not sure when this tray was baked because nobody writes the baking time on the tray. I think it was this morning, but I cannot say for sure." / "Okay, no problem. I will take two anyway." (3/3, one thread) | CUSTOMER_SERVICE 0.95 fact, summary "Customer asking about egg tart freshness and making a purchase." | CUSTOMER_SERVICE | pass |
| 1·4 Display check | full | ROUTINE_OPS 0.95 fact | ROUTINE_OPS | pass |
| 1·5 Closing | full | ROUTINE_OPS 0.95 fact | ROUTINE_OPS | pass |
| 2·1 Opening | full ("Morning, oven on, display lights on, the cash in the till is counted and correct.") | ROUTINE_OPS 1.0 fact | ROUTINE_OPS | pass (round 1: dropped) |
| 2·2 Problem A | 3/3 lines, one thread ("…Nobody wrote the baking time on the tray, so I can only guess…") | CUSTOMER_SERVICE 1.0 fact {sale:true}, summary "Customer asking about baking time of an egg tart and making a purchase." | CUSTOMER_SERVICE | pass |
| 2·3 Problem B | line 1 "Hello, Demo Bakery, thanks for calling. Yes, we can do 50 egg tarts for tomorrow morning, pick up at 10:00. Okay, got it. Thank you, bye." / line 2 "That was a phone order for tomorrow. I did not read the order back to the caller before hanging up, so I am not sure the quantity and the pickup time are right." (2/2) | line 1 → **PHONE_CALL 1.0** → question → Yes → fact; line 2 → **separate CORRECTION 1.0 thread** (summary "Supervisor noting a mistake made during a phone order by failing to read it back.", runner-up PHONE_CALL "retrospective correction… rather than the active phone call") → question → Yes → "Waiting for review" | PHONE_CALL question | label pass; **line 2 did not join the PHONE_CALL thread** (§7 F-1) |
| 2·4 Display check | full | ROUTINE_OPS 1.0 fact | ROUTINE_OPS | pass |
| 2·5 Closing | full | ROUTINE_OPS 1.0 fact | ROUTINE_OPS | pass |
| 3·1 Opening | full | ROUTINE_OPS 1.0 fact (thread also absorbed card 5's closing line: "Opening and closing routine operations.") | ROUTINE_OPS | pass |
| 3·2 Problem B | line 1 "Hello, Demo Bakery, thanks for calling. A birthday cake and 20 croissants for Saturday, pick up at 3:00 or 4:00? Sorry, the line is bad. Okay, 4:00. Bye." / line 2 "That was another phone order. I hung up without reading the order back to the caller, so I hope I got the pickup time right." (2/2) | line 1 → **PHONE_CALL 1.0** → question → Yes → fact; line 2 → **separate CORRECTION 1.0** ("Reflecting on a phone order mistake regarding repeating the order.") → question → Yes | PHONE_CALL question | label pass; same split as day 2 (§7 F-1) |
| 3·3 Second bake | full | ROUTINE_OPS 1.0 fact (one thread with 3·4) | ROUTINE_OPS | pass |
| 3·4 Display check | full | same thread | ROUTINE_OPS | pass |
| 3·5 Closing | full | merged into 3·1's thread | ROUTINE_OPS | pass |

Labels 15/15 on the card level; the problem statement of A is now inside the CUSTOMER_SERVICE thread on both days
(the R-20 excerpt reached the Proposal agent, see §4). The problem statement of B is in a CORRECTION thread on both
days, so the PHONE_CALL fact's excerpt is only the call itself; the staff debrief note carried the problem instead.

Harness note: a segment PUT returns 2–4 s after a line ends; the guide's "I have spoken this" enables after ≥ 1 line
since the card was shown, so the harness tapped at the pace a judge would (card 1 at +20 s, card 5 at +73…118 s).

## 3. Debrief

| Day | End → first screen | Questions | Answers |
|---|---|---|---|
| 1 | "Debrief complete · There are no questions today." after 2.0 s (`preparing:false`, the tick had already run during the cards) | 0 | — |
| 2 | "Preparing your questions" 132 s → Question 1 of 2 | "Around 23:20 there was a phone call. Is that right?" · "Around 23:20 there was a correction. Is that right?" | Yes + reason each; POST …/answer 200 `answered` ×2; "Debrief complete · Thank you. All 2 questions are answered and today is closed." |
| 3 | Question 1 of 2 after 2.1 s | "Around 23:27 there was a phone call…" · "Around 23:27 there was a correction…" | Yes + reason ×2; then "All 3 demo days are done. Sign out and continue as Supervisor." Jump button gone. |

Correction docs (Firestore `corrections`): `answer: "yes"`, `reason_text` (my typed reason, no name), `answered_device_id`
only, no role, no name; `needs_supervisor_confirm: false` for PHONE_CALL, `true` for CORRECTION (hard rule #7 ok).
The CORRECTION question per phone day (round-1 observation (c)) is still there; ≤ 2 questions/day as R-20 §4 asked.

## 4. Proposals (D1 — fixed)

Supervisor, after day 3: watch panel "Customer service · seen on 2 of 2 days needed · Ready", "Phone call · … · Ready"
(`GET /api/v1/proposals` watch: CS facts 2/dates 2, PHONE_CALL facts 2/dates 2).

| Ask | Latency | Response | Doc |
|---|---|---|---|
| "Ask Bee6 for a proposal" | **12.7 s** | 201 `awaiting_supervisor`, focus CUSTOMER_SERVICE, `reused:false` | `proposals/28037e4b…`: generator `{adk, gemini-3.5-flash, asia-southeast1, agent_version proposal-v3, gate pgate-v1, library_version {interventions:2, rubric:1}, attempts:1, floor-v2}`, gate passed 9/9 checks, no blocked rule, counts {facts 2, dates 2}, evidence 2026-10-13 + 2026-10-14 (thread ids only, no device id in `content.evidence`) |
| "Ask for another proposal" | **7.3 s** | 201 `awaiting_supervisor`, focus PHONE_CALL | `proposals/ac12b6a2…`: same generator shape, attempts 1, gate passed, evidence 2026-10-14 + 2026-10-15 |

After the second Ask the button reads "All asked · no more evidence to use" (disabled); the panel shows both categories
"Proposed". Cloud Run: two `[proposal] generated` lines (16:49:12Z, 16:52:35Z), one `[proposal] decided`.

**Proposal A (CUSTOMER_SERVICE) — intervention `add_record_step`, target `bake-01` Morning bake (modify):**
- Title: "Record baking time on tray labels".
- Change text: "Morning bake: Bake the first tray of each bread by opening time, and write the baking time on each tray's label."
- Rationale: "Customers on multiple days asked about the freshness and baking times of items, but staff could not answer because the baking times were not recorded. Writing the baking time on each tray's label at the time of baking ensures staff can immediately and accurately answer customer questions."
- Metric: CUSTOMER_SERVICE decrease, "Daily count of customer service inquiries where staff are unable to confirm the baking time or freshness of display items." baseline 2 in 5 days. Failure condition: "Staff are observed serving customers from trays without a written baking time, or still cannot answer questions about when an item was baked." Review after 14 days (card said Thu 29 Oct at proposal time).
- Owner reading: cited dates shown as "Tue 13 Oct · 23:10 — Customer asking about egg tart freshness…" and "Wed 14 Oct · 23:19 — …"; `add_record_step` fits (write the time where the next person reads it); plain language; no person's name; a process step, no blame. Good.

**Proposal B (PHONE_CALL) — intervention `add_record_step`, NEW step:**
- Title: "Record phone orders on order slips".
- Change text: "[staff] Take a phone order: When a customer calls to place an order, write down their name, phone number, requested items, quantities, and pickup date and time on a paper order slip. Read all these details back to the customer to confirm them before hanging up, then clip the completed slip to the order board."
- Rationale: "Staff took phone orders on 2026-10-14 and 2026-10-15 but hung up without reading the details back, leaving them uncertain about the quantities and pickup times. Adding a step to write down the details on an order slip and read them back to the customer ensures the information is recorded accurately and confirmed immediately."
- Metric: PHONE_CALL decrease, baseline 2 in 5 days. Failure: "Any phone order is found on the order board with missing details, or staff report being unsure of a phone order's details during the evening debrief." Review 14 days.
- Owner reading: cites both dates (ISO dates inside the rationale, less friendly than A's "Tue 13 Oct"); fits the intervention; no staff name; it is a process step. Two quality notes: (a) the step tells staff to write the **customer's name and phone number** on a slip (customer PII on paper, not in the system; a product/privacy wording question for Tiffany/Rangga, not a hard-rule break); (b) the leading "[staff]" role tag was copied into the step text (the prompt renders steps as `- step_id [role] title: text`, the model echoed the bracket).

The staff debrief note reached the model: without it the PHONE_CALL excerpts are only the calls (§2), yet the rationale
names "hung up without reading the details back" — the content of the two `reason_text` notes.

**Weak case (sandbox `sbx-49a8be99692d`, one day of CUSTOMER_SERVICE):** watch "Customer service · seen on 1 of 2 days needed ·
Needs 1 more day", button "Not enough evidence yet" disabled, `state: needs_more`; no `[proposal]` log line for that outlet
→ no model call (plain-code floor).

**Variants sandbox Asks (CS 9 facts/3 dates, PHONE_CALL 6 facts/2 dates, STAFF_CONSULT 1/1 needs_more):** Ask → 201 CS
`add_record_step` NEW "[staff] Label baking time: When placing a freshly baked tray on display, write the baking time on
the tray label." (7.1 s, evidence 10-13 + 10-15); Ask for another → 201 PHONE_CALL `add_record_step` NEW "[staff] Take a
phone order: … write down the items, quantities, and pickup date and time on an order slip, and read these details back
to the caller to confirm before hanging up." (6.5 s). 4 of 4 Asks across two sandboxes produced a proposal on attempt 1.

## 5. Supervisor → owner → SOP v2 → review date → Home

- Supervisor sign-in 4.2 s (demo "Fill in" → Sign in) → lands on `/day/2026-10-15`: "Facts: 3 · Questions: 1", rows show
  "A staff member answered Yes: <reason>", no device id anywhere; "Change category / Reject" only on staff-confirmed rows.
- Proposal detail: "Feasible means staff can do this in the shop…" → **Mark feasible** B → `POST …/review` 200
  `{result: feasible, status: awaiting_owner}`; same for A. List: both "Waiting for owner approval".
- Supervisor SOP book: "08/10/26 · current", "Steps in version 1", "From your SOP 5 · Improved with Bee6 0", changes "No changes yet".
- Sign out → entry page → `/sign-in?as=owner` → Fill in → Sign in 3.5 s → `/home`: "Waiting for your approval · 2" (both
  "Supervisor marked it feasible · Review"), Progress 0/0, "Today in five lines", Next review "No data yet", Cost "Coming soon", Reset the demo.
- Approvals page: "One proposal at a time, in the recommended order… 0 of 2 decided", #1 A "Reviewing now", #2 B
  "Waiting for you"; **Approve** A → `POST …/approve` 200 `{approved}` (no confirm dialog) → "Approved. It ships as a new SOP
  version." "#1 … Approved · Shipped as SOP version 2".
- Owner SOP book: tabs **"08/10/26" | "17/10/26 · current"**, "Steps in version 2", "From your SOP 4 · Improved with Bee6 1",
  Changes: "Version 2, from Sat 17 Oct · Record baking time on tray labels · Before (version 1) … After (version 2) … Done by:
  Staff · Metric: Customer service per day should go down (now 2 in 5 days) · Review on Sat 31 Oct · Approved on Fri 16 Oct".
  `GET /api/v1/sop`: latest v2 effective 2026-10-17, in_force_version 1, first_version_date 2026-10-08. Firestore `sop_versions/sbx-…:v2` exists.
- Reviews: "Fast-forward to the review date (simulated)" → `POST /api/v1/reviews/fast-forward` 200 `{version:2}` → "Simulated
  review created · Waiting for a verdict · SOP version 2: review on Sat 31 Oct · Before (Fri 9 Oct to Thu 15 Oct): 2 in 5
  captured days, 0.4 per day · After (Sat 17 Oct to Fri 30 Oct): no captured days · bee6 has no suggestion… · Waiting for the
  supervisor's verdict by Sat 7 Nov".
- Owner Home after approval: "Waiting for your approval · 1", "APPROVED 1 · started, waiting for review", "NEXT REVIEW Sat 31 Oct · Record baking time on tray labels".
- **B after A shipped: "Approve · not available — The SOP changed after this was drafted. You can still reject it with a reason."**
  (`notices.sop_changed`, R-09 rule, `generator.sop_version_id` v1 ≠ current v2). By design, but it means a judge can ship
  exactly one of the two proposals; the other must be rejected and re-asked. See §7 O-1.
- Dates: my run crossed midnight WIB; the demo header stays "Thu 15 Oct" while `GET /api/v1/sop` reports `today: 2026-10-16`,
  so v2 is "from 17/10/26" and the review date moved from the card's 29 Oct to 31 Oct (= approval day + 1 + 14). A judge
  running in daytime sees 16/10/26 and 30 Oct. Not a defect; worth knowing for the script.

## 6. D2 — Cancel today cleanup (fixed)

Sandbox `sbx-011317babd70`, day 2: Start → d3-c1 + d3-c2 (opening + phone card) → wait one tick → Firestore shows the
ghost material: threads `…5424585f…:T1` ROUTINE_OPS fact, `:T2` PHONE_CALL open, `:T3` CORRECTION open, questions
`q_thread_…:T2`, `:T3` open. Relaunch the browser (tab closed) → `/capture` "Today's session was interrupted. Cancel it and
start today again." → **Cancel today** → `POST …/discard` **202 `{ok:true, cleanup:"pending"}`** → "Session cancelled",
Start offered. **46 s later** (next tick) all three ghost threads, both questions and the 3 segments are gone; tombstone
`capture_sessions/jdg-…:445b423b…` has `end_reason: "discarded"`, `cleanup_done_at_ms: 1792082642348`; audit
`jdg-011317babd70:445b423b…:capture.session_cleanup` `{actor_role: system, details: {threads_deleted: 3, questions_deleted: 2,
corrections_deleted: 0, segments_deleted: 0}}` (the route's own `capture.session_discarded` says `segments_deleted: 3`).
Second repro in the same sandbox (session `e13429ce…`, interrupted after 6 segments): identical — cleanup done 16 s after
the discard, audit counts threads 3 / questions 2. Logs: no `cleanup_failed`, no error in the tick during the window.
Third repro (session `663cf541…`, interrupted at card 5): cleanup done 103 s after the discard, audit counts threads 3 /
questions 2. Then the real day 2 (session `a22b7748…`, ended by the 10-min `auto_stop`) → debrief **"Question 1 of 2"**:
"Around 00:12 there was a phone call…" and "Around 00:12 there was a correction…" — both from the real session's unit
`w_642ceb7b…` (`GET /api/v1/questions` lists exactly those two, `preparing:false`). Round 1 showed 4 (ghosts + real);
today three cancelled sessions left **zero** ghost questions. Answered both → "All 2 questions are answered and today is closed."
Jump to tomorrow → day 3: all four `capture_sessions` (3 tombstones + the auto_stop) shifted by exactly −86 400 000 ms
together with their `cleanup_done_at_ms`; `capture.session_cleanup` audits still **3** (no second cleanup after the shift);
`sandbox.next_day_count: 2`. Firestore `threads`/`questions` for the sandbox now hold only the day-1 and day-2 real docs.

## 7. Findings (zero tolerance; all reproduced; Rangga decides)

**R-20 scope: no defect.** Both outside-scope findings below are real and reproduced:

- **F-1 [major, model behaviour] The second phone line opens a CORRECTION thread instead of joining the PHONE_CALL thread (exact
  cards, 2 of 2 days, main sandbox).** Repro: day 2 card 3 / day 3 card 2 read with a 3 s pause between the two lines → each
  line is its own segment → the label tick returns `T3 PHONE_CALL 1.0` for the call and `T4 CORRECTION 1.0` ("Supervisor
  noting a mistake…", runner-up PHONE_CALL "retrospective correction… rather than the active phone call") for the staff
  sentence. Effect: (a) two debrief questions per phone day instead of one; (b) a "Waiting for review" CORRECTION item for the
  supervisor each day; (c) the PHONE_CALL fact's excerpt does not contain the problem — the proposal relied on the staff's
  debrief note (a judge who answers Yes with an empty reason gives the model only "Taking a phone order…" + "Hello, Demo
  Bakery…"); (d) the label summary invents a "Supervisor" actor. It is non-deterministic: in the variants sandbox the same
  shape (old wavs d2-c3.old/d3-c2.old and improv-d2c3/d3c2) joined the PHONE_CALL thread on day 2 (2-line PHONE_CALL 0.9
  facts) and split into CORRECTION on day 3. This is exactly the residual the PR-C review flagged ("the one §3.3 assumption
  this PR cannot prove offline"). Evidence: `threads` docs of `sbx-7af31ca61115` (T3/T4 of unit `w_4baa834a…`, T2/T3 of
  `w_e59261f3…`), screenshots `m-d2-q2.png`, `m-d3-q2.png`, `s10-sup-day.png`.
- **F-2 [minor, 360 px] The open judge-guide sheet covers "Yes, end".** Repro: `/capture` after "Jump to closing time" with the
  guide open ("Tap End today" card) → tap End today → the confirm card "End today's operations?" renders behind the sheet; "Not
  yet, keep going" is half visible, "Yes, end" is under the sheet (Playwright: `<section class="b6-sheet"> subtree intercepts
  pointer events`); the judge must collapse the guide first. Same family as round-1 D7. Screenshot `m-d1-now.png`.

Round-1 minor findings, re-checked (none in R-20 scope): **D4 still there** — `/proposals`, `/sop`, `/reviews`, `/devices`
read "Judge guide · Stage 1 of 5" for a supervisor on day 3 (progress says day 3, days_done 3); after an Ask the pill
jumps to "Stage 4 of 5" on `/proposals`; owner pages `/home`, `/sop`, `/reviews`, `/proposals?id=…` all read "Stage 1 of 5".
**D5 still there** — after staff Sign out, `/sign-in` shows "Demo · Signed in as Staff · Ends at 01:08" (bee6.demo keeps
`role: staff`); on the owner sign-in it shows "Signed in as Supervisor". **D6 still there** — `favicon.ico` 404 on every page
load (13 WARNING entries in Cloud Logging in the window, one console error per page). **D7 still there** — on `/pair` with the
guide open, "Set up" is under the sheet (click intercepted; `elementFromPoint` = the journey list).

Observations (not defects): **O-1** after the first approval the second proposal is "Approve · not available (The SOP changed
after this was drafted)" — the judge guide/stage-5 copy should say "approve one; reject the other with a reason or ask
again"; otherwise a judge who expects two approvals is stuck. **O-2** the owner can `POST /api/v1/proposals/generate` (200,
reused) and `POST /api/v1/constraints` (201) — allowed by the role table, noted because the entry page frames generation as
the supervisor's job. (I created one constraint "probe" in my own sandbox by this probe; TTL deletes it.) **O-3** the demo
session auto-stops 10 min after Start (`demo_session.max_ms 600000`): my first ghost attempt ended as `auto_stop` with the
phone questions still open; a slow judge who takes > 10 min on 5 cards gets the same. **O-4** the label model merged day 3's
opening and closing lines into one ROUTINE_OPS thread ("Opening and closing routine operations", 23:27–23:28) — harmless.
**O-5** "17/10/26 · current" labels the not-yet-in-force version (effective tomorrow) as current while `in_force_version` is 1.
**O-6** `[pipeline-tick] skew {skew_min_ms, skew_newest_ms}` info lines, 5 per tick (one per device) — noise, not WARNING.

## 8. Variants (improv-*, real/*, *.old.wav controls) — labels and drops

| Clip | Stored transcript (lines) | Label | Note |
|---|---|---|---|
| improv-d1c3 (new, 3 s) | 3/3 heard ("Excuse me, do you know if these egg tarts are from today?… I am really not certain of the baking time. There is no time written on the tray…" / "But I cannot be sure. Okay, that is fine. I will take two of them.") | CUSTOMER_SERVICE 0.95 fact | pass |
| real-q1-staff-a + b | 2/2 | **STAFF_CONSULT 0.9** fact ("Staff discussing when a tart was baked and who prepared the tray.") | round 1: CUSTOMER_SERVICE; label flips between runs on this clip |
| improv-d2c2 (new, 3 s) | customer line + "That is okay. I will have one." — **staff line DROPPED** (2 of 2 plays, day 1 and day 3) | CUSTOMER_SERVICE 0.95 fact | drop |
| d1-c3.old (2 s) | 3/3 heard (2 of 2 plays) | CUSTOMER_SERVICE 0.95 fact | control: round 1 dropped it; today heard |
| d2-c2.old (2 s) | customer line + "All right, I will have one…" — **staff line DROPPED** (2 of 2 plays) | CUSTOMER_SERVICE 0.95 fact | control: round 1 heard it; today dropped |
| real-d1-opening | 1/1 | ROUTINE_OPS 0.95 fact | pass |
| real-q2-customer + staff | 2/2 | CUSTOMER_SERVICE 0.95 fact | pass |
| improv-d2c3 (new) | 3 bursts → 2 segments, all words heard | PHONE_CALL 0.9 fact (both lines one thread) | pass |
| improv-d3c2 (new) | all heard | PHONE_CALL 0.9 fact (one thread) | pass |
| real-phonecall | 1/1 | **CUSTOMER_SERVICE 0.8** ("Customer service interaction about egg tarts.") | round 1: PHONE_CALL 0.95 |
| d2-c3.old, d3-c2.old (day 2) | all heard | PHONE_CALL 0.9 fact, 2-line threads | pass |
| d2-c3.old, d3-c2.old (day 3 control) | all heard | PHONE_CALL 1.0 question + **CORRECTION 0.9** ("Supervisor noting…") each | same split as F-1 |
| real-d2-closing | 1/1 ("…leftover bread is locked.") | ROUTINE_OPS 0.95 | pass |

Drop count: exact new cards **0/21 lines** (main) + 0/… on the ghost re-runs; variants **4 drops in 36 lines**, all four the
same shape (a ≈ 3.5–4 s customer question, 2–3 s gap, a 6–8 s staff answer in one segment) and only on `improv-d2c2` and
`d2-c2.old`; the new `d2-c2` (7 s customer line, 3 s gap) was heard 3/3 both times. Debrief on the variants day 2: 5 questions
(cap 5 held), day 3: 4 questions. Variants label accuracy 11/13 on the category a human would pick (STAFF_CONSULT on real-q1
is defensible; CUSTOMER_SERVICE on real-phonecall is wrong).

## 9. Other checks (pass)

- Jump to tomorrow: day 1→2 and 2→3 `POST /api/v1/demo/next-day` 200 `{day:n}` in 0.7–0.8 s (round 1: 6 s); header "Day n
  of 3 · Thu 15 Oct"; day-1/2 data shifted back one day each time (threads/corrections carry `2026-10-13/14`); outlet
  `sandbox.next_day_count: 2` after day 3; the guide hides Jump after day 3 ("All 3 demo days are done").
- Sign-out/re-entry: staff Sign out after day 3 → entry page (no dialog, nothing open) → `/sign-in?as=supervisor` "You are
  continuing your demo (ends 01:08)" → same sandbox; owner likewise.
- RBAC probes (live, with the real bearer the page sends): owner → `GET /api/v1/questions` 403 "Role owner may not perform
  questions:read"; owner → `GET /api/v1/capture/config` and `POST /api/v1/demo/next-day` 403 "A device credential is required";
  owner → `POST …/review` 403 "may not perform proposals:review"; owner → `POST /api/v1/threads/x/confirm` 403; no bearer → 401
  on every route. Device credential (the page's own `authorization` + `x-device-id` headers, replayed) → `GET /api/v1/proposals`,
  `POST …/approve`, `GET /api/v1/sop`, `GET /api/v1/home`, `POST /api/v1/demo/reset`, `GET /api/v1/day/…` all **401**
  (device tokens are not web credentials); `POST /api/v1/demo/next-day` with `expected_day: 3` → **422** (schema allows 1|2
  only), so a 4th jump is impossible through the API; the UI hides "Jump to tomorrow" once day 3 is done (main sandbox).
- Hard rules at runtime: no audio/base64 in any Firestore doc read (segments hold `lines[].text`, `model`, `location: global`)
  or in any log line; answers store `answered_device_id` only; no person's name anywhere (none spoken; model text uses "staff",
  "customer", "supervisor"); proposal generator location `asia-southeast1` for gemini-3.5-flash recorded on the doc; 360 px
  capture/debrief/interrupted screens: scrollWidth 360 = innerWidth.
- Cloud Run logs 16:05Z–17:20Z: **no 5xx, no severity ≥ ERROR, no FAILED_PRECONDITION, no non-favicon WARNING**; `[proposal]
  generated` ×4 (two sandboxes), `[proposal] decided` ×3, `segment.usage` lines carry tokens + audioSeconds only.
- Proposals list loads (`GET /api/v1/proposals` 200 with `open`, `decided`, `watch`).
- Open (not provable from outside): that SDP ran on each line; that `asia-southeast1` came from `config/regions.yaml`.

## 10. Latencies

Pair 0.3–0.8 s · sign-in 3.5–4.2 s · segment PUT 2–4 s after a line ends · tick every 2 min · End → questions 2 s when the tick
already ran, else 82–162 s ("Preparing your questions") · Jump to closing 2–4 s · next-day 0.5–0.8 s · **Ask → proposal 6.5–12.7 s**
(attempt 1 every time) · Mark feasible / Approve < 3 s · fast-forward 2 s.

## 11. Human manual-test checklist (real phone, Rangga)

1. Read d2-c3 / d3-c2 aloud with a slow count of three between the two lines → in the debrief expect "phone call" AND "correction"
   questions (F-1); answer Yes to the phone call **with a reason that names the problem** — that reason is what the Proposal agent reads.
2. Read the three problem-A lines with the pause → the day record should show one Customer service row with all three lines.
3. With the guide open on "Tap End today", tap End today → check whether "Yes, end" is reachable without collapsing the guide (F-2).
4. On `/pair` with the guide open, tap "Set up" (D7).
5. Finish the 5 cards within 10 minutes of Start (O-3), or expect an auto-stop with the questions still open.
6. After approving proposal #1, look at #2: "Approve · not available" (O-1) — decide what the stage-5 guide should say.

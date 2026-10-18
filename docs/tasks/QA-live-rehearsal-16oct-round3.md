# QA live audio rehearsal, round 3 (16 Oct 2026 01:30–02:15 WIB, demo project only, after R-21)

Target: https://web-33uzb53tza-et.a.run.app (Cloud Run `web`, revision **web-00018-5kp** at 100 % traffic = image 8214be6 =
main after PR #78; project bee6-playground). Driver: the round-2 harness (Playwright 1.64 Chromium, fake microphone
`--use-file-for-fake-audio-capture=<wav>%noloop`, 360×800 mobile emulation with `hasTouch` for the phone, 1280×900 for one
desktop supervisor/owner pass), one persistent profile per sandbox. Firestore read-only with the Admin SDK under ADC
(`r3/fs.cjs`). Logs with `gcloud logging read --project=bee6-playground`. Day wavs = the round-2 concatenations of
`private/rehearsal/d{d}-c{1..5}.wav` (3 s between lines, 9 s between cards); variants `var1/var2/var3.wav`; `ghost.wav` =
d3-c1 + d3-c2. Evidence: screenshots and raw JSON in
`<LOCAL_PATH>/r3/`
(`shots/*.png`, 305 files; `out-*.json`; `bundle/` = the served JS). Run window 18:33Z–19:12Z (01:33–02:12 WIB).
Nothing written outside the four throw-away sandboxes below (TTL 2 h, expire 03:33 WIB). `demo-tpl-outlet` / `demo-outlet`
untouched. No product code edited, nothing pushed, no infra action. Pilot project never touched.

**VERDICT: SHIP for the R-21 scope.** All eleven re-verify items of `docs/tasks/R-21-round2-fixes.md` §8 pass live
(§2 below); the full R-20 regression passes (§8). Round-2 findings F-1, F-2, D4, D5, D6, D7, O-3, O-5, O-6 are fixed;
O-1 and O-2 are as accepted. **One new reproduced finding outside R-21's scope, for Rangga's explicit decision (zero
tolerance): O-7, four demo phones uploading at the same time make Vertex transcribe answer 429 → segment PUT 503 →
"Some speech was not captured" on every phone** (§7). Two phones at once were fine.

## 0. Leftover headless poller (closed)

The headless Chrome polling `/api/v1/capture/config` every 30 s on the new revision was mine: four round-2 `node driver.js`
processes (ports 9333–9336) with Chromium profiles `r2/prof-main|var|ghost|weak` were still alive at 01:30 WIB. Killed before
this run (pids 14268, 14269, 17335, 19836 and their Chromium children). After this run every r3 driver and Chromium is
closed too (`lsof` shows nothing on 9341–9345).

## 1. Sandboxes

| Sandbox | Device | Purpose |
|---|---|---|
| `sbx-906d301f6671` | `jdg-906d301f6671` | main: exact cards days 1–3 → supervisor → owner at 360 px (the judge path) |
| `sbx-6ffa91e30330` | `jdg-6ffa91e30330` | second exact run days 1–3 (one-thread rate ×2) → supervisor → owner at 1280 px |
| `sbx-4f95f6e9b784` | `jdg-4f95f6e9b784` | day 1 left open (20-min auto-stop), day 2 ghost repro (Cancel today) then real day 2, day 3 phone variants (var2) |
| `sbx-a62e5221bb97` | `jdg-a62e5221bb97` | weak case (1 day of CUSTOMER_SERVICE), then variant days (var1, var3) after re-pairing as staff |

A fifth sandbox was refused: `POST /api/v1/demo/session` **429 `rate_limited` "Too many demo sessions from this network
today"** (the cap is 10 sandboxes per IP per UTC day; round 2 plus other sessions from this network had used them). Not a defect.

Entry: `/pair` → guide "Fill in 000000" (sheet collapses, D7) → Set up by touch → "Device set up" → `/capture` "Day 1 of 3 ·
Fri 16 Oct". Pair 0.8–1.9 s. Template history still routine-only (6 ROUTINE_OPS facts, dates 10-13/10-14 after the shifts).

## 2. R-21 checklist (1)–(11)

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | F-1 one PHONE_CALL thread per phone day, both lines; A one CS thread; routine ROUTINE_OPS | **pass, 5/5 phone days one thread** (main d2, main d3, second d2, second d3, ghost real d2) and 2/2 improv phone variants; A 6/6 one thread (main d1/d2, second d1/d2, ghost d2, weak d1); routine 22/22 ROUTINE_OPS. One debrief question per phone day, **no correction question, no CORRECTION thread, no "Waiting for review" row** (the phone row reads "Fact, confirmed by staff") | §3, §4; `out-*-d2-end.json`, `fs.cjs` dumps |
| 2 | Guide example reason text | **pass**: the served lazy guide chunk of web-00018-5kp contains "I did not read the order back to the caller" (1 hit) and not "took a big order on the phone" (0); also "About 20 minutes", "Approve one, reject the other", "Pause for a slow count of three" present | `r3/bundle/lazy.js` |
| 3 | Stage pill on hard loads | **pass**: supervisor day 1 (days_done 1) `/sop` `/proposals` `/reviews` `/devices` `/day` all "Stage 3 of 5"; supervisor day 3 all "Stage 4 of 5" (360 px and 1280 px); owner `/home` `/sop` `/reviews` `/proposals` "Stage 4 of 5" before feasible, "Stage 5 of 5" after (desktop) and "STAGE 5 OF 5" on `/sop`, `/proposals`, `/home` after approval (360 px). Every hard load issued one `GET /api/v1/demo/progress` 200 | `out-*-sup-signin.json`, `out-*-own-signin.json`, `shots/*-pill_*.png` |
| 4 | 360×800 sheet behaviours | **pass**: F-2 — guide open on "Tap End today" (`aria-expanded=true`), ONE `page.tap` on End today → `aria-expanded=false`, confirm card rendered, `elementFromPoint` at the centre of "Yes, end" = that button, touch landed → `POST …/end` 200: **10 of 10 day-ends** (main ×3, second ×3, weak ×3, ghost ×1). D7 — `/pair` Fill in → `aria-expanded=false`, `elementFromPoint` on Set up = "BUTTON:Set up", touch paired: 4/4 (+1 re-pair). Modal — owner `/home` with the guide open: the in-sheet "Reset the demo" control opens `role=alertdialog aria-modal=true`; a touch inside the dialog leaves the sheet open; Cancel closes the dialog and focus returns to the in-sheet trigger (`activeElement` = BUTTON "Reset the demo", inSheet true, not body); sheet still open. Mid-card — `/capture` day 3 after card 1 was tapped: a touch on the page header collapses the sheet; re-open shows the same "Card 2 of 5" with "I have spoken this" still disabled; the remaining 4 cards continued normally | `shots/m-d2-after-end-tap.png`, `m-pair-after-fill.png`, `m-own-reset-dialog.png`, `m-own-reset-after-cancel.png`, `g-d3-mid-collapsed.png`, `g-d3-mid-reopened.png` |
| 5 | Proposal wording | **pass** on 5 of 5 proposals (texts in §5): no `[staff]`, no `(role:`, no ISO date, no "name"/"phone number"; B says "order details and pickup time on an order slip" | `fs.cjs … proposals` |
| 6 | favicon | **pass**: `curl -sI /favicon.ico` → 200 `image/svg+xml` (also `/icon.svg`); Cloud Logging since the deploy: only INFO 200 lines for favicon, zero 404 WARNING; the four drivers' console logs: 0 favicon errors, 0 non-503 errors | §9 |
| 7 | D5 | **pass** ×4: `/sign-in` after staff sign-out shows no "Signed in as" text, `<html>` carries `b6-panel-reserved` only (no `b6-topbar-reserved`), and "You are continuing your demo (ends 03:33)" is shown | `shots/w-signin-supervisor.png`, `m-sup-signin-supervisor.png` |
| 8 | 20-min auto-stop | **pass**: `GET /api/v1/capture/config` → `demo_session.max_ms: 1200000`; a day-1 session left open (`sbx-4f95f6e9b784`, start 18:33:33Z) ended by itself: `end_reason: auto_stop`, `ended_at − started_at = 1,200,748 ms`, `auto_stop_at_ms = start + 1,200,000`; the page reached "Debrief complete · There are no questions today" by 18:53:34Z with no tap | `shots/g-d1-autostop.png` |
| 9 | SOP book tabs | **pass**: before approval "Version 1 · 09/10/26 · current"; after approving A: tabs **"09/10/26 · current" \| "17/10/26 · upcoming"**, "Steps in version 2", "Improved with Bee6 1", Changes "Version 2, from Sat 17 Oct … Review on Sat 31 Oct · Approved on Fri 16 Oct"; after `reviews/fast-forward` the tabs are unchanged. `GET /api/v1/sop`: latest v2 effective 2026-10-17. (The first-version date is relative to the sandbox's today: 09/10/26 tonight, 08/10/26 in round 2.) | `shots/m-own-sop-after.png`, `n-own-sop-after.png` |
| 10 | skew log | **pass for the threshold**: 21 `[pipeline-tick] skew` lines in 18:30Z–19:12Z, all for `device_id: 'demo-tpl-phone'` with `skew_newest_ms: 74629977` (20.7 h, the seeded template segments) — a genuine > 60 s skew that the rule logs by design; **zero** lines for my four devices (2–4 s upload latency), round 2 had 5 per tick | gcloud |
| 11 | R-20 regression | **pass** (§8) | |

## 3. Day × card table — exact cards (main `sbx-906d…`; the second run `sbx-6ffa…` is identical in shape)

Transcript = stored `segments.lines[].text` / thread lines; label = thread category / confidence / status. **Dropped lines: 0 of
21 (main), 0 of 21 (second run).**

| Day·card | Heard | Label | One thread | Result |
|---|---|---|---|---|
| 1·1 Opening | full | ROUTINE_OPS 0.95 fact | — | pass |
| 1·2 First bake | full | ROUTINE_OPS 0.9 fact | — | pass |
| 1·3 Problem A | 3/3 ("…nobody writes the baking time on the tray…") | CUSTOMER_SERVICE 0.95 fact, runner-up COMPLAINT ("did not express dissatisfaction") | **yes** (3 lines) | pass |
| 1·4 Display check | full | ROUTINE_OPS 0.9 fact | — | pass |
| 1·5 Closing | full | ROUTINE_OPS 0.95 fact | — | pass |
| 2·1 Opening | full | ROUTINE_OPS 1.0 fact | — | pass |
| 2·2 Problem A | 3/3 | CUSTOMER_SERVICE 1.0 fact, "Customer asking about egg tart freshness and making a purchase." | **yes** (3 lines) | pass |
| 2·3 Problem B | 2/2: "Hello, Demo Bakery, thanks for calling. Yes, we can do 50 egg tarts for tomorrow morning, pick up at 10:00…" / "That was a phone order for tomorrow. I did not read the order back to the caller before hanging up, so I am not sure the quantity and the pickup time are right." | **PHONE_CALL 1.0** → question → Yes → fact (`staff_confirmed`), summary "Phone order taken for tomorrow morning with a self-correction note." | **yes** (2 lines, no CORRECTION) | pass (round 2: split) |
| 2·4 Display check | full | ROUTINE_OPS 1.0 fact | — | pass |
| 2·5 Closing | full | ROUTINE_OPS 1.0 fact | — | pass |
| 3·1 Opening | full | ROUTINE_OPS 0.95 fact | — | pass |
| 3·2 Problem B | 2/2: "…A birthday cake and 20 croissants for Saturday, pick up at 3:00 or 4:00? …" / "That was another phone order. I hung up without reading the order back to the caller, so I hope I got the pickup time right." | **PHONE_CALL 1.0** → question → Yes → fact; summary "Taking a phone order for a birthday cake and croissants with pickup scheduled." (second run: PHONE_CALL 0.95, runner-up CUSTOMER_SERVICE) | **yes** (2 lines) | pass (round 2: split) |
| 3·3 Second bake | full | ROUTINE_OPS 0.9 fact | — | pass |
| 3·4 Display check | full | ROUTINE_OPS 0.9 fact | — | pass |
| 3·5 Closing | full | ROUTINE_OPS 0.95 fact | — | pass |

Labels **15/15** on both exact sandboxes (30/30). Phone days one-thread rate on the exact cards: **4/4** (plus the ghost
sandbox's real day 2: 5/5). Day 3's opening and closing were not merged this time (round-2 O-4 did not recur).

## 4. Debrief

| Sandbox·day | End → first screen | Questions | Answers |
|---|---|---|---|
| main 1 / second 1 / weak 1 | "Debrief complete · There are no questions today." after 92 s / 22 s / 22 s | 0 | — |
| main 2 | "Preparing your questions" 172 s → Question 1 of 1 | "Around 01:44 there was a phone call. Is that right?" | Yes + reason; POST …/answer 200 `answered`; "Thank you. Today's only question is answered and today is closed." |
| main 3 | 162 s → Question 1 of 1 | "Around 01:52 there was a phone call…" | Yes + reason; "All 3 demo days are done. Sign out and continue as Supervisor." Jump gone |
| second 2 / second 3 | 172 s / 203 s → Question 1 of 1 | one phone-call question each | Yes + reason each |
| ghost real 2 (after a cancelled session) | 212 s → Question 1 of 1 | "Around 02:02 there was a phone call…" (**1, not 2**: zero ghosts) | Yes + reason |
| ghost 3 (var2, two different phone orders) | Question 1 of 2 | two phone-call questions (two events, correct) | Yes ×2 |
| weak 2 (var1) / weak 3 (var3) | no questions (all CUSTOMER_SERVICE facts) | 0 | — |

Correction docs: `answer: "yes"`, `reason_text` (my typed reason), `answered_device_id` only, no role, no name,
`needs_supervisor_confirm: false` (hard rule #7 ok). ≤ 2 questions on every day; phone days exactly 1.

## 5. Proposals (5 of 5 Asks produced a proposal on attempt 1; `generator`: adk, gemini-3.5-flash, asia-southeast1, proposal-v3, pgate-v1, floor-v2)

Watch panel before the Asks (main): "Customer service · seen on 2 of 2 days needed · Ready", "Phone call · … · Ready"
(`GET /api/v1/proposals` watch: CS facts 2/dates 2, PHONE_CALL facts 2/dates 2). After both: "All asked · no more evidence to use" (disabled).

**Main sandbox, Ask → 201 in 7.6 s, focus CUSTOMER_SERVICE** (`c776c199…`, `add_record_step`, NEW step):
- Title "Record baking time on tray labels"
- Change text: "Write the baking time on the tray label immediately when placing a fresh tray on the display."
- Rationale: "On two days, customers asked when the egg tarts were baked, but staff could not answer because the baking time was not recorded. Adding a step to write the baking time on the tray label when it is placed on the display will ensure staff can answer customer questions accurately."
- Metric: "Daily count of customer service queries about freshness where staff cannot provide the exact baking time." baseline 2 in 5 days; failure "A customer asks for the baking time of an item and staff cannot answer because the label is blank."; review after 14 days (card: Fri 30 Oct at proposal time, Sat 31 Oct once approved after midnight WIB). Evidence Wed 14 Oct 01:38 + Thu 15 Oct 01:43 (thread ids only).

**Main sandbox, Ask for another → 201 in 5.8 s, focus PHONE_CALL** (`2136ce27…`, `add_record_step`, NEW step):
- Title "Record phone orders"
- Change text: "When taking an order by phone, write the order details and pickup time on an order slip, read these details back to the caller to confirm them, and place the slip on the order board before hanging up."
- Rationale: "On two days, staff took phone orders but hung up without reading the details back to the caller, leaving them unsure of the correct quantity and pickup time. Adding a record step ensures that order details and pickup times are written down, verified with the customer, and stored in a shared location."
- Metric: "The daily count of phone calls where staff do not read back the order details and pickup time to the caller."; failure "Staff take a phone order but do not read the details back or fail to write them on an order slip."; evidence Thu 15 Oct 01:44 + Fri 16 Oct 01:52.

**Second sandbox (desktop), Ask 7.4 s / Ask for another 7.2 s:**
- A (modify `bake-01`): "Bake the first tray of each bread by opening time, and write the baking time on the tray label as soon as the tray is placed on the display." Rationale "On two days, customers asked about the freshness and baking time of items on display, but staff could not answer accurately because the baking times were not recorded. …"
- B: "Record and confirm phone orders" — "When taking a phone order, write the order details and pickup time on an order slip, read these details back to the customer to confirm, and place the slip on the order board." Rationale "On two days, staff took phone orders but hung up without reading the details back to the customer, leaving them unsure if the quantity or pickup time was correct. …"

**Weak/variants sandbox (CS 8 facts / 3 dates, no other category):** Ask 6.4 s → 201 CS "Write the baking time on the tray
label immediately when a tray is taken out of the oven." — rationale "Customers on multiple days asked …"; "Ask for another"
absent ("All asked"). Grep over all five `change_text` + `rationale`: `\[staff\]` 0, `\(role:` 0, `\d{4}-\d{2}-\d{2}` 0,
`phone number` 0, `name` 0. The PHONE_CALL excerpt now carries the problem itself (both lines in the thread), so B no longer
depends on the typed debrief note.

**Weak case (one day of CUSTOMER_SERVICE):** watch "Customer service · seen on 1 of 2 days needed · Needs 1 more day", button
"Not enough evidence yet" disabled, `state: needs_more`; no `[proposal]` log line for that outlet until its variant days gave
it 3 dates → no model call on the weak state (plain-code floor).

## 6. Supervisor → owner → SOP v2 → review → Home (main at 360 px; repeated on the second sandbox at 1280 px)

- Staff Sign out → entry page → `/sign-in?as=supervisor` → Fill in → Sign in 4.1 s → `/day/2026-10-16`: "Facts: 5 · Questions: 0",
  rows "Fact, confirmed by staff", no device id anywhere on supervisor or owner screens (grep of every page text for `jdg-`: none).
- `/proposals`: Ask ×2 (§5) → "Open" each → "Mark feasible" → `POST …/review` 200 `{feasible, awaiting_owner}` ×2; list "Waiting for owner approval".
- Supervisor SOP book: "Version 1 · 09/10/26 · current", "From your SOP 5 · Improved with Bee6 0".
- Sign out → `/sign-in?as=owner` → Sign in 3.2 s → `/home`: "Waiting for your approval · 2 … Supervisor marked it feasible", Progress APPROVED 0.
- Approvals: "0 of 2 decided · #1 Record baking time on tray labels · Reviewing now · #2 Record phone orders · Waiting for you";
  **Approve** → `POST …/approve` 200 `{approved}` → "Approved. It ships as a new SOP version." "#1 … Approved · Shipped as SOP version 2".
  #2 now "Approve · not available — The SOP changed after this was drafted. You can still reject it with a reason." with the
  guide card "Approve one, reject the other" (O-1, by design, copy present).
- Owner SOP book: tabs **"09/10/26 · current" | "17/10/26 · upcoming"** (item 9). Firestore `sop_versions/sbx-…:v2` exists.
- Reviews: "Fast-forward to the review date (simulated)" → `POST /api/v1/reviews/fast-forward` 200 `{version: 2}` → "Simulated
  review created · Waiting for a verdict · SOP version 2: review on Sat 31 Oct · Before (Sat 10 Oct to Fri 16 Oct): 2 in 5 captured
  days, 0.4 per day · After (Sat 17 Oct to Fri 30 Oct): no captured days · … Waiting for the supervisor's verdict by Sat 7 Nov".
- Home after approval: "Waiting for your approval · 1", "APPROVED 1 · started, waiting for review", "NEXT REVIEW Sat 31 Oct …".

## 7. Findings (zero tolerance; reproduced; Rangga decides)

**R-21 scope: no defect.** One finding outside R-21's scope:

- **O-7 [major, environment/quota] Four demo phones uploading at once → Vertex transcribe 429 → segment PUT 503 → every phone
  shows "Some speech was not captured. That note is now incomplete."** Repro: four sandboxes started `day1.wav` within the same
  second at 18:34:2xZ; Cloud Run: `segment.upstream_unavailable { stage: 'transcribe', upstream: 429 }` ×81, `PUT /api/v1/segments/…`
  **503 ×81 vs 200 ×17** in 18:34:25–18:35:52Z (`{"error":{"code":"SERVICE_UNAVAILABLE","message":"Transcription upstream unavailable"}}`);
  the client retried each segment a few times then gave up and the page showed the "not captured" notice; the four day-1 sessions
  were unusable (2–6 lines heard of 7). With **two** phones in parallel (the rest of the run) there was not a single 503 (95 × 200
  after the burst, 0 × 5xx). Round 2 ran four in parallel without this, so the limit is shared/variable (the preview model on
  `global`). Effect for judging day: if ≥ 3–4 judges read cards at the same minute, their notes go missing and the journey breaks.
  Not an R-21 regression; dev-ops should check the `gemini-3.5-transcribe-preview` quota on bee6-playground and the judge
  schedule should stagger starts. Evidence: `r3/out-m-d1.json`, `drv-*.log`, gcloud query in §9.

Observations (not defects):
- **O-8** the SOP first-version tab date is relative to the sandbox's today (09/10/26 tonight, 08/10/26 in round 2); judges in daytime see 09/10/26 as well.
- **O-9** `POST …/approve` and `POST …/review` validate the body and look up the proposal before the role check: a wrong role with an
  invalid body gets 422, with an unknown id 404; with a **valid** body the role check answers 403 ("Role supervisor may not perform
  proposals:approve", "Role owner may not perform proposals:review"). The route still rejects; only the error ordering differs.
- **O-10** the guide collapses itself when the capture phase changes (by design); opening it between Start and "Listening"
  (my harness at +2.5 s on the slow, 429-retrying server) made it close again once "Listening" arrived. A judge who opens the guide
  after "Listening" shows never sees this (0 self-collapses in 11 later day runs).
- **O-11** my harness's End came ~105 s after Start on the variant days, before the 160–200 s variant wavs had finished, so the
  last clips of var1/var3 (`d2-c2.old`, `real-d1-opening`, `d2-c3.old`, `d3-c2.old`) and of var2 (`real-phonecall`, the two `.old`
  phone cards, `real-d2-closing`) were not played. Harness artefact, not a product drop; those clips are the round-2 controls.
- **O-12** the supervisor day record shows "Sessions cancelled: 1" after a Cancel today (honest, fine).
- **O-13** the `debrief.answer_uploaded` audit entry carries `details.device_id` (R-07 era, not new); no supervisor/owner route lists audit rows.

Round-2 findings re-checked: **F-1 fixed** (5/5 one thread, 2/2 on improv variants). **F-2 fixed** (10/10 by real touch). **D4 fixed**
(13 hard loads, two roles, two viewports). **D5 fixed** (4/4). **D6 fixed** (200 svg, zero 404 in logs/console). **D7 fixed** (5/5).
**O-3 fixed** (20 min). **O-5 fixed** ("· upcoming"). **O-6 fixed** (only a > 60 s skew still logs). **O-1, O-2** unchanged by decision.
**D3 residual** (round-2 §8) unchanged on the variants: the ≈ 4 s customer question + 2–3 s gap + staff answer shape still drops the
staff line (§8 table); the rewritten exact cards dropped nothing (0/42 lines).

## 8. Regression (R-20 "done when") and variants

- **Labels 15/15** on both exact sandboxes; debrief ≤ 2 per day (phone days 1); Ask A then "Ask for another" B on attempt 1 (×2 sandboxes);
  supervisor feasible → owner approve → SOP v2 + review date + Home (×2); weak case suppressed with no model call; 4th jump:
  `POST /api/v1/demo/next-day {expected_day: 3}` → **422** (`invalid_union`; the schema allows 1|2) and the UI hides "Jump to tomorrow"
  after day 3; sign-out/re-entry: staff → entry → supervisor → owner all land in the same sandbox ("You are continuing your demo"),
  and `/pair` after a supervisor session re-pairs the **same** device (`jdg-a62e5221bb97`).
- **"Cancel today" ghost cleanup (D2):** ghost sandbox day 2 = `ghost.wav` (opening + phone card) → one tick (threads ROUTINE_OPS +
  PHONE_CALL, 1 open question) → browser relaunched → `/capture` "Today's session was interrupted. Cancel it and start today again."
  → **Cancel today** → `POST …/discard` **202 `{ok:true, cleanup:"pending"}`** (0.3 s) → next tick (**83 s** later): tombstone
  `cleanup_done_at_ms` set, audit `capture.session_cleanup` `{threads_deleted: 2, questions_deleted: 1, corrections_deleted: 0,
  segments_deleted: 0}` (the route's own `capture.session_discarded` says `segments_deleted: 3`), zero ghost threads/questions left;
  the real day 2 then produced **1 question (not 2)**. Three more discards in the run (the 429-ruined day-1 sessions on main/second/weak)
  were cleaned the same way (`threads_deleted` 0/3/0, each within one tick, no `cleanup_failed`).
- **RBAC probes (live, real bearers):** supervisor → `GET /api/v1/home` 403 "may not perform home:read", `GET /capture/config` 403
  "A device credential is required", `POST /demo/next-day` 403, `POST /demo/reset` 403 "Only the owner can reset the demo",
  `POST …/approve` (valid body) **403** "may not perform proposals:approve"; owner → `GET /questions` 403, `POST …/review` (valid body)
  **403**, `POST /threads/{real id}/confirm` 403 "labels:confirm", `GET /capture/config` 403; device credential → `GET /proposals`,
  `/home`, `/sop`, `POST /demo/reset` all **401** "Invalid or expired token"; no bearer → 401 "Missing bearer token" on `/proposals`,
  `/sop`, `/day/…`.
- **Hard rules at runtime:** no audio/base64 in any Firestore doc of the four sandboxes (scan of every string field > 1500 chars or
  base64-shaped, every Buffer: none) nor in any log line (`base64`, `audio/`, `data:audio`: 0); segments hold `lines[].text`, `model:
  gemini-3.5-transcribe-preview`, `location: global`; answers store `answered_device_id` only; no person's name anywhere (model text
  uses "staff", "customer", "caller"); proposal docs record `location: asia-southeast1` for gemini-3.5-flash (whether it came from
  `config/regions.yaml` is not provable from outside); 360 px screens: no horizontal overflow seen in 305 screenshots.
- **Variants (improv/real/old, w and g sandboxes):**

| Clip | Stored lines | Label | Note |
|---|---|---|---|
| improv-d1c3 | customer question / "But I cannot be sure." — **staff sentence dropped** (round 2: 3/3) | CUSTOMER_SERVICE 0.95 fact | drop (D3 shape) |
| real-q1-staff-a + b | 2/2 | CUSTOMER_SERVICE 0.95 (round 2: STAFF_CONSULT 0.9) | label flips between runs on this clip |
| improv-d2c2 (×2 plays) | customer line + "That is okay. I will have one." — **staff line dropped** both times | CUSTOMER_SERVICE 0.98 / 1.0 | drop (same as round 2) |
| d1-c3.old (×2 plays) | customer + staff merged in one segment (heard) + closing line | CUSTOMER_SERVICE 0.98 / 1.0 | pass |
| d2-c2.old | customer line + "All right, I will have one…" — **staff line dropped** | CUSTOMER_SERVICE 1.0 | drop (same as round 2) |
| real-q2-customer + staff | 2/2 | CUSTOMER_SERVICE 1.0 | pass |
| improv-d2c3 | 2/2 | **PHONE_CALL 1.0, one thread**, "Phone order for egg tarts with self-correction on missing readback." | pass |
| improv-d3c2 | 2/2 | **PHONE_CALL 1.0, one thread** | pass |
| real-d1-opening, d2-c3.old, d3-c2.old, real-phonecall, real-d2-closing | not played (O-11) | — | — |

Variants: 4 drops in 20 lines played, all the same D3 shape; exact cards 0 drops in 42 lines (plus 7 on the ghost real day).

## 9. Logs (Cloud Run, read-only, 18:30Z–19:12Z)

`PUT /api/v1/segments/`: 95 × 200, 81 × 503 (all 503 inside the four-phone burst 18:34:05–18:35:52Z, O-7). Outside the burst:
**no 5xx, no severity ≥ ERROR, no FAILED_PRECONDITION, no cleanup_failed**; WARNING entries are only my own probes' 401/403/422 and
zero favicon entries (favicon lines are INFO 200). `[proposal] generated` ×5, `[proposal] decided` ×6, `[pipeline-tick] skew` ×21 (all
`demo-tpl-phone`, 74,629,977 ms), `segment.usage` lines carry tokens + audio seconds only.

## 10. Latencies

Pair 0.8–1.9 s · sign-in 3.2–4.3 s · segment PUT 2–4 s after a line ends (one phone or two) · tick every 2 min · End → "no questions"
22–92 s, End → first question 162–212 s ("Preparing your questions") · Jump to closing 0.23–0.43 s · next-day 0.46–0.49 s · Cancel today
0.3 s + cleanup ≤ 83 s · **Ask → proposal 5.8–7.6 s** (attempt 1, 5/5) · Mark feasible / Approve < 3.5 s · fast-forward ~2 s ·
auto-stop at +1,200,748 ms.

## 11. Human manual-test checklist (real phone, Rangga)

1. Read d2-c3 / d3-c2 aloud with a slow count of three between the two lines → expect exactly ONE "phone call" question in the debrief and no "correction" question; after Yes, the supervisor day record shows one "Phone call · Fact, confirmed by staff" row with both lines.
2. With the guide open on "Tap End today", tap End today with your thumb → the sheet should drop and "Yes, end" be reachable without touching the handle (F-2); same on `/pair`: Fill in → Set up (D7).
3. Owner Home with the guide open: tap the guide's "Reset the demo" → tap the dialog text (sheet should stay) → Cancel (the guide should still be open) — then do NOT press Reset.
4. Leave a session open and do nothing for 20 minutes → it should end by itself and go to the debrief (O-3).
5. If several judges will run at the same time, start them a minute apart or have dev-ops raise the transcribe quota first (O-7).
6. Hard-reload `/sop` as supervisor and `/home` as owner on the real phone → the handle must not read "Stage 1 of 5" (D4).

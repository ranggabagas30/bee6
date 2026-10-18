# QA: after days 4-5, early fast-forward, retry-after-End and Jump wait on web-develop (Sun 18 Oct 2026, 13:00 to 14:25 UTC)

Target: https://web-develop-33uzb53tza-et.a.run.app, Cloud Run `web-develop`, image tag `9a74fe2` (develop).
First revision tested `web-develop-00063-nts`. At 13:14 UTC the shared daily model cap ran out (see "Run history"), Rangga approved a cap raise, and the rest ran on
`web-develop-00064-2gd` (same image 9a74fe2; DEMO_MODEL_DAILY_CAP=1000, DEMO_SEGMENT_DAILY_CAP=1500, DEMO_GENERATE_DAILY_CAP=80; PROPOSAL_AGENT_V4=true, DEBRIEF_AGENT=true,
FIRESTORE_DATABASE_ID=staging), read back with `gcloud run services describe` before resuming.
Driver: Playwright Chromium headless, fake microphone (macOS `say` clips, fictional text copied from `lib/demo/script.ts`), one fresh persistent profile per sandbox, a
Playwright `page.route` for the synthetic 503s. Claude-in-Chrome not used. No product code edited, nothing pushed or merged, `web` and the pilot never touched.
**3 sandboxes**, started one after another: **A5** (360x640 phone for staff, 1280x800 for Supervisor/Owner; 5-day path), **B3** (360 phone, 1280; 3-day regression plus Jump wait),
**C4** (360 phone; retry-after-End scenarios).

Evidence root (session scratchpad), `qa18/`:
`<LOCAL_PATH>/qa18/`
(`out-s6day-*`, `out-s6jump-*`, `out-s6own-*`, `out-s6approve-*`, `out-s6ff-*`, `out-r4verdict-A5-*`, `out-s6cancel-*`, `out-s6supday-*`, `out-s5sup-*`, `shots/*.png`, logs in `s6/`;
harness in `pw/` (`s6day.js`, `s6jump.js`, `s6cancel.js`, `s6owner.js`, `s6approve.js`, `s6ff.js`, `s6supday.js`, `rbac3.js`); audio `audio/day4.wav`, `day5.wav`, `day1x/2x/3x.wav` (day + one extra tail note), `audio/make-after.sh`).

## VERDICT: DO-NOT-SHIP (zero tolerance): 1 major and 4 minor reproduced defects, plus parts of the brief not proven

What works on the live build: the 5-day path end to end (days 4 and 5 cards, stage pills 6 and 7, the plain-code verdict "Worked", the "All 5 demo days are done" line), the
3-day path, `approve_first` versus `max_days` versus `review_exists`, the empty-after-days fast-forward ("no suggestion"), the 25 s Jump wait, retry growth and the 240 s give-up
with the "Some speech was not captured" notice, sign-out with queued failing uploads, and the no-auth RBAC probes. The defects are in the new retry-after-End behaviour (a delivered
late note never reaches the day record; a stale "retrying" row after the Jump abort) and in review dates and copy. See DEFECTS.

## Run history (what happened, in order)

1. 13:01 to 13:14 UTC: A5 days 1-3, B3 day 1 (Jump wait), all fine.
2. 13:14 UTC: B3 day 2 PUTs and A5 `POST /api/v1/proposals/generate` returned **429 `demo_model_cap`** ("The demo has reached today's usage limit"). Read-only log count since 00:00 UTC:
   257 x 200 segment PUTs + 15 x 201 generate before this. I stopped all runs, told the PM, and spent nothing until the revision with the raised caps was serving.
3. 13:26 onwards on 00064-2gd: B3 day 2-3 (re-run after cancelling the interrupted day-2 session), A5 supervisor, owner, days 4-5, early/late fast-forward, verdicts, C4 retry scenarios.
4. Harness mistakes I made and corrected (not product defects): (a) my first owner script approved the first approvable proposal ("Morning bake and label") on A5, so A5's reviewed change is
   the tray-label change, not the read-back change the brief named; (b) a leftover owner session and the Bahasa toggle made two scripts fail to find English buttons, so they were re-run;
   (c) on day 4 I answered the one question "No" (the call did happen; the harness has an `answer=no` flag that was right for the old problem days, wrong here).

## Results table

| # | Brief item | Viewport | Result | Evidence |
|---|---|---|---|---|
| 1a | Days 1-3 "as before" on A5 | 360 | PASS | `out-s6day-A5-{1,2,3}.json`: End to question 142.2 s (d1 no question, "Debrief complete"), 101.5 s (d2), 131.7 s (d3); axe 0 violations on every question screen EN and ID; 0 console errors; `Jump to tomorrow` d1 and d2 posted at once (HTTP 200 in about 1.3 s) |
| 1b | Owner approves a change, then Jump to tomorrow to day 4 | 1280 + 360 | PASS, with the caveat in Run history 4(a) | supervisor Ask: 2 proposals in 29.0 s (`201, 201`), both "CHECKED BY BEE6 · 19 OF 19 CHECKS", marked feasible; owner approved "Morning bake and label" (SOP v2, starts Mon 19 Oct) and rejected "Take phone orders"; phone day 3 drawer then read "STAGE 6 OF 7 ... The Owner approved a change. Jump to tomorrow to run day 4 with the new SOP."; jump 200 |
| 1c | Day 4 staff cards d4-* (read-back card = two staff lines, spoken with a 3 s pause) | 360 | PASS | cards 1-5 in order with titles Opening / First bake, labelled / A phone order, read back / Display check / Closing; all enabled and tapped; 0 horizontal overflow; supervisor day record: 4 work notes incl. "Taking a phone order for 30 croissants on Friday and confirming details by reading back." |
| 1d | Day 4 debrief, jump to day 5 | 360 | PASS | question on the phone "Around 20:34, was there a phone call for croissants for Friday?" (agent wording; the supervisor record shows the template "Around 20:34 there was a phone call. Is that right?", same known OBS as the earlier round), answered; 112.2 s End to question; Jump 200 in 0.7 s, no "Finishing" flash; drawer "STAGE 6 OF 7 Day 5 of 5" |
| 1e | Day 5 cards d5-*, drawer after day 5 | 360 | PASS | 5 cards in order; End to "Debrief complete" 142.2 s (no question); drawer "STAGE 7 OF 7 ... That was the last demo day. Sign out, continue as Supervisor, and open Reviews. All 5 demo days are done."; the Jump button is absent (not shown on day 5) |
| 1f | Reviews: "Fast-forward to the review date", plain-code verdict | 1280 | PASS (label change; see 1b caveat) | `out-s6ff-A5-l1280-owner.json`: "Simulated review created." in 0.26 s; card "SOP VERSION 2 · REVIEW ON SAT 31 OCT, Morning bake and label"; **BEFORE 2 in 5 captured days, 0.4 per day (Sat 10 Oct to Fri 16 Oct); AFTER 0 in 2 captured days, 0.0 per day (Sat 17 Oct to Fri 30 Oct); "Bee6 suggests: Worked ... moved the right way by 100%"**; "This is a short window, so read the numbers with care." |
| 1g | Verdict chain and stage 7 cards | 1280 | PASS | supervisor "Worked" ("Verdict saved."), owner "Worked" ("Confirmed. Remembered as: Worked"), reviews page DECIDED; guide cards in order: stage 5 "Owner home" -> stage 6 "All decided / run days 4 and 5" -> stage 7 "Fast-forward to the review date" (todo list) -> stage 7 "Give your verdict" -> stage 7 "The loop is closed" |
| 1h | Bahasa, axe, console on the review path | 1280 | PASS | Reviews page ID text renders ("Tinjauan", "Saran Bee6: Berhasil", dates "Sab 31 Okt"; model text for the step title and metric stays English); axe 0 violations on `/proposals` owner, `/reviews` before and after fast-forward (EN), question screens EN+ID; 0 console errors and 0 responses >= 400 on every supervisor/owner run |
| 2a | 3-day path regression (B3): day 3 approve_first | 360 | PASS | B3 day 3 drawer: "STAGE 4 OF 7 ... Days 4 and 5 open after the Owner approves a change. Sign out and continue as Supervisor." (not `max_days`); same on A5 day 3 |
| 2b | Owner approves, fast-forward on the empty after-days | 1280 | PASS | B3: owner approved "Take phone orders" (the read-back change, SOP v2, review Mon 26 Oct) and rejected the label one; early fast-forward: "Simulated review created."; BEFORE "2 in 5 captured days, 0.4 per day", AFTER "no captured days / No rate yet", "Bee6 has no suggestion: fewer than 2 captured days in one of the windows"; stage pill 7 OF 7 and the "Give your verdict" card |
| 2c | Owner rejects everything: guide stays sane | n/a | NOT RUN | needs a 4th sandbox (3 + proposals); B3 rejected one proposal only |
| 3a | Day 3 without approval shows `approve_first`, not `max_days` | 360 | PASS | A5 d3, B3 d3 (above) |
| 3b | Fast-forward early, then back on the phone: `review_exists` | 360 | PASS | B3 after the early fast-forward: phone main text "A review already exists, so the demo days are finished. Sign out and open Reviews."; no Jump button; drawer "STAGE 7 OF 7" |
| 3c | `max_days` on day 5 | 360 | PASS | "All 5 demo days are done. Sign out and continue as Supervisor." (A5 d5, on the page and in the drawer) |
| 4a | Retry after End, flag flipped after about 60 s (C4 day 1) | 360 | PASS for the phone; FAIL for the day record (DEFECT 1) | End at 13:32:34 with the extra tail clip failing; PUTs kept coming after End; flag off 60.0 s after End; next PUT delivered HTTP 200 at 13:34:17.9; retry row text cleared by the 82 s sample; no "not captured" notice |
| 4b | 250 s give-up (C4 day 2) | 360 | PASS | failing PUTs at +0.6, 8.0, 16.7, 39.5, 68.7, 84.4, 112.6, 136.7, 165.0, 190.3, 218.3, 234.0, 250.5 s after End (gaps grow to 29 s, none above 30 s); no PUT after 250.5 s (the flag stayed on to 295 s, 0 more); notice "Some speech was not captured / That note is now incomplete. It cannot be recovered. Dismiss" in the first sample after the last PUT (252.2 s) |
| 4c | Batalkan with a queued failing segment | 360 | PASS via the sandbox path (see note) | the listening screen has no "Cancel session" button on a sandbox; the cancel route is "Sign out (cancels today's session)". With card 2 failing and the row "Not sent yet · retrying (3x)": confirm "Sign out and cancel" at 14:16:41.9; last PUT at +0.4 s; 70 s window afterwards: 0 PUTs; POST `/capture/sessions/<id>/discard` 202. "Cancel today" on an interrupted session (no queue) returns 202 with no dialog (`out-cancel-C4.json`, `out-cancel-B3.json`) |
| 4d | Sign out with queued failing uploads | 360 | PASS | same run as 4c: redirect to `/` in 0.95 s, 0 PUTs in the 70 s after the redirect (the route stays installed across the client navigation) |
| 4e | JUMP WAIT (B3 day 1, tail note failing, flag on until after the Jump) | 360 | PASS for the wait; DEFECT 2 for what stays on screen | tap at +0.03 s: button label "Finishing uploads…" and disabled; shift `POST /api/v1/demo/next-day` 200 at 25.6 s; day 2 ready screen; flag turned off right after the Jump; 0 PUTs for the remaining 230 s; supervisor day records of B3 (days 1, 2, 3 after they ran) contain no "back door / kitchen lights" note in any day |
| 4f | Jump with nothing pending | 360 | PASS | A5 d1 to d4, B3 d2, C4 d1, d2: the button never showed "Finishing uploads…", POST 200 within 0.5 to 1.3 s |
| 5 | Hard-rule runtime checks | n/a | PASS | below |
| 6 | Wait times | n/a | recorded | below |

## DEFECTS (most severe first)

1. **[major, needs Rangga] A note delivered after End by a retry is stored but never appears in the supervisor day record.**
   Repro: sandbox C4, day 1, wav `audio/day1x.wav` (the 5 day-1 cards plus one extra note "One more note before I go. I locked the back door and switched off the kitchen lights."),
   `QA_FAILFILE` set after card 5 so the extra note's PUT gets a synthetic 503; tap End; remove the flag 60 s after End. The PUT of that segment is delivered `200` at 13:34:17.9
   (Cloud Run request log: `PUT ... 200 1.66 s`) and the phone row clears. Open the Supervisor Day record for that day at 13:39, 13:42 and 14:20 (45 minutes later, `out-s6supday-C4-p360-*.json`):
   still **5 work notes, the extra note is not there**, and not under any other day. A read-only Firestore query (staging, `segments` where `device_id` = C4's device, one query, a boolean on the
   text, nothing printed or saved) showed the segment document exists with 1 redacted line containing the text. So it is stored, but no thread or note is ever built from it. Expected (brief and
   spec section "late delivery only, no coverage loss"): the note appears in the day record. Dev-ops: see log-check 3.
2. **[minor] After the Jump aborts a still-retrying upload, the new day's ready screen keeps showing "Not sent yet · retrying (12x) Server busy" forever.**
   Repro: B3 day 1 with the failing tail note (command in Evidence), End, wait for "Debrief complete", tap Jump to tomorrow: after 25.6 s day 2 shows "Ready to open" but the upload line above the orb still
   reads "Not sent yet · retrying (12x) · Server busy" for the whole 230 s I watched, although 0 PUTs were sent after the abort (`out-s6day-B3-1-jumpwait.json` samples, `shots/B3-p360-d1-tomorrow.png`).
   Expected: the retry row disappears (and, since the note is dropped, arguably the "Some speech was not captured" notice, which was not shown either).
3. **[minor] Review date shown inconsistently on A5.** The owner's approval summary says "The approved change starts on Mon 19 Oct and is reviewed on Mon 2 Nov" (`out-s6own-A5-l1280-approve.json`), but after the
   fast-forward the Reviews card reads "SOP VERSION 2 · REVIEW ON SAT 31 OCT" with the verdict due "by Sat 7 Nov", and the After window "Sat 17 Oct to Fri 30 Oct" starts before the SOP start date (Mon 19 Oct).
   B3 is consistent (approval "Mon 26 Oct", Reviews "REVIEW ON MON 26 OCT"). It differs on the sandbox that ran days 4 and 5 (the simulated clock moved). Possibly the intended simulated-time behaviour, but a judge sees two dates.
4. **[minor] Guide copy repeats or contradicts itself.** (a) Day 3 debrief drawer: "Days 4 and 5 unlock after the Owner approves a change. Days 4 and 5 open after the Owner approves a change." (same sentence twice, A5 and B3).
   (b) After `review_exists` (B3 day 3) the drawer says "Days 4 and 5 unlock after the Owner approves a change. A review already exists, so the demo days are finished." although the change is approved.
   (c) Day 5: "Sign out, continue as Supervisor, and open Reviews. All 5 demo days are done. Sign out and continue as Supervisor." (sign-out instruction twice).
5. **[minor, known limitation, listed because zero tolerance] Real `503` on segment PUT, about 21 s long, 3 times in 5 runs** (A5 day 4 at 13:36:07, B3 day 2 at 13:30:18, C4 day 1 first PUT at 13:31:29), each recovered by the
   retry (next PUT 200). Console shows "Failed to load resource ... 503 ()" on those runs. About 21 s equals two 10 s transcribe timeouts plus the jittered wait (upstream slow, not 429). It happened only 3 times in about 120 PUTs.

Observations, no defect: (O1) On staff days 1 and 2 before the judge visits the Supervisor, the phone pill reads "STAGE 2 OF 7 · Supervisor · look around" while the staff card is on screen (by design: the day-1 card sends the judge to the Supervisor first).
(O2) The phone question heading on day 4 is the agent wording while the supervisor record shows the template (same as the earlier round). (O3) The Reviews guide card on stage 6 says fast-forwarding early "locks that review in", which matches B3.
(O4) The model cap and the 429 are not product defects; a judging day with 100 sandboxes will hit DEMO_MODEL_DAILY_CAP=300 after roughly 8 full journeys (each 3-day journey is about 25 segments plus proposals), see Recommendation.

## Not proven in this run

- "Worked for the read-back change": A5's approved change was the tray-label change (harness choice, my mistake). The Worked verdict (0.4/day -> 0.0/day) is proven for that change. The read-back change was approved on B3, where only the early (empty after-days) fast-forward was run: before 0.4/day, after "no captured days". A true read-back 5-day run needs a 4th sandbox.
- "Owner rejects everything" (2c), a Supervisor-token call to an Owner-only route (RBAC wrong-role probe, see below), a 1280 screenshot comparison of the two guide panels against the boards, real microphone, real phone wake-lock, real Vertex 429 behaviour (my 503s are synthetic; the 429 that closed the day was real).

## Hard-rule runtime checks

- audio/base64: none. No `base64` / `data:audio` string in any saved response, request body or screen text in the 31 saved JSON outputs; PUT bodies recorded as byte counts only.
- redaction: the saved screens show `[PERSON_NAME]` only where the earlier rounds expected it; none this round. Day record, proposals, reviews and debrief text contain no staff or customer name.
- names: `Bella` / `Ari` count 0 in every API body and every screen (A5, B3, C4, supervisor and owner runs).
- RBAC probes: no session: `GET /api/v1/questions`, `/proposals`, `/home`, `/reviews`, `/sop`, `/demo/progress` all **401**; `POST /api/internal/pipeline/tick` with a bogus bearer **401** and with no auth **401**; `POST /api/internal/reviews/run`
  bogus bearer **401**; `PUT /api/v1/segments/x:y`, `POST /api/v1/demo/next-day`, `POST /api/v1/reviews/fast-forward` without auth **401**. Wrong role: an Owner session token on the device routes
  (`PUT /segments/...`, `GET /capture/config`, `POST /demo/next-day`, `POST /demo/closing`) **403 "A device credential is required"**; Owner on `GET /api/v1/questions` **403** (`Role "owner" may not perform "questions:read"`);
  the staff device token on the supervisor/owner routes **401** "Invalid or expired token". NOT run: a Supervisor token against an Owner-only route (two attempts failed on my harness, not the product).
- region-from-config: not provable from the browser (dev-ops list).
- data hygiene: demo data only, fictional clips, the three sandboxes' ids appear only in saved evidence.

## End-to-end wait times (End to first question, or to "Debrief complete" when there is none)

| Run | Seconds | Result |
|---|---|---|
| A5 d1 / d2 / d3 / d4 / d5 | 142.2 / 101.5 / 131.7 / 112.2 / 142.2 | no question / question / question / question / no question |
| B3 d1 (failing tail note) / d2 / d3 | 122.6 / 101.6 / 121.1 | done / question / question |
| C4 d1 (failing tail note) | 71.5 | no question |
| Ask Bee6 for proposals (A5, B3) | 29.0 s, 2 proposals each (201, 201) | v4 cards "19 OF 19 CHECKS", "The agent read 1 SOP section(s) and 2 fact(s) before writing." |
| Owner approve to "Approved. It ships..." | about 1 s | HTTP 200 |
| Fast-forward click to "Simulated review created." | 0.26 s | |
| Segment PUT (200s) | typically 1.1 to 2.5 s, three 12 to 15 s outliers (VAD tail/transcribe) | |
"Preparing your questions" appeared 1.5 s after End on every run; its text says "about 2 to 4 minutes", observed 1.2 to 2.4 minutes.

## Log checks for dev-ops (read-only, counts only, never text), project bee6-playground, web-develop, 13:00 to 14:25 UTC 18 Oct

Outlets: A5 phone device `jdg-f82315c242d9`, B3 `jdg-ebd4c806bbf4`, C4 `jdg-e30c2117f9ee` (outlets `sbx-` + the same 12 hex).
1. Model-cap accounting: how many `model_day:2026-10-18` charges were counted before the 13:14 UTC refusal, by kind (segment, generate, answer, redact); confirm the first PUT of a `seg_id` charges once and retries are free (R-23, 30 free), using the 503-retried segments of B3 d1 (about 12 PUTs for one seg_id) and C4 d2 (17 PUTs); expect +1 charge each, not +12 or +17.
2. 503 on segment PUT: count `httpRequest.status=503` per outlet; expect only the three real ones (A5 13:36:07, B3 13:30:18, C4 13:31:29), each about 21 s long; for each, `segment.upstream_unavailable` stage and `upstream` (timeout vs 429), and `transcribe.retry` attempt counts. The synthetic 503s never reached the server (Playwright route), so expect 0 server-side log entries for them.
3. DEFECT 1: segment `...0ee23177398b` of C4 (PUT 200 at 13:34:17.9): confirm the document exists, its `session_id`, that the session was already ended, and whether any tick after 13:34 read it (`pipeline-tick` logs for `jdg-e30c2117f9ee`: `n_segments` in the 13:34 to 14:20 ticks, any "skew" or "session ended" skip reason, label/thread counts for that device and day). Is a segment received after the session's `ended_at` ever windowed in sandbox mode? Note `pipeline-tick skew` for this device showed `skew_min_ms` 41668190 (about 11.6 h) in the 13:34 window.
4. `debrief_agent.call` outcomes per outlet per day (A5 d2 to d4, B3 d2 to d3): counts of `skipped`, `accepted`, `rejected`, `error`; confirm no `error_class`.
5. `proposal` logs: A5 and B3 each 2 proposals, `agent_version proposal-v4`, `v4_fell_back` false, model location from `config/regions.yaml`.
6. Review fast-forward: 3 `POST /api/v1/reviews/fast-forward` 200 (A5 once, B3 once) plus the 409 `NOTHING_TO_REVIEW` I provoked once while probing (A5, owner token); the review-agent: REVIEW_AGENT is unset, so expect the plain-code verdict only and 0 review-agent model calls; before/after counts per window and any "overlap" flag for A5 (window Sat 17 to Fri 30 Oct) and B3 (after window empty).
7. `demo/next-day`: count 200 and 409 per outlet (A5: 4 x 200 [d1, d2, d3, d4], B3: 2 x 200, C4: 2 x 200, plus 1 x 409 at most), and confirm the B3 day-1 shift ran 25.6 s after the tap with the day-1 stored segments moved 24 h back and no day-1 segment landed after the shift.
8. No Cloud Storage write, no audio or base64 in any log line, no `question_en`, line text, "Bella", "Ari" in logs.
9. Revision hygiene: all 00063 traffic until about 13:20, 00064-2gd after; 429 `demo_model_cap` count on 00063 (about 10 PUTs and 1 generate).

## Recommendation

- Fix or accept DEFECT 1 (Rangga's call): either process late segments of an ended session in the next tick, or make the phone say the note is dropped instead of "delivered".
- Fix DEFECT 2 (clear the upload row when the Jump aborts the queue, and show the "not captured" notice if a note was dropped).
- Decide DEFECT 3 (one review date everywhere, or label it simulated).
- Judging day: the shared model cap of 300/day is spent by about 8 full journeys; DEMO_MODEL_DAILY_CAP and DEMO_SEGMENT_DAILY_CAP need a raise (dev-ops, Rangga's go) before real judging.

## Human manual-test checklist (real phone)

1. Real phone on mobile data, day 1: put the phone in airplane mode after the last card, tap End, turn it back on after 60 s: the note should upload and show in the Supervisor day record (DEFECT 1 says it will not today).
2. Real phone: Jump to tomorrow with a poor connection: confirm the "Finishing uploads…" label, the 25 s limit, and that day 2's ready screen shows no stale "retrying" row.
3. Real phone, days 4 and 5: read the read-back card (two lines, 2 s pause) aloud; confirm the card enables after the first line is heard and the debrief question wording.

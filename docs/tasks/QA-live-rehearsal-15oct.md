# QA live audio rehearsal, 15 Oct 2026 (demo project only)

Target: https://web-33uzb53tza-et.a.run.app (Cloud Run `web`, revision web-00016-z72, project bee6-playground).
Driver: Playwright 1.64 Chromium (new headless) with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream
--use-file-for-fake-audio-capture=<wav>%noloop`, 360x800 mobile emulation for the phone, 1280x900 for supervisor/owner.
Per-day wavs were concatenated from `private/rehearsal/d{d}-c{1..5}.wav` with silence gaps (3 s, then 6 s on the day-3 re-run).
Firestore read with the Admin SDK under ADC (read-only). Logs with `gcloud logging read --project=bee6-playground`.
Screenshots: `<LOCAL_PATH>/shots/`.
Nothing was written outside the two throw-away sandboxes below. `demo-tpl-outlet` and `demo-outlet` untouched. No product code edited.

**VERDICT: DO-NOT-SHIP.** The judge journey ends with no proposal: the Proposal agent answered `no_proposal / no_clear_pattern`
on every Ask (3 of 3, two sandboxes, problem A and problem B). Everything before that stage works (labels correct 15/15
exact cards and 9/9 improv/real variants; debrief; next-day shift; sign-out/re-entry; SOP v1 dated 08/10/26).

## 1. Sandboxes

| Sandbox | Device | Created (WIB) | Purpose |
|---|---|---|---|
| `sbx-af24fdc55221` | `jdg-af24fdc55221` | 20:10 | main 3-day judge journey (exact cards) |
| `sbx-720c19a50427` | `jdg-720c19a50427` | 20:51 | variants (improv-* and real/*), then a phone-only day 2 for the problem-B probe |

Entry page: three role cards, Staff "START HERE" → `/pair` → guide "Fill in 000000" → Set up → "Device set up" checklist →
"Open the listening page" → `/capture` "Day 1 of 3 · Thu 15 Oct", Start offered. SOP book (supervisor and owner):
"Version 1 08/10/26 · current" (judge day 15 Oct minus 7). Template history (13-14 Oct) is routine-only: 6 ROUTINE_OPS facts.

## 2. Day x card table (main sandbox, exact wavs)

Transcript = the stored segment `lines[].text` in Firestore. Label = thread category / confidence / gate verdict.

| Day·card | Heard transcript (stored lines) | Label | Expected | Result |
|---|---|---|---|---|
| 1·1 Opening | "Good morning. I am opening the shop now. The oven is on and the display lights are on. I counted the cash in the till and it matches the float." | ROUTINE_OPS 1.0 fact | ROUTINE_OPS | pass |
| 1·2 First bake | full | ROUTINE_OPS 1.0 fact | ROUTINE_OPS | pass |
| 1·3 Problem A | seg 1 (14.1 s audio): "Excuse me, are these egg tarts fresh today? When were they baked?" — **staff line "Hmm, I am not sure when this tray was baked…" DROPPED by transcription**; seg 2: "Okay, that is fine. I will take two, please. Two egg tarts. Here you go. Thank you." | CUSTOMER_SERVICE 1.0 fact, summary "Customer asking about freshness of egg tarts and making a purchase." fields {sale:true} | CUSTOMER_SERVICE | label pass; transcript FAIL (problem line lost) |
| 1·4 Display check | full | ROUTINE_OPS 1.0 fact | ROUTINE_OPS | pass |
| 1·5 Closing | full | ROUTINE_OPS 1.0 fact | ROUTINE_OPS | pass |
| 2·1 Opening | **DROPPED**: segment 20:20:44-56 held card 1 + card 2 line 1 (12 s) but returned only "Hi, is this egg tart from today? How fresh is it?" | (merged into 2·2) | ROUTINE_OPS | transcript FAIL (harmless) |
| 2·2 Problem A | "Hi, is this egg tart from today? How fresh is it?" / "Sorry, I do not know exactly when it was baked. Nobody wrote the baking time on the tray. It should be from this morning." / "Alright, I will have one. One egg tart, enjoy. Hello, Demo Bakery, thanks for calling." | CUSTOMER_SERVICE 0.95 fact, summary "Customer asking about egg tart freshness and making a purchase.", runner-up COMPLAINT | CUSTOMER_SERVICE | pass |
| 2·3 Problem B | "Yes, 50 egg tarts for tomorrow morning, pick up at 10:00. Okay, got it. Thank you. Bye." — line 1 merged into 2·2 (above); **line 3 "I did not read that phone order back to the caller…" DROPPED** (segment 20:21:29-44 returned only "Display check…") | PHONE_CALL 0.98 → question (always_question) → Yes → fact staff_confirmed; summary "Phone call for a large pre-order of egg tarts." | PHONE_CALL question | label pass; transcript FAIL (read-back line lost) |
| 2·4 Display check | full | ROUTINE_OPS 0.95 fact | ROUTINE_OPS | pass |
| 2·5 Closing | full | ROUTINE_OPS 0.99 fact | ROUTINE_OPS | pass |
| 3·1 Opening (re-run) | "Good morning, the oven is on… Hello, Demo Bakery, thanks for calling." (card 2 line 1 merged in) | ROUTINE_OPS 0.95 fact | ROUTINE_OPS | pass |
| 3·2 Problem B | "A birthday cake and 20 croissants for Saturday. Pick up at three or four? Sorry, the phone line is bad. Okay, 4:00. Bye." / "I hung up without reading the order back to the caller. I hope I got the time right." | PHONE_CALL 1.0 → question → Yes → fact; **the read-back line became its own CORRECTION 0.9 thread (needs_supervisor_confirm → question)** | PHONE_CALL question | pass (+1 extra CORRECTION question) |
| 3·3 Second bake | merged with 3·4 in one segment, full text | ROUTINE_OPS | ROUTINE_OPS | pass |
| 3·4 Display check | full | ROUTINE_OPS | ROUTINE_OPS | pass |
| 3·5 Closing | full | ROUTINE_OPS | ROUTINE_OPS | pass |

Day-3 attempt 1 (3 s gaps, continuous audio): every word was transcribed but the VAD merged the 5 cards into 4 segments,
so the 5th guide card stayed "Waiting for Bee6 to hear this card… Locked until all 5 cards are spoken (4 of 5 done)."
That is a harness artefact (a judge waits for the tap to enable), but it exposed defect D2 below after Cancel today.

## 3. Debrief

| Day | Preparing → questions | Questions | Answers |
|---|---|---|---|
| 1 | 101 s after End | 0 ("There are no questions today.") | — |
| 2 | 61 s | 1: "Around 20:21 there was a phone call. Is that right?" | Yes + reason; "Debrief complete"; answer showed "1 answer is not sent yet" then uploaded within ~5 s (POST …/answer 200) |
| 3 | 0 s (ghosts already there) then +65 s for the real ones | **4**: 20:32 phone call and 20:33 correction (from the CANCELLED session) + 20:38 phone call and 20:39 correction (real) | Yes to all 4 (a judge cannot tell the ghosts apart) |

Correction doc for the day-2 answer: `answer: "yes"`, `reason_text` stored, `answered_device_id` only, no role, no name (hard rule #7 ok).
Yes on day 2 did not end the debrief early (one question, then complete). Reload on the done screen keeps "Debrief complete".

## 4. Proposals (the failure)

Supervisor after day 3: watch panel "Customer service · seen on 2 of 2 days needed · Ready", "Phone call · seen on 2 of 2 days needed · Ready", button "Ask Bee6 for a proposal".

| Ask | Sandbox | Focus (first ready) | Response | Latency |
|---|---|---|---|---|
| 1 | main | CUSTOMER_SERVICE (2 facts, 2 dates) | 201 `status: suppressed`, `suppression.reason: model_declined`, `model_reason: no_clear_pattern`, `blocked_rule: null`, `gate.checks: []`, `generator: {kind: adk, model: gemini-3.5-flash, location: asia-southeast1, agent_version: proposal-v2, gate_version: pgate-v1, attempts: 1, floor_version: floor-v2}`, `counts: {candidate_facts: 2, candidate_dates: 2}` | 9.1 s (2879 in / 143 out / 371 thought tokens) |
| 2 | main | same | identical | 3.1 s |
| 3 | variants, phone-only day 2 | PHONE_CALL (5 facts, 2 dates; CS only 1 date) | identical, `have_facts: 5, have_dates: 2` | 5.3 s |

UI after each Ask: "The facts show no clear repeated problem. Watch for: Customer service, Phone call" / "Open proposals: No open proposals." No "Ask for another" (it needs a proposal with content). Owner Home: "Waiting for your approval · 0"; Approvals empty; SOP stays v1; Reviews empty. **No supervisor check, no owner approval, no SOP v2, no review date could be exercised.**

Why (stage by stage): transcript → label → gate are fine (facts exist, floor-v2 passes: `focus` found, floor passed). The break is the
Proposal agent input. `lib/proposals/prompt.ts` sends one line per fact: `- E1 2026-10-13 20:12 CUSTOMER_SERVICE: <summary> {fields}` — only the
label model's `summary` and `fields`. The summaries are event descriptions with no problem in them ("Customer asking about freshness of egg
tarts and making a purchase", "Phone call taking an order for a birthday cake and croissants"). The debrief reason text ("did not read it
back") is never passed. So rule 8 of the system instruction ("if the facts show no clear repeated problem, answer no_proposal with reason
no_clear_pattern") fires every time. On day 1 the only line that states problem A ("I am not sure when this tray was baked. There is no time
written on the tray") was also dropped by transcription, so even a line-aware prompt would have seen it on one day only.

## 5. Variants sandbox (improv-* and real/*), labels

| Clip | Stored transcript | Label | Pass |
|---|---|---|---|
| improv-d1c3 | "Hi there, are the egg tarts fresh today? Like, when did you bake them?" (staff answer DROPPED) / "All right, two please." | CUSTOMER_SERVICE 0.95 fact | yes |
| real-q1-staff-a + b | "When was the eclair on display baked? And also, who baked the last tray?" / "I don't know. I actually forgot what time it came out from the oven." | CUSTOMER_SERVICE 0.9 fact, summary "Customer inquiring about eclair baking time." | yes |
| real-q2-customer + staff | "Is this fresh today?" / "Oh, one moment. Let me check it first and I will let you know." | CUSTOMER_SERVICE 0.95 fact | yes |
| improv-d2c2 | "Hello, is this egg tart baked today? Is it fresh?" (staff answer DROPPED) / "Okay, one please. One egg tart, here you go." | CUSTOMER_SERVICE 0.95 fact | yes |
| improv-d2c3 | "Hello, Demo Bakery, how can I help you? Yes, 50 egg tarts for tomorrow morning… Thanks, goodbye." / "I did not read that phone order back to the caller. I will note it down a bit later." | PHONE_CALL 0.9 question (both lines in one thread) | yes |
| improv-d3c2 | "…a birthday cake and 20 croissants for Saturday… Okay, 4:00. Goodbye." / "I put the phone down without reading the order back to the caller. I hope I heard the time right." | PHONE_CALL 0.9 question | yes |
| real-phonecall | "Yes, you'd like 50 egg tarts for tomorrow? I'll confirm later." | PHONE_CALL 0.95 question | yes |
| real-d1-opening | "The oven is on, the display lights are on, and I also counted the opening cash." | ROUTINE_OPS 0.95 | yes |
| real-d2-closing | "The cash is counted, the oven is cleaned, and the leftover bread is sold." | ROUTINE_OPS 0.95 | yes |

Label accuracy 9/9. Debrief: 3 PHONE_CALL questions (cap 5 held). Phone-only day 2 (d2-c1, d2-c3, d3-c2, d2-c4, d2-c5): PHONE_CALL x2 questions + CORRECTION x2 questions, all labelled as expected.

## 6. Defects (zero tolerance; all reproduced)

- **D1 [blocking] No proposal is ever created.** Repro: run the 3 days as in §2, sign in as supervisor, Proposals → "Ask Bee6 for a proposal" → 201 suppressed `model_declined/no_clear_pattern` (3/3 across two sandboxes, A and B). Expected: proposal A after day 2+, proposal B after day 3, then supervisor feasible → owner approve → SOP v2 + review date. Evidence: `proposals/a81f1cb9…`, `proposals/7bda3995…` in `sbx-af24fdc55221`, `proposals/c3e5ee62…` in `sbx-720c19a50427`; Cloud Run lines `[proposal] generated … status: 'suppressed'` at 13:46:25Z, 13:46:58Z, 14:09:00Z; screenshots 44-sup-after-ask.png, 45-sup-after-ask2.png, 55-var-after-ask.png.
- **D2 [major] "Cancel today" leaves the cancelled session's notes.** Repro: start a day, speak, close/relaunch the tab before Jump to closing, wait one tick (2 min), re-open `/capture` → "Today's session was interrupted" → Cancel today (POST …/discard → 202 `cleanup: "pending"`) → run the day again → End. Observed: the debrief lists the cancelled session's questions (20:32 phone call, 20:33 correction) next to the real ones (4 questions instead of 2); answering them makes them facts (evidence); `threads` and `questions` from unit `w_bfe817db…` still exist while the segments were deleted. The dialog promises "the notes from today are deleted and today does not count". The day record does hide them ("Sessions cancelled: 1"), the debrief does not. Known P1 gap per `docs/tasks/R-P1-discard-response.md`, but it is on the judge path (any interrupted session).
- **D3 [major, model finding] Transcription drops one utterance of a two-utterance segment.** 5 of ~10 such segments: d1·c3 staff "Hmm, I am not sure when this tray was baked…" (14.1 s audio → 16 output tokens); d2·c1 "Morning. Oven on…"; d2·c3 "I did not read that phone order back…"; improv-d1c3 staff answer; improv-d2c2 staff answer. Both voice orders affected (Daniel→Samantha and Samantha→Samantha). The dropped line is problem A's only signal on day 1. Evidence: `segments` docs listed in §2 (audioSeconds in `segment.usage` log lines match the full audio).
- **D4 [minor] Judge guide stage pill wrong on web pages.** On `/proposals`, `/sop`, `/reviews`, `/devices`, `/home` the pill reads "Judge guide · Stage 1 of 5" and no `GET /api/v1/demo/progress` is made; `/day` shows the right stage (3, then 4). Screenshots 16-sup-proposals-day1.png vs 15-sup-landing.png.
- **D5 [minor] Demo bar after sign-out.** After staff Sign out, `/sign-in` still shows "Demo · Signed in as Staff · Ends at 22:10" (bee6.demo keeps `role: staff`). Screenshot 14-signin-supervisor.png.
- **D6 [minor] `favicon.ico` 404** on every page: a console error per page load and WARNING entries in Cloud Logging.
- **D7 [minor, 360 px] Open guide sheet covers "Set up" on `/pair`.** The pair card says "Tap Fill in 000000, then Set up"; with the sheet open the Set up button is under the sheet (Playwright: "subtree intercepts pointer events"); the judge must close the guide first. Screenshot 03b-pair-guide-open.png.

Observations (not defects, for the plan): (a) after a demo pair the "Device set up" checklist shows before `/capture` while §8.1 says "go straight to /capture" (spec contradiction); (b) a declined focus blocks the other: `service.ts` picks the first READY category not taken by an open proposal; a suppressed proposal takes nothing, so every Ask re-tries CUSTOMER_SERVICE and PHONE_CALL is never attempted while CS is ready; (c) problem B's third line ("I hung up without reading the order back") labels CORRECTION (needs supervisor) → a second question per phone day and a "Waiting for review" item; (d) `POST /api/v1/demo/next-day` on day 3 with `expected_day` 1 or 2 → 200 `{day: 3}` (stale/idempotent) and no shift; 409 `max_days` is unreachable through the schema (`expected_day ∈ {1,2}`); the UI hides the button and `next_day_count` stayed 2, so the cap holds; (e) the label stage logs no token usage line (only `segment.usage` and `[proposal] generated`), CLAUDE.md §7; (f) auto-fact threads on the day record show no "Change category/Reject" actions (only staff-answered rows do), so §10.3 safety net 2 (relabel a STAFF_CONSULT auto-fact) is not reachable from the UI; (g) with continuous speech the VAD does not split at 3-6 s pauses but splits elsewhere (max ~14-15 s), so one segment often holds two cards; a judge who waits for "I have spoken this" is unaffected.

## 7. Other checks (pass)

- Jump to tomorrow: day 1 → 2 and 2 → 3 in 6 s (`[demo] next_day … docs: 35`), Start offered, header "Day n of 3 · Thu 15 Oct".
- Sign out before closing → "Sign out and cancel today?" dialog, Keep listening keeps the session. After closing → "Sign out?" / "Sign out anyway" → entry page; re-pair 000000 → same sandbox → "Today's session is still open." → End today → debrief.
- "I have spoken this" disabled until a segment with ≥1 line is accepted; one card at a time; after card 5 "Jump to closing time" → End today enabled; End confirm dialog "End today's operations?".
- Day 3 done: "All 3 demo days are done. Sign out and continue as Supervisor."; Jump button hidden; reload keeps state.
- Supervisor day record: no device id, "A staff member answered Yes: …"; Waiting for review lists the CORRECTION threads; empty states on Reviews/Devices/Proposals day 1 as specified ("Needs 1 more day").
- Owner: nav Home/Approvals/SOP/Reviews; Home tiles ("Waiting for your approval · 0", Progress 0/0, Today in five lines, Next review "No data yet", Cost "Coming soon", Reset the demo present); sign-in 3.6-4.1 s.
- 360 px: capture page and guide have no horizontal overflow (scrollWidth 360 = innerWidth).
- RBAC probe: device token on `GET /api/v1/proposals`, `GET /api/v1/day/today`, `POST /api/v1/demo/reset` → 401; bad token on segments PUT → 401.
- Hard rules at runtime: no audio or base64 in any Firestore doc read (segments store `lines[].text` only) or log line; answers store `answered_device_id` only; no name anywhere (none spoken); proposal generator location `asia-southeast1` for gemini-3.5-flash (recorded on the doc); no FAILED_PRECONDITION / index error in logs 13:05-14:15Z.
- Open (not provable from outside): that Sensitive Data Protection ran on each line (no redaction log line); that `asia-southeast1` came from `config/regions.yaml`.

## 8. Latencies

Pair 3.0 s · sign-in 3.6-4.1 s · segment PUT returns 2-4 s after the segment closes (transcribe 1-3 s for 5-14 s audio) · tick every 2 min (labels land at the tick) · End → questions 101 s / 61 s / 65-125 s · closing 2.6 s · next-day 6.0 s · Ask 3-9 s.

## 9. Brainstorm candidates (for the proposal failure)

1. Feed the problem to the Proposal agent: add to each FACTS line (a) the confirmed debrief `reason_text` (already redacted) and (b) a short redacted excerpt of the thread's lines or a label-model field such as `issue`. Today only `summary` + `fields` reach the model.
2. Change the label prompt so `summary` states the outcome/problem when there is one ("staff could not say when the tray was baked; no bake time on the tray", "order taken by phone, not read back"), and add an `issue` field for CUSTOMER_SERVICE / PHONE_CALL.
3. Rewrite the cards so the staff states the problem in one explicit sentence, identical on both days, as its own line with a 4-5 s pause before it (one utterance per segment avoids D3): e.g. "I could not tell the customer when the egg tarts were baked, because nobody writes the bake time on the tray." / "I took a phone order and did not read it back to the caller." Drop the "Hello, Demo Bakery" line into the same card line as the order so the thread stays PHONE_CALL.
4. Soften rule 8 for the demo scale ("two facts of one category on two dates count as a repeated pattern unless they contradict each other") and let an Ask after a decline move to the next ready category (`another` should skip a declined focus).

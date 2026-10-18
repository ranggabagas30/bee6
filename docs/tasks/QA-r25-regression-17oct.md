# QA — R-25 integrated regression on staging (Sat 17 Oct, 11:35–13:30 WIB)

Build under test: `web-develop-00036-shv` = `develop` `11b9149` on https://web-develop-33uzb53tza-et.a.run.app (DEMO_MODE=true, `FIRESTORE_DATABASE_ID=staging`, `PROPOSAL_AGENT_V4` unset). Release question: may this go to `main` (combined release with R-24 flag OFF) by 17:00 WIB.

**Verdict so far: DO-NOT-SHIP** — one P0 (R25-001, the sandbox idle screen has no "Ready to open" stage on day 1 and on day 2) plus three P1s below. Everything else in groups A–K passed. Details, repro and the exact text observed are in the group sections; the defect list is §2.

Method: Playwright (headless Chromium, `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>` with the git-ignored `private/rehearsal` day-1/day-2 concatenations), ONE persistent profile per sandbox journey (`launchPersistentContext`), 360×640 @2x `isMobile`+`hasTouch` for the phone and 1280×900 for the laptop/web; axe-core 4 (wcag2a/aa, 2.1, best-practice) and the console read on every screen; Group A on a local `next start` of the same commit with `DEMO_MODE` unset. Harness: `scratchpad/r25/` (`driver.js`, `helpers.js`, one `*.js` step per group); screenshots `scratchpad/r25/shots/r25-<step>-<viewport>.png`; raw JSON per step `scratchpad/r25/<step>-out.json`. No sandbox key appears in any file written here. Sandboxes used: the seeded `sbx-uitest*` (`proposals`, `proposals-one`, `review-due`, `decided`, `debrief` after its 11:57 re-seed) and four NEW demo sandboxes created through the Entry page (B day-1, C-offline, C+D, C-lost); staging tick stayed PAUSED; nothing on `web`, `(default)`, the pilot, Cloud Run, Scheduler or env was touched; no Reset was confirmed.

Legend: PASS = observed exactly as the acceptance text; FAIL = reproduced defect (id in §2); BLOCKED = could not be exercised (why); NOTE = observation that needs a ruling, not counted as a defect.

## 1. Groups

### A. Pilot-safety smoke (local build, `DEMO_MODE` unset) — PASS

`npm ci` + `npm run build` of `11b9149` in a throwaway worktree (`scratchpad/r25-wt`), `next start -p 3101` with `DEMO_MODE`, `NEXT_PUBLIC_DEMO_MODE`, `PROPOSAL_AGENT_V4` unset. Evidence `scratchpad/r25/a-pilot.mjs`, shots `r25-A-*-360.png`.

| Check | Result |
|---|---|
| `/` | 307 → `/sign-in` (curl and browser) |
| `/sign-in` | "Bee6 / ID Bahasa Indonesia / EN English / Sign in / Sign in as / Staff / Supervisor / Owner / Choose who you are to continue." — no DEMO ACCESS box, no guide |
| `/pair` | Logo + ID/EN + "Set up this device / Ask your supervisor for the 6-digit code…/ 6-digit code / Set up". No "Demo Bakery", no STAFF/DEMO DATA chips, no demo steps, no guide handle |
| `/capture` unpaired | redirects to `/pair` |
| chunks on `/pair`, `/capture` | 13/15 JS chunks loaded; **no** chunk contains `firebase`; the DemoBar/JudgeGuide **components are not fetched** (the chunks `1om6crd…`, `1m3svg…` that hold them never load). Two loaded chunks contain only the `next/dynamic` loader stubs (`e.A(63402).then(e=>e.DemoBar)`) and the i18n dictionary strings ("Open the judge guide", "DEMO DATA") — strings, not UI. |
| console | 0 errors on all three |
| `/api/health` | 200 |

### B. Live audio path — FAIL (R25-001), everything else PASS

Fresh sandbox from the Entry page ("Open staff screen"), 360×640, `day1.wav`; day 2 on the `debrief` sandbox at 1280 with `day2.wav` (see B.2). Evidence `b1-entry.js … b4-end.js`, `b6-debrief360.js`, `b7-debrief1280.js`; shots `r25-B-*`.

B.1 Day 1 at 360:

| Step | Observed | Result |
|---|---|---|
| Entry `/` | h1 "A small shop's day, turned into one better SOP step at a time.", chip "DEMO OUTLET · FICTIONAL DATA", kicker "TRY ALL THREE ROLES · ABOUT 20 MINUTES", three cards (Try as Staff/Supervisor/Owner, links "Open staff screen → /pair" …), handle "JUDGE GUIDE · DEMO · Welcome · pick Staff to start". POST `/api/v1/demo/session` 200 on the Staff card. axe 0, console 0 | PASS |
| `/pair` | h1 "Set up this device", sub "Ask your supervisor for the 6-digit code. It works once, for 10 minutes.", label "6-digit code", "Set up" disabled, hint "Enter all 6 digits to set up."; no Demo access box; handle "STAGE 1 OF 5 · Fill in the demo code" | PASS |
| Guide "Fill in 000000" | card "Staff · day 1 / Set up the staff phone / STEP: PAIR THE DEVICE / For this demo the code is 000000…"; tapping it fills the field and closes the sheet; reopening shows the disabled control "Filled in ✓" + "Filled in. Tap Set up." | PASS |
| Set up → paired | 1.3 s; h1 "Device set up", sub "For Demo Bakery · Outlet 1", 4 steps (Leave the device… / Keep the screen on… / Tap Start… / End unlocks at closing time…), link "Open the listening page"; handle title "Open the listening page", card kicker "NEXT" "Tap Open the listening page. Then tap Start and read the script cards that appear in this guide." (pair_done, UI-021 FIXED); outlet line shows "ends 13:40" | PASS |
| `/capture` idle | **NO h1, no orb, no "Day 1 of 3 · Sat 17 Oct" line.** `main` holds only the sr-only status, "Start", muted "Sign out" and the one `data-testid=capture-notice` "Speech becomes short work notes. Audio is not kept." Handle "STAGE 1 OF 5 · Tap Start, then read the cards · Day 1 of 3". No yellow bar. axe 0, console 0 | **FAIL R25-001** |
| Start → Listening | POST `/capture/sessions` 200; h1 "Listening"; `.b6-sub` "Focus on your customers.\nWe'll keep the notes."; mono "Day 1 of 3 · Sat 17 Oct"; button "End · available at closing time (21:45)" really `disabled`; red text button "Sign out (cancels today's session)" `rgb(142,53,38)` 14px `b6-btn--text-danger`; no "Cancel session"; no header Sign out; live regions: one "Listening" (page) + "Card 1 of 5" (guide) | PASS |
| 5 script cards | "I have spoken this · next card" enabled at +14.1 s, +7.8 s, +19.9 s, +7.8 s, +9.9 s after the previous tap (= the wav's own card spacing; 5 segment POSTs 200, `lines: 1` each, same as the R-19/R-23 rehearsals). All-spoken card "ALL 5 CARDS SPOKEN / Well done. Day 1's speech is captured. Jump to closing time, then tap End." + "Jump to closing time »" + "‹ Previous card (re-read only)" | PASS |
| Jump to closing | POST `/demo/closing` 200 `closing_reached:true`; sub "Closing time has passed. Tap End when operations are done."; "End today" enabled; muted "Sign out" (`#5F5C55`); handle "All cards spoken · jump to closing" | PASS |
| End sheet | `role=dialog aria-modal=true` `.b6-dsheet`: "End today's operations? / The 1-hour debrief starts now. This cannot be undone. / Not yet, keep going / Yes, end"; initial focus "Not yet, keep going"; Tab cycles Yes, end → Not yet → Yes, end (trap); Escape closes and focus returns to "End today" | PASS |
| Yes, end → Preparing | POST `/sessions/<id>/end` 200; h1 "Preparing your questions", sub "Bee6 is reading today's notes to decide what to ask. Please wait.", mono "Day 1 · debrief window 60 min", one amber `!` box ("Please keep this page open and the screen on…"), disabled "Start is locked until the debrief is done", ONE h1, ONE capture-notice, handle "STAGE 2 OF 5 · Wait for your questions". `GET /questions` polled every 10 s → `questions: [], preparing: true` for 100 s (tick paused — expected; not resumed) | PASS |

B.2 Question / done / day 2 on the re-seeded `debrief` sandbox (window 11:52–12:52):

| Step | Observed | Result |
|---|---|---|
| Q1 at 360 | kicker "QUESTION 1 OF 5", chip "53 min left", chip "CST Customer service", mono "Today · 10:37", "Around 10:37 there was customer service. Is that right?", explanation "Bee6 heard a customer being served. It needs your answer to be sure.", Yes / No (no "Not sure"), reason field always visible (placeholder "Why? Add a short reason (required)", "0/500"), "Next question" disabled until Yes/No **and** a reason, "Skip", "Check for new questions", notes "Answering does not end the debrief…" + "An answer sent with Next cannot be changed.", one notice; 5 progress bars; the only h1 is the sr-only "Shop phone" (`C-cap-title`, deliberate) | PASS |
| Q1–Q3 | Yes+reason → Next (POST `/questions/<id>/answer` 200 `answered`), No+reason → Next (200), Skip → "QUESTION 4 OF 5"; `bee6.debrief.progress` = `{answered:2, skipped:1, seen:[u1,u2,u3]}` | PASS |
| Questions vs day record | `/api/v1/questions`: CS 10:37, PHONE 10:50, COMPLAINT 11:03, STAFF_CONSULT 11:16, ROUTINE 11:29 — identical to the supervisor `/day/2026-10-17` rows of the same sandbox (10:37 CST, 10:50 PHN, 11:03 CMP, 11:16 CNS, 11:29 RTN, each "Question, waiting for the debrief") | PASS (coordinator's extra check) |
| Guide on the question card | "STAGE 2 OF 5 · Supervisor · look around · Answer what really happened · DEBRIEF TIP …"; NO "Jump to tomorrow" control (UI-112 FIXED) | PASS |
| Timed-out (J, clock +61 min client-side, no reload) | h1 "Debrief closed"; sub "The 60 minutes are over. 3 of 5 questions were not answered and are recorded as **unverified**." (`<b>` on unverified); mono "Next Start · Sun 18 Oct from 01:00"; footer disabled "Start unlocks tomorrow from 01:00" + "Use Jump to tomorrow in the judge guide" + muted "Sign out"; one notice; axe 0 | PASS for copy/layout/footer; see R25-004 for the guide state |
| Q at 1280 (fresh profile) | `.dtop`-style bar: logo, "Demo Bakery · Outlet 1 · ends 23:57", chips STAFF + DEMO DATA, ID/EN; counter "QUESTION 1 OF 3" (3 left server-side; fresh localStorage → DEV-1 known limitation, not a defect) | PASS |
| Done at 1280 | h1 "Debrief complete", "2 of 3 were not answered and are recorded as unverified.", mono "Next Start · Sun 18 Oct from 01:00", ONE disabled "Start unlocks tomorrow from 01:00", ONE muted "Sign out", ONE h1, ONE notice; guide "Today is done / NEXT / Day 1 of 3 is done…" + "Jump to tomorrow »" | PASS |
| Jump to tomorrow | first POST `/demo/next-day` 409 `unanswered_questions {unanswered:2}` → "Jump anyway" → 200 `{day:2}` | PASS |
| Day 2 idle at 1280 | **again no h1 / orb / day line** — only Start, Sign out, notice (same symptom as day 1) | **FAIL R25-001 (day 2)** |
| Day 2 header at 1280 | chips STAFF + DEMO DATA present; header right = ID/EN only, **no "Sign out" button** (board L2-* has `.btn2` Sign out from 900 px) | **FAIL R25-003** |
| Day 2 Listening → End | h1 "Listening", "Day 2 of 3 · Sat 17 Oct", cards 5/5 (+17, +9, +14, +9, +17 s), closing sub, End sheet identical, "Preparing your questions / Day 2 · debrief window 60 min"; guide "STAGE 3 OF 5" after day 2 | PASS |

Axe: 0 serious/critical on every screen above. Console: 0 errors (the only entries are my harness's `/robots.txt` 404 and the expected 409 of the first next-day call).

### C. Sticky lost notice (R-23) — PASS

New sandbox, 360, looping `day1.wav`; the first segment PUT was answered 400 by request interception (a 4xx is a permanent drop in `lib/capture/retry.ts`; a 14-s offline stretch in an earlier attempt only produced "retrying (5x)" and recovered — network failures never drop, by design). Evidence `c2-lost.js`, shots `r25-C-lost-notice-360.png`, `r25-C-closing-notice-360.png`, `r25-C-after-end-360.png`, `r25-C-after-dismiss-360.png`.

- 13 s after Start: `b6-alert--amber` "▲ Some speech was not captured / That note is now incomplete. It cannot be recovered. / [Dismiss]" under the footer; the later 5 segments uploaded 200 and "Upload succeeded" sits under the notice.
- The notice is still there on the closing screen, and **after End** on "Preparing your questions" (live region announces it once). Dismiss → the upload-status block is empty. PASS.

### D. Sign-out / open-session / mic — PASS, one NOTE (R25-002 for ruling)

Evidence `cd1-mic.js`, `cd2-run.js`; shots `r25-D-*`.

| Case | Observed | Result |
|---|---|---|
| Mic denied (context without the fake-UI flag) | Start → POST session 200 → h1 "Microphone problem · not listening", help "Check the microphone permission in the browser, then try again.", idle orb shell, End disabled, red sign-out link; one polite status carries the text (announced once); console: 3× "Error starting micVad NotAllowedError" (expected) | PASS |
| Reload after the mic failure | "Today's session was interrupted / Cancel it and start today again. / Cancel today" → Cancel today → h1 "Session cancelled" + Start | PASS (NOTE: the session is opened on the server before the mic is checked, so a denied mic leaves an open session behind; not in the acceptance list) |
| Sign out while running | dialog "Sign out and cancel today? / Today's session is still running. If you sign out now it is cancelled: the notes from today are deleted and today does not count. This also unpairs the phone, so you need a new 6-digit code to use it again. / Keep listening / Sign out and cancel"; focus "Keep listening"; confirm → POST `/sessions/<id>/discard` 202, lands on `/`, device unpaired (re-pair needed); after re-pair `/capture` h1 "Session cancelled" (status region announces it) + Start | PASS |
| Sign out after closing | muted link → dialog "Sign out? / Closing time has passed, so today's session can no longer be cancelled. It stays open until you come back and tap End, then the debrief runs for 60 minutes. Questions left unanswered are recorded as unverified. Signing out unpairs the phone. / Stay / Sign out anyway"; focus "Stay"; confirm → `/`, **no** discard/end call (nothing deleted) | PASS |
| Open-session return (re-pair) | h1 "Today's session is still open", sub "Closing time has passed. Tap End to start the debrief. It runs for 60 minutes.", mono day line, "End today", footer notice "You signed out before ending. Nothing was lost." once, privacy note, muted Sign out; handle "Tap End to start the debrief" | PASS |
| End from that screen | goes **straight** to "Preparing your questions" — no "End today's operations? … cannot be undone" sheet (`OpenSessionView` `onEnd` → `handleOpenEnd`, no `openSelesaiConfirm`) | NOTE → R25-002, needs the tech-lead's ruling against R2 |

### E. Supervisor walkthrough (1280 + 360) — PASS, one NOTE

Sandboxes `proposals` (list, detail, reject panel, Ask, both marked feasible), `proposals-one` (Mark feasible), `review-due` (reviews, SOP v2 in force, devices), `debrief` (Ask attempt, day record of today). Evidence `e1…e9`, `h-sup-*`; shots `r25-E-*`, `r25-H-sup_*`.

- WebShell: `nav.b6-nav` 210 px rail; `.dtop` bar "Bee6 · Demo Bakery · Outlet 1 · ends 22:44 · SUPERVISOR · DEMO DATA · ID/EN · Sign out"; no yellow bar; no "Demo access" box on `/pair` (it lives on `/sign-in`, R5). PASS
- Day record `/day/2026-10-16`: three tiles WORK NOTES 11 / DEBRIEF ANSWERS "4 of 5 · 1 unverified" / NEED YOUR CHECK "2 · 12:20 · Customer complaint +1 more"; filters All (11) … Customer complaint (1) work; rows "Needs your check" with Confirm / Change label / Reject; "Fact, confirmed by staff"; "Unverified"; **Staff debrief lists 5 rows: 3 Yes (with reasons), 1 Unverified (no answer), 1 No** (UI-114 FIXED); "A staff member answered; no names are kept."; no device id anywhere (`jdg-*` grep empty). PASS
- Proposals list: watch rows "seen on 2 of 2 days needed · Proposed/Ready", "seen on 1 of 2 days needed · Needs 1 more day" (never N>M, UI-115 FIXED); two cards with "Waiting for you", "2 moments · Thu 15 Oct, Fri 16 Oct", "Review"; "Rules for Bee6 (optional)" collapsed `<details>` (R8). NOTE: the sentence "One proposal can be made now" never appears, neither with one "Ready" category (`proposals`) nor with three (`debrief`, "No open proposals") — coordinator says: not a defect until the tech-lead rules. "Not seen yet" placeholder rows cannot be checked on a seeded sandbox (every category is present in `watch.categories`); they need a fresh-sandbox supervisor visit before day 1 is processed (tick paused → not reachable today).
- Detail: "‹ Proposals", kicker "Serve a customer", pill "Waiting for your check", h1 title, WHAT CHANGES IN THE SOP (Before/After), THE EVIDENCE · 2 MOMENTS ON 2 DAYS, WATCH THIS METRIC, REVIEW DATE Sun 25 Oct, "Reject… (reason required)", "Mark feasible". Reject panel: inline `<form>` "Reject this proposal? / Give a short reason… / Why is this not workable? (required) / 0/300 / Reject proposal (disabled until text) / Cancel"; focus lands in the textarea; Cancel removes the form and returns focus to "Reject… (reason required)". PASS
- Mark feasible (`proposals`, both; `proposals-one` consumed by my first attempt): POST `/proposals/<id>/review` 200 → pill "Waiting for owner approval", banner "Marked feasible. The owner decides next. Sign out and pick Owner to approve or reject.", disabled "Marked feasible ✓", "Sign out · pick Owner". PASS
- Ask (`proposals`): "Ask for another proposal" → chip "Asking Bee6…", card "Bee6 is writing a proposal / This can take up to a minute. Please keep this page open." — **no "Usually 10-30 seconds" line (flag OFF, group I)**; POST `/proposals/generate` 201 after 13 s with `status: suppressed, model_declined / no_clear_pattern` (only Staff question + Training were left) → "No other problem is ready yet. Watch for: Staff question, Training". PASS for the loading card and the flag; the decline is the F-01 path (seed), not a defect. The `debrief` Ask could not be run (its supervisor profile was already signed in elsewhere; see §4).
- Reviews (`review-due`): `.b6-card` in Plus Jakarta Sans: "WAITING FOR A VERDICT / SOP VERSION 2 · REVIEW ON FRI 16 OCT / Write the bake time on every tray label / Metric… / BEFORE 2.0 per day / AFTER 0.2 per day / This is a short window… / Bee6 suggests: Worked / the count per day moved the right way by 90% / Failure condition… / Waiting for the supervisor's verdict by Sat 24 Oct / Worked · Revise · Revert" (UI-120 FIXED). PASS
- SOP book (`review-due`): "VERSION 10/10/26 | 09/10/26 · current", "Version 2, in force since Fri 9 Oct", Book/Table, cover "DEMO BAKERY · OUTLET 1 / Standard Operating Procedures / Version 2 · in use from Fri 9 Oct · 5 steps", CONTENTS, "From your SOP 4 · Improved with Bee6 1", chapter pages with PAGE n OF 4; improved step (Stock 3.1) carries "IMPROVED · NEW ON …", new text, "Before:" old text and "See why it changed and the result". PASS
- Devices: h1 "Connected devices", sub "Phones that listen for this shop.", card "COMING SOON / Pairing codes for a new phone will be made here. For this demo the staff phone is already set up." No id. PASS
- Guide on supervisor pages: `debrief` sandbox (days_done = 1) shows "STAGE 2 OF 5" on `/day` and `/proposals` (R7); web panel "Do this now" rows with ✓ done / • current step / not yet. PASS. On `proposals`/`review-due` seeds (no journey progress) the chip reads STAGE 1 OF 5 — seed artefact.
- 360: every supervisor route renders without horizontal scroll (`scrollWidth == clientWidth`), axe 0. PASS

### F. Owner walkthrough — PASS

`proposals` (after both feasible) for the T11 flow; `decided` for the after-state; `owner` was already consumed at 11:40 (re-seeded at 11:57, not needed after that). Evidence `f1b`, `f2`, `f3`, `f4`, `h-owner-*`; shots `r25-F-*`.

- Home (waiting): h1 "Good morning." 44px/300 Plus Jakarta Sans, "Sat 17 Oct · here is where things stand.", "PROGRESS · THIS WEEK" + Week/Month/Since start, sentence "0 approved and 0 rejected this week.", "WAITING FOR YOUR APPROVAL · 2 / Both marked feasible by the supervisor. In Bee6's recommended order." / **"Review in order" → `/proposals` (no `?id=`)** / rows **#1 Write the bake time on every tray label, #2 Read every phone order back…** (oldest first; per-row links carry `?id=`), "Today in five lines" (5 lines), "Next review / No review scheduled yet / Appears after you approve a change", "COST PER OUTLET-DAY Coming soon"; **no Reset button on the page** (it is the guide's owner-home control). PASS
- Approvals: "‹ Back to home", kicker "APPROVALS · 1 OF 2 · 2 LEFT", h1 = #1 title, WHY / COST / EXTRA WORK FOR STAFF tiles, "Why Bee6 suggests this" evidence, THE EVIDENCE, WATCH THIS METRIC, "Starts the day after approval · review Sun 25 Oct", decision card `position: sticky; top: 16px` ("Your decision / Approve / Reject — why? / Write a short reason first… 0/300 / Reject with reason"), RECOMMENDED ORDER rail. "Reject with reason" disabled with an empty field (still disabled with a 1-char "x"; enabled with a sentence — looks like a minimum length, not in the acceptance text). Approve → POST `/approve` 200 `approved`, live "Approved. It ships as a new SOP version.", kicker "2 OF 2 · 1 LEFT", #2 card shows "Not available: the SOP changed / This proposal was drafted on the old SOP version, so it can only be rejected…", disabled "Approve · not available" + "The SOP changed after this was drafted. You can still reject it with a reason."; reject #2 with a reason → 200 `rejected` → h1 "Both decided. Nice and calm.", "1 approved, 1 rejected. The approved change starts on Sun 18 Oct and is reviewed on Sun 25 Oct.", rows (#1 "Shipped as SOP version 2", #2 "Now a rule: …"), WHAT HAPPENS NEXT, **"Back to home" primary then "See the SOP" secondary**. PASS
- SOP v2 (`decided` and the just-approved `proposals`): "VERSION 10/10/26 · current | 18/10/26 · upcoming", "Version 2 · in use from Sun 18 Oct · 5 steps", "Improved with Bee6 1", Stock 3.1 "IMPROVED · NEW ON 18/10/26" + Before + "See why it changed and the result"; Table view "stock-01 … 18/10/26 · Bee6 proposal, approved 17/10/26". PASS
- Reset dialog (`decided`, from the guide's "Reset the demo"; OPEN + CANCEL only, never confirmed): `.b6-dsheet` in Plus Jakarta Sans, "Reset this demo? / This sets this demo copy back to day 1: the original SOP, no proposals and none of the notes from your days. Fictional data only. This cannot be undone.", red "Reset the demo" (`#8E3526`, y=457) above "Cancel" (y=519), initial focus "Cancel", Escape closes and focus returns to "Reset the demo"; 0 POSTs. PASS
- 360: `/home`, `/proposals`, `/sop`, `/reviews` no horizontal scroll, axe 0. PASS

### G. Judge guide — PASS (one FAIL shared with J: R25-004)

- Collapsed handle on the phone: `.b6-handle` 84 px tall ("JUDGE GUIDE" + chip "DEMO"/"STAGE n OF 5" + title; "Day n of 3" `.b6-clock` on capture pages). Open sheet: section label + ONE `.b6-cardbox`, **no "YOUR JOURNEY" list** (`/`, `/pair`, `/capture`). PASS
- Script cards: "CARD n OF 5", title, speaker kicker + line, note "Read it word for word. You play every voice; the speaker name is not spoken. Pause about 2 seconds between speakers.", "I have spoken this · next card ✓", "Waiting for Bee6 to hear this card…", "‹ Previous card (re-read only)". PASS
- "Fill in 000000" → "Filled in ✓" (disabled) + "Filled in. Tap Set up."; pair_done card "Open the listening page". PASS
- Supervisor pages after day 1: "STAGE 2 OF 5" (`debrief` sandbox); web panel "Do this now" rows. PASS
- Question card: no Jump to tomorrow; done card: "Jump to tomorrow »". PASS
- 1280 closed pill: sits top-right above the `.dtop` bar at every web route; bounding-box test against every header button/link → no overlap (`r25-H-*-1280.png`). PASS
- After the timed-out screen the handle still reads "Answer the questions" and the open card has no "Jump to tomorrow" while the page says "Use Jump to tomorrow in the judge guide" → R25-004 (clock advanced client-side; see §2).

### H. ID/EN toggle, 360 + 1280 of every route — PASS

Routes: `/`, `/sign-in`, `/pair`, `/capture` (all states above), `/day`, `/day/<Y1>`, `/proposals`, `/sop`, `/reviews`, `/devices`, `/home`, owner `/proposals`, owner `/sop`, owner `/reviews`. On each: ID → `<html lang="id">`, cookie `bee6_lang=id`, one polite line "Bahasa Indonesia dipilih.", Bahasa strings (e.g. "Catatan hari", "Usulan", "Buku SOP", "Tinjauan", "Perangkat terhubung", "Selamat pagi.", "Keduanya sudah diputuskan. Tenang dan rapi.", "Hari sebuah toko kecil…"); reload keeps `lang=id`; EN → `lang=en`. No "PROVISIONAL" marker leaks into the rendered text. 360 screenshots of every route: no horizontal scroll (`r25-H-*-360*.png`, `r25-K-*-360.png`). axe 0 everywhere.

### I. Flag-off proof + health — PASS

Ask loading card has no "Usually 10-30 seconds" line (E); `GET /api/health` 200.

### J. UI-072 timed-out board — PASS by the tech-lead's zero-code method (not BLOCKED)

Real component + real state machine on `debrief` with `Date.now` advanced +61 min in the page after question 4 was on screen (no reload, no answer after the patch). 360: "Debrief closed / The 60 minutes are over. 3 of 5 questions were not answered and are recorded as **unverified**. / Next Start · Sun 18 Oct from 01:00 / Start unlocks tomorrow from 01:00 / Use Jump to tomorrow in the judge guide / Sign out / Speech becomes short work notes…". Recorded as "real screen, clock advanced client-side (not a 60-min wall-clock wait)" — evidence for copy, layout and footer only, not for the server-side expiry. 1280 (L2-09b) not captured: the remaining questions were used for the Done screen at 1280 (one sandbox, one device). Guide state after the timeout: R25-004.

### K. Re-verification of the 17 Oct fidelity gaps (UI-001 … UI-120)

Status: FIXED (observed as the board/ruling says), STILL A GAP (reproduced), RULED (deliberately changed by R1–R19 / 9.9 — not a gap), NOT RE-CHECKED (no reachable state today), NEW.

| Id | Status | Evidence (what I saw on `11b9149`) |
|---|---|---|
| UI-001 | FIXED | "Try as Staff / Supervisor / Owner" titles + board lines + "Open staff screen / supervisor view / owner view" |
| UI-002 | FIXED | logo mark + "Bee6", `.b6-seg` ID/EN on every staff screen (shots `r25-B-*-360`) |
| UI-003 | FIXED | `.b6-chip--line` "DEMO OUTLET · FICTIONAL DATA" under the outlet line, above the h1 |
| UI-004 | FIXED | h1 32px/300/-0.6px (360), 48px/300/-1px (1280), computed |
| UI-005 | FIXED | no glass box at 360 (entry text has no "Fictional shop…" line) |
| UI-006 | FIXED | handle 84 px, kicker + teal chip DEMO / STAGE n OF 5, title line, "Day 1 of 3" clock on capture |
| UI-007 / UI-008 | FIXED | open sheet = handle + "Welcome" label + one cardbox; no "YOUR JOURNEY" on any phone sheet |
| UI-009 | FIXED | with ID the handle reads the ID title (e.g. entry) |
| UI-010 / UI-101 / UI-103 | FIXED | `.b6-kick` "STEP 1" mono 12px no border; kicker 12px/.3px; card titles 20/24 px weight 400 |
| UI-011 | FIXED | 3 `.prev` illustration blocks on D2-01 at 1280 |
| UI-012 / UI-109 | FIXED | h1 "Set up this device", board sub, "6-digit code", 28px mono field, no Demo access box |
| UI-013 | FIXED | "Code not recognized, expired or already used. / Ask your supervisor for a new code." (401) |
| UI-014 | FIXED | "No connection. / Try again when the signal is steady." (offline) — amber vs red not measured |
| UI-015 | FIXED | "Staff · day 1 / Set up the staff phone / STEP: PAIR THE DEVICE / For this demo the code is 000000…" |
| UI-016 | FIXED | single mono field, "Set up" active after fill |
| UI-017 | RULED (R10) | idle keeps a muted footer "Sign out"; no header Sign out |
| UI-019 | PARTLY FIXED → **R25-003** | 1280 `/pair` and `/capture`: chips STAFF / DEMO DATA + outlet line present; header "Sign out" `.btn2` missing |
| UI-020 / UI-023 / UI-102 | FIXED | "Device set up / For Demo Bakery · Outlet 1" + the 4 board steps |
| UI-021 | FIXED | pair_done handle/card |
| UI-022 | FIXED | no yellow bar anywhere; "ends HH:MM" in the mono slot |
| UI-030 | **STILL A GAP → R25-001** | no "Ready to open" stage on the sandbox idle screen (day 1 and day 2) |
| UI-031 / UI-033 / UI-063 | FIXED | teal orb stage, h1 "Listening", two-line sub, mono day line; 1280 column centred with `.dtop` chips |
| UI-032 | FIXED | End (disabled) then one red "Sign out (cancels today's session)"; no Cancel session; after closing muted "Sign out" |
| UI-034 / UI-107 | FIXED | "CARD n OF 5" kicker, speaker kicker, board note |
| UI-035 | FIXED | "ALL 5 CARDS SPOKEN / Well done. Day 1's speech is captured…" |
| UI-036 | FIXED | sub "Closing time has passed. Tap End when operations are done."; handle "All cards spoken · jump to closing" |
| UI-037 / UI-070 | FIXED | both sign-out sheets carry the full board copy incl. the unpair sentence |
| UI-038 | RULED (R2) | confirm sheet kept and restyled `.b6-dsheet` |
| UI-039 | FIXED | "Preparing your questions" stage, amber alert, "Day 1 · debrief window 60 min" |
| UI-040 | FIXED (answered variant) | h1 "Debrief complete", "k of n were not answered…", mono Next Start, locked Start, muted Sign out |
| UI-041 | NOT RE-CHECKED (tick paused, R13) | fresh-sandbox debrief stays "Preparing"; question screens verified on the seeded `debrief` instead |
| UI-050 | FIXED | WebShell `.dtop` + 210 px rail + chips |
| UI-051 | FIXED (three tiles, R16) | WORK NOTES / DEBRIEF ANSWERS / NEED YOUR CHECK, date segmented control, filter chips |
| UI-052 | FIXED (R7) | STAGE 2 OF 5 on supervisor pages when days_done = 1 |
| UI-053 / R8 | FIXED | constraints inside collapsed "Rules for Bee6 (optional)" |
| UI-054 / UI-055 / UI-086 | FIXED | version control, Book/Table, cover, "Improved with Bee6", IMPROVED badge + Before |
| UI-056 | RULED (R11) | placeholder "COMING SOON" |
| UI-057 / UI-105 | NOT RE-CHECKED | no empty-reviews sandbox visited today (`review-due` has a due review; `decided` shows the fast-forward control) |
| UI-058 | RULED (R5) | `/sign-in` keeps the DEMO ACCESS box |
| UI-060 / UI-080 / UI-082 / UI-117 | FIXED | greeting + hello line, progress sentence, waiting card copy + "Review in order", after-state copy, next-review copy |
| UI-061 | FIXED | owner guide "Do this now" rows + "Reset the demo" control |
| UI-062 | NOT RE-CHECKED | no owner sandbox with nothing waiting and nothing decided |
| UI-064 / UI-106 | RULED (R4) | real dates |
| UI-071 | FIXED | "Today's session is still open" + board sub + "You signed out before ending. Nothing was lost." |
| UI-072 | FIXED (copy/layout, J) | "Debrief closed" + "… recorded as **unverified**" |
| UI-073 | NOT RE-CHECKED | change-label dialog not opened in this run (no spare "Needs your check" row to spend) |
| UI-074 | NOT RE-CHECKED | "Not seen yet" placeholders need a fresh-sandbox supervisor before day 1 is processed |
| UI-075 | FIXED | "Review" buttons, "2 moments · Thu 15 Oct, Fri 16 Oct" |
| UI-076 / UI-104 | FIXED | "Bee6 is writing a proposal / This can take up to a minute. Please keep this page open." + chip "Asking Bee6…" |
| UI-077 | MATCH | detail structure as before (Before:/After: labels) |
| UI-078 | FIXED (inline panel, 9.9.1) | "Reject this proposal?" form |
| UI-079 | FIXED | banner + "Marked feasible ✓" + "Sign out · pick Owner" |
| UI-081 / UI-119 | FIXED | `.b6-dsheet`, Plus Jakarta Sans, board copy, red above Cancel |
| UI-083 / UI-084 / UI-085 / UI-118 | FIXED | board layout, sticky decision card, "Not available: the SOP changed", "Both decided. Nice and calm.", Back to home primary |
| UI-087 / UI-113 | FIXED (R9b) / RULED (deferred) | kicker + time-left chip + bars + category chip + time + explanation line; template wording stays |
| UI-100 | NOT MEASURED | box radius/padding not measured this run |
| UI-108 | FIXED | pill "JUDGE GUIDE [STAGE n OF 5] ⌄" |
| UI-110 / UI-111 | RULED (harness artefact, DEV-1) | persistent profile: "QUESTION 4 OF 5" after 2 answers + 1 skip; whole-debrief numbering |
| UI-112 | FIXED | no Jump control on the question card |
| UI-114 / UI-115 / UI-116 / UI-120 | FIXED | see E and F |

## 2. Defect list (severity order)

| Id | Sev | What | Expected | Actual | Repro | Evidence | Suspected file | Kind |
|---|---|---|---|---|---|---|---|---|
| **R25-001** | **P0** | Sandbox `/capture` idle screen has no stage: no h1 "Ready to open", no orb, no "Day n of 3 · date", no `.b6-sub` | Board P2-04 / L2-02: orb "Start", h1 "Ready to open", sub "Tap Start to begin listening…", mono day line, Start, note | `main` = sr-only status + "Start" + "Sign out" + note only — on day 1 of a fresh sandbox and again on day 2 after Jump to tomorrow (360 and 1280) | Entry → Staff → pair 000000 → Open the listening page (or: finish a day, Jump to tomorrow) | `r25-B-capture-idle2-360.png`, `r25-B-day2-idle-1280.png`, `b2c-dom.js` DOM dump; `capture/config` carries `last_ended {business_date: 2026-10-16, end_reason: selesai, debrief_ends_at_ms: 1792165500000}` from the template | `app/capture/page.tsx` L330 `debriefEndsAtMs` is non-null for an expired template `last_ended`, so the page renders `DebriefFlow`; `app/capture/debrief/DebriefFlow.tsx` `closed` + `expired` arm (~L429–452) returns `{headline}{primary}` and `headline` is null on a sandbox → no `StageScreen` | functional + presentational (first screen every judge sees) |
| R25-002 | P1 (ruling needed) | "End today" on the open-session screen ends the day without the confirm sheet | R2: "Confirm stays… both confirm panels state it cannot be undone"; tech spec §8 step 10: the close instant is "Yes, end" in the confirm | Click → POST `/end` → "Preparing your questions" directly | Run a day, Jump to closing, Sign out (closed), re-pair, open `/capture`, tap "End today" | `cd2-out.json` (`d3EndDialog: null`, then Preparing) | `app/capture/OpenSessionView.tsx` L44 `onClick={closingReached ? onEnd : onCancel}` → `page.tsx` `handleOpenEnd` (no `openSelesaiConfirm`) | functional; if the tech-lead rules this path is meant to be direct, downgrade to board note |
| R25-003 | P1 | Staff header at ≥ 900 px has no "Sign out" button | Board L2-01/L2-02/L2-03/L2-09, R17: `.dtop` right = `.seg` + `.btn2` "Sign out" | Header right = ID/EN only on `/pair` and every `/capture` state at 1280; sign-out exists only as the footer link | open `/capture` at 1280 | `r25-B-day2-listening-1280.png`, `b7-out.json` `headerBtns` | `app/shop/StaffTopBar.tsx` supports `signOut` from 900 px but `app/capture/page.tsx` / `PairScreen.tsx` do not pass it | presentational |
| R25-004 | P1 (clock-patched evidence) | After the debrief times out the guide still shows the question card ("Answer the questions", no Jump to tomorrow) while the page says "Use Jump to tomorrow in the judge guide" | Done/closed card with "Jump to tomorrow »" (as on the Done screen) | handle "STAGE 2 OF 5 · Answer the questions"; open card = DEBRIEF TIP, no control | J method (client clock +61 min on the question screen) | `r25-J-timedout-guide-360.png`, `b6-out.json` `timedOutGuide` | the timed-out transition in `DebriefFlow.tsx` does not publish the `debrief_done` guide key (`app/demo/guide-bridge.ts`) — to confirm with a real 60-min expiry | functional (guide), judge-visible only when a debrief times out |

Observations not counted as defects (need a ruling): "One proposal can be made now" never shown (E); denied mic leaves an open server session ("Today's session was interrupted" on reload) (D); "Reject with reason" stays disabled for a 1-character reason (F); the sr-only h1 "Shop phone" on every debrief state is deliberate (`C-cap-title`).

## 3. Hard-rule checks (runtime)

- Audio/base64: no segment body logged; `/segments` responses carry only `{seg_id, lines}`; no audio field in any API response captured (`net` logs redact tokens). Clean.
- Names / device ids: supervisor day record, proposals, approvals, home, reviews — no `jdg-*`, no staff name; "A staff member answered". Clean.
- RBAC live probe (`rbac3.js`, each session's own bearer sniffed from its page calls, 12:55): supervisor → `GET /home` 403 "Role supervisor may not perform home:read", `POST /proposals/<id>/approve` 403, `GET /capture/config` and `POST /demo/next-day` 403 "A device credential is required"; owner → `GET /questions` 403 "may not perform questions:read", `POST /proposals/<id>/review` 403, device routes 403; staff device token → `/home`, `/day/<d>`, `/proposals`, `/sop`, `/approve` all 401 "Invalid or expired token"; no bearer → 401 "Missing bearer token" everywhere. Allowed by the spec and observed 200: supervisor `GET /questions` (supervisor queue view), owner `GET /day/<d>` (owner view), owner `POST /proposals/generate` (web-backend-rbac §331: Owner + Supervisor) — the last one created a suppressed proposal on `decided` (my probe, 12:56). PASS.
- Region-from-config: not observable from the browser; not checked.

## 4. Not verified and why

- Fresh-sandbox debrief questions (R13): tick paused by design → "Preparing" forever; question/done/timed-out verified on the seeded `debrief` instead.
- Timed-out board at 1280 (L2-09b) and the Done screen at 360: one `debrief` seed = one device; I spent the remaining questions on the Done screen at 1280. A second `debrief` re-seed would cover both in ~5 min.
- "Not seen yet" watch placeholders (R14) and the empty Reviews card (UI-057/105): need states not reachable today.
- Ask on `debrief` (three Ready categories with real gaps): my supervisor profile for that sandbox was already signed in from an earlier step and the sign-out helper failed; the flag-off proof was taken on `proposals` instead.
- `config/regions.yaml` model location: not observable from the browser; unchanged code.
- Chrome extension visual pass: not done (Playwright screenshots reviewed by eye for the key screens: idle, listening, preparing, day record 1280, listening 1280).

## 5. Sandboxes consumed by this run (for re-seeds)

`proposals` (both proposals decided by the owner: SOP v2 shipped; one suppressed Ask), `proposals-one` (proposal marked feasible), `debrief` (Q1–Q2 answered, Q3 skipped, Q4 answered, Q5 skipped; day 2 run and ended), `decided` (one suppressed proposal from the owner RBAC probe; nothing else), `review-due` untouched (review not decided), `owner` re-seeded 11:57 and not used since. Four new demo sandboxes were created by the Entry page (per-IP count +4).

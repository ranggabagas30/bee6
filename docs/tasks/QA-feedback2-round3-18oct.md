# QA — demo feedback 2, round 3 on the final staging build (Sun 18 Oct 2026, 18:56–19:45 WIB)

Target: https://web-develop-33uzb53tza-et.a.run.app (Cloud Run `web-develop`, revision **web-develop-00048-vm2** = develop
`9d59b90`, Firestore db `staging`, DEMO_MODE, caps raised). Health `GET /api/health` → 200 `{"status":"ok"}`.
Driver: Playwright 1.64.1 Chromium (headless; fake microphone `--use-file-for-fake-audio-capture=<wav>%noloop`), one
persistent profile per sandbox; phone emulation 360×640 (`isMobile`, `hasTouch`), 390×844 and laptop 1280×800. Audio = the
FICTIONAL round-2/3 clips in `private/rehearsal/d{d}-c{1..5}.wav` concatenated per day (3 s lead-in, 9 s between cards), plus one
synthetic (macOS `say`) day-3 phone card that speaks the FICTIONAL seeded staff names "Bella" and "Ari" to observe the scrub.
Claude-in-Chrome was not used (everything is scripted, repeatable). No product code edited, nothing pushed, no infra touched,
pilot never touched. Sources of truth read first: `docs/internal_testing/demo-feedback-2.md`, `docs/tasks/demo-feedback-2-ui.md`,
`docs/tasks/demo-feedback-2-round3.md`, `lib/demo/script.ts`, `lib/demo/guide.ts`, `lib/demo/credentials.ts` (all at 9d59b90).

Evidence root (this session's scratchpad):
`<LOCAL_PATH>/qa18/`
— `shots/*.png` (345 screenshots), `out-*.json` (raw page text, bounding boxes, API request log per run), `pw/*.js` (the harness),
`audio/` (the day wavs). Paths below are relative to that root.

**Sandboxes started: 3 of the allowed ~6** (A = `jdg-9200b75fdd1f`, the full judge path at 360 px, days 1–3 → supervisor → owner;
B = laptop pair + day 1 at 1280 px, then the same sandbox at 390×844 for one day with the phone card; C = the fresh sandbox the
expired-session test starts, paired only). `sbx-uitest*` fixtures untouched. Two phones uploaded in parallel at most.

## VERDICT: DO-NOT-SHIP (one reproduced judge-visible defect, D-1; everything else in items 3, 4, 9, 10, 11, 12–16 passes)

Zero tolerance applies: D-1 is a real, reproduced defect on the new item-10 screen. Only Rangga can accept it as a known gap. If he
does, every other acceptance bullet below is proven and the build is otherwise clean (0 console errors except the transient 503s
in O-2, 0 axe violations on 20 page states, no horizontal overflow at 360/390/1280).

## Defects (reproduced)

- **D-1 [major] The quoted debrief line shows the shop name as "[STAFF] Bakery".** Every phone-call question on this build read
  `“Hello, [STAFF] Bakery, thanks for calling. …”` (3 of 3 questions: sandbox A day 2 and day 3, sandbox B at 390 px). The stored
  thread line is `Hello, Demo Bakery, …` (the supervisor's `/day` shows it intact, `shots/A3-p360-day-scroll2.png`). Cause (read in
  code, not guessed): `lib/debrief/scrub.ts` `expandScrubNames` turns the seeded FICTIONAL staff names "Ari Demo" / "Bella Demo"
  (`scripts/seed.ts` `DEMO_SEED.staff`) into the tokens `Ari`, `Bella`, `Demo` (every token ≥ 3 code points), and
  `lib/debrief/question-line.ts` `scrubQuestionLine` then replaces the surname token "Demo" inside the shop name. Repro: pair with
  000000 → run day 2 → read card d2-c3 → End → the question card "Bee6 heard:" first line. Observed `[STAFF] Bakery`; expected
  `Demo Bakery` (the brief: "a seeded staff name appears as [STAFF]" — a staff NAME, not the shop). Judge-visible on the headline
  new feature; it looks like a bug to a judge ("why is the bakery a staff member?"). The same expansion runs on the answer-reason
  scrub (`scrubReason`), so a typed reason containing "Demo Bakery" is very likely stored as "[STAFF] Bakery" too (not exercised
  live). Fix is for `developer`/Rangga (not QA): e.g. seed surnames that do not collide with the outlet name, or drop tokens equal
  to a word of the outlet name — Rangga decides. Evidence: `shots/A-p360-d2-question-EN-view.png`, `shots/A-p360-d3-question-EN-view.png`,
  `shots/B-p390-d1-question-EN-view.png`, `out-debrief-A-2.json` / `out-debrief-A-3.json` / `out-debrief-B-1.json` (`debrief.quotedLines`).

## Results table

| Item | Viewport | Result | Evidence | What I did / observed |
|---|---|---|---|---|
| (3) upload line at the TOP under the top bar, visible with the guide sheet open while a card waits | 360×640 | PASS | `shots/A-p360-d1-uploading-sheet-open.png`, `A-p360-d2-card3-phone.png`; `out-day-A-1.json` `checks.uploadStatusTop` | Start → sheet opened itself → first "Uploading" at +14 s: `data-testid=upload-status` box y=100 h=17 (top bar h=88), sheet body top 252 → not covered; also seen on day 2 (`Uploading` above the orb with "Card 3 of 5 · A phone order" open) and day 3 |
| (3) same at 390×844 | 390×844 | PASS | `shots/B-p390-d1-uploading-sheet-open.png`; `out-day-B-1.json` | upload box y=100, sheet top 426 |
| (3) End/Mulai reachable | 360, 390 | PASS | `shots/A-p360-d3-closing.png`, `B-p390-d1-end-confirm.png`; `out-day-A-2.json` `checks.afterCollapse.endBox` {y:486,h:56} (viewport 640) | sheet collapsed → "End today" fully inside the viewport; one tap on End today through the open sheet → confirm sheet "Yes, end" → `POST …/end` 200 (A ×3, B ×1) |
| (3) pilot layout unchanged | — | NOT TESTABLE on staging (DEMO_MODE) | — | skipped as instructed |
| (9) guide opens by itself at Mulai — phone sheet | 360×640 | PASS | `shots/A-p360-d1-after-start.png`, `A-p360-d2-after-start.png`; `out-day-A-{1,2,3}.json` `checks.guideOpenedAtStart` | sampled `aria-expanded` every 250 ms after tapping Start: false ×4–5 then true (opens ~1.3 s after the tap, when the phase flips to listening); day 1, day 2 **and** day 3 |
| (9) guide opens by itself at Mulai — laptop panel | 1280×800 | PASS | `shots/B-l1280-d1-after-start.png`; `out-day-B-1.json` (first run) | side panel open with "Card 1 of 5" next to the orb and the End button; nothing covered |
| (9) not on reload/resume | 1280×800 | PASS | `shots/B-l1280-d1-after-reload.png`; `checks.guideAfterReload.openedByItself=false` (12 samples) | reload mid-session → page shows "Today's session was interrupted · Cancel today" (by design, R-20 D2) and the guide stays collapsed |
| (9) orb visible / End reachable after collapse | 360, 390 | PASS | `shots/A-p360-d1-collapsed.png`, `A-p360-d3-closing.png`; `afterCollapse.orbBox` | orb + headline + End today visible with the sheet collapsed; no horizontal overflow |
| (11) debrief has no "Check for new questions" button; still advances by itself (10 s poll) | 360, 390 | PASS | `out-day-A-2.json` `debrief.questionPolls` (18 GETs at 19:05:22, :33, :43, … :08:13 = every 10 s); `checkButton*` = 0 on preparing, question, done and inside the guide; `shots/A-p360-d2-preparing.png`, `A-p360-d2-done.png` | "Preparing your questions" → question appeared after 171 s with no tap; day 3: 15 polls; day 1 and B: 0 buttons |
| (15) `/sign-in?as=supervisor` form centred at 1280, unchanged at 360 | 1280×800 | PASS | `shots/signin-supervisor-l1280-collapsed.png`, `-guide-open.png`; `out-signin-l1280.json` `solo.*.geometry*` | form 440 px wide: left gap 420 = right gap 420 with the pill collapsed; 240 = 240 with the panel open (body padding-right 360 px); owner identical |
| (15) 360 | 360×640 | PASS | `shots/signin-supervisor-p360-collapsed.png`; `out-signin-p360.json` | form 328 px, 16 px gutters both sides, unchanged with the sheet open |
| (4) `?as=supervisor` / `?as=owner`: no Staff/Supervisor/Owner tabs, kicker "Sign in as …" | 360, 1280 | PASS | `out-signin-*.json` `solo.{supervisor,owner}` (`radios: 0`, `fieldsets: 0`, kicker "SIGN IN AS SUPERVISOR"/"OWNER") | h1 "Sign in", kicker, one "Demo access" card |
| (4) page shows only the one-line pointer | 360, 1280 | PASS | same; `mainText` | "Your demo email and password are in the Judge Guide." + the private-copy line; no email/password on the page (`credentialOnPage: false`) |
| (4) guide pill does not open itself | 360, 1280 | PASS | `guideSelfOpened: false` (10 samples over 2.5 s) | handle reads "Supervisor email and password" / "Owner email and password" |
| (4) guide shows the email+password card, copyable | 360, 1280 | PASS | `shots/signin-supervisor-l1280-guide-open.png`, `signin-owner-p360-guide-open.png`; `credBold`, `credUserSelect: "all"` | `<b class="cred">supervisor.judge@example.com</b>` / `bee6-demo`, `user-select: all`; Bahasa handle "Email dan kata sandi Supervisor" |
| (4) "Fill in the form" fills both fields, does not submit | 360, 1280 | PASS | `afterFill` (`email`, `password` set, `url` unchanged, `newApiRequests: []`), `shots/signin-*-filled.png` | sheet collapses after filling on the phone (so Sign in is reachable); no `POST /api/v1/demo/session` |
| (4) Sign in works | 360, 1280 | PASS | `out-web-A-p360-supervisor.json` `signin` (6.2 s → `/day/2026-10-18`), `out-web-A-p360-owner.json` (6.2 s → `/home`), `out-web-A2-l1280-sop-owner.json` (6.2 s → `/home`); `shots/A-p360-sup-landed.png`, `A2-l1280-own2-landed.png` | via the judge path: `/` → role card → Fill in the form → Sign in → "Signing in… / Preparing your demo shop…" → landed; no blank frame (6 s burst at 250 ms) |
| (4) entry card on `/` mentions where the credentials are; ≥ 900 px auto-opens on first visit | 1280, 360 | PASS | `shots/entry-first-l1280.png`; `out-signin-l1280.json` `entry.guide.open=true`, `mentionsCredentials=true` | panel open on first visit with "Supervisor and Owner sign in with the email and password this guide shows on the sign-in page."; at 360 the sheet is collapsed (by design) and the same sentence is in the card |
| (12–14) Sign out as supervisor → `/`, no tabs | 360 | PASS | `out-web-A-p360-supervisor.json` `signout` (`/sop` → `/` in 224 ms, `radios: 0`); `shots/A-p360-sup-signed-out.png` | 120 ms burst: no blank frame; entry page with the three cards |
| (12–14) Sign out as owner → `/`, no tabs | 360, 1280 | PASS | `out-web-A-p360-owner.json` (244 ms), `out-web-A2-l1280-sop-owner.json` (205 ms), `out-web-A-p360-sop-owner.json` (244 ms) | 0 blank frames in every burst |
| (12–14) each of the three role cards works after sign-out | 360 | PASS | `A-p360-sup-*`, `A-p360-own-*`, `A-p360-expire-fresh-paired.png` | Staff → `/pair`; Supervisor → solo sign-in → `/day`; Owner → solo sign-in → `/home` (all "You are continuing your demo (ends 03:56)") |
| (12–14) `/sign-in`, `/sign-in/`, `/sign-in?as=FOO` → `/`; `?as=staff` → `/pair` | 360, 1280 | PASS | `out-signin-*.json` `redirects`; `shots/redirect-*.png` | all land on `/` (h1 "A small shop's day…", 0 radios) / `/pair` ("Set up this device"); `/day`, `/home`, `/sop` without a session → `/` |
| (12–14) expire/clear the session → `/day` bounces to `/`; a fresh sandbox can start | 360 | PASS | `out-web-A-p360-expire.json`; `shots/A-p360-expire-landed.png`, `A-p360-expire-fresh-paired.png` | removed `localStorage bee6.demo`, deleted the firebase IndexedDB dbs (reported "blocked" while in use; `bee6.demo` gone) → `/day` → `/` in 106 ms → Open staff screen → 000000 → paired, new `sandbox_key` (sandbox C) |
| (12–14) Back button does not loop | 360, 1280 | PASS | `signout.back1/back2/forward` | after Sign out: Back stays on `/` (replace), second Back = the solo sign-in page (signed-out form, no bounce), Forward `/` |
| (12–14) no flash/blank on sign out | 360, 1280 | PASS | bursts `shots/A-p360-sup-signout-burst-*.png` etc. | `/sop` → `/` in 205–244 ms; the one "blank" flag at 360 owner sign-in (`own2-signin-burst-04`) is my probe failing during navigation — the frame shows "Signing in… / Preparing your demo shop…" |
| (16) after approval: tabs v1 "· current", v2 plain date, pending sentence | 1280 | PASS | `shots/A2-l1280-own2-sop-book.png`; `out-web-A2-l1280-sop-owner.json` `sop` | "11/10/26 · current" \| "19/10/26" + "Version 2 starts on Mon 19 Oct. Until then, version 1 applies."; no "upcoming" anywhere (`hasUpcoming: false`) |
| (16) 360 wrap, EN and ID, Table view | 360 | PASS | `shots/A-p360-own2-sop-book.png`, `-sop-book-ID.png`, `-sop-table.png`, `-sop-table-ID.png`; `out-web-A-p360-sop-owner.json` | ID: "11/10/26 · saat ini" \| "19/10/26", "Versi 2 berlaku mulai Sen 19 Okt. Sampai saat itu, versi 1 yang berlaku."; Table "Steps in version 2 as a table"; `scrollWidth 360 = innerWidth` in both views |
| (10) "Bee6 heard:" + 1–2 quoted redacted lines on the day-2 phone-call card | 360 | **FAIL (D-1)** otherwise correct | `shots/A-p360-d2-question-EN-view.png`, `A-p360-d2-question-EN.png` (full page) | day 2 read via the real capture path (fake mic, 8 of 8 segments accepted) → PHONE_CALL question "Around 02:04 there was a phone call. Is that right?" → "Bee6 heard:" + both d2-c3 lines verbatim (numbers normalised by the transcriber: "50", "10:00") — but the shop name is scrubbed to "[STAFF] Bakery" |
| (10) lines are plain text | 360 | PASS | `out-debrief-A-2.json` `debrief.quotedHtml` (`children: 0`) | `<p class=heardLine>` with text nodes only, typographic quotes |
| (10) a seeded staff name appears as [STAFF] | 360 | PASS on privacy, token differs — see O-6 | `shots/A-p360-d3-question-EN-view.png`; `out-debrief-A-3.json` | spoken "Bella" / "Ari" were already `[PERSON_NAME]` in the stored line (SDP at ingest), shown as such; no name reached the screen. The `[STAFF]` token appeared only for the surname "Demo" (D-1) |
| (10) generic why-sentence replaced | 360, 390 | PASS | `whyPresent: false` in all three question runs | "It needs your answer to be sure" absent when lines are shown |
| (10) 360 px layout with two long lines | 360×640 | PASS | `shots/A-p360-d2-question-EN-view.png`, `-EN-bottom.png`; `out-debrief-A-2.json` | lines wrap at 272 px (right edge 316 < 360), `scrollWidth 360`; Yes/No side by side (both y=514, 151 px wide); Next question (y=224 after scroll) and Skip (y=327) reachable; day-3 lines truncated with "…" at 160 code points |
| (10) 390×844 | 390×844 | PASS | `shots/B-p390-d1-question-EN-view.png`; `out-debrief-B-1.json` | Yes/No y=514 w=166; Next y=697, Skip y=800 after scroll; no overflow |
| (10) Bahasa lead-in "Bee6 mendengar:" | 360, 390 | PASS | `shots/A-p360-d2-question-ID-view.png`; `heardID: true` ×3 | lead-in translated; the quoted lines stay as spoken (English) — see O-1 for the ID heading |
| (10) `localStorage bee6.debrief.answers` has only the 5 keys and no line text | 360, 390 | PASS | `out-debrief-A-3.json` / `out-debrief-B-1.json` `debrief.answersPendingParsed` (captured while the POST was held for 4 s) | `["question_id","debrief_business_date","answer","reason","answered_at_ms"]`, then `[]` once uploaded; `anyLineTextInLS: false` over every localStorage value |
| (10) the answer POST body has no line text | 360, 390 | PASS | `debrief.answerPosts[0].body` | exactly the five keys, `reason` = my typed text |
| (10) `GET /api/v1/questions` → `Cache-Control: private, no-store` | 360, 390 | PASS | `debrief.questionPolls[*].cc` (34 polls) | every response |
| (10) reload the phone after the deploy | — | n/a | — | fresh profiles were used, so every bundle was the new one |
| a11y (axe-core 4, WCAG 2.x A/AA) | 360, 1280 | PASS | `out-axe.json` | 0 violations on 20 page states (`/`, `/sign-in?as=supervisor`, `/pair` ×guide open/closed ×2 widths; owner `/home`, `/sop`, `/proposals` ×2 widths; staff `/capture` ×guide) |
| console / network | all | PASS with O-2 | `out-*.json` `console`, `requests` | 0 page errors; only "Failed to load resource: 503" during the O-2 retries and one CSS preload warning on `/` |

## Hard-rule checks at runtime (what I could observe from the browser)

- Audio/base64: segment `PUT`s carry the audio in the request only; no response, page text or localStorage value held audio or
  base64. Cloud Run logs / Firestore were **not** readable from this role (not verified server-side).
- Names: no staff name on any screen or in any captured response (`out-*.json` grep for Bella/Ari: 0); the supervisor's day record
  shows "[PERSON_NAME]" and "A staff member answered; no names are kept"; no device id on supervisor/owner screens (`dayDeviceIdLeak: false`).
- Answers: POST body = device-scoped five keys only; no role, no name.
- RBAC: not re-probed this round (round 3 of 16 Oct covered it); the bare `/day`, `/home`, `/sop` without a session bounce to `/`.
- Region-from-config: not provable from the browser.

## Observations (not defects of items 3–16, for the record)

- **O-1** The Bahasa question heading is generic and shows a degenerate range: "Sekitar pukul 02:04–02:04 ada kegiatan kerja. Benar?"
  while EN says "Around 02:04 there was a phone call. Is that right?" (`shots/A-p360-d2-question-ID-view.png`). Pre-existing
  PROVISIONAL ID copy, not touched by this round.
- **O-2** Transient `PUT /api/v1/segments/…` **503** ("transcription upstream unavailable" class, round-3 O-7) with only two phones
  uploading at the same time: 5 occurrences (day 2 ×2 on the same segment, day 3 ×3), every one retried to 200 within 2–15 s, no
  "Some speech was not captured", all 8/8 and 6/6 segments stored. Judges in parallel remain a quota risk (dev-ops).
- **O-3** Reloading `/capture` mid-session shows "Today's session was interrupted · Cancel today" (R-20 design); the fake mic restarts
  the clip, so I cancelled and re-ran that day on sandbox B (`shots/B-p390-cancel-*.png`, `POST …/discard` → cleaned).
- **O-4** Guide copy says "Open a proposal: read the evidence…" (card `proposal_detail`) but the list control reads "Review"
  (`C-propd-open`). Minor wording mismatch, pre-existing.
- **O-5** The first SOP version's tab date is judge-day minus 7 ("11/10/26") and every demo day's record is dated "Sun 18 Oct"
  (the next-day jump shifts earlier days back) — by design (R-19), noted so nobody reads it as a bug.
- **O-6** Spoken staff names are redacted at ingest by Sensitive Data Protection to `[PERSON_NAME]`, so the read-time `[STAFF]`
  scrub never had a name left to catch; privacy outcome correct, token differs from the brief's wording.
- **O-7** My harness, not the product: the first sandbox-A day-1 run looked for a button named "End" (the sandbox label is "End
  today"), and the first sandbox-B 390 px end closed the browser before `POST …/end` left — both re-run from the same state; the
  "empty" thread cards in the full-page `/day` screenshot are `content-visibility: auto` not painting off-screen cards — the
  scrolled viewport shots show them rendered (`shots/A3-p360-day-scroll{1,2}.png`).

## Not tested / could not test (honest list)

- Pilot layout (not on staging). Real microphone, real phone, Bluetooth, screen-wake: not possible here (manual list below).
- Cloud Run logs and Firestore for audio/base64 or `lines` in log lines: no GCP access from this role; only the browser-visible
  requests and storage were checked.
- The owner "reject the other" path and Reviews fast-forward: only one proposal was asked for (CS, days 1+2); the harness did not
  tap "Ask for another proposal", so the phone-call proposal was never generated. Approve → SOP v2 is covered.
- A cold (brand-new context) supervisor sign-in at 1280 px: the 1280 sign-in was done inside the continuing sandbox A (copied
  `bee6.demo`), to stay within the sandbox budget. The cold path was exercised at 360 px via the expired-session test (sandbox C).
- Claude-in-Chrome (real profile) was not used; every check is a Playwright script that can be re-run after a fix.

## Human manual-test checklist (real phone, Rangga/Tiffany)

1. Pair → Start: the guide sheet should slide open by itself about a second after Start (item 9) — on days 1, 2 and 3; it must NOT
   open after a reload of the page.
2. With the sheet open on "Card 1 of 5", speak the card and watch the line under "Demo Bakery · Outlet 1" say "Uploading" then
   "Upload succeeded" above the orb (item 3), with the sheet still open.
3. Day 2, after End: "Preparing your questions" should turn into the phone-call question by itself (no button) within ~3 min; the
   card shows "Bee6 heard:" and the two phone-order lines — check whether "Demo Bakery" reads "[STAFF] Bakery" (D-1).
4. Switch to ID on that screen: "Bee6 mendengar:" above the lines; note the heading wording (O-1).
5. Sign out as supervisor and as owner → you should land on the entry page with the three cards (no Staff/Supervisor/Owner tabs);
   press Back once → still the entry page.
6. Owner → Approvals → Approve #1 → SOP: tabs "11/10/26 · current" and "19/10/26", sentence "Version 2 starts on …", no "upcoming".

## Re-test 2 (D-1) — Sun 18 Oct 2026, 20:05–20:22 WIB

Target: the same URL, revision **web-develop-00049-q54** = develop `0c9e9e3` (PR #120, `fix(debrief): keep the shop name in quoted
question lines when a staff token is also an outlet word`), Firestore `staging`, DEMO_MODE, `pipeline-tick-staging` every 2 min.
Same harness (`pw/*.js`, Playwright 1.64.1 Chromium headless, fake microphone, persistent profile), **one fresh sandbox D**
(`jdg-75d530e3724d`, new profile `prof/D`, so every bundle was the new one; no old context reused). Phone emulation 390×844
(`isMobile`, `hasTouch`); the day-3 question was also looked at from the same sandbox at 1280×800 (screenshot only, no answer).
Audio: the FICTIONAL `day1.wav`, `day2.wav` (d2-c1..c5, the exact d2-c3 phone card) and `day3n.wav` (d3-c2 replaced by the synthetic
phone card that speaks the FICTIONAL seeded names "Bella" / "Ari"). Harness additions this round: `lib.js` now keeps the body of every
`GET /api/v1/questions` 200 (so the server's own `lines` are evidence, not only the DOM), `debrief.js` gained `peek` (other-viewport
look without answering) and the shop-name / seeded-name assertions, `rolecheck.js` signs in as supervisor then owner in the same
sandbox and greps `/day`, `/proposals`, `/home`, `/sop`. No product code edited, nothing pushed, pilot never touched,
`docs/internal_testing/demo-feedback-2.md` not changed.

Evidence: same root as above; files `shots/D-*.png` (64), `out-pair-D.json`, `out-day-D-{1,2,3}.json`, `out-debrief-D-2.json`,
`out-debrief-D-3.json`, `out-debrief-D-3-peek-l1280.json`, `out-rolecheck-D-p390.json`, logs `pair-D.log`, `day-D-*.log`,
`debrief-D-*.log`, `rolecheck-D.log`.

### VERDICT: SHIP — D-1 is fixed on the live build; nothing else in item 10 moved; no new defect reproduced.

| # | Check | Viewport | Result | Evidence | What I did / observed |
|---|---|---|---|---|---|
| (a) | Quoted line shows "Demo Bakery" intact (D-1) — day-2 d2-c3 card | 390×844 | **PASS** | `shots/D-p390-d2-question-EN-view.png`; `out-debrief-D-2.json` `debrief.quotedLines`, `shopNameIntact: true`, `staffTokenOnShop: false`; server body in `requests[]` (GET 20:14:15.518) | Pair 000000 → day 1 (day1 clips, no question, "Debrief complete" after 130 s, Jump to tomorrow) → day 2: Start → 5 cards read through the fake mic (card 3 = the d2-c3 phone order; 8/8 segment PUTs stored, one 503 retried to 200 in 2 s) → Jump to closing → End today → Yes, end → "Preparing your questions" → the PHONE_CALL question appeared by itself after 78 s. Card: "Around 03:11 there was a phone call. Is that right?" / "Bee6 heard:" / `“Hello, Demo Bakery, thanks for calling. Yes, we can do 50 egg tarts for tomorrow morning, pick up at 10:00. Okay, got it. Thank you, bye.”` / `“That was a phone order for tomorrow. I did not read the order back to the caller before hanging up, so I am not sure the quantity and the pickup time are right.”`. The server's own `GET /api/v1/questions` body carries the same two `lines` with `Hello, Demo Bakery` — the fix is server-side, not a display trick. No `[STAFF]` anywhere on the screen or in any response body |
| (a) | same on the day-3 phone card | 390×844, 1280×800 | **PASS** | `shots/D-p390-d3-question-EN-view.png`, `shots/D-l1280-d3-question-EN-view-peek.png`; `out-debrief-D-3.json` `shopNameIntact: true`; `out-debrief-D-3-peek-l1280.json` | `“Hello, Demo Bakery, thanks for calling. A birthday cake and 20 croissants for Saturday, pick up at three or four? Sorry, the line is bad. Okay, four o'clock. B…”` — same text at both widths (3 of 3 phone-call questions on this build read "Demo Bakery"; on 00048 it was 3 of 3 "[STAFF] Bakery") |
| (b) | Spoken seeded names Bella/Ari never appear — screen (EN + ID) | 390, 1280 | **PASS** | `out-debrief-D-3.json` `namesOnScreen: []`, `namesOnScreenID: []`, `placeholdersOnScreen: ["[PERSON_NAME]","[PERSON_NAME]"]`; `shots/D-p390-d3-question-{EN,ID}-view.png` | second line `“That was another phone order. [PERSON_NAME] was next to me and I hung up without reading the order back to the caller, so I hope [PERSON_NAME] and I got the pi…”` — both names were redacted at ingest (SDP), `[STAFF]` did not need to appear and did not |
| (b) | … server response bodies | — | **PASS** | `out-debrief-D-{2,3}.json` `namesInQuestionGetBodies: []`; grep of every captured body for `\b(Bella|Ari)\b` and `[STAFF]` → none | 20 + 1 polls on day 3, 9 on day 2 |
| (b) | … localStorage | 390 | **PASS** | `debrief.namesInLS: []` (every key's value scanned) | keys present: `bee6.debrief.answers`, `.progress`, `.done`, `.done.summary`, `bee6.device_token`, `bee6.demo`, `bee6.device_id` |
| (b) | … answer POST body | 390 | **PASS** | `debrief.namesInAnswerPost: false`; `answerPosts[0].body` | body = the five keys with my typed reason only |
| (b) | … supervisor `/day`, `/proposals`; owner `/home`, `/proposals`, `/sop` | 390 | **PASS** | `out-rolecheck-D-p390.json` `supDay.names: []` (`personName: 2`, `shopName: 1`, `staffBakery: 0`, `deviceIdLeak: false`), `supProposals/ownHome/ownProposals/ownSop .names: []`; `shots/D-p390-role-*.png` | the supervisor's day record shows the phone thread as "Fact, confirmed by staff" with both lines (`Hello, Demo Bakery, …` intact, names as `[PERSON_NAME]`); no device id on any role screen |
| (c) | "Bee6 heard:" lead-in | 390 | PASS | `heardPresent: true` (days 2 and 3) | — |
| (c) | lines are plain text | 390 | PASS | `quotedHtml[*].children: 0` (days 2 and 3) | `<p>` with text nodes only, typographic quotes |
| (c) | 390 layout wrap, no overflow | 390×844 | PASS | `quotedHtml[*]` w=302, right=346 < 390; `overflow.scrollWidth 390 = innerWidth` (EN and ID) | long day-3 lines truncated with "…" |
| (c) | 360 wrap | 360×640 | not re-run this round (brief: one sandbox at 390 + 1280) — round-3 result stands (same component, unchanged by PR #120) | — | — |
| (c) | Yes/No side by side | 390, 1280 | PASS | day 2: Yes {x:24,y:514,w:166} No {x:200,y:514,w:166}; day 3: both y=535; 1280: both y=463, w=251 | same row, equal width |
| (c) | Next / Skip reachable | 390 | PASS | day 2 after scroll: Next y=697 h=56, Skip y=800 h=44 (viewport 844); `shots/D-p390-d2-question-EN-bottom.png` | — |
| (c) | "Bee6 mendengar:" in ID | 390 | PASS | `heardID: true` ×2; `shots/D-p390-d2-question-ID-view.png` | quoted lines stay as spoken (English); heading still the generic O-1 wording |
| (c) | generic why-sentence absent when lines are shown | 390 | PASS | `whyPresent: false` ×2 | — |
| (c) | `bee6.debrief.answers` = only the 5 keys, no line text | 390 | PASS | `answersPendingParsed[0]` keys `question_id, debrief_business_date, answer, reason, answered_at_ms` (read while the POST was held 4 s), `[]` after upload; `anyLineTextInLS: false` (now also scans for `[STAFF]`/`[PERSON_NAME]`) | days 2 and 3 |
| (c) | answer POST body without line text | 390 | PASS | `answerPosts[0].body` = exactly the five keys, 200 | — |
| (c) | `GET /api/v1/questions` → `Cache-Control: private, no-store` | 390, 1280 | PASS | `questionPolls[*].cc` — 9 + 20 + 1 polls, every one `private, no-store` | — |
| (d) | debrief advances by itself, no "Check for new questions" button | 390, 1280 | PASS | `checkButton*` = 0 on load, while preparing, on the question, in the guide card, at done (days 1–3); polls every 10 s (`20:12:55, :05, :15 … 20:14:15`; 1280: `20:17:04, :14, :24 …`); `shots/D-p390-d2-preparing.png`, `D-p390-d2-done.png` | day-2 question after 78 s, day-3 after 188 s, no tap; day 1 "Debrief complete · There are no questions today" |
| (d) | guide opens by itself at Mulai | 390 | PASS | `out-day-D-{1,2,3}.json` `checks.guideOpenedAtStart.opened: true` (false ×5 then true, ~1.3 s after the tap); `shots/D-p390-d2-after-start.png` | days 1, 2 and 3 |
| regression | upload line at the top with the sheet open (item 3) | 390 | PASS | `checks.uploadStatusTop` box y=100 h=17, sheet open, on all three days | unchanged |
| regression | End reachable after collapse, `POST …/end` 200 | 390 | PASS | `afterCollapse.endBox` {y:564,h:56}; `endReqs` 200 ×3 | — |
| console / network | all runs | PASS | `console: []` on pair, day 1, day 3, both debriefs, the 1280 peek; day 2: one "503" resource error (the retried segment, O-2); rolecheck: one 403 — see O-8 | 0 page errors |

### Hard-rule checks at runtime (this round)
- Audio/base64: only the segment `PUT`s carry audio (request side); no response body, page text or localStorage value held audio or base64.
- Names: 0 occurrences of the FICTIONAL seeded names in any screen text (staff, supervisor, owner), any response body, localStorage or the answer POST; the stored lines show `[PERSON_NAME]`; no device id on supervisor/owner screens.
- RBAC (incidental live probe, O-8): a signed-in **supervisor** navigated to `/home` → `GET /api/v1/home` **403** (owner-only route rejected the wrong role server-side).
- Cloud Run logs / Firestore: not readable from this role; region-from-config not provable from the browser.

### Observations (not defects)
- **O-8** The one 403 in `rolecheck` is my harness (`signOutIfAny` opens `/home` while still signed in as supervisor to find the Sign out button); the product rejected it correctly and the page still offered Sign out. Not a product defect.
- O-1 (generic ID heading "Sekitar pukul 03:11–03:11 ada kegiatan kerja. Benar?") and O-2 (transient segment 503, retried) are unchanged from round 3.

### Not tested / could not test this round
- 360×640 was not re-run (one sandbox, 390 + 1280 as briefed); round 3's 360 results stand for the unchanged component.
- A typed reason containing "Demo Bakery" (the `scrubReason` path the fix deliberately left untouched) was not exercised; the stored-answer rendering on the supervisor screen was checked only with my plain reason.
- Real microphone / real phone / screen-wake: manual list above still applies; item 3 of that list can now be read as "expect **Demo Bakery**".
- Cloud Run logs and Firestore contents (no GCP access from this role).

## Round 4 (items 18–20) — Sun 18 Oct 2026, 12:57–13:35 WIB

Target: the same URL, Cloud Run `web-develop` revision **web-develop-00053-bkq** (100 % of traffic, confirmed read-only with
`gcloud run services describe`; `rollback-1017` tag on 00040-zbm carries 0 %) = develop **e01621e** (PRs #124 item 18, #125 items
19 + 20), Firestore `staging`, `DEMO_MODE=true`, `PROPOSAL_AGENT_V4` unset (v3 proposal agent), `DEMO_GENERATE_DAILY_CAP=30`,
`pipeline-tick-staging` every 2 min. `GET /api/health` → 200. Same harness (Playwright 1.64.1 Chromium headless, fake microphone,
persistent profile per sandbox), **two fresh sandboxes**: **E** (profile `prof/E`, paired 12:57 WIB) and **F** (`prof/F`, 13:01), each run
through the FICTIONAL day clips `day1.wav`, `day2.wav`, `day3.wav` at 390×844, then the role screens at **1280×800 (E)** and
**360×640 (E and F)**. Round-4 scripts: `pw/r4lib.js`, `pw/r4-sup.js` (items 18 + 19), `pw/r4-owner.js` (item 20: approvals, SOP,
reviews fast-forward), `pw/r4-verdict.js` (verdicts, supervisor list + SOP), `pw/r4-sop.js` (other-viewport SOP / approvals / reviews
look), `pw/r4-signout.js`; `pw/lib.js` now keeps the bodies of every `/api/v1/{proposals,sop,reviews,home}` exchange as evidence.
Evidence: `shots/E-*` and `shots/F-*` (176 round-4 screenshots), `out-r4*.json` (11 files), `out-day-{E,F}-*.json`,
`out-debrief-{E,F}-2.json`, logs `r4*.log`, `day-{E,F}-*.log`. No product code edited, nothing pushed, pilot never touched,
`docs/internal_testing/demo-feedback-2.md` not changed.

Harness slips this round (mine, not the product; each re-run from the same state): `day.js` looked for a button named "Next"
(it is "Next question") so both day-2 runs stopped on the question screen and were resumed with `debrief.js`; the item-19 loop
first matched the nav link "Reviews" instead of the card button "Review proposal: …"; the skip18 re-run overwrote E's item-18 JSON
(the printed values are preserved verbatim in `out-r4sup-E-l1280-18-transcript.json`; the screenshots and `r4sup-E.log` are the
originals); an `i18` scope slip crashed F's first supervisor run after item 18 (fixed, re-run as `out-r4sup-F-p360-19.json`).

### VERDICT: SHIP — items 18, 19 and 20 pass on both sandboxes at every width; no defect reproduced in this round's scope.

**Step-case in step 4 (explicit):** in BOTH sandboxes the model made both proposals **new steps** (`target_step: null`,
`kind: "add"`, ids `p-<uuid>`; E: "Record baking time on tray labels" + "Record and confirm phone orders"; F: "Record baking time on
tray labels" + "Record phone orders"). That is the **DIFFERENT-STEPS case**: #2 showed the plain, enabled "Approve" and was
approved → "Shipped as SOP version 3". The **same-step collision could not be provoked**: a second sandbox was tried as
briefed and the model again targeted no existing step, so the "Not available: this step was just changed" copy, the disabled
Approve and the Reject-only path were **not observed live** (unit-tested only — `lib/sop/rebase.test.ts`, `ApprovalsReview.test.tsx`).

| Item | Viewport | Result | Evidence | What I did / observed |
|---|---|---|---|---|
| (18) button reads "Ask Bee6 for proposals" with both rows ready | 1280 (E), 360 (F) | PASS | `out-r4sup-E-l1280-18-transcript.json` `askLabel`; `out-r4sup-F-p360.json` `item18.askLabel`, `askBox` {x:34,y:403,w:292,h:48}; `shots/E-l1280-r4sup-proposals-before.png` | after day 3, sign in as supervisor → Proposals: both watch rows "Ready", one button "Ask Bee6 for proposals", enabled; guide card "Tap Ask Bee6 once: it writes one proposal for each problem…" |
| (18) ONE tap writes both: "Writing proposal 1 of 2…" then "2 of 2…", one status line, no third | 1280 (E) | PASS | transcript `samples` (0.0 s "Writing proposal 1 of 2…", 12.0 s "Writing proposal 2 of 2…", 19.2 s settled), `generatePosts`, `listReloads`; `shots/E-l1280-r4sup-generating-1of2.png`, `-2of2.png`, `-proposals-after.png` | one tap → exactly **2** `POST /api/v1/proposals/generate` (12:16:57 body `{from_date,to_date}` → 201; 12:17:04 `{…,another:true}` → 201), **one** list reload after the chain, one line "Bee6 wrote 2 proposals. Open each to read the evidence.", 2 "Review proposal: …" buttons, button → "Both asked · no more evidence to use" (disabled). **Duration 19.2 s** (rounds ≈ 7 s + 7 s). Proposal 1 = CUSTOMER_SERVICE "Record baking time on tray labels" → **new step**; proposal 2 = PHONE_CALL "Record and confirm phone orders" → **new step** (different steps) |
| (18) fast double tap → still exactly 2 | 360 (F) | PASS | `out-r4sup-F-p360.json` `item18.generatePosts` (13:25:47 → 201, 13:25:54 `another:true` → 201), `secondTapError`, `reviewCount: 2`, `statusLines`; `shots/F-p360-r4sup-proposals-after.png` | tap, then a second tap ≈30 ms later: the second could not land because the button had already become the disabled "Asking Bee6…" (Playwright logged the locator timeout); exactly 2 POSTs, 2 proposals, "Bee6 wrote 2 proposals…", **30.0 s** (my sampling started after the 30 s second-tap timeout, so the 1-of-2 / 2-of-2 lines were not captured at 360 — seen at 1280 only). F's proposals: "Record phone orders" (new step), "Record baking time on tray labels" (new step) |
| (18) guide copy after the ask | 1280, 360 | PASS | `guideCardAfter` | "Check each proposal · ✓ Run all the days · ✓ Ask Bee6 for proposals · • Open a proposal…"; `proposals_generating` card "The proposals appear in about half a minute." (`shots/E-l1280-r4sup-generating-1of2.png`) |
| (19) after Mark feasible: NO "Sign out · pick Owner" button, no chip row, banner stays | 1280 (E), 360 (F) | PASS | `out-r4sup-E-l1280-19.json` / `out-r4sup-F-p360-19.json` `item19.proposals[*]` (`signOutPickOwner: 0`, `markedFeasibleChip: 0`, `markFeasibleAfter: 0`, `buttonsAfter: ["‹ Proposals"]`, `bannerFocused: true`, `topBarSignOut: 1`), `reviewPosts` 200 `{"decision":"feasible"}`; `shots/E-l1280-r4sup-p1-feasible-view.png`, `F-p360-r4sup-p1-feasible-view.png` | opened each proposal → Mark feasible (no confirm) → the only element left under the detail is the banner "Marked feasible. The owner decides next. Sign out and pick Owner to approve or reject." (`role=status`, focused); the only control in `main` is "‹ Proposals"; top-bar Sign out present; guide → "Over to the Owner"; no horizontal overflow at 360 |
| (19) top-bar Sign out → `/`, then Owner via the entry card | 1280, 360 | PASS | `item19.signout` (E: `/proposals` → `/` in 142 ms; F: 153 ms; `radios: 0`, three entry links), `ownerEntry.url: /sign-in?as=owner`; `shots/*-r4sup-sup-signed-out.png`, `*-r4sup-owner-entry.png` | Sign out from the proposal detail lands on the entry page with the three cards; "Open owner view" → the solo owner sign-in → signed in to `/home` (1.6 s) |
| (20) Approvals: approve #1 → "Approved. It ships as a new SOP version." | 1280 (E), 360 (F) | PASS | `out-r4own-E-l1280.json` / `out-r4own-F-p360.json` `item20.p1` (`doneLineAfterS` 0.28 / 0.31), `approvePosts[0]` 200 `{"result":"approved"}`; `shots/*-r4own-p1-approved.png` | one tap on Approve (#1 "Record baking time on tray labels") → the line appeared, the SOP overview reloaded with latest v2 (`sopAfterP1`: v2 add, effective 2026-10-19, review 2026-11-02), screen moved to #2 |
| (20) #2 shows plain **Approve (enabled)** — different-steps case | 1280, 360 | PASS | `item20.p2` (`case: "DIFFERENT_STEPS (Approve enabled)"`, `approveButtons: [{text:"Approve", disabled:false}]`, `naHeading: false`, `oldNaCopy: false`, `rejectField: 1`); `shots/E-l1280-r4own-p2-before-view.png`, `F-p360-r4own-p2-before-view.png`; proposals GET `notices.sop_changed: false` for both | "APPROVALS · 2 OF 2 · 1 LEFT", pace line "Starts the day after approval · review Sun 1 Nov", "Approving creates a new SOP version. The old version stays in the SOP book.", Approve + "Reject — why?" field. Neither the old "Not available: the SOP changed" nor the new "this step was just changed" copy appeared (correct for this case) |
| (20) quick double tap on Approve #2 → exactly one request, no error toast | 1280 (E: two Playwright clicks back to back), 360 (F: two synchronous `el.click()` in one task) | PASS | `item20.approvePosts` = exactly 2 POSTs in total (one per proposal; E 12:22:40 + 12:23:06, F 13:30:47 + 13:31:14), `p2.errorToast: []`, `alertsAfterDouble: [""]`, `doneLineAfterS` 0.035 / 0.003; `shots/*-r4own-p2-approved.png` | one `POST …/<#2>/approve` → 200 `approved`; no alert text; summary reached |
| (20) summary: "Shipped as SOP version 2" and "… version 3" with their own dates, no "The approved change starts on …", "2 approved, 0 rejected" | 1280, 360; EN + ID | PASS | `item20.summary` (`shippedLines`, `counts: "2 approved, 0 rejected."`, `approvedChangeStarts: false`, `datesLines` ×2 "Starts Mon 19 Oct · review Mon 2 Nov", `pills` ×2 "Approved · starts Mon 19 Oct", `overflow: false`, `textID` "Terbit sebagai SOP versi 2/3 … 2 disetujui, 0 ditolak."); `shots/E-l1280-r4own-summary-view.png`, `F-p360-r4own-summary-view.png`, `E-l1280-r4own-summary-ID.png`; guide "All decided · Each approved change is now its own SOP version…" | "Both decided. Nice and calm." · #1 Shipped as SOP version 2 · #2 Shipped as SOP version 3; the single-approval sentence is absent; "WHAT HAPPENS NEXT · Each approved change is in the SOP from its start date…" |
| (20) SOP page, owner and supervisor: ONE tab for the pending day, header, badges, why-cards, legend 2, Table origins, seed tab | 1280 (E owner + supervisor), 360 (E owner + supervisor, F owner + supervisor); EN + ID | PASS | `out-r4own-E-l1280.json` `sop.{en,id}`, `out-r4sop-E-p360-{owner,supervisor}.json`, `out-r4verdict-{E-l1280,F-p360}-supervisor.json` `sop.en`, `out-r4own-F-p360.json` `sop`; API `latest 3, in_force 1, changes v3(prev 2) + v2(prev 1), both eff 2026-10-19`; `shots/E-l1280-r4own-sop-en-newest-ch5.png`, `-why1.png`, `-why2.png`, `E-p360-r4sop-owner-sop-en-{book,table,seed}.png`, `F-p360-r4own-sop-en-newest-ch5.png`, `*-sop-id-*.png` | tabs exactly **["11/10/26 · current", "19/10/26"]** (ID "11/10/26 · saat ini"), no third tab for v2; header **"Version 3 starts on Mon 19 Oct. Until then, version 1 applies."** / "Versi 3 berlaku mulai Sen 19 Okt. Sampai saat itu, versi 1 yang berlaku."; "Version 3 · in use from Mon 19 Oct · 7 steps"; both added steps sit in chapter 5 "Other steps" with the badge **"NEW ON 19/10/26"** ("BARU PADA 19/10/26"; they are `add` changes, so no "IMPROVED ·" prefix and no struck old wording — correct per `C-sop-book-new`); each "See why it changed and the result" opens its **own** card (5.1 → "Version 2, from Mon 19 Oct · Record baking time…", 5.2 → "Version 3, from Mon 19 Oct · Record and confirm phone orders…"; `aria-expanded` true); legend **"From your SOP 5 / Improved with Bee6 2"**; Table view: both rows "19/10/26 · Bee6 proposal, approved 18/10/26" (`tableBee6Origins: 2`), the five seed rows "Your SOP"; seed tab "11/10/26 · current": 5 steps, old wording, **0 badges**, legend "Improved with Bee6 0"; no "upcoming"; `scrollWidth = innerWidth` at 360 in Book and Table, EN and ID |
| (20) Reviews: fast-forward twice → review for v2 then v3, each with the overlapping-change notice, no crash | 1280 (E), 360 (F) | PASS | `reviews.ff1` (POST → `{"version":2}`, "Simulated review created.", 1 overlap notice), `ff2` (→ `{"version":3}`, 2 notices on the page), `ff3.buttonPresent: false` (button gone once nothing is left); `shots/E-l1280-r4own-reviews-ff2.png`, `F-p360-r4own-reviews-ff2.png`, `E-l1280-r4own-reviews-ID.png` | "SOP VERSION 2 · REVIEW ON MON 2 NOV" then "SOP VERSION 3 · REVIEW ON MON 2 NOV", each "Simulated time (demo)", before 0.4/day, after "No rate yet", "Bee6 has no suggestion: fewer than 2 captured days…", amber "Another SOP change took effect during the measured period; these numbers may mix both.", "Waiting for the supervisor's verdict by Mon 9 Nov"; 0 console errors |
| (20) supervisor verdict then owner verdict on one review | 1280 (E), 360 (F) | PASS | `out-r4verdict-*-supervisor.json` `reviews.verdictPosts` (`POST /api/v1/reviews/3/verdict` → `recorded, awaiting_owner`), `statusLines` "Supervisor's verdict on Sun 18 Oct: Worked"; `out-r4verdict-*-owner.json` (→ `recorded, confirmed`, "Owner's verdict on Sun 18 Oct: Worked", "Confirmed. Remembered as: Worked"); `shots/*-r4supervisor-v-verdict-after.png`, `*-r4owner-v-verdict-after.png` | "Worked" → confirm group "Record "Worked" as your verdict?" → reason → Yes → "Verdict saved."; the v3 review moved to DECIDED for the owner; the v2 review still waits for the supervisor |
| (20) supervisor Proposals list afterwards: both Approved, no "SOP changed" notice | 1280 (E), 360 (F) | PASS | `out-r4verdict-*-supervisor.json` `proposals.statuses: ["Approved","Approved"]`, `sopChangedNotice: false`, `details[*].sopChangedNotice: false`, API `notices.sop_changed: [false,false]`; `shots/*-r4supervisor-v-proposals-list.png`, `*-r4supervisor-v-p{1,2}-detail.png` | both cards "Approved", both details pill "Approved", no notice text |
| regression: debrief quoted lines still "Demo Bakery" | 390 (E and F, days 2 and 3) | PASS | `out-debrief-{E,F}-2.json` `shopNameIntact: true`, `staffTokenOnShop: false`, `heardID: true`; `out-day-{E,F}-3.json` `quotedLines` | `“Hello, Demo Bakery, thanks for calling. …”` on all four phone-call questions; answers 200; `anyLineTextInLS: false` |
| regression: items 12–16 (sign out → `/`, centred form, SOP "current") | 1280, 360 | PASS | every `signout.landed: "/"` (120–153 ms, 10 sign-outs), `signin.formGeometry` 1280: left 420 = right 420 (w 440); 360: 16 = 16 (w 328); `tabs[0]` "11/10/26 · current" | — |
| regression: capture days 1–3 on the new build | 390 | PASS | `out-day-{E,F}-{1,2,3}.json`: segments 7/7, 8/8, 6/6 stored (**no 503 this time**, two phones in parallel), guide opened itself at Start, "Debrief complete" day 1 after 173 s, questions after 113 s (E d2) / 123 s (E d3) | — |
| a11y (axe-core 4.14, WCAG 2.x A/AA) | 1280, 360 | PASS | `axe` fields in `out-r4*.json` | **0 violations on 16 page states**: supervisor `/proposals` before the ask (E 1280, F 360), owner `/proposals` before (E, F), owner summary (E, F), owner `/sop` (E 1280, E 360, F 360), supervisor `/sop` (E 1280, E 360, F 360), owner `/reviews` (E, F), owner + supervisor `/proposals` read-only at 360 |
| console / network | all 11 role runs + 6 day runs | PASS | `console: []`, `bad: []` in every `out-r4*.json`; day runs 0 page errors | 0 console errors/warnings, 0 responses ≥ 400 across the whole round |
| names / device ids on role screens | all | PASS | `roleGrep` on `/day`, `/proposals`, every detail, `/home`, `/sop`, `/reviews`: `names: []`, `deviceIdLeak: false`; `namesInAnyApiBody: []` | no seeded name, no `[STAFF]`, no device id anywhere on a supervisor/owner screen or response body |

### Hard-rule checks at runtime (this round)
- Audio/base64: only the segment `PUT`s carry audio (request side); no proposal/SOP/review response body held audio or base64.
- Names (rule 7): 0 occurrences of the FICTIONAL seeded names in any screen text or response body; the shipped SOP steps, proposals, reviews and audit-visible text carry no name or device id; verdict and review POST bodies carry the decision and my typed reason only.
- RBAC: not re-probed this round (round 3 O-8 and 16 Oct cover it; every route used answered 200 for its own role only). Rule 9: both SOP versions were created only through the owner's `POST …/approve`.
- Region-from-config, Cloud Run logs, Firestore contents: not provable from the browser / no GCP data access from this role (only the read-only `gcloud run … describe` above).

### Observations (not defects of items 18–20; for Rangga's decision)
- **O-9 (pre-existing, outside this round's diff)** The proposal's "REVIEW DATE Sun 1 Nov" (supervisor detail, owner pace line "review Sun 1 Nov" before approval) becomes "review **Mon 2 Nov**" once shipped: the drafted `content.review_date` is draft-day + 14 (`lib/proposals/service.ts` L873 `reviewDate(today, …)`), the version's is effective-from + 14 (`lib/sop/ship.ts` `shipReviewDate`, identical at 9d59b90). A judge who reads both screens sees the date move by one day. `shots/E-l1280-r4sup-p1-feasible-view.png` vs `E-l1280-r4own-summary-view.png`. Not introduced by PRs #124/#125; Rangga to accept or route to `developer` (one-line fix: draft `review_date` from tomorrow).
- **O-10** At 1280×800 the round line "Writing proposal 1 of 2…" sits at the bottom edge of the generating block, just below the fold with the panel at its initial scroll (`shots/E-l1280-r4sup-generating-1of2.png`: the heading "Bee6 is writing a proposal" is visible at y≈738, the round line is cut at y≈800). It is reachable by scrolling and fully visible after the block grows; cosmetic. At 360 the block is below the watch card as designed.
- O-11 The two new steps both land in chapter 5 "Other steps" (the model sends no chapter for an added step); the badge reads "NEW ON 19/10/26" not "IMPROVED · NEW ON" because they are additions, not rewrites — expected by `C-sop-book-new`.
- O-2 (transient segment 503) did **not** recur this round (21/21 segment PUTs on E, 21/21 on F, two phones in parallel).

### Not tested / could not test (honest list)
- **Same-step collision (item 20 reject-only path, "Not available: this step was just changed", disabled Approve, Reject with reason):** not provoked in two sandboxes — the v3 agent chose a **new step** for both problems both times; the brief's budget (≤ 2 fresh sandboxes, 3 total shared with Rangga) was spent. Covered only by the unit tests in PR #125.
- "Writing proposal 1 of 2 / 2 of 2" lines at 360 px: not captured on F (sampling started after the 30 s double-tap timeout); verified at 1280 only. The settled state at 360 is captured.
- The optional 45 s offline locked-card guide hint: skipped (it would require interrupting a capture day; not in the three items).
- Item 18's partial-chain path (round 2 suppressed/failed → "Bee6 wrote 1 of 2 proposals…", "Ask for another proposal" retry) and the demo cap path: not reachable on a healthy build without faking a failure; unit-tested in PR #124.
- Pilot layout (`demo=false`: one round per tap) — not on staging.
- Real microphone / real phone / screen-wake: manual list from round 3 still applies.

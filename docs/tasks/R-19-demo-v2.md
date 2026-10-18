# R-19 Demo v2: the 3-day judge journey (internal-test feedback, 13 Oct): spec + implementation plan

Status: **PLAN v4, tech-lead, Wed 14 Oct 2026 (v2 = Q1-Q8; v3 = W1-W10; v4 = V1-V10 pilot out of MUST + page-2 design, and S1-S5 staging dropped, §1). Nothing is built.** It covers Rangga's 23-point feedback
(`docs/internal_testing/demo-feedback-1.md`), the page-2 wireframes (25 boards: P2-01..P2-10b phone, D2-01..D2-09
laptop), and Rangga's decisions of 13 and 14 Oct (listed in §1). §15 holds the open questions (max 8, each with a
default). Next steps: Rangga's "go", then the PM's edge-case brainstorm (permutations and missing branches only; the
approach is settled), then the builds in §11.

> **For agentic workers:** this file is the spec and the plan in one (same convention as `R-12.md`, `R-18-*.md`).
> Execute it task by task, literally (`superpowers:executing-plans` or `superpowers:subagent-driven-development`, plus
> `superpowers:test-driven-development`). **If the plan is silent or looks wrong against the real code, stop and flag
> it to tech-lead. Do not improvise** (CLAUDE.md §10 rule 11).

**Base and branching.** Code citations are from `origin/develop` @ `708b8cd` (= `main` + README links). The shared
checkout is on a stale branch (`feature/r-05b-label-call-pr2`); **never build there and never switch its ref.** Each
PR gets its own worktree off the then-current `origin/develop`, for example
`git worktree add ../bee6-r19-pr1 -b feature/r19-evidence-rules origin/develop`. `gh pr create --base develop`.
**No staging environment (S1).** Feature PRs merge into `develop` after tech-lead review and local QA; `develop` is
**promoted to `main`** at the checkpoints of §12 (each with Rangga's approval); Cloud Build deploys `web` in
bee6-playground (demo project only); QA then runs the live journey on https://web-33uzb53tza-et.a.run.app. Every PR
passes: pre-push hook (lint, build, vitest), tech-lead review, independent local QA (zero tolerance), and
security-reviewer where §11 says so. `web-develop` stays an empty private service: ignore it.

**Skills to load (name them in every brief):** `superpowers:test-driven-development`, `react-patterns`,
`react-testing`, `frontend-a11y`, `nextjs-turbopack` (verify any routing/`redirect()`/layout convention against
`node_modules/next/dist/docs/`), `api-design` (new routes), `error-handling`, `ux-copy` (copy keys), `eval-harness`
(Task R, rehearsal), `browser-qa` (QA), `gcp-patterns` (dev-ops track). Never `claude-api`.

---

## A. HAND-OFF FOR RANGGA (read first): the day 1-3 judge script and the template clip list

### A.1 How the script works (decided 14 Oct)

- The judge reads a **pre-defined scenario word for word**, one card at a time, in the judge guide drawer on the
  staff phone. Light improvisation is tolerated; the label model copes with it, and Task R measures that it does.
- The judge plays every voice (staff, customer, caller). The speaker tag ("Customer:") is **not** spoken; it only
  tells the judge which voice to use. Pause about 2 seconds between speakers.
- Cards are short for readability only. There is **no 15 s rule for live cards**: the phone cuts long speech into
  several segments by itself.
- The drawer shows **one active card at a time** (scrollable box). After speaking it the judge taps **"I have spoken
  this"** and the next card appears. After the 5th card the same guide card offers "Jump to closing time" (§5.3-5.4).
- Problem A (customer asks if the egg tart is fresh / when it was baked; the staff member is not sure; no colleague is
  asked; the customer is not unhappy) is designed to become a **CUSTOMER_SERVICE** moment on **days 1 and 2**.
- Problem B (a phone order is taken and **not read back** to the caller) is a **PHONE_CALL** moment on **days 2 and
  3**. PHONE_CALL is never an automatic fact (`ALWAYS_QUESTION`); it becomes a fact only when the judge answers
  **Yes** in that evening's debrief ("Around 14:05 there was a phone call. Is that right?").
- Each day has 5 cards, so at most 5 work moments, so at most 5 debrief questions (the debrief cap is 5).
- After day 1 nothing is ready (A on 1 day). After day 2, A is ready (2 days) and B has 1 day. After day 3, B is ready
  too. That gives the 2 proposals (one per problem).
- English is final for the demo. The Bahasa column follows later (PROVISIONAL, Tiffany).

### A.2 Day 1 (Mon): 5 cards, about 2.5 min of speech

| # | Card (guide title) | Who speaks | Exact words | Expected result |
|---|---|---|---|---|
| 1 | Opening | Staff | "Good morning. I am opening the shop now. The oven is on and the display lights are on. I counted the cash in the till and it matches the float." | ROUTINE_OPS (fact or question; never evidence) |
| 2 | First bake | Staff | "The first tray of egg tarts is out of the oven. I am putting them on the display now. The croissants go in next." | ROUTINE_OPS |
| 3 | A customer at the display (problem A) | Customer | "Excuse me, are these egg tarts fresh today? When were they baked?" | CUSTOMER_SERVICE, problem A, day 1 |
| | | Staff | "Hmm, I am not sure when this tray was baked. There is no time written on the tray. I think it was this morning, but I cannot say for sure." | |
| | | Customer | "Okay, that is fine. I will take two, please." | |
| | | Staff | "Two egg tarts. Here you go, thank you." | |
| 4 | Display check | Staff | "Display check. The cinnamon rolls are running low, so I am refilling them now. Everything else on the display is full." | ROUTINE_OPS |
| 5 | Closing | Staff | "We are closing now. I counted the till, I cleaned the oven, and I wrote the leftover bread in the log." | ROUTINE_OPS |

### A.3 Day 2 (Tue): 5 cards, about 3 min of speech

| # | Card | Who speaks | Exact words | Expected result |
|---|---|---|---|---|
| 1 | Opening | Staff | "Morning. Oven on, display lights on. The cash in the till is counted and correct." | ROUTINE_OPS |
| 2 | A customer at the counter (problem A again) | Customer | "Hi. Is this egg tart from today? How fresh is it?" | CUSTOMER_SERVICE, problem A, day 2 |
| | | Staff | "Sorry, I do not know exactly when it was baked. Nobody wrote the baking time on the tray. It should be from this morning." | |
| | | Customer | "Alright, I will have one." | |
| | | Staff | "One egg tart. Enjoy." | |
| 3 | A phone order (problem B) | Staff | "Hello, Demo Bakery, thanks for calling." | PHONE_CALL, problem B, day 2 (debrief question; answer **Yes**) |
| | | Staff | "Yes, fifty egg tarts for tomorrow morning. Pickup at ten. Okay, got it. Thank you, bye." | |
| | | Staff | "I did not read that phone order back to the caller. I will write it down later." | |

*(Rewrite round 1, 14 Oct, Task R: card 3 lines 1 and 3 changed so the label model hears a phone call; d3 v1 paraphrase had failed 3/5. Synthetic rehearsal wavs d2-c3 and improv-d2c3 must be re-made.)*
| 4 | Display check | Staff | "Display check. The croissants are almost gone, I am putting out a new tray. The rest is full." | ROUTINE_OPS |
| 5 | Closing | Staff | "Closing time. Till counted, oven cleaned, leftover bread logged." | ROUTINE_OPS |

### A.4 Day 3 (Wed): 5 cards, about 2.5 min of speech

| # | Card | Who speaks | Exact words | Expected result |
|---|---|---|---|---|
| 1 | Opening | Staff | "Good morning. The oven is on, the display lights are on, and the float in the till is correct." | ROUTINE_OPS |
| 2 | Another phone order (problem B again) | Staff | "Hello, Demo Bakery, thanks for calling." | PHONE_CALL, problem B, day 3 (debrief question; answer **Yes**) |
| | | Staff | "A birthday cake and twenty croissants for Saturday. Pickup at three or four? Sorry, the phone line is bad. Okay, four o'clock. Bye." | |
| | | Staff | "I hung up without reading the order back to the caller. I hope I got the time right." | |

*(Rewrite round 1, 14 Oct: same reason as day 2 card 3. Re-make d3-c2 and improv-d3c2 wavs.)*
| 3 | Second bake | Staff | "The second tray of croissants is out. I am putting them on the display now." | ROUTINE_OPS |
| 4 | Display check, a calm one | Staff | "Display check. Everything is full. Nothing to refill right now." | ROUTINE_OPS |
| 5 | Closing | Staff | "We are closed. I counted the till, cleaned the oven and logged the leftovers." | ROUTINE_OPS |

**Debrief guidance printed in the drawer on every day:** "Answer what really happened in today's script. The phone
order did happen, so answer **Yes** and type a few words why (for example: took a big order on the phone)." A reason
is required today (1 to 500 characters; §15 Q-8).

**Why the wording is shaped like this** (so a rewrite in Task R keeps it): problem A never names a colleague, never
says "let me check with…" (that drifts to STAFF_CONSULT) and the customer is never unhappy (that drifts to
COMPLAINT, which needs a supervisor). Problem B starts with "Hello, Demo Bakery" so the label model hears a phone
call. Routine cards never mention a customer or a phone. No person's name, no phone number, no price is spoken (hard
rules #7, #8). The hypothetical and small-talk cards of script v1 are removed (they cost debrief slots).

### A.5 Template clips (routine only): DONE 14 Oct

**Decision: the template holds routine history only. Extra seeded A/B evidence is harmful**, for three reasons:
1. A seeded A or B fact counts toward the per-category floor (§3.2). Problem A would be ready after the judge's day 1
   (or even at sign-in), so the supervisor's first look would show a proposal instead of "waiting for evidence", and
   the judge's own speech would no longer be what made the proposal. That breaks the core story (feedback #13).
2. A seeded PHONE_CALL thread becomes an `unverified` question at the template's debrief end: noise in the day record.
3. Rangga's earlier problem-A and phone-call recordings are evidence: **never seed them.**

**Fixtures are made** (no recording needed from Rangga or Tiffany). All in the git-ignored `private/demo-clips-v2/`,
indexed in `private/FIXTURES-INDEX.md`; `plan.json` there is already validated against `PlanSchema`
(`scripts/demo-seed-template.ts`). Every clip is ≤ 15 s (`CLIP_MAX_MS`) and under 256 KiB WebM/Opus, because the seed
script uploads each file as ONE segment.

| File | Day | Time | Length | Source | Words |
|---|---|---|---|---|---|
| `t1-open-d2.webm` | -2 | 07:10 | 9.2 s | REAL (Rangga's opening clip) | original wording |
| `t2-bake-d2.webm` | -2 | 08:30 | 3.5 s | synthetic | "First tray of croissants is out. Putting them on the display now." |
| `t3-close-d2.webm` | -2 | 20:45 | 8.5 s | REAL (Rangga's closing clip) | original wording |
| `t4-open-d1.webm` | -1 | 07:05 | 4.3 s | synthetic | "Morning. The oven and the display lights are on. The float in the till is correct." |
| `t5-display-d1.webm` | -1 | 13:00 | 4.3 s | synthetic | "Display check done. I refilled the cinnamon rolls. Everything else is full." |
| `t6-close-d1.webm` | -1 | 20:50 | 4.1 s | synthetic | "We are closed. Till counted, oven cleaned, leftovers logged." |

After seeding, the **inverted readiness check** (§5.9) must print `CLEAN` or the template is rejected (a routine clip
that labels as CUSTOMER_SERVICE would pollute problem A). The two REAL clips are the most likely to drift (their
wording is free); if either fails, swap in the unused synthetic copy from `private/demo-clips-v2/_synth-unused/`.

### A.6 Rehearsal audio (Task R, not seeded): DONE 14 Oct

In `private/rehearsal/` (git-ignored; played through Chrome's fake microphone by QA):
- `d1-c1.wav` … `d3-c5.wav`: the 15 exact script cards of §A.2-A.4, 2 s silence between speakers.
- `improv-d1c3.wav`, `improv-d2c2.wav`, `improv-d2c3.wav`, `improv-d3c2.wav`: synthetic improvised paraphrases of the
  4 problem cards.
- `real/`: Rangga's real-voice recordings as WAV 16 kHz mono (problem A first and second day, a phone call in problem-B
  style, an opening, a closing): the natural, improvised variants.

**Caveat:** the synthetic voices (macOS `say`) are cleaner than a phone microphone in a room, so a pass on them is
optimistic. Task R's audio pass therefore also requires the `real/` variants (§10.2), and E2E round 2 is run once
with a human reading the cards aloud into a real phone.

## 0. Findings from the code (read before building)

1. **The "Yes ends the debrief" bug, root cause.** `lib/debrief/flow.ts` freezes the question list at `OPEN`
   (`LOADED` takes `questions.slice(0, DEBRIEF_SHOW_MAX)`). `COMMITTED` and `SKIP` move to `{kind:"done"}` as soon as
   the frozen list is exhausted. On a sandbox the list at `OPEN` is usually 1-2 items (the carry-over questions, or
   the first labelled thread), because the judge's own moments are labelled 2-4 min after End. So the first Yes
   (the usual answer) lands on "Debrief complete" while the server debrief is still open and more questions are still
   being made. The done screen's Back then returns to `closed`, which renders the "Answer questions" entry card
   again (feedback #11). It looks Yes-specific only because judges answer Yes. **Task D0 reproduces it first** (a
   failing reducer test plus a repro on the live demo after promotion P1, or locally with a mocked questions route); if the repro shows a different cause, stop and flag.
2. **Start is shown during the debrief.** `app/capture/page.tsx` `renderIdle` always renders the Mulai button and
   only sets `aria-disabled` when `!idle.offered`; `DebriefFlow` renders `primary` under the `closed` and `timed_out`
   views. So a disabled-looking Start is visible during the debrief (feedback #6).
3. **The template carries evidence today.** The R-18 template (clips 2, 3, 5) seeds problem A facts and CARRY_OVER_MAX
   = 2 reopens template questions. Both must go (decided: CARRY_OVER_MAX = 0, routine-only template).
4. **One Generate = one proposal, any categories.** `generateProposal` offers every fact candidate to the model and
   the floor is "2 facts on 2 dates" across all categories (`precheck.ts`). The reuse step returns the open proposal
   for the same range, and `isSuperseded` (`review-plan.ts:49`) makes any newer open proposal for the **identical
   range** supersede the older one, so a second proposal for the same dates would block the first (409 SUPERSEDED).
   A second proposal needs: per-category floor, focus category, "Generate another" skipping reuse, exclusion of
   threads already cited by awaiting proposals, and an overlap-based supersede rule (§3).
5. **ROUTINE_OPS facts count as evidence today** (`selectCandidates` drops only NON_WORK). Decided: they stop counting.
6. **No time travel exists.** The sandbox runs on the real clock with the R-18 demo profile (Start any time, End at
   once, 5-min hard stop, one demo day per sandbox: `demoMulaiAvailability` refuses a second start on the same
   business date). "Jump to tomorrow" is therefore a **data shift**: every time-bearing field of the sandbox moves
   back exactly one day (`shiftDeep` in `lib/demo/clone.ts` already does this for the clone). After the shift the
   real "today" is a fresh business day, and the existing rule "today > last.business_date" offers Start.
7. **The segment response already returns `lines`** (`app/api/v1/segments/[segment]/route.ts`: `{seg_id, lines}`),
   never text. That is the speech counter behind "I have spoken this"; no transcript ever returns to the phone.
8. **The tick waits ~90 s of silence before closing a window** (`windowing.ts` `silence: 90_000`) and runs every
   2 min. Without help, each day's debrief waits 2-4 min ("Preparing your questions"). Over 3 days that is 6-12 of
   the 20 minutes. Mitigations: Scheduler `*/1` on the demo (dev-ops, no code) and the optional fast lane
   (Task D3).
9. **Staging is dropped (S1).** No `FIRESTORE_DATABASE_ID`, no named database, no `cloudbuild.yaml` change. Local QA
   cannot exercise the pipeline (the tick route needs Cloud Tasks/Scheduler OIDC), so every pipeline-dependent check
   (preparing, debrief questions, facts, proposals) happens live after a promotion (§12).

---

## 1. Decisions this plan implements (Rangga, 13-14 Oct; do not re-litigate)

| # | Decision | Where |
|---|---|---|
| D-1 | Journey: staff day 1 → supervisor look (Proposals: waiting for evidence) → staff "Jump to tomorrow", days 2-3 (3 days, ~20 min) → supervisor confirms labels, asks for proposals, marks feasible (guide nudges feasible) → owner approves ONE, rejects the other. Approve-both not required; SOP_CHANGED stays. | all |
| D-2 | Debrief cap 5; no seeded/carry-over questions (CARRY_OVER_MAX = 0); "Preparing your questions" while labelling; Yes never ends the debrief; Start locked until the debrief is over AND it is the next day (01:00+; on the sandbox: after Jump to tomorrow). | §6 |
| D-3 | **Product rule change, everywhere incl. the pilot:** ROUTINE_OPS stops counting toward the proposal evidence floor and the proposal gate. | §3.1 |
| D-4 | Next day = data shift with 7 guards, refused once any proposal with content exists. Flow: days 1-3, then Ask. | §4 |
| D-5 | Evidence staging A (days 1-2, CUSTOMER_SERVICE) / B (days 2-3, PHONE_CALL, fact only on a staff Yes). | §A |
| D-6 | Template re-cut: routine-only, 2 days (-2, -1), inverted readiness check. | §A.5, §5.9 |
| D-7 | End locked until closing time; "Jump to closing time" unlocks only when all 5 cards of the day are spoken (no time rule). | §5.4 |
| D-8 | Staff sign-out: before closing = cancel today; after closing = cannot cancel. Entry page with 3 roles. Remove the Switch bar (keep the expiry notice). Owner reset = demo-only wipe back to the template. | §5, §7, §8 |
| D-9 | Supervisor nav: Day record, Proposals, SOP, Reviews, Connected devices. Owner nav: Home, Approvals, SOP, Reviews (Team hidden). Empty states everywhere. | §8 |
| D-10 | Connected devices: generate + copy a code; no device ids shown; no QR, no unpair. Owner Home tiles; cost "coming soon". SOP versions labelled by date with the improved step. | §9 |
| D-11 | Script is spoken word for word (14 Oct); wording validated before the demo (Task R). | §A, §10 |
| D-12 | Restyle LAST and timeboxed: design finalization → behaviour/flow → restyle. | §11 PR-11 |
| Q1 | **Sign-out after closing does NOT end the day.** The server session stays open ("open day waiting for the official close trigger and the debrief answer"). The phone finds it again on return (§5.7a); the 10-min hard stop closes an orphan server-side (§5.7b). | §5.7, §5.7a, §5.7b |
| Q2 | ROUTINE_OPS excluded from the proposal floor, the proposal gate and ranked last in the debrief; the evidence gate itself is unchanged. | §3.1 |
| Q3 | Per-category floor applies to the pilot too. | §3.2 |
| Q4 | 10-minute hard stop per demo day; no "I'm stuck" skip. | §5.4 |
| Q5 | Template = 2 routine days (-2, -1), 6 clips. | §A.5 |
| Q6 | Before-opening stage and simulated hh:mm clock CUT. The phone shows "Day n of 3 · date"; Pair goes straight to the Start-ready screen. | §8.1, §7 |
| Q7 | Connected-devices code generation on the pilot too (additive, security-reviewed). | §9.3 |
| Q8 | Debrief reason stays REQUIRED (1-500 chars); the guide tells the judge to type a few words. | §A.4, §6 |
| W1 | Script UI = ONE active card (scrollable, focus moves to the next); "I have spoken this" marks it spoken; no list, no previous/next. | §5.3 |
| W2 | Jump to closing unlocks only when all 5 cards are spoken; **no time rule**. Speech guard kept (1 heard line per card, 5 per day, server-checked). | §5.4 |
| W3 | End always visible, disabled "End · available at closing time (HH:MM)" until Jump to closing. | §5.5 |
| W4 | Locked-jump text exactly "Locked until all N cards are spoken (k of N done)." | §5.4 |
| W5 | ~~Staff sign-out on the pilot~~ **Superseded by V1:** pilot work is out of MUST (§18). Demo staff sign-out stays local. | §5.7, §18 |
| W6 | Owner Home progress = proposals the supervisor marked feasible that the owner APPROVED / REJECTED (week, month, since start). | §9.2 |
| W7 | Preparing screen tells the judge to keep the page open and the screen on. | §6.3 |
| W8 | Entry page follows page-1 W1 Judge landing; pairing follows page-1 "Set up this device" + "Device set up". The code 000000 and "to change role, sign out and pick again" live ONLY in the judge guide (entry and pair cards). | §8.1, §7.2 |
| W9 | ~~Guide tabs~~ **Superseded by V3:** one contextual card, collapsed by default, one language at a time. | §7 |
| W10 | Sample text in Day record / Proposals / Approvals uses the English script (fresh egg tarts; phone order not read back). Real screens show real data; this affects only guide copy and QA expectations. §A unchanged. | §7, §14 |
| V1 | **Pilot is NOT in MUST (14 Oct).** All pilot-only work (pilot sign-out/unpair, pilot session sweep + its pilot index, pilot re-pair path, pilot copy/guards) moves to §18 Post-submission. Demo PRs must not depend on any of it. | §18 |
| V2 | **Design source of truth = page 2 of the Bee6 Wireframes canvas** (~71 boards P2-*, L2-*, D2-*); board → PR map in §11a. Board dates (Mon 12 - Wed 14 Oct, v2 from Thu 15, review Tue 20) are illustrative; screens show real dates. | §11a |
| V3 | Judge guide has NO tabs: one contextual card per screen/stage; collapsed handle by default (phone bottom sheet; laptop "Judge guide · Stage n of 5" pill top-right opening a side panel). Listening card: active script card + "I have spoken this" + "Previous card (re-read only)"; after card 5 the same card becomes "Jump to closing time", then "Tap End today". | §7 |
| V4 | Entry = page-1 W1 Judge landing without the long paragraph; Pair = Set up this device → Device set up → Start-ready. Demo code + role tip only in the guide. | §8.1 |
| V5 | Owner Home = page-1 W4 (Progress: approved/rejected week/month/since start; Waiting for your approval list; Today in five lines; Next review; Cost coming soon; no Team). | §9.2 |
| V6 | Owner Approvals = page-1 W8 Review in order: one proposal at a time, inline required "Reject — why?", no confirm dialogs, recommended order, all-decided end; after #1 approved, #2 shows "Approve · not available" (SOP_CHANGED kept). | §9.5 |
| V7 | SOP page (supervisor + owner) = page-1 W13/W11 SOP book: version switch by date (dd/mm/yy), Book/Table toggle, chapters, improved badge with struck-through old wording and "See why it changed and the result". No Add/Download/Sheets buttons, no QR, no unpair (not built, not shown). | §9.1 |
| V8 | Supervisor screens added: change-label dialog, "Asking Bee6" generating state (keep this page open), proposal detail (Mark feasible / Reject with reason), marked-feasible hand-over, SOP first version. | §9.5 |
| V9 | Fixtures done: template clips in `private/demo-clips-v2/`, rehearsal audio in `private/rehearsal/`. | §A.5, §A.6 |
| V10 | Connected-devices code generation stays a SHOULD (supervisor feature; no QR, no unpair, no device ids). | §9.3 |
| S1 | **Staging dropped (14 Oct).** No `FIRESTORE_DATABASE_ID`, no named DB, no staging secrets/jobs; `web-develop` stays empty and ignored. | §0 item 9, §12 |
| S2 | Feature PRs → `develop` after tech-lead review + local QA (unit, lint, typecheck, build, Playwright against `next dev`/`next start` with mocked or demo-project services). | §11 gate |
| S3 | `develop` promoted to `main` at checkpoints P1 Thu 19:00, P2 Fri 14:30, P3 Fri 22:00, P4 Sat 08:00, freeze Sat 12:00; Cloud Build deploys `web` (demo project); dev-ops verifies; QA runs the live journey incl. the fake-mic audio rehearsal. Interim live breakage accepted. | §12 |
| S4 | Safety net: tag the known-good revision before every promotion (today `web-00015-9tt`); rollback = one traffic command; schema stays additive/optional; template wiped + re-seeded at P1 and before the freeze, inverted check CLEAN. | §12 |
| S5 | No new composite index for MUST; the sweep index only if the SHOULD sweep ships. | §12 D1 |

**What changes pilot behaviour, and what is demo-only (call this out in every PR body):**
- **Shared product rules (code shared by pilot and demo; change pilot behaviour; decided, kept in MUST):**
  (a) ROUTINE_OPS is never proposal evidence (floor + proposal gate); (b) the evidence floor is evaluated **per
  category** (2 facts on 2 dates in one category), stricter than today's any-mix rule; (c) debrief ranking puts
  ROUTINE_OPS and unlabelled-unit questions last; (d) "Generate another", cited-thread exclusion and the overlap-based
  supersede rule (§3.3-3.4).
- **Shared UI (also visible on the pilot, no behaviour change):** nav shell and empty states (PR-6), the Set up this
  device restyle of `/pair` with pilot copy unchanged (PR-6), the proposals/approvals screens (PR-12), the SOP page
  labels and improved badge (PR-9a), the owner Home (PR-8, SHOULD), the devices page (PR-10, SHOULD).
- **Demo-only (gated by `DEMO_MODE === "true"` AND a sandbox outlet):** next day (PR-2), closing route, End lock, Start
  hidden, line event use (PR-4a), demo sign-out + open-session view + sandbox sweep (PR-4b), Preparing/waiting-more
  debrief, auto-open, CARRY_OVER 0 (PR-3), judge guide and script (PR-5), entry page `/` (PR-6), owner reset (PR-7).
- **Pilot-only, OUT of MUST (§18):** staff sign-out that unpairs a real phone, the unpair route, the all-outlet session
  sweep and its pilot index, the pilot re-pair copy/guards. **Hold-back rule:** no demo PR may import, call or require
  any of these; the demo sweep (if built) is sandbox-filtered and needs only the demo-database index.

**Docs to update in the same release (docs PR, PM routes it; Rangga approves since `docs/**` is outside code
commits):** `docs/specs/technical-specification.md` §8.15 "Insight sufficiency" (suff rule now per category,
ROUTINE_OPS excluded; version label `floor-v2`) and the H10 node of the §7 diagram (line ~759); `docs/specs/pipeline-and-agents.md`
(ProposalAgent input: focus category only); `docs/db-schema.md` (new fields §2); `docs/specs/web-backend-rbac.md`
§6.6 (new routes §2.3); README "How a proposal is made"; close the matching `docs/plan.md` §10 items.

---

## 2. Data and contract changes (all land in PR-0 so parallel PRs never conflict on them)

### 2.1 `lib/firestore/schema.ts` (all optional, so every existing doc still parses)

```ts
// OutletSchema.sandbox (the .strict() object) gains:
next_day_count: z.number().int().min(0).max(2).optional(),        // absent = 0
shift_started_at_ms: z.number().int().min(0).nullable().optional(), // non-null while a shift runs or after a crash

// CaptureSessionSchema gains (sandbox sessions only):
demo_closing_at_ms: z.number().int().min(0).optional(),           // set by POST /api/v1/demo/closing

// ProposalSchema (root) gains:
focus_category: WorkCategorySchema.nullable().optional(),         // the one category a proposal is about; null on suppressed
// ProposalSchema.generator gains:
floor_version: z.literal("floor-v2").optional(),                  // absent = the old any-category floor

// DEMO_COUNTER_KINDS gains: "reset_sandbox", "process_now_sandbox"
```

No migration: absent fields read as the old behaviour (`next_day_count ?? 0`, no closing mark, `focus_category`
absent → supersede falls back to evidence overlap, §3.4). `shiftDeep` treats `demo_closing_at_ms` as an instant
(`_ms` suffix), which is correct.

### 2.2 `lib/demo/constants.ts`

```ts
export const CARRY_OVER_MAX = 0;               // was 2 (D-2)
export const DEMO_SESSION_MAX_MS = 600_000;    // was 300_000: 10-min hard stop per demo day (escape hatch, §5.4)
export const DEMO_DAYS_TOTAL = 3;
export const NEXT_DAY_MAX = 2;                 // next_day_count never exceeds this
export const GENERATE_PER_SANDBOX = 8;         // was 5 (Ask after day 1 + Ask + Another + retries)
export const SEGMENT_PER_SANDBOX = 150;        // was 60 (3 days x up to 10 min)
export const RESET_PER_SANDBOX = 3;
export const PREPARING_MAX_MS = 6 * 60_000;    // "Preparing" never shows longer than this after End
export const PROCESS_NOW_MIN_INTERVAL_MS = 20_000; // fast lane (Task D3)
export const PROCESS_NOW_PER_SANDBOX = 40;
```
`DEMO_SESSION_MAX_MS` is also a `z.literal` in `lib/capture/contract.ts` (`demo_session.max_ms`): change both.

### 2.3 New and changed routes (contracts; zod `.strict()` everywhere)

| Route | Auth | Body / response | PR |
|---|---|---|---|
| `GET /api/v1/capture/config` | device | `demo_session` (sandbox only) becomes `{ max_ms: 600000, script_id: "bakery-v2", day: 1\|2\|3, days_total: 3, days_done: 0..3, closing_reached: boolean, open_session: { session_id, started_at_ms, closing_reached, auto_stop_at_ms } \| null, next_day: { allowed: boolean, reason: NextDayRefusal \| null } }` (all sandbox-only) | PR-0 contract, PR-2 fills day/next_day, PR-4 fills closing_reached + open_session |
| `POST /api/v1/demo/closing` | device (sandbox) | `{ session_id: uuid }` → 200 `{ closing_reached: true }`; 409 `not_enough_speech {have, need}`, `session_not_open`; 404 off-sandbox | PR-4 |
| `POST /api/v1/demo/next-day` | device (sandbox) | `{ expected_day: 1\|2, confirm_unanswered: boolean }` → 200 `{ day: 2\|3 }`; 409 `{code: NextDayRefusal, unanswered?: number}`; 404 off-sandbox | PR-2 |
| `GET /api/v1/questions` | device | adds `preparing?: boolean` (key present only on a sandbox) | PR-3 |
| `POST /api/v1/demo/process-now` | device (sandbox) | `{}` → 200 `{ processed: number }`; 429 | PR-3 (SHOULD, Task D3) |
| `GET /api/v1/proposals` | supervisor/owner | adds `watch: { from_date, to_date, categories: WatchRow[] }` | PR-1 |
| `POST /api/v1/proposals/generate` | supervisor/owner | body adds `another?: boolean`; view adds `focus_category` | PR-1 |
| `GET /api/v1/demo/progress` | supervisor/owner (sandbox) | `{ day, days_done, proposals_with_content, feasible, owner_decided }` | PR-5 |
| `POST /api/v1/demo/reset` | owner (sandbox) | `{ confirm: "reset" }` → 200 `{ reset: true }`; 429; 404 off-sandbox | PR-7 |
| `GET /api/v1/home` | owner | adds `progress`, `waiting_approval`, `next_review` (§9.2) | PR-8 |
| `GET /api/v1/devices` | supervisor/owner | `{ devices: DeviceRow[] }`, **no ids** | PR-10 |
| `POST /api/v1/devices/pairing-code` | supervisor/owner | `{}` → `{ code: "123456", expires_at_ms }` | PR-10 |

`NextDayRefusal = "session_open" | "day_not_ended" | "preparing" | "unanswered_questions" | "max_days" |
"proposal_exists" | "shift_incomplete" | "busy"` (PR-0 exports it from `lib/demo/contract.ts`).

Every new route: `requireClaims`/`requireDevice` first, outlet from the claims only, `DEMO_MODE === "true"` and
`outlet.project_kind === "demo"` and `outlet.sandbox` present for every `/api/v1/demo/*` route (else **404 before any
other read**, same as `app/api/v1/demo/session/route.ts`), `handleApiError`, `jsonOk`, no text in logs.

---

## 3. Evidence rules (PR-1, `developer`, sonnet; 9 h)

### 3.1 ROUTINE_OPS excluded (product rule, everywhere)

- `lib/proposals/constants.ts`: `export const EVIDENCE_EXCLUDED: ReadonlySet<WorkCategory> = new Set(["ROUTINE_OPS"]);`
  and `export const FLOOR_VERSION = "floor-v2" as const;`
- `lib/proposals/candidates.ts` `selectCandidates`: after the NON_WORK skip, `if (EVIDENCE_EXCLUDED.has(effective)) continue;`.
  Effective = `confirmed_category ?? category`, so a supervisor relabel from ROUTINE_OPS to CUSTOMER_SERVICE makes it count.
- Nothing else changes in the evidence gate (`lib/pipeline/gate.ts`): a ROUTINE_OPS thread still becomes a fact or a
  question by the same rules (hard rule #10 is untouched). It simply never reaches a proposal. Day record and Home
  still show it.
- `lib/debrief/rank.ts` `rankQuestions`: three tiers, then oldest `window_start_ms`, then `question_id`:
  tier 0 incident (unchanged `INCIDENT_FIRST`), tier 1 `kind === "gate"` with category not ROUTINE_OPS, tier 2 the
  rest (ROUTINE_OPS gate questions and `unlabelled_unit`). Why: with a cap of 5, a routine question must never push
  the phone-call question out.

### 3.2 Per-category floor (`lib/proposals/precheck.ts`)

```ts
export interface CategoryEvidence { category: WorkCategory; facts: number; dates: number; ready: boolean }
/** Pure. One row per category present in `all`; ready = facts >= MIN_EVIDENCE_FACTS && dates >= MIN_EVIDENCE_DATES.
 *  Order: ready first, then facts desc, then dates desc, then CATEGORIES order. */
export function evidenceByCategory(all: readonly Candidate[]): CategoryEvidence[];
/** passed iff some row is ready. facts/dates = the FIRST row's numbers (0/0 when empty). */
export function checkEvidenceFloor(all: readonly Candidate[]): { passed: boolean; facts: number; dates: number };
```
`followupFor(all)`: `categories` = first 3 rows' categories; `have_facts`/`have_dates` = first row's numbers (so the
card reads "1 of 2 days" for the closest problem). Schema unchanged.

### 3.3 Focus category, "Generate another", cited-thread exclusion (`lib/proposals/service.ts`)

- `GenerateBodySchema` gains `another: z.boolean().optional()`; the route passes it; `generateProposal` input gains
  `another: boolean` (default false).
- `ProposalStore` gains `listOpenProposals(): Promise<Proposal[]>` (status `awaiting_supervisor | awaiting_owner`, any
  range, outlet-scoped, at most 50, malformed skipped). Firestore impl in `lib/firestore/proposal-store.ts`
  (`where outlet_id ==`, `where status in [...]`).
- Step 6 (reuse): run **only when `another !== true`** (unchanged otherwise).
- New step 8a': `const open = await store.listOpenProposals();`
  `cited = new Set(open.flatMap(p => (p.content?.evidence ?? []).map(e => e.thread_id)))`;
  `taken = new Set(open.map(p => p.focus_category).filter(Boolean))`.
  `const pool = all.filter(c => !cited.has(c.thread_id));`
  `const rows = evidenceByCategory(pool);` `const focus = rows.find(r => r.ready && !taken.has(r.category)) ?? null;`
- If `focus === null` → the existing suppressed path (`insufficient_evidence`), with `followupFor(pool)`, counts from
  `pool`, `focus_category: null`, `generator.floor_version: "floor-v2"`.
- Else: `const focused = pool.filter(c => c.category === focus.category);` and **only `focused`** goes to
  `aliasCandidates` / the prompt / `aliasToCandidate`. The written proposal carries `focus_category: focus.category`
  and `floor_version: "floor-v2"`. `toProposalView` exposes `focus_category` (view schema `.nullable()`).
- pgate is unchanged (its `evidence_min` and `metric_not_in_evidence` already hold inside one category).
- `GENERATE_PER_SANDBOX` = 8 (PR-0).

### 3.4 Supersede by overlap (`lib/proposals/review-plan.ts`)

`isSuperseded(p, sameRange)` keeps all current conditions **and** adds: the newer `q` must be about the same problem:
`(p.focus_category && q.focus_category) ? p.focus_category === q.focus_category : evidenceIntersects(p, q)` where
`evidenceIntersects` = the two `content.evidence[].thread_id` sets share an id (null content = no overlap). Legacy
proposals (no `focus_category`) therefore supersede only when they share evidence. `supersededIds` unchanged.

### 3.5 Watch panel ("What Bee6 is watching")

`listProposals` (`lib/proposals/review-service.ts`) adds `watch`: range = `[today-6, today]` (business dates, outlet
tz), read with the same `listSessions`/`listThreadsInRange` + `selectCandidates` as Generate (reuse; inject the
proposal store). `WatchRow = { category, facts, dates, need_dates: 2, state: "ready" | "needs_more" | "proposed" }`;
`proposed` when the category is the `focus_category` of an open or approved proposal whose range overlaps. Only
categories with at least 1 fact are listed (no "Not seen yet" rows: plain code cannot know a problem it has not
seen; the guide explains what is coming). **PR-1 is API-only:** the watch panel UI and the "Ask Bee6 for a
proposal" / "Ask for another proposal" (`another: true`) buttons are built in PR-12 (§9.5).

### 3.6 Tests (PR-1)

- `candidates.test.ts`: ROUTINE_OPS fact dropped; ROUTINE_OPS with `confirmed_category: "CUSTOMER_SERVICE"` kept;
  NON_WORK still dropped.
- `precheck.test.ts`: 2 CS facts on 2 dates → ready; 1 CS + 1 PHONE_CALL on 2 dates → not passed (rule change);
  ordering ties; followup uses the first row.
- `service.test.ts`: focus = CS only in the prompt (assert `aliasCandidates` input); `another: true` skips reuse;
  cited threads of an open proposal are excluded; with A proposed and B ready → second proposal focus PHONE_CALL;
  with A proposed and B not ready → suppressed; `floor_version` written.
- `review-plan.test.ts`: same range, different focus → not superseded; same focus → superseded; legacy no-focus
  overlapping evidence → superseded; legacy disjoint → not.
- `rank.test.ts`: PHONE_CALL gate before ROUTINE_OPS gate before unlabelled, incidents first.
- `review-service.test.ts`: watch rows and `proposed` state.
- Seed check: `scripts/demo-seed-template.test.ts` for the inverted check (§5.9).

---

## 4. Jump to tomorrow = data shift (PR-2, `developer`, sonnet; 9 h; security-reviewer: yes)

### 4.1 The 7 guards (all plain code, all server-side, in this order)

| # | Guard | Refusal |
|---|---|---|
| G1 | `DEMO_MODE === "true"`, outlet `project_kind === "demo"`, `outlet.sandbox` present | 404 (before any other read) |
| G2 | Device claims; `claims.outlet_id` is that sandbox; device doc not revoked, not expired | 401/404 (existing `requireDevice`) |
| G3 | No open capture session for the device | 409 `session_open` |
| G4 | `last_ended` present, not `discarded`, `business_date === today`; and not preparing (§6.2 computation) | 409 `day_not_ended` / `preparing` |
| G5 | `(next_day_count ?? 0) < NEXT_DAY_MAX` and `body.expected_day === next_day_count + 1` | 409 `max_days`; a stale `expected_day` returns 200 with the current day (idempotent double tap) |
| G6 | No proposal of the outlet with `content !== null` (any status), and no live `proposal_locks/{outlet}` | 409 `proposal_exists` / `busy` |
| G7 | Single flight: a transaction on the outlet doc sets `sandbox.shift_started_at_ms = now` only if it is null; then the device's pipeline lease (`tickStore.acquireLease(outlet, device, now, 120_000)`) | 409 `shift_incomplete` (marker already set and older than 120 s) / `busy` (marker newer, or lease held) |

Unanswered questions: if G1-G7 pass and the device has `open` questions while `now < last_ended.debrief_ends_at_ms`
and `confirm_unanswered !== true` → 409 `unanswered_questions` with `unanswered: n`, nothing written (check runs
before G7 takes the marker).

### 4.2 The shift (new pure module `lib/demo/next-day.ts` + store methods)

- Reuse `shiftDeep` from `lib/demo/clone.ts`, extended with an optional 5th parameter
  `opts?: { dateKeys?: ReadonlySet<string>; untouchedKeys?: ReadonlySet<string> }` whose defaults are today's
  `DATE_KEYS` / `UNTOUCHED_KEYS` (the clone's behaviour must not change; its tests stay green).
- `NEXT_DAY_DATE_KEYS = DATE_KEYS ∪ {"debrief_business_date", "from_date", "to_date"}`;
  `NEXT_DAY_UNTOUCHED = UNTOUCHED_KEYS ∪ {"expires_at", "expires_at_ms", "sandbox", "ts", "pairing_code_expires_at", "paired_at", "created_at"}`
  (TTL and record-of-real-time fields never move).
- `delta = -86_400_000`, `days = -1`. Per collection, docs where `outlet_id == sandbox`:

| Collection | What moves |
|---|---|
| `capture_sessions` | whole doc via `shiftDeep` (started/ended/auto_stop/debrief/demo_closing `_ms`, `local_date`, `received_*_at`) |
| `segments` | `received_at`, plus **explicitly** `device_start`, `device_end` (ISO, no `_at` suffix); `expires_at` never |
| `threads` | `first_line_start_ms`, `last_line_end_ms`, `lines[].start_ms/end_ms`, `created_at_ms`, `updated_at_ms` (shiftDeep; `summary`, `text`, `fields`, `gate`, `runner_up` untouched) |
| `questions` | `window_start_ms`, `window_end_ms`, `created_at_ms`, `answered_at_ms`, `expired_by_debrief_end_ms` |
| `corrections` | `answered_at_ms`, `received_at_ms`, `debrief_business_date`; `expires_at`, `created_at` never |
| `label_units` | `labelled_at_ms` |
| `proposals` (only suppressed/blocked exist, G6) | `range.from_date/to_date`, `created_at_ms`, `updated_at_ms` |
| `devices` | **only** `last_ended` (business_date, ended_at_ms, debrief_ends_at_ms) |
| `sop_versions`, `constraints`, `staff`, `audit_log`, `outlets`, heartbeats, `pipeline_locks`, `demo_counters` | nothing |

- Order: (1) G1-G7 + marker; (2) read every doc of the table (bounded: refuse 503 `template_too_large` above
  `TEMPLATE_DOC_MAX * 3`); (3) write in batches of `WRITE_BATCH_MAX` with `set` (doc ids unchanged:
  `capture_sessions` ids are `{device}:{session}`, thread/question ids carry no date); (4) expire the open questions
  of the ended day with the existing `tickStore.expireOpenQuestions(outlet, device, shiftedDebriefEndsAtMs, now)` so
  day 2's debrief never shows day-1 questions; (5) transaction: `next_day_count + 1`, `shift_started_at_ms = null`;
  (6) release the pipeline lease in `finally`. A crash between (3) and (5) leaves the marker set → later calls get
  `shift_incomplete`; the recovery is the owner reset (copy below).
- No label, summary, line text, category, confidence, gate decision or fact status changes (hard rule #10). Audio:
  none touched (#2). Names: none read (#7).

### 4.3 Capture config and Start

`lib/capture/contract.ts` `projectCaptureConfig`: on a sandbox, `day = next_day_count + 1`;
`days_done = next_day_count + (last_ended && last_ended.end_reason !== "discarded" && last_ended.business_date === today ? 1 : 0)`;
`next_day` = the result of the same pure guard function `nextDayEligibility(input)` (G3-G6 only, no writes), so the
drawer can show the lock reason without a call. Start: `demoMulaiAvailability` is unchanged (after the shift,
`today > last.business_date` and the shifted debrief end is in the past, so Start is offered; before the shift,
`day_ended`). `day` caps at 3: on day 3 after End, `next_day = {allowed:false, reason:"max_days"}`.

### 4.4 Exact refusal copy (EN final; ID PROVISIONAL)

| Code | EN | ID (PROVISIONAL) |
|---|---|---|
| `proposal_exists` | "Bee6 has already written a proposal from these days, so the shop clock can't move to another day. To run the days again, sign in as Owner and reset the demo." | "Bee6 sudah membuat usulan dari hari-hari ini, jadi jam toko tidak bisa maju ke hari lain. Untuk mengulang, masuk sebagai Pemilik dan atur ulang demo." |
| `max_days` | "All 3 demo days are done. Sign out and continue as Supervisor." | "Ketiga hari demo sudah selesai. Keluar, lalu lanjut sebagai Supervisor." |
| `session_open` | "End today's session first." | "Akhiri sesi hari ini dulu." |
| `day_not_ended` | "Run today first: tap Start, speak the cards, then End." | "Jalankan hari ini dulu: ketuk Mulai, bacakan kartu, lalu Selesai." |
| `preparing` | "Bee6 is still preparing today's questions. Try again in a minute." | "Bee6 masih menyiapkan pertanyaan hari ini. Coba lagi sebentar lagi." |
| `unanswered_questions` (confirm) | Title "Leave {n} questions unanswered?" Body "If you jump to tomorrow now, today's debrief ends and these questions are recorded as unverified." Buttons "Answer them first" / "Jump anyway" | "Biarkan {n} pertanyaan tidak dijawab?" / "Jika Anda lompat ke besok sekarang, debrief hari ini berakhir dan pertanyaan ini dicatat sebagai belum terverifikasi." / "Jawab dulu" / "Tetap lompat" |
| `shift_incomplete` | "The demo could not move to the next day. Sign in as Owner and reset the demo." | "Demo tidak bisa maju ke hari berikutnya. Masuk sebagai Pemilik dan atur ulang demo." |
| `busy` | "Bee6 is busy with today's notes. Try again in a few seconds." | "Bee6 sedang memproses catatan hari ini. Coba lagi beberapa detik lagi." |

### 4.5 Tests (PR-2)

`next-day.test.ts` (pure): every guard and its order; stale `expected_day` idempotent; per-collection field table
(a fixture doc per collection, assert exactly which keys moved by -1 day and that `expires_at`, `summary`,
`lines[].text`, `gate`, `sandbox.*` did not); `clone.test.ts` unchanged and green; a fixture where the shifted debrief
end makes `expireAtDebriefEnd` return unverified. `route.test.ts`: 404 on pilot (no outlet read), 404 for a non-sandbox
device, each 409 body, success writes `next_day_count`. Store test with the in-memory fake: marker set/cleared; crash
after batch → `shift_incomplete`.

---

## 5. Staff session gates, script v2, sign-out (PR-4 server + phone; PR-5 drawer)

### 5.1 Script v2 data (`lib/demo/script.ts`, PR-5)

Add `bakery-v2` next to `bakery-v1` (keep v1 until PR-5 merges, then delete it in the same PR):
```ts
export const ScriptCardV2Schema = z.object({
  id: z.string().regex(/^d[1-3]-[a-z0-9-]{1,24}$/),
  title: Bilingual(60),
  lines: z.array(z.object({ speaker: z.enum(["staff","customer","caller"]), text: Bilingual(240) }).strict()).min(1).max(6),
  problem: z.enum(["A","B"]).nullable(),        // QA/guide reference only; no server code reads it (hard rule #10)
}).strict();
export const SCRIPT_V2: Readonly<Record<1|2|3, readonly ScriptCardV2[]>>;  // exactly the §A.2-A.4 text, EN; ID = EN copy marked PROVISIONAL until Tiffany
export const CARD_MIN_LINES = 1;                 // transcribed lines needed before "I have spoken this" enables (speech, not time)
export function requiredLines(day: 1|2|3): number; // = SCRIPT_V2[day].length * CARD_MIN_LINES = 5
```
Every day has exactly 5 cards (schema refine: `length === 5`). The §A text fits the one-card box as is (longest card
A.2-3: 4 lines, about 70 words; the box scrolls).

### 5.2 Line counting on the phone (PR-4)

The browser engine already receives the segment PUT JSON. Add a `CaptureEvent` `{ type: "segment_accepted", lines: number }`
emitted after a 200 that is not `{discarded:true}` (find the exact emit point in `lib/capture/browser/engine.ts` /
`session.ts`; if no clean seam exists, stop and flag). `/capture` keeps `linesThisSession` (reset on Start) and
`linesSinceCardShown` (reset when a card becomes the active card). No text ever reaches the phone.

### 5.3 One active card at a time (decided 14 Oct; PR-5)

- The listening guide card (§7) shows **one script card only**: "Card {k} of 5", the card title, then its lines (speaker tag in small caps,
  the words in large type) in a scrollable box (max height 50 vh, `overflow-y: auto`). **No list, no previous/next.**
- Button **"I have spoken this"** at the bottom. Enabled when `linesSinceCardShown >= CARD_MIN_LINES`; before that it
  is disabled with the helper "Waiting for Bee6 to hear this card…". There is no time rule anywhere.
- Tap → the card is marked spoken, the next card replaces it, the box scrolls to top and focus moves to the new card
  heading (`tabIndex={-1}` + `focus()`; an `aria-live="polite"` line announces "Card {k} of 5").
- After card 5 the same guide card becomes **"All 5 cards are spoken" + button "Jump to closing time"** (P2-05d); after
  the jump it becomes "Tap End today" (P2-06).
- A small link **"‹ Previous card (re-read only)"** shows the previous card with no button, and "Back to card {k}"
  returns; it never un-marks anything.
- Progress kept in `sessionStorage` `bee6.script.{session_id}` (`{ spoken: string[] }`) so a reload keeps it. Not
  undoable. No Skip.
- Language: the card shows ONE language, following the page's EN/ID toggle (EN now; ID PROVISIONAL = EN text until
  Tiffany supplies it, so ID mode shows EN cards with a small "Bahasa coming soon" note).

### 5.4 "Jump to closing time" unlock rule (exact; decided 14 Oct)

- **Client:** unlocked iff all 5 cards are marked spoken. Locked text, exactly:
  **"Locked until all N cards are spoken (k of N done)."** (N = 5, k = spoken count).
- **Server guard (kept):** `POST /api/v1/demo/closing` refuses 409 `not_enough_speech {have, need}` unless the session
  is open, belongs to the caller, and the sum of non-empty `lines` over `segments where outlet_id == X && device_id ==
  D && session_id == S` is `>= requiredLines(day)` (= 5). On success it sets `capture_sessions.demo_closing_at_ms =
  now` (idempotent). Copy on 409: "Bee6 has not heard enough yet ({have} of {need}). Wait a few seconds for the last
  card to upload, then try again."
- **Why keep a speech guard (and why it is not a time rule):** a tap-through with no speech produces no threads, so
  the debrief is empty and Proposals stays "waiting for evidence" forever; the judge would only find out at the end of
  day 3. The card-level guard (1 heard line per card) catches it on the card, while the judge is still speaking. It
  counts captured speech only; it never measures elapsed time. It is the minimum: 1 line per card, 5 per day.
- **Why not a transcript text match:** the phone never receives transcript text (the segment response is a count by
  design); judges improvise lightly, so a string match would lock out honest judges or need fuzzy (model-like)
  judgement; the evidence decision stays with the gate.
- **Stuck judge (mic or upload fails):** after a card shows "Waiting for Bee6…" with 0 new lines while the engine
  reports no speech, show "Not picking up your voice?" with 3 checks (mic allowed, tab open, speak closer) and the
  upload status line (this appears on the engine's own "no voice detected" / upload-error status, not on a timer).
  The escape hatch is the **10-minute hard stop** (Q4): the session auto-stops, the day still counts and the debrief
  starts with whatever was heard: "Bee6 stopped listening after 10 minutes. Today still counts." No "I'm stuck" skip.

### 5.5 End always visible, disabled until closing (decided 14 Oct; PR-4)

- Phone, sandbox session: the End button is **always rendered**. Before closing it is `disabled` (real `disabled`, not
  only `aria-disabled`) with the label **"End · available at closing time ({close_hm})"**, `close_hm` = `closeMs(
  session.local_date, weekly, tz)` formatted HH:MM (template outlet hours). After the closing 200 (or
  `open_session.closing_reached`) it is enabled with the label "End today".
- Server `endSession`: on a sandbox outlet, `end_reason === "selesai"` without `demo_closing_at_ms` → 409
  `closing_not_reached`. `auto_stop` and `lost` are always accepted. Pilot path unchanged.
- Server `discardSession`: on a sandbox, a session with `demo_closing_at_ms` → 409 `closing_reached`.
- Pilot End is unchanged (appears at `min(start + 4 h, close)`).

### 5.6 Start hidden while locked (PR-4, sandbox only)

`renderIdle`: when `config.demo_session` and `!idle.offered`, do **not** render the Start button; render
"Start unlocks tomorrow from 01:00" plus "Use Jump to tomorrow in the judge guide" (only when
`next_day.allowed`), or the `next_day.reason` copy otherwise. Pilot unchanged (button stays, `aria-disabled`).

### 5.7 Staff sign-out, demo only (PR-4b; V1)

The pilot has no staff sign-out today and gets none in this release (pilot version: §18). On a demo sandbox, "Sign
out" sits in the phone top bar (`app/shop/ShopTopBar.tsx`, rendered only when `config.demo_session` is present).
Sign out = remove `bee6.device_token` and `bee6.device_id` from `localStorage` (keep `bee6.demo`, the sandbox key) and
`router.replace("/")`. Re-pairing with `000000` in the same browser returns to the same sandbox (`startOrSwitch`
rotates the token) and shows the current state. **No server route is called for the sign-out itself.**
- **Before closing, session running:** P2-07a "Sign out and cancel today?" / "Today's session is still running. If
  you sign out now it is cancelled: the notes from today are deleted and today does not count." / "Keep listening" /
  "Sign out and cancel" → existing discard route (Batalkan) → sign out. If discard fails: stay, show the Batalkan error.
- **After closing, session running (Q1):** P2-07b "Sign out?" / "Closing time has passed, so today's session can no
  longer be cancelled. It stays open until you tap End, then the debrief runs for 60 minutes. Questions left
  unanswered are recorded as unverified." / "Stay" / "Sign out anyway" → no session route; the server session stays
  open with `demo_closing_at_ms` set.
- **No session:** sign out at once, no dialog.
- **Uploads:** before sign-out, stop the engine (mic off, wake lock released, `stopRunningSession` without the end
  POST), wait for the in-memory upload queue to drain (at most 15 s, "Finishing uploads…"; the rest dropped, counts
  only logged).
- **Answer cache:** kept; it drains after re-pairing (same device id).

### 5.7a Finding the still-open session on return (Q1; PR-4b; demo only)

The R-P1 rule "the local session is in memory only, lost on reload" (`app/capture/page.tsx:124`) stays: **the phone
never resumes listening into an old session.** Read-only discovery plus End:
- `GET /api/v1/capture/config`: `demo_session` (sandbox only) gains `open_session: { session_id: uuid, started_at_ms:
  int, closing_reached: boolean, auto_stop_at_ms: int } | null`. Server: `firestoreCaptureSessionStore(outlet)
  .findOpenForDevice(device_id)` = `capture_sessions where outlet_id == X && device_id == D && ended_at_ms == null`,
  limit 3, newest `started_at_ms` chosen in code (equality filters only: no new index). Pilot response unchanged.
- `/capture` with `open_session !== null` and no local session → `app/capture/OpenSessionView.tsx` (P2-07c / L2-06c):
  - `closing_reached`: "Today's session is still open." / "Closing time has passed. Tap End to start the debrief." /
    **End today** → existing end route (`selesai`, `ended_at_ms: now`) → `setLastEnded(...)` → debrief (§6).
  - not reached (reload or closed tab before closing): "Today's session was interrupted." / "Cancel it and start today
    again." / **Cancel today** → existing discard route → Start offered again.
  - Start is not offered while `open_session` exists.

### 5.7b Sandbox sweep of an orphaned open session (PR-4b; SHOULD, 1.5 h; demo only)

If the judge signs out after closing and never returns, nothing is harmed (the sandbox expires at 2 h). The sweep only
makes the debrief start on time for a judge who returns late:
- `lib/demo/sandbox-sweep.ts` `sweepSandboxSessions(store, now_ms, limit = 20)`: `capture_sessions where ended_at_ms ==
  null && auto_stop_at_ms <= now`, keep `outlet_id.startsWith(SANDBOX_OUTLET_PREFIX)` only, call the existing
  `endSession` with `end_reason: "auto_stop"`, `ended_at_ms = auto_stop_at_ms`. Idempotent; errors logged by class.
- Called from `app/api/internal/pipeline/tick/route.ts` after `runTick` **only when `DEMO_MODE === "true"`** (never on
  the pilot). Needs the composite index `capture_sessions (ended_at_ms ASC, auto_stop_at_ms ASC)` on the demo
  database only. If the index is missing, the sweep logs an error and does nothing else (the demo still works:
  §5.7a covers the returning judge).

### 5.8 Tests (PR-4a/PR-4b/PR-5)

Pure `cardState({spoken, linesSinceCardShown})` and `jumpLockText(k, N)` (exact string); "I have spoken this" disabled
until 1 line; one card rendered at a time; "Previous card" shows the previous card read-only and returns; focus moves
to the next heading; sessionStorage restore; the card follows the language toggle. Server: closing route each branch;
end route sandbox 409 / pilot unchanged; discard 409 after closing; config `open_session` only on a sandbox; sweep
(if built) closes only sbx- sessions and runs only with DEMO_MODE. Page tests: End always rendered and disabled with
the exact label (sandbox); Start hidden on sandbox when locked, pilot still renders it; the two sign-out dialogs call
discard vs nothing; no sign-out control on a pilot device; the open-session view's two branches.

### 5.9 Seed template re-cut + inverted readiness check (PR-1, `scripts/demo-seed-template.ts`)

- `plan.json` from §A.5 (2 days, offsets -2/-1, 3 clips each, every clip ≤ 15 s).
- Replace the R-18 readiness check with `checkTemplateClean(rows, sessions)`: run `selectCandidates` (which now drops
  ROUTINE_OPS) over the template range; **pass iff the result is empty** (no fact in any evidence category) **and**
  `evidenceByCategory` has no ready row. Print `CLEAN: routine-only history (routine facts=<n>)` and exit 0, or
  `NOT CLEAN: <category>=<facts> facts` and exit 2. `--check-only` keeps working.
- The clone needs at least one template day with an ended debrief (`cloneTemplate` throws otherwise): the plan's
  sessions end normally, unchanged.

---

## 6. Debrief (PR-3, `developer`, sonnet; 7 h)

### 6.1 Task D0: reproduce first

Write the failing test in `lib/debrief/flow.test.ts`: demo state, `LOADED` with 1 question and `preparing: true`,
`CHOOSE yes`, `TYPE "ok"`, `COMMITTED` → expect `view.kind === "waiting_more"` (fails today: `done`). Repro live after promotion P1
(QA): End a day after one card → open debrief → Yes → "Debrief complete". If the repro shows something else, stop
and flag tech-lead.

### 6.2 Server `preparing` (`lib/debrief/service.ts`, sandbox only)

`DebriefStore` gains `getLatestEndedSession(device_id, business_date)`, `listSessionLines(device_id, session_id):
Promise<{line_id: string; has_text: boolean}[]>` (line_id = `${seg_id}#${i}`, the windowing formula), and
`listLabelledLineIds(device_id)` (same query as the tick store's). In `listDebriefQuestions`, when
`calendar.sandbox === true` and the debrief is active: `pending = lines.filter(l => l.has_text && !labelled.has(l.line_id)).length`;
`preparing = pending > 0 && now_ms < last.ended_at_ms + PREPARING_MAX_MS`. Add `preparing` to the response (key only on
a sandbox). Log `{event:"debrief.preparing", pending}` counts only. Pure helper `isPreparing(...)` unit-tested.

### 6.3 Reducer and screens (`lib/debrief/flow.ts`, `app/capture/debrief/*`)

*(Amended 14 Oct after PR-3 tech-lead review: the demo poll runs only while the server says `preparing` (or on the question screen while `preparing` is true), not for the whole hour; once the 5-question cap is spent the debrief goes to `done` even if the server is still preparing; a counts-plus-seen-ids progress record in the phone's localStorage (`bee6.debrief.progress`) keeps counts and the cap across a reload.)*

- `DebriefState` gains `demo: boolean` and `preparing: boolean`. `LOADED`/`REFRESHED` events carry `preparing`.
- New views: `{kind:"preparing"}` (LOADED with 0 questions and preparing) and `{kind:"waiting_more", answered, skipped}`.
- `COMMITTED`/`SKIP` at the end of the list: `demo && preparing` → `waiting_more`; else `done` (pilot path identical
  to today).
- `REFRESHED` (demo): room = `DEBRIEF_SHOW_MAX - seen.size` (the cap is 5 **per debrief**, fixing today's "done"
  branch that could add 5 more); in `preparing`/`waiting_more`, fresh questions → `question` view; none and
  `!preparing` → `done` (0 answered and 0 skipped renders "No questions today").
- Demo poll: every 10 s while `preparing`, `waiting_more` or `question` (constant `REFRESH_POLL_MS_DEMO = 10_000`),
  stopping at `endsAtMs`.
- Demo auto-open: on a sandbox, `DebriefFlow` dispatches `OPEN` on mount unless the completion flag is set; the
  "Answer questions" entry card never shows on a sandbox.
- **Terminal done (demo):** no Back button. On entering `done`, write `localStorage["bee6.debrief.done"] = String(endsAtMs)`.
  In `closed`, if that flag equals `endsAtMs`, render the done summary instead of the entry card. Done copy (P2-10):
  "Debrief complete" / "Thank you. All {n} questions are answered and today is closed." (or "{k} of {n} were not
  answered and are recorded as unverified."), then the Start-locked line (§5.6) and Sign out.
- Preparing copy (P2-08, W7): "Preparing your questions" / "Bee6 is reading today's notes to decide what to ask. Your
  questions appear in about 2 to 4 minutes." / **"Keep this page open and the screen on. If you close it, the questions
  wait longer, but the 60-minute debrief clock keeps running."** / "Start is locked until the debrief is done." Waiting-more copy: "Checking for more
  questions…" / "Answering does not end the debrief. It ends when every question is answered or the 60 minutes are over."
- Timed out: unchanged copy plus "Questions left unanswered are recorded as unverified."
- Pilot: `demo === false` keeps every existing transition and screen (all existing tests stay green unmodified).

### 6.4 CARRY_OVER_MAX = 0

Set in PR-0. `cloneTemplate` then carries nothing; the "Earlier day" chip code stays (harmless) but never fires.
Test: clone with `CARRY_OVER_MAX = 0` leaves every template question `unverified`.

### 6.5 Task D3 fast lane (SHOULD, 4 h, security-reviewer: yes)

`POST /api/v1/demo/process-now` (device, sandbox): guards G1/G2, `last_ended` today and not discarded, rate
`PROCESS_NOW_MIN_INTERVAL_MS` per device (counter `process_now_sandbox`, cap `PROCESS_NOW_PER_SANDBOX`), `MODEL_DAILY`
bump. Runs the tick's per-device processing for the caller only, with `as_of_ms = max(now, last_ended.ended_at_ms +
silence + 180_000)` so the ended session's windows count as closed. **Precondition:** `processOneDevice` must accept an
`as_of_ms` separate from `now_ms`; if it does not, stop and flag (do not move `now_ms`, it stamps records). The
phone calls it once on entering `preparing` and every 30 s while preparing. Labels, gate and thresholds are
untouched (hard rule #10).

### 6.6 Tests (PR-3)

The D0 test; preparing/waiting_more/done transitions; cap 5 across refreshes; pilot transitions unchanged
(snapshot the existing reducer test file passing untouched); `isPreparing` table; questions route returns `preparing`
only on sandbox; DebriefFlow: auto-open on sandbox, no entry card after done, flag survives remount.

---

## 7. Judge guide (PR-5, `developer`, sonnet; 9 h; V3)

No tabs. **One contextual card per screen and state**, inside a guide that is **collapsed by default** everywhere.

### 7.1 Data model (`lib/demo/guide.ts`, pure, zod-validated at module load)

```ts
export type StageId = "staff_day1" | "supervisor_look" | "staff_days23" | "supervisor_decide" | "owner_approve";
export const STAGES: readonly { id: StageId; title: Bilingual }[];
  // "Staff · day 1", "Supervisor · look around", "Staff · days 2-3", "Supervisor · decide", "Owner · approve"

/** Every screen/state that has its own guide card. */
export type GuideKey =
  | "entry" | "pair"                                            // P2-01o, P2-02o
  | "capture_ready" | "capture_listening" | "capture_all_spoken" // P2-04o, P2-05o, P2-05d
  | "capture_closing" | "capture_open_session"                  // P2-06, P2-07c
  | "debrief_preparing" | "debrief_question" | "debrief_done"   // P2-08, P2-09, P2-10o (+ timed out P2-10b)
  | "day" | "proposals_waiting" | "proposals_ready" | "proposals_generating" | "proposal_detail" | "proposals_feasible"
  | "sop" | "reviews" | "devices" | "home" | "approvals" | "approvals_done";

export type GuideAction =
  | { kind: "fill_demo_code" }                 // pair: "Fill in 000000" fills the field (does not submit)
  | { kind: "script_card" }                    // listening: renders the active script card (§5.3) in the card body
  | { kind: "jump_closing" }                   // all spoken: POST /api/v1/demo/closing
  | { kind: "jump_tomorrow" }                  // done/timed-out: POST /api/v1/demo/next-day (§4)
  | { kind: "reset_demo" };                    // owner home: PR-7 dialog

export interface GuideCard {
  title: Bilingual;                 // e.g. "Tap Start, then read the cards"
  body: Bilingual[];                // 1-3 short lines; no list longer than 3
  action: GuideAction | null;
  footnote: Bilingual | null;       // e.g. entry: "To change role later: sign out, then pick again."
}
export const GUIDE: Readonly<Record<GuideKey, GuideCard>>;  // copy from the page-2 boards (EN); ID PROVISIONAL
export interface JourneyProgress { day: 1|2|3; days_done: number; proposals_with_content: number; feasible: number;
  owner_decided: number; supervisor_visited: boolean }
export function currentStage(p: JourneyProgress): StageId;
export function guideKeyFor(route: string, state: CaptureGuideState | WebGuideState): GuideKey;  // pure, table-tested
```
`currentStage` (exact): `days_done < 1` → staff_day1; `days_done === 1 && !supervisor_visited` → supervisor_look;
`days_done < 3 && proposals_with_content === 0` → staff_days23; `proposals_with_content === 0 || feasible <
proposals_with_content` → supervisor_decide; else owner_approve. (`supervisor_visited` = localStorage
`bee6.guide.sup_seen`, set when any supervisor page mounts.)

Where the demo facts live: **only** in the guide. The entry card says what Bee6 is, "about 20 minutes", and the
footnote "To change role later: sign out, then pick again." The pair card has "Fill in 000000". No screen shows them.

### 7.2 Guide component (`app/demo/JudgeGuide.tsx`, mounted in `app/layout.tsx` when `DEMO_MODE`)

- **Phone (< 900 px):** a collapsed bottom handle "JUDGE GUIDE · STAGE n OF 5 · <card title> · Day n of 3"; tap opens a
  bottom sheet (max 70 vh, body scrolls). **Laptop (≥ 900 px):** a pill top-right "Judge guide · Stage n of 5"; click
  opens a right side panel (360 px, body scrolls). Collapsed by default on every screen and after every route or state
  change; open/closed is not persisted. Non-modal (no focus trap), `aria-expanded` on the handle/pill, controls ≥ 48 px.
- Contents when open: the 5-stage list (✓ done, • current), then the ONE card for `guideKeyFor(route, state)`.
- `script_card` action: the card body is the active script card of §5.3 (title, speaker lines, "I have spoken this",
  "‹ Previous card (re-read only)"). After card 5 the key becomes `capture_all_spoken` with the `jump_closing` button;
  after the jump, `capture_closing` "Tap End today". Locked text when needed (§5.4): "Locked until all N cards are
  spoken (k of N done)."
- `jump_tomorrow`: enabled iff `demo_session.next_day.allowed`, else the §4.4 reason line; 409 `unanswered_questions` →
  inline confirm inside the card (no modal) → retry with `confirm_unanswered: true` → refetch config.
- One language at a time, following the page EN/ID toggle (`useLang`). ID = PROVISIONAL (EN until Tiffany).
- "Day n of 3 · {Ddd d MMM}" also appears in the phone header (PR-4a) from `demo_session.day` and the business date.
- Progress: phone from `demo_session`; web from `GET /api/v1/demo/progress` (on mount and after any decision).
- Replaces `ScriptDrawer` (delete it and its test). `DemoBar`: remove the Switch row and "start over"; keep the expiry
  notice and the ended-sandbox handling.

### 7.3 Tests

`currentStage` table; `guideKeyFor` table (every key reachable, every route covered); GUIDE schema parse; collapsed on
mount and after a route change; phone sheet vs laptop pill by width; "Fill in 000000" fills without submitting; jump
buttons' locked/unlocked text; inline unanswered confirm; DemoBar has no switch buttons; pilot layout renders no guide
(import-boundary test like `app/demo/import-boundaries.test.ts`).

---

## 8. Entry, nav shell, empty states, owner reset

### 8.1 Entry page and pairing (PR-6, `developer`; 4 h of PR-6's 8 h)

Demo `/` follows page-1 **W1 Judge landing** (W8): top strip "DEMO OUTLET · FICTIONAL DATA" + EN/ID; hero headline
"A small shop's day, turned into one better SOP step at a time." (**no** long explanation paragraph, V4); "TRY ALL THREE
ROLES · ABOUT 20 MINUTES"; three role cards STEP 1 Staff (START HERE, best on a phone) → `/pair`, STEP 2 Supervisor →
`/sign-in?as=supervisor`, STEP 3 Owner → `/sign-in?as=owner`, each with a small static preview image of its screen
(`public/demo/preview-{staff,supervisor,owner}.png`, fictional screenshots taken by uiux from the live demo after promotion P2; until then the cards render without images); footer strip
"Fictional shop, fictional data. Real shop data lives in a separate system and can't be reached from this demo.
Sessions last 2 hours." **No 000000 and no "change role" line on the page** (they live in the guide). Pilot `/`
unchanged (redirect to `/sign-in`).

`/pair` follows page-1 **Set up this device** (both deployments; PR-6 restyles the existing `PairForm`, no contract
change): heading "Set up this device", 6-digit field (one input, `inputMode="numeric"`, `autocomplete="one-time-code"`,
6 boxes visual), states **empty** (button disabled, "Enter all 6 digits"), **filled** (button enabled), **refused**
(existing `C-pair-refused`), **network** (existing `C-pair-net`), then the **Device set up** screen
(`app/pair/PairedChecklist.tsx`, page-1 Ph-SetupDone): "For {outlet name}" and 4 steps. Pilot steps unchanged
(`C-pair-step-1..4`). Demo steps: 1 "Keep this page open while you run the demo.", 2 "Allow the microphone when
asked.", 3 "Tap Start, then speak the script cards in the judge guide.", 4 "End becomes available at closing time:
use Jump to closing time in the judge guide." Button "Open the listening page". No demo code on this screen.
Remove the staff-side "start a fresh demo" control (the owner resets). After a successful demo pair, go straight to `/capture`, which shows
the Start-ready screen (P2-04) headed "Day {n} of 3 · {Ddd d MMM}" (Q6: no before-opening stage, no simulated hh:mm
clock anywhere; the boards' "SIM · 06:30" chips are not built).

### 8.2 Nav shell (PR-6, `developer-junior` for the mechanical parts; 3 h)

`app/web/AppNav.tsx`: `NAV = { supervisor: [day, proposals, sop, reviews, devices], owner: [home, proposals("Approvals"), sop, reviews] }`
(no Team). Role from the ID token claim (navigation only; the server still enforces). Used inside `WebTopBar` (brand,
outlet name, role chip, "DEMO DATA" chip on demo, LangSwitch, Sign out). `/devices` route exists from PR-10; until
then the item links to a placeholder page "Connected devices · coming in this release" (PR-6 creates
`app/devices/page.tsx` placeholder; PR-10 replaces it).

### 8.3 Empty states (PR-6; copy EN, ID PROVISIONAL)

| Screen | Empty copy |
|---|---|
| Day record | "No notes for this day yet." / "Notes appear after the shop phone listens and Bee6 reads the day." |
| Proposals (no watch rows, no proposals) | "No proposal yet" / "Bee6 needs the same problem on at least 2 days." |
| Approvals (owner) | "Nothing waiting for you." / "Proposals appear here after the supervisor marks them feasible." |
| SOP (no version) | "No SOP yet." / owner: "Uploading an SOP is coming soon. The demo uses a ready-made SOP." |
| Reviews | "Nothing to review yet" / "When an approved change reaches its review date, it appears here." |
| Devices | "No phone connected yet." |
| Home tiles | each tile "—" with "No data yet" |

### 8.4 Owner reset (PR-7, `developer`; 5 h; security-reviewer: yes)

`resetSandbox(store, deps, claims)` in `lib/demo/service.ts`; route `POST /api/v1/demo/reset`:
1. G1 (404 off-sandbox), `claims.role === "owner"` (403), body `{confirm:"reset"}` strict.
2. `bumpCounter(reset_sandbox, RESET_PER_SANDBOX)` → 429 over.
3. Read the outlet (keep `key_sha256`, `expires_at_ms`) and the judge device (`token_hash`).
4. `deleteSandbox(outletId)`.
5. `cloneTemplate` with the same ids, `now`, same `key_sha256`, same `device_token_hash`, and a new optional input
   `expires_at_ms` (default `now + SANDBOX_TTL_MS`, unchanged for creation) set to the old expiry, so a reset never
   extends the 2-hour copy. Write with `writeSandbox`.
6. Failure after step 4: 503 `reset_failed`; copy "The reset did not finish. Go to the entry page and start a new demo."
- UI `app/demo/ResetDemoButton.tsx` (confirm dialog: "Reset this demo?" / "This sets this demo copy back to day 1,
  with the original SOP and no proposals. Make sure no staff phone is listening." / "Cancel" / "Reset"), registered as
  the `reset_demo` control in the guide (owner pages only). After 200: `/home` with a notice "Demo reset to day 1".
- Tests: 404 pilot, 403 supervisor, 429, expiry preserved, token hash preserved, re-clone has `next_day_count`
  absent, no proposals, SOP v1 only.

---

## 9. SOP book, owner home, connected devices, proposals and approvals UI

### 9.1 SOP book (V7): PR-9a MUST (3 h, `developer-junior`) + PR-9b SHOULD (5 h, `developer`)

Same screen for supervisor and owner (D2-04, D2-04a, D2-04b, D2-04c). Read-only; steps change only via proposals.
- **PR-9a (MUST):** version switch by date: label `dd/mm/yy` of `effective_from_date` (seed: `created_at_ms`, outlet
  tz), newest marked "· current". The changed step (`change.step_id`) shows the badge **"IMPROVED · NEW ON
  {dd/mm/yy}"**, the new text, and the old wording `change.before.text` struck through (`<del>`, with visually hidden
  "Before:" for screen readers); `kind: "add"` → "NEW ON {dd/mm/yy}" without old wording. Link **"See why it changed
  and the result"** → `/proposals?id={source_proposal_id}` (supervisor) or the approvals detail (owner). "SOP first
  version" (D2-04a) = the seed version with no badges. Footer "Read-only. Steps change only through an approved
  proposal." **Remove** "Add SOP page", "Download", "Open in Sheets" (not shown at all, V7).
- **PR-9b (SHOULD):** Book/Table toggle. Book = two-page spread: left page contents + legend ("From your SOP" n /
  "Improved with Bee6" n), right page the chapter's steps; prev/next page. Chapters are plain code
  (`lib/sop/chapters.ts`): step id prefix `open`/`close` → "Opening & closing", `bake` → "Production", `stock` →
  "Stock", `serve` → "Customer", anything else → "Other steps" (the pilot's SOP falls back here; no pilot data
  change). Table = columns CODE / STEP / CHAPTER / WHO (role) / WHEN (version date) / WHERE IT CAME FROM ("Your SOP" or
  "Bee6 proposal, approved {date}"). At 360 px the book collapses to one page.
- Tests: date labels, current marker, badge only on `change.step_id`, struck old text, no Add/Download/Sheets in the
  DOM, chapter mapping table, table columns.

### 9.2 Owner home = page-1 W4 (PR-8, `developer`; 6 h; SHOULD; V5)

Layout: mist background, greeting, **Waiting for your approval · n** list (each row: change title, "Supervisor marked
it feasible", Review → approvals), **Progress** card with a Week / Month / Since start switch and two counts
(Approved · started, waiting for review / Rejected), **Today in five lines** (existing), **Next review**, **Cost per
outlet · coming soon**. No Team menu. Reset area for PR-7 (D2-07b confirm, D2-07c after reset).

`HomeResponseSchema` (strict extension, W6):
```ts
progress: { week: Tally, month: Tally, since_start: Tally },   // Tally = { approved: int, rejected: int }
waiting_approval: { count: int, items: { proposal_id: uuid, change_title: string }[] },  // max 5, newest first
next_review: { date: string | null, change_title: string | null },
```
- A proposal counts only if `supervisor_review.decision === "feasible"` **and** `owner_decision` exists. `approved` =
  `owner_decision.decision === "approved"`; `rejected` = `"rejected"`. Windowed by
  `businessDateOf(owner_decision.decided_at_ms, tz)`. Week = `[today-6, today]`, month = `[today-29, today]`, since
  start = all. Read `proposals where outlet_id == X && status in ["approved","rejected"]`, at most 500, filter in code.
- `waiting_approval` = proposals `awaiting_owner`; titles are the stored, already redacted `change_title`.
- `next_review` = smallest `sop_versions.change.review_date >= today` with its `change_title`.
- If PR-8 is cut, the existing Home (Today in five lines) stays; the owner reaches Approvals from the nav.
- Tests: feasible+approved counted; feasible+rejected counted; supervisor-rejected not counted; awaiting_owner only in
  waiting; window edges; empty → zeros.

### 9.3 Connected devices (PR-10, `developer`; 5 h; security-reviewer: yes; SHOULD, V10)

Supervisor feature on both deployments (D2-05, D2-05a). No QR, no unpair, no device id anywhere (not built, not shown).
- `GET /api/v1/devices` (supervisor|owner): `DeviceRow = { label: string, paired: boolean, paired_on: string | null,
  last_seen_ms: number | null, listening: boolean }`. **No device id, no token, no code** (hard rule #7).
  `last_seen_ms` from the newest heartbeat; `listening` = an open capture session exists.
- `POST /api/v1/devices/pairing-code` (supervisor|owner): re-use the outlet's pending device (token_hash null, not
  revoked), else create one: id `dev-<12 hex>` (sandbox: `dvx-<12 hex>`, `expires_at_ms` = sandbox expiry), label
  `"Shop phone {n}"`; set `pairing_code = generatePairingCode()` (already excludes reserved `000000`), expiry now + 10
  min. Response `{ code, expires_at_ms }`. Audit `devices.pairing_code`, `actor_role` only. Sandbox cap: at most 2
  extra devices per sandbox (409 `device_limit`).
- UI `app/devices/DevicesApp.tsx`: code in large digits, Copy (Clipboard API, fallback select), countdown, "Generate a
  new code", connected list. If cut: PR-6's placeholder page stays ("Connected devices · coming soon").

### 9.4 Fast lane — §6.5.

### 9.5 Proposals and approvals UI (V6, V8): PR-12a MUST (7.5 h) + PR-12b SHOULD (7 h), `developer`

**PR-12a, supervisor (D2-02b, D2-03, D2-03a, D2-03b, D2-03d, D2-03e, D2-03f, D2-03g):**
- **Watch panel** (§3.5 data): one row per category with ≥ 1 fact: `C-cat-*` label, "seen on {dates} of 2 days
  needed", chip Ready / Needs 1 more day / Proposed. Empty: "No proposal yet" / "Bee6 needs the same problem on at least
  2 days." Buttons "Ask Bee6 for a proposal" and, once one exists, "Ask for another proposal" (`another: true`).
- **Generating state (D2-03d):** while the generate call runs (up to `MODEL_TIMEOUT_MS` × 2): "Asking Bee6…" / "This
  can take up to a minute. Keep this page open." Buttons disabled; a 409 `GENERATION_IN_PROGRESS` shows the same state.
- **Proposal detail (D2-03e):** step and status chip, change title, **What changes in the SOP** (old step text struck,
  new `change_text`), **The evidence · n moments on n days** (date · time · summary from the view), **Watch this metric**
  (`metric.description`), **Review date** (`review_date`), note "Feasible means staff can do this in the shop. The owner
  approves or rejects after you." Actions: **Mark feasible** and an inline **Reject… (reason required)** textarea
  (D2-03f; 1-500 chars, button disabled until filled; no confirm dialog), using the existing review route.
- **Marked-feasible hand-over (D2-03g):** "Marked feasible. The owner decides next." + guide card "Sign out and pick Owner".
- **Change-label dialog (D2-02b):** the existing `ThreadActions` "Change category" becomes a dialog listing the work
  categories by their `C-cat-*` labels (radio list, current one marked), Save / Cancel; same `override` action.
- Tests: watch rows/chips, another button visibility, generating state on 409, inline reject disabled until text,
  feasible hand-over, change-label dialog sends `override` with the chosen category.

**PR-12b, owner approvals = page-1 W8 Review in order (D2-08, D2-08c, D2-08d, D2-08e):**
- One proposal at a time, ordered by `created_at_ms` ascending ("Recommended order" list #1, #2 with status), progress
  segments on top, "‹ Back to home".
- Card: area/step, change title, three tiles **Why** (`rationale`), **Extra work for staff** (`change_text`), **Cost**
  ("Not estimated yet · coming soon": there is no cost field and it is never invented), evidence list, watch metric,
  "Starts {effective date} · review {review_date}" from the view (never a hard-coded "five days": the review date is the
  plain-code `review_date`, 7-28 days).
- **Your decision** card: **Approve** at the top; below it an inline required **"Reject — why?"** textarea (1-500 chars,
  "Write a short reason first. It becomes a rule Bee6 will respect.") and "Reject with reason". **No confirm dialogs.**
- After #1 is approved, #2 shows **"Approve · not available"** (disabled) with "The SOP changed after this was drafted.
  You can still reject it with a reason." (existing `notices.sop_changed`; SOP_CHANGED rule kept).
- **All decided (D2-08e):** "Both decided." summary (approved: starts / review date; rejected: "now a rule" with the
  reason), "What happens next", buttons "Back to home" / "See the SOP".
- Fallback if PR-12b is cut: the existing owner proposals screen, plus the guide card "Approve one, then reject the
  other with a reason".
- Tests: order, one-at-a-time navigation, approve then #2 approve disabled with the SOP-changed line, inline reject
  required, all-decided summary, Cost tile never shows a number.

## 10. Task R: scenario rehearsal (validation BEFORE the demo; `developer` builds the harness 3 h, QA runs it)

### 10.1 Text rehearsal (`scripts/eval-scenario.ts`, `npm run eval:scenario`, demo project only)

- Fixture `scripts/eval-fixtures/scenario-v2.ts`: the §A script lines per day (speaker tags stripped) plus 4 variants
  per day: **V1 paraphrase** (same meaning, other words), **V2 fillers** ("um", "okay so", repeated words), **V3
  reordered** (cards in a different order), **V4 light improvisation** (one extra sentence per problem card, e.g.
  "They look good though"). The variant text is written by tech-lead in the fixture (fictional).
- For each day × variant, two unitings: **U1 one unit** (all lines, as when the judge pauses < 90 s) and **U2 one
  unit per card**. Run each through the real path used by `scripts/eval-label.ts` (categories loader → prompt →
  label client, `gemini-3.5-flash-lite`, location from `config/regions.yaml`), 5 runs, then `evaluateGate` per thread
  with no answer.
- Classify per run: A-card lines → thread category CUSTOMER_SERVICE as **fact** or **question**; B-card lines →
  PHONE_CALL (always a question); routine lines → never CUSTOMER_SERVICE or PHONE_CALL; questions per day ≤ 5.
- **Acceptance:** exact script (U1 and U2): A correct 5/5 on days 1 and 2 with A as fact in ≥ 3/5; B correct 5/5 on
  days 2 and 3; contamination 0/5; questions ≤ 5 in 5/5. Variants: A and B correct ≥ 4/5 each, contamination ≤ 1/5.
- Output: a table (counts only; prints no line text beyond the fixture's own ids). Exit 2 on failure.
- **Rewrite loop:** on failure, tech-lead rewrites the failing card(s) (keep §A.4 rules), updates `SCRIPT_V2` and the
  fixture together, re-runs. At most 3 rounds (by Thu 15 Oct 20:00). Still failing → Rangga decides between the best
  wording and adding the supervisor relabel step to the guide as the documented recovery.

### 10.2 Audio rehearsal on the live demo (QA; uses the §A.6 clips)

Chrome with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<card.wav>`
(one launch per card, or a concatenated day file with 3 s gaps) on https://web-33uzb53tza-et.a.run.app after promotion P1 (the real pipeline). Run the whole 3-day
journey twice with the exact clips and once with the improvised takes. Record per day: lines per card (sets
`min_lines`), threads and categories on Day record, debrief questions (count ≤ 5, PHONE_CALL present on days 2-3),
proposals A and B both generated. **Pass:** 2 of 2 exact runs and the improvised run produce both proposals.

### 10.3 Safety nets the judge can always use (documented in the guide)

1. Debrief Yes turns any question thread into a fact (`staff_confirmed`) unless its category needs a supervisor.
2. Supervisor "Change label" on Day record (`supervisor_confirmed`): if the egg-tart moment landed as STAFF_CONSULT or
   COMPLAINT, relabel it CUSTOMER_SERVICE; it then counts. The supervisor guide (D2-02) says so.
3. If only A is ready, the supervisor can still finish the journey with one proposal (approve it); the guide says
   "One proposal is possible now" (D2-03a).

---

## 11. PR list, ownership, dependencies, gates

| PR | Branch | Scope | Owner agent | Est. | Depends on | Security-reviewer | Tier |
|---|---|---|---|---|---|---|---|
| PR-0 | `chore/r19-contracts` | all §2.1 schema fields, §2.2 constants, §2.3 contract types; i18n split scaffold `lib/i18n/v2/{journey,session,debrief,web,proposals,devices,sop,home}.ts` spread into `ID`/`EN` | developer | 1.5 h | — | no | MUST |
| PR-0b | `chore/r19-design-tokens` | page-2 design tokens and primitives only: colours, type scale, spacing, radii, `Card`, `Button` (primary/secondary/destructive/disabled), `Chip`, `Pill`, `Segmented`, `Sheet`/`SidePanel` shells, mist background, in `app/ui/**` + `app/globals.css`. No screen changes. | uiux + developer | 3 h | — | no | MUST |
| PR-1 | `feature/r19-evidence-rules` | §3 (API only) + §5.9 | developer | 8 h | PR-0 | no | MUST |
| PR-2 | `feature/r19-next-day` | §4 | developer | 9 h | PR-0 | **yes** | MUST |
| PR-3 | `feature/r19-debrief` | §6 (D3 fast lane optional, separate commit series) | developer | 7 h (+4 h D3) | PR-0, PR-0b | D3 only | MUST (D3 SHOULD) |
| PR-4a | `feature/r19-session-gates` | §5.2 line event, §5.4 closing route, §5.5 End, §5.6 Start hidden, "Day n of 3 · date" header (sandbox) | developer | 6 h | PR-0, PR-0b | no | MUST |
| PR-4b | `feature/r19-demo-signout` | §5.7 demo sign-out (local), §5.7a open-session view (sandbox) | developer | 3 h | PR-4a | no | MUST |
| PR-4b+ | same branch, last commits | §5.7b sandbox sweep (DEMO_MODE only) | developer | 1.5 h | PR-4b | no | SHOULD |
| PR-5 | `feature/r19-judge-guide` | §5.1, §5.3, §7 (contextual cards, collapsed handle/pill, one language) | developer | 9 h | PR-0b; PR-2 + PR-4a merged before its merge | no | MUST |
| PR-6 | `feature/r19-shell` | §8.1 W1 landing + Set up this device + Device set up, §8.2 nav, §8.3 empty states | developer (+junior for empty states) | 8 h | PR-0, PR-0b | no | MUST |
| PR-7 | `feature/r19-owner-reset` | §8.4 | developer | 5 h | PR-0; registers the `reset_demo` action in PR-5's guide | **yes** | MUST |
| PR-9a | `feature/r19-sop-dates` | §9.1 PR-9a (date versions, improved badge, struck old text, buttons removed) | developer-junior | 3 h | PR-0b | no | MUST |
| PR-12a | `feature/r19-supervisor-proposals` | §9.5 PR-12a (watch panel, generating, detail, inline reject, feasible hand-over, change-label dialog) | developer | 7.5 h | PR-1, PR-0b | no | MUST |
| PR-R | `feature/r19-rehearsal` | §10.1 harness + fixture | developer | 3 h | PR-0 | no | MUST |
| Docs | PM-routed | §1 doc list | developer-junior | 1.5 h | PR-1 | no | MUST (not code) |
| PR-12b | `feature/r19-owner-approvals` | §9.5 PR-12b (W8 review in order) | developer | 7 h | PR-12a | no | SHOULD (first) |
| PR-8 | `feature/r19-owner-home` | §9.2 (W4) | developer | 6 h | PR-6, PR-0b | no | SHOULD |
| PR-9b | `feature/r19-sop-book` | §9.1 PR-9b (book/table, chapters) | developer | 5 h | PR-9a | no | SHOULD |
| PR-10 | `feature/r19-devices` | §9.3 | developer | 5 h | PR-6 | **yes** | SHOULD |
| PR-11 | `feature/r19-restyle` | screens no other PR touched (day record cards, reviews, sign-in) onto PR-0b tokens; CSS/markup only, no behaviour, no copy | uiux + developer | **4 h hard timebox** | all MUST merged | no | CUT-IF-LATE |

**MUST total ≈ 87 h of agent build** (PR-0 1.5, PR-0b 3, PR-1 8, PR-2 9, PR-3 7, PR-4a 6, PR-4b 3, PR-5 9, PR-6 8,
PR-7 5, PR-9a 3, PR-12a 7.5, PR-R 3, docs 1.5 = 75.5, plus ~12 h of review-fix rounds). **SHOULD ≈ 35.5 h** (PR-12b 7,
PR-8 6, PR-9b 5, PR-10 5, D3 4, sweep 1.5, PR-11 4, + ~3 h fixes).

**Deltas.** v3 (87 h) → v4 page-2/pilot-out (88 h): pilot work out (PR-4b 7.5 → 3 h, −4.5; PR-10 out of MUST, −5.5);
PR-0b tokens +3; PR-12a supervisor proposals UI +7.5 (never scoped before); PR-9a SOP dates/badge +3; PR-5 no tabs −2;
PR-1 UI moved out −1. **Staging dropped (S1): −1 h build** (PR-0 2.5 → 1.5 h: no `FIRESTORE_DATABASE_ID`, no
`cloudbuild.yaml` flag) **→ 87 h.** Dev-ops effort (not in the build total) falls from about 4 h (named DB, TTLs,
indexes, secrets, service, trigger, jobs, staging seed) to about 2 h (D0 trigger check, tags + verify at 5
promotions, 2 template re-seeds). QA shifts from per-PR staging runs to local runs plus 4 live checkpoint runs
(about the same QA hours, fewer environments).

**Honest fit before the Sat 17 Oct 12:00 freeze.** MUST (≈ 87 h) fits with 4-5 parallel worktrees from Wed PM to
Fri midday, **if** Rangga merges about 5 PRs a day Thu and Fri and QA keeps pace. Of the SHOULD list, realistically
only **PR-12b** (owner W8) and **PR-8** (owner home) fit on Fri; **PR-9b SOP book, PR-10 devices, D3, the sweep and
PR-11 most likely do not**. Cut-first order (now that pilot items are out): (1) PR-11 restyle; (2) PR-9b book/table
(keep PR-9a dates + badge); (3) PR-10 devices (placeholder page stays); (4) D3 fast lane (Scheduler `*/1` stays);
(5) sandbox sweep; (6) PR-8 W4 home (existing Home stays); (7) PR-12b W8 approvals (existing screen + guide card).
Never cut: every MUST row, Task R, both E2E rounds.

**File ownership (no two open PRs edit the same file):**
- PR-0 alone: `lib/firestore/schema.ts`, `lib/demo/constants.ts`, `lib/demo/contract.ts`, `lib/capture/contract.ts`
  (schema only), `lib/i18n/dict.ts` (the one-time spread).
- Each later PR adds copy only in its own `lib/i18n/v2/<slice>.ts`.
- PR-1: `lib/proposals/**`, `lib/debrief/rank.ts`, `lib/firestore/proposal-store.ts`, `app/api/v1/proposals/**`,
  `scripts/demo-seed-template.ts` (no `app/` files).
- PR-0b: `app/ui/**`, `app/globals.css` (new); no screen file.
- PR-12a: `app/proposals/**` (supervisor side; new `WatchPanel`, `GeneratingState`, `ProposalDetail`,
  `FeasibleHandover`), `app/day/ThreadActions.tsx` + new `ChangeLabelDialog.tsx`. PR-12b (after 12a): new
  `app/proposals/ApprovalsReview.tsx` + the owner branch of `ProposalsApp.tsx`.
- PR-9a then PR-9b: `app/sop/**`, `lib/sop/chapters.ts`. PR-8: `app/home/**`, `lib/home/**`, `app/api/v1/home/**`.
- PR-6 changes only the top-bar line of each `*App.tsx`; PR-12a, PR-9a and PR-8 start from develop **after PR-6
  merges** (or rebase onto it before review) so that line never conflicts.
- PR-2: `lib/demo/next-day.ts`, `lib/demo/clone.ts` (only the `shiftDeep` opts param), `lib/firestore/demo-store.ts`
  (new methods), `app/api/v1/demo/next-day/**`, `app/api/v1/capture/config/route.ts`, `lib/capture/contract.ts`
  projection function.
- PR-3: `lib/debrief/{flow,service,constants}.ts`, `lib/firestore/debrief-store.ts`, `app/capture/debrief/**`,
  `app/api/v1/questions/route.ts`, `app/api/v1/demo/process-now/**`; in `app/capture/page.tsx` **only** the
  `DebriefFlow` props line.
- PR-4a: `lib/capture/session-service.ts` (sandbox end/discard 409s), `lib/capture/browser/{engine,session}.ts` (the
  event), `app/api/v1/demo/closing/**`, `app/capture/page.tsx` (End, Start).
- PR-4b (after 4a): `lib/firestore/stores.ts` (`findOpenForDevice`), `app/shop/ShopTopBar.tsx` (sandbox-only sign-out),
  `app/capture/SignOutDialog.tsx`, `app/capture/OpenSessionView.tsx`, `app/capture/page.tsx` (sign-out + open-session
  lines), capture config route (`open_session`); sweep commits: `lib/demo/sandbox-sweep.ts`,
  `app/api/internal/pipeline/tick/route.ts` (one DEMO_MODE-gated call). PR-2 also edits the capture config
  projection: PR-4b merges first, PR-2 rebases.
- PR-5: `lib/demo/{guide,script}.ts`, `app/demo/{JudgeGuide,DemoBar}.tsx`, `app/layout.tsx`, `app/capture/ScriptDrawer*`
  (delete), `app/api/v1/demo/progress/**`, `app/capture/page.tsx` (drawer mount lines only).
- PR-6: `app/page.tsx`, `app/sign-in/**`, `app/pair/**`, `app/demo/DemoAccess.tsx`, `app/web/**`, each `*App.tsx`
  top-bar line, empty-state components, `app/devices/page.tsx` placeholder.
- PR-7: `lib/demo/service.ts` (reset fn), `lib/demo/clone.ts` (expires param — merge after PR-2), `app/api/v1/demo/reset/**`,
  `app/demo/ResetDemoButton.tsx`, one line in `lib/demo/guide.ts` (after PR-5).
- **Merge order** (each rebased on develop first): PR-0 → PR-0b → PR-1 → PR-R → PR-4a → PR-4b → PR-3 → PR-2 → PR-6 →
  PR-5 → PR-7 → PR-9a → PR-12a → (SHOULD) PR-12b → PR-8 → PR-9b → PR-10 → PR-11.

### 11a. Page-2 board → PR map (design source of truth, V2)

`-open` / `o` boards are the same screen with the judge guide opened: the screen belongs to the PR in the row, the
guide card content to PR-5. `L2-*` are the laptop layouts of the `P2-*` staff screens (same PR; both widths tested).

| Boards | Screen | PR |
|---|---|---|
| P2-01-Entry, P2-01o-EntryGuide, D2-01-Entry, D2-01-Entry-open | Entry (W1 landing) | PR-6 (+PR-5 card) |
| P2-02-Pair, P2-02o-PairGuide, L2-01-Pair, L2-01-Pair-open | Set up this device | PR-6 (+PR-5 "Fill in 000000") |
| P2-03-SetupDone, L2-01b-SetupDone | Device set up | PR-6 |
| P2-04-Ready, P2-04o-ReadyGuide, L2-02-Ready, L2-02-Ready-open | Start-ready, "Day n of 3" | PR-4a (+PR-5) |
| P2-05-Listening, P2-05b-Day2, P2-05c-Day3, P2-05o-ListeningCard, L2-03-Listening, L2-03-Listening-open, L2-03b-Day2, L2-03c-Day3 | Listening, End disabled, active script card | PR-4a (screen) + PR-5 (card) |
| P2-05d-AllSpoken, L2-03a-AllSpoken, L2-03a-AllSpoken-open | All spoken → Jump to closing | PR-5 (+PR-4a closing route) |
| P2-06-Closing, L2-04-Closing | Closing reached, End today | PR-4a |
| P2-07a-SignOutRunning, P2-07b-SignOutClosed, L2-06a-SignOutRunning, L2-06b-SignOutClosed | Demo sign-out dialogs | PR-4b |
| P2-07c-OpenSession, L2-06c-OpenSession | Session still open | PR-4b |
| P2-08-Preparing, L2-07-Preparing | Preparing your questions | PR-3 |
| P2-09-Question, L2-08-Question | Debrief question | PR-3 |
| P2-10-Complete, P2-10o-CompleteGuide, P2-10b-TimedOut, L2-09-Complete, L2-09-Complete-open, L2-09b-TimedOut | Debrief complete / timed out (+ Jump to tomorrow card) | PR-3 (+PR-5, PR-2 action) |
| D2-02-DayRecord, D2-02-DayRecord-open | Day record (nav, empty state; card restyle) | PR-6 (+PR-11 restyle) |
| D2-02b-ChangeLabel | Change-label dialog | PR-12a |
| D2-03-Proposals, D2-03-Proposals-open, D2-03a-ProposalsReady, D2-03b-ProposalsEmpty, D2-03b-ProposalsEmpty-open | Proposals + watch panel | PR-12a (data PR-1) |
| D2-03d-Generating, D2-03e-ProposalDetail, D2-03f-RejectReason, D2-03g-Feasible | Asking Bee6, detail, reject, hand-over | PR-12a |
| D2-04-SOP, D2-04a-SOPv1, D2-04b-OwnerSOP | SOP versions by date, improved badge | PR-9a (book layout PR-9b) |
| D2-04c-SOPTable | SOP table view | PR-9b |
| D2-05-Devices, D2-05a-DevicesBefore | Connected devices | PR-10 (placeholder PR-6) |
| D2-06-ReviewsEmpty | Reviews empty | PR-6 |
| D2-07-OwnerHome, D2-07-OwnerHome-open, D2-07c-OwnerHomeAfter | Owner home W4 | PR-8 (reset notice PR-7) |
| D2-07b-ResetConfirm | Reset confirm | PR-7 |
| D2-08-Approvals, D2-08-Approvals-open, D2-08c-RejectReason, D2-08d-AfterApprove, D2-08e-AllDecided | Approvals W8 | PR-12b |

Board dates and times (Mon 12 - Wed 14 Oct, "21:00", v2 from Thu 15, review Tue 20) are illustrative. Screens render
real business dates; the review date is the stored `review_date` (7-28 days after the effective date, plain code), so
no copy may hard-code "five days later".

**Gate per PR (no staging, S2):**
1. Pre-push hook green (lint, build, vitest) + `npm run typecheck`.
2. Tech-lead review PASS.
3. **Local QA** (zero tolerance): unit + component tests; Playwright browser tests against `next build && next start`
   (or `next dev`) with the API mocked at the route level (`page.route`) for pipeline-dependent states (preparing,
   questions, proposals), and against the demo project's real services through `.env.local` (`DEMO_MODE=true`,
   `GOOGLE_CLOUD_PROJECT=bee6-playground`, ADC) for non-pipeline flows (entry, pair with 000000, Start, cards with the
   fake-mic WAVs, End, sign-out, next-day shift, reset). Local runs write only sandbox docs (they expire in 2 h).
4. Rangga merges into `develop`.
5. At the next promotion checkpoint the PR is verified **live** (§12, §14); any live defect = a fix PR before the next
   promotion. A PR whose live check failed is never promoted twice without its fix.

---

## 12. Deploy, promotion checkpoints and dev-ops (bee6-playground ONLY; every step needs Rangga's go)

No staging (S1). Dev-ops echoes `--project=bee6-playground` on every command. The pilot project is never touched.

**Before the first promotion (one-time):**
- **D0 Pilot trigger check (go needed):** confirm no Cloud Build trigger in the pilot project deploys from `main`; if
  one does, pause it until after 18 Oct (the shared rules of §1 must not reach the pilot by accident).
- **D1 New composite indexes for the demo path:** **none required for MUST.** Every new MUST query uses equality
  filters only (`findOpenForDevice`; `listOpenProposals` = `outlet_id ==` + `status in`; segments by `outlet_id`,
  `device_id`, `session_id`; next-day per-collection `outlet_id ==`), which Firestore serves from single-field indexes.
  Only if the SHOULD sandbox sweep ships: `gcloud firestore indexes composite create --collection-group=capture_sessions
  --field-config=field-path=ended_at_ms,order=ascending --field-config=field-path=auto_stop_at_ms,order=ascending
  --project=bee6-playground`. Safety: QA checks Cloud Logging after each promotion for `FAILED_PRECONDITION`
  (missing index); the error carries the exact create link.
- **D2 Scheduler (SHOULD, go needed):** demo `pipeline-tick` from `*/2` to `*/1`.
- **D3 Open infra items from `docs/HANDOFF.md`** that the live demo needs, if still open: `DEMO_IP_SALT` secret,
  Token Creator role on the Cloud Run SA, TTL on `demo_counters.expires_at`. No new secret is needed by R-19.

**Every promotion (develop → main):**
1. Dev-ops records the serving revision and tags it: `gcloud run services describe web --region=asia-southeast2
   --project=bee6-playground --format='value(status.traffic)'`, then `gcloud run services update-traffic web
   --region=asia-southeast2 --project=bee6-playground --update-tags=good-<MMDD-HHMM>=<revision>` (today's known-good:
   `web-00015-9tt`).
2. Rangga approves and merges the develop → main PR; Cloud Build deploys `web`.
3. Dev-ops verifies the new revision is serving and healthy (`/api/health`, no startup errors in Cloud Logging).
4. QA runs the checkpoint's live checks (below). On a blocker: **rollback in one command**
   `gcloud run services update-traffic web --region=asia-southeast2 --project=bee6-playground --to-revisions=<good revision>=100`,
   then a fix PR. Rollback does not revert Firestore data; that is safe because every schema change is additive and
   optional (§2.1) and old code ignores the new fields.

**Template wipe + re-seed (go needed each time):** delete all `demo-tpl-outlet` docs (dev-ops), `npm run seed --
--project demo --template` (fresh pairing code), `npm run demo:seed-template -- --base-url https://web-33uzb53tza-et.a.run.app
--code <code> --clips-dir private/demo-clips-v2`, wait for the tick, then `--check-only` must print `CLEAN`.
Needed at P1 (the current template carries problem-A evidence and the old readiness check) and again before the freeze.

**Promotion checkpoints:**

| Checkpoint | When (WIB) | Contains | Live checks (QA) |
|---|---|---|---|
| **P1** | Thu 15, 19:00 | PR-0, PR-0b, PR-1, PR-R, PR-4a, PR-4b, PR-3, PR-2 | template re-seed + CLEAN; staff day 1-3 with the fake-mic WAVs (cards, closing, End, preparing, debrief Yes does not end it, next day, `proposal_exists` refusal); Task R audio pass (§10.2); generate A then another → B via the existing proposals screen |
| **P2** | Fri 16, 14:30 | PR-6, PR-5, PR-7, PR-9a, PR-12a (+ P1 fixes) | **E2E round 1** at 15:00: the full §14 journey |
| **P3** | Fri 16, 22:00 | SHOULD merges (PR-12b, PR-8, …) + round-1 fixes | the screens added; regression of steps 1-12 |
| **P4** | Sat 17, 08:00 | fixes only | template re-seed + CLEAN at 08:30; **E2E round 2** at 09:00 (once with a human reading into a real phone) |
| **Freeze** | Sat 17, 12:00 | blocker fixes from round 2 only (else nothing) | smoke; 15:00 final journey on the demo URL; 18:00 go/no-go |

Nobody outside Rangga uses the live demo before the 18 Oct submission, so breakage between checkpoints is accepted.

---

## 13. Calendar (WIB). Submission Sun 18 Oct. **Code freeze Sat 17 Oct 12:00.**

| When | Build (parallel worktrees) | Review / QA / merge | Rangga / Tiffany / dev-ops |
|---|---|---|---|
| **Wed 14** AM | — | PM brainstorm (edge cases only) | Rangga's go on plan v4; gos D0, D3 |
| Wed 14 PM | PR-0 (1.5 h) and PR-0b tokens (3 h) in parallel; then PR-1, PR-2, PR-3, PR-4a start off develop+PR-0; PR-R | PR-0 → merge by 16:00, PR-0b by 20:00 | — |
| **Thu 15** | PR-1..3, PR-4a finish AM; PR-4b, PR-5, PR-6, PR-7, PR-9a start; PR-12a after PR-1 + PR-6 merge (~15:00); Task R text rehearsal + rewrite rounds (by 18:00) | Local QA and merges of PR-1, PR-R, PR-4a, PR-4b, PR-3, PR-2, PR-6 | **P1 promotion 19:00**; template wipe + re-seed (go); live P1 checks + audio rehearsal 19:30-22:00 |
| **Fri 16** | P1 fixes first; PR-5, PR-7, PR-9a, PR-12a finish by 11:00; SHOULD from 11:00: PR-12b, PR-8 (then PR-9b, PR-10, D3, sweep only if hands are free); PR-11 16:00-20:00 **only if** round 1 has zero blockers | Merges by 14:00; **P2 promotion 14:30; E2E round 1 live 15:00**; SHOULD merges by 21:30 | **P3 promotion 22:00** (go) |
| **Sat 17** | Fixes only | **P4 promotion 08:00**, re-seed 08:30, **E2E round 2 09:00**; **12:00 freeze** (last promotion only for round-2 blockers) | 15:00 final live journey; 18:00 go/no-go |
| **Sun 18** | No code | — | Submission; rollback = the tagged good revision |

**MUST:** PR-0, PR-0b, PR-1, PR-2, PR-3 (without D3), PR-4a, PR-4b (without the sweep), PR-5, PR-6, PR-7, PR-9a,
PR-12a, PR-R + Task R, docs, the promotions P1-P4 with tagging and the two template re-seeds, E2E rounds 1-2 and the final live run.
**PROMOTED TO MUST (Rangga, 15 Oct 10:50): the owner screens.** PR-12b owner W8 approvals (7 h), PR-8 owner W4 home (6 h), PR-9b SOP book/table (5 h) = 18 h build, about 23 h with fix rounds, in 3 parallel worktrees (PR-12b starts off PR-12a's branch). We are ahead of the calendar (PR-9a and PR-12a were due Fri 11:00). Priority if time runs out: PR-12b first (owner approve-one/reject-one is part of the judge story), then PR-8, then PR-9b. PR-10 and PR-11 stay SHOULD / cut-if-late.
**SHOULD (in build order):** PR-10 connected
devices, D3 fast lane, sandbox sweep, Scheduler `*/1` on demo.
**CUT-IF-LATE:** PR-11 restyle of untouched screens; W1 landing preview images (cards without images).
**Cut already:** "Jump to opening time" / before-opening stage and the simulated hh:mm clock (Q6); nav count badges;
QR and unpair on devices; Add/Download/Sheets on SOP; all pilot-only work (§18).

**Drop order if time runs out:** see §11 "Honest fit" (PR-11 → PR-9b → PR-10 → D3 → sweep → PR-8 → PR-12b). Never
dropped: every MUST row, Task R, E2E.

---

## 14. Test plan

**Unit (per PR, listed in each section).** The pre-push hook runs everything; every existing test stays green
unmodified except where this plan changes behaviour on purpose (precheck any-mix case, rank order, CARRY_OVER clone
test, DEMO_SESSION_MAX_MS literal, ScriptDrawer removal).

**Live E2E script (QA on https://web-33uzb53tza-et.a.run.app after P2, real browser; phone = Chrome device emulation 360x780 with fake mic from `private/rehearsal/`, laptop = 1280 px).
Time each step; target ≤ 20 min total.**
1. `/` → three role cards, Staff "START HERE". Pick Staff → `/pair` → `000000` → `/capture`. Guide stage 1 of 5.
2. Start offered ("Day 1 of 3 · date"). Tap Start. One card shown; "I have spoken this" disabled until Bee6 hears
   it; play card 1..5 clips, tap after each; next card replaces it. Guide card: "Locked until all 5 cards are spoken
   (k of 5 done)." until card 5; then Jump to closing time → End (always visible, was disabled "End · available at
   closing time (HH:MM)") enables.
3. Before Jump to closing: Sign out → "cancel today?" dialog (verify copy) → Keep listening.
4. End → Preparing (≤ 3 min with `*/1`; ≤ 1 min with D3) → questions (≤ 5) → answer Yes to the first: the debrief
   does **not** end. Finish all → Debrief complete; no "Answer questions" button; Start hidden with "Start unlocks
   tomorrow…"; reload → still complete.
5. Sign out → Supervisor (laptop, same browser profile) → Day record shows day 1 notes (egg-tart question under
   Customer service); Proposals: watch row "Customer service · seen on 1 of 2 days" and "No proposal yet"; Ask →
   suppressed "not enough evidence"; nav has 5 items; Reviews/SOP/Devices pages render (empty states).
6. Sign out → Staff → re-pair `000000` → same sandbox, day 1 done. Jump to tomorrow → day 2 → Start offered.
   Day 2 cards; Jump to closing; Sign out → "cannot cancel" dialog → **Sign out anyway** → entry page. Re-pair
   `000000` → "Today's session is still open. Tap End to start the debrief." → End today → debrief includes "a phone
   call" → Yes + reason. Done. (Variant run, only if the SHOULD sweep shipped: sign out anyway and wait 11 min → the sweep closes it as auto_stop;
   re-pair shows the debrief, Start locked.)
7. Jump to tomorrow with one question unanswered (variant run) → confirm dialog → Jump anyway → day 3.
8. Day 3 → End → debrief phone call Yes. Jump to tomorrow → refused `max_days` copy.
9. Supervisor: watch shows Customer service ready and Phone call ready; Ask → proposal A (focus CUSTOMER_SERVICE);
   Ask for another → proposal B (PHONE_CALL); both listed, neither superseded. Mark both Feasible.
10. Staff phone (variant): Jump to tomorrow now refused with the `proposal_exists` copy.
11. Owner → Home tiles (days listened 3+2 template, waiting approval 2, cost coming soon) → Approvals → approve A →
    SOP v2 with "Improved in v2" chip on the target step → approve B refused SOP_CHANGED → reject B with a reason →
    constraint recorded.
12. Owner → Reset this demo → confirm → Home "Demo reset to day 1" → Staff re-pair → day 1, Start offered, no
    proposals, SOP v1.
13. Pilot regression (pilot URL, read-only checks, no real data touched; plus unit tests for the shared rules):
    no sign-out control on a pilot phone; no guide; capture config has no `demo_session`; `/` redirects to `/sign-in`; `/capture` on
    a pilot device shows no guide, Start button behaviour unchanged; debrief pilot flow unchanged (unit-level).
14. Every screen at 360 px: no horizontal scroll; drawer usable; axe: no serious violations.
15. Logs (Cloud Logging, demo project): no line text, no audio, no device id in any supervisor/owner response.

---

## 15. Questions for Rangga: none open (14 Oct). Q1-Q8, W1-W10 and V1-V10 are recorded in §1

1. Sign-out after closing → **leave the session open** (no auto End); return view + 10-min sweep (§5.7a/b). *Changed from the default.*
2. ROUTINE_OPS → **yes**: floor + proposal gate + debrief ranking; evidence gate unchanged.
3. Per-category floor on the pilot → **yes**.
4. Escape hatch → **10-minute hard stop**, no "I'm stuck" skip.
5. Template → **2 routine days, 6 clips**.
6. Before-opening stage + simulated clock → **cut**; "Day n of 3 · date"; Pair goes straight to Start-ready.
7. Devices code generation on the pilot → **yes** (security review).
8. Debrief reason → **stays required**.

No open questions remain for the build (v4). New items, if any, go to tech-lead first.

---

## 16. What could go wrong on demo day (and the mitigation already in the plan)

1. **The label model drifts on a judge's improvisation** (A lands as STAFF_CONSULT/COMPLAINT) → Task R thresholds;
   supervisor relabel is in the guide; debrief Yes covers question threads.
2. **Preparing takes 3-4 min per day** (tick cadence + 90 s silence) → Scheduler `*/1`; D3 fast lane; the guide
   suggests looking at the supervisor screens while waiting after day 1.
3. **Many judges at once** queue in the sequential tick → `*/1`; D3 is per-device; caps unchanged otherwise.
4. **Mic blocked / tab backgrounded / phone screen off** → "Not picking up your voice?" help; 10-min hard stop ends the
   day honestly.
5. **Judge switches from phone to laptop** → a new sandbox (no cross-device join; R-18 known gap). The entry page and
   guide say "use one browser for the whole demo".
6. **Crossing 01:00 WIB mid-journey** (US-morning judges) moves the business date by itself; days stay distinct, Start
   still opens; `days_done` may read one day off for a few minutes. Accepted; listed in the README known gaps.
7. **A shift crashes half-way** → marker → `shift_incomplete` copy → owner reset.
8. **Judge asks for proposals after day 2** → one proposal only; Jump to tomorrow then refused (`proposal_exists`);
   the guide warns before Ask (D2-03a); the owner can still approve the one; reset to try again.
9. **Approve both** → second refused SOP_CHANGED (kept on purpose); the approvals page says "Approve one and reject
   the other".
10. **Sandbox expires (2 h) mid-journey** → existing expiry notice; journey takes ~20 min.
11. **Quota/caps hit** (generate 8, segments 150, model daily) → existing demo cap copy; caps sized for 3 days + one reset.
12. **Template not re-seeded on the default DB after release, or seeded with evidence** → release checklist step +
    inverted `--check-only` must print CLEAN before go.
13. **A promotion breaks the live demo** → the revision tagged before it is one command away (§12); schema changes
    are additive; the freeze is 12:00 Sat so the last promotion has 6 h of live checks behind it.
14. **Stale answer-cache entries after a reset** (the phone still holds answers to deleted questions) → the uploader
    must drop an entry on 404; QA verifies after reset (E2E step 12); if it retries forever, fix in PR-7.
15. **Judge signs out after closing and does not come back** → the server session stays open (Q1) until the judge
    returns (§5.7a "Tap End") or the sandbox expires at 2 h; no one is harmed. If the SHOULD sandbox sweep ships (with
    its demo-DB index, §12 D1), it closes the session at the 10-min hard stop so the debrief starts on time.
16. **Judge signs out after closing while segments are still uploading** → up to 15 s drain, the rest dropped; the
    line floor was already met at Jump to closing, so evidence is unaffected.
17. **A shared rule surprises the pilot** (per-category floor is stricter; routine work never counts) → called out
    in the PR bodies and the spec update; the pilot's supervisor sees "waiting for evidence" longer. Accepted (Q2, Q3).
---

## 17. Hard-rule checklist

| Rule | How this plan meets it |
|---|---|
| #1 Google only | No new SDK; Task R uses the existing Vertex label client |
| #2 No audio stored | No audio touched by any new route; segment response stays a count; fake-mic files stay private, off the repo |
| #3 Redact before storing | No new stored free text except the existing answer/reason paths |
| #4 Paid project only | Task R, local QA and the live demo run in bee6-playground with the service account |
| #5 Regions | Service and data in asia-southeast2 (unchanged); models via `config/regions.yaml` |
| #6 No browser Firestore | Every new screen goes through new API routes with role + outlet checks |
| #7 People data | Devices API (SHOULD) returns no ids; no names anywhere; answers stay device-id only; audit actor = role |
| #8 Public repo | Script and template text are fictional; clips stay in a git-ignored folder |
| #9 SOP only via proposals | Reset re-clones v1 (a copy, not an edit); no SOP write route added |
| #10 Gate is plain code | Floor per category, exclusion, focus choice, watch, guards and the unlock rule are plain code; the shift moves time only; `problem`/`expect` fields are never read by server code |
| #11 Small commits | 13 PRs, small commits per task |

## 18. Post-submission / pilot (OUT of MUST, V1; not built before 18 Oct)

**Hold-back rule:** nothing in a demo PR may import, call or require anything in this section. The demo sweep
(§5.7b, SHOULD) is sandbox-filtered, `DEMO_MODE`-gated and needs only the demo-database index; the pilot gets no new
index, route or sweep in this release.

Kept here so the design is not lost (it was fully specified in plan v3):
1. **Pilot staff sign-out = unpair the phone.** Sign-out in `ShopTopBar` on a real shop phone; strong confirm (title
   "Sign out and unpair this phone?", body "This phone will stop being the shop's listening phone. To use it again you
   need a new 6-digit code from your supervisor (Connected devices).", a state line for before/after closing, required
   checkbox "I understand this phone needs a new code", safe button focused). Before closing: discard then unpair.
   After closing: the day stays open, unpair only. Uploads drain before the unpair call.
2. **`POST /api/v1/devices/unpair`** (device auth; clears `token_hash`, `paired_at`, `pairing_code*`; keeps
   `last_ended`, label; audit `device.unpaired` with `actor_role: "device"`; 404 on a sandbox). Security review.
3. **All-outlet session sweep**: as §5.7b but for every outlet with `SWEEP_GRACE_MS = 5 min` after `auto_stop_at_ms`
   (implements tech spec §8.3 for a phone that is gone), plus the composite index on the pilot project (Rangga's go).
4. **Pilot re-pair path**: PR-10's code generation re-uses the unpaired device doc (its `last_ended` and cached answer
   ids carry over). Ship 1-3 only together with PR-10.
5. **`open_session` for the pilot** (config key at top level, return view), reconciled with the pilot's existing
   Lanjutkan/`lost` recovery (tech spec §8.7).
6. Pilot copy (EN + ID) for all of the above, reviewed by Tiffany; QA on a non-sandbox outlet in the demo project (the v3 E2E step
   13a); demo-day risks "staff unpairs by mistake" and "sweep races the phone".
Estimate when picked up: about 10 h build + security review + QA.

## Result

*(Filled in after the build.)*

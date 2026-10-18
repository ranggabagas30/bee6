# UI-test states on staging (17 Oct): seeded fictional sandboxes for QA

Purpose: reach every data-dependent board on `web-develop` (https://web-develop-33uzb53tza-et.a.run.app, database `staging`) without the pipeline tick (`pipeline-tick-staging` stays PAUSED) and without driving the long staff journey.

Code: `scripts/seed-ui-states.ts` (+ test) on branch `feature/uitest-seed` (worktree `../bee6-uitest-seed`, off origin/develop `eac54ff`; not pushed). Command: `npm run seed:ui-states`.

## 1. What it does

It writes one fixed demo SANDBOX per scenario (`sbx-uitest<name>`), cloned from the demo template exactly like `POST /api/v1/demo/session` does, then adds curated FICTIONAL data: threads (already-redacted style text, no names), debrief questions, staff answers (device id only), proposals A and B, constraints, a shipped SOP v2 and a due review. The SOP v2, the proposal decisions and the review are produced by the app's own planners (`planShip`, `buildDecisionWrite`, `buildReview`), so every doc passes the real schemas, and the real services (day record, proposals list, SOP overview, reviews, owner home) were run against the seeded data on staging (all parse and show the content below).

Why sandboxes and not `demo-outlet`: the seeded `demo-owner@example.com` / `demo-supervisor@example.com` passwords (10 Oct) are unknown, and no password or account may be created. The demo sign-in ("Fill in" with the public demo credentials) opens a sandbox; a stored sandbox key makes that same sign-in open THIS pre-filled sandbox instead of a new one. Each sandbox lives 12 h by default (`--ttl-hours`, max 48; a normal sandbox lives 2 h).

Guards: refuses unless `GOOGLE_CLOUD_PROJECT=bee6-playground`, `FIRESTORE_DATABASE_ID=staging`, `DEMO_MODE=true` (and refuses the pilot project id); prints the verified target on every run; writes only outlets named `sbx-uitest*`; never touches `(default)`, the template, `demo-outlet`, Cloud Run, Scheduler, Firebase Auth or any password; no model call, no audio.

## 2. Run it (re-creates the named sandboxes; safe to repeat)

```
cd "<LOCAL_PATH>/bee6-uitest-seed"
export FIRESTORE_DATABASE_ID=staging GOOGLE_CLOUD_PROJECT=bee6-playground DEMO_MODE=true
echo "$GOOGLE_CLOUD_PROJECT / $FIRESTORE_DATABASE_ID"            # must print bee6-playground / staging
npm run seed:ui-states -- --scenario all                          # or one scenario
npm run seed:ui-states -- --scenario owner --key <43-char key>    # re-seed one scenario and KEEP its key (browser keeps working)
npm run seed:ui-states -- --scenario timeout --debrief-minutes 5 # fresh short debrief window
npm run seed:ui-states -- --scenario all --delete                 # remove only the sbx-uitest* sandboxes
```

Each run prints, per scenario, the sandbox id, the key and three console one-liners (owner / supervisor / staff).

## 3. Scenarios

| scenario | outlet id | what is in it |
|---|---|---|
| `debrief` | `sbx-uitestdebrief` | Filled history on yesterday (Y1) and the day before (Y2); three evidence-ready categories (Customer service, Phone call, Staff consult; 2 facts on 2 days each) so the Ask works; no proposals; TODAY: an ended session and an OPEN debrief with 5 open questions on the phone (window closes about 55 min after seeding). |
| `timeout` | `sbx-uitesttimeout` | Same as `debrief`, but the debrief window closes 6 min after seeding (use `--debrief-minutes`). |
| `proposals-one` | `sbx-uitestproposal1` | History + ONE proposal ("Write the bake time on every tray label", step "Display check") waiting for the supervisor. |
| `proposals` | `sbx-uitestproposals` | History + TWO proposals waiting for the supervisor (A above, B "Read every phone order back before hanging up", step "Serve a customer"). |
| `owner` | `sbx-uitestowner` | Both proposals already marked feasible by the supervisor (waiting for the owner); SOP still v1. |
| `decided` | `sbx-uitestdecided` | A approved by the owner and shipped as SOP v2 (starts tomorrow, review in 7 days); B rejected by the owner with a reason (it became a rule). |
| `review-due` | `sbx-uitestreviewdue` | Same decisions, approved 9 days ago: SOP v2 is in force since 9 Oct, its review date has arrived and the review waits for the supervisor. |

Every scenario except `debrief` / `timeout` also has five fact notes for TODAY (owner Home "Today in five lines").
Dates are relative to the seeding day: Y1 = yesterday, Y2 = the day before (on 17 Oct: Fri 16 Oct, Thu 15 Oct). Yesterday's day record holds 11 notes: auto-labelled facts, a COMPLAINT that "Needs your check" (staff said yes), a staff-confirmed phone call, an Unverified note, a note the staff rejected ("No"), plus four staff debrief answers.

## 4. Open a sandbox in a browser (once per role switch)

1. New tab (a clean profile or a private window is best, one sandbox per browser profile) at the base URL. Open DevTools > Console.
2. Paste the one-liner for the sandbox and role from the run output (it writes `localStorage["bee6.demo"]`, the key the demo sign-in reuses, and goes to `/sign-in`).
3. Owner or Supervisor: on `/sign-in?as=owner` (or `supervisor`) tap "Fill in" and then sign in; the demo credentials are the published ones and the page prints them. The app switches INTO the seeded sandbox (it does not create a new one) and lands on `/home` (owner) or `/day` (supervisor).
4. Staff: go to `/pair`, tap "Fill in 000000" (judge guide) and "Set up", then "Open the listening page" / `/capture`.
5. Switch role in the same sandbox with the yellow demo bar (or repeat steps 2-4). Do NOT use the Entry page "Try as ..." cards with no stored key: that would create a new, empty sandbox.

The page under the sign-in box says the demo is "continuing" when it found the stored sandbox. Quickest proof it is the seeded one: owner `/home` shows data (not "Nothing waiting"), or the phone `/capture` opens question 1 of 5 in `debrief`.

## 5. Board id -> how to reach it

Role = who must be signed in. Phone boards (P2-/L2-) are the staff `/capture`; desktop boards (D2-) are supervisor / owner.

| Board | Sandbox | Role | URL / action |
|---|---|---|---|
| D2-02 Day record (filled) + D2-02-open | `proposals` (any except `debrief`/`timeout`; those have today's open notes too) | supervisor | `/day/<yesterday>` (e.g. `/day/2026-10-16`; the landing `/day` is today, which is empty or only open notes). `-open` = open the judge guide panel. |
| D2-02b Change a label (dialog) | `proposals` | supervisor | `/day/<yesterday>` > on a note row tap "Change label" (best: the "Needs your check" COMPLAINT note or the egg-tart notes; all carry a runner-up). Cancel to keep the data. |
| D2-03a One ready | `proposals-one` | supervisor | `/proposals` |
| D2-03 Two items + D2-03-open | `proposals` | supervisor | `/proposals` (`-open` = watch panel / guide open) |
| D2-03d Asking Bee6 (loading) | `debrief` | supervisor | `/proposals` > "Ask Bee6 for a proposal". The Ask is REAL (Gemini on the staging project): the loading card shows for about 10-60 s, then a real proposal appears. Capped at 8 asks per sandbox. |
| D2-03e Proposal detail | `proposals` | supervisor | `/proposals` > open a card (button "Open" in the app, "Review" on the board) |
| D2-03f Reject with a reason (dialog) | `proposals` | supervisor | detail > "Reject..." (reason required). Cancel to keep it; confirming rejects it and writes a rule. |
| D2-03g Marked feasible | `proposals-one` | supervisor | detail > "Mark feasible" (one way: the proposal becomes "waiting for the owner"). Re-seed to repeat. |
| D2-04 SOP book v2 | `review-due` (v2 in force) or `decided` (v2 starts tomorrow) | supervisor | `/sop`; use the version switch if v1 is shown first |
| D2-04b Owner SOP | `review-due` / `decided` | owner | `/sop` |
| D2-06 Reviews (not empty, bonus) | `review-due` | supervisor or owner | `/reviews` shows the due review. In `decided` the demo fast-forward button is available instead. |
| D2-07 Owner home (waiting) + D2-07-open | `owner` | owner | `/home`: "Waiting for your approval . 2", five lines of today |
| D2-07b Reset the demo (confirm) | `owner` or `decided` | owner | `/home` > "Reset the demo" > dialog. TAP CANCEL: confirming re-clones the template and wipes the seeded data (re-seed restores it). |
| D2-07c Owner home (after) | `decided` | owner | `/home` ("Nothing waiting", progress 1 approved / 1 rejected, next review date) |
| D2-08 Approvals + D2-08-open | `owner` | owner | `/home` > "Review" on a waiting row, or `/proposals` |
| D2-08c Reject needs a reason | `owner` | owner | on the approval card leave the reason empty and tap "Reject with reason" |
| D2-08d After approving #1 (#2 blocked) | `owner` | owner | approve #1 ("Write the bake time on every tray label"), then open #2: "Approve . not available" + "The SOP changed after this was drafted..." (this ships SOP v2 for real; re-seed to repeat) |
| D2-08e All decided | `decided` | owner | `/proposals` shows "Both decided." directly. Or, in `owner`, approve #1 and reject #2 with a reason. |
| P2-09 Debrief question / L2-08 | `debrief` | staff | `/capture` (360 px phone, 1280 px laptop): the debrief opens by itself with question 1 of 5 (categories in order: Customer service, Phone call, Complaint, Staff consult, Routine). Answer needs Yes/No plus a short reason (no names, no digits). |
| P2-10 Debrief complete (answered) / L2-09, -open | `debrief` | staff | answer or skip all 5 questions; the guide card then offers "Jump to tomorrow" (it is allowed here) |
| P2-10b Debrief timed out / L2-09b | `timeout` | staff | Seed it fresh right before the check (`--scenario timeout --debrief-minutes 5`, keep the same `--key`), open `/capture` as staff within the window, leave question 1 unanswered and wait: at the window's end the question screen turns into the timed-out screen (board title "Debrief closed"; the app's title may still read "Debrief complete", UI-072). Opening `/capture` AFTER the window does not show the timeout board (the debrief no longer auto-opens). |

Judge-guide "Jump to ..." controls: "Jump to tomorrow" works in `debrief` once the debrief is done (it moves that sandbox to day 2: re-seed to go back). "Jump to closing time" is NOT usable as a shortcut: the server refuses it until the open session holds enough transcribed speech (`not_enough_speech`), so closing boards (P2-06 / L2-04) still need the five spoken cards.

## 6. Not made reachable, and why

- P2-08 Preparing: needs transcribed lines still waiting for the tick; the seed has none pending, so the debrief goes straight to the questions.
- P2-06 / L2-04 Closing, P2-05* Listening, P2-07a/b/c sign-out and open-session boards: they need a running session (microphone or enough speech); they were already audited live and are unchanged by this seed.
- D2-05 / D2-05a Devices: the screen is a placeholder in the app (UI-056), nothing to seed.
- Rate limits still apply: 30 sandbox creates per IP per day and 8 Asks per sandbox; the seed itself creates no demo counter rows. A role switch counts against the per-IP switch cap (60 a day).
- The demo bar says "Ends at" the seeded expiry (12 h); a re-seed with the same `--key` extends it.

## 7. Notes for the tech-lead

- `lib/sop/write-boundary.test.ts` (hard rule 9 guard) lists `scripts/seed-ui-states.ts` in its allowlist because the `decided` / `review-due` scenarios write an SOP v2 doc into `sbx-uitest*` sandboxes (built by `planShip`). It is marked PENDING tech-lead sign-off in the test file. The script is staging-only, refuses non-sandbox outlets (demo-store `writeSandbox`) and is not reachable from the app.
- Dev-mode support: considered; this seed is the QA-facing equivalent. No `/capture` dev-mode change was needed.

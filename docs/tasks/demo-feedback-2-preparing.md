# Demo feedback 2 — "Preparing your questions" > 4 min on staging

Tech-lead diagnosis, 17 Oct (read-only; build e84a0a3 / `web-develop-00040-zbm`, project `bee6-playground`).

## Verdict

**(a) Stuck waiting on the paused staging tick. Not a product bug; no code fix required.** The screen was
processing nothing because nothing on staging can label lines while `pipeline-tick-staging` is PAUSED. The same
path on `web` (tick ENABLED, `*/2 * * * *`) clears in 10 s – ~3 min.

## How "Preparing" is produced (code path)

- Server flag: `lib/debrief/preparing.ts:11-31` (`computePreparing`). `preparing = pending > 0 && now < ended_at + PREPARING_MAX_MS`,
  where `pending` = text lines of the device's latest ended session that **no finished label unit** covers
  (`listLabelledLineIds` reads the tick store's label units).
- `PREPARING_MAX_MS = 6 * 60_000` — `lib/demo/constants.ts:68`. After 6 min from End the flag goes `false` regardless.
- Only `GET /api/v1/questions` (device branch, sandbox only) computes it: `lib/debrief/service.ts:123-129`,
  `app/api/v1/questions/route.ts:40-47` (logs `debrief.preparing {pending, preparing}` counts only).
- Label units are produced **only** by `runTick`, whose sole caller is `POST /api/internal/pipeline/tick`
  (`app/api/internal/pipeline/tick/route.ts:42`), invoked by Cloud Scheduler. No Cloud Task, no inline
  labelling on End, and the R-19 "process-now fast lane" exists only as a contract/constant
  (`lib/demo/contract.ts:121-125`, `lib/demo/constants.ts:70-71`) — there is no `app/api/v1/demo/process-now` route.
  **So question generation on a sandbox depends 100 % on the Scheduler tick.**
- Client: `app/capture/debrief/DebriefFlow.tsx:259-273` polls `/api/v1/questions` every `REFRESH_POLL_MS_DEMO = 10_000`
  (`lib/debrief/constants.ts:43`) while the view is `preparing`/`waiting_more`, until `ends_at_ms`.
  `lib/debrief/flow.ts:166-200`: on a refresh with no new questions and `preparing:false` the view becomes
  `done` ("There are no questions today" / terminal). A failed or non-2xx poll keeps the current screen
  (`DebriefFlow.tsx:237, 242-244`) — the next 10 s tick is the retry.

## Live evidence (staging, read-only logs)

- Scheduler: `pipeline-tick-staging` **PAUSED**, `review-run-staging` PAUSED; prod `pipeline-tick` ENABLED, last
  attempt 10:18Z, 200, ~0.3 s.
- `web-develop` tick route: last successful tick 2026-10-17T01:36:00Z (200); only 401/405 hits since (someone
  curling it without OIDC — unrelated).
- Rangga's run: `POST /api/v1/demo/closing` 200 at 10:11:31Z → `debrief.preparing { pending: 6, preparing: true }`
  every 10 s from 10:11:49Z to 10:16:19Z (28 polls, `pending` never moved — nothing labelled). Polling stopped at
  ~4 min 48 s after End, i.e. the page was left before the 6-min cap (10:17:31Z) would have flipped the screen to
  "There are no questions today". Same pattern at 05:41Z (`pending: 5`).
- Prod `web`, last 3 days: every `preparing: true` run ends in `preparing: false`; run lengths are mostly 1–20 polls
  (10 s – ~3 min, i.e. one or two 2-min tick intervals plus labelling); one run reached 40 polls (~6.7 min, the cap).

## Answers

- **(a)** Yes: stuck on the paused tick. Expected on staging, not a defect in the screen. Poll never "hangs": it
  runs every 10 s and would have resolved at the 6-min cap or at the debrief's end.
- **(b)** No navigation/state bug found: the fetch loop, reducer transitions and the cap all behave as designed.
  Two UX gaps are real but by design: (1) there is **no timeout/error/retry affordance on the Preparing screen**
  (`DebriefPreparing.tsx` — no Back, no Check, disabled button; the only exit is the 6-min cap, which then shows
  "There are no questions today", a misleading terminal message when the pipeline was simply never run);
  (2) the 6-min cap is silent — the judge sees a spinner for up to 6 min with no countdown and no explanation.
- **(c)** Same code path on `web`. Real expected latency there: worst case ≈ 2-min tick interval + per-unit
  labelling (~seconds each; `DEFAULT_MAX_UNITS_PER_DEVICE = 20`, `lib/pipeline/tick/service.ts:44`) ≈ 2–4 min;
  observed typical 10 s – 3 min, hard cap 6 min. The demo copy ("2–4 min after End", `DebriefFlow.tsx:34`) matches.

## Fix proposal

- **Needs a code fix?** No for the reported symptom. For staging testing: resume `pipeline-tick-staging`
  (dev-ops, Scheduler mutation — not done here) whenever the debrief is being exercised; a paused tick will
  always reproduce this.
- **Quick win (optional, copy only, no behaviour change):** when the cap flips `preparing` to false with zero
  questions on a sandbox, the done screen reads "There are no questions today". Consider a distinct line for the
  cap case ("We could not prepare questions in time") — needs the server to expose `cap_hit` or the client to
  compare `Date.now()` to End + 6 min; small, sandbox-only.
- **Ultimate (behaviour change, defer unless judging day needs it):** implement the already-specified R-19 D3
  fast lane (`POST /api/v1/demo/process-now`, rate-limited by `PROCESS_NOW_MIN_INTERVAL_MS`/`PROCESS_NOW_PER_SANDBOX`)
  called from the sandbox End/closing flow so the judge's lines are labelled without waiting for the Scheduler.
  Removes the Scheduler dependency and most of the 2-min worst case. Risk: runs `runTick` inside a user
  request on the shared `web` service (lease contention with the Scheduler tick is already handled by
  `pipeline_locks`, but request latency and the per-IP demo cap must be respected); needs its own tech-lead plan.

## Risk

- Leaving the staging tick paused during further UI reviews will keep producing this "defect" and will also
  starve `waiting_more`/question screens; re-enable before any debrief QA run.
- Hard rules untouched by any option above; the fast-lane option must keep the OIDC-only tick route unchanged and
  add role/outlet (`sandbox: true`) checks on the new device route.

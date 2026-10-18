# R-23 — Retry budget, cap charging and loss visibility under a transcribe burst (QA load test L-1/L-2/L-3)

Status: PLAN (tech-lead, Fri 16 Oct ~03:30 WIB). Baseline: `origin/main` 4a93a9e (= R-22 PR-A/B/C merged).
Freeze: Sat 17 Oct 12:00 WIB. Demo project only (`bee6-playground`); the pilot shares the code but no pilot
deploy is in scope. Fix loop: branch per PR → tech-lead PASS → PM merges → QA re-runs the load harness.
Skills to name in the briefs: `tdd-workflow`, `error-handling` (PR-A/B/C), `react-patterns` + `ux-copy` (PR-D),
`code-review` for the gate.

## 0. The one-paragraph diagnosis (from `docs/tasks/QA-load-test-16oct.md`)

The shared `gemini-3.5-transcribe-preview` capacity on `global` served this project **~6–10 transcriptions/min**
during the bursts; 6 phones offer ~24/min at the start of a day. The system is throughput-bound: no retry policy
creates capacity, it only decides who waits and for how long, and whether a wait ends in a drop. Today the phone
gives a head segment 8 server-error attempts (≈ 88–100 s); every dropped segment in runs 3–4 was refused for
exactly that long, while the same bursts recovered other segments after up to 113 s. So the loss is an **artefact of
the attempt budget, not of capacity**: given ~4 minutes, a 6-phone burst (42 segments ÷ ~8/min ≈ 5 min, minus the
segments that go through at once) clears. The server's own 4 attempts recover only 6–12 % and make every 503 cost
~6 s instead of 0.3 s; each 503 also spends a demo cap charge; and after a drop the "not captured" line is replaced
by "Upload succeeded" on the next 2xx, so a judge can miss it.

## 1. Decisions (quick win vs ultimate, and the pick)

| # | Topic | Quick win | Ultimate | Pick and why |
|---|---|---|---|---|
| 1 | Phone head budget | `maxAttempts` 8 → 20 (one-line) | **Time-based budget: keep retrying the head until it has been refused for `HEAD_BUDGET_MS = 240 s`** (PR-A) | **Ultimate.** Attempts are a proxy that moves whenever the server latency or backoff changes (R-22 PR-A silently changed it from ~20 s to ~100 s). Time is what the capacity math is in. 240 s = 2 × the longest observed recovery (113 s) and still well inside the bounds that already exist: the 10-min queue cap (prune), the demo session hard stop (20 min), and End (`stop()` → `engine.abort()`, drain ≤ 5 s / 15 s). Backoff stays 500 ms · ×2 · **cap 30 s**, jittered [raw/2, raw]: a slot frees every ~6–10 s project-wide, and 6 phones polling every 15–30 s offer ~0.3 attempts/s in total, which matches the serve rate; a lower cap only adds refused calls. |
| 2 | Server attempts | 4 → 3 | **4 → 2** (PR-B), i.e. one 0.5–1 s second chance | **2.** The 429 is capacity-shaped over minutes; attempts 3–4 (sleeps of ~2 s and ~4 s) recovered almost nothing (6–12 % in-request overall) and cost ~6 s per 503. With 2 attempts a 503 costs ≈ 1.5–2 s, the phone keeps the long waits where they matter. Not 1: a 1 s retry still absorbs sub-second blips for free. QA can check the per-attempt recovery split in `logs-run*.json` (`transcribe.retry` attempt numbers immediately before a 200); if most in-request recoveries were at attempt ≥ 3, use 3 instead. |
| 2b | Server-side concurrency limiter / queue | – | per-instance semaphore (`maxInFlight`, bounded wait) | **No.** (a) Capacity is ~8/min project-wide: position ≥ 4 in a per-instance line exceeds the 30 s route budget and still ends in a 503, now after 30 s and holding a Cloud Run request. (b) `maxScale 3`: a per-instance line is not a project line. (c) The phone's time budget *is* the queue, at zero server cost, and the jitter already decorrelates phones. (d) The real fix (an async rate-limited queue) would need the audio to outlive the request → hard rule 2 forbids it. Deferred; not a hackathon item. |
| 3 | Demo caps charged per 503 | dev-ops sets `DEMO_SEGMENT_SANDBOX_CAP=300`, `DEMO_SEGMENT_DAILY_CAP=6000`, `DEMO_MODEL_DAILY_CAP=10000` on judging day (no code) | **Charge once per segment id** (PR-C): the first PUT of a `seg_id` charges as today; its retries are free (bounded allowance), so the ledger counts segments, not attempts | **Ultimate, with the env raise as the fallback if PR-C is not merged by Sat 10:00.** "Charge only on success" was rejected: a hostile client holding a judge device token could fire parallel PUTs that all pass a check-only gate before any charge lands, so the abuse bound (150 model calls per sandbox) would be gone. Charge-first-then-mark keeps the counter transaction as the serialising bound. |
| 4 | L-3 loss notice | – | **Sticky notice until Dismiss or the next Start** (PR-D) | **Ultimate** (small). The succeeded row is shown *under* it, so later uploads stay visible. |
| 5 | Guide stall copy | – | one extra muted line under "Waiting for Bee6 to hear this card…" while the upload is retrying (PR-D) | **Yes, needed:** under a stall the only in-guide text today is the mic hint "Not picking up your voice? Check the microphone…", which is wrong (the mic is fine, the service is busy) and sends a judge fiddling with the phone. |
| 6 | Judging-day rule | keep | sharpen numbers (PR-E, copy) | **Sharpen:** "at most 4 reading at once" is confirmed by data (N=4 passes twice; N=5 fails); "a minute apart" is not: a 5th phone starting 1 min into a 4-phone burst still lands in the backlog. The honest unit is a card set (~2 min). |
| 7 | Provisioned Throughput / capacity | – | – | **Nothing to build.** See §8. |

## 2. PR-A — phone: time-based head budget (`developer`, Fable/sonnet; ~1.5 h incl. tests)

### 2.1 Files
`lib/capture/browser/engine.ts`, `lib/capture/browser/engine.test.ts`, `lib/capture/browser/engine-lost.test.ts`,
`lib/capture/browser/engine-http-status.test.ts` (only where it relies on `maxAttempts`). Nothing else. `retry.ts`,
`queue.ts`, `client.ts`, `session.ts`, `UploadStatusLine.tsx`, copy keys: untouched.

### 2.2 Exact changes in `engine.ts`
- New exported constant: `export const HEAD_BUDGET_MS = 240_000;` with the comment: "R-23: a queue head that keeps
  being refused by the server (429/5xx) is dropped once it has been refused for this long, measured from its first
  server error to the latest one. Network failures (null) never count: offline retries forever, only the 10-min queue
  capacity prunes (B-4, finding #2)."
- `CaptureEngineOptions`: **remove** `maxAttempts`; add
  ```ts
  /** R-23: how long a head segment may keep being refused by the server before it is dropped. */
  headBudgetMs?: number;
  /** Clock for the budget; defaults to Date.now. Injectable for tests. */
  now?: () => number;
  ```
- Fields: `private readonly headBudgetMs: number;` `private readonly now: () => number;` set in the constructor
  (`options.headBudgetMs ?? HEAD_BUDGET_MS`, `options.now ?? Date.now`). Delete `maxAttempts` field and its assignment.
- `headAttempt` gains `firstServerErrorAt: number | null` (initialised `null` where the object is created at
  `headAttempt?.id !== item.id`). Keep `count`, `serverErrorCount`, `failed` exactly as they are (`serverErrorCount`
  stays for observability; nothing reads it for a decision any more).
- In `pump()`, replace the two lines
  ```ts
  if (status !== null) this.headAttempt.serverErrorCount += 1;
  if (status !== null && this.headAttempt.serverErrorCount >= this.maxAttempts) { this.dropHead(item.id); continue; }
  ```
  with
  ```ts
  if (status !== null) {
    this.headAttempt.serverErrorCount += 1;
    const at = this.now();
    if (this.headAttempt.firstServerErrorAt === null) this.headAttempt.firstServerErrorAt = at;
    if (at - this.headAttempt.firstServerErrorAt >= this.headBudgetMs) {
      this.dropHead(item.id);
      continue;
    }
  }
  ```
  Everything after (`failed += 1`, `connectionOk = false`, `emitStatus`, `stopping` break, the jittered
  `sleepOrAbort(backoffDelayMs(count, { jitter: true, rng, maxMs: MAX_BACKOFF_MS }))`) stays byte-for-byte.
  `MAX_BACKOFF_MS` stays 30_000.
- Class doc comment: replace "gives up after `maxAttempts` (default 8, R-22)" with "gives up once the head has
  been refused for `headBudgetMs` (default 4 min, R-23)". Update the `headAttempt` field comment likewise.

Semantics to preserve (the tests below pin them):
- A drop happens only on a server-error result (status is a number), never during a wait, never on `null`, never on
  the very first server error unless `headBudgetMs` is 0 (elapsed 0 ≥ 0 → drop; used by tests as "drop at once").
- Elapsed time includes the PUT's own duration (the clock is read after `upload` resolves), so a 30 s server-side
  attempt counts toward the budget.
- A success resets `headAttempt` to null (as today), so the next head starts a fresh budget.
- `abort()` behaviour unchanged: the pump breaks after the in-flight PUT; nothing queued behind is dropped or counted.

### 2.3 Tests (vitest; fake clock = `let t = 0; const now = () => t; const sleep = async (ms) => { t += ms; }`)
Rewrite the attempt-based tests; keep every other test unchanged.
1. "drops the head once it has been refused for headBudgetMs": upload always 503, `headBudgetMs: 10_000`, fake
   clock, `rng: () => 1` → after `drain()`: `droppedCount === 1`, `upload` called ≥ 2 times, and the clock advanced
   ≥ 10 000 ms. (With waits 500, 1000, 2000, 4000, 8000 the drop lands on the 6th attempt at t = 15.5 s.)
2. "a 200 inside the budget delivers the segment": 503 × 4 then 200, `headBudgetMs: 60_000` → `queuedCount 0`,
   `droppedCount 0`, state `listening`.
3. "the budget counts the PUT's own duration": upload fake advances `t += 30_000` before returning 503,
   `headBudgetMs: 50_000` → attempt 1 errors at t = 30 (budget starts), attempt 2 at t = 60.5 (elapsed 30.5, kept),
   attempt 3 at t = 91.5 (elapsed 61.5 ≥ 50) → dropped on the 3rd attempt; `upload` called exactly 3 times.
4. "network failures (null) never start or consume the budget (B-4)": `headBudgetMs: 5_000`, 20 × null (the fake
   clock advances by each wait, far past 5 s) then 503 then 200 → `droppedCount 0`, delivered (the first 503 is what
   sets `firstServerErrorAt`, elapsed 0 at that moment).
5. "headBudgetMs 0 drops on the first server error" (replaces the old `maxAttempts: 1/2` shapes in
   `engine-lost.test.ts` "turns true after a server-error give-up": use `headBudgetMs: 0`, results `[503, 200]`).
6. "default budget is 240 s": `HEAD_BUDGET_MS === 240_000` and an engine built without the option drops a permanently
   refused head only after the fake clock passed 240 s (use `rng: () => 1`; count the attempts: waits
   0.5+1+2+4+8+16+30·k ≥ 240 s → the drop is on the 14th attempt).
7. Existing R-22 jitter tests (`rng` bands, lockstep, Math.random default) stay as they are, minus any
   `maxAttempts` option.
8. `engine-http-status.test.ts`: replace `maxAttempts: N` with `headBudgetMs` + the fake clock only where the test's
   point is the drop; otherwise just delete the option.

### 2.4 Hard rules
2/2a: audio stays in page memory only, for longer under a stall (bounded by the 10-min queue cap and the session end);
P3 untouched. Nothing else touched. 11: one commit `feat(r-23): time-based head retry budget on the phone`.

## 3. PR-B — server: 4 → 2 transcribe attempts (`developer-junior`; ~30 min)

### 3.1 Files
`lib/transcribe/gemini.ts`, `lib/transcribe/gemini.test.ts`.

### 3.2 Exact changes
- `TRANSCRIBE_RETRY.attempts: 4` → `2`. `baseMs`, `factor`, `maxDelayMs`, `statuses`, `attemptTimeoutMs` unchanged.
- Doc comment lines 31–34: "retried inside that budget with jittered backoff (1 s -> 4 s, 4 attempts)" →
  "retried ONCE after a jittered 0.5–1 s wait (2 attempts, R-23: the 429 is capacity-shaped over minutes, so longer
  in-request waits recovered almost nothing and only slowed the phone's own retry cycle)".
- Tests: any test that relies on the default 4 passes `retry: { attempts: 4 }` explicitly (so its shape is kept),
  plus one new test "default is 2 attempts: a 429 then a 429 throws after exactly 2 calls and one sleep in
  [500, 1000]" (`rng: () => 0` → 500; `rng: () => 1` → 1000). The "gives up after attempts" and base64-leak tests
  must stay green.
- `app/api/v1/segments/[segment]/route.ts` header comment: no change needed.

### 3.3 Hard rules
Unchanged (same client, same ADC, same location resolver, same whitelisted log line).

## 4. PR-C — demo caps: charge once per segment id (`developer`, Fable/sonnet; ~1.5 h incl. tests)

### 4.1 Mechanism (read `lib/demo/caps.ts`, `lib/demo/route-caps.ts`, `lib/firestore/demo-store.ts bumpCounter`)
Today: step 7b of the route runs `enforceDemoCapsForRoute("segment", claims, "segments:upload")` = three
`bumpCounter` transactions (`segment_sandbox:<outlet>`, `segment_day:<day>`, `model_day:<day>`) before
`recordSegment`; a 503 later leaves the charges in place; a phone retry of the same `seg_id` charges again.

New: a **per-segment marker counter** in the same `demo_counters` collection (same TTL policy, 2 days):
- id `charge_once:segment:<outlet_id>:<seg_id>`, kind `charge_once`, `limit = 1 + SEGMENT_FREE_RETRIES`.
- `bumpCounter(marker, "charge_once", day, 1 + SEGMENT_FREE_RETRIES, expiry)` returns `true` for the first
  `1 + SEGMENT_FREE_RETRIES` PUTs of that `seg_id`. On the **first** one (count was 0 → the transaction wrote 1) the
  normal charge runs; on PUTs 2..(1+allowance) only the kill switches are honoured and **no cap is charged or
  compared**; past the allowance the full charge runs again (so a replaying client is bounded).
- The marker transaction must tell "first" from "later": `bumpCounter` returns only a boolean, so **add one method to
  `DemoStore`**: `bumpCounterCount(counterId, kind, day, limit, expiresAtIso): Promise<number | null>` — same
  transaction as `bumpCounter`, but returns the **new count** (1 for the first charge) or `null` when at/over the
  limit or damaged. Implement in `lib/firestore/demo-store.ts` by factoring the existing transaction body into a
  private helper used by both (keep `bumpCounter`'s ABORTED → `LockedError(2, "The demo is busy, try again shortly",
  "demo_busy")` mapping for both). Add the same to `lib/demo/testing/fake-store.ts` (count-returning variant).
- Why "first attempt charges" and not "success charges": the counter transaction is what serialises parallel
  PUTs; a check-only gate before the model call lets N parallel requests through at once (abuse bound lost).
- Why an allowance instead of "marked = free forever": a replayed `seg_id` whose transcription keeps failing would get
  unlimited free Vertex calls. Spend in money is already bounded (a `seg_id` can be *stored* once: the idempotent
  `store.get`), so the allowance only bounds free *failed* calls. `SEGMENT_FREE_RETRIES = 30` covers a 4-min budget
  (≈ 14–20 phone attempts) with margin.

### 4.2 Exact changes
- `lib/firestore/schema.ts`: add `"charge_once"` to `DEMO_COUNTER_KINDS`.
- `lib/demo/constants.ts`: `export const SEGMENT_FREE_RETRIES = 30;` with the comment above.
- `lib/demo/store-types.ts`: the `bumpCounterCount` method (doc: "Transaction, like bumpCounter, but returns the
  new count, or null when the limit refused it / the doc is damaged").
- `lib/demo/caps.ts`:
  - `enforceDemoCaps` input gains `once?: { id: string; freeRetries: number }`.
  - After the kill-switch block and before the three counts:
    ```ts
    if (input.once && input.mode !== "check") {
      const n = await store.bumpCounterCount(
        `charge_once:${input.key}:${outlet.outlet_id}:${input.once.id}`, "charge_once", day, 1 + input.once.freeRetries, expiry);
      if (n !== null && n > 1) return; // already charged by an earlier attempt of this same id: free retry
      // n === 1: first attempt → charge below. n === null: allowance exhausted (or damaged marker) → charge below.
    }
    ```
    (Kill switches above still refuse before the marker is touched. A `LockedError` from an ABORTED marker
    transaction propagates as today: 429 `demo_busy`, the phone retries.)
  - Doc comment: add the paragraph "Once-per-id charging (R-23)…" summarising §4.1.
- `lib/demo/route-caps.ts`: `enforceDemoCapsForRoute(key, claims, permission?, mode = "charge", once?: { id: string })`
  → passes `once: once && { id: once.id, freeRetries: SEGMENT_FREE_RETRIES }`. (Only the segment route uses it; the
  parameter is generic by shape only.)
- `app/api/v1/segments/[segment]/route.ts` step 7b: `enforceDemoCapsForRoute("segment", claims, "segments:upload",
  "charge", { id: seg_id })`. Comment: "R-23: charged once per seg_id; a phone retry after a 503 is free (bounded)."
  `seg_id` is already validated (`parseSegmentPath` + `SegmentMetadataSchema`), and the counter id has no `/`
  (`bumpCounter` throws on one anyway).

### 4.3 Tests
- `lib/demo/caps.test.ts` (fake store):
  1. "once: the first call charges the three counters and writes the marker (count 1)".
  2. "once: the second call with the same id charges nothing (counters unchanged, marker count 2)".
  3. "once: a different id charges again".
  4. "once: past the allowance (freeRetries 2 → the 4th call) the full charge runs again".
  5. "once: a kill switch still refuses before the marker is touched" (`DEMO_SEGMENT_SANDBOX_CAP: "0"` → no marker doc).
  6. "once: an already-charged id is free even when the cap is now full" (cap 1: id A charges → full; id A again → passes;
     id B → 429 `demo_segment_cap`).
  7. "mode check ignores once" (no marker written).
  8. Existing "counter ids carry the sandbox id or the day only" → extend: the marker id carries the sandbox id and
     the seg id, never an ip or key.
- `app/api/v1/segments/[segment]/route.demo-caps.test.ts`:
  9. "a transcriber 503 then a retry of the same seg_id spends one charge, not two" (transcribe rejects once with
     `ServiceUnavailableError`, then resolves; `DEMO_SEGMENT_SANDBOX_CAP=1`: PUT#1 503, PUT#2 200, PUT#3 (seg-2) 429).
  10. Existing 151st-upload test: still green (each PUT has a distinct seg id → distinct markers; adjust the helper to
      take a seg id).
- `lib/firestore/demo-store.test.ts`: `bumpCounterCount` returns 1, 2, then null at limit 2; damaged doc → null;
  ABORTED → `LockedError demo_busy` (mirror the existing `bumpCounter` tests).
- `lib/demo/testing/fake-store.ts`: the count-returning variant, shared by the tests above.

### 4.4 Hard rules
6: still server-side, after auth/permission/validation, before any model call. 7: counter ids carry outlet id and seg
id only (a segment doc already carries both; no person, no device id needed in the id). 8: nothing real. The marker
docs are demo-project only (`DEMO_MODE` gate unchanged) and die with the 2-day TTL dev-ops set on `demo_counters`
(confirm the TTL policy exists on `expires_at`; if it does not, this adds ≤ 3000 small docs/day until it does).

### 4.5 Fallback if PR-C is not merged by Sat 10:00 WIB
dev-ops sets on the demo service: `DEMO_SEGMENT_SANDBOX_CAP=300`, `DEMO_SEGMENT_DAILY_CAP=6000`,
`DEMO_MODEL_DAILY_CAP=10000` (all under `CAP_SANITY_MAX`). Rationale: with the 240 s budget a stuck segment makes
~14–20 charged attempts; QA measured ~30 wasted charges per judge-day at 8 attempts.

## 5. PR-D — L-3 sticky loss notice + Dismiss, guide stall line, mic/upload split (`developer`, Fable/sonnet; ~2 h)

### 5.1 Files
`app/capture/page.tsx`, `app/capture/UploadStatusLine.tsx` (+ `.test.tsx`), `app/demo/guide-bridge.ts` (+ tests),
`app/demo/JudgeGuide.tsx` (+ `.test.tsx`), `lib/i18n/dict.ts` (one key, both languages), `lib/i18n/v2/journey.ts`
(one key, both languages), `app/capture/page.test.tsx` / `page-copy.test.tsx` where `micTrouble` is asserted.
No engine change; `upload-retention.ts` untouched (its carry-loss keeps feeding `lostSinceSuccess`; the page simply
stops using `deriveLostLine` for the notice).

### 5.2 Exact behaviour
- **Notice rule (page):** `const lostNotice = (uploadSource?.droppedCount ?? 0) > dismissedDropsRef.current` where
  `uploadSource = sessionRunning ? status : lastUploadStatus`. `dismissedDropsRef` (a `useRef<number>(0)`) is set to
  `uploadSource.droppedCount` on Dismiss and reset to 0 in `handleMulaiTap` (a new day/session starts with a fresh
  engine, whose `droppedCount` is 0, so the notice ends at the next Start by construction). After End the retained
  `lastUploadStatus` keeps the last engine's `droppedCount`, so the notice survives the stop. Put the rule in a pure
  helper `deriveLostNotice(status: UploadSource | null | undefined, dismissedAtDrops: number): boolean` in
  `UploadStatusLine.tsx` (extend `UploadSource` with `Partial<Pick<CaptureStatus, "droppedCount">>`), unit-tested.
- **`UploadStatusLine` props:** add `onDismissLost?: () => void`. When `lost && onDismissLost`, render under the
  helper line a text button (`type="button"`, `minHeight: 44`, `padding: "10px 0"`, same `WARN_TOKEN` colour,
  `aria-label` not needed: visible text) with `t(lang, "C-u-lost-dismiss")`. Place it inside the live-region div
  so order is lost → helper → dismiss → the row.
- **Succeeded row no longer hidden by the lost line:** `showView = view !== null` (delete the `lost && succeeded`
  exclusion and its doc sentence). `useRecoveryToast`: `succeededShown = phase === "succeeded"` (drop `&& !lost`);
  keep `lossCleared` as is (a Dismiss then counts as a "loss cleared" toast trigger only if a failure preceded it;
  acceptable, and it means the judge sees "Upload working again" once).
- **Guide bridge:** `CaptureBridgeState` gains `uploadBusy: boolean` ("the queue head is being retried after a
  server refusal or a network failure"); `micTrouble` becomes mic-only:
  `micTrouble = status !== null && (status.state === "mic_error" || status.micError !== null)`;
  `uploadBusy = status !== null && status.headFailedAttempts > 0`. (`lostSinceSuccess` leaves `micTrouble`: a loss
  is shown by the page's own notice and is not a mic problem.)
- **JudgeGuide `ScriptCard`:** below the existing `C-journey-waiting-hear` line, when `!live.canMarkSpoken &&
  uploadBusy`, render `<p style={MUTED_LINE}>{t(lang, "C-journey-catching-up")}</p>` and **do not** render the
  "Not picking up your voice?" block while `uploadBusy` is true (condition becomes
  `!live.canMarkSpoken && micTrouble && !uploadBusy && linesSinceCardShown === 0`).
- **Copy (EN final, ID PROVISIONAL; Rangga/UX-03 own the wording):**
  - `dict.ts` `C-u-lost-dismiss`: EN "Dismiss" · ID "Tutup" `// PROVISIONAL`.
  - `journey.ts` `C-journey-catching-up`: EN "Bee6 is catching up: the transcription service is busy. Keep reading;
    this card unlocks when it has been heard." · ID "Bee6 sedang menyusul: layanan transkripsi sedang sibuk. Lanjutkan
    membaca; kartu ini terbuka setelah terdengar." `// PROVISIONAL`.

### 5.3 Tests
- `UploadStatusLine.test.tsx`: replace "hides the succeeded row while the lost line is up" with "shows the succeeded
  row under the lost line"; add "Dismiss button renders only with `onDismissLost` and calls it"; add
  `deriveLostNotice` cases: (0 drops, 0 dismissed) false · (1, 0) true · (1, 1) false · (2, 1) true · null → false.
  The live-region and aria tests must stay green with the button inside the region.
- `page.test.tsx`: "a dropped segment keeps the lost line after a later 2xx until Dismiss" (drive the engine status
  callback with `droppedCount 1, lostSinceSuccess true` then `lostSinceSuccess false, lastUploadHttpStatus 200`
  → the line is still there; click Dismiss → gone); "a new Start clears it".
- `guide-bridge` / `page` tests: `micTrouble` false and `uploadBusy` true for `headFailedAttempts 1` with a healthy mic.
- `JudgeGuide.test.tsx`: the catching-up line appears with `uploadBusy: true` and no lines heard, and the mic hint
  does not; with `micTrouble: true, uploadBusy: false` the mic hint appears as before.

### 5.4 Hard rules / UX note
No data change. Works at 360 px (one extra text button and one muted line). **UX-03 §5.7 row L ("until the next
2xx") changes to "until Dismiss or the next Start"** for both demo and pilot pages (same component): Rangga to confirm.

## 6. PR-E — copy: the judging-day stagger rule (`developer-junior`; ~20 min)

- `lib/demo/guide.ts` `capture_ready` body line 4 →
  "After the 5 cards, Jump to closing time unlocks End. No more than 4 people should read cards at the same time;
  if more are ready, wait until someone has finished their 5 cards (about 2 minutes) before tapping Start."
  (≤ 240 chars: 213. `guide.test.ts` "capture_ready has 4 body lines" stays green.)
- `README.md` line 43 → the same sentence. Optional in the same PR (Rangga's call): line 40 "a session hard-stops
  5 minutes after Start" is stale (`DEMO_SESSION_MAX_MS` = 20 min).
- `docs/tasks/R-18-judge-signin-and-script.md` judge script: same wording where the stagger rule appears (docs only).
- Test: `guide.test.ts` body-length assertion (existing) + a string match on "No more than 4".

## 7. Order, routing, estimates, parallelism
PR-A (developer, 1.5 h) ∥ PR-B (junior, 0.5 h) ∥ PR-C (developer, 1.5 h) — disjoint files, merge in any order.
PR-D (developer, 2 h) can start at once too (touches `page.tsx`, `UploadStatusLine`, guide files only).
PR-E (junior, 0.3 h) any time. Total ≈ 6 h agent time + reviews ≈ 1 h + QA load run ≈ 1 h. Everything fits before
Sat 12:00 if started Fri morning. **If time runs short: A + B + E first** (they remove the loss), then D (visibility),
then C or its env fallback (§4.5).

## 8. Provisioned Throughput / capacity (question 7): what is known, no commands
- Google's PT supported-models index lists PT pages for Gemini 3.5 Flash and newer Flash/Live models; **"Gemini 3.5
  Transcribe" has no PT page**, consistent with dev-ops ("no quota row, PT likely unavailable"). Preview models run on
  dynamic shared quota on `global`; there is no self-serve quota row to raise for this model.
- What Rangga could do (none blocks the build): (1) ask the AI Builder Cup organisers' Google contact for a temporary
  capacity allowance / allow-listing for `gemini-3.5-transcribe-preview` on `bee6-playground` for judging day (the
  fastest lever, if any); (2) a Google Cloud support case ("capacity for a preview model") needs a paid support plan
  and is unlikely to land by Sunday; (3) accept demand shaping: 4 phones at once, the rest 2 min apart (PR-E).
- Do not change model or location: `config/regions.yaml` lists `global` only (rule 5), and a different model changes
  the stated stack (CLAUDE.md §3).

## 9. Must not break
- Segment idempotency (`store.get` before transcribe; `already_exists` → 200) and the discard tombstone (R-20).
- The 15 s segment cap (`batcher.ts`), `SegmentMetadataSchema`, headers, `X-Session-Id`.
- B-4 (null never consumes the budget), the `stopping` break, the 10-min queue prune, `abort()` promptness,
  `stop()` drain bounds (5 s / 15 s demo sign-out), the debrief starting synchronously at End.
- UploadStatusLine states (retrying + "(Nx)" + "Server busy" / "No internet", uploading, succeeded, toast);
  only the lost line's lifetime and the row visibility under it change (PR-D).
- Demo caps: kill switches, per-sandbox/day/model refusals with Retry-After, `demo_busy` on ABORTED, the pilot's
  zero-read path (`DEMO_MODE` unset → inert).
- Hard rule 2: audio only in page memory, never persisted; rule 5: location from `config/regions.yaml`; R-22's
  `transcribe.retry` log shape `{attempt, upstream, delayMs}`.

## 10. How QA re-verifies (same r4 harness; demo project; read-only Firestore; cents)
Runs: **N=4 ×2** and **N=6 ×1** (same-second starts, `day1.wav`), plus one regression phone through End → debrief.
Pass criteria (honest, per run):
1. N=4: 0 × "Some speech was not captured", 7/7 lines on every phone (as today), every 503 preceded by **at most one**
   `transcribe.retry` line (PR-B), 503 latency p50 ≤ 2.5 s.
2. N=6: **0 lines lost**: every segment's first PUT → 200 within 240 s (report p50/p95/max time-to-200; expect up to
   ~4 min for the last ones); "Not sent yet · retrying (Nx) · Server busy" may show for minutes; the guide shows
   "Bee6 is catching up…" while a card is stalled and never the mic hint; no phone shows the lost line.
   **Graceful degradation (if capacity that minute is below ~5/min and a line is still lost):** the lost line stays
   on screen through End (screenshot at End), the succeeded row appears under it, Dismiss hides it, the next Start
   clears it. Record which happened; a loss with the notice visible is a reported risk, a loss without it is a defect.
3. Caps (read-only counters, before/after): `segment_day` and `model_day` deltas **equal the number of 200s** (not
   200 + 503); `segment_sandbox` per sandbox equals that phone's stored segments; `charge_once:*` docs exist with a
   2-day `expires_at`.
4. Logs: 0 audio/base64 lines (as in §6 of the load report); `demo.charge_failed` absent; `demo_busy` 429s, if any,
   are retried by the phone and end in 200.
5. Regression: End → "Preparing your questions" → question → answer → supervisor Ask → owner approve (R-20/21 path).
Human checklist (Rangga/Tiffany, real phones): two phones reading at once → no notice; pull the Wi-Fi for 30 s →
"No internet", recovers; one phone shown a forced loss (dev mode or a 413-sized segment) → notice stays after the
next good upload, Dismiss hides it.

## 11. Rangga decisions
1. `HEAD_BUDGET_MS` = 240 s (bounded by End / 10-min queue / 20-min demo session)? Server attempts 2 (not 3)?
2. PR-C once-per-seg_id charging (marker counter, allowance 30) vs the env-raise fallback only (§4.5)?
3. L-3: sticky notice + "Dismiss", succeeded row shown under it, applies to the pilot page too (UX-03 §5.7 row L change)?
4. Copy: "Dismiss"/"Tutup", the catching-up line, the 4-phones/2-minutes stagger sentence; fix the stale "5 minutes" in README?
5. Ask the organisers' Google contact for transcribe capacity on judging day (no code either way)?

## R-23 reviews

Tech-lead review (Fri 16 Oct ~03:55 WIB), five branches on `origin/main` 4a93a9e. Merge simulation A→B→C→D→E via
`git merge-tree --write-tree` (dangling commits only): **no conflicts** (PR-D touches `lib/i18n/v2/journey.ts` +
`dict.ts`, PR-E touches `lib/demo/guide.ts` + README: disjoint). Gates on the merged tree (scratchpad extract, the
worktree's `node_modules`): `tsc --noEmit` clean · `eslint .` clean · vitest **322 files, 5349 passed, 1 skipped**.

### PR-A `feature/r-23-phone-budget` 1b74742 — PASS
- Budget start/end correct: `firstServerErrorAt` set at the first numeric status, compared on each later numeric
  status, clock read after `upload` resolved (PUT duration counts, pinned by the 91.5 s test). `null` never starts or
  consumes it (B-4 test with 20 nulls then 503 → kept). Success resets `headAttempt` (unchanged code path).
- No test can spin: `engine.test.ts` `makeEngine` injects a fake clock that `sleep` advances; `runAlwaysFailing`
  injects its own; `engine-lost.test.ts` and `engine-http-status.test.ts` use real `Date.now` but every scripted
  upload ends in 200 (`results.shift() ?? 200`) or uses `headBudgetMs: 0`. Production path: real clock, real jittered
  sleeps capped 30 s → a refused head makes ≤ 14 attempts in 240 s, then drops. `abort()` path untouched; End still
  bounded by the 5 s / 15 s drain; queue still pruned at 10 min of audio.
- Memory: Opus ~24 kbps → a 15 s segment ≈ 45 KB; a 240 s stall holds ≤ 16 segments ≈ 0.7 MB, the 10-min queue cap
  ≤ 40 segments ≈ 1.8 MB per phone. Negligible on any phone; the server holds one body per in-flight PUT as before.
- N=6: 42 segments at ~8/min clear in ~5 min project-wide; the 240 s budget is per head (starts when that segment is
  first refused), and 7 segments ≈ 105 s of audio per phone sit far under the 10-min prune, so 0 drops is expected
  unless capacity falls below ~5/min. With PR-B a 503 now costs ≤ 2 s (one attempt + 0.5–1 s + one attempt, each
  ≤ 15 s only on a timeout), so the phone's own backoff dominates as intended.
- Note (not blocking): `serverErrorCount` is now observability only, as planned.

### PR-B `feature/r-23-server-attempts` c9dadba — PASS
`attempts: 2`; `baseMs/factor/maxDelayMs/statuses/attemptTimeoutMs` unchanged; the `transcribe.retry`
`{attempt, upstream, delayMs}` log line untouched; existing 4-attempt tests pinned with `retry: { attempts: 4 }`;
new default tests assert exactly 2 calls and one sleep of 500 (rng 0) / 1000 (rng 1). Doc comment updated.

### PR-C `feature/r-23-charge-once` 89ec7e0 + f4045e9 — PASS (deviation from plan §4.2 RATIFIED)
- The developer's order (read marker → free only if `1 ≤ seen < 1+allowance` and the bump succeeds → else charge →
  write the marker only after all three charges passed) is strictly better than the plan's: the plan's
  "mark first, charge if count == 1" would have let a client send every seg_id twice (refused first PUT leaves the
  marker, the retry is free), i.e. bypass every cap. Ratified; the plan text above is superseded by the code.
- Adversarial pass: (a) same seg_id N× in parallel with no marker: every PUT reads 0 → all charge (over-charge, the
  safe side) → each bumps the marker; later retries free within 30. (b) refused-then-retry: a refused first PUT writes
  no marker (test "a cap-refused seg_id is not made free"); retry charges again. (c) seg_id forging: the path parser
  allows exactly one `:` so `seg_id` has none; outlet id comes from claims, so the marker is always
  `charge_once:segment:<own outlet>:<no-colon id>` — cannot collide with another sandbox's marker or any
  `segment_sandbox:/segment_day:/model_day:` id. A `/` in `seg_id` makes `readCounter` throw → `runCheck` maps the
  untyped throw to 503 `demo_cap_unavailable` before any model call (and the segment doc id was already broken for
  such an id; pre-existing, harmless). (d) damaged marker: `readCounter` → MAX_SAFE_INTEGER → `seen ≥ limit` → full
  charge, no marker write (tested). (e) marker write fails after a successful charge: untyped → 503
  `demo_cap_unavailable`; ABORTED → 429 `demo_busy`; the phone retries and is charged again (safe direction).
  (f) TTL: marker rows use the same `expiry = now + COUNTER_TTL_MS` (2 days) and the native `expires_at` Timestamp,
  so the existing `demo_counters.expires_at` TTL policy covers them; a 20-min session never outlives it. (g) write
  rate: one marker write per retry, ≥ 250 ms apart and 15–30 s apart after the 7th — well under 1/s sustained.
  (h) indexes: none (get by id). (i) pilot: `DEMO_MODE !== "true"` returns before any read (unchanged).
- Caps now count segments: `segment_day`/`model_day` deltas = charged first PUTs (= 200s + refused-by-upstream first
  attempts, not retries). Abuse under a sustained 429 burst: a replayed seg_id gets ≤ 30 free *failed* model calls
  per charged segment (a stored seg_id answers 200 from `store.get` with no model call, so a success ends the free
  calls); per sandbox that is ≤ 150 × 31 failed calls as the worst case — bounded, and a 429'd call costs nothing.
  Acceptable for the demo project.
- Notes (not blocking): `Partial<Pick<DemoStore,"bumpCounterCount">>` + a runtime throw is a little loose; a required
  method would be cleaner but every caller already passes the full store. `SegmentMetadataSchema.seg_id` is still
  `min(1)` with no charset/length rule (pre-existing; a 1500-byte id would 503 here instead of 500 in `store.get`).

### PR-D `feature/r-23-notice-copy` 1964d07 + 522f18d — PASS-WITH-NOTES (one required fix before merge)
1. **Required** `app/capture/UploadStatusLine.tsx:124-133` (`useRecoveryToast`): with the sticky notice, `lost` only
   goes false on Dismiss or Start, so `lossCleared` can no longer mean "a 2xx recovered the upload". Scenario: a
   segment drops (→ `lossRaised` sets `failedSinceSuccessRef`), no 2xx follows (e.g. the day was Ended), the judge
   taps Dismiss → `lossCleared && failedSinceSuccessRef` → toast "Upload working again" although nothing succeeded.
   Fix: drop `lossCleared` from the trigger (`if (succeededShown && failedSinceSuccessRef.current)`), delete the
   stale "A 2xx that clears the lost line…" comment, and add the test "Dismiss with no success in between shows no
   toast". No existing test asserts the `lossCleared` path (checked).
- Verified: a rejected Start (422/409) returns before `resetLostNotice()`, so the notice survives it; `status` is
  nulled in `stopRunningSession`, so there is no flash of the old count between Start and the new engine's first
  report; `deriveLostNotice` null-safe; Dismiss parks focus on the live region (`tabIndex=-1`); one polite region;
  44 px button; inline block layout fits 360 px; the pilot page gets the same component (UX-03 §5.7 row L change,
  Rangga's call #3 above).
- UX ruling change for Rangga: `stopRunningSession` bumps the generation, so a **late drop reported by the stopped
  engine** (during the ≤ 5 s End drain) only flips `lostSinceSuccess` in the retained status and no longer raises the
  droppedCount-based notice. Segments still queued at End were already abandoned silently (R-19 console count), so
  this narrows an already-narrow case; if Rangga wants it kept, the one-line fix is in `upload-retention.ts`
  `retainEngineStatus` older-gen branch: also `droppedCount: prev.status.droppedCount + 1`.
- `deriveLostLine` is now unused by the page (still exported/tested); fine to leave.

### PR-E `feature/r-23-stagger-copy` 4475a5c — PASS
Line 4 is 213 chars, under the `Bilingual` `max(240)` (the `card()` helper mirrors `en` into `id`); README line 40
"20 minutes" matches `DEMO_SESSION_MAX_MS = 1_200_000`; stagger sentence identical in README and guide; test added.
Docs-only leftover: `docs/tasks/R-18-judge-signin-and-script.md` still says "about a minute apart" (not in the PR).

### Merge order
A → B → C → D → E (any order is conflict-free; this is the order simulated and gated). Merge PR-D only after fix #1.

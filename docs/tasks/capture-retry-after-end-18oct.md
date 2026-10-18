# Fix: a server-refused segment keeps retrying after End (18 Oct 2026)

Author: tech-lead (plan). Approved direction: Rangga, 18 Oct. Builder: `developer` (sonnet). This touches the capture
engine's retry and stop logic, so it is not a `developer-junior` task. Branch: `fix/transcribe-429-retry` in worktree
`../bee6-fb22` (clean, off `origin/develop` 0ccbfb1). Source: `docs/tasks/QA-step3-risk-fixes-18oct.md` DEFECT 1 and the
dev-ops log checks.

## 1. Root cause (verified in code at 0ccbfb1)

- The phone does not have a 6-try cap. `lib/capture/retry.ts` `nextUploadAction` / `DEFAULT_MAX_ATTEMPTS = 6` are
  dead code: nothing outside `retry.test.ts` imports them. The live uploader is `CaptureEngine.pump`
  (`lib/capture/browser/engine.ts`) with `createSegmentUploader` (`lib/capture/browser/client.ts`). It retries 429/5xx
  until the head has been refused for `HEAD_BUDGET_MS = 240_000` (measured from the head's first server error), with
  backoff 0.5 s doubling, a 30 s cap and jitter in [raw/2, raw]. Network failures (`null`) retry forever.
- End (Selesai) and the auto-stop call `stopRunningSession()` -> `session.stop()` (`lib/capture/browser/session.ts`
  line 329) -> `engine.flush()` + `engine.abort()`. `abort()` sets `stopping = true` and wakes the backoff sleep.
  In `pump()`, `if (this.stopping) break;` (line 412) and `sleepOrAbort()` (line 440, returns at once when
  `stopping`) mean a server-refused head gets the attempt that is in flight, plus one more if the wake hit a sleep.
  Then the pump exits and the rest of the in-memory queue is abandoned. It is not counted as dropped either.
- J day 1: segment `7118df98` got 6 x 503 in about 13 s (0.25 to 0.5, 0.5 to 1, 1 to 2, 2 to 4, 4 to 8 s of backoff,
  plus the PUTs), then End came and the pump stopped. The Vertex 429 burst lasted 76 s. With the R-23 budget still
  running it would have been delivered.
- R-23 (`docs/tasks/R-23-retry-budget.md` line 87, 359) deliberately kept "`abort()` behaviour unchanged". This
  fix changes that ruling for End and the auto-stop only, with Rangga's approval on 18 Oct. Everything else R-23 decided
  stays the same: budget, backoff, jitter, B-4, the 10-min prune and the sticky lost notice.

## 2. Decision: two ways to stop the engine

| Mode | Engine call | Meaning |
|---|---|---|
| **finish** (drain and retry) | `engine.finish()` | Capture is over, but uploads go on in the background. A server-refused head (status non-null: 429/5xx) keeps its normal backoff until its head budget is spent, then drops (existing drop path, so `droppedCount` rises and the sticky "not captured" notice shows). A network failure (`null`) after finish exits the pump at once, as it does today. The queue is left in memory and not counted as dropped. |
| **hard** (abort) | `engine.abort()` | No new upload starts after this call. A PUT that is already in flight is not cancelled (no AbortController; out of scope) and its result is still recorded. The pending backoff sleep is woken. |

**Overall bound in finish mode.** `finishDeadline = now() at finish() + headBudgetMs` (240 s). On every server error
after finish, the head is dropped if **either** its own budget is spent (`at - firstServerErrorAt >= headBudgetMs`,
unchanged) **or** `at >= finishDeadline`. Why: without the second rule, a queue of N refused segments could keep the page
retrying for N x 240 s after End. With it, the whole background drain ends about 4 minutes after End (plus one PUT per
remaining head). A head that was already refused for 200 s before End gets only its remaining 40 s, which is exactly
"the remaining HEAD_BUDGET_MS". Successes and 4xx drops are not affected by the deadline.

### Who calls which

All page call sites pass the mode explicitly. `CaptureStopOptions.mode` defaults to `"finish"` so the documented
`stop()` contract ("flushes and ships the final segment") and the existing `session-stop.test.ts` cases stay valid.

| Trigger (`app/capture/page.tsx` at 0ccbfb1) | Line | New call |
|---|---|---|
| Auto-stop effect (pilot `close(D)+1h` and sandbox 10:00 hard stop) | 451 | `stopRunningSession({ mode: "finish" })` |
| `confirmSelesai` success | 663 | `stopRunningSession({ mode: "finish" })` |
| `handleDevStop` (DEV-01 manual Stop) | 964 | `stopRunningSession({ mode: "finish" })` |
| `confirmBatalkan` success (discard) | 782 | `stopRunningSession({ mode: "hard" })` |
| `confirmSignOut`, `"running"` branch (discard, then leave) | 901 | `void stopRunningSession({ mode: "hard" })`, then `finishSignOut()` (which aborts every other session, below) |
| `confirmSignOut`, after-closing branch | 911 | `stopRunningSession({ mode: "finish", drainMs: SIGN_OUT_DRAIN_MAX_MS })`. The 15 s wait stays, and retries keep running during it. Then `finishSignOut()` hard-aborts whatever is left. |
| `finishSignOut()` (every sign-out path, including "no running session but an older one still draining" and the `!auth` path at 881) | 851 | first line: `abortAllCaptureUploads();`, then `clearDeviceAuth()` and `router.replace("/")` as today |
| Unmount effect | 516-523 | `void s?.stop({ mode: "hard" }); abortAllCaptureUploads();` |
| `handleMulaiTap`: the page moved on while the engine was starting (`gen !== sessionGenRef.current`) | 612 | `void captureSession.stop({ mode: "hard" });` |
| `handleDevStart`: stop requested while starting | 952 | `await captureSession.stop({ mode: "hard" });` |
| `handleOpenEnd` / `handleOpenCancel` | n/a | No engine runs in that view. No change. |

Batalkan hard-aborts **only the session being discarded**. An older, ended session that is still draining keeps going:
its notes belong to a day that was ended, not discarded. Sign-out and unmount abort everything. The server already
answers `200 {discarded: true}` for a tombstoned session (`segment-service.ts` line 89), so hard abort on discard is a
second safeguard, not the only one.

**A new Mulai while the old engine drains.** Nothing extra is needed and nothing is aborted. Each engine owns its own queue,
`genSegId` (crypto UUID), and uploader closure. That closure captures that session's `sessionId` (X-Session-Id) and the
`auth` it started with (`session.ts` line 126). The segment path is `deviceId:segId`, so the two engines can never collide.
The server treats a re-PUT of a stored id as success (`store.get` -> existing). The demo cap charges once per `seg_id`
(`route.ts` step 7b), so retries after End cost nothing extra. The two engines may PUT concurrently; that is fine.

## 3. Exact changes

### 3.1 `lib/capture/browser/engine.ts`

1. Replace `private stopping = false;` with:
   ```ts
   /** running → finishing (End/auto-stop: keep retrying server refusals) → aborted (no new upload). Never goes back. */
   private mode: "running" | "finishing" | "aborted" = "running";
   /** Set once by finish(): no server-refused head is retried past this clock reading. */
   private finishDeadline: number | null = null;
   ```
2. Add `finish()` and rewrite `abort()` (replace lines 243-248):
   ```ts
   /**
    * Graceful end (Selesai, auto-stop). Capture is over; queued segments keep uploading in the background.
    * A server-refused head (429/5xx) keeps its normal backoff until its head budget or the finish deadline
    * (now + headBudgetMs) is spent, then drops. A network failure (null) after this exits the pump at once.
    * Idempotent; a no-op after abort(). Resolves when the pump is idle (may take minutes: callers bound it).
    */
   finish(): Promise<void> {
     if (this.mode === "running") {
       this.mode = "finishing";
       this.finishDeadline = this.now() + this.headBudgetMs;
       // Keep today's prompt exit for a network outage: if the head is sleeping after a null, retry it now
       // (the pump then breaks on the next null). A server-error backoff is NOT cut short.
       if (this.headAttempt !== null && this.lastUploadHttpStatus === null) this.wake?.();
     }
     return this.drain();
   }

   /** Hard stop (discard, sign-out, unmount): no new upload starts; an in-flight PUT settles on its own. */
   abort(): Promise<void> {
     this.mode = "aborted";
     this.wake?.();
     return this.drain();
   }
   ```
   (`abort()` stays `async`-compatible: it returns the same `Promise<void>` type as before.)
3. In `pump()`:
   - At the very top of the `for (;;)` body, before `peek()`, add: `if (this.mode === "aborted") break;`
   - In the transient branch, replace the `if (at - ... >= this.headBudgetMs)` test with:
     ```ts
     const headSpent = at - this.headAttempt.firstServerErrorAt >= this.headBudgetMs;
     const finishSpent = this.finishDeadline !== null && at >= this.finishDeadline;
     if (headSpent || finishSpent) {
       this.dropHead(item.id);
       continue;
     }
     ```
   - Replace `if (this.stopping) break;` (line 412) and its comment with:
     ```ts
     // Hard stop: never wait or retry. Finishing: a network failure (null) exits at once and leaves the
     // queue in memory (finding #3, unchanged); a server refusal keeps its backoff (18 Oct fix).
     if (this.mode === "aborted") break;
     if (this.mode === "finishing" && status === null) break;
     ```
   - Success and 4xx-drop paths: unchanged. A success that lands after `abort()` is still confirmed (the PUT was delivered).
     The loop-top check then exits.
4. `sleepOrAbort`: `if (this.mode === "aborted") return Promise.resolve();` (it no longer short-circuits in finishing).
5. Header comment (lines 16-22): replace the last sentence with "`finish()` (End, auto-stop) keeps retrying server
   refusals in the background until the head budget or the finish deadline is spent. `abort()` (discard, sign-out,
   unmount) stops at once, even mid-backoff." Also fix the `stopping`/`abort()` mentions in the field comments.
6. No new log line, event, or status field. `status.state` stays `"offline"` while a finishing head is refused
   (`connectionOk = false`, `queue.size > 0`). That is what drives the retained retry row on the page (§4).

### 3.2 `lib/capture/browser/session.ts`

1. Types:
   ```ts
   export type CaptureStopMode = "finish" | "hard";
   export interface CaptureStopOptions {
     drainMs?: number;
     /**
      * "finish" (default; Selesai, auto-stop): flush the open segment and keep uploading in the background,
      * retrying server refusals up to the head budget. "hard" (discard, sign-out, unmount): do not flush,
      * start no new upload.
      */
     mode?: CaptureStopMode;
   }
   ```
2. Module-level registry (above `startCaptureSession`):
   ```ts
   /** Engines that may still upload: the running one and any finishing in the background. Hard-aborted by sign-out/unmount. */
   const liveEngines = new Set<CaptureEngine>();
   /** Hard-aborts every capture engine on this page (sign-out, unmount). Idempotent; never throws. */
   export function abortAllCaptureUploads(): void {
     for (const engine of liveEngines) void engine.abort();
     liveEngines.clear();
   }
   ```
   Right after `const engine = new CaptureEngine(...)`: `liveEngines.add(engine);`. In the `!isOpusEncoderSupported()`
   early return, no engine exists yet, so there is nothing to add.
3. In `stop()` (replace lines 348-351):
   ```ts
   const mode = options?.mode ?? "finish";
   let drained: Promise<void>;
   if (mode === "hard") {
     drained = waitAtMost(engine.abort(), drainMs);
     liveEngines.delete(engine);
   } else {
     engine.flush();
     const background = engine.finish();
     // Leave the registry once the background drain is idle, so sign-out has nothing stale to abort and the
     // engine can be collected.
     void background.then(() => liveEngines.delete(engine));
     drained = waitAtMost(background, drainMs);
   }
   ```
   Keep `const released = ...` and the `stopping = Promise.all([drained, released])...` lines as they are.
   Second-call semantics stay the same: a second `stop()` returns the first promise and its options are ignored.
   Escalation to hard happens only through `abortAllCaptureUploads()`.
4. Update the `CaptureSession.stop` JSDoc: settle at drain or `drainMs`; in finish mode the uploads go on after it
   settles, until `abortAllCaptureUploads()` or the finish deadline.
5. No change to `client.ts`, the heartbeat, the wake lock or mic teardown. The mic, VAD, heartbeat and wake lock are
   still released synchronously at stop, in both modes.

### 3.3 `app/capture/page.tsx`

Only the call sites in the §2 table, plus `abortAllCaptureUploads` added to the existing
`@/lib/capture/browser/session` import. There is no new state, ref or UI. `stopRunningSession` keeps its signature
(`CaptureStopOptions` gains `mode`). Do not touch the refusal maps or line ~130 (feature/after-days edits there).

### 3.4 Status line and queue state in the background (no code change; verify only)

After End, `stopRunningSession` bumps `sessionGenRef` and sets `sessionRunning` to false. The finishing engine's
`onStatus` still goes through `retainEngineStatus(..., gen)`, and its gen is still the newest **started** gen, so
`lastUploadStatus` keeps updating:
- While it retries: `state "offline"` + `headFailedAttempts > 0` -> `deriveRetainedUploadView` shows the retry row
  ("Not sent yet · retrying (Nx) · Server busy") on the ended/debrief screen.
- On a 200: the queue empties, the retained view goes back to null, and the row disappears. No toast (unchanged: the retained
  view never reports "succeeded").
- On a budget or deadline drop: `droppedCount` rises -> `deriveLostNotice` shows the sticky "Some speech was not
  captured" notice. This is the existing failed state; no new copy.
- After a new Mulai, the old engine's reports are older-gen: they are ignored except for a genuine new drop, which only
  raises the retained flag. The running screen shows the new engine's counts, so an old engine's late drop does not show
  on the running screen. This is an accepted gap and no change is planned.
- `status` (live) and `linesThisSession` are gated by `isCurrent()`, so they are unaffected.

Accepted gap (Rangga, 18 Oct; do NOT build): a note that lands after that day's debrief questions were prepared misses
that day's questions, and "Debrief complete" can still show. No "N notes not sent" line (option B declined).

### 3.5 Dead code: delete

Delete these from `lib/capture/retry.ts`: `DEFAULT_MAX_ATTEMPTS`, `interface UploadAction`, `nextUploadAction` (lines 23-47).
Keep `classifyUploadResult`, `BackoffOptions`, `DEFAULT_BACKOFF` and `backoffDelayMs`, which are used by `engine.ts` and `restart.ts`.
In `lib/capture/retry.test.ts`, delete the `describe("nextUploadAction", ...)` block and drop `DEFAULT_MAX_ATTEMPTS`
and `nextUploadAction` from the import. Before deleting, run
`grep -rn "nextUploadAction\|DEFAULT_MAX_ATTEMPTS" app lib scripts` in the worktree: the only hits must be these two
files. Do not edit docs (the dev-ops note in the QA file that blames `DEFAULT_MAX_ATTEMPTS` is history; the PM corrects
it).

## 4. Tests (write these first and watch them fail on 0ccbfb1, then implement)

### 4.1 `lib/capture/browser/engine.test.ts` (new `describe("finish() vs abort() (18 Oct: retry after End)")`)

Use `makeEngine` (an instant fake sleep that advances the clock). Where a test needs the pump genuinely asleep, use a
**held sleep**: `sleep: (ms) => { waits.push(ms); return new Promise<void>((r) => { release = () => { t += ms; r(); }; }); }`
with its own `t`/`now`. Flush microtasks with a small helper:
`const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };`

1. **After finish, a 503 head keeps retrying until 240 s, then drops.** `upload` always returns 503. On call 3 it
   calls `void engine.finish()` before returning (End lands mid-retry). Use `rng: () => 1` and the default budget. Expect
   `upload` called 14 times, `clock.now() === 241_500`, `droppedCount 1`, `queuedCount 0`, `status.lostSinceSuccess true`.
   Recorded `onStatusChange` states after the finish include `"offline"`. The same test on 0ccbfb1 shows 3 or 4 calls
   and `droppedCount 0`: that is the regression proof.
2. **After finish, a 503 head that recovers is delivered.** Calls 1-3 return 503 (finish called inside call 2), call 4 returns 200.
   Expect 4 calls, `droppedCount 0`, `queuedCount 0`, `state "listening"`.
3. **finish does not reset or shorten the backoff, and jitter stays in bounds.** Record waits with the instant sleep
   (`runAlwaysFailing`-style), `rng: () => 0`, finish called inside call 1. Expect the waits to equal the running schedule
   `[250, 500, 1_000, 2_000, 4_000, 8_000, 15_000, 15_000, ...]` exactly. Repeat with `rng: () => 0.999`: every wait is in
   `[raw/2, raw]` and `<= 30_000`.
4. **A network failure after finish exits at once.** `upload` returns 503 on call 1 and `null` on call 2 (finish called
   inside call 2). Expect exactly 2 calls, `drain()` resolves, `queuedCount 1`, `droppedCount 0`.
5. **finish wakes a network-backoff sleep (prompt exit kept).** Use a held sleep that is never released and `upload`
   always `null`. Flush, `await settle()` (1 call, sleeping), then `await engine.finish()`. It must resolve without
   releasing the sleep. Expect exactly 2 calls (the woken retry, then the break), `queuedCount 1`.
6. **finish does NOT wake a server-error backoff.** Held sleep, `upload` always 503. Flush, `settle()` (1 call,
   sleeping), call `engine.finish()` (do not await), then `settle()`: still 1 call. `release()` and then `settle()`: 2 calls.
7. **The finish deadline bounds a multi-segment queue.** Two segments: `frame(0), frame(100), flush()` and
   `frame(2_000), frame(2_100), flush()`. `upload` always 503, `rng: () => 1`, finish called inside call 1 (deadline 240 s).
   Expect 15 calls (14 for head 1, ending at 241.5 s; head 2 dropped on its first refusal because 241.5 s >= 240 s),
   `droppedCount 2`, `queuedCount 0`.
8. **abort() after finish stops at once.** Held sleep, `upload` always 503. Flush, `settle()`, `finish()`, then
   `await engine.abort()`. It resolves without a release. Still 1 call, `queuedCount 1`.
9. **abort() before the flushed segment is pumped uploads nothing.** `pushFrame(0)`, `pushFrame(100)`, `flush()`, then
   immediately `await engine.abort()`. Expect `upload` not called.
10. **A success already in flight at abort() is still confirmed.** `upload` returns a promise you resolve by hand. Flush,
    `settle()`, call `engine.abort()`, resolve the upload with 200, then await the abort. Expect `queuedCount 0`,
    `droppedCount 0`, 1 call.
11. **A new engine runs independently while an old one finishes.** Engine A: held sleep, `upload` always 503,
    `genSegId` `a-*`. Engine B: instant sleep, `upload` 200, `genSegId` `b-*`. A: flush, settle, finish (sleeping). B:
    push, flush, `await B.drain()`. Expect B's upload to be called once with `seg_id "b-1"`, A's upload never to receive a `b-*`
    id, and A still at 1 call. Then release A: A's upload is called again with `"a-1"`.
12. Update the existing **"uploads the final flushed segment on a graceful online stop"** test (line 373): replace
    `await engine.abort()` with `await engine.finish()`. Keep **"stop()/abort() returns promptly while offline"** as it is
    and add a twin that uses `finish()` (a `null` outage plus the 5 ms real sleep must also return in under 200 ms).

### 4.2 `lib/capture/browser/session-stop.test.ts`

Make the upload mock controllable: `hoisted.upload = vi.fn(() => new Promise<number | null>(() => {}))` and
`createSegmentUploader: () => hoisted.upload`. Reset it in `afterEach`, and call `abortAllCaptureUploads()` in `afterEach`.
The existing 6 tests stay as they are (default mode is finish).

1. **`stop({ mode: "hard" })` does not flush or upload.** `pushSpeech(5)`, advance 0, `stop({ mode: "hard" })`,
   advance 6 s. Expect `hoisted.upload` not called, the result `{ droppedCount: 0, queuedCount: 0 }`, and the mic track stopped.
2. **Finish keeps retrying a 503 after stop() settles.** `hoisted.upload.mockResolvedValue(503)`. `pushSpeech(5)`,
   advance 0, `stop()`, advance 6 s. The result resolves, and n = calls so far. Advance 60 s: the call count is now > n.
3. **`abortAllCaptureUploads()` ends a background drain.** Same setup as 2, then after 6 s call `abortAllCaptureUploads()`.
   Note the count (allow one already-scheduled retry by advancing 1 ms and re-reading), then advance 300 s. The count is
   unchanged.
4. **The finish drain ends at the budget.** Same setup as 2. Advance 300 s. The upload count stops growing (read it at
   300 s and at 400 s: equal). Optional: a second `startCaptureSession` + `stop()` shows that the first engine is gone
   from the registry (an `abortAllCaptureUploads()` call does not throw). Skip that part if it is awkward.

### 4.3 `app/capture/page.test.tsx` (add one new `describe` at the END of the file; do not edit the existing tests at lines 360-700, which feature/after-days touches)

The mock factory for `@/lib/capture/browser/session` gains
`abortAllCaptureUploads: () => abortAllCaptureUploads()` with a module-level `const abortAllCaptureUploads = vi.fn();`,
cleared in the existing `afterEach`/`beforeEach`. The new describe reuses `renderRunning`/`renderDemoRunning`/`advance`:

1. Selesai: `fakeSessions[0].stop` called with `{ mode: "finish" }`, and `abortAllCaptureUploads` not called.
2. Pilot auto-stop and sandbox 10:00 hard stop: `stop` called with `{ mode: "finish" }`.
3. Batalkan confirm: `stop` called with `{ mode: "hard" }`.
4. Sandbox sign-out before closing (the "running" dialog -> confirm): `stop` called with `{ mode: "hard" }`, then
   `abortAllCaptureUploads` called once, before navigation.
5. Sandbox sign-out after closing: `stop` called with `{ mode: "finish", drainMs: 15_000 }`, and `abortAllCaptureUploads`
   called after it (`stop.mock.invocationCallOrder[0] < abortAllCaptureUploads.mock.invocationCallOrder[0]`).
6. Unmount while running: `stop` called with `{ mode: "hard" }` and `abortAllCaptureUploads` called. Unmount after a
   Selesai (no running session): `abortAllCaptureUploads` called (the background drain is killed).
7. New Start after a Selesai: a second `startCaptureSession` call. `fakeSessions[0].stop` called exactly once (finish).
   `abortAllCaptureUploads` not called.

### 4.4 `app/capture/page-copy.test.tsx` and `app/capture/page-structure.test.tsx`

Add `abortAllCaptureUploads: vi.fn()` to their `vi.mock("@/lib/capture/browser/session", ...)` factories. A named
import that is missing from a `vi.mock` factory throws. No other change.

### 4.5 `lib/capture/retry.test.ts`: the deletions in §3.5 only.

## 5. Hard-rule check

- §2.2 audio: segment bytes stay only in the engine's in-memory queue, now for at most about 4 min after End (bounded by the
  finish deadline, sign-out and unmount). Nothing is written to IndexedDB, localStorage, Cloud Storage or any log. No new
  log line or event field. P3 (`NEXT_PUBLIC_DEVICE_AUDIO_QUEUE`) is untouched and stays off.
- §2.6 / §2.7: no new route, no Firestore access, no new id or name anywhere. The X-Session-Id stays the session's own
  (closure), and the server-side role/outlet/device checks are unchanged.
- §2.1 / §2.5: no model call change. The server route and transcribe retry are untouched.
- Demo cap: charged once per `seg_id`, so background retries are free (`route.ts` step 7b).

## 6. Risks

1. **Wake lock is released at End.** If the phone screen locks during the ~4 min background drain, the browser may
   throttle or freeze the tab and the retries pause. The debrief runs on the same page right after End, so the screen is
   normally on. We accept this and do not keep the wake lock. QA checks it on a real phone.
2. **Navigating away from `/capture` during the drain kills it** (unmount = hard abort, by Rangga's rule). The debrief is
   rendered inside `/capture` (`DebriefFlow`), so End -> debrief does not unmount. A judge who opens the supervisor
   view in the same tab within 4 min of End signs out first, which also hard-aborts. Accepted.
3. **Two engines PUT concurrently** after a quick new Start. Separate queues, ids and session ids; the server is idempotent per
   id. Low risk.
4. **Late note vs demo next-day jump.** A day-1 note that lands after a next-day jump carries day 1's session id. QA
   checks that it shows on day 1 (or is simply absent from the debrief), never on day 2. The accepted gap covers missing
   questions, not misfiling. If it files under day 2, stop and tell Rangga.
5. **Timers.** A woken `defaultSleep` still has its `setTimeout` pending (up to 30 s). It resolves into nothing.
   Harmless, unchanged from today.

## 7. Parallel with feature/after-days

Safe to build in parallel. feature/after-days touches `app/capture/page.tsx` only at about line 130 (2 added lines in the
refusal map), and the three page test files only in fixture `days_total` / day-line strings
(page.test.tsx hunks at about 163 and 662-692, 821 and 1168; page-copy at 228 and 261; page-structure at 54-164). This fix
touches the page's import, the stop call sites (372-964), the vi.mock factories (page.test.tsx at about 82-113,
page-copy at about 40, page-structure at about 38), and a new describe at the end of page.test.tsx. No shared hunk is
expected. Git should auto-merge, and whichever lands second rebases. Expected conflict files if any: `app/capture/page.tsx`
and `app/capture/page.test.tsx` (textual-adjacency only). No overlap in `lib/capture/*`, `lib/demo/*`, JudgeGuide or i18n.

## 8. Done when

- All tests in §4 pass. `npm run lint`, `npm run typecheck` and `npx vitest run` are clean (the pre-push hook).
- `grep -rn "nextUploadAction\|DEFAULT_MAX_ATTEMPTS" app lib scripts` returns nothing.
- QA on web-develop (fictional clips; three sandboxes in lockstep is the repro): during a 503 burst, a segment still
  retrying at End is delivered after End (supervisor day record has the closing note), or is shown as "Some speech was
  not captured" after about 4 min. Batalkan with a 503 queue: no PUT after the discard. Sign-out after closing: no
  segment PUT after the redirect to `/` (DevTools network). Dev panel (DEV-01) event log shows the post-End
  `segment_upload_result` events. No extension is needed: `onEvent` is not gated by `isCurrent`.
- Self-review checklist (CLAUDE.md §4). 360 px: no UI change.

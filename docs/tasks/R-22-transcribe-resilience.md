# R-22 — Transcribe resilience under a burst (QA round 3 finding O-7) + sandbox per-IP cap

Status: PLAN (tech-lead, Fri 16 Oct morning WIB). Baseline: `origin/main` 8214be6. Freeze: Sat 17 Oct 12:00 WIB.
Builder: PR-A and PR-B → `developer` (sonnet/Fable; logic + tests). PR-C → `developer-junior` (mechanical).
Skills to name in the briefs: `tdd-workflow`, `error-handling` (retries/backoff), `code-review` for the gate.

## 1. Facts (read from the code on origin/main, Cloud Run describe, QA round 3 §9)

### 1.1 What the server does on a Vertex 429 today
- `lib/transcribe/gemini.ts` makes ONE `generateContent` call with no `retryOptions`. The `@google/genai` 2.24 client only
  retries when `httpOptions.retryOptions` is set (node/index.mjs `apiCall`: `if (!retryOptions) return runFetch()`), so there is
  **no retry anywhere on the server**. Any thrown error (429, 5xx, timeout, network) becomes
  `ServiceUnavailableError("Transcription upstream unavailable", "transcribe", <status>)` → the route answers **503 immediately**.
- The 503 carries **no `Retry-After`** (`handleApiError` only adds it for `LockedError`/429).
- `AbortSignal.timeout(30_000)` bounds the single call.
- Order inside `PUT /api/v1/segments/{device}:{seg}` (route.ts): auth → path/device match → content-type → headers → body →
  size → **`enforceDemoCapsForRoute("segment", …)` (charges `segment_sandbox` 150 / `segment_day` 3000 / `model_day` 5000)** →
  `recordSegment` (tombstone check → idempotency `store.get` → transcribe → redact → `store.create`).
  So **every 503'd attempt still charges the demo caps**: the 81 failures in the burst cost ≈ 81 charges (≈ 20 per sandbox,
  13% of a sandbox's 150-segment budget) with nothing stored.
- Cloud Run `web` on `bee6-playground`: `maxScale 3, minScale 1, containerConcurrency 80, 1 CPU / 512 Mi, timeout 1800 s`.
  Not the bottleneck: 4 phones = at most 4 requests in flight. The 429 is Vertex-side (the preview model's shared/dynamic
  capacity on `global`; dev-ops is confirming whether any project quota exists to raise).

### 1.2 What the phone does on a 503
- `lib/capture/browser/engine.ts` `pump()`: the queue is **serialised** (one upload in flight per phone). `classifyUploadResult`
  (`lib/capture/retry.ts`): 429/5xx/null → retry; other 4xx → drop.
- Backoff: `backoffDelayMs(count, { jitter: false, maxMs: 30_000 })` → **500 ms, 1 s, 2 s, 4 s, 8 s — no jitter**. Only real
  429/5xx bump `serverErrorCount`; at `maxAttempts = 6` the head is **dropped** (`dropHead`), the audio (in memory only, hard
  rule 2) is gone, `lostSinceSuccess` turns true → UploadStatusLine shows "Some speech was not captured" + "That note is now
  incomplete. It cannot be recovered." (C-u-lost / C-u-lost-help). Before the drop the page already shows
  "Not sent yet · retrying (Nx)" + "Server busy" (C-u-retry / C-u-server; `online` and `httpStatus` ARE passed by
  `app/capture/page.tsx:1292-1303`).
- Time to give up on one segment ≈ 0.5+1+2+4+8 s of waits + 6 round trips (a 429 comes back in ~1 s) ≈ **20 s**.

### 1.3 Why 81 attempts for 17 successes (a self-inflicted retry storm)
- A healthy phone sends ~4 PUT/min (15 s segments). A failing phone sends 6 attempts in ~20 s ≈ 18 PUT/min: **4–5× amplification
  per phone**, and with no jitter the four phones (started within the same second) retry in lockstep.
- Burst window 18:34:05–18:35:52Z (107 s): 98 attempts ≈ 55 req/min offered to Vertex; 17 served ⇒ the preview model gave this
  project roughly 10 transcriptions/min in that window. 81 failures ≈ 13–14 segments × 6 attempts. Each failure also burnt a
  demo cap charge. Two phones (≈ 8 req/min offered) never hit the limit; round 2 with four phones did not either ⇒ variable
  shared capacity, not a fixed project quota we control.
- Nothing is retried after the drop; nothing is persisted (correct per hard rule 2 / P3 OFF). The loss is permanent by design.

## 2. Options (quick win vs ultimate)

| # | Option | Quick win | Ultimate | Verdict |
|---|---|---|---|---|
| A | **Server-side retry inside the request budget** (`gemini.ts`) | Own small loop around the existing `generate` seam: retry 429/500/502/503/504 with jittered exponential backoff, one shared 30 s deadline (details §3). Unit-testable with the existing fake. | Honour `Retry-After` — not possible: the SDK's `ApiError` exposes only `status`, no headers. Use the SDK's `httpOptions.retryOptions` instead — rejected: the retry would live inside the real client, invisible to our `generate` test seam (a fake bypasses it) and it ignores our deadline between sleeps. | **Build (PR-A).** Highest value: absorbs most 429s before the phone ever sees a 503, cuts wasted cap charges to 1 per segment. |
| B | In-process semaphore for transcribe calls | `maxInFlight = 6` per instance with a bounded wait | Global limiter via Firestore counter | **Defer.** The storm is request rate, not concurrency (≤ 1 in flight per phone). With A, B adds little; 3 instances make a per-instance limit weak anyway. |
| C | **Phone retry with jitter + a larger server-error budget** (`engine.ts`) | `jitter: true` (injectable `rng`), `maxAttempts` 6 → 8; everything else unchanged (B-4 semantics, `stopping` break, 10-min queue cap, in-memory only) | Honour `Retry-After` from the route (needs the `UploadFn` contract to return headers) | **Build (PR-B).** Small, kills the lockstep, gives one segment ~1 min of server-side-retried attempts instead of 20 s. Ultimate deferred. |
| D | Fallback location or model | — | — | **No.** `config/regions.yaml` lists `global` only for the transcribe model (the probe found it nowhere else); a second location would be a hard-coded literal (rule 5). A different model for transcription changes the stated stack and quality (CLAUDE.md §3). |
| E | A "busy, retrying" UX instead of "Some speech was not captured" | Already exists: `C-u-retry` + `C-u-server` show while retrying; `C-u-lost` only after a real drop, and it is true (the audio is gone). | — | **No copy change.** Add one line to the judge guide's `capture_ready` card only if Rangga wants it (§6). |
| F | Stagger guidance in the judge script | README / judge guide: "If several people start at the same time, start about a minute apart." | — | **Do (zero code, docs).** Also: Rangga/Tiffany must not run a rehearsal on the demo project while judges are on it. |
| G | Raise the quota | dev-ops checks `gemini-3.5-transcribe-preview` on `bee6-playground` | Provisioned Throughput | **dev-ops; probably no lever** for a preview model on shared capacity. Do not block on it. |
| H | Sandbox per-IP cap 10/UTC-day | Raise default to 30 + env `DEMO_SANDBOX_IP_CAP` | — | **Build (PR-C)**, see §5. |

## 3. PR-A — server-side retry in `lib/transcribe/gemini.ts` (developer, sonnet/Fable; ~1.5 h incl. tests)

### 3.1 Files
- `lib/transcribe/gemini.ts` (only file with logic), `lib/transcribe/gemini.test.ts` (tests). No route change.
  Optional one-line comment update in `app/api/v1/segments/[segment]/route.ts` header ("transcribe retries inside its 30 s budget").

### 3.2 Exact design
Add to `GeminiTranscriberDeps`:
```ts
/** Retry policy for transient upstream failures (429/5xx) inside ONE request. Defaults in TRANSCRIBE_RETRY. */
retry?: Partial<TranscribeRetryOptions>;
/** Injectable sleep (tests pass an instant one). */
sleep?: (ms: number) => Promise<void>;
/** Injectable RNG in [0,1) for jitter. */
rng?: () => number;
```
New exported constants/types (same file):
```ts
export interface TranscribeRetryOptions {
  /** Total attempts including the first. */
  attempts: number;          // default 4
  baseMs: number;            // default 1_000
  factor: number;            // default 2
  maxDelayMs: number;        // default 4_000
  /** Upstream HTTP statuses that are retried. Timeouts and everything else are NOT. */
  statuses: readonly number[]; // default [429, 500, 502, 503, 504]
  /** Per-attempt abort; the whole sequence is still bounded by `timeoutMs` (30 s). */
  attemptTimeoutMs: number;  // default 15_000
}
export const TRANSCRIBE_RETRY: TranscribeRetryOptions = { attempts: 4, baseMs: 1_000, factor: 2, maxDelayMs: 4_000, statuses: [429, 500, 502, 503, 504], attemptTimeoutMs: 15_000 };
```
Behaviour of `transcribe()`:
1. `const deadline = Date.now() + timeoutMs` (`timeoutMs` keeps its meaning: the TOTAL budget, default 30 s).
2. Loop `attempt = 1..attempts`:
   - Build `params` exactly as today but with `abortSignal: AbortSignal.timeout(Math.min(attemptTimeoutMs, deadline - Date.now()))`.
     Build the base64 string ONCE before the loop (`const data = input.audio.toString("base64")`) and reuse it; never log it.
   - `try { response = await generate(params, ctx); break; } catch (error) { … }`.
   - Classify as today into `upstream: number | "timeout" | "unknown"` (keep the existing extraction code; factor it into
     `function classifyUpstream(error: unknown): number | "timeout" | "unknown"`).
   - Retry only if `typeof upstream === "number" && statuses.includes(upstream) && attempt < attempts`.
   - `delay = jittered(min(maxDelayMs, baseMs * factor ** (attempt - 1)))` where jittered = `round(raw/2 + rng() * raw/2)`
     (same shape as `lib/capture/retry.ts backoffDelayMs`; do NOT import it — it is a browser-side module by convention; copy the
     4-line formula).
   - If `Date.now() + delay + 2_000 > deadline` → stop retrying (throw as today). Else `await sleep(delay)` and continue.
   - On giving up: `throw new ServiceUnavailableError("Transcription upstream unavailable", "transcribe", upstream)` — unchanged
     message, unchanged `stage`, `upstream` = the LAST failure's status.
3. Add ONE whitelisted log line per retried attempt: `console.warn("transcribe.retry", { attempt, upstream, delayMs })` — no
   message text, no body, no audio (hard rule 2). Nothing else is logged here.

Worst-case route latency: deadline 30 s + the per-attempt signal is always clipped to the remaining budget, so ≤ ~30 s (was 30 s).
Typical 429 case: attempts at t ≈ 0, 1, 3, 7 s → a segment that failed before now succeeds in < 8 s if capacity frees up.

### 3.3 Edge cases (handle exactly like this)
- Timeout (`AbortError`/"timeout") → NOT retried (budget spent); still 503 `upstream: "timeout"`.
- 400/401/403/404 from Vertex → not retried; 503 as today (`upstream: 400` etc.).
- Error with no `status` (network) → `"unknown"` → not retried (keep it simple; the phone retries the whole PUT).
- `attempts: 1` → identical to today's behaviour (one call, no sleep).
- Success on attempt k → result identical to today (`text`, tokens, `model`, `location`); nothing records k.
- Empty text on success is still a valid result (unchanged).
- The route's demo-cap charge happens once per PUT regardless of retries (no code change; state it in the PR body).

### 3.4 Tests (`gemini.test.ts`, vitest, fake `generate` + instant `sleep` + fixed `rng`)
1. "retries a 429 then succeeds": generate throws `{status: 429}` twice, then returns text → result text; `generate` called 3×;
   `sleep` called with [1000·j, 2000·j] where j is the rng-derived jitter (use `rng: () => 1` → exact 1000, 2000).
2. "gives up after `attempts` and throws the sanitised 503 with the last upstream status": 4 × `{status: 503}` → throws
   `ServiceUnavailableError`, `.stage === "transcribe"`, `.upstream === 503`, `.message` has no "fake-opus-bytes"/base64.
3. "does not retry a 400": one call, throws, `sleep` never called.
4. "does not retry a timeout": `AbortError` → one call, `upstream === "timeout"`.
5. "stops early when the deadline would be exceeded": `timeoutMs: 1500`, first error 429 → no sleep, throws after 1 call.
6. "jitter is within [raw/2, raw]": `rng: () => 0` → 500; `rng: () => 0.999` → ≈ 1000.
7. Existing tests must pass unchanged (params shape, VERBATIM, vocabulary, location from resolver, no API key).
8. `route.test.ts` "returns 503 when transcriber throws ServiceUnavailableError" stays green (it injects its own transcriber).

### 3.5 Hard-rule check (PR-A)
1 Google-only: still `@google/genai` Vertex mode, ADC. · 2: the same in-memory `Buffer`/base64 string is reused for a retry inside the
request and dropped with it; the retry log line carries `{attempt, upstream, delayMs}` only. · 4: unchanged SA. · 5: location still
from `getModelLocation`; no fallback literal. · 6: route unchanged. · 11: one commit `feat(r-22): retry transient transcribe failures
inside the request budget`.

## 4. PR-B — phone backoff jitter + larger server-error budget (developer; ~1 h incl. tests)

### 4.1 Files
`lib/capture/browser/engine.ts`, `lib/capture/browser/engine.test.ts` (+ `engine-http-status.test.ts` only if an expectation on the
drop count changes). No change to `retry.ts`, `queue.ts`, `client.ts`, `UploadStatusLine.tsx`, copy keys.

### 4.2 Exact changes
- `CaptureEngineOptions` gains `rng?: () => number` (default `Math.random`). Store as `private readonly rng`.
- `this.maxAttempts = options.maxAttempts ?? 8` (was 6). Update the class doc comment ("gives up after `maxAttempts` server errors").
- In `pump()`: `backoffDelayMs(this.headAttempt.count, { jitter: true, rng: this.rng, maxMs: MAX_BACKOFF_MS })`.
  Keep `baseMs` 500 / factor 2 (defaults). Sequence with `rng = 1`: 500, 1 s, 2 s, 4 s, 8 s, 16 s, 30 s → ~62 s of waits over 8
  attempts, each attempt now also held up to ~30 s by the server's own retry. Keep everything else byte-for-byte: B-4 (null never
  counts), `stopping` break, `dropHead`, `lostSinceSuccess`, `headFailedAttempts`.
- Do NOT touch `createSegmentUploader` (status-only contract) or the 10-min queue cap.

### 4.3 Tests
- Existing "gives up after maxAttempts on a repeated SERVER error" and the B-4 pair: pass `maxAttempts` explicitly if they rely on 6,
  or update expected drop point to 8 (prefer explicit option so the default can move again).
- New: "default maxAttempts is 8" (7 × 503 → still queued; 8th → dropped, `droppedCount` 1).
- New: "backoff is jittered": capture `sleep` ms with `rng: () => 0` → 250, 500, 1000…; `rng: () => 0.999` → ≈ 500, 1000, 2000…
- New: "network null still never consumes the server budget" (regression guard, 20 × null then 1 × 503 → not dropped).

### 4.4 Hard-rule check (PR-B)
2/2a: audio stays in page memory only, P3 unchanged (`NEXT_PUBLIC_DEVICE_AUDIO_QUEUE` untouched). Nothing else touched.

## 5. PR-C — sandbox per-IP cap: 10 → 30 per UTC day + env override (developer-junior; ~45 min)

### 5.1 Assessment
`SANDBOX_IP_DAILY = 10` (`lib/demo/constants.ts:34`), applied in `lib/demo/service.ts:131` (`bumpCounter(ipBucketKey(ip, day, salt), "sandbox_ip", day, SANDBOX_IP_DAILY, …)`), with **no env override** (the route only overrides `DEMO_SANDBOX_DAILY_CAP` and `DEMO_SWITCH_IP_CAP`, `app/api/v1/demo/session/route.ts:84-86`). A judging panel behind one office NAT shares one key: ~5–8 judges, each 1–3 sandboxes (a reload loses the key and creates a new sandbox; "Reset the demo" does not), plus Rangga/Tiffany if on the same network ⇒ 15–25 in a day. **10 is too low; a refused judge sees "Too many demo sessions from this network today" (429 `rate_limited`) and is stuck.** The UTC day rolls at 07:00 WIB, so one morning panel is one bucket. Spend stays bounded by the global caps (300 sandboxes/day, 3000 segments/day, 5000 model calls/day), so the per-IP cap is anti-single-abuser only.

Proposal: default **30**, env **`DEMO_SANDBOX_IP_CAP`** (not killable — same rule as `DEMO_SWITCH_IP_CAP`), so dev-ops can set 60 on the judging day without a deploy.

### 5.2 Exact changes
- `lib/demo/constants.ts`: `export const SANDBOX_IP_DAILY = 30;` (comment: "R-22: 30 (was 10): a judging panel behind one NAT").
- `lib/demo/service.ts`: `caps?: { sandboxDaily?: number; switchIpDaily?: number; sandboxIpDaily?: number }`;
  in `createSandbox`: `const ipCap = deps.caps?.sandboxIpDaily ?? SANDBOX_IP_DAILY;` and use `ipCap` in the `bumpCounter` call.
- `app/api/v1/demo/session/route.ts:84-86`: add `sandboxIpDaily: capFromEnv(process.env.DEMO_SANDBOX_IP_CAP, SANDBOX_IP_DAILY)`
  (import `SANDBOX_IP_DAILY` from constants).
- `lib/demo/caps.ts` doc comment listing NOT-killable env caps: add `DEMO_SANDBOX_IP_CAP`.
- README env table: add `DEMO_SANDBOX_IP_CAP` (default 30). CLAUDE.md §6 is Rangga's/PM's edit (list it in the PR body).

### 5.3 Tests
- `lib/demo/service.test.ts`: "the 31st sandbox from one IP in a UTC day is refused with 429 rate_limited; the 30th is issued"
  (memory store); "caps.sandboxIpDaily: 2 refuses the 3rd".
- `app/api/v1/demo/session/route.test.ts`: env `DEMO_SANDBOX_IP_CAP=2` → 3rd request from the same XFF → 429 `rate_limited`;
  garbage value → default 30 (via `capFromEnv`).

## 6. Zero-code items
- Judge guide / README: one sentence — "If several people start at the same time, start about a minute apart; the transcription
  service shares capacity." Where: `lib/demo/guide.ts` `capture_ready` card body (needs Rangga's wording OK; it is copy) and the
  README judge section. QA round 3 §11 item 5 already says this for Rangga.
- Judging day: nobody runs `npm run demo:*` rehearsals or the fake-mic harness on `bee6-playground` while judges are on it.
- dev-ops: report the `gemini-3.5-transcribe-preview` quota page for `bee6-playground`; set `DEMO_SANDBOX_IP_CAP=60` after PR-C
  deploys; optional `DEMO_SEGMENT_SANDBOX_CAP=200` is NOT needed once PR-A stops the wasted charges.

## 7. How to test end to end (after PR-A deploys to develop)
1. Fake 429: unit tests above (the `generate` seam). No product-code fault injection (no env flag): keep the product clean.
2. Controlled load (QA, read-only on prod data, demo project only): the R-19 PR-R fake-mic rehearsal harness (the `drv-*.log` setup
   QA used in round 3), **N = 4 then N = 6** phones starting `day1.wav` in the same second; one run each.
   Pass: 0 × "Some speech was not captured" on every phone; Cloud Run `segment.upstream_unavailable` may appear only with
   `transcribe.retry` lines before a 200; 7/7 lines heard per phone. Record: 503 count, `transcribe.retry` count, max PUT latency.
   Spend: 6 phones × ~7 segments ≤ 15 s = ~42 transcribe calls (~20k audio tokens) + 42 SDP calls + label ticks ⇒ **cents, not
   dollars**, and 42 of the 3000 daily segment cap. Sandbox creation: 10 per IP per run-day today (PR-C lifts it).
3. Regression: `npx vitest run lib/capture lib/transcribe app/api/v1/segments lib/demo` + the pre-push hook. Live: one real phone
   on `/capture` reads a card, End today → debrief question appears (R-20/R-21 path unchanged).

## 8. Must not break
- Segment idempotency (`store.get` before transcribe; `already_exists` success) and the discard tombstone (R-20) — untouched.
- The 15 s cap (`batcher.ts maxSegmentMs 15_000`) — untouched. `SegmentMetadataSchema`, headers, `X-Session-Id` — untouched.
- UploadStatusLine semantics (retrying/server busy/lost/toast) — untouched; only the timing of a drop changes.
- B-4 (offline nulls never consume the server budget), `stopping` break, 10-min queue prune — untouched.
- DLP path: unchanged (its own 30 s timeout; no retry added in this task).

## 9. Order, estimates, routing
PR-A (sonnet/Fable, 1.5 h) → deploy develop → QA load N=4/6 (0.5 h) → PR-B (sonnet, 1 h) → PR-C (haiku, 0.75 h) → docs/guide line.
Total ≈ 4–5 h agent time; all three fit before Sat 12:00. If time is short: PR-A alone removes most of the risk; PR-C is a
10-minute change and should not be skipped (a refused judge is a dead end).

## 10. Rangga decisions
1. Go on PR-A / PR-B / PR-C in that order before the freeze?
2. Per-IP cap: default 30 + `DEMO_SANDBOX_IP_CAP` (dev-ops sets 60 on judging day)?
3. The guide/README stagger sentence (copy) — approve wording.
4. Accept that a genuinely dropped segment still reads "Some speech was not captured" (true statement; no copy change)?
5. OK to spend cents on one 6-phone load run on `bee6-playground` today?

## R-22 reviews

Tech-lead review (Fri 16 Oct, read-only). Branches: PR-A `feature/r-22-server-retry` 7fa5406 · PR-B `feature/r-22-phone-jitter`
11439ed · PR-C `feature/r-22-ip-cap-copy` bd630c3, each on `origin/main` 8214be6.

**Integration:** `git merge-tree --write-tree` A → B → C onto origin/main: three clean trees (no conflicts; the PRs touch disjoint
files; dangling commit 8e99c7f, no refs moved). On the merged tree: `tsc --noEmit` clean · `vitest run` 321 files, 5245 passed,
1 skipped · eslint clean on every changed file.

### PR-A — PASS-WITH-NOTES (hard rules: pass)
Matches §3.2 exactly: shared deadline, per-attempt `min(15 s, remaining)`, headroom check `now + delay + 2000 <= deadline`,
jitter `round(raw/2 + rng·raw/2)`, statuses `[429,500,502,503,504]`, timeout/400/no-status not retried, base64 built once and
never logged, final error byte-identical to today's `ServiceUnavailableError("Transcription upstream unavailable","transcribe",
upstream)`, log line exactly `{attempt, upstream, delayMs}` (tested against a base64 leak). The edited existing test (instant
`sleep` + `console.warn` mock) is fine: it now exercises 4 × 503 and still asserts the sanitised 503.
- Route interplay (verified, no change needed): `enforceDemoCapsForRoute` runs at step 7b before `recordSegment`, so a PUT is
  charged once however many server-side attempts it makes. The phone's uploader has **no fetch timeout** and the engine queue
  is serialised, so a 30 s PUT is simply awaited: no duplicate in-flight PUTs, no double `recordUsage` (logged only after
  `store.create`). A phone retry after a 503 finds nothing stored and transcribes again (that is the retry, not a duplicate);
  the discard tombstone path is unchanged (`create()` → `discarded`). Worst case 30 s per PUT vs the 1800 s Cloud Run timeout.
- Amplification judgement: worst case 8 phone × 4 server = 32 upstream calls per segment (was 6). Per phone under a sustained
  429: before, 6 calls in ~20 s (~18/min, then the segment is lost); after, 32 calls over ~2 min (~62 s jittered waits + 8 × ~8 s
  server sequences, ~16/min). Instantaneous offered rate is about equal, it lasts ~6× longer, and the phone-side jitter
  decorrelates the four phones. The 429 is capacity-shaped (≈ 10 served/min in round 3), so this trades latency for
  success rather than worsening contention. Acceptable. If the N=6 load run shows no improvement, reduce the server `attempts`
  to 3 first (0/1/3 s), not the phone's 8.
- Note (pre-existing, not a fix): `classifyUpstream` returns `"timeout"` for any Error whose message contains "timeout" even
  when it carries a numeric status, so a 504 with "timeout" in its text is not retried. Same precedence as before the PR.

### PR-B — PASS-WITH-NOTES (hard rules: pass)
Matches §4.2: `rng` injected (default `Math.random`), `maxAttempts` default 8, `jitter: true` with `MAX_BACKOFF_MS` 30 s
unchanged, B-4 null semantics, `stopping` break, `dropHead`, 10-min queue cap all untouched (tests cover each).
- `lib/capture/retry.ts` `DEFAULT_MAX_ATTEMPTS = 6` is used only by `nextUploadAction` (and its test), which the engine does not
  call: dead-code drift, not a bug. Optional one-line bump to 8 (the test reads the constant symbolically); plan §4.1 said "no
  change to retry.ts", so leaving it is also fine. Rangga's call.
- "A couple of minutes" claim: worst case per stuck head ≈ 31–62 s of jittered waits + 8 × ≤ 30 s server time ≈ up to 5 min.
  The 10-min queue cap counts audio duration, so a 5-min stall accumulates ~5 min of segments and prunes nothing; on the
  sandbox the session hard-stops at 5 min anyway.
- End / Selesai / auto-stop: `confirmSelesai` and the auto-stop call `stopRunningSession()` without awaiting, and the debrief
  card appears synchronously (tests), so a long retry never delays the debrief. `engine.abort()` lets the in-flight PUT finish
  (the fetch is not aborted, up to 30 s now) and then breaks the pump: anything queued behind a stuck head is abandoned
  silently (not counted as dropped, no "not captured" line). Pre-existing R-19 behaviour; only the demo sign-out waits (15 s).
  PR-B widens the window in which End can catch a segment mid-retry from ~20 s to ~5 min under a sustained 429. For Rangga
  to accept (it only matters while Vertex is actually refusing).

### PR-C — PASS-WITH-NOTES (hard rules: pass; README adds no secrets)
Matches §5.2/§5.3: `SANDBOX_IP_DAILY = 30`, `caps.sandboxIpDaily` in `createSandbox`, route uses `capFromEnv(DEMO_SANDBOX_IP_CAP,
SANDBOX_IP_DAILY)` (bad value / `0` → 30, same as `DEMO_SWITCH_IP_CAP`), caps.ts doc comment, service and route tests for the
30th/31st, env = 2 and garbage. Existing 10-based tests updated consistently.
- Guide copy: `GuideCardSchema` allows 4 body lines of ≤ 240 chars, so the sentence was appended to the 4th line (165 chars,
  validated at module load; `guide.test.ts` "capture_ready has 4 body lines" still passes). On 360 px it wraps to ~6 lines
  inside the collapsed guide: acceptable. Bahasa column stays `same()` (provisional, file convention). Tone is fine for judges;
  "the transcription service shares capacity" is slightly technical — optional shorter form: "Starting together with others?
  Start about a minute apart." Wording is Rangga's decision (§10.3).
- CLAUDE.md §6 env list still needs `DEMO_SANDBOX_IP_CAP` (PM edit, as the plan said).

Required fixes: none on any PR.

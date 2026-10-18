# Transcribe timeout: server-side handling of a slow `gemini-3.5-transcribe-preview` call (18 Oct)

Status: DESIGN + PLAN (tech-lead, Sun 18 Oct). Read-only pass against `origin/develop` e01621e (`git show`, no
checkout). Companion to `docs/tasks/segment-503-unlock-18oct.md` (the guide hint, shipped as #122) and the dev-ops
log trace of `web-develop`. Rangga approved the follow-up; this doc decides it.

## 0. Decision in one paragraph

**Option A, tuned: per-attempt abort 15 s → 10 s, and a per-attempt timeout is retried once inside the request
(same 2-attempt bound, same 30 s total budget, same 0.5–1 s jittered wait).** One file of product code
(`lib/transcribe/gemini.ts`), one test file, no route, cap, store or client change. It is not demo-only: the pilot
runs the same code and has the same defect, and the change is behaviour-neutral in the capacity (429) regime where
the load tests live. My earlier objection ("retry doubles model calls exactly when the model is slow") is withdrawn
for A with the numbers in §2: the timeout retry fires in the *hung-call* regime (0 timeouts among 397 503s under
load; 10 of 186 on a single quiet phone), where the next call is usually fast, and it replaces a client re-send the
phone already makes today, so the net extra model load is ≈ +1 %. It still applies to option B (hedging), which is
why B is rejected. Safe to ship to `develop` → `web-develop` today after the §5 replay; `main` with the next
release once the §5 numbers are in.

## 1. Facts this decision rests on (verified vs. given)

| Fact | Source | Status |
|---|---|---|
| Per-attempt abort `attemptTimeoutMs = 15_000`; `attempts: 2`; 429/5xx retried once after a jittered 0.5–1 s; a `"timeout"` is **not** retried (`retryable` needs a numeric status); total `timeoutMs` 30 s; `MIN_ATTEMPT_HEADROOM_MS` 2 s; the per-attempt signal is clipped to what is left of the budget | `lib/transcribe/gemini.ts` @ e01621e | verified |
| The SDK honours `config.abortSignal`: `@google/genai` 2.24.0 creates a fresh per-attempt signal (`createAttemptSignal`) and passes it to `fetch`, so our abort really cancels the HTTP call | `node_modules/@google/genai/dist/node/index.mjs` ~13394, ~13825 | verified |
| The SDK's own retry is **off** unless `httpOptions.retryOptions` is set (`apiCall`: `if (!retryOptions) return runFetch()`); we never set it, so nothing stacks under ours. Consistent with the load test (every 429 answered in ~1.2 s, never 5 SDK attempts) | same file ~13854; `QA-load-test-16oct-round2.md` §1 | verified |
| Cloud Run `web`: `containerConcurrency 80`, request timeout 1800 s, 1 CPU / 512 Mi, minScale 1 / maxScale 3 | `docs/tasks/R-01-gcp-state.md` (16 Oct) | from the doc, not re-checked live |
| Phone: the PUT `fetch` has **no client-side timeout** (`lib/capture/browser/client.ts createSegmentUploader`); strict FIFO single pump; first retry after 250–500 ms; a head is dropped only on a server status after `HEAD_BUDGET_MS` 240 s; `null` (network) never counts | `client.ts`, `engine.ts`, `segment-503-unlock-18oct.md` §2 | verified |
| Idempotency: `recordSegment` reads `store.get(key)` **before** transcribing and `store.create` answers `already_exists` as success → one Firestore doc per `seg_id`; an in-request retry is one `transcribe()` call → one write; a client re-send of the same `seg_id` after a 503 transcribes **again** (nothing was written) — harmless to data, one more model call | `lib/capture/segment-service.ts` | verified |
| Demo caps: `enforceDemoCapsForRoute("segment", …, "charge", { id: seg_id })` runs **once per PUT, before** `recordSegment`; so attempts inside one request are free by construction, and a client re-send of the same `seg_id` is free up to `SEGMENT_FREE_RETRIES` 30 (R-23). `MODEL_DAILY` counts model-calling **requests**, not model calls | `route.ts` step 7b, `lib/demo/caps.ts`, `lib/demo/constants.ts` | verified |
| `recordUsage` logs the tokens of the **successful** attempt only; an aborted attempt's tokens are unknown to us | `segment-service.ts`, `gemini.ts` | verified |
| Model latency on `web-develop` (200s only): median 1.56 s, p95 4.4 s, p99 11.2 s; **10 of 186 PUTs (5.4 %) hit the 15 s abort** (`upstream:"timeout"`); each recovered by the phone's re-send after 16–31 s | the brief / dev-ops trace | **given, not re-derived**: I could not find the trace under `docs/`; the numbers are taken as reported |
| Load tests (N=4..8): 397 × 503, **all** `upstream: 429`, 503 p50 1.2 s, **0 timeouts**; served ~8–12 transcriptions/min project-wide | `QA-load-test-16oct-round2.md` §1 | verified |
| Segment length ≤ 15 s (`maxSegmentMs`), so audio seconds per call ≤ 15; `config/regions.yaml` has the model on `global` | `lib/capture/batcher.ts`, `config/regions.yaml` | verified |
| Vertex quota / rate row for the preview model; whether Vertex bills an aborted request | — | **unknown** (R-23 §8: no quota row, dynamic shared quota; nothing to verify from here) |

Two regimes follow from the two data sets, and they do not overlap:
- **Capacity regime** (load tests): the model *refuses* fast (429 in ~1.2 s). A timeout never happens; a timeout
  retry never fires. Our 429 handling (R-23) is untouched by this design.
- **Hung-call regime** (quiet single phone on `web-develop`): the model neither answers nor refuses. Successes have
  p99 = 11.2 s while 5.4 % of calls exceed 15 s, i.e. the distribution is bimodal — a *hang*, not a slow tail. The
  evidence that the next call is cheap: every one of the 10 recovered on the phone's first re-send, in 16–31 s
  total = 15.3 s + 0.25–0.5 s backoff + a 1–15 s second call.

## 2. The numbers per option

Notation: h = hang rate ≈ 5 % (given); a fresh call after a hang behaves like any call (median 1.6 s); the phone's
first backoff is 250–500 ms; a 429 answers in ~1.2 s.

| | D: as is (15 s abort, no timeout retry) | **A: 10 s abort + 1 in-request timeout retry** | A at 8 s | B: hedge at ~6 s, first call kept | C: A, demo only |
|---|---|---|---|---|---|
| Hung segment, time to 200 as seen by the phone | 15.3 s **503** + 0.25–0.5 s + ~1.6 s ≈ **17–20 s** typical, 31 s seen | 10 s + 0.5–1 s + ~1.6 s ≈ **12–13 s, no 503** | ~10–11 s | ~6 + 1.6 ≈ **7.6 s** | demo: as A; pilot: as D |
| What the judge/staff sees on a hang | "Not sent yet · retrying (1x)" + guide "catching up" | nothing (a slightly longer "Uploading") | same | same | split |
| Double hang (h² ≈ 0.25 %) | 503 at 15.3 s, re-send | 503 at ~21–22 s (6 s later than today), then re-send; phone budget unaffected (240 s) | 503 at ~17.5 s | 503 at ~15–30 s depending on the second | split |
| False aborts (a success that would have landed between the abort and 15 s) | 0 | ~1 % (p99 11.2 s; the 10–15 s slice is thin); each costs one extra call and ~12.6 s instead of 10–15 s | ~2 % (the 8–15 s slice) | 0 (the first call is kept) | as A |
| Extra model calls vs. one per segment | **+5 %** today already (the phone's re-send) | +5 % (hangs) +1 % (false aborts), **minus** the 5 % re-sends that no longer happen ⇒ **≈ +1 % net** | ≈ +2 % net | +3–5 % **concurrent** second calls on every call > 6 s, both billed, both occupying model capacity at the same moment | split |
| Behaviour in the capacity (429) regime | unchanged | **unchanged** (a 429 comes back before any timeout; `attempts: 2` bounds 429+timeout mixes to 2 calls) | unchanged | **worse**: a hedge at 6 s can turn one 429 into two refused calls under the exact burst the load tests fear | as A on demo |
| Held Cloud Run slot per request | ≤ 15 s + 30 s DLP | ≤ 21 s + 30 s DLP; 1 of 80 per instance; ≤ 8 phones ⇒ irrelevant | same | same | same |
| Demo caps / `MODEL_DAILY` for a retried call | re-send free (R-23 marker) | in-request retry free by construction; marker path unchanged | same | same | same |
| Code / tests | 0 | 1 file + tests, ~1 h, `developer-junior`-shaped except the abort test | same | 2 AbortControllers, `Promise.race`, loser cancel, 2× test surface; ~3 h; `developer` | A + a `DEMO_MODE` read inside `lib/transcribe` (pilot-shared file) |
| Hard rules | — | none touched (same client, same ADC, same `getModelLocation`, same whitelisted log, same in-memory payload) | same | same | same |

Why 10 s and not 8 or 12: 8 s doubles the false-abort slice (p95 is 4.4 s, so 8–10 s still holds ~1 % of
legitimate successes) for a 2 s gain on 5 % of segments; 12 s puts a hung segment's recovery at ~14.6 s, which
is barely better than today's 15.3 s 503 and loses most of the point. 10 s keeps the whole worst-case sequence at
10 + 1 + 10 = 21 s, inside the 30 s budget with the 2 s headroom rule unchanged, and inside the phone's own picture
(no client timeout exists, so the phone simply sees a longer PUT).

Why not B: it is the only option that *adds concurrent* model calls at the moment the model is slow, which is the
objection I raised in `segment-503-unlock-18oct.md` §4(b) and it stands for B. Its gain over A is ~5 s on 5 % of
segments, bought with the most code and the only behaviour change in the 429 regime. Revisit only if §5 shows the
hang rate well above 10 % **and** the hung calls are not reproduced by a fresh call.

Why not C: the pilot has the identical defect (same route, same model, same 15 s abort); a `DEMO_MODE` branch in
`lib/transcribe/gemini.ts` would make a pilot-shared file read a demo-only env for no pilot benefit, and would keep
the pilot's staff seeing a transient error on 5 % of segments. A is neutral where it does not help and strictly better
where it does, so it should ship to both.

Why not D: the guide hint (#122) tells a judge what to do after 45 s, but 5 % of segments still flash "Not sent yet"
and hold the FIFO head ≥ 15 s; the next segment behind it waits the same 15 s. The fix is an hour.

## 3. Exact change (one PR; `developer-junior` for 3.1–3.3, `developer` (sonnet) only for test 6 in 3.4)

### 3.1 `lib/transcribe/gemini.ts`
1. `TranscribeRetryOptions`: add one field after `attemptTimeoutMs`:
   ```ts
   /**
    * 18 Oct: a per-attempt timeout is retried too (within `attempts`). The model sometimes hangs rather than
    * refuses (5 % of calls on a quiet phone exceeded 15 s while p99 of successes was 11 s); a fresh call is
    * usually fast, and the phone would re-send the same audio anyway. A 429 burst never reaches this branch.
    */
   retryTimeout: boolean;
   ```
2. `TRANSCRIBE_RETRY`: `attemptTimeoutMs: 15_000` → `10_000`; add `retryTimeout: true`. Everything else unchanged
   (`attempts: 2`, `baseMs: 1_000`, `factor: 2`, `maxDelayMs: 4_000`, `statuses`).
3. Add an injectable clock to `GeminiTranscriberDeps`:
   ```ts
   /** Clock for the total budget; defaults to Date.now. Injectable for tests. */
   now?: () => number;
   ```
   and in `geminiTranscriber`: `const now = deps.now ?? Date.now;` then replace the three `Date.now()` calls
   (`deadline`, the abort clip in `buildParams`, the headroom check) with `now()`.
4. The retry predicate in the `catch` becomes:
   ```ts
   const upstream = classifyUpstream(error);
   const retryable =
     attempt < retry.attempts &&
     (upstream === "timeout"
       ? retry.retryTimeout
       : typeof upstream === "number" && retry.statuses.includes(upstream));
   ```
   The wait, the headroom rule (`now() + delayMs + MIN_ATTEMPT_HEADROOM_MS <= deadline`) and the sanitised
   `ServiceUnavailableError(…, "transcribe", upstream)` are unchanged. A timeout on the **last** attempt still throws
   `upstream: "timeout"` → the route's 503 → the phone re-sends, exactly as today.
5. The retry log line gains one whitelisted number so §5 can measure attempt latency from logs alone:
   `console.warn("transcribe.retry", { attempt, upstream, delayMs, elapsedMs: now() - started })` where
   `const started = now();` is set next to `deadline`. No message, no body, no text (hard rule 2).
6. Doc comment (the "A ~30 s TOTAL budget (R-22)…" paragraph): replace the last sentence with: "A per-attempt timeout
   (10 s) is retried the same way (18 Oct: the preview model sometimes hangs instead of refusing; the next call is
   usually fast). The sequence is bounded by `attempts` (2) and the 30 s budget: at most 10 + 1 + 10 s. Any other
   failure is not retried, so the route still answers 503 within ~30 s and the phone retries."

### 3.2 No other product file changes
`app/api/v1/segments/[segment]/route.ts` (the cap charge is already once per PUT, before the model call),
`lib/capture/segment-service.ts` (one `transcribe()` → one write), `lib/demo/*`, `lib/redact/dlp.ts` (its own 30 s
budget; unchanged), `lib/capture/browser/*` (the phone sees a longer PUT, nothing to change): **untouched**. The
`docs/tasks/segment-503-unlock-18oct.md` §4(b) row is superseded by this doc; add one line there pointing here.

### 3.3 Config/infra
None. No env var, no `config/regions.yaml` change, no Cloud Run flag. (Judging-window min/max instances is a
separate open dev-ops item; a 21 s held request at concurrency 80 does not move it.)

### 3.4 Tests — `lib/transcribe/gemini.test.ts` (extend the "retry (R-22 PR-A)" describe or add
"timeout retry (18 Oct)"; reuse `flakyGenerate` / `build`; `rng: () => 1` so a 1 s base wait is exactly 1000)
1. **"retries a per-attempt timeout once by default"**: `flakyGenerate([new DOMException("aborted","AbortError")])`
   → resolves `{ text: "flat white" }`; `calls.length === 2`; `sleeps` equals `[1000]`; `console.warn` called once
   with `expect.objectContaining({ attempt: 1, upstream: "timeout", delayMs: 1000, elapsedMs: expect.any(Number) })`
   and nothing else in that object (assert the key set is exactly `attempt, upstream, delayMs, elapsedMs`).
2. **"a timeout then a timeout throws after exactly 2 calls with upstream 'timeout'"**: two AbortErrors → rejects
   `toMatchObject({ stage: "transcribe", upstream: "timeout" })`, `calls.length === 2`, `sleeps` `[1000]`.
3. **"retryTimeout: false keeps the pre-18-Oct behaviour"**: the existing "does not retry a timeout" test gets
   `retry: { retryTimeout: false }` and is otherwise unchanged (1 call, no sleep).
4. **"attempts bounds 429 and timeout together"**: `[{ status: 429 }, AbortError]` → rejects `upstream: "timeout"`,
   `calls.length === 2`, one sleep.
5. **"the budget: a 10 s first attempt leaves room for the retry at 30 s but not at 12 s"** (fake clock via `now`):
   `let t = 0; const now = () => t;` a generate whose first call does `t += 10_000` then throws AbortError, second
   returns text; sleep does `t += ms`. With `timeoutMs: 30_000` → 2 calls, text. With `timeoutMs: 12_000` → rejects
   `upstream: "timeout"` after 1 call and no sleep (10 000 + 1 000 + 2 000 headroom > 12 000). This pins the headroom
   rule for the new branch.
6. **"the real abort fires and is retried"** (`developer`, real timers, no fake clock): `retry: { attemptTimeoutMs: 20 }`,
   `sleep` instant; generate call 1 returns `new Promise((_, reject) => params.config!.abortSignal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))` (never resolves on its own), call 2 returns text.
   Expect text, `calls.length === 2`, and the test finishes well under 1 s. This proves the `AbortSignal.timeout` clip
   is what turns a hang into the retry (vitest fake timers do not patch `AbortSignal.timeout`, so this one must stay
   on real timers — say so in a comment).
7. **"default constants"**: `TRANSCRIBE_RETRY.attemptTimeoutMs === 10_000`, `retryTimeout === true`,
   `attempts === 2`.
8. The existing "reuses the same base64 payload on every attempt and gives each attempt a fresh abort signal within
   budget", "logs only {attempt, upstream, delayMs}…" (update its expected key set to include `elapsedMs`), the leak
   tests and the R-23 "default is 2 attempts" test stay green unchanged.

`lib/capture/segment-service.test.ts`, one test: **"a transcriber that recovers internally still stores once and logs
usage once"**: a fake transcriber whose `transcribe` resolves after an internal delay (just `await Promise.resolve()`
twice) → `store.create` called exactly once, `recordUsage` once, result `stored`. Tautological today but it pins the
contract that the retry lives *inside* `transcribe()`.

`app/api/v1/segments/[segment]/route.demo-caps.test.ts`: **no new test** — the route mocks the whole transcriber, so an
internal retry is invisible to it; the existing "a transcriber 503 then a retry of the same seg_id spends one charge,
not two" already pins the once-per-PUT charge, which is the property that makes in-request attempts free.

### 3.5 Hard rules touched (self-review line for the PR)
1 (Google only): same `GoogleGenAI` Vertex client, ADC. 2 (no audio persisted/logged): the same in-memory base64 is
reused by the second attempt and dropped with the request; the new `elapsedMs` is a number; the error stays the fixed
sanitised message. 5 (regions): `getModelLocation` unchanged. 11: one commit `fix(transcribe): retry a per-attempt
timeout once, 10 s abort`. Nothing else is touched.

## 4. Risk to the pilot path

The pilot uses the same `PUT /api/v1/segments` → `recordSegment` → `geminiTranscriber()`; there is no demo branch in
`lib/transcribe`. Effects on the pilot: (i) a hung call now recovers in ~12 s without a 503 instead of ~17–31 s with
one; (ii) a success that would have taken 10–15 s is aborted and redone once (~1 %, cost +1 call, ~neutral latency);
(iii) a double hang gets its 503 ~6 s later than today. No change in the 429 regime, no data-shape change, no cap
change (the pilot has none). Keep it pilot-shared; do **not** gate on `DEMO_MODE`. The pilot deploy is out of scope
today anyway (`main` moves only on Rangga's go), so the pilot sees this with the next release, after the §5 numbers.

## 5. Eval before `main` (demo project `bee6-playground`, `web-develop`; QA, Fable; read-only Firestore; cents)

Harness: the round-4 Playwright harness (`r4/`, fake microphone, fictional clips) used for
`QA-load-test-16oct-round2.md`, unchanged. Baseline = the dev-ops trace at `web-develop-00053-bkq` (186 PUTs, 10
timeouts, median 1.56 s / p95 4.4 s / p99 11.2 s) plus, if dev-ops still has it, the same query re-run on that window
with the fields below so both sides are measured the same way.

Runs (same clips, same order, a fresh sandbox each):
1. **Quiet**: N=1 phone, 3 demo days of cards, ≥ 100 PUTs; repeat until ≥ 200 PUTs in total (two sandboxes). This is
   the regime the fix targets.
2. **Contended**: N=4 phones at once, day 1, the R-23 shape (28 PUTs per run). Proves the 429 path is unchanged.

Measure from the Cloud Run request log + app logs of `web-develop` (one query per run window):
- `timeout_503_rate` = PUT 503 with `segment.upstream_unavailable {upstream:"timeout"}` ÷ PUTs. Baseline 5.4 %.
  **Target ≤ 1 %** (≤ 2 in 200); the hangs should now show up as `transcribe.retry {upstream:"timeout"}` lines instead.
- `hang_rate` = `transcribe.retry upstream:"timeout"` lines ÷ PUTs, with their `elapsedMs` (expect ≈ 10 000–10 100).
  This is the number the whole design assumes is ~5 %; report it either way.
- `second_attempt_latency` for those: the PUT's total latency minus `elapsedMs` minus `delayMs`. If its median is not
  within ~2× the overall median (i.e. the second call is also slow), A is not buying much and B/D should be reconsidered.
- PUT latency **p50 / p95 / max** for 200s, quiet run: expect p50 unchanged ± 0.3 s, p95 ≤ baseline (hangs now end at
  ~12 s instead of being 503s and re-sends), max ≤ ~22 s.
- `model_calls_per_put` = (PUT 200 + `transcribe.retry` lines) ÷ PUTs. Target ≤ 1.08 (baseline ≈ 1.05 counting
  re-sends as calls).
- Contended run: 503 p50 still ~1.2 s, every `transcribe.retry` line `upstream: 429`, **zero** `upstream:"timeout"`
  retries, lines lost 0 at N=4 (R-23 bar). If timeout retries appear under contention, stop and re-read §1's two-regime
  claim: it would be wrong.
- Data: unique `seg_id` docs in `segments` for each sandbox = PUT 200 count minus duplicates/discards (no double
  stores); `demo_counters segment_sandbox:<sbx>` = number of distinct `seg_id`s (no double charge).
- Hard rules at runtime (as in round 2 §7): no base64/audio in any log line; the retry line has exactly
  `attempt, upstream, delayMs, elapsedMs`.

Ship bar for `main`: `timeout_503_rate ≤ 1 %`, `model_calls_per_put ≤ 1.08`, contended run unchanged, 0 data/charge
anomalies. QA writes `docs/tasks/QA-transcribe-timeout-18oct.md` with the four numbers per run.

## 6. Ship today?

**Yes, to `develop` → `web-develop`**, under the standing flow (tech-lead gate → PM merge → Cloud Build → dev-ops
verifies the revision → QA runs §5). The diff is one file plus tests, no hard rule is touched, the 429 path is
byte-identical in behaviour, and the failure mode if the hang assumption is wrong is bounded: a slow-but-progressing
call is redone once and lands at ~12.6 s instead of 10–15 s. **`main` only after §5** — the same freeze rule as every
other change this weekend. The judging-day hint in the guide (#122) stays; it covers the double hang and the capacity
regime, which this change does not remove.

## 7. What I could not verify (flag, not block)

- The latency distribution and the 10/186 count are taken from the brief; the trace file is not under `docs/`. If the
  10 timeouts clustered in one minute (a Vertex incident) rather than being spread, the hang rate is lower than 5 %
  and the fix matters less but costs nothing extra. §5's `hang_rate` settles it.
- Whether Vertex bills an aborted request. Assume yes; the cost is ≤ 6 % of transcribe calls, each ≤ 15 s of audio.
- The Vertex quota/rate row for `gemini-3.5-transcribe-preview` (R-23 §8: none visible). The design does not depend
  on it: in the only regime where quota binds, this branch never runs.
- Cloud Run `web-develop` concurrency/timeout were read from `R-01-gcp-state.md` for `web`; dev-ops should confirm
  `web-develop` matches (concurrency ≥ 8, timeout ≥ 60 s is all that is needed).

## 8. Routing and estimate

`developer-junior` (haiku): §3.1 items 1–6 and tests 1–5, 7, 8 and the segment-service test (~45 min; the edits are
literal). `developer` (sonnet): test 6 (real abort through the SDK signal) and the final run of `lib/transcribe` +
`lib/capture/segment-service` + the two route test files (~20 min). Skills to name: `tdd-workflow`,
`error-handling`; `code-review` for the gate. One commit. Tech-lead review checks: the predicate shape in 3.1(4), the
three `Date.now()` → `now()` replacements, the log key set, and that no other file moved.

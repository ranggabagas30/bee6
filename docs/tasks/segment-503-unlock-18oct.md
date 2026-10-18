# Segment 503 + locked script card (18 Oct, day 1) — read-only diagnosis

Tech-lead, read against `origin/main` 30c931d (`git show`, no checkout). Companion to dev-ops' log trace; this
doc does not repeat the trace, it says what the code does and what to ship today.

## 1. What happened (verified from code, timing matched to the report)

| Observed | Code path | Status |
|---|---|---|
| One `PUT /api/v1/segments/...` → **503 after 15.3 s** | `lib/transcribe/gemini.ts`: `TRANSCRIBE_RETRY.attemptTimeoutMs = 15_000` aborts the first Gemini call; `classifyUpstream` → `"timeout"`; **timeouts are not retried server-side** (`retryable` requires a numeric status in `[429,500,502,503,504]`), so `ServiceUnavailableError("transcribe", "timeout")` → 503 at ~15.0 s + overhead | **Verified** by timing. The log line `segment.upstream_unavailable {stage:"transcribe", upstream:"timeout"}` confirms it (dev-ops). |
| Not a demo-cap refusal | `lib/demo/caps.ts` caps throw `LockedError` = **429**, never 503; the only cap 503s (`demo_not_ready`, `demo_cap_unavailable`) fail in < 1 s, before the model call | **Verified** (15.3 s rules them out) |
| Not SDP | `lib/redact/dlp.ts` runs after transcribe with its own 30 s timeout; a redact 503 would land > 15 s only after a successful transcribe | **Verified** |
| Different from QA round 3 / load tests | Those 503s were `upstream: 429` at p50 1.2 s (capacity, "transcribe.retry attempt 1"). This one is a **slow model**, not a refusing one: one judge, one phone, a 15 s audio segment (`batcher.ts` max 15 s) that `gemini-3.5-transcribe-preview` (global, preview) did not answer within 15 s | **Inferred** (cause of the slowness is upstream; nothing in our code) |

## 2. Client pump and retry (verified, `lib/capture/browser/engine.ts`, `lib/capture/retry.ts`)

- Strict FIFO, single pump: `queue.peek()` is retried until it succeeds or is dropped. **A failing head blocks every
  segment behind it** (by design: ordering + no parallel model calls). Rangga's "next segment uploaded fine" can only
  have happened after the head resolved (200 or drop).
- Backoff (jittered): 250–500 ms, 0.5–1 s, 1–2 s, 2–4 s, 4–8 s, 8–16 s, then 15–30 s. Each attempt that times out
  again costs another ~15 s. Drop when a server error lands ≥ `HEAD_BUDGET_MS` 240 s after the first one → with 15 s
  attempts the drop lands at ~250–270 s after the first 503.
- `status === null` (network) never consumes the budget; 4xx drops at once.

## 3. What the judge sees, and when (verified)

| t after the segment closed | Phone (`UploadStatusLine`) | Guide card (`JudgeGuide.ScriptCard`) |
|---|---|---|
| 0–15.3 s | "Uploading" | "Waiting for Bee6 to hear this card…" (button disabled) |
| 15.3 s (first 503, `headFailedAttempts` = 1) | "Not sent yet · retrying (1x)" | + "Bee6 is catching up: the transcription service is busy. Keep reading; this card unlocks when it has been heard." |
| ~16 s (retry 200 with `lines ≥ 1`) | "Upload succeeded" | button enables |
| ~250 s+ (budget exhausted → drop) | amber "Some speech was not captured · That note is now incomplete. It cannot be recovered." + Dismiss | still "Waiting…" — **nothing tells the judge to read the card again** |

Unlock rule (`lib/demo/guide.ts cardState`): `linesSinceCardShown ≥ 1`, fed only by `segment_accepted` events =
a **200** whose `data.lines` is a number (`lib/capture/browser/client.ts acceptedLineCount`). So:
- a stuck head → the unlock waits for it (HOL);
- a **200 with `lines: 0`** (empty transcript) → counts nothing, button stays locked, no message;
- a **dropped** head → the line never counts; the judge only sees the amber "cannot be recovered" line ~4 min later,
  which reads as final, not as "say it again".
- A re-spoken line **does** count once it reaches a 200 (nothing special needed) — but it queues behind the stuck head.

Why the button stayed locked in Rangga's case even though the retry presumably went through (**inferred**, dev-ops
can settle it from the trace): either (A) the head's retry 200 carried `lines: 0` (check `segment.usage
outputTokens` or the segment doc's `lines`), or (B) the head kept timing out and both PUTs (head + re-spoken segment)
only resolved after he spoke again. Both end the same way: the judge waited with "catching up" and nothing actionable.

## 4. Fix options

| # | Option | Effort | Risk | Verdict |
|---|---|---|---|---|
| (a) **Guide copy with a timer**: while `!canMarkSpoken && uploadBusy` for ≥ 45 s, swap "Keep reading…" for "Still catching up. Read this card again now; the button unlocks when either reading is heard." Also when the engine's `droppedCount` rises while a card is active: "That reading was not captured. Read this card again." | ~1 h (JudgeGuide + bridge flag + i18n + 2 tests) | Demo-only (`app/demo`), no pilot path, no hard rule. Re-reading duplicates a transcript line → the labels/threads may merge or double one event; acceptable for the demo (the second reading is often what is stored anyway). | **Quick win — ship today** |
| (b) Server: retry a `"timeout"` once within the 30 s budget (attemptTimeoutMs 15 → 13 s, add `"timeout"` to retryables) | ~1 h + tests | Doubles model calls exactly when the model is slow; keeps the Cloud Run request open ~27 s; at N=4–6 phones the shared ~6–12/min capacity (load test) is the bottleneck, so extra calls hurt more than they help | Not today. Revisit only if dev-ops' trace shows many `upstream:"timeout"` entries |
| (c) Client backoff tuning | — | First retry is already 250–500 ms; nothing to gain for this case | No |
| (d) Show the amber box sooner | small | Wrong semantics: the speech is not lost until the drop; a false "cannot be recovered" costs trust | No; (a) covers the need |
| (e) Time-based unlock (allow "I have spoken this" after X s stalled) | small | The judge marks all 5 cards while nothing is stored; `POST /demo/closing` then refuses 409 `not_enough_speech` and the script cards are gone (RereadLast is read-only) → worse dead end | No |
| (f) Infra: min-instances 1, concurrency | dev-ops | Cold start adds ~1–2 s (ADC token), not 15 s; does not fix model latency. Still worth `min-instances=1` on judging day for first-request latency | Cross-check with dev-ops, no code |

## 5. Recommendation

Ship **(a)** today under the standing flow (tech-lead gate → merge to `develop` → `web-develop` → Rangga tests;
`main` on his go). Exact slice for `developer` (sonnet, it touches the bridge contract):

1. `app/demo/guide-bridge.ts` `CaptureBridgeState`: add `droppedCount: number` (from `status.droppedCount`, 0 when
   no engine). `app/capture/page.tsx` publishes it next to `uploadBusy` (one line).
2. `app/demo/JudgeGuide.tsx ScriptCard`: `useEffect` timer — when `uploadBusy && !live.canMarkSpoken` holds
   continuously for `CATCHING_UP_REREAD_MS = 45_000`, set `rereadHint = true`; reset on `live.index` change or when
   `canMarkSpoken`. Separately, remember `droppedCount` when the card was shown; `droppedSinceCardShown > 0` →
   `lostHint = true`. Render precedence: `lostHint` > `rereadHint` > existing "catching up".
3. `lib/i18n/v2/journey.ts`: `C-journey-reread-stalled` (EN: "Still catching up. Read this card again now; the
   button unlocks when either reading is heard.") and `C-journey-reread-lost` (EN: "That reading was not captured.
   Read this card again."). ID columns PROVISIONAL, mirror the existing style.
4. Tests (`app/demo/JudgeGuide.test.tsx`, fake timers): stalled 44 s → old copy; 45 s → reread copy; index change
   resets; `droppedCount` 0→1 while on a card → lost copy wins; pilot/`lib/capture` diff empty.

Judging-day note for the README/guide (no code): "If a card stays locked for about a minute, read it again."

Ask dev-ops for, from the trace: `upstream` value of the 503 (expect `"timeout"`), the retry PUT's status and
`segment.usage outputTokens`, instance count/cold start at 11:19 WIB, and whether `min-instances=1` is set on `web`.

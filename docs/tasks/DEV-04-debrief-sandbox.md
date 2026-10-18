# DEV-04: `/dev/debrief` debrief sandbox — DROPPED (Fri 9 Oct)

Status: **DROPPED by tech-lead on Fri 9 Oct after Rangga's answer to v1 open question 5. Do not build.**
The v1 plan (8 Oct) was never committed, so it is not in git history. Its shape, if it is ever revived: a
`page.dev.tsx` mounting the real `DebriefFlow` through its existing `fetchFn` and `storage` test seams, with an
in-memory fake server and in-memory `Storage`, zero changes to `/capture` or `DebriefFlow`, about 2 h.

## Why

Rangga, 9 Oct: "What is the problem if we still using the real Firestore/network? It is not UI testing only, but
functionality as well with shorter hours."

v1's case for an in-memory sandbox rested on one fact: "a real session cannot give questions on demand; they
come only from the pipeline tick". Rangga then approved a dev-only **"Run pipeline tick now"** button (DEV-03 §3.11).
With it, a DEV-03 fast day with `selesai_after_mulai_min = 0` reaches a **real, Firestore-backed debrief with real
generated questions in about 3 minutes** (Mulai → fictional speech → Selesai → 90 s silence → tick now → open the
card). That path exercises transcription, SDP redaction, windowing, Gemini labelling, the evidence gate, question
writes, the answer route and the debrief-end expiry — everything the fake skipped. Full walkthrough: DEV-03 §1.5.

## What dropping it loses (for the PM to raise with Rangga only if he wants it)

1. Questions in exact shapes on demand (7 questions to see the 5-question cap, a chosen category mix). The real
   path depends on what Gemini labels; the fictional script steers it but cannot dictate it.
2. Forced server failures (400 refusal, 503 retry, 500 load error). The real path still covers offline (DevTools
   Network → Offline) and the timeout (short debrief).
3. Both are already covered by unit tests on `origin/main` (`app/capture/debrief/DebriefFlow.test.tsx`,
   `QuestionScreen.test.tsx`, `lib/debrief/*.test.ts`); the residual is a visual-only check of screens R-07 already
   shipped. If wanted, it is about 2 h after go-live (Mon 12 – Wed 14 evenings), not a go-live item.

## Where the work went

- "Skip Mulai → close, straight into the debrief" (Rangga's request #4): DEV-03, `selesai_after_mulai_min = 0`.
- Real questions on demand: DEV-03 §3.11 (tick-now, PR A).

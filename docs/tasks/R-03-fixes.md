# R-03 bug-fix round — capture page reliability (found via TSD work, 1 Oct)

Status: **PR #4 OPEN, waiting for Rangga: https://github.com/ranggabagas30/bee6/pull/4** — both
gates cleared after 3 fix rounds (304/304 tests). Not a new R-ID; a bug-fix round on already-merged
R-03 code (PR #1, merge commit `1f69a8b`). Found incidentally while a `tech-lead` instance wrote
`docs/specs/technical-specification.md` and grounded itself in the real capture-page code. Rangga
prioritized fixing these before continuing to R-05b, given Monday 5 Oct go-live.

**B-2 (mic-restart race) and B-1 (wake-lock real-browser timing) both still need Rangga's direct
confirmation on the real pilot/demo phone before Monday — carried in the PR body, repeating here for
visibility.** Everything else is independently verified (tech-lead PASS + QA SHIP, both re-derived
the acceptance criteria themselves rather than trusting prior reports).

Full findings and reasoning: `docs/specs/technical-specification.md` §9 (triage table) and §2
(capture stage detail). This file tracks just the fix.

## Related, separate fix: DLP region — PR #5 OPEN: https://github.com/ranggabagas30/bee6/pull/5
(branch `fix/dlp-region-fallback`, not this branch)
Manual testing of this PR surfaced a second go-live blocker, unrelated to the 5 findings below:
`lib/redact/dlp.ts` hardcoded its region instead of reading `config/regions.yaml`'s probed fallback
(hard rule #5). Root cause of the observed failure was actually a stale local `gcloud` ADC quota
project (fixed by Rangga), not a region-support problem — but the hardcoding was a real, independent
bug, fixed on its own branch/PR to keep this PR's scope clean. **Known gap carried forward: the
region probe (`npm run probe`) runs under a developer's local ADC credentials, not Cloud Run's
runtime service account — it cannot catch a missing `roles/dlp.user` (or broader) grant on that
service account. Verify this explicitly on the first live deploy**: PUT one fictional segment with
a phone number, confirm a 2xx and a stored `[PHONE_NUMBER]`-redacted line, with no DLP/region errors
in Cloud Run logs. Full history: `docs/tasks/R-01-gcp-state.md` open item 4.

## Scope: 5 findings, all in `lib/capture/browser/*`

1. **B-1 [High]** `wake-lock.ts:27-35` — the code never notices when the browser itself releases the
   screen wake lock (this happens automatically whenever the tab is hidden once). After that, the
   lock is never re-acquired, but the heartbeat keeps reporting `screen_awake: true` — a false
   positive that threatens the ≥90% capture-coverage acceptance goal. Fix: listen for the wake lock's
   own `release` event (or re-acquire on `visibilitychange` → visible) and keep the heartbeat's
   reported state honest.

2. **B-2 [High, confirm on a real phone before closing]** `session.ts:110-143` — a single mic failure
   can trigger two concurrent restarts: the VAD library's internal rethrow fires both the `onError`
   handler and the `spinUp` call's own catch block, and nothing guards against both running at once.
   Two voice detectors feeding one capture engine corrupts the audio timeline. Fix: a single
   in-flight-restart guard (e.g. a boolean/promise lock) so only one restart path can run at a time.

3. **B-3 [High]** `engine.ts:125,207` — the audio buffer is only trimmed when a segment closes.
   During silence (VAD never fires a close), it keeps growing — ~230MB/hour by the report's estimate.
   A quiet shop or a muted/disconnected mic will eventually crash the capture tab. Fix: trim the
   buffer on a time-based interval independent of segment closure, not only on close.

4. **B-4 [Medium]** `engine.ts:274` — the 6-attempt retry limit for server 5xx errors also counts
   plain network failures (e.g. being offline). After a reconnect, the first queued segment can get
   dropped on its first 5xx because it's already near the attempt ceiling from counting the outage
   itself. Fix: count network-unreachable retries separately from server-error retries, or reset the
   counter on a successful reconnect.

5. **B-5 [Medium, hard rule #7]** `session.ts:103` — the raw Bluetooth/mic device label (e.g. "Dina's
   AirPods") is stored verbatim in the `heartbeats` subcollection with no expiry. Device labels
   commonly include an owner's name. Fix: either strip/hash the label before storing it, or give
   `heartbeats` the same kind of TTL segments already have — confirm which with Rangga if the fix
   isn't obvious from the existing `heartbeats` schema.

## Acceptance
- Each fix has a unit test demonstrating the specific failure mode is gone (e.g. B-2: simulate a mic
  error and assert exactly one restart fires; B-3: simulate N minutes of continuous silence and assert
  the buffer size stays bounded).
- `npm run typecheck` / `npm run lint` / `npx vitest run` all clean.
- No change to capture's on-the-wire segment format or the `/api/segments` contract — this is a
  reliability fix, not a protocol change.
- B-2 specifically needs a note in the PR calling out that it should be confirmed on a real device
  before Monday, since the dual-mic-restart race is hard to fully prove in a unit test alone.

## Result
(fill in after build)

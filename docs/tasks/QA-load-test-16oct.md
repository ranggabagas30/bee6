# QA live load test, R-22 transcribe resilience (16 Oct 2026 02:49–03:25 WIB = 15 Oct 19:49–20:25Z, demo project only)

Target: https://web-33uzb53tza-et.a.run.app (Cloud Run `web`, revision **web-00019-6wr** at 100 % = image 4a93a9e = main after
PR #80; project bee6-playground). Driver: the round-3 harness extended (`r4/`: Playwright 1.64 Chromium, fake microphone
`--use-file-for-fake-audio-capture=<wav>%noloop`, 360×800 `isMobile`+`hasTouch`, one persistent profile per sandbox, one driver
process per phone; new in r4: per-request latency, in-flight tracking, a `runLoad` step that taps Start at a shared wall-clock
millisecond on every phone). Wavs: `r3/day1.wav` (= `private/rehearsal/d1-c1..c5` with 9 s gaps, 103 s, 7 lines) and
`r3/day2.wav` (`d2-c1..c5`, 117 s, 8 lines). Logs: `gcloud logging read --project=bee6-playground` (read-only). Firestore:
read-only Admin SDK under ADC (`r4/fs.cjs`, `r4/counters.cjs`). Evidence (screenshots, raw JSON, log dumps):
`<LOCAL_PATH>/r4/`
(`out-*.json`, `net-r4-*.json`, `logs-run{1..4}.json`, `logs-round3.json`, `shots/*.png`). Nothing written outside my 11
throw-away sandboxes (TTL 2 h). `demo-tpl-outlet` / `demo-outlet` untouched. No product code edited, nothing pushed, no infra
action, pilot project never touched. All 11 drivers and their Chromiums closed at the end (`ps`/`lsof`: none left).

**VERDICT: DO-NOT-SHIP against the R-22 §7 pass criteria.** The retry machinery works exactly as designed (every 503 is preceded by
3 `transcribe.retry` lines, 1,037 retries all `upstream: 429`, real 429s recovered to 200 both inside a request and across phone
retries), and **N = 4 passes twice (0 lines lost, 0 "Some speech was not captured")**. But **N = 6 (+1) lost a line on 4 of 7 phones
and N = 5 lost lines on 5 of 5 phones**: the shared preview capacity in these windows was ~6–10 transcriptions per minute for the
whole project, and the phone's 8-attempt budget (≈ 90–100 s per segment) runs out while the queue is still being refused. Retries
cannot create capacity; the §7 criterion "0 × not captured, 7/7 lines per phone" fails at N ≥ 5. Rangga decides whether to accept
"safe up to 4 phones at once, stagger beyond that" as a known risk (see §7 recommendations).

## 1. Runs (same-second starts; Cloud Run request log counts; phone-side counts in §2)

| Run | N | Start (Z) | PUT 200 | PUT 503 | 429 seen? | `transcribe.retry` (att 1/2/3) | recovered in-request | segments dropped | phones "not captured" | lines heard | time-to-200 p50 / p95 / max |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 dry | 1 (reg-1 d1) | 19:49:33 | 7 | 0 | no | 0 | – | 0 | 0/1 | 7/7 | 1.7 s / 2.6 s / 2.6 s |
| 1 | 4 (a-1..4 d1) | 19:52:28 | 28 | 31 | **yes** (31 give-ups, 4 recovered) | 98 (35/32/31) | 4 | 0 | **0/4** | **7/7 ×4** | 2.6 s / ~90 s / 95 s |
| 2 | 4 (a-1,2,4 d2; a-3 d1 again) | 20:00:01 | 28 | 38 | **yes** | 134 (48/45/41) | 10 | 0 | **0/4** | **7/7 ×4** | 3.2 s / 61 s / 68 s |
| 3 | 6 (b-1..6 d1) + reg-1 d2 13 s earlier = 7 | 20:04:24 / 20:04:37 | 46 | 148 | **yes** | 480 (168/158/154) | 20 | **4** (b-1, b-2, b-4, reg-1: 1 each) | **4/7** | b-1 6/7, b-2 6/7, b-4 6/7, reg-1 7/8, b-3/5/6 7/7 | 14.3 s / 73 s / 113 s |
| 4 | 4 (a-1,2,4 d3; a-3 d2) + b-6 d2 playing day-2 phone cards = 5 | 20:13:35 | 29 | 105 | **yes** | 325 (115/108/102) | 10 | **7** (a-1 1, a-2 2, a-3 1, a-4 2, b-6 1) | **5/5** | a-1 6/7, a-2 5/7, a-3 6/7, a-4 5/7, b-6 7/8 | – (7 of 36 segments never got a 200) |

Totals over the four bursts: 131 × 200, **322 × 503**, 1,037 `transcribe.retry` lines (**all `upstream: 429`**, delays 502–3,995 ms
= the jittered 1 s / 2 s / 4 s schedule), 322 `segment.upstream_unavailable`, 44 PUTs recovered inside the request after ≥ 1 429.
All on one Cloud Run instance, one revision (`web-00019-6wr`). Round-3 baseline (same query on 18:33:30–18:36:30Z, `web-00018-5kp`):
17 × 200, 81 × 503, 0 retry lines, 503 latency p50 0.33 s.

Latency per PUT (Cloud Run `httpRequest.latency`): 200 p50 1.8–2.5 s, p95 5–11 s, max 14 s · **503 p50 6.0 s, p95 7.3–7.5 s,
max 15–21 s** (4 upstream attempts + 0.5–4 s jitter waits; round 3's instant 0.33 s rejection is gone). Time-to-transcript above =
first PUT attempt → final 200 as seen by the phone.

Served capacity in the bursts (200s per minute of window): run 1 ≈ 10/min, run 2 ≈ 9/min, run 3 ≈ 8/min, run 4 ≈ 6/min. Four phones
produce ~16 segments/min at the start of a day; the backlog drains only after the wav ends.

Run 3 note: the 6 b-phones were meant to start after reg-1's day 2; a harness slip started them 13 s after it, so run 3 is
effectively **7 phones**, and the regression phone's day 2 ran inside the burst (its dropped line is the first caller line of
card 3; the PHONE_CALL thread has 1 of 2 lines). Reported as observed; not re-run to save the per-IP sandbox budget.

## 2. Phone-side detail (from each driver's network log; `out-*-load.json`, `net-r4-*.json`)

Every dropped segment shows the same shape: **8 consecutive 503s over 88–100 s, then `dropHead`** → "▲ Some speech was not captured ·
That note is now incomplete" (screenshots `shots/b-1-lost.png`, `b-2-lost.png`, `b-4-lost.png`, `regd2-reg1-lost.png`,
`r4-*-lost.png`). Segments that recovered needed 6–8 attempts and 48–113 s. Examples: b-1 `cfe991` 8 × 503 221 s → 322 s dropped;
b-3 `444e9b` 7 × 503 then 200 at 113 s (the 8th attempt saved it); reg-1 `feddf8` 8 × 503 68 s → 162 s dropped (the card-3
caller line); run 1 a-3 `0a0fb7` 7 × 503 then 200 after 95 s, and the three segments queued behind it went through in 1 s each.

Phone status line (sampled every second): "Not sent yet · retrying (Nx)" + "Server busy" appeared on every phone in every burst
(`shots/*-retry.png`); "Upload succeeded" between bursts. After a drop, the next success replaces the "not captured" line with
"Upload succeeded" (a1/a3/a4 pages ended on "Upload succeeded" although a line was lost — pre-existing `lostSinceSuccess`
semantics, by design; noted for Rangga because a judge can miss the loss).

Stored segments per session (Firestore, read-only): run 1 7/7/7/7 · run 2 7/7/7/7 · run 3 b 6/6/7/6/7/7, reg-1 d2 7 (of 8) ·
run 4 6/5/6/5/7 (of 7/7/7/7/8). Matches the phone counts exactly; nothing stored twice; no `already_exists` replays.

Guide under a stall (observation, not a defect): "I have spoken this" stays disabled with "Waiting for Bee6 to hear this card…"
for as long as the card's segment is stuck (up to ~100 s). My harness plays audio ahead of the cards, so a-3's card 5 was shown
after its audio had already been heard and the card never unlocked (`shots/a-3-stuck.png`); I cancelled that day (discard 202,
cleanup within one tick: `threads_deleted: 5, segments_deleted: 7`) and re-ran it as part of run 2. A real judge waits on the
card instead, so the effect for judges is a 1–2 minute wait per stuck card, not a stuck guide.

## 3. Demo caps and the per-IP sandbox cap (Firestore `demo_counters`, read-only, after the run)

- `sandbox_ip` for this network, UTC day 2026-10-15: **21** (round 3 had already used ≥ 10 from this IP; my 11 sandboxes were the
  11th–21st and **none was refused**; round 3's 5th was refused at the old cap of 10). Default 30 confirmed live;
  `DEMO_SANDBOX_IP_CAP` is not set on the service (dev-ops note), so 9 remain on this IP today (resets 00:00Z = 07:00 WIB).
- `sandbox_day` 21/300 · `segment_day` **630/3000** (this test charged ≈ 460: every 503'd PUT is charged, as the plan says) ·
  `model_day` 681/5000 · `generate_day` 13. Largest `segment_sandbox`: 35/150 (b-4, 7 real segments). Not exhausted; but a judge
  in a 6-phone burst burns ~30 charges per day on failures (≈ 90 over 3 days of 150).

## 4. Stagger sentence on the `capture_ready` guide card (360 px)

`shots/a-1-capture-ready-guide-360.png` (+ `-full.png`): day 3 "Not started" with the guide open shows "After the 5 cards, Jump to
closing time unlocks End. If several people start at the same time, start about a minute apart; the transcription service shares
capacity." as the 4th body line, wrapped over 4 lines, `document.scrollWidth` 360 = `clientWidth` 360, zero elements past the right
edge. Pass.

## 5. Regression pass (reg-1, `sbx-1b0f3e2f2dcf`, 360 px, fresh sandbox — the 11th from this IP today)

- Pair by touch 1.3 s → day 1 (`day1.wav`, alone): 7 × 200, 7/7 lines, no retry; 5 cards tapped as heard; Jump to closing 0.3 s →
  End today → "Preparing your questions" → "Debrief complete · There are no questions today" after 142 s; Jump to tomorrow 200 `{day: 2}`.
- Day 2 (`day2.wav`, inside the run-3 burst, see §1): 7/8 lines (1 dropped), one CUSTOMER_SERVICE thread (3 lines), one
  PHONE_CALL thread (1 line) → End → **1 question** "Around 03:05 there was a phone call. Is that right?" → Yes + reason → `POST …/answer`
  200 `answered` → "Thank you. Today's only question is answered and today is closed."; correction doc `answered_device_id` only.
- Sign out → `/sign-in?as=supervisor` (no "Signed in as" text on the sign-in page) → 4.1 s → `/day/2026-10-16` → `/proposals` watch:
  "Customer service · seen on 2 of 2 days needed · Proposed", "Phone call · seen on 1 of 2 days needed · Needs 1 more day" →
  **Ask → 201 in 11.6 s**, CUSTOMER_SERVICE `add_record_step` "Record baking time on tray labels" (modify `bake-01`; "2 moments ·
  Thu 15 Oct, Fri 16 Oct"; no `[staff]`, `(role:`, ISO date or name) → "Ask for another" absent (only one category ready, correct) →
  **Open** (a button on the list; round 3's harness looked for an `a[href*=id=]` link — the UI is a button; it opened the detail in
  place at `/proposals`) → **Mark feasible** → "Waiting for owner approval".
- Sign out → owner 3.2 s → Home "Waiting for your approval · 1 · Supervisor marked it feasible" → Approvals "0 of 1 decided" →
  **Approve → 200 `approved`** → "Approved. It ships as a new SOP version." → SOP tabs **"09/10/26 · current" | "17/10/26 · upcoming"**,
  `GET /api/v1/sop` latest v2 effective 2026-10-17 → Reviews "Fast-forward" → 200 `{version: 2}` → "Simulated review created ·
  Waiting for a verdict · SOP version 2: review on Sat 31 Oct · Metric: Customer service per day should go down (now 2 in 4 days)" →
  Home "APPROVED 1 · started, waiting for review", "Today in five lines · Facts: 5". R-20/R-21 path intact.
- b-6 day 2 (day-2 phone cards under the run-4 burst): 7/8 lines, End → question "Around 03:14 there was a phone call…" → answered 200.
  All other 10 phones: End today → "no questions" (day-1 cards) in 2–142 s; "Jump to tomorrow" 200 on every sandbox used twice.

## 6. Hard rules at runtime

No audio/base64 in any Firestore doc of the 11 sandboxes (`fs.cjs` scan of every string > 1500 chars / base64-shaped / Buffer:
none) and none in Cloud Run logs 19:45–20:25Z (`base64`, `data:audio`, `audio/`: 0 lines; the only severity ≥ ERROR entries are the
322 request-log 503s; `FAILED_PRECONDITION` 0, `cleanup_failed` 0). `transcribe.retry` lines carry exactly `{attempt, upstream,
delayMs}`. Segments store `lines[].text`, `model: gemini-3.5-transcribe-preview`, `location: global`; answers store
`answered_device_id` only; no person's name in any thread/proposal text (model text says "staff", "customer", "caller"); supervisor
and owner pages show no device id. `[pipeline-tick] skew` lines: 110 in the window (multi-line entries; expected, my devices'
uploads were delayed > 60 s by the retries, plus the seeded `demo-tpl-phone`). RBAC was not re-probed in this run (round 3 §8 covers
it; R-22 changed no route).

## 7. Findings and recommendations (zero tolerance; Rangga decides)

- **L-1 [major, capacity] ≥ 5 phones starting together still lose lines.** Reproduced twice (run 3: 4 of 7 phones, run 4: 5 of 5).
  Mechanism: Vertex served 6–10 transcriptions/min to this project; each refused segment costs the phone ~6 s per attempt plus
  0.25–30 s jittered waits, and 8 attempts ≈ 90–100 s; with a serial queue per phone and a day that produces 7 segments in 100 s,
  the head segment is refused for longer than its budget. The audio is then gone (hard rule 2, correct). N = 4 is safe in both runs.
- **L-2 [minor, cost/latency] the 4 server attempts recover little and slow the phone's cycle.** In-request recovery was 4/35,
  10/48, 20/168, 10/115 (6–12 %) because the 429 is capacity-shaped over minutes, not seconds; each 503 now takes ~6 s (was 0.3 s),
  so a phone makes fewer attempts per minute. Tech-lead's fallback applies: cut server `attempts` to 3 (or 2) and keep the budget
  on the phone, where the waits are long enough to matter.
- **L-3 [minor, UX] after a drop the status line goes back to "Upload succeeded" on the next success**, so the loss notice can be
  missed by a judge (pre-existing `lostSinceSuccess` semantics; `shots/r4-a1-end.png` vs `r4-a1-lost.png`).
- Observations: O-14 each 503'd PUT still charges `segment_sandbox`/`segment_day` (plan §1.1 accepted this); O-15 the guide waits
  on "Waiting for Bee6 to hear this card…" for the whole stall (up to ~100 s per card); O-16 `DEMO_SANDBOX_IP_CAP` not set
  (default 30 in force), 21 of 30 used on this IP today.

Recommendations: (1) judging-day rule: at most 4 phones in capture at once; start further judges ≥ 1 minute apart (the stagger
sentence is live); (2) give the phone a time-based budget (e.g. keep retrying the head for ~4–5 min, bounded by the session end)
instead of 8 attempts — every dropped segment in runs 3–4 was refused for only 88–100 s and the same bursts recovered segments
after up to 113 s; (3) server `attempts` 4 → 3 (L-2); (4) dev-ops: Provisioned Throughput or a capacity request for
`gemini-3.5-transcribe-preview` if ≥ 5 simultaneous judges are expected; set `DEMO_SANDBOX_IP_CAP=60` on judging day as planned.

## 8. Sandboxes used (TTL 2 h; all sessions ended via End today, none left open)

reg-1 `sbx-1b0f3e2f2dcf` · a-1 `sbx-6585725b8fa2` · a-2 `sbx-cac09a73c584` · a-3 `sbx-a42a9b39851f` (day 1 discarded once, cleaned)
· a-4 `sbx-4b84551d79cd` · b-1 `sbx-518adff219cb` · b-2 `sbx-687b957069d0` · b-3 `sbx-f92a3df27b06` · b-4 `sbx-708926de06c5` ·
b-5 `sbx-e967e257a113` · b-6 `sbx-94d997bdbae8`. Spend: 138 transcribe 200s + 322 refused PUTs (each with up to 4 upstream
attempts), ~138 SDP calls, label ticks, 1 proposal, 3 debrief question sets — cents.

## 9. Human manual-test checklist (real phones, Rangga/Tiffany)

1. Two real phones reading day-1 cards at the same minute → expect "Upload succeeded" throughout and 7/7 lines; then add a third
   and a fourth → "Not sent yet · retrying" may appear but no "Some speech was not captured".
2. Do not run five or more phones at once on the demo project on judging day without staggering (L-1).

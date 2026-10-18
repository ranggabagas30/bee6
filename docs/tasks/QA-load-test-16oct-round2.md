# QA live load test round 2, after R-23 (16 Oct 2026 04:12–05:05 WIB = 15 Oct 21:12–22:05Z, demo project only)

Target: https://web-33uzb53tza-et.a.run.app (Cloud Run `web`, revision **web-00020-p9p** at 100 % = image tag 5a47d02 = main after
PR #82; project bee6-playground; `DEMO_MODE=true`, no `DEMO_*_CAP` overrides on the service). Driver: the round-1 harness
`r4/` reused (Playwright 1.64 Chromium, fake microphone `--use-file-for-fake-audio-capture=<wav>%noloop`, 360×800 `isMobile`+`hasTouch`,
one persistent profile per sandbox, one driver process per phone, Start tapped at a shared wall-clock millisecond) extended for
this round (`runLoad2`: samples the judge guide every second for the "catching up" line and the mic hint, the succeeded row under
the lost notice, waits up to 12 min per phone; `forcedLoss`: intercepts the phone's own segment PUTs with a 503; `staggerCheck`;
`afterEndDismiss`). Wavs: `r4/day1.wav` (= `private/rehearsal/d1-c1..c5`, 103 s, 7 lines, 7 segments) and `r4/day2.wav`
(`d2-c1..c5`, 117 s, 8 lines, 8 segments). Logs: `gcloud logging read --project=bee6-playground` (read-only). Firestore: read-only
Admin SDK under ADC (`r4/counters2.cjs`, `r4/fs.cjs`). Evidence (raw JSON, log dumps, screenshots):
`<LOCAL_PATH>/r4/`
(`out-{c,d,six,eight}-*-load.json`, `out-*-finish.json`, `out-d-4-forced*.json`, `out-reg*-d3-flow.json`, `ctr-run{1..4}-{before,after}.json`,
`ctr-final.json`, `logs-r5-run{1..4}.json`, `logs-r5-hardrules.json`, `fs-c1.txt`, `fs-d3-{a,b}.txt`, `shots/{c,d,six,eight,reg2}-*.png`).
Nothing written outside my 8 throw-away sandboxes (TTL 2 h): `sbx-7daadfccd76a` (c-1), `sbx-337bb9345c07` (c-2), `sbx-93a124766ee0`
(c-3), `sbx-1fdd61ed0354` (c-4), `sbx-4fc34f891197` (d-1), `sbx-2224cfa36c67` (d-2), `sbx-ab638419bd76` (d-3), `sbx-1bfa1ff6a49c` (d-4).
`demo-tpl-outlet` / `demo-outlet` untouched. No product code edited, nothing pushed, no infra action, pilot project never touched.
All 8 drivers and their Chromiums closed at the end (`ps`/`lsof`: none left).

**VERDICT: SHIP** against R-23 §10. N=4 ×2 and N=6 ×1 pass every bullet (0 lines lost, every 503 preceded by exactly one
`transcribe.retry`, 503 p50 1.2–1.3 s, every N=6 segment stored within 139 s, "catching up" shown and the mic hint never shown
during a stall); caps now count segments, not attempts (161 charges for 160 stored + 1 lost, vs ~460 for 131 stored last round);
real upstream 429s were observed in every run and recovered through the phone retry loop. **Reported risk, not a defect:** at
N=8 (escalated because capacity contended in every run) one phone lost one segment after being refused for 259 s — with the
notice visible, sticky through End, hidden by Dismiss. Rangga decides whether "4 at once, the next after ~2 minutes" (now in the
guide) is accepted as the judging-day rule. Open item (not reproducible live): the "a cap-refused attempt leaves no marker"
sub-bullet needs a demo cap to be hit (150 segments in one sandbox); it is pinned only by `lib/demo/caps.test.ts` (passes on 5a47d02).

## 1. Runs (same-ms Starts; server counts from the Cloud Run request log; phone counts in §2)

| Run | N | Start (Z) | PUT 200 | PUT 503 | real 429 seen? | `transcribe.retry` (by attempt) | recovered in-request | lines lost | phones with notice | time-to-200 p50 / p95 / max | 503 latency p50 / p95 | served/min |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 4 (c-1..4, day 1) | 21:14:19 | 28 | 31 | **yes** (33 × 429) | 33 (att 1: 33, att 2: 0) | 2 | **0** (7/7 ×4) | 0/4 | 2.3 s / 59.2 s / 91.1 s | 1.27 s / 2.16 s | 11.8 |
| 2 | 4 (d-1..4, day 1) | 21:21:14 | 28 | 52 | **yes** (54) | 54 (54 / 0) | 2 | **0** (7/7 ×4) | 0/4 | 2.0 s / 92.3 s / 107.6 s | 1.19 s / 1.67 s | 8.3 |
| 3 | 6 (c-1..4 d2, d-1, d-2 d2) | 21:29:22 | 42 | 119 | **yes** (126) | 126 (126 / 0) | 7 | **0** (7/7 ×6) | 0/6 | 3.8 s / 125.8 s / 138.8 s | 1.19 s / 1.71 s | 9.7 |
| 4 | 8 (c-1..4 d3, d-1, d-2, d-4 d3, **d-3 d2 on day-2 phone cards**) | 21:49:48 | 56 | 195 | **yes** (206) | 206 (206 / 0) | 11 | **1** (d-1 6/7; the other 7 phones 7/7 and d-3 8/8) | **1/8** (d-1, notice shown) | 3.2 s / 179.1 s / 227.8 s (+ the lost head, refused 259 s) | 1.20 s / 1.72 s | 8.8 |

Totals: 154 × 200, **397 × 503** (= every severity ≥ ERROR entry in the whole window), 419 `transcribe.retry` lines, **all
`attempt: 1`, all `upstream: 429`**, delays 501–999 ms (the jittered 0.5–1 s second chance), 22 in-request recoveries (5 %), 0
`attempt: 2` lines (PR-B: 2 attempts). 503s now cost 1.2 s instead of 6 s (round 1: p50 6.0 s). Run 1–3 on one instance, run 4
on two. Time-to-200 = first PUT of a segment → its 200 as seen by the phone. Run 2's slowest segment (107.6 s) and run 3's two
slowest (125.8 s, 138.8 s) would have been dropped by the old ~100 s attempt budget; the 240 s time budget kept them.

Minutes of "Not sent yet · retrying (Nx) · Server busy" visible per phone: run 1 10–89 s, run 2 36–167 s, run 3 89–**233 s**
(c-4), run 4 164–**353 s** (c-3). Every segment that recovered in runs 1–3 did so inside 139 s.

## 2. Phone-side detail

- Status line, judge guide: on every phone in every burst the status read "Not sent yet · retrying (Nx)" + "Server busy"
  (`shots/*-retry.png`), the guide card showed "Waiting for Bee6 to hear this card…" **plus "Bee6 is catching up: the transcription
  service is busy. Keep reading; this card unlocks when it has been heard."** for the whole stall (sampled every second: e.g. six-d1
  221 of 221 retry seconds, eight-c1 283/283), and **"Not picking up your voice?" never appeared** (0 samples on 22 phone-days).
  Mid-stall capture on eight-d1: lines = ["Not sent yet · retrying (6x)", "Server busy", "Waiting for Bee6 to hear this card…",
  "Bee6 is catching up: …"], line box x 18–342 px, `scrollWidth` 360 (`shots/eight-d1-guide-full.png`). The guide sheet never
  collapsed by itself (0 on all phones).
- Run 4 d-1's loss (`out-eight-d1-load.json`): segment `ae9f34e7` first refused at 99.4 s, 16 attempts (gaps 0.5 → 30 s), last 503
  at 358.4 s = **refused for 259.1 s ≥ 240 s → dropped** (the budget is time-based, as specified); it was the last segment in d-1's
  queue, so no later success row followed; "▲ Some speech was not captured · That note is now incomplete. It cannot be recovered. ·
  Dismiss" stayed up for the rest of the session (37 s sampled), through Jump to closing and **End** ("Debrief complete · no
  questions" with the notice still shown, `shots/d-1-d3-at-end-notice.png`), then **Dismiss (box 52.8 × 44 px) hid it**; 4 s of
  polling after the tap: no notice, no "Upload working again" toast; focus parked on the live region.
- Stored segments (Firestore `segment_sandbox` counters, which equal stored segments per sandbox): run 1 7/7/7/7 · run 2 7/7/7/7 ·
  run 3 14 on each of the six sandboxes (7+7) · run 4 21 on c-1..c-4, d-2 (7+7+7), 20 on d-4 (7+6 real after the forced loss + 7),
  21 on d-1 (7+7+6 stored + the 1 lost head charged once), 15 on d-3 (7+8). Matches the phone counts; nothing stored twice; 0
  `already_exists`.

## 3. Forced loss (d-4 day 2, alone; Playwright `page.route` answered the phone's own PUTs with 503 for 262 s, nothing reached the server)

First (intercepted) 503 at 21.5 s → 18 attempts → **drop at 262.3 s = 240.8 s after the first server error**; notice up; interception
released; the next segment PUT → 200 at 266 s → one legitimate "Upload working again" toast (a real 2xx after failures), then
**"Upload succeeded" rendered under the notice** (`shots/d-4-forced-succeeded-under-lost.png`); live-region order: lost line → helper →
**Dismiss** → succeeded row; Dismiss computed `minHeight: 44px`, `padding: 10px 0`, box height 44, warn colour `rgb(122,79,0)`;
"catching up" 243 samples, mic hint 0. Jump to closing → End today → "Debrief complete · There are no questions today." **with the
notice still visible** (`shots/d-4-forced-at-end-notice.png`) → Dismiss → hidden, **no toast** in 4 s of polling
(`shots/d-4-forced-after-dismiss.png`). Server side: `segment_day` moved by exactly d-4's 6 real 200s; the 18 intercepted 503s charged
nothing (they never left the phone). 6 of 7 lines stored, as intended for the test.

"The next Start clears the notice": not driven live (my relaunch between days reloads the page, which clears retained state anyway;
driving it needs the guide's own Jump to tomorrow without a reload and a spare sandbox day, which the per-IP budget did not leave).
Covered by `app/capture/page.test.tsx` "a new Start clears the lost notice…" — that file could not run in my environment (the local
checkout is on the old `feature/r-05b-label-call-pr2` branch and its `node_modules` lack `firebase/auth`); it ran in the tech-lead's
merged-tree gate and the pre-push hook. Listed in §9 for a real phone.

## 4. Demo caps (`demo_counters`, read-only, before/after each load step, before any End)

| Step | `segment_day` | `model_day` | `charge_once` docs | equals |
|---|---|---|---|---|
| before | 764 | 817 | 0 (none existed: no PUT had reached web-00020 yet) | – |
| run 1 (28 × 200, 31 × 503) | 792 (**+28**) | 845 (**+28**) | 28 (counts: 22 × 1, then 4,4,5,7,8,9) | 28 segments = 28 × 200 |
| run 2 (28 × 200, 52 × 503) | 820 (+28) | 873 (+28) | 56 | 28 × 200 |
| run 3 (42 × 200, 119 × 503) | 862 (+42) | 915 (+42) | 98 | 42 × 200 |
| forced loss (6 real 200s) | 868 (+6) | 921 (+6) | 104 | 6 × 200 |
| run 4 (56 × 200, 195 × 503, 1 lost) | 925 (**+57**) | 978 (+57) | 161 (max count 16 = the lost head's 1 charge + 15 free retries) | 56 × 200 **+ 1 lost segment** |

So the deltas equal the number of distinct segment ids whose first PUT passed the cap gate: exactly the 200s when nothing is lost,
200s + lost heads otherwise (the lost head was charged once on its first PUT, its 15 retries were free). That is the tech-lead-ratified
semantics ("segments, not attempts"; "charge only on success" was rejected for the abuse bound), one segment different from the
literal "equals the 200s" wording of §10 point 3 only when a line is lost. Per-sandbox `segment_sandbox` = stored segments (+1 on d-1).
Every `charge_once:segment:<outlet>:<seg_id>` doc carries `kind: charge_once`, `day: 2026-10-15`, a native `expires_at` Timestamp **2.0
days ahead** (e.g. `2026-10-17T21:15:58Z` for a 21:15 PUT), ids carry the sandbox id and the seg id only (no ip, device, key). After
the whole session: `model_day` 980 (+2 = 1 `generate` + 1 answer redact), `generate_day` 15. Last round the same traffic shape
charged ~460 for 131 stored; this round **161 for 160 stored + 1 lost** (= 551 PUTs).

`sandbox_ip` for this network, UTC day 2026-10-15: 21 → **29 of 30** (my 8 sandboxes); the 30th was deliberately not used; resets
00:00Z = 07:00 WIB. `sandbox_day` 29/300, `segment_day` 925/3000, `model_day` 980/5000. No cap was hit, so "a cap-refused attempt
leaves no marker" could not be observed live (see the verdict's open item).

Note for the harness: reusing the old `prof-a-*` profile directories re-attached to last round's expired sandboxes (same device ids,
`sandbox_ip` unchanged, "Ends at 04:51"); I closed them untouched and used fresh profile names.

## 5. Stagger sentence, `capture_ready` card (c-1, day 1, 360 px; `shots/c-1-capture-ready-360.png`, `-full.png`)

Body line 4 reads exactly "After the 5 cards, Jump to closing time unlocks End. No more than 4 people should read cards at the same
time; if more are ready, wait until someone has finished their 5 cards (about 2 minutes) before tapping Start." (5 wrapped lines,
element 324 px wide at x 18–342, line-height 21.75 px); `document.scrollWidth` 360 = `clientWidth`, zero elements past the right edge;
the old "about a minute apart" copy is gone. Pass. (Data point: 4 at once passed twice with 0 loss; 6 passed once; 8 lost one line.)

## 6. Regression pass (R-20/21/22 path; d-3 `sbx-ab638419bd76`, 360 px)

- Pair by touch (guide open, Fill in 000000, Set up) 310 ms–2.3 s on all 8 phones → day 1 (`day1.wav`, inside run 2): 7/7 lines,
  End → "no questions" → Jump to tomorrow 200 `{day: 2}` → day 2 (`day2.wav`, day-2 phone cards, inside the N=8 burst): 8/8 lines,
  one CUSTOMER_SERVICE thread (3 lines), one PHONE_CALL thread (2 lines) → End → **question "Around 04:50 there was a phone call. Is
  that right?"** → Yes + reason → `POST …/answer` 200 `answered` → "Debrief complete". Correction doc keys: `answer, answered_at_ms,
  answered_device_id, …, reason_text` (no role, no `answered_by`).
- All other 7 phones × 3 days: Jump to closing 200 `closing_reached`, End → "no questions" in 2–122 s, Jump to tomorrow 200 on days
  1 and 2 (20 of 20). Session docs: `end_reason=selesai`, `demo_closing_at_ms` set.
- Sign out → `/sign-in?as=supervisor` (no "Signed in as" on the sign-in page) 3.3–4.5 s → `/day/2026-10-16` → `/proposals` watch:
  "Customer service · seen on 2 of 2 days needed · Proposed", "Phone call · seen on 1 of 2 days needed · Needs 1 more day" →
  **Ask → 201 in 12.6 s**, CUSTOMER_SERVICE `add_record_step` "Record baking time on tray labels", evidence "2 moments on 2 days ·
  Thu 15 Oct 04:21, Fri 16 Oct 04:50", review date Fri 30 Oct; "Ask for another" absent (one category ready) → **Open** (button) →
  **Mark feasible → 200 `{result: feasible, status: awaiting_owner}`** → "Waiting for owner approval".
- Sign out → owner 3.1 s → Home "Waiting for your approval · 1 · Supervisor marked it feasible" → Approvals → **Approve → 200
  `approved`** → "1 of 1 decided · Approved. It ships as a new SOP version." → SOP tabs **"09/10/26 · current" | "17/10/26 ·
  upcoming"**, `GET /api/v1/sop` latest v2 effective 2026-10-17 → Reviews "Fast-forward" → 200 `{version: 2}` → "Simulated review
  created · Waiting for a verdict · SOP version 2: review on Sat 31 Oct · Metric: Customer service per day should go down (now 2 in
  4 days)" → Home "APPROVED 1 · started, waiting for review", "Today in five lines · Facts: 3". No `jdg-`, `sbx-`, `answered_by`,
  `[staff]`, `(role:` or ISO timestamp on any supervisor/owner page.
- Harness note: my reused `supervisorFlow` still looked for `a[href*=id=]` links (the list uses an "Open" button, as round 1 noted), so
  the first pass reached Ask only; the Open → Mark feasible → Approve chain above was driven explicitly afterwards (`out-reg2-d3-flow.json`).

## 7. Hard rules at runtime

- Audio/base64: 0 lines in Cloud Run logs 21:10–22:12Z for `base64`, `data:audio`, `audio/` (`logs-r5-hardrules.json`: 397 entries, all
  the request-log 503s; 0 non-request error entries); `fs.cjs` scan of every string > 1500 chars / base64-shaped / Buffer in
  `sbx-7daadfccd76a` and `sbx-ab638419bd76` (segments, threads, questions, corrections, proposals, audit_log, sop_versions, reviews,
  devices, outlets): none. `transcribe.retry` lines carry exactly `{attempt, upstream, delayMs}`.
- Redaction: segments store `lines[].text` only; the answer reason is stored redacted (`reason_text`); no raw audio anywhere.
- Names/ids: device docs have no name-ish key; threads/questions/proposals/SOP text name nobody ("staff", "customer", "caller");
  proposals/approvals/audit actors are roles (`device`, `supervisor`, `owner`); supervisor/owner pages show no device id. Observation
  (pre-existing, unchanged by R-23): `audit_log` `debrief.answer_uploaded` keeps `details.device_id`, and question docs carry a
  `device_id` key — device ids, not people; noted for Rangga, not an R-23 defect.
- Region from config: segments `model: gemini-3.5-transcribe-preview`, `location: global`; the proposal generator `gemini-3.5-flash`
  at `asia-southeast1` — both as listed in `config/regions.yaml`.
- RBAC: no route semantics changed in R-23 beyond the charge-once gate; not re-probed this round (round 3 §8 covers the routes).
- `demo.charge_failed` 0 · `demo_busy` 0 · `demo_cap_unavailable` 0 · `cleanup_failed` 0 · `FAILED_PRECONDITION` 0.

## 8. Findings (zero tolerance; Rangga decides)

- **R-1 [reported risk, capacity] N=8 at once still loses a line even with the 240 s budget.** Reproduced once (run 4, d-1: refused
  for 259 s). Served capacity stayed 8–12 transcriptions/min for the whole project in every window; 8 phones offer ~32/min. The
  notice behaved exactly as R-23 specifies (sticky through End, Dismiss hides it), so this is "loss with the notice". N=4 and N=6
  lost nothing. The guide's "no more than 4 at the same time; the next after ~2 minutes" rule is therefore necessary on judging day.
- **O-1 [observation] caps count segments, not successes** (+57 for 56 × 200 + 1 lost head in run 4). This is the ratified PR-C
  design; the §10 wording "equals the number of 200s" holds exactly whenever nothing is lost.
- **O-2 [observation] after End the "Upload succeeded" row is not shown under the notice** (only the notice + Dismiss); during the
  session it is. Matches the plan (the row belongs to the running engine's status); noted so nobody expects it on the debrief screen.
- **O-3 [open, not reproducible live] "a cap-refused attempt leaves no marker"** needs a demo cap hit; unit-tested only
  (`lib/demo/caps.test.ts` "a refused daily or model charge leaves no marker either", "the refused id left no marker…": pass on 5a47d02).
- **O-4 [open, environment] `app/capture/page.test.tsx`** ("a dropped segment keeps the lost notice … until Dismiss", "a new Start
  clears the lost notice…") could not run here (stale local checkout without `firebase/auth`); 551 other tests on 5a47d02 passed in a
  read-only `git archive` export, incl. `UploadStatusLine.test.tsx`, `lib/demo/caps.test.ts`, `lib/firestore/demo-store.test.ts`,
  `app/demo/*`, `app/api/v1/segments/*`, `lib/capture/browser/engine.test.ts`, `lib/transcribe/gemini.test.ts`.
- Harness defects (mine, not the product's): the stale `state.inflight` after a relaunch made run 3's two slowest phones wait to the
  12-min ceiling (data unaffected; patched before run 4); `supervisorFlow` link selector (see §6).

Recommendations: (1) keep the judging-day rule exactly as the guide now says (≤ 4 reading at once, the next after a finished card
set); (2) if ≥ 6 judges can be on phones at the same time, the only remaining lever is capacity for `gemini-3.5-transcribe-preview`
(R-23 §8), not code; (3) dev-ops: `DEMO_SANDBOX_IP_CAP=60` on judging day as planned (29/30 used by one tester in one UTC day);
(4) optional copy: the "Upload succeeded" row vanishing at End is fine, but the debrief screen could keep the notice's helper
line shorter — Rangga/UX call, no change required.

## 9. Human manual-test checklist (real phones, Rangga/Tiffany)

1. Two phones reading day-1 cards at the same minute → "Upload succeeded" throughout, 7/7 lines; add a third and a fourth → "Not sent
   yet · retrying" and the guide's "Bee6 is catching up…" may appear, never "Not picking up your voice?", no "Some speech was not captured".
2. One phone: force a loss (airplane mode does NOT count — only server errors consume the budget; use a 5th–8th phone burst or dev
   mode) → after the next good upload the notice stays with "Upload succeeded" under it → End today → notice still shown on the
   debrief screen → **do not Dismiss** → Jump to tomorrow in the guide → Start → the notice is gone (the one path I could not drive).
3. Pull the Wi-Fi for 30 s mid-card → "No internet" → recovers with no notice (B-4: network failures never consume the budget).
4. Judging day: never let five or more phones Start within the same ~2 minutes on the demo project.

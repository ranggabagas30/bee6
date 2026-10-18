# QA — demo-project (`bee6-playground`) regression & acceptance matrix

**Authored by:** QA (per Rangga's explicit direction, 8 Oct: QA owns writing this checklist; tech-lead/
developer own fixing whatever it finds — they do not author it).
**Status: NOT YET EXECUTED.** This document was built read-only, without touching the live service, any
`gcloud`/`firebase` config, or git refs that mutate the shared tree. A separate dispatch runs it once (a)
the `GOOGLE_CLOUD_PROJECT` env-var fix lands on the demo Cloud Run service (another agent, in parallel —
confirmed as a tracked gap below, not touched here) and (b) Rangga has done his own live spoken-recording
test through the real `/capture` page (§11 is the stub reserved for that).

**Why this exists:** Rangga wants the demo build (one GCP project, `bee6-playground`) proven mature — no
major bugs, aligned with the specs — before pilot work resumes, so bug-fix cost isn't paid twice across
pilot and demo.

## 0. Scope, ground truth, and how to execute this later

**Source of truth for "done when" criteria:** `docs/plan.md` + `docs/backlog.md` (sprint 1/2 sections),
cross-checked against `docs/specs/web-backend-rbac.md` §6.6 (routes/contracts) and
`docs/specs/technical-specification.md` §8 (session/capture/debrief/retention rules). Tasks in scope, per
the dispatch brief — every one of these is confirmed **merged to `origin/main`** (see note below):
R-01 (infra), R-03/R-04 (capture page + segment→transcribe pipeline), R-05a/R-05b (windowing/gate/tick
service), capture phase plan **P1** (Mulai/Selesai/Batalkan/auto-stop), R-07 (debrief server + phone +
screens), DEV-01 (dev-mode panel). R-02, R-06, P2–P5, R-08+ are **out of scope** (R-02 is dormant/PIN-off
by design; R-06 has no shipped screen yet — only a static HTML mockup at
`docs/design/supervisor-day-record.html`; P2–P5/R-08+ are "if time"/post-MVP 1 per `docs/backlog.md` §6/§6a).

**IMPORTANT — local git ref correction made while building this doc:** the local `main` branch in this
checkout was 139 commits behind `origin/main` (stale ref, not a code problem) — `git ls-tree -r main`
undercounts what's actually shipped. All "merged" claims below were verified against **`origin/main`**
via `git fetch` + read-only `git ls-tree`/`git show` (no checkout, no mutation of the shared tree). Confirmed
merged PRs relevant to this matrix: #1–#5 (R-03/R-04/R-05a), #6/#9 (R-05b), #13/#15/#19/#20
(capture P1 + status-truth fixes), #14 (consent flag removal), #17/#18/#21 (R-07 server/phone/screens).
Whoever executes this matrix should re-run `git fetch && git log origin/main -1` first and diff against
the commit this doc cites, in case more has landed since.

**Demo URL — confirmed live right now (read-only `curl`, 8 Oct 2026):**
`https://web-33uzb53tza-et.a.run.app` → `HTTP/2 200`, `x-powered-by: Next.js`. This is still the correct
URL; use it for every live-browser and live-API row below unless a later check shows otherwise (re-confirm
with `curl -I <url>` before a run, since Cloud Run URLs can change if the service is recreated).

**Blocking prerequisite the executor must check first (do not start §4–§10's live rows until this is
green):** `docs/tasks/R-01-gcp-state.md` "New gap found, TODO for developer" entry — the demo Cloud Run
`web` service does not have `GOOGLE_CLOUD_PROJECT` set, and `lib/transcribe/gemini.ts`,
`lib/pipeline/label/client.ts`, `lib/redact/dlp.ts` all hard-read that env var with no fallback (throws if
unset). Until that fix lands and redeploys, **any row that exercises transcription, redaction, or the
label call will fail with a 500 that is an environment bug, not a product bug** — don't log those as
product defects; confirm the fix shipped (check Cloud Run service env vars, or just try one segment PUT and
see it return 200 instead of 500) before running §5/§7/§9/§11.

**How to get a device credential for the live rows (demo project, `demo-outlet`, device `demo-phone`):**
1. `DEMO_MODE=true npm run seed -- --project demo` (against `bee6-playground` credentials) → prints a
   fresh 6-digit pairing code (valid 10 min). Re-run this each time the code has expired; it is idempotent
   on the outlet/staff/device docs themselves (same `demo-staff-1`/`demo-staff-2`/`demo-phone` ids each
   time — only the pairing code and its expiry are refreshed).
2. `POST https://web-33uzb53tza-et.a.run.app/api/v1/devices/pair` with that code → device token.
3. Use `Authorization: Bearer <device_token>` + `X-Device-Id: demo-phone` on every device route below
   (`lib/http/guard.ts`'s `requireDevice`: bearer checked first — a verified Firebase ID token on a device
   route is 403; a bad/missing bearer is 401; device token + missing/mismatched `X-Device-Id` is 401).
4. Demo outlet hours are seeded as **`opening_time: "07:00"`, `closing_time: "21:45"`, no `weekly_hours`**
   (legacy fallback — same hours every day, no closed weekday, no past-midnight close). This means:
   Mulai window = `[01:00, 17:45]` (close − 4h), Selesai available from `start + 4h` (capped at close),
   auto-stop at `22:45` (close + 1h). **Known gap this matrix flags, doesn't fix:** the demo seed has no
   closed-weekday or past-midnight outlet, so §3a's D1–D4/W1–W4/E1–E10/S5/S9 browser rows (closed-day and
   past-midnight edge cases) cannot be exercised against the live demo outlet as seeded — only against
   fixtures/unit tests, or by temporarily reseeding demo with different hours (ask Rangga first; that
   would touch shared demo data other sessions might be using).
5. No "fake now" dev clock-offset control exists in the shipped code (checked: no `fakeNow`/`DEV_NOW`/
   `now_offset` anywhere in `origin/main`). Rows that need a specific time-of-day must either (a) use
   Playwright's `page.clock.install()`/route interception on the client's `Date.now()` calls, or (b) drive
   the session via direct API calls with crafted `started_at_ms`/`debrief_ends_at_ms` timestamps where the
   contract allows it (see §6.6.3–§6.6.5), never by editing the real wall clock.

**Tooling:** Playwright (scripted) for the repeatable browser rows — 360px and 1280px, console-error +
network capture, screenshot on failure. Claude-in-chrome only for exploratory spot checks. Never a real
mic capture in either tool — use `--use-fake-ui-for-media-stream`/`--use-fake-device-for-media-stream`
(Chromium flags) or pre-recorded fictional WebM/Opus fixtures for anything that needs "speech"; §11 (real
mic, real recording) is Rangga-only, by hardware necessity.

**Executing this later:** work top to bottom; each task section is independently re-runnable (check only
that section's boxes). Record Pass/Fail/Notes inline in the tables as they're run — don't create a second
document. A single reproduced defect of any severity (per `CLAUDE.md`'s QA zero-tolerance rule) means
DO-NOT-SHIP for the demo build as a whole, even if every other row passes.

---

## 1. Cross-cutting hard-rule checks (CLAUDE.md §2 — apply across every task below)

Run these once per execution pass; cite them again inline wherever a specific task row re-triggers the
same rule (e.g. R-04's redaction, R-07's answer-route RBAC).

| # | Hard rule | Verification method | Pass/Fail | Notes |
|---|---|---|---|---|
| H1 | No audio or base64 ever reaches Firestore/logs/errors (#2) | PUT a fictional segment via the API (§5), then inspect the Cloud Run service logs (`gcloud logging read` — read-only) and the stored `segments` doc for the response body / any field; grep for base64-looking strings (`[A-Za-z0-9+/]{100,}={0,2}`) in both | | |
| H2 | Transcript text is redacted before storage (#3) | Send a segment whose fictional speech contains an Indonesian-format phone number and a seeded staff name (see §11); fetch the stored segment/thread doc server-side and confirm the raw text never appears, only `[STAFF]`/the DLP placeholder | | |
| H3 | Every API route checks `outlet_id` + `role` server-side, not just client-side (#6) | For each route in §6.6 that this demo build ships, call it with (a) no token, (b) a wrong-role token (owner token on a device route, device token on an owner-only route), (c) a correct-role token for a *different* outlet if a second outlet can be seeded safely, else assert the outlet is read only from verified claims in the route source — expect 401/403/404 per §6.6.1, never a leaked doc | | |
| H4 | No staff name outside the `staff` collection (#7); answers/threads/questions/audit carry no name or role, only a device id (#7, §6.6.6) | Inspect a `questions`/`answer`/`thread`/`audit_log` doc after a seeded-name answer flow (§9, §11); confirm fields are exactly `answered_device_id` + timestamps, no `answered_by`/`staff_id`/name anywhere | | |
| H5 | Model location comes from `config/regions.yaml`, never hard-coded (#5) | Read `config/regions.yaml` on `origin/main`; cross-check each of `lib/transcribe/gemini.ts`, `lib/pipeline/label/client.ts`, `lib/redact/dlp.ts` for a literal region string instead of a `regions.yaml` read (grep for `asia-southeast2`/`asia-southeast1`/`global` as a bare literal outside that config file) | | |
| H6 | Public repo has no real SOP/transcript/staff/customer data, no `.env`, no key, no audio (#8) | `git grep` on `origin/main` for `.env` (tracked), for any committed audio file extension, for the string "Proofed" outside doc/spec files that are explicitly about the pilot (those are fine; a literal transcript/SOP text would not be) | | |
| H7 | SOP changes only via the proposal pipeline, never a direct edit endpoint (#9) | Not reachable in this scope — no SOP-write route ships yet (R-08/R-09/R-10 are out of scope for the demo build as currently merged); confirm by grep: no route under `app/api/**` performs a direct `sop_versions` write outside what R-08+ would add later | | |
| H8 | The evidence gate is plain code, not an AI call (#10) | Read `lib/pipeline/gate.ts` on `origin/main`; confirm no `@google/genai`/model call inside it, only deterministic rule logic | | |

---

## 2. R-01 — Foundations (`docs/backlog.md` §2 R-01)

**Done when (backlog):** a push to `main` deploys a hello page to Cloud Run in Jakarta; `config/regions.yaml`
lists a location for every model (Transcribe, 3.5 Flash-Lite, 3.5 Flash, the Live model); no API keys,
service accounts only.

| Criterion | Verification method | Pass/Fail | Notes |
|---|---|---|---|
| Demo Cloud Run `web` service is live and serves the app | `curl -I https://web-33uzb53tza-et.a.run.app` → `200` (already confirmed live during this doc's authoring, 8 Oct) | | re-confirm at execution time |
| Service region is `asia-southeast2` (Jakarta) | `gcloud run services describe web --region=asia-southeast2 --project=bee6-playground` (read-only describe, not a config change) or check the Cloud Run console | | |
| `config/regions.yaml` has a resolved location for every model in use (Transcribe, Flash-Lite, Flash) | Read `config/regions.yaml` on `origin/main`; cross-reference against `docs/tasks/R-01-gcp-state.md`'s probe table | | Live model (R-16) is "if time", not expected to be resolved — do not fail on that entry alone |
| No API keys anywhere in the deployed config/env | Check Cloud Run service's env vars (`gcloud run services describe ... --format='value(spec.template.spec.containers[0].env)'`, read-only) for any `*_API_KEY`; confirm only service-account-based auth | | |
| `GOOGLE_CLOUD_PROJECT` env var fix (tracked gap) | Confirm the var is now set on the demo Cloud Run service's env, and that a live segment PUT (§5) no longer 500s with an env-read crash | | **This is the blocking prerequisite from §0 — check it first** |

---

## 3. R-02 — brief check only (dormant by design, not in scope, but a dependency of everything else)

Not a task under test here (status: done, PIN route intentionally off in MVP 1). Two runtime-observable
facts worth a quick confirm since every other section depends on them:

| Criterion | Verification method | Pass/Fail | Notes |
|---|---|---|---|
| `POST /api/v1/auth/pin` returns 404 in this build | `curl -X POST .../api/v1/auth/pin` with any body | | should 404, not 200/500 |
| A wrong `outlet_id`/role is rejected server-side on a route this demo build ships | Covered by H3 above | | cross-ref, don't duplicate |

---

## 4. R-03 — `/capture` page (`docs/backlog.md` §2 R-03)

**Done when (backlog, web spec §5):** silent room → 0 bytes; first syllable intact; 3 min of talk → ≥ 12
segments; 10 min offline → every segment arrives once, in order; external mic unplugged → built-in within
3 s.

**Note:** the *opening-hours auto-gate* version of R-03 was superseded by capture phase plan **P1**
(Mulai/Selesai replace it — §6 below carries the current acceptance). The rows here are what's still R-03's
own scope post-P1: VAD/segment/encode/upload mechanics, independent of session boundaries.

| Criterion | Verification method | Pass/Fail | Notes |
|---|---|---|---|
| Mic permission prompt appears, sample-rate check refuses < 16 kHz | Playwright with a fake low-sample-rate `getUserMedia` device via CDP, on the live demo URL's `/capture` | | |
| Silent room produces 0 upload bytes | Playwright with a fake silent audio track (`--use-fake-device-for-media-stream`) for 30s+; confirm no `PUT /api/v1/segments/...` network call fires | | |
| First syllable of speech is not clipped (pre-roll works) | Inspect `lib/capture/browser/vad.ts`'s pre-roll constant (400 ms per spec) is wired into the engine; Playwright: a fake audio track with a sharp speech onset → confirm the uploaded segment's declared duration includes the pre-roll window | | component-level; full acoustic verification needs a real mic (defer to human checklist if in doubt) |
| 3 min of continuous fake speech → ≥ 12 segments uploaded | Playwright with a looping fake speech track + short pauses matching the batcher's ≤15s/pause rules; count `PUT` calls via network capture | | |
| 10 min simulated offline → every segment arrives once, in order, after reconnect | Playwright request interception: block all `PUT /api/v1/segments/*` for 10 simulated minutes (use fake timers, don't actually wait 10 real minutes), then allow; confirm each segment id PUT exactly once and in ascending seg-id order server-side | | |
| External mic unplugged → falls back to built-in within 3s | Needs a real second audio input device — **human manual-test item**, not Playwright-automatable | | → §13 human checklist |
| Screen wake lock acquired while capturing, released on stop | Playwright: check `navigator.wakeLock` mock is called on session start and `release()` on stop (via `lib/capture/browser/wake-lock.ts` test hooks) or inspect via CDP `Page.setWebLifecycleState`/wake-lock protocol events | | |
| Heartbeat fires every 60s while a session is open | Network capture: confirm `POST /api/v1/heartbeat` cadence ≈60s during a multi-minute Playwright run | | |

---

## 5. R-04 — Segment API → Transcribe → redact → store (`docs/backlog.md` §2 R-04)

**Done when (backlog):** a repeated `PUT` returns `200` with no second model call; no audio or base64
anywhere in Firestore, logs or errors; 5 demo clips come back as readable redacted text.

| Criterion | Verification method | Pass/Fail | Notes |
|---|---|---|---|
| `PUT /api/v1/segments/{device}:{seg}` with a fictional Opus/WebM clip → `200`, transcribed text stored | Live API call with device token (§0 step 3) and a small fictional fixture clip (never real Proofed audio) | | blocked until the `GOOGLE_CLOUD_PROJECT` fix lands (§0) |
| Repeating the identical `PUT` (same `device:seg` id) → `200`, no second transcribe/model call | Call twice; confirm via Cloud Run logs (read-only) that only one `lib/transcribe/gemini.ts` invocation happened; second response identical | | idempotency per segment id |
| No audio, no base64 in the stored segment doc, in logs, or in any error body | H1 above, re-run specifically for this flow | | |
| Redaction runs before storage — a planted phone number is replaced, not stored raw | H2 above, re-run specifically for this flow; see §11 for the full staff-name + phone-number combined check once Rangga's real recording exists | | can be partially pre-verified now with a **synthetic** (non-mic) fixture clip containing a spoken fictional Indonesian-format number, if one can be generated without a real recording |
| 5 fictional demo clips come back as readable, redacted text | Run 5 distinct fictional fixture clips (Tiffany's demo clips, T-702, if available under `/private/` or a committed fictional fixture) through the live segment API; manually read each resulting stored text for plausibility | | never use real Proofed clips, per hard rule #8 |
| Content-Type checked before the body is read (size/DoS guard) | `curl -X PUT` with a wrong Content-Type and an oversized body → expect rejection before any transcribe call (check logs for no upstream call attempted) | | |
| Segment route checks device auth before touching Firestore | H3 (RBAC probe): call the route with no token, with an owner token, with a mismatched `X-Device-Id` | | |
| TTL on `segments` (48h) is configured | Check Firestore TTL policy on the `segments` collection in `bee6-playground` (read-only `gcloud firestore` describe, or Firestore console) | | |

---

## 6. R-05a — Pipeline plain code: windowing, threads, evidence gate (`docs/backlog.md` §2 R-05a)

**Done when (backlog):** unit tests pass for parallel threads, a thread across 3 windows, and every gate
rule. This is pure-logic code with no UI — verify by exercising the real functions with crafted inputs, not
by re-deriving from the unit tests the developer already wrote (those are the pre-push hook's job).

| Criterion | Verification method | Pass/Fail | Notes |
|---|---|---|---|
| Windowing: ≥90s silence or 6min cap closes a window; tiny windows batch; empty windows make no call | Craft a fictional line sequence through `lib/pipeline/windowing.ts` directly (a small script or REPL import, not editing the file) with gaps at 89s/90s/91s and a 6min+ run; confirm window boundaries match spec | | |
| Thread builder: a thread spanning 3 windows joins correctly via `reply_to` + grace period | Craft 3 windows' worth of fictional lines with cross-window `reply_to` links through `lib/pipeline/threads.ts`; confirm one thread, not three | | |
| Evidence gate: every documented rule fires on the right input (`invalid_label`, `needs_supervisor_confirm`, `no_evidence`, `below_threshold`, `label_conflict`, `always_question`) | Craft one fictional input per rule through `lib/pipeline/gate.ts`; confirm the expected `GateDecision` | | this is the "unit-test-shaped but run live against the real function" style per QA's E2E-for-pure-logic guidance |
| Hypothetical trap ("kalau nanti … habis") labelled TRAINING, not a false fact | Run the exact trap phrasing (fictional) through the real label pipeline end to end (§7) — this criterion technically belongs to R-05b, cross-referenced here since the gate is downstream of it | | see §7 for the authoritative 5/5 check |

---

## 7. R-05b — Label call + Cloud Scheduler tick service (`docs/backlog.md` §2 R-05b)

**Done when (backlog):** the hypothetical trap ("kalau nanti … habis") is labelled TRAINING on 5/5 runs;
outputs pass zod; failures become questions, not facts.

| Criterion | Verification method | Pass/Fail | Notes |
|---|---|---|---|
| Hypothetical trap → TRAINING on 5/5 independent runs | Push a fictional segment containing the trap phrasing through the live segment API 5 separate times (distinct seg ids), let the tick fire (it runs every 2 min on `POST /api/internal/pipeline/tick`, Scheduler-driven — or invoke the internal route directly with a valid Cloud Tasks/Scheduler OIDC token if testable), inspect the resulting thread's category each time | | blocked until §0's env-var fix; also needs the label model (`gemini-3.5-flash-lite`) actually reachable from demo's region per `regions.yaml` |
| Label model output validated against zod; a schema-invalid model response becomes a question, not a silently-accepted fact | Cannot force a malformed model response live; instead confirm via code read that `lib/pipeline/label/wire-schema.ts` validation + `lib/pipeline/label/failure.ts`'s failure→question mapping is wired into `lib/pipeline/tick/service.ts` on the live route (not a stub) | | genuine negative-path coverage needs either a mocked model response (test-only) or accepting this as a code-read confirmation, not a live-call reproduction — flag as a partial if executed |
| `/api/internal/pipeline/tick` rejects a request without valid Cloud Tasks/Scheduler OIDC | H3-style probe: call the route directly with no OIDC token / a forged one → expect 401/403, never runs the tick | | this route is explicitly internal-only per CLAUDE.md §3 |
| One device at a time under a lease; a lease conflict doesn't double-process | Fire two overlapping tick invocations (if the route can be called twice near-simultaneously by the executor) and confirm only one actually advances a given device's pipeline state, OR confirm via code read of `lib/pipeline/tick/service.ts`'s lease logic if concurrent live triggering isn't practical from outside | | |
| Private (non-work) lines are deleted after labelling, only counted | After a segment labelled `NON_WORK`, confirm the segment's stored line text for that line is gone (not just excluded from the thread) — inspect the Firestore doc directly (read-only) | | |

---

## 8. Capture phase plan P1 — Mulai / Selesai / Batalkan / auto-stop (`docs/backlog.md` §3 "The capture
phase plan", §3a; `docs/specs/technical-specification.md` §8)

**Done when (backlog, §3a):** the §3a browser rows pass. That table has ~70 rows (U1–U3, M1–M6, W1–W4,
D1–D4, K1–K2, C1–C8, E1–E10, S1–S12, MD1/2/4, A1–A9) and is itself a QA-authored Playwright test plan
already referenced in the spec — this matrix does not re-type all ~70; it picks the rows that most directly
prove the "Mulai/Selesai/Batalkan/auto-stop" behaviour named in the dispatch brief, run them against the
**live demo URL**, and points back to `docs/backlog.md` §3a for the full set if deeper/exhaustive re-run is
ever wanted. The closed-weekday/past-midnight-specific rows (D1–D4, W1–W4, E1–E10, S5, S9) are **not
exercisable against the live demo outlet as currently seeded** (§0 note) — mark those "blocked (seed
limitation)" rather than skipping silently.

| # | Row (adapted from §3a) | Verification method (live demo URL) | Pass/Fail | Notes |
|---|---|---|---|---|
| P1-1 | Mulai enabled inside its window, disabled outside it, with the correct disabled-reason note | Playwright: load `/capture`, confirm Mulai's enabled state and note text match `mulaiAvailability` for the current real time against the seeded 07:00–21:45 hours (window `[01:00,17:45]`) | | |
| P1-2 | Double-tap Mulai → exactly one session created, no dup POST | Playwright: rapid double-click Mulai, inspect network tab for exactly one `POST /api/v1/capture/sessions` | | |
| P1-3 | Mulai starts audio capture (mic prompt + VAD state) on tap | Playwright with fake media stream; confirm `state_changed` reaches a "listening" state after tap | | |
| P1-4 | Selesai hidden before `start + 4h` (capped at close), shown with no reload once reached | Start a session via direct API call with a crafted `started_at_ms` such that `start+4h` is imminent; wait (fake timers, not real wall-clock wait) past the threshold; confirm Selesai button appears with no page reload | | |
| P1-5 | Selesai confirm dialog appears, "Belum, lanjut" changes nothing, confirming ends the session | Playwright: tap Selesai, screenshot the confirm, tap "Belum, lanjut", confirm no state change; reopen, confirm Selesai for real, confirm session ends (`ended` state, debrief entry appears) | | |
| P1-6 | Auto-stop fires at close+1h (22:45) if Selesai was never tapped | API-level: start a session via `POST /api/v1/capture/sessions` with a `started_at_ms` far enough in the past that the auto-stop deadline has passed; let the tick/timer catch it (or call the equivalent internal route if directly testable); confirm the session ends with `auto_stop`, `debrief_ends_at_ms` = auto_stop+1h | | |
| P1-7 | Batalkan (cancel) panel: 1s arm delay on the destructive button, 15s self-close with no tap | Playwright: open the cancel panel, confirm the delete button is disabled for ~1s then enabled; separately open it and wait 15s (fake timers) with no tap, confirm it auto-closes with nothing discarded | | |
| P1-8 | Cancel while capturing: no flush, only this session's queue purged, in-flight upload aborted, no segment with its id stored server-side | Playwright: start, speak (fake audio) for a few seconds, cancel + confirm delete; inspect network tab (aborted request) and, server-side, confirm no segment doc exists for that session's seg ids | | matches §3a row C1/C2 |
| P1-9 | Discard route: idempotent (calling twice → 200 + no second audit entry); ended `selesai` session → 409 `session_ended` | Direct API calls: `POST .../discard` twice on the same session; separately end a session normally then try to discard it | | |
| P1-10 | Upload status line: headline stays "Listening"/green through a retry sequence; a drop-then-upload ends `succeeded`; a 401 mid-drain → `retrying`, never falsely `succeeded` | Playwright with request interception: force one segment PUT to 503 twice then 200 (watch the line go `uploading → retrying(1x) → retrying(2x) → succeeded`); separately force a 401 and confirm it never reports `succeeded` | | matches §3a row U1 |
| P1-11 | Tab lock: a second tab/device session shows `tab_busy`, doesn't start a second capture | Open `/capture` in two Playwright browser contexts with the same device token; confirm the second shows `tab_busy` and never calls `startCaptureSession` | | |
| P1-12 | Reload mid-session → `interrupted` state, "Lanjutkan" resumes the same `session_id` | Playwright: start a session, reload the page, confirm `interrupted` + Lanjutkan button, tap it, confirm the same session id continues (no new session created) | | |
| P1-13 | 401/403 on a capture route are retried, not treated as terminal | Request interception: force `POST /api/v1/heartbeat` or a segment PUT to 401/403 once, then succeed; confirm the client retries (per the upload-status contract) rather than abandoning | | |
| P1-14 | Consent gate is fully gone — no `consent_complete` field read anywhere, no "no consent" screen | Playwright: confirm `/capture` never shows a consent screen regardless of outlet state; `GET /api/v1/capture/config` response has no `consent_complete` key (contract check) | | this was explicitly removed per `chore/remove-consent-flag` (PR #14) |
| P1-15 | Page fits a 360px-wide viewport with the dev panel closed (production view) | Playwright screenshot at 360×640, confirm no horizontal scroll/overflow | | |
| P1-16 | RBAC: capture session routes (`sessions`, `.../end`, `.../discard`) reject non-device tokens | H3 probe, specific to these 3 routes | | |
| P1-17 *(blocked — seed limitation)* | Closed-weekday / past-midnight rows (D1–D4, W1–W4, E1–E10, S5, S9 in §3a) | Needs an outlet seeded with `weekly_hours` including a closed day and/or a past-midnight close — not present on `demo-outlet` as currently seeded | blocked | ask Rangga before reseeding demo with different hours; don't do it unilaterally — other sessions may depend on the current seed |

---

## 9. R-07 — Tap debrief: server + phone + screens (`docs/backlog.md` §3 R-07)

**Done when (backlog, abridged — full text above in this doc's research, verbatim in `docs/backlog.md`):**
a staff member gives 5 typed Ya/Tidak+reason answers on a paired device in ~5 min with no sign-in; an
answer without a choice or an empty/whitespace reason is refused (400); a 501-char reason is refused (400),
500 accepted; *Lewati* leaves the question open, expires `unverified`; a *Tidak* on a thread question leaves
it `excluded_from_evidence`/`staff_rejected`, closes the question without a new one; a typed phone number is
stored as the SDP placeholder; a redaction failure stores nothing (503) and the phone retries; a supervisor
token on the answer route gets 403; Mulai stays disabled until the debrief's 1h timeout even if every
question is answered; the supervisor sees "a staff member answered" (no name/device id — though note: **no
supervisor screen ships yet**, so this can only be checked at the API-response level, not a UI); two devices
of the same outlet see only their own questions; `POST /api/v1/auth/pin` returns 404; a typed staff name is
stored as `[STAFF]`; the debrief entry appears within 2s of Selesai/auto-stop.

| Criterion | Verification method | Pass/Fail | Notes |
|---|---|---|---|
| Debrief entry button appears on `/capture` within 2s of Selesai (or auto-stop), enabled, no sign-in needed | Playwright: end a session (Selesai), start a timer, confirm the debrief entry card renders within 2s | | |
| Top ≤5 open questions for *this device only*, incidents first then oldest-first | Seed/trigger enough fictional threads to generate >5 questions across categories incl. one incident category; confirm the device only ever sees its own device_id's questions, incidents surfaced first | | |
| Question shows the two-part SOP-implementation template: headline, Ya/Tidak (nothing preselected), required reason field with a live code-point counter, no `maxLength` attribute, no *Bukan ini*, no reason chips | Playwright: screenshot a question screen; assert no option is pre-selected; type into the reason field and confirm the counter tracks code points (test an emoji / multi-byte char) | | |
| *Lanjut* disabled until a choice is made AND the trimmed reason is non-empty; disabled again over 500 (code points), text kept, nothing cached | Playwright: try Lanjut with no choice (disabled), with Ya + empty/whitespace reason (disabled), with Ya + 501 chars (disabled, text still shown) | | |
| API: empty/whitespace reason → 400 `reason_empty`; invalid `answer` value → 400 `invalid_body`; reason > 500 code points → 400 `reason_too_long`, nothing stored; exactly 500 accepted | Direct `POST /api/v1/questions/{id}/answer` calls with each malformed body | | |
| *Lewati* sends nothing, leaves the question open with no choice/reason pre-filled on reopen; unanswered → `unverified` after the debrief ends | Playwright: tap Lewati, confirm no network call fires for that question; reopen within the hour, confirm blank state; let the debrief window pass (API-level: query the question after `debrief_ends_at_ms`) | | |
| *Tidak* + reason on a thread question → gate `staff_rejected`; thread `excluded_from_evidence: true`, not confirmed; question closes as rejected, `status: "answered"`, `answer: "no"`; no new question created | Answer a seeded thread-question with Tidak via the live API; inspect the resulting thread + question docs server-side | | |
| *Ya* + reason on a low-confidence non-sensitive thread → `staff_confirmed`, `gate_version: "2"`, fact uses the thread's model category regardless of reason content | Same flow with Ya; confirm the gate input is the thread's category, not anything parsed from the reason text (try an "opposite" reason and confirm it doesn't change the outcome) | | |
| A typed Indonesian-format phone number in the reason is stored as the SDP placeholder, never raw, never in logs/error bodies | Answer a question with a reason containing a fictional phone number; inspect the stored doc + Cloud Run logs | | ties to H2 |
| A typed seeded staff name ("Ari Demo"/"Bella Demo") in the reason is stored as `[STAFF]` | Answer with a reason containing "Ari Demo" or "Bella Demo" verbatim; inspect the stored doc | | **must be one of the two seeded names, not an arbitrary fictional name** — the scrub matches known staff, not generic NER |
| A redaction (SDP) failure → 503, nothing written, phone retries in ~60s | Force the DLP call to fail (if a safe way exists without touching prod config — otherwise mark "needs a mocked-failure environment, not live-forceable" and defer) | | may not be live-forceable without touching shared infra — judgment call at execution time |
| Supervisor/owner token on the answer route → 403, nothing written | H3-style probe with an owner/supervisor Firebase ID token against `POST /api/v1/questions/{id}/answer` | | |
| Mulai stays disabled until the debrief's 1h timeout even once every question is answered | Answer every open question quickly after Selesai; confirm Mulai is still disabled until `debrief_ends_at_ms`, not released early | | |
| A second paired device of the same outlet sees only its own questions; 404 on the first device's question id | Needs a second device credential (pair a second time with a fresh code against the same outlet, or a second seeded device if the seed supports it) — call `GET /api/v1/questions` and `.../answer` on the other device's question id | | |
| Each device's unanswered questions expire at its own debrief end, independent of another device's | Same two-device setup, offset the two sessions' end times, confirm independent expiry | | |
| `POST /api/v1/auth/pin` → 404 | Direct call, cross-ref §3 | | |
| Stored answer doc has `answered_device_id` + timestamps only, no `answered_by`, no `staff_id`, no name | H4 re-run for this flow | | |
| Mode label reads "room" with 1 paired device, "wearable" with 2+, display-only (no behaviour difference) | Pair a second device, confirm the DevPanel's mode readout changes but no session/debrief rule changes | | needs `NEXT_PUBLIC_DEV_CONTROLS=true` locally to see the readout (DevPanel is dev-only) — not visible on the live prod-mode demo URL itself; verify the underlying `captureMode()` behaviour via API/state instead for the live-URL pass |

---

## 10. DEV-01 — `/capture` developer mode (`docs/tasks/DEV-01-capture-dev-mode.md`)

**Acceptance (from the task doc):** typecheck/lint/vitest clean (pre-push hook's job, not re-derived here);
dev panel provably absent (not just hidden) when the flag is unset; manual start/pause/stop reuses the real
session functions; event log shows real transitions, no transcript/audio content by construction; real
(non-dev) `/capture` behaviour is unchanged.

| Criterion | Verification method | Pass/Fail | Notes |
|---|---|---|---|
| With `NEXT_PUBLIC_DEV_CONTROLS` unset (the live demo URL's actual build config), the dev panel is absent from the render tree, not CSS-hidden | Playwright: load `/capture` on the live demo URL, query the DOM for the dev panel's container — expect zero matching nodes, not `display:none` | | confirms the **production build has the flag off**, which is itself a hard-rule-adjacent check (dev tooling must never leak to a real deploy) |
| Locally (`NEXT_PUBLIC_DEV_CONTROLS=true`), Start/Pause/Stop call the exact same session functions the real page uses; a fresh session starts after pause (not stale) | This requires a **local** dev server, not the live demo URL — run `npm run dev` with the flag set, Playwright against `localhost` | | out of scope for "live demo URL" rows; still worth one local pass since it's part of this build |
| Event log never contains a `text`/`transcript` field (type-level guarantee) | Code read: `lib/capture/browser/event-log.ts`'s `CaptureEvent` union has no such field, confirmed by the `@ts-expect-error` test already in the suite — re-derive by reading the type, not just trusting the test's existence | | |
| Event log renders live transitions (`state_changed` → `segment_opened` → `segment_closed` → `segment_upload_started` → `segment_upload_result`) while speaking (fake audio) | Local dev server + Playwright with fake media stream; confirm the sequence appears in the panel | | DEV-01's own doc flags this exact sequence as never independently verified live (Task 4) — this closes that gap if run |
| 360px layout holds with the dev panel open | Screenshot at 360×640 locally with the flag on | | |

---

## 11. RESERVED — Rangga's live spoken-recording test (stub; fill in once he has done it)

**Not executed by QA — real microphone/hardware test, per the task brief, planned separately.** This section
is the checklist QA (or whoever reviews his results) uses once Rangga has recorded through the real
`/capture` page on the demo outlet with a **planted fictional phone number and one of the two seeded staff
names spoken aloud**.

**Required planted content for the recording (do this before recording, not after):**
- Speak a fictional Indonesian-format phone number (e.g. "nol delapan satu dua, tiga empat lima enam, tujuh
  delapan sembilan nol" / or read digits directly — any clearly Indonesian mobile-format number, fictional).
- Speak one of the two seeded staff names **verbatim**: "Ari Demo" or "Bella Demo" (not "Ari", not a
  different name — the scrub matches the exact seeded `staff.name`/`name_key`, not generic NER, so an
  off-list name will NOT be scrubbed and that is expected, not a bug).
- Say something that plausibly maps to one working category (e.g. a restock/customer-service/training-style
  sentence) so the pipeline has something to label.
- Optionally include the hypothetical-trap phrasing ("kalau nanti... habis...") to cross-check §7's trap
  result against a real transcription, not just a fictional text fixture.

| # | Item | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| R1 | Transcription produces a plausible work note from the real recording | The stored segment text reads as a sensible (if imperfect) transcription of what was actually said | | |
| R2 | DLP redaction removes the planted phone number from the **stored** transcript | Fetch the stored segment/thread text server-side; the raw digit sequence does not appear; a DLP placeholder (e.g. `[PHONE_NUMBER]`) appears in its place | | if the raw number is still present anywhere retrievable, this is a **blocking** hard-rule violation, not a minor defect |
| R3 | Staff-name scrub removes the spoken seeded name ("Ari Demo" or "Bella Demo") from the stored text | Fetch the stored text; confirm `[STAFF]` appears where the name was said, and the literal name string does not appear anywhere in the stored doc, logs, or error bodies | | must be one of the two seeded names — if Rangga used a different name, this row cannot be marked pass/fail and must be re-recorded |
| R4 | The pipeline tick turns the segment into a thread with the expected category | After the next tick cycle (≤2 min), query the resulting thread; its category matches what the spoken content plausibly maps to (judgment call, not exact-match) | | |
| R5 | A debrief question appears for anything that should trigger one (low confidence, incident category, or a gate rule that defers to staff) | After Selesai/auto-stop, check the device's open questions for an entry tied to this thread, if the content was ambiguous/sensitive enough to warrant one | | if the content was clearly high-confidence routine work, no question is expected — don't fail this row for a correctly-silent gate |
| R6 | No audio or base64 of the real recording ever appears in Firestore, logs, or error bodies | Re-run H1 specifically against this real (not fixture) recording | | still "fictional" content spoken by Rangga, not real Proofed data — but the audio-handling rule applies regardless of whose voice it is |

---

## 12. Execution log (fill in at run time)

| Date | Executor | Sections run | Overall verdict | Notes |
|---|---|---|---|---|
| | | | | |

---

## 13. Human manual-test checklist (hardware this QA pass cannot drive)

- External mic unplugged mid-session → falls back to built-in within 3s. (real second audio device)
- Incoming call mid-session → gap classification + recovery. (real phone, real call)
- Screen off / app switched / phone locked for 5 min → capture continues or opens the correct gap. (real
  device, real OS behaviour)
- Battery to 0% or low+unplugged → `battery_empty` on recovery. (real device)
- `navigator.storage.persist()` real result, and Android backup-exclusion of Chrome site storage. (real
  Android device + OS version specifics)
- A full real shop-hours day (Mulai before prep, Selesai after close) → coverage check. (real day, real
  phone — N/A for the demo build specifically, this is a pilot-side item, listed here only because it's the
  same underlying mechanism this matrix's §8 exercises in miniature)
- §11 above in full (real mic, real voice) — Rangga only, by design.

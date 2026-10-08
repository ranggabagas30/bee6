# bee6

SOP Improvement Agent for small F&B shops, built for the GATI x Google Cloud
AI Builder Cup 2026. A web app listens to a shop's day through one paired
phone — staff tap **Mulai** to start and **Selesai** to end the day; capture
also stops on its own 1 hour after closing — and turns speech into short work
notes (audio is never kept). A 1-hour debrief then asks staff, one tap at a
time, whether flagged moments happened and why. The system proposes changes
to the shop's SOP from that evidence; a supervisor checks each proposal, the
owner approves it, it ships as a new SOP version, and the system checks on a
set date whether it worked. Pilot shop: Proofed (Indonesia). Judges try it
through a demo outlet in the same app.

## Stack

- **App:** Next.js (App Router) + TypeScript (strict), one Cloud Run service
  `web` in `asia-southeast2` (Jakarta) — screens, API routes, pipeline
  handlers and agents all live in this one service.
- **Data:** Firestore (Native mode, `asia-southeast2`).
- **Auth:** Firebase Authentication — Google sign-in for the owner and
  supervisors, a custom token per paired device (claims
  `{ outlet_id, role, device_id? }`). No staff sign-in in MVP 1 (the staff
  PIN route from R-02 exists but is dormant, returns 404).
- **AI:** `@google/genai` against Google Cloud (Vertex mode) only —
  `gemini-3.5-transcribe-preview` for transcription, `gemini-3.5-flash-lite`
  for windows → threads → labels, `gemini-3.5-flash` reserved for the
  Proposal/Critic/Review agents, and a Live API model for the voice debrief
  only "if time" (R-16). No other AI provider or API key anywhere in the
  product code. Each model's region comes from `config/regions.yaml`, filled
  in by `npm run probe` against a real GCP project — never hard-coded.
- **Agents:** Google ADK for TypeScript, planned for the Proposal/Critic/
  Review agents (R-08 onward) — not yet integrated; today the pipeline runs
  only through the plain-code windowing/thread-builder/evidence-gate step and
  the label call.
- **Async work:** Cloud Scheduler drives the pipeline tick and the review
  dates; Cloud Tasks → `/api/internal/*` (OIDC-verified) for other async
  work. The debrief itself has no Scheduler job — it starts on the phone at
  Selesai or the auto-stop.
- **Browser capture:** `getUserMedia` + AudioWorklet (16 kHz) + Silero VAD
  (ONNX Runtime Web) + WebCodecs Opus + Screen Wake Lock. An on-device
  encrypted audio queue (IndexedDB + WebCrypto AES-GCM, capture phase plan P3)
  is planned but not built; it will stay off on the pilot until Rangga's
  written sign-off.
- **Validation:** zod on every API input and every model output.
- **Tests:** unit tests for the gate, thread builder, windowing, role checks
  and schemas; a smoke test per milestone with a fictional clip is planned
  (R-13) but not built yet.

## Current state (8 Oct 2026)

**Built and merged to `main`:**
- R-01 foundations — Next.js/TypeScript skeleton, region probe, CI/CD config.
- R-02 data model, Firebase Auth sign-in, and RBAC (owner/supervisor see only
  their outlet; a wrong `outlet_id` is rejected server-side).
- R-03 `/capture` capture pipeline — mic permission, VAD + Opus segment
  capture, in-memory offline upload queue, screen wake lock, heartbeat and
  self-restart.
- Capture phase plan P1 — Mulai/Selesai/Batalkan (cancel) session boundaries,
  weekly opening hours, and the auto-stop 1 h after closing.
- R-04 segment API → `gemini-3.5-transcribe-preview` → Sensitive Data
  Protection redaction → Firestore, with no audio or base64 ever written to
  storage, logs, or errors.
- R-05a/R-05b pipeline plain code — windowing, cross-window thread builder,
  the evidence gate (plain code, not AI), and the label call
  (`gemini-3.5-flash-lite`) with a staff-name scrub and a scheduled tick
  route (Cloud Scheduler, OIDC-verified) that orchestrates it end to end.
- R-07 tap debrief — the server slice (gate v2, reason checks, routes, tick
  expiry), the phone's answer cache and uploader, and the one-question-at-a-
  time Ya/Tidak + reason debrief flow on `/capture` (entry card, done and
  timeout screens).

**Deployed:** the demo project (`bee6-playground`) has a live Cloud Run `web`
service that auto-deploys on every push to `main` via a Cloud Build trigger
— this is what judges will use. No public submission URL is published here
yet; making every submission link open without login (R-14) hasn't shipped.

**Pending:** the pilot project (Proofed's real outlet) has no Cloud Run
service, Cloud Build trigger, or Scheduler job yet. Pilot go-live was
postponed from Mon 5 Oct to **Mon 12 Oct**, pending internal testing on a
test outlet and Rangga's written sign-off.

**Not started yet:** R-06 (supervisor day-record view), R-08 (ProposalAgent),
R-09 (approval screens), R-10 (SOP versions + before/after list), R-11
(ReviewAgent), R-12 (demo outlet polish), R-13 (eval harness), R-14
(release), capture phase plan P3 (on-device encrypted audio queue), and
capture phase plan P4 (retention/TTL for thread text). R-15 (CriticAgent)
and the P5 cross-device merge have moved to the next MVP, after this one.

See `docs/plan.md` and `docs/backlog.md` for the full task list, dates, and
"done when" criteria.

## Running locally

```bash
npm install
npm run dev            # local dev server
npm run build          # next build
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npm test               # unit tests (vitest run)
npm run probe          # region probe -> config/regions.yaml (needs a real GCP project)
npm run seed           # outlet, users, device pairing code, staff names (PINs dormant)
npm run eval           # placeholder for the R-13 eval harness (not implemented yet)
npm run eval:redaction # measured redaction-accuracy check against a real project
npm run eval:label     # label-model trap eval
```

`npm install` also runs `npm run prepare`, which points git at `.githooks`
(`core.hooksPath`) for this repo. From then on, `git push` runs lint, build,
and unit tests locally first and refuses the push if any of them fail (a
`smoke` step runs too if that script ever exists — it doesn't yet; R-13 is
not built). Use `git push --no-verify` to bypass this deliberately; that's
standard git behavior, reserved for a human's explicit call, not something an
agent decides on its own.

## Using the live deployment

The demo outlet runs on a live Cloud Run service at `https://web-33uzb53tza-et.a.run.app` 
(project `bee6-playground`). This is for judges, visitors, and internal testing only — it uses 
fictional data and is safe to publish.

### Pairing a device

To set up the demo on a phone:

1. **Generate a pairing code** (requires GCP access to the demo project):
   ```bash
   GOOGLE_CLOUD_PROJECT=bee6-playground DEMO_MODE=true npm run seed -- --project demo
   ```
   This prints a 6-digit code valid for 10 minutes.

2. **Pair the phone:** Open `https://web-33uzb53tza-et.a.run.app/pair` in the phone's browser, 
   enter the 6-digit code, and submit. The phone is now linked to the demo outlet.

### Capture and debrief flow

Once paired, open `https://web-33uzb53tza-et.a.run.app/capture` on the same phone:

1. **Mulai (Start):** Tap to begin a capture session. The phone starts listening and transcribing 
   speech into short work notes. The page shows a status line.

2. **Speak naturally:** Say something — mention a staff name (e.g., "Ari Demo" or "Bella Demo", 
   the seeded demo staff), a phone number, a work scenario, or any phrase. The transcription runs 
   in real time with **name-scrubbing and redaction for sensitive data** (names matched against 
   known staff are replaced; phone numbers and addresses are redacted). This part works immediately 
   and can be demoed in minutes.

3. **Selesai (End):** The **Selesai** button becomes available **4 real hours after Mulai**, 
   not based on segment count. Tap it to end the session and trigger the debrief. A full live 
   demo of the Mulai → Selesai → debrief loop therefore requires either waiting 4 hours or is 
   not practical in a single sitting. What can be demoed quickly is step 1–2: Mulai, live capture, 
   and the working transcription/redaction pipeline.

4. **Batalkan (Cancel):** At any time before Selesai, you can cancel the session with a 
   confirmation prompt.

5. **Debrief:** After Selesai, one question appears at a time on the capture screen. Each asks 
   whether a flagged moment happened (based on the captured speech). Answer **Ya** (Yes), **Tidak** 
   (No), or **Lewati** (Skip), and optionally type a reason (max 500 characters, no staff names). 
   Reasons are redacted and stored.

### Notes

- **Demo only.** This is the demo outlet (`bee6-playground`). The **pilot project** (Proofed's real 
  shop) is a separate deployment, not yet live. Pilot go-live is scheduled for **Mon 12 Oct** 
  pending internal sign-off — no public URL is published until then.

- **Fictional data.** The demo outlet, staff, and test transcripts are all fictional. It is safe 
  to try the full flow with made-up speech or the seeded staff names (Ari Demo, Bella Demo).

- **Always online.** Capture requires the browser page to stay open, the screen on, and the phone 
  connected. There is no native app yet.

## Known gaps

- DPIA under PP 33/2026 is the next priority after submission.
- Transcription (`gemini-3.5-transcribe-preview`) is in preview.
- Jakarta (`asia-southeast2`) doesn't yet serve Gemini `generateContent`; per
  the real probe in `config/regions.yaml`, text models fall back to
  `asia-southeast1` (`gemini-3.5-flash`) or `global`
  (`gemini-3.5-transcribe-preview`, `gemini-3.5-flash-lite`). Data and
  services themselves stay in `asia-southeast2`.
- `config/regions.yaml` was probed against the demo project
  (`bee6-playground`) only; it still needs to be re-probed against the pilot
  project before the pilot handles real transcription or labeling, since
  preview-model access can be project-specific.
- The Live API model for the optional voice debrief (R-16, "if time") 404s
  under its current placeholder id; untested, and not scheduled unless time
  remains after the main path.
- Browser capture needs the paired phone's page open, the screen on, and the
  phone plugged in — there is no native app.
- Consent is collected outside the app (the bee6–Proofed paper contract plus
  an emailed notice), not through an in-app gate; revocation is a manual
  procedure, acknowledged and completed within 7 working days.
- A forgotten Mulai looks like a day off — there's no retroactive detection.
- Firestore TTL deletion lags behind the nominal retention window.
- `DAILY_TOKEN_CEILING` (the per-outlet daily cost-guard cap on non-essential
  model calls) is specified in `CLAUDE.md` §7 but not enforced in code yet.
- `T-206` (the incident-keyword fast path — flagging a safety/security
  incident immediately rather than waiting for the normal label pipeline) is
  specified but not built; no task currently owns it.
- A staff-name scrub runs on label-pipeline text today, but the dedicated
  scrub pass over the 14-day-retained thread text (capture phase plan P4)
  hasn't shipped yet; threads have no expiry until P4 lands.
- A measured redaction-accuracy check (`scripts/eval-redaction.ts`, run
  against the real demo project) found Google DLP's `STREET_ADDRESS`
  detector misses common Indonesian "Komplek … Blok … No." addresses
  entirely, and only partially redacts "Jalan … No." addresses it does catch
  (the house number and district survive in clear text). Phone numbers,
  emails, and names all scored correctly. Accepted as a known gap rather than
  building a regex supplement now.
- The per-device debrief answer rate limit is deferred (a follow-up is due
  before the Sun 11 Oct sign-off); the answer route has no rate limit yet.
- The debrief has been verified with unit tests and network-mocked browser
  runs, but a full real-device end-to-end pass (real capture session →
  Selesai/auto-stop → debrief → redaction on the answer route) is still
  pending.
- See `CLAUDE.md` and `docs/` for the full set of hard rules, architecture,
  and other honestly-stated known gaps.

---

Built with Claude Code. Runs entirely on Google Cloud and Gemini.

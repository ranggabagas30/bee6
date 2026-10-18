# Architecture (as built, 18 Oct 2026)

Detail and the full gap list: `specs/technical-specification.md` §9 (as built) and §10 (known gaps).

## Principle
**One architecture for the demo and for real use.** The judges' demo and the pilot shop run the same code,
endpoints, models and prompts. Only the input (a judge reading fictional script cards aloud vs a live shop), the data (fictional vs
real), the project (demo vs pilot) and the clock (the demo can jump days and fast-forward to the review date,
labelled simulated) differ. As built, only the demo project runs services; the pilot has not gone live.

**AI suggests, plain code filters, humans decide.** Every model output passes plain code before it is stored
or shown, and no SOP change ships without a supervisor and the owner.

## Picture in words
```
Paired phone (Chrome, /capture: page open, screen on, plugged in)
  mic → Silero VAD (in browser) → ≤ 15 s speech segments → Opus (WebCodecs)
  → in-memory queue, retry (4 min budget per segment) → PUT /api/v1/segments/{device}:{seg}
                 │
                 ▼
Cloud Run (Next.js, asia-southeast2 Jakarta), one service per environment:
  "web" (judges, from main, Firestore (default)) · "web-develop" (staging, from develop, Firestore "staging")
  ├─ Segment route: Gemini 3.5 Transcribe (in memory, 10 s per attempt, 1 retry)
  │                 → Sensitive Data Protection → Firestore (text only, 48 h TTL); audio dropped
  ├─ Pipeline tick (Cloud Scheduler, OIDC): windows → staff-name scrub → Gemini 3.5 Flash-Lite
  │     (threads, labels, work vs private) → evidence gate (plain code) → facts or debrief questions
  │     → Debrief agent words question headings (demo sandboxes; checker: check_question)
  ├─ Proposal Ask: plain-code range + evidence floor → Proposal agent (Gemini 3.5 Flash; v4 tool loop,
  │     checker: check_proposal; v3 fallback checked by pgate-v1) → supervisor → owner → new SOP version
  ├─ Review: plain-code verdict rev-v1 (daily Scheduler run; demo fast-forward)
  │     → Review agent explains it (demo sandbox fast-forward; checker: check_review)
  └─ Screens: capture + debrief (phone) · day record, questions, proposals (supervisor)
              · home, approvals (owner) · SOP versions · reviews · demo guide and "Try as…"
                 │
   Firestore Native (asia-southeast2): (default) and staging · Cloud Scheduler · Secret Manager
   Firebase Auth · Sensitive Data Protection (asia-southeast2)
   Gemini on Vertex AI via @google/genai and Google ADK; location per model from config/regions.yaml
```

## Components
| Name | Kind | Job | Model / location |
|---|---|---|---|
| Capture | Browser code | Voice detection, segments, upload queue with retry, Mulai / Selesai / auto-stop | Silero VAD (MIT), on the phone |
| Transcriber | Model call | Speech → text, verbatim, ≤ 100 vocabulary terms | `gemini-3.5-transcribe-preview`, `global` |
| Redaction | Google service | Personal details out before any write; fails closed | Sensitive Data Protection, `asia-southeast2` |
| Labeller | Model call | Threads, category, confidence, evidence refs, runner-up, work vs private | `gemini-3.5-flash-lite`, `global` |
| Evidence gate | **Plain code** | Fact or debrief question | — |
| Debrief | Plain code + agent | Tap debrief (Yes / No + reason, or Skip) on the paired phone. The Debrief agent only words a question's heading; checker `check_question`; template fallback; flag `DEBRIEF_AGENT`; demo sandboxes only | `gemini-3.5-flash-lite`, `global` |
| Proposal agent | ADK agent | v4: read-only tools (SOP sections, evidence, intervention, rubric) and the plain-code checker `check_proposal`; flag `PROPOSAL_AGENT_V4`; v3 (one structured call, checked by `pgate-v1`) is the fallback | `gemini-3.5-flash`, `asia-southeast1` |
| Review | Plain code + agent | Verdict suggestion `rev-v1` in plain code. The Review agent explains it in plain English; checker `check_review` (the stored verdict must equal the rule's); plain-card fallback; flag `REVIEW_AGENT`; demo sandbox fast-forward only | `gemini-3.5-flash-lite`, `global` |
| Approvals and SOP versions | Plain code + humans | Supervisor feasible / reject (reason becomes a constraint), owner approve / reject, immutable SOP versions | — |

No Critic agent (dropped 16 Oct): the plain-code checkers are the critic. No agent has a write tool. The voice
debrief (Live API, R-16) is not built.

## Platform
| Piece | Use |
|---|---|
| Cloud Run `web`, `web-develop` | Demo project (`bee6-playground`), `asia-southeast2`; built by Cloud Build on a push to `main` / `develop` |
| Firestore | Native, `asia-southeast2`; `(default)` for `web`, named database `staging` for `web-develop` (`FIRESTORE_DATABASE_ID`) |
| Cloud Scheduler | `pipeline-tick` every minute and `review-run` daily 09:00 Jakarta on `web`; `pipeline-tick-staging` every 2 minutes on `web-develop` (its review run paused). OIDC-verified, audience from env |
| Secret Manager | Runtime secrets (for example `DEMO_IP_SALT`, `THREAD_HANDLE_KEY`) |
| Firebase Authentication | Owner and supervisor: email + password (admin-provisioned, no self sign-up). Paired devices and demo role sessions: custom tokens. Claims `{ outlet_id, role, device_id? }` |
| Vertex AI | Every model call through the runtime service account (no API keys); locations from `config/regions.yaml` |
| Cloud Tasks | Not used (the pipeline is the Scheduler tick) |

## Demo model
Each visitor gets a private sandbox outlet (`sbx-…`, 2 h) cloned from a fictional template, behind `DEMO_MODE`.
A 5-day journey: days 1 to 3 live and scripted, days 4 and 5 optional after the Owner approves. "Jump to
tomorrow" shifts the sandbox's own timestamps (guards include `approve_first` and `review_exists`), the review
can be fast-forwarded (simulated), and per-IP, per-sandbox and daily caps (UTC day) bound spend. Detail:
technical specification §9.2.

## Data flow and privacy
1. Audio lives only in the phone's memory and in the segment request. Never stored in the cloud.
2. Transcript lines are redacted before storage; stored segments expire after 48 h.
3. Private (non-work) lines are removed after labelling and only counted.
4. Kept: threads (category, summary, redacted evidence lines with staff names scrubbed), questions, answers
   (device id and timestamps only), SOP versions, proposals, constraints, reviews, outcomes, audit log.
5. Names only in `staff`; everything else stores roles. Browsers never talk to Firestore.

## Roles (summary)
Owner (email + password; summaries and approvals) · Supervisor (email + password; full day record, proposals,
reviews) · Paired device (pairing code; capture and the tap debrief; no staff sign-in in MVP 1) · Judge (demo
sandbox, picks a role). Full matrix: `specs/web-backend-rbac.md` §2.

## Cost (model spend per outlet per month, estimates)
- Transcribe for all speech: **~$24 / $30 / $37** at 15 / 20 / 25% of the day being speech (modelled, not
  measured on a real shop).
- Modelled cheaper path (Flash-Lite first pass, Transcribe when unsure): ~$11–16. Not built.
- The Proposal agent v4 uses about 3.6 times the tokens of v3 per Ask.

## Known gaps
Full list: `specs/technical-specification.md` §10. In short: Transcribe is preview on shared capacity
(bursts give 429 → 503) · some models run on `global` or Singapore · browser capture needs the page open with
the screen on · on-device audio queue (P3), offline outbox (P2) and thread-text expiry (P4) not built · the
pilot has not gone live · DPIA next.

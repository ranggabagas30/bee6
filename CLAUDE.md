# CLAUDE.md: SOP Improvement Agent (GATI × Google Cloud AI Builder Cup 2026)

You are helping **Rangga** (the only engineer) build this product with an agentic workflow. Rangga gives the goal, approves plans, and reviews every change. **When anything is unclear, ask Rangga. Never invent requirements.**

## 1. What we are building (one paragraph)
A web app that listens to a small F&B shop's day through one phone, turns speech into short work notes (never keeping audio), asks staff *why* gaps happened in a short evening debrief, and proposes changes to the shop's SOP. A supervisor checks each proposal, the owner approves it, it ships as a new SOP version, and the system checks on a set date whether it worked. Pilot shop: Proofed (Indonesia). Judges try it through a demo outlet in the same app.

Read `docs/README.md` for the doc map. **If two docs disagree, the order is:** this file → `docs/plan.md` → `docs/backlog.md` → `docs/specs/web-backend-rbac.md` → `docs/architecture.md` → `docs/specs/pipeline-and-agents.md` → `docs/product-spec.md` → `docs/adr/` (history only).

## 2. Hard rules (never break these)
1. **The product uses only Google Cloud and Google AI.** Gemini models on Google Cloud (Agent Platform, formerly Vertex AI) via the `@google/genai` SDK; Cloud Run; Firestore; Firebase Auth; Cloud Tasks; Cloud Scheduler; Secret Manager; Sensitive Data Protection. **No other AI provider, SDK, or API key in the product code**, even for tests or fallbacks.
2. **Never store audio in the cloud.** Audio arrives in the segment request, is transcribed in memory, and is dropped. No Cloud Storage writes, no audio or base64 in logs, errors, traces or Firestore.
3. **Redact before storing text.** Run Sensitive Data Protection on transcript lines before they are written anywhere.
4. **Real data only on paid Google Cloud.** Never use AI Studio free keys or free quota with real shop data. All model calls go through the Google Cloud project with a service account.
5. **Regions:** services and data in `asia-southeast2` (Jakarta). Each model's location comes from `config/regions.yaml` (Jakarta → Singapore → global, filled by the region probe). Never hard-code a location.
6. **Browsers never talk to Firestore directly.** Every read and write goes through our API, which checks the user's `outlet_id` and `role` on the server.
7. **People data:** staff names live only in the `staff` collection (used to route questions). Threads, proposals, answers, outcomes and audit logs store **roles**, never names. Supervisors see "a staff member answered", never who.
8. **The public repo must never contain:** the shop's real SOP, franchise documents, real transcripts, real staff or customer data, `.env` files, keys, or audio files. Demo data is fictional.
9. **SOP changes only through proposals** (evidence → supervisor → owner). No endpoint edits the SOP directly.
10. **The evidence gate is plain code, not AI.** A label becomes a fact only if the gate's rules pass; otherwise it becomes a debrief question.
11. **Commit small and often.** The git history is our proof the code was written during the hackathon.

## 3. Stack
- **App:** Next.js (App Router) + TypeScript (strict), one Cloud Run service `web` in `asia-southeast2`: screens + API routes + pipeline handlers + agents.
- **Async work:** Cloud Tasks → internal API routes (`/api/internal/*`, verified with the Cloud Tasks OIDC token). Cloud Scheduler for opening/closing, debrief time and review dates.
- **Data:** Firestore (Native mode, `asia-southeast2`).
- **Auth:** Firebase Authentication: Google sign-in for owner and supervisors; custom tokens for the shop device and for staff PIN sessions; custom claims `{ outlet_id, role, staff_id?, device_id? }`.
- **AI:** `@google/genai` against Google Cloud (Vertex mode). Models:
  - `gemini-3.5-transcribe`: all transcription (verbatim mode, custom vocabulary ≤ 100 terms, no diarization, no word timestamps)
  - `gemini-3.5-flash-lite`: windows → threads → labels (structured output with enum schemas)
  - `gemini-3.5-flash`: ProposalAgent, CriticAgent, ReviewAgent
  - a Live API model for the voice debrief (which one is decided by the region probe)
- **Agents:** Google's Agent Development Kit (ADK) for TypeScript. Check the current package name and docs before R-08; ask Rangga if ADK blocks you for more than 2 hours (the fallback is a plain state machine calling Gemini).
- **Browser capture:** `getUserMedia` + AudioWorklet (16 kHz) + Silero VAD in the browser (ONNX Runtime Web; check the licence of any wrapper library) + WebCodecs Opus encoding + Screen Wake Lock.
- **Validation:** zod for every API input and every model output.
- **Tests:** unit tests for the gate, thread builder, windowing, role checks and schemas; one end-to-end smoke test per milestone using a **fictional** audio clip.

## 4. How we work (agentic SDLC)
For every task (R-01 … R-16 in `docs/plan.md`; steps, dependencies and "done when" in `docs/backlog.md`):
1. **Read** the task in `docs/plan.md` and its spec section. List anything unclear and **ask Rangga before coding**.
2. **Plan:** write a short plan (files to touch, data changes, tests, risks) in `docs/tasks/R-xx.md`. Wait for Rangga's "go".
3. **Build** in small commits (conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`).
4. **Test:** unit tests pass; lint and type-check clean; run the smoke test if the task touches the pipeline.
5. **Self-review** against the checklist below, then open a PR with: what changed, how it was tested, screenshots for UI, known gaps.
6. **Rangga reviews and merges.** Deploy to Cloud Run and check the task's acceptance criteria on the live URL.
7. Update `docs/tasks/R-xx.md` with the result and anything left for later.

**Skills:** before writing code for a task, read `docs/skills-policy.md` and load the DAILY skill(s) that match the task (via the Skill tool). It lists which installed skills to use for this repo, which to ignore, and that `claude-api` is suppressed (the product uses Gemini only). This applies to every session, including spawned sub-agents.

**Self-review checklist (every PR):**
- [ ] No non-Google AI calls; no secrets; no audio persisted or logged
- [ ] Every API route checks role + outlet on the server
- [ ] Model outputs validated with zod; failures handled (retry or become a question)
- [ ] Names never stored outside `staff`
- [ ] Model location read from `config/regions.yaml`
- [ ] Works on a 360 px-wide phone screen
- [ ] Tests added or updated; acceptance criteria listed in the PR are met

## 5. Task list and dates (from `docs/plan.md`)
Rangga works ~4 h on weekdays and ~8 h on weekends.

| ID | Task | Est | Target | Spec |
|---|---|---|---|---|
| R-01 | GCP projects, billing caps, **region probe script**, repo, Cloud Build → Cloud Run, Next.js skeleton | 4 h | Wed 30 Sep | plan §4 |
| R-02 | Firestore schema v0; Google sign-in + roles; shop device token + staff PIN via seed script | 5 h | Thu 1 – Fri 2 | web spec §2, §3, §6.4 |
| R-03 | `/capture` page: mic + input picker, browser VAD, 15 s segments, Opus, upload + in-memory retry, wake lock, heartbeat, status | 8 h | Fri 2 – Sat 3 | web spec §4.1, §5 |
| R-04 | Segment API → Gemini 3.5 Transcribe → redaction → store (no audio saved) | 4 h | Sun 4 | web spec §6.2–6.3 |
| — | **Go-live step 1 at Proofed** (capture + transcription) | | **Mon 5 Oct** | |
| R-05 | Windowing + thread builder + evidence gate as plain code (Sun 4), then the label call (Mon 5) | 7 h | Sun 4 – Mon 5 | pipeline spec E3 |
| R-06 | Day record screen (supervisor full, owner summaries) | 3 h | Tue 6 | web spec §4.3–4.4 |
| R-07 | Tap debrief on the shop device (PIN → ≤ 5 questions → answer) | 3 h | Wed 7 | pipeline spec T-402, web spec §4.2 |
| R-08 | ProposalAgent (ADK) with evidence rule + suppression | 5 h | Wed 7 – Thu 8 | pipeline spec T-504 |
| R-09 | Approval screens (supervisor reason → permanent constraint; owner approve) | 4 h | Fri 9 | pipeline spec T-506/T-507 |
| R-10 | SOP versions + simple v1→v2 diff | 2 h | Sat 10 | pipeline spec T-508 |
| R-15 | CriticAgent (uses the evidence gate as a tool) | 3 h | Sat 10 | pipeline spec T-505 |
| R-16 | Voice debrief (Live API, one shared session per close, agent speaks first; tap fallback) | 6 h | Sun 11 | pipeline spec T-403 |
| R-11 | ReviewAgent + Scheduler (Wed 14, 09:00 WIB) + verdict screen + outcome memory | 4 h | Mon 12 | pipeline spec T-509/T-510 |
| R-12 | Demo outlet: seed via the real segment API, "Try as …", rate limits, fast-forward (labelled simulated) | 4 h | Tue 13 | web spec §4.5 |
| R-13 | Eval script: confusion matrix from the gold-set sheet + Transcribe quality on 20 clips | 2 h | Wed 14 | pipeline spec T-804, T-207 |
| R-14 | README, tag v1.0, uptime check, incognito test of every link | 3 h | Thu 15 | pipeline spec T-814–T-818 |

Key dates: go-live Mon 5 Oct · first proposal Fri 9 · SOP v2 Sat 10 · review Wed 14 · freeze Thu 15 · **submit Fri 16 Oct**.

## 6. Commands (fill in during R-01)
```
npm run dev         # local dev
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm test            # unit tests
npm run smoke       # end-to-end smoke with a fictional clip
npm run probe       # region probe → config/regions.yaml
npm run seed        # create outlet, users, device token, staff PINs (pilot or demo)
# deploy: Cloud Build trigger on main → Cloud Run (asia-southeast2)
```

## 7. Environment (names only; values live in Secret Manager or .env.local, never committed)
`GOOGLE_CLOUD_PROJECT` · `APP_REGION=asia-southeast2` · `FIREBASE_*` (web config) · `CLOUD_TASKS_QUEUE` · `TASKS_INVOKER_SA` · `DEMO_MODE` (true only in the demo project) · `DAILY_TOKEN_CEILING`

## 8. Cost guards
- Log input/output tokens and audio seconds per call, per outlet, per day.
- Stop non-essential model calls for an outlet when `DAILY_TOKEN_CEILING` is reached (capture keeps queuing; nothing is lost).
- Demo project: per-IP rate limits and a daily cap on live calls.

## 9. Known gaps (state them honestly in the README)
- DPIA under Indonesia's PP 33/2026 is the **next priority after submission**.
- Gemini 3.5 Transcribe is in preview.
- Some models may run on the global endpoint if they aren't offered in Jakarta or Singapore (see `config/regions.yaml`).
- Browser capture needs the shop phone plugged in with the capture page open and the screen on.
- Transcription with Transcribe only costs ~$24–37 per outlet per month; a cheaper first-pass path is modelled, not built.

## 10. Credits line for the README
"Built with Claude Code. Runs entirely on Google Cloud and Gemini."

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

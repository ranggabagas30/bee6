# CLAUDE.md: SOP Improvement Agent (GATI × Google Cloud AI Builder Cup 2026)

You help **Rangga** (the only engineer) build this product. Rangga sets the goal, approves plans and reviews every change. **When anything is unclear, ask Rangga. Never invent requirements.**

## 1. What we are building
A web app that listens to a small F&B shop's day through a paired phone and turns speech into short work notes (audio is never stored in the cloud). Staff tap **Mulai** to start and **Selesai** to end the day; capture also stops by itself 1 h after closing (the auto-stop). A 1-hour debrief starts at Selesai or the auto-stop and asks staff whether flagged moments happened and why. The system proposes SOP changes; a supervisor checks each one, the owner approves it, it ships as a new SOP version, and it is reviewed on a set date. Pilot shop: Proofed (Indonesia). Judges use a demo outlet in the same app.

**Detail lives in the revised docs:** session, capture, debrief, offline queue, retention and privacy rules in `docs/specs/technical-specification.md` §8; routes and data in `docs/specs/web-backend-rbac.md` §6.6; sprints and phases in `docs/plan.md`; screens and copy in `docs/tasks/UX-03-journey-design.md`. Doc map: `docs/README.md`.
**If two docs disagree:** this file → `docs/specs/technical-specification.md` → `docs/plan.md` → `docs/backlog.md` → `docs/specs/web-backend-rbac.md` → `docs/architecture.md` → `docs/specs/pipeline-and-agents.md` → `docs/specs/product-spec.md` → `docs/adr/` (history only). Within dated notes, the newest wins. **UI vs functional:** UX decisions (UX-03) win on how a screen looks, reads or is worded; the technical specification wins on functional and technical behaviour (sessions, queue, routes, data, retention, consent, privacy). English is the default UI language; Bahasa is the second column.

## 2. Hard rules (never break these)
1. **Google only.** Gemini on Google Cloud (Vertex) via `@google/genai`; Cloud Run, Firestore, Firebase Auth, Cloud Tasks, Cloud Scheduler, Secret Manager, Sensitive Data Protection. **No other AI provider, SDK or API key in product code**, not even for tests or fallbacks.
2. **Never store audio in the cloud.** Audio arrives in the segment request, is transcribed in memory and dropped. No Cloud Storage writes; no audio or base64 in logs, errors, traces or Firestore.
   - **2a. On-device queue (capture phase P3).** Only on the paired phone, audio may wait in browser storage (IndexedDB), encrypted with AES-GCM under a non-extractable key, until its upload is confirmed or 24 h pass; then it is deleted (the purge runs when the page next runs). It never goes to any cloud storage. P3 stays OFF on the pilot (`NEXT_PUBLIC_DEVICE_AUDIO_QUEUE=false`) until Rangga's explicit written sign-off for P3. Debrief answers also wait only on that phone until uploaded, at most 14 days.
3. **Redact before storing text.** Sensitive Data Protection runs on transcript lines, and on debrief reasons after the staff-name scrub, before anything is written.
4. **Real data only on paid Google Cloud.** No AI Studio free keys or free quota with real shop data. All model calls use the Google Cloud project's service account.
5. **Regions.** Services and data in `asia-southeast2`. Each model's location comes from `config/regions.yaml`. Never hard-code a location.
6. **Browsers never talk to Firestore.** Every read and write goes through our API, which checks `outlet_id` and `role` on the server.
7. **People data.** Staff names live only in `staff`, used only for the name scrub and transcription vocabulary. Threads, questions, answers, proposals, outcomes and audit logs never store a name or staff id. Questions are role-agnostic. **An answer stores only the answering device id and timestamps: no role, no `answered_by`.** Where an actor must be recorded (proposals, approvals, audit logs) it is a role. Device docs hold no person's name; no supervisor or owner screen or route shows a device id. Supervisors see "a staff member answered", never who.
   - **7a. Thread text retention: 14 days.** Threads keep their own already-redacted work-line text (never raw text, audio or NON_WORK lines) for `retention_days` (default 14) after the last line, then Firestore TTL deletes it. Capture phase P4 applies this in code (`expires_at`, TTL policy, backfill); until P4 ships, threads have no expiry. Any staff-name scrub must cover thread line text, not only summaries.
   - **7b. Consent is collected outside the app** (bee6–shop paper contract plus emailed consent, privacy policy and TnC). No consent gate, flag or revoked state in MVP 1; revocation is manual (technical specification §8, consent). The `/capture` privacy line is a notice, not consent.
8. **The public repo never contains** the shop's real SOP, franchise documents, real transcripts, real staff or customer data, `.env` files, keys or audio. Demo data is fictional.
9. **SOP changes only through proposals** (evidence → supervisor → owner). No endpoint edits the SOP directly.
10. **The evidence gate is plain code, not AI.** A label becomes a fact only if the gate's rules pass; otherwise it becomes a debrief question.
11. **Commit small and often.** The git history proves the code was written during the hackathon.

## 3. Stack
- **App:** Next.js (App Router) + TypeScript strict; one Cloud Run service `web` in `asia-southeast2` (screens, API, pipeline, agents).
- **Async:** Cloud Tasks → `/api/internal/*` (Cloud Tasks OIDC verified). **Cloud Scheduler runs the pipeline tick and the review dates only.** The debrief has no Scheduler job: it starts on the phone at Selesai or the auto-stop.
- **Data:** Firestore (Native, `asia-southeast2`).
- **Auth:** Firebase Auth. Email + password for owner and supervisors (accounts created by an admin provisioning script; no self sign-up — decided 9 Oct, replacing the earlier Google sign-in plan for simpler setup/testing); a custom token per paired device; claims `{ outlet_id, role, device_id? }`. No staff sign-in in MVP 1.
- **AI** (`@google/genai`, Vertex mode): `gemini-3.5-transcribe-preview` for all transcription (`global` only, sync, verbatim, ≤ 100 vocabulary terms; the id without `-preview` 404s); `gemini-3.5-flash-lite` for windows → threads → labels; `gemini-3.5-flash` for the Proposal (v3; the tool-using v4 sits behind `PROPOSAL_AGENT_V4`, off everywhere) and Review agents; no Critic agent (dropped 16 Oct); a Live API model only for R-16 ("if time").
- **Agents:** Google ADK for TypeScript. Check the package and docs before R-08; ask Rangga if blocked > 2 h (fallback: plain state machine calling Gemini).
- **Browser capture:** `getUserMedia` + AudioWorklet (16 kHz) + Silero VAD (ONNX Runtime Web; check any wrapper's licence) + WebCodecs Opus + Screen Wake Lock; P3 adds IndexedDB + WebCrypto AES-GCM.
- **Validation:** zod on every API input and every model output.
- **Tests:** unit tests for the gate, thread builder, windowing, role checks and schemas; one smoke test per milestone with a **fictional** clip.

## 4. How we work
For every task (`docs/plan.md`; steps and "done when" in `docs/backlog.md`):
1. **Read** the task and its spec section. Ask Rangga about anything unclear **before coding**.
2. **Plan** in `docs/tasks/R-xx.md` (files, data changes, tests, risks). Consider extending `/capture`'s dev mode (`docs/tasks/DEV-01-capture-dev-mode.md`) if the stage is hard to observe. Wait for Rangga's "go".
3. **Build** in small conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
4. **Test:** unit tests, lint and typecheck clean; smoke test if the pipeline is touched.
5. **Self-review** (checklist below), then open a PR: what changed, how tested, screenshots for UI, known gaps.
6. **Rangga reviews and merges**; deploy and check the acceptance criteria on the live URL.
7. Update `docs/tasks/R-xx.md` with the result and leftovers.

**Skills:** load the matching skill(s) via the Skill tool before coding (`/ecc-guide` if unsure; mapping in `docs/pm-playbook.md` §10 rule 11). Never use `claude-api` (the product uses Gemini only).

**Self-review checklist (every PR):**
- [ ] No non-Google AI calls; no secrets; no audio persisted or logged
- [ ] Every API route checks role + outlet on the server
- [ ] Model outputs validated with zod; failures handled (retry or become a question)
- [ ] Names never stored outside `staff`; answers carry the device id only
- [ ] Model location read from `config/regions.yaml`
- [ ] Works on a 360 px-wide phone screen
- [ ] Tests added or updated; the PR's acceptance criteria are met
- [ ] Developer-mode support considered (extended, or explicitly skipped)

## 5. Commands
```
npm run dev         # local dev
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm test            # unit tests
npm run smoke       # end-to-end smoke with a fictional clip (R-13)
npm run probe       # region probe → config/regions.yaml
npm run seed        # outlet, users, device pairing code, staff names (PINs dormant)
# deploy: Cloud Build trigger on main → Cloud Run (asia-southeast2)
```

## 6. Environment (names only; values in Secret Manager or .env.local, never committed)
`GOOGLE_CLOUD_PROJECT` · `APP_REGION=asia-southeast2` · `FIREBASE_*` · `CLOUD_TASKS_QUEUE` · `TASKS_INVOKER_SA` · `DEMO_MODE` (demo project only; must stay unset on the pilot) · `DAILY_TOKEN_CEILING` · `PIPELINE_TICK_AUDIENCE` (the tick route's own URL, the expected OIDC audience; never derived from the request) · `NEXT_PUBLIC_DEVICE_AUDIO_QUEUE` (P3; `false` on the pilot) · `REVIEW_RUN_AUDIENCE` (R-11; the daily review-run route's own URL, same OIDC-audience pattern as `PIPELINE_TICK_AUDIENCE`) · `DEMO_IP_SALT` (R-12; demo project only — salts the per-IP daily hash used for demo rate limits, never the raw IP) · `DEMO_SANDBOX_IP_CAP` (R-22; demo project only — per-IP daily sandbox cap, default 30, not killable; dev-ops raises it on judging day) · `PROPOSAL_AGENT_V4` (R-24; exactly `"true"` enables the tool-using Proposal agent; `true` only on `web-develop` until Rangga's go; unset on `web` and the pilot) · `FIRESTORE_DATABASE_ID` (R-24 §3.12; named Firestore database for `web-develop` = `staging`; unset = `(default)`; never set on `web` or the pilot)

## 7. Cost guards
- Log input/output tokens and audio seconds per call, per outlet, per day.
- At `DAILY_TOKEN_CEILING`, stop non-essential model calls for that outlet (capture keeps queuing).
- Demo project: per-IP rate limits and a daily cap on live calls.

## 8. Known gaps (state them honestly in the README)
DPIA under PP 33/2026 is next after submission · Transcribe is in preview · some models may run on `global` · capture needs the page open, screen on, phone plugged in · consent is outside the app, revocation manual within 7 working days · a forgotten Mulai looks like a day off · Firestore TTL deletion lags. Full list: `docs/specs/technical-specification.md` §8.

## 9. README credits line
"Built with Claude Code. Runs entirely on Google Cloud and Gemini."

## 10. PM working rules (Rangga; detail and history in `docs/pm-playbook.md`)
1. The PM always dispatches an agent; it never edits product files, reviews diffs, runs QA, researches, or debugs infra/GCP itself (infra goes to `dev-ops`). It edits only this file, memory, `docs/HANDOFF.md`, `docs/tasks/R-xx.md`, `.claude/agents/*.md`.
2. Check real state every check-in (`git log`, working tree, tasks); stop agents once their result is verified.
3. An open PR gates the next task: tell Rangga and stop.
4. Dispatch one-shot agents unnamed; name one only for a real back-and-forth. Task tools are not a reporting channel.
5. Inspect diffs with `git`; `gh` only for what git can't do.
6. Argue feasibility against `docs/plan.md` first; standard+ scope gets a tech-lead design pass; a behaviour-changing fix gets a quick-win and an ultimate option.
7. Tech-lead review AND independent QA are both mandatory before "ready". QA has zero tolerance: any reproduced defect is DO-NOT-SHIP unless Rangga accepts it explicitly. The PM re-checks QA's evidence.
8. If a developer misreads a task, pair it with tech-lead (both named).
9. Update `docs/HANDOFF.md` every session and merge. **When a decision is made, close the matching open item in `docs/plan.md` §10 in the same change.**
10. No agent runs a git command that mutates the shared tree (`reset`, `checkout -- <path>`, `stash`, `clean`, switching refs); use read-only git or a worktree.
11. Load the matching skill per activity and name it in every brief; verify libraries via context7. New idea: tech-lead writes the deep plan in `docs/tasks/R-xx.md` → PM brainstorms edge cases only → `developer`/`developer-junior` builds it literally. `security-reviewer` on demand only.
12. Before pushing, the PM runs `npm run lint`; issues go back to the developer. Once both gates pass and lint is clean, push and open the PR (merge stays Rangga's).
13. Token economy: opus only for hard reasoning; compact at logical breakpoints (before ~150k context).
14. `developer-junior` (haiku) only for mechanical slices; the gate, threads, windowing, label merging, Gemini/ADK agents and RBAC go to `developer` (sonnet). Same gates for both.
15. **Fable override (Rangga, 14 Oct, R-19):** for R-19 the PM may dispatch `developer`/`uiux` on **Fable** (the Agent tool `model` override; agent files are not edited) for the hard slices (evidence rules/gate, next-day shift, session gates, debrief, judge guide, page-1 ports) and for `qa` on the live journey and audio rehearsal. Sonnet/Haiku stay on mechanical slices; tech-lead (opus), security-reviewer and dev-ops are unchanged. **Widened by Rangga, 14 Oct (later):** because the other models' quota is smaller than Fable's, the PM dispatches Fable (`model: "fable"`) for most heavy tasks, including tech-lead reviews, QA live runs and fix batches that touch logic; Haiku stays on mechanical slices only. **Narrowed by Rangga, 15 Oct (evening):** Fable only for `tech-lead` and `qa` (high reasoning and evaluation of test data); `developer`, `developer-junior`, `uiux` and `dev-ops` run on their default models with no override. Same gates for every model. The PM records wall time and fix rounds per Fable PR and goes back to Sonnet if Fable is not better.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

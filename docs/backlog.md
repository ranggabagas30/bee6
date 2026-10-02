# SOP Improvement Agent — Task Backlog (v3, 30 Sept 2026, 01:30 WIB)

**What this doc is:** the step-by-step detail for every task in the current plan. Dates, hours and sprint goals live in `docs/plan.md`; if the two disagree, the plan wins.
**Task IDs:** `R-xx` = Rangga's build tasks. `T-xxx` = spec sections in `docs/specs/pipeline-and-agents.md` and `docs/specs/web-backend-rbac.md`, where the acceptance criteria live.
**How Rangga works each task with Claude Code:** read the task + spec → plan in `docs/tasks/R-xx.md` → Rangga says go → small commits → tests → PR → Rangga reviews → deploy → check "Done when" on the live URL (see `CLAUDE.md` §4).

---

## 1. Critical path

R-01 → R-02 → R-03 → R-04 → **Go-live step 1 (Mon 5)** → R-05 → R-06 → **step 2 (Tue 6)** → R-07 (**Wed 7**) → R-08 → **first proposal (Fri 9)** → R-09 → R-10 → **SOP v2 (Sat 10)** → R-11 → **review (Wed 14)** → R-14 → **submit (Fri 16)**.
Off the path (can slip without moving a milestone): R-12, R-13, R-15, R-16.

## 2. Sprint 1 — capture + transcription core (Wed 30 Sep – Sun 4 Oct)

### R-01 Foundations · 4 h · Wed 30
- **Steps:** two GCP projects (pilot = real Proofed data, demo = fictional only), paid billing, budget alerts 50/90/100%, APIs on (T-001) · region probe script → `config/regions.yaml` (T-002) · public GitHub repo with licence + `.gitignore` for audio and `/private/` (T-003) · Next.js + TypeScript skeleton · Cloud Build trigger on `main` → Cloud Run `web` in asia-southeast2.
- **Depends on:** nothing.
- **Done when:** a push to `main` deploys a hello page to Cloud Run in Jakarta; `regions.yaml` lists a location for every model (Transcribe, 3.5 Flash-Lite, 3.5 Flash, the Live model); no API keys, service accounts only.
- **Check-in Wed 30, 20:00:** probe results + 5-min capture test; start the 14 h test.

### R-02 Data + login + roles · 5 h · Thu 1 – Fri 2
- **Steps:** Firestore schema v0 with TTL on `segments` (the web spec §6.4) · Firebase Auth Google sign-in · custom claims `{outlet_id, role, staff_id?, device_id?}` · role check on every API route · **seed script** (`npm run seed`): outlet, owner + supervisor emails, staff names + PIN hashes, a 6-digit pairing code for the shop phone · `/pair` page that swaps the code for a device token · staff name + PIN login on the paired phone (T-005, T-006).
- **Depends on:** R-01.
- **Done when:** owner and supervisor can sign in and see only their outlet; a wrong outlet ID is rejected by the server; staff PIN login works only on the paired phone; 5 wrong PINs lock for 15 min.

### R-03 Capture page · 8 h · Fri 2 – Sat 3
- **Steps:** `/capture` with mic permission, input picker, sample-rate check (< 16 kHz refused), screen wake lock, opening hours (T-101) · AudioWorklet 16 kHz + Silero VAD (ONNX Runtime Web), 400 ms pre-roll (T-102) · segment batcher ≤ 15 s (≥ 2 s pause after ≥ 6 s, or 8 s silence) + Opus via WebCodecs + `PUT /api/v1/segments/{device}:{seg}` with retry (T-103) · in-memory queue ~10 min (T-107a) · heartbeat every 60 s + self-restart on mic errors (T-105) · status screen only, no transcript · capture refuses to start if the outlet's consent flag is false.
- **Depends on:** R-02 (device token); segment API contract agreed with R-04.
- **Done when:** the web spec §5 capture checks pass on the shop phone (silent room → 0 bytes; first syllable intact; 3 min of talk → ≥ 12 segments; 10 min offline → every segment arrives once, in order; external mic unplugged → built-in within 3 s).
- **Cut if behind on Sat:** input picker (built-in mic only) and the heartbeat screen.

### R-04 Segment API → Transcribe · 4 h · Sun 4
- **Steps:** idempotent segment route (device token required) · audio inline to **Gemini 3.5 Transcribe** (verbatim, custom vocabulary ≤ 100, `id-ID`/`jv-ID` or auto-detect, whichever tests better on Tiffany's clips) · Sensitive Data Protection redaction · store lines with device times, model and location; TTL 48 h (T-202, T-204, T-303) · log audio seconds + tokens per call.
- **Depends on:** R-01 (probe), R-02, Tiffany's vocabulary list (Sat 3).
- **Done when:** a repeated `PUT` returns `200` with no second model call; no audio or base64 anywhere in Firestore, logs or errors; 5 demo clips come back as readable redacted text.

### R-05a Pipeline plain code · 4 h · Sun 4
- **Steps:** windowing (≥ 90 s silence or 6 min cap; tiny windows batched; empty windows make no call) (T-302) · thread builder over `reply_to` links with grace periods (T-305) · evidence gate rules (T-306) — all with unit tests on made-up data.
- **Depends on:** R-04 data shape.
- **Done when:** unit tests pass for parallel threads, a thread across 3 windows, and every gate rule.
- **If behind:** moves to Mon 5; go-live step 2 slips to Wed 7.

## 3. Sprint 2 — understand the day, close the proposal loop (Mon 5 – Sun 11 Oct)

### R-05b Label call · 3 h · Mon 5
- **Steps:** label prompt + JSON schema generated from `config/categories.yaml` (T-301) · Flash-Lite call with structured output: `reply_to` per line, category enum, fields, confidence, evidence line indices, runner-up + why not, `non_work_lines` (T-304) · private lines deleted after labelling, only counted · Cloud Scheduler every 2 min → `POST /api/internal/pipeline/tick` (OIDC), one device at a time under a lease, oldest-first · Monday's segments reprocessed Tue.
- **Depends on:** R-05a, Tiffany's category examples (Sun 4).
- **Done when:** the hypothetical trap ("kalau nanti … habis") is labelled TRAINING on 5/5 runs; outputs pass zod; failures become questions, not facts.

### R-06 Day record screen · 3 h · Tue 6
- **Steps:** timeline of threads with category, summary, confidence, fact/question status · supervisor sees quoted (redacted) evidence lines; owner sees summaries only · filter by category · Bahasa/English label toggle (T-401a).
- **Depends on:** R-05b.
- **Done when:** a 14-hour day loads in < 2 s on a phone; the owner view contains no quoted lines.

### R-07 Tap debrief · 3 h · Wed 7
- **Steps:** at close (default 21:45), top ≤ 5 questions (uncertain + incident first) on the shop phone after PIN · *Iya* / *Bukan, itu…* + optional typed fix · answer writes a `correction` and updates the thread · stored as `answered_by: staff` (no name) · COMPLAINT, CORRECTION and incident answers wait for supervisor confirmation (T-402).
- **Depends on:** R-02 (PIN), R-05b.
- **Done when:** a staff member answers 5 questions in ≤ 2 min; the supervisor sees "a staff member answered".

### R-08 ProposalAgent · 5 h · Wed 7 – Thu 8
- **Steps:** ADK (TypeScript) agent inside `web` on Gemini 3.5 Flash · picks one intervention from the library · cites ≥ 1 rubric criterion + ≥ 2 dated evidence items (thread IDs) · states metric, failure condition, review date, and that unmet demand is a censored floor · reads all stored constraints · too little evidence → no proposal + a debrief question + logged suppression (T-503, T-504) · a "Generate proposal" button for supervisors.
- **Depends on:** R-06 data, Tiffany's SOP v1 spec + rubric + library (Wed 7).
- **Fallback if ADK blocks > 2 h:** a plain state machine calling Gemini (already agreed).
- **Done when:** a seeded case with 1 evidence item produces no proposal and a logged reason; a real proposal on Fri 9 cites dated evidence.

### R-09 Approval screens · 4 h · Fri 9
- **Steps:** supervisor *Feasible* / *Reject* (reason required) → reason saved as a permanent outlet constraint (T-506, T-507) · owner *Approve* / *Reject* (reason required), shown only after the supervisor says feasible · everything written to `audit_log`.
- **Depends on:** R-08.
- **Done when:** after a rejection like "the oven only holds 2.5 kg", the revised proposal respects it; nothing ships without both approvals.

### R-10 SOP versions + diff · 2 h · Sat 10
- **Steps:** immutable `sop_versions`; v2 = v1 + approved change; diff view (added / changed / removed steps) with metric, failure condition and review date (T-508).
- **Depends on:** R-09.
- **Done when:** SOP v2 exists with review date Wed 14; the pipeline reads v2 from the next morning.
- **Cut if behind:** plain before/after list.

### R-15 CriticAgent · 3 h · Sat 10
- **Steps:** ADK agent that calls the evidence gate as a tool (`check_evidence(proposal)`); only passing proposals reach the supervisor; block reason shown (T-505).
- **Depends on:** R-08, R-05a gate.
- **Done when:** a seeded weak proposal (1 evidence item) is blocked with its reason.

### R-16 Voice debrief · 6 h · Sun 11
- **Steps:** Live API, one shared session per close, agent speaks first in Bahasa, ≤ 5 questions, ≤ 4 min · same question queue as R-07 (answers keyed by `question_id`) · answer text stored, audio not (T-403).
- **Depends on:** R-07, probe result for the Live model.
- **Done when:** a dropped session continues in tap mode with no double-counted answers.
- **If behind:** moves to Sprint 3 buffer.

## 4. Sprint 3 — close the loop, demo outlet, submit (Mon 12 – Fri 16 Oct)

### R-11 ReviewAgent · 4 h · Mon 12
- **Steps:** Cloud Scheduler job Wed 14 09:00 WIB → review route → compare the metric before (Mon 5 – Fri 9) and after (Mon 12 – Tue 13) → propose *worked / revise / revert* → supervisor + owner confirm → `outcomes` (T-509, T-510) · the same route is what the demo's "fast-forward" calls.
- **Depends on:** R-10.
- **Done when:** the job fires without anyone pressing anything; an unconfirmed outcome is stored as "unknown" and kept out of memory.

### R-12 Demo outlet · 4 h · Tue 13
- **Steps:** seed the demo project by sending Tiffany's clips through the real segment API · landing page with "Try as Owner / Supervisor / Staff" (2 h sessions) · per-IP rate limits + daily token cap · "fast-forward to review date" labelled *simulated time* (T-701, T-708).
- **Depends on:** R-11, Tiffany's clips.
- **Done when:** someone outside the team completes the judge path in a fresh browser on phone and laptop in ≤ 4 min.

### R-13 Eval · 2 h · Wed 14
- **Steps:** script reads the gold-set Google Sheet → confusion matrix, per-category precision/recall, macro-F1 · Transcribe quality on 20 human-checked clips (T-804, T-207).
- **Depends on:** Tiffany's 60+ labelled episodes (Tue 13).
- **Done when:** numbers reproduce from a pinned snapshot of the sheet; sample size stated.

### R-14 Release · 3 h · Thu 15
- **Steps:** README (setup, architecture, model/region table from `regions.yaml`, known gaps incl. DPIA next, Transcribe preview, credits line) · tag v1.0 · uptime check for 19 Oct – 6 Nov · incognito test of link, repo, video, deck (T-814 – T-818).
- **Done when:** every submission link opens without login in a private window.

## 5. Tiffany's backlog

| ID | Task | By | Feeds |
|---|---|---|---|
| T-901 | Consent form (Bahasa), counter signage, staff briefing, signatures | Thu 1 | Go-live |
| T-205 | Custom vocabulary (≤ 100 terms) | Sat 3 | R-04 |
| T-702 | 5 Bahasa demo clips (fictional outlet) | Sat 3 | R-03/R-04 tests, R-12 |
| T-301 | `categories.yaml` example pairs | Sun 4 | R-05b |
| — | Weekday problem: ask daily; 2–3 candidates | Wed 7 | R-08 focus |
| T-501 | SOP v1 spec (private, never in the repo) | Wed 7 | R-08 |
| T-502 | Rubric + intervention library | Wed 7 | R-08 |
| — | Supervisors: day record walk-through, debrief at close, honest proposal review | Wed 7 – Sat 10 | Loop |
| T-803 | B-roll (no customer faces, no SOP document on screen) | Sun 11 | Video |
| T-806 | Video script draft | Sun 11 | Video |
| T-802 | Gold set: 60+ episodes labelled in the Google Sheet (10 labelled by both supervisors) | Tue 13 | R-13 |
| T-807 | Screen recordings | Tue 13 – Wed 14 | Video |
| T-812/813 | Video (< 3 min, English captions) and deck (PDF) final | Thu 15 | Submission |
| T-818 | Submit on Hack2skill; save the confirmation | Fri 16 | — |

## 6. "If time" tasks (P1, in order)
| Task | Est | Spec |
|---|---|---|
| Encrypted IndexedDB queue (AES-GCM, 2 h cap) | 4 h | the web spec §5 |
| Cost-per-day tile (token/audio logs → owner home) | 3 h | the web spec §4.4 |
| "Re-run this clip live" in the demo outlet | 2 h | the web spec §4.5 |
| POS CSV import (SalesEvent) | 4 h | the pipeline spec T-601 |
| Team and device settings screens | 4 h | the web spec §4.3 |
| Guided tour in the demo outlet | 2 h | the web spec §4.5 |

## 7. Removed from earlier plans (for the record)
Android app tasks (T-101 – T-110 Android versions) · Flash-Lite first-pass transcription and escalation (T-203) · Flex tier (T-208) · separate `ingest` / `pipeline` / `agents` services · separate playground website · gold-set labelling screen (→ Google Sheet) · 4-person team assumption. History: `docs/adr/ADR-001-lean-gemini-architecture.md`.

## 8. Definition of done (every task)
- [ ] Merged to `main` via PR that Rangga reviewed; lint, type-check and tests green; deployed to Cloud Run in asia-southeast2
- [ ] "Done when" checks pass on the live URL
- [ ] No non-Google AI calls, no secrets, no audio stored or logged, no real Proofed data in the repo
- [ ] Every new API route checks role + outlet on the server
- [ ] `docs/tasks/R-xx.md` updated with the result and anything left for later

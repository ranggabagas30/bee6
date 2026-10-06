# SOP Improvement Agent — MVP Specs (v2, 30 Sept 2026, 01:30 WIB)

**Sources of truth:** `docs/plan.md` for sprints; `docs/specs/technical-specification.md` (§8) for
capture and session rules; `docs/specs/web-backend-rbac.md` (§6.6) for routes and data;
`docs/tasks/UX-03-journey-design.md` for screens and copy.
Precedence: `CLAUDE.md` → `docs/plan.md` → `docs/backlog.md` → this spec.
Reconciled 4 Oct 2026 (tech-lead): A2 goal 2 (off-day cut-off), A4 staff stories, D6, T-004 thread retention,
T-403 wording.

> **Updated 4 Oct 2026, MVP 1 answer shape (tech-lead, docs only; Rangga, 4 Oct, final; `docs/HANDOFF.md`
> "Debrief answer shape for MVP 1"). Supersedes the free-text-only answer in the note below.** Each debrief
> question gets exactly one answer: ***Ya* (YES) or *Tidak* (NO) plus a required reason, or *Lewati*
> (skip)**. YES reaches T-306's gate as `staff_answer = { question_id, chosen_category: <thread's model
> category> }` (`staff_confirmed`); NO as `chosen_category: null` (the existing `staff_rejected` branch: the
> thread is not confirmed and is excluded from evidence, the question is closed as rejected). The reason is
> required, refused when empty or over 500 characters (never truncated), name-scrubbed and SDP-redacted,
> stored and shown only; the gate never reads it. Category-revising free text is post-MVP 1. Changed: T-306
> (one AC line), T-402, T-403 (one line).

> **Updated 4 Oct 2026, final (tech-lead, docs only): debrief answer shape (Rangga, 4 Oct, final;
> `docs/HANDOFF.md` "Debrief answer shape").** A debrief answer is **one free-text WHY explanation**, not
> *Ya* / *Tidak* / *Bukan ini* and not a choice list (reason chips withdrawn). Empty or whitespace-only is
> not an answer; the cap is 500 characters, refused, never truncated; the staff-name scrub and Sensitive
> Data Protection run on it before storage. An accepted explanation on a question with a thread feeds
> T-306's gate as the unchanged `staff_confirmed` input (the thread's model category); the gate never reads
> the text. Supervisors do not answer device questions; a fully answered debrief does not release Mulai
> early. Changed: T-306 (one AC line), T-402, T-403 (one line).

> **Updated 4 Oct 2026, late (tech-lead, docs only): role-agnostic questions and multi-device (Rangga, 4
> Oct, final; `docs/HANDOFF.md`).** A debrief question never depends on who answers: every question asks
> whether the SOP step was done properly and, if not, why. Answers store the answering device id and
> timestamps only, no `answered_by` role. Each device's open questions expire at that device's own debrief
> end; the insight run merges all devices (technical spec §8.15). Changed: T-306 (expiry scope), T-402.

> **Updated 4 Oct 2026 (tech-lead, docs only): sign-in and consent (Rangga, 4 Oct, final; `docs/HANDOFF.md`).**
> Owner and supervisor keep Google sign-in; staff need no sign-in. **Consent is not collected in the app:**
> it is covered by the paper contract between bee6 and Proofed, and bee6 emails the consent, the updated
> privacy policy and the TnC to all users. The in-app consent gate (consent flag, "no consent" view,
> staff-consent step) is **removed from MVP 1**; T-901's "capture refuses to start for an outlet whose
> consent flag is false" is struck. Revocation stays manual (within 7 working days) with no in-app
> revoked-consent state. The phone's privacy line stays as an in-app notice, not consent collection.
> Changed: §A3 (non-goals), E9 T-901.

> **Updated 4 Oct 2026 (tech-lead, docs only): MVP 1 device model (Rangga, 4 Oct, final).** No staff
> sign-in in MVP 1 (no name, no PIN): staff only pair a device, the system tracks the device id only, and
> every session rule runs per device. Mode (one active paired device = "room", more = "wearable") is a
> derived label only. The debrief shows each device the questions it heard; answers are stored as "a
> staff member" plus the device id. Staff PIN sign-in is post-MVP 1. Changed: A3 (wearable), A4 (staff
> story, judge), T-005/T-006, T-402. Rule detail: `docs/specs/web-backend-rbac.md` §2a.

> **Updated 4 Oct 2026 (tech-lead, docs only; Rangga's decision D3):** every open question expires as
> "unverified" at the end of the debrief, whether or not it was picked for that debrief; the earlier
> 7-day question expiry (T-306) is superseded. Detail: `docs/specs/technical-specification.md`
> §8.10.

> **Updated 3 Oct 2026 (aligned with `docs/plan.md` v5):** dates re-dated to the Mon 12 Oct pilot go-live (one-step go-live after internal testing Tue 6 – Sun 11 and Rangga's written sign-off Sun 11 18:00; real evidence Mon 12 – Wed 14; first real insight run Thu 15, Fri 16 fallback; submit Fri 16; pilot review Wed 21 Oct, after submission, so the closed loop is shown on the demo outlet only). Capture is staff-tapped Mulai/Selesai with a hard auto-stop 60 min after closing, not unattended; the tap debrief opens after Selesai / auto-stop; R-16 is "if time".

**What this doc is:** Part A is the MVP-level PRD. Part B specs each epic with acceptance criteria.
**How it fits:** web app, capture, backend, login and roles are specced in `docs/specs/web-backend-rbac.md`; this doc covers the rest (pipeline, debrief, agents, approvals, demo outlet, evidence, consent). Dates and hours: `docs/plan.md`. Steps per task: `docs/backlog.md`. Product behaviour source: `docs/product-spec.md`. Engineering-level detail for the pipeline as built (exact algorithms, edge cases, leak boundaries, file:line citations): `docs/specs/technical-specification.md`.
**v2 changes (30 Sept):** web app instead of Android · Gemini 3.5 Transcribe for all speech (no Flash-Lite first pass, no escalation) · one Cloud Run service · demo outlet inside the same app (no separate playground site) · weekday demo story · new dates (go-live Mon 5, SOP v2 Sat 10, review Wed 14; superseded by plan v5: go-live Mon 12, SOP v2 Thu 15, pilot review Wed 21 Oct) · task IDs mapped to R-xx. Items marked **(P1)** are built only if time allows. Decision history: `docs/adr/ADR-001-lean-gemini-architecture.md`.

---

# Part A — MVP PRD

## A1. Problem statement
Small F&B outlets like Proofed repeat the same operational mistakes (stockouts, missed steps, inconsistent complaint handling) because nobody records *why* they happen, and SOPs never change on evidence. Current tools check whether today's SOP was followed. None of them changes the SOP and checks whether the change worked. Without that loop, the outlet keeps discussing the same mistakes in weekly meetings with no structured record of causes.

## A2. Goals (by Fri 16 Oct)
1. **One real proposal loop at Proofed on real dates:** weekday evidence (Mon 12 – Wed 14) → first real insight run and proposal (Thu 15; fallback run Fri 16) → supervisor review (a real rejection with reason if it happens) → owner approval → **SOP v2 (Thu 15)** with a set review date → pilot review on **Wed 21 Oct, after submission** → outcome in memory. Before submission the review verdict and outcome memory are shown on the demo outlet only (fast-forward, labelled simulated).
2. **Capture with manual sessions:** ≥ 90% of planned opening hours covered on days with a session (session time minus capture gaps) from Mon 12; staff press Mulai and Selesai only. The only automatic stop is the hard auto-stop 60 min after closing; a day with no Mulai by the end of its Mulai window (close − 4 h, technical spec §8.3) is recorded as off / closed, with no gap alarm. Measured by capture phase plan P5's coverage function.
3. **Measured label quality:** per-category precision/recall on a gold set of ≥ 60 real episodes, shown as a confusion matrix.
4. **A judge can operate it:** the demo outlet's judge path works in a fresh browser in ≤ 4 minutes, on phone and laptop.
5. **A defensible cost number:** measured cost per outlet-day from the per-call token and audio logs, plus Transcribe quality on 20 real clips.

## A3. Non-goals (this window)
- **Full DPIA:** after submission (GATI, 29 Sept). The README states it as the next priority. *Consent and signage are not deferred.* *(4 Oct: consent by the bee6–Proofed paper contract plus an emailed notice to all users, not collected in the app.)*
- **Native Android app:** replaced by the web capture page.
- **Streaming transcription / live captions:** not a product need, and 2–3× the product price at production volume. The only real-time part is the voice debrief.
- **Cheaper transcription path** (Flash-Lite first pass): a slide labelled "modelled", not built.
- **A separate demo architecture:** the demo outlet uses the same app and endpoints; only input (recorded clips), data (fictional) and clock (fast-forward, labelled simulated) differ.
- **Wearable hardware features, second mic, photo and reminder lanes, event cards, POS API adapters.** (4 Oct device model: pairing more than one phone works with the same session rules and is labelled "wearable mode", but nothing wearable-specific is built: no per-person routing, no cross-device de-duplication.)

## A4. Personas and user stories
**Staff (front desk and kitchen)**
- As a staff member, I want to tap Mulai once when work starts and Selesai once when it ends (the phone stops on its own an hour after closing if I forget), so capture needs no other action from me. (technical spec §8.3; a forgotten Mulai means the day counts as off.)
- As a staff member after Selesai (or the auto-stop), I want at most five short questions about the episodes my paired device heard, asked about the step and not about me, with no sign-in, so answering honestly carries no penalty. (MVP 1 device model; per-person "my own episodes" needs staff sign-in, post-MVP 1.)

**Supervisor (two at the pilot shop)**
- As a supervisor, I want to see the day as a timeline of labelled threads with evidence lines, so I can check what happened without listening to audio.
- As a supervisor, I want to reject a proposal with a reason and have that reason respected in every future proposal ("the oven only holds 2.5 kg").
- As a supervisor, I want to confirm or override labels on complaints and corrections, so staff answers about their own mistakes don't become facts unchecked.

**Owner**
- As the owner, I want to approve only changes that affect cost or brand, with the evidence summary and the review date in view, so I decide in a minute.
- As the owner, I want to see on the review date whether the change worked, so the SOP only keeps what's proven.

**Judge**
- As a judge who doesn't speak Bahasa, I want an English panel showing the category, evidence and the runner-up category with the reason it lost.
- As a judge, I want to try the app as each role (Owner, Supervisor, Staff) from one link, without creating an account. (MVP 1: "Staff" is a demo paired-device session, since staff do not sign in.)
- As a judge, I want to fast-forward to the review date and see the outcome, clearly marked as simulated time.

**Edge cases:** the shop phone reboots overnight · Wi-Fi drops for 10 min during the rush · an external mic dies mid-shift · a hypothetical ("kalau nanti … habis…") must not become an incident · a proposal with only one evidence item must be refused · a staff member talks non-stop for 3 minutes (segment cap).

## A5. Architecture (current, summarised)
- **D0 One architecture:** demo outlet and pilot use the same app, endpoints, models, prompts. Only input, data and clock differ.
- **D1 Segments, not streaming:** browser VAD → ≤ 15 s speech segments → Opus → idempotent upload → **Gemini 3.5 Transcribe** in the request → redaction → store. Audio is never stored in the cloud.
- **D2 No escalation:** every segment goes to Transcribe (GATI, 29 Sept). Confidence comes from the label call plus debrief answers.
- **D3 Regions:** services + Firestore in Jakarta; each model's location from the probe (Jakarta → Singapore → global), logged per call.
- **D4 Capture inputs:** built-in mic (default), USB or Bluetooth via the browser's input picker; sources below 16 kHz refused.
- **D5 One-step go-live (v5):** capture, transcription, labels, day record and tap debrief all go live together on Mon 12, after internal testing (Tue 6 – Sun 11, test outlet in the pilot project) and Rangga's written sign-off (Sun 11, 18:00).
- **D6 One Cloud Run service** (`web`); async steps via Cloud Tasks; Live API only for the voice debrief (R-16, "if time"), which like the tap debrief starts at Selesai or the auto-stop (technical spec §8.3).
- **Cost:** ~$24 / $30 / $37 per outlet-month at 15 / 20 / 25% speech. Full detail: the web spec §7.

## A6. Success metrics
| Metric | Type | Target (success / stretch) | Measured by |
|---|---|---|---|
| Coverage of planned opening hours on days with a session | Leading | ≥ 90% / ≥ 97% | capture phase plan P5 coverage (sessions minus capture gaps) |
| Speech share of the day | Leading | Measured and reported (expected 15–25%) | Heartbeat stats |
| Transcript latency (segment end → text stored) | Leading | p95 ≤ 20 s / ≤ 10 s | Timestamps in `segments` |
| Debrief questions answered per debrief | Leading | ≥ 60% / ≥ 80% | `questions` |
| Label precision/recall on the gold set | Lagging | Macro-F1 per category; ≥ 0.75 on the 4 most frequent | R-13 |
| Proposals suppressed by the gate | Leading | Logged; ≥ 1 shown in the video | `proposals.status=suppressed` |
| Loop closure | Lagging | Outcome recorded on the demo outlet before submission; pilot outcome after the Wed 21 Oct review | `outcomes` |
| Cost per outlet-day | Lagging | Measured from call logs | Token + audio-second logs |

## A7. Open questions
| # | Question | Owner | Needed by |
|---|---|---|---|
| Q1 | Which models answer in Jakarta / Singapore / only global? | Rangga (R-01 probe) | Wed 30 |
| Q2 | Does the shop phone keep capturing 14 h with the page open and the screen on? | Rangga | Internal testing (Tue 6 – Sun 11) |
| Q3 | Is Transcribe good enough on Bahasa + Javanese in rush noise? `id-ID`/`jv-ID` or auto-detect? | Rangga (R-04, R-13) | Sun 4 (first look) |
| Q4 | Does the Live API speak and understand Indonesian well enough? | Rangga (R-16) | If time (R-16 is "if time"; tap fallback exists) |
| Q5 | Does Sensitive Data Protection catch Indonesian phone numbers (+62 / 08…)? If not, add a custom regex | Rangga (R-04) | Sun 4 |
| Q6 | Which weekday problem is the demo story? | Tiffany with Proofed | Wed 14 (evening) |
| Q7 | Does GATI qualify for the $300 Google Cloud credit? | GATI | Before billing grows |
| Q8 | Launch price: stay at Rp300k or test Rp450–500k with 3–30-outlet operators? | GATI | Deck (Fri 16, midday) |

## A8. Timeline
Pilot deploy (test outlet) Mon 5 · internal testing Tue 6 – Sun 11 · **Rangga's written sign-off Sun 11, 18:00** · **pilot go-live Mon 12** (first tap debrief after Selesai / auto-stop) · real evidence Mon 12 – Wed 14 · **first real insight run + SOP v2 Thu 15** (fallback run Fri 16) · freeze Fri 16 midday · **submit Fri 16** · platform deadline Sun 18 · pilot review **Wed 21 Oct** (after submission).

---

# Part B — Epic and task specs

Format: **What** · **Acceptance criteria (AC)** · **Notes**. Each task shows the R-task that builds it.

## E0 — Foundations (R-01, R-02)

**T-001 GCP projects**
- What: `bee6-pilot` (real Proofed data) and `bee6-playground` (demo outlet, fictional data only). Paid billing. Default region asia-southeast2.
- AC:
  - [ ] Both projects have billing linked; Agent Platform, Cloud Run, Firestore, Cloud Build, Secret Manager, Sensitive Data Protection, Cloud Scheduler and Cloud Tasks APIs enabled.
  - [ ] Budget alerts at 50/90/100% on each project.
  - [ ] The demo project has an API quota cap on model requests per minute.
  - [ ] No API keys for real data: service accounts only.

**T-002 Region probe**
- What: a script calls each model with a 1-line prompt (a 2 s clip for audio models) at asia-southeast2, then asia-southeast1, then global; writes `config/regions.yaml`.
- Models: `gemini-3.5-transcribe`, `gemini-3.5-flash-lite`, `gemini-3.5-flash`, the Live debrief model(s).
- AC:
  - [ ] `regions.yaml` lists, per model, the first location that answered and its latency.
  - [ ] Failures are recorded with their error code, not skipped; running twice gives the same result.
  - [ ] The app reads model locations only from `regions.yaml`.

**T-003 Repo and CI/CD**
- What: public GitHub repo created now (commit history proves fresh code). One Next.js app: `app/` (screens + API routes), `lib/pipeline/`, `lib/agents/`, `config/`, `scripts/` (probe, seed, eval), `docs/`. Cloud Build trigger on `main` → Cloud Run `web` (asia-southeast2).
- AC:
  - [ ] A push to `main` deploys in < 10 min.
  - [ ] Secrets only in Secret Manager; `.gitignore` blocks audio files, `.env*` and `/private/`.
  - [ ] Licence file and third-party notes (Silero VAD MIT, ADK Apache-2.0, ONNX Runtime MIT).
  - [ ] **The SOP v1 spec and franchise documents never enter this repo.**

**T-004 Firestore schema v0:** as the web spec §6.4.
- AC:
  - [ ] TTL on `segments.expire_at` deletes redacted segments after 48 h.
  - [ ] `threads` hold category, fields, summary, evidence line refs, confidence and runner-up, plus their own already-redacted work-line text (never raw or unredacted text, never audio, never NON_WORK lines). This is a deliberate retention category: it outlives the 48 h segment TTL so that R-08 proposals and the pilot review (Wed 21 Oct) can still cite days-old evidence. Source: `docs/tasks/R-05a.md` Decision 3. *(4 Oct, capture phase plan P4: bounded to `retention_days`, default 14, via `expires_at` + a Firestore TTL policy, technical spec §8.15; CLAUDE.md §2 #7a changes in the same PR as P4.)*
  - [ ] Names appear only in `staff`.

**T-005/T-006 Login, roles, seed script, pairing, staff PIN:** as the web spec §2–§3. MVP 1: the staff PIN is built (R-02) but dormant and its route is off; staff only pair a device (web spec §2a).

## E1 — Web capture (R-03)
Specced in the web spec §4.1 and §5 (capture page, VAD, segments, Opus, upload, in-memory queue, heartbeat, acceptance checks).
**T-110 Keep the pilot running (from Mon 12):** a daily 09:00 look at session coverage, speech share and yesterday's debrief completion; fix or raise it the same day. AC: coverage ≥ 90% of planned hours on weekdays with a session, Mon 12 – Fri 16 (days recorded as off / closed are skipped, not counted as gaps).

## E2 — Segment transcription (R-04)
Specced in the web spec §6.2–§6.3. Additional AC:

**T-204 Segment store**
- [ ] Each segment is written as `segments/{outlet}/{seg_id}` with `t_start_device`, `t_end_device`, `lines_redacted`, `model`, `location`, `expire_at = now + 48 h`.
- [ ] **No audio bytes anywhere in the cloud** (code review check: no Cloud Storage client; no audio or base64 in logs).
- [ ] Input tokens, output tokens and audio seconds are logged per call (for the cost number).

**T-205 Custom vocabulary v1:** ≤ 100 terms (products, staff first names, suppliers, sister branches) in `config/vocabulary.yaml` (private values; the public repo holds a fictional example).

**T-206 Incident keywords:** `incident_keywords` in `config/categories.yaml` (e.g. *kebakaran, api, maling, copet, jatuh, luka, gas bocor*). A match makes the window process at once instead of waiting (part of R-05). **Next:** a push alert to supervisors. Hypotheticals are still labelled by the model; the keyword only speeds things up.

**T-207 Transcription quality report (R-13)**
- [ ] 20 real clips from the gold set are transcribed by a human (redacted).
- [ ] Report: Transcribe word error rate, $/speech-minute, latency p50/p95.
- [ ] The numbers go into the deck unchanged, with the sample size stated.

## E3 — Understanding pipeline (R-05a, R-05b)

**Goal:** turn segments into labelled threads, drop private talk, and let only well-evidenced labels become facts. **Non-goal:** auto-accept (no category graduates before the gold set exists).

**T-301 `categories.yaml` v1:** 11 categories + NON_WORK as `docs/product-spec.md` §5, decision order, parents, fields, **one contrastive pair per category** (real vs hypothetical/retold; Tiffany). AC: the file validates against a schema; the label prompt and JSON schema are generated from it.

**T-302 Windowing:** a window closes on ≥ 90 s of silence or at 6 min (cut at the nearest pause); windows < 10 s are batched every 3 min; windows with no text make no call. AC: replaying a recorded day produces the same windows every time.

**T-303 Redaction:** Sensitive Data Protection removes phone numbers, emails, customer names and addresses from each segment's lines *before* storage (e.g. `[PHONE]`). AC: ≥ 95% on 20 Indonesian test lines; custom regex for +62/08 numbers if needed.

**T-304 Thread + label call**
- Input: window lines (indexed) + open-thread notes from the previous window + the active SOP slice.
- Output (structured output, enum-constrained):
```json
{"lines":[{"i":3,"reply_to":1,"thread":"T1"}],
 "threads":[{"id":"T1","category":"CUSTOMER_SERVICE","confidence":0.82,
   "evidence":[3,5],"runner_up":{"category":"COMPLAINT","why_not":"no dissatisfaction expressed"},
   "fields":{"unmet_request":{"item":"egg tart","reason":"sold_out"},"sale":false},
   "summary":"Customer asked for egg tart at 15:40; sold out"}],
 "non_work_lines":[7,8]}
```
- AC:
  - [ ] Evidence is returned as line indices, not re-quoted text.
  - [ ] The hypothetical trap labels TRAINING, never an incident, on 5/5 runs.
  - [ ] Model and location come from `regions.yaml` (Gemini 3.5 Flash-Lite).
  - [ ] Prompt work uses **synthetic** clips only (AI Studio is fine for that); real data runs only through Google Cloud.

**T-305 Thread builder:** connected components over `reply_to` links (plain code), grace periods (Training 10 min, Customer service 2 min, Complaint 5 min) so threads span windows; NON_WORK lines are deleted and only counted. AC: unit tests for parallel threads and a thread across 3 windows.

**T-306 Evidence gate (plain code)**
- Rule: a label becomes a **fact** only if confidence ≥ the category threshold (0.9 until calibrated) **and** it has ≥ 1 evidence line **and** it isn't COMPLAINT, CORRECTION, SAFETY, SECURITY or DISRUPTION (those always need supervisor confirmation). Everything else → `questions`.
- AC:
  - [ ] Every gate decision is logged with the rule that fired.
  - [ ] Open questions expire as "unverified" at the end of the debrief of the device that heard them
    (every open question of that device created before its debrief ended, picked for it or not; per
    device, Rangga 4 Oct multi-device; Rangga D3, 4 Oct, supersedes the earlier 7-day
    expiry; technical spec §8.10) and never become facts.
  - [ ] SECURITY_INCIDENT text never contains a person's name.
  - [ ] *(4 Oct, MVP 1 final)* A debrief answer reaches the gate only as `staff_answer = { question_id,
    chosen_category }`: a YES passes the thread's model category (`staff_confirmed`), a NO passes `null`
    (`staff_rejected`, checked first: verdict `question`, thread `excluded_from_evidence: true`, no new
    question created) (R-07 notes §4b.1); the gate never receives or reads the reason text.

## E4 — Day record and debrief (R-06, R-07, R-16)

**T-401a Day record (R-06):** see the web spec §4.3–§4.4. AC: a 14-hour day loads in < 2 s on a phone; filter by category; Bahasa/English labels; owner view has summaries only.

**T-402 Tap debrief (R-07)**
- [ ] After Selesai (or the hard auto-stop) on a paired device, the top 5 of **that device's** open questions (uncertain + incident first) are shown on it, with no sign-in (MVP 1 device model; staff PIN login is post-MVP 1).
- [ ] Questions are about the step, never the person, and never depend on who answers (role-agnostic, Rangga 4 Oct): each asks whether the SOP step was done properly and, if not, why. *(4 Oct, MVP 1; wording is a tech-lead default flagged for Rangga)* Two parts: the *Ya* / *Tidak* headline asks whether the labelled step happened ("Sekitar pukul 15:00 ada restock. Benar?"), and the SOP question is the reason prompt after *Ya* ("Sudah sesuai SOP? Kalau belum, kenapa?"), so a *Tidak* never means "not done properly".
- [ ] Answers (Rangga, 4 Oct, MVP 1 final): **exactly one per question: *Ya* (YES) or *Tidak* (NO) plus a required reason typed in the staff member's own words, or *Lewati* (skip, sends nothing; the question stays open)**. No *Bukan ini*, no reason chips, no category choice; free text that revises the category is post-MVP 1. A body without `answer: "yes" | "no"` is refused (400 `invalid_body`); an empty or whitespace-only reason is not an answer (400 `reason_empty`, on YES and NO); a reason over 500 characters is refused, never truncated (400 `reason_too_long`; the phone's field cannot exceed it); the staff-name scrub and then Sensitive Data Protection run on the reason before any write or log (503 and nothing stored if redaction fails). A refused answer leaves the question open, and it expires as unverified at the debrief end. Each accepted answer writes a `correction` with `answer` and the redacted `reason_text`, sets the question `status: "answered"` + `answer`, and updates the thread via the gate: YES passes `chosen_category` = the thread's model category (`staff_confirmed`); NO passes `null` (`staff_rejected`: thread not confirmed, `excluded_from_evidence: true`, question closed as rejected, no new question). The reason is never read to decide a category, a verdict or a gate input. The few-shot reuse takes the thread's lines with its confirmed category, never the reason as a label, and never a NO-rejected thread. It stores the answering device id and timestamps only, no role and no name (4 Oct, late: `answered_by` dropped); supervisors see "a staff member answered Yes / No" with the reason and never the device id; owners see summaries only.
- [ ] Supervisors do not answer device questions (Rangga, 4 Oct, final): the answer route is device-only (403 otherwise); supervisors confirm or override labels on the thread side.
- [ ] A fully answered debrief does not release Mulai early: the 1-hour timeout always applies (Rangga, 4 Oct, final).
- [ ] Answers on COMPLAINT, CORRECTION and incident threads wait for supervisor confirmation.

**T-403 Voice debrief (R-16)**
- [ ] **One shared Live API session per debrief** (on the device, inside its 1-hour debrief window, technical spec §8.10–§8.11); the agent speaks first in Bahasa; ≤ 5 questions; system context ≤ 1.5k tokens; hard stop at 4 min.
- [ ] If the session drops, the same questions continue in tap mode (answers keyed by `question_id`, never counted twice).
- [ ] The answer text is stored; the audio is not. *(4 Oct, MVP 1 final: the spoken answer becomes the same *Ya* / *Tidak* + reason with the same rules as T-402: empty reason is not an answer, 500-character cap, name scrub and Sensitive Data Protection before storage. Mapping speech to YES / NO is left to R-16's own plan.)*

## E5 — Improvement loop (R-08, R-09, R-10, R-11, R-15)

**Goal:** evidence → proposal → supervisor → owner → SOP v2 → review on date → outcome memory, with a plain-code guardrail. **Non-goals:** interventions invented outside the library; auto-approval.

**T-501 SOP v1 spec (private, Tiffany):** checkable steps (id, trigger/time, owner role, evidence type, failure path) for Proofed's current practice. Kept private, never in the public repo.

**T-502 Rubric v1 + intervention library v1 (Tiffany):** rubric criteria (observable, time-bound, single owner, evidence-defined, failure path, unambiguous) and interventions (change quantity/time, change trigger, add failure path, capture unmet request, shift schedule, add script) as YAML.

**T-503 Agents inside `web`:** ADK (TypeScript) agents run in the one Cloud Run service; Cloud Scheduler calls their internal routes with an OIDC token. Fallback if ADK blocks > 2 h: a plain state machine calling Gemini.

**T-504 ProposalAgent (R-08)** · Gemini 3.5 Flash
- [ ] Every proposal names one library intervention, cites ≥ 1 rubric criterion and ≥ 2 dated evidence items (thread IDs), states the metric, failure condition and review date, and says unmet demand is a censored floor.
- [ ] All stored constraints are in context; a proposal that breaks one is blocked.
- [ ] Too little evidence → no proposal; a debrief question is created; the suppression is logged with its reason.
- [ ] Runs by a supervisor's "Generate proposal" button (a daily schedule is optional).

**T-505 CriticAgent (R-15):** checks each proposal with the gate as a tool (`check_evidence(proposal)`); only passing proposals reach the supervisor. AC: a seeded weak proposal (1 evidence item) is blocked with its reason. (v5: the Critic is built Sat 10, so the first real proposal on Thu 15 goes through it.)

**T-506 Approval screens (R-09)**
- Supervisor: *Feasible* / *Reject* (reason required). Owner: *Approve* / *Reject* (reason required), shown only after the supervisor says feasible.
- [ ] Evidence, rubric criterion, metric and review date fit on one phone screen (owner sees dated summaries, not quoted lines).
- [ ] Default is no change: nothing ships without both approvals.

**T-507 Constraints (R-09):** every rejection reason is stored as a permanent outlet constraint and fed into later proposals. AC: after "oven only holds 2.5 kg", the revised proposal stays within it.

**T-508 Versioning (R-10):** immutable `sop_versions`; v2 = v1 + an approved change; diff view (added / changed / removed steps) with metric, failure condition and review date. AC: the pipeline reads the active version from the next morning.

**T-509 ReviewAgent + scheduler (R-11):** a Cloud Scheduler job on the review date (pilot: **Wed 21 Oct, 09:00 WIB**, after submission) calls the review route → compares the metric before (weekdays Mon 12 – Wed 14, under v1) and after (weekdays from SOP v2's ship date to the review date), stated plainly as a short window → proposes *worked / revise / revert* → supervisor + owner confirm → `outcomes`. AC: fires without anyone remembering; an unconfirmed outcome is stored as "unknown" and kept out of memory.

**T-510 Review screen (R-11):** before/after numbers, verdict buttons, reason field.

## E6 — Context data (P1)
**T-601 SalesEvent CSV import (P1):** canonical schema (`schema_version, outlet_id, source, adapter_version, receipt_id, line_no, occurred_at, item_sku, item_name, qty, status, ingested_at`); idempotency key `source+receipt_id+line_no`. AC: importing the same file twice creates no duplicates; "last sale time per item per day" is added to context.
**T-602 ESB export (P1):** receipts from Proofed for the pilot weekdays, or a typed daily CSV.

## E7 — Demo outlet for judges (R-12)
**Goal:** a judge operates the loop on a fictional outlet in English in ≤ 4 minutes, in the same app. **Non-goals:** real Proofed data; judge accounts.

**T-701 Demo outlet:** runs in the demo project (`bee6-playground`) with the same code; English by default; phone and laptop.
**T-702 Scenario clips (Tiffany):** 5 short Bahasa clips of a fictional outlet (lead scenario matching the weekday problem, plus complaint handling and a hypothetical trap) + English panel text.
**T-703 Seed through the real path:** the clips are sent through the real `/api/v1/segments` endpoint in the demo project, and the real pipeline and agents produce the day record and proposal. No hand-written outputs.
**T-705 Judge path**
- [ ] Landing page → **Try as Staff** (answer a debrief question) → **Try as Supervisor** (day record with runner-up panel, review a proposal, reject with a reason → constraint) → **Try as Owner** (approve → v1→v2 diff) → **Fast-forward to review date** (calls the same review route the scheduler calls; screen says *simulated time*) → outcome.
- [ ] Someone outside the team completes it unaided in ≤ 4 min.
- [ ] (P1) "Re-run this clip live" and a guided tour.
**T-708 Demo guards:** 2 h role sessions; per-IP rate limits; daily token cap; project quota cap; refusal for inputs that try to change instructions.

## E8 — Evidence and submission (R-13, R-14 + Tiffany)
**T-802 Gold set:** Tiffany and the supervisors label episodes (redacted lines) in a Google Sheet: correct category + fields. AC: ≥ 60 episodes by Wed 14, from Mon 12 – Tue 13 real data (target 100); 10 episodes labelled by both supervisors to check agreement.
**T-803 B-roll (Tiffany):** the shop and team at work; no customer faces, no SOP document or franchise material on screen; written OK from staff.
**T-804 Eval (R-13):** script → confusion matrix, per-category precision/recall, macro-F1; rush-hour subset shown separately. AC: reproducible from a pinned snapshot of the sheet.
**T-805 Cost per outlet-day:** computed from the per-call logs for the deck (the owner's cost tile is P1).
**T-806 – T-813 Video, deck, recordings, diagram (Tiffany):** the architecture diagram shows the named agents (Capture, Transcriber, Labeller, Evidence Gate [code], DebriefAgent, ProposalAgent, CriticAgent, ReviewAgent) and which Gemini model and region each uses.
**T-814 README (R-14):** setup, architecture, model/region table from `regions.yaml`, known gaps (**DPIA next**, Transcribe preview, any global-endpoint calls, browser capture needs the page open), licences, credits line.
**T-815 – T-818 (R-14 + Tiffany):** tag v1.0, freeze, quota caps, incognito checklist, uptime alert for 19 Oct – 6 Nov, submit.

## E9 — Consent and privacy (Tiffany)
**T-901 Consent (not deferred; revised 4 Oct, Rangga final):** consent is covered by the **paper contract between bee6 and Proofed**, and bee6 **emails the consent, the updated privacy policy and the TnC to all users** (owner, supervisors, staff) before any real audio. The emailed text keeps the original content: ambient transcription, what is kept (work notes) and what isn't (audio), how long, and how to object or withdraw (by email or under the contract). Counter signage for customers and the staff briefing stay. **No in-app consent step:** there is no consent flag, no "no consent" view and no revoked-consent state in MVP 1. The `/capture` privacy line is an in-app notice, not consent collection. Revocation: handled manually, acknowledgement and complete removal within 7 working days (technical spec §8.16). AC: the signed contract and a record of the sent emails kept offline by GATI (never in the repo); ~~capture refuses to start for an outlet whose consent flag is false~~ *(removed from MVP 1, 4 Oct; may return post-MVP 1 if in-app consent is added)*. *Original (30 Sept): Bahasa staff consent form, counter signage, staff briefing, signatures before any real audio (Thu 1).*
**T-902 Data-flow one-pager (P2):** what's kept, where it runs (from `regions.yaml`), retention, "next: DPIA under PP 33/2026".
**After submission:** full DPIA, per-site privacy profiles, per-model residency table.

---

## Sources (checked 29 Sept 2026)
- Gemini 3.5 Transcribe (custom vocabulary limits, modes, not combinable with diarization or timestamps): https://ai.google.dev/gemini-api/docs/transcribe
- Transcribe Live limits that ruled streaming out (10-min sessions, no diarization): https://ai.google.dev/gemini-api/docs/live-api/live-transcribe
- Audio understanding (inline ≤ 20 MB, Opus supported): https://ai.google.dev/gemini-api/docs/audio
- Agent Platform pricing (Transcribe ~$0.0051/min sync; Live API context billing): https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing
- Google Cloud regions (Jakarta, Singapore; no Malaysia listed): https://cloud.google.com/about/locations

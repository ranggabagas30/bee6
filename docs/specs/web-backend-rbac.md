# SOP Improvement Agent — Web App, Backend and Roles Spec (v1.1, 30 Sept 2026, 01:30 WIB)

**What this doc is:** the build spec for the web app (replacing the Android app), the backend, login, and who-can-do-what (roles).
**How it fits:** `docs/plan.md` says when each part is built; `docs/backlog.md` has the steps per task (R-xx); `docs/specs/pipeline-and-agents.md` covers the pipeline, debrief, agents and demo.
**v1.1 changes (30 Sept):** one Cloud Run service (not three) · in-memory upload queue for the MVP (encrypted queue is P1) · users, staff and the shop phone set up by a seed script (settings screens are P1) · gold set in a Google Sheet (no labelling screen) · region order Jakarta → Singapore → global · pilot cost corrected · task table now uses R-IDs. Items marked **(P1)** are built only if time allows.

## 0. Decisions from GATI (29 Sept, evening)

| # | Decision |
|---|---|
| W1 | **Web app instead of Android.** One responsive web app for everyone: the shop's capture device, staff, supervisors, owner and judges. |
| W2 | **Transcription = Gemini 3.5 Transcribe only** (dedicated speech-to-text model), not Flash-Lite. |
| W3 | **Login:** Owner and Supervisor sign in with Google. Staff tap their name + a 4-digit PIN, **only on the shop device**. |
| W4 | **Judges:** one-click "Try as Owner / Supervisor / Staff" in a **demo outlet**, fully separate from Proofed's real data. |
| W5 | **Stack:** TypeScript, Next.js. |
| W6 | Shop capture screen shows **status only** (no live transcript). |
| W7 | Owner sees **summaries only**; the quoted evidence lines stay with supervisors. |
| W8 | The SOP changes **only through proposals** (evidence → supervisor → owner). No direct editing. |

**Also locked:** one architecture for demo and production; segments (not streaming); services in Jakarta, each Gemini model's location from the region probe (Jakarta → Singapore → global); Live API only for the evening debrief; consent before real audio; one Cloud Run service (29 Sept); dev tool Claude Code, product only Google Cloud + Google AI (29 Sept).

---

## 1. The system in one picture (words)

```
[Shop phone: Chrome, /capture]                        [Phones/laptops: browser]
  mic → voice detection → ≤ 15 s segments              Owner · Supervisor · Staff (shop phone) · Judge (demo)
  → in-memory queue → upload                                    │
            │                                                   │
            ▼                                                   ▼
  ┌──────────── Cloud Run service "web", asia-southeast2 (Jakarta) ────────────┐
  │  screens + API routes + login/roles (Next.js, TypeScript)                  │
  │  pipeline  segment → Transcribe → redact → windows → labels → gate         │
  │            (async steps via Cloud Tasks → /api/internal/*, OIDC-checked)   │
  │  agents    ADK (TypeScript): Debrief, Proposal, Critic, Review             │
  └───────────────┬──────────────────────────────────┬─────────────────────────┘
                  │                                  │
        Firestore (Jakarta)               Gemini on Google Cloud (Agent Platform)
        Cloud Tasks, Scheduler            location per model from config/regions.yaml
        Secret Manager, Firebase Auth     (Jakarta → Singapore → global)
                                          3.5 Transcribe · 3.5 Flash-Lite · 3.5 Flash · Live API
```

---

## 2. Roles and permissions (simple RBAC)

Four roles plus the shop device. Each user belongs to **one outlet** with **one role** (MVP). A **judge** in the demo outlet gets exactly the permissions of the role they picked ("Try as Owner" sees owner screens), on fictional data only.

| Can do | Owner | Supervisor | Staff | Shop device |
|---|:-:|:-:|:-:|:-:|
| Sign in with Google | ✅ | ✅ | — | — |
| Sign in with name + PIN | — | — | ✅ shop device only | — |
| Upload audio segments + heartbeats | — | — | — | ✅ own outlet |
| See day record: summaries | ✅ | ✅ | — | — |
| See day record: quoted evidence lines | — | ✅ | — | — |
| Answer debrief questions | — | ✅ (any) | ✅ (own episodes) | — |
| See who answered a question | — | ❌ (shows "a staff member") | — | — |
| Confirm / override labels | — | ✅ | — | — |
| Review proposal (feasible / reject + reason) | — | ✅ | — | — |
| Approve proposal (cost & brand) | ✅ | — | — | — |
| Record review-date verdict | ✅ | ✅ | — | — |
| See SOP versions + diffs | ✅ | ✅ | read current steps | — |
| Edit SOP directly | — | — | — | — |
| Invite supervisors (MVP: seed script) | ✅ | — | — | — |
| Add staff, reset PINs, pair/unpair shop device (MVP: seed script; screens P1) | ✅ | ✅ | — | — |
| Upload POS CSV / roster (P1) | ✅ | ✅ | — | — |
| Cost per day tile (P1) | ✅ | — | — | — |

**Rules the backend enforces (not just the UI):**
- Every request carries the user's `outlet_id` and `role` (as token claims). The server rejects any read or write outside that outlet.
- Proposals, threads and outcomes store **role + SOP step**, never a staff name. Names exist only in the staff list used to route debrief questions.
- A staff answer on a COMPLAINT, CORRECTION or any incident thread is saved but **only becomes a fact after a supervisor confirms**.
- The demo outlet and Proofed live in **different GCP projects**. A demo visitor can never reach real data.
- GATI's platform admin (outside the app UI) creates outlets and the first owner.

---

## 3. Login (authentication)

| Who | How | Details |
|---|---|---|
| Owner, Supervisor | **Google sign-in** (Firebase Authentication) | MVP: the seed script lists the owner and supervisor emails; signing in with that Google account links the role. (P1: owner invites supervisors from a screen.) |
| Shop device | **Pairing code** | MVP: the seed script prints a 6-digit code valid 10 min; it's typed on the shop phone at `/pair`. The phone receives a long-lived device token (stored in the browser) tied to one outlet. Revoking it is a script command. (P1: *Settings → Devices → Pair / Unpair*.) |
| Staff | **Name + 4-digit PIN, on the paired shop device only** | The PIN screen appears only when a valid device token is present. 5 wrong tries → locked 15 min. The staff session lasts 30 min or until "Done". |
| Judge | **"Try as…" buttons** on the demo landing page | Creates a short session (2 h) with the chosen role in the demo outlet. Rate-limited per IP. |

Notes:
- Token claims: `{ outlet_id, role, staff_id? , device_id? }`, set by the backend (Firebase custom claims / custom tokens).
- Firestore is **closed to browsers**: every read and write goes through the `web` API, which checks the claims. Simpler and safer than writing Firestore rules for five roles.
- Firebase Authentication stores users' emails outside Jakarta. Note it in the later DPIA.

---

## 4. Web app: screens by role

Responsive: works on a phone (360 px wide) and a laptop. Language toggle: **Bahasa Indonesia / English**. Demo outlet defaults to English.

### 4.1 Shop device — `/capture` (and staff PIN)
- **Big status:** 🟢 Listening · 🟡 Offline (N segments waiting) · 🔴 Mic problem. Mic source shown (built-in / USB / Bluetooth). **No transcript on screen.**
- Keeps the screen awake while open; asks to stay plugged in.
- Starts automatically at opening time, pauses at closing time.
- A "Staff" button opens the **name + PIN** screen for the debrief.
- If consent isn't marked complete for the outlet, capture won't start (shows why).

### 4.2 Staff (on the shop device, after PIN)
- **Tonight's questions** (max 5, about *steps*, not people). Answer by tapping *Iya* / *Bukan* and optionally typing a correction (R-07).
- **Voice debrief** (R-16): the agent speaks first; the same questions; falls back to tap if the connection drops.
- Current SOP steps for their role (read-only).

### 4.3 Supervisor
- **Today / Day record:** timeline of labelled threads, with category, summary, **quoted evidence lines**, confidence, and fact/question status. Filter by category.
- **Questions queue:** everything waiting for confirmation; confirm or override labels.
- **Proposals:** evidence, rubric criterion, intervention, metric, failure condition, review date. Buttons: *Feasible* / *Reject* (reason required).
- **Reviews:** before/after numbers on the review date; verdict *worked / revise / revert*.
- **SOP:** current version, history, v1→v2 diff.
- **Settings (P1):** staff (add, reset PIN), shop device (pair / unpair / health), uploads (POS CSV, roster). In the MVP these are done by the seed script.
- **Gold set:** not a screen. Episodes are labelled in a Google Sheet by Tiffany and the supervisors; the eval script (R-13) reads it.

### 4.4 Owner
- **Home:** today in 5 lines (summaries only), proposals waiting for approval, upcoming review dates, cost per day (P1).
- **Approvals:** proposal summary, evidence as *dated summaries* (no quoted lines), cost/brand impact. *Approve* / *Reject* (reason required).
- **Reviews, SOP history** as for supervisors.
- **Team:** see staff list (inviting supervisors from a screen is P1).

### 4.5 Judge (demo outlet)
- Landing page: one paragraph on what the product does + **Try as Owner / Supervisor / Staff**.
- A small guided tour (the 7 steps from GATI's private product context §13.5) that can be skipped **(P1)**.
- **"Re-run this clip live" (P1)**: sends a scenario clip through the real `/segments` endpoint and shows the fresh result.
- **"Fast-forward to review date"**: calls the same review endpoint the scheduler calls; the screen says *simulated time*.
- The demo capture page works with the judge's own mic (with permission) in the demo outlet.

---

## 5. Capture in the browser (replaces the Android app)

**How it works:**
1. `getUserMedia` opens the mic; the user can pick the input from the list the browser gives (built-in, USB receiver, or a Bluetooth mic that the phone has connected).
2. An AudioWorklet feeds 16 kHz audio to **Silero VAD** running in the browser (ONNX Runtime Web). 400 ms pre-roll so first syllables aren't cut.
3. Speech is batched into **segments of ≤ 15 s** (closed early on a ≥ 2 s pause once ≥ 6 s is collected, or after 8 s of silence). Silence isn't uploaded.
4. Each segment is compressed to **Opus** (WebCodecs audio encoder, ~24 kbps; a 15 s segment ≈ 45 KB) in a WebM/OGG container.
5. It's held in an **in-memory queue** (about 10 min of segments; older ones are dropped and counted) and uploaded with `PUT /api/v1/segments/{device_id}:{seg_id}`. Deleted on `200`. **(P1)** An encrypted queue in IndexedDB (WebCrypto AES-GCM, key can't be exported, 2 h cap) replaces it if time allows.
6. **Heartbeat** every 60 s: mic source, sample rate, speech %, queue size, battery, screen-awake state.

**Known limit (test first: 5-min test and 14 h test on Wed 30):** a browser only captures reliably while the page stays **open, in front, and the screen on**. So the shop device is a plugged-in phone or tablet with the capture page kept open. The page re-requests the mic and restarts itself after errors or device changes.

**Browser support target:** Chrome on Android (shop device). Owner/supervisor screens: any modern browser.

**Acceptance criteria (capture):**
- [ ] Silent room for 10 min → 0 bytes uploaded.
- [ ] First syllable intact on 10 test clips.
- [ ] 3 minutes of continuous talk → ≥ 12 segments, no words lost between them.
- [ ] Turn off Wi-Fi for 10 min, reconnect → every segment arrives exactly once, in order. (30 min once the P1 encrypted queue exists.)
- [ ] Unplug the external mic → capture continues on the built-in mic within 3 s, and the heartbeat shows the fallback.
- [ ] A Bluetooth or USB source below 16 kHz is refused with a clear message.
- [ ] Screen stays awake for 14 hours with the page open (test on the actual shop phone).
- [ ] Upload ≤ 1 GB per month at 20% speech.

---

## 6. Backend

### 6.1 One Cloud Run service (asia-southeast2)
| Part (inside `web`) | What it does |
|---|---|
| Screens + API | Next.js app: every screen, all API routes, login, role checks |
| Pipeline | Transcription runs inside the segment request; the rest (windows → labels → gate) runs as Cloud Tasks calling `/api/internal/*` (the OIDC token from Cloud Tasks is checked) |
| Agents | ADK (TypeScript): DebriefAgent, ProposalAgent, CriticAgent, ReviewAgent; Cloud Scheduler calls their internal routes |

Scales 0 → n. One deployable is simpler for a one-person team; the architecture slide still names each agent.
Supporting: Firestore (Native, Jakarta), Cloud Tasks (queues between steps, retries), Cloud Scheduler (opening/closing, debrief time, review dates), Secret Manager, Sensitive Data Protection, Firebase Authentication. (P1: BigQuery billing export for the cost tile.)

### 6.2 Main API (served by `web`)
| Method + path | Who | Does |
|---|---|---|
| `PUT /api/v1/segments/{device}:{seg}` | Shop device | Transcribes the audio **in memory only**, stores redacted text, queues the next pipeline step, returns `200`. Idempotent. |
| `POST /api/v1/heartbeat` | Shop device | Device health |
| `POST /api/v1/devices/pair` | Shop phone with a valid pairing code | Code → device token (codes come from the seed script; P1: from Settings) |
| `POST /api/v1/auth/pin` | Staff via shop device | Name + PIN → staff session |
| `POST /api/v1/demo/session` | Anyone (demo only) | One-click role session |
| `GET /api/v1/day/{date}` | Owner (summaries), Supervisor (full) | Day record |
| `GET /api/v1/questions` · `POST /api/v1/questions/{id}/answer` | Staff (own), Supervisor | Debrief |
| `POST /api/v1/threads/{id}/confirm` | Supervisor | Confirm / override a label |
| `GET /api/v1/proposals` · `POST …/{id}/review` · `POST …/{id}/approve` | Supervisor / Owner | Approval chain |
| `GET /api/v1/sop` · `GET /api/v1/sop/diff?from=&to=` | Owner, Supervisor, Staff (current) | SOP |
| `POST /api/v1/reviews/{id}/verdict` | Owner, Supervisor | Outcome |
| `POST /api/v1/proposals/generate` | Supervisor | Runs the ProposalAgent now (also used in the demo outlet) |
| `POST /api/internal/*` | Cloud Tasks, Cloud Scheduler only (OIDC) | Pipeline steps, debrief time, review date |
| `POST /api/v1/uploads/pos` · `/roster` (P1) | Owner, Supervisor | CSV imports |
| `GET /api/v1/cost/daily` (P1) | Owner | Cost tile |

Transcription happens inside the segment request (so the audio never has to be stored); the rest of the pipeline runs async via Cloud Tasks.

### 6.3 Transcription (Gemini 3.5 Transcribe only)
- Call: audio inline (≤ 45 KB), `language_codes: ["id-ID","jv-ID"]` (or auto-detect if accuracy is better, decided in R-04 on Tiffany's test clips), **custom vocabulary ≤ 100 terms** (products, staff first names, suppliers). No diarization, no word timestamps (they can't be combined with custom vocabulary, and speaker role comes from mic position).
- Mode: **verbatim** (keeps "misalnya…", "kalau nanti…", which the label step needs to spot hypotheticals).
- Output stored as redacted text lines with the device's start/end time.
- **Work vs private:** Transcribe can't judge this, so the label call (text, Flash-Lite) marks `non_work_lines`; those lines are deleted from the segment record right after labelling and only counted.
- **Uncertain words:** Transcribe gives no confidence, so confidence comes from the label call plus debrief answers (the gate already sends anything unsure to a question).

### 6.4 Data model (Firestore; every document has `outlet_id`)
`outlets` · `users` (uid, role, outlet) · `staff` (name, PIN hash, role; **the only place names live**) · `devices` (+ `heartbeats`) · `segments` (redacted lines, times, model, location; TTL 48 h) · `windows` · `threads` (category, fields, summary, evidence line refs, confidence, runner-up, status) · `questions` · `corrections` · `sop_versions` (immutable) · `proposals` · `constraints` · `reviews` · `outcomes` · `sales_events` · `event_cards` · `audit_log` (who did what, when).

### 6.5 Security basics
- Secrets in Secret Manager; one service account for `web` with only the permissions it needs; a separate invoker account for Cloud Tasks/Scheduler.
- PINs hashed (bcrypt/argon2); device tokens revocable; staff sessions short.
- No audio in cloud storage, logs or error reports (log sizes and IDs only).
- Every approval, rejection, override and verdict is written to `audit_log`.
- Demo project has an API quota cap and a daily token ceiling; live calls are rate-limited per IP.

---

## 7. Cost with Transcribe only (be ready for the judge question)

All-in model spend per outlet per month, at 15 / 20 / 25% speech: **~$24 / $30 / $37**. That's **1.3–2.1× the Rp300k price**; transcription alone is ~$19–32 of it (≈ $0.005 per speech minute).

This is fine for the hackathon (pilot + demo ≈ **$60–65** of Google Cloud through judging on 6 Nov, ≈ $115–125 if it runs to the 4 Dec finale; the $300 new-customer credit may cover it) but not as a business at Rp300k. The honest ways to answer a judge:
1. **A cheaper first pass** (Flash-Lite, which Google documents for speech recognition) with Transcribe only when unsure, which models at ~$11–16/month. **Decided (Q-A):** not built; shown as a slide labelled "modelled".
2. Price at the franchisor tier (Rp450–500k+) and tune voice detection.

---

## 8. Answers from GATI (29 Sept, 21:00)

| # | Question | Answer |
|---|---|---|
| Q-A | Build the Flash-Lite cheaper-path switch now? | **No. Transcribe first.** The cheaper path stays a deck slide (modelled, labelled as modelled) |
| Q-B | Team | **Rangga:** all technical design and implementation. **Tiffany:** all non-technical work |
| Q-C | Shop device | **Android phone** (Chrome) |
| Q-D | Can supervisors see which staff member answered? | **No, only "a staff member".** Supervisors follow up in person outside the app |

**Effect of Q-D on the design:** staff names are used only to route a question to the right person on the shop device. Answers, corrections and audit entries store `answered_by: staff` (role only). The audit log records the device, not the person.

## 9. Where each part is built (R-IDs from the plan)

| Part of this spec | Task | Date |
|---|---|---|
| Projects, probe, repo, deploy (§6.1) | R-01 | Wed 30 Sep |
| Data model, Google sign-in, roles, seed script, pairing, staff PIN (§2, §3, §6.4) | R-02 | Thu 1 – Fri 2 |
| Capture page (§4.1, §5) | R-03 | Fri 2 – Sat 3 |
| Segment API + Transcribe + redaction (§6.2, §6.3) | R-04 | Sun 4 |
| Day record screens (§4.3, §4.4) | R-06 | Tue 6 |
| Staff debrief, tap (§4.2) | R-07 | Wed 7 |
| Approval screens (§4.3, §4.4) | R-09 | Fri 9 |
| Staff debrief, voice (§4.2) | R-16 | Sun 11 |
| Demo outlet + "Try as…" (§4.5) | R-12 | Tue 13 |
| Encrypted queue, settings screens, cost tile, re-run live, tour, CSV uploads | P1 | If time |

## Sources (checked 29 Sept 2026)
- Gemini audio understanding (transcription is a listed use; inline ≤ 20 MB; WebM/Opus supported): https://ai.google.dev/gemini-api/docs/audio
- Gemini 3.1 Flash-Lite model page ("improved audio-input quality for tasks like ASR"): https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-flash-lite
- Gemini 3.5 Transcribe (custom vocabulary ≤ 1,000 terms, best ≤ 100; not combinable with diarization or timestamps; verbatim vs smart): https://ai.google.dev/gemini-api/docs/transcribe
- Transcribe pricing on Agent Platform (~$0.0051 per audio minute, sync): https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing

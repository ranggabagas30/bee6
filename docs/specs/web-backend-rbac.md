# SOP Improvement Agent — Web App, Backend and Roles Spec (v1.1, 30 Sept 2026, 01:30 WIB)

**Sources of truth:** `docs/plan.md` for sprints; `docs/specs/technical-specification.md` (§8) for
capture and session rules; `docs/specs/web-backend-rbac.md` (§6.6) for routes and data;
`docs/tasks/UX-03-journey-design.md` for screens and copy.
Precedence: `CLAUDE.md` → `docs/plan.md` → `docs/backlog.md` → this spec.
Reconciled 4 Oct 2026 (tech-lead): capture status (§4.1), the Mulai window (§4.1), debrief wording (§1, §4.2),
the staff role on answers (§2), the internal-route list (§6.2), and two superseded notes below.

> **Updated 18 Oct 2026 (tech-lead, docs only): as built.** Owner and supervisor sign in with **email +
> password** (accounts created by the admin provisioning script, which only touches Firebase Auth and reads
> the role and outlet from the seeded `users` doc; no self sign-up; 9 Oct). The Google sign-in lines below are
> history. The pipeline runs on a **Cloud Scheduler tick** (`/api/internal/pipeline/tick`, every minute on
> `web`, every 2 minutes on staging `web-develop`) plus the daily review run (`/api/internal/reviews/run`);
> **nothing uses Cloud Tasks**. Agents as built: Proposal (v4 tool loop, plain-code `check_proposal`, flag
> `PROPOSAL_AGENT_V4`), Debrief (question wording only, demo sandboxes, `check_question`, flag
> `DEBRIEF_AGENT`) and Review (explains the plain-code verdict on the demo sandbox fast-forward,
> `check_review`, flag `REVIEW_AGENT`); **no Critic agent** (dropped 16 Oct). The R-06, R-08 v2 and R-11
> routes marked "planned" in §6.2 are built. The Mon 12 Oct pilot go-live was postponed on 9 Oct with no new
> date; the pilot project has no deployed service. Detail: `docs/specs/technical-specification.md` §9 and §10.

> **Updated 4 Oct 2026, MVP 1 answer shape (tech-lead, docs only; Rangga, 4 Oct, final; `docs/HANDOFF.md`
> "Debrief answer shape for MVP 1"). Supersedes the free-text-only answer in the note below.** A debrief
> answer is ***Ya* (YES) or *Tidak* (NO) plus a required reason**, or *Lewati* (skip, sends nothing). Route
> body `{ question_id, debrief_business_date, answer: "yes" | "no", reason, answered_at_ms }`; no valid
> `answer` → 400 `invalid_body`; empty reason → 400 `reason_empty`; reason over 500 characters → 400
> `reason_too_long` (never truncated); name scrub then SDP before storage, 503 on redaction failure. YES
> confirms the thread's model category (`staff_confirmed`); NO rejects it (`staff_rejected`: thread not
> confirmed and excluded from evidence, question closed as rejected). The reason is stored and shown only
> (supervisor: beside its thread, no device id; owner: summaries only), never a gate input. Category-revising
> free text is post-MVP 1. Device-only route, 403 for supervisors and owners, unchanged. Changed: §2
> (rules), §2a (items 5, 6), §4.2, §4.3, §6.2, §6.5.

> **Updated 4 Oct 2026, final (tech-lead, docs only): debrief answer shape and the supervisor exclusion
> (Rangga, 4 Oct, final; `docs/HANDOFF.md` "Debrief answer shape").** **Supervisors do NOT answer device
> debrief questions** (Q32 closed: no; rule in §2). `POST /api/v1/questions/{id}/answer` accepts the device
> principal only; a supervisor, owner or staff token gets **403** and nothing is written. Supervisors
> confirm or override on the **thread** side (`POST /api/v1/threads/{id}/confirm`, the questions queue)
> and review proposals; those are separate actions audited with `actor_role: "supervisor"` and never
> create or edit an answer. A debrief answer is **one free-text WHY explanation** (no *Ya* / *Tidak* /
> *Bukan ini*, no reason chips), refused when empty or over 500 characters, name-scrubbed and redacted
> with Sensitive Data Protection before storage (§6.6.6). The supervisor sees the
> stored explanation next to its thread as "a staff member answered", never with a device id; the owner
> sees summaries only. A fully answered debrief does not release Mulai early. Changed: §2 (matrix row
> "Answer debrief questions", rules), §2a (items 5, 6), §4.2, §4.3 (questions queue), §6.2 (questions
> routes split), §6.5.

> **Updated 4 Oct 2026, late (tech-lead, docs only): role-agnostic questions, multi-device, the Mulai gate
> (Rangga, 4 Oct, final; `docs/HANDOFF.md`).** **Debrief questions are role-agnostic:** a question never
> depends on who answers; it asks whether an SOP step was done properly and, if not, why. **No
> `answered_by` role is stored:** an answer keeps only the answering device id and timestamps (for the
> cross-device merge, the debrief binding and idempotency); supervisors and owners still see "a staff
> member answered", never who and never the device id. **Multi-device:** several devices may run sessions
> at once; each has its own session, debrief, debrief expiry and Mulai gate, and there is no outlet-level
> Mulai; answers upload per device and the insight run merges all devices (technical spec §8.15), so two devices
> hearing one conversation is a merge concern, not a double count. **Mulai gate:** a device's Mulai waits
> for that device's previous-day debrief to time out unless that day was off for it (technical spec §8.3 rule
> 6(d)). Whether supervisors may still answer device questions is open (Q32; proposed: no).
> *(Closed 4 Oct, final: no; see the note above.)*
> Changed: §2 (matrix rows "Answer debrief questions" and "See who answered", rules), §2a (items 3, 5, 6),
> §4.2, §6.2 (questions route), §8 (effect of Q-D).

> **Updated 4 Oct 2026 (tech-lead, docs only): sign-in and consent (Rangga, 4 Oct, final; `docs/HANDOFF.md`).**
> Owner and supervisor keep **email + password (accounts created by an admin provisioning script; no self sign-up)**; staff need **no sign-in** (as in the device model note
> below). **Consent is not collected in the app:** it is covered by the paper contract between bee6 and
> Proofed, and bee6 emails the consent, the updated privacy policy and the TnC to all users. The in-app
> consent gate (the outlet's `consent_complete` flag, the capture page's "no consent" view, the
> staff-consent step) is **removed from MVP 1**. This also answers the device model note's open item:
> neither a staff member nor a newly paired staff phone goes through any in-app consent step. Revocation
> stays a manual procedure (requests by email or under the contract; acknowledgement and complete removal
> within 7 working days; technical spec §8.16), and **MVP 1 has no in-app revoked-consent state**. The privacy
> line on `/capture` stays as an in-app **notice**, not consent collection. Changed: §1 "Also locked",
> §4.1 (consent bullet, new privacy-line bullet).

> **Updated 4 Oct 2026 (tech-lead, docs only): MVP 1 device model (Rangga, 4 Oct, final; `docs/HANDOFF.md`).**
> MVP 1 has **no staff sign-in** (no name, no PIN, no staff session). Staff only **pair a device**. The
> system does not tell a shop phone from a staff member's own phone: it tracks the **device id** only, and
> every session rule runs per device, the same way whatever the mode. **Mode is derived and is a label
> only:** exactly one active paired device = "room mode", more than one = "wearable mode" (new §2a). Debrief
> answers come from the **device principal** and are stored as `answered_by: "staff"` plus the device id,
> never a name *(superseded 4 Oct, later: no `answered_by`, device id and timestamps only, §6.6.6)*. The staff name + PIN design is kept below, marked **post-MVP 1**. Changed: W3, W4, §1, §2
> (intro, matrix, rules), new §2a, §3, §4.1, §4.2, §4.3, §4.5, §5 (known limit), §6.2, §6.4, §6.5, §8
> (effect of Q-D), §9. **Open for Rangga (not decided here; consent part closed 4 Oct by the sign-in and consent note above, no in-app consent step for anyone):** whether the staff consent step still
> applies without staff sign-in (and whether pairing a staff phone needs its own consent); owner and
> supervisor email + password sign-in (accounts created by an admin provisioning script; no self sign-up) stays (CLAUDE.md §3) unless Rangga says otherwise; staff phones must keep the
> page open with the screen on to capture (§5); two devices hearing one conversation produce duplicate
> threads and questions (no cross-device de-duplication is built), which can double-count evidence. *(4 Oct,
> late: resolved as a read-time merge in the insight run, technical spec §8.15; see the newest note.)*

> **Updated 3 Oct 2026 (aligned with `docs/plan.md` v5):** `/capture` now starts only on a staff tap of Mulai and stops on Selesai or the hard auto-stop 60 min after closing (opening hours are reminders only; ~~off-hours Mulai is a normal session with no shorter cap~~ *superseded 4 Oct: Mulai only inside the Mulai window, technical spec §8.3*; a day with no Mulai is recorded as off / closed with no gap alarm); task table re-dated for the Mon 12 Oct pilot go-live (*postponed 9 Oct, no new date*); R-16 moved to "if time".

**What this doc is:** the build spec for the web app (replacing the Android app), the backend, login, and who-can-do-what (roles).
**How it fits:** `docs/plan.md` says when each part is built; `docs/backlog.md` has the steps per task (R-xx); `docs/specs/pipeline-and-agents.md` covers the pipeline, debrief, agents and demo.
**v1.1 changes (30 Sept):** one Cloud Run service (not three) · in-memory upload queue for the MVP (encrypted queue is P1) · users, staff and the shop phone set up by a seed script (settings screens are P1) · gold set in a Google Sheet (no labelling screen) · region order Jakarta → Singapore → global · pilot cost corrected · task table now uses R-IDs. Items marked **(P1)** are built only if time allows.

## 0. Decisions from GATI (29 Sept, evening)

| # | Decision |
|---|---|
| W1 | **Web app instead of Android.** One responsive web app for everyone: the shop's capture device, staff, supervisors, owner and judges. |
| W2 | **Transcription = Gemini 3.5 Transcribe only** (dedicated speech-to-text model), not Flash-Lite. |
| W3 | **Login:** Owner and Supervisor sign in with Google *(superseded 9 Oct: email + password, admin-provisioned, no self sign-up)*. Staff tap their name + a 4-digit PIN, **only on the shop device**. **MVP 1 (4 Oct): staff do not sign in; they only pair a device (§2a). The name + PIN sign-in is post-MVP 1.** |
| W4 | **Judges:** one-click "Try as Owner / Supervisor / Staff" in a **demo outlet**, fully separate from Proofed's real data. (MVP 1: "Try as Staff" opens a paired-device session in the demo outlet, §3.) |
| W5 | **Stack:** TypeScript, Next.js. |
| W6 | Shop capture screen shows **status only** (no live transcript). |
| W7 | Owner sees **summaries only**; the quoted evidence lines stay with supervisors. |
| W8 | The SOP changes **only through proposals** (evidence → supervisor → owner). No direct editing. |

**Also locked:** one architecture for demo and production; segments (not streaming); services in Jakarta, each Gemini model's location from the region probe (Jakarta → Singapore → global); Live API only for the voice debrief (R-16, "if time"; the debrief starts at Selesai or the auto-stop, technical spec §8.3); consent before real audio (*4 Oct: by the bee6–Proofed paper contract plus an emailed consent, privacy policy and TnC to all users, not collected in the app*); one Cloud Run service (29 Sept); dev tool Claude Code, product only Google Cloud + Google AI (29 Sept).

---

## 1. The system in one picture (words)

```
[Paired device(s): Chrome, /capture]                  [Phones/laptops: browser]
  mic → voice detection → ≤ 15 s segments              Owner · Supervisor · Judge (demo)
  (shop phone or a staff phone; same to the system)     (MVP 1: staff answer the debrief on a paired device)
  → in-memory queue → upload                                    │
            │                                                   │
            ▼                                                   ▼
  ┌──────────── Cloud Run service "web", asia-southeast2 (Jakarta) ────────────┐
  │  screens + API routes + login/roles (Next.js, TypeScript)                  │
  │  pipeline  segment → Transcribe → redact → windows → labels → gate         │
  │            (Cloud Scheduler tick → /api/internal/*, OIDC-checked)          │
  │  agents    ADK (TypeScript): Proposal, Debrief (wording), Review (explain) │
  └───────────────┬──────────────────────────────────┬─────────────────────────┘
                  │                                  │
        Firestore (Jakarta)               Gemini on Google Cloud (Agent Platform)
        Cloud Scheduler                   location per model from config/regions.yaml
        Secret Manager, Firebase Auth     (Jakarta → Singapore → global)
                                          3.5 Transcribe · 3.5 Flash-Lite · 3.5 Flash
```

---

## 2. Roles and permissions (simple RBAC)

Owner and supervisor (email + password; accounts created by an admin provisioning script, no self sign-up) plus the **paired device**. In MVP 1 there is no staff principal and no staff role is stored on debrief answers (they store the answering device id and timestamps only, §2a; §6.6.6). The "Staff (post-MVP 1)" column is the later design, kept so it survives. Each user belongs to **one outlet** with **one role** (MVP). A **judge** in the demo outlet gets exactly the permissions of the role they picked ("Try as Owner" sees owner screens), on fictional data only.

| Can do | Owner | Supervisor | Staff (post-MVP 1) | Paired device (MVP 1: any paired phone) |
|---|:-:|:-:|:-:|:-:|
| Sign in with email + password (admin-provisioned; 9 Oct, replaced Google sign-in) | ✅ | ✅ | — | — |
| Sign in with name + PIN | — | — | ✅ paired device only (post-MVP 1) | — |
| Pair with a 6-digit code (`/pair`) | — | — | — | ✅ own outlet |
| Upload audio segments + heartbeats; Mulai / Selesai / cancel its own session | — | — | — | ✅ own outlet, own sessions |
| See day record: summaries | ✅ | ✅ | — | — |
| See day record: quoted evidence lines | — | ✅ | — | — |
| Answer debrief questions | — | ❌ *(Rangga, 4 Oct, final; Q32 closed: supervisors confirm/override labels instead; 403 on the answer route)* | ✅ (own episodes; post-MVP 1) | ✅ MVP 1: questions carrying this `device_id`, inside its debrief window; stored with the device id and timestamps only, no role (questions are role-agnostic) |
| See who answered a question | — | ❌ (shows "a staff member"; no name, no device id) | — | — |
| Confirm / override labels | — | ✅ | — | — |
| Generate proposal (`proposals:generate`) | ✅ (new, R-08 v2) | ✅ | — | — |
| Review proposal (feasible / reject + reason) | — | ✅ | — | — |
| Approve proposal (cost & brand) | ✅ | — | — | — |
| Record review-date verdict | ✅ | ✅ | — | — |
| See constraints (`constraints:read`, new) | ✅ (new, R-08 v2) | ✅ (new, R-08 v2) | — | — |
| Add a constraint (`constraints:write`, new) | — | ✅ (new, R-08 v2) | — | — |
| See SOP versions + diffs | ✅ | ✅ | read current steps (post-MVP 1) | — (no SOP screen on devices in MVP 1) |
| Edit SOP directly | — | — | — | — |
| Invite supervisors (MVP: seed script) | ✅ | — | — | — |
| Add staff names (for the name scrub), pair/unpair devices (MVP: seed script; screens P1); reset PINs (post-MVP 1) | ✅ | ✅ | — | — |
| Upload POS CSV / roster (P1) | ✅ | ✅ | — | — |
| Cost per day tile (P1) | ✅ | — | — | — |

**Rules the backend enforces (not just the UI):**
- Every request carries the user's `outlet_id` and `role` (as token claims). The server rejects any read or write outside that outlet.
- Proposals, threads and outcomes store **role + SOP step**, never a staff name. Names exist only in the staff list (MVP 1: used only for the staff-name scrub and the custom vocabulary; post-MVP 1 it also routes debrief questions to a signed-in staff member).
- A staff answer (MVP 1: any answer sent by a paired device) on a COMPLAINT, CORRECTION or any incident thread is saved but **only becomes a fact after a supervisor confirms**.
- **Only a paired device answers debrief questions (Rangga, 4 Oct, final).** The answer route rejects every other principal (supervisor, owner, staff, judge) with 403 before reading the body. A supervisor's confirm/override is a thread action (`POST /api/v1/threads/{id}/confirm`), never an answer, and stores the supervisor's role in `audit_log` only.
- **A debrief answer is *Ya* / *Tidak* plus a required reason (Rangga, 4 Oct, MVP 1 final; supersedes "one free-text explanation").** The strict body needs `answer: "yes" | "no"` (otherwise 400 `invalid_body`). The server refuses a reason that is empty or whitespace-only (400 `reason_empty`) or longer than 500 characters (400 `reason_too_long`, never truncated), runs the staff-name scrub and then Sensitive Data Protection on it before any write or log, and answers 503 (nothing written) if redaction fails. YES confirms the thread's model category (`staff_confirmed`); NO rejects it (`staff_rejected`: the thread is not confirmed and is excluded from evidence; the question is closed as rejected). The reason is never read by any rule to decide a category, a verdict or a gate input; category-revising free text is post-MVP 1 (technical spec §8.10–§8.11).
- **Debrief questions are role-agnostic (4 Oct, late):** no question targets, names or depends on a person or role; every question asks whether an SOP step was done properly and, if not, why. Answers store no actor except the device id.
- Device documents never hold a person's name or a label like "Budi's phone" (hard rule #7). Pairing never asks who owns the phone.
- The demo outlet and Proofed live in **different GCP projects**. A demo visitor can never reach real data.
- GATI's platform admin (outside the app UI) creates outlets and the first owner.

### 2a. MVP 1 device model (Rangga, 4 Oct, final)

1. **No staff sign-in in MVP 1.** No name, no PIN, no staff session, no staff token. Staff only pair a
   device with the system (`/pair` + a 6-digit code from the seed script).
2. **One kind of device.** The shop phone and a staff member's own phone are the same thing to the
   system: a `devices` doc, a `device_id`, a long-lived device token with claims
   `{ outlet_id, role: "device", device_id }`. Nothing records whose phone it is.
3. **The session runs the same everywhere.** Every rule in the technical spec §8 (Mulai window, Selesai,
   auto-stop, cancel, debrief clock, answer cache, eligibility, business-day attribution) runs **per
   device** with no mode branch: each device has its own sessions (`capture_sessions/{device_id}:…`),
   its own last-ended day, its own debrief window, its own debrief expiry, its own Mulai gate and its own
   answer cache, and several devices may run sessions at the same time; there is no outlet-level Mulai
   (one device in its debrief never holds back another). The pipeline tick already
   works one device at a time (R-05b). Outlet-level views combine devices (a day is "on" if any device
   had a non-discarded session in it; technical spec §8.15), and the insight run merges every device's facts and
   answers, counting one episode heard by two devices once (technical spec §8.15).
4. **Mode is derived, and it is a label only.** `captureMode(n)` where `n` = the outlet's active
   paired devices (a `devices` doc with `paired_at` set and `revoked !== true`), counted at read time: `n === 1` → `"room"`, `n > 1` → `"wearable"`,
   `n === 0` → `"none"`. It is **never stored** and **never an input to any rule**: not the session
   model, the pipeline, the gate, the debrief, coverage, sufficiency or RBAC. Its only uses: a DevPanel
   readout and a label on the supervisor/owner day record and reports ("Mode: ruangan / wearable").
   Enforced by a test: the helper is a pure function, and no module under the capture session, pipeline,
   gate, debrief-service or insights code imports it.
5. **Debrief.** Anyone holding a paired device answers that device's debrief, with no sign-in. A device
   sees and answers only the open questions whose `device_id` is its own (threads and questions carry the
   device that heard them). With one device that is every question of the outlet; with several, each
   device answers what it heard. Questions are role-agnostic (an SOP step done properly or not, and why).
   **Supervisors do not answer device questions** (Rangga, 4 Oct, final; Q32 closed): they confirm or
   override labels on the thread side. The answer itself is *Ya* / *Tidak* + a required reason, or
   *Lewati* (technical spec §8.10–§8.11; 4 Oct, MVP 1).
6. **What an answer stores (4 Oct, late: role-agnostic questions).** No actor role: the
   `answered_by` field is dropped, because every MVP 1 answer comes from a device (so the value would
   never vary) and no logic may depend on who answers. The answer stores `answered_device_id` (from the
   claims; cross-device merge, debrief binding, idempotency), `answered_at_ms` and `received_at_ms`. It
   never stores a uid, a staff id or a name. Anyone answering on a paired device is shown as "a staff
   member" (Q-D). The audit entry is `actor_role: "device"` + `device_id` (an audit actor, not an answer
   field). *(4 Oct, final: Q32 closed, no supervisor answering, so there is no `answer_source` field.)*
   The stored answer is `answer` (`"yes"` | `"no"`) and `reason_text`, already name-scrubbed and
   SDP-redacted (4 Oct, MVP 1).
7. **The device id is never shown next to an answer or a thread** on supervisor or owner screens or in
   their API responses. In wearable mode a phone is usually one person's, so a device id works like a
   name; showing it would break "supervisors see 'a staff member answered', never who".
8. **The `staff` collection stays** as the only place names live: the staff-name scrub (thread text,
   `fix_text`) and the custom vocabulary use it. R-02 already built the PIN hash, the PIN lockout and
   `POST /api/v1/auth/pin`; in MVP 1 they are **dormant**: no PIN is given to staff, and R-07 turns the
   PIN route off (404) so no unused login surface is live.
9. **Post-MVP 1:** staff name + PIN sign-in on a paired device (the design in §3 and
   `docs/tasks/R-07-ux-notes.md` §4.1), with per-staff question routing.

---

## 3. Login (authentication)

| Who | How | Details |
|---|---|---|
| Owner, Supervisor | **email + password (accounts created by an admin provisioning script; no self sign-up)** (Firebase Authentication) | MVP: the seed script writes the owner and supervisor `users` docs (email, role, outlet); the admin provisioning script creates the Firebase Auth account for that email with a generated password (no self sign-up, no password on the command line). (P1: owner invites supervisors from a screen.) |
| Device (any paired phone: the shop phone or a staff phone) | **Pairing code** | MVP: the seed script prints a 6-digit code valid 10 min; it's typed on the phone at `/pair`. The phone receives a long-lived device token (stored in the browser) tied to one outlet. Revoking it is a script command. Each paired phone is one device; the outlet's paired-device count gives the mode label (§2a). (P1: *Settings → Devices → Pair / Unpair*.) |
| Staff (**post-MVP 1**) | **Name + 4-digit PIN, on a paired device only** | Not in MVP 1 (§2a): staff do not sign in. Kept design: the PIN screen appears only when a valid device token is present. 5 wrong tries → locked 15 min. The staff session lasts 30 min or until "Done". |
| Judge | **"Try as…" buttons** on the demo landing page | Creates a short session (2 h) with the chosen role in the demo outlet. In MVP 1 "Try as Staff" creates a device session (`role: "device"`) on a demo device, since there is no staff principal. Rate-limited per IP. |

Notes:
- Token claims: `{ outlet_id, role, staff_id? , device_id? }`, set by the backend (Firebase custom claims / custom tokens). In MVP 1 no token carries `staff_id` (it is for the post-MVP 1 staff session).
- Firestore is **closed to browsers**: every read and write goes through the `web` API, which checks the claims. Simpler and safer than writing Firestore rules for five roles.
- Firebase Authentication stores users' emails outside Jakarta. Note it in the later DPIA.

---

## 4. Web app: screens by role

Responsive: works on a phone (360 px wide) and a laptop. Language toggle: **Bahasa Indonesia / English**. Demo outlet defaults to English.

### 4.1 Paired device — `/capture` (shop phone or staff phone; same screen)
- **Two status axes (technical spec §8.8; truthful UI):** the capture headline (🟢 "Mendengarkan / Listening" while a session runs and frames flow, for every upload result including `queue_full`, per the technical spec §8.8 headline rule (Rangga, 4 Oct); 🔴 mic problem; neutral when no session) and a separate **upload line** in every mode ("Mengunggah", "Gagal unggah, coba ulang (Nx)", "Gagal unggah, dilewati", "Unggah berhasil"). Offline never hides that listening continues; a 401/403 is kept and retried, never shown as success. Mic source shown (built-in / USB / Bluetooth). **No transcript on screen.**
- Keeps the screen awake while open; asks to stay plugged in.
- Starts only when staff tap **Mulai**, offered only inside the Mulai window [01:00 on D, close(D) − 4 h] and only when the per-device Mulai gate allows it (technical spec §8.3 rules 1, 6; §8.5); never on a closed weekday. Stops on **Selesai** (shown from Mulai + 4 h, confirmed) or the hard auto-stop 60 min after the day's closing time. Opening hours show reminders only. "Batalkan sesi" discards the open session until its close is triggered (technical spec §8.9). A day with no Mulai by the window end is recorded as off / closed, with no gap alarm (technical spec §8.3 rule 2).
- Outlet hours come from the seed (`weekly_hours`). The pilot's real hours live only in the private, untracked seed config, never in a public doc; public docs use a placeholder (`<OPEN>`–`<CLOSE>`). Closing may cross midnight (`<CLOSE>` on the next calendar day), in which case the hard auto-stop also falls on the next calendar day.
- After Selesai or the auto-stop, the debrief entry opens **this device's** questions directly, with no sign-in (MVP 1, §2a). (Post-MVP 1: a "Staff" button opens the name + PIN screen first.)
- ~~If consent isn't marked complete for the outlet, capture won't start (shows why).~~ *Removed from MVP 1 (4 Oct, Rangga final): consent is covered by the bee6–Proofed paper contract and an emailed notice, so the app has no consent flag, no "no consent" view and no revoked-consent state. Could return post-MVP 1 only if in-app consent is added.*
- The privacy line (`PRIVACY_NOTE`, technical spec §8.16) stays on screen as an in-app **notice** of what is and isn't kept. It is not consent collection: nothing is gated on it and nobody taps to accept it (4 Oct).

### 4.2 Debrief on a paired device (MVP 1: no sign-in)
- **This debrief's questions** for this device (the debrief starts at Selesai or the auto-stop and lasts 1 h, technical spec §8.10–§8.11) (max 5, about *steps*, not people, role-agnostic): each asks whether the SOP step was done properly and, if not, why. *(4 Oct, MVP 1 final)* Answer each with *Ya* or *Tidak* (did the labelled step happen; the SOP question "done per the SOP? if not, why?" is the reason prompt after *Ya*) plus a required typed reason (at most 500 characters; an empty one is not an answer; "tanpa nama" in the label); *Lanjut* commits, *Lewati* skips; no *Bukan ini*, no reason chips (R-07). Stored name-scrubbed and redacted, with the device id and timestamps only, no role (§2a). Finishing every question does not release Mulai early.
- **Voice debrief** (R-16): the agent speaks first; the same questions; falls back to tap if the connection drops.
- Current SOP steps for their role (read-only): **post-MVP 1** (needs a signed-in staff role).
- Post-MVP 1: the same screen after a staff name + PIN sign-in, with questions routed per staff member.

### 4.3 Supervisor
- **Today / Day record:** timeline of labelled threads, with category, summary, **quoted evidence lines**, confidence, and fact/question status. Filter by category.
- **Questions queue:** everything waiting for confirmation; confirm or override labels. Read-only for answers: the supervisor sees each accepted answer as "a staff member answered Yes / No: «reason»" (no device id), and a NO-rejected thread marked "Rejected by staff", excluded from evidence until the supervisor overrides it (4 Oct, MVP 1) and **cannot answer** a device question (4 Oct, final; Q32 closed).
- **Proposals:** evidence, rubric criterion, intervention, metric, failure condition, review date. Buttons: *Feasible* / *Reject* (reason required).
- **Reviews:** before/after numbers on the review date; verdict *worked / revise / revert*.
- **SOP:** current version, history, v1→v2 diff.
- **Settings (P1):** staff names (add; PIN reset is post-MVP 1), devices (pair / unpair / health), uploads (POS CSV, roster). In the MVP these are done by the seed script.
- **Mode label:** the day record header shows "Mode: ruangan / room" or "Mode: wearable" from the current paired-device count (§2a). Label only.
- **Gold set:** not a screen. Episodes are labelled in a Google Sheet by Tiffany and the supervisors; the eval script (R-13) reads it.

### 4.4 Owner
- **Home:** today in 5 lines (summaries only), proposals waiting for approval, upcoming review dates, cost per day (P1).
- **Approvals:** proposal summary, evidence as *dated summaries* (no quoted lines), cost/brand impact. *Approve* / *Reject* (reason required).
- **Reviews, SOP history** as for supervisors.
- **Team:** see staff list (inviting supervisors from a screen is P1).

### 4.5 Judge (demo outlet)
- Landing page: one paragraph on what the product does + **Try as Owner / Supervisor / Staff** ("Staff" = a demo paired-device session in MVP 1, §3).
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
5. It's held in an **in-memory queue** (about 10 min of segments; older ones are dropped and counted) and uploaded with `PUT /api/v1/segments/{device_id}:{seg_id}`. Deleted on `200`. An encrypted queue in IndexedDB (WebCrypto AES-GCM, key can't be exported) replaces it if time allows: phase P3, cap 4 h of audio or 64 MB, undelivered audio deleted after 24 h, OFF on the pilot until Rangga's written sign-off (`docs/specs/technical-specification.md` §8.14; the old "2 h cap" is superseded).
6. **Heartbeat** every 60 s: mic source, sample rate, speech %, queue size, battery, screen-awake state.

**Known limit (test first: 5-min test and 14 h test on Wed 30):** a browser only captures reliably while the page stays **open, in front, and the screen on**. So the shop device is a plugged-in phone or tablet with the capture page kept open. The page re-requests the mic and restarts itself after errors or device changes. **This applies to every paired device (MVP 1, §2a):** a staff phone in a pocket with the screen off will not capture, so wearable mode is only as reliable as each phone's screen-on, page-open state (open item for Rangga, see the 4 Oct note).

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
| Pipeline | Transcription runs inside the segment request; the rest (windows → labels → gate) runs on the Cloud Scheduler tick calling `/api/internal/pipeline/tick` (the OIDC token is checked: issuer `TASKS_INVOKER_SA`, audience `PIPELINE_TICK_AUDIENCE`). No Cloud Tasks |
| Agents | ADK (TypeScript), as built: ProposalAgent (v4, flag), DebriefAgent (question wording, demo sandboxes), ReviewAgent (explains the plain-code verdict, demo sandbox fast-forward), each checked by plain code; no CriticAgent. Scheduler calls only the tick and the daily review run |

Scales 0 → n. One deployable is simpler for a one-person team; the architecture slide still names each agent.
Supporting: Firestore (Native, Jakarta; staging uses the named database `staging`), Cloud Scheduler (pipeline tick, review dates; capture start/stop and the debrief follow Mulai/Selesai, not a schedule), Secret Manager, Sensitive Data Protection, Firebase Authentication. (P1: BigQuery billing export for the cost tile.)

### 6.2 Main API (served by `web`)
| Method + path | Who | Does |
|---|---|---|
| `PUT /api/v1/segments/{device}:{seg}` | Paired device | Transcribes the audio **in memory only**, stores redacted text (the next pipeline tick picks it up), returns `200`. Idempotent. Upstream failure → `503` (the phone retries) |
| `POST /api/v1/heartbeat` | Paired device | Device health |
| `POST /api/v1/devices/pair` | Any phone with a valid pairing code | Code → device token (codes come from the seed script; P1: from Settings) |
| `POST /api/v1/auth/pin` | Staff via paired device (**post-MVP 1**) | Name + PIN → staff session. Built in R-02; **returns 404 in MVP 1** (R-07 turns it off, §2a) |
| `POST /api/v1/demo/session` | Anyone (demo only) | One-click role session |
| `GET /api/v1/day/{date}` | Owner (summaries), Supervisor (full) | Day record *(built, R-06)* |
| `GET /api/v1/home` | Owner, Supervisor | Home/dashboard summary *(built, R-06; owner home)* |
| `GET /api/v1/questions` | Paired device (MVP 1: its own open questions, inside its debrief window); Supervisor (read-only, any, for the questions queue; no device id in the response) *(supervisor branch: built, R-06)*; Staff (own) post-MVP 1 | Debrief list / questions queue |
| `POST /api/v1/questions/{id}/answer` | **Paired device only** (MVP 1: questions with its own `device_id`, inside its debrief window); Staff (own) post-MVP 1. Supervisor / owner → 403 (4 Oct, final) | Debrief answer (4 Oct, MVP 1): body `{ question_id, debrief_business_date, answer: "yes" \| "no", reason, answered_at_ms }`; no valid `answer` → 400, empty reason → 400, reason > 500 characters → 400, scrub + SDP on the reason before storage, 503 on redaction failure; YES → `staff_confirmed`, NO → `staff_rejected`. Stored with `answered_device_id` and timestamps only, no role, never a name (§2a; §6.6.6) |
| `POST /api/v1/threads/{id}/confirm` | Supervisor | Confirm / override / reject a label *(built, R-06)* |
| `GET /api/v1/proposals` · `POST …/{id}/review` · `POST …/{id}/approve` | Supervisor / Owner | Approval chain |
| `GET /api/v1/sop` · `GET /api/v1/sop/diff?from=&to=` | Owner, Supervisor; Staff (current) post-MVP 1 | SOP. *As built: `GET /api/v1/sop` only (versions with their change); no separate diff route* |
| `POST /api/v1/reviews/{id}/verdict` | Owner, Supervisor | Outcome |
| `GET /api/v1/constraints` | Owner, Supervisor | List constraints (built, R-08 v2) |
| `POST /api/v1/constraints` | Supervisor | Add a constraint (built, R-08 v2) |
| `POST /api/v1/proposals/generate` | Owner, Supervisor (both, v2, not supervisor-only) | Runs the ProposalAgent now over a date range (also used in the demo); as built this is the insight run: plain-code range check and evidence floor first |
| `POST /api/internal/*` | Cloud Scheduler only (OIDC; as built no Cloud Tasks) | Pipeline steps (the tick), the debrief-end `unverified` expiry if R-07 picks a tick write (technical spec §8.10), review date. The debrief itself starts at Selesai or the auto-stop, not on a schedule |
| `GET /api/v1/capture/config` | Paired device | Its outlet's timezone, resolved weekly hours and this device's `last_ended` (§6.6.2) |
| `POST /api/v1/capture/sessions` · `…/{session_id}/end` · `…/{session_id}/discard` | Paired device only | Start, end and cancel its own session (§6.6.3 to §6.6.5) |
| `POST /api/v1/capture/gaps` | Paired device only | Gap ledger upsert, P2 (§6.6.7). *Not built* |
| `POST /api/v1/insights/runs` · `GET /api/v1/insights/runs` | Supervisor, Owner of the outlet | Idempotent insight run per exact date range + sufficiency check; run list + weekly reminder flag (§6.6.8). *Not built: the proposal generate route plays this role* |
| `GET /api/v1/reviews` · `POST /api/v1/reviews/fast-forward` | Owner, Supervisor; fast-forward demo only (`DEMO_MODE`, demo outlet, 3 per sandbox) | Review list; simulated fast-forward to the review date (runs the same review code; the Review agent only on a sandbox with `REVIEW_AGENT`) |
| `POST /api/v1/demo/closing` · `POST /api/v1/demo/next-day` · `GET /api/v1/demo/progress` · `POST /api/v1/demo/reset` | Demo sandbox only (`DEMO_MODE`; 404 otherwise) | Jump to closing, jump to tomorrow (plain-code guards), guide progress, owner reset (technical spec §9.2) |
| `POST /api/v1/uploads/pos` · `/roster` (P1) | Owner, Supervisor | CSV imports |
| `GET /api/v1/cost/daily` (P1) | Owner | Cost tile |

Transcription happens inside the segment request (so the audio never has to be stored); the rest of the pipeline runs on the scheduled tick (as built; no Cloud Tasks).

### 6.3 Transcription (Gemini 3.5 Transcribe only)
- Call: audio inline (≤ 45 KB), `language_codes: ["id-ID","jv-ID"]` (or auto-detect if accuracy is better, decided in R-04 on Tiffany's test clips), **custom vocabulary ≤ 100 terms** (products, staff first names, suppliers). No diarization, no word timestamps (they can't be combined with custom vocabulary, and speaker role comes from mic position).
- Mode: **verbatim** (keeps "misalnya…", "kalau nanti…", which the label step needs to spot hypotheticals).
- Output stored as redacted text lines with the device's start/end time.
- **Work vs private:** Transcribe can't judge this, so the label call (text, Flash-Lite) marks `non_work_lines`; those lines are deleted from the segment record right after labelling and only counted.
- **Uncertain words:** Transcribe gives no confidence, so confidence comes from the label call plus debrief answers (the gate already sends anything unsure to a question).

### 6.4 Data model (Firestore; every document has `outlet_id`)
`outlets` · `users` (uid, role, outlet) · `staff` (name, PIN hash, role; **the only place names live**; MVP 1: names feed the scrub and vocabulary, the PIN hash is dormant) · `devices` (+ `heartbeats`; no person's name or label, MVP 1 §2a) · `segments` (redacted lines, times, model, location; TTL 48 h) · `windows` · `threads` (category, fields, summary, evidence line refs, confidence, runner-up, status) · `questions` · `corrections` · `sop_versions` (immutable; v1, v2 = v1 + approved change) · `proposals` · `constraints` (redacted text; `source: "supervisor_rejection" | "manual"`; planned, R-08 v2, not yet built) · `reviews` · `outcomes` · `sales_events` · `event_cards` · `audit_log` (who did what, when) · `capture_sessions` · `capture_gaps` (P2) · `insight_runs` (P5). Field-level shapes for the session, gap, insight and answer work: §6.6.

### 6.5 Security basics
- Secrets in Secret Manager; one service account for `web` with only the permissions it needs; a separate invoker account for Cloud Scheduler (the internal routes require it as the OIDC issuer).
- PINs hashed (bcrypt/argon2) and staff sessions short (post-MVP 1; the PIN route is off in MVP 1); device tokens revocable. In MVP 1 a paired device can answer its own debrief questions without any PIN, so the answer route's debrief-window binding and per-device rate limit (§6.6.6) are the compensating controls. The answer's reason is refused when empty or over 500 characters and is name-scrubbed and SDP-redacted before storage; it never appears in logs or error bodies (4 Oct, MVP 1 final).
- No audio in cloud storage, logs or error reports (log sizes and IDs only).
- Every approval, rejection, override and verdict is written to `audit_log`.
- Demo project has an API quota cap and a daily token ceiling; live calls are rate-limited per IP.

### 6.6 Session, gap, insight and answer contracts (6 Oct 2026)

Normative. The rules these routes serve are in `docs/specs/technical-specification.md` §8; this section
fixes routes, bodies, status codes, document shapes and audit entries. All new collections live in the
Jakarta database; every document carries `outlet_id`; `outlet_id` and `device_id` come from verified claims
only, never from a body, header or path; document ids are built from claims. No document here has a field
that can hold a person's name, audio or unredacted text.

#### 6.6.1 Status convention (every device route below)
- A zod failure (bad path uuid, an extra field on a strict body, a wrong type) and a range or order failure
  both answer **422 `VALIDATION_ERROR`** (the repo's existing mapping). 400 `BAD_REQUEST` is only for a
  malformed request (unparseable JSON, a missing header). The answer route keeps its own 400 codes
  (§6.6.6), because the phone's cache treats a 400 as "remove the entry".
- No token → 401. A token of any non-device role (staff, supervisor, owner, judge) → 403.
- Every phone-side sender (outbox, pending discards, uploads) treats 400 and 422 the same: remove, log to the
  dev event log only, never retry.

#### 6.6.2 Outlet, device and config shapes
- `OutletSchema` gains, all optional so existing docs parse: `weekly_hours` (Mon to Sun, each `{ open, close }`
  `HH:MM` strict, or `null` for closed; validated as in the technical spec §8.2), `retention_days` (int 1-90,
  default 14), `insight_reminder_weekday` (`mon`…`sun`, default `fri`). `opening_time` / `closing_time` stay
  (fallback for old docs). `consent_complete` becomes `z.boolean().optional()`, legacy, never read.
- `DeviceSchema` gains `last_ended` (optional): `{ business_date: "YYYY-MM-DD", end_reason: "selesai" |
  "auto_stop" | "lost" | "discarded", ended_at_ms, debrief_ends_at_ms: number | null }` (strict). Written only
  inside the transaction that closes or discards a session of that device; set when absent or when
  `session.local_date >= last_ended.business_date` (an older date never overwrites a newer one); an idempotent
  repeat writes nothing. It lives on the **device**, never the outlet, so one device never blocks another.
- `GET /api/v1/capture/config` (device) response, strict: `{ timezone, weekly_hours (always resolved, never
  undefined), last_ended: { business_date, end_reason, debrief_ends_at_ms } | null }` read from
  `devices/{claims.device_id}`. No `consent_complete` key (a contract test asserts its absence). Deploy note:
  the old page bundle parses this strictly but only at mount, so deploy after that night's debrief ends and
  reload the phone before the next opening.
- `HeartbeatSchema` gains optional `session_id` (uuid | null), `queued_ms`, `oldest_queued_ms` (number | null),
  `answers_pending`, `answers_pending_oldest_date` (date | null). Heartbeats post only while the page is open
  and a session runs, the audio queue is non-empty, or the answer cache is non-empty.
- `SegmentSchema` gains `session_id: z.uuid().nullable().optional()` (null or absent = a pre-P1 bundle);
  `SegmentMetadataSchema` gains `session_id: z.uuid().optional()`. `ThreadSchema` gains `expires_at` (domain
  ISO, stored as a native Timestamp, like segments; P4).
- Collections constant gains `captureSessions: "capture_sessions"`, `captureGaps: "capture_gaps"`,
  `insightRuns: "insight_runs"`.

#### 6.6.3 `capture_sessions/{device_id}:{session_id}`
```ts
CaptureSessionSchema = z.object({
  outlet_id, device_id: z.string().min(1),
  session_id: z.uuid(),                       // crypto.randomUUID() on the phone
  started_at_ms: int >= 0,                    // device clock
  ended_at_ms: int >= 0 | null,               // stored as sent; coverage clamps it, the route never does
  end_reason: "selesai" | "lost" | "auto_stop" | "discarded" | null,
  auto_stop_at_ms: int >= 0,                  // server-computed at start, never from the body
  local_date: "YYYY-MM-DD",                   // server-computed at start, never recomputed
  debrief_ends_at_ms: int >= 0 | null (optional),  // set by the end transaction; null on discard
  received_start_at: ISO, received_end_at: ISO | null,
  cleanup_done_at_ms: int >= 0 | null (optional),  // only on discarded: null until Cancel-B cleanup ran
}).strict().refine(ended_at_ms === null || ended_at_ms >= started_at_ms)
```
No actor field (anyone at the shop taps Mulai / Selesai / cancel; who tapped is never recorded). No TTL in
MVP 1 (known gap). A service layer with an injected store interface keeps routes thin and is unit-tested
without Firestore.

**`POST /api/v1/capture/sessions`** (device). Strict body `{ session_id: uuid, started_at_ms: int >= 0 }`.
`started_at_ms` more than 5 min in the future (`START_FUTURE_TOLERANCE_MS`) or older than 7 days
(`START_MAX_AGE_MS`; exactly 7 days accepted) → 422. Transaction: existing doc → 200 unchanged (first write
wins; a tombstone is returned unchanged). Else create with `ended_at_ms: null`, `end_reason: null`, `local_date
= mulaiWindowDateOf(start) ?? businessDateOf(start)`, `auto_stop_at_ms = close(local_date) + 60 min` (falling
back to `started_at_ms + 60 min` when that is null or not after the start), `received_start_at: now`. A start
outside every Mulai window, on a closed weekday, or for a business date this device has already ended is **not
refused** (a pressed Mulai's capture is never thrown away): the route adds one audit entry
`capture.session_start_outside_window` or `capture.session_start_after_day_end` (`details: { local_date }`).
Response `{ data: { ok: true } }`. Audit `capture.session_start`.

**`POST /api/v1/capture/sessions/{session_id}/end`** (device). Path uuid (else 422). Strict body `{
started_at_ms, ended_at_ms, end_reason: "selesai" | "lost" | "auto_stop" }`; `ended_at_ms >= started_at_ms`
else 422. Transaction on the claims-device doc (IDOR-safe by construction): missing → create it (the start was
lost) with `local_date` and `auto_stop_at_ms` computed as above, then end it; already ended or a tombstone → 200
unchanged (never un-discarded). The same transaction sets `debrief_ends_at_ms` = `ended_at_ms + 60 min` for
`selesai` and `auto_stop`, `auto_stop_at_ms + 60 min` for `lost`, and writes `devices/{device_id}.last_ended`
(§6.6.2 rule). Audit `capture.session_end`, no details with names.

#### 6.6.4 Segment upload and a cancelled session
- The segment `PUT` gains an optional header `X-Session-Id` (uuid), read into the metadata and stored on the
  segment (`session_id: metadata.session_id ?? null`). Every P1 bundle sends it; pre-P1 bundles never do and
  have no cancel button. **Release gate:** the cancel button must not ship in any build whose segment write
  does not stamp `session_id` (otherwise a discard deletes 0 segments while telling staff "removed").
- The segment write is a transaction that reads `capture_sessions/{claims.device_id}:{session_id}` (the claims
  device, never the path or header). If it is a tombstone: write nothing, respond **200 `{ data: { discarded:
  true } }`** (the phone drops the item and never retries); transcription is skipped when the pre-transcribe
  read already sees the tombstone, and the audio is dropped in memory as always. If the session doc does not
  exist yet (late start), proceed normally.

#### 6.6.5 `POST /api/v1/capture/sessions/{session_id}/discard` (device)
- Path uuid (else 422). Strict body `{ started_at_ms: int >= 0, discarded_at_ms: int >= 0 }`;
  `discarded_at_ms >= started_at_ms`; each timestamp at most 5 min in the future and not older than **8 days**
  (`DISCARD_MAX_AGE_MS`; exactly 8 days accepted; one day longer than the start bound so an offline pending
  discard still lands); else 422. A body `device_id` → 422.
- Transaction on the claims-device doc: missing → create the tombstone directly (`local_date` and
  `auto_stop_at_ms` as in §6.6.3); open → set the tombstone (`end_reason: "discarded"`, `ended_at_ms =
  discarded_at_ms`, `debrief_ends_at_ms: null`, `cleanup_done_at_ms: null`); already discarded → no change;
  ended `selesai` / `auto_stop` / `lost` → **409 `{ error: { code: "session_ended" } }`**. The tombstone branch
  also writes `devices/{device_id}.last_ended` with `end_reason: "discarded"`, `debrief_ends_at_ms: null`, and
  **creates** the audit doc at the fixed id `audit_log/{device_id}:{session_id}:capture.session_discarded` in
  the same commit, with `details: { local_date, elapsed_ms (= discarded_at_ms − started_at_ms),
  segments_deleted: 0 }` (so tombstone and audit always exist together, at most one audit). The idempotent
  branch writes nothing.
- After the commit, on **every** call including retries: delete every `segments` doc with `device_id ==
  claims.device_id && session_id == session_id` in WriteBatches of at most 399 deletes + 1 audit update,
  where the update is `details.segments_deleted: FieldValue.increment(<deletes in this batch>)` (exact under any
  crash: a retry adds only what it actually deletes). Then delete the session's `capture_gaps`, and try Cancel-B
  once under the device's pipeline lock. The tombstone is committed first, so any later segment write is
  refused and any earlier one is found by the delete.
- Response **200 `{ data: { ok: true, cleanup: "done" } }`** or **202 `{ data: { ok: true, cleanup: "pending"
  } }`** when the lock was busy (the tick finishes it). The phone treats both as success.
- **Cancel-B** (rules: technical spec §8.9) increments `details.threads_deleted` / `details.questions_deleted`
  on the same fixed-id audit doc in the same batches that delete those docs, and sets the tombstone's
  `cleanup_done_at_ms` only after the last batch. The tick's query for pending cleanups: `device_id ==`,
  `end_reason == "discarded"`, `cleanup_done_at_ms == null` (dev-ops adds the composite index if Firestore
  asks). The gaps route counts any later entry whose `session_id` is a tombstone as `ignored` (never a 4xx).
- Store contract: the session transaction outcome may carry `fixed_audits: { id, entry }[]`, each written with
  `tx.create` in that transaction; `deleteSegments(key, audit_id)` deletes in batches as above and returns the
  number deleted by this call; there is no separate create-once audit path.
- The day record's cancelled-session count reads these audit entries (`action ===
  "capture.session_discarded"`, `details.local_date`): a count only, never who, never a start time.

#### 6.6.6 Debrief answer route: security contract (`POST /api/v1/questions/{id}/answer`)
Body, checks and order are in §2, §6.2 and `docs/tasks/R-07-ux-notes.md` §4b.2. In addition (security-reviewer
reviews this route on R-07, because it widens what a paired device can write):
1. **Auth:** `requireDevice` only; any other principal → 403 before the body is read. The PIN route stays 404.
2. **Scope:** load `questions/{question_id}`; 404 (no existence leak) unless `question.outlet_id ===
   claims.outlet_id` **and** `question.device_id === claims.device_id`.
3. **Debrief binding (the main compensating control):** accept only if `answered_at_ms` lies inside a debrief
   window of **this device** (`debrief_start_ms <= answered_at_ms <= debrief_ends_at_ms`, from its session docs or
   `devices/{device_id}.last_ended`), is not more than 5 min in the future (→ 400), is not older than 14 days (→
   400), and the question was open at `answered_at_ms` (now `open`, or `unverified` by that same debrief's
   expiry, which the answer then replaces).
4. **Stored fields:** the correction has `answer`, `reason_text` (scrubbed then redacted), `answered_device_id`,
   `answered_at_ms`, `received_at_ms`, `expires_at` (14-day rule): no `answered_by`, uid, staff id, name or PIN.
   The device id is never returned by a supervisor or owner route.
5. **Errors:** 400 codes `invalid_body`, `reason_empty`, `reason_too_long`; 503 `redaction_unavailable` (never a
   400 for a redaction failure, since a 400 makes the phone delete the entry). Logs carry `question_id`, the code
   and the length only.
6. **Idempotent and bounded:** upsert by `question_id`; a repeat returns 200 `already_answered` (the phone then
   removes the entry); which answer wins when two arrive for one question is R-07's choice, tested. A per-device
   rate limit (proposed 60 answers per 10 min) because the device token is long-lived.
7. **Audit:** one entry per accepted answer, `actor_role: "device"`, `action: "debrief.answer_uploaded"`,
   `target_id: question_id`, no text.
What it widens: a paired device writes answers with no PIN, and in wearable mode there may be several such
devices; it can already upload audio and end sessions; it still cannot read answers, names or another device's
questions.

#### 6.6.7 `capture_gaps/{device_id}:{gap_id}` and `POST /api/v1/capture/gaps` (P2)
```ts
CaptureGapSchema = z.object({
  outlet_id, device_id, gap_id: z.uuid(), session_id: z.uuid().nullable(),
  kind: "capture" | "upload",                 // derived on the server from category
  category: CAPTURE_GAP_CATEGORIES | UPLOAD_GAP_CATEGORIES,   // technical spec §8.13
  start_ms: int >= 0, end_ms: int >= 0 | null,
  detected_by: "live" | "recovered", received_at: ISO,
}).strict().refine(end_ms === null || end_ms >= start_ms).refine(kind matches category)
```
Route (device): body `{ entries: [...] }`, 1 to 50 entries, each strict `{ gap_id, session_id, category,
start_ms, end_ms, detected_by }` (a client-sent `kind` is rejected). Any timestamp more than 5 min in the future
or older than 8 days → 422 for the whole batch. Per entry, a transaction on the claims-device doc: missing →
create; stored `end_ms === null` and incoming `end_ms !== null` → set `end_ms` only; anything else (category or
start changed, end already set, or a tombstoned session) → keep the stored doc and count it `ignored`, never a
4xx (outbox replays must be safe). Response `{ data: { written, ignored } }`. No TTL in MVP 1 (known gap).

#### 6.6.8 Insight runs (P5)
```ts
SUFFICIENCY_RULES = ["range_valid","data_settled","min_days","coverage","evidence","staff_answers"]
DAY_REASONS = ["closed_day","day_off","not_started","low_coverage","no_facts","in_progress","unsettled"]
SufficiencyDay = { local_date, planned_minutes, covered_minutes, coverage_source: "sessions" |
  "heartbeats_legacy" | "none", capture_gap_minutes, fact_threads, questions, answered_questions, qualifies,
  reasons: DAY_REASONS[] }                    // strict
SufficiencyResult = { version: "suff-v1", passed, rules: { rule, passed, value, threshold }[], days }
InsightRunSchema = z.object({
  outlet_id, run_id,                          // = doc id = "{outlet_id}:{from}:{to}", the idempotency key
  requested_by_role: "owner" | "supervisor",  // first caller's role; never a uid or email
  from_date, to_date,                         // business dates
  requested_at_ms, sufficiency: SufficiencyResult,
  status: "running" | "insufficient" | "awaiting_agent" | "proposed" | "no_proposal" | "failed",
  proposal_id: string | null,
  lease_until_ms: int | null, lease_token: uuid | null,   // only while running; the token guards the finishing write
  request_count: int >= 1, failed_attempts: int >= 0, updated_at_ms,
}).strict()
```
- **`POST /api/v1/insights/runs`** (supervisor or owner of the outlet, `requirePermission`; device or staff →
  403; another outlet → 403). Body `{ from_date, to_date }`. One transaction on
  `insight_runs/{claims.outlet_id}:{from}:{to}`:
  1. missing → create `running` with a 5-min lease and a new token, `request_count: 1`, `failed_attempts: 0`;
     commit; evaluate sufficiency (and the agent if passed) outside the transaction; finish with an update that
     applies only if the token still matches; **201** `{ data: { run, reused: false } }`;
  2. `running`, lease live → **409 `run_in_progress`** with the run (the UI shows processing and polls GET every
     5 s);
  3. `running`, lease expired → reclaim with a new lease and token, `request_count += 1`, continue as 1; 200,
     `reused: false`;
  4. `proposed` or `no_proposal` → stored run, `request_count += 1`, no re-check, no model call; 200, `reused:
     true`;
  5. `awaiting_agent` → if R-08 is wired, claim a lease and call the agent once, else as 4;
  6. `insufficient` → re-evaluate sufficiency in place (plain code, no model call), overwrite it, continue to the
     agent under a lease if it now passes; `request_count += 1`; 200, `reused: true` (same doc, not a second run);
  7. `failed` → retry in place under a lease while `failed_attempts < 3`; at 3 → **409 `retry_limit`**.
  Invariants (tested): at most one agent call in flight and at most one `proposal_id` per key, ever; supervisor
  and owner share the key. **Overlapping ranges are separate keys and separate runs**; no overlap check exists and
  none may be added. `awaiting_agent` lets P5 ship before R-08.
- **`GET /api/v1/insights/runs?limit=10`** (same roles): runs plus `reminder_due` = the weekday of today's
  business date equals `insight_reminder_weekday ?? "fri"` and no run has `requested_at` in the last 6 local
  days. No scheduler, no model call.
- Privacy: counts, dates, enums; no text.

#### 6.6.9 Audit actions added
`capture.session_start`, `capture.session_end`, `capture.session_start_outside_window`,
`capture.session_start_after_day_end`, `capture.session_discarded` (fixed id, counts only),
`debrief.answer_uploaded`, `consent.revoked_data_removed` (manual revocation; target = outlet + date range;
roles only). Every entry: `actor_role`, a target id, and counts, dates or enums only; never a name, text or audio.

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

**Effect of Q-D on the design:** answers, corrections and audit entries store `answered_by: staff` (role only). *(4 Oct, late: answers and corrections now store no role at all, only the device id and timestamps; audit entries keep the principal's role.)* The audit log records the device, not the person. MVP 1 (4 Oct, §2a): there is no staff sign-in, so names route nothing; they are used only for the staff-name scrub and the custom vocabulary. The device id stored with an answer is never shown to supervisors or owners. (Post-MVP 1: names also route a question to the right signed-in person.)

## 9. Where each part is built (R-IDs from the plan)

| Part of this spec | Task | Date |
|---|---|---|
| Projects, probe, repo, deploy (§6.1) | R-01 | Wed 30 Sep |
| Data model, email + password (accounts created by an admin provisioning script; no self sign-up), roles, seed script, pairing, staff PIN (§2, §3, §6.4; staff PIN built but dormant in MVP 1, §2a) | R-02 | Thu 1 – Fri 2 (done) |
| Capture page (§4.1, §5) | R-03 | Fri 2 – Sat 3 |
| Segment API + Transcribe + redaction (§6.2, §6.3) | R-04 | Sun 4 |
| Mulai/Selesai sessions + hard auto-stop (§4.1) | capture phase plan P1 | Sun 4 – Mon 5 (pilot go-live planned Mon 12; postponed 9 Oct, no new date) |
| Day record screens (§4.3, §4.4) | R-06 | Tue 6 |
| Debrief on a paired device, tap, no sign-in; mode label; PIN route off (§2a, §4.2) | R-07 | Wed 7 |
| Approval screens (§4.3, §4.4) | R-09 | Fri 9 – Sat 10 |
| Staff debrief, voice (§4.2) | R-16 | If time (v5) |
| Demo outlet + "Try as…" (§4.5) | R-12 | Wed 14 |
| Encrypted queue, settings screens, cost tile, re-run live, tour, CSV uploads | P1 | If time |

## Sources (checked 29 Sept 2026)
- Gemini audio understanding (transcription is a listed use; inline ≤ 20 MB; WebM/Opus supported): https://ai.google.dev/gemini-api/docs/audio
- Gemini 3.1 Flash-Lite model page ("improved audio-input quality for tasks like ASR"): https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-flash-lite
- Gemini 3.5 Transcribe (custom vocabulary ≤ 1,000 terms, best ≤ 100; not combinable with diarization or timestamps; verbatim vs smart): https://ai.google.dev/gemini-api/docs/transcribe
- Transcribe pricing on Agent Platform (~$0.0051 per audio minute, sync): https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing

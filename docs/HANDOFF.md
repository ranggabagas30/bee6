# HANDOFF — read this first (updated Sat 3 Oct 2026, late session)

Loaded automatically at session start by a hook. The PM updates it at the end of every work session
and after every merge (`CLAUDE.md` §10 rule 9). Keep it short and current; history lives in git, plans
in `docs/tasks/`, decisions in memory and `docs/`.

## Where we are
- **Demo project (`bee6-playground`) is live and wired.** Cloud Run `web` at
  https://web-33uzb53tza-et.a.run.app (revision built from `main` at `2f07781`, includes PR #9 and #10).
  Timeout 1800s, env vars `PIPELINE_TICK_AUDIENCE` and `TASKS_INVOKER_SA` set, `tasks-invoker` and
  `allUsers` have `run.invoker`. Cloud Scheduler job `pipeline-tick` (every 2 min, OIDC as
  `tasks-invoker`, audience = tick route URL) is ENABLED. First tick returned 200. Response body not yet
  confirmed. Health `/api/health` returns 200. Tick route with no token returns 401 (fails closed).
- **Pilot project (`project-a10437b4-b198-402e-97e`) is NOT deployed yet.** Same steps as demo still
  to do: Cloud Build trigger, service URL, timeout, env vars, invoker bindings, Scheduler job. Note the
  Cloud Build trigger wiring that worked on demo: 2nd-gen connection `bee6-github`, repository `bee6`,
  Console trigger with the compute default SA. Pilot go-live is Monday 5 Oct.
- **PR #9** (R-05b PR2, tick route) MERGED. **PR #10** (cloudbuild deploy image path) MERGED.
- **Pending merges / branches:**
  - `feat/capture-bilingual-copy` (d9f5d1f) and the bilingual follow-ups (`944b732` and the
    worktree branches). Superseded by `feat/capture-live-state-truth`. Do not merge the older ones alone.
  - `feat/capture-live-state-truth` (4 commits, from 944b732): neutral "not started" banner, offline
    state says listening with uploads waiting, numeric HTTP status on the upload event. Review round 1:
    tech-lead CHANGES REQUESTED. Open finding: a stopped session's late status callback can overwrite
    the next session's status (dev path), showing a false "Listening" or a stale waiting count. Fix: a
    per-session generation guard, plus a test. Minor: show "Server busy" only for a real server error,
    not for a network failure. QA browser verdict on this commit was still pending at handoff.
  - Still unverified: `npm run build` in the feature worktree (no node_modules there). Needs
    `npm ci --ignore-scripts` in that worktree, or a run from a checkout with deps.
- **Copy and wording still needing your sign-off in the product:** "Belum mulai / Not started",
  "Pengambilan audio belum berjalan", "Server sibuk, mencoba lagi", the "·" separator in the offline
  headline, and the reading "Mendengarkan toko" for the page title. Also the mic line is now one line,
  "Mikrofon / Microphone: <source>", with the value untranslated.
- **Privacy line (approved by Proofed, final):** "Suara diubah jadi catatan kerja singkat. Rekaman suara
  tidak disimpan." / "Speech becomes short work notes. Audio is not kept." Proofed knows that redacted
  transcript is kept for debugging and audit only for now.

## Product direction decided (Rangga, 3 Oct) — supersedes automatic hours gating
- **Manual session boundaries:** staff press Mulai (start of work, before opening, for prep) and Selesai
  (operations ended, ready for debrief). No automatic start or stop by opening hours.
- **Opening hours per day** (Mon–Sun, from Google Maps as reference, entered manually). Used only as
  checkpoints: "opening time, no session started" and "closing time, session still running".
- **Offline-first:** encrypted on-device audio queue is allowed. Gap ledger records any interruption
  (device off, reboot, battery, call, network, server error, mic lost) with timestamps and category only.
- **Redacted work text retention:** 14 days default, customizable later (storage allocation).
- **Insights:** on-demand button over a chosen date range, from saved redacted text. Weekly proposal is a
  reminder only and runs a plain-code sufficiency check first; proposes only on sufficient evidence.
- **Provider abstraction:** after MVP 1, not now.
- **Open, must be confirmed before planning:** (a) the approved privacy line says "Audio is not kept",
  which an encrypted on-device audio queue contradicts. Proofed's consent and the DPIA need to cover the
  new wording. (b) Mulai/Selesai on the live pilot phone before Monday 5 Oct changes the capture path that
  is running now. Decide whether it lands before go-live or after it is verified.
- Docs to correct: `docs/specs/web-backend-rbac.md:103`, `docs/specs/pipeline-and-agents.md:16`,
  `docs/specs/technical-specification.md:54`, `docs/backlog.md` T-101 and the closing-time trigger.

## In flight at compaction (4 Oct, late)
- **P1 build** on branch `feat/prod-01-p1` (stacked on `feat/capture-live-state-truth-r2`). Done: mic-label
  fix, consent-gate removal, weekly-hours schema. Next, in order: calendar.ts + tests, session-state.ts,
  session routes, the page (Mulai/Selesai), Cancel-A, then the 30 s checkpoint and DevPanel readouts.
  Do NOT deploy this branch yet; the page still auto-starts from the clock. Do NOT merge until the
  status-truth branch passes review (page files overlap).
- **Status-truth branch** `feat/capture-live-state-truth-r2`: QA DO-NOT-SHIP earlier for the mic label
  (now fixed on the P1 branch). Needs tech-lead and QA re-review before it merges.
- **Upload-toast branch** `feat/capture-upload-toast` (a96121e): tech-lead CHANGES REQUESTED, one fix
  (use pointer events, pause on mouse only). QA browser verdict pending.
- **Spec corrections approved, not yet applied:** fix the two hours-validation examples in the revised technical spec §8 (PROD-01 is removed, 6 Oct)
  (the 20:00–02:00 example is impossible; the 03:00–06:30 example fails the 4 h rule, not the other one).
- **Seed:** keep the loader tolerant of `consent_complete` until the private seed file is cleaned, then
  make it strict before the Sun 11 deploy (Rangga to clean the private file).
- **Consent text test:** keep the negative check (no consent text on the capture page).
- **CLAUDE.md** edits applied: §2 rule 7 and 7b, §3 auth, §5 seed comment, §8 capture and consent lines.

## Approved plan (Rangga, latest)
- **Plan v5 approved:** `docs/plan.md` (PROD-01 removed 6 Oct; its rules moved into the revised docs).
  Sprint load 92% accepted, cut order R-15, then R-10 as a plain list, then P5.
- **R-16 (voice debrief) moves to "if time"**, Rangga confirmed.
- **Sufficiency thresholds confirmed:** 3 days, 60% coverage, 2 facts on 2 dates, at least 1 day with answers.
- **Revocation response time:** within 7 working days (Rangga confirmed).
- **Business day:** work is counted by the session's business date. A session started Wednesday that
  closes Thursday 01:00 belongs to Wednesday. Confirmed.
- **Revocation:** acknowledgement and complete removal are both within 7 working days. Confirmed.
- **Cancel button (new, Rangga):** staff can discard a running session that was started by mistake.
  Allowed at any time while the session is running, with a two-step confirmation. Semantics in the plan.
- **Mulai eligibility (Rangga):** once a business day has ended (Selesai or auto-stop), its Mulai is not
  offered again. The next business day's Mulai is offered only from 01:00 the calendar day after the
  ended business day's date, never earlier, even if the shop's previous close was 21:00 or 22:00.
- **Answer decisions approved (Rangga, 4 Oct):** (1) the headline is "Sekitar pukul HH:MM ada <langkah>.
  Benar?" and the SOP question moves into the reason label after YES ("Sudah sesuai SOP? Kalau belum, kenapa?"),
  with "Kenapa tidak?" after NO; (2) the reason is required on YES and on NO; (3) NO on a sensitive category
  (complaint, correction, safety, security, disruption) excludes that thread like any other NO. Sprint load
  is 82.75 of 84 h (99%). R-07 is 4.75 h.
- **Debrief answer shape for MVP 1 (Rangga, 4 Oct, final, supersedes the free-text-only shape):** the
  answer is YES / NO with a required reason. Yes confirms the thread's category; No rejects it (the existing
  `staff_rejected` gate branch). The reason is required, redacted and name-scrubbed, capped at 500 characters.
  Free text revising the category is post-MVP 1 (too hard for now). Lewati (skip) and the other decisions
  from the previous note stand.
- **Debrief answer shape (Rangga, 4 Oct, earlier):** a debrief answer is a free-text WHY explanation, not a
  yes/no. Staff explain why the SOP step was or was not implemented properly. Redaction and the name scrub
  run on it before storage; add a length cap. Supervisors do NOT answer device questions (no). A fully
  answered debrief does NOT release Mulai early: the full 1 h timeout applies (no, for simplicity).
- **Mulai and previous debrief (Rangga, 4 Oct, final, supersedes D2 and D2a):** Mulai is NOT shown until
  the previous business day's debrief is completed within its timeout, UNLESS the previous day is an
  off-day (weekend or weekday off). Reading A confirmed.
- **No undo (Q28):** accepted for MVP 1.
- **Multi-device (Rangga, 4 Oct, final):** sessions can start simultaneously on multiple devices in the
  outlet, and each device runs its own debrief. Debrief expiry is per DEVICE, not per outlet. Each device's
  answers are uploaded and merged later, so the system can generate comprehensive insights from all devices.
- **Debrief questions are role-agnostic (Rangga, 4 Oct, final):** a question does not depend on who
  answers it. It asks whether the SOP was implemented properly, and if not, why.
- **Sign-in and consent (Rangga, 4 Oct, final):** owner and supervisor keep Google sign-in. Staff need no
  sign-in. Consent is NOT collected inside the app; it is covered by the paper contract between bee6 and
  Proofed. bee6 emails the consent and the updated privacy policy and TnC to all users. The in-app
  consent gate (consent_complete, the "no consent" view) is removed from MVP 1.
- **MVP 1 device model (Rangga, 4 Oct, final):** staff sign-in (name + PIN) is NOT needed for MVP 1.
  Staff only pair the device with the system. The system does not distinguish a shop device from a staff
  phone; it tracks the device id only. The session runs uniformly regardless of mode or device. Mode is
  derived: exactly one paired device = "room mode"; more than one = "wearable mode". This supersedes the
  staff-PIN sign-in in the earlier device model and touches R-07, the RBAC table, and CLAUDE.md §2 rule 7
  (staff identity on debrief answers). Roles and no-names rules still stand for stored data.
- **Decisions D1–D5 (Rangga, 4 Oct, final):**
  - D1: Selesai shows at start + 4 h (the minimum opening duration), not at close. Example: Mulai 01:00
    shows Selesai about 05:00; Mulai 21:00 shows Selesai at 01:00. Cancel is allowed until close is triggered.
  - D2: Mulai is always shown from 01:00, even if the previous day's debrief does not exist.
  - D3: every open question expires at the end of the debrief.
  - D4: no Mulai at all on closed weekdays.
  - D5: the paired shop phone itself uploads the cached debrief answers.
- **Session model (Rangga, final):**
  - Mulai window for business day D: from 01:00 on D until (close − 4 h) on D. Close time is a const 4 h
    minimum opening assumption. Mulai allowed during the closing hour.
  - No Mulai by the window end = off-day.
  - Maximum close setting: 01:00 (next day). Auto-stop is 1 h after close, so max 02:00.
  - Selesai shows at close time; auto-stop at the latest at close + 1 h.
  - Debrief starts after Selesai or auto-stop. It lasts 1 h from its start, regardless of activity.
    Answers tapped are saved first; unanswered questions expire as unverified.
  - Interrupted debrief resumes from its original start; a reload cannot extend it.
  - Answer cache on the phone: kept until uploaded, then removed; in any case removed after 14 days
    (accepted loss if offline longer). Roles only, no names.
  - Next business day's Mulai is offered from the later of 01:00 on D+1 and the end of D's debrief.
    If D's debrief ends at 03:00 Thu, Mulai shows on Thu and marks Thu's session (D+1) running.
  - Business-day boundary is 01:00: a Mulai at 01:30 belongs to the day that opened at 01:00.

## Decisions (Rangga, latest) no change needed; the test-outlet hours stay as they are.
- **Debrief:** assumed around 01:00 to 02:00 after closing; adjustable.
- **Test outlet:** uses the same past-midnight hours (09:30 to 01:00), adjustable freely.
- **Off-hours Mulai:** no 1-hour cap. Rangga corrected this; the earlier "1 hour" wording is void.
- **Written sign-off:** Rangga's signature alone.
- **Internal testing:** test outlet in the pilot project.
- **Pilot review:** Wed 21 Oct, after submission.
- **Long off-hours run accepted** (Mulai at Sat 23:30 runs to Mon 23:00 unless Selesai is tapped).
- **Proofed hours (private seed, not in the public repo):** Mon–Sun 09:30 to 01:00 the next day. Closing
  crosses midnight: the hard auto-stop is 02:00 the next day. Plan must confirm midnight handling.
- **Upload-line copy (sample, PM-generated, Rangga will supply final copy later if available):**
  - Uploading: "Mengunggah / Uploading"
  - Retrying: "Gagal unggah, coba ulang (1x) / Upload failed, retrying (1x)", counting up (2x, 3x)
  - Skipped: "Gagal unggah, dilewati / Upload failed, skipped"
  - Succeeded: "Unggah berhasil / Upload succeeded"
  - Hints: "Server sibuk / Server busy", "Hubungi supervisor / Contact supervisor"

## Decisions (Rangga, latest)
- **Pilot go-live postponed from Mon 5 Oct to Mon 12 Oct** (Owner not ready). Time for adjustment and
  internal testing by Tiffany and Rangga. Plan and sprint schedule must be re-dated accordingly.
- **Proofed "informed" is only a verbal ack, not sign-off.** Live testing on the pilot still needs Rangga's
  formal sign-off. The encrypted on-device queue (P3) is NOT enabled on the pilot until that sign-off.
- **Overlapping insight date ranges are allowed as separate runs.**
- **Off-hours Mulai:** a session started outside the planned window runs for at most 1 hour, then stops
  automatically. Explain this clearly in the plan (what staff see, why it is bounded).
- **Holiday / closed day:** if nobody presses Mulai before the stop time, the day is treated as off or
  closed. No gap alarm for that day.
- **Consent revocation is NOT handled in-session.** A revocation request goes to Rangga or Tiffany, who
  stop capture and remove the data manually for now.

## Decisions (Rangga, 3 Oct, final)
- **Listening vs upload are separate:** green "Listening" means capture is running and audio will be
  kept, regardless of upload result. Add a separate upload status in every mode: "Mengunggah / Uploading",
  "Gagal unggah, coba ulang (1x) / Upload failed, retrying (1x)", "Unggah berhasil / Upload succeeded".
- **Mulai/Selesai goes ahead.** Go-live trial is realistic at 10:00, after 08:00 opening, because staff
  are not ready at opening. Sprint plan to be adjusted with known risks.
- **Hard auto-stop:** Selesai is forced 1 hour after the set closing time, by default.
- **Insights:** supervisor and owner can run them; runs are idempotent (no duplicate run for the same range).
- **Reminder timing:** the plan must explain exactly how reminders work.
- **Privacy wording:** generated in the plan (§12), Proofed informed of TnC changes.

## Accepted risks (Rangga, explicit, 3 Oct)
- **Silent green banner on a 401 (revoked or re-paired device):** the shop phone can show
  "Mendengarkan / Listening" while every segment is discarded. Accepted for the Monday pilot. Revisit
  after go-live: the engine status must reflect dropped uploads, and the supervisor view should alert
  when a device has heartbeats but no new segments.

## Planned, not built
- **UX-02 auth and navigation plan**: `docs/tasks/UX-02-auth-nav-refinement.md`. PR-A (sign-in,
  session cookie, gated owner and supervisor pages) can start after go-live. PR-B (gating `/capture`
  for the shop phone, device session upgrade) waits until Monday's go-live is verified on the real phone.
  Open questions for Rangga remain: session length (7 days proposed for pilot), the paired-phone landing
  on `/`, the placeholder `/today` before R-06, public landing names (proposed: "by GATI" yes, Proofed no),
  and timing of PR-B.
- **TSD rewritten** to the standard template: `docs/specs/technical-specification.md` (379 lines, concept
  level, uncommitted per the docs commit rule). The old 952-line code-level version was never in git;
  a copy is at `/tmp/bee6-technical-specification-v1-code-level-2026-10-03.md`, which can be cleared.
  Decision needed: where the old version lives durably. Repoint references in `docs/tasks/R-05b.md`,
  `docs/specs/pipeline-and-agents.md`, and `docs/tasks/R-03-fixes.md`.
- **Deferred, tracked in `docs/tasks/R-05b.md`:** R-06/R-07 must switch the `q_thread_*` question write
  off blind `tx.set`, so an answered question is not reopened on merge.
- **Known gaps for the README/known-gaps list:** the scheduled tick's worst-case lease is 30 minutes;
  the ledger has no TTL (pilot scale acceptable); the staff-name scrub on long-lived thread text is still
  planned; the daily token ceiling enforcement is not built.

## Process and team rules (3 Oct)
- **Always dispatch dev-ops for any gcloud, IAM, or infra diagnosis or fix.** The PM does not troubleshoot
  infra in chat (CLAUDE.md §10 rule 1, memory `feedback_always_dispatch_devops_infra`).
- **tech-lead owns the deep implementation plan** (`docs/tasks/R-xx.md`). Developers follow it literally.
  developer-junior (haiku) is for mechanical slices only.
- **Browser testing split:** Playwright (scripted, headless) for repeatable checks; Claude in Chrome
  (extension, interactive) for exploratory or real-profile checks. QA loads browser tools via ToolSearch
  first; the extension was verified working on 3 Oct (one browser connected).
- **Truthful UI rule (Rangga, 3 Oct):** any label must match real system state. "Listening" means capture
  is running. "Offline" must never hide that listening continues.
- **Cost:** `/usage` on 3 Oct showed sonnet-driven subagents were the largest line item (developer 24%),
  and long sessions (>150k context) drove most spend. PM compacts at logical breakpoints, not at capacity.

## Waiting on Rangga
1. Decide on the status-truth fix round: confirm the two wording items above, and say whether to ship the
   branch before Monday.
2. Pilot deployment: the same steps as demo, run through dev-ops on your go-ahead.
3. Answers to the UX-02 open questions (session length, landing, `/today` placeholder, names, PR-B timing).
4. Where the old TSD copy lives durably, and approval to repoint the three references.
5. `npm run build` in the feature worktree, or approval for dev-ops to run it there.

## Next actions
1. QA's browser verdict on `feat/capture-live-state-truth` lands. Then the fix round: the generation
   guard, plus the "Server busy" wording fix, both with tests. Tech-lead and QA re-check.
2. Pilot go-live: dev-ops runs the pilot setup on your go-ahead, same steps as demo.
3. After go-live is verified on the real phone: PR-A of the UX-02 auth plan.

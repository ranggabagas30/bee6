# R-18 Official role sign-in, demo credentials, staff script drawer: spec + implementation plan

Status: **PLAN v1, tech-lead, Sun 11 Oct 2026. Nothing is built. Design pass only.** It records Rangga's two final
decisions of 11 Oct: (D-1) the judge's trial never starts from empty data. The judge's live speech is **added to** the
seeded template history (2 earlier fictional days). The proposal must be possible from the seeded history alone, and
the evidence gate is never lowered or bypassed. (D-2) Each use of a demo sign-in code mints a fresh **private**
sandbox through the R-12 machinery. There are never shared accounts. §11 lists the open questions. After that comes
Rangga's "go", then the PM's edge-case brainstorm (permutations and missing branches only).

> **For agentic workers:** this file is the spec and the plan in one (same convention as `R-10.md`, `R-12.md`).
> Execute it task by task, literally (`superpowers:executing-plans` or `superpowers:subagent-driven-development`, plus
> `superpowers:test-driven-development`). Steps use `- [ ]`. **If the plan is silent or looks wrong against the real
> code, stop and flag it to tech-lead. Do not improvise** (CLAUDE.md §10 rule 11).

**Base and branch.** The code citations come from `origin/develop` @ `2cbe4db` (R-12 PR-A and its hardening are merged)
and from `feature/r12-demo-ui` @ `0116d28` (R-12 PR-B: Landing, DemoBar, demo-client, sign-in link; **in review, not
merged**). **R-18 P1 must start only after R-12 PR-B merges** (it edits `Landing.tsx`, `SignInScreen.tsx`, `app/page.tsx`
and `lib/i18n/dict.ts` from that PR; the stacking rule in memory `feedback_merge_hold_stale_pr`). P0 has no UI and can
start now. Use fresh worktrees off the then-current `origin/develop`, for example
`git worktree add ../bee6-r18-p0 -b feature/r18-clone-shift origin/develop`. `gh pr create --base develop`. Never
target `main`. Never switch refs in the shared checkout.

**Sources this plan argues from:** CLAUDE.md §1, §2, §3; technical spec §8 (Mulai/Selesai, auto-stop at close + 1 h,
a debrief of 1 h from Selesai or the auto-stop, P1/P3/P4); `R-12.md` (sandbox, clone, re-arm, caps, Q-2 "simulated
timing", Q-5 template days, Q-8 flat fast-forward); `DEV-03-fast-day.md` §1.3–§1.5 (fast-day knobs and real
question latency; DEV-03 is **not built**); `DEV-05-dev-role-sign-in.md` §3 (custom-token design);
`R-SOP-sample-fit.md` (the 5-step placeholder SOP stays until the full one lands); `UX-03-journey-design.md` (capture
copy, 360 px). **Not read:** the published judge guide (`<PRIVATE_DESIGN_LINK>`) and the clip script
page (`<PRIVATE_DESIGN_LINK>`). This subagent has no docs-connector tool. §9.4 lists the changes
those pages need, written from the design. The PM must diff them against the live pages.

**Skills to load:** `superpowers:test-driven-development`, `react-patterns`, `frontend-a11y`, `react-testing`,
`nextjs-turbopack` (verify `redirect()` and `connection()` against `node_modules/next/dist/docs/`), `ux-copy` (EN/ID
copy), `api-design` (P2 config field), `error-handling`. Never `claude-api`. **security-reviewer: on demand for P1**
(it adds a public credential and the pairing-code exclusion). It is **not** needed for P2 unless the optional fast lane
(P3-a) is built. That lane is a new device-authenticated route that runs model calls.

---

## 0. Findings and blockers (read first)

Each finding below was checked against the real code. Items 1–4 are defects or blockers that hold **whether or not**
R-18 is built. Items 1 and 2 break the R-12 judge path as it is designed today.

1. **The template's absolute dates age out of the judging window (R-12 defect, blocking for C).** The template is
   seeded once, with days at offsets −3…−1 from the seeding day (`scripts/demo-seed-template.ts` `DaySchema`). The
   clone copies every timestamp and date unchanged (`lib/demo/clone.ts`: only ids and the D-debrief fields change).
   Judges arrive 19 Oct – 6 Nov. Two consequences:
   - `/proposals` defaults its range to the last 7 days (`app/proposals/ProposalsApp.tsx:75`,
     `addDays(today, -6)`). About 7 days after seeding, the default range no longer contains any template day, so
     Generate returns the "not enough evidence" follow-up and **no proposal**.
   - `validateRange` refuses any `from_date` older than `today − (retention_days − 1)` (`lib/proposals/range.ts`,
     default 14). About 14 days after seeding, the template days **cannot be selected at all**. A seed on ~16 Oct
     means that every judge after ~29 Oct gets no proposal by any path.
   **Fix (P0, Task 1):** the clone shifts the whole template by a whole number of days, so its last day lands on
   *yesterday's business date* for the sandbox. This changes timing only; it never changes a label, a summary or a
   gate decision. Disclose it the same way R-12 Q-2 discloses the re-armed debrief ("simulated timing"). Rangga must
   confirm it (§11 Q-1).
2. **R-12's re-armed debrief blocks Mulai for the first hour of every sandbox (blocking for B).** The clone sets
   `last_ended.debrief_ends_at_ms = now + 1 h` (`clone.ts`, judge device). `mulaiAvailability` returns
   `debrief_running` while that holds (`lib/capture/calendar.ts` `mulaiAvailability`), and a fully answered debrief
   does not release Mulai early (Rangga, 4 Oct). So "Staff: tap Mulai and speak" cannot happen in a fresh sandbox.
   **Fix (P2, Task 6):** in R-18 the clone stops opening a debrief at creation. It *carries over* at most 2 of the
   template's expired questions so that the judge's own debrief (opened at their Finish) has content at once. §1.4
   gives the exact mechanism.
3. **The Mulai window excludes the US morning (blocking for B).** The template outlet has hours 07:00–21:45
   `Asia/Jakarta` (`scripts/seed.ts` `DEMO_SEED`). The Mulai window is `[01:00, close − 4 h]` = 01:00–17:45 WIB
   (`mulaiWindowFor`). Between 17:45 and 01:00 WIB (10:45–18:00 UTC, about 03:45–11:00 US Pacific), the page shows
   `window_passed` and offers no Mulai. Selesai appears only at `min(start + 4 h, close)` (`selesaiFromMs`), and the
   auto-stop comes at close + 1 h. None of this fits a 4-minute session. **Fix (P2, Tasks 7–8):** a server-derived
   *demo session profile* that only sandbox devices receive. Pilot behaviour is unchanged (§1.3).
4. **The published staff code `000000` can be a real pairing code (hard-rule risk, P0).**
   `generatePairingCode()` = `randomInt(0, 1_000_000)` padded (`lib/auth/pairing.ts:21`). If the pilot ever draws
   `000000`, anyone who types the published demo code on the pilot URL within its 10-minute life pairs a device **into
   the real shop**. That device could upload audio and read debrief questions. **Fix (P0, Task 2):** never generate a
   reserved code. Defense in depth: the pair route refuses a reserved code before any lookup.
5. **The debrief does not refresh.** `DebriefFlow` fetches once on open (`app/capture/debrief/DebriefFlow.tsx`, "fetch
   on mount"). The judge's own moments become questions about 2–4 min after their last word (item 7), but the debrief
   opens at the Finish tap. Without the carry-over (item 2) and a refresh, the judge's debrief is empty. **Fix (P2,
   Task 10):** a "Check for new questions" button on the debrief, plus an auto-refresh every 20 s while the debrief is
   open on a sandbox device.
6. **Proposal from the seeded history alone is not guaranteed by code today.** The floor is plain code: at least 2
   candidates on at least 2 dates (`lib/proposals/precheck.ts`, `MIN_EVIDENCE_FACTS/DATES = 2`). A candidate must have
   `status: "fact"`, must not be excluded, must not be supervisor-rejected and must not be NON_WORK
   (`lib/proposals/candidates.ts`). The template's questions all expired unanswered (`unverified`), so the template's
   facts are **only** the threads the gate passed automatically: categories ROUTINE_OPS, CUSTOMER_SERVICE,
   STAFF_CONSULT, TRAINING and EVENT at confidence ≥ 0.9 with evidence and no conflict (`lib/pipeline/categories.ts`,
   `gate.ts`). R-12's design leaned on the judge answering re-armed questions to create the facts. With D-1, that
   cannot be relied on. **Fix (P0, Task 3):** the template seeding run must end with a *readiness check* (same
   `selectCandidates` + `checkEvidenceFloor` code, over the template's own days, with zero answers). If it fails, the
   remedy is the real product path, never a lower floor: Rangga, signed in as the template's supervisor, confirms
   threads on `/day` through `POST /api/v1/threads/{id}/confirm` (gate v3 `supervisor_confirmed`). The clone then
   carries those facts into every sandbox.
7. **End-to-end latency for live speech, from code (C):**

   | Stage | Code | Time |
   |---|---|---|
   | VAD segment closes (silence or 15 s cap) → Opus → `PUT /api/v1/segments` | `lib/capture/browser/engine.ts`, contract 15 s | 0–15 s after the words |
   | Synchronous transcription (`gemini-3.5-transcribe-preview`, `global`) + SDP redaction + write | `lib/capture/segment-service.ts` | about 3–8 s per segment (measure) |
   | Window closes: 90 s of silence after the last line, or the 6-min cap | `lib/pipeline/windowing.ts` (`silence 90_000`, `cap 360_000`) | **+90 s** after the last word |
   | A window with < 10 s of speech waits for its 3-min block to end | DEV-03 §1.4 | +0–180 s (tiny bursts only) |
   | Next Cloud Scheduler tick (`*/2`) | deployed job | +0–120 s |
   | Label call (`gemini-3.5-flash-lite`), gate, thread + question write; devices are processed **sequentially** | `lib/pipeline/tick/service.ts` `runTick` loop | about 5–20 s per unit (×3 on retries) |

   **Estimate after the last spoken word:** about 2 min typical, 3.5–4 min worst case for a normal script read with
   short pauses (one window). A script with pauses longer than 90 s splits into small windows, and tiny ones add up
   to 3 min more. Several judges at the same moment queue behind each other in the sequential tick.
   **Consequence:** the live moments reach `/day` while the judge is answering the debrief or switching to
   Supervisor. That is acceptable under D-1 because nothing waits on them. §7 gives the QA measurement plan.
8. **Today's sign-in surfaces (reconciled):** `/sign-in` is email + password for owner/supervisor
   (`app/sign-in/SignInScreen.tsx`, `signInWithEmailAndPassword` → `POST /api/v1/auth/session`; accounts come from
   `scripts/provision-web-user.ts`, no self sign-up). `/pair` is the shop phone's 6-digit code → `POST
   /api/v1/devices/pair` → long-lived device token in `localStorage` (`bee6.device_token`, `bee6.device_id`). `/` is
   a scaffold on the pilot ("scaffold in progress") and the judge Landing ("Try as Staff / Supervisor / Owner") in
   demo mode (PR-B). The DemoBar switches role inside the same sandbox through `sandbox_key`. Role and outlet always
   come from verified claims or the device doc (`requireClaims`, `requireDevice`). Nothing in R-18 changes that.
9. **Cross-device continuity does not exist.** The sandbox key lives in the browser's `localStorage` (`bee6.demo`).
   A judge who does Staff on a phone and then signs in as Supervisor on a laptop gets a **new** sandbox without their
   spoken moments. P1 covers this with guidance (one browser for the whole path). A join code is optional P3-b.
10. **Effort:** P0 2.5 h + P1 7.0 h + P2 11.0 h = **20.5 h** of build, before review and QA rounds. P3 is optional
    (5.5 h). §9 gives the phasing and the recommendation.

### 0a. Requests: in scope and out

| Item | Decision |
|---|---|
| A. One official "Sign in as Staff / Supervisor / Owner" page, no "Try" wording | **In (P1)** |
| A. Demo credentials (staff `000000`; `supervisor.judge@example.com` / `owner.judge@example.com` + one shown password) mint a private sandbox | **In (P1)**, client branch only on demo deployments; server contract unchanged |
| A. Pilot shows no demo hints; demo credentials do nothing | **In (P1)** + P0 Task 2 (reserved code) + Task 13.5 (provisioning guard) |
| B. Script drawer (hybrid script), Next button, Finish ends the session, hard auto-stop, general rules shown | **In (P2)**, sandbox devices only |
| B. Short demo session (Mulai any time, Selesai at once, hard stop) | **In (P2)**, server-derived profile, sandbox only |
| C. Generate works immediately from the seeded history | **In (P0)**: time shift + readiness check |
| C. Live moments visible in the day record and debrief | **In (P2)**: carry-over + debrief refresh; they appear ~2–4 min after speech |
| Demo shortcut that runs the tick at once for a sandbox ("fast lane") | **Optional (P3-a)**. It leaves the evidence rules untouched (§1.6) |
| Cross-device join code | **Optional (P3-b)** |
| Lower the evidence floor, auto-answer questions, hand-write facts | **Out, permanently** (D-1, hard rule #10) |

---

## 1. Architecture (decisions and why)

### 1.1 One sign-in page with three roles (A)

**The one official entry is `/sign-in`, rendered by a new `RoleSignIn` component.** `/` shows the same component on
both deployments:
- **Pilot (`DEMO_MODE` unset):** `/` server-redirects to `/sign-in` (replacing the scaffold text). `/sign-in` shows
  heading "Sign in", a role choice **Staff / Supervisor / Owner**, and the matching panel. It has no demo text, no
  demo bundle (PR-B's lazy-load boundary is kept) and no demo branch.
- **Demo (`DEMO_MODE === "true"`):** `/` = one intro paragraph and the fictional-data line (PR-B copy, reworded
  without "Try"), then `RoleSignIn demo`. `/sign-in` = `RoleSignIn demo` without the intro. Both show a **demo
  credentials box** inside each role panel.

**Role choice:** a native radio group (`<fieldset><legend>Sign in as</legend>` + 3 radios styled as a segmented
control, each ≥ 48 px). It is not ARIA tabs: radios give keyboard and screen-reader behaviour for free. Default
selection: none on the pilot (the page asks "Who are you?"). On demo, Staff is preselected because the judge path
starts with Staff. The selection persists in the URL (`?as=staff|supervisor|owner`) so a shared link opens the right
panel. Invalid values are ignored.

**Panels:**
- **Staff panel** = the existing pairing form, extracted from `app/pair/page.tsx` into `app/pair/PairForm.tsx`
  without any behaviour change. Label "Enter the 6-digit code from your supervisor". `/pair` keeps working and
  renders the same `PairForm` (seed output and earlier instructions point at `/pair`). If this browser already holds
  a device token, the panel shows "This phone is already connected. Open capture" (a link to `/capture`) above the
  form.
- **Supervisor panel / Owner panel** = the existing email + password form, extracted from `SignInScreen.tsx` into
  `app/sign-in/EmailSignInForm.tsx`. **Role truth stays in the claims.** The two panels run the same Firebase
  sign-in. After `POST /api/v1/auth/session`, the user lands by the role in their claims (`redirectTarget`, unchanged),
  not by the panel picked. A supervisor who signs in on the Owner panel lands on `/day`. The panel choice only picks
  the heading and, in demo, the demo credentials shown.

**Demo credentials (fixed, public, demo deployments only).** Constants live in `lib/demo/credentials.ts` and are
imported only by demo-only client code and its tests:

| Role | Shown on page | Effect |
|---|---|---|
| Staff | code `000000` | `startOrSwitch("staff")` |
| Supervisor | `supervisor.judge@example.com` + `bee6-demo` | `startOrSwitch("supervisor")` |
| Owner | `owner.judge@example.com` + `bee6-demo` | `startOrSwitch("owner")` |

- `example.com` is reserved (RFC 2606). No mailbox exists and no one can register it. **No Firebase account with
  these emails is ever created** (Task 13.5 makes the provisioning script refuse them).
- `startOrSwitch(role)` (new, in `app/demo/demo-client.ts`): if this browser holds a live sandbox (`bee6.demo` not
  expired), it **switches role in that sandbox** (`sandbox_key`, same as the DemoBar). Otherwise it creates one. So
  Staff, then Supervisor, then Owner in one browser stay one story. A separate "Start a fresh demo" control (PR-B's
  start-over with its confirm step, moved here) forgets the key first.
- **Matching rule (pure, `matchDemoCredential(role, input)`):** staff code is exactly `"000000"` after trimming.
  Email is trimmed and compared case-insensitively. Password must match exactly. The **credential decides the role**,
  not the panel: `owner.judge@…` typed into the Supervisor panel signs in as owner. A demo email with a wrong
  password goes to the normal Firebase path, which fails with the normal "wrong email or password" message. This
  avoids a special oracle.
- **Anything else typed on a demo deployment takes the real path** (Firebase email sign-in, or the real pair route).
  Internal QA keeps signing in to the shared `demo-outlet` with real `demo-*@example.com` accounts.
- **Why no server-side credential check.** The credential is published on the page. A server check would add no
  security and would reopen R-12 PR-A's security-reviewed contract (`DemoSessionBodySchema` is `.strict()`
  `{ role, sandbox_key? }`). The security boundary stays where R-12 put it: `DEMO_MODE` + `project_kind: "demo"` +
  per-IP and daily caps + sandbox isolation + 2 h expiry (`lib/demo/service.ts`). On the pilot the route 404s before
  any read, whatever the client sends.
- **On the pilot the demo credentials do nothing:** the branch is not in the rendered tree (`demo` prop false). The
  demo emails reach Firebase and fail as unknown users. `000000` reaches the real pair route, which refuses it as a
  reserved code (Task 2) before any lookup. The page shows no hint that a demo exists.

**What happens to PR-B's pieces:**
- **Landing "Try as …" buttons: removed.** `Landing.tsx` becomes `DemoIntro` (title, intro, suggested path,
  fictional line) above `RoleSignIn demo`. Its restart confirm moves into `RoleSignIn`'s demo box as "Start a fresh
  demo".
- **SignInScreen "Start a new demo" link: removed.** The page itself now carries the demo box. The "Your demo session
  has ended." line and the device-key cleanup for an ended demo stay (PR-B behaviour, unchanged).
- **DemoBar: unchanged** except its copy: "Demo · signed in as Staff · Switch to Supervisor / Owner · ends HH:MM"
  (no "Try").
- `useDemoStart` is reused unchanged by `startOrSwitch`.

### 1.2 The demo session profile (B), server-derived, sandbox only

The capture config response gains one optional field. It is present only when **all three** hold: `DEMO_MODE ===
"true"` (env, read at request time), the outlet doc has a `sandbox` object, and the device doc has `expires_at_ms`.
A real shop phone cannot meet any of the three on the pilot.

```ts
// lib/capture/contract.ts — CaptureConfigResponseSchema gains:
demo_session: z.object({
  max_ms: z.literal(300_000),          // hard auto-stop: started_at + 5 min
  script_id: z.literal("bakery-v1"),   // which script the drawer shows
}).strict().optional(),
```

The client never reads `DEMO_MODE` for this. It reacts only to the server's field, so a pilot build cannot enter
demo behaviour by accident or by tampering with local state.

**What the profile changes on `/capture` (client, pure helpers; pilot untouched when the field is absent):**

| Rule | Pilot (no profile) | Sandbox (profile) |
|---|---|---|
| Mulai offered | `mulaiAvailability` (window, closed day, `day_ended`, `debrief_running`) | `demoMulaiAvailability`: offered unless a session is open, a debrief is running, or this business date already ended (one demo day per sandbox). **Ignores the window and closed weekdays** |
| Selesai shown | `min(start + 4 h, close)` | at once |
| Auto-stop | close + 1 h | `min(close + 1 h, started_at + max_ms)` → `end_reason: "auto_stop"` |
| Debrief | 1 h from end | unchanged (1 h; the answer route's 60-min window is hard-coded and stays) |
| Off-hours banner, opening/closing checkpoints | shown | suppressed (they are window-based and meaningless here) |
| Script drawer | absent | shown |

**Server side (session routes):** `startSession` already accepts a start outside the window. It only writes an audit
row (`capture.session_start_outside_window`), which is fine and honest. One change: for a sandbox device,
`auto_stop_at_ms = started_at + DEMO_SESSION_MAX_MS` (`autoStopFor` gains an optional `demoMaxMs`), so a session that
ends as `lost` starts its debrief at a sensible time. The `local_date` rule (`mulaiWindowDateOf ?? businessDateOf`)
is unchanged and gives today's business date.

**Batalkan (discard)** stays available. A discarded demo session leaves `last_ended` alone, so Mulai is offered
again. That is the only retake path. Segment cap: `SEGMENT_PER_SANDBOX` 40 → **60** (one 4-min read is about 15–25
segments; one retake must fit).

### 1.3 The script drawer (B)

**Placement:** non-modal. On viewports narrower than 900 px it is a **bottom sheet**, at most 55 % of the height
when open and a 56 px handle when collapsed. The status banner ("Listening"), Selesai and Batalkan stay visible above
it (truthful-UI rule, 3 Oct). From 900 px up it is a right side panel, 360 px wide. `role="region"`,
`aria-label="Demo script"`. It never traps focus, because the user must still reach Selesai, Batalkan and the mic
status. Collapse/expand is a button with `aria-expanded`. Card changes are announced by one polite live region
("Card 3 of 10"). `prefers-reduced-motion` disables the slide.

**States:** `before` (session not started: the rules card + "Tap Start to begin"), `running` (cards 1…N with Back /
Next), `finish` (last card: **Finish and end the day** button), `ended` (after any end: "Done. Answer the debrief
questions, then switch to Supervisor").
- **Finish** calls the page's existing Selesai-confirmed handler (the same code the confirm's "Yes" runs). The drawer
  *is* the confirmation, so it skips the dialog. Ends with `end_reason: "selesai"`.
- **Hard auto-stop** at `started_at + 5:00` is the page's auto-stop effect with the profile deadline. The drawer
  shows "Demo ends automatically at MM:SS", counting down, as text (no colour-only cue).
- No auto-advance. Each card shows a suggested duration as a hint only. The judge controls the pace.
- The drawer stays open after Selesai, Batalkan or an auto-stop. It switches to the `ended` state.
- The general rules stay visible on the `before` card and as one line in the drawer header: "Keep this tab open and
  the screen on. Allow the microphone. Plug in if the battery is low."

**Script: hybrid.** Word-by-word lines anchor the moments the pipeline must catch reliably (the bake-time problem,
the phone call). Instruction cards ("in your own words", with an example) let the judge show that the product works
on natural speech. Every card carries an *intent* line shown in small text ("What the app should notice"). That
turns the drawer into a guided explanation of the product, not just a teleprompter.

```ts
// lib/demo/script.ts (pure data + a zod schema; tests in lib/demo/script.test.ts)
export const ScriptCardSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,32}$/),
  kind: z.enum(["rules", "say", "own_words", "finish"]),
  speaker: z.enum(["you", "customer", "colleague", "caller"]).nullable(),
  text: z.object({ en: z.string().min(1).max(220), id: z.string().min(1).max(220) }).strict(),
  example: z.object({ en: z.string().max(220), id: z.string().max(220) }).strict().nullable(),
  intent: z.object({ en: z.string().max(140), id: z.string().max(140) }).strict(),
  expect: z.enum(["fact_possible", "question", "dropped", "none"]),  // QA reference; never shown, never used by code
  sop_step: z.enum(["open-01", "bake-01", "stock-01", "serve-01", "close-01"]).nullable(),
  seconds: z.number().int().min(5).max(45),
}).strict();
```

**Script `bakery-v1`** (aligned with the 5-step placeholder SOP: `open-01`, `bake-01`, `stock-01`, `serve-01`,
`close-01`, and with Tiffany's "when was this baked?" scenario. **Final wording needs Tiffany's pass against the clip
script page, which this pass could not read.** Lines are spoken in the language the judge picks. Each Bahasa column
is a draft for Tiffany.)

| # | kind / speaker | EN text (ID draft) | Intent shown | expect | step | s |
|---|---|---|---|---|---|---|
| 0 | rules | "Keep this tab open, screen on, mic allowed. Read each card aloud, then tap Next." (Biarkan tab ini terbuka, layar menyala, mikrofon diizinkan. Bacakan tiap kartu, lalu ketuk Berikutnya.) | "Nothing is recorded until you tap Start." | none | – | 10 |
| 1 | say / you | "Morning. Oven is on, display lights on, first tray of croissants going in now." (Pagi. Oven sudah nyala, lampu display nyala, loyang croissant pertama masuk sekarang.) | "Opening routine: may become a fact on its own." | fact_possible | open-01 | 15 |
| 2 | own_words / customer + you | "Play a customer asking when a loaf was baked. Answer that you're not sure because the tray has no time on it." Example: "When was this sourdough baked?" "Hmm, I'm not sure, there's no label. This morning, I think?" | "The bake-time problem the earlier demo days also show." | fact_possible | bake-01 | 30 |
| 3 | say / colleague | "Hey, what time did the sourdough come out? A customer asked again." / "No idea, nobody wrote it down." (Eh, roti sourdough keluar jam berapa? Pelanggan tanya lagi. / Nggak tahu, nggak ada yang catat.) | "Staff asking each other: evidence for the same problem." | fact_possible | bake-01 | 20 |
| 4 | own_words / you | "Say you checked the display and refilled what was running low." Example: "Display check done, topped up the cinnamon rolls." | "Routine check, in your own words." | fact_possible | stock-01 | 20 |
| 5 | own_words / customer | "Play a customer complaining the bread they bought yesterday was already stale." | "A complaint is never a fact by itself; it becomes a question." | question | serve-01 | 25 |
| 6 | say / caller + you | "Hello, Demo Bakehouse. Yes, we can keep two loaves for pickup at five." (Halo, Demo Bakehouse. Bisa, kami simpankan dua roti untuk diambil jam lima.) | "Phone calls are always checked with staff later." | question | serve-01 | 20 |
| 7 | say / you | "If the oven ever breaks down, we'd have to call the technician." (Kalau ovennya rusak, kita harus panggil teknisi.) | "Something that did not happen: it must not become a fact." | none | – | 10 |
| 8 | own_words / you | "Chat about your weekend for a few seconds." | "Small talk is not work: it is dropped from the record." | dropped | – | 15 |
| 9 | say / you | "Counting the till now and logging the leftover loaves." (Sekarang hitung kas dan catat roti sisa.) | "Closing routine." | fact_possible | close-01 | 15 |
| 10 | finish | "Tap Finish to end the demo day. Your debrief opens next." | "Your moments reach the day record about 2–4 minutes after you finish." | none | – | 5 |

Talk time is about 3 min (185 s of suggested time), and Mulai to Finish is about 3:30–4:00 with taps. The hard stop
at 5:00 leaves margin. `expect` is for QA only (§7). The code never checks the pipeline's output against it
(the evidence gate stays the only judge, hard rule #10).

**Language recommendation:** the script and drawer follow the page language (EN default, ID column). Transcription
auto-detects the language (`lib/transcribe/gemini.ts`: `languageCodes` omitted). The label prompt has no language
assumption. ProposalAgent writes in the SOP's language (`lib/proposals/prompt.ts` rule 10), so the proposal stays
English. **Effect:** an English-speaking judge's lines show in English in the day record, beside the Bahasa template
lines. The judge sees a bilingual record. That is honest, because it is the real product. Risk: the transcription
vocabulary (Bahasa bakery terms) may bias English words slightly. The QA plan (§7) measures this. If English
labelling proves weak, the fallback is to recommend Bahasa lines read from the ID column (§11 Q-6).

### 1.4 Debrief content without waiting for the pipeline (B/C)

**Carry-over replaces R-12's re-arm at creation.** In `cloneTemplate`:
- The judge device gets `last_ended` = the template's (time-shifted) last day, with the original (shifted)
  `debrief_ends_at_ms` already in the past. So `debrief_running` does not fire and Mulai is offered.
- **At most `CARRY_OVER_MAX = 2`** of the template device's questions that the template's last debrief end expired
  (the same `rearmed` set the clone already computes, ranked by `rankQuestions`, top 2) are written `status: "open"`,
  `expired_by_debrief_end_ms: null`, without answer fields, and with **`created_at_ms = now_ms`**. The thread state
  restore is unchanged from R-12. The rest stay `unverified`.
- Why `created_at_ms = now`: the tick's expiry (`expireAtDebriefEnd`) closes an open question only if
  `created_at_ms <= debrief_end <= now`. A question created after the device's last debrief end belongs to the
  **next** debrief, exactly like a question raised during today's session. The next tick therefore leaves it alone.
  The judge's own debrief (opened at Finish) lists it, and the judge's debrief end expires it normally.
- Answering it works through the unchanged route: `findEndedDebrief(device, today)` finds the judge's session, the
  answer falls inside today's window, and the status is `open` (`lib/debrief/service.ts` steps 10–12). A YES
  re-gates the template thread with gate v2 (`staff_confirmed`). That is the real gate, run on a real thread.
- **Honesty in the UI:** a question whose `window_start_ms` business date differs from the debrief's business date
  shows a small chip, "Earlier day · Mon 12 Oct", on `QuestionScreen` (generic rule; on the pilot it never fires,
  because questions expire at their own day's debrief end). `DebriefQuestionView` gains `business_date` (string),
  computed server-side.
- **Ordering:** `rankQuestions` puts the oldest first, so the carried questions come first and today's live
  questions follow as they arrive (`DEBRIEF_SHOW_MAX = 5`, so at least 3 slots stay free for live ones).

**Debrief refresh:** the debrief's question list gains a "Check for new questions" button (all devices; 48 px). On a
device with the demo profile it also polls every 20 s while the list is shown, stopping at the debrief's end or after
10 minutes. New ids are appended; answered or cached ids are never re-shown (the existing cache filter).

### 1.5 The judge path end to end (C), against the code

1. **Sign in as Staff** (`000000`) → sandbox created: template shifted (last day = yesterday), 2 carried-over
   questions, judge device paired → `/capture`, Mulai offered, drawer shows the rules card.
2. **Start → read the cards → Finish** (about 4 min, hard stop at 5) → session ends `selesai` → debrief opens with the
   2 carried questions. Today's questions appear over the next 2–4 min (refresh/poll).
3. **Answer** (YES/NO + reason; real SDP + name scrub) → template threads may become `staff_confirmed` facts.
4. **DemoBar → Supervisor** → `/day` (today). The judge's live threads appear (facts, open with questions, or
   unlabelled) as the tick processes them. Earlier days are one tap back. Optional confirm/override/reject (R-06).
5. **`/proposals` → Generate** (default range: last 7 days = the 2 template days + today) → the floor passes **from
   the template alone** (P0 Task 3 guarantees it) → ProposalAgent (`gemini-3.5-flash`, about 10–30 s, 60 s timeout)
   → proposal citing evidence → Feasible.
6. **DemoBar → Owner** → approve → SOP v2 ships (R-10) → `/reviews` → fast-forward (simulated time, R-11; the
   after-window is still flat by R-12 Q-8 (a)).

**Nothing in this path reads the judge's live moments as a precondition.** They add evidence when they arrive. They
never block (D-1).

### 1.6 Optional fast lane (P3-a), evidence rules untouched

`POST /api/v1/demo/process` (device auth, sandbox device only, `DEMO_MODE` only, capped by a new
`PROCESS_PER_SANDBOX = 6` and the existing `MODEL_DAILY`). It runs the existing `runTick` restricted to the caller's
device (the same lease, windowing, label call and gate). The debrief poll calls it instead of waiting for the
scheduler. **Windowing's 90 s silence rule is kept.** One generic windowing change is needed for the lane to pay off:
"a window whose last line ends before the device's session `ended_at_ms`, with `as_of_ms ≥ ended_at_ms`, is closed"
(after Selesai no more speech can arrive for that session). This also benefits the pilot, because the debrief gets
its questions about 90 s sooner. It touches `lib/pipeline/windowing.ts` (judgement work, `developer`), and Rangga
must accept it as a pilot behaviour change (§11 Q-8). Gain: about 2 min saved in the worst case. **Recommendation:
skip it for 18 Oct** unless QA's latency measurement (§7) shows a worst case over 5 min.

---

## 2. Global constraints (every task inherits these)

- **Pilot inertness.** Every new behaviour is reachable only when (a) the server read `DEMO_MODE === "true"` at
  request time and passed `demo` as a prop (sign-in), or (b) the capture config carries `demo_session` (capture),
  which the server sets only for a sandbox outlet plus an expiring device on a demo deployment. No `NEXT_PUBLIC_*`
  flag. No client env read.
- **Demo bundle boundary (PR-B):** pilot pages ship no demo chunk. `RoleSignIn` imports demo code only through a
  `next/dynamic` / lazy boundary under `app/demo/`. Extend `app/demo/import-boundaries.test.ts`.
- **No change** to `requireClaims`, `requireDevice`, RBAC, `lib/pipeline/gate.ts`, `lib/pipeline/categories.ts`,
  `lib/proposals/precheck.ts`, `lib/proposals/constants.ts`, `config/**`. The evidence floor, thresholds and gate are
  never touched (D-1, hard rule #10).
- **Read-only (import, do not edit) unless a task names the file:** `lib/proposals/**`, `lib/sop/**`,
  `lib/reviews/**`, `lib/agents/**`, `lib/pipeline/**` (P3-a excepted), `lib/debrief/service.ts` (Task 10 edits only
  the list view field).
- Copy goes through `t(lang, key)`. EN default, ID second. 360 px first. Touch targets ≥ 48 px. Visible focus. No
  colour-only state.
- No audio or base64 anywhere new. The drawer never touches audio. Logs: `[demo] …` with sandbox id only (R-12
  discipline).
- Every PR targets `develop`.

## 3. Review focus

1. **Pilot leak of demo behaviour:** a pilot `/sign-in` that renders demo hints, ships the demo chunk, or calls
   `/api/v1/demo/session`. Pinned: 13.T1, 13.T2, boundary test.
2. **Reserved code reachable on the pilot:** pinned 2.T1–2.T3.
3. **Demo credential becoming a real account:** pinned 13.T6 (provisioning refuses `*.judge@example.com`).
4. **Profile reachable by a real device:** pinned 7.T1–7.T4 (each of the three conditions false → no field).
5. **Time shift corrupting data:** a shifted doc that fails its schema, a template id left behind, a non-whole-day
   shift, local times changed. Pinned: 1.T1–1.T7.
6. **Carry-over re-expired by the next tick or answerable outside the window:** pinned 6.T2–6.T4 (uses the real
   `expireAtDebriefEnd`).
7. **Finish ending the session twice or racing the auto-stop:** pinned 9.T5, 9.T6 (the existing
   `autoStopInFlightRef` guard is reused; Finish is disabled while an end is in flight).
8. **Drawer hiding the truthful status:** pinned 11.T4 (banner and Selesai stay in the accessible tree and visible at
   360 × 640).

## 3a. Data changes (summary)

| Item | Change |
|---|---|
| Firestore schema | **none new.** Cloned docs change values only (shifted times, carry-over `created_at_ms`) |
| `CaptureConfigResponseSchema` | optional `demo_session { max_ms, script_id }` |
| `DebriefQuestionView` | `business_date` (string, `YYYY-MM-DD`) |
| Constants | `DEMO_SESSION_MAX_MS = 300_000`, `CARRY_OVER_MAX = 2`, `SEGMENT_PER_SANDBOX` 40 → 60, `RESERVED_PAIRING_CODES = ["000000"]` |
| Env | none |

## 4. File map

| File | New / change | Phase | Responsibility |
|---|---|---|---|
| `lib/demo/clone.ts` (+test) | change | P0, P2 | whole-day time shift; carry-over replaces re-arm |
| `lib/demo/constants.ts` | change | P0, P2 | new constants |
| `lib/demo/service.ts` (+test) | change (1 line) | P0 | pass the business-date anchor to the clone |
| `lib/auth/pairing.ts` (+test) | change | P0 | reserved codes never generated |
| `app/api/v1/devices/pair/route.ts` / its service (+test) | change | P0 | reserved code refused before lookup |
| `scripts/demo-seed-template.ts` (+test) | change | P0 | readiness check at the end of the run |
| `lib/demo/credentials.ts` (+test) | new | P1 | constants + `matchDemoCredential` |
| `app/pair/PairForm.tsx` (+test), `app/pair/page.tsx` | new / change | P1 | extracted form; page renders it |
| `app/sign-in/EmailSignInForm.tsx` (+test), `SignInScreen.tsx` | new / change | P1 | extracted form |
| `app/sign-in/RoleSignIn.tsx` (+test) | new | P1 | role radio group + panels + lazy demo box |
| `app/demo/DemoCredentials.tsx` (+test) | new | P1 | demo box per role, fill-in, start fresh |
| `app/demo/demo-client.ts` (+test) | change | P1 | `startOrSwitch` |
| `app/demo/Landing.tsx` → `DemoIntro.tsx` (+test) | change | P1 | intro only; Try buttons removed |
| `app/page.tsx`, `app/sign-in/page.tsx` (+tests) | change | P1 | pilot redirect; demo intro + picker |
| `app/demo/DemoBar.tsx` | copy only | P1 | no "Try" |
| `scripts/provision-web-user.ts` (+test) | change | P1 | refuse demo emails |
| `lib/i18n/dict.ts` (+test) | change | P1, P2 | `C-signin-role-*`, `C-demo-cred-*`, `C-script-*` keys |
| `lib/capture/contract.ts`, `lib/capture/services.ts` (+tests) | change | P2 | `demo_session` field |
| `app/api/v1/capture/config/route.ts` | change | P2 | passes `demoMode` |
| `lib/capture/session-service.ts`, session routes (+tests) | change | P2 | sandbox `auto_stop_at_ms` |
| `lib/capture/demo-session.ts` (+test) | new | P2 | `demoMulaiAvailability`, `autoStopDeadline`, `selesaiReady` |
| `app/capture/page.tsx`, `idle-view.ts`, `selesai-view.ts`, `off-hours-banner.ts` (+tests) | change | P2 | apply the profile |
| `lib/demo/script.ts` (+test) | new | P2 | script data + schema |
| `app/capture/ScriptDrawer.tsx` (+test) | new | P2 | drawer UI |
| `app/capture/debrief/DebriefFlow.tsx`, `QuestionScreen.tsx`, `lib/debrief/contract.ts`, `lib/debrief/service.ts` (+tests) | change | P2 | refresh/poll; Earlier-day chip; `business_date` |

---

## 5. Tasks

### P0: correctness of the seeded history (can start now, no UI; one PR `feature/r18-clone-shift`)

#### Task 1: whole-day time shift in the clone (1.25 h, `developer`)
- [ ] **1.1** In `cloneTemplate`'s input, add `anchor_business_date: string` (the caller passes
  `businessDateOf(now_ms, tpl.outlet.timezone)`). Compute `targetLast = addDays(anchor, -1)`,
  `k = daysBetween(D, targetLast)` (D = template `last_ended.business_date`), `deltaMs = k * 86_400_000`. If
  `k < 0`, throw (→ `demo_not_ready`, logged). `k = 0` is a no-op shift.
- [ ] **1.2** **DST guard:** check `localHmOf(t, tz) === localHmOf(t + deltaMs, tz)` for the template's earliest
  session start and latest session end. If either differs, throw (→ `demo_not_ready`). Asia/Jakarta never fails it.
- [ ] **1.3** `shiftDeep(value, deltaMs, k)`, applied **after** `rewriteDeep`, recurses like it and changes only:
  (a) numbers under keys matching `/_ms$/` whose value is ≥ `1_000_000_000_000` (epoch ms; leaves durations and
  zero); (b) strings under keys `local_date`, `business_date`, `effective_from_date` matching `YYYY-MM-DD` →
  `addDays(v, k)`; (c) ISO datetime strings under keys matching `/_at$/` → shifted ISO. Nothing else. Free text
  (`summary`, `lines[].text`, `fields`, `gate`) is never touched. Explicit list for review: sessions
  `started_at_ms, ended_at_ms, auto_stop_at_ms, debrief_ends_at_ms, local_date, received_*_at`; device
  `last_ended.*`; threads `first_line_start_ms, last_line_end_ms, created_at_ms, updated_at_ms, lines[].start_ms,
  lines[].end_ms`; questions `window_*_ms, created_at_ms, answered_at_ms, expired_by_debrief_end_ms`; SOP v1
  `created_at_ms`, `effective_from_date` (null stays null).
- [ ] **1.4** The fields R-12 sets from `now_ms` (sandbox object, device `paired_at`, `created_at`, `expires_at_ms`)
  are set **after** the shift and never shifted.
- [ ] **1.5** Tests (`lib/demo/clone.test.ts`): **1.T1** last template day becomes anchor − 1; **1.T2** every
  session/thread/question time moves by exactly `deltaMs` and `localHmOf` is unchanged for all of them; **1.T3**
  `summary`/`lines[].text`/`fields` byte-identical; **1.T4** every cloned doc still parses with its schema;
  **1.T5** `k < 0` throws; **1.T6** a DST zone fixture (`Europe/Berlin` across 25 Oct) throws; **1.T7** the
  existing R-12 tests (no `demo-tpl-` substring, unique ids, equality except listed fields) are updated to "except
  ids, shifted fields and re-arm/carry-over fields" and still pass; **1.T8** with the shifted clone,
  `selectCandidates` over `[anchor − 6, anchor]` on the fixture keeps all template facts (the default Generate
  range).
- [ ] **1.6** `lib/demo/service.ts` passes `anchor_business_date`. One test: the service uses the outlet timezone.

#### Task 2: reserved pairing codes (0.5 h, `developer`)
- [ ] **2.1** `lib/auth/pairing.ts`: `export const RESERVED_PAIRING_CODES: ReadonlySet<string> = new Set(["000000"])`.
  `generatePairingCode()` redraws while the code is reserved (a loop; the expected draw count stays about 1).
- [ ] **2.2** The pair service/route: a body code in `RESERVED_PAIRING_CODES` → the **same** response as an unknown
  code (no existence oracle), before any Firestore read. Same rate-limit path as today.
- [ ] **2.3** Tests: **2.T1** with `randomInt` stubbed to return 0 then 42, the result is `"000042"`; **2.T2** the
  route with `000000` makes zero store calls and returns the unknown-code response; **2.T3** the seed's printed code
  is never reserved (the existing seed test with a stub).

#### Task 3: template readiness check (0.75 h, `developer`)
- [ ] **3.1** At the end of `scripts/demo-seed-template.ts` (after its progress poll reports `pending_units === 0`),
  read the template threads and sessions read-only. Run `selectCandidates` over `[D − 6, D]` and then
  `checkEvidenceFloor`. Print `READY: facts=<n> dates=<m>` or
  `NOT READY: facts=<n> dates=<m> (need 2 on 2).` CORRECTED 11 Oct (QA + tech-lead): the earlier remedy 'confirm threads as the template supervisor on /day' cannot work (planConfirm needs an ANSWERED question; template questions expire unanswered, there is no template login). The working remedy: re-cut the clips so >= 2 days each have >= 1 clear auto-fact moment (ROUTINE_OPS, CUSTOMER_SERVICE, STAFF_CONSULT, TRAINING, EVENT at >= 0.9), have dev-ops delete the demo-tpl-outlet data, re-seed, then `--check-only`.
- [ ] **3.2** New flag `--check-only`: skips pairing and upload and runs only 3.1 (read-only), so Rangga can re-check
  after confirming threads.
- [ ] **3.3** Tests: **3.T1** fixture with 2 auto facts on 2 dates → READY; **3.T2** 3 facts on 1 date → NOT READY;
  **3.T3** `--check-only` makes no HTTP call (the existing static "no Firestore write API" test still passes).
- [ ] **3.4** Runbook line in the script header: if NOT READY, provision `demo-tpl-supervisor@example.com` with
  (SUPERSEDED, see the correction above: do NOT provision a template login; re-cut the clips and re-seed.)
  **This is the product's real supervisor-confirm path (gate v3). It is not a bypass.**

**P0 total 2.5 h** (with 0.5 h review fixes buffer inside the tasks above, excluding QA).

### P1: official role sign-in + demo credentials (after R-12 PR-B merges; one PR `feature/r18-role-signin`)

#### Task 4: extract the two forms (1.25 h, `developer-junior` for 4.1–4.2; `developer` reviews 4.3)
- [ ] **4.1** `app/pair/PairForm.tsx` = the form, state and submit logic of `app/pair/page.tsx`, moved without
  change. Props: `{ onPaired?: (outletId: string) => void }`. `page.tsx` renders `<ShopTopBar/>` + `<PairForm/>` +
  its existing paired checklist. All existing `/pair` tests pass unmodified.
- [ ] **4.2** `app/sign-in/EmailSignInForm.tsx` = the form JSX and `handleSubmit` of `SignInScreen.tsx`. Props:
  `{ auth, disabled, onBusy, signingInRef, demoIntercept?: (email: string, password: string) => Promise<boolean> }`.
  When `demoIntercept` returns `true`, the Firebase call is skipped. `SignInScreen` keeps the loading/redirect
  effects. All existing `SignInScreen` tests pass unmodified.
- [ ] **4.3** Check that `signingInRef` semantics are unchanged (the stale-redirect race comment in the file).

#### Task 5: `RoleSignIn` (2.0 h, `developer`)
- [ ] **5.1** `app/sign-in/RoleSignIn.tsx` (client). Props `{ config, demo: boolean, initialRole: "staff" | "supervisor" | "owner" | null }`.
  Markup: `<h1>` "Sign in" / "Masuk"; `<fieldset>` + `<legend>` "Sign in as" / "Masuk sebagai"; three radios
  (`Staff/Staf`, `Supervisor/Supervisor`, `Owner/Pemilik`), each label ≥ 48 px tall and wrapping at 360 px. Then the
  panel: Staff → `<PairForm/>` (+ "already connected" link if `localStorage` holds `bee6.device_token`); Supervisor
  or Owner → `<EmailSignInForm/>` with a per-role subheading. In demo mode only, `<DemoCredentials role=…/>` loads
  through `next/dynamic` above the form.
- [ ] **5.2** Role ↔ URL: on change, `router.replace("?as=<role>")` (no history spam). `page.tsx` reads `searchParams.as`
  (verify the async `searchParams` convention in `node_modules/next/dist/docs/`) and passes `initialRole`. Default:
  `null` on the pilot (the panel area shows "Choose who you are to continue"), `"staff"` on demo.
- [ ] **5.3** Focus: after a POINTER-initiated role change (mouse/touch), focus moves to the panel's first input. Keyboard (arrow keys) role changes must NOT move focus (AMENDED 11 Oct after QA/tech-lead: WCAG 3.2.2; arrow keys must walk Staff -> Supervisor -> Owner with focus staying on the radio group). Errors stay in the existing
  `role="status"` lines.
- [ ] **5.4** `app/sign-in/page.tsx`: renders `RoleSignIn` with `demo = process.env.DEMO_MODE === "true"` (read per
  request after `connection()`). `SignInScreen` remains the wrapper for the loading/signed-in states.
- [ ] **5.5** `app/page.tsx`: pilot → `redirect("/sign-in")`; demo → `<DemoIntro/>` + `<RoleSignIn demo initialRole="staff"/>`.

#### Task 6 (P1 numbering: 6a): demo credentials (1.5 h, `developer`)
- [ ] **6a.1** `lib/demo/credentials.ts`: `DEMO_STAFF_CODE = "000000"`, `DEMO_PASSWORD = "bee6-demo"`,
  `DEMO_EMAILS = { supervisor: "supervisor.judge@example.com", owner: "owner.judge@example.com" }`,
  `matchDemoCredential(input: {kind:"code", code} | {kind:"email", email, password}): DemoRole | null` (rules in
  §1.1). The test asserts `DEMO_STAFF_CODE` ∈ `RESERVED_PAIRING_CODES`.
- [ ] **6a.2** `app/demo/demo-client.ts`: `startOrSwitch(role, options)` = live `bee6.demo` → the existing switch path;
  else the existing create path. Returns the same `StartDemoResult`.
- [ ] **6a.3** `app/demo/DemoCredentials.tsx`: a bordered box "Demo access" / "Akses demo". It shows the role's
  credential as selectable text, a **Fill in** button (fills the panel's inputs and does not submit), the line "Each
  sign-in opens your own private copy of a fictional shop for 2 hours. Nothing you do affects anyone else." / "Setiap
  masuk membuka salinan pribadi toko fiktif selama 2 jam. Yang Anda lakukan tidak memengaruhi orang lain.", and, when
  a live sandbox exists, "You are continuing your demo (ends HH:MM)" plus **Start a fresh demo** (PR-B's two-step
  confirm, moved).
- [ ] **6a.4** Wiring: `PairForm` and `EmailSignInForm` receive `demoIntercept`, which only `RoleSignIn` supplies,
  and only when `demo` is true. On a match → `startOrSwitch`. On `started` → navigate to `landing_path`. On a refusal
  → PR-B's `refusalLines` in the status line.

#### Task 7 (P1 numbering: 7a): retire Try, copy, guard (1.25 h, `developer-junior`)
- [ ] **7a.1** `Landing.tsx` → `DemoIntro.tsx`: keep title, intro, path, fictional line. Delete the role buttons, the
  restart block and their tests (moved to 6a.3). Rewrite `C-demo-path` without "Try": "Suggested path: sign in as
  Staff and speak a short shop day, answer the debrief, then switch to Supervisor and Owner from the bar at the top."
- [ ] **7a.2** Remove the dict keys `C-demo-try-*`. DemoBar copy "Signed in as {role}". Remove SignInScreen's "Start a
  new demo" link (keep "Your demo session has ended." and the device-key cleanup).
- [ ] **7a.3** New dict keys (EN/ID), all with tests in `dict-demo.test.ts`: `C-signin-as`, `C-signin-role-staff`,
  `-supervisor`, `-owner`, `C-signin-choose`, `C-signin-staff-help` ("Enter the 6-digit code from your supervisor to
  connect this phone." / "Masukkan kode 6 angka dari supervisor untuk menghubungkan ponsel ini."),
  `C-signin-staff-connected`, `C-demo-cred-title`, `C-demo-cred-code`, `C-demo-cred-email`, `C-demo-cred-password`,
  `C-demo-cred-fill`, `C-demo-cred-private`, `C-demo-cred-continuing`, `C-demo-cred-fresh`.
- [ ] **7a.4** `scripts/provision-web-user.ts`: refuse any email ending in `.judge@example.com`, and the two exact
  `DEMO_EMAILS` (exit 1, message "reserved demo address").

#### Task 13: P1 tests (1.0 h, `developer`; written first, TDD)
- **13.T1** pilot `/sign-in` (`demo=false`): no text matching `/demo|000000|judge|example\.com/i`; the 3 radios exist.
- **13.T2** pilot: the demo module never loads (`import-boundaries.test.ts` extended: `RoleSignIn` statically imports
  nothing from `app/demo/**` except through `dynamic`).
- **13.T3** demo, Staff, `000000` → `startOrSwitch("staff")` called; the pair route is not called.
- **13.T4** demo, Staff, `123456` → the pair route is called; demo is not.
- **13.T5** demo, Supervisor panel, `OWNER.JUDGE@example.com ` + `bee6-demo` → `startOrSwitch("owner")`; a wrong
  password → the Firebase path is called.
- **13.T6** `provision-web-user` refuses the demo addresses.
- **13.T7** live sandbox in `localStorage` → the switch path, not create; expired → create.
- **13.T8** a11y: `axe` has no violations for each role panel at 360 px; radios reachable by arrow keys; focus moves
  to the first input.
- **13.T9** `/` on the pilot redirects to `/sign-in`; on demo it renders the intro + picker.

**P1 total 7.0 h.**

### P2: short demo session + script drawer (one PR `feature/r18-script-drawer`; can build in parallel with P1 after P0 merges; touches no P1 file)

#### Task 6: carry-over replaces re-arm (1.0 h, `developer`)
- [ ] **6.1** In `cloneTemplate`: the judge device's `last_ended` = the shifted template value (not `now`-based). The
  D session keeps its shifted end. Of the `rearmed` set, pick the top `CARRY_OVER_MAX` by `rankQuestions` and write
  them as in §1.4 (`created_at_ms = now_ms`). Others keep `unverified`. Thread restore only for the carried gate
  questions.
- [ ] **6.2** Tests: **6.T1** exactly ≤ 2 open questions, the rest unverified; **6.T2**
  `expireAtDebriefEnd(carried, device.last_ended.debrief_ends_at_ms, now + 1 min)` returns `null`; **6.T3**
  `mulaiAvailability` with the cloned `last_ended` at `now` is not `debrief_running`; **6.T4** after a simulated judge
  session end at `t`, `expireAtDebriefEnd(carried, t + 1 h, t + 1 h)` expires it (normal life cycle).

#### Task 7: `demo_session` in the capture config (0.75 h, `developer`)
- [ ] **7.1** `toCaptureConfig(outlet, lastEnded, count, demoMode: boolean, device)` adds `demo_session` only when
  `demoMode && outlet.sandbox && device.expires_at_ms !== undefined`. The route passes
  `process.env.DEMO_MODE === "true"`.
- [ ] **7.2** Tests: **7.T1–7.T3** each condition false → no field (strict schema parse); **7.T4** all true → the
  exact object.

#### Task 8: session profile rules (1.5 h, `developer`)
- [ ] **8.1** `lib/capture/demo-session.ts` (pure): `demoMulaiAvailability({ now_ms, tz, session_open, last_ended })`
  returns the `MulaiAvailability` shape: `session_open` → not offered; `last_ended` and
  `businessDateOf(now) <= last_ended.business_date` → `day_ended` (copy: "Demo day finished. Switch to Supervisor
  to see it."); a running debrief → `debrief_running`; else offered with `business_date = businessDateOf(now)`.
  `autoStopDeadline(session, config)` = `min(autoStopAtMs(...) ?? ∞, started_at + max_ms)` when the profile is
  present. `selesaiReady(profile)` = true.
- [ ] **8.2** `app/capture/page.tsx`, `idle-view.ts`, `selesai-view.ts`, `off-hours-banner.ts`: branch on
  `config.demo_session` only. The existing auto-stop effect takes its deadline from `autoStopDeadline`.
- [ ] **8.3** Server: `autoStopFor` gains optional `demoMaxMs`. The session routes pass it when the outlet has
  `sandbox` and `DEMO_MODE === "true"`. `SEGMENT_PER_SANDBOX = 60`.
- [ ] **8.4** Tests: Mulai offered at 22:30 WIB with the profile and `window_passed` without it; Selesai ready at
  start; auto-stop fires at start + 5:00 (fake clock) with `end_reason: "auto_stop"`; pilot snapshots unchanged
  (existing page tests pass unmodified); server `auto_stop_at_ms` = start + 5 min only for a sandbox.

#### Task 9: drawer behaviour (1.5 h, `developer`)
- [ ] **9.1** `app/capture/ScriptDrawer.tsx`: props `{ script, lang, state, startedAtMs, maxMs, onFinish, finishing }`.
  States per §1.3. Back/Next, "Card n of N" live region, collapse button, countdown text.
- [ ] **9.2** Finish → `onFinish()` = the page's Selesai-confirmed handler. Disabled while `finishing` or while
  `autoStopInFlightRef` is set.
- [ ] **9.3** Tests: **9.T1** renders only when `config.demo_session`; **9.T2** Next/Back bounds; **9.T3** the live
  region text; **9.T4** Finish calls the handler once; **9.T5** a double tap → one end request; **9.T6** auto-stop
  fires while on card 5 → the drawer goes to `ended` with no second end request.

#### Task 10: debrief refresh + Earlier-day chip (1.0 h, `developer`)
- [ ] **10.1** `DebriefQuestionView.business_date` = `businessDateOf(q.window_start_ms, tz)` (server). Contract test.
- [ ] **10.2** `QuestionScreen`: the chip "Earlier day · {Ddd D Mmm}" / "Hari sebelumnya · …" when
  `q.business_date !== debrief.business_date`.
- [ ] **10.3** `DebriefFlow`: a "Check for new questions" button in the list and empty states. With the profile, a
  20 s poll until the debrief end or 10 min. New ids are appended, cached ids filtered (existing).
- [ ] **10.4** Tests: chip on/off; poll appends; poll stops at the end; no poll without the profile.

#### Task 11: script content + layout (2.0 h: 1.0 `developer-junior` for 11.1–11.2, 1.0 `developer` for 11.3–11.4)
- [ ] **11.1** `lib/demo/script.ts`: `bakery-v1` exactly as the §1.3 table (EN text; ID drafts marked
  `// DRAFT: Tiffany`). The schema test: ids unique, `sop_step` ∈ the 5 placeholder ids, the sum of `seconds` between
  150 and 240, no staff names from `DEMO_SEED.staff` in any text, no `demo-tpl-` token.
- [ ] **11.2** Dict keys `C-script-*` for the drawer chrome (title, next, back, finish, ended, countdown, rules line,
  collapse/expand).
- [ ] **11.3** Layout: bottom sheet < 900 px (max-height 55 vh, handle 56 px), side panel ≥ 900 px. Reduced motion.
- [ ] **11.4** **11.T4** at 360 × 640 the status banner, Selesai and Batalkan stay visible
  (`getBoundingClientRect` in jsdom with set sizes, plus a QA screenshot); `axe` clean.

#### Task 12: live tuning on the demo project (1.0 h, PM dispatches QA + Tiffany for wording)
- [ ] Run §7's script runs. Adjust only the wording/order of `bakery-v1` (not code) if a card repeatedly fails to
  produce its expected kind. Record the results under "Result".

**P2 total 11.0 h** (Tasks 6–12 = 8.75 h + 2.25 h tests and fixes inside the tasks).

### P3: optional (only if P0–P2 merged by Thu 15 Oct and QA is clean)
- **P3-a fast lane** (§1.6): 2.5 h + security-reviewer. Build only if the measured worst case is over 5 min.
- **P3-b cross-device join code:** an 8-character base32 code shown in the DemoBar, stored hashed on the sandbox,
  redeemed in the demo box ("Have a code from your phone?"), with the existing `SWITCH_IP_DAILY` bounding guesses.
  2.5 h + security-reviewer.
- **P3-c "Your moments" highlight on `/day`:** threads whose session is the judge's are already the only threads for
  today. A header line "Today: your demo day" is enough. 0.5 h.

---

## 6. Edge cases (required behaviour)

| # | Case | Behaviour |
|---|---|---|
| E1 | Pilot user types `000000` | Real pair route → "code not valid" (same as any unknown code), no lookup |
| E2 | Pilot user types a demo email | Firebase "wrong email or password"; no demo request |
| E3 | Demo email + wrong password on demo | Real Firebase path → normal error (no oracle) |
| E4 | Owner credential in the Supervisor panel | Signs in as owner (the credential decides) |
| E5 | Live sandbox in this browser, judge signs in as another role | Switch in the same sandbox; no new clone |
| E6 | Expired sandbox in this browser | New sandbox; "Your demo session has ended." shown first (PR-B) |
| E7 | Per-IP cap reached (10/day) | PR-B refusal copy with retry time; nothing else changes |
| E8 | Judge does Staff on phone, Supervisor on laptop | New sandbox on the laptop (no live moments). The guide says to use one browser. P3-b fixes it |
| E9 | Judge never speaks, taps Finish at once | Session ends; debrief shows the 2 carried questions; Generate still works (template) |
| E10 | Judge speaks nothing work-related | Same as E9; NON_WORK lines are blanked (existing) |
| E11 | Judge forgets Finish | Auto-stop at 5:00 → debrief opens |
| E12 | Judge reloads during the session | No restore exists (decided 11 Oct, Rangga's default accepted pending his confirmation): the page is idle on reload, Start is offered, the drawer's rules area shows `C-script-reload` ("If this page reloads, tap Start again"), and the orphaned server session hard-stops at its own start + 5 min |
| E13 | Judge taps Batalkan | Session discarded, segments deleted (existing); Mulai offered again; drawer back to `before` |
| E14 | Second Mulai after a finished demo day | `day_ended` copy "Demo day finished…"; "Start a fresh demo" on `/sign-in` gives a new day |
| E15 | Mic denied | Existing mic-error state; drawer shows the rules card text "Allow the microphone to continue" |
| E16 | Judge at 00:30 WIB | `businessDateOf` = previous calendar day; the shift targets anchor − 1, so the session date is still > template's last day |
| E17 | Template not READY | Not deployable: the runbook stops at Task 3. The clone itself does not check (no extra read on every visit) |
| E18 | Segment cap (60) hit | Existing `demo_cap` handling; drawer unaffected; status line shows the upload state truthfully |
| E19 | Live moments not yet processed when Supervisor opens `/day` | Day shows template days + whatever is processed; refresh shows more. Nothing blocks Generate |
| E20 | Carried question answered after the judge's debrief ends | Existing `not_in_debrief` / expiry behaviour |
| E21 | `?as=foo` | Ignored; default role |
| E22 | Already-paired real shop phone opens `/sign-in` (pilot) | Staff panel shows "This phone is already connected. Open capture" |

## 7. QA (independent, live, zero tolerance) and manual checks

**Unit/integration:** every `*.T*` above, gates via the pre-push hook.

**Live on `bee6-playground` (demo project only; always echo `--project`):**
1. **Pilot-face check:** run the build locally with `DEMO_MODE` unset → `/` redirects; `/sign-in` has no demo text;
   the network panel shows no `/api/v1/demo/*` call and no demo chunk. The pilot project itself is not touched.
2. **Judge path, 3 runs on phone (Android Chrome, 360 px) + 2 on laptop Chrome, each in a fresh profile:** sign in
   with `000000`, read the script, Finish, answer, Supervisor, Generate, Feasible, Owner approve, fast-forward. Time
   each step. **Pass:** Generate returns a proposal on every run without changing the date range; the whole path
   takes ≤ 10 min with the 4-min staff part.
3. **Latency measurement (Finding 7), 5 runs at different offsets from the even minute:** record t0 = Finish tap
   (DevPanel/event log), t1 = last segment `PUT` 200 (Cloud Logging, filtered by the sandbox id), t2 = the tick
   start log after t1, t3 = thread `created_at_ms`, t4 = question `created_at_ms` (read-only Firestore query by
   `outlet_id`), t5 = visible on `/day`. Report p50/max of `t4 − last spoken word`. **Expected:** p50 about 2 min,
   max ≤ 4 min. Over 5 min → recommend P3-a.
4. **Script fidelity:** 3 runs in EN, 2 in ID, 1 in own words. For each card record: transcribed (yes/no), thread
   category, fact/question/dropped. Compare with `expect`. **Acceptance:** card 6 (phone call) yields a question in
   ≥ 4/5 runs; card 7 (hypothetical) never becomes a fact; card 8 never appears as text in `/day`. Wording changes
   go to Task 12, never code.
5. **Profile isolation:** sign in to the shared `demo-outlet` with its real paired phone → no drawer, normal window
   rules.
6. **Reserved code:** call the pair route with `000000` on the demo project → unknown-code response; logs show no
   lookup.
7. **Time shift:** in a fresh sandbox, `/day` "yesterday" and the day before show the template days with local times
   identical to the template's.

**Manual (Rangga or Tiffany, physical):** an iPhone Safari run (WebCodecs Opus/AudioWorklet support on iOS is the
largest unknown; if it fails, the guide says "Android Chrome or desktop Chrome"); a run on hotel-grade Wi-Fi.

## 8. Preconditions and outside-the-code steps
1. R-12 PR-B merged (P1 only).
2. Tiffany's clips seeded into the template (R-12 Task 3) **after P0 merges and deploys**, then the Task 3 readiness
   check READY. If NOT READY: re-cut the clips, have dev-ops delete the template data, re-seed (corrected Task 3.4).
3. Tiffany reviews the ID column and the script wording against her clip script page.
4. Judge guide and clip script page updated (§9.4) after the build is final, before submission.
5. No infra changes. No new env, secret, index or TTL.

## 9. Effort, phasing, routing, recommendation

### 9.1 Hours

| Phase | Server | UI | Tests (inside) | Total | Routing |
|---|---|---|---|---|---|
| P0 clone shift + reserved code + readiness | 2.5 | 0 | yes | **2.5 h** | `developer` |
| P1 role sign-in + demo credentials | 0.25 | 5.75 | 1.0 | **7.0 h** | `developer`; 4.1–4.2 and 7a `developer-junior` |
| P2 profile + drawer + carry-over + refresh | 3.25 | 4.75 | 2.0 (+1.0 live tuning) | **11.0 h** | `developer`; 11.1–11.2 `developer-junior` |
| P3 optional | 2.5–5.5 | – | – | 0.5–5.5 h | `developer` + security-reviewer |

Add about 30–40 % for tech-lead and QA rounds (the R-06…R-12 history): **P0+P1+P2 ≈ 27–29 h wall-clock agent time.**

### 9.2 Against the calendar (Sun 11 → submission Sun 18 Oct)
The queue before R-18: R-12 PR-B fixes/merge, R-14 README, develop → main promotion, live QA on the demo project,
infra go items, Tiffany's clips and the template seed. Proposed order:
- **Mon 12:** P0 (independent, small) in parallel with R-12 PR-B's final fixes. Merge P0 **before** the template is
  seeded (the shift and the readiness check are needed to seed and verify once).
- **Mon 12–Tue 13:** P1 after PR-B merges. P2 in parallel (no shared files with P1 except `lib/i18n/dict.ts`: separate
  key blocks, merge second with a rebase).
- **Wed 14:** template seed + READY; live QA §7 runs 2–4; Task 12 tuning.
- **Thu 15:** develop → main promotion; the judge guide and clip page rewritten; R-14 README (mention simulated
  timing: time-shifted history, carried-over questions, fast-forward).
- **Fri 16–Sat 17:** buffer, the video, P3 only if everything is green.

### 9.3 What is demo-credible at each stopping point
- **P0 only:** R-12 PR-B's "Try as" flow works for every judge date (without P0 it fails after ~7 days). The Staff
  step is the re-armed debrief (no speaking). **Minimum to ship.**
- **P0 + P1:** the official three-role sign-in with the published demo credentials; the pilot looks like a real
  product. Staff still answers seeded questions only.
- **P0 + P1 + P2:** the full story Rangga asked for: the judge speaks a guided 4-minute day, sees their own moments
  join the record, and the proposal is guaranteed by the seeded history.
- **Recommendation:** commit to **P0 + P1 + P2**, with P0 first and non-negotiable. If by Wed 14 noon P2 has not
  passed tech-lead review, ship P0 + P1 and keep the guide on the "answer seeded questions" path. **P2 must not be
  half-shipped** (a drawer without the profile cannot start a session for most of the day). Skip P3 unless QA's
  latency is over 5 min.

### 9.4 Changes the published pages need (written from the design; diff against the live pages)
**Judge guide:**
- Replace every "Try as Staff / Supervisor / Owner" with "Sign in as …" and the credentials table (§1.1), with the
  line "Each sign-in opens your own private copy for 2 hours. Nothing you do affects anyone else."
- **Do the whole path in one browser** (phone recommended for Staff; laptop works too, its mic is used). Supported:
  Android Chrome, desktop Chrome (and Safari/iOS only if the manual iPhone run passes).
- Staff step: "Tap Start, read the cards in the script panel (about 4 minutes), tap Finish. The demo stops by itself
  after 5 minutes."
- Set expectations: "Your own moments appear in the day record 2–4 minutes after you finish. Two questions from
  earlier demo days are there at once. The proposal uses the shop's earlier days plus yours."
- A **simulated timing** note: the earlier days are moved to sit just before today; the review date is
  fast-forwarded.
- Remove any step that says the debrief is available immediately after sign-in (that is R-12's re-arm, now
  replaced).

**Clip script page:**
- Mark the 5 clips as the **template's earlier days** (seeded once, Bahasa) and add the live `bakery-v1` card table
  (EN with the ID column) as "what the judge says today".
- State which clips must produce automatic facts (ROUTINE_OPS / CUSTOMER_SERVICE / STAFF_CONSULT on both days) for
  the readiness check, and that a NOT READY result is fixed by supervisor confirmation, not by editing data.

## 10. Hard-rule checklist (how this plan meets each)

| Rule | How |
|---|---|
| #1 Google only | No new AI call. P3-a reuses `runTick` (Gemini via `@google/genai`) |
| #2 No audio in the cloud | Drawer never touches audio; capture path unchanged; no new logs of bodies |
| #2a On-device queue | Untouched (`NEXT_PUBLIC_DEVICE_AUDIO_QUEUE` unchanged) |
| #3 Redact before storing | Unchanged: live lines and answers take the existing SDP path; the clone copies already-redacted text and never edits it (1.T3) |
| #4 Real data only on paid GCP | Demo project only; fictional script; no AI Studio |
| #5 Regions | No location touched |
| #6 No browser Firestore | All new flows use existing API routes; role/outlet from claims/device doc |
| #7 People data | Script contains no names (11.1 test); carried questions carry no new fields; answers keep the device id only; demo emails are not people and never become accounts (7a.4) |
| #7a/#7b | Unchanged |
| #8 Public repo | Script, credentials and SOP are fictional; clips stay in `private/` |
| #9 SOP only via proposals | Unchanged path (proposal → supervisor → owner) |
| #10 Evidence gate is plain code | No change to gate, thresholds or floor; the readiness remedy is the real supervisor-confirm gate path; the shift and carry-over move timing only; `expect` is never read by code |
| #11 Small commits | Three PRs, small commits per task |

## 11. Questions for Rangga

- **Q-1 (decides P0):** Is the **whole-day time shift** of the cloned history acceptable under T-703, disclosed as
  simulated timing like Q-2? Default: yes. Without it, Generate stops working for judges about a week after seeding,
  and entirely after about 14 days. (Alternative: re-seed the template every 5 days from your machine until 6 Nov.
  That is manual, and it fails silently if missed.)
- **Q-2:** **Carry-over of 2 earlier-day questions** into the judge's own debrief, shown with an "Earlier day" chip,
  replacing R-12's "debrief open at sign-in". Default: yes. Alternative: no carry-over; the debrief waits for the
  judge's own questions (empty for the first 2–4 min, and empty for good if the judge said nothing work-related).
- **Q-3:** If the template is **NOT READY** after seeding, is it acceptable that you (as the template's supervisor)
  confirm threads through the real `/day` confirm, so every sandbox starts with supervisor-confirmed facts? Default:
  yes (the real gate v3 path). Alternative: re-record clips until automatic facts pass.
- **Q-4:** Demo credentials: `000000`, `supervisor.judge@example.com`, `owner.judge@example.com`, password
  `bee6-demo`. OK, or other values? (The domain must stay `example.com` or a domain you own; never `gmail.com`.)
- **Q-5:** Session length: hard stop at **5:00** with a ~4-min script. Or 4:30?
- **Q-6:** Script language: follow the page language (EN default), with ID as the second column. Default: yes. If QA
  shows English labelling is weak, switch the default to Bahasa?
- **Q-7:** Pilot `/` → redirect to `/sign-in` (replacing "scaffold in progress"). Default: yes.
- **Q-8:** The fast lane (P3-a) includes a generic windowing change: "a window closes at session end". It also
  speeds up the pilot's debrief by about 90 s. Build it only if QA's worst case is over 5 min? Default: yes, only then.
- **Q-9:** Cross-device join code (P3-b) after submission, with the guide saying "one browser" for now? Default: yes.
- **Q-10:** Staff panel on the pilot is the pairing code (the real staff entry in MVP 1; no staff sign-in exists).
  Wording "Enter the 6-digit code from your supervisor". OK?

## Result

*(Filled in after the build.)*

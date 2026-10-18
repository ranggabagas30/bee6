# Demo feedback 2 — round 3 (items 9–16): design pass

Tech-lead design pass, Sun 18 Oct (submission day). Read against `origin/develop` 7e895df (read-only worktree
`../bee6-fb5`). Source: `docs/internal_testing/demo-feedback-2.md`, items 9–16 (all OPEN). No code was edited.
Every `file:line` below is on 7e895df.

**Recommendation in one line:** three PRs, merged in order PR1 (items 9, 11, 15, 16) → PR2 (items 12/13/14) → PR3
(item 10, sandbox-only, `developer` + `security-reviewer`). PR1 and PR2 are mechanical (`developer-junior`), ~3 h wall
for both including review, QA and two traffic switches. PR3 is a go/no-go for Rangga against the submission cut-off
(≈ 4–5 h wall); if it cannot start with that much clock left, defer it and keep the UI-113 known gap.

---

## Item 9 — open the Judge Guide by itself at Mulai (staff phone)

**Today.** `app/demo/JudgeGuide.tsx` L289–298: on every page-driven card change the guide **collapses** (`setOpen(false)`),
except `capture_listening → capture_all_spoken`. Start flips the bridge phase `ready → listening`
(`lib/demo/guide.ts` L596–600, `app/capture/page.tsx` L736–739), so Mulai closes the guide — the opposite of what Rangga
wants. The only auto-open is the entry page at ≥ 900 px on first visit (L214–221, `WELCOME_SEEN_KEY`).

**Quick win = the change (no "ultimate" needed).** In the L290 effect, before the `sameFlow` line:

```ts
const startedListening = prev.pathname === pathname && prev.key === "capture_ready" && key === "capture_listening";
if (startedListening) { setOpen(true); return; }
```

Both widths. Phone: the sheet opens over the stage; the upload line is already in the top slot (finding 3, done) so the
judge still sees "Uploading"; End is under the sheet (already accepted: `collapseOnOutsidePointerDown`). Laptop:
`SidePanel` moves focus to its close button on open (`app/ui/SidePanel.tsx` L37–39) — fine here, nothing to type after
Start. `autoOpened` stays false so `WELCOME_SEEN_KEY` and the auto-open Escape handler are untouched.

Edge cases: reload mid-session → `prevRef` starts at the current key, no transition, stays collapsed (correct). Day 2/3
Mulai → opens again (wanted: the script card is the reason to open). `listening → closing` still collapses as today.
`open_session` (other device holds the day) never transitions to `listening` on this device.

Files/tests: `app/demo/JudgeGuide.tsx` (3 lines); `app/demo/JudgeGuide.test.tsx` add: (a) phone, bridge phase `ready`
then `listening` → sheet open (`aria-expanded="true"` on the handle / body visible); (b) same at wide → panel open;
(c) `listening → closing` still collapses; (d) first render already `listening` → collapsed. Estimate 0.5 h.
`developer-junior`. Risk: none on hard rules.

---

## Item 11 — "Check for new questions": what it is, remove it

**Today.** R-18's manual refresh (`app/capture/debrief/CheckNewButton.tsx`; rendered by `QuestionScreen.tsx` L238 only
when `onCheck` is set, which `DebriefFlow.tsx` L519 sets on sandbox only). Since R-19 the flow **polls by itself**
every 10 s (`REFRESH_POLL_MS_DEMO`) while `preparing` / `waiting_more` / a question is on screen and the server still
says `preparing` (`DebriefFlow.tsx` L257–272); once the server stops preparing "nothing new can arrive" (its own
comment L249–251). The button is therefore redundant and, as Rangga found, unexplained. **Remove it.**

Files: delete `app/capture/debrief/CheckNewButton.tsx`; `QuestionScreen.tsx` drop the import (L13), the `onCheck` /
`checking` props (L36–38, L56–57) and L238; `DebriefFlow.tsx` drop `checking` state (L220), the `manual` parameter and
`lastCheckAtRef` / `REFRESH_MIN_INTERVAL_MS` branch (L222–246 → `refreshQuestions()` with no argument; keep the
in-flight guard, the `!res.ok` return and the `finally`), L13 import, L519–520; `lib/debrief/constants.ts` delete
`REFRESH_MIN_INTERVAL_MS` (L44–45); `lib/i18n/dict.ts` delete `C-script-check-new` and `C-script-checking` (ID + EN);
`lib/i18n/dict-script.test.ts` L9 drop the two keys. Tests to update: `QuestionScreen.test.tsx`, `DebriefFlow.test.tsx`,
`app/capture/page.test.tsx` (every case that queries the button or `checking`). `lib/debrief/reason.ts`,
`service.ts`, `lib/proposals/review-*.ts` only contain the word "checking" — do not touch.

Risk: a question created by a late tick after `preparing` went false is no longer fetchable by a tap; the 10 s poll
already stopped in that case, and the R-19 design (`PREPARING_MAX_MS`) bounds it — accepted. Estimate 0.75 h.
`developer-junior`.

---

## Item 15 — centre the sign-in form

**Today.** `app/sign-in/sign-in.module.css` L7–14 `.screen { width: 100%; max-width: 440px; display: flex; … }` inside
`main.b6-main` (`app/web/shell.module.css` L120–130: a flex **column**, `align-items` default = stretch). A 440 px
block in a column flex container with no auto margins sits at the left edge from ≥ 472 px of main width — that is what
Rangga sees on a laptop. At 360 px main's inner width (328 px) is below 440, so nothing changes there.

**Change.** `.screen` add `margin: 0 auto;` (auto margins centre a max-width item on the cross axis of a column flex
container). Nothing in `app/globals.css`; no `@media`; no `!important`. With the Judge Guide panel open at ≥ 900 px the
body gets `padding-right: var(--b6-panel-w)` and main shrinks, so the form centres in the remaining width — correct.
The h1 / kicker stay left-aligned inside the centred 440 px column (ask Rangga if he wants `text-align: center` on
them too; default no).

Files/tests: `sign-in.module.css` (1 line); add `app/sign-in/sign-in-css.test.ts` (same pattern as
`app/sop/sop-table-css.test.ts`): the `.screen` block contains `margin: 0 auto`. Estimate 0.25 h. `developer-junior`.
QA: 360 × 640 unchanged; 1280 wide: form centred with the panel collapsed and open.

---

## Item 16 — SOP versions: drop "upcoming", "current" only on the version in use

**Today.** `app/sop/SopApp.tsx` L46–58 `versionLabel`: `version === in_force_version → "{date} · current"`,
`version > in_force → "{date} · upcoming"` (`lib/i18n/v2/sop.ts` L27/L79), older → plain date. Why "upcoming" exists:
`lib/sop/ship.ts` L36–38 — a shipped version is effective **tomorrow** (`addDays(localDate, 1)`), so right after the
owner approves, `latest` (v2, dated tomorrow) is not in force and `in_force_version` is still v1
(`lib/sop/service.ts` L98, `lib/sop/in-force.ts` L23–31). The switch lists versions by `effective_from_date`
(`app/sop/versions.ts` L64–87); the **newest is selected by default** (L86). The header sentence "Version 2 starts on
… Until then, version 1 applies." (`C-sop-version-pending`) is **suppressed whenever the switch is shown** (L72, R-21
O-5 "board-literal, option (a)").

**Semantic risk, stated plainly.** After approval the owner lands on v2 (selected by default, dated tomorrow, showing
v2's steps) while the "· current" mark sits on v1's tab. With "upcoming" gone and the pending sentence suppressed,
nothing on the page says v2 is not live yet. In the demo this is exactly the screen a judge sees after "Approve", so it
matters there most.

Options:
- **(A) literal (Rangga's words):** drop the `upcoming` branch → plain date; keep "· current" on the in-force version.
- **(B) A + re-enable the pending sentence** when the newest version is not in force: `headerLine` L72 delete
  `if (hasSwitch) return null;`. One existing bilingual line carries the meaning "upcoming" used to; nothing new to
  write. Deviates from board D2-04 by one line of text.
- **(C) A + default-select the in-force version** (`useState(data.in_force_version ?? newest.version)`): the owner
  opens on what applies today and switches to v2 by its date. Hides the thing the owner just approved — worse for the demo.

**Recommendation: B.** Ask Rangga to confirm A vs B.

Files/tests: `SopApp.tsx` L48/L56 (and L72 for B); delete `C-sop-book-upcoming` ID + EN in `lib/i18n/v2/sop.ts`;
`SopApp.test.tsx` cases asserting "upcoming" → plain date (and for B: the pending sentence shows with ≥ 2 versions when
`in_force_version < latest.version`, hidden when equal). Estimate 0.5 h. `developer-junior`. Hard rules: none
(read-only screen; rule 9 untouched).

---

## Items 12, 13, 14 — after sign out: land on `/`, no Staff/Supervisor/Owner tabs

**Today.** `app/web/SignOutButton.tsx` L24 `router.replace("/sign-in")`. Bare `/sign-in` on demo renders
`RoleSignIn` with `initialRole = "staff"` (`app/sign-in/page.tsx` L17) and the three radios (`RoleSignIn.tsx`
L191–213; solo mode only for `?as=supervisor|owner`, L83). The same bare URL is where every 401→refresh→401 expiry
bounce lands (`router.replace("/sign-in")` in `app/home/HomeApp.tsx` L48/L65, `SopApp` L158/175, `DayRecordApp`,
`ProposalsApp`, `QueueApp`, `ReviewsApp`, `DevicesApp`, the proposal panels — 20 call sites). Prior plan D2/Q5 kept
the tabs for exactly that reason; Rangga has now overruled it (a fresh incognito window restarts the session).

**Change (quick win = ultimate; one file).** Decide it on the server in `app/sign-in/page.tsx`, which already reads
`DEMO_MODE` and `?as` at request time:

```ts
const role = parseSignInRole(as);
if (demo && role === "staff") redirect("/pair");   // the staff entry on demo is /pair (R-19 PR-6)
if (demo && role === null) redirect("/");          // bare /sign-in, or an invalid ?as, never renders on demo
return <SignInScreen config={…} demo={demo} initialRole={role} />;   // pilot: unchanged (null → the chooser)
```
(`redirect` from `next/navigation`, placed after `await searchParams`; it throws, so nothing renders. Builder: confirm
`redirect()` inside a server page during a client `router.replace` navigation against
`node_modules/next/dist/docs/` — the App Router follows it in the RSC response; no `window.location` needed.)

Why this and not editing `SignOutButton`: the button does not know `DEMO_MODE`, the 20 bounce sites do not either, and
item 12 needs the **bare** URL itself to stop showing tabs on demo. One server rule makes every path converge:
Sign out → `/sign-in` → `/`; expiry bounce → `/sign-in` → `/`; typed `/sign-in` → `/`; `?as=staff` → `/pair`;
`?as=supervisor|owner` → the solo form as today (finding 4). `SignOutButton.tsx` stays as is (one extra hop, ~50 ms).

**Everything that relied on `/sign-in` being the landing — re-examined:**
- *"Your demo session has ended" line*: it lives in `DemoAccess` (non-bare, L88–91) and shows on the solo pages, and
  `DemoBar` is hidden on `/` and `/sign-in` (`DemoBar.tsx` L67). An expired judge now lands on `/` and sees the entry
  page with **no ended line** — which is what item 1 (DONE) asked for on `/`. When they tap "Open supervisor view" the
  solo page says "Your demo session has ended." next to the guide's credential card, and a typed/filled credential
  starts a fresh sandbox (`useDemoStart(config, "restart")`). The ended cleanup still runs: `DemoBar`'s
  `closeEndedDemo` effect (L54–56) runs before its `shown` return, on every path including `/`, and `SignInScreen`'s
  `removeDeviceKeys` still runs on the solo pages. **Ask Rangga to confirm:** no ended line on `/` for an expired session
  (consistent with item 1), or one quiet line on `/` only while `expired` (would reverse item 1).
- *Back button*: `/day` → Sign out → `replace` → `/`: history is [`/sign-in?as=supervisor`, `/`]; Back shows the solo
  form for a signed-out user. No loop: `app/page.tsx` L15 redirects `/ → /sign-in` only when `DEMO_MODE !== "true"`,
  the new rule redirects `/sign-in → /` only when it is — mutually exclusive.
- *Pilot*: `demo` is false → no redirect, chooser and tabs unchanged, `app/page.tsx` still sends `/` to `/sign-in`.
- *Entry footnote* "To change role later: sign out, then pick a role again." (`lib/demo/guide.ts` L142/154/166) and the
  guide lines "Sign out, pick Staff…" (L309, L337, L483) now describe the screen literally — keep.
- *`first-paint.ts`* L24 still reserves the panel on `/sign-in` for the solo pages — keep. *`FeasibleHandover`* →
  `/sign-in?as=owner` — unaffected. *`RoleSignIn` redirectSignedIn* (L102–106): a still-signed-in user on a solo page
  goes to their start page; after Sign out there is no user — unaffected.
- *`RoleSignIn`'s radio group* becomes unreachable on demo (dead on demo, live on the pilot) — leave it; do not delete.

Files/tests: `app/sign-in/page.tsx` (+5 lines); `app/sign-in/page.test.tsx`: mock `next/navigation` `redirect` to throw
a sentinel; add demo + no `as` → `redirect("/")`, demo + `as=nonsense` → `/`, demo + `as=staff` → `/pair`,
demo + `as=supervisor|owner` → renders with that `initialRole`; the existing "demo → Staff preselected" case (L30–38)
becomes the `/pair` redirect case; pilot cases unchanged. `RoleSignIn.test.tsx` "demo + null keeps the three radios"
stays as a component test (note in its title that the page never renders it on demo). `SignOutButton.test.tsx` unchanged.
Estimate 0.75 h. `developer-junior`. Hard rules: none (rule 6 untouched: no data; the pilot path byte-identical).

---

## Item 10 — show the flagged line on the debrief question (privacy analysis + recommendation)

### What the "design" says — there are two, and they disagree
- `docs/tasks/UX-03-journey-design.md` §3 rule 6 (L190) "Question text is a template", §4 hard-rule checks (L200) "No
  transcript or quoted thread line on the phone. Debrief questions are templates.", §5.8 (L466–467) "Never a name, role or
  quoted thread line." — the journey design forbids it.
- The R-25 page-2 board P2-09 / L2-08 shows a moment-specific line ("…the egg tarts were fresh"); R-25 ruled it **UI-113,
  deferred** (`docs/tasks/R-25-ui-fidelity.md` L513: "the thread summary is not on the wire … needs the gate + security
  pass") and the phone kept the template; `docs/HANDOFF.md` L7 carries it as a known gap.

Rangga's "follow the design" means the board. That is a **product-owner reversal of a UX-03 hard-rule check**, not a
bug fix: if PR3 ships, UX-03 §3/§4/§5.8 and the technical specification §8.10 must be amended in the same PR (one line
each: "a sandbox debrief question may quote up to two already-redacted, name-scrubbed lines of the device's own
thread"). CLAUDE.md §1 makes the technical specification win on data behaviour, so the spec line is the one that counts.

### Current wire and screen
`GET /api/v1/questions` device branch (`app/api/v1/questions/route.ts` L35–52): `requireDevice` → `listDebriefQuestions`
(`lib/debrief/service.ts` L93–136) → `DebriefQuestionViewSchema` `.strict()` = `{question_id, kind, category, start_hm,
end_hm, business_date?}` (`lib/debrief/contract.ts` L35–49). The service re-scopes every question to
`claims.device_id` + `claims.outlet_id` (L106). The route's log callback receives counts only (route L45–46, service
L92/L127). The phone (`QuestionScreen.tsx` L81–83, L155–162) renders `questionLines` (template `C-d-q-step` "Around {hm}
there was {step}. Is that right?") and `questionWhy` (one fixed sentence per category). Thread text sits in
`threads/{id}.lines[].text` (`lib/firestore/schema.ts` L472–480, L499–544) with `evidence_line_ids`; a `gate` question
carries `thread_id` (L554–571); an `unlabelled_unit` question has `thread_id: null`.

### Privacy analysis against the hard rules
| Rule | Touch | Verdict |
|---|---|---|
| #2 no audio | none — text only; nothing new is stored anywhere | clean |
| #3 redact before store | thread lines are SDP-redacted at ingest (`lib/capture/segment-service.ts` L20, L105; infoTypes include `PERSON_NAME`, `lib/redact/dlp.ts` L40). We return **stored, already-redacted** text; no new write, no new SDP call | clean |
| #6 no browser→Firestore | stays on `GET /api/v1/questions` behind `requireDevice` (outlet + device claims); the thread read must be re-scoped `thread.outlet_id === claims.outlet_id && thread.device_id === claims.device_id` or no lines are returned | clean if the scope check is in the service (test it) |
| #7 names only in `staff` | **the gap.** The dedicated staff-name scrub over thread text is not shipped (technical specification §8 gap table L448; CLAUDE.md 7a "any staff-name scrub must cover thread line text"). SDP `PERSON_NAME` catches most but not nicknames. Mitigation: scrub **at read time** with the existing `scrubReason(text, store.listStaffNames())` (`lib/debrief/scrub.ts` L33 — the same function the answer path uses at `service.ts` L222–229); never persisted; if `listStaffNames()` throws, return **no lines** (fail closed, never unscrubbed text) | acceptable with the read-time scrub; residual = a name not in `staff`, the product's existing residual |
| #7a retention 14 d | read inside the 1 h debrief, well inside any retention; the phone keeps the lines in React state only — the answer cache (`AnswerCacheEntrySchema` `.strict()`, L79–95) stays text-free; no localStorage/IndexedDB write | clean |
| who sees it | whoever holds the paired phone — the device that recorded the line, its own thread (device-scoped). Supervisors already see thread text on `/day`; this is a narrower exposure, not a new class | acceptable; still, this is the first device route that returns stored text → `security-reviewer` must pass it |
| logging | the service's `log` receives counts only today; add a test that no call carries `lines`/text; `handleApiError` never echoes payloads | clean |

### Design decisions (if Rangga says go)
- **Sandbox-only today (the "flag").** Gate on the store's existing `calendar.sandbox === true` exactly like
  `business_date` and `preparing` (service L120, L125): the pilot response stays byte-identical, so the UX-03 rule and
  the 7a scrub gap are not touched on the pilot. Extending to the pilot is a separate decision after the 7a scrub lands.
  No new env var.
- **Wire.** `DebriefQuestionViewSchema` + `lines: z.array(z.string().min(1).max(QUESTION_LINE_MAX_CHARS)).max(QUESTION_LINES_MAX).optional()`
  (`.strict()` kept — the existing `contract.test.ts` L146 loop that rejects an extra `text` key stays green);
  constants `QUESTION_LINES_MAX = 2`, `QUESTION_LINE_MAX_CHARS = 160` in `lib/debrief/constants.ts`. Absent when there is
  nothing to show (pilot, `unlabelled_unit`, no thread, scope mismatch, scrub unavailable).
- **Which lines.** `thread.lines` filtered to `evidence_line_ids` (the lines the gate counted), in `start_ms` order; if that
  set is empty, the first lines of `thread.lines`; drop blank/whitespace lines; take 2; truncate each to 160 code points
  with "…" (`Array.from`, like `reasonLength`). `unlabelled_unit` → no lines (its text lives in segment docs; not today).
- **Store.** `DebriefStore` + `getThread(thread_id: string): Promise<Thread | null>`; Firestore impl in
  `lib/firestore/debrief-store.ts` (`threads()` helper exists, L60): `doc.get()` + `ThreadSchema.safeParse`, parse failure
  → `logSkippedDoc` + `null`. One read per gate question, ≤ `DEBRIEF_LIST_SERVER_CAP` (10); one `listStaffNames()` per
  request, only when ≥ 1 gate question has a thread.
- **Screen (which of time / category / line / why).** Keep the chip, the time and the template heading as they are. Where
  `lines` is present, the quoted line(s) **replace** `questionWhy` (the board's explanation line is the moment-specific
  one); where absent, `questionWhy` stays. Render each line as a plain text node inside a `<p className={css.heard}>`
  with a visible lead-in — never through `t()` interpolation, never HTML (same rule as `SopVersionSteps`). Copy
  (`lib/i18n/v2/debrief.ts`): `C-d2-heard` EN "Bee6 heard:" / ID "Bee6 mendengar:"; each line in typographic quotes.
  The radiogroup `aria-label` (L165) stays `questionText` (template only), so the quote is read once, in the card.
- **Template.** The heading template is unchanged (`C-d-q-step`). The question remains role-agnostic and the line text is
  the only moment-specific element.

### Files and tests
`lib/debrief/contract.ts`, `lib/debrief/constants.ts`, `lib/debrief/service.ts` (+ `getThread`, sandbox branch, read-time
scrub, truncation), `lib/firestore/debrief-store.ts`, `lib/i18n/v2/debrief.ts`, `app/capture/debrief/QuestionScreen.tsx`
(+ `debrief.module.css` `.heard`), `docs/specs/technical-specification.md` §8.10, `docs/tasks/UX-03-journey-design.md`
§3/§4/§5.8 (one amending line each). Tests: `contract.test.ts` (optional `lines`, max 2, ≤ 160 cp, extra keys still
rejected); `service.test.ts` (sandbox: evidence lines in order; fallback to first lines; scrubbed names; wrong
device/outlet thread → absent; thread parse failure → absent; `listStaffNames` throws → absent and the rest of the
response intact; `unlabelled_unit` → absent; **pilot response has no `lines` key and is deep-equal to today's**; the log
callback never carries `lines`); `app/api/v1/questions/route.test.ts` (device branch on a sandbox fixture returns lines;
error path echoes nothing); `QuestionScreen.test.tsx` (quote rendered as text, `<b>` in a line stays literal; falls back to
`questionWhy`; `aria-label` unchanged); `lib/debrief/flow.test.ts` unchanged (the view is passed through).
Fixtures: `lib/demo/testing/fixtures.ts` `threadDoc` already has `lines` + `evidence_line_ids`.

### Effort, risk, recommendation
`developer` (sonnet) 2.5–3 h including tests; tech-lead review; `security-reviewer` pass on service + store + contract
(mandatory: first device route returning stored text); QA live on the phone (a line appears under the question for the
judge's own spoken card; nothing in the answer cache; no text in Cloud Run logs). ≈ 4–5 h wall, zero slack, and it
conflicts with PR1 in `QuestionScreen.tsx` (rebase after PR1). **Recommendation: do it with the flag (sandbox-only)
as PR3, only if PR1 and PR2 are merged and switched with ≥ 5 h left before the submission cut-off; otherwise defer and
keep the UI-113 known gap.** Rangga decides; name the cut-off time.

---

## PR grouping and order

| PR | Branch | Items | Files (disjoint?) | Builder | Build + tests | Wall (review + QA + switch) |
|---|---|---|---|---|---|---|
| **PR1** | `fix/demo-feedback-2-round3-small` | 9, 11, 15, 16 | `JudgeGuide.tsx`(+test), `CheckNewButton.tsx` (delete), `QuestionScreen.tsx`(+test), `DebriefFlow.tsx`(+test), `app/capture/page.test.tsx`, `lib/debrief/constants.ts`, `lib/i18n/dict.ts`, `dict-script.test.ts`, `sign-in.module.css`(+css test), `SopApp.tsx`(+test), `lib/i18n/v2/sop.ts` | `developer-junior` | ~2 h | ~1.5 h |
| **PR2** | `fix/demo-feedback-2-signout-entry` | 12, 13, 14 | `app/sign-in/page.tsx`(+test) — disjoint from PR1 | `developer-junior` | 0.75 h | ~1 h |
| **PR3** | `feat/demo-feedback-2-question-lines` | 10 | listed above; **overlaps PR1 in `QuestionScreen.tsx`** → cut after PR1 merges | `developer` + `security-reviewer` | 3 h | ~2 h |

Order: PR1 first (the most judge-visible fixes). PR2 may be **built** in its own worktree while PR1 is in review (file-
disjoint) but is merged and switched only after PR1's switch (one at a time on `web-develop`). PR3 starts only on Rangga's
go. Each merge: auto-merge to develop → dev-ops switches `web-develop` traffic → findings set to READY FOR TESTING.

Skills for the briefs: PR1/PR2 `developer-junior` with `react-patterns`, `react-testing`; PR2 also `nextjs-turbopack`
(verify `redirect()` in `node_modules/next/dist/docs/`); PR3 `developer` with `api-design`, `security-review`
(security-reviewer runs it), `ux-copy` for `C-d2-heard`.

## Questions for Rangga
1. Item 16: option A (date only) or **B** (date only + the existing "Version 2 starts on … Until then, version 1 applies."
   sentence back under the switch)? Recommended B.
2. Item 13/14: confirm an expired session landing on `/` shows **no** ended line (consistent with item 1). Yes/no.
3. Item 15: form centred only (recommended), or also centre the "Sign in" heading and kicker text?
4. Item 10: go / no-go for PR3 today, sandbox-only — and the submission cut-off time to measure the ≥ 5 h rule against.
   Confirm the UX-03/tech-spec amendment is acceptable (this reverses UX-03 §4 "no quoted thread line on the phone" for the
   sandbox only).
5. Item 9: open the guide on **every** Mulai (days 1–3; recommended) or the first only?

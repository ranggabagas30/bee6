# R-25 regression fixes (QA R25-002 / R25-003 / R25-004)

Tech-lead rulings and literal fix briefs for `developer` (sonnet). Written 17 Oct 12:20 WIB against `origin/develop`
`11b9149` (read-only worktree). Source: `docs/tasks/QA-r25-regression-17oct.md` §2. R25-001 is a separate brief
(`docs/tasks/R-25-idle-fix.md`, branch `fix/idle-expired-fallback`, in flight). Follow literally; flag a gap, do not
improvise. Skills: `react-patterns`, `react-testing`, `tdd-workflow` (failing test first).

Hard stop for new fixes 15:00, release PR 17:00. All three fixes together are ~1.5-2 AH; see §4 for the order.

## 0. Summary of rulings

| Id | Ruling | Judge severity | Fix size | Pilot risk | Ship before 15:00? |
|---|---|---|---|---|---|
| R25-002 open-session "End today" has no confirm | **Real functional bug** (spec §8 step 10(a) + 12; ruling R2). End gets the same `EndConfirmSheet`. **Cancel today stays direct** (see 1.1). | Low-medium: reached only by Sign out (closed) -> re-pair -> return; one tap ends the day with no warning | ~35 min (page.tsx only + 5 test edits + 3 new tests) | None: `open_session` exists only on a sandbox profile; the new state is never true on the pilot | **Yes** |
| R25-003 no header "Sign out" at >= 900 px | **Real board gap** (L2-01/02/03/09, R17). T5's "no Sign out in the header" (page.tsx L1415 comment) applied the phone board to the laptop. `StaffTopBar.signOut` was built for this in T4 and never wired. `/pair` is **deferred** (see 2.1). | Medium for a laptop judge (every state), but no function is missing (the footer link works) | ~40 min (page.tsx + 2 new tests) | None: the header is `modern`/sandbox-only; the pilot never renders `StaffTopBar` or the link | **Yes** |
| R25-004 guide still "Answer the questions" after the debrief timed out | **Real, transient (<= 30 s), and the same on a real 60-min expiry** (see 3.1). Not a clock-patch artefact; the patch only let QA look inside the 30 s window. | Low: only a judge who lets the debrief run 60 min idle, and the guide self-corrects within 30 s | 1 line + 1 test edit (~10 min) | None: `capturePhaseFor` runs only with `demo_session` | **Yes** |

`DEMO_MODE` unset: every change below is behind `sandbox` / `demo_session` / `demo`; the pilot DOM and handlers are
byte-identical. No route, no data, no model, no audio, no name (hard rules untouched).

---

## 1. R25-002: open-session End gets the confirm sheet

### 1.1 Ruling and why

- Technical specification §8 step 10: "Close triggered. Exactly one instant, the first of: (a) **'Yes, end' tapped in the
  Selesai confirm** (opening the panel is not a trigger) …". Step 12: "Both confirm panels state that it cannot be
  undone." R-25 ruling R2: "Confirm stays … the close instant is 'Yes, end tapped in the Selesai confirm'."
  `handleOpenEnd` (page.tsx L786) posts `/end` straight from the tap: the only End path in the app with no confirm.
  The R-19 PR-4b note "the page runs the existing end route" meant the route, not "skip the confirm". **Bug.**
- **Cancel today (interrupted session) stays one tap.** A discard never ends the day (spec §8: "A discarded session
  never ends the day, so Batalkan is the retake path"; Start is offered again right after), so step 12's "cannot be
  undone" does not apply; board P2-07c / L2-06c shows one action; the guide card `capture_open_session` says "Tap
  **Cancel today** … then Start today again". The running-session Batalkan's 3 s arming is a running-mic safeguard,
  not a rule for the recovery screen. Record as a board note, no code.
- The existing sandbox End sheet is reused as is: `EndConfirmSheet` (title "End today's operations?", body
  `C-script-end-b` "The 1-hour debrief starts now. This cannot be undone.", "Not yet, keep going" / "Yes, end").

### 1.2 `app/capture/page.tsx` (the only product file)

(a) New state next to `openBusy` / `openErrorKey` (the open-session block near L250):

```ts
  // R25-002: the open-session view's End confirm (spec §8 step 10a). Separate from `selesaiConfirmOpen`, which
  // belongs to the running session's sheet, so a stale flag can never open the wrong sheet after Start.
  const [openEndConfirm, setOpenEndConfirm] = useState(false);
```

(b) Render-time sync, directly under the existing `if (signOutKind === "running" && session === null)` block (L322-324):

```ts
  // R25-002: the 30 s config re-poll can drop the open session under the sheet (the server closed it): nothing to
  // end any more, so the sheet goes with the view.
  if (openEndConfirm && !demoSession?.open_session) {
    setOpenEndConfirm(false);
  }
```

(c) `handleOpenEnd` (L786-810): on success close the sheet BEFORE the view changes. Insert `setOpenEndConfirm(false);`
as the first line after `if (!result.ok) { ...; return; }`, i.e. immediately before `setLastEnded({ business_date: localDate, ...`.
On failure nothing else changes: `setOpenErrorKey(...)` already runs; the sheet stays open and shows it (d). Do not
touch `handleOpenCancel`.

(d) `renderIdle` open-session branch (L1014-1031) becomes:

```tsx
    if (openSession) {
      return (
        <>
          <OpenSessionView
            lang={lang}
            closingReached={openSession.closing_reached}
            busy={openBusy}
            // R25-002: while the sheet is open the error is shown in the sheet, not twice.
            errorKey={openEndConfirm ? null : openErrorKey}
            onEnd={() => {
              setOpenErrorKey(null);
              setOpenEndConfirm(true);
            }}
            onCancel={() => void handleOpenCancel()}
            dayLine={dayLine}
            footer={
              <>
                {renderNote()}
                {renderSignOutLink("muted")}
              </>
            }
          />
          {openEndConfirm ? (
            <EndConfirmSheet
              lang={lang}
              body={t(lang, "C-script-end-b")}
              busy={openBusy}
              errorKey={openErrorKey}
              onKeep={() => setOpenEndConfirm(false)}
              onEnd={() => void handleOpenEnd()}
            />
          ) : null}
        </>
      );
    }
```

`EndConfirmSheet` is already imported (L23). `OpenSessionView.tsx` is NOT edited (it already takes `onEnd`).
Not for the pilot: `demoSession?.open_session` is only ever set on a sandbox profile.

Edge cases, all covered by the above: busy tap twice (`openBusyRef` guard + `busy` on the sheet); End fails with
409/5xx (error in the sheet, "Yes, end" retried, sheet stays); session gone mid-sheet (b); Escape / "Not yet" (sheet
closes, view unchanged, `postSessionEnd` not called); sign-out link under the sheet (modal; not reachable).

### 1.3 Tests

`app/capture/page.test.tsx`, `describe("open-session view (plan 5.7a)")` and the one test outside it:

- Every existing test that does `fireEvent.click(await screen.findByRole("button", { name: "End today" }))` on an
  open-session config and then expects `postSessionEnd` (L1458, L1494, L1508, L1529, L1587 — confirm by grep) adds
  the next line `fireEvent.click(screen.getByRole("button", { name: "Yes, end" }));`. L1532 ("End today enabled
  again after a failed End") then asserts the error inside the dialog: `within(screen.getByRole("dialog")).getByRole("alert")`
  (or whatever `EndConfirmSheet` renders for `errorKey`; read the component) and that "Yes, end" is enabled again.
- New test 1: `it("End today opens the End confirm first; Not yet keeps the open session, nothing posted")`:
  `renderWithOpen(open({ closing_reached: true }))`; click "End today"; expect `getByRole("dialog", { name: "End today's operations?" })`
  with text "The 1-hour debrief starts now. This cannot be undone."; `expect(postSessionEnd).not.toHaveBeenCalled()`;
  click "Not yet, keep going"; `queryByRole("dialog")` null; `getByRole("button", { name: "End today" })` still there;
  `postSessionEnd` still 0 calls.
- New test 2: `it("Yes, end ends THAT session once (selesai) and the debrief follows")`: click "End today", click
  "Yes, end"; `waitFor(postSessionEnd toHaveBeenCalledTimes(1))` with the open session's `session_id` and
  `end_reason: "selesai"`; `queryByRole("dialog")` null; then "Preparing your questions" (copy the L1505 assertions).
- New test 3: `it("Cancel today stays a single tap (no confirm)")`: `open({ closing_reached: false })`; click
  "Cancel today"; `postSessionDiscard` called once; `queryByRole("dialog")` null. (Keeps 1.1 honest.)
- `app/capture/OpenSessionView.test.tsx`: unchanged.

---

## 2. R25-003: header "Sign out" from 900 px on `/capture`

### 2.1 Ruling and why

- Boards L2-01/L2-02/L2-03/L2-09 (QA §B, UI-019) put a `.btn2` "Sign out" beside the ID|EN segment from 900 px;
  ruling R17 made `StaffTopBar` the one component for both widths and T4 gave it `signOut` (hidden under 900 px by
  `shop.module.css` L51, shown from 900 px L90). T5 then rendered `<StaffTopBar demo outletLine />` with the comment
  "No Sign out in the header: the footer link is the only one" — that is R10's **phone** rule applied to the laptop.
  Gap confirmed.
- **Exactly one affordance at a time**, decided in JS, not CSS: `useDrawerLayout().wide` (page.tsx L210, the same
  `(min-width: 900px)` query the CSS uses). Wide: header button, no footer link. Narrow: footer link, no header
  button. jsdom has no `matchMedia` -> `wide` is false -> every existing test is unchanged.
- The header button is on **every** sandbox `/capture` state (idle, listening, closing, ended, debrief, open
  session), label always "Sign out" (`C-sess-signout`, the board's `.btn2`), same handler `handleSignOutTap`, same
  disabled rule, same `SignOutDialog` (`running` = cancels today, `closed` = nothing deleted). The dialog carries the
  warning, so the red "cancels today's session" wording of the phone link is not needed in the header (board shows
  "Sign out"). On the question screen the phone has no footer link today; the laptop header will have the button
  (kind `closed`, harmless) — board L2-09 shows it, accepted.
- **`/pair`: deferred** (known gap, HANDOFF). A sign-out there needs a handler PairScreen does not have (entry-role
  state); the judge is on `/pair` for ~20 s. Board note.

### 2.2 `app/capture/page.tsx` (the only product file)

(a) Right after `const sandbox = demoSession !== undefined;` (L959, before `renderSignOutLink` at L974):

```ts
  // R25-003 (boards L2-*): from 900 px the one sign-out control is the header's secondary button; under 900 px it is
  // the footer link (R10). Decided here, not in CSS, so there is never a second affordance in the tree.
  const headerSignOut = sandbox && drawerLayout.wide;
  const signOutDisabled = signOutBusy || selesaiBusy || autoStopBusy || closingBusy || mulaiBusy || openBusy;
```

Use `signOutDisabled` in both the header button and `renderSignOutLink` (its current inline expression is identical).

(b) L1416 becomes:

```tsx
      {modern ? (
        <StaffTopBar
          demo
          outletLine
          signOut={
            headerSignOut
              ? {
                  label: t(lang, "C-sess-signout"),
                  onClick: handleSignOutTap,
                  disabled: signOutDisabled,
                }
              : undefined
          }
        />
      ) : null}
```

and the comment above it is replaced by: `{/* The staff bar (logo, the demo outlet line with its expiry, ID | EN; the Sign out button from 900 px, R25-003). */}`.

(c) `renderSignOutLink` (L974): first line of the body `if (headerSignOut) return null;`. `inOrder`-based structure
tests do not change because jsdom is narrow.

Nothing else: `StaffTopBar.tsx`, `shop.module.css`, `DebriefFlow.tsx`, `OpenSessionView.tsx` untouched. The disabled
expression is the same as the footer link's (keep them identical; a helper `const signOutDisabled = ...` used by both
is fine).

### 2.3 Tests

`app/capture/page.test.tsx`, new `describe("sign-out at >= 900 px (R25-003)")`:

- A `matchMedia` stub like `app/demo/JudgeGuide.test.tsx` L53: `vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(min-width: 900px)", media: q, addEventListener: () => {}, removeEventListener: () => {} }))`
  in a `beforeEach`; `vi.unstubAllGlobals()` in `afterEach` (check the file's existing afterEach already does this).
- Test 1 (idle): `demoConfig()`; `await renderReady()`; `within(container.querySelector("header")!).getByRole("button", { name: "Sign out" })`
  exists; `within(container.querySelector("main")!).queryByRole("button", { name: /Sign out/ })` is null;
  click the header button -> the `SignOutDialog` with the `closed` copy opens (reuse the assertion of the existing
  "closed" dialog test, L1281-1300 area).
- Test 2 (running, before closing): start a session (`renderDemoRunning()`); header "Sign out" present; no
  "Sign out (cancels today's session)" anywhere; click header -> the `running` dialog copy (the cancel warning).
  Also `expect((headerBtn as HTMLButtonElement).disabled)` follows `mulaiBusy` if easy; otherwise skip.
- Test 3 (narrow guard): without the stub, the existing L1189 test ("is a footer link on a sandbox device (no header
  button)") stays as is — do not edit it.
- `app/capture/page-structure.test.tsx`: unchanged (narrow).

---

## 3. R25-004: `timed_out` must publish `debrief_done` at once

### 3.1 Ruling and why (the clock-patch question, answered from the code)

- `DebriefFlow.tsx` L199-203: while a question is on screen the flow runs its **own 1 s ticker with `Date.now()`**
  and dispatches `TICK`; the reducer (`lib/debrief/flow.ts` L244-247) turns the view into `timed_out` within 1 s of
  `ends_at_ms`. `publishDebriefView("timed_out")` fires in the same render (L304-306).
- The guide does not read that view directly: the page's bridge effect (page.tsx L714-732) computes
  `capturePhaseFor({ nowMs, debriefView, startOffered, ... })` where `nowMs` is the page's **30 s** tick (L453-462;
  the 1 s page tick L469 runs only while a session is open, and none is). `capturePhaseFor` (guide-bridge.ts L149-168)
  checks `nowMs >= debriefEndsAt` first — still false on the stale page clock — then switches on `debriefView`, and
  `timed_out` is not a case, so the **default** returns `debrief_question` (next_day.reason is not "preparing"). The
  guide therefore keeps the question card (kicker "DEBRIEF TIP", no control; the UI-112 change removed Jump from it)
  until the page's next tick, at most 30 s later, when `nowMs >= endsAt` and `startOffered` is false (sandbox
  `day_ended`) give `debrief_done` and the Jump card.
- **A real 60-min expiry behaves identically**: both tickers read the same `Date.now`; the lag is structural, not
  created by QA's patch. QA's patch moved `Date.now` for the whole document (the guide lives in the root layout of the
  same window), so the guide was not "reading an unpatched clock"; QA simply captured inside the <= 30 s window.
  Same class of defect as R-19 round-3 D3 (done-flag lag), fixed there for `done`, missed for `timed_out`.
- Known consequence (unchanged, by design): the Jump control after a timeout hits the server's 409
  `unanswered_questions` -> the existing "Answer first / Jump anyway" confirm. Not in scope.

### 3.2 `app/demo/guide-bridge.ts`

In `capturePhaseFor`, add one case to the `switch (input.debriefView)` (L157), before `case "question"`:

```ts
    case "timed_out":
      // The flow's own 1 s clock passed ends_at before the page's 30 s tick did: the debrief is over now.
      return "debrief_done";
```

Update the doc comment above the function: after "a screen that says nothing about the questions (closed, loading,
...) falls back to the config." add " A `timed_out` screen is `debrief_done` at once (its 1 s clock runs ahead of the
page's 30 s one)." No other file.

### 3.3 Tests

`app/demo/guide-bridge.test.ts`:

- L73 `it.each([...])`: remove `"timed_out"` from the list (keep `closed`, `loading`, `load_error`, `empty`).
- New: `it("a timed_out screen is debrief_done before the page's clock tick, whatever the config says", () => { const d = { ...base, lastEnded: ended(), startOffered: false, debriefView: "timed_out" as const }; expect(capturePhaseFor(d)).toBe("debrief_done"); expect(capturePhaseFor({ ...d, profile: profile({ next_day: { allowed: false, reason: "preparing" } }) })).toBe("debrief_done"); });`
- Keep the "never overrides a session, the done flag, the window's end" test as is (a session still wins:
  `session` is checked first).
- `app/demo/guide-bridge.view.test.tsx` / `JudgeGuide.test.tsx`: neither mentions `timed_out` today (grepped); no edit.

---

## 4. Order, batching, and the idle fix

Overlap map (develop `11b9149`):

| Fix | Files | Overlap with `fix/idle-expired-fallback` (page.tsx L1120-1165 + DebriefFlow.tsx renderView re-indent) |
|---|---|---|
| R25-004 | `app/demo/guide-bridge.ts`, `guide-bridge.test.ts` | none |
| R25-002 | `app/capture/page.tsx` L250 / L322 / L786-810 / L1014-1031; `page.test.tsx` | same file, different hunks (L1014-1031 is the open-session branch, ~90 lines above the idle fix's hunk; git merges cleanly, but the page.test.tsx additions of both land in nearby describes) |
| R25-003 | `app/capture/page.tsx` L210 / L974 / L1394 / L1416; `page.test.tsx` | same file, different hunks; L1416 sits ~250 lines below the idle hunk |

Recommended:

1. **Now, in parallel, its own micro-branch off `origin/develop`: `fix/guide-timed-out-phase` = R25-004** (10 min,
   zero overlap, can merge before or after the idle PR in any order). Tech-lead gate: diff = 1 case + tests.
2. **R25-002 + R25-003 on ONE branch `fix/r25-open-end-header-signout`, branched from the head of
   `fix/idle-expired-fallback`** (stacked), so page.tsx never has two unmerged rewrites of the same region in flight.
   Commit order inside it: R25-002 (tests first), then R25-003. PR base = `develop` once the idle PR merges (rebase
   onto develop then; the developer owns that branch, no shared-tree mutation). If the idle PR has already merged by
   the time this starts, branch off `origin/develop` directly. Do **not** edit `DebriefFlow.tsx` in this branch
   (neither fix needs it).
3. Gates: `npx vitest run app/capture app/demo`, then full `npx vitest run`, `npm run lint`, `npm run typecheck`,
   `npm run build`. Tech-lead review: 15 min per branch. QA re-run on `web-develop`: R25-002 (open-session path
   at 360), R25-003 (1280: header button idle/listening/debrief, no footer link; 360: footer link, no header
   button), R25-004 (timeout via `--debrief-minutes 8` seed or the clock method, guide flips within 1 s).

If anything above slips past 15:00: ship R25-004 regardless (it is a one-liner), and record R25-002 and R25-003
as known gaps in HANDOFF/README: "On the laptop the staff Sign out is the footer link, not a header button" and
"Ending a session found open on return ends the day without a second confirm (Cancel today is the recovery path)".
Neither touches the pilot.

## 5. Hard rules

None touched: no model call, route, Firestore write, audio, name, device id on a supervisor screen, or region. The
sheet reuses existing copy keys; the header button reuses the existing handler and dialog. Pilot (`DEMO_MODE` unset)
byte-identical: every branch is behind `sandbox` / `demo_session` / `demo`.

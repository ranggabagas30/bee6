# R-25 idle fix (QA defect R25-001): fresh sandbox `/capture` renders no stage, h1 or day line

Tech-lead brief for `developer` (sonnet). Written 17 Oct against `origin/develop` `11b9149`. Follow it literally;
flag a gap, do not improvise. Skills: `react-patterns`, `react-testing`, `tdd-workflow` (write the failing tests
first, then the two code changes).

## 1. Diagnosis (confirmed, read-only in a worktree off `origin/develop`)

QA's read is right.

1. `lib/demo/clone.ts` (`cloneTemplate`, L190-215 and the device write at ~L285) copies the template device's
   `last_ended` into the judge device, shifted by whole days so the template's last day lands on the sandbox's
   **yesterday** (R-18 P2 carry-over, by design: `last_ended` drives `days_done`, the next-day guards G4/G7 and
   the carried-over questions). So a fresh sandbox always has
   `last_ended = { business_date: <yesterday>, end_reason: "selesai", debrief_ends_at_ms: <yesterday, in the past> }`.
2. `app/capture/page.tsx` L330: `debriefEndsAtMs = lastEnded && end_reason !== "discarded" ? debrief_ends_at_ms : null`
   is therefore **non-null** on every fresh sandbox, so `renderIdle` (L1120) takes the `DebriefFlow` branch, not
   the sandbox `StageScreen` branch (L1121-1138), which is reached only when `debriefEndsAtMs === null`.
3. `app/capture/debrief/DebriefFlow.tsx` L429-454, `closed` arm: `expired` is true, `restoredDone` is null (no
   flag for that `endsAtMs`), `demo && !expired` is false, so it returns `{headline}{null}{primary}`. On a
   sandbox R-25 T5 made `headline` **null** (page.tsx L1035) and `primary` is only the Start button + Sign out
   link. Result: no `Stage`, no h1, no sub, no day line. Exactly what QA saw.
4. The unit tests missed it because every sandbox idle test seeds `last_ended: null`
   (`app/capture/page-structure.test.tsx` L62 `base`; `page.test.tsx` `demoConfig`), which the real clone never produces.

**Is `web` (main `5a47d02`) affected today?** No. On main the `headline` is always the `StatusBanner`
(`git show origin/main:app/capture/page.tsx` L976-983) and there is no `StageScreen`; the same `closed`+expired
arm renders banner + Mulai + help line, i.e. the old (pre-page-2) idle screen, which is correct for that design.
The DebriefFlow-mounted-on-a-fresh-sandbox structure is **pre-existing** (since R-18/R-19) but was **masked** by
the banner. The blank screen is a **regression introduced by R-25 T5 on develop only**. Judges on `web` today see
a working idle screen.

**Day 2 is also broken on develop** (QA did not reach it): "Jump to tomorrow" (`lib/demo/next-day.ts`
`shiftLastEnded`) moves `last_ended` back one day, so `debrief_ends_at_ms` is again expired, the `key`
changes, the done flag no longer matches, and the same empty arm renders. The fix below covers it.

**Data fix rejected.** Making the clone drop/neutralise an expired `last_ended` would change `days_done`,
the next-day guards and the carried-over question set, and a real judge's own day 1 produces the identical
shape on day 2 anyway. No re-seed of `demo-tpl-outlet` is needed or wanted. The template is fine.

## 2. Fix (smallest safe one): `DebriefFlow` owns an "expired, never opened" fallback for sandboxes

Why in `DebriefFlow` and not the page: only `DebriefFlow` knows both `restoredDone` (read once at mount) and
whether the flow was **open at expiry** (`timed_out`). A page-level "expired and no flag" predicate would unmount
the flow at the moment of the timeout and lose the Timeout screen (board P2-10b), and would hide the privacy note
under it. So:

- the page builds the sandbox idle `StageScreen` once (a helper) and passes it to `DebriefFlow` as
  `expiredFallback`;
- `DebriefFlow`'s `closed` arm returns that fallback when `demo && expired && !restoredDone`;
- the page's trailing privacy note (`page.tsx` L1162) moves into `DebriefFlow` as a `note` prop so the fallback
  (whose footer already holds the note in board order Start -> note -> Sign out) does not show it twice and every
  other sandbox debrief screen keeps it exactly where it is today.

Pilot path: both new props are `undefined` and additionally gated on `demo`, so the pilot `closed` arm,
`timed_out` arm and DOM are unchanged. `DEMO_MODE` unset: byte-identical behaviour.

### 2.1 `app/capture/debrief/DebriefFlow.tsx`

(a) Add two optional props to `DebriefFlowProps`, after `onSignOut`:

```ts
  /**
   * R-25 idle fix, sandbox only: what to render in place of the whole debrief when this debrief's hour is already
   * over at mount and it was never opened (no completion flag): a fresh sandbox clone carries yesterday's expired
   * `last_ended`, and "Jump to tomorrow" moves the judge's own day there. The page passes its idle StageScreen,
   * privacy note included. Ignored on the pilot (`demo` false) and whenever a done flag or an open flow exists.
   */
  expiredFallback?: ReactNode;
  /**
   * R-25 idle fix, sandbox only: the page's privacy notice block (`<div className="b6-foot">...</div>`), rendered
   * after every debrief screen EXCEPT `expiredFallback` (whose footer already carries it). Absent on the pilot.
   */
  note?: ReactNode;
```

(b) Destructure them in the component signature: `expiredFallback,` and `note,` after `onSignOut,`.

(c) In the `closed` arm, insert ONE line between the `restoredDone` line and the `demo && !expired` block:

```ts
      if (demo && restoredDone) return demoDone(restoredDone.answered, restoredDone.skipped, pendingCount);
      if (demo && expired && expiredFallback !== undefined) return expiredFallback;   // <- new
      if (demo && !expired) {
```

(d) Append `note` after every OTHER rendered view. Mechanically: rename the existing `switch (state.view.kind) { ... }`
block into an inner function and return it wrapped:

```tsx
  function renderView(): ReactNode {
    switch (state.view.kind) {
      /* the existing arms, unchanged apart from (c) */
    }
  }
  const fallbackShown = demo && state.view.kind === "closed" && !restoredDone && nowMs >= endsAtMs && expiredFallback !== undefined;
  return (
    <>
      {renderView()}
      {fallbackShown ? null : note}
    </>
  );
```

`renderView` must return something in every arm (the switch is exhaustive today; keep it so, TypeScript will
tell you). `note` undefined on the pilot renders nothing, so the pilot DOM is unchanged. Do not touch the
reducer, the auto-open effect (L296-300: it already skips when `Date.now() >= endsAtMs`), the uploader, or any
other arm.

### 2.2 `app/capture/page.tsx`

(a) Extract the sandbox idle stage. Inside `renderIdle`, replace the `if (sandbox) { const ended = ...; return (<StageScreen ...>) }`
block at L1122-1138 with a call to a new helper and define that helper right above the
`if (debriefEndsAtMs === null || ...)` test (it closes over `idle`, `sandboxPrimary`, `dayLine`, `lang`):

```tsx
    /** R-25 T5 / idle fix: the sandbox idle stage (board P2-04 / P2-04b). Also the debrief's `expiredFallback`. */
    function renderSandboxIdleStage() {
      const ended = !idle!.offered;
      const title = sandboxIdleTitle(idle!);
      const subText = ended ? idle!.note : t(lang, "C-sess-ready-sub");
      return (
        <StageScreen
          tone={ended ? "done" : "idle"}
          orbLabel={ended ? undefined : t(lang, "C-b-mulai")}
          title={title}
          sub={subText ? <p className="b6-sub">{subText}</p> : null}
          mono={dayLine}
        >
          {sandboxPrimary}
          {renderNote()}
          {renderSignOutLink("muted")}
        </StageScreen>
      );
    }
```

`idle` is already narrowed non-null by the `if (!idle) return null;` at L1032, so prefer defining the helper
after that guard and dropping the `!`s if TypeScript narrows through the closure (it does not narrow across a
nested function: keep a local `const idleView = idle;` before the helper and use that instead of `idle!`).

(b) The no-debrief branch becomes:

```tsx
    if (debriefEndsAtMs === null || nowMs === null || !effectiveConfig || !auth) {
      if (sandbox) return renderSandboxIdleStage();
      return (
        <>
          {headline}
          {primary}
        </>
      );
    }
```

(c) The `DebriefFlow` mount becomes (the trailing `{sandbox ? <div className=... >{renderNote()}</div> : null}` line
and its comment are DELETED; the fragment wrapper can go too):

```tsx
    return (
      <DebriefFlow
        key={debriefEndsAtMs}
        auth={auth}
        endsAtMs={debriefEndsAtMs}
        nowMs={nowMs}
        tz={effectiveConfig.timezone}
        nextMulaiText={nextMulaiText}
        headline={headline}
        primary={primary}
        demo={config?.demo_session !== undefined}
        dayNumber={demoSession?.day ?? null}
        expiredFallback={sandbox ? renderSandboxIdleStage() : undefined}
        // UX-03 section 5.10: the privacy notice is on every screen of the page, the debrief included.
        note={sandbox ? <div className={cx("b6-foot", css.foot)}>{renderNote()}</div> : undefined}
      />
    );
```

Nothing else in `page.tsx` changes. In particular leave the sr-only polite status at L1442 (`debriefEndsAtMs === null`
condition) alone: it is an announcement for transitions; the fallback renders its own h1.

Do not touch `lib/demo/clone.ts`, `lib/demo/next-day.ts`, `scripts/demo-seed-template.ts`, `idle-view.ts`,
`demo-session.ts`, the capture engine, or any route.

## 3. Behaviour matrix after the fix (verify each with the tests in section 4)

| Case | `last_ended` | now vs `debrief_ends_at_ms` | done flag | Screen |
|---|---|---|---|---|
| A. Fresh sandbox, day 1 | yesterday | expired | none | **fallback**: Stage idle, h1 "Ready to open", sub, "Day 1 of 3 · <date>", Start enabled, note, Sign out (board order) |
| B. Day 2 after Jump to tomorrow | yesterday (shifted) | expired | none (key changed) | **fallback**: same with "Day 2 of 3 · <date>" |
| C. Ended today, debrief still open | today | not expired | none | unchanged: "Loading" then auto-open (preparing / questions) |
| D. Flow open when the hour ends | today | expires mid-question | none | unchanged: `timed_out` -> "Debrief closed" + unanswered counts, note under it |
| E. Done, then the hour ends; or reload after done | today | expired | present | unchanged: `restoredDone` -> "Debrief complete" + locked Start footer, note under it |
| F. Reload after D (or page closed during the hour) | today | expired | none | **fallback** with `idle.offered === false`: Stage done, h1 "Ended" (or "Ended automatically at HH:MM"), sub "Demo day finished. Switch to Supervisor to see it.", locked Start "Start unlocks tomorrow from 01:00" + "Use Jump to tomorrow in the judge guide", note, Sign out. (develop today: blank; main: banner + lock lines) |
| G. Discarded day | any, `discarded` | n/a | n/a | unchanged (`debriefEndsAtMs` null -> no DebriefFlow) |
| H. Pilot, any of the above | any | any | n/a | unchanged (`expiredFallback`/`note` undefined, `demo` false) |

## 4. Tests (write these first; they must fail on `develop` for A, B, F and pass after)

### 4.1 `app/capture/page-structure.test.tsx` (sandbox document-order file)

Add a fixture next to `base`:

```ts
/** What a real template clone carries (R-18 P2): yesterday's ended day with an already-expired debrief. */
const YESTERDAY_ENDED = { business_date: "2026-10-11", end_reason: "selesai", debrief_ends_at_ms: Date.parse("2026-10-11T15:00:00Z") };
```

Test 1 (regression, QA R25-001): copy the existing "idle: top bar, stage, h1, sub, day line, Start, note, sign-out
link, upload block" test verbatim as a new `it("idle on a FRESH clone (yesterday's expired last_ended, R25-001): the same stage, h1, day line and order")`,
with `fetchCaptureConfig.mockResolvedValue({ ...base, last_ended: YESTERDAY_ENDED, demo_session: PROFILE })`.
Keep every assertion: `.b6-stage--idle`, h1 "Ready to open", the sub, "Day 1 of 3 · Mon 12 Oct", `inOrder(header, stage, h1, sub, day, start, note, signOut, upload)`,
exactly one "Speech becomes short work notes. Audio is not kept.", no "Not started", no "Shop phone", no header Sign out. Also
`expect((start as HTMLButtonElement).getAttribute("aria-disabled")).not.toBe("true")`.

Test 2 (day 2): same config but `demo_session: { ...PROFILE, day: 2, days_done: 1 }`; assert h1 "Ready to open" and
`screen.getByText("Day 2 of 3 · Mon 12 Oct")`, exactly one notice.

### 4.2 `app/capture/page.test.tsx`, inside `describe("CapturePage with the R-18 demo profile (sandbox only)")`

Test 3 (case F): fake clock `MON_2230_WIB`; config
`{ ...demoConfig({ days_done: 1, next_day: { allowed: true, reason: null } }), last_ended: { business_date: "2026-10-12", end_reason: "selesai", debrief_ends_at_ms: Date.parse(MON_2230_WIB) - 60_000 } }`;
no done flag. `await renderReady()`. Expect: `findByRole("heading", { level: 1, name: "Ended" })`;
`getByText("Demo day finished. Switch to Supervisor to see it.")`; a disabled button "Start unlocks tomorrow from 01:00";
`getByText("Use Jump to tomorrow in the judge guide")`; `getAllByTestId("capture-notice")` length 1; `queryByText("Debrief closed")` null;
`queryByRole("button", { name: "Start" })` null; `container.querySelector(".b6-stage--done")` truthy (check the tone class name in `app/ui` Stage; use whatever class `tone="done"` emits).

Test 4 (case E guard): same config but `seedDoneFlag(Date.parse(MON_2230_WIB) - 60_000)` before render. Expect
`findByRole("heading", { level: 1, name: "Debrief complete" })`, `getByText("Use Jump to tomorrow in the judge guide")`,
exactly one `capture-notice`, and `queryByRole("heading", { name: "Ended" })` null.

Test 5 (case D guard): the existing "timed out" page-level behaviour is covered in `DebriefFlow.test.tsx`; add only
an assertion to an existing sandbox End -> debrief test (e.g. the one that reaches "Question 1 of 1" via `openDebrief(true)`)
that `screen.getAllByTestId("capture-notice")` has length 1 while the question is on screen (proves `note` moved, not lost).

### 4.3 `app/capture/debrief/DebriefFlow.test.tsx`, inside `describe("DebriefFlow: R-19 demo debrief (sandbox only)")`

Extend `Harness` with two pass-through props `expiredFallback?: ReactNode` and `note?: ReactNode`.

Test 6: `endsAtMs = Date.now() - 1`, `demo`, `expiredFallback={<p>FALLBACK</p>}`, `note={<p>NOTE</p>}`,
`headline={<p>PAGE HEADLINE</p>}`, `primary={<p>PRIMARY</p>}`; server with one question. Expect FALLBACK shown; NOTE,
PAGE HEADLINE and PRIMARY absent; `gets(calls)` is 0 (nothing fetched: no auto-open).

Test 7: as 6 but the storage has a done flag for that `endsAtMs` (reuse how the existing "reload inside the hour restores
the summary" test seeds it). Expect "Debrief complete" heading, NOTE present, FALLBACK absent.

Test 8: `endsAtMs = Date.now() + 5_000`, `demo`, `expiredFallback={<p>FALLBACK</p>}`, `note={<p>NOTE</p>}`; wait for
"Question 1 of 1"; expect NOTE present and FALLBACK absent; click `advance-now`; expect heading "Debrief closed", NOTE present,
FALLBACK absent.

Test 9 (pilot guard): no `demo`, `endsAtMs = Date.now() - 1`, `expiredFallback={<p>FALLBACK</p>}`, `note={<p>NOTE</p>}`,
`headline={<p>PAGE HEADLINE</p>}`, `primary={<p>PRIMARY</p>}`. Expect PAGE HEADLINE and PRIMARY shown, FALLBACK absent,
and NOTE shown (note is harmless on the pilot but the page never passes it; this pins that `demo` gates the fallback only).
Also keep the existing "pilot (no demo): the entry card still shows" test green.

Run: `npx vitest run app/capture` then the full `npx vitest run`, `npm run lint`, `npm run typecheck`, `npm run build`.

## 5. Hard rules touched

None change. No data write, no route, no model call, no audio, no names, no Firestore from the browser. Pilot path
byte-identical (`DEMO_MODE` unset: `demo_session` absent, `sandbox` false, both new props undefined). The privacy
notice (UX-03 §5.10, CLAUDE.md §7b) stays on every sandbox screen: that is what the `note` prop and tests 3-5, 7-8 pin.

## 6. Risks

- `renderView()` re-indent is a large but mechanical diff in `DebriefFlow.tsx`; review the diff with `git diff -w`
  to see the real change (three lines plus the wrapper).
- `fallbackShown` must use the same predicate as the `closed` arm (`restoredDone` is mount-time state, `nowMs >= endsAtMs`
  from props). If they drift, the note doubles or disappears; tests 6-8 catch it.
- The sr-only polite status (page L1442) does not announce the fallback's "Ended" title in case F. Transition-only
  announcement, reload-only case: accepted, out of scope.
- Nothing here changes the clone or the template; no re-seed, no authority question.

## 7. Estimate

Developer: 45-60 min including tests. Tech-lead re-review: 15 min (diff against this brief). QA: re-run R25-001 on
`web-develop` (fresh sandbox, day 2 after Jump, and one End -> timeout) 20 min.

## 8. QA side question: the proposals watch note "One proposal can be made now"

`app/proposals/WatchPanel.tsx` L70-71: `showOneNote = demo && !hasProposal && readyRows.length === 1 && readyRows[0].category === "CUSTOMER_SERVICE" && serverRows.some(state === "needs_more")`.
Rows come from the server (`lib/proposals/review-service.ts` L154: `proposed` / `ready` / `needs_more`), and
`scripts/demo-seed-template.ts` deliberately seeds a **clean** template: ROUTINE history only, no evidence category
with a fact, no ready row (its own clean check, L165-185). So on a fresh seeded sandbox both script rows read
"Not seen yet" (placeholders) and the note **cannot** show; that is expected. It appears only on the judge path after
day 2's pipeline has run: egg-tart (CUSTOMER_SERVICE) seen on days 1 and 2 -> "Ready", the phone order (PHONE_CALL)
seen on day 2 only -> "needs more", and no proposal asked yet. Once "Ask Bee6 for a proposal" is tapped
(`hasProposal` true) it disappears. Not a defect.

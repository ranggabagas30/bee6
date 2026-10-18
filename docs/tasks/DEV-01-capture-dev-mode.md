# DEV-01 — `/capture` developer mode (manual control + event log)

Status: **Merged into PR #5 (bundled with the DLP region fix): https://github.com/ranggabagas30/bee6/pull/5**
— both gates cleared (tech-lead PASS + QA SHIP, one fix round each). 421/421 tests. Task 4's live-device
verification (real mic, real 360px) still needs Rangga — see Result section below.

> Design via `superpowers:brainstorming` (architectural path, approved by Rangga 2 Oct in-chat,
> section by section — no separate spec file; this doc IS the spec + plan, per this project's
> convention of writing both into one `docs/tasks/` file). Plan via `superpowers:writing-plans`
> discipline (bite-sized tasks, no placeholders, self-reviewed below).

**Goal:** make `/capture` testable without hand-patching Firestore or guessing whether a segment
reached Gemini — a dev-only manual start/pause/stop control plus a visible, on-page event log of
the capture state machine (VAD/segment/wake-lock transitions), compiled in only for local dev.

**Why now:** found a bug (DLP region hardcoding, PR #5) that took real multi-agent investigation to
diagnose partly because there was no visibility into the pipeline beyond grepping sanitized server
logs. Rangga: "notice the bug ASAP before finishing all tasks takes precedence... supporting
development mode is as important to make the testing becomes comprehensive, clear, and safer."

**Architecture:**
1. **Gating:** a new env var `NEXT_PUBLIC_DEV_CONTROLS` (build-time, `NEXT_PUBLIC_*` so it's
   readable client-side, same mechanism Next.js already uses for client-visible config). Unset (or
   not `"true"`) in every real build — pilot, demo, and any deploy — so `/capture` behaves exactly
   as it does today with zero risk to a real device. Set only in a developer's local `.env.local`.
2. **Manual control:** when the flag is on, `/capture` renders an additional dev panel with
   Start / Pause / Stop buttons, bypassing the `opening_hours`/consent auto-gate entirely for this
   session. "Pause" = the same `stop()` the real page already calls; "resume"/"start" = the same
   `startCaptureSession()` the real page already calls on mount. No new session-internal state — the
   dev panel is just an alternate trigger for calls that already exist. **The real auto-gate logic in
   `app/capture/page.tsx` is not modified, only branched around** when the flag is set.
3. **Event log:** a new ring-buffer hook (last 200 events, in-memory, not persisted) fed by a new
   optional callback (`onEvent`) threaded through `CaptureSession`/`CaptureEngine`'s existing
   state-reporting path — the same transitions that already drive `StatusBanner`'s single current
   state, now recorded as a timestamped list. Event payloads are state names, segment ids, byte
   counts and durations — **never transcript text or audio** (hard rule #2). Rendered as a scrolling,
   newest-first list in the dev panel, visible on the same screen as the controls.
4. **Scope discipline:** capture-only for now (VAD/segment/wake-lock). Designed so a later stage
   (R-05b's label-call tick, once built) can feed its own events into the same `onEvent` shape without
   reworking this — but wiring that up is R-05b's job, not this task's.

**Tech Stack:** no new dependency. Pure React state (a ring buffer in a `useRef`/`useState` pair) and
a plain callback prop threaded through existing classes — no new library for logging/ring-buffers.

**Spec:** this file. Builds on `/capture`'s existing code (`app/capture/page.tsx`,
`lib/capture/browser/{session,engine,wake-lock}.ts`), all shipped in PR #1/#3/#4.

**Branch:** `fix/dlp-region-fallback` (PR #5, already open) — Rangga's explicit choice, 2 Oct, over a
separate branch, since it's testing tooling for the same area currently under test.

## Global constraints
- `NEXT_PUBLIC_DEV_CONTROLS` must be absent (or any value other than the literal string `"true"`) in
  every committed `.env.example`/deploy config — this task adds the flag's *handling*, never sets it
  to `"true"` anywhere committed.
- No transcript text, no audio, no base64 in any event payload (hard rule #2) — enforced by what the
  event shape is allowed to carry, not by a redaction step (there's nothing to redact if the shape
  never includes free text from a transcript in the first place).
- The real (non-dev) `/capture` code path must be provably unchanged: the existing R-03 test suite
  (304+ tests across `lib/capture/**`) must still pass unmodified, and a new test must assert the dev
  panel renders nothing at all when the flag is unset — not hidden via CSS, actually absent from the
  render tree.

## Review focus (failure modes the design doesn't test for directly)
1. **Dev panel leaking into a real build via a stale/misconfigured env.** → Task 1's test asserts
   the panel's absence is a build-time branch (`if (flag) return null` pattern or equivalent), not a
   runtime-only check that could be bypassed by a query param.
2. **An event payload accidentally carrying transcript text** (e.g. someone later wires a new event
   type and forgets the "no content" rule). → Task 3's event type is a discriminated union with no
   `text`/`transcript` field in its type at all — a future event type that tried to add one would be
   a visible, reviewable type change, not a silent runtime leak.
3. **Pause/resume leaving the mic open or the wake lock held** after a dev-mode stop, since dev mode
   reuses `stop()`/`startCaptureSession()` rather than new code — if either of those has a latent bug,
   dev mode would surface it identically to the real page. → Task 2's test reuses the SAME
   stop/start assertions the real R-03 fix-round tests already use (mic release, wake-lock release),
   just invoked via the dev panel's button handlers instead of the real auto-gate effect.
4. **Ring buffer growing unbounded over a long dev session.** → Task 3 caps it at 200 events, oldest
   dropped first; test asserts this explicitly.
5. **The dev panel breaking the 360px phone-width layout** (CLAUDE.md self-review checklist item).
   → Task 1 and 3's components get a quick explicit width check in their tests/manual check.

---

## Task 1: env flag + dev panel shell (no logic yet)

**Files:**
- Create: `lib/capture/dev-mode.ts` — `isDevControlsEnabled(): boolean` reading
  `process.env.NEXT_PUBLIC_DEV_CONTROLS === "true"`, single source of truth for the flag check.
- Create: `lib/capture/dev-mode.test.ts`
- Create: `app/capture/DevPanel.tsx` — shell only this task (renders a labelled container, no
  controls/log yet); `app/capture/DevPanel.test.tsx`.
- Modify: `app/capture/page.tsx` — render `<DevPanel />` only when `isDevControlsEnabled()`, and only
  when `isDevControlsEnabled()`, bypass the `opening_hours`/consent gate's early return (still compute
  and show the real state underneath, don't delete that logic).
- Modify: `.env.local.example` (or create it if it doesn't exist) — document
  `NEXT_PUBLIC_DEV_CONTROLS=true` as a local-only, never-committed-as-true option, consistent with how
  other env names are documented.

**Interfaces:**
- Produces: `isDevControlsEnabled(): boolean`.
- Consumes: nothing new.

- [ ] Write a failing test: `isDevControlsEnabled()` returns `false` when
  `NEXT_PUBLIC_DEV_CONTROLS` is unset, `"false"`, or any non-`"true"` string.
- [ ] Implement `isDevControlsEnabled`; confirm test passes.
- [ ] Write a failing test: rendering `CapturePage` with the flag unset produces no `DevPanel` node in
  the render tree at all (query by test id, assert `null`, not just visually hidden).
- [ ] Wire the conditional render in `page.tsx`; confirm test passes.
- [ ] Write a failing test: with the flag set, the auto-gate's `outside_hours`/`no_consent` early
  returns no longer block rendering the active capture view.
- [ ] Implement the bypass branch (still showing the real computed state alongside the dev panel, not
  hiding it); confirm test passes.
- [ ] Commit: `feat(dev-mode): add NEXT_PUBLIC_DEV_CONTROLS flag and dev panel shell`.

## Task 2: manual start/pause/stop controls

**Files:**
- Modify: `app/capture/DevPanel.tsx` — add Start / Pause / Stop buttons.
- Modify: `app/capture/DevPanel.test.tsx`
- Modify: `app/capture/page.tsx` — thread `startCaptureSession`/`stop` (already imported) down to
  `DevPanel` as props, so the dev panel calls the exact same functions the real auto-gate effect uses.

**Interfaces:**
- Consumes: `startCaptureSession` (`lib/capture/browser/session.ts`, unchanged signature), the
  existing `session.stop()` method.
- Produces: nothing new — `DevPanel` gets `{ onStart: () => void, onPause: () => void, onStop: () =>
  void }` props from `page.tsx`, which close over the same `sessionRef` the real auto-gate effect
  already manages.

- [ ] Write a failing test: clicking "Start" in `DevPanel` (with a mocked `onStart`) calls the prop
  exactly once.
- [ ] Implement the button + handler; confirm test passes.
- [ ] Write a failing test: clicking "Pause" calls `session.stop()` (reuse the exact mock/assertion
  shape from `lib/capture/browser/session.test.ts`'s existing stop-releases-mic test) and leaves
  `sessionRef.current` cleared, matching the real stop path's behavior.
- [ ] Implement Pause as calling `session.stop()` then clearing the ref; confirm test passes (and
  confirm via the reused assertion that the mic/wake-lock are actually released, not just that stop
  was called).
- [ ] Write a failing test: clicking "Start" again after a pause calls `startCaptureSession()` fresh
  (new session object, not a stale reference) and updates `sessionRef.current`.
- [ ] Implement; confirm test passes.
- [ ] Commit: `feat(dev-mode): add manual start/pause/stop controls to the dev panel`.

## Task 3: event ring-buffer + log display

**Files:**
- Create: `lib/capture/browser/event-log.ts` — `CaptureEvent` discriminated union type (variants:
  `state_changed` {state, queuedCount}, `segment_opened` {seg_id}, `segment_closed` {seg_id,
  duration_ms}, `segment_upload_started` {seg_id, byte_count}, `segment_upload_result` {seg_id,
  ok: boolean}, `wake_lock_changed` {held: boolean}, `mic_restart` {reason: string} — note: NONE of
  these variants has a field that could hold transcript text or audio bytes, by construction) and
  `createEventRingBuffer(capacity: number)` — `{ push(event: CaptureEvent): void, list():
  readonly CaptureEvent[] }`, dropping the oldest entry past `capacity`.
- Create: `lib/capture/browser/event-log.test.ts`
- Modify: `lib/capture/browser/session.ts` — accept an optional `onEvent?: (e: CaptureEvent) => void`
  in `CaptureSessionCallbacks`, call it at the same points `onStatus`/`onMicSource` are already called
  (translate the existing status/mic-source/wake-lock changes into `CaptureEvent`s — don't add new
  instrumentation points beyond what's already observable).
- Modify: `app/capture/page.tsx` — create one `createEventRingBuffer(200)` per mount, pass `onEvent:
  buf.push` into `startCaptureSession`'s callbacks, pass `buf.list()` down to `DevPanel`.
- Modify: `app/capture/DevPanel.tsx` — render the event list, newest-first, each line as
  `[relative time] event_type: {compact metadata}`.
- Modify: `app/capture/DevPanel.test.tsx`

**Interfaces:**
- Produces: `CaptureEvent` (the discriminated union — this is the contract future stages build their
  own event variants against), `createEventRingBuffer(capacity: number): { push, list }`.
- Consumes: `CaptureSessionCallbacks` (`lib/capture/browser/session.ts`) — extended, not replaced;
  existing callers that don't pass `onEvent` are unaffected (it's optional).

- [ ] Write a failing test: `createEventRingBuffer(3)` pushed 5 events keeps only the latest 3, oldest
  dropped first, `list()` returns them in insertion order.
- [ ] Implement; confirm test passes.
- [ ] Write a failing test: a `CaptureEvent` value can never be constructed with a `text`/`transcript`
  field — assert this at the type level (a `// @ts-expect-error` line attempting to add one to a
  variant, checked by `tsc`) and in the schema if `CaptureEvent` gets a zod shape for the ring buffer's
  own tests (it may not need runtime validation if it's purely an internal type — decide based on
  whether anything crosses a serialization boundary; if nothing does, the compile-time check alone is
  sufficient and no zod schema is needed here).
- [ ] Write a failing test: `startCaptureSession`'s existing status-change callback also calls the new
  `onEvent` with a matching `state_changed` event, when `onEvent` is provided; and does nothing extra
  when `onEvent` is omitted (back-compat — no behavior change for any existing caller).
- [ ] Implement the `onEvent` threading in `session.ts`; confirm both tests pass.
- [ ] Write a failing test: `DevPanel` renders a provided event list newest-first, each with a
  human-readable line, and renders nothing from an empty list (no crash, no placeholder text implying
  an error).
- [ ] Implement the log rendering; confirm test passes.
- [ ] Commit: `feat(dev-mode): add capture event ring buffer and on-page log display`.

## Task 4: manual verification + width check

**Files:** none (manual check, recorded in this doc's Result section).

- [ ] With `NEXT_PUBLIC_DEV_CONTROLS=true` locally, confirm the dev panel appears, Start/Pause/Stop
  work, and the event log updates live while speaking into the mic (should show `segment_opened` →
  `segment_closed` → `segment_upload_started` → `segment_upload_result` for each spoken segment,
  matching what's currently only visible by grepping server logs or querying Firestore directly).
- [ ] Confirm the page still fits a 360px-wide viewport with the dev panel open (CLAUDE.md self-review
  checklist item) — Chrome DevTools device toolbar, iPhone SE width or narrower.
- [ ] Confirm with `NEXT_PUBLIC_DEV_CONTROLS` unset (the default), `/capture` behaves identically to
  before this task — no visual or behavioral change, dev panel absent.

## Acceptance
- [ ] `npm run typecheck` / `npm run lint` / `npx vitest run` all clean, full existing suite unaffected.
- [ ] Dev panel is provably absent (not hidden) when the flag is unset.
- [ ] Manual start/pause/stop reuses the exact same `startCaptureSession`/`stop()` the real page uses
  — no parallel/duplicate session-management logic.
- [ ] Event log shows real capture-stage transitions live, contains no transcript/audio content by
  construction (type-level guarantee, not a runtime filter).
- [ ] Real (non-dev) `/capture` behavior and its existing test suite are provably unchanged.

## Result

Tasks 1–3 built and committed on `fix/dlp-region-fallback` (worktree
`.claude/worktrees/agent-r03-fixes/`), 5 commits on top of PR #5's existing head
(`29e51cc`): `8ecd129` (test infra), `a23a234` (flag), `37b049e` (shell+gating),
`be96d1b` (manual controls), `d7000ae`+`9ad4249` (event-log type+buffer),
`bfac4d3` (session/engine onEvent wiring), `1e91e91` (log rendering), `41aab3d`
(360px safety). `npx tsc --noEmit` / `npx eslint .` / `npx vitest run` all clean
throughout; suite grew 393 → 420, all passing, no existing test modified in a
way that changes its assertions (only `engine.ts`'s `genSegId()` call site moved
earlier — verified against the existing `engine.test.ts` assertions unchanged).

**Task 4 — NOT independently completed by this session; blocked on real
browser + microphone hardware, which this sandboxed CLI session has neither.**
I did not attempt to fake this: no browser-automation tool was available in
this session's tool list, and the only way to exercise `getUserMedia` for real
is an actual browser with mic permission. I also found another `next dev`
process already running against this exact worktree directory (PID 95009,
started before this session) and deliberately did not touch `.env.local` or
restart/kill it, to avoid disrupting whatever that other session is doing —
briefly tested that `NEXT_PUBLIC_DEV_CONTROLS=true` taking effect requires a
`next dev` restart (Turbopack doesn't hot-apply a new `NEXT_PUBLIC_*` value to
an already-running server), then reverted `.env.local` back to its original
content before doing anything else.

What stands in for it:
- `lib/capture/dev-mode.test.ts`, `app/capture/DevPanel.test.tsx`,
  `app/capture/page.test.tsx` cover flag gating (render-tree absence, not CSS),
  Start/Pause/Stop wiring (including a session-swap test proving a fresh
  session starts after pause, not a stale one), and the on-page log actually
  showing an emitted event after Start — using jsdom + `@testing-library/react`
  (newly added devDependencies — see "test infra" commit; not in the task
  doc's "no new dependency" line, which was about the ring buffer only).
- `lib/capture/browser/session.test.ts` (new — this module had zero unit tests
  before DEV-01) fakes every browser adapter `startCaptureSession` imports and
  asserts the real `stop()` releases the mic track and the wake lock — the
  exact behavior Review-focus point 3 worried dev mode could silently break.
- `lib/capture/browser/engine.test.ts` asserts the real
  segment_opened→segment_closed→segment_upload_started→segment_upload_result
  sequence and shared `seg_id`, end to end through `CaptureEngine`, with no
  mocks beyond the already-injected `encode`/`upload`.

**Rangga, to actually do Task 4** (under a minute, on your own machine, outside
any agent session so you don't collide with a live dev server):
1. Stop or ignore the other running `next dev` (PID 95009 if still up), or use
   a different port. Add `NEXT_PUBLIC_DEV_CONTROLS=true` to `.env.local`, then
   `npm run dev` fresh (it must restart to bake the flag in).
2. Open `/capture` on a paired device/browser profile, grant mic permission,
   click Start, speak a sentence with a pause after it, watch the log —
   expect `state_changed` lines throughout, then
   `segment_opened`→`segment_closed`→`segment_upload_started`→
   `segment_upload_result` once the pause closes the segment. Click Pause,
   confirm the mic indicator in the browser tab drops. Click Start again,
   confirm it resumes.
3. Chrome DevTools device toolbar at 360px (iPhone SE or narrower): confirm no
   horizontal scroll with the panel + log open. (Note: `PAGE_STYLE` on the
   outer `<main>` uses `content-box` sizing with `padding: 24`, so the page
   has rendered at up to ~408px since before this task — pre-existing, not
   introduced here; the dev panel itself is `border-box` and wraps long lines,
   so it doesn't add to that.)
4. With the flag unset (default), confirm `/capture` looks and behaves exactly
   as before this task — already covered by `page.test.tsx`'s render-tree
   assertion, but worth eyeballing once.

Paste the actual event sequence you see back here once you've run it.

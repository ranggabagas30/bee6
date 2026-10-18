# DEV-02 — `/capture` time-travel control (dev-only view clock)

Status: **SUPERSEDED (8 Oct, tech-lead) by `DEV-03-fast-day.md`. Do not build.** Kept as history only.
Rangga's counter-proposal (short hours as real data) is the better base once the **durations** travel
with the hours. Hours alone cannot work (DEV-03 §1.1). A server-side fast day keeps the phone and the
server in agreement, with no view-clock/real-clock split. The debrief screens are covered by
`DEV-04-debrief-sandbox.md`, and role sign-in by `DEV-05-dev-role-sign-in.md` (deferred to R-06). What
would revive DEV-02: needing to see production-length copy on screen (4 h Selesai note, real
`window_passed` times). Even then, Playwright `page.clock` is the cheaper tool.

~~Original status: PLAN, written by tech-lead (8 Oct). Waiting for the PM's edge-case brainstorm and then Rangga's
"go". Nothing is built.~~

> New idea, not a backlog task (CLAUDE.md §10 rule 11). This file is the spec and the plan in one, the
> same as `docs/tasks/DEV-01-capture-dev-mode.md`. The builder follows it **literally**. If something
> here turns out to be wrong against the real code, **stop and flag it**. Do not work around it.

**Base:** `origin/main` @ `31161e6` (R-07 screens merged, PR #21). The shared checkout is on an old
branch (`feature/r-05b-label-call-pr2`) that has no `lib/capture/calendar.ts`. **Build in a fresh
worktree off `origin/main`**, branch `feat/dev-02-time-travel`. Never switch refs in the shared tree.

**Goal:** make the full Mulai → Selesai → debrief → debrief-timeout loop, and the auto-stop, testable
in one sitting on a local dev server, without waiting 4 to 5 real hours. Today this cannot be done:
Selesai shows only from `start + 4 h` (`SELESAI_AFTER_START_MS`, `lib/capture/calendar.ts`), the
auto-stop is `close + 1 h`, the debrief lasts 1 h, and the dev panel (`app/capture/DevPanel.tsx`) only
has mic Start/Pause/Stop.

**Why seeding different hours can't fix this (checked):** the Mulai window ends at `close − 4 h` and
Selesai is `min(start + 4 h, close)`. Any start inside the window is at least 4 h before close, so
Selesai is always at least 4 h after Mulai, whatever the hours are. The wait has to be removed by a
clock, not by data.

---

## 1. The design decision: a client-only "view clock" with an anchor reset

### 1.1 What the server does with time today (this decides the design)

| Route | Time check on the client's timestamp (server clock) |
|---|---|
| `POST /api/v1/capture/sessions` (`startSession`) | `started_at_ms > now + 5 min` → **422**; older than 7 days → 422 |
| `POST .../{id}/end` (`endSession`) | only `ended_at_ms >= started_at_ms`. The server **stores the debrief window as `ended_at_ms + 1 h`, taken from the client's value** |
| `POST .../{id}/discard` | both timestamps within `[now − 8 d, now + 5 min]` |
| `GET /api/v1/questions` (`listDebriefQuestions`) | the debrief is active only while `server now < last_ended.debrief_ends_at_ms` |
| `POST /api/v1/questions/{id}/answer` (`submitAnswer`) | `answered_at_ms <= now + 5 min` (step 6) **and** `answered_at_ms` inside `[ends − 1 h, ends]` of the server-stored window (step 11), otherwise 400 |
| Pipeline tick (`/api/internal/pipeline/tick`) | real `Date.now()`; expires questions at the stored debrief end (`lib/pipeline/gate.ts`) |

`lib/debrief/answer-uploader.ts` treats any 400 as `removed_refused`: **the cached answer is deleted
from the phone**. So if a fake timestamp is refused, the phone silently loses an answer it already
showed as saved.

### 1.2 Approaches considered

| Approach | Verdict |
|---|---|
| **A. Fake `Date.now()` for the whole client** (e.g. Playwright `page.clock`, or a global `devNow()` used for everything, including timestamps sent to the server) | **Rejected.** Moving forward past Mulai sends a future `started_at_ms` → 422. Moving forward before Selesai stores a future debrief window, and then every answer fails either step 6 (future) or step 11 (outside the window) → 400 → silently dropped. It can only show screen states, never the real loop. |
| **B. A clock offset the server also uses** (a request header read at each route's `Date.now()`) | **Rejected.** It adds a time-forging input to five device routes. It needs its own server-side gate. The pipeline tick still runs on real time, so questions and threads would follow a different timeline from the sessions. And **`.env.local` points at the pilot project (`GOOGLE_CLOUD_PROJECT=<PILOT_PROJECT_ID>`)**, so a local run would write fake-dated sessions and `last_ended` records into the real-data Firestore. A future-dated `last_ended.business_date` blocks that device's real Mulai until the date arrives. |
| **C. Shorter durations in dev** (Selesai after 4 min, a 1-min debrief) | **Rejected.** The constants are shared with the server (`autoStopFor`, `DEBRIEF_DURATION_MS` in `endSession`). Changing them only on the client makes the client's debrief window disagree with the server's. Changing them on the server means editing the pure rules this task must not touch. |
| **D. Client-only view clock + anchor reset (RECOMMENDED)** | A dev-only offset moves only the clock the phone uses **to evaluate rules** (`nowMs`). Every timestamp **sent to the server or written to the phone cache** stays real `Date.now()`. The offset resets to 0 at each session event (Mulai, Selesai, auto-stop, Batalkan), so those events always happen at the same instant on the view clock and on the real clock. **No server file changes.** No fake timestamp can reach Firestore. |

### 1.3 How D works

- `realNow = Date.now()`. `viewNow = Date.now() + offsetMs`. `offsetMs` is 0 whenever the gate (§2) is
  off. It is then never even read from storage.
- **View clock (shifted)** is used for: the page's `nowMs` state (30 s tick, `visibilitychange`, mount);
  everything computed from `nowMs` (idle view, Mulai availability, the Selesai gate, the auto-stop
  deadline check, the next-Mulai text, the Selesai confirm panel copy); the Batalkan panel's
  `nextMulaiIsNow` copy check; and `DebriefFlow`'s timeout checks (the `nowMs` prop, the 1 s question
  tick, the guard at the top of `handleLanjut`).
- **Real clock (never shifted)** is used for: `started_at_ms`, `ended_at_ms`, `discarded_at_ms`,
  `answered_at_ms`; every answer-cache call (`appendAnswer`, `purgeNow`, `cachedIds`); the uploader's
  `now`; `ANSWER_RETRY_MS` and `ANSWER_PURGE_INTERVAL_MS`; the Batalkan 1 s arm delay and 15 s
  self-close; the event-log timestamps and the DevPanel's relative-time column; heartbeats; the capture
  engine.
- **Anchor reset (core rule):** when Mulai, Selesai, the auto-stop or Batalkan succeeds, the page sets
  `offsetMs = 0` and `nowMs = Date.now()` **in the same handler, in the same React batch** as the state
  change for that event (`setSession` / `setLastEnded`).
  - Each anchor (session start, session end) is therefore stamped at a moment when view time equals
    real time. A real-time anchor value (`session.started_at_ms`, `lastEnded.debrief_ends_at_ms`, the
    server's `config.last_ended`) has the same meaning on both clocks.
  - Any jump made **after** the anchor counts as time that has passed since it. That is what makes
    Selesai show, the auto-stop fire and the debrief time out.
  - Reload stays consistent: the server's `last_ended` is in real time, and so is the phone's anchor.
- **Why the reset at Mulai is required, not optional:** without it, an offset left over from an
  earlier jump (for example +1 day, used to get past `day_ended`) is still active when the new session
  starts. The session's `local_date` is computed from the real `started_at_ms` (today), but the view is
  tomorrow, so `autoStopAtMs(today) < viewNow`. **The auto-stop would fire on the very next render.**
  The reset prevents this.
- **Why the reset at Selesai or auto-stop is required:** the server stores the debrief window as
  `[realEnd, realEnd + 1 h]`. If the phone kept a +4 h offset, its debrief would already have expired
  the moment it opened.

### 1.4 Where the offset is stored: `sessionStorage`

| Option | Verdict |
|---|---|
| React state only | Lost on reload. A mid-debrief "+1 h, then reload" check (resume-after-reload is an R-07 rule) could not be tested. |
| URL query parameter | **Rejected.** It is a runtime input that anyone with a link can set. That is exactly what DEV-01's gating forbids, even behind the build gate. |
| `localStorage` | Survives a tab close, so an offset you forgot about would quietly shift tomorrow's testing too. |
| **`sessionStorage` (chosen)** | Survives a reload in the same tab. It is gone when the tab closes, so a forgotten offset can't carry over into another day's session. It is always shown in the dev panel (§4) and is cleared by every anchor reset. |

Key: `bee6.dev.clockOffsetMs`. The value is a decimal integer string. It is validated on every read (§5).

---

## 2. Safety: this can never run on the pilot or in a deployed demo

### 2.1 How the existing gate actually works (verified)

- `lib/capture/dev-mode.ts`: `isDevControlsEnabled()` returns
  `process.env.NEXT_PUBLIC_DEV_CONTROLS === "true"`. Next.js copies `NEXT_PUBLIC_*` values into the
  client bundle when `next build` runs (`node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`
  L158–166), so the value is fixed per build.
- Its only consumer is `app/capture/page.tsx` (`devControlsEnabled`: mounts `DevPanel`, wires `onEvent`).
- `.env.example` has `NEXT_PUBLIC_DEV_CONTROLS=false`. `.env.local` (untracked) does not set it.
- **What this misses:** if `NEXT_PUBLIC_DEV_CONTROLS=true` were ever set in a demo or pilot build
  environment, DEV-01's panel would ship. That is acceptable for DEV-01 (it only controls the mic and
  logs). It is **not** acceptable for a clock that changes when Selesai shows, when the auto-stop fires
  and when the debrief ends.

### 2.2 The double gate (exact condition)

Add this to the **same module**, `lib/capture/dev-mode.ts`, built from the existing check so there is
one flag rather than two that could drift apart:

```ts
/**
 * DEV-02 time-travel gate. Requires the DEV-01 flag AND a `next dev` build.
 * NODE_ENV is inlined at build time: "development" only under `next dev`,
 * "production" for every `next build`/`next start` (every Cloud Run deploy,
 * pilot and demo), "test" under vitest. So even a deploy built with
 * NEXT_PUBLIC_DEV_CONTROLS=true by mistake can never reach this.
 */
export function isDevClockEnabled(): boolean {
  return isDevControlsEnabled() && process.env.NODE_ENV === "development";
}
```

- The check is `=== "development"` (an allowlist), **not** `!== "production"`. A `test` or unset
  `NODE_ENV` therefore also stays off.
- **Why not `DEMO_MODE`:** it has no `NEXT_PUBLIC_` prefix, so it does not exist in the browser bundle
  (it would be `undefined` there). A client-side check on it would protect nothing. `NODE_ENV` is
  always copied into the bundle and Next.js sets it (`environment-variables.md` L278–283: `next dev` →
  `development`, every other command → `production`).
- **Result:** the time controls work only under `npm run dev` with `NEXT_PUBLIC_DEV_CONTROLS=true` in
  an untracked `.env.local`. Every deployed revision (pilot and demo) is built with `next build`, so
  they are off there no matter what the env template says.
- **No server change at all.** No route, no header, no server environment variable. There is nothing
  on the server to misconfigure.
- Like DEV-01, this makes no promise that the minifier removes the gated code from the production
  bundle. The guarantee is that it can never run. QA can optionally grep `.next/static` for
  `bee6.dev.clockOffsetMs` after `npm run build`. That is informational only, not an acceptance item.

### 2.3 Hard rules this touches

| Rule | How the plan meets it |
|---|---|
| §2.2 audio | Capture engine, segment upload and event payloads are untouched. The new event variant carries an integer and an enum only (§3, Task 1). |
| §2.2a / §2.7 answers wait on the phone for at most 14 days | Purges use the **real** clock. If a negative offset were applied to `purgeNow`, answers would be kept past 14 real days, which breaks this rule. This is the main reason the cache stays on wall-clock time. |
| §2.6 browsers never talk to Firestore | No new I/O. The only storage is one `sessionStorage` integer. |
| §2.7 people data | The stored value is an integer offset. No names, device ids or answers. |
| §2.8 public repo | No data. `.env.example` keeps `NEXT_PUBLIC_DEV_CONTROLS=false`. |
| Real-data integrity (not a numbered rule) | No fake timestamp is ever sent. See the open question for Rangga about local dev pointing at the pilot project. |

---

## 3. Files and exact changes

### 3.1 `lib/capture/dev-mode.ts` (modify)
Add `isDevClockEnabled()` exactly as in §2.2. `isDevControlsEnabled()` is not changed.

### 3.2 `lib/capture/dev-clock.ts` (create; pure functions; no env reads, no `Date.now()`)

```ts
import { z } from "zod";

export const DEV_CLOCK_STORAGE_KEY = "bee6.dev.clockOffsetMs";
/** 8 days: covers mulaiAvailability's 8-day next-offer search. */
export const DEV_CLOCK_MAX_ABS_OFFSET_MS = 8 * 86_400_000;

export type DevClockCause =
  | "nudge"
  | "jump_selesai"
  | "jump_auto_stop"
  | "jump_debrief_end"
  | "jump_next_mulai"
  | "reset_manual"
  | "reset_mulai"
  | "reset_selesai"
  | "reset_auto_stop"
  | "reset_batalkan";

export type DevClockStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const OffsetSchema = z
  .number()
  .int()
  .min(-DEV_CLOCK_MAX_ABS_OFFSET_MS)
  .max(DEV_CLOCK_MAX_ABS_OFFSET_MS);

/** True iff `ms` is an allowed offset. */
export function isValidOffset(ms: number): boolean;

/**
 * 0 when !enabled (and then storage is NOT touched at all), when storage is
 * undefined, when the key is missing, or when the value isn't /^-?\d+$/ or
 * fails OffsetSchema. An invalid value is also removed from storage.
 */
export function readDevClockOffset(storage: DevClockStorage | undefined, enabled: boolean): number;

/**
 * Returns false and touches nothing when !enabled, storage is undefined, or
 * !isValidOffset(ms). Otherwise: 0 → removeItem(key); non-zero → setItem(key, String(ms)); returns true.
 */
export function writeDevClockOffset(storage: DevClockStorage | undefined, enabled: boolean, ms: number): boolean;

/** realNowMs + offsetMs. */
export function viewNowMs(realNowMs: number, offsetMs: number): number;

/** targetViewMs − realNowMs (the offset that makes viewNow == target right now). */
export function offsetToReach(targetViewMs: number, realNowMs: number): number;

/**
 * A negative offset is refused while a debrief is open on the REAL clock
 * (debriefEndsAtMs !== null && realNowMs < debriefEndsAtMs). Reason: the
 * view would show the debrief open after the server's real window closed.
 * The answer would then get a 400 not_in_debrief, and the uploader drops
 * a 400 as removed_refused. Every other combination is allowed if valid.
 */
export function isOffsetAllowed(
  nextOffsetMs: number,
  ctx: { realNowMs: number; debriefEndsAtMs: number | null },
): boolean;

/** "±0" for 0; else sign + optional "{d}d " + "{h}h {mm}m", e.g. "+4h 00m", "−1h 00m", "+1d 1h 01m". Seconds are dropped (truncated toward 0). Use U+2212 for minus. */
export function formatOffset(ms: number): string;
```

### 3.3 `lib/capture/browser/event-log.ts` (modify)
Add one variant to `CaptureEvent`:

```ts
| { type: "dev_clock_changed"; offset_ms: number; cause: DevClockCause }
```

Import `DevClockCause` as a type from `@/lib/capture/dev-clock`. Update the doc comment: this variant
holds only an integer and a closed enum. Nothing else in the file changes.

### 3.4 `app/capture/DevPanel.tsx` (modify)

- `formatMetadata`: add `case "dev_clock_changed": return \`offset_ms=${event.offset_ms} cause=${event.cause}\`;`
  (the switch must stay exhaustive).
- New **optional** prop (keeping DEV-01's rule that new props are optional, and hidden when not
  passed):

```ts
export interface DevClockControls {
  offsetMs: number;
  /** Outlet timezone for the readout; null before config loads (readout shows "—"). */
  tz: string | null;
  /** Real-clock debrief end of this device (page's debriefEndsAtMs), for the backward-nudge rule. */
  debriefEndsAtMs: number | null;
  /** View-clock targets; null hides nothing but disables that button. */
  targets: {
    selesai: number | null;
    auto_stop: number | null;
    debrief_end: number | null;
    next_mulai: number | null;
  };
  onNudge: (deltaMs: number) => void;
  onJumpTo: (targetViewMs: number, cause: Extract<DevClockCause, `jump_${string}`>) => void;
  onReset: () => void;
}
// in DevPanelProps:
devClock?: DevClockControls;
```

- Render (only when `devClock !== undefined`) a `<div data-testid="dev-clock">` **between the
  Start/Pause/Stop row and the event log**, separated by the same dashed border as `READOUTS_STYLE`:
  1. Heading `Time travel (view clock)`.
  2. Readout line `data-testid="dev-clock-readout"`:
     - when `now === 0` (DevPanel's own 1 s tick hasn't fired yet) or `tz === null`: `Real — · View —`;
     - else when `offsetMs === 0`: `View = real time (YYYY-MM-DD HH:MM)`;
     - else: `Real YYYY-MM-DD HH:MM · View YYYY-MM-DD HH:MM (+4h 00m)`. Use `localDateOf` and
       `localHmOf` from `lib/capture/calendar` with `tz`, and `formatOffset`. Real = DevPanel's
       existing `now` state; view = `now + offsetMs`.
  3. When `offsetMs !== 0`, one extra line in `#b00020`: `View clock shifted. Timestamps sent to the server stay real.`
  4. Nudge row (`BUTTON_ROW_STYLE`, wraps): `−4h`, `−1h`, `+15m`, `+1h`, `+4h`, `+1d` → `onNudge(±ms)`.
     - The negative nudges (`−4h`, `−1h`) are **disabled** when
       `!isOffsetAllowed(offsetMs + delta, { realNowMs: now, debriefEndsAtMs })`. When `now === 0`
       they are disabled too.
  5. Preset row: `→ Selesai`, `→ Auto-stop`, `→ Debrief end`, `→ Next Mulai`, then `Reset`.
     - Each preset is disabled when its target is `null` or `target <= now + offsetMs` (already
       reached). Otherwise it calls `onJumpTo(target, "jump_selesai" | …)`.
     - `Reset` is disabled when `offsetMs === 0` and otherwise calls `onReset()`.
- English only, monospace, the existing styles. No dictionary keys (DEV-01 convention: the DevPanel is
  English-only dev text, and UX-03 has no dev-mode copy rules).

### 3.5 `app/capture/debrief/DebriefFlow.tsx` (modify)

- New optional prop `clockOffsetMs?: number`. Default `0` in the destructure. Doc comment: *"DEV-02 view-clock offset. Only timeout checks use it; every
  timestamp written or sent stays real."*
- The 1 s question tick (currently L146–150): dispatch `{ type: "TICK", now_ms: Date.now() + clockOffsetMs }`.
  Its dependency list becomes `[state.view.kind, clockOffsetMs]`, so a jump while a question is open
  restarts the interval with the new offset.
- `handleLanjut` (currently L192–227):
  ```ts
  const realNow = Date.now();
  const viewNow = realNow + clockOffsetMs;
  if (viewNow >= state.ends_at_ms) { dispatch({ type: "TICK", now_ms: viewNow }); return; }
  ...
  answered_at_ms: realNow,
  appendAnswer(effectiveStorage, entry, realNow);
  ```
- **Do not change:** the uploader's `now: Date.now`; `purgeNow(..., Date.now())` (L130, L178);
  `cachedIds(..., Date.now())` (L165); `ANSWER_RETRY_MS` and `ANSWER_PURGE_INTERVAL_MS`. These stay on
  the real clock (§1.3, §2.3).

### 3.6 `app/capture/page.tsx` (modify). Route this file to `developer` (sonnet).

Exact changes:

1. Imports: `isDevClockEnabled` from `@/lib/capture/dev-mode`. From `@/lib/capture/dev-clock`:
   `readDevClockOffset`, `writeDevClockOffset`, `isOffsetAllowed`, `offsetToReach`,
   `isValidOffset`, `type DevClockCause`. From `@/lib/capture/calendar`, add `selesaiFromMs` to the
   existing import.
2. Gate: `const devClockEnabled = isDevClockEnabled();` next to `devControlsEnabled`.
3. State and ref:
   ```ts
   const [devOffsetMs, setDevOffsetMs] = useState(0);
   const devOffsetRef = useRef(0);
   ```
4. Storage helper (module scope):
   `function devClockStorage(): Storage | undefined { return typeof window === "undefined" ? undefined : window.sessionStorage; }`
5. **Tick effect (currently L319–328).** Keep the empty dependency list. Change its body to:
   ```ts
   devOffsetRef.current = readDevClockOffset(devClockStorage(), devClockEnabled);
   const tick = () => {
     setDevOffsetMs(devOffsetRef.current);
     setNowMs(Date.now() + devOffsetRef.current);
   };
   tick(); // existing shape: an immediate tick, then setInterval + visibilitychange
   ```
   When the gate is off, `readDevClockOffset` returns 0 without touching storage, so
   `nowMs === Date.now()`, which is today's behaviour exactly. `devClockEnabled` is fixed at build time,
   so leaving it out of the dependency list is correct. Add an
   `// eslint-disable-next-line react-hooks/exhaustive-deps` only if lint actually asks for one, with a
   one-line reason.
6. One function changes the offset (an event-handler context, so `Date.now()` is allowed):
   ```ts
   function applyDevOffset(nextMs: number, cause: DevClockCause): void {
     if (!devClockEnabled) return;
     if (!isValidOffset(nextMs)) return;
     if (nextMs < 0 && !isOffsetAllowed(nextMs, { realNowMs: Date.now(), debriefEndsAtMs })) return;
     writeDevClockOffset(devClockStorage(), devClockEnabled, nextMs);
     devOffsetRef.current = nextMs;
     setDevOffsetMs(nextMs);
     setNowMs(Date.now() + nextMs);              // SAME batch: never a render with a stale nowMs
     handleEvent({ type: "dev_clock_changed", offset_ms: nextMs, cause });
   }
   function resetDevOffsetForAnchor(cause: Extract<DevClockCause, `reset_${string}`>): void {
     if (!devClockEnabled || devOffsetRef.current === 0) return;
     applyDevOffset(0, cause);
   }
   ```
   `isOffsetAllowed(0, …)` is always true, so resets are never blocked.
7. **Anchor resets.** Each one goes in the same synchronous block as the existing state update:
   - `handleMulaiTap`: immediately before `setSession({...})` (after `sessionRef.current = captureSession; setSessionRunning(true);`) → `resetDevOffsetForAnchor("reset_mulai")`.
   - `confirmSelesai`: immediately before `setLastEnded({...})` on the success path → `"reset_selesai"`.
   - Auto-stop microtask: immediately before `setLastEnded({...})` → `"reset_auto_stop"`.
   - `confirmBatalkan`: immediately before `setLastEnded({...})` on the success path → `"reset_batalkan"`.
   - **Why the order matters:** effects run in declaration order, and the auto-stop effect is declared
     **before** the tick effect. If `nowMs` were updated only by the tick effect, the render after
     `setSession` would pair the new session with the old shifted `nowMs`, and the auto-stop could
     fire on a session that just started. Updating `nowMs` in the same batch as `setSession` closes
     that gap.
8. **Timestamps sent to the server stay `Date.now()`.** Do not edit L297, L384, L434, L460, L471 or
   L476, except for the Batalkan item below.
9. Batalkan copy: in `renderBatalkanPanel`, change `nextMulaiIsNow(session.local_date, now, tz)` to
   `nextMulaiIsNow(session.local_date, now + devOffsetMs, tz)`. `isDiscardArmed` and the 15 s self-close
   stay on the real clock (`batalkanOpenedAtMs`/`batalkanTickMs`, unchanged).
10. Next-offer refactor (no behaviour change): pull the `mulaiAvailability(...).next_offer_ms`
    expression (currently inside the `nextMulaiText` IIFE, L245–264) into
    `const nextOfferMs: number | null = effectiveConfig && nowMs !== null ? mulaiAvailability({...same args...}).next_offer_ms : null;`.
    Build `nextMulaiText` from `nextOfferMs` exactly as today.
11. Preset targets (pure, computed in render):
    ```ts
    const devClockTargets = {
      selesai: session && config ? selesaiFromMs(session.started_at_ms, session.local_date, config.weekly_hours, config.timezone) : null,
      auto_stop: session && config ? autoStopAtMs(session.local_date, config.weekly_hours, config.timezone) : null,
      debrief_end: !session && debriefEndsAtMs !== null ? debriefEndsAtMs : null,
      next_mulai: !session && idle && !idle.offered ? nextOfferMs : null,
    };
    ```
    These real-clock anchors can be used directly as view-clock targets because of the anchor reset
    (§1.3).
12. Render the DevPanel only under the existing `devControlsEnabled` branch. Add the new prop only
    when `devClockEnabled`:
    ```tsx
    devClock={devClockEnabled ? {
      offsetMs: devOffsetMs,
      tz: config?.timezone ?? null,
      debriefEndsAtMs,
      targets: devClockTargets,
      onNudge: (d) => applyDevOffset(devOffsetRef.current + d, "nudge"),
      onJumpTo: (target, cause) => applyDevOffset(offsetToReach(target, Date.now()), cause),
      onReset: () => applyDevOffset(0, "reset_manual"),
    } : undefined}
    ```
    The `onNudge` / `onJumpTo` closures call `Date.now()` and read the ref only when clicked, never
    during render.
13. Pass `clockOffsetMs={devOffsetMs}` to `<DebriefFlow …/>`.
14. `.env.example`: **no change** (`NEXT_PUBLIC_DEV_CONTROLS=false` stays). Add one comment line above
    it: `# true only in an untracked .env.local; DEV-02 time travel additionally requires \`npm run dev\``.

**Files not to touch:** `lib/capture/calendar.ts`, `lib/debrief/flow.ts`, `app/capture/selesai-view.ts`,
`app/capture/idle-view.ts`, any `app/api/**` route, any `lib/**/service.ts`, `lib/debrief/answer-cache.ts`,
`lib/debrief/answer-uploader.ts`, the capture engine and session. If the builder finds it needs to edit
one of these, the plan is wrong: stop and flag it.

---

## 4. Edge cases (and the required behaviour for each)

| # | Case | Required behaviour | Why that is right |
|---|---|---|---|
| E1 | Gate off (any deploy, or flag unset) with a stale `bee6.dev.clockOffsetMs` already in `sessionStorage` | Ignored. Storage is not even read. `nowMs = Date.now()`. No `dev-clock` node. | Zero behaviour change, tested (T19, T20). |
| E2 | `NEXT_PUBLIC_DEV_CONTROLS=true` in a `next build` (a mis-set demo) | DEV-01 panel shows. **No time controls**, no offset applied. | Double gate (§2.2). |
| E3 | A stored value that is garbage, a float, in exponent notation, or out of range | Read as 0 and the key is removed. | `readDevClockOffset`. |
| E4 | Jump forward while idle before Mulai | Mulai availability and notes follow the view (for example `window_passed` after 17:45 on the demo hours). | Pure rules, same inputs. |
| E5 | Real time is after the Mulai cut-off (for example 20:00 when the window closes 17:45), so you jump −3 h and tap Mulai | Allowed. The server gets the real `started_at_ms` and records `capture.session_start_outside_window` (an audit only, accepted). The offset resets to 0. `local_date = businessDateOf(real)`. Selesai shows at `min(start + 4 h, close)` in real time, reachable with `→ Selesai`. | This is what makes evening testing possible. The extra audit line is expected in dev and is documented. |
| E6 | Running session, `→ Selesai` | The Selesai button shows straight away, without waiting for the 30 s tick (`nowMs` is set in the same batch). | |
| E7 | Running session, a jump to or past the auto-stop deadline | The existing auto-stop effect fires once (`autoStopInFlightRef`) with the **real** `ended_at_ms` and `end_reason: "auto_stop"`. The offset resets. The debrief runs `[realEnd, realEnd + 1 h]` on both phone and server. | The server's window comes from the client's `ended_at_ms`, so it has to be real (an `ended_at_ms` equal to the 22:45 deadline would be a real-future time, which puts every answer outside the window). The session's stored `ended_at_ms` is the click time, not 22:45. Accepted, documented. |
| E8 | Jump while the Selesai confirm panel or the Batalkan panel is open | No special handling. If the jump passes the auto-stop, the existing auto-stop code closes both panels. The Batalkan arm delay and self-close are real-clock durations and are not affected. | |
| E9 | A jump while Mulai, Selesai or Batalkan is in flight | Allowed. On success, the anchor reset overwrites it to 0. On failure (422/409), the offset stays. | Harmless. Logged as `dev_clock_changed`. |
| E10 | Debrief closed (card showing), then `+1h` or `→ Debrief end` | The card disappears (`nowMs >= endsAtMs`). Mulai remains `day_ended`. | Same end state as if real time had passed. |
| E11 | **A question is open, then a forward jump past the end** | Within ≤ 1 s the question tick (restarted with the new offset) dispatches TICK. The reducer goes to `timed_out` with `ended_at_ms = s.ends_at_ms`, so the screen shows the debrief end time, not the jump time. Any half-typed answer is dropped. Answers already in the cache keep uploading on the real clock and are accepted, because their `answered_at_ms` is real and inside the server window. | Exactly what real time would have produced (the reducer is idempotent past the end). |
| E12 | A question is open, then `Lanjut` right after a jump past the end, before the 1 s tick | The `handleLanjut` guard uses the view clock, goes to `timed_out`, writes nothing to the cache. | |
| E13 | **A backward jump while a debrief is open (real now < real end)** | Refused: the negative nudge buttons are disabled in the DevPanel, and `applyDevOffset` also returns early. | Otherwise the phone would accept an answer after the server's real window closed. The server would return 400 `not_in_debrief` and the uploader would **silently drop** it (`removed_refused`). |
| E14 | A backward jump while a session is running | Allowed. Selesai may hide again. No auto-stop. | Consistent with the view. |
| E15 | Repeating the loop in one sitting (the day has ended, so `day_ended`) | `→ Next Mulai` jumps to the next offer (tomorrow 01:00 or later, after the debrief). Tap Mulai: the server records the real `started_at_ms`, the session is dated today, the audit `capture.session_start_after_day_end` is written (accepted), and the offset resets. After the next Selesai, the server's `lastEndedFor` overwrites with the same `business_date` (`>=`), so a new debrief starts. | Lets QA and Rangga run the loop several times. Documented side effect: extra audit entries. |
| E16 | Reload in the middle of a debrief after `+15m` | The offset comes back from `sessionStorage`; `config.last_ended` (real time) plus the offset gives the same remaining time as before the reload. | Survives a reload by design. Note: a reload in the middle of a **session** still loses the local session, as it already does today (R-P1). DEV-02 does not change that. |
| E17 | The tab is closed and reopened | Offset 0. | `sessionStorage`. |
| E18 | `visibilitychange` and the 30 s tick | Both call `tick()`, which reads `devOffsetRef`, so they always use the current offset. | |
| E19 | `ANSWER_RETRY_MS`, `ANSWER_PURGE_INTERVAL_MS`, the 14-day cache age | Real clock, unaffected by any jump. | §2.3. A 14-day purge on a shifted clock would either delete real pending answers early (forward jump) or keep them past 14 days (backward jump). |
| E20 | Event log | Every offset change, including automatic resets, adds a `dev_clock_changed` line. Event `ts` stays real, so the "Xs ago" column measures real elapsed time. | QA evidence trail. |
| E21 | A jump of more than ±8 days | `isValidOffset` refuses it (a no-op). Presets never get near this. | |
| E22 | Clicking before the config has loaded | Nudges work (they only change `nowMs`). All presets are disabled (targets are null). | |

**Not in scope (stated so nobody expects it):** DEV-02 does **not** create debrief questions; they come
from the pipeline tick over real segments. With no questions, the debrief shows `empty`, which can still
be tested. DEV-02 does **not** move the server's question expiry (a tick on the real clock). The
"unanswered → `unverified` at the debrief end" row still needs the real hour, or an API-level check. It
does **not** work on a deployed URL (§2.2).

---

## 5. Tasks (TDD: write each failing test first, then the code)

### Routing
- **`developer-junior` (haiku), mechanical:** Task 1 (gate, pure module, event variant) and Task 2
  (DevPanel UI).
- **`developer` (sonnet), judgement:** Task 3 (`DebriefFlow`) and Task 4 (`page.tsx` wiring). These
  involve batch ordering, effect order against the auto-stop, and anchor resets. The **E7, E11 and
  E13** behaviours are the parts where judgement is still needed inside this plan. If
  `react-hooks/set-state-in-effect`, `refs` or `purity` lint objects to any step in §3.6, flag it with
  the exact message. Do not restructure on your own.

### Task 1: gate + pure dev-clock module + event variant
**Files:** `lib/capture/dev-mode.ts`, `lib/capture/dev-mode.test.ts`, `lib/capture/dev-clock.ts` (new),
`lib/capture/dev-clock.test.ts` (new), `lib/capture/browser/event-log.ts`.
Use `vi.stubEnv` / `vi.unstubAllEnvs()` (in `afterEach`) for env cases.

- T1 `isDevClockEnabled()` is false when `NEXT_PUBLIC_DEV_CONTROLS` is unset, with `NODE_ENV=development`.
- T2 it is false with the flag `"true"` and `NODE_ENV="production"`.
- T3 it is false with the flag `"true"` and `NODE_ENV="test"`.
- T4 it is false with the flag `"TRUE"` or `"1"` and `NODE_ENV="development"`.
- T5 it is true **only** with the flag `"true"` and `NODE_ENV="development"`.
- T6 `readDevClockOffset(storage, false)` returns 0 and **`getItem` is never called** (use a spy), even
  when the storage holds `"14400000"`.
- T7 `readDevClockOffset(storage, true)` returns 14400000 for `"14400000"` and −3600000 for `"-3600000"`.
- T8 For `"abc"`, `"1.5"`, `""`, `"1e3"`, `" 5"`, and `String(8*86_400_000 + 1)` it returns 0 and
  `removeItem(KEY)` is called. A missing key returns 0 and does **not** call `removeItem`.
- T9 `readDevClockOffset(undefined, true)` returns 0.
- T10 `writeDevClockOffset(storage, false, 5)` returns false and does not call `setItem`.
  `(storage, true, 5)` calls `setItem(KEY, "5")`. `(storage, true, 0)` calls `removeItem(KEY)`.
  `(storage, true, 1.5)` and `(storage, true, MAX + 1)` return false and touch nothing.
- T11 `viewNowMs(1000, 500) === 1500`, `offsetToReach(5000, 1000) === 4000`, `offsetToReach(1000, 5000) === -4000`.
- T12 `isOffsetAllowed(-1, { realNowMs: 10, debriefEndsAtMs: 20 })` is false.
  `isOffsetAllowed(-1, { realNowMs: 20, debriefEndsAtMs: 20 })` is true.
  `isOffsetAllowed(-1, { realNowMs: 10, debriefEndsAtMs: null })` is true.
  `isOffsetAllowed(5, { realNowMs: 10, debriefEndsAtMs: 20 })` is true.
  `isOffsetAllowed(MAX + 1, …)` is false.
- T13 `formatOffset`: `0 → "±0"`, `14_400_000 → "+4h 00m"`, `-3_600_000 → "−1h 00m"`,
  `90_060_000 → "+1d 1h 01m"`, `59_999 → "+0h 00m"`.
- T14 Type-level: a `dev_clock_changed` event with an extra `text` field is a type error. Add a
  `// @ts-expect-error` case to `event-log.test.ts`, next to DEV-01's existing check.
- Commit: `feat(dev-02): add dev-clock gate, pure offset module and event variant`.

### Task 2: DevPanel time-travel section
**Files:** `app/capture/DevPanel.tsx`, `app/capture/DevPanel.test.tsx`. Use fake timers, as the
existing DevPanel tests do, to drive its 1 s `now`.

- T15 Without the `devClock` prop, there is no `dev-clock` node. The existing DEV-01 and R-07 DevPanel
  tests pass **unmodified**.
- T16 With `offsetMs: 0`, the readout reads `View = real time (…)`, `Reset` is disabled, and there is
  no "shifted" warning line.
- T17 With `offsetMs: 14_400_000` and `tz: "Asia/Jakarta"`, after one 1 s tick at a fixed system time,
  the readout shows the real and view times 4 h apart, plus `(+4h 00m)` and the warning line.
- T18 Clicking `+1h` calls `onNudge(3_600_000)`, `−1h` calls `onNudge(−3_600_000)`, `+1d` calls
  `onNudge(86_400_000)`, and `Reset` calls `onReset`.
- T19a A preset with a `null` target is disabled. A preset whose target is in the future (view time)
  calls `onJumpTo(target, "jump_selesai")`. A preset whose target is ≤ the current view time is disabled.
- T19b With `debriefEndsAtMs` = now + 30 min and `offsetMs: 0`, `−1h` and `−4h` are disabled while `+1h`
  is enabled. With `debriefEndsAtMs: null`, the negative nudges are enabled.
- T19c The log renders a `dev_clock_changed` event as `offset_ms=14400000 cause=jump_selesai`.
- Commit: `feat(dev-02): add time-travel controls to the dev panel`.

### Task 3: DebriefFlow view-clock offset
**Files:** `app/capture/debrief/DebriefFlow.tsx`, `app/capture/debrief/DebriefFlow.test.tsx`.

- T20 Every existing `DebriefFlow` test passes **unmodified**, so the default `clockOffsetMs` of 0 is
  proven to change nothing.
- T21 Question open, `endsAtMs` = real + 30 min. Re-render with `clockOffsetMs = 31 min`, advance 1 s:
  the timeout screen shows, and its heading carries `clockLabel(endsAtMs)`, not the jump time.
- T22 Question open, `clockOffsetMs = 0`: choose and type, then `Lanjut`. The cached entry's
  `answered_at_ms` equals the fixed real `Date.now()`.
- T23 Same as T22 but with `clockOffsetMs = 10 min` (still inside the window): the cached
  `answered_at_ms` is still the **real** `Date.now()`, not real + 10 min.
- T24 `clockOffsetMs` puts the view past `endsAtMs`, then `Lanjut` is clicked before any tick: there is
  no cache write (storage is unchanged) and the timeout screen shows.
- Commit: `feat(dev-02): run debrief timeout checks on the dev view clock`.

### Task 4: page wiring (developer, sonnet)
**Files:** `app/capture/page.tsx`, `app/capture/page.test.tsx`, `.env.example` (comment only).
In `page.test.tsx`, extend the existing `vi.mock("@/lib/capture/dev-mode", …)` factory with
`isDevClockEnabled: () => isDevClockEnabled()` (a new `vi.fn(() => false)`). This is a mock-only edit.
No existing assertion may change. Seed `window.sessionStorage` per test and clear it in `afterEach`.

- T25 **Gate fully off:** both mocks false, `sessionStorage` pre-seeded with `"14400000"`, a session
  started at a fixed time. Selesai is **not** shown until the fake timers really advance 4 h, and there
  is no `dev-clock` node. (E1)
- T26 **Mis-set demo build:** `isDevControlsEnabled` true, `isDevClockEnabled` false, storage seeded.
  The `dev-panel` is present, `dev-clock` is absent, and Selesai behaves exactly as in T25. (E2)
- T27 Clock on: tap Mulai. The `postSessionStart` body has `started_at_ms === Date.now()` at the tap.
  Click `→ Selesai`: **without advancing timers**, the Selesai button appears. (E6)
- T28 Clock on: after T27's jump, confirm Selesai. `postSessionEnd` has `ended_at_ms === Date.now()`
  (real) and `end_reason: "selesai"`. Afterwards the readout reads `View = real time`, the storage key
  is gone, the log contains `cause=reset_selesai`, and the debrief card says 60 minutes left
  (`C-d-entry-left` with `mm: 60`).
- T29 Clock on: a running session, then `→ Auto-stop`. Flush microtasks: `postSessionEnd` is called
  **exactly once**, with `end_reason: "auto_stop"` and a real `ended_at_ms`, and the offset is reset. (E7)
- T30 Clock on: with a leftover offset of +1 day from `→ Next Mulai`, tap Mulai. After the start
  resolves, the offset is 0 **and `postSessionEnd` is never called** (the auto-stop did not fire).
  This is the regression test for §1.3 "why the reset at Mulai is required".
- T31 Clock on: after Selesai, `→ Debrief end`. The card disappears and the Mulai button is still
  `aria-disabled`. (E10)
- T32 Clock on: after Selesai (debrief open on the real clock), `−1h` and `−4h` are disabled. Clicking
  the disabled `−1h` (`fireEvent.click`) leaves the readout at `View = real time` and the storage key
  absent. The page-level guard in `applyDevOffset` is the second line of defence; Task 1's
  `isOffsetAllowed` tests (T12) cover its logic. (E13)
- T33 Clock on: storage pre-seeded `"900000"` (+15 min) and a `config.last_ended` with
  `debrief_ends_at_ms = real + 60 min`. After mount, the readout shows `(+0h 15m)` and the card says
  45 minutes left. (E16)
- T34 Clock on: Batalkan after a `+1h` jump. The `postSessionDiscard` body has a real `discarded_at_ms`
  and the log shows `cause=reset_batalkan`.
- Commit: `feat(dev-02): wire the dev view clock into /capture with anchor resets`.
- Commit (separate): `chore(dev-02): note the time-travel gate in .env.example`.

### Task 5: manual check (recorded in this file's Result section)
With `NEXT_PUBLIC_DEV_CONTROLS=true` in `.env.local`, then `npm run dev` restarted (the flag only takes
effect after a restart, see DEV-01's result notes):
1. Load `/capture`, tap Mulai, then `→ Selesai`, tap Selesai and confirm. The debrief card shows about
   60 minutes.
2. Open the debrief (empty or with questions), press `+1h`, and the timeout screen shows within 1 s.
3. `→ Next Mulai`, Mulai, `→ Auto-stop`: a new debrief appears.
4. At 360 px (DevTools, iPhone SE), the time section wraps with no horizontal scroll.
5. `npm run build && npm start` with the same `.env.local`: the DEV-01 panel shows but the
   **time-travel section is absent**. This proves the NODE_ENV gate on a real production build.

---

## 6. What this unblocks (concrete)

All of the rows below become runnable **locally (`npm run dev` + Playwright or by hand), in minutes**.
None of them become runnable on the live demo URL (§2.2). The demo-URL versions of these rows keep their
current method (Playwright `page.clock` for screen states, or crafted API timestamps).

| Doc / row | Today | With DEV-02 |
|---|---|---|
| `QA-demo-regression.md` §8 **P1-4** (Selesai hidden before start + 4 h, shown with no reload) | crafted API `started_at_ms` + fake timers | real Mulai tap, then `→ Selesai`, no reload |
| §8 **P1-5** (Selesai confirm → session ends → debrief entry shows) | needs P1-4's 4 h | end to end in about 1 minute |
| §8 **P1-6** (auto-stop at close + 1 h) | API-level only, with "let the tick/timer catch it" | real UI auto-stop via `→ Auto-stop`, with the `auto_stop` end and the debrief start checked on the phone |
| §9 "debrief entry within 2 s of Selesai (or auto-stop)" | needs a real Selesai, so 4 h | runnable |
| §9 *Lewati* "reopen within the hour, blank state" | needs a real Selesai | runnable (the expiry half still needs the real hour or an API check) |
| §9 "Mulai stays disabled until the debrief's 1 h timeout even once every question is answered" | 1 real hour | answer, check Mulai is disabled, `→ Debrief end`, check Mulai behaviour (still `day_ended` the same day, offered at `→ Next Mulai`) |
| §9 "Each device's unanswered questions expire at its own debrief end" | two real hours across two devices | **phone side only** (each phone's timeout screen). Server-side expiry is still the real tick. |
| §11 **R5** in Rangga's recorded test (a debrief question appears after Selesai/auto-stop) | Rangga waits 4 h after Mulai to reach Selesai | Selesai minutes after the recording (the recording itself and R1–R4, R6 are unchanged) |
| `docs/plan.md` §5, **Sat 10**: "a full Mulai → Selesai → debrief loop (2 h)" | 4 h+ of wall-clock waiting | a local loop takes minutes. **The real-phone part on the deployed pilot test outlet still runs on real time** (open question 2). |
| SIT/UAT: the R-07 plan's and technical spec §8's session-lifecycle rows (Selesai, auto-stop, debrief, timeout) | same blockers | same unblocking, locally |

---

## 7. Effort (plan.md format)

| Slice | Who | Hours |
|---|---|---|
| Task 1: gate + `dev-clock.ts` + event variant + T1–T14 | developer-junior | 0.75 |
| Task 2: DevPanel time section + T15–T19c | developer-junior | 0.75 |
| Task 3: DebriefFlow offset + T20–T24 | developer | 0.5 |
| Task 4: page wiring + T25–T34 | developer | 1.5 |
| Task 5: manual check | Rangga (5 min) / QA local | 0.25 |
| **Total build** | | **3.75 h** (+ tech-lead review and QA, as usual) |

**Calendar impact:** Sprint 2 is already at 105% with no buffer (`docs/plan.md` §5). DEV-02 is not on
the go-live critical path, but it **directly shortens** Sat 10's 2 h loop test and the Sun 11 sign-off
evidence. It also makes R-07's acceptance rows runnable before sign-off. Recommendation: build it
**Thu 8 / Fri 9 in parallel with R-08**. It touches only `/capture` files, and R-08 touches none of
them (ask tech-lead before dispatching, per the parallel-work rule). If something has to give, it comes
out of Sat 10's 4 h free slot, which DEV-02 itself partly gives back.

---

## 8. Open questions for Rangga

1. **Local dev points at the pilot project.** `.env.local` has
   `GOOGLE_CLOUD_PROJECT=<PILOT_PROJECT_ID>` (pilot, real data). DEV-02 never sends a fake timestamp.
   But every local loop (Mulai, Selesai, answers, plus the expected `start_outside_window` and
   `start_after_day_end` audits from E5 and E15) writes test sessions to **pilot Firestore**. Until
   go-live (Mon 12) that is the test outlet, which is allowed in the internal window. **After go-live it
   must not be.** Recommendation: point `.env.local` at `bee6-playground` (demo) for DEV-02 testing, as
   a dev-ops task, or confirm explicitly that the pilot test outlet is acceptable until Sun 11.
2. **Judge demos and the Sat 10 real-phone test run on deployed builds**, where this is off by design
   (the PM's own requirement: impossible even if the flag leaks into a demo build). Is that acceptable?
   - Judges' live use of the demo outlet would need pre-seeded, already-ended days. The video can be
     recorded from a local `npm run dev` against the demo project.
   - The real phone on Sat 10 can only use DEV-02 if it loads the laptop's dev server over HTTPS
     (`next dev --experimental-https`; `getUserMedia` needs a secure context).
   - **What would change my recommendation:** if you need time travel on a deployed demo revision, that
     calls for a different design that works with the server (Approach B, demo project only, with a
     server-side gate). It is a deliberate scope decision, not part of this task.
3. **Extra audit entries** (`capture.session_start_outside_window`, `capture.session_start_after_day_end`)
   from evening and repeat-loop testing (E5, E15). Fine on the test outlet / demo project? (Assumed yes.)

---

## Acceptance
- [ ] `npm run lint` / `npm run typecheck` / `npx vitest run` are clean. Every existing test passes
  with no assertion changed (only `page.test.tsx`'s dev-mode mock factory gains one export).
- [ ] Time controls are **absent from the render tree** unless `NEXT_PUBLIC_DEV_CONTROLS === "true"`
  **and** `NODE_ENV === "development"` (T5, T25, T26, Task 5 step 5).
- [ ] With the gate off, a stored offset has no effect and storage is not read (T6, T25).
- [ ] Every timestamp sent to the server or written to the answer cache is real `Date.now()` (T22,
  T23, T27, T28, T29, T34).
- [ ] The full Mulai → Selesai → debrief → timeout loop and the auto-stop loop run in minutes on
  `npm run dev` (Task 5).
- [ ] No server, calendar, flow-reducer, cache or uploader file is changed (`git diff --stat` against
  `origin/main` lists only the files in §3).
- [ ] The 360 px layout holds with the time section open.

## Result
_(builder fills in: commits, test counts, Task 5 observations, anything flagged rather than improvised)_

# DEV-03: `/capture` "fast day" + "run the pipeline tick now" (dev-only, demo outlet, real server and real Firestore)

Status: **PLAN v2, revised by tech-lead on Fri 9 Oct after Rangga's answers to the v1 open questions.
Supersedes DEV-02 (view clock) and DEV-04 (debrief sandbox, dropped; see §1.5). Waiting for the PM's
edge-case brainstorm, the uiux pass (Task U, §3.10), then Rangga's "go". Nothing is built.**

> New idea, not a backlog task (CLAUDE.md §10 rule 11). This file is the spec and the plan in one, the
> same as `DEV-01-capture-dev-mode.md`. The builder follows it **literally**. If something here turns
> out to be wrong against the real code, **stop and flag it**. Do not work around it.

**Base:** `origin/main` @ `31161e6`. **Build in a fresh worktree off `origin/main`.** Never switch refs in
the shared tree. Two PRs (§6): `feat/dev-03a-tick-now` first, then `feat/dev-03-fast-day` on top of it.

### What changed from v1 (Rangga's answers, 9 Oct)

| v1 question | Rangga's answer | What this plan now does |
|---|---|---|
| 1 Demo only | "Agree" | Unchanged: every dev route refuses a non-demo outlet (§2.3). |
| 2 Debrief D 1–60, default 5 | "Agree, but show it in the UI so the user knows it. Consult UIUX. The tick-now button can override the waiting" | D stays 1–60, default 5. **New:** an always-visible fast-day indicator with live countdowns (§3.10, Task 5b), designed by uiux first (Task U). **New:** "Run pipeline tick now" is a manual button usable at any moment, with or without a fast day (§3.11). |
| 3 "Gap from now" instead of typed times | "No, keep using open/close times" | **Reverted to typed clock-face open and close times** (`<input type="time">`). No "gap" knob. §1.2, §3.2. |
| 4 Typed times cost +0.5 h | (accepted with 3) | Included in the effort (§6). |
| 5 Tick-now route | "Yes, I want this" | In scope as PR A (DEV-03a), real Gemini cost on the demo project. |
| DEV-04 sandbox | "What is the problem if we still use the real Firestore/network? Not UI testing only, functionality too" | **DEV-04 dropped.** The fast day with C = 0 plus tick-now gives a real, Firestore-backed debrief with real generated questions in about 3–4 minutes. §1.5 says what is lost by dropping it. |

**Covers Rangga's requests (8 Oct):**
1. "Customizable open and close time with at minimum 1 minute (best practice 3 minutes) time gap." → typed open/close, gap ≥ 1 min, prefilled to now → now + 3.
2. "Customizable auto-close duration with at minimum 1 minute." → A, 1–60 min.
4. "Skip Mulai → close, go straight into the debrief" → a fast day with `selesai_after_mulai_min = 0` puts Selesai on screen at the Mulai tap; tick-now then fills that debrief with real questions (§1.5).

---

## 1. Checking the requests against the real code

### 1.1 Shortening the outlet's hours alone does not work (unchanged from v1, still true on `origin/main`)

Example: Thursday hours `09:00`–`09:03`, `Asia/Jakarta`, now `09:00`.

1. **The outlet doc is refused before any rule runs.** `DayHoursSchema` (`lib/firestore/schema.ts`
   L60–76) requires "open at least 4 h" and "the Mulai window ends after 03:00". `parseOutletDoc` throws,
   `GET /api/v1/capture/config` and every session route return 500. `npm run seed` refuses it too.
2. **Even with the schema bypassed, Mulai is not offered.** `mulaiWindowFor` (`calendar.ts` L179–191) is
   `[01:00, close − 4 h]`.
3. **The close never makes Selesai sooner.** `selesaiFromMs = min(start + 4 h, close)`; any in-window
   start gives `start + 4 h`.
4. **Auto-stop is `close + 60 min` and the debrief is 60 min** on both phone and server, independent of hours.

So the fast day is **hours plus three durations**, applied by the **server** and sent to the phone in the
config response, so both sides compute from identical inputs and every timestamp stays the real `Date.now()`.

### 1.2 Typed open and close times: what each one actually drives

Rangga chose typed clock-face times (answer 3). What the code does with them:

- **`close`** drives everything in the loop: Mulai window end (`close − C`), auto-stop (`close + A`), and
  `selesaiFromMs`'s `min(…, close)`.
- **`open`** drives no rule in the loop. The Mulai window starts at **01:00** of the business day
  (`mulaiWindowFor`), not at `open` (production rule §4.0: staff may start before opening for prep).
  `open` matters only for validity (`open ≥ 01:00`, `open ≠ close`, gap) and for the hours shown on screen.
  **Consequence a tester must know:** typing an open time in the future does **not** hide Mulai; Mulai is
  offered from 01:00, exactly as in production. The indicator shows the typed hours so this is not confusing.
- Typed times let a tester reach states "gap from now" could not: a close already passed (the
  `window_passed` / missed-day screen), or real-looking hours with short durations. These are allowed, with
  a non-blocking warning (§3.2 `warnings`).

### 1.3 The fast day's knobs and the real floor of each

| Knob | Meaning in code | Allowed | Floor and why |
|---|---|---|---|
| `open`, `close` (`"HH:MM"`, outlet-local, today's business day) | the weekday's hours for this business date only | `open ≥ 01:00`; `open ≠ close`; `close ≤ open` means next day; close at most 01:00 next day (`MAX_CLOSE_ABS_MIN`); **gap = close − open ≥ C + 1 min** | Gap ≥ 1 min is Rangga's minimum (C = 0). **Recommended: gap 3, C 1** (Mulai, Selesai at +1, close at +3, auto-stop at close + A are distinct moments). The DevPanel prefills open = current minute, close = open + 3. |
| `selesai_after_mulai_min` (C) | both `SELESAI_AFTER_START_MS` and `MULAI_CUTOFF_BEFORE_CLOSE_MS` (`calendar.ts` L17–19, kept equal on purpose, §4.0) | 0 – 240, and ≤ gap − 1 | **0 is safe**: Selesai shows at the tap. Keeping both equal keeps the production invariant "Selesai never later than close for an in-window Mulai". |
| `auto_stop_after_close_min` (A) | `AUTO_STOP_AFTER_CLOSE_MS` | 1 – 60 | 1 is safe. The phone enforces it from the page's 30 s tick (0–30 s late, same as production). |
| `debrief_min` (D) | `DEBRIEF_DURATION_MS` on phone **and** server | 1 – 60, **default 5** (Rangga agreed 9 Oct) | **Hard ceiling 60**: the answer route's step 11 (`lib/debrief/service.ts` L172) accepts answers only in `[ends − 60 min, ends]`; a longer debrief would 400 early answers and the uploader silently drops a 400. Floor 1 is functionally safe. **For a real-question loop use D ≥ 5** (questions arrive about 2 min after Selesai, §1.4). |

The page's 30 s tick is **not** changed. The indicator (§3.10) has its own 1 s display tick, so countdowns
are exact even though the page's own transitions can lag up to 30 s (same as production).

### 1.4 How fast real questions can appear (corrected from v1)

v1 said "about 5–12 min after the last speech, ≥ 15 min debrief". That was wrong: it confused thread
**grace** (which only decides whether a later unit continues a thread) with question **creation**. Checked
in `lib/pipeline/tick/service.ts` and `lib/pipeline/windowing.ts` on `origin/main`:

- A question is written **at labelling time** (`processOneUnit` → `questionWrites`), when a unit is labelled
  and the gate does not pass (or the label call fails → `unlabelled_unit`).
- A unit is ready when its window is **closed**: `as_of_ms − last_line_end ≥ 90 s` (`finalizeWindow`, the
  90 s silence rule) or the 6-min cap. `as_of_ms = newest.device_end + (server_now − newest.received_at)`,
  so after Selesai (no new segments) windows close 90 s after the last speech.
- A window with ≥ 10 s of speech is its own unit and is labelled as soon as it is closed. **Tiny windows**
  (< 10 s of speech) are batched per 3-min clock block and wait for that block to end.
- Without tick-now, a tick only runs when the **deployed** demo service's Cloud Scheduler job calls it
  (every 2 min, if that job exists and reads the same Firestore). Local `npm run dev` has no tick at all.

**With tick-now:** speak for 30–60 s (≥ 10 s of speech per burst), tap Selesai, wait **~90 s** of silence,
tap "Run pipeline tick now" → questions are in Firestore. The 90 s silence rule is the pipeline's own rule
and is **not** bypassed (that would mean faking `now_ms` into the pipeline, which fake-dates real writes).
Tick-now skips the **scheduler** wait (2 min deployed, infinite locally), not the silence rule.

### 1.5 Reconciliation of Rangga's DEV-04 objection (answer 5): DEV-04 is dropped

Rangga's objection: "What is the problem if we still use the real Firestore/network? It is not UI testing
only, but functionality as well with shorter hours." He is right, and v1's reason for a sandbox no longer
holds: v1 argued "a real session cannot give questions on demand, they come only from the pipeline tick".
With tick-now in scope (answer 4), that is no longer true. The real path now is:

| Step | Time |
|---|---|
| Start fast day: open = now, close = now + 3, **C = 0**, A = 1, D = 5 | 0:00 |
| Mulai (Selesai is on screen immediately) → read the fictional script aloud for 30–60 s | 0:10 – 1:10 |
| Selesai → confirm → the real debrief opens (real `last_ended`, real 5-min window on server and phone) | ~1:15 |
| Wait ~90 s of silence (the indicator shows the debrief countdown) → **Run pipeline tick now** | ~2:45 |
| Open the debrief card (or Back then reopen it if you opened it early and saw "empty") → real questions | ~3:00 |
| Answer → real answer route, real SDP redaction of the reason, real Firestore write | ~3:00 – 6:15 |
| Debrief ends → **Run pipeline tick now** again → unanswered questions expire to `unverified` (real `expireOpenQuestions`) | ~6:20 |

This exercises everything DEV-04's fake skipped: transcription, SDP redaction, windowing, Gemini labelling,
the evidence gate, thread and question writes, the answer route's window check, answer redaction and the
debrief-end expiry. **A separate sandbox is unnecessary for go-live.**

**What dropping DEV-04 honestly loses** (stated so the PM can bring it back to Rangga if he wants it later):
1. **Questions on demand in exact shapes**: 7 questions (to see the 5-question cap), a specific category mix,
   incident-first ordering. On the real path the count and categories depend on what Gemini labels and the
   gate decides; a tester can steer it with the fictional script but not dictate it.
2. **Forced server failures**: a 400 refusal, a 503 retry, a 500 load error. The real path can show offline
   (Chrome DevTools → Network → Offline) and the timeout (D = 1–2), but not a forced 400/503.
3. These are **already covered by unit tests** on `origin/main` (`app/capture/debrief/DebriefFlow.test.tsx`,
   `QuestionScreen.test.tsx`, `lib/debrief/*.test.ts`), so the residual is visual-only, for screens that
   R-07 already shipped. **Recommendation:** do not build it. If Rangga later wants the visual check of those
   shapes, it is a 2 h post-go-live task (Mon 12 – Wed 14 evenings), not a blocker. `DEV-04-debrief-sandbox.md`
   is now a short "dropped" record pointing here.

### 1.6 What a fast day still cannot show

- **Production-length copy** ("You can tap End from 18:00" four hours out). The calendar unit tests cover it.
- **A Cloud-Scheduler-driven tick under `next dev`.** Tick-now is the local substitute (same `runTick`).
- **Multi-device merging**: not in MVP 1.

---

## 2. Safety: three layers, none of which a deploy can reach

### 2.1 Layer 1: the route files do not exist in a production build (structural)

Dev routes are named `route.dev.ts`. `next.config.ts` becomes a phase function adding `dev.ts`/`dev.tsx`
to `pageExtensions` **only** for `PHASE_DEVELOPMENT_SERVER`
(`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/index.md` L85–88). In
`next build`, `route.dev.ts` is not a route file and is not built. **Task 0 verifies this on Next 16.3.7
first.** If it fails, continue with layers 2 and 3 only (after the PM confirms) and record it in Result.

### 2.2 Layer 2: one runtime gate, shared by phone and server

Add to `lib/capture/dev-mode.ts`:

```ts
/**
 * DEV-03 gate: the DEV-01 flag AND a `next dev` process. NODE_ENV is
 * "development" only under `next dev`; every `next build`/`next start`
 * (every Cloud Run deploy, pilot and demo) is "production"; vitest is "test".
 * So even a deploy built with NEXT_PUBLIC_DEV_CONTROLS=true by mistake can
 * never reach a dev route, a fast day or the tick-now button.
 */
export function isDevToolsEnabled(): boolean {
  return isDevControlsEnabled() && process.env.NODE_ENV === "development";
}
```

- Every `route.dev.ts` handler's **first statement**: `if (!isDevToolsEnabled()) return new Response(null, { status: 404 });` (before auth, before any read).
- `getDevFastDay()` returns `null` when the gate is off, even if something was stored.
- The phone ignores `config.dev_fast_day`, and renders neither the indicator nor the tick button, unless `isDevToolsEnabled()`.

### 2.3 Layer 3: dev routes only act on a **demo** outlet (confirmed by Rangga, answer 1)

Every dev route loads the caller's outlet and refuses with `403 { code: "dev_demo_only" }` unless
`outlet.project_kind === "demo"` (`OutletSchema` L120). **Prerequisite:** Rangga's `.env.local` points at
`bee6-playground` with a seeded, paired demo device, and local Application Default Credentials can call
Vertex and SDP on `bee6-playground` (dev-ops, §6).

### 2.4 Hard rules this touches

| Rule | How the plan meets it |
|---|---|
| §2.1 Google only | Tick-now calls the existing `runTick` (Gemini via `@google/genai`, Vertex). No new SDK. |
| §2.2 audio | No change to capture, segments or logs. The fast day holds hours and integers; the tick result holds counts only. |
| §2.3 redaction | No new text path. Tick-now runs the existing pipeline, which already scrubs and redacts. |
| §2.4 real data only on paid cloud | Demo outlet only (§2.3), fictional speech only (Task 6 script). Tick-now uses the same local credentials local transcription already uses; **no new credential path**. See open question 2 about local ADC vs the service account. |
| §2.5 regions | Tick-now reaches the model only through the existing label client, which reads `config/regions.yaml`. |
| §2.6 browsers never talk to Firestore | All dev actions go through our API (`requireDevice` + outlet check). |
| §2.7 people data | Fast day: hours and durations only. Tick result: counts and a skipped reason, no text, no names. Reset audit is `actor_role: "device"`. |
| §2.8 public repo | No real data. `.env.example` keeps `NEXT_PUBLIC_DEV_CONTROLS=false`. The fictional script lives in this file. |
| §2.9 / §2.10 | SOP, proposals and the gate code are untouched; tick-now runs the gate exactly as the scheduler does. |
| Real-data integrity | Every timestamp is the real `Date.now()`, on the phone and in `runTick({ now_ms: Date.now() })`. Demo outlets only. |

---

## 3. Files and exact changes

### 3.1 `lib/capture/calendar.ts` (modify; pure; `developer`) — unchanged from v1

```ts
/** The three durations a day runs on (§4.0, §4.8, §8.10). Production values unless a DEV-03 fast day is active. */
export interface DayTiming {
  /** Selesai shows this long after Mulai AND the Mulai window ends this long before close (kept equal, §4.0). */
  selesai_after_mulai_ms: number;
  auto_stop_after_close_ms: number;
  debrief_duration_ms: number;
}
export const PRODUCTION_TIMING: Readonly<DayTiming> = Object.freeze({
  selesai_after_mulai_ms: SELESAI_AFTER_START_MS,
  auto_stop_after_close_ms: AUTO_STOP_AFTER_CLOSE_MS,
  debrief_duration_ms: DEBRIEF_DURATION_MS,
});
```

Add a **trailing optional** `timing: DayTiming = PRODUCTION_TIMING` parameter; every existing call keeps working:
- `autoStopAtMs(localDate, weekly, tz, timing)`: `+ timing.auto_stop_after_close_ms`.
- `mulaiWindowFor(localDate, weekly, tz, timing)`: `end_ms: c - timing.selesai_after_mulai_ms`.
- `mulaiWindowDateOf(ms, weekly, tz, timing)`: pass to `mulaiWindowFor`.
- `selesaiFromMs(startedAtMs, localDate, weekly, tz, timing)`: `startedAtMs + timing.selesai_after_mulai_ms`.
- private `nextOfferMs(..., timing)`: pass to `mulaiWindowFor`.
- `mulaiAvailability(input)`: input gains `timing?: DayTiming`; `const timing = input.timing ?? PRODUCTION_TIMING;`.
- `evaluateCheckpoint`: unchanged. No env read, no `Date.now()`.

### 3.2 `lib/dev/fast-day.ts` (create; pure, isomorphic; `developer-junior`) — **rewritten for typed times**

```ts
import { z } from "zod";
import {
  WEEKDAYS, MAX_CLOSE_ABS_MIN, MULAI_WINDOW_OPEN_MIN, parseHmToMinutes, closeAbsMinutes,
  type WeeklyHours,
} from "@/lib/firestore/schema";
import {
  PRODUCTION_TIMING, businessDateOf, localDateOf, weekdayOf, closeMs as closeMsOf, type DayTiming,
} from "@/lib/capture/calendar";
import type { CaptureConfigResponse } from "@/lib/capture/contract";

const MIN = 60_000;
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** POST /api/dev/fast-day body. Times are outlet-local, for TODAY's business date. */
export const FastDayInputSchema = z
  .object({
    open: hm,
    close: hm,
    selesai_after_mulai_min: z.number().int().min(0).max(240),
    auto_stop_after_close_min: z.number().int().min(1).max(60),
    debrief_min: z.number().int().min(1).max(60),
    reset_last_ended: z.boolean(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (parseHmToMinutes(v.open) < MULAI_WINDOW_OPEN_MIN) {
      ctx.addIssue({ code: "custom", path: ["open"], message: "Open must be 01:00 or later" });
      return;
    }
    if (v.open === v.close) {
      ctx.addIssue({ code: "custom", path: ["close"], message: "Close must differ from open" });
      return;
    }
    const closeAbs = closeAbsMinutes({ open: v.open, close: v.close });
    if (closeAbs > MAX_CLOSE_ABS_MIN) {
      ctx.addIssue({ code: "custom", path: ["close"], message: "Close must be 01:00 next day or earlier" });
      return;
    }
    const gap = closeAbs - parseHmToMinutes(v.open);
    if (gap < v.selesai_after_mulai_min + 1) {
      ctx.addIssue({
        code: "custom",
        path: ["close"],
        message: `Close must be at least ${v.selesai_after_mulai_min + 1} min after open`,
      });
    }
  });
export type FastDayInput = z.infer<typeof FastDayInputSchema>;

export const DayTimingSchema = z
  .object({
    selesai_after_mulai_ms: z.number().int().min(0).max(240 * MIN),
    auto_stop_after_close_ms: z.number().int().min(MIN).max(60 * MIN),
    debrief_duration_ms: z.number().int().min(MIN).max(60 * MIN),
  })
  .strict();

/** The stored and wire shape (config response `dev_fast_day`). */
export const DevFastDaySchema = z
  .object({
    business_date: dateString,
    weekday: z.enum(WEEKDAYS),
    open: hm,
    close: hm,
    timing: DayTimingSchema,
  })
  .strict();
export type DevFastDay = z.infer<typeof DevFastDaySchema>;

export type FastDayWarning = "mulai_window_passed" | "mulai_window_short";

export type FastDayBuild =
  | {
      ok: true;
      fast_day: DevFastDay;
      preview: { mulai_until_ms: number; close_ms: number; auto_stop_ms: number };
      warnings: FastDayWarning[];
    }
  | { ok: false; code: "fast_day_before_business_day" };

/** All seven weekdays closed; `applyFastDay(EMPTY_WEEK, f)` gives a table with only the fast weekday open. */
export const EMPTY_WEEK: WeeklyHours = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

export function buildFastDay(input: FastDayInput, now_ms: number, tz: string): FastDayBuild;
export function applyFastDay(weekly: WeeklyHours, fast: DevFastDay): WeeklyHours;
export function fastDayCloseMs(fast: DevFastDay, tz: string): number;
export function effectiveCaptureConfig(
  loaded: CaptureConfigResponse,
  devToolsEnabled: boolean,
): { config: CaptureConfigResponse; timing: DayTiming };
```

`EMPTY_WEEK` is valid: tech-lead checked `origin/main` `lib/firestore/schema.ts` L100–106, every weekday is
`DayHoursSchema.nullable()`. If that has changed by build time, **stop and flag it**.

**`buildFastDay`: exact algorithm** (the input is already schema-valid; the caller parses first)
1. `D = businessDateOf(now_ms, tz)`. If `D !== localDateOf(now_ms, tz)` (00:00–00:59, before the business day
   starts at 01:00) → `{ ok: false, code: "fast_day_before_business_day" }`.
2. `fast_day = DevFastDaySchema.parse({ business_date: D, weekday: weekdayOf(D), open: input.open, close: input.close,
   timing: { selesai_after_mulai_ms: C*MIN, auto_stop_after_close_ms: A*MIN, debrief_duration_ms: D_min*MIN } })`.
3. `close_ms = fastDayCloseMs(fast_day, tz)`; `mulai_until_ms = close_ms - C*MIN`; `auto_stop_ms = close_ms + A*MIN`.
4. `warnings`: `now_ms > mulai_until_ms` → `"mulai_window_passed"`; else `mulai_until_ms - now_ms < MIN` →
   `"mulai_window_short"`. **Warnings never block** (a passed window is a legitimate test of the missed-day screen).
5. Return `{ ok: true, fast_day, preview: { mulai_until_ms, close_ms, auto_stop_ms }, warnings }`.

There is **no** v1-style "bump close by a minute": the tester typed the times; the warning tells them.

**`fastDayCloseMs(fast, tz)`:** `closeMsOf(fast.business_date, applyFastDay(EMPTY_WEEK, fast), tz)` (non-null by
construction; if it returns `null`, throw `new Error("fast day has no close")` — unreachable).
A close of `00:30` with open `23:58` is read by `closeMs` as the next day. No special case.

**`applyFastDay`:** `return { ...weekly, [fast.weekday]: { open: fast.open, close: fast.close } };`. Not run through
`WeeklyHoursSchema` (its 4 h refinements are what a fast day breaks). In memory only.

**`effectiveCaptureConfig`:** unchanged from v1: gate off or no `dev_fast_day` → `{ config: loaded, timing: PRODUCTION_TIMING }`;
else `{ config: { ...loaded, weekly_hours: applyFastDay(loaded.weekly_hours, loaded.dev_fast_day) }, timing: loaded.dev_fast_day.timing }`.

### 3.3 `lib/dev/fast-day-status.ts` (create; pure; `developer-junior`) — **new, feeds the indicator**

```ts
import type { DevFastDay } from "@/lib/dev/fast-day";

export type FastDayPhase = "before_mulai" | "mulai_missed" | "running" | "debrief" | "over";
export type FastDayRowId = "mulai_until" | "selesai_from" | "close" | "auto_stop" | "debrief_ends";
export interface FastDayRow { id: FastDayRowId; at_ms: number; remaining_ms: number }
export interface FastDayStatus { phase: FastDayPhase; open: string; close: string; rows: FastDayRow[] }

export function fastDayStatus(input: {
  fast: DevFastDay;
  tz: string;
  now_ms: number;
  /** The page's running session, or null. */
  session: { started_at_ms: number } | null;
  /** The page's lastEnded (config shape), or null. */
  last_ended: { business_date: string; debrief_ends_at_ms: number | null; end_reason: string | null } | null;
}): FastDayStatus;
```

Rules (`close = fastDayCloseMs(fast, tz)`, `C/A/D` from `fast.timing`, `row(id, at) = { id, at_ms: at, remaining_ms: Math.max(0, at - now_ms) }`):
1. `session !== null` → phase `running`. Rows, in this order: `selesai_from` (`started + C`) **only if** `now < started + C`;
   `close` only if `now < close`; `auto_stop` (`close + A`) always.
2. else, `last_ended` with `business_date === fast.business_date`, `end_reason !== "discarded"`,
   `debrief_ends_at_ms !== null` and `now < debrief_ends_at_ms` → phase `debrief`, rows: `debrief_ends`.
3. else, `last_ended` with `business_date === fast.business_date` (any end reason, debrief over or none) → phase `over`, no rows.
4. else `now <= close - C` → phase `before_mulai`, rows: `mulai_until` (`close − C`), `close`.
5. else → phase `mulai_missed`, no rows.

`open`/`close` are copied from `fast` for display. No `Date.now()` inside.

### 3.4 `lib/capture/contract.ts` (modify; `developer`) — unchanged from v1

- `CaptureConfigResponseSchema` gains `dev_fast_day: DevFastDaySchema.optional()`. `weekly_hours` stays the real, validated table.
- `toCaptureConfig(outlet, lastEnded, pairedDeviceCount, devFastDay: DevFastDay | null = null)`: `...(devFastDay ? { dev_fast_day: devFastDay } : {})` (key **absent** when null).
- Use `import type` for `CaptureConfigResponse` inside `fast-day.ts`. If lint or the build still reports a cycle, **stop and flag it**.

### 3.5 `lib/dev/fast-day-store.ts` (create; server memory; `developer`) — unchanged from v1

```ts
declare global { var __bee6DevFastDays: Map<string, DevFastDay> | undefined; }
export function getDevFastDay(outletId: string): DevFastDay | null;   // null when the gate is off, even if stored
export function setDevFastDay(outletId: string, fast: DevFastDay): boolean; // false, no-op, when the gate is off
export function clearDevFastDay(outletId: string): boolean;
```
`globalThis` map, keyed by `outlet_id`, survives HMR, **gone on `npm run dev` restart by design**.

### 3.6 Server wiring for the fast day (`developer`)

**`lib/capture/session-service.ts`** (unchanged from v1): `CalendarCtx` gains `timing?: DayTiming`; `timingOf(cal)`;
`autoStopFor`, `newSession`, `outsideWindowOrAfterEnd` and `endSession` (`debriefStart + timingOf(cal).debrief_duration_ms`) use it.

**`lib/capture/session-api.ts` `calendarFor`** (unchanged from v1):
```ts
const fast = getDevFastDay(outletId); // always null outside `next dev` + flag
return fast
  ? { weekly: applyFastDay(weekly, fast), tz: outlet.timezone, timing: fast.timing }
  : { weekly, tz: outlet.timezone };
```

**`app/api/v1/capture/config/route.ts`:** pass `getDevFastDay(device.outlet_id)` through `getCaptureConfig(store, params, devFastDay)` (3rd param, default `null`) into `toCaptureConfig`.

**`lib/debrief/service.ts`: do NOT change** (step 11 stays at 60 min; that is why D ≤ 60).

**`lib/dev/fast-day-service.ts` (create):**
```ts
export interface FastDayServiceDeps {
  outlets: OutletReader;
  devices: DeviceReader;
  /** firestoreTickStore().expireOpenQuestions — the same function the tick uses. */
  expireOpenQuestions(outletId: string, deviceId: string, debriefEndsAtMs: number, nowMs: number): Promise<number>;
  clearLastEnded(outletId: string, deviceId: string): Promise<void>;
  store: { set: typeof setDevFastDay; clear: typeof clearDevFastDay };
}
export async function startFastDay(deps, claims: CustomClaims, rawBody: unknown, now_ms: number):
  Promise<{ dev_fast_day: DevFastDay; warnings: FastDayWarning[] }>;
export async function stopFastDay(deps, claims: CustomClaims): Promise<{ cleared: true }>;
```
`startFastDay` order. **Validate everything before mutating anything:**
1. `devicePrincipal(claims)` → 403 for a non-device principal.
2. `const input = FastDayInputSchema.parse(rawBody)` → 422 via `handleApiError`.
3. Load the outlet. Missing → 404. `project_kind !== "demo"` → `throw new AppError("Dev tools run on demo outlets only", "dev_demo_only", 403)`.
4. `const built = buildFastDay(input, now_ms, outlet.timezone)`; `!built.ok` → `throw new AppError(built.code, built.code, 422)`.
5. If `input.reset_last_ended`: `const last = (await deps.devices.getDevice(...))?.last_ended ?? null`. If
   `last?.debrief_ends_at_ms != null && now_ms < last.debrief_ends_at_ms` → `throw new AppError("A debrief is open", "debrief_open", 409)`.
6. Mutate, in this order:
   a. **(new, E19)** if `reset_last_ended` and `last` has `debrief_ends_at_ms != null`, `end_reason !== "discarded"` and
      `debrief_ends_at_ms <= now_ms` → `await deps.expireOpenQuestions(outlet_id, device_id, last.debrief_ends_at_ms, now_ms)`.
      This is the tick's own condition (`service.ts` ~L528) copied verbatim. Reason: once `last_ended` is cleared,
      the tick can no longer expire the previous loop's unanswered questions, and they would leak into the next
      loop's debrief (`listOpenQuestions` is not date-filtered).
   b. if `reset_last_ended` → `await deps.clearLastEnded(outlet_id, device_id)`.
   c. `deps.store.set(outlet_id, built.fast_day)`.
7. Return `{ dev_fast_day: built.fast_day, warnings: built.warnings }`.

`stopFastDay`: steps 1 and 3, then `store.clear(outlet_id)`.

**`lib/dev/dev-firestore.ts` (create)** — unchanged from v1: `clearLastEnded` = one `WriteBatch` with
`last_ended: FieldValue.delete()` on `devices/{deviceDocId(outletId, deviceId)}` and an `AuditLogSchema`-parsed
`{ actor_role: "device", action: "dev.reset_last_ended", target_type: "device", target_id: deviceId }` create.

**`app/api/dev/fast-day/route.dev.ts` (create):** `POST` (gate → `requireDevice` → `readJsonBody` → `startFastDay(realDeps(), claims, body, Date.now())` → `jsonOk`) and `DELETE` (gate → `requireDevice` → `stopFastDay`). `runtime = "nodejs"`, `dynamic = "force-dynamic"`. `realDeps()` wires `firestoreCaptureStore()`, `firestoreTickStore().expireOpenQuestions` (bound as a plain arrow: `(o, d, e, n) => tick.expireOpenQuestions(o, d, e, n)`), `clearLastEnded` and the store functions.

### 3.7 Phone wiring (`app/capture/*`; `developer`)

Pure view functions (unchanged from v1): `timing?: DayTiming` on the inputs of `idle-view.ts` (L52, L82, L99),
`selesai-view.ts` (L32), `off-hours-banner.ts` (L43, L47, L72).

**`app/capture/page.tsx`:**
1. `const devToolsEnabled = isDevToolsEnabled();`
2. `const [timing, setTiming] = useState<DayTiming>(PRODUCTION_TIMING);` `const [configVersion, setConfigVersion] = useState(0);`
3. Config load effect: `const eff = effectiveCaptureConfig(loaded, devToolsEnabled); setConfig(eff.config); setTiming(eff.timing); setLastEnded(loaded.last_ended);` Dependencies `[router, configVersion]`.
4. Pass `timing` to `idleViewFor`, `nextMulaiText`'s `mulaiAvailability`, the auto-stop effect's `autoStopAtMs` (add `timing` to its deps), `handleMulaiTap`'s `mulaiWindowDateOf`, `selesaiViewFor`.
5. Replace `endedAt + DEBRIEF_DURATION_MS` (L310, L450) and `now + 60 * 60_000` (L622) with `timing.debrief_duration_ms`.
6. **Timestamps sent to the server stay `Date.now()`** (L297, L384, L434, L460, L471, L476 unchanged).
7. Fast-day handlers `handleFastDayStart(input)` / `handleFastDayClear()` as in v1; on success `setConfigVersion((v) => v + 1)` and store `warnings` for the DevPanel.
8. **Indicator (new):** render `<FastDayIndicator …/>` (§3.10) **only when** `devToolsEnabled && config?.dev_fast_day && config.timezone`, at the position uiux fixes in §3.10 (default: directly after `<ShopTopBar />`, before the `<h1>`), with props `{ fast: config.dev_fast_day, tz: config.timezone, session: session ? { started_at_ms: session.started_at_ms } : null, last_ended: lastEnded }`.
9. DevPanel props: `fastDay={devToolsEnabled ? {...} : undefined}` (v1 shape plus `warnings`, `tz`) and `tick={devToolsEnabled ? {...} : undefined}` (§3.11).

**`lib/dev/fast-day-client.ts` (create):** `postDevFastDay(auth, input)` → `{ ok: true; warnings } | { ok: false; status; code }`,
`deleteDevFastDay(auth)`, and `postDevTick(auth)` (§3.11). A network error → `{ ok: false, status: 0, code: "network" }`.

### 3.8 `app/capture/DevPanel.tsx` fast-day section (modify; `developer-junior`)

```ts
export interface DevFastDayControls {
  active: DevFastDay | null;
  tz: string | null;
  busy: boolean;
  error: string | null;
  warnings: FastDayWarning[];   // from the last successful Start
  canStart: boolean;
  onStart: (input: FastDayInput) => void;
  onClear: () => void;
}
```
`<div data-testid="dev-fast-day">`, `READOUTS_STYLE` dashed border, between the Start/Pause/Stop row and the event log:
1. Heading `Fast day (local dev, demo outlet only)`.
2. **Two `<input type="time" step={60}>`** labelled `Open` and `Close`. **Prefill** when `tz` first becomes non-null:
   `open = localHmOf(Date.now(), tz)`, `close = localHmOf(Date.now() + 3 * 60_000, tz)`. A `Fill from now` button
   re-applies the same prefill. Inputs disabled while `tz === null`.
3. Three `<input type="number">`: `Selesai after Mulai (min)` default 1, `Auto-stop after close (min)` default 1,
   `Debrief (min)` default **5**. Checkbox `Reset this device's day` default checked.
4. On every change: `FastDayInputSchema.safeParse(values)`. Fails → first issue's message in `#b00020`, Start disabled.
   Passes and `tz` known → `buildFastDay(parsed, Date.now(), tz)` preview line
   `data-testid="dev-fast-day-preview"`: `Mulai until {HH:MM} · close {HH:MM} · auto-stop {HH:MM} · debrief {D} min`
   (times via `localHmOf`), plus any warning line (copy from §3.10). `fast_day_before_business_day` → shown as an error, Start disabled.
5. Buttons `Start fast day` (disabled when `!canStart || busy || invalid`) and `Clear fast day` (disabled when `active === null || busy`).
   `!canStart` → hint `Finish the session/debrief first.`
6. `error` → `Fast day failed: {error}` in `#b00020`.

English only, monospace, wraps at 360 px (DEV-01 convention; uiux may adjust wording in Task U, not the controls).

### 3.9 `next.config.ts` (modify; Task 0; `developer`) — unchanged from v1

```ts
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
const BASE_EXTENSIONS = ["tsx", "ts", "jsx", "js"];
export default function config(phase: string): NextConfig {
  return {
    output: "standalone",
    // DEV-03: `*.dev.ts(x)` route files exist only under `next dev`.
    pageExtensions: phase === PHASE_DEVELOPMENT_SERVER ? ["dev.tsx", "dev.ts", ...BASE_EXTENSIONS] : BASE_EXTENSIONS,
  };
}
```

### 3.10 Fast-day indicator: behaviour (fixed here) and presentation (**uiux decides, Task U**)

Rangga (answer 2): "show it in the UI so the user knows it. Consult with the UIUX for the user friendly
information style." **Mechanism:** tech-lead fixes *what* the indicator must convey and its hard constraints
(below). The *presentation* (wording, format of times and countdowns, placement within the constraints,
colour, a11y announcement style) is decided by **uiux in Task U, before Task 5b is built**. The PM dispatches
`uiux` (unnamed, one-shot, skills `impeccable` + `ux-copy` + `frontend-a11y`) with §3.10 and §3.11 as the brief.
uiux's answer is pasted by the PM into **§3.10.3 below**, replacing the strawman, and marked
"Decided by UI/UX {date}". **Task 5b must not start while §3.10.3 still says STRAWMAN.** Tasks 0–5 do not
depend on it and proceed in parallel.

#### 3.10.1 Behaviour (fixed; uiux may not change these)
- **B1 When:** rendered if and only if `isDevToolsEnabled()` and the effective config carries `dev_fast_day`.
  Never in a production build, never on a pilot outlet (the server never sends it there), never when the gate is off.
- **B2 Where:** visible **without scrolling** on a 360 × 640 viewport in **every** `/capture` state (loading excluded):
  idle, running, Selesai confirm open, Batalkan open, debrief closed/open/question/done/timed-out. Not collapsible,
  not dismissible while the fast day is active. Must not sit inside the DevPanel (the panel grows and scrolls).
- **B3 What:** from `fastDayStatus()` (§3.3): that a fast day is active; the typed hours `open–close`; the phase;
  and every row with its **absolute local time and a live countdown**. Phase `over` must tell the tester the
  loop is finished and how to start another (Clear, or Start a new fast day). Phase `mulai_missed` must say
  Mulai's window has passed for these hours.
- **B4 Precision:** countdowns update every **1 s**, via an interval **inside the indicator component only**
  (`setInterval(() => setNow(Date.now()), 1_000)`, cleared on unmount). The page's 30 s tick is not changed.
  A row whose `remaining_ms` is 0 stays visible (shows 0 / "now") until the phase changes.
- **B5 Not confusable with production:** it must not reuse `StatusBanner`'s colours or its headline slot, and it
  must read as a developer tool (DEV-01 uses `#7a4fff`, dashed, monospace).
- **B6 a11y:** must **not** announce every second. No `role="alert"`. The countdown text has `aria-live="off"`;
  a phase change may be announced once (uiux decides: polite live region on the phase line, or none).
- **B7 Language:** dev-only text follows DEV-01: **English only, not added to the UX-03 key sheet**, unless uiux
  decides otherwise with a reason (then it lists the keys in both columns, ≤ 59 chars each).
- **B8 Width:** wraps at 360 px with no horizontal scroll; no line truncated.
- **B9 No people data:** shows no device id, no name (it has none to show).

#### 3.10.2 What uiux also reviews (copy only, controls fixed)
- The DevPanel fast-day section labels, the two warning lines (`mulai_window_passed`, `mulai_window_short`),
  and the tick-now readout lines (§3.11.4).

#### 3.10.3 Presentation — **Decided by UI/UX, 9 Oct 2026**

#### Placement and structure
Directly after `<ShopTopBar />`, before the `<h1>` (the default position — kept, because it is the
only spot on the page every `/capture` state renders before any state-specific content, which is what
makes "visible without scrolling in every state" (B2) true for free: nothing above it can push it
below the fold, because nothing else renders above it). `data-testid="dev-fast-day-indicator"`.
`role="group"` `aria-label="Developer fast-day status"` on the outer element (a stable accessible name
for anyone who tabs to or inspects it — it is not itself a live region).

Internal structure, top to bottom:
1. A 4 px "hazard bar" (decorative, `aria-hidden="true"`) — see Visual style.
2. The header line (hours).
3. The phase line.
4. Zero or more row lines (`fastDayStatus().rows`, in the order the function returns them).
5. A visually-hidden `aria-live="polite"` span that is empty on mount and is set to one short sentence
   only when the phase changes after mount (see A11y). It renders no visible text.

#### Visual style — unmistakable from `StatusBanner`
`StatusBanner` (§5.2–5.3) uses Atkinson Hyperlegible, a 26/32 bold headline, and only the five production
tones (`--ok` / `--warn` / `--danger` / `--muted` / `--accent`) on `--bg`/`--surface`. The indicator shares
**none** of that:

- `fontFamily: ui-monospace, "SF Mono", "Cascadia Code", monospace` (monospace is on the product's own
  forbidden-tells list for production copy, §2 — using it here is precisely the signal "this is not a
  production screen").
- A hue the production token table never uses: `#7a4fff` (border) on a tinted background
  `#f4f0ff` light / `#241c3d` dark, text `#2a1f52` light / `#e4dcff` dark — a dark-on-very-light /
  light-on-very-dark pairing designed to clear the same ≥ 4.5:1 the rest of the app holds itself to (not
  independently measured here; flag in Task 6 if it looks too low in either theme).
- `border: 2px dashed #7a4fff`, `borderRadius: 0` (sharp corners; `--surface` panels elsewhere are never
  square-cornered in the shipped screens, so this alone is a second tell).
- The hazard bar: a 4 px strip, `background: repeating-linear-gradient(45deg, #7a4fff 0 8px, #19121f 8px
  16px)`, `marginBottom: 6px`. A diagonal stripe reads as "under construction" / "do not ship this" even
  in a blurry screenshot or a demo-recording frame grab, which is the literal safety goal (brief,
  "visually distinct enough... nobody could mistake a screenshot"). Purple + near-black, not the
  production `--warn` amber, so it is never read as a real warning state.
- `fontSize: 13`, `lineHeight: 1.5`, `padding: 8px 10px`, `margin: 8px 0`, `whiteSpace: pre-wrap`,
  `overflowWrap: anywhere`, no fixed width (wraps at 360 px with no horizontal scroll — B8; checked by
  jsdom style assertions in I4, confirmed on a real 360 px viewport in Task 6 step 9).
- Digits in times and countdowns use `font-variant-numeric: tabular-nums` so a row's width does not jiggle
  every second — a small thing, but it is exactly the kind of jiggle that reads as "flaky" under time
  pressure and this tool exists to be trusted at a glance.

#### Countdown precision and a11y (B4, B6)
- One `setInterval(() => setNow(Date.now()), 1_000)` inside `FastDayIndicator` only, cleared on unmount
  (I2). It drives `remaining_ms` for the already-open rows; it never recomputes `fastDayStatus()` on its
  own faster than once a second, and never touches the page's 30 s poll.
- The row list element carries `aria-live="off"` explicitly (defense in depth: nothing above it is a live
  region either, but the literal attribute makes the intent inspectable). **No `role="alert"` anywhere in
  this component.**
- A separate, visually-hidden (`position:absolute; width:1px; height:1px; overflow:hidden;
  clip-path:inset(50%); white-space:nowrap`) `<span role="status" aria-live="polite">` announces **once**,
  only on a phase change *after* mount (a `useRef` holds the previous phase, seeded with the phase the
  component is born with, so the first paint announces nothing — the same "no forced read on load" the
  production headline already follows). Content: `Dev fast day phase: {phase label}.` e.g. `Dev fast day
  phase: Running.` The visible phase line and row text are never themselves inside a live region, so a
  count ticking down is never read, exactly as the retry-count precedent in §5.7 already established for
  this codebase (do not read a number that only changes for cosmetic reasons).
- Why one announcement per phase change and not zero: a tester driving the fast day by voice-over while
  also trying to read the mic/debrief screens benefits from knowing "it's debrief now" without having to
  glance back at this box; it costs one utterance per real transition (at most 4 per loop: before_mulai →
  running → debrief → over, plus the rare → mulai_missed branch), never per second.

#### Copy — EN primary, ID second column (brief requirement). **Shipped behaviour: the indicator always
renders in English, regardless of the shop-phone language toggle** (see rationale below); the ID column
is written to the same shape so wiring it in later is a one-line change, and so Rangga can sign off on it
now rather than later. Every line ≤ 59 characters in both columns (checked above).

Row labels:

| Row id | EN label | ID label (not wired in v1) |
|---|---|---|
| `mulai_until` | `Start by` | `Mulai paling lambat` |
| `selesai_from` | `End from` | `Selesai mulai` |
| `close` | `Close` | `Tutup` |
| `auto_stop` | `Auto-stop` | `Auto-stop` |
| `debrief_ends` | `Debrief ends` | `Debrief sampai` |

Row template: `{label} {HH:MM} · in {m:ss}` (EN) / `{label} {HH:MM} · dalam {m:ss}` (ID). `{HH:MM}` is
`localHmOf(row.at_ms, tz)`. `{m:ss}` is `formatCountdown(row.remaining_ms)`: `remaining_ms <= 0` → the
word `now` (EN) / `sekarang` (ID), dropping `in`/`dalam`; else minutes (no leading zero, may exceed 59) `:`
seconds (zero-padded). A row at 0 keeps rendering (`now`) until the phase itself changes (B4) — unchanged
from `fastDayStatus()`'s own row list, nothing extra to build here.

Phase labels (`Phase: {label}` EN / `Fase: {label}` ID):

| Phase | EN | ID (not wired in v1) |
|---|---|---|
| `before_mulai` | `Before start` | `Sebelum mulai` |
| `mulai_missed` | `Start missed` | `Mulai terlewat` |
| `running` | `Running` | `Berjalan` |
| `debrief` | `Debrief` | `Debrief` |
| `over` | `Loop finished` | `Putaran selesai` |

Full block per phase (header line is always `DEV FAST DAY · {open}–{close}` EN / `HARI CEPAT DEV ·
{open}–{close}` ID; `{open}`/`{close}` are the typed `HH:MM` strings straight from `fast`):

```
# before_mulai (rows: mulai_until, close)
DEV FAST DAY · 14:00–14:03
Phase: Before start
Start by 14:02 · in 1:38
Close 14:03 · in 2:38
```
```
# running (rows: selesai_from?, close?, auto_stop)
DEV FAST DAY · 14:00–14:03
Phase: Running
End from 14:01 · in 0:28
Close 14:03 · in 2:28
Auto-stop 14:04 · in 3:28
```
```
# debrief (row: debrief_ends)
DEV FAST DAY · 14:00–14:03
Phase: Debrief
Debrief ends 14:09 · in 4:12
```
```
# mulai_missed (no rows; must state the window has passed, B3)
DEV FAST DAY · 09:00–09:03
Phase: Start missed
The Start window has passed for these hours.
Start a new fast day to try again.
```
```
# over (no rows; must say the loop is finished and how to start another, B3)
DEV FAST DAY · 14:00–14:03
Phase: Loop finished
This loop is done. Clear it, or start
a new fast day to run another loop.
```

ID equivalents (reference, not wired in v1 — see rationale):

```
# before_mulai
HARI CEPAT DEV · 14:00–14:03
Fase: Sebelum mulai
Mulai paling lambat 14:02 · dalam 1:38
Tutup 14:03 · dalam 2:38
```
```
# running
HARI CEPAT DEV · 14:00–14:03
Fase: Berjalan
Selesai mulai 14:01 · dalam 0:28
Tutup 14:03 · dalam 2:28
Auto-stop 14:04 · dalam 3:28
```
```
# debrief
HARI CEPAT DEV · 14:00–14:03
Fase: Debrief
Debrief sampai 14:09 · dalam 4:12
```
```
# mulai_missed
HARI CEPAT DEV · 09:00–09:03
Fase: Mulai terlewat
Jendela mulai sudah lewat untuk jam ini.
Mulai hari cepat baru untuk coba lagi.
```
```
# over
HARI CEPAT DEV · 14:00–14:03
Fase: Putaran selesai
Putaran ini selesai. Hapus, atau mulai
hari cepat baru untuk putaran lain.
```

**Why English-only is the shipped v1 behaviour, not a silent gap:** the indicator's only readers are the
GATI team testing locally under `next dev`; it is never shown to staff, the pilot shop, or judges (B1).
DEV-01/§3.8 already settled DevPanel as English-only for the same tool family, and following the
shop-phone language toggle here would cost real wiring (passing `lang` through `page.tsx`, calling `t()`,
adding these keys to `lib/i18n/dict.ts` even though §3.10.1 B7 says dev-only text is *not* added to the
UX-03 key sheet by default) for a tool whose whole job is to never be confused with production. A second
reason to keep it fixed: if the indicator *did* follow the toggle and happened to render in Bahasa while
a tester had switched the shop phone to Bahasa for testing, it would look **more** like it belongs to the
product, not less — the fixed-English, fixed-monospace, fixed-purple presentation is itself part of how
this stays unmistakable (B5). This is my use of the B7 escape clause in reverse: I am deciding **not** to
exercise it for v1, while still handing over the ID column so the call can be revisited without redoing
the translation work.

#### DevPanel warning lines (§3.10.2, English only per §3.8 — DevPanel's existing convention, unchanged
here; ID given as reference only, same reasoning as above)

| Warning | EN (shipped) | ID (reference) |
|---|---|---|
| `mulai_window_passed` | `Start window already passed for these hours.` / `Tapping Start will show the missed-start screen.` (two lines) | `Jendela mulai sudah lewat untuk jam ini.` / `Menekan Mulai akan menampilkan layar terlewat.` |
| `mulai_window_short` | `Less than 1 minute left before Start closes.` | `Kurang dari 1 menit sebelum jendela mulai tutup.` |

### 3.10.4 "Run pipeline tick now" result-line wording (§3.11.4) — **Decided by UI/UX, 9 Oct 2026**

English only (DevPanel convention, same as 3.10.3's DevPanel section); ID given as reference only. Every
server-origin code is mapped to a fixed phrase — never interpolated raw — matching `lib/i18n/dict.ts`'s own
rule ("no string from the server is rendered directly").

| Outcome | EN (shipped) | ID (reference) |
|---|---|---|
| Hint, always shown | `Uses Gemini on the demo project. A window closes 90 s after the last speech.` | `Memakai Gemini di proyek demo. Window tutup 90 detik setelah ucapan terakhir.` |
| `device === null` | `This device is not in the tick list (revoked or unpaired).` | `Perangkat ini tidak ada di daftar tick (dicabut atau belum dipasangkan).` |
| `skipped_reason === "lease_held"` | `Another tick is already running. Try again in a moment.` | `Tick lain sedang berjalan. Coba lagi sebentar.` |
| `"no_segments"` (base) | `No speech uploaded yet for this device.` | `Belum ada ucapan yang terunggah untuk perangkat ini.` |
| `"no_segments"`, `questions_expired > 1` | append `{N} questions expired.` | append `{N} pertanyaan kedaluwarsa.` |
| `"no_segments"`, `questions_expired === 1` | append `1 question expired.` | append `1 pertanyaan kedaluwarsa.` |
| `"error"` | `Tick failed on this device. Check the dev server log.` | `Tick gagal untuk perangkat ini. Cek log server dev.` |
| success, main line | `{units} units · {threads} threads · {questions} questions · {expired} expired · {failed} failed` | `{units} unit · {threads} thread · {questions} pertanyaan · {expired} kedaluwarsa · {failed} gagal` |
| success, `units_processed === 0` (append) | `Nothing ready yet. Wait for 90 s of silence, then tap again.` | `Belum ada yang siap. Tunggu 90 detik sunyi, lalu ketuk lagi.` |
| success, `questions_written > 0` (append) | `Reopen the debrief card to load them.` | `Buka lagi kartu debrief untuk memuatnya.` |
| top-level error, `code === "dev_demo_only"` | `Tick failed: this outlet is not a demo outlet.` | `Tick gagal: outlet ini bukan outlet demo.` |
| top-level error, `code === "http_500"` | `Tick failed: the server had an error. Check the dev server log.` | `Tick gagal: server mengalami error. Cek log server dev.` |
| top-level error, `code === "network"` | `Tick failed: no connection. Check your network, then try again.` | `Tick gagal: tidak ada koneksi. Cek jaringan, lalu coba lagi.` |

Colour: the `error` line (both the per-device `"error"` row and the top-level `Tick failed: …` line) stays
`#b00020` as §3.11.4 already specified; nothing else in this table carries an error colour (`device===null`,
`lease_held` and `no_segments` are normal statuses, not failures, and reading them in red would train
testers to panic at a routine "nothing happened yet" result).

### 3.11 "Run pipeline tick now" (PR A, DEV-03a; `developer`)

Rangga (answers 2 and 4): a real tick, real Gemini cost on the demo project, **usable at any moment as a
manual override**, independent of any fast day or debrief-duration default.

#### 3.11.1 `lib/dev/scoped-tick-store.ts` (create)
```ts
import type { TickStore } from "@/lib/pipeline/tick/types";
/** The same store, but the tick sees only this one device. Every other method is the original function. */
export function scopeTickStore(store: TickStore, outletId: string, deviceId: string): TickStore {
  return {
    ...store,
    async listActiveDevices() {
      return (await store.listActiveDevices()).filter((d) => d.outlet_id === outletId && d.device_id === deviceId);
    },
  };
}
```
The spread is safe: tech-lead checked `origin/main` `lib/firestore/tick-store.ts`, `firestoreTickStore()` (L133)
returns an object literal and the file has no `this.` reference. If that has changed by build time, **stop and flag it**.
**`lib/pipeline/**` is not modified.** Tick-now calls the unchanged `runTick`.

#### 3.11.2 `lib/dev/dev-tick-service.ts` (create)
```ts
export interface DevTickDeps { outlets: OutletReader; tickStore: TickStore; runTick: typeof runTick }
export async function runDevTick(deps: DevTickDeps, claims: CustomClaims, now_ms: number):
  Promise<{ device: DeviceTickResult | null }>;
```
1. `devicePrincipal(claims)` → 403. 2. Load outlet; missing → 404; `project_kind !== "demo"` → 403 `dev_demo_only`.
3. `const r = await deps.runTick({ store: scopeTickStore(deps.tickStore, outlet_id, device_id), now_ms })`.
4. Return `{ device: r.devices[0] ?? null }` (`null` = this device is not in the active list, e.g. revoked).

No logging beyond what `runTick` already logs (skew numbers and error classes; never text).

#### 3.11.3 `app/api/dev/tick/route.dev.ts` (create)
`POST`: `if (!isDevToolsEnabled()) return new Response(null, { status: 404 });` → `requireDevice(req)` →
`jsonOk(await runDevTick({ outlets: firestoreCaptureStore(), tickStore: firestoreTickStore(), runTick }, claims, Date.now()))`,
errors through `handleApiError`. `runtime = "nodejs"`, `dynamic = "force-dynamic"`. No body.

#### 3.11.4 DevPanel tick row (`developer-junior`)
```ts
export interface DevTickControls {
  busy: boolean;
  result: { device: DeviceTickResult | null } | null;  // last successful call
  error: string | null;
  onRun: () => void;
}
```
`<div data-testid="dev-tick">` **above** the fast-day section (it is useful with real hours too):
- Button `Run pipeline tick now`. **Disabled only while `busy`.** Never disabled by session, debrief, fast day
  or any timer (Rangga: "skip the wait at any time").
- One hint line, always shown: `Uses Gemini on the demo project. A window closes 90 s after the last speech.`
- Readout `data-testid="dev-tick-readout"` after a call (copy reviewed by uiux, §3.10.2):
  - `device === null` → `This device is not in the tick list (revoked or unpaired).`
  - `skipped_reason === "lease_held"` → `Another tick is running (deployed scheduler?). Try again in a minute.`
  - `"no_segments"` → `No speech uploaded yet for this device.` (plus `{questions_expired} expired` if > 0)
  - `"error"` → `Tick failed on this device. Check the dev server log.`
  - `null` → `{units_processed} units · {threads_written} threads · {questions_written} questions · {questions_expired} expired · {failed_units} failed`.
    If `units_processed === 0`: add `Nothing ready yet: wait for 90 s of silence, then tap again.`
    If `questions_written > 0`: add `Reopen the debrief card to load them.`
- `error` → `Tick failed: {error}` in `#b00020` (`dev_demo_only`, `http_500`, `network`).

**Page wiring:** `handleDevTick()` → `setTickBusy(true)`; `postDevTick(auth)`; set `tickResult` or `tickError`; `setTickBusy(false)`.
It does **not** reload the config or remount `DebriefFlow` (remounting would throw away an in-progress answer).

### 3.12 Files not to touch

`lib/debrief/**`, `app/capture/debrief/**`, `lib/pipeline/**` (tick-now only *calls* `runTick`), `lib/http/guard.ts`,
`lib/auth/**`, `app/pair/page.tsx`, the capture engine, `lib/firestore/schema.ts`, `lib/firestore/tick-store.ts`.
If the build seems to need one of these changed, the plan is wrong: stop and flag it.

---

## 4. Edge cases (required behaviour)

| # | Case | Required behaviour |
|---|---|---|
| E1 | Any deployed build, even with `NEXT_PUBLIC_DEV_CONTROLS=true` | `/api/dev/*` does not exist (layer 1) or 404s (layer 2). No fast day, no indicator, no tick button. |
| E2 | `next dev` without the flag | Same as E1. |
| E3 | Caller's outlet is `pilot` | Fast day and tick: 403 `dev_demo_only`. Nothing stored, nothing written, **no Gemini call**. |
| E4 | Invalid knobs (open 00:30, open = close, close after 01:00 next day, gap < C + 1, D > 60, A = 0, extra key, float) | 422. DevPanel already shows the message and disables Start. |
| E5 | 00:00–00:59 local | 422 `fast_day_before_business_day`. |
| E6 | Open `23:58`, close `00:01` | Valid (close next day, ≤ 01:00). Auto-stop `00:02` with A = 1. Session dated D. |
| E7 | Close already passed (e.g. 09:00–09:03 typed at 14:00) | Accepted with warning `mulai_window_passed`. Mulai shows the missed screen; indicator phase `mulai_missed`. Legit test of that copy. |
| E8 | Fewer than 60 s left before `close − C` | Accepted with warning `mulai_window_short`. |
| E9 | Open in the future (14:10–14:13 typed at 14:00) | Accepted. **Mulai is offered now** (window starts 01:00, production rule). Indicator shows the typed hours. |
| E10 | Device already ended today, `reset_last_ended = false` | Fast day stored; Mulai shows `day_ended`; indicator phase `over`. Tick the reset box. |
| E11 | Reset while this device's debrief is open | 409 `debrief_open`. Nothing written (validate before mutate). Button already disabled. |
| E12 | Start or Clear while a session runs | Disabled on the phone. A forced curl moves the session's close; accepted, dev-only. |
| E13 | `npm run dev` restarts with `/capture` open | Server forgets the fast day; phone keeps it until reload. **Reload `/capture` after any dev-server restart**; the indicator then disappears (that is the visible proof). |
| E14 | Two fast days in a row | The second replaces the first. |
| E15 | Repeat loops on one day | Each Start with reset: expire the previous loop's open questions (E19), clear `last_ended`, one `dev.reset_last_ended` audit. |
| E16 | Answers from an earlier loop uploaded after a later loop ended | `findEndedDebrief` falls back to the latest debrief end for the date; the 60 min lower bound covers them. |
| E17 | Fast weekday is a closed day in the real hours | The override opens it for that weekday only. |
| E18 | Two dev devices on one demo outlet | Share one fast day; each device's reset and tick are its own. |
| **E19** | Reset after a finished debrief that no tick has expired yet | `startFastDay` calls `expireOpenQuestions` with the tick's exact condition **before** clearing `last_ended`, so old questions do not appear in the next debrief. |
| **E20** | Tick-now while a session is running | Allowed. Labels whatever windows are already closed (what the scheduler does every 2 min). |
| **E21** | Tick-now tapped twice fast, or while the deployed scheduler ticks the same device | The device lease makes the second one `lease_held`; readout says so. No double labelling. |
| **E22** | Tick-now during an open debrief | Questions are written; the open `DebriefFlow` is **not** remounted. Readout says "Reopen the debrief card". An `empty` screen → Back → reopen → `GET /api/v1/questions` refetches (`flow.ts` OPEN). |
| **E23** | Tick-now after the debrief ended | Expires that debrief's open questions to `unverified` (real R-07 path). |
| **E24** | Tick-now with no fast day (real hours) | Works the same. The button does not depend on a fast day. |
| **E25** | Local server runs a different code version than the deployed demo service, both ticking | Both write the same collections; the lease serialises them. If the schemas differ (unmerged pipeline change), the tick-now results may differ from the scheduler's. Accepted, dev-only; prefer a demo project whose scheduler job is paused while testing locally (dev-ops, open question 3). |
| **E26** | Gemini or SDP call fails during tick-now | `runTick` already handles it per unit (`failed_units`, `unlabelled_unit` question, ledger `failed`). Readout shows `failed`. |
| **E27** | Indicator while the gate is off but the server sent `dev_fast_day` (mis-set build) | Not rendered (B1). |

---

## 5. Tasks (TDD: write each failing test first)

### Routing and order
- **`developer` (sonnet):** Task 0, Task 1, Task 3, Task 3b, Task 4. Shared pure rules, server wiring, page effects.
- **`developer-junior` (haiku):** Task 2, Task 5, Task 5b. Fully specified algorithms and mechanical UI.
- **`uiux`:** Task U (parallel with Tasks 0–4).
- **PR A (DEV-03a, tick-now):** Task 0 → Task 3b → Task 5 (tick row only) → Task 6 steps 1–2.
- **PR B (DEV-03, fast day):** Task 1 ∥ Task 2 → Task 3 → Task 4 ∥ Task 5 (fast-day section) → Task 5b (after Task U) → Task 6 steps 3–9.

### Task 0: `pageExtensions` spike and the gate (0.5 h) — PR A
Files: `next.config.ts`, `lib/capture/dev-mode.ts` (+test), throwaway `app/api/dev/ping/route.dev.ts` (deleted before commit).
- T0.1–T0.5 `isDevToolsEnabled`: true only for flag `"true"` + `NODE_ENV="development"`; false for flag unset/`"TRUE"`/`"1"` and for `NODE_ENV` `"production"`/`"test"`/unset (`vi.stubEnv`, `vi.unstubAllEnvs()` in `afterEach`).
- Spike (recorded in Result): `npm run dev` → `curl localhost:3000/api/dev/ping` works; `npm run build` → no `.next/server/app/api/dev`, no `/api/dev/ping` in `.next/app-path-routes-manifest.json`, every existing route still built. **If it fails: stop, report, continue on layers 2–3 only once the PM confirms.**
- Commit: `chore(dev-03): add dev-tools gate and dev-only page extensions`.

### Task 3b: tick-now route (0.75 h) — PR A
Files: `lib/dev/scoped-tick-store.ts` (+test), `lib/dev/dev-tick-service.ts` (+test), `app/api/dev/tick/route.dev.ts` + `route.test.ts` (imports `./route.dev`), `lib/dev/fast-day-client.ts` (`postDevTick` only in PR A, +test).
- K1 `scopeTickStore`: `listActiveDevices` returns only the matching `{outlet_id, device_id}`; other outlet / other device filtered out; every other method `toBe` the original function.
- K2 `runDevTick`: non-device claims → 403; pilot outlet → 403 `dev_demo_only` **and the `runTick` mock is never called**; missing outlet → 404.
- K3 demo outlet → `runTick` called once with `now_ms` passed through and a store whose `listActiveDevices` is scoped; returns `{ device: devices[0] }`; `devices: []` → `{ device: null }`.
- K4 route: gate off → 404 and `requireDevice` not called; gate on + 401 → 401; gate on + valid → 200 `{ data: { device } }`.
- K5 `postDevTick`: 200 → `{ ok: true, result }`; 403 with envelope → `{ ok: false, status: 403, code: "dev_demo_only" }`; fetch throws → `code: "network"`.
- Commit: `feat(dev-03a): add the dev-only run-tick-now route`.

### Task 1: calendar timing (1 h) — PR B
Unchanged from v1 (C1–C6): `PRODUCTION_TIMING` values and frozen; **every existing calendar test passes unmodified**; window end, Selesai at C = 0, auto-stop with A, `mulaiAvailability` with timing.
- Commit: `feat(dev-03): let calendar rules take a day timing (production default)`.

### Task 2: `lib/dev/fast-day.ts` + `fast-day-status.ts` (1.5 h) — PR B
Files: `lib/dev/fast-day.ts`, `lib/dev/fast-day-status.ts`, and their `.test.ts`. Times in `Asia/Jakarta` (UTC+7).
- F1 Thu `2026-10-08T07:00:20Z` (14:00:20), open `14:00` close `14:03`, C1 A1 D5 → `fast_day` `{ business_date: "2026-10-08", weekday: "thu", open: "14:00", close: "14:03", timing: { 60_000, 60_000, 300_000 } }`; preview `mulai_until` 14:02:00, `close` 14:03:00, `auto_stop` 14:04:00; `warnings: []`.
- F2 open 14:00 close 14:01, C0, now 14:00:20 → valid, `warnings: ["mulai_window_short"]`. F3 now 13:59:00 same input → `warnings: []`.
- F4 now 00:30 → `fast_day_before_business_day`.
- F5 open `23:58` close `00:01`, C1, now 23:58:10 → `business_date` that day, close_ms = next day 00:01.
- F6 open `09:00` close `09:03`, now 14:00 → ok, `warnings: ["mulai_window_passed"]`.
- F7 `FastDayInputSchema` rejects, each with the §3.2 message and path: open `00:30`; open = close; open `23:00` close `01:30`; open `14:00` close `14:01` with C1; D61; A0; C −1; C 241; an extra key; a float; `"9:00"`. Accepts open `14:00` close `14:01` C0 A1 D1; and open `23:58` close `00:01` C1.
- F8 `applyFastDay` replaces only `thu`; every other key `toBe` the same object. `EMPTY_WEEK` + fast → only `thu` non-null.
- F9 (the proof): real-shaped weekly `thu: { open: "07:00", close: "21:45" }` + F1's fast day and timing: `mulaiAvailability` at 14:00:20 → `offered`; window `end_ms` 14:02:00; `selesaiFromMs(14:00:30)` = 14:01:30; `autoStopAtMs` = 14:04:00; at 14:02:01 with no `last_ended` → `window_passed`.
- F10 the same hours with `PRODUCTION_TIMING` → `window_passed` at 14:00:20 (hours alone are not enough, §1.1).
- F11 `effectiveCaptureConfig`: gate false → `config === loaded`, `PRODUCTION_TIMING`; true → `thu` replaced, timing from the fast day; true without `dev_fast_day` → unchanged.
- S1–S8 `fastDayStatus` with F1's fast day: S1 13:59, no session → `before_mulai`, rows `mulai_until` (14:02, remaining 180 000) then `close`. S2 14:02:30, no session → `mulai_missed`, no rows. S3 session started 14:00:30, now 14:01:00 → `running`, rows `selesai_from` (remaining 30 000), `close`, `auto_stop`. S4 same session, now 14:03:30 → `running`, rows `auto_stop` only. S5 `last_ended` same date, `debrief_ends_at_ms` = 14:06:30, now 14:05 → `debrief`, row `debrief_ends` remaining 90 000. S6 same, now 14:07 → `over`. S7 `last_ended` with `end_reason: "discarded"` on the same date → `over` (no debrief row). S8 `last_ended` for a **different** business date → treated as none (`before_mulai` / `mulai_missed` by time).
- Commit: `feat(dev-03): add the pure fast-day builder and status`.

### Task 3: server wiring for the fast day (2 h) — PR B
Files as v1 plus the E19 change. Tests:
- S1 every existing session-service, session-api, contract and config-route test passes unmodified.
- S2 `endSession` with `debrief_duration_ms = 300_000` → `debrief_ends_at_ms = ended_at_ms + 300_000`. S3 `lost` → `auto_stop_at_ms + 300_000`.
- S4 `startSession` with a fast cal → `auto_stop_at_ms = close + A`, no `session_start_outside_window` audit.
- S5 `calendarFor` with a mocked store: fast day → override used; `null` → identical to today.
- K1–K3 config contract (key absent without a fast day; present and parses with one; extra key rejected).
- G1–G3 store gate/per-outlet behaviour (reset `globalThis.__bee6DevFastDays` in `beforeEach`).
- V1 non-device → 403. V2 pilot → 403 and **none of `expireOpenQuestions`, `clearLastEnded`, `store.set` called**. V3 invalid body → ZodError. V4 00:30 → 422, nothing called. V5 open debrief + reset → 409, nothing called. V6 valid + reset + a finished non-discarded debrief → call order exactly `expireOpenQuestions(o, d, ends, now)` → `clearLastEnded` → `store.set`. V7 reset + finished **discarded** debrief → `expireOpenQuestions` not called, `clearLastEnded` called. V8 reset + no `last_ended` → `expireOpenQuestions` not called; `clearLastEnded` **is** called (an idempotent delete). V9 reset false → neither called, `store.set` called. V10 response carries `warnings` from `buildFastDay`. V11 `stopFastDay` on pilot → 403.
- R1–R4 route gate/auth/200/DELETE as v1.
- Commits: `feat(dev-03): apply a dev fast day on the server`, `feat(dev-03): add the dev fast-day route`.

### Task 4: page wiring (1.5 h) — PR B
Files: `app/capture/page.tsx`, `idle-view.ts`, `selesai-view.ts`, `off-hours-banner.ts` (+tests), `lib/dev/fast-day-client.ts` (fast-day calls, +test), `app/capture/page.test.tsx` (extend the `vi.mock("@/lib/capture/dev-mode")` factory with `isDevToolsEnabled`; no existing assertion changes).
- P1 gate off, config mock includes `dev_fast_day`: Selesai not shown at +2 min; no `dev-fast-day`, `dev-tick` or `dev-fast-day-indicator` node.
- P2 mis-set build (`isDevControlsEnabled` true, `isDevToolsEnabled` false): `dev-panel` present; fast-day, tick and indicator absent; fast day ignored.
- P3 gate on, F1, 14:00:20: Mulai offered; tap at 14:00:30; at 14:01:30 + a 30 s tick Selesai shows; `started_at_ms === Date.now()` at the tap.
- P4 no Selesai; past 14:04:00 + a tick → `postSessionEnd` once with `auto_stop`, real `ended_at_ms`; debrief card says 5 min.
- P5 Selesai confirmed → card says 5 min.
- P6 DevPanel `Start fast day` → POST `/api/dev/fast-day` with the exact typed body; config fetched a second time; Mulai offered with the new hours.
- P7 Start disabled while a session runs and while the debrief is open.
- P8 `Run pipeline tick now` is **enabled** while a session runs, while the debrief is open, and with no fast day; tapping it POSTs `/api/dev/tick` and does **not** refetch the config (config fetch count unchanged).
- P9 gate on + `dev_fast_day` → `dev-fast-day-indicator` present (placeholder component from Task 5b may be a stub until 5b lands; this test is added in Task 5b if Task 4 finishes first).
- One new test per view function proving `timing` changes the output.
- Commit: `feat(dev-03): run /capture on the fast-day hours and durations`.

### Task 5: DevPanel sections (1 h) — tick row in PR A, fast-day section in PR B
Files: `app/capture/DevPanel.tsx`, `DevPanel.test.tsx`.
- D1 no `fastDay`/`tick` props → neither node; existing tests unmodified.
- D2 with `tz` = `Asia/Jakarta` and fake time 14:00:20 → Open prefilled `14:00`, Close `14:03`, C1 A1 D5, reset checked; Start → `onStart({ open: "14:00", close: "14:03", selesai_after_mulai_min: 1, auto_stop_after_close_min: 1, debrief_min: 5, reset_last_ended: true })`.
- D3 Close `14:00` (= open) → message `Close must differ from open`, Start disabled. D4 `canStart=false` → disabled + hint. D5 preview line matches §3.8 format. D6 Close `09:03`, Open `09:00` at 14:00 → warning line shown, Start **enabled**. D7 `Fill from now` re-prefills. D8 `tz` null → time inputs disabled.
- D9 tick row: button enabled when not busy regardless of other props; disabled when busy; `onRun` called; each §3.11.4 readout branch renders its line (`device: null`, `lease_held`, `no_segments`, `error`, success with 0 units, success with questions).
- Commits: `feat(dev-03a): add the tick-now row to the dev panel` (PR A), `feat(dev-03): add fast-day controls to the dev panel` (PR B).

### Task U: uiux design pass on the indicator and dev copy (0.5 h, `uiux`) — gates Task 5b
Brief = §3.10 + §3.11.4 verbatim. Output: the §3.10.3 replacement (placement, exact strings per phase and row,
countdown format, colour/border, the a11y live-region choice) and any wording changes for §3.8/§3.11.4 copy.
It must respect B1–B9; if uiux thinks a B-rule is wrong, it says so and the PM brings it to tech-lead, it does
not silently override it. PM pastes the result into §3.10.3, marked "Decided by UI/UX {date}".

### Task 5b: `FastDayIndicator` (1 h, `developer-junior`) — PR B, after Task U
Files: `app/capture/FastDayIndicator.tsx`, `FastDayIndicator.test.tsx`, plus the one render line in `page.tsx` (§3.7 step 8).
- I1 renders §3.10.3's strings for each phase using `fastDayStatus` fixtures S1–S7.
- I2 fake timers: advancing 1 s changes the countdown text by one second; the interval is cleared on unmount (`vi.getTimerCount()` back to the pre-mount count).
- I3 no `role="alert"`; countdown element has `aria-live="off"`.
- I4 at 360 px width (jsdom style check only: no fixed width > 360, `overflowWrap` set); real-device check is Task 6.
- I5 (page) P9 from Task 4.
- Commit: `feat(dev-03): show an always-visible fast-day indicator`.

### Task 6: manual check (Rangga or QA, local; 0.5 h)
Prerequisite (dev-ops): `.env.local` → `bee6-playground`; demo outlet seeded; this browser paired to a demo device;
local ADC can call Vertex + SDP on `bee6-playground`; `NEXT_PUBLIC_DEV_CONTROLS=true`; `npm run dev` restarted.
Fictional script (read aloud, ≥ 10 s per burst): *"The fridge door in the back was left open again this morning, the milk was warm when I checked it. A customer also said her latte was cold and we remade it."*

PR A:
1. No fast day, real hours. Mulai → read the script → wait 90 s of silence → **Run pipeline tick now** → readout shows ≥ 1 unit. Tap it again at once → either `0 units` or `lease_held`, never a double label.
2. Point `.env.local` at the pilot project → tap the button → `Tick failed: dev_demo_only`; dev-server log shows no Gemini call.

PR B:
3. Prefill (now → now + 3), C1 A1 D5, Start → indicator appears at the top with the hours and `Mulai until` countdown. Mulai → indicator `running` with `Selesai from` counting down → Selesai shows → confirm → indicator `debrief`, 5:00 counting down.
4. **Real-question loop (Rangga's DEV-04 objection):** Start again, **C0**: Mulai (Selesai already on screen) → read the script → Selesai → wait 90 s → tick now → readout `n questions` → open the debrief card → real questions → answer one with a reason → after the debrief ends, tick now → readout `n expired`. Total under 7 min.
5. Start again (reset) → Mulai → do not tap Selesai → auto-stop about 1 min after close, `ended automatically`, indicator `debrief`.
6. Type 09:00–09:03 while it is later → warning shown, Start allowed → Mulai shows the missed screen, indicator `mulai_missed`.
7. Restart `npm run dev`, reload `/capture` → indicator gone, readout `Real hours` (E13).
8. `npm run build && npm start` with the same `.env.local` → `curl -X POST localhost:3000/api/dev/fast-day` and `/api/dev/tick` → 404; no DevPanel dev sections, no indicator.
9. 360 px (DevTools iPhone SE) in idle, running, debrief question → indicator visible without scrolling, no horizontal scroll.

---

## 6. Effort and calendar

| Slice | Who | Hours | PR |
|---|---|---|---|
| Task 0 gate and spike | developer | 0.5 | A |
| Task 3b tick-now route | developer | 0.75 | A |
| Task 5 tick row | developer-junior | 0.25 | A |
| Task 6 steps 1–2 | Rangga / QA | 0.25 | A |
| **PR A subtotal** | | **1.75 h** | |
| Task 1 calendar timing | developer | 1.0 | B |
| Task 2 builder (typed times) + status | developer-junior | 1.5 | B |
| Task 3 server wiring + E19 | developer | 2.0 | B |
| Task 4 page wiring | developer | 1.5 | B |
| Task 5 fast-day section (typed times) | developer-junior | 0.75 | B |
| Task U uiux pass | uiux | 0.5 | B (parallel) |
| Task 5b indicator | developer-junior | 1.0 | B |
| Task 6 steps 3–9 | Rangga / QA | 0.5 | B |
| **PR B subtotal** | | **8.75 h** | |
| **Total** | | **10.5 h** agent/tester time (+ tech-lead review and QA per PR) | |
| Prerequisite: `.env.local` → demo, seed, pair, local ADC on demo | dev-ops / Rangga | 0.25 | before A |

**Versus v1:** v1 was DEV-03 6.25 h + DEV-04 2.0 h + tick-now 0.75 h (then unscoped) = 9.0 h. v2 is 10.5 h:
+0.5 typed times (Rangga accepted), +1.5 indicator (status function, uiux pass, component), +0.25 E19, +0.25 tick
row, +0.25 longer manual loop; −2.0 DEV-04 dropped.

**Calendar (today Fri 9 Oct; note: 9 Oct 2026 is a Friday, not a Thursday).** `docs/plan.md` §5: Fri 9 = R-08
finish + R-09; Sat 10 = R-09 finish + R-10 + the real-phone loop test with Tiffany; Sun 11 = P5 + **Cancel-B**
(touches `session-service.ts`) + sign-off 18:00; Mon 12 go-live. `origin/main` shows no R-08 commit yet, so Sprint 2
is already behind, and **Rangga's review/merge time is the real bottleneck**, not agent hours.

Recommendation:
- **PR A (tick-now, 1.75 h): Fri 9, in parallel with R-08.** No file overlap (R-08: `lib/agents`, proposal routes;
  PR A: `next.config.ts`, `lib/capture/dev-mode.ts`, `lib/dev/*`, `app/api/dev/tick`, `DevPanel.tsx`). It is useful
  immediately, with real hours, for R-08/P5 work: it turns fictional speech into real threads and questions on the
  demo project on demand instead of waiting for a scheduler.
- **PR B (fast day, 8.75 h): Sat 10, in parallel with R-09/R-10**, Task U dispatched Fri 9 so Task 5b is unblocked
  on Sat 10. No overlap with R-09/R-10 (owner/supervisor screens, SOP versions). **PR B must merge before
  Cancel-B starts on Sun 11** (both touch `session-service.ts`); if it is not merged by Sun 11 morning, Cancel-B
  goes first and PR B rebases after go-live.
- **Cut line:** if Fri 9 – Sat 10 overrun on R-08/R-09/R-10, **PR B slips to Mon 12 – Wed 14 evenings**; PR A still
  lands. Never cut Task 0's safety or the indicator (Rangga made it a condition of the fast day). DEV-03 is not on
  the go-live critical path and must not displace R-08/R-09/R-10/P5/Cancel-B.
- The Sat 10 real-phone loop test with Tiffany runs on the **pilot** deploy and real hours; DEV-03 does not change
  it (dev tools never reach a deployed build).

---

## 7. Open questions for Rangga

1. **(Decided 9 Oct, recorded)** Demo only; D 1–60 default 5; typed open/close; tick-now in scope; DEV-04 dropped
   per §1.5 unless you want the visual-only sandbox after go-live.
2. **Local credentials for tick-now.** Hard rule §2.4 says model calls use the project's service account. Local
   transcription already runs with whatever credentials `.env.local`/ADC provides; tick-now adds labelling calls
   through the same path on the **demo** project with fictional speech only. Is local ADC (your user account on
   `bee6-playground`) acceptable for the demo project, or should dev-ops set up impersonation of the demo service
   account (`gcloud auth application-default login --impersonate-service-account=…`)? Recommendation: impersonation,
   0.25 h for dev-ops, keeps the rule literal.
3. **Demo project's deployed scheduler job** (E25): should dev-ops pause it while you test locally, so only tick-now
   labels your device? Recommendation: pause it during local sessions; the lease already prevents double labelling,
   but a paused job makes the tick-now readout deterministic.

## Acceptance
- [ ] lint / typecheck / `npx vitest run` clean. Every existing test passes with no assertion changed (only `page.test.tsx`'s dev-mode mock factory gains one export).
- [ ] `/api/dev/*` absent from `next build` (Task 0 spike) and 404 under `next dev` without the flag.
- [ ] No fast day applied, stored or sent, no indicator, no tick button, unless `isDevToolsEnabled()`; dev routes act only on `demo` outlets (pilot → 403, no Gemini call).
- [ ] Every timestamp sent to the server, and `runTick`'s `now_ms`, is the real `Date.now()`.
- [ ] Tick-now is usable at any moment (session running, debrief open, no fast day) and is disabled only while its own call is in flight.
- [ ] The indicator is visible without scrolling at 360 × 640 in every `/capture` state while a fast day is active, and its presentation is the one uiux recorded in §3.10.3.
- [ ] Task 6 step 4: real questions from fictional speech in a real debrief in under 7 minutes, server `debrief_ends_at_ms` equal to the phone's.
- [ ] `lib/debrief/**`, `lib/pipeline/**`, `lib/firestore/schema.ts`, `lib/firestore/tick-store.ts`, `lib/http/guard.ts` and everything in §3.12 unchanged.

## Result
_(builder fills in: commits, test counts, Task 0 spike outcome, Task 6 observations, anything flagged instead of improvised)_

# R-07 Tap debrief: implementation plan

> **For agentic workers:** execute this plan task by task, literally (`superpowers:subagent-driven-development`
> or `superpowers:executing-plans`, plus `superpowers:test-driven-development`). Steps use `- [ ]`. Where the
> plan is silent or seems wrong, **stop and flag it to tech-lead; do not improvise** (CLAUDE.md §10 rule 11).

**Goal:** a paired device's debrief: the entry card after Selesai or the auto-stop, at most 5 of this device's
questions one at a time, *Ya* / *Tidak* plus a required reason or *Lewati*, the done screen, the 1-hour timeout,
the phone answer cache, the device-only answer route with name scrub + SDP redaction, the `staff_confirmed` /
`staff_rejected` gate inputs, and the per-device debrief-end expiry that replaces the 7-day rule.

**Architecture:** pure logic modules (gate v2, expiry, reason checks, scrub, answer planner, phone cache, debrief
reducer) with injected stores, so every rule is unit-tested without Firestore or a browser. Two thin device routes
(`GET /api/v1/questions`, `POST /api/v1/questions/{id}/answer`). The pipeline tick, which already holds a per-device
lease, writes the `unverified` expiry. `/capture` renders the debrief in place (no new URL).

**Tech stack:** Next.js App Router route handlers (check `node_modules/next/dist/docs/` for route handler and
dynamic-segment `params` conventions before writing the routes; `params` is a Promise in this major), zod,
Firestore Admin SDK, Vitest + Testing Library, the existing `lib/redact` `dlpRedactor`, `lib/i18n` dictionary.

**Specs this plan implements (read them, the plan argues from them):**
`docs/tasks/R-07-ux-notes.md` (§3.1, §4, §4a, §4b, §4c are requirements) · `docs/tasks/UX-03-journey-design.md`
§5.8, §6 (`C-d-*` keys, EN singular table, category label table), §5.12 item 3 · `docs/specs/technical-specification.md`
§8.1, §8.3 rule 5, §8.10, §8.11, §8.15, §8.17, §8.18 · `docs/specs/web-backend-rbac.md` §2, §2a, §6.2, §6.6.1,
§6.6.6 · `docs/backlog.md` R-07 (steps, done when) and §3a "R-07 debrief required tests", QA rows D2, K1, K2,
S8, S10, MD2, MD4, A1-A9.

**Skills to load:** `superpowers:test-driven-development`, `api-design`, `error-handling`, `react-patterns`,
`frontend-a11y`, `nextjs-turbopack` (route conventions). Security review: dispatch `security-reviewer` on PR-A
(the answer route), per web spec §6.6.6.

---

## 0. Preconditions (check before starting; stop and tell the PM if any fails)

1. `origin/main` contains PR #13 (P1 server: `capture_sessions`, `devices.last_ended`, the end route writing
   `debrief_ends_at_ms`). **Confirmed on `b95d2e6`.**
2. **The P1 phone side is merged** (the `/capture` rewrite with Mulai / Selesai / auto-stop, the reducer, the
   phone record `bee6.capture.last_ended`, the 30 s checkpoint, `mulaiAvailability` wired to the Mulai button,
   DevPanel "fake now"). **Not on `origin/main` today** (`app/capture/page.tsx` still has the old hours view;
   `feat/prod-01-p1` holds the work). Tasks 1 to 6 do not depend on it and can start now; **Task 7 (page
   integration) must not start until it merges.** Task 7 reads the names P1 ships; where this plan names a P1
   helper (`readLastEnded`, `effectiveLastEnded`, the formatted next-Mulai text), use the merged P1 name and note
   the mapping in the PR.
3. R-05b is merged (questions written by the tick, `q_thread_*` ids). **Confirmed.**
4. R-06 (supervisor day record) is **not built**. R-07 stores everything the supervisor view needs (§9); the
   rendering of "A staff member answered Yes: «…»" and "Rejected by staff" is R-06's, not this task's.

## Global constraints (every task inherits these)

- `REASON_MAX_CHARS = 500`, counted as `Array.from(reason.trim()).length`; refused (400), never truncated.
- `ANSWER_CACHE_MAX_AGE_MS = 14 * 86_400_000`; `DEBRIEF_DURATION_MS = 60 * 60_000` (already in
  `lib/capture/calendar.ts`; import it, never redefine).
- Phone cache key `bee6.debrief.answers`. No name, staff id, PIN, role, device id or uid field anywhere in a
  cache entry, a question, a correction or a response.
- No `answered_by`, `staff_id`, `chosen_category`, `reason_code`, `skip` field anywhere.
- The raw reason and the scrubbed-but-unredacted reason are never persisted, logged, traced or echoed. Logs carry
  `question_id`, an error code and a length only.
- The reason is never read by any rule (no keyword match, no model call). A test proves opposite reasons give an
  identical gate input.
- Device-only answer route. Questions are role-agnostic. The device id is never in a list response item and never
  shown on screen.
- No early release: no code compares answered and total counts to change Mulai or end the debrief.
- One language per screen (`lib/i18n` `t(lang, key)`); the toggle changes copy only. Typed text is never
  translated. Category is an enum code on the wire, mapped to a label by a fixed table on the phone (see
  Task 7.3 and Open question 1).
- Copy strings come only from UX-03 §6 rows (all "Approved by Rangga 6 Oct"). No new wording.
- 360 px first; touch targets ≥ 48 px (entry button 56 px).
- Hard rule #5: the redactor already reads its region via `getServiceLocation("dlp")`; never pass a location.

## Review focus (failure modes no single task's happy path exercises)

1. **A 400 deletes the phone's answer.** Any server failure that is transient (redaction outage, the session end
   not yet received, rate limit) must never be a 400. Pinned by tests in Task 4 (503 for both; 429 lands with the deferred
   rate-limit follow-up, see §11) and Task 6
   (dispositions).
2. **A later tick reopens an answered question or un-excludes a rejected thread** (blind `tx.set`). Pinned in
   Task 5.
3. **Typed text survives somewhere it should not** (a draft in storage, a log line, an error body). Pinned in
   Task 4 (log spy) and Task 7 (storage spy).
4. **Reopening inside the hour shows an answer already given on this phone but not yet uploaded.** Pinned in
   Task 7 (cached ids filtered from the list).
5. **gate v1 output changes by one byte** (an `undefined` key, a reordered check). Pinned in Task 2 (R-05a grid
   unchanged, `toStrictEqual`).

---

## File map

| File | New / change | Responsibility |
|---|---|---|
| `lib/firestore/schema.ts` | change | Question status/answer fields, `CorrectionSchema`, thread staff fields, `GateDecisionSchema` v2 (heartbeat answer fields DEFERRED to P5, §11) |
| `lib/firestore/collections.ts` | change | `rateLimits: "rate_limits"` (DEFERRED to the rate-limit follow-up, §11) |
| `lib/debrief/constants.ts` | new | `REASON_MAX_CHARS`, `ANSWER_CACHE_MAX_AGE_MS`, `DEBRIEF_LIST_SERVER_CAP`, `DEBRIEF_SHOW_MAX`, `INCIDENT_FIRST` (rate-limit constants DEFERRED, §11) |
| `lib/debrief/contract.ts` | new | zod: answer body, list response, answer response, cache entry |
| `lib/pipeline/gate.ts` | change | `staff_answer` input, gate v2, `expireAtDebriefEnd`; delete `expireQuestion` |
| `lib/debrief/reason.ts` | new | `checkReason` (trim, empty, cap) |
| `lib/debrief/scrub.ts` | new | `expandScrubNames`, `scrubReason` (reuses `scrubStaffNames`) |
| `lib/debrief/rank.ts` | new | `rankQuestions` |
| `lib/debrief/answer-plan.ts` | new | `planAnswerCommit` (pure transaction planner incl. the gate producer) |
| `lib/debrief/service.ts` | new | `listDebriefQuestions`, `submitAnswer` over `DebriefStore` |
| `lib/firestore/debrief-store.ts` | new | Firestore `DebriefStore` |
| `app/api/v1/questions/route.ts` | new | `GET` list (device) |
| `app/api/v1/questions/[id]/answer/route.ts` | new | `POST` answer (device) |
| `app/api/v1/auth/pin/route.ts` | change | returns 404, no auth, no body read |
| `lib/capture/calendar.ts` | change | `localHmOf(ms, tz)` |
| `lib/pipeline/tick/service.ts`, `lib/pipeline/tick/types.ts`, `lib/firestore/tick-store.ts` | change | expiry write; non-blind question/thread writes |
| `lib/debrief/answer-cache.ts` | new | phone cache (pure + `Storage` adapter) |
| `lib/debrief/answer-uploader.ts` | new | flush loop and dispositions |
| `lib/debrief/flow.ts` | new | `reduceDebrief` (pure phone state machine) |
| `lib/i18n/dict.ts`, `lib/i18n/category-labels.ts` | change / new | `C-d-*` keys, EN singular keys, category label table |
| `app/capture/debrief/DebriefEntryCard.tsx`, `DebriefFlow.tsx`, `QuestionScreen.tsx`, `DebriefDone.tsx`, `DebriefTimeout.tsx` | new | screens |
| `app/capture/page.tsx` | change | render card / flow; mount uploader; heartbeat fields |
| `app/capture/DevPanel.tsx`, `lib/devices/capture-mode.ts` | change / new | R-07 readouts, mode label (Task 8, cuttable) |

Tests sit next to each file as `*.test.ts(x)` (repo convention).

---

## Task 1: Schemas, constants, contracts (0.5 h, `developer-junior` OK)

**Files:** change `lib/firestore/schema.ts`, `lib/firestore/collections.ts`; create `lib/debrief/constants.ts`,
`lib/debrief/contract.ts`; tests `lib/firestore/schema.test.ts` (extend), `lib/debrief/contract.test.ts`.

**Produces (exact names later tasks use):**

```ts
// lib/debrief/constants.ts
export const REASON_MAX_CHARS = 500;
export const ANSWER_CACHE_MAX_AGE_MS = 14 * 86_400_000;
export const CORRECTION_TEXT_MAX_CHARS = 1000;        // storage bound after redaction placeholders
export const DEBRIEF_SHOW_MAX = 5;                     // phone shows at most 5
export const DEBRIEF_LIST_SERVER_CAP = 10;             // server returns at most 10 (phone filters cached ids, then takes 5)
export const ANSWER_FUTURE_TOLERANCE_MS = 5 * 60_000;
// DEFERRED (Rangga, 7 Oct) to the rate-limit follow-up due before Sun 11 sign-off (§11): do NOT add now.
// export const ANSWER_RATE_WINDOW_MS = 10 * 60_000;
// export const ANSWER_RATE_MAX = 60;
export const ANSWER_RETRY_MS = 60_000;
export const ANSWER_PURGE_INTERVAL_MS = 5 * 60_000;
export const INCIDENT_FIRST: ReadonlySet<WorkCategory> = new Set(["SAFETY_INCIDENT", "SECURITY_INCIDENT", "DISRUPTION"]);
```

`lib/firestore/schema.ts` changes (all new fields optional so every existing doc still parses):

```ts
// QuestionSchema: replace status, add three fields
status: z.enum(["open", "unverified", "answered"]),
answer: z.enum(["yes", "no"]).nullable().optional(),
answered_at_ms: z.number().int().min(0).nullable().optional(),
/** The debrief end that set `unverified` (lets a late in-window answer replace it, §4c item 2). */
expired_by_debrief_end_ms: z.number().int().min(0).nullable().optional(),
```
Keep `QuestionSchema` a plain `z.object(...).strict()` (other code may `.omit/.pick` it). Add a separate
`QuestionDocSchema = QuestionSchema.superRefine(...)` enforcing: `status === "answered"` ⇔ `answer` is
`"yes"|"no"` **and** `answered_at_ms` is a number; `status !== "answered"` ⇒ `answer` and `answered_at_ms` absent
or null. The debrief store parses with `QuestionDocSchema`.

```ts
export const CorrectionSchema = z.object({
  ...withOutlet,
  correction_id: z.string().min(1),            // === question_id (doc id corrections/{question_id})
  question_id: z.string().min(1),
  thread_id: z.string().min(1).nullable(),     // null for unlabelled_unit
  answer: z.enum(["yes", "no"]),
  reason_text: z.string().min(1).max(CORRECTION_TEXT_MAX_CHARS),   // scrubbed THEN redacted, never raw
  answered_device_id: z.string().min(1),       // from claims; never returned to supervisor/owner
  debrief_business_date: dateString,
  answered_at_ms: z.number().int().min(0),
  received_at_ms: z.number().int().min(0),
  needs_supervisor_confirm: z.boolean(),       // thread category in NEEDS_SUPERVISOR_CONFIRM; false for unlabelled
  expires_at: isoDateTime,                     // stored as a native Timestamp (same conversion as segments)
  created_at: isoDateTime,
}).strict();
```
`.max(1000)` counts UTF-16 units in zod; the service checks code points itself before parse (Task 4).

```ts
// ThreadSchema: add three optional fields
label_source: z.enum(["model", "staff_confirmed"]).optional(),
confirmed_category: CategorySchema.optional(),
excluded_from_evidence: z.boolean().optional(),
```

```ts
// GateDecisionSchema (in lib/pipeline/gate.ts, imported by schema.ts)
const GATE_RULES = ["staff_rejected", "invalid_label", "label_conflict", "always_question",
  "needs_supervisor_confirm", "no_evidence", "below_threshold", "staff_confirmed", "passed"] as const;
fired_rule: z.enum(GATE_RULES),
checks: z.array(z.object({ rule: z.enum(GATE_RULES), passed: z.boolean(), waived: z.boolean().optional() }).strict()),
gate_version: z.enum(["1", "2"]),
question_id: z.string().min(1).optional(),     // v2 only
model_category: CategorySchema.optional(),     // v2 only (category = the effective one)
```

**DEFERRED (Rangga, 7 Oct)** to P5 (their only consumer): do NOT add these fields in R-07. Kept here for P5.

```ts
// HeartbeatSchema: add (optional; the request schema derives from it)
answers_pending: z.number().int().min(0).optional(),
answers_pending_oldest_date: dateString.nullable().optional(),
```

`lib/firestore/collections.ts`: add `rateLimits: "rate_limits"` (count docs only, no text). **DEFERRED (Rangga, 7 Oct)** with the
rate limit (§11): do NOT add in R-07.

`lib/debrief/contract.ts`:

```ts
export const QuestionIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9_:~.-]+$/);
export const AnswerBodySchema = z.object({
  question_id: QuestionIdSchema,
  debrief_business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  answer: z.enum(["yes", "no"]),
  reason: z.string().max(20_000),            // raw; the 500 cap is checked after trim, 20k only bounds parsing
  answered_at_ms: z.number().int().min(0),
}).strict();
export const DebriefQuestionViewSchema = z.object({
  question_id: QuestionIdSchema,
  kind: z.enum(["gate", "unlabelled_unit"]),
  category: WorkCategorySchema.nullable(),   // enum code; null for unlabelled_unit
  start_hm: z.string().regex(/^\d{2}:\d{2}$/),
  end_hm: z.string().regex(/^\d{2}:\d{2}$/),
}).strict();
export const DebriefListResponseSchema = z.object({
  debrief: z.object({ business_date: dateString, ends_at_ms: z.number().int().min(0) }).strict().nullable(),
  questions: z.array(DebriefQuestionViewSchema).max(DEBRIEF_LIST_SERVER_CAP),
}).strict();
export const AnswerResponseSchema = z.object({ status: z.enum(["answered", "already_answered"]) }).strict();
export const AnswerCacheEntrySchema = z.object({
  question_id: QuestionIdSchema,
  debrief_business_date: dateString,
  answer: z.enum(["yes", "no"]),
  reason: z.string(),
  answered_at_ms: z.number().int().min(0),
}).strict().refine((e) => e.reason === e.reason.trim() && Array.from(e.reason).length >= 1
  && Array.from(e.reason).length <= REASON_MAX_CHARS, { message: "reason out of range" });
```
(`WorkCategorySchema` = `CategorySchema.exclude(["NON_WORK"])`; add it to `lib/pipeline/categories.ts` if absent.)

- [ ] **Step 1: failing tests** (`lib/debrief/contract.test.ts`, `lib/firestore/schema.test.ts`):
  - `AnswerBodySchema` rejects: missing `answer`; `answer: "maybe"`; each extra key `skip`, `explanation`,
    `chosen_category`, `staff_id`, `device_id`, `answered_by`; accepts the exact five keys.
  - `AnswerCacheEntrySchema` key set is exactly the five keys (assert `Object.keys(shape)`), rejects an extra
    `name` / `staff_id` / `role` / `device_id`; rejects `reason: ""`, `" x"` (untrimmed), 501 code points; accepts
    500 code points including one emoji (`"😀" + "a".repeat(499)`).
  - `CorrectionSchema` rejects `answered_by`, `staff_id`, `name`, `chosen_category`, `reason_code`; requires
    `answer`.
  - `QuestionDocSchema`: `answered` without `answer` fails; `open` with `answer: "yes"` fails; an R-05b doc
    (no new fields) parses.
  - `DebriefQuestionViewSchema` rejects `device_id`, `thread_id`, `status`, `text`.
  - Old `ThreadSchema` / `HeartbeatSchema` docs still parse; `GateDecisionSchema` parses a v1 decision unchanged.
- [ ] **Step 2:** run `npx vitest run lib/debrief/contract.test.ts lib/firestore/schema.test.ts`, expect FAIL.
- [ ] **Step 3:** implement the shapes above.
- [ ] **Step 4:** tests pass; `npm run typecheck`.
- [ ] **Step 5:** commit `feat(r-07): debrief schemas, constants and contracts`.

---

## Task 2: Gate v2 and debrief-end expiry (0.75 h, `developer`)

**Files:** change `lib/pipeline/gate.ts`, `lib/pipeline/gate.test.ts`.

**Produces:**

```ts
export type StaffAnswerInput = { question_id: string; chosen_category: WorkCategory | null };
export function evaluateGate(input: {
  category: WorkCategory; confidence: number; evidence_line_ids: readonly string[];
  label_conflict: boolean; staff_answer?: StaffAnswerInput;
}): GateDecision;

export type QuestionStatus = "open" | "unverified" | "answered";
export function expireAtDebriefEnd(
  q: { status: QuestionStatus; created_at_ms: number },
  debrief_ends_at_ms: number | null,   // this device's latest ended debrief end
  now_ms: number,
): { status: QuestionStatus; expired_by_debrief_end_ms: number | null } | null;  // null = no change
```

**Rules.**
- **No `staff_answer`:** the current code path, byte-identical (same checks array, same order, `gate_version: "1"`,
  no `question_id` / `model_category` / `waived` keys at all, not even `undefined`). Do not refactor v1.
- **`staff_answer.chosen_category === null` (NO):** compute the v1 checks for the model category as today (for the
  log), then prepend `{ rule: "staff_rejected", passed: false }`; `fired_rule: "staff_rejected"`,
  `verdict: "question"`, `category` = model category, `model_category` = model category, `question_id`,
  `gate_version: "2"`. No `passed` check at the end (`{ rule: "passed", passed: false }` as v1 does on any fire).
  This holds even with 0 evidence lines on a COMPLAINT thread.
- **`chosen_category !== null` (YES):** effective category `c = chosen_category`. Checks, in this order:
  `invalid_label` (category valid and not NON_WORK, confidence finite in [0,1]; never waived),
  `label_conflict` (`waived: true`), `always_question` (`waived: true`), `needs_supervisor_confirm` (on `c`, never
  waived), `no_evidence` (never waived), `below_threshold` (`waived: true`). Each records its real `passed`; a
  waived check never fires. Precedence among the non-waived: `invalid_label` → `needs_supervisor_confirm` →
  `no_evidence`; if none fires: `fired_rule: "staff_confirmed"`, `verdict: "fact"`, push
  `{ rule: "staff_confirmed", passed: true }`; otherwise push `{ rule: "staff_confirmed", passed: false }`.
  `category: c`, `model_category`, `question_id`, `threshold` and `confidence` as v1, `gate_version: "2"`.
- **Expiry (§4c):** `status !== "open"` → `null` (answered yes/no and unverified are never touched).
  `debrief_ends_at_ms === null` → `null`. `created_at_ms <= E && E <= now_ms` →
  `{ status: "unverified", expired_by_debrief_end_ms: E }`. Otherwise `null`. No age rule exists anywhere.
- Delete `expireQuestion` and the 7-day tests. `grep -rn expireQuestion app lib` must return nothing afterwards.
  `applyGateDecision` stays as is (the tick's no-answer path; `unverified` terminal there); update its doc comment
  to say the late-answer path is in `lib/debrief/answer-plan.ts`.

- [ ] **Step 1: failing tests** (keep the R-05a exhaustive grid test file untouched; it must still pass):
  1. low-confidence CUSTOMER_SERVICE (0.3, 2 evidence) + `chosen_category: "CUSTOMER_SERVICE"` → fact,
     `staff_confirmed`, `below_threshold` check `{ passed: false, waived: true }`, `gate_version: "2"`.
  2. COMPLAINT + `"COMPLAINT"` → question, `needs_supervisor_confirm`.
  3. 0 evidence + a confirm → question, `no_evidence`.
  4. PHONE_CALL + `"PHONE_CALL"` → fact (always_question waived).
  5. label_conflict true + confirm → fact (waived).
  6. `null` → `staff_rejected`, verdict question; same on a COMPLAINT thread with 0 evidence.
  7. NaN confidence + confirm → `invalid_label`.
  8. For every case of the R-05a grid, `evaluateGate(x)` `toStrictEqual` the v1 result recorded before the
     change (generate a fixture from the current code in Step 1, commit it as `gate.v1-fixture.json`, then assert),
     and `"question_id" in result === false`.
  9. Expiry: open, created 01:00, E 02:10, now 02:10 → unverified/E; created 02:20, E 02:10 → null; E null (off
     or cancelled day) → null; answered yes and answered no → null; unverified → null; created 30 days ago, E null
     → null (no age rule); now < E → null.
- [ ] **Step 2:** run `npx vitest run lib/pipeline/gate.test.ts`, expect FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** pass; also run the whole `lib/pipeline` suite (the tick still type-checks against the new enum).
- [ ] **Step 5:** commit `feat(r-07): gate v2 staff answer input and debrief-end expiry`.

---

## Task 3: Reason checks and the staff-name scrub (0.25 h, `developer`)

**Files:** create `lib/debrief/reason.ts`, `lib/debrief/scrub.ts`, tests beside them.

```ts
// reason.ts
export type ReasonCheck = { ok: true; trimmed: string } | { ok: false; code: "reason_empty" | "reason_too_long" };
export function checkReason(reason: string): ReasonCheck;      // trim(); "" → empty; Array.from(t).length > 500 → too_long
export function reasonLength(reason: string): number;          // Array.from(reason.trim()).length (the phone counter uses this)

// scrub.ts
export function expandScrubNames(rawNames: readonly string[]): string[];
// for each name: normalizeStaffName(name) (lib/auth/staff-name.ts); add the full normalized name;
// add every whitespace token with Array.from(token).length >= 3; dedupe; sort by code-point length desc.
export function scrubReason(text: string, rawNames: readonly string[]): string;
// = scrubStaffNames(text, expandScrubNames(rawNames))  (reuse lib/pipeline/label/scrub.ts; do not copy it)
```

- [ ] **Step 1: failing tests:** `checkReason("")`, `"   \n "` → `reason_empty`; 500 code points with an emoji → ok;
  501 → `reason_too_long`; `"  ok  "` → `trimmed: "ok"`. Scrub with names `["Dina Putri"]`:
  `"dina lupa restock"` → `"[STAFF] lupa restock"`; `"DINA PUTRI telat"` → `"[STAFF] telat"`; `"Dinamo"` unchanged;
  `"Putri bilang"` → `"[STAFF] bilang"`; names `["Al Bo"]` (tokens < 3) → only `"al bo"` matched, `"al"` alone kept;
  empty names list → text unchanged; accent: names `["Dédé"]`, `"dede datang"` → `"[STAFF] datang"`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(r-07): reason checks and staff-name scrub for debrief answers`.

---

## Task 4: Debrief service, store, routes, PIN off (1.25 h, `developer`; security-reviewer on this PR)

> **DEFERRED (Rangga, 7 Oct)**: the per-device answer rate limit (`takeAnswerToken`, check 7, the `rate_limits` store
> doc and its test) moves to a follow-up that **must land before the Sun 11 Oct sign-off**. Reason: budget (§11).
> Build the route without check 7; keep the check numbering below unchanged so the follow-up slots back in.

**Files:** create `lib/debrief/rank.ts`, `lib/debrief/answer-plan.ts`, `lib/debrief/service.ts`,
`lib/firestore/debrief-store.ts`, `app/api/v1/questions/route.ts`, `app/api/v1/questions/[id]/answer/route.ts`;
change `app/api/v1/auth/pin/route.ts`, `lib/capture/calendar.ts` (`localHmOf`); tests beside each.

### 4.1 Store contract (`lib/debrief/service.ts`)

```ts
export interface EndedDebrief { business_date: string; debrief_ends_at_ms: number }   // start = ends − DEBRIEF_DURATION_MS
export interface AnswerTxSnapshot { question: Question | null; thread: Thread | null; correction_exists: boolean }
export interface AnswerWritePlan {
  result: "answered" | "already_answered" | "question_closed";
  question_patch?: Partial<Question>;          // status/answer/answered_at_ms (and clears expired_by_debrief_end_ms)
  thread_patch?: Partial<Thread>;              // gate, status, label_source, confirmed_category, excluded_from_evidence
  correction?: Correction;                     // created with tx.create at corrections/{question_id}
  audit?: { action: "debrief.answer_uploaded"; target_type: "question"; target_id: string; details: { device_id: string } };
}
export interface DebriefStore {                 // outlet fixed at construction (from claims)
  getLastEnded(device_id: string): Promise<LastEnded | null>;
  getOutletCalendar(): Promise<{ tz: string; retention_days: number }>;   // retention_days default 14
  listOpenQuestions(device_id: string): Promise<Question[]>;              // outlet_id ==, device_id ==, status == "open"
  getQuestion(question_id: string): Promise<Question | null>;             // any outlet; the service checks scope
  findEndedDebrief(device_id: string, business_date: string): Promise<EndedDebrief | null>;
  // capture_sessions where outlet_id ==, device_id ==, local_date == business_date, end_reason in
  // [selesai, auto_stop, lost], debrief_ends_at_ms != null; if several, the latest debrief_ends_at_ms.
  // Fast path: devices/{outlet}:{device}.last_ended when its business_date matches.
  listStaffNames(): Promise<string[]>;                                    // raw `staff.name` values of the outlet
  // DEFERRED (rate-limit follow-up, before Sun 11): takeAnswerToken(device_id: string, now_ms: number): Promise<boolean>;
  transactAnswer(question_id: string, fn: (s: AnswerTxSnapshot) => AnswerWritePlan): Promise<AnswerWritePlan["result"]>;
}
```

`firestoreDebriefStore(outletId, db = adminDb())` in `lib/firestore/debrief-store.ts`:
- device doc id `deviceDocId(outletId, device_id)`; parse with `DeviceSchema`.
- questions parsed with `QuestionDocSchema`; a doc that fails to parse is skipped in the list and logged by
  `question_id` only.
- DEFERRED (rate-limit follow-up, before Sun 11), not built in R-07: `takeAnswerToken`: one transaction on `rate_limits/answers:{device_id}:{Math.floor(now/ANSWER_RATE_WINDOW_MS)}`
  `{ outlet_id, count }`; `count >= ANSWER_RATE_MAX` → return false; else set `count + 1`.
- `transactAnswer`: inside `db.runTransaction`: **all reads first** (question doc; thread doc if
  `question.thread_id`; `corrections/{question_id}`), then `fn`, then writes: `tx.update(question, patch)`,
  `tx.update(thread, patch)` when present, `tx.create(correction)` (convert `expires_at` to a Timestamp like
  `firestoreSegmentStore` does), `tx.create` an `audit_log` doc (auto id) parsed with `AuditLogSchema`,
  `actor_role: "device"`.
- If Firestore asks for a composite index on any query, the error goes to `dev-ops`; do not change the query
  shape to dodge it without telling tech-lead.

### 4.2 `listDebriefQuestions(store, claims, now_ms)`

1. `last = getLastEnded(claims.device_id)`. Active iff `last && last.end_reason !== "discarded" &&
   last.debrief_ends_at_ms !== null && now_ms < last.debrief_ends_at_ms`. Not active → return
   `{ debrief: null, questions: [] }` (the phone shows the load-error state with retry, Task 7; this covers an end
   still queued offline).
2. `qs = listOpenQuestions(device_id)`; defensively drop any with `device_id !== claims.device_id` or
   `outlet_id !== claims.outlet_id`.
3. `rankQuestions(qs)` (`lib/debrief/rank.ts`): `kind === "gate" && category ∈ INCIDENT_FIRST` first; then
   `window_start_ms` ascending; tie `question_id` ascending. Slice `DEBRIEF_LIST_SERVER_CAP`.
4. Map to `DebriefQuestionView`: `start_hm = localHmOf(window_start_ms, tz)`, `end_hm = localHmOf(window_end_ms, tz)`,
   `category` = the question's category when `kind === "gate"` and it is a work category, else `null`.
5. Return `DebriefListResponseSchema.parse({ debrief: { business_date: last.business_date, ends_at_ms }, questions })`.

`localHmOf(ms, tz)` in `lib/capture/calendar.ts`: `"HH:MM"` from the existing `zonedParts` (24 h, zero padded).
Test: `Asia/Jakarta`, `Date.UTC(2026,9,7,19,5)` → `"02:05"`.

### 4.3 `submitAnswer(deps, claims, path_id, rawBody, now_ms)`

Deps: `{ store, redactor: Redactor, log }`. Throw `AppError(message, code, status)` for every coded failure (no
`details`, no echo of input). Order is normative (A-tests depend on it):

| # | Check | Failure |
|---|---|---|
| 1 | `requireDevice` (route) | 401; any verified ID token (supervisor, owner, staff, judge) → 403 **before the body is read** |
| 2 | body is JSON (route: `await req.text()` then `JSON.parse` in try) | 400 `invalid_body` |
| 3 | `AnswerBodySchema.safeParse` | 400 `invalid_body` |
| 4 | `path_id === body.question_id` and `QuestionIdSchema` on `path_id` | 400 `invalid_body` |
| 5 | `checkReason(body.reason)` | 400 `reason_empty` / 400 `reason_too_long` |
| 6 | `answered_at_ms > now + 5 min` or `< now − 14 days` (exactly 14 days old is refused) | 400 `answered_at_out_of_range` |
| 7 | DEFERRED (follow-up before Sun 11): `takeAnswerToken` false | 429 `rate_limited` (`LockedError`, Retry-After 60). Skip in R-07 |
| 8 | `getQuestion`: missing, `outlet_id ≠ claims`, or `device_id ≠ claims` | 404 `NOT_FOUND` (same body for all three) |
| 9 | question `status === "answered"` | 200 `{ status: "already_answered" }`, nothing written, no redaction call |
| 10 | `findEndedDebrief(device, body.debrief_business_date)` is null | **503 `SERVICE_UNAVAILABLE`** (existing ServiceUnavailableError; no new 409, Rangga 7 Oct) (the end is still queued; the phone keeps the entry; see Open question 3) |
| 11 | `ends − 60 min <= answered_at_ms <= ends` | 400 `not_in_debrief` |
| 12 | question `unverified` and `expired_by_debrief_end_ms !== ends` | 400 `question_closed` |
| 13 | `s = scrubReason(trimmed, await listStaffNames())` | (a store failure → 503 `SERVICE_UNAVAILABLE`, same as 14) |
| 14 | `r = await redactor.redact(s)` in try/catch | any throw → 503 `SERVICE_UNAVAILABLE`; nothing written; log `{ question_id, code, length }` only |
| 15 | `Array.from(r).length > CORRECTION_TEXT_MAX_CHARS` | 400 `reason_too_long` (placeholders lengthened it; rare) |
| 16 | `transactAnswer(question_id, (snap) => planAnswerCommit({...}))` | result `already_answered` → 200 `already_answered`; `question_closed` → 400 `question_closed` |
| 17 | log `{ event: "debrief.answer", question_id, result, fired_rule? }` | — |

Response 200 `{ data: { status: "answered" } }` (`AnswerResponseSchema`).

### 4.4 `planAnswerCommit` (pure, `lib/debrief/answer-plan.ts`)

Input: `{ snap, body: { answer, debrief_business_date, answered_at_ms }, ends_ms, redacted_reason, device_id,
outlet_id, now_ms, retention_days }`. Re-checks inside the transaction (a racing tick or a second phone):
- `snap.question` null → throw `NotFoundError` (deleted by Cancel-B between read and write).
- `status === "answered"` or `snap.correction_exists` → `{ result: "already_answered" }` (first committed answer
  wins; no writes).
- `status === "unverified" && expired_by_debrief_end_ms !== ends_ms` → `{ result: "question_closed" }`.
- Otherwise:
  - `question_patch = { status: "answered", answer, answered_at_ms, expired_by_debrief_end_ms: null }`.
  - `correction` = full `CorrectionSchema` doc: `correction_id = question_id`, `thread_id`, `answer`,
    `reason_text = redacted_reason`, `answered_device_id = device_id`, `debrief_business_date`, `answered_at_ms`,
    `received_at_ms = now_ms`, `needs_supervisor_confirm = thread ? NEEDS_SUPERVISOR_CONFIRM.has(thread.category) : false`,
    `expires_at = new Date(answered_at_ms + retention_days * 86_400_000).toISOString()`,
    `created_at = new Date(now_ms).toISOString()`.
  - **Gate producer** only when `question.kind === "gate"` and `snap.thread` exists:
    `gate = evaluateGate({ category: thread.category, confidence: thread.confidence, evidence_line_ids:
    thread.evidence_line_ids, label_conflict: thread.label_conflict, staff_answer: { question_id,
    chosen_category: answer === "yes" ? thread.category : null } })`.
    - YES and `gate.fired_rule === "staff_confirmed"` → `thread_patch = { gate, status: "fact",
      label_source: "staff_confirmed", confirmed_category: thread.category }`.
    - YES and any other rule → `thread_patch = { gate, status: "open", label_source: "model" }` (stays a supervisor
      question; no `confirmed_category`).
    - NO → `thread_patch = { gate, status: "open", label_source: "model", excluded_from_evidence: true }`. Never
      sets `confirmed_category`. No new question is created (R-07 has no question-creation path; the tick's is
      guarded in Task 5).
    - `kind === "gate"` but thread missing → write the correction and question, no thread patch (log
      `thread_missing` with `question_id`).
  - `unlabelled_unit`: no gate call, no thread patch.
  - `audit = { action: "debrief.answer_uploaded", target_type: "question", target_id: question_id, details: { device_id } }`.
  - The reason is an input only to `correction.reason_text`. It is not passed to `evaluateGate` or read anywhere
    else (a test passes two different reasons and asserts identical `evaluateGate` arguments via a spy).

### 4.5 Routes

`app/api/v1/questions/route.ts`:
```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const claims = await requireDevice(req);
    const data = await listDebriefQuestions(firestoreDebriefStore(claims.outlet_id), claims, Date.now());
    return jsonOk(data);
  } catch (e) { return handleApiError(e); }
}
```
Any non-device principal → 403 (from `requireDevice`). The supervisor read-only branch is R-06/R-09's, not R-07's.

`app/api/v1/questions/[id]/answer/route.ts`: `POST(req, { params })`, `const { id } = await params` (verify the
`params` type in `node_modules/next/dist/docs/` first), `requireDevice` first, then `await req.text()`, then
`submitAnswer({ store: firestoreDebriefStore(claims.outlet_id), redactor: dlpRedactor(), log }, claims, id, text, Date.now())`.
Never `console.*` the body, `text`, `reason` or `s`.

`app/api/v1/auth/pin/route.ts`: replace the handler body with
`return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });` before any
auth or body read. Remove the now-unused imports; leave `lib/auth/pin.ts` and `staffPinLogin` in place (dormant,
post-MVP 1).

### 4.6 Failing tests first

`lib/debrief/service.test.ts` (fake in-memory `DebriefStore`, spy redactor, spy log):
- order: empty reason on a non-existent question → 400 `reason_empty` (not 404); 501 code points → 400
  `reason_too_long`, `getQuestion` never called; `answer: "maybe"` → `invalid_body`, nothing written.
- `answered_at_ms` now + 5 min + 1 → 400; now − 14 d → 400; now − 14 d + 1 → passes check 6.
- another outlet's question → 404; another device's question of the same outlet → 404; identical body for both
  and for a missing id.
- DEFERRED (rate-limit follow-up, before Sun 11), do not write in R-07: rate: 61st call within the window → 429; the fake counts per device (device B unaffected).
- already answered → 200 `already_answered`, redactor not called, no write.
- no ended debrief for the date → 503 `SERVICE_UNAVAILABLE` (not 409); window `[ends − 60 min, ends]`: `ends − 60 min` and
  `ends` accepted, `ends + 1` → 400 `not_in_debrief`.
- S8: question expired by `ends` (status `unverified`, `expired_by_debrief_end_ms = ends`), answer at `ends − 5 min`
  uploaded at `ends + 20 min` → `answered`; same question with `expired_by_debrief_end_ms` = an older end → 400
  `question_closed`.
- redactor throws → 503 `SERVICE_UNAVAILABLE`; question still `open`; no correction; log lines contain no
  reason substring (scan every spy call's JSON for the input text and for `"Dina"` and `"0812"`).
- A3: staff `["Dina"]`, reason `"Dina lupa, nomor pelanggan 0812 3456 7890"`, redactor fake replaces the digits
  with `[PHONE_NUMBER]` → stored `reason_text` contains `[STAFF]` and `[PHONE_NUMBER]`, not `Dina`, not `0812`.
- stored correction has `answered_device_id`, `answered_at_ms`, `received_at_ms`, and none of `answered_by`,
  `staff_id`, `name`, `uid`.
- redacted text longer than 1000 code points → 400 `reason_too_long`, nothing written.

`lib/debrief/answer-plan.test.ts`: A8 (YES on low-confidence CUSTOMER_SERVICE, 2 evidence → thread fact,
`staff_confirmed`, `confirmed_category`, `gate_version "2"`); A9 (NO → question `answered`/`no`, thread
`excluded_from_evidence: true`, `label_source: "model"`, no `confirmed_category`, gate `staff_rejected`); YES on
COMPLAINT → thread `open`, `needs_supervisor_confirm`, correction `needs_supervisor_confirm: true`; NO on COMPLAINT
→ excluded; YES/NO on `unlabelled_unit` → evaluateGate spy not called; opposite reasons → identical evaluateGate
args; snapshot already answered → `already_answered`, no writes (two phones racing: first wins).

`lib/debrief/rank.test.ts`: incidents first, then oldest, tie by id; cap 10.

`app/api/v1/questions/route.test.ts` and `.../answer/route.test.ts` (mock `requireDevice`, `firestoreDebriefStore`,
`dlpRedactor`): supervisor ID token → 403 and `req.text` never called (spy); no token → 401; unparseable JSON →
400 `invalid_body`; path id ≠ body id → 400; list with no active debrief → `{ debrief: null, questions: [] }`;
list response keys exactly `question_id, kind, category, start_hm, end_hm`.

`app/api/v1/auth/pin/route.test.ts`: any body, any token → 404; `requireDevice` not called.

- [ ] Steps: write tests → FAIL → implement 4.1 to 4.5 → PASS → `npm run lint && npm run typecheck` → commit
  in two commits: `feat(r-07): debrief list and answer service with store` and
  `feat(r-07): device-only question routes; PIN route returns 404`.

---

## Task 5: Tick: expiry write and non-blind question/thread writes (0.5 h, `developer`)

**Files:** change `lib/pipeline/tick/types.ts` (store interface + `DeviceTickResult.questions_expired`),
`lib/pipeline/tick/service.ts`, `lib/firestore/tick-store.ts`; tests `service.test.ts`, `tick-store.test.ts`.

**5.1 Expiry write.** New `TickStore` methods:
```ts
getLastEnded(outletId: string, deviceId: string): Promise<LastEnded | null>;
expireOpenQuestions(outletId: string, deviceId: string, debriefEndsAtMs: number, nowMs: number): Promise<number>;
```
`expireOpenQuestions` queries `questions` where `outlet_id ==`, `device_id ==`, `status == "open"`, then in
transactions of at most 100 docs: re-read each, apply `expireAtDebriefEnd(q, E, now)`; on a non-null result
`tx.update(q, { status: "unverified", expired_by_debrief_end_ms: E })`, and for `kind === "gate"` with a thread
whose `status === "open"` and `excluded_from_evidence !== true`, `tx.update(thread, { status: "unverified" })`
(reads of all docs in the chunk first). Returns the count.

In `processOneDevice`, **right after the lease is acquired and before `listSegmentsForDevice`** (so a device with
no segments still expires): `last = getLastEnded(...)`; if `last?.debrief_ends_at_ms != null &&
last.end_reason !== "discarded" && last.debrief_ends_at_ms <= now_ms` → `questions_expired =
await expireOpenQuestions(...)`. Wrap in its own try/catch (log `error_class` only); a failure never stops
labelling. Add `questions_expired` to every `DeviceTickResult` return (0 on skips).
Known limit (write in the PR): only the device's latest ended debrief is used; if the tick were down across two
debriefs of one device, older open questions expire at the next end instead.

**5.2 Non-blind writes in `writeUnitResult`** (all reads in the existing read phase, before any write):
- For each question doc: `tx.get`. Missing → `tx.set` (as today). Exists with `status !== "open"` → **skip** (never
  reopen an answered or unverified question). Exists `open` → `tx.update` only `{ category, window_start_ms,
  window_end_ms }` (keep `created_at_ms`, so expiry is not pushed forward).
- For each thread doc: `tx.get`. If the stored thread has `label_source === "staff_confirmed"` or
  `excluded_from_evidence === true` → write the new doc but carry over from the stored doc: `label_source`,
  `confirmed_category`, `excluded_from_evidence`, `status`, `gate` (the staff decision stands; new lines still
  merge). Otherwise `tx.set` as today.

- [ ] **Step 1: failing tests:** device with no segments but `last_ended` E ≤ now → open question created before E
  becomes `unverified` with `expired_by_debrief_end_ms: E`, `questions_expired: 1`; created after E stays open;
  E > now → nothing; `end_reason: "discarded"` → nothing; device A's E leaves device B's question open (MD2);
  answered yes / no untouched; a later unit continuing a NO-rejected thread keeps `excluded_from_evidence: true`
  and does not overwrite the `answered` question; continuing a staff-confirmed thread keeps `status: "fact"`;
  an open question's `created_at_ms` is unchanged by a continuation; `expireOpenQuestions` throwing → labelling
  still runs and the result has `questions_expired: 0`.
- [ ] Steps 2-4: FAIL → implement → PASS (whole `lib/pipeline` and `lib/firestore` suites).
- [ ] **Step 5:** commit `fix(r-07): tick expires questions at the debrief end and never reopens answers`.

---

## Task 6: Phone answer cache and uploader (0.5 h, `developer`)

**Files:** create `lib/debrief/answer-cache.ts`, `lib/debrief/answer-uploader.ts`, tests beside them.

```ts
// answer-cache.ts (storage injected: window.localStorage in the page, a Map-backed fake in tests)
export const ANSWER_CACHE_KEY = "bee6.debrief.answers";
export class CacheWriteError extends Error {}
export function readCache(storage: Storage): AnswerCacheEntry[];
// JSON.parse in try: invalid JSON → []; non-array → []; each item kept only if AnswerCacheEntrySchema passes.
export function purgeExpired(entries: AnswerCacheEntry[], now_ms: number): AnswerCacheEntry[];
// keep iff now_ms − answered_at_ms < ANSWER_CACHE_MAX_AGE_MS  (14 d − 1 ms kept, exactly 14 d removed)
export function appendAnswer(storage: Storage, entry: AnswerCacheEntry, now_ms: number): "added" | "duplicate";
// purge, then if question_id already present → "duplicate" (first answer wins, nothing changes), else append;
// setItem in try → throw CacheWriteError on any failure (quota, private mode). Validates entry with the schema first.
export function removeEntry(storage: Storage, question_id: string): void;
export function purgeNow(storage: Storage, now_ms: number): number;   // returns entries removed; writes back
export function pendingSummary(entries: AnswerCacheEntry[]): { count: number; oldest_date: string | null };
export function cachedIds(storage: Storage, now_ms: number): Set<string>;
```

```ts
// answer-uploader.ts
export type Disposition = "removed_ok" | "removed_refused" | "kept_retry" | "kept_offline";
export function dispositionFor(status: number | "network"): Disposition;
// 200..299 → removed_ok; 400, 404, 422 → removed_refused (dev event log: question_id + status only);
// 401, 403, 409, 429, >= 500 → kept_retry; "network" → kept_offline.
export function createAnswerUploader(deps: {
  storage: Storage; fetchFn: typeof fetch; auth: DeviceAuth; now: () => number;
  devLog: (e: { kind: "answer_refused"; question_id: string; status: number }) => void;
}): { flush(): Promise<{ last: Disposition | null; pending: number }> };
```
`flush`: single-flight (a second call while one runs returns the running promise); `purgeNow` first; then oldest
`answered_at_ms` first, one POST at a time to `/api/v1/questions/${encodeURIComponent(id)}/answer` with
`deviceAuthHeaders(auth)` and `Content-Type: application/json`, body = the cache entry exactly (the five keys,
nothing added). Stop the loop at the first `kept_*` result (the rest would fail the same way). The request carries
only the device token and `X-Device-Id` (D5); no cookie or other credential is added.

- [ ] **Step 1: failing tests:** entry written before `fetchFn` is called (call-order spy on `storage.setItem` vs
  `fetchFn`, through a helper `commitAndSend(entry)` = `appendAnswer` then `flush()`); 200 and 200
  `already_answered` remove; 400 removes and devLogs `{question_id, status}` with no reason; 404 removes; 503,
  409, 429, 401 keep; network error keeps and returns `kept_offline`; K2: entries at now − 14 d (purged, never
  fetched) and now − 14 d + 1 min (sent, removed); 14 d − 1 ms kept and sent; corrupt JSON → `[]` and the next
  append succeeds; `setItem` throwing → `CacheWriteError`; duplicate `question_id` → `"duplicate"`, the first
  entry unchanged; `pendingSummary` returns count + oldest `debrief_business_date`; the POST body has exactly the
  five keys.
- [ ] Steps 2-4: FAIL → implement → PASS.
- [ ] **Step 5:** commit `feat(r-07): phone answer cache with 14-day purge and uploader`.

---

## Task 7: Debrief screens and page integration (1.0 h, `developer`; starts only after P1 phone side merges)

> **DEFERRED (Rangga, 7 Oct):** the heartbeat `answers_pending` / `answers_pending_oldest_date` fields (in 7.5)
> move to P5, their only consumer. Reason: budget (§11). `pendingSummary` itself stays (Task 6; DevPanel uses it).

**Files:** create `lib/debrief/flow.ts`, `lib/i18n/category-labels.ts`, `app/capture/debrief/*.tsx`; change
`lib/i18n/dict.ts`, `app/capture/page.tsx`; tests `lib/debrief/flow.test.ts`, `app/capture/debrief/*.test.tsx`,
`app/capture/page.test.tsx` (extend).

### 7.1 State machine `reduceDebrief` (pure)

```ts
export type DebriefView =
  | { kind: "closed" }                                   // /capture shows the entry card (if now < ends)
  | { kind: "loading" }
  | { kind: "load_error" }
  | { kind: "empty" }
  | { kind: "question"; list: DebriefQuestionView[]; index: number; choice: "yes" | "no" | null;
      reason: string; save_error: boolean }
  | { kind: "done"; answered: number; skipped: number }
  | { kind: "timed_out"; ended_at_ms: number };
export type DebriefState = { view: DebriefView; ends_at_ms: number; business_date: string | null };
export type DebriefEvent =
  | { type: "OPEN" } | { type: "RETRY" }
  | { type: "LOADED"; questions: DebriefQuestionView[]; business_date: string; cached: ReadonlySet<string> }
  | { type: "LOAD_FAILED" }
  | { type: "CHOOSE"; answer: "yes" | "no" } | { type: "TYPE"; reason: string }
  | { type: "COMMITTED" } | { type: "COMMIT_FAILED" } | { type: "SKIP" }
  | { type: "BACK" } | { type: "TICK"; now_ms: number };
export function reduceDebrief(s: DebriefState, e: DebriefEvent): DebriefState;
export function canCommit(v: DebriefView): boolean;   // question && choice !== null && 1 <= reasonLength(reason) <= 500
```
Rules: `OPEN`/`RETRY` → `loading`. `LOADED`: drop questions whose id is in `cached`, take the first
`DEBRIEF_SHOW_MAX`; empty → `empty`; else `question` index 0, `choice: null`, `reason: ""`. `LOAD_FAILED` →
`load_error`. A list response with `debrief: null` is dispatched as `LOAD_FAILED` (the server does not see the
debrief yet). `CHOOSE` sets/switches `choice`, keeps `reason`, never advances. `TYPE` replaces `reason` (no
trimming in state; no cap in state). `COMMITTED` (dispatched only after `appendAnswer` succeeded) → next index with
`choice: null, reason: ""`, or `done` with counts. `COMMIT_FAILED` → `save_error: true`, choice and reason kept.
`SKIP` → next index (choice and reason discarded) and `skipped + 1`, or `done`. `BACK` from `done`/`empty`/
`timed_out`/`load_error` → `closed`. `TICK` with `now_ms >= ends_at_ms`: from any view except `closed` →
`timed_out` (choice and reason dropped from state); from `closed` → unchanged (the page hides the card).
Every other combination returns the same state object. **No event, count or view ever changes Mulai.**

### 7.2 Components (copy keys only from §7.4; every string via `t(lang, ...)`)

- `DebriefEntryCard` props `{ endsAtMs, nowMs, nextMulaiText, onOpen }`: `C-d-entry-h`; `C-d-entry-left` with
  `mm = Math.max(1, Math.ceil((endsAtMs − nowMs) / 60_000))` (EN singular key at 1); button `C-d-btn` (min-height
  56 px, full width); `C-d-takes`; under the card `C-d-next` with P1's next-Mulai day and time (the same values P1
  renders in `C-m-debrief`). No question text, kind, topic or count before the list loads.
- `QuestionScreen`: heading (focus target, `tabIndex={-1}`, focused on each new index) = progress `C-d-prog`
  (`N = index+1`, `M = list.length`) then the question text (7.3). Radiogroup: `role="radiogroup"` with
  `aria-label` = the question text; two `role="radio"` buttons `C-d-yes` / `C-d-no`, `aria-checked`, 48 px tall,
  equal width side by side at 360 px, selected state = fill + "✓" glyph; ArrowLeft/ArrowRight move and select.
  Reason block only when `choice !== null`: `<label>` `C-d-r-yes` or `C-d-r-no` (+ second line), `<textarea
  rows={4} autoComplete="off">` 16 px, **no `maxLength`**; counter right-aligned: `n = reasonLength(reason)`;
  `n < 450` → `C-d-count`; `450 <= n <= 500` → `C-d-count-warn` (`M = 500 − n`) in the warning tone;
  `n > 500` → `C-d-over` (`N = n − 500`, EN singular at 1). Footer: `C-b-lewati` (secondary, left, always
  enabled) and `C-b-lanjut` (primary, right, `disabled={!canCommit}`); under it `C-d-help-dis` when disabled for a
  missing choice or empty reason, `C-d-over` when over; `C-d-locked` once, below the footer, on the first question
  only. `save_error` → `C-d-save-fail` (3 lines) in `role="alert"`, focus moved to it. Upload status line (polite
  `role="status"`) from the uploader's last result: `kept_offline` → `C-d-offline`; `kept_retry` →
  `C-d-refused`; anything else → nothing (`removed_refused` is recorded in the dev event log only, since the
  server will never accept that entry).
- `DebriefDone`: heading `C-d-done-h` (focused), `C-d-done-l`; if `pending > 0` → `C-d-done-unsent` (N, singular
  EN at 1); if `skipped > 0` → `C-d-done-skip` (N, `{hm}` = HH:MM of `ends_at_ms`); always `C-d-done-mulai`;
  button `C-b-kembali` → `BACK`. The empty state uses `C-d-empty-h` (2 lines) + `C-b-kembali`. No recap.
- `DebriefTimeout`: `C-d-timeout` (3 lines, `{hm}` = HH:MM of `ends_at_ms`) + `C-b-kembali`; shown inline on
  `/capture` in place of the card until dismissed or reload.
- Loading: `C-d-load` with `aria-busy="true"`. Load error: `C-d-err` + `C-b-coba` (48 px) → `RETRY`.

**Lanjut handler (exact order):** (1) if `now >= ends_at_ms` → dispatch `TICK` (timeout) and stop; (2) build the
entry `{ question_id, debrief_business_date: state.business_date, answer: choice, reason: reason.trim(),
answered_at_ms: Date.now() }` (real clock, never the dev fake-now offset); (3) `appendAnswer(localStorage, entry,
now)` in try: `CacheWriteError` → `COMMIT_FAILED` and stop; `"duplicate"` is treated as success; (4) dispatch
`COMMITTED`; (5) `void uploader.flush()` (do not await before advancing). **Lewati:** dispatch `SKIP`, nothing
else (no storage call, no fetch).

### 7.3 Question text and category labels

`lib/i18n/category-labels.ts`: `export const CATEGORY_LABELS: Record<Lang, Partial<Record<WorkCategory, string>>>`
with `en` = the 11 EN labels from UX-03 §6 (verbatim) and `id = {}` (Q-U23 pending). `questionText(lang, q)`:
`q.kind === "gate" && q.category && CATEGORY_LABELS[lang][q.category]` → `t(lang, "C-d-q-step", { hm:
q.start_hm, step: label })`; otherwise `C-d-q-block` with `{ hm: q.start_hm, hm_end: q.end_hm }` (EN row has two
lines; render both). An unknown code falls back to `C-d-q-block`. Never render anything from the server other than
the enum-mapped label and the two `HH:MM` strings.

### 7.4 Dictionary keys (`lib/i18n/dict.ts`, both `ID` and `EN`, text verbatim from UX-03 §6)

The `t()` placeholder regex is `[a-zA-Z_]+`, so rename sheet placeholders: `{HH:MM}` → `{hm}` (second time in
`C-d-q-block` → `{hm_end}`), `{Thu 15 Oct}` / `{Kam 15 Okt}` → `{day}`, `{mm}` stays, `{N}`/`{M}` stay,
`{step}`/`{langkah}` → `{step}`. Multi-line rows become `KEY` (L1), `KEY-2` (L2), `KEY-3` (L3). EN singular forms
become `KEY-one` (ID copies the plural row's text). Keys: `C-d-entry-h`, `C-d-entry-left`(+`-one`),
`C-d-entry-n`(+`-one`), `C-d-btn`, `C-d-takes`, `C-d-next`, `C-d-load`(+`-2`), `C-d-err`(+`-2`), `C-d-empty-h`
(+`-2`), `C-d-prog`, `C-d-q-step`, `C-d-q-block`(+`-2` EN; ID has one line, so ID `-2` = `""` and the component
skips empty lines), `C-d-yes`, `C-d-no`, `C-d-r-yes`(+`-2`), `C-d-r-no`(+`-2`), `C-d-count`, `C-d-count-warn`,
`C-d-over`(+`-one`), `C-d-help-dis`, `C-d-locked`, `C-d-save-fail`(+`-2`,`-3`), `C-d-refused`(+`-2`),
`C-d-offline`, `C-d-done-h`, `C-d-done-l`, `C-d-done-unsent`(+`-2`, +`-one`), `C-d-done-skip`(+`-2`, +`-one`),
`C-d-done-mulai`, `C-d-timeout`(+`-2`,`-3`); and `C-b-kembali`, `C-b-lewati`, `C-b-lanjut`, `C-b-coba` if not
already present. Skip any key already in the dict with the same text. Run the existing dict tests (every key in
both languages, ≤ 59 characters per line).

### 7.5 Page integration (`app/capture/page.tsx`)

- `debriefEndsAtMs` = the effective last-ended record P1 already computes (phone `bee6.capture.last_ended` merged
  with the config's `last_ended`, later wins): `end_reason !== "discarded"` and `debrief_ends_at_ms !== null`.
  Show the card iff `nowMs() < debriefEndsAtMs` (P1's `nowMs()`, which includes dev fake-now) and the debrief view
  is `closed`. The card is placed above the primary slot.
- **Within 2 s:** P1 writes the last-ended record before dispatching `SELESAI` / `AUTO_STOP`; the card must derive
  from that state on the same render (not wait for the 30 s tick). Test it on both transitions.
- `useReducer(reduceDebrief, ...)`, `ends_at_ms = debriefEndsAtMs`. The page's existing 30 s tick and the
  `visibilitychange` handler also dispatch `TICK`; additionally, while the view is `question`, a 1 s interval
  dispatches `TICK` (so the timeout closes the screen on time) and is cleared on leave.
- `OPEN` → `fetch("/api/v1/questions", { headers: deviceAuthHeaders(auth) })` → parse with
  `DebriefListResponseSchema` → `LOADED` with `cached = cachedIds(localStorage, now)` and the response's
  `business_date`; non-2xx, network error, parse failure or `debrief: null` → `LOAD_FAILED`.
- Uploader: created once at mount (after `readDeviceAuth()`); `flush()` on mount, on `window` `online`, every
  `ANSWER_RETRY_MS`, and after each commit; `purgeNow` every `ANSWER_PURGE_INTERVAL_MS` and when the flow opens.
  Disposed (intervals and listener removed) on unmount.
- **DEFERRED (Rangga, 7 Oct)** to P5, do NOT build in R-07: Heartbeat: wherever the page builds the heartbeat body, add `answers_pending` and
  `answers_pending_oldest_date` from `pendingSummary(readCache(localStorage))` when `count > 0` (omit both when 0).
- The language toggle must not touch debrief state: the reducer state is not keyed on `lang`, and the textarea is
  controlled from reducer state.

### 7.6 Failing tests first

`lib/debrief/flow.test.ts`: every transition above; `LOADED` filters cached ids and caps at 5; `COMMIT_FAILED`
keeps text; `SKIP` discards choice and reason; `TICK` at `ends` from `question` → `timed_out` with no reason in
state; `TICK` before `ends` returns the same object; `BACK` from `done` → `closed`; no exported function takes or
returns anything Mulai-related (grep test: `flow.ts` does not import `calendar`).

`app/capture/debrief/QuestionScreen.test.tsx` (Testing Library, fake timers): nothing preselected; tapping Ya
does not advance; switching Ya → Tidak keeps typed text and swaps the label; Lanjut disabled with no choice, with
`"   "`, enabled with `"a"`; paste 600 chars → field keeps 600, `C-d-over` shows 100, Lanjut disabled,
`localStorage.setItem` never called; exactly 500 with an emoji enabled; counter switches to warn at 450; textarea
has no `maxlength` attribute; radios have `role="radio"` + `aria-checked`, arrow keys move; at 360 px both radios
are on one row (assert computed widths via a layout-independent check: both buttons inside one flex row with
`flex: 1`).

`app/capture/debrief/DebriefFlow.test.tsx` (mock fetch + Map storage): A7: choose Ya, type, Lewati → no
`setItem`, no fetch; reopen (`BACK` then `OPEN`) shows the same question with no choice and an empty reason;
`setItem` with `bee6.debrief.answers` happens before the POST `fetch` (call order); `setItem` throwing →
`C-d-save-fail` in `role="alert"`, text kept, no fetch; at no point is `setItem`/`sessionStorage.setItem` called with
any other key holding the reason (spy all keys, scan values for the typed text before Lanjut); timeout while text
is typed → `C-d-timeout`, typed text not in storage; Lanjut tapped after `ends` → timeout, nothing cached; A5:
everything answered → done screen, and the page's Mulai stays disabled until `ends` (render the page with fake
time, assert Mulai disabled at `ends − 1 ms` and enabled within one 30 s tick after `ends`); language toggle
mid-question keeps choice, reason and focus; reopen with one answer still in the cache → that question is not
shown; list `debrief: null` → `C-d-err` with retry.

`app/capture/page.test.tsx`: the entry card appears synchronously after the Selesai confirm and after an auto-stop
(including a past-midnight auto-stop at 02:00 with `ends` 03:00); not after a cancel; reload at `ends − 30 min`
shows `C-d-entry-left` with 30; reload at `ends + 1 min` shows no card. (DEFERRED to P5, do not write in R-07:
heartbeat body carries `answers_pending: 2` with two cached entries and omits both fields with none.)

- [ ] Steps: tests → FAIL → implement 7.1 to 7.5 → PASS → lint, typecheck → commits:
  `feat(r-07): debrief state machine and copy keys`, `feat(r-07): debrief screens on /capture`.

---

## Task 8: DevPanel readouts and the mode label (0.25 h, `developer-junior`; kept in scope by Rangga, 7 Oct)

**Files:** create `lib/devices/capture-mode.ts` (+ test); change `app/capture/DevPanel.tsx` (+ test),
`lib/capture/contract.ts` + `app/api/v1/capture/config/route.ts` (one display-only field).

- `export function captureMode(n: number): "none" | "room" | "wearable"` (0 → none, 1 → room, > 1 → wearable).
- Config response gains `capture_mode` (display only), computed at read time from the outlet's devices with
  `paired_at` set and `revoked !== true`. Update the strict `CaptureConfigResponseSchema` and its contract test.
- DevPanel (only when `NEXT_PUBLIC_DEV_CONTROLS`): answer-cache count (`pendingSummary(readCache(localStorage)).count`; `answers_pending` itself is deferred to P5), oldest
  entry age in minutes, a "purge now" button (`purgeNow(localStorage, Date.now())`, then re-read), the mode label,
  and this device's short id (first 6 chars).
- Test: `captureMode(0|1|2)`; an import-ban test: no file under `lib/capture/session*`, `lib/pipeline/**`,
  `lib/debrief/**`, `lib/capture/calendar.ts` imports `lib/devices/capture-mode` (read the files, regex on import
  lines); DevPanel shows the readouts only with dev controls on.
- Commit `feat(r-07): dev readouts for the answer cache and the derived mode label`.

---

## 9. What R-07 leaves for R-06 / R-08 / P5 (record in the PR, do not build)

- Supervisor day record (R-06): read `corrections/{question_id}` beside its thread; show "A staff member answered
  Yes/No: «reason_text»" (supervisor only, never `answered_device_id`), and "Rejected by staff" when
  `excluded_from_evidence === true`. Owner: no reason. The supervisor's `GET /api/v1/questions` branch.
- Every evidence consumer (R-06 counts, R-08 citations, P5 sufficiency) must skip threads with
  `excluded_from_evidence === true` and use `confirmed_category ?? category`.
- Cancel-B must delete `corrections/{question_id}` with each deleted question.
- dev-ops: a Firestore TTL policy on `corrections.expires_at` (P4), and any composite index Firestore asks for on
  `questions (outlet_id, device_id, status)` or `capture_sessions (outlet_id, device_id, local_date)`.

## 10. Hard-rule checklist (how this plan meets each one)

| Rule | How |
|---|---|
| #1 Google only | Redaction uses the existing `dlpRedactor`; no model call anywhere in R-07 |
| #2 No audio | No audio path is touched |
| #3 Redact before storing | Scrub then SDP before the only text write (`reason_text`); 503 on failure, nothing written |
| #5 Regions | `dlpRedactor()` reads its location from `config/regions.yaml`; no location in R-07 code |
| #6 No browser Firestore | Phone uses only the two routes; both check device claims and scope by outlet + device |
| #7 Names | Names read from `staff` only, used in memory for the scrub; no name or role stored; device id never in a list item or a supervisor response |
| #9 SOP via proposals | R-07 writes no SOP |
| #10 Gate is code | Gate v2 is plain code; the reason never reaches it (test) |
| #11 Small commits | ~12 commits listed above |

## 11. Hours

| Task | Hours | Agent |
|---|---|---|
| 1 Schemas, constants, contracts | 0.5 | developer-junior |
| 2 Gate v2 + expiry | 0.75 | developer |
| 3 Reason checks + scrub | 0.25 | developer |
| 4 Service, store, routes, PIN 404 (rate limit deferred) | 1.25 | developer (+ security-reviewer) |
| 5 Tick expiry + non-blind writes | 0.5 | developer |
| 6 Phone cache + uploader | 0.5 | developer |
| 7 Screens + page integration (heartbeat fields deferred) | 1.0 | developer |
| 8 DevPanel readouts + mode label (kept) | 0.25 | developer-junior |
| **Total** | **5.0** | |

**Rangga's decision (7 Oct, Open question 6):** keep Task 8; apply cuts (b) and (c). Original total 5.5 h, minus
0.25 h (b) and 0.25 h (c) = **5.0 h, still 0.25 h over the 4.75 h budget.** Reason the plan ran over: the 4.75 h
was sized before it was known that gate v2 does not exist yet (R-07 notes call `staff_rejected` "existing"; it is
not in `gate.ts`) and that the tick's blind writes must be fixed here.

**Deferred:**
| Item | Moves to | Due | Reason |
|---|---|---|---|
| (b) Per-device answer rate limit: `takeAnswerToken`, check 7 (429 `rate_limited`), `rate_limits` collection + constants, its service test | Follow-up task (own small PR, `developer`) | **Before the Sun 11 Oct sign-off** | Budget. The answer route is device-token only and writes are idempotent per question, so the exposure in the gap is bounded, but it must not ship to sign-off without it |
| (c) Heartbeat `answers_pending` / `answers_pending_oldest_date` (schema fields in Task 1, body fields + test in Task 7.5) | P5 | With P5 | Budget. P5 is their only consumer; nothing in R-07 reads them |

**Next cut candidate (for Rangga to decide; NOT applied):** the original cut order was (a) Task 8, (b), (c). With
(b) and (c) applied, the only remaining item in that order is **(a) Task 8 to R-06 (0.25 h)**, which would bring
the total to exactly 4.75 h. Rangga kept Task 8 on 7 Oct, so the alternative is to accept 5.0 h (0.25 h over).

**PR split:** PR-A = Tasks 1 to 5 (server; security-reviewer on it). PR-B = Tasks 6 to 8 (phone; after P1 phone
side merges). Each PR gets tech-lead review + independent QA (browser for PR-B: rows D2, K1, K2, A1, A2, A5, A7,
MD4 at 360 px).

## 12. Open questions for Rangga

1. "Debrief categories shown as enum codes, never translated": tech-lead reads this as "the wire carries the enum
   code and the phone maps it with the fixed UX-03 table; ID mode uses the block template until Q-U23 labels
   exist". Confirm, or say if the raw code (e.g. `ROUTINE_OPS`) should be shown on screen.
2. Is the 5-question cap per debrief (a fixed pick) or per opening (reopening shows the next unanswered ones)? The
   plan builds per opening.
3. New status codes on the answer route: none new: debrief-not-ended reuses 503 `SERVICE_UNAVAILABLE` (keep and retry, decided 7 Oct) when the server has not received
   the session end yet, and 404 treated as "remove" on the phone. OK to add these to web spec §6.6.6 and
   technical spec §8.11?
4. A YES on a COMPLAINT / incident thread: the thread stays `label_source: "model"` (only a fact gets
   `staff_confirmed`). OK?
5. An expired gate question also sets its thread to `unverified`. OK?
6. ~~Budget~~ Decided 7 Oct: keep Task 8, defer (b) rate limit (before Sun 11) and (c) heartbeat fields (P5).
   Plan is 5.0 h, 0.25 h over. Still open: accept 5.0 h, or also move Task 8 to R-06 (see §11)?
